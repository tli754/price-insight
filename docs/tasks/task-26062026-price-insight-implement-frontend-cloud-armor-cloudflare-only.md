# Task: Add Cloud Armor Cloudflare-Only Protection for Frontend

## 1. Goal

Implement a Terraform-managed Google Cloud Armor policy that protects **only the Price Insight frontend Load Balancer backend service**.

The policy must:

- allow requests from the complete official Cloudflare IPv4 and IPv6 proxy CIDR ranges
- deny all other source IP addresses before they reach Nuxt frontend Cloud Run
- leave backend API/webhook Load Balancer backend service unchanged
- preserve normal access through `https://www.qweyha520.bar`
- block direct requests to the Google Load Balancer IP
- be small, reviewable, Terraform-managed, and reversible

This task is implementation work for the approved frontend-only scope.

Do not change backend API/webhook security policy or Cloud Run ingress/default URL in this task.

## 2. Background

Project:

- Name: Price Insight
- Infrastructure: Terraform, global HTTPS Application Load Balancer, serverless NEGs, Cloud Run
- Frontend: Nuxt service on Cloud Run
- Backend: Fastify API service on Cloud Run
- DNS/CDN: Cloudflare
- Public frontend hostname: `www.qweyha520.bar`

Frontend traffic flow:

```text
User → Cloudflare → Google HTTPS Load Balancer → frontend serverless NEG → frontend Cloud Run
```

Direct scanner traffic has reached the Google Load Balancer IP and caused frontend Cloud Run wake-ups. Observed paths include:

```text
/.git/config
/wp-config.js
/wp-admin/install.php
/app-config.js
/dicom-web/studies
/wado-rs/studies
```

Important constraints:

- DataForSEO pingbacks and future Shopify webhooks are backend concerns.
- Do not attach this policy to backend because webhook and internal callers need separate investigation and policy design.
- Backend JWT/session protection stays unchanged.
- Existing DataForSEO webhook secret verification stays unchanged.
- Cloudflare Access is not part of this task.
- Cloud Run ingress/default `run.app` URL protection is not part of this task.

Cloud Armor must be attached to the relevant Load Balancer backend service. Cloudflare CIDRs must come from the official current list, not from DNS lookup results.

## 3. Materials

Inspect first:

```text
infra/terraform/
infra/terraform/load-balancer.tf
infra/terraform/cloud-run.tf
infra/terraform/versions.tf
infra/terraform/providers.tf
infra/terraform/variables.tf
.github/workflows/infra-terraform.yml
```

Search for:

```text
google_compute_backend_service
google_compute_region_backend_service
serverless NEG
security_policy
url_map
path_matcher
frontend
backend
Cloud Armor
```

Use the pinned Google provider version already in the repository. Do not upgrade providers, introduce modules, or add dependencies.

Official Cloudflare proxy IP sources:

```text
https://www.cloudflare.com/ips-v4
https://www.cloudflare.com/ips-v6
```

Verify and include the complete current IPv4 and IPv6 lists. Do not use a partial copied list. 

```cloudflare IPv4 ranges
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```
```cloudflare IPv6 ranges 
2400:cb00::/32
2606:4700::/32
2803:f800::/32
2405:b500::/32
2405:8100::/32
2a06:98c0::/29
2c0f:f248::/32
```

## 4. Approved Scope and Boundaries

### Allowed

- Add a Terraform-managed global Cloud Armor backend security policy.
- Store the complete current official Cloudflare IPv4 and IPv6 CIDRs in clearly named Terraform locals or a dedicated Terraform file.
- Attach the policy only to the frontend Google Load Balancer backend service.
- Add a concise comment with the official source URLs and date verified.
- Run Terraform formatting, validation, and a read-only plan using existing repository workflow/scripts.
- Add/update infrastructure documentation only if an established location exists.

### Not allowed

- Do not attach policy to backend API/webhook backend service.
- Do not change `/api/*`, `/auth/*`, `/webhooks/*`, DataForSEO, Shopify, Cloud Tasks, or order-worker routing.
- Do not change Cloudflare Access or Cloudflare DNS proxy settings.
- Do not change Cloud Run ingress or disable `run.app` URLs.
- Do not add WAF, rate limiting, bot management, or scanner-path rules.
- Do not change provider versions, IAM, secrets, Terraform state, or deployment configuration.
- Do not modify unrelated application code.
- Do not run `terraform apply`, manual Console changes, `gcloud` mutations, or destructive Git commands.

### Required approval gate

