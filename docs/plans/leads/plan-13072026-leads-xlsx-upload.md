# Plan: Upload xlsx to import leads from the /leads page

## 1. Summary

Leads currently only enter the system via a CLI (`tsx src/cli.ts import <file.xlsx>`) run against a file on disk. Tao wants to trigger the same import from the `/leads` dashboard page by uploading an xlsx file, instead of shelling in. The parse → map → hard-filter → score → upsert pipeline already exists and is fully tested; this is purely about exposing it over HTTP (a new `POST /api/leads/import` route on the existing leads Fastify service) and adding a small upload control to the existing Leads page. No business logic changes.

## 2. Current Implementation

**Import pipeline (`apps/leads/src/import/`)** — pure, already transport-agnostic, currently only wired to a CLI:
- `xlsx-parser.ts` — `parseWorkbookBuffer(buf: Buffer | Uint8Array): RawRow[]` (buffer-based, already tested in isolation) and `parseXlsx(filePath)` (thin disk wrapper around the former).
- `row-mapper.ts` — `mapRow(raw, sourceFile, now)`, pure.
- `filter/hard-filter.ts` — `hardFilter(input, cfg?)`.
- `score/score.ts` — `scoreDataset(inputs, weights?, now?)`.
- `repo/company-repository.ts` — `companyRepository.upsertByDomain(...)`, idempotent on `domain`.
- `importer.ts` — `runImport(filePath: string, deps: Partial<ImportDeps> = {})`: orchestrates the above, returns `ImportSummary { total, rejected, scored, byReason }`. `readRows` is already an injectable dep (defaults to `parseXlsx`), and `repo` is already injectable (defaults to the singleton `companyRepository`) — both seams exist precisely for a non-CLI caller.
- `cli.ts` — the only current caller: loads env, connects Mongo, calls `runImport(filePath)`, prints summary, closes.

**Fastify API (`apps/leads/src/`)** — a standalone service (port 4100, separate from `apps/backend`), already has list/detail/status routes:
- `app.ts` — `buildApp(env, deps)`: registers `@fastify/cors`, `@fastify/cookie`, `@fastify/jwt`, decorates `env`/`companyRepository`, central `setErrorHandler` (`AppError` → typed JSON, `ZodError` → 400). Routes: `healthRoutes` unauthenticated at `/api`; `leadsRoutes` registered inside a sub-plugin with `preHandler: requireSession(...)`.
- `routes/leads.ts` — `GET /leads`, `GET /leads/:id`, `PATCH /leads/:id/status`, all reading `fastify.companyRepository` (the injected/decorated instance, not the bare singleton — this is what makes the routes testable with a fake repo via `buildApp(env, { repository: fakeRepo })`). A comment already documents a placeholder for a future `POST /leads/analyze` in the same file.
- **No `@fastify/multipart` (or any file-upload plugin) is installed anywhere in the monorepo.** This is a new dependency.

**Frontend (`apps/frontend`)**:
- `app/pages/leads/index.vue` — the Leads dashboard: ranked table, status control, filters, pagination. Fetches via `useFetch`/`$fetch` against `/leads-api/...`, which `nuxt.config.ts` `routeRules` proxies to `${NUXT_LEADS_URL}/api/**` (default `http://localhost:4100`). No nuxt.config changes needed for a new leads-service route.
- Closest existing pattern for an action button that POSTs and refreshes: `syncOrders()` in `app/pages/orders/index.vue` — sets a loading ref, calls `$fetch(...)`, shows a `useToast()` success/error, calls `refresh()`. `$fetch` auto-detects a `FormData` body and lets the browser set the multipart boundary, so no new HTTP-client code is needed.
- `shared/types/lead.ts` — mirrors the leads API contract; needs a new `LeadImportSummary` type.
- No existing file-upload UI anywhere in the app. Per Tao's decision, this uses a plain button + hidden `<input type="file">` (not `UFileUpload`/dropzone) to stay consistent with existing action-button styling, and a single toast for the result (not a modal).

**Known unrelated pending change**: `apps/leads/src/import/row-mapper.ts` has an uncommitted working-tree fix (a stray NUL byte in a contact dedup key, replaced with `|`). This is unrelated to the upload feature and must be left untouched.

## 3. Affected Areas

- Frontend: yes — `apps/frontend/app/pages/leads/index.vue` (new upload button + handler), `apps/frontend/shared/types/lead.ts` (new response type).
- Backend: yes — new `POST /api/leads/import` route in `apps/leads/src/routes/leads.ts`, `@fastify/multipart` registration in `apps/leads/src/app.ts`.
- Database: no schema change — reuses existing `upsertByDomain` idempotent upsert.
- Queue/jobs: no.
- External APIs: no.
- Tests: yes — new route test(s) in `apps/leads/src/__tests__/`.
- Config/infra: no infra changes; one new npm dependency (`@fastify/multipart`) needs approval before install.

## 4. Risks

