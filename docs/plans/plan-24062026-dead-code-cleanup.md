# Plan: Dead Code & Redundancy Cleanup (Backend, Frontend, Core, Infra)

## 1. Summary

A research-only audit found a clear set of dead files/services left over from two prior migrations — the Jina/OpenAI-extractor pipeline replaced by `AiReportService`, and the GKE→Cloud Run migration — plus an entirely unused standalone package (`packages/core`), a dangerous orphaned legacy DB-reset script, leftover Redis env vars, and several pockets of duplicated business logic (competitor filtering/mapping) and duplicated/ad-hoc formatting helpers on the frontend. Recommended direction: do this as a small number of narrowly-scoped, low-risk removal PRs (safe deletions first, dedup refactors second), each independently reviewable and revertable, rather than one large sweep.

## 2. Current Implementation

The audit found:

- **Dead extractor pipeline**: `apps/backend/src/services/jina-reader.ts` (`JinaReaderService`, 29 lines) and `apps/backend/src/lib/prompt-loader.ts` (`loadPrompt`, 19 lines) have zero importers in `apps/backend/src` and no tests. The service that used to wire them together (`ExtractorService`) is already gone from source. `apps/backend/src/app.ts` only registers `AiReportService` (DataForSEO + inline OpenAI prompts) — confirmed by reading its full import list.
- **Dead prompts**: `/prompts/extractor-system.md`, `extractor-user.md`, `extractor.md`, `extractor-validation.md`, `extractor-repair.md`, `prompts/README.md` — zero references from backend source; `README.md` documents the dead Redis+Jina flow verbatim.
- **Dead standalone package**: `packages/core/` (core.js, cli.js, extractor/*, tests) — confirmed via repo-wide grep that nothing outside `packages/core/package.json` itself references `@price-insight/core`. It's a pnpm workspace member so its tests run under `turbo test`, but it ships no consumed code.
- **Dangerous orphaned script**: `apps/backend/src/db/migrate.ts` (261 lines) — drops and recreates the entire legacy schema. Zero references in package.json scripts, no other source file imports it, not run by any CI workflow. Properly superseded by `apps/backend/src/db/run-migrations.ts` + the `drizzle/0000...0005_*.sql` chain.
- **Unused k8s manifest (keep)**: `.github/k8s/migration-job.yaml` — not referenced by any `.github/workflows/*.yml`; `deploy.yml` does everything via `gcloud run deploy/describe/update-traffic`. Tao has asked to retain this file for potential future use, so it is excluded from the cleanup scope below despite being currently unreferenced.
- **Leftover Redis env**: `apps/backend/.env.example` lines 14-18 (`REDIS_HOST/PORT/PASSWORD/DB/TTL_SECONDS`) — `apps/backend/src/config/env.ts`'s zod schema has no REDIS_* fields; no `redis` package dependency.
- **Likely-dead SerpAPI path**: `apps/backend/src/services/serp-api-service.ts` (207 lines) — not imported in `app.ts`; only used by its own test file and `src/scripts/investigate-serp.ts`, which itself reads `process.env.SERPAPI_API_KEY`, a var that doesn't exist in `env.ts`'s schema (only `SERPAPI_LOCATION/GL/HL/GOOGLE_DOMAIN/NUM_RESULTS` exist). Predecessor to the now-live `DataForSeoService`.
- **Duplicated business logic**: the NZ/AU + price-range competitor filter and the 17-field competitor row-mapping object are copy-pasted near-verbatim between `apps/backend/src/services/competitor-analysis-service.ts` (lines ~25-31, ~41-58, ~84-99) and `apps/backend/src/routes/webhook.ts` (lines ~113-145). Two different `normalizeSource()` functions (different behavior) exist under the same name in those two files.
- **Frontend formatting duplication**: `formatPrice` defined twice with different signatures (`apps/frontend/app/pages/competitors/[id].vue:51-57` vs `apps/frontend/app/pages/products/[id].vue:144-148`), plus ad hoc `Intl.NumberFormat`/`.toFixed(2)`/date formatting scattered across ~10 page/component files with no shared composable, despite `apps/frontend/app/utils/` already existing as the natural home (currently only `stats.ts`, `inventory.ts`).
- Stale "GKE"/"kubectl" comments in `apps/backend/src/scripts/find-all-competitors.ts` (lines 11,14-15) and `sync-products.ts` (line 7) — comment-only, scripts themselves are live and correct.

Main files:
- `apps/backend/src/services/jina-reader.ts`
- `apps/backend/src/lib/prompt-loader.ts`
- `prompts/*.md`
- `apps/backend/src/db/migrate.ts`
- `apps/backend/.env.example`
- `packages/core/`
- `apps/backend/src/services/serp-api-service.ts`
- `apps/backend/src/services/competitor-analysis-service.ts`
- `apps/backend/src/routes/webhook.ts`
- `apps/frontend/app/utils/`

Note: `.github/k8s/migration-job.yaml` was identified as currently unreferenced but is being **kept** per Tao's instruction (retained for possible future use) — not part of this cleanup's scope.

## 3. Affected Areas

- Frontend: yes — formatting duplication cleanup is frontend-only refactor work (no backend coupling)
- Backend: yes — file deletions (jina-reader, prompt-loader, migrate.ts, serp-api-service) and dedup of competitor filter/mapping logic
- Database: indirectly — `migrate.ts` deletion removes a destructive script, no schema change itself
- Queue/jobs: no
- External APIs: removing dead SerpAPI client (no live external calls today; safe)
- Tests: yes — `serp-api-service.test.ts` would need removal/decision; `price-analysis.test.ts` unaffected; new tests if dedup helpers are extracted
- Config/infra: yes — `.env.example` Redis lines, `.github/k8s/migration-job.yaml`
- CI/CD: no workflow changes needed (nothing currently references the dead files)

## 4. Risks

- **Technical risk**: deleting `migrate.ts` is net risk-reducing (removes a destructive script), but must double-check no operator has a personal alias/runbook step that calls it outside the repo (can't fully verify from inside the repo — flag in PR description).
- **Technical risk**: `packages/core` removal is the largest blast radius item — it has its own published bin entries (`price-insight`, `price-insight-extract`). If anyone outside this repo installs/depends on the npm package name `@price-insight/core`, deleting it would break them. Need explicit confirmation it's not published/consumed externally before deleting (vs. just leaving it as an inert, never-built workspace member).
- **Data risk**: none — all proposed deletions are unused code paths, not data-touching in their dead state.
- **Performance risk**: none.
- **Security risk**: low positive — removing `serp-api-service.ts` and its env reads slightly shrinks attack surface; removing `migrate.ts` removes a destructive footgun.
- **UX/product risk**: none from backend/infra cleanup. Frontend formatting dedup carries a small regression risk if the new shared formatter doesn't match each call site's exact prior formatting (e.g., `competitors/[id].vue`'s Intl.NumberFormat currency style vs `products/[id].vue`'s raw-string-first style are *intentionally* different — a careless merge could silently change displayed values).
- **Migration/rollback risk**: none for backend/infra deletions (easily revertable via git). Frontend dedup is the only piece needing careful manual visual QA before merge.

## 5. Recommended Approach

Summary:
- Split into two PRs to keep review scope small and risk isolated:
  - **PR 1 (deletions only, no logic changes)**: remove `apps/backend/src/services/jina-reader.ts`, `apps/backend/src/lib/prompt-loader.ts`, `/prompts/*` (all 6 files), `apps/backend/src/db/migrate.ts`, the 5 REDIS_* lines in `apps/backend/.env.example`, and (pending Tao's explicit confirmation `packages/core` is not externally consumed) `packages/core/`. Also fix the stale GKE/kubectl comments in `find-all-competitors.ts` and `sync-products.ts` as a 2-line doc fix in the same PR since it's zero-risk. `.github/k8s/migration-job.yaml` is explicitly **out of scope** — Tao wants it retained for potential future use even though it's currently unreferenced.
  - **PR 2 (dedup refactor)**: extract the competitor country/price-range filter and the 17-field row-mapping into a shared helper (e.g., `apps/backend/src/lib/competitor-filter.ts` or a method on `CompetitorAnalysisService` reused by `webhook.ts`), used by both `competitor-analysis-service.ts` and `webhook.ts`. Decide and document the two `normalizeSource` behaviors explicitly (rename one, e.g. `normalizeSourceForCompare` vs `normalizeSourceForDisplay`, rather than silently merging them — they are not interchangeable). On the frontend, add `apps/frontend/app/utils/currency.ts` (or a composable) with a single `formatCurrency` honoring the existing two distinct display modes as named functions, and migrate call sites incrementally.
- `serp-api-service.ts` + its test: flag as a separate decision for Tao — either delete alongside `investigate-serp.ts`, or keep if there's a known near-term plan to revive SerpAPI as a fallback to DataForSEO. Don't bundle this into PR 1's "obviously dead" deletions since it has real, working test coverage (just no live caller) — worth a one-line confirmation from Tao first.

Likely files:
- `apps/backend/src/services/jina-reader.ts` (delete)
- `apps/backend/src/lib/prompt-loader.ts` (delete)
- `prompts/*.md` (delete, 6 files)
- `apps/backend/src/db/migrate.ts` (delete)
- `apps/backend/.env.example` (edit, remove lines 14-18)
- `packages/core/` (delete, pending confirmation)
- `apps/backend/src/scripts/find-all-competitors.ts`, `sync-products.ts` (comment fix)
- `apps/backend/src/services/competitor-analysis-service.ts`, `apps/backend/src/routes/webhook.ts` (PR 2 dedup)
- `apps/frontend/app/utils/` (new shared formatter, PR 2)

Why this approach:
- Splitting deletions from refactors means PR 1 is essentially zero-risk and fast to approve/merge; PR 2 carries the only behavior-sensitive changes and deserves its own focused review and manual QA pass.
- Confirming `packages/core`'s external-consumption status before deleting avoids an irreversible mistake (can't easily tell from inside the repo whether the npm package name is published/depended upon elsewhere).

Avoid:
- Do not silently merge the two `normalizeSource` implementations — they have different, both-intentional behavior (lowercase-for-compare vs preserve-case-for-display).
- Do not delete `serp-api-service.ts` in the same PR as the "obviously dead" items — it has passing tests, so its removal needs an explicit decision, not a drive-by deletion.
- Do not touch `apps/backend/src/config/env.ts`'s `WEBHOOK_HOST` default (`https://www.qweyha520.bar`) as part of this cleanup — it looked suspicious during the audit but is out of scope for a dead-code pass and deserves its own investigation.
- Do not touch the mock-data-in-production-UI issue (`apps/frontend/app/pages/orders/index.vue` blending `mockOrders` with real API data) in this cleanup — that's a product-correctness issue, not dead code, and changing it would expand scope beyond cleanup.

## 6. Approval Needed

Tao approval is required before:

- Deleting `packages/core/` (need explicit confirmation it has no external consumers/published npm presence)
- Deleting `apps/backend/src/db/migrate.ts` (destructive-script removal — low risk but touches db/ directory, falls under "approval required before database-related changes" per CLAUDE.md's general caution)
- Deciding the fate of `serp-api-service.ts` + `investigate-serp.ts` + its test file (keep vs delete)
- Any frontend formatter behavior change that could alter what's visually displayed to merchants (PR 2)

## 7. Test Plan

Automated tests:
- `pnpm --filter @price-insight/backend test` — confirm full suite still passes after PR 1 deletions (expect no failures since none of the deleted files have importers)
- If `packages/core` is deleted: confirm `turbo test` config / root `pnpm test` no longer tries to run `packages/core`'s tests (should just no-op since the workspace member is gone)
- If `serp-api-service.ts` is deleted: remove `apps/backend/src/__tests__/serp-api-service.test.ts` in the same change (can't have a test for a deleted file)

Edge case tests (for PR 2 dedup only):
- Competitor filter helper: country exactly "NZ"/"AU" (pass), other country codes (reject), null/undefined country, price exactly at `productPrice/2` and `productPrice*2` boundaries, `product.price` null (no price filtering applied)
- normalizeSource rename: verify webhook.ts's own-store comparison still matches case-insensitively after rename, verify competitor-analysis-service.ts's display value still preserves original casing and still defaults empty string to "Unknown"
- Frontend formatCurrency: null price, zero price, negative price (refunds), missing currency code, very large numbers (thousands separator)

Manual validation needed:
- After PR 2 frontend changes: visually diff `competitors/[id].vue` and `products/[id].vue` price displays against current production screenshots to confirm no formatting regression
- Confirm `/api/products/:id/competitors/search` and the DataForSEO webhook pingback endpoints still return identical filtered results before/after the dedup refactor (can run both code paths against the same recorded DataForSEO fixture and diff output)

Regression checks:
- Run full backend test suite after each PR
- Run `pnpm --filter @price-insight/frontend build` after frontend dedup to catch type errors from the new shared util's signature

## 8. Validation Commands

Suggested commands:

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend lint
pnpm --filter @price-insight/backend build
pnpm --filter @price-insight/frontend lint
pnpm --filter @price-insight/frontend build
pnpm test   # only if packages/core is being removed, to confirm turbo no longer picks it up
```

Do not run `db:push` or any migration command as part of this work — no schema changes are involved.

## 9. Next Implementation Prompt

```markdown
# Task: Dead code cleanup — Part 1 (safe deletions)

## Goal

Remove confirmed-dead files left over from the Jina/OpenAI-extractor pipeline and the GKE-to-Cloud-Run migration, plus leftover Redis env vars, without changing any live behavior.

## Background

A research audit confirmed these files have zero live importers/callers and no CI references. Full evidence (grep results, line numbers) is in plan-24062026-dead-code-cleanup.md.

## Scope

Implement only:

- Delete `apps/backend/src/services/jina-reader.ts`
- Delete `apps/backend/src/lib/prompt-loader.ts`
- Delete `prompts/extractor-system.md`, `prompts/extractor-user.md`, `prompts/extractor.md`, `prompts/extractor-validation.md`, `prompts/extractor-repair.md`, `prompts/README.md`
- Delete `apps/backend/src/db/migrate.ts`
- Edit `apps/backend/.env.example` to remove the REDIS_HOST/PORT/PASSWORD/DB/TTL_SECONDS lines
- Fix stale "GKE"/"kubectl create job" comments in `apps/backend/src/scripts/find-all-competitors.ts` (lines 11,14-15) and `apps/backend/src/scripts/sync-products.ts` (line 7) to reference Cloud Run instead

## Boundaries

Do not:
- touch `packages/core/` (separate approval needed)
- touch `apps/backend/src/services/serp-api-service.ts` or its test (separate decision needed)
- touch `apps/backend/src/services/competitor-analysis-service.ts` or `apps/backend/src/routes/webhook.ts` business logic (that's Part 2)
- touch any frontend files
- touch `.github/k8s/migration-job.yaml` — Tao wants this file retained for future use, do not delete it
- run migrations or change deployment config

## Expected Changes

Likely files (all deletions except one edit):
- `apps/backend/src/services/jina-reader.ts` (deleted)
- `apps/backend/src/lib/prompt-loader.ts` (deleted)
- `prompts/*.md` (deleted, 6 files)
- `apps/backend/src/db/migrate.ts` (deleted)
- `apps/backend/.env.example` (edited)
- `apps/backend/src/scripts/find-all-competitors.ts`, `apps/backend/src/scripts/sync-products.ts` (comment edits)

## Tests

Add/update:
- None required — these are unused-file deletions with no test coverage to update

Run:

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
```

## Definition of Done

* All listed files deleted, `.env.example` and script comments edited
* `pnpm --filter @price-insight/backend test` passes with no new failures
* `pnpm --filter @price-insight/backend build` succeeds
* `git status` shows only the expected deletions/edits, nothing else touched
```

## 10. Final Status

Waiting for Tao approval.
