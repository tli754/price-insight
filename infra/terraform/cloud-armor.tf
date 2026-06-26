# Cloudflare proxy IP ranges — official sources:
#   https://www.cloudflare.com/ips-v4
#   https://www.cloudflare.com/ips-v6
# Verified: 2026-06-26. Update this file and re-apply if Cloudflare publishes
# new ranges.
#
# Cloud Armor caps src_ip_ranges at 10 per rule, so the 15 IPv4 ranges are
# split across two allow rules (priorities 1000 and 1001); IPv6 is a third
# rule (priority 1002).

locals {
  cloudflare_ipv4_a = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
  ]

  cloudflare_ipv4_b = [
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]

  cloudflare_ipv6 = [
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
  ]
}

resource "google_compute_security_policy" "frontend_cloudflare_only" {
  name        = "price-insight-frontend-cloudflare-only"
  description = "Allow only Cloudflare proxy IP ranges to the Price Insight frontend origin."
  project     = var.project_id

  rule {
    priority    = 1000
    action      = "allow"
    description = "Allow Cloudflare IPv4 proxy ranges (first 10)"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = local.cloudflare_ipv4_a
      }
    }
  }

  rule {
    priority    = 1001
    action      = "allow"
    description = "Allow Cloudflare IPv4 proxy ranges (remaining 5)"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = local.cloudflare_ipv4_b
      }
    }
  }

  rule {
    priority    = 1002
    action      = "allow"
    description = "Allow Cloudflare IPv6 proxy ranges"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = local.cloudflare_ipv6
      }
    }
  }

  rule {
    priority    = 2147483647
    action      = "deny(403)"
    description = "Deny direct non-Cloudflare access to frontend origin"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}
