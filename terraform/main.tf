terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Store state in GCS so the team shares a single source of truth.
  # Create the bucket manually before running terraform init:
  #   gcloud storage buckets create gs://wd-tools-tfstate --location=australia-southeast1
  backend "gcs" {
    bucket = "wd-tools-tfstate"
    prefix = "price-insight/terraform.tfstate"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
