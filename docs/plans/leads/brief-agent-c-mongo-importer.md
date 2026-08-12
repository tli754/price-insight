# Agent Brief C — Step 4 xlsx Importer → MongoDB (apps/leads)

> Supersedes `plan-12072026-leads-phase1-step4-importer.md` (that draft targeted the
> now-removed MySQL layer). Leads is **MongoDB-only**; the foundation + ICP band
> scoring are already merged on `feature/lead-scoring` (HEAD `3665e1bb`).

## Goal
Build an **offline CLI importer** that reads a BuiltWith/Store-Leads `.xlsx` export,
maps its 42 columns onto the merged `companies` schema, runs the existing
deterministic **hard-filter** + **band scorer**, and **idempotently** upserts
`companies` documents into the Leads MongoDB. No HTTP server (that is Step 5).

Runs in an isolated git worktree off `feature/lead-scoring`. A **local Mongo is
available** (`mongodb://127.0.0.1:27017/leads`, Docker `infra-mongo`) for the e2e run.

## Reuse — treat these as stable APIs (consume, do NOT modify)
Foundation (`src/db/*`, `src/env.ts`):
- `connect(): Promise<Db>`, `getDb(): Db`, `close()` — `src/db/mongo.js`
- `ensureIndexes(db)` — `src/db/indexes.js`
- `companies()` accessor + `companySchema`/`CompanyDoc`, `companySignalsSchema`, `contactSchema`, `sourceSchema`, `companyScoreSchema`, `scoreHistoryEntrySchema`, `LIFECYCLE_STATUSES`, `COLLECTIONS` — `src/db/collections.js`
- `loadEnv()` — `src/env.js`

Pure core (`src/lib`, `src/filter`, `src/score`, `src/config`, `src/domain`):
- `normalizeDomain`, `parseNumber`, `splitMultiValue`, `excelSerialToDate` — `src/lib/normalize.js`
- `hardFilter(input, cfg?) → { pass, reason }` — `src/filter/hard-filter.js` (input is `HardFilterInput`, now **requires `productCount`**)
- `scoreDataset(inputs: ScoreInput[], weights?, now?) → ScoreResult[]` — `src/score/score.js` (batch: builds the percentile context over the array — **score all filter-passers together**, not one-by-one)
- `WEIGHTS`, `HARD_FILTER`, `VALUE_BAND` — `src/config.js`
- `HardFilterInput`, `ScoreInput`, `ScoreResult` — `src/domain/types.js`

`xlsx` (SheetJS, `^0.18.5`) and `mongodb` (`^6.21.0`) are already installed — **no new deps**.

## Exact files in scope (create)
- `src/import/xlsx-parser.ts` — read a file path → `RawRow[]` where each row is a
  `Record<string, unknown>` keyed by the header cell. Use `XLSX.read(buf)` +
  `XLSX.utils.sheet_to_json(ws, { raw: true, defval: null })` on the first sheet.
  Dates arrive as **Excel serials** (raw numbers) — do NOT set `cellDates`.
- `src/import/row-mapper.ts` — pure `mapRow(raw, sourceFile) → MappedLead` producing:
  `{ companyFields, signals, contacts[], source, hardFilterInput, scoreInput }`
  using the column map below and the `normalize` helpers.
- `src/import/importer.ts` — orchestrator `runImport(filePath) → ImportSummary`:
  parse → `mapRow` all → `hardFilter` each → **`scoreDataset` over the passers** →
  assemble `CompanyDoc`s → upsert via the repository → return
  `{ total, rejected, scored, byReason: Record<string,number> }`.
- `src/repo/company-repository.ts` — `upsertByDomain(doc, scoreEntry?)`: idempotent
  upsert keyed on `domain`; see idempotency rules below.
- `src/cli.ts` — `import <file>` subcommand: `loadEnv()` → `connect()` →
  `ensureIndexes(db)` → `runImport(file)` → print summary → `close()`. Hand-roll
  `process.argv` parsing (no arg-parsing dep). (`package.json` already has a `cli`
  script → `tsx src/cli.ts`.)
- Tests: `src/__tests__/row-mapper.test.ts`, `src/__tests__/importer.test.ts`
  (+ optional `xlsx-parser.test.ts` with a fixture generated via `XLSX.utils`).

## Column → `companies` mapping (42-col Store-Leads/BuiltWith export)
`companyFields`: `domain`=Root Domain (`normalizeDomain`), `companyName`=Company,
`vertical`=Vertical, `employeeCount`=Employees (`parseNumber`), `productCount`=SKU
(`parseNumber`), `country`=Country (upper, 2-letter), `platform`=eCommerce Platform
first line lowercased (`Shopify`→`shopify`), else `"unknown"`.

`signals` (`companySignalsSchema`): `salesRevenue`=Sales Revenue, `technologySpend`=
Technology Spend, `tranco`=Tranco, `pageRank`=Page Rank, `cruxRank`=CRuX Rank,
`socialFollowers`=Social, `marketingAutomation`=Marketing Automation Platform,
`crmPlatform`=CRM Platform, `aiPlatform`=AI, `paymentPlatforms`=Payment Platforms
(all numbers via `parseNumber`, strings trimmed); `firstDetected`=First Detected,
`lastFound`=Last Found, `lastIndexed`=Last Indexed (all via `excelSerialToDate`);
`hasMarketingAutomation`/`hasCrm`/`hasAi` = the corresponding platform cell non-empty.

`contacts` (dedupe via `splitMultiValue`, dedupe by `(type,value)`): Emails→`email`
(first ⇒ `isPrimary`), Telephones→`phone`, People→`person`, and X/Twitter/Facebook/
LinkedIn→`social` (`label`=network).

