# Plan: Cloud Run Infrastructure + Routing (PR 2)

## 1. Summary

Stand up the Cloud Run + load-balancer infrastructure for the GKE → Cloud Run migration, entirely in Terraform. Three Cloud Run services: `frontend` and `backend` (public, behind a GCLB with path-based routing on a single custom domain), and a new `order-worker` (private, IAM-gated, invoked only by dedicated Cloud Tasks/Cloud Scheduler caller identities). Image deployment is split: Terraform owns service shape (and starts each service on a bootstrap placeholder image), GitHub Actions owns routine SHA-tagged image releases via `gcloud run deploy`. **No application code changes in this PR** — `apps/backend`'s Cloud SQL Unix-socket support and `order-worker`'s code/packaging are explicitly deferred (see Risks).

## 2. Current Implementation

- `infra/terraform/` today only manages GCP Secret Manager secrets (`secrets.tf`) and CI service-account IAM bindings on those secrets (`iam.tf`). No Cloud Run, networking, or Cloud SQL resources exist in Terraform yet.
- `.github/workflows/infra-terraform.yml`: manual `workflow_dispatch` (`plan`/`apply`), authenticates as `terraform-ci@wd-tools.iam.gserviceaccount.com` via Workload Identity Federation, runs against `infra/terraform/` directly (no per-environment subfolders — consolidated in `bcc530ed`), gated by the `prod` GitHub Environment's required reviewers on `apply`. It also runs a manual "reconcile" step that imports pre-existing GCP secrets into Terraform state if found.
- Existing GKE setup (for reference, being replaced): Cloud SQL Auth Proxy sidecar connecting to `wd-tools:australia-southeast1:wd-tools` via Workload Identity, using `price-insight-backend@wd-tools.iam.gserviceaccount.com` (already granted `roles/cloudsql.client`). This same GSA is being reused directly as the Cloud Run runtime SA for `backend` — Cloud Run services run *as* a GSA natively, no Workload Identity layer needed.
- `apps/backend/src/db/index.ts` connects via `mysql2.createPool({ host, port, ... })` — TCP only, no Unix-socket support. This must change before the real backend image can connect to Cloud SQL via Cloud Run's built-in connector (`/cloudsql/{connection_name}`), but per your explicit instruction, that code change is **not** part of this PR.
- Order sync (BullMQ worker + node-cron, removed in PR 4) currently runs in-process inside the backend. `order-worker`'s actual code location (new `apps/order-worker` package vs. same image as backend with a different entrypoint) is an open PR 4 decision — this PR only needs `order-worker`'s Cloud Run *shape* to exist.

## 3. Affected Areas

- Frontend: No app code change — Cloud Run service shape only.
- Backend: No app code change in this PR (see Risk below — real deploys will fail DB connectivity until a follow-up code PR ships).
- Database: No schema change. Connectivity *path* changes (Unix socket vs. TCP) but that's a follow-up code PR, not this one.
- Queue/jobs: `order-worker` Cloud Run service + Cloud Tasks queue + Cloud Scheduler job created here; the code that uses them ships in PR 4.
- External APIs: No new third-party API; new GCP services (Cloud Run, Cloud Tasks, Cloud Scheduler, Compute load balancing).
- Tests: No app tests affected (no app code touched). `terraform validate`/`plan` is the validation surface.
- Config/infra: Yes — this PR is entirely infra.

## 4. Risks

- **Backend can't actually reach the DB yet.** This PR makes the Cloud Run *service* exist and attaches the Cloud SQL instance, but `apps/backend`'s `mysql2.createPool` still only knows TCP `host`/`port`. The bootstrap placeholder image will deploy and run fine (it doesn't touch MySQL), but the first real `gcloud run deploy` of the actual backend image will crash-loop on DB connection until a small follow-up PR adds a Unix-socket branch to `db/index.ts`. **This must be sequenced before or alongside the first real backend deploy** — flagging clearly so it isn't mistaken for a Terraform bug.
- **Cloud Scheduler will 404 daily until PR 4 ships.** The scheduler job targets `order-worker`'s `/internal/scheduled-order-discovery`, which doesn't exist until PR 4's code lands. Harmless (no escalation configured beyond Cloud Scheduler's own retry), but expected log noise — worth muting/ignoring rather than chasing as a bug.
- **`order-worker`'s env vars are provisional.** Since its code packaging is an open PR 4 decision, the exact env var names Terraform sets on it may need adjusting once PR 4 lands. The secret *access* scope (least privilege — DB + Shopify only) is decided now regardless of packaging.
- **Terraform CI identity permissions unknown.** `terraform-ci@wd-tools.iam.gserviceaccount.com` currently only needed Secret Manager admin-ish permissions. Creating Cloud Run services, Cloud Tasks queues, Cloud Scheduler jobs, new service accounts, and Compute load-balancing resources likely needs additional IAM roles (`roles/run.admin`, `roles/cloudtasks.admin`, `roles/cloudscheduler.admin`, `roles/iam.serviceAccountAdmin`, `roles/compute.networkAdmin`, `roles/serviceusage.serviceUsageAdmin`) granted to it. I can't verify its current roles without `gcloud` (per your instruction not to run it) — first `terraform plan` will surface any permission gaps as errors; expect a possible round-trip to grant the Terraform SA more IAM before `apply` succeeds.
- **Managed SSL cert vs. Cloudflare proxy.** Already flagged: if the `www.qweyha520.bar` DNS record is proxied (orange-cloud) in Cloudflare, the Google-managed cert may fail to provision. You'll need it in DNS-only mode at least until the cert issues.
- **Secret import gaps.** `infra-terraform.yml`'s "Reconcile Terraform state" step has a hardcoded list of secrets to import-if-they-exist. It does **not** include `backend-session-secret`/`backend-dev-auth-password` (added to `secrets.tf` in the prior commit) — if those already exist in GSM outside Terraform's knowledge, `apply` will fail with "already exists" instead of importing. Added to this PR's scope to close that gap.

