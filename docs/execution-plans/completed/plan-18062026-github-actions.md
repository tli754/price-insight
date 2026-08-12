# Plan: Simplify GitHub Actions Workflows

## 1. Summary

Consolidate five workflow files into the three-item Actions menu the task specifies (`Build`, `Deploy`, `Infrastructure`), fully decoupling build from deploy (currently `build.yml` builds *and* triggers deploy in the same run), replacing the GKE-targeting `deploy.yml` with a true Cloud-Run digest-deploy workflow, and converting `codex-review.yml` from a menu-visible manual trigger to a PR-label-gated one. One real gap surfaced during investigation that needs your decision before I can finalize the Deploy design: **database migrations have no equivalent step in the Cloud Run path today** (see Risks).

## 2. Current Implementation

**Files, triggers, and what each actually does right now:**

| File | Display name | Trigger | What it does |
|---|---|---|---|
| `build.yml` | Build Images | `workflow_dispatch` (`ref`, `target`) | Builds backend/frontend via `docker/build-push-action`, tags `:<8-char-sha>` **and** `:latest`, pushes to GAR, then immediately calls `deploy.yml` via `workflow_call` with `image_tag: github.sha`. Build and deploy are coupled — there's no way to build without also deploying. |
| `deploy.yml` | Deploy | `workflow_dispatch` + `workflow_call` | **GKE/kubectl-based** — gets GKE credentials, applies k8s manifests, syncs secrets from GSM into k8s Secrets, runs a migration `Job` (`.github/k8s/migration-job.yaml`, runs `node dist/db/run-migrations.js`), then `kubectl set image` + `kubectl rollout status` for backend/frontend. This is the **only place migrations currently run**. Obsolete as a deploy mechanism now that Cloud Run is live (PR2), but its migration step has no replacement yet. |
| `deploy-cloud-run.yml` | Deploy to Cloud Run | `workflow_dispatch` (`target` only, no `commit_sha`) | The actually-Cloud-Run-targeting workflow. Per service (backend, frontend): builds the image itself (no separate pre-built artifact), pushes SHA-tagged (`github.sha`, no `latest`), `gcloud run deploy --image=...@digest`, curls `/api/health`, rolls back via `update-traffic` on smoke-test failure. Backend and frontend run as **independent parallel jobs** — no `needs`, so a failed backend deploy doesn't stop frontend. No image-existence check (it builds inline), no digest-resolution-from-existing-tag step (digest comes straight from its own build output). |
| `infra-terraform.yml` | Infrastructure | `workflow_dispatch` (`action: plan\|apply`) | Already exactly matches what the task wants structurally — `fmt`→`init`→reconcile→`validate`→`plan`→(`apply` if selected), gated by the `prod` GitHub Environment's required-reviewer rule. **No `concurrency:` block currently set.** |
| `codex-review.yml` | Codex Review | `workflow_dispatch` only | Runs `openai/codex-action` with a fixed review prompt. Shows up as a manual Actions-menu item today — exactly what the task wants to eliminate. Provider (Codex/OpenAI) should be preserved, just retrigger via PR label. |

