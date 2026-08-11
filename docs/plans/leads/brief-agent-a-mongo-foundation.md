# Agent Brief A — MongoDB Foundation Swap (apps/leads)

## Goal
Convert `apps/leads` from the committed MySQL/Drizzle data layer to **MongoDB
Atlas only**. Remove all MySQL/Drizzle artifacts; add a native `mongodb` driver
connection, **Zod** document schemas + typed collection accessors, an index-setup
routine, and a Zod-validated env loader. **Leads is Mongo-only and FINAL.**

Runs in an isolated git worktree off `feature/lead-scoring`. No live MongoDB is
available — code must typecheck/lint/test **without connecting to a server**.

## Exact files in scope
Delete:
- `apps/leads/src/db/schema.ts`
- `apps/leads/drizzle.config.ts`

Create:
- `apps/leads/src/db/mongo.ts` — client factory: `connect()/getDb()/close()` over the native `mongodb` driver; reads `MONGODB_URI` from the env loader; lazy singleton; no top-level connect.
- `apps/leads/src/db/collections.ts` — **Zod** schemas + inferred TS types + `COLLECTIONS` name constants + typed accessors (`companies()`, `crawlSnapshots()`, `aiAnalyses()`). Define the document schemas **standalone** (do NOT import from `src/domain/types.ts` — keep persistence decoupled from the scoring types).
- `apps/leads/src/db/indexes.ts` — `ensureIndexes(db)`: unique on `companies.domain`; non-unique on `companies.status`, `companies.score.overall` (desc), `companies.platform`, `companies.country`.
- `apps/leads/src/env.ts` — `loadEnv()` using `dotenv` + Zod: `NODE_ENV`, `PORT`, `APP_URL`, `SESSION_SECRET`, `MONGODB_URI`. (Note: put it at `src/env.ts`, NOT `src/config/env.ts` — `src/config.ts` already exists as a file and would clash with a `config/` dir.)
- `apps/leads/src/__tests__/company-schema.test.ts` — Zod parse tests: a valid `companies` document passes; missing `domain` fails; bad `status` fails; embedded `score.components` shape validates.

Modify:
- `apps/leads/package.json` — deps/scripts (see Dependency changes).
- `apps/leads/.env.example` — remove `LEADS_MYSQL_*` and `LEADS_DATABASE_URL`; add `MONGODB_URI=mongodb+srv://...`; keep `SESSION_SECRET`, `PORT`, `APP_URL`, `NODE_ENV`.
- `pnpm-lock.yaml` — will update when you run `pnpm install` (expected; it is a lockfile, not source).

## `companies` document schema (authoritative shape for the importer)
```
{
  domain: string,                 // unique key, lowercased bare host
  companyName?: string,
  platform: string,               // default "unknown"
  country?: string,               // 2-letter
  vertical?: string,
  employeeCount?: number,
  productCount?: number,
  status: LifecycleStatus,        // enum below, default "imported"
  filterReason?: string | null,
  signals: {
    salesRevenue?: number, technologySpend?: number, tranco?: number,
    pageRank?: number, cruxRank?: string, socialFollowers?: number,
    marketingAutomation?: string, hasMarketingAutomation: boolean,
    crmPlatform?: string, hasCrm: boolean, aiPlatform?: string, hasAi: boolean,
    paymentPlatforms?: string,
    firstDetected?: Date, lastFound?: Date, lastIndexed?: Date
  },
  contacts: Array<{ type: "email"|"phone"|"person"|"social", value: string,
                    label?: string, isPrimary: boolean }>,
  sources: Array<{ source: string, sourceFile?: string,
                   raw?: Record<string, unknown>, importedAt: Date }>,
  score?: { overall: number, components: { value: number, gap: number,
            reach: number, recency: number }, reasons: string[],
            weights: Record<string, number>, scoredAt: Date },
  scoreHistory: Array<{ overall: number, components: {...}, reasons: string[],
                        weights: Record<string, number>, createdAt: Date }>,
  latestCrawlSnapshotId?: string,   // ref into crawl_snapshots (P2)
  latestAiAnalysisId?: string,      // ref into ai_analyses (P3)
  lastCrawledAt?: Date,
  createdAt: Date, updatedAt: Date
}
```
`LifecycleStatus` enum (from the MVP spec — use these exact lowercase-ish tokens,
your call on casing but be consistent and document it):
`new, imported, filtered, qualified, queued, crawling, crawled, scored,
ai_analysed, ready, contacted, meeting, customer, rejected, archived, failed`.

`crawl_snapshots` and `ai_analyses`: define **minimal** Zod schemas (at least
`companyId`/`domain`, `createdAt`, and an open `data` object) — they are populated
in P2/P3, so keep them permissive but present.

## Files it MUST NOT modify
- `apps/leads/src/config.ts`, `src/score/score.ts`, `src/filter/hard-filter.ts`, `src/domain/types.ts` — **owned by the parallel ICP-scoring agent.**
- `apps/leads/src/lib/normalize.ts` — shared pure core; keep byte-for-byte stable.
- Anything under `apps/backend/**` or `apps/frontend/**`.
- Existing tests `normalize.test.ts`, `hard-filter.test.ts`, `score.test.ts`.
- No importer/repository/CLI/server code (that is the next, separate phase).

## Dependency changes
- ADD: `mongodb` (^6.x) to `dependencies`.
- REMOVE from `dependencies`: `drizzle-orm`, `mysql2`.
- REMOVE from `devDependencies`: `drizzle-kit`.
- REMOVE scripts: `db:generate`, `db:studio`. (Leave `dev`/`build`/`start`/`cli`/`test`/`lint`.)
- Keep `zod`, `dotenv`, fastify/* (untouched this phase).
- Run `pnpm install` in the worktree to refresh `pnpm-lock.yaml`.

## Validation commands (all must pass; no live DB)
```bash
pnpm --filter @price-insight/leads exec tsc --noEmit   # expect: clean, exit 0
pnpm --filter @price-insight/leads lint                # expect: clean, exit 0
pnpm --filter @price-insight/leads test                # expect: all pass (existing + new schema tests)
# Prove the MySQL layer is fully gone:
grep -rEi "drizzle|mysql2|LEADS_DATABASE_URL|LEADS_MYSQL" apps/leads/src apps/leads/*.ts apps/leads/*.json ; echo "exit=$?"  # expect: no matches
```

## Rules
- Do NOT commit or push. Leave changes in the worktree for Tao to review.
- Do NOT touch other apps. Do NOT add a live-DB dependency in tests (no `mongodb-memory-server`).
- If something forces you outside this scope, stop and report instead of guessing.

## Completion report format
```
## Agent A — MongoDB Foundation
### Files changed
- created: …
- modified: …
- deleted: …
### Dependency changes
- added / removed …
### Validation
- tsc: pass/fail
- lint: pass/fail
- test: N passed (list new tests)
- residual-MySQL grep: clean/matches
### Contract for the importer
- `companies` document shape + LifecycleStatus casing actually used
- exported accessors/functions the importer should call (names + signatures)
- ensureIndexes behaviour
### Unresolved issues / assumptions
- …
### git diff --stat
```
```
```
