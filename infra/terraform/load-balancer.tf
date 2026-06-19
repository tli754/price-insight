# Single external HTTPS load balancer, path-routing to frontend/backend on
# one custom domain. order-worker is intentionally NOT attached here — it's
# private and only ever invoked directly via its Cloud Run URL.

resource "google_compute_global_address" "lb_ip" {
  name    = "price-insight-lb-ip"
  project = var.project_id
}

resource "google_compute_region_network_endpoint_group" "frontend" {
  name                  = "frontend-neg"
  project               = var.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.frontend.name
  }
}

resource "google_compute_region_network_endpoint_group" "backend" {
  name                  = "backend-neg"
  project               = var.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.backend.name
  }
}

# Serverless NEG backends — no health check resource; Cloud Run manages its
# own health and a health check is neither required nor supported here.
resource "google_compute_backend_service" "frontend" {
  name    = "frontend-backend"
  project = var.project_id

  backend {
    group = google_compute_region_network_endpoint_group.frontend.id
  }
}

resource "google_compute_backend_service" "backend" {
  name    = "backend-backend"
  project = var.project_id

  backend {
    group = google_compute_region_network_endpoint_group.backend.id
  }
}

resource "google_compute_url_map" "https" {
  name            = "price-insight-url-map"
  project         = var.project_id
  default_service = google_compute_backend_service.frontend.id

  host_rule {
    hosts        = [var.domain]
    path_matcher = "paths"
  }

  host_rule {
    hosts        = [var.apex_domain]
    path_matcher = "apex-redirect"
  }

  path_matcher {
    name            = "paths"
    default_service = google_compute_backend_service.frontend.id

    path_rule {
      paths   = ["/api", "/api/*", "/auth", "/auth/*", "/webhooks", "/webhooks/*"]
      service = google_compute_backend_service.backend.id
    }
  }

  path_matcher {
    name = "apex-redirect"

    default_url_redirect {
      host_redirect          = var.domain
      https_redirect         = true
      strip_query            = false
      redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    }
  }
}

resource "google_compute_managed_ssl_certificate" "default" {
  name    = "price-insight-cert-v2"
  project = var.project_id

  managed {
    domains = [var.domain, var.apex_domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "default" {
  name             = "price-insight-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.default.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name       = "price-insight-https-forwarding-rule"
  project    = var.project_id
  target     = google_compute_target_https_proxy.default.id
  port_range = "443"
  ip_address = google_compute_global_address.lb_ip.address
}

# HTTP -> HTTPS redirect on the same static IP.
resource "google_compute_url_map" "http_redirect" {
  name    = "price-insight-http-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "default" {
  name    = "price-insight-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name       = "price-insight-http-forwarding-rule"
  project    = var.project_id
  target     = google_compute_target_http_proxy.default.id
  port_range = "80"
  ip_address = google_compute_global_address.lb_ip.address
}
