# Price Insight

[![Build](https://github.com/wd-tools/price-insight/actions/workflows/build.yml/badge.svg)](https://github.com/wd-tools/price-insight/actions/workflows/build.yml)
[![Deploy](https://github.com/wd-tools/price-insight/actions/workflows/deploy.yml/badge.svg)](https://github.com/wd-tools/price-insight/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-10.28.2-orange)](https://pnpm.io)
[![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-blueviolet)](https://turbo.build)
[![GKE](https://img.shields.io/badge/Deploy-GKE%20australia--southeast1-4285F4?logo=google-cloud)](https://cloud.google.com/kubernetes-engine)

> **AI-native eCommerce competitor price monitoring platform** — automated scraping, structured extraction, and intelligent pricing analysis for Shopify merchants.

---

## Overview

Price Insight continuously monitors competitor product listings, extracts structured pricing data using AI, and delivers actionable insights to eCommerce merchants. It compares a merchant's product prices against live competitor data, calculates market position and margin, and surfaces recommendations through a clean dashboard.

**Primary users:** eCommerce operators, buyers, and pricing analysts running Shopify stores.

**Core workflow:**
1. Competitors are configured per product/category
2. Scheduled scraping fetches competitor pages via [Jina Reader](https://jina.ai/reader/) and [SerpAPI](https://serpapi.com/)
3. OpenAI extracts structured pricing data from raw page content
4. Prices are compared using shared logic in `packages/core/`
5. Insights, trends, and alerts surface in the Nuxt dashboard

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 22 |
| pnpm | 10.28.2 |
| MySQL | 8.x |
| Redis | 7.x |
| Docker | (optional, for local containers) |

```bash
# Install pnpm if needed
corepack enable && corepack prepare pnpm@10.28.2 --activate

# Clone and install
git clone https://github.com/wd-tools/price-insight.git
cd price-insight
pnpm install
```

### Environment Setup

```bash
# Backend
cp apps/backend/.env.example apps/backend/.env
# Edit apps/backend/.env — fill in DB, Redis, and API keys

# Frontend
cp apps/frontend/.env.example apps/frontend/.env
# Edit apps/frontend/.env — fill in Google OAuth and session password
```

### Start Development

```bash
pnpm dev   # starts all apps via Turborepo (hot-reload)
```

Frontend → `http://localhost:3000`
Backend API → `http://localhost:3001`

---

## Features

### Current

- 🔍 **Competitor scraping** — fetches product pages via Jina Reader and SerpAPI
- 🤖 **AI extraction** — OpenAI (gpt-4.1-mini) parses raw HTML into structured product/price data
- 📊 **Price comparison** — statistical analysis (percentile, average, min/max) via `packages/core/`
- 🛒 **Shopify integration** — pulls the merchant's own product catalogue via Shopify API
- 🔐 **Google OAuth** — secure login via `nuxt-auth-utils`
- ⚡ **Redis caching** — reduces redundant scraping and API calls
- 🚀 **Kubernetes deployment** — production-grade GKE cluster in `australia-southeast1`
- 🔄 **Automated CI/CD** — GitHub Actions builds images and deploys to GKE on manual trigger

### Planned

- 📈 Historical price trend tracking and charting
- 🔔 Price alert notifications (email / webhook)
- 🗂 Multi-store / multi-brand support
- 📦 Bulk product import and competitor mapping UI
- 📉 Margin optimisation recommendations
- 🌐 Additional retailer integrations beyond Shopify

---

## Architecture

### Frontend — `apps/frontend/`

| Layer | Technology |
|-------|-----------|
| Framework | [Nuxt 4](https://nuxt.com) |
| UI | [@nuxt/ui](https://ui.nuxt.com) |
| Auth | [nuxt-auth-utils](https://github.com/atinux/nuxt-auth-utils) (Google OAuth) |
| Runtime | Node.js / Nitro |

### Backend — `apps/backend/`

| Layer | Technology |
|-------|-----------|
| Framework | [Fastify 5](https://fastify.dev) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Database | MySQL 8 |
| Cache | Redis (ioredis) |
| Validation | [Zod](https://zod.dev) |
| AI | OpenAI API (gpt-4.1-mini) |

### Infrastructure

| Component | Detail |
|-----------|--------|
| Cloud | Google Cloud Platform |
| Orchestration | GKE — `wd-tools-cluster`, `australia-southeast1` |
| Container Registry | Google Artifact Registry (`australia-southeast1-docker.pkg.dev/wd-tools/price-insight/`) |
| Secrets | Google Secret Manager |
| Auth (CI/CD) | Workload Identity Federation |
| IaC | Terraform (`terraform/`) |
| In-cluster Redis | Kubernetes Deployment (`k8s/redis/`) |

### External Services

| Service | Purpose |
|---------|---------|
| [Jina Reader](https://jina.ai/reader/) | Clean web page extraction |
| [SerpAPI](https://serpapi.com/) | Search-based competitor discovery |
| [OpenAI](https://openai.com) | AI price/product extraction (gpt-4.1-mini) |
| Shopify API | Merchant product catalogue sync |
| Google OAuth | User authentication |

---

## Repository Structure

```
price-insight/
├── apps/
│   ├── backend/          # Fastify 5 API — routes, services, Drizzle, business logic
│   └── frontend/         # Nuxt 4 — dashboard UI, Google OAuth, SSR
├── packages/
│   └── core/             # Shared price comparison utilities (used by backend)
├── k8s/
│   ├── backend/          # Kubernetes Deployment, Service manifests
│   ├── frontend/         # Kubernetes Deployment, Service manifests
│   ├── redis/            # In-cluster Redis Deployment + Service
│   ├── ingress/          # Ingress rules
│   └── namespace/        # Namespace definition
├── terraform/            # GCP IAM, Secret Manager, Artifact Registry, GKE config
├── .github/
│   ├── workflows/
│   │   ├── build.yml         # Build & push Docker images to GAR
│   │   ├── deploy.yml        # Deploy to GKE (manual trigger)
│   │   └── codex-review.yml  # AI-assisted PR code review
│   └── k8s/
│       └── migration-job.yaml  # Kubernetes DB migration Job manifest
└── .ai/
    ├── tasks/            # Task files for AI workers
    └── plans/            # Implementation plans
```

---

## Local Development

### Common Commands

```bash
# Install all dependencies
pnpm install

# Start all apps (hot-reload)
pnpm dev

# Build all apps
pnpm build

# Run all tests
pnpm test

# Lint all packages
pnpm lint
```

### Database Commands

Run from `apps/backend/`:

```bash
# Generate a new migration from schema changes
pnpm db:generate

# Push schema changes directly (dev only — bypasses migration files)
pnpm db:push

# Open Drizzle Studio (visual DB browser)
pnpm db:studio
```

### Tips

- Turborepo caches task outputs — run `pnpm turbo run build --force` to bust the cache.
- The backend requires MySQL and Redis to be running before `pnpm dev`.
- Use `NUXT_DEV_AUTH_BYPASS=true` + `NUXT_DEV_AUTH_PASSWORD` to skip Google OAuth locally.

---

## Environment Variables

### Backend — `apps/backend/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | ✅ | `development` or `production` |
| `PORT` | ✅ | Backend port (default `3001`) |
| `APP_URL` | ✅ | Public base URL of the backend |
| `MYSQL_HOST` | ✅ | MySQL host |
| `MYSQL_PORT` | ✅ | MySQL port (default `3306`) |
| `MYSQL_USER` | ✅ | MySQL username |
| `MYSQL_PASSWORD` | ✅ | MySQL password |
| `MYSQL_DATABASE` | ✅ | MySQL database name |
| `DATABASE_URL` | ✅ | Full MySQL connection string (used by Drizzle) |
| `REDIS_HOST` | ✅ | Redis host |
| `REDIS_PORT` | ✅ | Redis port (default `6379`) |
| `REDIS_PASSWORD` | ⚠️ | Redis password (required in production) |
| `REDIS_DB` | | Redis database index (default `0`) |
| `REDIS_TTL_SECONDS` | | Default cache TTL in seconds |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `OPENAI_MODEL` | | OpenAI model name (default `gpt-4.1-mini`) |
| `SHOPIFY_TOKEN_URL` | ✅ | Shopify OAuth token endpoint |
| `SHOPIFY_PRODUCTS_URL` | ✅ | Shopify products API URL |
| `SHOPIFY_CLIENT_ID` | ✅ | Shopify app client ID |
| `SHOPIFY_CLIENT_SECRET` | ✅ | Shopify app client secret |

### Frontend — `apps/frontend/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `NUXT_SESSION_PASSWORD` | ✅ | Secret for encrypting session cookies (min 32 chars) |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `NUXT_PUBLIC_API_URL` | ✅ | Backend API base URL (exposed to browser) |
| `NUXT_DEV_AUTH_BYPASS` | | `true` to skip Google OAuth in local dev |
| `NUXT_DEV_AUTH_PASSWORD` | | Password used when auth bypass is enabled |

> **Never commit real secrets.** Production secrets are managed in Google Secret Manager and synced by `deploy.yml` at deploy time.

---

## Database Strategy

### Technology

- **MySQL 8** managed on GKE (in-cluster or Cloud SQL depending on environment)
- **Drizzle ORM** for type-safe schema definitions and query building
- Migration files are generated by `drizzle-kit` and committed to the repository

### Migration Workflow

1. Modify the Drizzle schema in `apps/backend/src/db/schema/`
2. Run `pnpm db:generate` to produce a new SQL migration file
3. Commit the migration file alongside code changes
4. On deploy, the `db-migrate` Kubernetes Job runs the pending migration **before** the rolling update begins

### Expand-and-Contract Strategy

All schema changes follow the **expand-and-contract** pattern:

- **Expand:** add new columns/tables as nullable or with defaults — old code still runs
- **Migrate data:** backfill or transform as needed (in the migration or a separate job)
- **Contract:** remove deprecated columns/tables only after all consumers are updated

This ensures zero-downtime migrations and safe rollbacks.

### CI/CD Migration Gate

The `deploy.yml` workflow gates the rollout on the migration Job:

```
Apply manifests → Run db-migrate Job → Wait for Job completion → Roll out backend → Roll out frontend
```

Deployments fail fast if the migration fails — protecting production data integrity.

---

## AI Development Workflow

Price Insight uses a structured, human-supervised AI-native development process.

### Pipeline

```
Tony (human)
  │
  ▼
ChatGPT Planner
  │  Produces task files + high-level plan
  ▼
OpenClaw Manager (Claude)
  │  Decomposes tasks, assigns to workers, manages worktrees
  ▼
Claude Workers
  │  Implement features, write tests, produce PRs
  ▼
Testing Worker
  │  Validates implementation, runs lint + tests
  ▼
PR Review (codex-review.yml)
  │  Automated code review via GitHub Actions
  ▼
Human Approval (Tony)
  │  Final review and merge decision
  ▼
main branch
```

### Rules

| Rule | Detail |
|------|--------|
| **No direct main commits** | All changes go through a feature branch and PR |
| **Git worktrees** | Each worker operates in an isolated worktree to avoid conflicts |
| **Investigation before implementation** | Workers read and understand the codebase before writing code |
| **Human approval before merge** | Tony reviews and approves all PRs — no autonomous merges |
| **Task files as spec** | Work is driven by files in `.ai/tasks/` — not ad-hoc prompts |

### AI Prompts

There is no standalone `prompts/` directory — the legacy Jina-Reader + markdown-prompt URL extraction pipeline was removed as dead code. The current AI report system prompt is an inline string constant in `apps/backend/src/services/ai-report-service.ts`, still version-controlled and reviewed like any other source file.

---

## Deployment

### Overview

Deployment is **manually triggered** via GitHub Actions `workflow_dispatch`. There is no automatic deploy on push to `main`.

### Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `build.yml` | Manual | Builds Docker images, pushes to Google Artifact Registry |
| `deploy.yml` | Manual | Applies k8s manifests, syncs secrets, runs migration, rolls out |
| `codex-review.yml` | PR open/update | AI-assisted code review comments |

### Deployment Steps (`deploy.yml`)

```
1. Authenticate via Workload Identity Federation
2. Connect to GKE cluster (wd-tools-cluster, australia-southeast1)
3. Apply Kubernetes namespace and base manifests
4. Sync secrets from Google Secret Manager → Kubernetes Secrets
5. Run db-migrate Job (blocks until complete)
6. Rolling update: backend Deployment
7. Rolling update: frontend Deployment
8. Verify rollout status
```

### Rolling Deployment

Both backend and frontend use Kubernetes `RollingUpdate` strategy with `maxUnavailable: 0` — ensuring zero-downtime deployments. Old pods stay live until new pods pass readiness checks.

### Authentication

CI/CD authenticates to GCP via **Workload Identity Federation** — no long-lived service account keys are stored as GitHub secrets.

```
Workload Identity Pool: projects/920312412888/...
```

### Container Registry

```
australia-southeast1-docker.pkg.dev/wd-tools/price-insight/backend:<tag>
australia-southeast1-docker.pkg.dev/wd-tools/price-insight/frontend:<tag>
```

---

## Engineering Principles

| Principle | Practice |
|-----------|---------|
| **Incremental changes** | Small, focused PRs. One concern per branch. |
| **Explicit typing** | TypeScript strict mode across all packages. Zod for runtime validation. |
| **Package boundaries** | Shared logic lives in `packages/core/`. Apps import from packages — not each other. |
| **Testing expectations** | Unit tests for core logic; integration tests for API routes. CI fails on test failures. |
| **CI validation** | Lint, type-check, and tests run on every PR via GitHub Actions. |
| **Prompt as code** | The AI report system prompt is an inline constant in `ai-report-service.ts`, versioned and reviewed like source code. |
| **Secrets hygiene** | No secrets in code or CI environment variables. All production secrets live in Google Secret Manager. |
| **Expand-and-contract** | All DB migrations are safe to deploy without downtime. |

---

## Documentation

| Document | Location |
|----------|---------|
| Architecture overview | `docs/architecture.md` *(planned)* |
| Deployment runbook | `docs/deployment.md` *(planned)* |
| AI workflow guide | `docs/ai-workflow.md` *(planned)* |
| Tool schema reference | `tool_call.json` |
| AI task files | `.ai/tasks/` |

---

## Current Status & Roadmap

### Status: Active MVP Development

The core scraping, extraction, and comparison pipeline is operational. The platform is deployed to GKE and accessible to internal users.

### Milestones

| Phase | Status | Description |
|-------|--------|-------------|
| **MVP — Core Pipeline** | ✅ In progress | Scraping, AI extraction, price comparison, Shopify sync |
| **MVP — Dashboard** | 🔄 In progress | Nuxt UI with Google OAuth, price comparison views |
| **MVP — Alerts** | 📋 Planned | Email/webhook notifications for price changes |
| **v1 — History & Trends** | 📋 Planned | Store historical prices, trend charts |
| **v1 — Multi-store** | 📋 Planned | Multiple Shopify stores per account |
| **v2 — Recommendations** | 📋 Planned | AI-driven margin optimisation suggestions |

---

## Contributing

This project uses an AI-assisted development workflow. See the [AI Development Workflow](#ai-development-workflow) section for how changes are planned, implemented, and reviewed.

For direct contributions:
1. Create a feature branch from `main`
2. Follow the expand-and-contract pattern for any DB changes
3. Ensure `pnpm lint` and `pnpm test` pass locally
4. Open a PR — automated review runs via `codex-review.yml`
5. Await human approval before merge

---

*Price Insight is an internal tool by [wd-tools](https://github.com/wd-tools). Not open for public contributions at this time.*
