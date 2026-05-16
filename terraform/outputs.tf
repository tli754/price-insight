output "backend_secret_ids" {
  description = "GSM secret IDs for backend — use these with: gcloud secrets versions add <id> --data-file=-"
  value       = { for k, v in google_secret_manager_secret.backend : k => v.secret_id }
}

output "frontend_secret_ids" {
  description = "GSM secret IDs for frontend — use these with: gcloud secrets versions add <id> --data-file=-"
  value       = { for k, v in google_secret_manager_secret.frontend : k => v.secret_id }
}
