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
