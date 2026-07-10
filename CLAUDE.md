# CLAUDE.md

@.claude/skills/planning/SKILL.md
@.claude/skills/implementation/SKILL.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

### Git

ALWAYS ask the user for confirmation before running `git push` or any command that pushes to a remote.

### Database migrations

NEVER run `db:push` against any shared environment (staging, production).
`db:push` applies schema without recording in `__drizzle_migrations`, permanently
desynchronising schema state from migration history. Only use `db:push` locally.
All schema changes to shared environments MUST go through `db:generate` → commit migration → deploy.

**Migrations are applied at deploy time, not at container start.** Cloud Run serves
via `node dist/server.js`, which does NOT run migrations. The `backend-migrate`
Cloud Run Job (`infra/terraform/cloud-run-jobs.tf`) runs `dist/db/run-migrations.js`
against Cloud SQL. Both deploy paths apply pending migrations on the new image
BEFORE routing traffic; if a migration fails, the service is NOT deployed:
- **CI (primary):** `.github/workflows/deploy.yml` `deploy-backend` job runs the
  migrate Job (`gcloud run jobs execute backend-migrate --wait`) before `gcloud run deploy`.
- **Local/manual:** `./infra/deploy-backend.sh` build+push → migrate → deploy.

Do not add a new migration without deploying through one of these paths, or the
served code will reference columns the DB does not have (e.g. the `cost` incident).

### Diagrams

ALWAYS use mermaid when creating architecture diagrams in markdown do NOT create ASCII diagrams.


## Commands

### Monorepo root (run from `/srv/price-insight`)
```bash
pnpm install          # Install all workspace dependencies
pnpm dev              # Start all dev servers via Turbo
pnpm build            # Build all packages via Turbo
pnpm test             # Run all tests via Turbo
```

### Core CLI (`/packages/core`)
```bash
pnpm --filter @price-insight/core test   # Run core and extractor tests
```

### Backend (`/apps/backend`)
```bash
pnpm --filter @price-insight/backend dev          # Start Fastify dev server with hot reload
pnpm --filter @price-insight/backend build        # TypeScript compilation
pnpm --filter @price-insight/backend start        # Run compiled dist/server.js
pnpm --filter @price-insight/backend db:generate  # Generate Drizzle migrations
pnpm --filter @price-insight/backend db:studio    # Open Drizzle Studio for DB inspection
```

### Frontend (`/apps/frontend`)
```bash
pnpm --filter @price-insight/frontend dev      # Start Nuxt dev server (port 3000)
pnpm --filter @price-insight/frontend build    # Production build
pnpm --filter @price-insight/frontend preview  # Preview production build
```

## Architecture

The repo is a Turborepo monorepo managed with pnpm workspaces:

```
price-insight/
├── apps/
│   ├── backend/    # @price-insight/backend — Fastify API
│   └── frontend/   # @price-insight/frontend — Nuxt 4
└── packages/
    └── core/       # @price-insight/core — CLI tools
```

### Core (`/packages/core`)
A pure JavaScript, JSON-in/JSON-out price analysis library. `analyzePrice(payload)` in `src/core.js` is the single entry point — it normalizes input, computes statistical position (percentile, average, median) against `reference_prices`, and returns a recommendation with optional margin analysis when `cost` is provided. Exports two CLI bins (`price-insight`, `price-insight-extract`). `tool_call.json` documents the schema for LLM function-calling hosts.

### Backend (`/apps/backend`)
A TypeScript Fastify 5 API server. Three pipelines feed the `products` table and its related data:

1. **Product import** — `POST /api/products/sync` (or `/products/import`) pulls products from Shopify via `ShopifyService` and upserts them through `ProductRepository`. There is no URL-scraping/extraction step; products come directly from Shopify's API.
2. **Competitor discovery** — `POST /api/products/find-competitors` (and `CompetitorAnalysisService.searchAndSuggest`) submit search/product-lookup tasks to `DataForSeoService`. Results land asynchronously via the DataForSEO pingback webhooks in `apps/backend/src/routes/webhook.ts`, filtered by `apps/backend/src/lib/competitor-filter.ts` (NZ/AU + price-range match) and persisted via `CompetitorRepository`.
3. **AI reports** — `POST /api/products/:id/reports/ai` (`AiReportService`) builds a payload from the product, its saved competitors, and sales history, then calls OpenAI's `chat.completions.parse` with a Zod response schema (`zodResponseFormat`). The system prompt is an inline string constant in `ai-report-service.ts` — there is no `/prompts` directory; that legacy Jina-Reader + markdown-prompt extraction pipeline was removed as dead code.

Database is MySQL + Drizzle ORM. The `products` table has a unique index on source URL hash to prevent duplicates. Schema is in `apps/backend/src/db/schema.ts`.

### Frontend (`/apps/frontend`)
Nuxt 4 + Vue 3 + `@nuxt/ui` (Tailwind CSS v4). No Google OAuth at this stage — authentication is a single shared password: the backend's `POST /auth/login` (`apps/backend/src/routes/auth.ts`) checks it against `DEV_AUTH_PASSWORD` and issues a JWT in an httpOnly `pi-session` cookie. The `auth.global` middleware (`apps/frontend/app/middleware/auth.global.ts`) protects all routes except `/login` by calling `/auth/session`, which Nuxt's `routeRules` proxies to the backend (`/auth/**` → `NUXT_BACKEND_URL`). The backend API is a separate process — the frontend calls it directly (CORS allowed via `APP_URL` env var on the backend).

## Environment Setup

Copy `.env.example` in each app before starting:

**Backend** (`/apps/backend/.env`) requires: MySQL connection, `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`/`DATAFORSEO_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`. Shopify credentials (`SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET`/etc.) are optional but required for product sync and webhooks. There is no Redis dependency.

**Frontend** (`/apps/frontend/.env`) requires: `NUXT_BACKEND_URL` (backend origin, proxied for `/api/**` and `/auth/**` route rules; defaults to `http://localhost:4000`).