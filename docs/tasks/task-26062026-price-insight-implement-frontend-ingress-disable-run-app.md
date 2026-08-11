# Task: Restrict Frontend Cloud Run Ingress and Disable Default `run.app` URLs

## 1. Goal

Implement the approved frontend-only Cloud Run hardening change for Price Insight:

1. Restrict the **frontend Cloud Run service** ingress so it accepts traffic only from:
   - internal Google Cloud sources where supported, and
   - the external Google Application Load Balancer.

2. Disable the frontend service’s default public `run.app` HTTPS endpoint URLs.

The intended result is:

```text
Allowed:
Browser
→ Cloudflare
→ Google HTTPS Load Balancer
→ frontend serverless NEG
→ frontend Cloud Run
→ works normally

Blocked:
Direct public request
→ https://frontend-<project-number>.<region>.run.app
→ denied

Direct public request
→ https://frontend-<hash>.a.run.app
→ denied
```

This task is frontend-only.

Do not change the backend Cloud Run service, webhook routes, DataForSEO, future Shopify webhook support, Cloud Armor policy, Cloudflare Access, or Load Balancer URL routing.

## 2. Background

Project:
- Name: Price Insight
- Frontend: Nuxt on Google Cloud Run
- Backend: Fastify / TypeScript on Google Cloud Run
- Infrastructure: Terraform, Google HTTPS Application Load Balancer, serverless NEGs, Cloudflare
- Region: `australia-southeast1`

Current frontend Cloud Run networking state from Google Cloud Console:

```text
Ingress: All
Default HTTPS endpoint URL: Enabled
```

Current default frontend Cloud Run URLs include forms similar to:

```text
https://frontend-920312412888.australia-southeast1.run.app
https://frontend-66fhf35iuq-ts.a.run.app
```

The frontend is already routed through:

```text
Cloudflare
→ Google HTTPS Load Balancer
→ frontend backend service
→ frontend serverless NEG
→ frontend Cloud Run service
```

A separate Cloud Armor frontend-only change may be implemented independently. This task must not assume Cloud Armor is already applied, but must remain compatible with it.

Reason for this change:

- prevent direct public access to frontend `run.app` URLs
- ensure public frontend traffic uses the intended Cloudflare → Google Load Balancer path
- prevent bypassing Load Balancer-level controls such as Cloud Armor
- reduce unauthorised scanner access paths to the Cloud Run frontend service

Important existing boundaries:

- Frontend has no expected webhook endpoints.
- Backend has DataForSEO webhook routes and future Shopify webhook considerations.
- Do not apply the same ingress/default URL restrictions to backend in this task.
- Terraform owns the Cloud Run deployment configuration.
- Do not make manual Console changes as the final source of truth.

## 3. Materials

Inspect the repository before editing.

Prioritise:

```text
infra/terraform/cloud-run.tf
infra/terraform/load-balancer.tf
infra/terraform/versions.tf
infra/terraform/providers.tf
infra/terraform/variables.tf
infra/terraform/outputs.tf
.github/workflows/infra-terraform.yml
.github/workflows/deploy.yml
apps/frontend/
apps/frontend/nuxt.config.*
```

Search for:

```text
google_cloud_run_v2_service
frontend
ingress
INGRESS_TRAFFIC
default_uri_disabled
default URL
run.app
serverless NEG
google_compute_region_network_endpoint_group
google_compute_backend_service
frontend URL
NUXT_PUBLIC
API_BASE
runtimeConfig
curl
health
smoke
```

Use the Google provider version pinned in the repository.

Before editing, verify:
- the exact Terraform resource name for frontend Cloud Run
- the exact field/value required by the pinned provider for `internal-and-cloud-load-balancing` ingress
- the exact field/value required by the pinned provider to disable the default `run.app` URL
- the external HTTPS Load Balancer routes to frontend using a serverless NEG
- no CI workflow, script, test, environment variable, or runtime config directly depends on the frontend `run.app` URLs
- frontend requests backend through the intended public/load-balancer path, not through the frontend `run.app` URL

Use official provider documentation or Context7 only where version-specific behavior needs verification.

## 4. Approved Scope and Boundaries

### Allowed

- Modify Terraform for the **frontend Cloud Run service only**.
- Set frontend ingress to the provider-supported equivalent of:
  ```text
  Internal and Cloud Load Balancing
  ```
- Disable frontend default `run.app` endpoint URLs using the provider-supported field.
- Update short Terraform comments/documentation if needed.
- Run Terraform format, validate, and read-only plan.
- Run existing non-destructive frontend/typecheck/lint checks if relevant.
- Report exact post-apply manual validation steps.

### Not Allowed

- Do not modify backend Cloud Run ingress or backend `run.app` endpoint settings.
- Do not change Load Balancer routes, URL maps, serverless NEGs, backend services, Cloud Armor policy, Cloudflare Access, Cloudflare DNS, or Cloudflare rules.
- Do not change DataForSEO webhook paths or configuration.
- Do not change future Shopify webhook design.
- Do not add dependencies or upgrade Terraform providers.
- Do not modify IAM, service accounts, secrets, VPC, Cloud SQL, Cloud Tasks, or GitHub Actions deployment behavior.
- Do not change application auth middleware or API authentication.
- Do not apply Terraform.
- Do not make manual Google Cloud Console changes.
- Do not run destructive git commands.