`source`: `{ source: "store-leads", sourceFile: <basename>, raw: <full row>, importedAt: now }`.

Dropped in P1 (kept only in `source.raw`): Location on Site, Primary Domain,
Majestic, Umbrella, Verified Profiles, City, State, Zip, First Indexed, CMS
Platform, Cloudflare Rank, Agency, Hosting Provider, Exclusion, Compliance.

`hardFilterInput`: `{ domain, country, platform, salesRevenue, productCount }`.

`scoreInput` (`ScoreInput`): `salesRevenue`, `technologySpend`, `productCount`,
**`prominenceRank` = Page Rank** (col 11 — 97/102 coverage; NOT Tranco, only 7/102),
`hasAi`/`hasCrm`/`hasMarketingAutomation` (as above), `hasEmail`/`hasPhone`/
`hasNamedPerson` = respective contact list non-empty, **`lastActivityAt` =
max(lastFound, lastIndexed)** (null if both absent).

## Status + idempotency (locked)
- **Rejected** (hard-filter fail): status `"rejected"`, set `filterReason`, no score.
- **Passed**: score the batch; status `"scored"`; set `score` = latest
  `{ overall, components, reasons, weights: WEIGHTS, scoredAt: now }` and **push**
  one `scoreHistory` entry `{ ...same, createdAt: now }`.
- **Idempotent upsert on `domain`:**
  - `$set`: `signals`, `contacts` (rebuilt+deduped each run), `companyName`,
    `platform`, `country`, `vertical`, `employeeCount`, `productCount`, `score`,
    `filterReason`, `updatedAt`.
  - `$setOnInsert`: `createdAt`, and **`status`** — so re-importing does NOT reset a
    human-advanced lifecycle (e.g. `contacted`) back to `scored`/`rejected`. Document
    this; the initial insert still lands `scored`/`rejected` correctly.
  - `sources`: add a provenance entry only if one with the same `(source,sourceFile)`
    is absent (no duplicate source rows on re-import).
  - `scoreHistory` is append-only (one entry per scored run) — acceptable audit growth.
- Enterprise ceilings stay **default-disabled** (`HARD_FILTER.maxRevenue/maxProductCount = 0`);
  the importer just calls `hardFilter` with the default config.

## Files it MUST NOT modify
- Everything under `src/db/**`, `src/env.ts`, `src/lib/**`, `src/filter/**`,
  `src/score/**`, `src/config.ts`, `src/domain/**` — consume as-is.
- `package.json`, `.env.example`, `pnpm-lock.yaml` — **no dependency changes**.
- `.env` — do NOT create or edit (Tao owns it; the runner passes `MONGODB_URI`).
- Anything under `apps/backend/**` / `apps/frontend/**`.
- Existing tests.

## Dependency changes
**None** (`xlsx` + `mongodb` already installed).

## Validation commands
```bash
pnpm --filter @price-insight/leads exec tsc --noEmit   # expect clean
pnpm --filter @price-insight/leads lint                # expect clean
pnpm --filter @price-insight/leads test                # expect all pass (existing + new)
```
Unit tests must NOT require a live DB — test `row-mapper` (pure) directly, and test
`importer` orchestration against a **fake repository** (inject the repo, or mock
`companies()`), asserting: rejects get `filterReason`+`rejected`; passers get a
score + one history entry; batch percentile scoring is invoked once; dedup works.

e2e (manual, after unit tests pass — uses the local Docker Mongo):
```bash
cd apps/leads
MONGODB_URI="mongodb://127.0.0.1:27017/leads" \
SESSION_SECRET="local-dev-session-secret-at-least-32-chars-long" \
pnpm exec tsx src/cli.ts import ~/workers/doc/data/Shopify_websites_in_Auckland_-_2026-07-10-excel.xlsx
# expect: summary like { total:102, rejected:N, scored:M, byReason:{...} }
# then spot-check: docker exec infra-mongo mongosh leads --quiet --eval \
#   'db.companies.find({},{domain:1,status:1,"score.overall":1,"score.reasons":1}).sort({"score.overall":-1}).limit(5)'
# re-run the same import → counts stable, no duplicate companies/sources/contacts (idempotency)
```

## Edge cases to cover in tests
Empty/header-only file → 0 imported. Missing/blank Root Domain → `no_domain`
reject. Duplicate domain within a file and across two runs → single company, no dup
signals/contacts/sources. Multi-line platform (`"Shopify\nShopify Hong Kong Dollar"`)
→ `shopify`. All-null signals row → no NaN score. Excel serial → correct date;
non-numeric date → null. Large Page Rank (`29221352`) parsed as number.
`lastActivityAt` = max of the two dates (or null).

## Rules
- Do NOT commit or push — leave changes in the worktree for review.
- Keep the core/foundation untouched; only add the import/repo/cli layer.
- Follow existing style (TS strict/ESM, `.js` import specifiers, Zod at boundaries).
- If anything forces you outside scope, STOP and report.

## Completion report format
```
## Agent C — Mongo Importer
### Files changed (created)
- …
### Import pipeline
- parse → map → filter → batch-score → upsert; status + idempotency behaviour
### Validation
- tsc / lint / test: pass/fail (+ list new tests)
### e2e run (local Mongo)
- summary counts { total, rejected, scored, byReason }
- top-5 scored spot-check
- re-run idempotency result (stable counts)
### Contract for Step 5 (Fastify)
- exported `runImport` signature + `ImportSummary` shape
- repository API
### Unresolved issues / assumptions
- …
### git diff --stat
```
```
```
