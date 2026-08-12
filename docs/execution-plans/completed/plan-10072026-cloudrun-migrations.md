# Plan: Apply DB migrations on Cloud Run deploy (fix `Unknown column 'cost'`)

## 1. Summary

Production backend (`backend-00022`) runs code that writes `products.cost`, but the
prod DB has no `cost` column → every product sync/import throws
`Unknown column 'cost' in 'field list'`. The migration exists and is committed
(`drizzle/0006_dry_shooting_star.sql`), but **nothing applies migrations in Cloud Run** —
`CMD` is `node dist/server.js`, and `runMigrations()` is dead code invoked by nothing.
This is the third occurrence of the same class of bug (`handle`, now `cost`).

Recommended direction:
- **Immediate:** apply the committed migration to prod via a Cloud Run Job running
  `node dist/db/run-migrations.js` on the *current* backend image.
- **Durable:** add a dedicated `backend-migrate` Cloud Run Job (Terraform) and a repo
  deploy script that runs migrate-then-deploy, so manual `gcloud run deploy` always
  applies pending migrations first. Document the runbook in CLAUDE.md.

## 2. Current Implementation

Deploys are **manual** `gcloud run deploy backend --image=...@sha256:<digest>`. All
services and the existing job boot on `var.bootstrap_image`; `lifecycle.ignore_changes`
on `containers[0].image` keeps Terraform from reverting the manually-deployed image.

Migration mechanics:
- `drizzle/0006_dry_shooting_star.sql` = `ALTER TABLE products ADD cost decimal(12,4);`
  (committed in `00bc0c5f`; folder is `apps/backend/drizzle`, per `drizzle.config.ts out`).
- `src/db/run-migrations.ts` exports `runMigrations(folder="./drizzle")`, has an
  `isMain` guard that runs when invoked as `node dist/db/run-migrations.js`, and a
  `bootstrapMigrationTracking` self-heal fallback for `__drizzle_migrations` drift
  (`ER_TABLE_EXISTS_ERROR` / `ER_DUP_FIELDNAME`).
- **Nothing calls `runMigrations()`** — no npm script, no `server.ts` startup hook,
  not in the Dockerfile.
- The image *does* include what a migrate job needs: Dockerfile copies
  `apps/backend/drizzle` and sets `WORKDIR /app/apps/backend`, so `./drizzle` and
  `dist/db/run-migrations.js` are both present.

Existing reusable job: `google_cloud_run_v2_job.backend_script_runner`
(`infra/terraform/cloud-run-jobs.tf`) reuses the backend image / SA / Cloud SQL /
secret env and is explicitly for one-off `node dist/...` scripts. **Its image is
`var.bootstrap_image` with `ignore_changes` on image**, so unless it was manually
`gcloud run jobs deploy`-ed to a recent image, it is stale and predates
`dist/db/run-migrations.js`.

Main files:
- `apps/backend/src/db/run-migrations.ts`
- `apps/backend/drizzle/0006_dry_shooting_star.sql` + `drizzle/meta/_journal.json`
- `apps/backend/Dockerfile`
- `infra/terraform/cloud-run-jobs.tf`
- `infra/terraform/cloud-run.tf` (deploy/image model)
- `CLAUDE.md` (migration policy)

## 3. Affected Areas

- Frontend: no.
- Backend: no application-code change required for the fix; optional deploy-script addition.
- Database: yes — apply additive nullable `cost` column to prod (and any other pending migrations).
- Queue/jobs: yes — new `backend-migrate` Cloud Run Job (durable fix).
- External APIs: no.
- Tests: minimal — no unit-test surface for infra; optional smoke check of `runMigrations` locally.
- Config/infra: yes — Terraform job resource + deploy runbook + CLAUDE.md docs.

## 4. Risks

- Stale job image: `backend-script-runner` may not contain `dist/db/run-migrations.js` →
  execution fails with "module not found". Mitigate by deploying the job to the current
  backend image digest before executing.
- Schema-tracking drift: prior `db:push`/manual fixes may leave `__drizzle_migrations`
  behind the actual schema; migrate could hit `ER_DUP_FIELDNAME`. Mitigated by the
  built-in `bootstrapMigrationTracking` fallback, but must verify it triggers.
