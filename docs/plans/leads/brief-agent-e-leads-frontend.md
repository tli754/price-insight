# Agent Brief E — Step 6 Leads Dashboard (Nuxt frontend, apps/frontend)

> Phase 1 dashboard UI. Runs in an isolated worktree, in parallel with Agent D
> (leads API, `apps/leads`) — **no file overlap** (different app). Build against
> the PINNED API contract below; full e2e wiring happens after both merge.

## Goal
Add a "Leads" tab and a ranked `/leads` dashboard to the shared Nuxt frontend,
listing scored companies (score-desc) with status control, reusing the existing
`pi-session` auth. Proxy the leads API through Nitro `routeRules`.

## Reuse / mirror (read for the exact idiom)
- `apps/frontend/nuxt.config.ts` — `routeRules` proxy pattern (`/api/**`, `/auth/**` → backend).
- `apps/frontend/app/components/AppNav.vue` — nav items array + `UNavigationMenu`.
- `apps/frontend/app/pages/insight.vue` — `@nuxt/ui` `UTable` (`columns` with `accessorKey`/`header`), `UBadge`, `formatDate`, `en-NZ` locale idiom.
- `apps/frontend/app/middleware/auth.global.ts` — already protects every non-`/login` route via `/auth/session`; `/leads` is covered automatically (no change needed).

Tech: Nuxt 4 + Vue 3 + `@nuxt/ui` (Tailwind v4). No new dependencies.

## Exact files in scope
Modify:
- `apps/frontend/nuxt.config.ts` — add a leads proxy rule. At top:
  `const leadsUrl = process.env.NUXT_LEADS_URL ?? "http://localhost:4100"`, then in
  `routeRules` add `"/leads-api/**": { proxy: \`${leadsUrl}/api/**\` }`. (Auth stays
  via the existing `/auth/**` → price-insight backend; the proxy forwards the
  `pi-session` cookie, which the leads service verifies with the shared secret.)
- `apps/frontend/app/components/AppNav.vue` — append `{ label: 'Leads', to: '/leads' }` to `items` (right of `Insight`).

Create:
- `apps/frontend/app/pages/leads/index.vue` — ranked table. Fetch
  `/leads-api/leads?sort=score&order=desc&page=..&pageSize=..` (via `useFetch`/`$fetch`;
  use `useRequestFetch` on server like `auth.global`). Columns: **Score** (`scoreOverall`,
  show `—` when null; `UBadge` colour by band e.g. ≥80 success / 60–79 warning /
  else neutral), **Company** (`companyName` + `domain` subtitle), **Vertical**,
  **Reasons** (join `reasons`, truncated), **Email** (`primaryEmail` or `—`),
  **Status** (`USelect` bound to `LIFECYCLE_STATUSES` → `PATCH /leads-api/leads/:id/status`).
  Pagination via `UPagination` using `total`/`page`/`pageSize`. Loading + empty states.
- `apps/frontend/app/pages/leads/[id].vue` (optional but preferred) — detail: signals,
  contacts, and the score breakdown (`components` + `reasons`). Fetch `/leads-api/leads/:id`.
- `apps/frontend/shared/types/lead.ts` — TS types matching the API contract
  (`LeadListItem`, `LeadListResponse`, lifecycle status union).

## PINNED API contract (from Agent D — build to this exactly)
Proxied base: `/leads-api/**` → leads service `/api/**`.
- `GET /leads-api/leads?status&platform&country&minScore&sort=score|company&order=asc|desc&page&pageSize`
  → `{ items: LeadListItem[], total, page, pageSize }`,
  `LeadListItem = { id, domain, companyName, platform, country, vertical, status,
  scoreOverall: number | null, reasons: string[], primaryEmail: string | null }`.
- `GET /leads-api/leads/:id` → full company document.
- `PATCH /leads-api/leads/:id/status` body `{ status }` → `{ ok: true, status }`.
Lifecycle status set: `new, imported, filtered, qualified, queued, crawling,
crawled, scored, ai_analysed, ready, contacted, meeting, customer, rejected,
archived, failed`.

## Manual-AI trigger — DESIGN IN, but DEFERRED (Phase 3)
Per Tao's decision AI is manually triggered post-crawl. Build the **selection shell**
now, but do NOT wire a real AI call:
- Add a row-selection column (checkboxes) + a toolbar **"Send to AI"** button that is
  **disabled** with a tooltip "Available after crawl (Phase 3)".
- Add a code comment: when P3 lands, the button POSTs the selected `ids` to
  `/leads-api/leads/analyze`. Do not implement that call now.
Keep it visually clear this is a future action; the Phase-1 dashboard is list + status.

## Files it MUST NOT modify
- `apps/leads/**`, `apps/backend/**`.
- Unrelated frontend pages/components (`insight.vue`, `competitor-products.vue`, `login.vue`, `PricePositionBar.vue`, etc.) — read for patterns, don't edit.
- No dependency changes; no `.env` edits (document `NUXT_LEADS_URL` in your report, don't create `.env`).

## Validation
```bash
pnpm --filter @price-insight/frontend exec nuxi typecheck   # or vue-tsc — clean
pnpm --filter @price-insight/frontend lint                  # clean
pnpm --filter @price-insight/frontend build                 # succeeds
```
Full click-through e2e needs the leads service running (Agent D) — out of scope
here; note it as a post-merge manual step. If you can, do a `nuxi dev` boot check
that `/leads` renders its loading/empty state without runtime errors (the proxy
will 502 until the leads service runs — that's expected).

## Rules
Do NOT commit or push. Do NOT touch `apps/leads`/`apps/backend`. Match the existing
Vue/@nuxt/ui style. If forced outside scope, STOP and report.

## Completion report format
```
## Agent E — Leads Dashboard
### Files changed (created / modified)
### Nav + proxy wiring (NUXT_LEADS_URL note)
### Dashboard columns + status control + AI-select shell (disabled)
### Validation: typecheck / lint / build
### Assumptions / deviations from the pinned contract
### Unresolved issues
### git diff --stat
```