## 5. Recommended Approach

### Identities

Cloud Tasks and Cloud Scheduler share a single `price-insight-invoker` caller identity (revised 2026-06-17 — both grants were identical, `roles/run.invoker` on `order-worker` only, and the two trigger sources are already distinguishable by the endpoint each calls: `/internal/sync-order` vs `/internal/scheduled-order-discovery`). Other identities remain separated by least privilege.

| Identity | Type | Purpose | Grants |
|---|---|---|---|
| `price-insight-backend@wd-tools.iam.gserviceaccount.com` | Existing, reused | `backend` Cloud Run runtime SA | Already has `roles/cloudsql.client` (from GKE setup) |
| `price-insight-frontend@wd-tools.iam.gserviceaccount.com` | New | `frontend` Cloud Run runtime SA | No special roles — serves static/SSR only |
| `price-insight-order-worker@wd-tools.iam.gserviceaccount.com` | New | `order-worker` Cloud Run runtime SA | `roles/cloudsql.client` + `secretAccessor` on DB + Shopify secrets only (see below) |
| `price-insight-invoker@wd-tools.iam.gserviceaccount.com` | New | Shared OIDC identity Cloud Tasks and Cloud Scheduler attach to their requests | `roles/run.invoker` on `order-worker` **only** |
| `service-<PROJECT_NUMBER>@gcp-sa-cloudtasks.iam.gserviceaccount.com` | Google-managed (data source, not created) | Cloud Tasks' own service agent | `roles/iam.serviceAccountTokenCreator` on `price-insight-invoker` only — lets Cloud Tasks *mint* the OIDC token, it is never itself the invoker |
| `service-<PROJECT_NUMBER>@gcp-sa-cloudscheduler.iam.gserviceaccount.com` | Google-managed (data source, not created) | Cloud Scheduler's own service agent | `roles/iam.serviceAccountTokenCreator` on `price-insight-invoker` only |
| `terraform-ci@wd-tools.iam.gserviceaccount.com` | Existing | Terraform `plan`/`apply` CI identity | Unchanged role *scope* in this plan, but likely needs additional roles granted (see Risks) before `apply` succeeds |
| `price-insight-ci@wd-tools.iam.gserviceaccount.com` | Existing | Build/deploy CI identity (GitHub Actions) | Gains `roles/run.developer` (or equivalent) to run `gcloud run deploy` against `frontend`/`backend` |

`order-worker`'s least-privilege secret list (matches "Shopify + DB only, no OpenAI/DataForSEO/frontend/unrelated"): `backend-mysql-host`, `backend-mysql-user`, `backend-mysql-password`, `backend-mysql-database`, `backend-shopify-token-url`, `backend-shopify-products-url`, `backend-shopify-orders-url`, `backend-shopify-client-id`, `backend-shopify-client-secret`. (Noting `backend-database-url` isn't actually read by any code — `db/index.ts` uses discrete `MYSQL_*` vars — so it's excluded from `order-worker`'s grants as dead weight, not an oversight.)

### Terraform resources (new files under `infra/terraform/`)

