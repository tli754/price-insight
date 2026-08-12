# Plan: Retire Gateway — Fold Auth/CORS into Backend (PR 1 of 3)

## 1. Summary

Move `apps/gateway`'s CORS, cookie, JWT, and password-auth routes (`/auth/login`, `/auth/logout`, `/auth/session`) into `apps/backend`, preserving the existing `/auth/*` contract and cookie semantics exactly. Update the frontend's local-dev proxy to target the backend directly instead of the gateway. This is app-code only — no Terraform, no Kubernetes, no GKE deploy. `apps/gateway` itself is deleted in PR 3, after Cloud Run (PR 2) is validated.

This is PR 1 of a 3-PR split (approved direction):
- PR 1 (this plan): move gateway auth/cookie/JWT/CORS into backend; preserve `/auth/*` contracts; add tests.
- PR 2: create Cloud Run infrastructure and routing (single custom domain + GCLB path routing: `/` → frontend, `/api/*` `/auth/*` `/webhooks/*` → backend) via Terraform; deploy frontend and updated backend.
- PR 3: remove `apps/gateway`, Kubernetes gateway resources, and obsolete build/deploy steps after Cloud Run validation.

GKE is already shut down — none of these PRs are deployed through the existing Kubernetes workflow.

## 2. Current Implementation

- **Gateway** (`apps/gateway/src/app.ts`): registers `@fastify/cors` (origin = `FRONTEND_URL`), `@fastify/cookie`, `@fastify/jwt` (secret = `SESSION_SECRET`), `@fastify/reply-from` (proxies `/api/*` → `BACKEND_URL`). Mounts `authRoutes` (`apps/gateway/src/routes/auth.ts`): a single shared `DEV_AUTH_PASSWORD` (client sends SHA-256 hash, compared server-side) issues a 7-day JWT in an httpOnly `pi-session` cookie. `/auth/session` verifies the cookie and returns `{ loggedIn, user }`.
- **Backend** (`apps/backend/src/app.ts`): Fastify 5, no CORS/cookie/JWT deps today. All routes registered with `prefix: "/api"` except `webhookRoutes` / `shopifyWebhookRoutes` (mounted at root — matches the planned `/webhooks/*` LB rule from PR 2).
- **Frontend**: `auth.global.ts` and `login.vue` call `/auth/session`, `/auth/login`, `/auth/logout` directly (relative URLs — same-origin in prod via Ingress). `nuxt.config.ts` only proxies these paths in **local dev** via `routeRules` → `NUXT_GATEWAY_URL` (default `http://localhost:4001`). In production, `k8s/ingress.yaml` already routes `/api` and `/auth` straight to the `gateway` Service — frontend's proxy rule is dev-only.
- Confirmed dead code found during investigation (no functional change needed, just noting): `frontend-nuxt-dev-auth-password` secret and `NUXT_API_URL`/`NUXT_DEV_AUTH_BYPASS` env vars in `apps/frontend/.env.example` are unused — leftover from before the gateway existed, superseded by the planned Google OAuth (nuxt-auth-utils) stage. Not touched in this PR.

## 3. Affected Areas

- Frontend: Yes — `nuxt.config.ts` proxy target only (no page/middleware changes; `/auth/*` contract is unchanged).
- Backend: Yes — new deps, new plugin registrations, new route file, env schema additions.
- Database: No
- Queue/jobs: No
- External APIs: No
- Tests: Yes — new auth route tests in backend; gateway's tests (none exist today) are not migrated since there were none.
- Config/infra: Env var additions only (`SESSION_SECRET`, `DEV_AUTH_PASSWORD`, CORS origin) — no Terraform/K8s changes in this PR.

## 4. Risks

