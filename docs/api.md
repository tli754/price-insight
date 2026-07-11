# API

Fastify 5 HTTP API (`apps/backend/src/app.ts`). Routes are registered in three
tiers: public auth, public `/api/health`, an authenticated `/api` sub-scope
(guarded by `requireSession`), and unauthenticated webhook/internal routes.

Error shape (single handler in `app.ts`): `{ "error": { "code", "message" } }`.
`AppError` → its status; `ZodError` → `400 VALIDATION_ERROR`; anything else →
`500 INTERNAL_SERVER_ERROR`.

## Auth (public — `routes/auth.ts`)

| Method | Path | Behaviour |
|--------|------|-----------|
| POST | `/auth/login` | body `{ password }` compared to `sha256(DEV_AUTH_PASSWORD)`; on success sets httpOnly `pi-session` JWT (7d), returns `{ ok: true }`; else `401` |
| POST | `/auth/logout` | clears `pi-session` |
| GET | `/auth/session` | verifies cookie → `{ loggedIn, user }` or `{ loggedIn:false }` |

## Health (public — `routes/health.ts`)
`GET /api/health` — liveness; used by the deploy health check.

## Protected `/api` (require `pi-session`)

Products (`routes/products.ts`)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/products` | list with competitor/sales/margin stats |
| GET | `/api/products/:id` | 404 `PRODUCT_NOT_FOUND` if missing |
| POST | `/api/products/import` | body validated by `importShopifyProductsSchema`; `201 { imported }` |
| POST | `/api/products/sync` | pulls from Shopify (`503` if unconfigured); `{ synced }` |
| POST | `/api/products/find-competitors` | body `{ productIds:number[] }`; posts DataForSEO shopping tasks; `202 { submitted }` |
| GET | `/api/products/:id/sales` | paginated sales history (`page`, `limit`≤100) |
| DELETE | `/api/products/:id` | `204` |

Competitors / analysis (`routes/analysis.ts`)
| Method | Path |
|--------|------|
| GET | `/api/competitors` |
| GET | `/api/competitors/:id/products` |
| GET | `/api/products/:id/saved-competitors` |
| GET | `/api/products/:id/competitors` |
| POST | `/api/products/:id/competitors/search` |
| POST | `/api/products/:id/competitors` |
| PATCH | `/api/products/:id/competitors/:competitorId` |
| DELETE | `/api/products/:id/competitors/:competitorId` |
| DELETE | `/api/products/:id/saved-competitors/:competitorId` |

Orders (`routes/orders.ts`)
| Method | Path |
|--------|------|
| POST | `/api/orders/sync` |
| GET | `/api/orders` |
| GET | `/api/orders/:id` |

Reports (`routes/reports.ts`)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/products/:id/reports/ai/latest` | latest successful report or `null` |
| POST | `/api/products/:id/reports/ai` | body `{ reports?: ReportType[] }` (defaults to all); runs OpenAI; `201 { report }` |

Shopify (`routes/shopify.ts`)
| Method | Path |
|--------|------|
| POST | `/api/shopify/orders/sync` |

## Webhooks (public, secret/HMAC-verified)

DataForSEO (`routes/dataforseo-webhook.ts`) — verified with `timingSafeEqual`
against `DATAFORSEO_WEBHOOK_SECRET`; always return `200` for handled/ignorable
cases so DataForSEO does not retry indefinitely.
| Method | Path |
|--------|------|
| GET | `/webhooks/dataforseo/pingback/shopping` |
| GET | `/webhooks/dataforseo/pingback/product_info` |

Shopify (`routes/shopify-webhook.ts`) — `POST /webhooks/shopify/orders`, HMAC
verified via `lib/shopify-hmac.ts`.

## Internal (`/internal/*`) — OIDC-authenticated

`routes/internal-competitor.ts` (registered on the backend) and
`routes/internal-sync.ts` (registered on order-worker). The sync routes verify a
Google OIDC token (`lib/verify-oidc.ts`) whose audience is the request host.
| Method | Path | Host | Purpose |
|--------|------|------|---------|
| POST | `/internal/process-shopping-pingback` | backend | Cloud Tasks handler for shopping pingback |
| POST | `/internal/process-product-info-pingback` | backend | Cloud Tasks handler for product-info pingback |
| POST | `/internal/sync-order` | order-worker | idempotent single-order upsert (skips if stored `updated_at` ≥ payload) |
| POST | `/internal/scheduled-order-discovery` | order-worker | Cloud Scheduler entrypoint; fans out per-order sync tasks |

## Frontend proxy

The browser talks to the frontend origin; `nuxt.config.ts` `routeRules` proxy
`/api/**` and `/auth/**` to `NUXT_BACKEND_URL` (baked at build time). CORS on the
backend is scoped to `APP_URL` with credentials (`app.ts`).

Unknown: there is no generated OpenAPI/Swagger spec in the repository.
