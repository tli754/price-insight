# Plan: Auth Investigation — Stage 1

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/competitors
- Coordination repo: /srv/price-insight

## Source Task File
- Task file: ~/workers/doc/tasks/tester-02062026-1.rm

## Task Summary
Audit all Nuxt server API routes and frontend pages. Classify each route. Identify where
`requireUserSession(event)` should be applied. Check webhook verification status. Confirm
backend access model. Propose route-level protection plan and validation tests.

## Files Inspected
- apps/frontend/server/api/health.ts
- apps/frontend/server/routes/auth/dev-login.post.ts
- apps/frontend/server/routes/auth/google.get.ts
- apps/frontend/app/middleware/auth.ts
- apps/frontend/app/pages/index.vue
- apps/frontend/app/pages/login.vue
- apps/frontend/app/pages/products/index.vue
- apps/frontend/app/pages/products/[id].vue
- apps/frontend/app/pages/competitors/index.vue
- apps/frontend/app/pages/competitors/[id].vue
- apps/frontend/app/pages/orders/index.vue
- apps/frontend/app/pages/orders/[id].vue
- apps/frontend/app/pages/insight.vue
- apps/frontend/app/pages/competitor-products.vue
- apps/frontend/app/layouts/default.vue
- apps/frontend/nuxt.config.ts
- apps/frontend/shared/types/auth.d.ts
- k8s/ingress.yaml
- k8s/backend/service.yaml

## Affected Apps / Packages
- apps/frontend only

## Route Classification

### Nuxt Server API Routes

| Route | File | Classification | Auth Needed? |
|---|---|---|---|
| GET /api/health | server/api/health.ts | health public route | No |
| POST /auth/dev-login | server/routes/auth/dev-login.post.ts | auth/session public route | No (it IS the login) |
| GET /auth/google | server/routes/auth/google.get.ts | auth/session public route | No (OAuth callback) |

No webhook endpoints exist yet.

### Frontend Pages

| Page | File | Has auth middleware? | Should be protected? |
|---|---|---|---|
| / (Products) | pages/index.vue | YES | Yes |
| /products | pages/products/index.vue | **NO** | Yes |
| /products/[id] | pages/products/[id].vue | **NO** | Yes |
| /competitors | pages/competitors/index.vue | **NO** | Yes |
| /competitors/[id] | pages/competitors/[id].vue | **NO** | Yes |
| /orders | pages/orders/index.vue | **NO** | Yes |
| /orders/[id] | pages/orders/[id].vue | **NO** | Yes |
| /insight | pages/insight.vue | **NO** | Yes |
| /competitor-products | pages/competitor-products.vue | **NO** | Yes |
| /login | pages/login.vue | No | No (public) |

## Existing Patterns Found
- `nuxt-auth-utils` is installed and configured.
- `setUserSession` / `useUserSession` are used in auth routes and layout.
- `defineNuxtRouteMiddleware` + `useUserSession` pattern exists in `app/middleware/auth.ts`.
- `definePageMeta({ middleware: ['auth'] })` is the pattern — used only in `pages/index.vue`.
- `requireUserSession(event)` is NOT currently used in any Nuxt server handler.

## Proposed Files to Change

```
apps/frontend/app/pages/products/index.vue       — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/products/[id].vue        — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/competitors/index.vue    — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/competitors/[id].vue     — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/orders/index.vue         — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/orders/[id].vue          — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/insight.vue              — add definePageMeta({ middleware: ['auth'] })
apps/frontend/app/pages/competitor-products.vue  — add definePageMeta({ middleware: ['auth'] })
```

New Nuxt server proxy API routes (one per backend resource group):
```
apps/frontend/server/api/products/index.get.ts          — proxy GET /api/products
apps/frontend/server/api/products/extract.post.ts       — proxy POST /api/products/extract
apps/frontend/server/api/products/sync.post.ts          — proxy POST /api/products/sync
apps/frontend/server/api/products/[id].get.ts           — proxy GET /api/products/:id
apps/frontend/server/api/products/[id]/competitors.get.ts        — proxy GET /api/products/:id/competitors
apps/frontend/server/api/products/[id]/competitors/search.post.ts — proxy POST /api/products/:id/competitors/search
apps/frontend/server/api/products/[id]/competitors/[cid].patch.ts — proxy PATCH /api/products/:id/competitors/:cid
apps/frontend/server/api/products/[id]/competitors/[cid].delete.ts — proxy DELETE /api/products/:id/competitors/:cid
apps/frontend/server/api/competitors/index.get.ts       — proxy GET /api/competitors
apps/frontend/server/api/competitors/[id]/products.get.ts — proxy GET /api/competitors/:id/products
apps/frontend/server/api/orders/index.get.ts            — proxy GET /api/orders
apps/frontend/server/api/orders/[id].get.ts             — proxy GET /api/orders/:id
```