Create the Terraform diff and validation evidence only. Do not apply production infrastructure. Stop after presenting the Terraform plan for Tao approval.

## 5. Required Implementation

### 5.1 Confirm the frontend backend service

Before editing, identify from Terraform:

- the exact backend service serving frontend serverless NEG / frontend Cloud Run
- the separate backend service serving backend API/webhook traffic
- that the frontend service supports a global backend security policy

Report the exact resource and file path.

### 5.2 Add frontend-only Cloud Armor policy

Create a global backend security policy with a clear name such as:

```text
price-insight-frontend-cloudflare-only
```

Rules:

| Priority | Match | Action |
|---:|---|---|
| 1000 | Complete official Cloudflare IPv4 + IPv6 CIDR ranges | Allow |
| 2147483647 | All other source IPs | `deny(403)` |

Use the current provider-compatible resource syntax. Expected structure is similar to:

```hcl
resource "google_compute_security_policy" "frontend_cloudflare_only" {
  name        = "price-insight-frontend-cloudflare-only"
  description = "Allow only Cloudflare proxy IP ranges to the Price Insight frontend origin."

  rule {
    priority    = 1000
    action      = "allow"
    description = "Allow Cloudflare IPv4 and IPv6 proxy ranges"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = local.cloudflare_proxy_cidrs
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
```

Treat this as a structural reference. Adjust only as required by the pinned provider schema.

### 5.3 Attach only to frontend Load Balancer backend service

Attach the policy through the correct frontend backend-service field, typically:

```hcl
security_policy = google_compute_security_policy.frontend_cloudflare_only.id
```

Confirm:

- frontend backend service receives policy
- backend API/webhook backend service does not receive policy
- HTTP-to-HTTPS redirect configuration remains unchanged
- URL map/path routing remains unchanged

### 5.4 CIDR maintenance

Use a deterministic approach:

- keep CIDRs in Terraform locals or one dedicated `.tf` file
- comment official source URLs and verification date
- do not dynamically fetch remote data during plan/apply
- do not add a third-party module

Document that Cloudflare CIDR changes require a reviewed Terraform update.

### 5.5 No preview mode

Do not rely on Cloud Armor preview mode for this strict allowlist. Produce a read-only Terraform plan, then wait for Tao approval before apply.

## 6. Validation and Definition of Done

### Changes report

Provide:

- exact Terraform files changed
- exact frontend backend service protected
- policy name
- confirmation backend API/webhook backend service unchanged
- confirmation HTTP redirect and URL map unchanged

### Cloudflare range evidence

Provide:

- source URLs used
- number of IPv4 and IPv6 CIDRs included
- date/time verified
- confirmation list was not derived from DNS output

### Commands

Run only appropriate existing commands, likely:

```bash
terraform fmt -check
terraform validate
terraform plan
```

Use the repository’s established Terraform workflow if required.

Report:

- exact commands run
- success/failure
- relevant plan excerpt
- confirmation plan changes only Cloud Armor policy, frontend policy attachment, and expected local/file changes

Flag unrelated drift immediately. Do not accept it silently.

### Post-approval, post-apply validation plan

Do not apply. Provide these verification steps for after Tao approves:

```bash
curl -I https://www.qweyha520.bar/login
curl -I https://www.qweyha520.bar/products
curl -k -I https://8.233.185.186/
curl -k -I https://8.233.185.186/.git/config
```

Expected:

```text
www.qweyha520.bar → normal Cloudflare/app response
8.233.185.186 → 403 from Cloud Armor
```

Also verify:

- direct IP requests do not appear in frontend Cloud Run logs
- normal Cloudflare-proxied frontend pages/assets do not receive unexpected 403
- backend API/webhook behaviour remains unchanged

### Rollback plan

Document Terraform rollback:

- detach/remove only frontend `security_policy`
- do not change unrelated infrastructure
- run plan and apply only after Tao approval
- include emergency rollback steps if legitimate traffic is denied

### PR checklist

- [ ] Only frontend backend service protected
- [ ] Backend API/webhook backend service unchanged
- [ ] Complete official Cloudflare IPv4 and IPv6 CIDRs included
- [ ] Default deny is `deny(403)`
- [ ] No Cloud Run ingress/default URL changes
- [ ] No Cloudflare Access/DNS changes
- [ ] No provider/dependency upgrades
- [ ] Terraform formatting and validation pass
- [ ] Terraform plan contains no unrelated changes
- [ ] Rollback steps documented
- [ ] Production apply not performed

End with exactly:

```text
Waiting for Tao approval to apply the Terraform change.
```
