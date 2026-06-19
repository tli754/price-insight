resource "google_secret_manager_secret_iam_member" "ci_backend" {
  for_each  = google_secret_manager_secret.backend
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.ci_sa_email}"
}

resource "google_secret_manager_secret_iam_member" "ci_frontend" {
  for_each  = google_secret_manager_secret.frontend
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.ci_sa_email}"
}

resource "google_secret_manager_secret_iam_member" "ci_gateway" {
  for_each  = google_secret_manager_secret.gateway
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.ci_sa_email}"
}

# Lets price-insight-ci run `gcloud run deploy` for routine image releases
# (split deployment ownership — Terraform owns shape, CI owns images).
# Scoped per-service, not project-wide.
resource "google_cloud_run_v2_service_iam_member" "ci_frontend_deployer" {
  project  = var.project_id
  location = google_cloud_run_v2_service.frontend.location
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.ci_sa_email}"
}

resource "google_cloud_run_v2_service_iam_member" "ci_backend_deployer" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.ci_sa_email}"
}

# Literal location/name (not a reference to google_cloud_run_v2_service.order_worker)
# so this binding has no Terraform dependency edge on that resource and can apply
# even while order-worker's own update is failing its health check — breaking the
# deploy/IAM chicken-and-egg (order-worker needs this grant to ever become healthy).
resource "google_cloud_run_v2_service_iam_member" "ci_order_worker_deployer" {
  project  = var.project_id
  location = var.region
  name     = "order-worker"
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.ci_sa_email}"
}
