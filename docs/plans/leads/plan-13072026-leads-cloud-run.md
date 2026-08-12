# Plan: Stand up apps/leads on Cloud Run

## 1. Summary

`apps/leads` (Fastify + MongoDB Atlas, Phase 1 of the lead-scoring feature) currently has zero deployment infrastructure — no Dockerfile, no Terraform Cloud Run resource, no CI build/deploy job. This plan scopes building that infra from scratch, mirroring the existing `backend`/`frontend`/`order-worker` patterns exactly. Two architectural decisions were resolved with Tao: MongoDB Atlas egress uses "allow from anywhere" (0.0.0.0/0) rather than net-new VPC/NAT infra, and the service is public (`allUsers` invoker) relying on its existing `requireSession` JWT-cookie auth, rather than a private IAM-invoker model like `order_worker` (which would require new OIDC-token plumbing in the frontend's Nitro proxy that doesn't exist today).

## 2. Current Implementation

- **No `apps/leads/Dockerfile`.** `apps/backend/Dockerfile` and `apps/frontend/Dockerfile` are the two existing examples — each a fully independent, non-templated 3-stage (`base`→`builder`→`runner`) pnpm/turbo Dockerfile: copies workspace manifests first for layer caching, `pnpm install --filter <pkg> --frozen-lockfile`, `pnpm turbo build --filter <pkg>`, then a `runner` stage that reinstalls prod-only deps, copies `dist/` (+ `drizzle/` for backend only), runs as non-root `node` via `tini`, `EXPOSE`s the app's port, `CMD ["node", "dist/server.js"]`.
- **No Terraform resource for leads.** `infra/terraform/cloud-run.tf` defines `frontend`, `backend`, `order_worker` as `google_cloud_run_v2_service` resources. Each has a scoped runtime service account, `lifecycle.ignore_changes` on `image, client, client_version, traffic` (the `traffic` entry is critical — its past absence caused traffic to reset to the bootstrap revision on every apply), direct env vars, and secret-sourced env vars via a `dynamic "env"` block referencing Secret Manager. `order_worker` (`cloud-run.tf:236-337`) is the concrete precedent for a Cloud Run service not attached to the load balancer/Cloud Armor.
- **No CI wiring.** `.github/workflows/build.yml` and `deploy.yml` are both `workflow_dispatch`-only (manual trigger). `build.yml` builds+pushes images tagged by git SHA to Artifact Registry. `deploy.yml`'s `resolve` job verifies the image exists and resolves its immutable digest; each `deploy-*` job deploys by digest, then (backend only) runs a migration Cloud Run Job first, then health-checks `$URL/api/health` with automatic rollback via `update-traffic` on failure. Auth in every job is inline Workload Identity Federation — no GitHub Secrets are used anywhere.
- **No migration-job equivalent needed for leads.** Unlike backend's Drizzle/Cloud-SQL migrations (which CLAUDE.md forbids running at container start), `apps/leads/src/app.ts` already calls `ensureIndexes(getDb())` on every boot (idempotent) — no schema to migrate, so no `cloud-run-jobs.tf` equivalent and no migrate step in its deploy job.
- **Frontend build-time coupling**: `apps/frontend/Dockerfile` bakes `NUXT_BACKEND_URL` in at build time via a Docker `ARG`, because Nitro's `routeRules` proxy targets are resolved at build time. The same will be needed for `NUXT_LEADS_URL` once leads exists — meaning the frontend image must be rebuilt after leads' first deploy for the proxy target to take effect.

Main files:
- `apps/leads/Dockerfile` (new)
- `infra/terraform/cloud-run.tf`, `secrets.tf`, `service-accounts.tf`, `iam.tf`, `outputs.tf`
- `.github/workflows/build.yml`, `deploy.yml`
- `apps/frontend/Dockerfile`
- `infra/deploy-leads.sh` (new)

## 3. Affected Areas

- Frontend: yes, one line — `NUXT_LEADS_URL` build-arg, needs a rebuild once leads exists (no source change).
- Backend: no.
- Database: no — MongoDB Atlas is external; index creation is already self-healing on boot.
- Queue/jobs: no.
- External APIs: no.
- Tests: no — pure infra/deploy plumbing, no application code changes.
- Config/infra: yes, substantially — new Terraform resources (Cloud Run service, secrets, service account, IAM), new CI build/deploy jobs, new manual deploy script.

## 4. Risks

