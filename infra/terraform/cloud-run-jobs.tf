# One-off maintenance scripts (apps/backend/src/scripts/**, compiled to
# dist/scripts/*.js) need the same Cloud SQL connector, Cloud Tasks, and
# Secret Manager access as the backend service — this Job reuses the backend
# image/SA/env instead of duplicating that wiring. Default command/args run
# load-recent-orders.js; override per-execution for other scripts:
#   gcloud run jobs execute backend-script-runner \
#     --region=australia-southeast1 --project=wd-tools \
#     --args=dist/scripts/<other-script>.js \
#     --update-env-vars=SINCE=2026-06-14 \
#     --wait
locals {
  # backend_script_runner still targets Cloud SQL/MySQL — not part of the
  # Postgres cutover (backend service + backend_migrate only, see cloud-run.tf).
  backend_script_runner_secret_env = concat(
    [
      { name = "MYSQL_HOST", secret = "backend-mysql-host" },
      { name = "MYSQL_USER", secret = "backend-mysql-user" },
      { name = "MYSQL_PASSWORD", secret = "backend-mysql-password" },
      { name = "MYSQL_DATABASE", secret = "backend-mysql-database" },
    ],
    local.backend_common_secret_env
  )
}

resource "google_cloud_run_v2_job" "backend_script_runner" {
  name     = "backend-script-runner"
  project  = var.project_id
  location = var.region

  template {
    template {
      service_account = data.google_service_account.backend_runtime.email
      max_retries     = 0
      timeout         = "1800s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.cloud_sql_connection_name]
        }
      }

      containers {
        image   = var.bootstrap_image
        command = ["node"]
        args    = ["dist/scripts/load-recent-orders.js"]

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

        dynamic "env" {
          for_each = local.backend_script_runner_secret_env
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
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.run,
    google_project_service.sqladmin,
    google_secret_manager_secret_iam_member.backend_runtime_secrets,
  ]
}

# Applies pending Drizzle migrations (drizzle/*.sql) against Cloud SQL. Cloud Run
# serves via `node dist/server.js`, which does NOT run migrations, so schema
# changes must be applied out-of-band before the new service revision goes live.
# infra/deploy-backend.sh executes this Job on the new image, waits, and only
# then deploys the backend service — keeping migrate-before-deploy the default
# path. Runs run-migrations.js, which self-heals __drizzle_migrations drift.
# Reuses the backend image/SA/env like backend-script-runner; env mirrors it
# because run-migrations.ts calls loadEnv() (the full backend env).
resource "google_cloud_run_v2_job" "backend_migrate" {
  name     = "backend-migrate"
  project  = var.project_id
  location = var.region

  template {
    template {
      service_account = data.google_service_account.backend_runtime.email
      max_retries     = 0
      timeout         = "1800s"

      containers {
        image   = var.bootstrap_image
        command = ["node"]
        args    = ["dist/db/run-migrations.js"]

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
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.run,
    google_project_service.sqladmin,
    google_secret_manager_secret_iam_member.backend_runtime_secrets,
  ]
}
