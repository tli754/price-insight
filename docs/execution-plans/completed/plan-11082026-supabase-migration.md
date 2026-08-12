# Plan: Migrate Database from MySQL (Cloud SQL) to Supabase Postgres

## 1. Summary

The repo has already had prep work done on `feature/supabase-migration` (currently staged, uncommitted): a hand-converted Postgres schema (`docs/data/price_insight_supabase_schema.sql`), a full data dump converted to Postgres INSERT syntax (`docs/data/price_insight_supabase_data.sql`, 38.6k lines / ~19.7k rows across 8 tables), and a row-count + FK-orphan validation script. That covers the *data* side. The *application* side — Drizzle schema/dialect, the DB driver, dialect-specific raw SQL, `$returningId()` calls, env vars, and all Terraform/Cloud Run/Secret Manager wiring — has not been touched yet. This plan covers that remaining work and the cutover sequencing.

Recommended direction: port the Drizzle layer to `pg-core`/postgres-js pointed at Supabase's Postgres, using the already-authored `price_insight_supabase_schema.sql` as the source of truth for the new baseline Drizzle migration (rather than trying to mechanically translate the 7 existing MySQL migration files), fix the handful of MySQL-dialect-specific call sites, switch Cloud Run to a plain `DATABASE_URL` connection string (dropping the Cloud SQL Unix-socket/`cloudsql.client` machinery entirely), and cut over via a frozen-write export → import → validate → repoint sequence.

## 2. Current Implementation

**Data layer:** MySQL 8 on Cloud SQL, Drizzle ORM (`drizzle-orm/mysql2`), 11 tables defined in `apps/backend/src/db/schema.ts` (products, product_images, competitor, competitor_products, price_history, price_insights, customers, customer_addresses, orders, order_items, product_ai_reports). `apps/backend/src/db/index.ts` opens a `mysql2` pool — Unix socket (`/cloudsql/...`) in production, TCP+TLS locally — and wraps it with `drizzle(pool, { schema, mode: "default" })`.

**Migrations:** 7 files in `apps/backend/drizzle/` (`0000_initial_schema.sql` … `0006_dry_shooting_star.sql`) tracked via Drizzle's `__drizzle_migrations` table. `apps/backend/src/db/run-migrations.ts` runs them via `drizzle-orm/mysql2/migrator`, plus a `bootstrapMigrationTracking` self-heal path that writes directly to `__drizzle_migrations` using MySQL syntax (`INSERT IGNORE`, backtick identifiers).

**Deploy-time migration:** Per CLAUDE.md, `backend-migrate` Cloud Run Job (`infra/terraform/cloud-run-jobs.tf`) runs `dist/db/run-migrations.js` against Cloud SQL *before* `gcloud run deploy` — both in CI (`.github/workflows/deploy.yml`) and `infra/deploy-backend.sh`.

**Connectivity:** Two Cloud Run services (`backend`, `order-worker`) and two Jobs (`backend-migrate`, `backend-script-runner`) all mount a `cloudsql` volume (`cloud_sql_instance { instances = [var.cloud_sql_connection_name] }`) and connect over the Unix socket at `/cloudsql`. The Cloud SQL instance itself is **not** Terraform-managed (created out-of-band, referenced only by `var.cloud_sql_connection_name`, same as the Artifact Registry repo). `order_worker_runtime` SA is granted `roles/cloudsql.client` in Terraform (`service-accounts.tf:30-34`); `backend_runtime` is a pre-existing GKE-era SA already holding that role out-of-band.

**Secrets:** `secrets.tf` defines `backend-mysql-host/-user/-password/-database` (wired into `cloud-run.tf` and both Jobs) plus an **already-scaffolded but currently unused** `backend-database-url` secret.

**Env vars:** `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` are validated via Zod in three separate places that must stay in sync: `apps/backend/src/config/env.ts`, `apps/backend/src/order-worker-server.ts` (its own narrower schema), and `apps/backend/src/__tests__/helpers/build-app.ts` (`fakeEnv`).