- **Cookie compatibility**: if `pi-session` JWT signing changes shape (algorithm, claims), existing logged-in sessions break. Mitigate by porting `routes/auth.ts` verbatim, same `@fastify/jwt` config.
- **CORS regression**: backend has never had CORS; if origin config is wrong, local cross-origin dev breaks (prod is same-origin via Ingress, so lower risk there).
- **Env var drift**: `SESSION_SECRET`/`DEV_AUTH_PASSWORD` must be added to backend's `env.ts` (zod schema) — a missing var fails fast at boot, which is good, but the CI/CD secret injection (`deploy.yml`) and `backend-secrets` k8s Secret aren't updated in this PR since we're not deploying to GKE. Document this clearly so it isn't accidentally deployed half-wired.
- **Frontend dev workflow breakage**: anyone with a stale `.env` pointing `NUXT_GATEWAY_URL` at 4001 will get proxy failures once gateway routes are removed from backend... actually gateway keeps running until PR 3, so this is low risk if we leave gateway's code untouched and only *add* the same routes to backend. Frontend dev proxy target should switch now so devs exercise the new backend path.
- **Scope creep**: easy to also "fix" the dead `NUXT_API_URL`/dev-auth-bypass vars. Out of scope — flagged for the Google OAuth stage instead.

## 5. Recommended Approach

Summary:
- Add `@fastify/cors`, `@fastify/cookie`, `@fastify/jwt` to `apps/backend/package.json`.
- Add `SESSION_SECRET` (min 32 chars) and `DEV_AUTH_PASSWORD` to `apps/backend/src/config/env.ts`.
- Register `cors` (origin from a new `FRONTEND_URL` backend env var, `credentials: true`, explicit method list — never `*` with credentials), `cookie`, and `jwt` in `apps/backend/src/app.ts`, before route registration.
- Port `apps/gateway/src/routes/auth.ts` to `apps/backend/src/routes/auth.ts` unchanged in behavior, register at root (no `/api` prefix) to match `/auth/login`, `/auth/logout`, `/auth/session`.
- Update `apps/frontend/nuxt.config.ts`: rename `NUXT_GATEWAY_URL` → `NUXT_BACKEND_URL` (default `http://localhost:4000`), point both `/api/**` and `/auth/**` routeRules proxies at it.
- Update `apps/backend/.env.example` and `apps/frontend/.env.example` accordingly.
- Leave `apps/gateway` and `k8s/ingress.yaml` completely untouched — gateway keeps running until PR 3.

Likely files:
- `apps/backend/package.json`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/app.ts`
- `apps/backend/src/routes/auth.ts` (new)
- `apps/backend/src/__tests__/auth.test.ts` (new)
- `apps/backend/src/__tests__/helpers/build-app.ts` (register cors/cookie/jwt + fakeEnv additions)
- `apps/backend/.env.example`
- `apps/frontend/nuxt.config.ts`
- `apps/frontend/.env.example`

Why this approach:
- Behavior-preserving port, not a rewrite — minimizes risk of breaking the only auth path currently in production.
- Backend already has the `/api` and root-mount route-registration pattern (`webhookRoutes` at root) — auth routes follow the same convention.
- Keeps PR strictly to app code, so it can merge and be exercised in local/dev before any infra change exists.

Avoid:
- Do not touch `apps/gateway`, `k8s/`, `.github/workflows/deploy.yml`, or `.github/workflows/build.yml` in this PR.
- Do not add Google OAuth or remove the password auth — that's the next stage.
- Do not use `cors: { origin: "*" }` — credentialed cookie requests require an explicit origin.
- Do not touch the dead `NUXT_API_URL` / `NUXT_DEV_AUTH_BYPASS` vars.

## 6. Approval Needed

Tao approval is required before:
- Implementing (per CLAUDE.md, requires literal `APPROVED TO IMPLEMENT`)
- Any change to GitHub Actions secrets or `deploy.yml` (none planned in this PR, but flag if it turns out unavoidable)

## 7. Test Plan

Automated tests (new, in `apps/backend/src/__tests__/auth.test.ts`):
- `POST /auth/login` with correct password hash → 200, `Set-Cookie: pi-session=...` present, httpOnly/sameSite=lax.
- `POST /auth/login` with wrong/missing password → 401, no cookie set.
- `GET /auth/session` with valid cookie → `{ loggedIn: true, user }`.
- `GET /auth/session` with no cookie → `{ loggedIn: false }`.
- `GET /auth/session` with tampered/expired JWT → `{ loggedIn: false }` (no throw).
- `POST /auth/logout` → clears cookie, subsequent `/auth/session` returns `loggedIn: false`.
- CORS preflight (`OPTIONS /api/health` with `Origin` header) → correct `Access-Control-Allow-Origin` matching configured `FRONTEND_URL`, not `*`.

Edge cases:
- Empty/missing `password` field in login body.
- Concurrent logins (each gets independent valid cookie — stateless JWT, no shared state to corrupt).

Manual validation:
- Run frontend + backend locally with updated `NUXT_BACKEND_URL`, confirm login/logout/session round-trip in browser, confirm `/products` still redirects to `/login` when logged out.

Regression checks:
- Existing `apps/backend/src/__tests__/health.test.ts` and all other route tests still pass (no shared state changed by new plugins).
- `apps/gateway` still builds/runs unchanged (not modified).

## 8. Validation Commands

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend typecheck 2>/dev/null || pnpm --filter @price-insight/backend build
pnpm --filter @price-insight/frontend build
```

