# All three services start on a bootstrap placeholder image. CI replaces it
# via `gcloud run deploy --image=...@sha256:<digest>`; each service's
# `lifecycle.ignore_changes` block below stops later `terraform apply` runs
# from reverting CI's deploy.

locals {
  # Shared by backend (service) and backend_migrate (job) — everything except
  # the DB connection var, which differs from backend_script_runner's (still
  # Cloud SQL/MySQL — see backend_script_runner_secret_env in cloud-run-jobs.tf).
  backend_common_secret_env = [
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

  # backend (service) and backend_migrate (job) — Postgres/Supabase via a
  # single DATABASE_URL. backend_script_runner stays on Cloud SQL/MySQL for
  # now (see cloud-run-jobs.tf) — not part of this cutover.
  backend_secret_env = concat(
    [{ name = "DATABASE_URL", secret = "backend-database-url" }],
    local.backend_common_secret_env
  )
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

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_URL"
        value = "https://${var.domain}"
      }
      env {
        # Expected OIDC caller for backend's internal routes — verified by
        # Cloud Scheduler-invoked order-sync-run/competitor-drain-run (pgmq
        # migration, ADR 0002) same as the pre-existing internal-competitor
        # routes. No outbound Cloud Tasks wiring needed anymore.
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

# order-worker (the private, least-privilege Cloud Run service that used to
# host /internal/sync-order + /internal/scheduled-order-discovery, invoked
# via Cloud Tasks) was retired 2026-08-15 — its logic folded into `backend`
# as part of the Cloud Tasks -> pgmq migration. See
# docs/decisions/0002-pgmq-order-sync-competitor-queue-migration.md and
# docs/execution-plans/completed/plan-15082026-pgmq-queue-migration.md.
