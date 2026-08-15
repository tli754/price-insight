# Daily batch drain triggers for the two pgmq queues (shopify_orders,
# dataforseo_competitors) that replaced Cloud Tasks + order-worker — see
# docs/decisions/0002-pgmq-order-sync-competitor-queue-migration.md. Two
# independent Cloud Scheduler jobs, matching the two independent manual
# "drain now" buttons in the frontend (/orders, /products) — same reasoning
# as the old scheduled_order_discovery job this replaces: one job, one
# target, no fan-out logic needed in a single combined route.
#
# Fixed UTC offset (not an IANA time_zone), same simplification the old
# scheduled_order_discovery job used ("14:00 UTC = 2:00am NZST") — drifts an
# hour during NZDT. Matches existing precedent rather than introducing a new
# pattern; not revisited here per "keep it simple, iterate" (see ADR 0002).

resource "google_project_service" "cloudscheduler" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

# shopify_orders: discovery (last-24h Shopify scan) + drain, in one
# execution — see routes/order-sync-internal.ts.
resource "google_cloud_scheduler_job" "order_sync_drain" {
  name      = "order-sync-drain"
  project   = var.project_id
  region    = var.region
  schedule  = "0 13 * * *" # 13:00 UTC = 1:00am NZST
  time_zone = "Etc/UTC"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/internal/order-sync-run"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.backend.uri
    }
  }

  depends_on = [
    google_project_service.cloudscheduler,
    google_cloud_run_v2_service_iam_member.backend_public,
  ]
}

# dataforseo_competitors: drain-only, no discovery stage (purely webhook-fed)
# — see routes/competitor-drain-internal.ts.
resource "google_cloud_scheduler_job" "competitor_drain" {
  name      = "competitor-drain"
  project   = var.project_id
  region    = var.region
  schedule  = "0 13 * * *" # 13:00 UTC = 1:00am NZST
  time_zone = "Etc/UTC"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.backend.uri}/internal/competitor-drain-run"

    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = google_cloud_run_v2_service.backend.uri
    }
  }

  depends_on = [
    google_project_service.cloudscheduler,
    google_cloud_run_v2_service_iam_member.backend_public,
  ]
}
