# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (price analysis CLI)
```bash
npm test              # Run tests for core and extractor modules (Node.js native test runner)
npm start             # Run price analysis CLI with sample data
npm run extract:sample  # Run extractor CLI against sample reader output
```

### Backend (`/backend`)
```bash
npm run dev           # Start Fastify dev server with hot reload (tsx watch)
npm run build         # TypeScript compilation
npm run start         # Run compiled dist/server.js
npm run db:generate   # Generate Drizzle migrations
npm run db:push       # Apply migrations to database
npm run db:studio     # Open Drizzle Studio for DB inspection
```

### Frontend (`/frontend`)
```bash
npm run dev           # Start Nuxt dev server (port 3000)
npm run build         # Production build
npm run preview       # Preview production build
```

## Architecture

The repo contains three independent packages plus shared prompts:

### Core (`/src`)
A pure JavaScript, JSON-in/JSON-out price analysis library. `analyzePrice(payload)` in `src/core.js` is the single entry point — it normalizes input, computes statistical position (percentile, average, median) against `reference_prices`, and returns a recommendation with optional margin analysis when `cost` is provided. The root `package.json` exports two CLI bins (`price-insight`, `price-insight-extract`). `tool_call.json` documents the schema for LLM function-calling hosts.

### Backend (`/backend`)
A TypeScript Fastify 5 API server. The extraction pipeline is the core concern:

1. `POST /api/products/extract` receives a URL
2. **ExtractorService** checks Redis (24h TTL) → calls **JinaReaderService** (`https://r.jina.ai/{url}`) on cache miss → sends content to **OpenAIExtractorService** → stores in MySQL via **ProductRepository**
3. OpenAI uses the Responses API with `json_schema` structured output, loaded from `/prompts/`
4. On parse failure, a single retry with `prompts/extractor-repair.md` is attempted
5. Returns HTTP 201 on new extraction, 200 on cached result

Database is MySQL + Drizzle ORM. The `products` table has a unique index on source URL hash to prevent duplicates. Schema is in `backend/src/db/schema.ts`.

### Frontend (`/frontend`)
Nuxt 4 + Vue 3 + `@nuxt/ui` (Tailwind CSS v4). Authentication is Google OAuth via `nuxt-auth-utils`. The `auth` middleware protects all routes except `/login`. The OAuth callback handler lives in `frontend/server/routes/auth/google.get.ts`. The backend API is a separate process — the frontend calls it directly (CORS allowed via `APP_URL` env var on the backend).

### Prompts (`/prompts`)
Five markdown files drive the LLM extraction:
- `extractor-system.md` + `extractor-user.md` — system/user prompt pair (user prompt uses `{{SOURCE_URL}}` and `{{READER_CONTENT}}` placeholders)
- `extractor.md` — extraction contract (fields, rules, JSON format)
- `extractor-validation.md` — optional secondary validation
- `extractor-repair.md` — fallback to repair malformed JSON (one retry)

See `prompts/README.md` for the recommended full flow.

## Tech Stack

| Layer | Technology |
|---|---|
| Core | Node.js (ESM), plain JavaScript |
| Backend | TypeScript, Fastify 5, Drizzle ORM 0.44, Zod 3, ioredis 5 |
| Database | MySQL 8 (Cloud SQL in prod), Redis (in-cluster in prod) |
| AI / extraction | OpenAI SDK 5 (Responses API, `json_schema` structured output) |
| Frontend | Nuxt 4, Vue 3, `@nuxt/ui` 4 (Tailwind CSS v4), `nuxt-auth-utils` |
| Auth | Google OAuth 2.0 |
| Infrastructure | GCP — GKE (Kubernetes), Cloud SQL, Google Secret Manager, Cloud SQL Auth Proxy sidecar |
| IaC | Terraform ≥ 1.5, Google provider ~6.0, state in GCS (`wd-tools-tfstate`) |
| CI/CD | GitHub Actions — separate manual build and deploy workflows; secrets injected from GSM on every deploy |

## Infrastructure

Deployment targets a GKE cluster (`price-insight`, zone `australia-southeast1-a`). Traffic flows:

```
Internet → GCE Load Balancer (Ingress)
             ├── /api → backend (port 4000)
             │           ├── Fastify container
             │           └── cloud-sql-proxy sidecar → Cloud SQL MySQL
             └── /    → frontend (port 3000, Nuxt SSR)

backend → Redis (in-cluster, port 6379)
```

Terraform manages GCP IAM and secrets (`/terraform`). Kubernetes manifests are in `/k8s`. See [`k8s/README.md`](k8s/README.md) for cluster bootstrap steps.

## Environment Setup

Copy `.env.example` in each package before starting:

**Backend** requires: MySQL connection, Redis connection, `OPENAI_API_KEY`, `OPENAI_MODEL`. Optional: `JINA_API_KEY` (higher rate limits), `SERPAPI_API_KEY`.

**Frontend** requires: `NUXT_SESSION_PASSWORD` (32+ char string), `NUXT_OAUTH_GOOGLE_CLIENT_ID`, `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`. Google OAuth callback URL: `http://localhost:3000/auth/google`.