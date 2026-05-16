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