Each proxy route applies `requireUserSession(event)` before forwarding.

Frontend pages update `apiUrl` references to use `/api` (local Nuxt server) instead of
`NUXT_PUBLIC_API_URL` (direct backend).

`k8s/ingress.yaml` — remove the `/api` → backend rule once proxying is in place.

## Implementation Plan
1. Add `definePageMeta({ middleware: ['auth'] })` to each unprotected page.
2. Create Nuxt server proxy routes for all backend API calls, each guarded with `requireUserSession(event)`.
3. Update all frontend pages to call `/api/...` (Nuxt server) instead of `${apiUrl}/api/...` (direct backend).
4. Remove `NUXT_PUBLIC_API_URL` from public runtimeConfig — move to private runtimeConfig as `apiUrl` for server-side proxy use only.
5. Remove the `/api` → backend ingress rule so the backend is no longer publicly reachable.
6. Confirm `/login` and `/api/health` remain unguarded.

## Key Finding: Backend Is Publicly Reachable via Ingress
The task states "Backend service is not publicly reachable" but this is NOT true of the
current setup:

- `k8s/ingress.yaml` routes `/api` → backend service (port 4000) directly.
- All frontend pages use `NUXT_PUBLIC_API_URL` (`apiUrl`) which is a public runtime config,
  meaning all `useFetch` and `$fetch` calls go browser → ingress → backend.
- This means the browser IS calling the backend directly, not through Nuxt server.

Proxying all backend calls through Nuxt server API routes is now IN SCOPE for this task.

## Webhook Verification Status
- No webhook endpoints exist in the Nuxt server yet.
- No Shopify HMAC verification code exists.
- When webhook routes are added, they must NOT use `requireUserSession` and must implement
  provider signature verification (Shopify HMAC).

## Risks / Edge Cases
- Only `pages/index.vue` is currently protected — all other pages are wide open.
- The `auth` middleware redirects to `/login` if session is absent, which is the correct UX.
- `devAuthBypass` mode works via `NUXT_DEV_AUTH_BYPASS` env var — this pattern is safe to keep.
- Proxy routes must forward query strings correctly (e.g. orders pagination params).
- `requireUserSession` on proxy routes means unauthenticated API calls return 401 rather than redirecting — frontend must handle this gracefully.
- Moving `NUXT_PUBLIC_API_URL` to private config means it is no longer accessible from browser-side code — all existing direct usages in pages must be replaced.

## Database Impact
None.

## API Impact
- New Nuxt server proxy routes introduced for all backend resource groups.
- All frontend pages switch from calling `NUXT_PUBLIC_API_URL` directly to calling local `/api/...` routes.
- Backend becomes unreachable from browser once ingress `/api` rule is removed.
- `NUXT_PUBLIC_API_URL` moves from public to private runtimeConfig.

## UI Impact
Unprotected pages will redirect to `/login` if accessed without a session.

## Infrastructure / Config Impact
None.

## Dependency Impact
None. `nuxt-auth-utils` already installed.

## Validation Commands
```bash
pnpm --filter @price-insight/frontend build
```
TypeScript typecheck is implicit in build. No automated auth tests exist yet.

## Approval Status
APPROVED. Implementation complete — waiting for Tony review.

## Implementation Notes
- 11 proxy routes created under apps/frontend/server/api/
- All 8 unprotected pages now have definePageMeta({ middleware: ['auth'] })
- apiUrl moved to private runtimeConfig; env var renamed NUXT_PUBLIC_API_URL → NUXT_API_URL
- k8s/ingress.yaml simplified to single / → frontend rule; backend no longer publicly reachable
- Build passes: pnpm --filter @price-insight/frontend build ✔
- ACTION REQUIRED: rename NUXT_PUBLIC_API_URL → NUXT_API_URL in the frontend-secrets k8s secret
