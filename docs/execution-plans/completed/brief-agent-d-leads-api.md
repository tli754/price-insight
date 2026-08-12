# Agent Brief D — Step 5 Leads API (Fastify over MongoDB, apps/leads)

> Phase 1 dashboard API. Foundation + scoring + importer are merged on
> `feature/lead-scoring` (HEAD `2f1e665f`). Runs in an isolated worktree, in
> parallel with Agent E (frontend, `apps/frontend`) — **no file overlap**; the
> shared API contract is pinned in §"API contract".

## Goal
Stand up the `apps/leads` Fastify HTTP service (referenced by `package.json`'s
`dev`/`start` but not yet created), serving a read/status API over the `companies`
MongoDB collection, protected by the shared `pi-session` cookie. Mirror
`apps/backend` conventions exactly.

## Reuse / mirror (read these; do not modify the backend)
- `apps/backend/src/server.ts` — `loadEnv → buildApp → listen({host:"0.0.0.0", port})`.
- `apps/backend/src/app.ts` — `Fastify({logger:true})`; register `@fastify/cors` `{origin: env.APP_URL, credentials:true}`, `@fastify/cookie`, `@fastify/jwt` `{secret: env.SESSION_SECRET}`; `setErrorHandler` (AppError + ZodError→400, else 500); protected group via a `preHandler`.
- `apps/backend/src/lib/require-session.ts` — copy the pattern: read `pi-session` cookie, `jwt.verify`, 401 on failure.
- `apps/backend/src/lib/app-error.ts` — copy for typed errors.
- `apps/backend/src/routes/auth.ts` — reference only. **Leads does NOT own login** (price-insight backend issues the `pi-session` cookie); leads only *verifies* it with the shared `SESSION_SECRET`.

Leads DB layer (already merged — import, do NOT modify): `connect`/`getDb`/`close`
(`src/db/mongo.js`), `ensureIndexes` (`src/db/indexes.js`), `companies()` +
`companySchema`/`CompanyDoc`/`LIFECYCLE_STATUSES`/`lifecycleStatusSchema`
(`src/db/collections.js`), `loadEnv` (`src/env.js`).

`env` already provides everything needed (`NODE_ENV`, `PORT`=4100, `APP_URL`,
`SESSION_SECRET`, `MONGODB_URI`) — **no env changes, no dependency changes**
(`fastify`, `@fastify/{cookie,cors,jwt}`, `zod`, `mongodb` all present).

## Exact files in scope
Create:
- `src/server.ts` — dotenv + `loadEnv` + `buildApp(env)` + `listen`.
- `src/app.ts` — `buildApp(env)`: Fastify, cors/cookie/jwt, error handler, `await connect()` + `await ensureIndexes(db)` on boot, `onClose → close()`, register health (unprotected) + leads routes (protected group).
- `src/lib/require-session.ts`, `src/lib/app-error.ts` — mirrored from backend.
- `src/routes/health.ts` — `GET /api/health → { ok: true }` (unprotected).
- `src/routes/leads.ts` — the endpoints below (protected).
- Tests: `src/__tests__/leads-routes.test.ts` using `app.inject()` + a **mocked/injected repository** (NO live DB): 401 without cookie, 200 with a token signed via `app.jwt.sign`, list/detail/status happy paths + validation errors.

Modify (merged file, this agent owns apps/leads now):
- `src/repo/company-repository.ts` — add read/query methods to the existing `CompanyRepository`: `list(query)`, `getById(id)`, `updateStatus(id, status)`. Keep `upsertByDomain` intact.

## API contract (PINNED — Agent E builds against this exactly)
All under `/api`, protected by `pi-session`. `id` = Mongo `_id` hex string.
- `GET /api/leads` — query: `status?`, `platform?`, `country?`, `minScore?` (number),
  `sort?` = `score`|`company` (default `score`), `order?` = `asc`|`desc` (default `desc`),
  `page?` (default 1), `pageSize?` (default 25, max 100). Validate with Zod.
  → `{ items: LeadListItem[], total: number, page: number, pageSize: number }`
  where `LeadListItem = { id, domain, companyName, platform, country, vertical,
  status, scoreOverall: number | null, reasons: string[], primaryEmail: string | null }`.
  Default sort = `score.overall` desc; docs without a score sort last.
- `GET /api/leads/:id` → the full `CompanyDoc` (with `id`), 404 if missing.
- `PATCH /api/leads/:id/status` — body `{ status }` validated against
  `LIFECYCLE_STATUSES`; 400 on invalid, 404 if missing → `{ ok: true, status }`.

## Manual-AI trigger — DESIGN NOW, do NOT implement (Phase 3)
Per Tao's decision, AI is **manually triggered** post-crawl (no auto score-gate).
In this brief: **do not build any OpenAI/analyze endpoint** (crawl+AI are P2/P3).
Only **document** the future shape in a code comment in `leads.ts`:
`POST /api/leads/analyze { ids: string[] }` → enqueue selected companies for
OpenAI (Phase 3). `AI_SCORE_THRESHOLD` stays advisory (ranking hint), not a gate.

## Files it MUST NOT modify
- `apps/backend/**`, `apps/frontend/**` (read backend for patterns only).
- `src/db/**`, `src/env.ts`, `src/lib/normalize.ts`, `src/filter/**`, `src/score/**`,
  `src/config.ts`, `src/domain/**`, `src/import/**`, `src/cli.ts` — consume as-is.
- `package.json`, `.env.example`, `pnpm-lock.yaml` (no dep/env changes).
- `.env` (Tao owns it; the runner passes env vars).

## Validation
```bash
pnpm --filter @price-insight/leads exec tsc --noEmit   # clean
pnpm --filter @price-insight/leads lint                # clean
pnpm --filter @price-insight/leads test                # all pass (existing 51 + new route tests, no live DB)
```
Optional manual smoke (local Mongo has 100 companies from the importer e2e):
```bash
cd apps/leads
MONGODB_URI="mongodb://127.0.0.1:27017/leads" SESSION_SECRET="local-dev-session-secret-at-least-32-chars-long" APP_URL="http://localhost:3000" \
  pnpm exec tsx src/server.ts &
# mint a token with the same secret (app.jwt.sign in a tiny script) and curl:
#   GET /api/leads?sort=score&order=desc  → 100 items, top by score
#   PATCH /api/leads/:id/status {status:"contacted"} → ok
```

## Rules
Do NOT commit or push. Do NOT change other apps. Follow TS strict/ESM + `.js`
import specifiers + Zod-at-boundary style. If forced outside scope, STOP and report.

## Completion report format
```
## Agent D — Leads API
### Files changed (created / modified)
### Endpoints implemented (+ the documented-only analyze note)
### Repository methods added
### Validation: tsc / lint / test (+ new tests)
### Smoke (if run): list/detail/status results against local Mongo
### Contract confirmation for Agent E (any deviations from the pinned contract)
### Unresolved issues
### git diff --stat
```
