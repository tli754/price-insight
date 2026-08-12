# Turborepo + pnpm Migration Plan

## Goal

Convert the existing multi-package project into a proper Turborepo-managed monorepo using pnpm workspaces. This enables unified task orchestration (build, dev, test) with caching across all packages.

## Current State

```
price-insight/
├── src/              # Root CLI package (price-insight, price-insight-extract bins)
├── backend/          # TypeScript Fastify API (price-insight-backend)
├── frontend/         # Nuxt 4 + Vue 3 (price-insight-frontend)
├── package.json      # Standalone root (no workspace config)
└── (no lock file)    # npm used but lock files gitignored
```

Each package manages its own `node_modules` independently. No task pipeline exists.

## Target State

```
price-insight/
├── apps/
│   ├── backend/      # Moved from /backend
│   └── frontend/     # Moved from /frontend
├── packages/
│   └── core/         # Moved from /src (CLI tools)
├── turbo.json
├── pnpm-workspace.yaml
├── package.json      # Monorepo root (no app code)
└── pnpm-lock.yaml    # Single lock file for entire repo
```

> **Why restructure into apps/ and packages/?**
> Turborepo convention separates deployable applications (`apps/`) from shared libraries (`packages/`). This makes the dependency graph explicit and enables proper caching.

---

## Migration Steps

### Step 1 — Install pnpm globally

```bash
npm install -g pnpm
pnpm --version  # verify
```

### Step 2 — Restructure directories

Move packages into the conventional Turborepo layout:

```bash
mkdir -p apps packages/core

# Move apps
mv backend apps/backend
mv frontend apps/frontend

# Move core CLI package
mv src packages/core/src
mv tool_call.json packages/core/
mv examples packages/core/
```

Update internal paths:
- `packages/core/package.json` — update bin paths from `./src/cli.js` → `./src/cli.js` (unchanged, just move context)
- `apps/backend/Dockerfile` — update `COPY` paths if they reference root `src/`
- `apps/frontend/Dockerfile` — update `COPY` paths if needed

### Step 3 — Create `pnpm-workspace.yaml` (root)

```yaml
packages:
  - apps/*
  - packages/*
```

### Step 4 — Update root `package.json`

Strip the root of app-specific scripts and make it the monorepo orchestrator:

```json
{
  "name": "price-insight-monorepo",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "devDependencies": {
    "turbo": "latest"
  },
  "packageManager": "pnpm@10.x"
}
```

> Remove the `bin` field and `type: module` from root — those move to `packages/core/package.json`.

### Step 5 — Create `turbo.json` (root)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".nuxt/**", ".output/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "db:generate": {
      "cache": false
    },
    "db:push": {
      "cache": false
    },
    "db:studio": {
      "persistent": true,
      "cache": false
    }
  }
}
```

### Step 6 — Update individual `package.json` files

**`packages/core/package.json`** — rename and fix paths:
```json
{
  "name": "@price-insight/core",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "price-insight": "./src/cli.js",
    "price-insight-extract": "./src/extractor/cli.js"
  },
  "scripts": {
    "test": "node test/core.test.js && node test/extractor.test.js",
    "start": "node src/cli.js examples/sample.json"
  }
}
```

**`apps/backend/package.json`** — add `name` scope:
```json
{
  "name": "@price-insight/backend"
}
```

**`apps/frontend/package.json`** — add `name` scope:
```json
{
  "name": "@price-insight/frontend"
}
```

### Step 7 — Move tests to correct package

Currently `apps/backend/test/` has `core.test.js` and `extractor.test.js` which test root `src/` logic. Move them to `packages/core/test/`:

```bash
mv apps/backend/test packages/core/test
```

Update the test script in `packages/core/package.json` accordingly.

### Step 8 — Delete old `node_modules` and install via pnpm

```bash
# Remove all existing node_modules
find . -name 'node_modules' -type d -prune -exec rm -rf {} +

# Install everything from root — pnpm hoists shared deps and links workspaces
pnpm install
```

This generates a single `pnpm-lock.yaml` at the root.

### Step 9 — Update `.gitignore`

Add pnpm-specific entries:

```gitignore
# pnpm
.pnpm-store/
pnpm-debug.log
```

Remove any `package-lock.json` or `yarn.lock` ignore rules that are no longer relevant.

### Step 10 — Update GitHub Actions workflows

**`.github/workflows/deploy.yml`** and **`codex-review.yml`** — replace npm with pnpm:

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 10

- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'pnpm'

- run: pnpm install --frozen-lockfile

# Replace individual npm run commands with turbo:
- run: pnpm turbo build
- run: pnpm turbo test
```

### Step 11 — Update Dockerfiles

Each app's Dockerfile needs to copy the monorepo context correctly. Example for `apps/backend/Dockerfile`:

```dockerfile
FROM node:22-alpine AS base
RUN npm install -g pnpm turbo

WORKDIR /app

# Copy root workspace files
COPY pnpm-workspace.yaml turbo.json package.json pnpm-lock.yaml ./

# Copy only backend package (prune unused packages)
COPY apps/backend ./apps/backend

# Install only backend dependencies
RUN pnpm install --filter @price-insight/backend --frozen-lockfile

# Build
RUN pnpm turbo build --filter @price-insight/backend
```

> Use `turbo prune` for more efficient Docker layer caching in production:
> ```bash
> turbo prune @price-insight/backend --docker
> ```

---

## Task Pipeline Diagram

```mermaid
graph TD
    A[pnpm install] --> B[turbo build]
    B --> C[@price-insight/core build]
    B --> D[@price-insight/backend build]
    B --> E[@price-insight/frontend build]
    C --> F[turbo test]
    D --> G[turbo dev - backend]
    E --> H[turbo dev - frontend]
```

---

## Key Benefits After Migration

| Before | After |
|---|---|
| No lock file | Single `pnpm-lock.yaml` |
| Independent `node_modules` per package | Hoisted + linked via pnpm |
| Manual per-package `npm run` | `turbo dev/build/test` from root |
| No task caching | Turbo caches build/test outputs |
| npm (slower) | pnpm (faster installs, disk efficient) |

---

## Risk & Rollback

- **Dockerfiles** are the highest-risk change — test builds locally before pushing
- **CI workflows** — test on a feature branch before merging
- Rollback: restore original directory structure from git, delete `turbo.json` and `pnpm-workspace.yaml`

---

## Execution Order Summary

1. Install pnpm globally
2. Create `apps/` and `packages/core/` directories, move code
3. Create `pnpm-workspace.yaml`
4. Update root `package.json` (orchestrator only)
5. Create `turbo.json`
6. Update each package's `package.json` (scoped names)
7. Move `backend/test/` → `packages/core/test/`
8. Delete all `node_modules`, run `pnpm install`
9. Update `.gitignore`
10. Update GitHub Actions workflows
11. Update Dockerfiles
12. Smoke test: `pnpm turbo build`, `pnpm turbo test`, `pnpm turbo dev`