**MySQL-dialect-specific code** (beyond the driver/dialect swap):
- `$returningId()` (MySQL-only Drizzle sugar for insert-id retrieval) — 6 call sites across `product-repository.ts`, `competitor-repository.ts` (×3), `order-repository.ts` (×3), `ai-report-repository.ts`.
- `.onUpdateNow()` on `updated_at` columns (products, customers, orders) — no MySQL equivalent in Postgres; repositories never set `updatedAt` manually on `.update()` calls, so they fully depend on this. The already-authored `price_insight_supabase_schema.sql` replaces it with a `set_updated_at()` trigger — confirmed as the right approach, no repository code changes needed for this specific piece.
- Raw `sql\`...\`` fragments using MySQL functions: `NOW() - INTERVAL 90 DAY` (`product-repository.ts:212`), `DATE_SUB(NOW(), INTERVAL 12 MONTH)` and `DATE_FORMAT(..., '%Y-%m')` (`order-repository.ts:589,592-593`).

**Tests:** All backend tests (`apps/backend/src/__tests__/**`) fully mock the DB layer (`vi.fn()` repository stubs in `build-app.ts`) — no test opens a real MySQL connection, and CI has no MySQL service container. This significantly de-risks the migration: the test suite validates route/service wiring, not SQL dialect.

Main files:
- `apps/backend/src/db/schema.ts`, `apps/backend/src/db/index.ts`, `apps/backend/src/db/run-migrations.ts`
- `apps/backend/drizzle.config.ts`, `apps/backend/drizzle/*.sql`, `apps/backend/drizzle/meta/*`
- `apps/backend/src/config/env.ts`, `apps/backend/src/order-worker-server.ts`, `apps/backend/src/__tests__/helpers/build-app.ts`
- `apps/backend/src/services/product-repository.ts`, `order-repository.ts`, `competitor-repository.ts`, `ai-report-repository.ts`
- `apps/backend/package.json`, `apps/backend/.env.example`
- `infra/terraform/secrets.tf`, `cloud-run.tf`, `cloud-run-jobs.tf`, `service-accounts.tf`, `variables.tf`
- `.github/workflows/infra-terraform.yml` (secret-import allowlist references `backend-mysql-host`)
- `docs/data/price_insight_supabase_schema.sql`, `_data.sql`, `_validate_import.sql` (already staged)

## 3. Affected Areas

- Frontend: No — frontend talks only to the backend API, never the DB directly.
- Backend: Yes — driver, dialect, schema, 4 repositories, 3 env-schema locations, package.json.
- Database: Yes — this is the core of the task; full MySQL → Postgres (Supabase) migration.
- Queue/jobs: Indirect — `order-worker` and `backend-migrate`/`backend-script-runner` Jobs share the same `createDatabase()` and env schema, so they move in lockstep with the backend.
- External APIs: No — Shopify/DataForSEO/OpenAI integrations are DB-agnostic.
- Tests: Yes, but low-risk — no test currently opens a real DB connection; risk is confined to whatever new unit coverage we add for the dialect-specific SQL rewrites.
- Config/infra: Yes — significant Terraform surface (Cloud SQL volume mounts removed from 4 resources, `cloudsql.client` IAM grant removed, `MYSQL_*` secrets/env replaced by a single `DATABASE_URL`).

## 4. Risks

