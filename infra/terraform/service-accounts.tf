data "google_project" "this" {
  project_id = var.project_id
}

# --- Cloud Run runtime identities ------------------------------------------

# Reused from the GKE setup (Cloud SQL Auth Proxy + Workload Identity). Already
# granted roles/cloudsql.client — Cloud Run runs *as* this SA directly, no
# Workload Identity layer needed.
data "google_service_account" "backend_runtime" {
  account_id = "price-insight-backend@${var.project_id}.iam.gserviceaccount.com"
  project    = var.project_id
}

resource "google_service_account" "frontend_runtime" {
  project      = var.project_id
  account_id   = "price-insight-frontend"
  display_name = "Price Insight frontend (Cloud Run runtime)"
}

# order-worker's dedicated runtime SA, its Cloud SQL client grant, and its
# scoped secret access were retired 2026-08-15 alongside the service itself
# — see cloud-run.tf's retirement note and ADR 0002.

# Runtime secret access for backend/frontend — distinct from the CI
# service account's accessor grants in iam.tf, which are build/deploy-time
# only (kubectl secret sync under GKE), not used by Cloud Run at runtime.
resource "google_secret_manager_secret_iam_member" "backend_runtime_secrets" {
  for_each  = google_secret_manager_secret.backend
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_service_account.backend_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "frontend_runtime_secrets" {
  for_each  = google_secret_manager_secret.frontend
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.frontend_runtime.email}"
}

# terraform-ci needs roles/compute.securityAdmin at the project level to create
# and attach Cloud Armor security policies. terraform-ci lacks
# getIamPolicy/setIamPolicy on the project, so this grant is applied out-of-band:
#   gcloud projects add-iam-policy-binding wd-tools \
#     --member="serviceAccount:terraform-ci@wd-tools.iam.gserviceaccount.com" \
#     --role="roles/compute.securityAdmin"

# terraform-ci needs roles/artifactregistry.reader on the price-insight repo —
# Cloud Run's services.patch API validates image-pull access for the *calling*
# identity on every update, even when the image itself isn't changing, so any
# in-place update to frontend/backend fails with a 403 without it.
# The repo predates Terraform (like the Cloud SQL instance) and terraform-ci
# lacks getIamPolicy/setIamPolicy on it, so this grant is applied out-of-band:
#   gcloud artifacts repositories add-iam-policy-binding price-insight \
#     --location=australia-southeast1 --project=wd-tools \
#     --member="serviceAccount:terraform-ci@wd-tools.iam.gserviceaccount.com" \
#     --role="roles/artifactregistry.reader"

# --- Cloud Scheduler OIDC caller identity ------------------------------------
#
# Identity Cloud Scheduler attaches as the OIDC token subject when invoking
# backend's internal routes (order-sync-internal.ts, competitor-drain-
# internal.ts) — see ADR 0002. Previously also used by Cloud Tasks pushing to
# order-worker; that queue and service are retired, so only the Scheduler
# grant below remains. No actAs/impersonation grants are needed anymore —
# backend/order-worker no longer create outbound Cloud Tasks tasks
# themselves, they only verify incoming OIDC tokens minted by Cloud
# Scheduler's own service agent.

resource "google_service_account" "invoker" {
  project      = var.project_id
  account_id   = "price-insight-invoker"
  display_name = "OIDC identity Cloud Scheduler attaches when invoking backend's internal routes"
}

resource "google_service_account_iam_member" "scheduler_agent_token_creator" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}
