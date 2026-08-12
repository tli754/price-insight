# Plan: Delete apps/gateway and Its K8s/CI References (PR 3)

## 1. Summary

Delete `apps/gateway` entirely, along with its Kubernetes manifests and the gateway-specific steps in the GKE build/deploy workflows. PR 1 already moved gateway's auth/CORS/cookie/JWT behavior into the backend and repointed the frontend's dev proxy at the backend directly — since then, gateway has been dead code with no live consumer. This PR removes it. GKE is already shut down, so nothing in this PR has live traffic to protect — the only real decision is what to do with gateway's Terraform-managed Secret Manager secrets, called out separately in Risks since deleting those `.tf` resources would have Terraform actually destroy real GCP secret material on `apply`.

## 2. Current Implementation

`apps/gateway` is referenced in exactly these places (confirmed via repo-wide grep for "gateway" across `*.yml`/`*.yaml`/`*.tf`):

- `k8s/gateway/deployment.yaml`, `k8s/gateway/service.yaml` — the GKE Deployment/Service, listening on port 4001.
- `k8s/ingress.yaml` — routes `/api` and `/auth` to the `gateway` Service (port 4001). Since PR 1, this is stale: the backend now serves both prefixes directly on port 4000 (`k8s/backend/service.yaml` already exposes 4000).
- `.github/workflows/build.yml` — `gateway` is a `target` choice option, `GATEWAY_IMAGE` env var, the full `build-gateway` job, and `build-gateway` in `call-deploy`'s `needs` list.
- `.github/workflows/deploy.yml` — `gateway` target choice option, `GATEWAY_IMAGE` env var, a secrets-sync block that fetches `gateway-session-secret`/`gateway-dev-auth-password` from GSM and creates a `gateway-secrets` K8s Secret, and a "Roll out gateway" step (`kubectl set image deployment/gateway`).
- `infra/terraform/secrets.tf` — `gateway_secrets` local list (`gateway-session-secret`, `gateway-dev-auth-password`), plus `google_secret_manager_secret.gateway`/`google_secret_manager_secret_version.gateway` resources (`for_each` over that list).
- `infra/terraform/iam.tf` — `google_secret_manager_secret_iam_member.ci_gateway`, granting the CI SA `secretAccessor` on the gateway secrets.
- `infra/terraform/outputs.tf` — `gateway_secret_ids` output.
- `.github/workflows/infra-terraform.yml` — imports `gateway-dev-auth-password`/`gateway-session-secret` in its state-reconciliation step.

## 3. Affected Areas

- Frontend: No (already repointed at the backend in PR 1).
- Backend: No.
- Database: No.
- Queue/jobs: No.
- External APIs: No.
- Tests: No (`apps/gateway` has no test suite to lose).
- Config/infra: Yes — K8s manifests, two CI workflows, and (optionally — see Risks) three Terraform files.

## 4. Risks

