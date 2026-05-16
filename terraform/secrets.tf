locals {
  backend_secrets = [
    "backend-database-url",
    "backend-mysql-user",
    "backend-mysql-password",
    "backend-mysql-database",
    "backend-openai-api-key",
    "backend-openai-model",
    "backend-jina-api-key",
    "backend-serpapi-api-key",
  ]

  frontend_secrets = [
    "frontend-nuxt-session-password",
    "frontend-nuxt-oauth-google-client-id",
    "frontend-nuxt-oauth-google-client-secret",
    "frontend-nuxt-dev-auth-bypass",
    "frontend-nuxt-dev-auth-password",
  ]
}

resource "google_secret_manager_secret" "backend" {
  for_each  = toset(local.backend_secrets)
  project   = var.project_id
  secret_id = each.value

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

# Placeholder versions — Terraform creates these so `apply` always succeeds.
# Add the real value once via gcloud:
#   echo -n "real-value" | gcloud secrets versions add <secret-id> --data-file=-
# The lifecycle block ensures Terraform never overwrites your manual updates.
resource "google_secret_manager_secret_version" "backend" {
  for_each    = google_secret_manager_secret.backend
  secret      = each.value.id
  secret_data = "placeholder"

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

resource "google_secret_manager_secret" "frontend" {
  for_each  = toset(local.frontend_secrets)
  project   = var.project_id
  secret_id = each.value

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "frontend" {
  for_each    = google_secret_manager_secret.frontend
  secret      = each.value.id
  secret_data = "placeholder"

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}
