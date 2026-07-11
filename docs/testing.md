# Testing

## Backend (Vitest)

Config: `apps/backend/vitest.config.ts` — `environment: node`, `globals: false`,
`include: src/__tests__/**/*.test.ts`. Run:

```bash
pnpm --filter @price-insight/backend test        # vitest run
pnpm --filter @price-insight/backend test:watch  # vitest
```

Coverage via `@vitest/coverage-v8` (installed; no threshold config found).

### Helpers
- `__tests__/helpers/build-app.ts` — builds the Fastify app for route tests.
- `__tests__/helpers/mock-db.ts` — mock database so tests don't need MySQL.

### What is covered (`apps/backend/src/__tests__/`)
| Area | Files |
|------|-------|
| App / health / auth | `app.test.ts`, `health.test.ts`, `auth.test.ts`, `require-session.test.ts` |
| Products | `products.test.ts`, `product-repository.test.ts` |
| Competitors | `competitors.test.ts`, `competitor-analysis-service.test.ts`, `competitor-repository.test.ts`, `internal-competitor.test.ts` |
| DataForSEO | `dataforseo-service.test.ts`, `dataforseo-webhook.test.ts` |
| Orders | `orders.test.ts`, `order-repository.test.ts`, `order-mapper.test.ts`, `internal-sync.test.ts`, `shopify-orders-sync.test.ts` |
| Shopify | `shopify-service.test.ts`, `shopify-webhook.test.ts` |
| AI / analysis | `ai-report.test.ts`, `price-analysis.test.ts` |
| Utilities | `nz-date-range.test.ts`, `cli.test.ts` |
| Legacy | `serp-api-service.test.ts` (covers the unused SerpAPI service) |

### Edge cases exercised (examples verified in code)
- Webhook secret validation and invalid params (`dataforseo-webhook.test.ts`,
  handlers use `timingSafeEqual` and return `200` on ignorable input).
- Shopify HMAC verification (`shopify-webhook.test.ts`, `lib/shopify-hmac.ts`).
- Idempotent order upsert / skip when already current (`internal-sync.test.ts`,
  `/internal/sync-order` compares stored `updated_at`).
- NZ timezone date boundaries (`nz-date-range.test.ts`, `lib/nz-date-range.ts`).
- Session-required routes reject missing/invalid cookies (`require-session.test.ts`).

## Core (node assertions)

```bash
pnpm --filter @price-insight/core test
# = node test/core.test.js && node test/extractor.test.js
```
Covers `analyzePrice` (`core.test.js`) and the legacy extractor
(`extractor.test.js`).

## Frontend

No test runner is configured in `apps/frontend/package.json` (scripts are
`dev`/`build`/`preview`/`lint` only). **Unknown:** automated frontend tests —
none found.

## CI

There is no dedicated test/lint GitHub Actions workflow in `.github/workflows/`
(only `build`, `deploy`, `infra-terraform*`). **Unknown:** whether tests run in
CI — not evidenced in the repository. Run tests locally with the filtered
commands above.