- New dependency install (`@fastify/multipart`) requires an explicit `pnpm add` — gated by the implementation skill's dependency-change rule.
- Unbounded/oversized uploads could exhaust memory (the parser buffers the whole file into memory). Needs a `limits.fileSize` cap.
- If the route relies on `runImport`'s default `repo` (the bare `companyRepository` singleton) instead of passing `fastify.companyRepository` explicitly, tests can't inject a fake repo — breaking the existing test pattern and diverging from how `list`/`detail`/`status` routes get their repo.
- Non-xlsx or malformed files: `XLSX.read` on garbage bytes can throw and must surface as a clean 400 (`AppError`), not a raw 500.
- This is the first bulk-write UI action (unlike single-row `PATCH /status`) — an import can upsert many companies in one call. Low risk given `upsertByDomain`'s idempotent/additive semantics (never downgrades lifecycle status past initial insert, `scoreHistory` is append-only), but there's no preview/confirm step before the write happens.

## 4b. Rollback Plan

- New dependency breaks build/install: revert the `package.json`/lockfile change and the `app.ts` multipart registration — no data involved. Data-safe: yes.
- Bad import corrupts leads data (wrong file uploaded): `upsertByDomain` is additive/idempotent — re-import with corrected data fixes it; a bad `scoreHistory` entry stays visible but isn't destructive to prior state. No automatic delete-on-import exists, so recovery is manual re-import, not a schema rollback. Data-safe: yes, but manual (no undo button).
- Route itself is buggy: remove the route registration and multipart plugin registration; the CLI import path is unaffected and remains available as a fallback. Data-safe: yes.

## 5. Recommended Approach

Summary:
- Add `@fastify/multipart` to `apps/leads`, register it (scoped to the protected sub-plugin in `app.ts`, alongside where `leadsRoutes` is already registered behind `requireSession`) with `limits.fileSize` (e.g. 10MB) and a single-file limit.
- Add `POST /leads/import` to `apps/leads/src/routes/leads.ts`: read the uploaded file via `request.file()`, validate it's present and has an `.xlsx` extension, `toBuffer()` it, then call `runImport(data.filename, { repo: fastify.companyRepository, readRows: () => parseWorkbookBuffer(buffer) })` — reusing the existing injectable seams in `importer.ts` with zero changes to `importer.ts`, `row-mapper.ts`, `hard-filter.ts`, or `score.ts`. Wrap `XLSX` parse failures and validation failures in `AppError` (400) so they flow through the existing `setErrorHandler`.
- Return the `ImportSummary` JSON as-is (`{ total, rejected, scored, byReason }`).
- Frontend: add an "Import Leads" `UButton` next to the existing refresh button in `leads/index.vue`, wired to a hidden `<input type="file" accept=".xlsx">`. On file selection, build a `FormData`, `$fetch('/leads-api/leads/import', { method: 'POST', body: formData })` with an `importing` loading ref (same shape as `syncOrders()`), show a single toast summarizing the result (e.g. `Imported 42 — 30 scored, 12 rejected`), then call `refresh()`.
- Add `LeadImportSummary` to `shared/types/lead.ts` mirroring the backend's `ImportSummary`.

Likely files:
- `apps/leads/package.json` (new dependency)
- `apps/leads/src/app.ts` (register `@fastify/multipart`)
- `apps/leads/src/routes/leads.ts` (new `POST /leads/import` route)
- `apps/leads/src/__tests__/leads-routes.test.ts` or a new `apps/leads/src/__tests__/import-route.test.ts`
- `apps/frontend/app/pages/leads/index.vue`
- `apps/frontend/shared/types/lead.ts`

Why this approach:
- Every parsing/filtering/scoring/persistence function is already pure, tested, and injectable — this change is purely additive and touches zero existing business logic.
- Matches existing patterns exactly: route placement/auth, error handling, frontend action-button/toast/refresh idiom, and test style.
- No nuxt.config or proxy changes needed — `/leads-api/**` already forwards any new leads-service route.

Avoid:
- Touching `apps/leads/src/import/row-mapper.ts`'s pending uncommitted fix.
- Changing `runImport`'s default `repo`/`readRows` behavior (keep the CLI path unaffected).
- Introducing `UFileUpload`/`UModal` — Tao chose the plain-button + toast pattern.

## 6. Approval Needed

Tao approval is required before:

- Adding the `@fastify/multipart` dependency (`pnpm add @fastify/multipart --filter @price-insight/leads`).
- Running `pnpm install` after the `package.json` edit.
- Starting implementation itself (per the implementation skill, requires the literal phrase "APPROVED TO IMPLEMENT").

## 7. Test Plan

Automated tests:
- New route test(s) covering `POST /leads/import`, following the `app.inject` + `buildApp(env, { repository: fakeRepo })` pattern already in `leads-routes.test.ts`, building an in-memory xlsx buffer the same way `xlsx-parser.test.ts` does.