- Public Cloud Run service relying on app-layer auth only: if `requireSession` ever has a bug, the whole leads API is exposed with no network-level backstop. Mitigated by this being the same model backend already runs in production today.
- Atlas 0.0.0.0/0 allowlisting: connection-string credentials become the sole barrier to the database.
- Frontend/leads deploy ordering: leads' Cloud Run URL must exist before frontend's next build. Deploying leads for the first time requires: apply Terraform → CI build+deploy leads → CI rebuild+redeploy frontend. Missing the last step leaves the frontend proxy pointed at `localhost:4100` in production.
- New IAM/secrets surface: a new runtime service account + Secret Manager grants is a genuine security-relevant change.
- Terraform apply is gated behind the `prod` GitHub Environment's required reviewers — this plan only produces the Terraform/Dockerfile/CI diffs; applying/deploying is a separate, explicitly-approved step.

## 4b. Rollback Plan

- Bad Terraform apply: gated behind manual approval on the `prod` environment already, so a bad plan is caught before it applies. The `ignore_changes` pattern means re-applying after a Terraform fix won't clobber the live image/traffic — data-safe: yes.
- Bad leads deploy (crashes / fails health check): deploy.yml's health-check + rollback pattern (used for backend) is replicated for leads — automatic `update-traffic` back to the previous revision — data-safe: yes (MongoDB untouched by a bad container deploy).
- Frontend rebuild breaks the leads proxy: revert via `gcloud run deploy frontend --image=...@<previous-digest>` — data-safe: yes, no migration involved.

## 5. Recommended Approach

Summary:
1. **`apps/leads/Dockerfile`** (new) — copy `apps/backend/Dockerfile`'s 3-stage pattern, filtered to `@price-insight/leads`, drop the `drizzle/` copy line, `EXPOSE 4100`, `CMD ["node", "dist/server.js"]`. No workspace-internal deps to worry about.
2. **Terraform**:
   - `secrets.tf`: add `leads_secrets = ["leads-mongodb-uri"]` local + matching `google_secret_manager_secret`/`_version` resources (placeholder pattern identical to existing groups). `SESSION_SECRET` is NOT duplicated — leads' env references the existing `backend-session-secret` secret directly.
   - `service-accounts.tf`: new `google_service_account.leads_runtime` (mirroring `order_worker_runtime`) + `secretAccessor` grants on `leads-mongodb-uri` and `backend-session-secret`.
   - `cloud-run.tf`: new `google_cloud_run_v2_service.leads` — no Cloud SQL volume, port 4100, direct env (`NODE_ENV=production`, `APP_URL=<frontend origin>`), secret-sourced env for `MONGODB_URI`/`SESSION_SECRET`, `lifecycle.ignore_changes` including `traffic`, scaling min 0/max 4. New `google_cloud_run_v2_service_iam_member.leads_public` granting `allUsers` `run.invoker`.
   - `iam.tf`: new `ci_leads_deployer` (`roles/run.developer` scoped to the leads service).
   - `outputs.tf`: add `leads` to `cloud_run_service_uris`, and `leads_secret_ids`.
3. **CI**:
   - `build.yml`: add a `build-leads` job mirroring `build-backend`.
   - `deploy.yml`: add `leads` as a valid `target`, add a `deploy-leads` job mirroring `deploy-backend` minus the migration step.
   - Update `build-frontend` to also resolve leads' URL and pass it as `NUXT_LEADS_URL`, mirroring `NUXT_BACKEND_URL`.
4. **`apps/frontend/Dockerfile`**: add `ARG NUXT_LEADS_URL=http://localhost:4100`, passed through like `NUXT_BACKEND_URL`.
5. **`infra/deploy-leads.sh`** (new, optional manual path) — copy `infra/deploy-backend.sh` minus the migrate-Job steps.

Likely files: see section 2.

Why this approach:
- Every piece mirrors an existing, working pattern in this exact repo (`order_worker` for the standalone/no-LB shape, `backend` for secret-env-wiring and Dockerfile shape, `NUXT_BACKEND_URL` handling for the new `NUXT_LEADS_URL` need) — nothing here is a novel design.