## 9. Next Implementation Prompt

```markdown
# Task: Move gateway auth/CORS/cookie/JWT into backend (PR 1 of 3)

## Goal
Preserve the /auth/login, /auth/logout, /auth/session contract while serving it from
apps/backend instead of apps/gateway, as the first step of the GKE→Cloud Run migration.

## Background
apps/gateway is being retired in favor of the backend serving /api/* and /auth/* directly,
behind a single-domain Cloud Run + GCLB path-routing setup (PR 2). GKE is already shut down,
so this PR does not touch any deploy workflow or Kubernetes manifest.

## Scope
Implement only:
- Add @fastify/cors, @fastify/cookie, @fastify/jwt to apps/backend
- Add SESSION_SECRET, DEV_AUTH_PASSWORD, FRONTEND_URL to apps/backend env schema
- Port apps/gateway/src/routes/auth.ts to apps/backend/src/routes/auth.ts (root-mounted)
- Register cors/cookie/jwt plugins in apps/backend/src/app.ts before routes
- Update apps/frontend/nuxt.config.ts dev proxy: NUXT_GATEWAY_URL -> NUXT_BACKEND_URL (default localhost:4000)
- Update both apps' .env.example files
- Add backend tests for the new auth routes (see Plan section 7)

## Boundaries
Do not:
- modify apps/gateway, k8s/, .github/workflows/deploy.yml, .github/workflows/build.yml
- add Google OAuth or change the auth model
- touch NUXT_API_URL / NUXT_DEV_AUTH_BYPASS (unused, out of scope)
- use cors origin "*"

## Expected Changes
- apps/backend/package.json
- apps/backend/src/config/env.ts
- apps/backend/src/app.ts
- apps/backend/src/routes/auth.ts (new)
- apps/backend/src/__tests__/auth.test.ts (new)
- apps/backend/src/__tests__/helpers/build-app.ts
- apps/backend/.env.example
- apps/frontend/nuxt.config.ts
- apps/frontend/.env.example

## Tests
Add: auth.test.ts covering login/logout/session success+failure paths, CORS preflight check.
Run:
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/frontend build

## Definition of Done
- All /auth/* behavior identical to gateway's current implementation
- Backend test suite green
- apps/gateway untouched and still functional standalone
```

## 10. Complexity

**Small** — single app, no DB/queue/infra changes, behavior-preserving port of ~50 lines of route code plus plugin wiring. Most of the effort is test coverage for the auth contract.

## 11. Final Status

Waiting for Tao approval.
