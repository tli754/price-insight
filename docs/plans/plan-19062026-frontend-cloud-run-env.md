# Plan: Frontend Cloud Run env/secrets wiring + smoke test fix

## 1. Summary

The frontend Cloud Run smoke test passes against Google's bootstrap placeholder
image (`us-docker.pkg.dev/cloudrun/container/hello`, revision `frontend-00001-9rz`)
because that image returns HTTP 200 for every path, including `/api/health`. The
smoke test only checks status code, so it can't tell a real deploy from a stuck
rollout.

Code inspection (not yet confirmed against live GCP state) found three distinct,
already-proven issues, and one still-open question:

1. **Dead secrets, not a missing-secret crash.** Terraform creates three frontend
   secrets and already grants the frontend runtime SA `secretAccessor` on them —
   but none of the three correspond to env vars the frontend code actually reads.
   `nuxt-auth-utils` isn't even a dependency. Wiring them would be a no-op.
2. **A real, separate, build-time bug.** The one env var the frontend code does
   read (`NUXT_BACKEND_URL`, in `nuxt.config.ts`) is consumed at **build time** to
   bake Nitro's `routeRules` proxy target. The Dockerfile sets `NUXT_GATEWAY_URL`
   (stale, from the retired `apps/gateway`) instead, so every built image has
   `/api/**` and `/auth/**` permanently proxying to `http://localhost:4000`. No
   Cloud Run runtime env var can fix this — it's frozen in the built artifact.
3. **The smoke test is checking the wrong thing**, as above.
4. **Still unknown: why the real revision never went Ready.** Nothing found in
   (1)-(2) explains a failed startup probe — `/api/health` is a local Nitro route,
   unaffected by the proxy bug, and there's no code that would throw at boot.
   This needs live revision conditions/logs, which requires authenticated
   `gcloud`/Cloud Logging access I don't have in this environment. Root cause is
   **not yet confirmed** — recommended approach below treats it as an open
   investigation step, not an assumption.

Recommended direction: fix the two proven bugs (proxy build-arg, smoke test), but
gate any further env/secret wiring on what the revision-conditions investigation
actually shows, rather than guessing.

## 2. Current Implementation

**Frontend auth/proxying** (post Google-OAuth removal, see `CLAUDE.md`):
- `apps/frontend/app/middleware/auth.global.ts` calls `/auth/session`.
- `apps/frontend/nuxt.config.ts:1,9-10` proxies `/api/**` and `/auth/**` to
  `${NUXT_BACKEND_URL}` (default `http://localhost:4000`) via static `routeRules`.
- `apps/frontend/server/api/health.ts` — local route, not proxied (`routeRules`
  has an explicit empty override at line 8: `"/api/health": {}`).
- No `nuxt-auth-utils` in `apps/frontend/package.json`. No OAuth route files exist.

**Build pipeline:**
- `apps/frontend/Dockerfile:15` — `RUN NUXT_GATEWAY_URL=http://gateway.price-insight.svc.cluster.local:4001 pnpm turbo build ...`. This var is never read by current code (confirmed via grep — only `NUXT_BACKEND_URL` is read). Leftover from the retired gateway (commit `2ef5b558`).
- Confirmed in the committed `.output` build artifact: `apps/frontend/.output/server/chunks/nitro/nitro.mjs:4361,4367` has the literal string `http://localhost:4000` baked into the proxy rules — proving the mechanism, not just asserting it.

**Terraform (`infra/terraform/`):**
- `secrets.tf:25-29` — `frontend_secrets = ["frontend-nuxt-session-password", "frontend-nuxt-dev-auth-password", "frontend-nuxt-api-url"]`, all created with a `"placeholder"` `secret_data` value (never set for real — see comment at `secrets.tf:51-54`, same pattern for backend).
- `service-accounts.tf:71-77` — `frontend_runtime_secrets` already grants the frontend runtime SA `roles/secretmanager.secretAccessor` on all three. IAM groundwork is done.
- `cloud-run.tf:45-90` — the frontend `google_cloud_run_v2_service` container block only sets `NODE_ENV=production`. There is no `frontend_secret_env` local (unlike `backend_secret_env` at `cloud-run.tf:7-27`, consumed via the `dynamic "env"` block at lines 164-175) and no `secret_key_ref` usage for frontend at all.
- `load-balancer.tf:62-70` — the GCLB already path-routes `/api*`, `/auth*`, `/webhooks*` to the **backend** service before traffic ever reaches frontend. So in real production traffic via the custom domain, frontend's broken internal proxy (bug #2 above) is largely masked — it only matters for direct calls to the frontend Cloud Run URL itself (which is exactly what the CI smoke test does, though it hits `/api/health`, the one unaffected route).