- **Dual-write / data-loss window during cutover.** `docs/data/price_insight_supabase_data.sql` is a point-in-time export (filename implies 2026-08-11 18:33:20). Any Shopify order-sync writes to MySQL after that export and before traffic repoints to Supabase are lost unless re-exported.
- **`$returningId()` has no Postgres equivalent** — a mechanical rename to `.returning({ id: table.id })` is needed at all 6 call sites; a missed one fails silently differently in Postgres (throws, doesn't return `undefined`), so this needs deliberate per-call-site review, not a blind find/replace.
- **Raw MySQL SQL fragments** (`DATE_FORMAT`, `DATE_SUB`, `INTERVAL 90 DAY` syntax) will fail outright against Postgres (different function names/interval syntax) — these are in the sales-history and "products with no recent orders" logic (`order-repository.ts`, `product-repository.ts`), which is used by the AI report pipeline.
- **Connection model mismatch.** Cloud SQL uses a private Unix-socket proxy (`/cloudsql`, no network egress config needed); Supabase is reached over the public internet with TLS. Cloud Run's per-instance concurrency means many concurrent Postgres connections unless Supabase's transaction pooler (port 6543, pgbouncer) is used — and pgbouncer transaction mode requires `{ prepare: false }` in postgres.js/node-postgres or prepared-statement errors surface under load. This is easy to get right in dev (low concurrency) and wrong in production.
- **Migration-history discontinuity.** `price_insight_supabase_schema.sql` explicitly excludes MySQL's `__drizzle_migrations` history ("Application schema only"). This means `db:generate` must produce a *fresh* Postgres baseline migration matching that already-applied schema, and `run-migrations.ts`'s MySQL-specific bootstrap-tracking logic (`INSERT IGNORE`, backticks) needs a Postgres rewrite or removal — otherwise every future `db:generate` diffs against nothing and Drizzle may try to re-create tables that already exist.
- **Terraform/Secret Manager desync.** `secrets.tf`'s `backend-database-url` secret already exists but is unwired (placeholder only) — going live means populating it manually via `gcloud secrets versions add` (per the existing comment in `secrets.tf`) and rewiring 4+ Terraform resources (`cloud-run.tf` ×2 services, `cloud-run-jobs.tf` ×2 jobs) to consume it instead of the 4 discrete MySQL secrets, plus dropping `cloud_sql_instance` volumes/mounts and the `roles/cloudsql.client` IAM grant.
- **Rollback under pressure.** Once Cloud Run env vars point at Supabase and Shopify order-sync starts writing there, rolling back to MySQL means either replaying writes forward or accepting data loss for that window — this is the single highest-stakes moment in the whole migration and needs an explicit freeze/verify/cutover runbook, not an ad hoc redeploy.
- **`apps/backend/.env.example` / local dev drift.** Every engineer's local `.env` currently has `MYSQL_*` vars; this is a one-time breaking change to local dev setup, low risk but needs a callout so Tao's local `.env` isn't silently broken.

## 4b. Rollback Plan

- **Cutover produces wrong/missing data (detected via `price_insight_validate_import.sql` row-count/orphan checks failing):** don't repoint Cloud Run yet — Supabase is a new project, so failure here is caught *before* traffic moves. Data-safe: yes, nothing has been decommissioned.
- **Post-cutover: application errors against Supabase (bad query, missing `$returningId` fix, etc.):** revert the 4 `env` blocks in `cloud-run.tf`/`cloud-run-jobs.tf` (via `terraform apply` of the previous MYSQL_* wiring) and redeploy the previous backend image — MySQL/Cloud SQL is left untouched and still has all data up to the freeze point, so this is a same-day revert. Data-safe: yes, *provided the MySQL instance has not been deleted yet* (see below) and *provided no new orders were only written to Supabase* — any writes made to Supabase during the rollback window must be manually replayed into MySQL or accepted as lost.
- **Decommissioning the old Cloud SQL instance:** must not happen until Supabase has run in production for an agreed verification period (Tao to set, e.g. 1–2 weeks) with no rollback needed. This is a manual, out-of-band step (the instance isn't Terraform-managed) — explicitly gate it behind Tao's sign-off, not automatic.
- **Migration job fails mid-deploy (`backend-migrate` Job):** per CLAUDE.md's existing guarantee, both CI and `deploy-backend.sh` migrate-before-deploy, so a failed migration blocks the deploy and the previously-running revision keeps serving — no user-facing rollback needed, just fix-forward on the migration.

## 5. Recommended Approach

Summary:
- Treat `docs/data/price_insight_supabase_schema.sql` as the new Postgres baseline (it's already been hand-verified against the live MySQL export) rather than mechanically porting the 7 MySQL migration files. Generate a single fresh `0000_*.sql` Drizzle migration from the ported `schema.ts` and reconcile it against what's already applied on Supabase (Drizzle supports marking a migration as already-applied).
- Port `schema.ts` table-by-table to `drizzle-orm/pg-core`: `mysqlTable` → `pgTable`, `int().autoincrement()` → `integer().generatedByDefaultAsIdentity()`, `json` → `jsonb` (matches the exported schema), drop `.onUpdateNow()` (rely on the SQL trigger already defined in `price_insight_supabase_schema.sql`), drop the `unsigned` option on `bigint` (no Postgres equivalent, harmless to drop).
- Swap `mysql2` → `postgres` (postgres.js) in `db/index.ts`, using Supabase's **transaction pooler** connection string (port 6543) with `{ prepare: false }`, sourced from a single `DATABASE_URL` (reusing the already-scaffolded `backend-database-url` secret) rather than 4 discrete `MYSQL_*` vars.
- Fix the 6 `$returningId()` call sites → `.returning({ id: table.id })`, and rewrite the 3 raw-SQL date fragments to Postgres syntax (`NOW() - INTERVAL '90 days'`, `NOW() - INTERVAL '12 months'`, `TO_CHAR(col, 'YYYY-MM')`).
- Rewrite `run-migrations.ts`'s bootstrap-tracking helper for Postgres (`ON CONFLICT DO NOTHING` instead of `INSERT IGNORE`, no backticks) — or drop it entirely if the fresh baseline means there's no pre-existing-schema-without-tracking scenario to self-heal from.
- Collapse `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` → `DATABASE_URL` in all three env-schema locations (`config/env.ts`, `order-worker-server.ts`, `build-app.ts` `fakeEnv`) and `.env.example`.
- Terraform: replace the 4 `backend-mysql-*` secrets with `backend-database-url` in `cloud-run.tf` (both services) and `cloud-run-jobs.tf` (both jobs); remove the `cloudsql` volume/volume_mounts and `MYSQL_PORT` env from all 4 resources; remove `order_worker_cloudsql_client` IAM grant; update `.github/workflows/infra-terraform.yml`'s secret-import list. Leave `var.cloud_sql_connection_name` in `variables.tf` unset/unused rather than deleting it outright until the old instance is fully decommissioned (avoids a Terraform var-required error if anything still references it).
- Cutover sequencing: freeze writes to MySQL (pause order-sync, e.g. via the existing Cloud Scheduler trigger) → re-run the export (`docs/data/*.sql` regenerated from a fresh Cloud SQL dump if the current one is stale by cutover time) → import into Supabase → run `price_insight_validate_import.sql`, all rows/orphans must match → flip Cloud Run env vars via Terraform apply → smoke-test → resume writes.

Likely files: (see section 2's "Main files" list — unchanged)

Why this approach is safe:
- Data conversion is already done and independently validated (row counts + FK orphan checks) — this plan doesn't touch that part, just consumes it.
- No test currently depends on a real MySQL connection, so the application-layer port can be validated by the existing mocked test suite plus targeted manual smoke tests against Supabase, without needing a new test-infra investment (e.g. testcontainers).
- Migrate-before-deploy is already enforced at the infra level (CLAUDE.md/deploy.yml) — a broken migration blocks deploy rather than partially rolling out.
- The old Cloud SQL instance is untouched until Tao explicitly signs off on a decommission window, so the entire cutover is reversible short of that step.

Avoid:
- Do not try to mechanically translate the 7 existing MySQL `drizzle/*.sql` migration files to Postgres syntax one-by-one — higher effort and risk than generating one fresh baseline from the already-authored, already-validated target schema.
- Do not run `db:push` against Supabase (CLAUDE.md rule — applies to any shared environment, including a new Supabase project once it's the system of record).
- Do not delete/decommission the MySQL Cloud SQL instance as part of this change — that's a separate, later, explicitly-approved step.
- Do not silently keep both `MYSQL_*` vars and `DATABASE_URL` "just in case" — pick one connection model to avoid the exact kind of Terraform/schema desync CLAUDE.md's "cost incident" already warns about.

Approval gates (see section 6).

Expected test impact: `apps/backend/src/__tests__/*.test.ts` — mocked, should pass unchanged; may need to add/adjust unit coverage around the rewritten date-range SQL fragments (sales history, "no recent orders" filter) and the `.returning()` insert-id calls, since those are the parts of the migration Drizzle's type system won't catch.

Expected validation commands: see section 8.

## 6. Approval Needed

Tao approval is required before:

- **Database schema changes** — porting `schema.ts` to `pg-core` and generating/applying a new Postgres migration baseline against Supabase.
- **Infrastructure/deployment changes** — all `infra/terraform/*.tf` edits (secrets, Cloud Run env/volumes, IAM grants) and any `terraform apply`.
- **Secrets** — populating `backend-database-url` (and any new Supabase-specific secrets) with real values via `gcloud secrets versions add`.
- **Any production-impacting change** — the actual cutover (freezing MySQL writes, importing into Supabase, repointing Cloud Run traffic) is a production event and needs an explicit go/no-go from Tao, plus agreement on the decommission window for the old Cloud SQL instance.
- **Scope/phasing confirmation** — whether to implement this as one PR or split app-layer-port vs. infra-cutover into two.

## 7. Test Plan

Automated tests:
- `pnpm --filter @price-insight/backend test` — full existing mocked suite must still pass unchanged (no DB-shape assumptions leak into route/service tests).

Edge case tests (new, targeted at the dialect-specific rewrites):
- `.returning({ id })` on insert returns the correct new-row id for products, customers, orders, competitor, product_ai_reports (currently exercised implicitly via repository tests with mocks — needs either a real-Postgres integration check or careful manual verification post-port, since the mock layer won't catch a `$returningId()` → `.returning()` mistake).
- Sales-history date-range query (`order-repository.ts`) against a fixture spanning a month boundary — verifies `TO_CHAR(..., 'YYYY-MM')` grouping matches the old `DATE_FORMAT` output shape the AI report pipeline expects.
- "Products with no orders in last 90 days" query (`product-repository.ts`) — boundary case at exactly 90 days.
- Empty/duplicate import: re-running `price_insight_supabase_data.sql` against a non-empty Supabase DB should fail cleanly on the unique constraints (not silently duplicate) — confirms the import script is not idempotent-by-accident.
- Connection failure / pooler exhaustion: verify behavior when Supabase's transaction pooler connection limit is hit under concurrent Cloud Run instances (this is a new failure mode that didn't exist with Cloud SQL's proxy).
- Migration idempotency: running `run-migrations.js` twice against an already-migrated Supabase DB should be a no-op, not an error.

Manual validation:
- Run `price_insight_validate_import.sql` against Supabase after import — all `actual_rows` must equal `expected_rows`, all orphan checks must be 0.
- Full manual smoke pass through the app against a Supabase-backed local/staging backend: product list, competitor discovery, AI report generation (exercises the rewritten sales-history SQL), order sync.

Regression checks:
- AI report generation end-to-end (heaviest consumer of the rewritten date-range SQL).
- Order webhook → `upsertMappedOrder` path (heaviest consumer of `.returning()` id calls).
- `backend-migrate` Job runs clean on a fresh Supabase DB with no manual intervention.

## 8. Validation Commands

Suggested commands:

```bash
pnpm --filter @price-insight/backend test                        # expect: all pass, no DB-shape failures
pnpm --filter @price-insight/backend build                        # expect: tsc compiles clean (schema.ts pg-core types)
pnpm --filter @price-insight/backend db:generate                  # expect: one new baseline migration, reviewed by hand before commit
psql "$SUPABASE_DATABASE_URL" -f docs/data/price_insight_supabase_schema.sql   # expect: schema applies clean on empty DB
psql "$SUPABASE_DATABASE_URL" -f docs/data/price_insight_supabase_data.sql     # expect: import completes, no constraint errors
psql "$SUPABASE_DATABASE_URL" -f docs/data/price_insight_validate_import.sql  # expect: every actual_rows == expected_rows, every orphan_count == 0
terraform -chdir=infra/terraform plan                              # expect: reviewed by Tao before apply — should show secret/volume/IAM changes only, no unrelated drift
```

Do not run `terraform apply`, `gcloud secrets versions add`, or any command that touches Supabase/Cloud SQL production data without Tao's explicit go-ahead at each gated step.

## 9. Next Implementation Prompt

```markdown
# Task: Port Drizzle/backend to Supabase Postgres (app layer only, no cutover)

## Goal

Port the backend's Drizzle schema, DB driver, and dialect-specific SQL from MySQL
to Postgres so it can target Supabase, WITHOUT touching Terraform/infra or
performing the production cutover — those are a separate, later approval.

## Background

docs/data/price_insight_supabase_schema.sql and _data.sql are already staged
and validated (row counts + FK orphan checks). This task ports schema.ts,
db/index.ts, run-migrations.ts, the 4 repositories' $returningId()/raw-SQL
call sites, and the 3 env-schema locations to match.

## Scope

Implement only:

- Port apps/backend/src/db/schema.ts from mysqlTable to pgTable (match
  price_insight_supabase_schema.sql column-for-column: identity PKs, jsonb,
  drop .onUpdateNow()).
- Swap apps/backend/src/db/index.ts from mysql2 to postgres (postgres.js),
  single DATABASE_URL, transaction-pooler-safe ({ prepare: false }).
- Update apps/backend/drizzle.config.ts dialect to "postgresql".
- Generate a fresh baseline migration via db:generate; review by hand against
  price_insight_supabase_schema.sql before committing.
- Rewrite apps/backend/src/db/run-migrations.ts's bootstrap-tracking helper
  for Postgres syntax (or remove if no longer needed with a fresh baseline).
- Fix the 6 $returningId() call sites (product-repository.ts,
  competitor-repository.ts ×3, order-repository.ts ×3, ai-report-repository.ts)
  to .returning({ id: table.id }).
- Rewrite the 3 MySQL-dialect raw sql`` fragments (product-repository.ts:212,
  order-repository.ts:589,592-593) to Postgres syntax.
- Collapse MYSQL_HOST/PORT/USER/PASSWORD/DATABASE to DATABASE_URL in
  apps/backend/src/config/env.ts, order-worker-server.ts, and
  __tests__/helpers/build-app.ts fakeEnv.
- Update apps/backend/package.json (drop mysql2, add postgres) and
  apps/backend/.env.example.

## Boundaries

Do not:
- Touch any infra/terraform/*.tf file.
- Run any migration or import against a real Supabase or Cloud SQL database.
- Perform or schedule the production cutover.
- Change unrelated files.

## Expected Changes

Likely files: see section 2's "Main files" (backend-only subset).

## Tests

See section 7 for full test requirements and edge cases.

Run:

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
```

## Definition of Done

* schema.ts, db/index.ts, run-migrations.ts, drizzle.config.ts all target Postgres.
* All 6 $returningId() and 3 raw-SQL call sites fixed.
* Env schema consistent across all 3 locations, DATABASE_URL-based.
* Existing mocked test suite passes unchanged.
* No infra/terraform changes included in this task's diff.
```

## 10. Final Status

Blocked on approval:
- **Database schema changes** — porting `schema.ts` and generating/applying a new Drizzle baseline against Supabase requires sign-off before any migration touches a real database.
- **Infrastructure/deployment changes** — the full Terraform diff (secrets, Cloud Run env/volume rewiring, IAM grant removal) needs review before `terraform apply`.
- **Secrets** — populating `backend-database-url` with the real Supabase connection string is a production credential change.
- **Production cutover** — freezing MySQL writes, importing into Supabase, and repointing Cloud Run traffic is a production-impacting event requiring an explicit go/no-go and an agreed decommission window for the old Cloud SQL instance.
- **Scope/phasing confirmation** — whether to implement this as one PR or split app-layer-port vs. infra-cutover into two.

Waiting for Tao approval.