- `apis.tf`: `google_project_service` for `run.googleapis.com` and `sqladmin.googleapis.com`, `disable_on_destroy = false` (declared even though already enabled, per your instruction — documents the dependency).
- `service-accounts.tf`: the four new GSAs above (`data` reference for the existing `price-insight-backend@`), plus `data "google_project" "this"` to derive `<PROJECT_NUMBER>` for the Google-managed service-agent emails.
- `cloud-run.tf`: three `google_cloud_run_v2_service` resources.
  - All three start on a bootstrap placeholder image (`us-docker.pkg.dev/cloudrun/container/hello`), with `lifecycle { ignore_changes = [template[0].containers[0].image] }` so CI-deployed images survive future `terraform apply` runs.
  - `frontend`, `backend`: `ingress = "INGRESS_TRAFFIC_ALL"`, `min_instance_count = 0`, `allUsers` granted `roles/run.invoker` (required for the GCLB's Serverless NEG path to reach them — Cloud Run still enforces IAM regardless of being behind a load balancer).
  - `backend`: Cloud SQL volume attachment (`volumes { cloud_sql_instance { instances = ["wd-tools:australia-southeast1:wd-tools"] } }` + matching `volume_mounts`), env vars + `secret_key_ref` for all `backend_secrets`.
  - `order-worker`: `ingress = "INGRESS_TRAFFIC_ALL"` (explicitly **not** `INGRESS_TRAFFIC_INTERNAL_ONLY` — ingress restriction is not the privacy control here, IAM is; an internal-only ingress setting risks blocking legitimate Cloud Tasks/Scheduler delivery), `min_instance_count = 0`, **no** `allUsers` binding — only `price-insight-invoker` gets `roles/run.invoker` on it via `google_cloud_run_v2_service_iam_member`. Same Cloud SQL volume attachment as backend, scoped secret set as above.
- `cloud-tasks.tf`: `google_cloud_tasks_queue` (retry config mirroring today's BullMQ: 3 attempts, exponential backoff) and `google_cloud_scheduler_job` (cron `0 14 * * *`, HTTP target = `order-worker`'s URI + `/internal/scheduled-order-discovery`, `oidc_token` referencing `price-insight-invoker` with `audience` = `order-worker`'s own Cloud Run URI — per your "task-level OIDC audience matching the worker service URL" requirement). The queue's per-task OIDC config (used when the future `order-worker` code enqueues tasks) will also reference `price-insight-invoker` with audience = `order-worker`'s URI.
- `load-balancer.tf`: `google_compute_global_address` (static IP, output for your Cloudflare record), serverless NEGs + backend services for `frontend`/`backend` only (**`order-worker` is not in the URL map** — it's never reached via the public LB), `google_compute_url_map` (path matchers: `/` → frontend, `/api/*` `/auth/*` `/webhooks/*` → backend), `google_compute_managed_ssl_certificate` for `www.qweyha520.bar`, HTTPS target proxy + forwarding rule (port 443), plus an HTTP→HTTPS redirect (separate url map + target proxy + forwarding rule on port 80).
- `secrets.tf`: extend the two new secrets (`backend-session-secret`, `backend-dev-auth-password`) into `.github/workflows/infra-terraform.yml`'s reconcile-import list, closing the gap noted in Risks.
- `outputs.tf`: add the static IP (for your Cloudflare A record), and each Cloud Run service's URI (needed for the `order-worker` OIDC audience wiring, and useful for manual smoke-testing).

### GitHub Actions (new workflow, e.g. `.github/workflows/deploy-cloud-run.yml`)

- Build + push SHA-tagged images (`:${{ github.sha }}`, never `:latest`) for `frontend` and `backend` to Artifact Registry (reusing `build.yml`'s existing build steps/pattern).
- `gcloud run deploy frontend --image=...@sha256:<digest> --region=australia-southeast1` (and same for `backend`) — pin by digest, not tag, per your instruction.
- A smoke-test step (`curl` the service's health endpoint) before considering the deploy successful.
- A rollback step: `gcloud run services update-traffic --to-revisions=<previous-revision>=100` if the smoke test fails.
- `order-worker`'s deploy step is **not** included yet — deferred to PR 4 once its packaging is decided.

Why this approach:
- Matches every decision made across this discussion exactly: Cloud SQL via built-in connector (no VPC connector, no private-IP change), `order-worker` as a fully separate, least-privilege, IAM-private service, dedicated OIDC caller identities instead of granting `run.invoker` to Google-managed agents directly, split Terraform/CI deploy ownership, no `latest` tags, no application code in this PR.
- Bootstrap image + `ignore_changes` lets `terraform apply` run successfully today (resources exist, can be reviewed in `plan`) without depending on PR 4 or the DB code fix being done first.

Avoid:
- Do not grant `roles/run.invoker` to the Cloud Tasks/Scheduler Google-managed service agents directly — only `serviceAccountTokenCreator` on the dedicated caller SAs.
- Do not set `order-worker`'s ingress to internal-only.
- Do not add a Serverless VPC Access connector or touch Cloud SQL's public/private IP setting.
- Do not write any `apps/*` code in this PR.
- Do not let CI deploy with `:latest` or a mutable tag.

## 6. Approval Needed

Tao approval is required before:
- Implementing (per CLAUDE.md, requires literal `APPROVED TO IMPLEMENT`)
- Running `terraform plan`/`apply` via `infra-terraform.yml` (existing `prod` Environment reviewer gate already covers `apply`)
- Granting `terraform-ci@` any additional IAM roles it turns out to need (surfaces during first `plan`/`apply`)
- Pointing Cloudflare DNS at the new static IP (manual, yours)

## 7. Test Plan

Automated:
- `terraform fmt -check -recursive`, `terraform validate`, `terraform plan` (via `infra-terraform.yml`, manual trigger) — no app-level tests are affected since no `apps/*` code changes.

Manual validation:
- After `apply`, confirm all three Cloud Run services exist and are running the bootstrap image.
- Confirm `order-worker` rejects an unauthenticated request (expect 403) and rejects a request with a token from the wrong service account.
- Confirm `frontend`/`backend` are reachable through the GCLB's static IP (via `curl -H "Host: www.qweyha520.bar" https://<static-ip>/api/health --resolve www.qweyha520.bar:443:<static-ip>` style test, before DNS cutover) once you've pointed Cloudflare.
- Confirm the managed SSL cert reaches `ACTIVE` status.

Edge cases:
- Cloud Scheduler firing against the bootstrap-image `order-worker` (no `/internal/*` routes yet) — expect a clean 404, not a crash.
- `terraform apply` re-run after a CI image deploy — confirm the `ignore_changes` lifecycle block actually prevents Terraform from reverting the image (test by running `plan` after a manual `gcloud run deploy` and confirming no image diff is shown).

Regression checks:
- `k8s/` and `apps/gateway` remain untouched.
- Existing `infra-terraform.yml` secret-import behavior for previously-existing secrets is unaffected by the list extension.

## 8. Validation Commands

```bash
# Local, if Terraform is installed — otherwise rely on infra-terraform.yml's plan step
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform validate
```
`init`/`plan`/`apply` must run via the `infra-terraform.yml` workflow (GCS backend credentials + WIF aren't available locally).

## 9. Next Implementation Prompt

```markdown
# Task: Cloud Run infrastructure + routing (PR 2)

## Goal
Stand up frontend, backend, and order-worker Cloud Run services, the Cloud SQL connector
attachment, Cloud Tasks/Scheduler infra with dedicated OIDC caller identities, and the GCLB
path-routing stack — all in Terraform, with no application code changes.

## Background
This is PR 2 of the GKE -> Cloud Run migration (after PR 1, gateway retirement, already merged).
Every design decision is recorded in plan-17062026-2-cloud-run-infra.md section 5 — follow it
exactly, especially the identity-separation table.

## Scope
Implement only:
- infra/terraform/apis.tf, service-accounts.tf, cloud-run.tf, cloud-tasks.tf, load-balancer.tf
- Extend infra/terraform/secrets.tf's reconcile-import coverage (.github/workflows/infra-terraform.yml)
- New .github/workflows/deploy-cloud-run.yml (build SHA-tagged images, gcloud run deploy by
  digest, smoke test, rollback) for frontend and backend only
- infra/terraform/outputs.tf additions (static IP, service URIs)

## Boundaries
Do not:
- write or modify any apps/* source file
- grant roles/run.invoker to Cloud Tasks/Scheduler's Google-managed service agents directly
- add a Serverless VPC Access connector or change Cloud SQL public/private IP
- include order-worker in the GCLB URL map
- use :latest or any mutable image tag in the deploy workflow
- run terraform apply without Tao's review of the plan output

## Expected Changes
- infra/terraform/apis.tf (new)
- infra/terraform/service-accounts.tf (new)
- infra/terraform/cloud-run.tf (new)
- infra/terraform/cloud-tasks.tf (new)
- infra/terraform/load-balancer.tf (new)
- infra/terraform/secrets.tf (reconcile-import list extension, in infra-terraform.yml)
- infra/terraform/outputs.tf
- .github/workflows/deploy-cloud-run.yml (new)

## Tests
Run:
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform validate
(plan/apply via infra-terraform.yml only, manual trigger, Tao reviews plan before apply)

## Definition of Done
- terraform validate passes
- terraform plan (run via the workflow) shows exactly the resources described in section 5,
  no unexpected diffs
- No apps/* files touched
- Identity table in section 5 matches 1:1 with the IAM bindings in the plan output
```

## 10. Complexity

**Large** — first real infrastructure-as-code for this app beyond secrets: three Cloud Run services, a full GCLB stack, five new service accounts with carefully scoped IAM, and a new CI deploy workflow. No app code involved, but the surface area and the number of distinct identities to get right (per your explicit separation requirement) make this the biggest single Terraform change in the migration.

## 11. Final Status

Waiting for Tao approval.
