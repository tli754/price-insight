variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "australia-southeast1"
}

variable "ci_sa_email" {
  description = "Service account email used by GitHub Actions CI (found in GCP_SA_KEY JSON as client_email)"
  type        = string
}

variable "domain" {
  description = "Custom domain served by the load balancer"
  type        = string
  default     = "www.qweyha520.bar"
}

variable "cloud_sql_connection_name" {
  description = "Cloud SQL instance connection name (project:region:instance), attached to Cloud Run via the built-in connector"
  type        = string
  default     = "wd-tools:australia-southeast1:wd-tools"
}

variable "bootstrap_image" {
  description = "Placeholder image Cloud Run services start on; routine deploys replace it via `gcloud run deploy` (CI), Terraform ignores subsequent image changes"
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
