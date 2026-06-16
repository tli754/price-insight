# Import blocks for secrets that already exist in GCP but are missing from Terraform state.
# After a successful `terraform apply`, these blocks can be removed (they are idempotent but add noise to plans).
# If a version import fails, verify the version number with:
#   gcloud secrets versions list <secret-id> --project=wd-tools

# ── Backend secrets ────────────────────────────────────────────────────────────

import {
  to = google_secret_manager_secret.backend["backend-dataforseo-login"]
  id = "projects/wd-tools/secrets/backend-dataforseo-login"
}
import {
  to = google_secret_manager_secret_version.backend["backend-dataforseo-login"]
  id = "projects/wd-tools/secrets/backend-dataforseo-login/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-dataforseo-password"]
  id = "projects/wd-tools/secrets/backend-dataforseo-password"
}
import {
  to = google_secret_manager_secret_version.backend["backend-dataforseo-password"]
  id = "projects/wd-tools/secrets/backend-dataforseo-password/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-mysql-host"]
  id = "projects/wd-tools/secrets/backend-mysql-host"
}
import {
  to = google_secret_manager_secret_version.backend["backend-mysql-host"]
  id = "projects/wd-tools/secrets/backend-mysql-host/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-own-store-name"]
  id = "projects/wd-tools/secrets/backend-own-store-name"
}
import {
  to = google_secret_manager_secret_version.backend["backend-own-store-name"]
  id = "projects/wd-tools/secrets/backend-own-store-name/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-shopify-client-id"]
  id = "projects/wd-tools/secrets/backend-shopify-client-id"
}
import {
  to = google_secret_manager_secret_version.backend["backend-shopify-client-id"]
  id = "projects/wd-tools/secrets/backend-shopify-client-id/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-shopify-client-secret"]
  id = "projects/wd-tools/secrets/backend-shopify-client-secret"
}
import {
  to = google_secret_manager_secret_version.backend["backend-shopify-client-secret"]
  id = "projects/wd-tools/secrets/backend-shopify-client-secret/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-shopify-orders-url"]
  id = "projects/wd-tools/secrets/backend-shopify-orders-url"
}
import {
  to = google_secret_manager_secret_version.backend["backend-shopify-orders-url"]
  id = "projects/wd-tools/secrets/backend-shopify-orders-url/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-shopify-products-url"]
  id = "projects/wd-tools/secrets/backend-shopify-products-url"
}
import {
  to = google_secret_manager_secret_version.backend["backend-shopify-products-url"]
  id = "projects/wd-tools/secrets/backend-shopify-products-url/versions/1"
}

import {
  to = google_secret_manager_secret.backend["backend-shopify-token-url"]
  id = "projects/wd-tools/secrets/backend-shopify-token-url"
}
import {
  to = google_secret_manager_secret_version.backend["backend-shopify-token-url"]
  id = "projects/wd-tools/secrets/backend-shopify-token-url/versions/1"
}

# ── Frontend secrets ───────────────────────────────────────────────────────────

import {
  to = google_secret_manager_secret.frontend["frontend-nuxt-api-url"]
  id = "projects/wd-tools/secrets/frontend-nuxt-api-url"
}
import {
  to = google_secret_manager_secret_version.frontend["frontend-nuxt-api-url"]
  id = "projects/wd-tools/secrets/frontend-nuxt-api-url/versions/1"
}

# ── Gateway secrets ────────────────────────────────────────────────────────────

import {
  to = google_secret_manager_secret.gateway["gateway-dev-auth-password"]
  id = "projects/wd-tools/secrets/gateway-dev-auth-password"
}
import {
  to = google_secret_manager_secret_version.gateway["gateway-dev-auth-password"]
  id = "projects/wd-tools/secrets/gateway-dev-auth-password/versions/1"
}

import {
  to = google_secret_manager_secret.gateway["gateway-session-secret"]
  id = "projects/wd-tools/secrets/gateway-session-secret"
}
import {
  to = google_secret_manager_secret_version.gateway["gateway-session-secret"]
  id = "projects/wd-tools/secrets/gateway-session-secret/versions/1"
}
