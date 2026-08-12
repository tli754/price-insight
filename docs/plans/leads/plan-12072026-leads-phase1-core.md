# Plan: Leads Phase 1 — Steps 1-3 (scaffold + schema + deterministic scoring core)

> Status note: These steps are **already implemented and committed** on branch
> `feature/lead-scoring` (commit `b0b2858d`). This file is the plan-of-record for
> that work — approach, affected areas, risks, and validation — kept for review
> parity with the workflow (every implementation has a task + plan). Steps 4-7
> are out of scope here and get their own plan.

## 1. Summary

Stand up the foundation of the new **Leads** prospecting domain as a standalone
`@price-insight/leads` workspace package, with:

1. **Step 1 — Package scaffold**: a new `apps/leads` package mirroring
   `apps/backend` conventions (TS strict/ESM, Vitest, Drizzle, ESLint), its own
   `LEADS_DATABASE_URL`, and shared `SESSION_SECRET` for `pi-session` auth.
2. **Step 2 — Drizzle schema**: the Leads MySQL pipeline tables
   (`lead_companies`, `lead_company_sources`, `lead_company_signals`, `contacts`,
   `score_history`) with Mongo-ref columns reserved for Phase 2/3.
3. **Step 3 — Deterministic scoring core**: DB-free `normalize` helpers, a
   config-driven hard-filter engine, and a percentile-relative Value/Gap/Reach/
   Recency scorer with component breakdown + reasons.