- Ordering on future deploys: if service is deployed before migrate runs, new code hits
  missing columns again (the current bug). Durable fix enforces migrate-before-deploy.
- Concurrency: running migrations at container startup (rejected approach) would race
  across autoscaled instances and could take the service down on a bad migration.
- Long/locking migration on a large `products` table could stall the deploy; `cost`
  ALTER is fast/additive, but the runbook must not assume all future migrations are.
- Human-skip risk: a runbook alone can be forgotten (root cause here). A wrapper deploy
  script reduces but doesn't eliminate this.

## 4b. Rollback Plan

- `cost` column applied wrongly: detect via `SHOW COLUMNS FROM products LIKE 'cost'`;
  revert with `ALTER TABLE products DROP COLUMN cost;`. Data-safe: yes (additive nullable).
- Migrate job fails mid-run: detect via job execution logs / non-zero exit; Drizzle applies
  one file per statement-block and records per-file — re-run after fixing. Data-safe: yes
  for additive migrations; destructive migrations would need per-migration review.
- `__drizzle_migrations` mis-seeded by bootstrap fallback: detect by comparing row count
  to `_journal.json` entries; recover by correcting the tracking table (no schema change).
  Data-safe: yes.
- New `backend-migrate` Terraform resource misbehaves: `terraform destroy -target` the job
  or revert the `.tf` change; jobs don't serve traffic so no user impact. Data-safe: yes.

## 5. Recommended Approach

### Phase 1 — Immediate (unblock prod)
Run the committed migration on the **current** backend image via a Cloud Run Job. Two
safe variants:

- Preferred: point the existing `backend-script-runner` job at the current backend image
  digest, then execute it against `run-migrations.js`:
  ```bash
  gcloud run jobs deploy backend-script-runner \
    --region=australia-southeast1 --project=wd-tools \
    --image=<current-backend-image@sha256:...> \
    --command=node --args=dist/db/run-migrations.js
  gcloud run jobs execute backend-script-runner \
    --region=australia-southeast1 --project=wd-tools --wait
  ```
  (Get the current image via `gcloud run services describe backend --region=australia-southeast1 --format='value(spec.template.spec.containers[0].image)'`.)
- If the job is already on a recent image, skip the deploy step and just `execute` with
  `--args=dist/db/run-migrations.js`.

Verify: job execution succeeds, logs show migration applied (or bootstrap fallback), and a
product sync no longer errors.

### Phase 2 — Durable (stop recurrence)
1. Add `google_cloud_run_v2_job.backend_migrate` in `infra/terraform/cloud-run-jobs.tf`,
   mirroring `backend_script_runner` wiring (SA, Cloud SQL volume, secret env,
   `max_retries = 0`) with `command = ["node"]`, `args = ["dist/db/run-migrations.js"]`,
   and `ignore_changes` on `image` (CI/manual deploy sets the real image).
