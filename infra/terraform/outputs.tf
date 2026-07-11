output "backend_secret_ids" {
  description = "GSM secret IDs for backend — use these with: gcloud secrets versions add <id> --data-file=-"
  value       = { for k, v in google_secret_manager_secret.backend : k => v.secret_id }
}

output "frontend_secret_ids" {
  description = "GSM secret IDs for frontend — use these with: gcloud secrets versions add <id> --data-file=-"
  value       = { for k, v in google_secret_manager_secret.frontend : k => v.secret_id }
}

output "gateway_secret_ids" {
  description = "GSM secret IDs for gateway — use these with: gcloud secrets versions add <id> --data-file=-"
  value       = { for k, v in google_secret_manager_secret.gateway : k => v.secret_id }
}

output "load_balancer_ip" {
  description = "Static IP to point the Cloudflare A record for var.domain at"
  value       = google_compute_global_address.lb_ip.address
}

output "cloud_run_service_uris" {
  description = "Cloud Run-assigned URIs for each service (order-worker's is the OIDC audience target, not publicly routed)"
  value = {
    frontend     = google_cloud_run_v2_service.frontend.uri
    backend      = google_cloud_run_v2_service.backend.uri
    order_worker = google_cloud_run_v2_service.order_worker.uri
  }
}
