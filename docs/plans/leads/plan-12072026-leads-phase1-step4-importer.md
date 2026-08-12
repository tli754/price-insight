doc# Plan: Leads Phase 1 — Step 4 (xlsx importer → filter → score → persist)

## 1. Summary

Build an **offline CLI importer** for the Leads domain that reads a
BuiltWith/Store-Leads `.xlsx` export, maps its 42 columns onto the Leads schema,
runs the existing deterministic **hard-filter** and **scorer**, and persists the
results idempotently to the dedicated Leads MySQL DB.

Recommended direction: a **CLI-only** step (no Fastify yet — that's step 5) exposed
as `pnpm --filter @price-insight/leads cli import <file>`. Reuse the DB-connection
and migration-runner patterns from `apps/backend` verbatim, and reuse the already
tested core (`normalize`, `hardFilter`, `scoreDataset`) unchanged. The importer is
the first code that actually needs the schema applied, so Step 4 also generates and
applies the **first Leads migration**.

Two blockers stand between this plan and an end-to-end run:
1. A provisioned **Leads MySQL DB** (`LEADS_DATABASE_URL`) — local is fine for P1.
2. Confirmation of a couple of **column→signal design decisions** (§6) that change
   scoring output.

## 2. Current Implementation

Steps 1-3 (`b0b2858d`) delivered a **DB-free** core and schema, but nothing yet
reads or writes the database. `apps/leads/src` currently has: `config.ts`,
`db/schema.ts`, `domain/types.ts`, `lib/normalize.ts`, `filter/hard-filter.ts`,
`score/score.ts`, and tests. There is **no** DB client, env loader, migration
runner, repository, or CLI entrypoint.

The `.xlsx` source is confirmed present and parseable with the installed `xlsx`
(SheetJS) dep. Verified structure of
`~/workers/doc/data/Shopify_websites_in_Auckland_-_2026-07-10-excel.xlsx`:
**103 rows (1 header + 102 data), 42 columns**. Dates arrive as **Excel serials**
(e.g. `42731`) — so `excelSerialToDate` (already in `normalize.ts`) is the correct
parser, and `sheet_to_json(ws, { raw: true })` is the correct read mode. This
resolves the "SheetJS vs CSV" question: **SheetJS, raw serial dates.**

Patterns to mirror (both in `apps/backend/src/db/`):
- `index.ts` — `createDatabase(env)` builds a `mysql2` pool (socket vs TCP+SSL) and wraps it with `drizzle(pool, { schema, mode: "default" })`.
- `run-migrations.ts` — `migrate()` + drift-bootstrap of `__drizzle_migrations`.
- `ProductRepository` (backend) — Drizzle upsert-on-conflict style for idempotency.

### Verified column → schema mapping

| # | Header | Target | Transform |
|---|--------|--------|-----------|
| 0 | Root Domain | `lead_companies.domain` | `normalizeDomain` (unique key) |
| 8 | Company | `lead_companies.company_name` | trim |
| 9 | Vertical | `lead_companies.vertical` | trim |
| 6 | Employees | `lead_companies.employee_count` | `parseNumber` |
| 7 | SKU | `lead_companies.product_count` | `parseNumber` |
| 25 | Country | `lead_companies.country` | upper, char(2) |
| 30 | eCommerce Platform | `lead_companies.platform` | first line → lowercased (`Shopify`→`shopify`), else `unknown` |
| 4 | Sales Revenue | `signals.sales_revenue` | `parseNumber` |
| 3 | Technology Spend | `signals.technology_spend` | `parseNumber` |
| 10 | Tranco | `signals.tranco` | `parseNumber` |
| 11 | Page Rank | `signals.page_rank` | `parseNumber` (bigint) |
| 35 | CRuX Rank | `signals.crux_rank` | trim ("Top 50m") |
| 5 | Social | `signals.social_followers` | `parseNumber` |
| 32 | CRM Platform | `signals.crm_platform` + `has_crm` | present ⇒ hasCrm=true |
| 33 | Marketing Automation Platform | `signals.marketing_automation` + `has_marketing_automation` | present ⇒ true |
| 39 | AI | `signals.ai_platform` + `has_ai` | present ⇒ hasAi=true |
| 34 | Payment Platforms | `signals.payment_platforms` | keep raw multi-line |
| 26 | First Detected | `signals.first_detected` | `excelSerialToDate` |
| 27 | Last Found | `signals.last_found` | `excelSerialToDate` |
| 29 | Last Indexed | `signals.last_indexed` | `excelSerialToDate` |
| 15 | Emails | `contacts` type=email | `splitMultiValue`, first ⇒ isPrimary |
| 14 | Telephones | `contacts` type=phone | `splitMultiValue` |
| 20 | People | `contacts` type=person | `splitMultiValue` ("Name - Role") |
| 16-19 | X / Twitter / Facebook / LinkedIn | `contacts` type=social | one row each, `label`=network |
| all | (full row) | `lead_company_sources.raw` (JSON) + `source`/`source_file` | provenance |

Intentionally **dropped in P1** (documented, not mapped): Location on Site,
Primary Domain, Majestic, Umbrella, Verified Profiles, City, State, Zip, First
Indexed, CMS Platform, Cloudflare Rank, Agency, Hosting Provider, Exclusion,
Compliance. (Raw row is preserved in `sources.raw`, so nothing is lost.)

## 3. Affected Areas

- **Frontend**: No.
- **Backend** (`apps/backend`): No — patterns are copied, not imported.
- **Database**: **Yes** — first Leads migration generated + applied to the Leads MySQL DB (local for P1). Never touches price-insight's DB.
- **Queue/jobs**: No.
- **External APIs**: No (score-gated OpenAI is P3).
- **Tests**: New — parser/mapper/importer unit tests with a tiny fixture; optional integration test gated on a DB env var.
- **Config/infra**: New files under `apps/leads/src` + generated `apps/leads/drizzle/`. No Terraform/CI/deploy changes (Leads has no deploy path yet).

## 4. Risks

- **Schema apply on shared env**: generating + applying the first migration is a schema change. Must go through `db:generate` → commit → (local) apply; **no `db:push` on any shared DB** (CLAUDE.md rule).
- **prominenceRank ambiguity**: `ScoreInput.prominenceRank` (lower=better) can come from Tranco, Page Rank, or CRuX bucket. Sample row has **no Tranco** but a Page Rank — column population varies, and the choice shifts the Value component. Design decision (§6).
- **`lastActivityAt` derivation**: recency needs a single date; source has First Detected / Last Found / Last Indexed. Choice affects the Recency component. Design decision (§6).
- **Idempotency / re-import**: re-running must not duplicate companies, signals, or contacts, nor append endless `score_history`. Mitigated by unique keys (domain; company+source; company_id on signals; company+type+value on contacts) and upsert; but score_history is intentionally append-only (one row per run).
- **Data quality**: sparse/garbage cells, non-NZ rows, multi-value platform strings, `parseNumber` on ranks like `29221352`. Mitigated by the tolerant `normalize` helpers + hard-filter.
- **Excel epoch bug**: serial→date already handles the 1900 leap-year offset; wrong epoch would shift all dates by ~2 days. Covered by an explicit test.
- **Money precision**: `sales_revenue` is `decimal(14,2)` read as `number` — large values are fine, but confirm no float rounding at import.

## 4b. Rollback Plan

- **Bad import batch**: import is idempotent and scoped by `source`/`source_file`; re-run after a fix overwrites companies/signals; a stray batch can be removed by `source_file` (cascade deletes children). — data-safe: yes.
- **Migration wrong**: it is the *first* Leads migration on a *local* DB — drop/recreate the local `leads` DB and regenerate; no shared data at risk. — data-safe: yes (local only).
- **Whole step back-out**: importer files are additive and imported by nothing else; revert the commit. — data-safe: yes.

## 5. Recommended Approach

Summary:
- **CLI-first**, no HTTP. Entry: `src/cli.ts` with an `import <file>` subcommand → orchestrator.
- **Layered, testable**: `xlsx-parser` (file→raw rows) → `row-mapper` (raw row→`{company, signals, contacts, filterInput, scoreInput}` via `normalize`) → `hardFilter` → `scoreDataset` (batch, so percentiles span the file) → `lead-repository` upserts inside a transaction → write `overall_score` + one `score_history` row.
- **Reuse, don't rebuild**: `createDatabase`/`run-migrations`/env-loader copied from backend; core (`normalize`/`hardFilter`/`scoreDataset`) untouched.
- **Score the batch, then persist**: build the percentile context over the whole file (rejected rows excluded) so relative scoring is stable.

Likely new files:
- `apps/leads/src/config/env.ts` — typed env loader (mirror backend `loadEnv`)
- `apps/leads/src/db/index.ts` — `createDatabase(env)` (mirror backend)
- `apps/leads/src/db/run-migrations.ts` — migration runner (mirror backend)
- `apps/leads/drizzle/**` — generated first migration (via `db:generate`)
- `apps/leads/src/import/xlsx-parser.ts`
- `apps/leads/src/import/row-mapper.ts`
- `apps/leads/src/import/importer.ts` (orchestrator)
- `apps/leads/src/repo/lead-repository.ts` (idempotent upserts)
- `apps/leads/src/cli.ts` (entrypoint)
- `apps/leads/src/__tests__/{xlsx-parser,row-mapper,importer}.test.ts` (+ small fixture)

Why this approach:
- Mirrors two proven in-repo patterns → low review cost, consistent ops story.
- CLI keeps step 4 fully offline and unit-testable before HTTP (step 5) exists.
- Batch scoring matches the scorer's percentile-relative design.

Avoid:
- `db:push` anywhere shared; adding an HTTP server (step 5); touching backend/frontend; inventing enrichment/AI now; mutating the core's public API.

## 6. Approval Needed

Tao approval is required before implementing:

- **First Leads DB migration** — schema apply; needs `LEADS_DATABASE_URL` target and the `db:generate` → commit → apply path (no `db:push`).
- **`prominenceRank` source decision** — recommend **Tranco, fall back to Page Rank** (both "lower=better" ranks; CRuX is a coarse bucket). Changes Value scores.
- **`lastActivityAt` source decision** — recommend **max(Last Found, Last Indexed)**. Changes Recency scores.
- **`has*` derivation from presence** — recommend: platform-string non-empty ⇒ hasCrm/hasAi/hasMarketingAutomation true; contacts presence ⇒ hasEmail/hasPhone/hasNamedPerson. Changes Gap/Reach scores.
- **New dependency for CLI arg parsing** (if any) — recommend **none** (hand-roll `process.argv`) to avoid a dep change.

## 7. Test Plan

Automated tests:
- `xlsx-parser` — reads a tiny fixture `.xlsx`; asserts row count, header order, raw serial dates preserved.
- `row-mapper` — column→object mapping for a representative row (Karibou fixture): domain normalized, platform `shopify`, emails/people split, serial→date, `has*` flags, dropped columns land in `raw`.
- `importer` — end-to-end over an in-memory/fixture dataset with a **mocked repository**: filter drops bad rows, batch scoring produces `overall_score`, one `score_history` per company.

Edge case tests:
- Empty file / header-only file → 0 imported, no crash.
- Missing/blank Root Domain → hard-filter `no_domain`, row skipped, reason recorded.
- Duplicate domain within one file and across two runs → single company, no dup signals/contacts (idempotency).
- Multi-value platform (`"Shopify\r\nShopify Hong Kong Dollar"`) → `shopify`.
- All-null signal row → no NaN score; sane floor.
- Excel serial boundaries → correct date; non-numeric date cell → null.
- Non-NZ country row (if `allowedCountries` later enabled) → still passes today (filter disabled by default).
- Very large Page Rank (`29221352`) parsed as number, not truncated.
- Re-run same file → `score_history` gains exactly one new row per company (append-only), company/signals unchanged.

Manual validation:
- Run `cli import` against the real Auckland file into a **local** Leads DB; spot-check top/bottom scored rows and their `reasons` in `db:studio`.

Regression checks:
- `apps/backend` / `apps/frontend` unaffected (no shared imports).
- Existing 19 core tests still pass (core untouched).

## 8. Validation Commands

```bash
pnpm --filter @price-insight/leads test              # expect: all tests pass, exit 0
pnpm --filter @price-insight/leads exec tsc --noEmit  # expect: no output, exit 0
pnpm --filter @price-insight/leads lint              # expect: clean, exit 0
pnpm --filter @price-insight/leads db:generate       # expect: new file under apps/leads/drizzle/ (AFTER approval)
# e2e (AFTER a local Leads DB exists + migration applied):
pnpm --filter @price-insight/leads cli import ~/workers/doc/data/Shopify_websites_in_Auckland_-_2026-07-10-excel.xlsx
# expect: "imported N, filtered M" summary; rows visible in db:studio
```

Do not run `db:push` or apply migrations to any shared environment.

## 9. Next Implementation Prompt

````markdown
# Task: Leads Phase 1 — Step 4 importer

## Goal
CLI importer: parse the BuiltWith/Store-Leads `.xlsx`, map 42 columns onto the
Leads schema, run the existing hard-filter + scorer, and persist idempotently to
the Leads MySQL DB with a per-run score_history entry.

## Background
Steps 1-3 (commit b0b2858d) shipped the DB-free core (`normalize`, `hardFilter`,
`scoreDataset`) and Drizzle schema. This step is the first code to touch the DB.
Column mapping and design decisions are fixed in the approved plan (§2, §6).

## Scope
Implement only:
- `src/config/env.ts`, `src/db/index.ts`, `src/db/run-migrations.ts` (mirror apps/backend)
- generated first migration under `apps/leads/drizzle/` (db:generate)
- `src/import/{xlsx-parser,row-mapper,importer}.ts`, `src/repo/lead-repository.ts`, `src/cli.ts`
- unit tests + a tiny `.xlsx` fixture

## Boundaries
Do not: add a Fastify server (step 5); touch apps/backend or apps/frontend; run
`db:push`; apply migrations to any shared DB; add deps beyond what's installed
(xlsx/drizzle/mysql2 already present); change the core's public API.

## Expected Changes
Likely files: see §5.

## Tests
See §7. Run:
```bash
pnpm --filter @price-insight/leads test
pnpm --filter @price-insight/leads exec tsc --noEmit
pnpm --filter @price-insight/leads lint
```

## Definition of Done
- `cli import <file>` loads the Auckland file into a local Leads DB, idempotently.
- Every non-rejected company has an `overall_score` and exactly one score_history
  row per run; rejected rows carry a `filter_reason`.
- New + existing tests, typecheck, and lint all pass.
````

## 10. Final Status

Blocked on approval:
- First Leads DB migration — schema apply; needs `LEADS_DATABASE_URL` + db:generate→commit→apply path (no db:push).
- `prominenceRank` source — recommendation given; alters Value scores, so needs a call.
- `lastActivityAt` source — recommendation given; alters Recency scores.
- `has*` presence-derivation rule — recommendation given; alters Gap/Reach scores.
- CLI arg-parsing dependency — recommend none; confirm before adding any dep.

Also blocked on the environment: a provisioned **Leads MySQL DB** for the e2e run
(local is fine for Phase 1).

Waiting for Tao approval.