- **Terraform secret deletion is a real, irreversible-ish action.** Removing `gateway_secrets`/`google_secret_manager_secret.gateway` from `secrets.tf` makes the next `terraform apply` *destroy* the actual `gateway-session-secret`/`gateway-dev-auth-password` GSM secrets (the `lifecycle.ignore_changes` on those resources only protects the secret *value* from being overwritten, not the resource from being destroyed if removed from config entirely). Since GKE is shut down, nothing reads these secrets anymore — but deleting them from GCP is a distinct, deliberate action from deleting dead code/CI, and deserves its own explicit approval rather than being silently bundled in. **Recommendation: leave the Terraform secret resources in place for this PR**, scope this PR to code/K8s-manifest/CI-workflow deletion only, and treat the Terraform secret removal as a separate one-line follow-up you approve explicitly when ready (it's a 3-file, ~15-line diff, trivial to do later).
- **`k8s/ingress.yaml`'s `/api`/`/auth` rules need a decision, not just deletion.** Since GKE is shut down, this doesn't affect live traffic, but leaving the manifest pointing at a Service that's about to be deleted (`gateway`) would make the checked-in config actively wrong, not just stale. Recommended approach below repoints those rules to the `backend` Service instead of deleting them outright, since backend genuinely serves those paths now.
- **No tests to break** — low regression risk; the main failure mode would be a leftover reference somewhere not caught by the grep (mitigated by re-running the same grep as a validation step after the edit).

## 5. Recommended Approach

Summary:
- Delete `apps/gateway/` entirely (`src/`, `Dockerfile`, `package.json`, `tsconfig.json`, `.env`/`.env.example`, `dist/` if present).
- Delete `k8s/gateway/deployment.yaml` and `k8s/gateway/service.yaml`.
- Edit `k8s/ingress.yaml`: repoint the `/api` and `/auth` path rules' `backend.service.name`/`port.number` from `gateway`/`4001` to `backend`/`4000`.
- Edit `.github/workflows/build.yml`: remove `gateway` from the `target` input's choice list, remove `GATEWAY_IMAGE`, remove the `build-gateway` job, remove `build-gateway` from `call-deploy.needs`.
- Edit `.github/workflows/deploy.yml`: remove `gateway` from the `target` choice list, remove `GATEWAY_IMAGE`, remove the gateway secrets-sync block, remove the "Roll out gateway" step.
- **Leave `infra/terraform/{secrets,iam,outputs}.tf` and `infra-terraform.yml`'s gateway secret-import lines untouched in this PR** — flagged above as a separate, explicitly-approved follow-up.

Likely files:
- Deleted: `apps/gateway/**`, `k8s/gateway/deployment.yaml`, `k8s/gateway/service.yaml`
- Edited: `k8s/ingress.yaml`, `.github/workflows/build.yml`, `.github/workflows/deploy.yml`

Why this approach:
- Matches exactly what's dead vs. what's still a deliberate-infra-change decision — code/CI cleanup is unambiguous and safe; GSM secret destruction is a separate, smaller, explicitly-gated decision.
- Repointing the ingress rules (rather than deleting them) keeps the manifest internally consistent with what PR 1 already shipped in the application code, even though GKE itself is shut down and won't read this file again before the Cloud Run cutover.

Avoid:
- Do not touch `infra/terraform/{secrets,iam,outputs}.tf` or `infra-terraform.yml`'s gateway import lines in this PR.
- Do not touch `k8s/backend/`, `k8s/frontend/`, `k8s/redis/`, or `k8s/namespace.yaml`.
- Do not touch anything under `infra/terraform/{apis,service-accounts,cloud-run,cloud-tasks,load-balancer}.tf` (PR 2's scope).

## 6. Approval Needed

Tao approval is required before:
- Implementing (per CLAUDE.md, requires literal `APPROVED TO IMPLEMENT`)
- The separate follow-up decision to delete the Terraform-managed `gateway-session-secret`/`gateway-dev-auth-password` GSM secrets (not part of this PR's scope, called out for a future explicit ask)

## 7. Test Plan

Automated:
- None applicable — no application code changes, `apps/gateway` had no tests.

Manual validation:
- Re-run `grep -rln "gateway" --include="*.yml" --include="*.yaml" --include="*.tf" .` (excluding `pnpm-lock.yaml`, which will still mention `@price-insight/gateway` in its history-free lockfile entries until a fresh `pnpm install` — expected, harmless) and confirm zero remaining hits in `k8s/`, `.github/workflows/`, and `apps/`.
- Confirm `pnpm install` at the repo root still succeeds after `apps/gateway` is removed (no dangling workspace reference in `pnpm-workspace.yaml`/root `package.json` — neither currently hardcodes individual app names, so this should be a non-issue, but worth a quick check).
- Visual diff of `k8s/ingress.yaml` to confirm `/api`/`/auth` now point at `backend:4000`.

Edge cases:
- N/A — this is a deletion-only change with no runtime behavior.

Regression checks:
- Confirm `k8s/backend/`, `k8s/frontend/`, `k8s/redis/` are byte-for-byte unchanged.
- Confirm `infra/terraform/cloud-run.tf`/`cloud-tasks.tf`/`load-balancer.tf` (PR 2) are unaffected.

## 8. Validation Commands

```bash
grep -rln "gateway" --include="*.yml" --include="*.yaml" --include="*.tf" . | grep -v node_modules | grep -v pnpm-lock.yaml
pnpm install
git status --short
```

## 9. Next Implementation Prompt

```markdown
# Task: Delete apps/gateway and its K8s/CI references (PR 3)

## Goal
Remove the now-dead gateway service entirely — code, K8s manifests, and CI workflow steps —
now that PR 1 moved its functionality into the backend. Leave the Terraform-managed GSM
secrets for gateway untouched (separate follow-up decision).

## Background
PR 1 already moved gateway's auth/CORS/cookie/JWT into apps/backend and repointed the
frontend's dev proxy at the backend. GKE is shut down, so nothing reads these K8s manifests
or runs these CI steps against live infrastructure anymore.

## Scope
Implement only:
- Delete apps/gateway/ entirely
- Delete k8s/gateway/deployment.yaml and k8s/gateway/service.yaml
- Edit k8s/ingress.yaml: repoint /api and /auth path rules from gateway:4001 to backend:4000
- Edit .github/workflows/build.yml: remove gateway target option, GATEWAY_IMAGE,
  build-gateway job, and its entry in call-deploy.needs
- Edit .github/workflows/deploy.yml: remove gateway target option, GATEWAY_IMAGE,
  the gateway secrets-sync block, and the "Roll out gateway" step

## Boundaries
Do not:
- touch infra/terraform/secrets.tf, iam.tf, or outputs.tf (gateway GSM secrets stay for now)
- touch infra-terraform.yml's gateway secret-import lines
- touch k8s/backend/, k8s/frontend/, k8s/redis/, or k8s/namespace.yaml
- touch anything in PR 2's Terraform files (apis.tf, service-accounts.tf, cloud-run.tf,
  cloud-tasks.tf, load-balancer.tf)

## Expected Changes
- Deleted: apps/gateway/** , k8s/gateway/deployment.yaml, k8s/gateway/service.yaml
- Edited: k8s/ingress.yaml, .github/workflows/build.yml, .github/workflows/deploy.yml

## Tests
Run:
grep -rln "gateway" --include="*.yml" --include="*.yaml" --include="*.tf" . | grep -v node_modules | grep -v pnpm-lock.yaml
pnpm install

## Definition of Done
- apps/gateway no longer exists
- No remaining "gateway" references in k8s/ or .github/workflows/
- infra/terraform/{secrets,iam,outputs}.tf unchanged
- pnpm install succeeds
```

## 10. Complexity

**Small** — pure deletion plus two small CI-workflow edits and one manifest repoint, no application logic, no tests to update. The only nuance is deliberately *not* touching the Terraform secrets, which is more a discipline point than a complexity one.

## 11. Final Status

Implemented and pushed 2026-06-18, exactly per scope:

- Deleted `apps/gateway/` (tracked files via `git rm`, plus leftover gitignored `.env`/`dist`/`node_modules` manually removed)
- Deleted `k8s/gateway/deployment.yaml`, `k8s/gateway/service.yaml`
- Repointed `k8s/ingress.yaml`'s `/api`/`/auth` rules to `backend:4000`
- Stripped gateway from `.github/workflows/build.yml` and `deploy.yml` (target option, image env var, build/rollout steps, secrets-sync block)
- Left `infra/terraform/{secrets,iam,outputs}.tf` and `infra-terraform.yml`'s gateway import lines untouched, as scoped

Validation: gateway grep clean (only the 4 protected Terraform/CI files remain), `pnpm install` succeeds, no diff in protected paths (`infra/terraform/`, `k8s/backend`, `k8s/frontend`, `k8s/redis`, `k8s/namespace.yaml`).

Committed as `2ef5b558` on `feature/cloud-run-migration`, pushed to origin.

Still open: the deferred follow-up decision on deleting the Terraform-managed `gateway-session-secret`/`gateway-dev-auth-password` GSM secrets (would destroy live secret material on `apply` — not part of this PR).
