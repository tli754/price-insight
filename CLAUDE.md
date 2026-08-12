# CLAUDE.md

@.claude/skills/planning/SKILL.md
@.claude/skills/implementation/SKILL.md

Guidance for Claude Code working in this repo.

## Rules

- **Git**: ALWAYS ask for confirmation before `git push` or any remote-pushing command.
- **Migrations**: NEVER run `db:push` against staging/production — it desyncs schema from
  `__drizzle_migrations` history. Local only. Shared envs go through `db:generate` → commit
  migration → deploy. Migrations run at **deploy time**, not container start: `dist/server.js`
  does not migrate; the `backend-migrate` Cloud Run Job (`infra/terraform/cloud-run-jobs.tf`,
  runs `dist/db/run-migrations.js`) applies pending migrations before traffic is routed, via
  `.github/workflows/deploy.yml` (CI, primary) or `./infra/deploy-backend.sh` (manual). A migration
  added without going through one of these paths means served code references columns the DB lacks.
- **Diagrams**: ALWAYS use mermaid for architecture diagrams in markdown, never ASCII.

## Commands

Run from repo root unless noted.

```bash
pnpm install / pnpm dev / pnpm build / pnpm test   # workspace-wide, via Turbo
pnpm --filter @price-insight/core test             # core CLI + extractor tests
pnpm --filter @price-insight/backend dev           # Fastify dev server, hot reload
pnpm --filter @price-insight/backend db:generate   # generate Drizzle migration
pnpm --filter @price-insight/frontend dev          # Nuxt dev server, port 3000
```

## Architecture

Turborepo + pnpm workspaces:

```
apps/backend/    @price-insight/backend — Fastify 5 API (TypeScript)
apps/frontend/   @price-insight/frontend — Nuxt 4 + Vue 3 + @nuxt/ui
packages/core/   @price-insight/core — pure-JS price analysis CLI (analyzePrice in src/core.js)
```

**Backend** feeds the `products` table (MySQL + Drizzle, unique index on source URL hash) via
three pipelines: (1) Shopify product sync (`ProductRepository`, no URL-scraping step), (2)
competitor discovery via DataForSEO, resolved async through pingback webhooks in
`routes/webhook.ts` and filtered by `lib/competitor-filter.ts`, (3) AI reports
(`AiReportService`) via OpenAI `chat.completions.parse` with an inline system prompt — there is
no `/prompts` dir, that extraction pipeline is dead/removed.

**Frontend** has no OAuth — a single shared password (`DEV_AUTH_PASSWORD`) issued as a JWT in an
httpOnly `pi-session` cookie via `POST /auth/login`; `auth.global` middleware guards all routes.
Talks to the backend directly (CORS via `APP_URL`), not through a Nuxt server proxy for app logic.

## Environment

Copy `.env.example` in `apps/backend` and `apps/frontend` before starting. Backend needs MySQL,
DataForSEO, and OpenAI creds (Shopify optional, only for sync/webhooks); no Redis. Frontend needs
`NUXT_BACKEND_URL` (defaults to `http://localhost:4000`).
