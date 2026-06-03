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