### Required approval gate

You may create the Terraform diff and run read-only validation.

Stop after providing the Terraform plan and validation evidence.

Do not apply production infrastructure until Tao explicitly approves.

## 5. Required Implementation

### 5.1 Confirm current frontend resource and traffic path

Before editing, report:

- frontend Cloud Run Terraform resource name and file path
- current configured ingress value
- whether default `run.app` URL is currently enabled by Terraform/default behavior
- frontend serverless NEG resource
- frontend Load Balancer backend service resource
- confirmation the Google Load Balancer route remains valid with restricted frontend ingress

### 5.2 Restrict frontend ingress

Update only the frontend Cloud Run Terraform resource to use the provider-supported equivalent of:

```text
internal-and-cloud-load-balancing
```

Expected intent:

```text
Public internet
→ cannot directly reach Cloud Run frontend

External Application Load Balancer
→ can reach frontend via serverless NEG

Cloudflare
→ still works because Cloudflare reaches the Google Load Balancer, not Cloud Run directly
```

Do not guess field syntax. Confirm it against the pinned Google provider version.

### 5.3 Disable frontend default `run.app` URL

Update only the frontend Cloud Run Terraform resource to disable default public endpoint URLs.

Expected intent:

```text
https://frontend-<project-number>.<region>.run.app
→ unavailable

https://frontend-<hash>.a.run.app
→ unavailable
```

Do not remove custom domain or Load Balancer configuration.

### 5.4 Preserve existing frontend functionality

Confirm no required frontend flow depends on the default Cloud Run URL:

- Cloudflare public hostname works
- Google Load Balancer routing works
- Nuxt SSR works
- Nuxt static assets work
- browser navigation works
- frontend can still call backend `/auth/session` through its intended API configuration
- login/logout/protected routes remain unchanged

Do not alter frontend code unless repository evidence proves a direct `run.app` dependency. If such a dependency exists, stop and report it as an approval decision rather than expanding scope automatically.

## 6. Definition of Done

Implementation planning/execution is complete when you provide:

### A. Changed files and scope

- exact Terraform files changed
- exact frontend Cloud Run resource changed
- exact ingress configuration used
- exact default endpoint disable configuration used
- confirmation backend Cloud Run service is unchanged
- confirmation Load Balancer, Cloud Armor, Cloudflare, and webhook routing are unchanged

### B. Before/after behaviour summary

| Access path | Before | After |
|---|---|---|
| `https://www.qweyha520.bar` | Works | Must still work |
| Cloudflare → Google Load Balancer → frontend | Works | Must still work |
| frontend default `run.app` URL | Publicly reachable | Must be blocked |
| direct public Cloud Run access | Allowed | Must be blocked |
| backend `run.app` URLs | Existing behavior | Unchanged |
| backend webhook routes | Existing behavior | Unchanged |

### C. Validation evidence

Run only valid, existing, non-mutating commands.

At minimum:

```bash
terraform fmt -check
terraform validate
terraform plan
```

Use the repository’s existing Terraform workflow if that is the normal plan mechanism.

Also inspect relevant frontend runtime config and scripts.

Report:
- exact commands run
- success/failure
- meaningful Terraform plan excerpt
- whether the plan includes only frontend ingress/default URL changes and expected metadata changes
- any unrelated drift found

Do not ignore unrelated plan changes. Stop and flag them.

### D. Manual post-apply validation plan

Do not apply, but provide exact checks for after Tao approval:

1. Confirm normal public frontend:

```bash
curl -I https://www.qweyha520.bar/login
curl -I https://www.qweyha520.bar/products
```

Expected: normal response through Cloudflare / app.

2. Confirm default URLs are blocked:

```bash
curl -I https://frontend-920312412888.australia-southeast1.run.app
curl -I https://frontend-66fhf35iuq-ts.a.run.app
```

Expected: request denied/unavailable; it must not reach Nuxt.

3. Browser validation:

- open the homepage
- login
- navigate to protected pages
- refresh a protected page
- confirm Nuxt assets load
- confirm no unexpected redirect loop
- confirm `/auth/session` behavior remains correct

4. Google Cloud validation:

- Cloud Run frontend networking page shows restricted ingress
- default HTTPS endpoint URL is disabled
- frontend Cloud Run logs no longer show direct `run.app` traffic
- legitimate Cloudflare-origin requests still reach frontend

### E. Rollback plan

Provide precise Terraform rollback steps:

- revert only the frontend ingress/default URL Terraform change
- run Terraform plan
- apply only after Tao approval
- document emergency rollback if public frontend becomes inaccessible

### F. PR checklist

- [ ] Frontend Cloud Run ingress restricted using provider-supported configuration
- [ ] Frontend default `run.app` URLs disabled
- [ ] Backend Cloud Run configuration unchanged
- [ ] Webhook routes/configuration unchanged
- [ ] Load Balancer and serverless NEG configuration unchanged
- [ ] Cloud Armor and Cloudflare configuration unchanged
- [ ] Terraform formatting and validation pass
- [ ] Terraform plan has no unrelated changes
- [ ] Post-apply validation and rollback steps documented
- [ ] Production apply not performed

End with exactly:

```text
Waiting for Tao approval to apply the Terraform change.
```
