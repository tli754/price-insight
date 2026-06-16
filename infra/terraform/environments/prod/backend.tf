terraform {
  backend "gcs" {
    bucket = "wd-tools-terraform-state"
    prefix = "price-insight/prod"
  }
}
