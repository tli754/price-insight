resource "google_project_service" "cloudtasks" {
  project            = var.project_id
  service            = "cloudtasks.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudscheduler" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

# Mirrors today's BullMQ defaultJobOptions (attempts: 3, exponential backoff).
resource "google_cloud_tasks_queue" "order_sync" {
  name     = "order-sync"
  project  = var.project_id
  location = var.region

  retry_config {
    max_attempts = 3
    min_backoff  = "2s"
    max_backoff  = "60s"
  }

  rate_limits {
    max_concurrent_dispatches = 1 # mirrors today's BullMQ Worker concurrency: 1
  }

  depends_on = [google_project_service.cloudtasks]
}

# Both backend (webhook/manual sync) and order-worker (scheduled-discovery
# fan-out) create tasks on this queue. This grants enqueuer access only;
# actAs-ing the invoker SA onto each created task's oidcToken is granted
# separately in service-accounts.tf (backend_actas_invoker /
# order_worker_actas_invoker).
resource "google_cloud_tasks_queue_iam_member" "backend_enqueuer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.order_sync.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${data.google_service_account.backend_runtime.email}"
}

resource "google_cloud_tasks_queue_iam_member" "order_worker_enqueuer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.order_sync.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.order_worker_runtime.email}"
}

# Replaces the in-process node-cron 2am schedule (incompatible with Cloud
# Run's scale-to-zero — see plan-17062026-4-cloud-tasks-queue.md).
resource "google_cloud_scheduler_job" "scheduled_order_discovery" {
  name      = "scheduled-order-discovery"
  project   = var.project_id
  region    = var.region
  schedule  = "0 14 * * *" # 14:00 UTC = 2:00am NZST
  time_zone = "Etc/UTC"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.order_worker.uri}/internal/scheduled-order-discovery"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.order_worker.uri
    }
  }

  depends_on = [
    google_project_service.cloudscheduler,
    google_cloud_run_v2_service_iam_member.order_worker_invoker,
  ]
}