Avoid:
- Attaching leads to the load balancer or Cloud Armor policy.
- Creating a `leads-session-secret` (must reuse `backend-session-secret` or the shared pi-session cookie breaks across services).
- Adding a migrate-style Cloud Run Job for leads (unneeded — `ensureIndexes()` on boot already covers it).
- Running `terraform apply`, `gcloud run deploy`, or triggering GitHub Actions workflows — that's Tao's (or the gated CI flow's) call, not something to do autonomously.

## 6. Approval Needed

Tao approval is required before:

- Any of this taking effect in GCP — happens via the `prod`-environment-gated `infra-terraform.yml` (`action: apply`).
- The IAM/secrets surface this introduces (new service account, new Secret Manager secret, new `run.invoker` binding).
- Triggering `build.yml`/`deploy.yml` for the new `leads` target, and the follow-up frontend rebuild.

## 7. Test Plan

Automated tests:
- None needed — no application code changes.

Edge case tests:
- N/A (infra-only change).

Manual validation (after Terraform apply + first CI build/deploy):
- `curl -sf https://<leads-run-url>/api/health` → `{"ok":true}`.
- Hit an authenticated route (`GET /api/leads` with a valid `pi-session` cookie) and confirm 200, not 500 (bad Mongo URI) or 401 (session secret mismatch with backend's).
- After the frontend rebuild, load `/leads` in a browser and confirm the dashboard loads real data through the `/leads-api/**` proxy (not a 502).
- Confirm a deliberately-bad leads deploy triggers the health-check failure → automatic rollback path.

Regression checks:
- `backend`/`frontend`/`order-worker` Terraform resources and CI jobs are unaffected (purely additive — no shared resource modified except `outputs.tf`).

## 8. Validation Commands

```bash
cd infra/terraform && terraform fmt -check   # expect: no diff
cd infra/terraform && terraform validate     # expect: success (requires local GCP creds/backend config)
docker build -f apps/leads/Dockerfile -t leads-test .   # expect: builds successfully, local-only sanity check
```

Do not run `terraform plan`/`apply` against real `prod` state, or any `gcloud`/workflow-dispatch command, without Tao's explicit go-ahead.

## 9. Next Implementation Prompt

```markdown
# Task: Stand up apps/leads on Cloud Run

## Goal

Build the Terraform, Dockerfile, and CI config needed to deploy apps/leads to Cloud Run, mirroring the existing backend/frontend/order-worker patterns. Do not apply Terraform or trigger deploys — that stays with Tao.

## Background

apps/leads has no deployment infra today. Atlas egress will use 0.0.0.0/0 allowlisting (no VPC/NAT). The service will be public (allUsers invoker), relying on its existing requireSession JWT-cookie auth, not a private IAM-invoker model.

## Scope

Implement only:

- `apps/leads/Dockerfile` — 3-stage pnpm/turbo build mirroring apps/backend/Dockerfile, EXPOSE 4100, CMD ["node", "dist/server.js"].
- `infra/terraform/secrets.tf` — `leads_secrets` local + secret resources for `leads-mongodb-uri` only (reuse `backend-session-secret` for SESSION_SECRET).
- `infra/terraform/service-accounts.tf` — `leads_runtime` service account + secretAccessor grants.
- `infra/terraform/cloud-run.tf` — `google_cloud_run_v2_service.leads` + `google_cloud_run_v2_service_iam_member.leads_public` (allUsers).
- `infra/terraform/iam.tf` — `ci_leads_deployer`.
- `infra/terraform/outputs.tf` — add `leads` entries.
- `.github/workflows/build.yml` — `build-leads` job; update `build-frontend` to resolve+pass `NUXT_LEADS_URL`.
- `.github/workflows/deploy.yml` — `leads` target + `deploy-leads` job (no migration step).
- `apps/frontend/Dockerfile` — `ARG NUXT_LEADS_URL=http://localhost:4100`.
- `infra/deploy-leads.sh` — manual deploy script mirroring deploy-backend.sh minus migration.

## Boundaries

Do not:

- run `terraform plan`/`apply` against real state
- run any `gcloud` command that mutates GCP resources
- trigger `build.yml`/`deploy.yml` via workflow_dispatch
- attach leads to the load balancer or Cloud Armor
- create a separate `leads-session-secret`
- add a migrate-style Cloud Run Job for leads

## Expected Changes

Likely files: see section 2 of the plan.

## Tests

See section 7 (Test Plan). No automated tests apply; run the local-only validation commands in section 8.

## Definition of Done

* All new/changed files above exist and are internally consistent (naming, secret refs, service names match across files).
* `terraform fmt -check` and `docker build` (local sanity checks only) pass.
* Nothing has been applied or deployed — Tao reviews and runs the actual apply/deploy steps himself.
```

## 10. Final Status

Blocked on approval:
- Infrastructure/deployment changes (new Cloud Run service, Terraform resources) — requires approval before infra/deployment changes, and `terraform apply` itself is gated behind the `prod` environment's required reviewers regardless.
- Auth/security changes (new service account, new Secret Manager secret + IAM grants, public `allUsers` invoker decision) — requires approval before auth/security changes.
- Actually triggering `build.yml`/`deploy.yml` for the new `leads` target and the subsequent frontend rebuild — production-impacting, manual actions outside what should be run autonomously.

Waiting for Tao approval.