Recommended direction (as built): keep the core **pure and DB-free** (mirrors
`packages/core`'s JSON-in/JSON-out discipline), push all tunable knobs into
`src/config.ts`, and defer every enrichment/AI concern to later phases so Phase 1
can ship import→filter→score→dashboard on MySQL alone.

## 2. Current Implementation

Before this work there was **no Leads domain** — the monorepo held `apps/backend`
(Fastify price-insight API), `apps/frontend` (Nuxt 4), and `packages/core` (pure
JS price analysis). Leads shares no entities with price-insight.

Patterns followed from existing code:
- `apps/backend` — Drizzle MySQL schema style, TS strict/ESM, Vitest, ESLint flat config, `.env.example` layout.
- `packages/core` — pure, deterministic, JSON-in/JSON-out core with no I/O.

Main files (created by this work):
- `apps/leads/package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `drizzle.config.ts`, `.env.example`
- `apps/leads/src/config.ts` — rubric weights (value .40 / gap .30 / reach .20 / recency .10), `AI_SCORE_THRESHOLD = 70`, hard-filter + recency-decay knobs
- `apps/leads/src/db/schema.ts` — five tables (BIGINT UNSIGNED ids)
- `apps/leads/src/domain/types.ts` — `HardFilterInput/Result`, `ScoreInput`, `ScoreComponents`, `ScoreResult`
- `apps/leads/src/lib/normalize.ts` — number/multi-value/Excel-date/domain/percentile helpers
- `apps/leads/src/filter/hard-filter.ts` — deterministic qualify/reject gate
- `apps/leads/src/score/score.ts` — percentile context + `scoreOne`/`scoreDataset`
- `apps/leads/src/__tests__/{normalize,hard-filter,score}.test.ts` — 19 tests

## 3. Affected Areas

- **Frontend**: No — untouched in steps 1-3 (Leads tab is step 6).
- **Backend** (`apps/backend`): No — no changes; Leads is a separate service.
- **Database**: New — a **separate** Leads MySQL DB (`LEADS_DATABASE_URL`); schema defined but **no migration applied to any shared env** yet. Never touches price-insight's DB.
- **Queue/jobs**: No — crawler worker is Phase 2.
- **External APIs**: No — DataForSEO/OpenAI untouched; score-gated OpenAI is Phase 3.
- **Tests**: New — 19 Vitest tests in `apps/leads`, isolated from other packages.
- **Config/infra**: `pnpm-lock.yaml` updated for the new workspace package; new `apps/leads/.env.example`. No Terraform/CI/deploy changes yet.

## 4. Risks

- **Rubric correctness**: weights/thresholds are judgment calls; a mis-tuned rubric silently mis-ranks leads. Mitigated by all knobs living in `config.ts` and full component/reason breakdown persisted to `score_history`.
- **Percentile-relative scoring on tiny datasets**: with ~102 rows, percentiles are coarse and sensitive to the import batch composition. Scores are relative to the loaded set, not absolute.
- **Schema drift vs. later phases**: Mongo-ref columns and enrichment fields are placeholders; if Phase 2 needs a different shape, a follow-up migration is required.
- **Null handling in signals**: many `.xlsx` columns are sparse; scorer averages only available signals — a company with almost no signals can still get a mid score. Watch during step 4/7.
- **No migration applied yet**: schema exists only as Drizzle definitions; nothing has been generated/committed as a migration or deployed. No runtime code references these columns yet, so no `cost`-incident-style risk today — but step 4 must generate+apply before any query runs.

## 4b. Rollback Plan

- **Rubric mis-tuned**: revert `config.ts` weights (pure constants, no data change) and re-run `scoreDataset` — data-safe: yes.
- **Schema wrong for later phases**: no shared migration exists yet, so change the Drizzle schema and regenerate before first apply — data-safe: yes (nothing deployed).
- **Whole Phase-1 core needs backing out**: `apps/leads` is additive and imported by nothing in backend/frontend; deleting the package or reverting `b0b2858d` has zero blast radius on price-insight — data-safe: yes.

## 5. Recommended Approach

Summary (as implemented):
- Keep the core deterministic and DB-free so it is unit-testable without a database and reusable by both the importer (step 4) and a future worker.
- Centralize every tunable in `config.ts`; the filter and scorer take config as an argument (default = the exported constant) so tests can inject alternatives.
- Model scoring as percentile-relative over the loaded dataset (`buildScoringContext` once, then `scoreOne` per row) — robust to units/outliers across heterogeneous BuiltWith columns.
- Reserve Mongo-ref + enrichment columns now, populate later; import writes `overall_score = 0` / `traffic_estimate = NULL` until the scoring/crawler passes run.

Likely files (all created):
- `apps/leads/src/config.ts`, `src/db/schema.ts`, `src/domain/types.ts`
- `apps/leads/src/lib/normalize.ts`, `src/filter/hard-filter.ts`, `src/score/score.ts`
- `apps/leads/src/__tests__/*.test.ts`

Why this approach:
- Mirrors two proven in-repo patterns (`packages/core` purity + `apps/backend` Drizzle/tooling), lowering review and maintenance cost.
- Additive and isolated — zero risk to price-insight's running services.
- Config-driven rubric makes tuning a data-free, reversible edit.

Avoid:
- Any I/O, DB access, or network in the scoring core.
- Coupling to price-insight's DB or entities.
- Applying a migration to a shared environment (deferred to step 4, and only through `db:generate` → commit → deploy).

## 6. Approval Needed

Because steps 1-3 are already committed, the gates below are **retroactive
acknowledgements** rather than blockers — but they are the decisions that
normally require Tao sign-off:

- **Database schema change** — five new Leads tables (separate Leads MySQL DB).
- **New service / architecture** — new `apps/leads` workspace package.
- **Dependency change** — new package brings its own deps; `pnpm-lock.yaml` updated.
- **Auth/security touchpoint** — Leads reuses `pi-session` via shared `SESSION_SECRET`.

## 7. Test Plan

Automated tests (present, 19 passing):
- `normalize.test.ts` — number/multi-value/Excel-date/domain/percentile helpers.
- `hard-filter.test.ts` — qualify/reject paths and config gating.
- `score.test.ts` — component math, weighting, reasons, percentile context.

Edge case tests (verify coverage; add where missing):
- Empty dataset → `scoreDataset([])` returns `[]`; percentile fns on empty input.
- All-null signals → value averages to a sane floor, no NaN.
- Missing domain / whitespace domain → hard-filter rejects (`no_domain`).
- `unknown` platform → **not** rejected (crawler detects later).
- Single-row dataset → percentile degenerate case doesn't divide by zero.
- Recency boundaries → exactly `freshMonths` (=1.0), `staleMonths` (=floor), null (=nullNeutral).
- Prominence rank inversion → lower rank yields higher value contribution.
- Country filter case-insensitivity (`nz` vs `NZ`).

Manual validation:
- `pnpm --filter @price-insight/leads test` output shows 19 passing.
- `tsc --noEmit` clean for the package.

Regression checks:
- `apps/backend` and `apps/frontend` builds/tests unaffected (no shared imports).

## 8. Validation Commands

```bash
pnpm --filter @price-insight/leads test        # expect: 19 passed, exit 0
pnpm --filter @price-insight/leads exec tsc --noEmit   # expect: no output, exit 0
pnpm --filter @price-insight/leads lint        # expect: clean, exit 0
git show --stat b0b2858d                       # expect: 16 files, +905 (scaffold + schema + core)
```

Do not run `db:generate`/`db:push`/migrations here — schema apply is step 4, and only via `db:generate` → commit → deploy against the Leads DB.

## 9. Next Implementation Prompt

Steps 1-3 are done. The next implementation prompt is **Step 4 (importer)** and
belongs in its own plan; sketch only:

````markdown
# Task: Leads Phase 1 — Step 4 importer

## Goal
Parse a BuiltWith/Store-Leads `.xlsx` export and ingest rows into the Leads MySQL
DB: hard-filter → upsert `lead_companies` (+ sources/signals/contacts) → run the
deterministic scorer → write `overall_score` and a `score_history` row.

## Scope
- `.xlsx` parse via SheetJS mapping 42 columns → `HardFilterInput`/`ScoreInput`.
- Idempotent upsert keyed on `domain` (+ `company_id, source` provenance uniqueness).
- Wire `normalize` + `hardFilter` + `scoreDataset` from the step-1-3 core.

## Boundaries
Do not touch backend/frontend; do not apply a migration to a shared env; generate
the Leads migration and apply only through db:generate → commit → deploy.

## Blocked on
- A provisioned **Leads MySQL DB** target (`LEADS_DATABASE_URL`) for e2e.
- **SheetJS-vs-CSV** confirmation for the import format.
````

## 10. Final Status

Blocked on approval (retroactive — already committed in `b0b2858d`, listed for sign-off parity):
- Database schema change — five new Leads tables define a new persistence surface.
- New service/architecture — `apps/leads` adds a workspace package.
- Dependency change — new package deps updated `pnpm-lock.yaml`.
- Auth/security touchpoint — shared `SESSION_SECRET` reuse for `pi-session`.

Waiting for Tao approval (and for the step-4 blockers: Leads MySQL DB + SheetJS/CSV decision).
