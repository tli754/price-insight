# Repository Structure

Turborepo monorepo managed with pnpm workspaces. `pnpm-workspace.yaml` declares
`apps/*` and `packages/*`; `turbo.json` defines the task graph; root
`package.json` pins `pnpm@10.28.2` and exposes `dev/build/test/lint` → `turbo`.

```
price-insight/
├── apps/
│   ├── backend/     @price-insight/backend  — Fastify 5 API (TypeScript, ESM)
│   └── frontend/    @price-insight/frontend — Nuxt 4 dashboard (Vue 3)
├── packages/
│   └── core/        @price-insight/core     — pure-JS price analysis + CLI bins
├── infra/terraform/ Cloud Run + Cloud SQL + LB + IAM (authoritative infra)
├── infra/deploy-backend.sh  local/manual deploy mirroring CI
├── k8s/             LEGACY GKE manifests (not the current deploy path)
├── .github/workflows/  build.yml, deploy.yml, infra-terraform*.yml
├── scripts/         test-db-connection.ps1
├── CLAUDE.md · AGENTS.md · README.md
```

## Turborepo task graph (`turbo.json`)

- `build` depends on `^build` (upstream packages first); outputs
  `dist/**`, `.nuxt/**`, `.output/**`.
- `dev` is persistent, uncached, also `^build` first.
- `test` depends on `^build`. `db:generate` / `db:push` / `db:studio` are
  uncached; `db:studio` is persistent.

## Backend layout (`apps/backend/src/`)

| Dir | Responsibility | Examples |
|-----|----------------|----------|
| `routes/` | HTTP handlers, one plugin per area | `products.ts`, `orders.ts`, `analysis.ts`, `reports.ts`, `auth.ts`, `dataforseo-webhook.ts`, `shopify-webhook.ts`, `internal-sync.ts`, `internal-competitor.ts`, `health.ts`, `shopify.ts` |
| `services/` | Integrations + orchestration + repositories | `dataforseo-service.ts`, `shopify-service.ts`, `shopify-graphql-service.ts`, `ai-report-service.ts`, `competitor-analysis-service.ts`, `cloud-tasks-*.ts`, `*-repository.ts`, `serp-api-service.ts` (legacy) |
| `lib/` | Pure helpers | `app-error.ts`, `competitor-filter.ts`, `price-analysis.ts`, `nz-date-range.ts`, `order-mapper.ts`, `shopify-hmac.ts`, `verify-oidc.ts`, `require-session.ts` |
| `db/` | Drizzle schema, connection, migration runner | `schema.ts`, `index.ts`, `run-migrations.ts` |
| `schemas/` | Zod request schemas | `product.ts`, `competitor.ts` |
| `config/` | Zod-validated env | `env.ts` |
| `types/` | Shared types + Fastify decorator typings | `ai-report.ts`, `fastify.d.ts` |
| `scripts/` | One-off maintenance scripts (run via `tsx`, or the `backend-script-runner` Job) | `sync-products.ts`, `load-recent-orders.ts`, `drain-dataforseo-backlog.ts`, `find-all-competitors.ts`, `investigate-dataforseo.ts`, `investigate-serp.ts` |
| `__tests__/` | Vitest suites + helpers | `*.test.ts`, `helpers/build-app.ts`, `helpers/mock-db.ts` |

Two process entrypoints: `server.ts` (full API) and `order-worker-server.ts`
(narrow `/internal/*` worker). Both compile to `dist/` via `tsc`.

## Frontend layout (`apps/frontend/`)

| Path | Contents |
|------|----------|
| `app/pages/` | Route pages: `products/`, `competitors/`, `orders/`, `competitor-products.vue`, `insight.vue`, `login.vue` |
| `app/components/` | `AppNav.vue`, `PricePositionBar.vue`, `SalesBarChart.vue`, `product/DecisionSummary.vue` |
| `app/middleware/` | `auth.global.ts` — session guard on every route except `/login` |
| `app/utils/` | `api-error.ts`, `currency.ts`, `inventory.ts`, `stats.ts` |
| `app/data/` | `mock-orders.ts`, `mock-queue.ts` (mock UI data) |
| `shared/types/` | Shared TS types (`product.ts`, `competitor.ts`, `order.ts`, `ai-report.ts`, `auth.d.ts`, `mock-*.ts`) |
| `server/api/` | `health.ts` (only Nitro server route) |
| `nuxt.config.ts` | route rules/proxy, `@nuxt/ui`, icon endpoint fix |

## Core package (`packages/core/`)

Pure JavaScript (no build). `src/core.js` exports `analyzePrice`; `bin` exposes
`price-insight` (`src/cli.js`) and `price-insight-extract`
(`src/extractor/cli.js`). `src/extractor/` (incl. `jinaReader.js`) is legacy and
not used by the apps. Tests run via `node test/*.test.js`.