2. Add a repo deploy script (e.g. `infra/deploy-backend.sh`) encoding the correct order:
   build+push image → `gcloud run jobs deploy backend-migrate --image=<digest>` →
   `gcloud run jobs execute backend-migrate --wait` → `gcloud run deploy backend --image=<digest>`.
   Fail the script if the migrate execution fails (don't deploy the service on migrate failure).
3. Document the deploy runbook + policy in `CLAUDE.md` under Database migrations.

Likely files:
- `infra/terraform/cloud-run-jobs.tf` (new job resource)
- `infra/deploy-backend.sh` (new)
- `CLAUDE.md` (runbook + policy)

Why this approach:
- Reuses the proven script-runner wiring (SA, Cloud SQL, secrets) — no new IAM surface.
- Keeps migrations out of the request-serving container → no autoscaling race, no boot-time
  failure taking down the service.
- Fits the existing manual `gcloud run deploy` model; the script makes the safe order the
  default path.
- `runMigrations()` already self-heals tracking drift, so it's robust to the current
  desynced prod state.

Avoid:
- Running migrations in `server.ts` at startup (concurrency race, service-down risk).
- `db:push` against prod (CLAUDE.md forbids; desyncs `__drizzle_migrations`).
- Relying on a docs-only runbook with no script (the exact failure mode that caused this).

## 6. Approval Needed

Tao approval is required before:
- Executing the migration job against the **prod** database (Phase 1) — shared-env schema change.
- Deploying/updating the `backend-script-runner` job image via `gcloud` (Phase 1) — GCP resource mutation.
- Adding the `backend-migrate` Terraform job + `terraform apply` (Phase 2) — infra change.
- Committing the deploy script + CLAUDE.md changes (Phase 2) — repo/process change.

## 7. Test Plan

Automated tests:
- None strictly required (infra + one-off script). Optionally add a local smoke test that
  runs `runMigrations()` against a throwaway MySQL and asserts `products.cost` exists.

Edge case tests / checks:
- Fresh DB (no `__drizzle_migrations`) → bootstrap seeds tracking, migrate applies cleanly.
- Drifted DB (schema ahead of tracking) → `ER_DUP_FIELDNAME` path triggers bootstrap+retry.
- Re-run idempotency → second execution is a no-op (all files already applied).
- Missing `dist/db/run-migrations.js` in job image → fails fast (validates image freshness).
- Migrate-fails-before-deploy → deploy script aborts, service not updated.

Manual validation:
- Post-Phase-1: `SHOW COLUMNS FROM products LIKE 'cost';` returns the column.
- Trigger a product sync/import and confirm no `Unknown column` error in logs.
- Confirm `__drizzle_migrations` row count matches `_journal.json` entries.

Regression checks:
- Product sync/import (`POST /api/products/sync`), AI report generation (reads `cost`/margin),
  existing order pipeline unaffected.

## 8. Validation Commands

```bash
# Confirm the migration file + current schema alignment (local, read-only)
grep -n "cost" apps/backend/src/db/schema.ts                 # expect: cost decimal column
cat apps/backend/drizzle/0006_dry_shooting_star.sql          # expect: ALTER TABLE products ADD cost

# Current prod backend image (read-only)
gcloud run services describe backend --region=australia-southeast1 \
  --project=wd-tools --format='value(spec.template.spec.containers[0].image)'  # expect: real image digest

# Post-migration verification (after approved Phase 1)
# via db:studio or a read query: SHOW COLUMNS FROM products LIKE 'cost';        # expect: 1 row

# Terraform (Phase 2, after approval)
cd infra/terraform && terraform plan   # expect: only adds google_cloud_run_v2_job.backend_migrate
```

Do not run migration execution or `terraform apply` until Tao approves.

## 9. Next Implementation Prompt

```markdown
# Task: Apply cost migration + wire migrations into Cloud Run deploy

## Goal
Unblock prod (`Unknown column 'cost'`) and ensure every future manual deploy applies
pending Drizzle migrations before serving new code.

## Background
`drizzle/0006` adds `products.cost` but nothing applies migrations in Cloud Run.
Deploys are manual `gcloud run deploy`. A reusable `backend-script-runner` job exists.

## Scope
Implement only:
- Phase 1: run `dist/db/run-migrations.js` against prod via a Cloud Run Job on the current
  backend image (Tao runs the gcloud commands).
- Phase 2: add `backend-migrate` Terraform job, add `infra/deploy-backend.sh` (build → push
  → migrate job → deploy service, abort on migrate failure), document runbook in CLAUDE.md.

## Boundaries
Do not:
- run migrations in server.ts at startup
- run db:push against any shared env
- change unrelated Terraform/services
- push/apply/deploy without Tao approval

## Expected Changes
- `infra/terraform/cloud-run-jobs.tf`
- `infra/deploy-backend.sh` (new)
- `CLAUDE.md`

## Tests
See section 7. Verify `SHOW COLUMNS FROM products LIKE 'cost'` and a clean product sync.

## Definition of Done
- Prod product sync no longer errors on `cost`.
- `terraform plan` shows only the new migrate job.
- Deploy script enforces migrate-before-deploy and aborts on migrate failure.
- CLAUDE.md documents the deploy runbook.
```

## 10. Final Status

Blocked on approval:
- Execute migration job against prod DB — shared-environment schema change (CLAUDE.md gate).
- Deploy/update `backend-script-runner` job image via gcloud — GCP resource mutation (memory: Tao runs gcloud).
- Add `backend-migrate` Terraform job + apply — infra change via Terraform only.
- Commit deploy script + CLAUDE.md — repo/process change.

Waiting for Tao approval.
```