**Image names:** `australia-southeast1-docker.pkg.dev/wd-tools/price-insight/price-insight-backend`, `...-frontend` (both already match Cloud Run's expectations, no change needed).

**Cloud Run service names:** `backend`, `frontend` (also `order-worker`, but it's out of scope — task only names two application projects).

**Health-check paths:** confirmed both exist — `apps/backend/src/routes/health.ts` → `GET /api/health` returns `{status:"ok"}` (no DB check — won't catch a DB-connectivity regression); `apps/frontend/server/api/health.ts` → `GET /api/health` returns `{status:'ok'}`.

**WIF auth:** both build and deploy paths already use `workload_identity_provider: projects/920312412888/locations/global/workloadIdentityPools/github-actions/providers/github` + `service_account: price-insight-ci@wd-tools.iam.gserviceaccount.com`. `iam.tf` already grants this SA `roles/run.developer` scoped to the `backend`/`frontend` Cloud Run services specifically (not project-wide) — sufficient for `gcloud run deploy` and, I believe, `update-traffic` rollback (same role), but this hasn't been exercised in anger yet.

**Other findings worth flagging, not fixing without your say:**
- `apps/frontend/Dockerfile` still hardcodes `NUXT_GATEWAY_URL=http://gateway.price-insight.svc.cluster.local:4001` at build time — a leftover from the now-deleted gateway (PR3). This is application source, out of this task's allowed scope ("do not modify application source code unless required only for an existing health endpoint and approved separately") — flagging as a separate follow-up, not touching it here.
- No existing Actions/YAML linter (`actionlint`, `yamllint`) in the repo — per task instruction, I won't add one; validation will be manual review + a YAML-syntax parse, called out in section 8 below.

## 3. Affected Areas

- Frontend: No application code changes; CI only.
- Backend: No application code changes; CI only.
- Database: **Open question** — migrations currently only run via the GKE path being retired (see Risks).
- Queue/jobs: No.
- External APIs: No (Codex/OpenAI review provider preserved, not replaced).
- Tests: No test changes — this task has no app-level tests to update.
- Config/infra: Yes — five workflow files edited/replaced/removed; `infra-terraform.yml` gets a concurrency block but its Terraform logic is untouched, per task boundaries.

## 4. Risks

- **Migration gap — accepted, out of scope.** The task spec's Deploy requirements (section 5B) say nothing about running DB migrations, and the only workflow that currently runs them (`deploy.yml`'s GKE Job) is being replaced. Tao has confirmed (2026-06-18) migrations are explicitly out of scope for this task — after this change, nothing in CI runs migrations. Tracked as an open follow-up, not blocking this work.
- **Rollback permission unverified.** `roles/run.developer` should cover `gcloud run services update-traffic` for rollback, but this has never been exercised end-to-end (the existing `deploy-cloud-run.yml` rollback path is unconfirmed in practice). First real failed-deploy test will be the actual proof.
- ~~`:latest` tag in the new Build workflow's cache strategy~~ — **Decided 2026-06-18: keep `:latest` purely as a registry cache source** (`cache-from: type=registry,ref=...:latest`), same as today. It is never used for deployment — Deploy only ever resolves and deploys SHA-tagged digests.
- **Image-existence + digest-resolution adds a new gcloud call shape not used elsewhere in this repo** (`gcloud artifacts docker images describe ...:<sha> --format='value(image_summary.digest)'`) — low risk, but it's new surface area worth a deliberate test (edge case: SHA never built → this call fails cleanly, which is exactly the "fail before changing Cloud Run" behavior wanted).
- **`pull_request_target` is genuinely security-sensitive** (task acknowledges this) — it runs with base-repo secrets even for fork PRs. The new code-review workflow must check out the PR head ref read-only for the diff, never run PR-supplied code with write credentials, and use minimal `permissions:`. Getting this wrong is a real secret-exfiltration risk from a malicious fork PR, not a theoretical one.
- ~~Label removal after review~~ — **Decided 2026-06-18: no auto-removal.** The `ai-review` label is left in place after the review runs; re-running review on the same PR means manually removing and re-adding the label.

## 5. Recommended Approach

Summary:
- **`build.yml`** — strip the `call-deploy` job entirely (no more auto-deploy after build). Keep parallel backend/frontend jobs, SHA-tagged pushes (`:latest` retained only as the `cache-from`/`cache-to` registry source, never deployed), add `run-name` and a `concurrency: build-${{ inputs.ref }}` group, add a job summary with the resolved SHA and pushed digest.
- **`deploy.yml`** — replace contents entirely with a true Cloud-Run deploy workflow: `target` + optional `commit_sha` inputs, resolve `DEPLOY_SHA`, verify the SHA-tagged image exists via `gcloud artifacts docker images describe`, resolve to digest, deploy backend → health/smoke check → (stop here if failed, with rollback) → deploy frontend → health/smoke check. Single `concurrency: cloud-run-production` group, `cancel-in-progress: false`.
- **`deploy-cloud-run.yml`** — delete once `deploy.yml`'s new version is validated to cover the same ground (it's the superseded prototype; nothing in it isn't being replicated).
- **Migrations** — out of scope, per Tao (2026-06-18). The new `deploy.yml` will not include a migration step. Filed as an open follow-up for a future task.
- **`infra-terraform.yml`** — no logic changes; add `concurrency: { group: terraform-production, cancel-in-progress: false }`. Display name already correct.
- **`codex-review.yml`** — change trigger from `workflow_dispatch` to `pull_request_target: types: [labeled]`, gated on `github.event.label.name == 'ai-review'`, minimal `permissions: { contents: read, pull-requests: write }` (write needed to post the review comment; label is not auto-removed), checkout the PR head ref explicitly (not the default ambient ref `pull_request_target` gives you), keep the existing Codex prompt/provider unchanged. Re-running review on the same PR is a manual remove-and-re-add of the label.

Likely files:
- `.github/workflows/build.yml` (rewritten)
- `.github/workflows/deploy.yml` (rewritten)
- `.github/workflows/deploy-cloud-run.yml` (deleted, after replacement confirmed)
- `.github/workflows/infra-terraform.yml` (concurrency block added only)
- `.github/workflows/codex-review.yml` (trigger changed)

Why this approach:
- Matches the task's explicit target Actions menu (Build/Deploy/Infrastructure) and every named requirement (parallel build, SHA tags, digest deploy, backend-before-frontend with stop-on-fail, rollback, PR-label review) without inventing scope beyond it.
- Keeps Infrastructure's Terraform logic completely untouched, per boundaries.
- Surfaces the migration gap and the `pull_request_target` security posture explicitly rather than silently deciding either one.

Avoid:
- Touching any `.tf` file, Cloud Run service shape, IAM, secrets, or DNS.
- Deploying anything to production during this work.
- Adding a new third-party Action without flagging it first (the existing `docker/build-push-action`, `google-github-actions/auth`, `openai/codex-action` are all already in use — no new ones needed for this design).
- Deleting `deploy-cloud-run.yml` or the old `deploy.yml` content before the new one is validated.

## 6. Approval Needed

Tao approval is required before:
- Implementing (per CLAUDE.md, requires literal `APPROVED TO IMPLEMENT`)
- ~~How migrations should run going forward~~ — **Decided 2026-06-18: out of scope for this task.** No migration step will be added to the new `deploy.yml`. Migrations are not addressed here; tracked as an open follow-up for a future task.
- Deleting `deploy-cloud-run.yml` (only after the new `deploy.yml` is confirmed working)

## 7. Test Plan

Automated tests: None applicable — no application code under test.

Manual validation (matches task section 7 exactly):
1. Build all
2. Build backend only
3. Build frontend only
4. Deploy backend by explicit SHA
5. Deploy frontend by explicit SHA
6. Deploy all with empty SHA input (resolves to branch's latest)
7. Missing image failure (request a SHA never built — must fail before touching Cloud Run)
8. Failed smoke test and rollback
9. Add `ai-review` label on a test PR
10. Confirm Infrastructure remains unaffected (run `plan` only, no `apply`)

Edge cases (from task section 6, all need explicit coverage):
- One of two parallel builds fails while the other succeeds
- Backend image exists but frontend doesn't (and vice versa)
- Two users trigger Deploy simultaneously (concurrency group should queue, not run both)
- Selected branch's latest SHA hasn't been built yet
- Label added twice / unrelated label added to a PR
- PR from a fork with the `ai-review` label (the security-sensitive path)

Regression checks:
- `infra-terraform.yml` plan run is unaffected by these changes
- No workflow run pushes or deploys a `:latest`-tagged image

## 8. Validation Commands

```bash
# YAML syntax check (no linter installed; using a plain parse)
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/build.yml .github/workflows/deploy.yml .github/workflows/infra-terraform.yml .github/workflows/codex-review.yml

# Confirm no stray gateway/GKE/latest references remain in the new files
grep -n "latest\|kubectl\|gke" .github/workflows/build.yml .github/workflows/deploy.yml
```

Actual `workflow_dispatch` runs (build, deploy, rollback-failure) must be triggered by you — I won't run them unprompted since they touch live Cloud Run / Artifact Registry.

## 9. Next Implementation Prompt

```markdown
# Task: Simplify GitHub Actions workflows to Build/Deploy/Infrastructure

## Goal
Decouple build from deploy, replace the GKE-based deploy.yml with a true Cloud-Run
digest-deploy workflow, and gate code review behind a PR label instead of a manual
Actions-menu entry.

## Background
build.yml currently builds images and auto-deploys via workflow_call. deploy.yml is
GKE/kubectl-based and obsolete except for its DB migration step, which has no Cloud
Run equivalent yet. deploy-cloud-run.yml is the closer Cloud-Run prototype but couples
build+deploy and runs backend/frontend as independent parallel jobs.

## Scope
Implement only:
- Rewrite build.yml: parallel backend/frontend build, SHA-only tags, no auto-deploy,
  run-name, concurrency group, job summary
- Rewrite deploy.yml: target + optional commit_sha inputs, image-existence check,
  digest resolution, backend-then-frontend with stop-on-fail, rollback, concurrency group
- Add concurrency block to infra-terraform.yml only (no logic changes)
- Change codex-review.yml trigger to pull_request_target on the ai-review label

Migrations are explicitly out of scope — do not add a migration step anywhere in this task.

## Boundaries
Do not:
- touch any .tf file or Terraform-managed resources
- change Cloud Run service names, regions, or IAM
- change DNS/Cloudflare or secrets
- run an actual production deploy during implementation
- delete deploy-cloud-run.yml until the new deploy.yml is validated

## Expected Changes
- .github/workflows/build.yml (rewritten)
- .github/workflows/deploy.yml (rewritten)
- .github/workflows/codex-review.yml (trigger changed)
- .github/workflows/infra-terraform.yml (concurrency block only)
- .github/workflows/deploy-cloud-run.yml (deleted, after validation)

## Tests
Manual workflow_dispatch runs per the 10-item test plan in the approved plan doc.

## Definition of Done
Matches section 8 of plan-18062026-github-actions.md exactly.
```

## 10. Complexity

**Medium-Large.** Not technically deep (no app logic), but wide: five workflow files, a genuine security-sensitive trigger type (`pull_request_target`), a real unresolved migration-strategy gap, and a meaningful behavior change (decoupling build from deploy) that needs careful sequencing to avoid a window where Deploy can't find an image. The migration question alone could turn into its own small follow-up task depending on which option you pick.

## 11. Final Status

Implemented 2026-06-18 on `feature/cloud-run-migration`, not yet committed/pushed/validated live:

- `build.yml` rewritten — parallel backend/frontend jobs, full-commit-SHA tags, `:latest` kept only as `cache-from`/`cache-to` registry source, `run-name`, `concurrency: build-${{ inputs.ref }}`, per-job summary with SHA + digest. `call-deploy` job removed entirely.
- `deploy.yml` rewritten — `resolve` job validates `commit_sha` (via `git rev-parse --verify`, supports full or short SHA) and verifies+resolves digests for every image the selected `target` needs *before* touching Cloud Run (closes the "fail before changing Cloud Run if any image is missing" requirement for `target: all`). `deploy-backend` then `deploy-frontend` (frontend's `if:` explicitly handles the case where target=`frontend` and `deploy-backend` was skipped, vs. target=`all` where it must have succeeded). Both deploy jobs: record previous revision, deploy by digest, curl `/api/health`, roll back via `update-traffic` + fail the job on health-check failure. `concurrency: cloud-run-production`, `cancel-in-progress: false`.
- `infra-terraform.yml` — added `concurrency: terraform-production` block only, zero logic changes.
- `codex-review.yml` — rewritten to trigger on `pull_request_target: types: [labeled]`, gated on label `ai-review`. **Deviated from the plan's sketch after checking `openai/codex-action`'s actual docs** (it does not auto-post PR comments): checks out `refs/pull/<number>/merge` with `persist-credentials: false`, runs with `sandbox: read-only`, captures the `final-message` output, posts it via `gh pr comment` (not `actions/github-script`, to avoid introducing a new third-party Action). The action has its own built-in write-access check on whoever added the label, so no `allow-users` config was needed for the safe default.
- `deploy-cloud-run.yml` — left in place, not deleted, per the plan's boundary (delete only after the new `deploy.yml` is validated live).

Validation done: YAML syntax check (all 4 files parse clean), grep confirms no `kubectl`/`gke` references and the only `latest` hits in `build.yml` are the intended cache-only usage. `git diff --stat`: 4 files changed, 351 insertions, 209 deletions.

Not done yet, needs Tao to trigger manually (touches live Cloud Run/Artifact Registry): the 10-item manual test plan in section 7, including the rollback/failed-health-check path and the fork-PR `ai-review` label test.
