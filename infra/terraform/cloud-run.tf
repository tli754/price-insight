# All three services start on a bootstrap placeholder image. CI replaces it
# via `gcloud run deploy --image=...@sha256:<digest>`; each service's
# `lifecycle.ignore_changes` block below stops later `terraform apply` runs
# from reverting CI's deploy.

locals {
  backend_secret_env = [
    { name = "MYSQL_HOST", secret = "backend-mysql-host" },
    { name = "MYSQL_USER", secret = "backend-mysql-user" },
    { name = "MYSQL_PASSWORD", secret = "backend-mysql-password" },
    { name = "MYSQL_DATABASE", secret = "backend-mysql-database" },
    { name = "OPENAI_API_KEY", secret = "backend-openai-api-key" },
    { name = "OPENAI_MODEL", secret = "backend-openai-model" },
    { name = "JINA_API_KEY", secret = "backend-jina-api-key" },
    { name = "SERPAPI_API_KEY", secret = "backend-serpapi-api-key" },
    { name = "DATAFORSEO_LOGIN", secret = "backend-dataforseo-login" },
    { name = "DATAFORSEO_PASSWORD", secret = "backend-dataforseo-password" },
    { name = "DATAFORSEO_WEBHOOK_SECRET", secret = "backend-dataforseo-webhook-secret" },
    { name = "SHOPIFY_TOKEN_URL", secret = "backend-shopify-token-url" },
    { name = "SHOPIFY_PRODUCTS_URL", secret = "backend-shopify-products-url" },
    { name = "SHOPIFY_ORDERS_URL", secret = "backend-shopify-orders-url" },
    { name = "SHOPIFY_CLIENT_ID", secret = "backend-shopify-client-id" },
    { name = "SHOPIFY_CLIENT_SECRET", secret = "backend-shopify-client-secret" },
    { name = "OWN_STORE_NAME", secret = "backend-own-store-name" },
    { name = "SESSION_SECRET", secret = "backend-session-secret" },
    { name = "DEV_AUTH_PASSWORD", secret = "backend-dev-auth-password" },
  ]

  # Provisional — see the order-worker comment block below.
  order_worker_secret_env = [
    { name = "MYSQL_HOST", secret = "backend-mysql-host" },
    { name = "MYSQL_USER", secret = "backend-mysql-user" },
    { name = "MYSQL_PASSWORD", secret = "backend-mysql-password" },
    { name = "MYSQL_DATABASE", secret = "backend-mysql-database" },
    { name = "SHOPIFY_TOKEN_URL", secret = "backend-shopify-token-url" },
    { name = "SHOPIFY_PRODUCTS_URL", secret = "backend-shopify-products-url" },
    { name = "SHOPIFY_ORDERS_URL", secret = "backend-shopify-orders-url" },
    { name = "SHOPIFY_CLIENT_ID", secret = "backend-shopify-client-id" },
    { name = "SHOPIFY_CLIENT_SECRET", secret = "backend-shopify-client-secret" },
  ]
}

# --- frontend (public, behind the load balancer) ----------------------------

resource "google_cloud_run_v2_service" "frontend" {
  name                = "frontend"
  project             = var.project_id
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = false

  template {
    service_account = google_service_account.frontend_runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }

    containers {
      image = var.bootstrap_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
      traffic,
    ]
  }

  depends_on = [google_project_service.run]
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.frontend.location
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- backend (public, behind the load balancer) -----------------------------
#
# NOTE: the currently-deployed backend image still runs BullMQ/node-cron
# in-process (PR 4 hasn't shipped) and needs Redis to fully function — Redis
# is intentionally not provisioned here. The bootstrap image deploys and
# passes health checks fine; the *real* backend image will be degraded
# (missing Redis, missing Cloud SQL Unix-socket support in db/index.ts) until
# those follow-up code changes ship. See plan-17062026-2-cloud-run-infra.md
# Risks.

resource "google_cloud_run_v2_service" "backend" {
  name                = "backend"
  project             = var.project_id
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = data.google_service_account.backend_runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_connection_name]
      }
    }

    containers {
      image = var.bootstrap_image

      ports {
        container_port = 4000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_URL"
        value = "https://${var.domain}"
      }
      env {
        name  = "MYSQL_PORT"
        value = "3306"
      }
      env {
        name  = "CLOUD_TASKS_PROJECT"
        value = var.project_id
      }
      env {
        name  = "CLOUD_TASKS_LOCATION"
        value = var.region
      }
      env {
        name  = "CLOUD_TASKS_QUEUE"
        value = google_cloud_tasks_queue.order_sync.name
      }
      env {
        name  = "ORDER_WORKER_URL"
        value = google_cloud_run_v2_service.order_worker.uri
      }
      env {
        name  = "INTERNAL_OIDC_SERVICE_ACCOUNT"
        value = google_service_account.invoker.email
      }

      dynamic "env" {
        for_each = local.backend_secret_env
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
      traffic,
    ]
  }

  depends_on = [
    google_project_service.run,
    google_project_service.sqladmin,
    google_secret_manager_secret_iam_member.backend_runtime_secrets,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- order-worker (private — IAM-gated, not in the load balancer) ----------
#
# PR 4 decision: reuses the backend image, but overrides command/args to run
# dist/order-worker-server.js — a separate, narrower entrypoint that only
# registers /internal/* routes and skips OpenAI/DataForSEO/auth/session
# wiring, matching this service's least-privilege secret scope below.
#
# command/args aren't set in this resource — they're applied by CI's
# `gcloud run deploy --command --args` alongside the real image, and ignored
# here (see lifecycle.ignore_changes), so the bootstrap placeholder's own
# entrypoint is what gets health-checked on the first `terraform apply`.

resource "google_cloud_run_v2_service" "order_worker" {
  name                = "order-worker"
  project             = var.project_id
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL" # IAM is the privacy control, not ingress — see plan Risks.
  deletion_protection = false

  template {
    service_account = google_service_account.order_worker_runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_connection_name]
      }
    }

    containers {
      # command/args are deliberately omitted here — see ignore_changes below.
      # CI's `gcloud run deploy` sets them alongside the real image so the
      # bootstrap placeholder's own entrypoint is what gets health-checked.
      image = var.bootstrap_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "MYSQL_PORT"
        value = "3306"
      }
      env {
        name  = "CLOUD_TASKS_PROJECT"
        value = var.project_id
      }
      env {
        name  = "CLOUD_TASKS_LOCATION"
        value = var.region
      }
      env {
        name  = "CLOUD_TASKS_QUEUE"
        value = google_cloud_tasks_queue.order_sync.name
      }
      env {
        name  = "INTERNAL_OIDC_SERVICE_ACCOUNT"
        value = google_service_account.invoker.email
      }

      dynamic "env" {
        for_each = local.order_worker_secret_env
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].command,
      template[0].containers[0].args,
      client,
      client_version,
      traffic,
    ]
  }

  depends_on = [
    google_project_service.run,
    google_project_service.sqladmin,
    google_secret_manager_secret_iam_member.order_worker_secrets,
  ]
}

# No allUsers binding — only the dedicated OIDC caller identity may invoke.
resource "google_cloud_run_v2_service_iam_member" "order_worker_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.order_worker.location
  name     = google_cloud_run_v2_service.order_worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.invoker.email}"
}
