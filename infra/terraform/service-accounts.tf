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

# Dedicated, least-privilege runtime identity for order-worker — separate from
# backend's so it only ever has Cloud SQL + the DB/Shopify secrets it needs,
# never OpenAI/DataForSEO/frontend/session secrets.
resource "google_service_account" "order_worker_runtime" {
  project      = var.project_id
  account_id   = "price-insight-order-worker"
  display_name = "Price Insight order-worker (Cloud Run runtime)"
}

resource "google_project_iam_member" "order_worker_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.order_worker_runtime.email}"
}

locals {
  order_worker_secrets = [
    "backend-mysql-host",
    "backend-mysql-user",
    "backend-mysql-password",
    "backend-mysql-database",
    "backend-shopify-token-url",
    "backend-shopify-products-url",
    "backend-shopify-orders-url",
    "backend-shopify-client-id",
    "backend-shopify-client-secret",
  ]
}

resource "google_secret_manager_secret_iam_member" "order_worker_secrets" {
  for_each  = toset(local.order_worker_secrets)
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.order_worker_runtime.email}"

  depends_on = [google_secret_manager_secret.backend]
}

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

# --- Cloud Tasks / Cloud Scheduler OIDC caller identity ---------------------
#
# Shared identity Cloud Tasks and Cloud Scheduler both attach as the OIDC
# token subject when pushing to order-worker. They are NOT the same as the
# Google-managed service agents below — the agents are only permitted to
# *mint a token as* this caller (serviceAccountTokenCreator), never granted
# run.invoker themselves. A single identity is sufficient here because both
# grants would be identical (run.invoker on order-worker only) and the two
# trigger sources are already distinguishable by the endpoint each calls
# (/internal/sync-order vs /internal/scheduled-order-discovery).

resource "google_service_account" "invoker" {
  project      = var.project_id
  account_id   = "price-insight-invoker"
  display_name = "OIDC identity Cloud Tasks/Scheduler attach when invoking order-worker"
}

resource "google_service_account_iam_member" "cloudtasks_agent_token_creator" {
  service_account_id = google_service_account.invoker.name
  role                = "roles/iam.serviceAccountTokenCreator"
  member              = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
}

resource "google_service_account_iam_member" "scheduler_agent_token_creator" {
  service_account_id = google_service_account.invoker.name
  role                = "roles/iam.serviceAccountTokenCreator"
  member              = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}