Edge case tests:
- Successful multi-row upload → correct `ImportSummary` counts and fake-repo `upsertByDomain` calls.
- Missing file field in the multipart request → 400 `AppError`.
- Non-`.xlsx` filename/extension → 400 `AppError`.
- Malformed/corrupt xlsx bytes (parse throws) → 400, not a raw 500.
- Oversized file (exceeds `limits.fileSize`) → clean 4xx, not a hang or 500.
- Unauthenticated request (no `pi-session` cookie) → 401, same as existing protected routes.
- Empty workbook (header row only, no data rows) → `ImportSummary` with `total: 0`, no upserts.
- Row with no domain → counted as rejected (`no_domain`) but not persisted.

Manual validation:
- Start `apps/leads` dev server and `apps/frontend` dev server, log in, go to `/leads`, click "Import Leads," select a real sample `.xlsx`, confirm the toast shows correct counts and the table refreshes with new/updated rows.
- Re-upload the same file to confirm idempotency (no duplicate rows, `scoreHistory` grows by one entry per re-scored row).

Regression checks:
- Existing `GET /leads`, `GET /leads/:id`, `PATCH /leads/:id/status` routes and their tests remain unaffected.
- CLI import (`pnpm --filter @price-insight/leads cli import <file>`) still works unchanged.

## 8. Validation Commands

```bash
pnpm --filter @price-insight/leads test        # expect: all existing + new tests pass
pnpm --filter @price-insight/leads lint         # expect: no lint errors
pnpm --filter @price-insight/frontend lint      # expect: no lint errors (if frontend has a lint script)
```

Do not run expensive or destructive commands unless Tao approved them.

## 9. Next Implementation Prompt

```markdown
# Task: Upload xlsx to import leads from the /leads page

## Goal

Let Tao upload an xlsx file directly from the /leads dashboard to trigger the existing import pipeline, instead of using the CLI only.

## Background

apps/leads already has a fully tested parse → map → filter → score → upsert pipeline (`runImport` in `apps/leads/src/import/importer.ts`), currently only invoked via a CLI that reads a file from disk. `parseWorkbookBuffer` in `xlsx-parser.ts` already accepts an in-memory buffer, and `runImport`'s `readRows`/`repo` deps are already injectable — no changes needed to the pipeline itself.

## Scope

Implement only:

- Add `@fastify/multipart` to `apps/leads/package.json` (needs explicit approval before `pnpm add`/`pnpm install`).
- Register `@fastify/multipart` in `apps/leads/src/app.ts`, scoped to the protected sub-plugin, with a file-size limit (e.g. 10MB) and single-file limit.
- Add `POST /leads/import` to `apps/leads/src/routes/leads.ts`: read `request.file()`, validate presence + `.xlsx` extension, `toBuffer()`, call `runImport(data.filename, { repo: fastify.companyRepository, readRows: () => parseWorkbookBuffer(buffer) })`, return the `ImportSummary`. Wrap failures in `AppError` for 400s.
- Add `LeadImportSummary` type to `apps/frontend/shared/types/lead.ts`.
- Add an "Import Leads" button + hidden file input to `apps/frontend/app/pages/leads/index.vue`, following the `syncOrders()` loading/toast/refresh pattern in `apps/frontend/app/pages/orders/index.vue`, posting a `FormData` to `/leads-api/leads/import`.
- New backend route tests in `apps/leads/src/__tests__/` covering the edge cases in section 7 of the plan.

## Boundaries

Do not:

- change unrelated files (especially do not touch the pending uncommitted fix in `apps/leads/src/import/row-mapper.ts`)
- change secrets or deployment config
- run migrations (none needed — MongoDB, no schema migration system)
- expand architecture beyond this plan (no `UModal`, no `UFileUpload`, no new routes beyond `/leads/import`)
- install dependencies without Tao's explicit go-ahead

## Expected Changes

Likely files:

- `apps/leads/package.json`
- `apps/leads/src/app.ts`
- `apps/leads/src/routes/leads.ts`
- `apps/leads/src/__tests__/leads-routes.test.ts` or new `import-route.test.ts`
- `apps/frontend/app/pages/leads/index.vue`
- `apps/frontend/shared/types/lead.ts`

## Tests

See section 7 (Test Plan) for full test requirements and edge cases.

Run:

```bash
pnpm --filter @price-insight/leads test
```

## Definition of Done

* `POST /api/leads/import` accepts a multipart xlsx upload, runs it through the existing pipeline, and returns an `ImportSummary`.
* The Leads page has a working "Import Leads" button that uploads a file, shows a toast summary, and refreshes the table.
* All new and existing `apps/leads` tests pass.
* CLI import path still works unchanged.
```

## 10. Final Status

Blocked on approval:
- Adding `@fastify/multipart` as a new dependency to `apps/leads` — dependency changes require explicit approval.
- Running `pnpm install` after that `package.json` edit — same gate.
- Starting implementation — requires the literal phrase "APPROVED TO IMPLEMENT" per the implementation skill.

Waiting for Tao approval.
