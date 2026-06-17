locals {
  backend_secrets = [
    "backend-database-url",
    "backend-mysql-host",
    "backend-mysql-user",
    "backend-mysql-password",
    "backend-mysql-database",
    "backend-openai-api-key",
    "backend-openai-model",
    "backend-dataforseo-login",
    "backend-dataforseo-password",
    "backend-shopify-token-url",
    "backend-shopify-products-url",
    "backend-shopify-orders-url",
    "backend-shopify-client-id",
    "backend-shopify-client-secret",
    "backend-own-store-name",
    "backend-session-secret",
    "backend-dev-auth-password",
    "backend-jina-api-key",
    "backend-serpapi-api-key",
    "backend-dataforseo-webhook-secret",
  ]

  frontend_secrets = [
    "frontend-nuxt-session-password",
    "frontend-nuxt-dev-auth-password",
    "frontend-nuxt-api-url",
  ]

  gateway_secrets = [
    "gateway-session-secret",
    "gateway-dev-auth-password",
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
  for_each    = toset(local.backend_secrets)
  secret      = google_secret_manager_secret.backend[each.key].id
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
  for_each    = toset(local.frontend_secrets)
  secret      = google_secret_manager_secret.frontend[each.key].id
  secret_data = "placeholder"

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

resource "google_secret_manager_secret" "gateway" {
  for_each  = toset(local.gateway_secrets)
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

resource "google_secret_manager_secret_version" "gateway" {
  for_each    = toset(local.gateway_secrets)
  secret      = google_secret_manager_secret.gateway[each.key].id
  secret_data = "placeholder"

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}
