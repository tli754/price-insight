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

resource "google_cloud_run_v2_service_iam_member" "ci_leads_deployer" {
  project  = var.project_id
  location = google_cloud_run_v2_service.leads.location
  name     = google_cloud_run_v2_service.leads.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.ci_sa_email}"
}

# Lets price-insight-ci update the backend-migrate Job's image and execute it
# during deploy (deploy.yml runs `gcloud run jobs update/execute backend-migrate`
# before deploying the backend service). roles/run.developer covers run.jobs.update
# and run.jobs.run. Scoped to this Job only, matching the per-service deployer grants.
resource "google_cloud_run_v2_job_iam_member" "ci_backend_migrate_deployer" {
  project  = var.project_id
  location = google_cloud_run_v2_job.backend_migrate.location
  name     = google_cloud_run_v2_job.backend_migrate.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.ci_sa_email}"
}

# Updating/executing backend-migrate needs actAs on its runtime SA
# (price-insight-backend), same as deploying the backend service does. Declared
# explicitly here so the migrate step's permissions live in Terraform rather than
# relying on an implicit grant. Additive (non-authoritative) — coexists with any
# existing binding without clobbering it.
resource "google_service_account_iam_member" "ci_actas_backend_runtime" {
  service_account_id = data.google_service_account.backend_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.ci_sa_email}"
}