**CI (`.github/workflows/deploy-cloud-run.yml`):**
- `workflow_dispatch` only. `deploy-frontend` job: build → push SHA-tagged image → `gcloud run deploy --image=...@digest` → smoke test (`curl -sf $URL/api/health`) → rollback on failure (lines 98-163).
- Smoke test only checks HTTP status; never inspects body or the active revision's image/condition.

## 3. Affected Areas

- Frontend: build-arg rename only (`Dockerfile`), no app code change anticipated unless investigation (item 4) finds otherwise.
- Backend: none.
- Database: none.
- Queue/jobs: none.
- External APIs: none.
- Tests: smoke-test logic in `deploy-cloud-run.yml` (no automated test framework involved — it's a CI shell step).
- Config/infra: `infra/terraform/cloud-run.tf` (possibly), `apps/frontend/Dockerfile`, `.github/workflows/deploy-cloud-run.yml`.

## 4. Risks

- **False confidence risk**: if I propose the secret-wiring fix (item 2 of the original ask) and it turns out to be a no-op (per finding #1), it costs a `terraform apply` cycle without fixing anything. Mitigated by NOT proposing it until investigation confirms it's actually needed.
- **IAM risk**: if frontend secrets are wired into `cloud-run.tf` without checking `frontend_runtime_secrets` is already correct (it is, confirmed), the revision would fail to start with a permission error — this exact failure mode is what likely happened to backend historically, hence the existing IAM grant. Low risk here since the grant already exists; just don't skip the `depends_on` when adding `secret_key_ref` (mirror backend's `cloud-run.tf:190` pattern).
- **Smoke-test false-negative risk**: tightening the smoke test to check body content could itself break if the real frontend's HTML structure changes later (e.g. a title rename). Mitigate by checking for the negative marker (Cloud Run placeholder signature) and the deployed image, not a brittle positive string.
- **Investigation-without-access risk**: I cannot run authenticated `gcloud` here. The root-cause step (item 4) needs Tao to either run the listed read-only commands and paste output, or grant a way to query GCP. Until then, recommended Terraform/workflow changes below are scoped to the two *proven* bugs only.
- **Rollback risk**: none of the proposed changes touch traffic-serving resources directly (frontend currently isn't serving real traffic anyway, by definition of the bug) — but the Dockerfile/workflow change does produce a new image that will be deployed by the next manual `workflow_dispatch` run, so an unrelated regression in that image would surface as a new failed deploy, same as today's failure mode, caught by the (now-fixed) smoke test.

## 5. Recommended Approach

Summary:
1. **Investigate first** (read-only, no apply): run the `gcloud` commands in
   Validation Commands below (or have Tao run them) to get the real frontend
   revision's `status.conditions` and Cloud Logging output for its boot attempt.
   This determines whether there's a *third* bug beyond the two already proven.
2. **Fix the build-time proxy bug**: rename the Dockerfile build arg from
   `NUXT_GATEWAY_URL` to `NUXT_BACKEND_URL`, and have `deploy-cloud-run.yml`'s
   `deploy-frontend` job pass the **backend's actual Cloud Run URL** (queried via
   `gcloud run services describe backend --format='value(status.url)'`, same
   pattern already used for the "previous revision" step) as that build arg's
   value, via `docker/build-push-action`'s `build-args`. This is a plain build
   arg, not a secret — the backend's Cloud Run URL isn't sensitive.
3. **Fix the smoke test** to fail when the active revision is still the bootstrap
   placeholder: check the response body for the placeholder's known marker
   (`"Congratulations, you successfully deployed a container image to Cloud Run"`)
   AND independently verify the serving revision's image via
   `gcloud run services describe frontend --format='value(status.traffic[0].revisionName)'`
   is not `bootstrap_image`. Fail (and roll back, same as today) if either check
   fails.
4. **Do not touch the three Terraform frontend secrets** (`frontend-nuxt-session-password`, `frontend-nuxt-dev-auth-password`, `frontend-nuxt-api-url`) in this PR — they correspond to no code path today. Flag them as dead/leftover from the removed Google OAuth design; cleanup is a separate, smaller follow-up (out of scope here per your "focused fix" instruction), not a blocker.

Likely files:
- `apps/frontend/Dockerfile` (rename build arg)
- `.github/workflows/deploy-cloud-run.yml` (pass backend URL as build-arg; tighten smoke test for both frontend and — optionally, for consistency — leave backend's smoke test as-is since backend doesn't have this placeholder-masking failure mode, it already crashes loudly per the Redis fix from earlier this session)
- `infra/terraform/cloud-run.tf` — **only if** investigation (step 1) shows frontend secrets are actually needed; not touched otherwise.

Why this approach:
- Fixes the two bugs I can already prove from the code, without guessing at the
  one I can't yet prove.
- Keeps the Terraform diff at zero unless investigation justifies it — smaller,
  safer change, consistent with "use Secret Manager references, don't put
  secret values in state" (nothing to add if nothing's needed).
- The smoke-test fix directly closes the "every future deploy could silently
  stay on the placeholder forever and CI would say it's fine" gap, independent
  of whatever item 4 finds.

Avoid:
- Wiring the three frontend secrets speculatively "just in case" — confirmed
  dead code, would just be clutter and a Terraform `apply` for nothing.
- Touching `load-balancer.tf`, DNS, Cloud Scheduler, `order-worker`, or any
  migration logic (per your explicit exclusions).
- Manually moving traffic between revisions via `gcloud run services update-traffic` before root cause is confirmed.

## 6. Approval Needed

Tao approval is required before:
- Editing `apps/frontend/Dockerfile` and `.github/workflows/deploy-cloud-run.yml` (workflow/deploy config change).
- Any `infra/terraform/cloud-run.tf` change, contingent on investigation findings — a separate, explicit approval if it turns out to be needed.
- Running `terraform plan`/`apply` (existing `prod` Environment reviewer gate already covers `apply`).
- Triggering the `deploy-cloud-run.yml` workflow to actually test the fix end-to-end (it's `workflow_dispatch`, manual).

## 7. Test Plan

Automated tests: none exist for Terraform/CI workflow files (infra has no test framework); this is shell/YAML/HCL, validated by `terraform plan` and a real (manual) workflow dispatch.

Edge case tests / things to verify by inspection or a real dispatch run:
- Build-arg rename doesn't silently no-op (verify the new `nitro.mjs` proxy rule baked into the image has the backend's real URL, not `localhost:4000` — extract and grep the built image's `.output` the same way I did locally).
- Smoke test correctly **fails** against the current (stuck) frontend service before any fix is applied — i.e. confirm the new check actually distinguishes the bad state (don't just trust it fixes the symptom without testing it against the known-bad case first).
- Smoke test correctly **passes** once a real revision is serving (after the build-arg fix is deployed).
- Rollback path still triggers correctly if the new check fails for an unrelated reason (e.g. real revision is broken for some other cause) — confirm `update-traffic` rollback step still fires off the tightened check the same way it does today off `curl -sf`'s exit code.
- Confirm `frontend_runtime_secrets` IAM grant is truly unused right now (no `terraform plan` diff expected from this PR if Terraform isn't touched).

Manual validation:
- Run the `gcloud` investigation commands below and read the actual revision conditions/logs before deciding if item 4 needs more than the two proven fixes.
- After deploying the build-arg fix, hit the frontend's bare Cloud Run URL directly (not through the LB) for `/auth/session` and confirm it no longer returns a proxy error to `localhost:4000`.

Regression checks:
- Backend deploy job and its smoke test are untouched — confirm no accidental shared-logic changes leak into the backend job if the smoke-test fix is implemented as a shared step/script.
- `order-worker`, Cloud Scheduler, Cloud SQL, DNS/Cloudflare config: untouched, per explicit exclusion.

## 8. Validation Commands

Read-only investigation (run these first, before any code change — I don't have authenticated `gcloud` access in this session, so either paste the output back or confirm I should request access):

```bash
# Revision list + status
gcloud run revisions list --service=frontend --region=australia-southeast1 --project=wd-tools

# Full condition detail for the latest non-bootstrap revision
gcloud run revisions describe <latest-revision-name> \
  --region=australia-southeast1 --project=wd-tools --format=json

# Boot/startup logs for that revision
gcloud logging read \
  'resource.type="cloud_run_revision" resource.labels.service_name="frontend" resource.labels.revision_name="<latest-revision-name>"' \
  --project=wd-tools --limit=100 --order=asc

# Confirm which revision is actually serving traffic right now
gcloud run services describe frontend --region=australia-southeast1 --project=wd-tools \
  --format='value(status.traffic[0].revisionName,status.traffic[0].percent)'
```

After implementation (once approved and merged):

```bash
pnpm --filter @price-insight/frontend build   # confirm build still succeeds locally
grep -o "http://localhost:4000\|https://backend-[a-z0-9-]*\.run\.app" apps/frontend/.output/server/chunks/nitro/nitro.mjs  # confirm bake target changed
```

Do not run `terraform apply` or trigger `workflow_dispatch` without separate confirmation at that point — both are listed above as approval gates distinct from the plan approval itself.

## 9. Next Implementation Prompt

```markdown
# Task: Fix frontend Cloud Run proxy build-arg and smoke test false-positive

## Goal

Stop the frontend's `/api/**`/`/auth/**` proxy from being permanently baked to
`http://localhost:4000`, and make the CI smoke test actually detect when traffic
is stuck on the Cloud Run bootstrap placeholder instead of a real deploy.

## Background

`apps/frontend/Dockerfile` builds the frontend with `NUXT_GATEWAY_URL` set (a
leftover from the retired `apps/gateway`), but `nuxt.config.ts` reads
`NUXT_BACKEND_URL` to bake Nitro's routeRules proxy target at build time. The
env var is never set under the right name, so every built image silently
defaults to proxying to `http://localhost:4000`. Separately, the CI smoke test
in `.github/workflows/deploy-cloud-run.yml` only checks HTTP status of
`/api/health`, which the Cloud Run bootstrap placeholder image
(`us-docker.pkg.dev/cloudrun/container/hello`) satisfies for any path — so a
stuck rollout looks "healthy" to CI.

## Scope

Implement only:
- Rename the Dockerfile build arg from `NUXT_GATEWAY_URL` to `NUXT_BACKEND_URL`.
- In `.github/workflows/deploy-cloud-run.yml`'s `deploy-frontend` job, query the
  backend's Cloud Run URL and pass it as that build arg via
  `docker/build-push-action`'s `build-args` input.
- Tighten the frontend smoke test step to fail if the response body matches the
  Cloud Run placeholder's known marker text, or if the serving revision's image
  is the bootstrap image.

## Boundaries

Do not:
- Touch `infra/terraform/cloud-run.tf`, `secrets.tf`, `service-accounts.tf`, or
  any other Terraform file.
- Touch `load-balancer.tf`, DNS, Cloud Scheduler, or `order-worker`.
- Change database migration logic.
- Run `terraform plan`/`apply` or trigger `workflow_dispatch`.
- Expand scope to clean up the three unused frontend Secret Manager secrets —
  that's a separate follow-up.

## Expected Changes

Likely files:
- `apps/frontend/Dockerfile`
- `.github/workflows/deploy-cloud-run.yml`

## Tests

Run:
```bash
pnpm --filter @price-insight/frontend build
grep -o "http://localhost:4000" apps/frontend/.output/server/chunks/nitro/nitro.mjs   # should find nothing if NUXT_BACKEND_URL was set during this local build
```

Manual:
- Confirm the smoke-test logic change actually fails against today's known-bad
  state before considering it done.

## Definition of Done

- Dockerfile build arg renamed and wired to the real backend URL in CI.
- Smoke test fails on placeholder, passes on a real healthy deploy.
- No Terraform, LB, DNS, scheduler, or order-worker changes present in the diff.
```

## 10. Final Status

Waiting for Tao approval.
