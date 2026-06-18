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
├── packages/
│   └── core/       # @price-insight/core — CLI tools
└── prompts/        # LLM prompt templates (shared)
```

### Core (`/packages/core`)
A pure JavaScript, JSON-in/JSON-out price analysis library. `analyzePrice(payload)` in `src/core.js` is the single entry point — it normalizes input, computes statistical position (percentile, average, median) against `reference_prices`, and returns a recommendation with optional margin analysis when `cost` is provided. Exports two CLI bins (`price-insight`, `price-insight-extract`). `tool_call.json` documents the schema for LLM function-calling hosts.

### Backend (`/apps/backend`)
A TypeScript Fastify 5 API server. The extraction pipeline is the core concern:

1. `POST /api/products/extract` receives a URL
2. **ExtractorService** checks Redis (24h TTL) → calls **JinaReaderService** (`https://r.jina.ai/{url}`) on cache miss → sends content to **OpenAIExtractorService** → stores in MySQL via **ProductRepository**
3. OpenAI uses the Responses API with `json_schema` structured output, loaded from `/prompts/`
4. On parse failure, a single retry with `prompts/extractor-repair.md` is attempted
5. Returns HTTP 201 on new extraction, 200 on cached result

Database is MySQL + Drizzle ORM. The `products` table has a unique index on source URL hash to prevent duplicates. Schema is in `apps/backend/src/db/schema.ts`.

### Frontend (`/apps/frontend`)
Nuxt 4 + Vue 3 + `@nuxt/ui` (Tailwind CSS v4). No Google OAuth at this stage — authentication is a single shared password: the backend's `POST /auth/login` (`apps/backend/src/routes/auth.ts`) checks it against `DEV_AUTH_PASSWORD` and issues a JWT in an httpOnly `pi-session` cookie. The `auth.global` middleware (`apps/frontend/app/middleware/auth.global.ts`) protects all routes except `/login` by calling `/auth/session`, which Nuxt's `routeRules` proxies to the backend (`/auth/**` → `NUXT_BACKEND_URL`). The backend API is a separate process — the frontend calls it directly (CORS allowed via `APP_URL` env var on the backend).

### Prompts (`/prompts`)
Five markdown files drive the LLM extraction:
- `extractor-system.md` + `extractor-user.md` — system/user prompt pair (user prompt uses `{{SOURCE_URL}}` and `{{READER_CONTENT}}` placeholders)
- `extractor.md` — extraction contract (fields, rules, JSON format)
- `extractor-validation.md` — optional secondary validation
- `extractor-repair.md` — fallback to repair malformed JSON (one retry)

See `prompts/README.md` for the recommended full flow.

## Environment Setup

Copy `.env.example` in each app before starting:

**Backend** (`/apps/backend/.env`) requires: MySQL connection, Redis connection, `OPENAI_API_KEY`, `OPENAI_MODEL`.

**Frontend** (`/apps/frontend/.env`) requires: `NUXT_BACKEND_URL` (backend origin, proxied for `/api/**` and `/auth/**` route rules; defaults to `http://localhost:4000`).