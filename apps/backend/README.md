# Price Insight Backend

Fastify backend for the extractor flow with:

- Fastify
- Drizzle ORM
- MySQL
- Redis
- Jina Reader
- OpenAI Responses API

## Setup

1. Copy `.env.example` to `.env`
2. Install dependencies
3. Run the dev server

```powershell
npm install
npm run dev
```

## Testing

Tests use [Vitest](https://vitest.dev/) with Fastify's built-in `inject()` for HTTP-level tests. No real database or Redis connection is required — all external dependencies are stubbed with `vi.fn()`.

```bash
# Run all backend tests once
pnpm --filter @price-insight/backend test

# Watch mode during development
pnpm --filter @price-insight/backend test:watch

# From the monorepo root (runs all packages)
pnpm test
```

Test files live in `src/__tests__/`. The shared test helper is at `src/__tests__/helpers/build-app.ts` — import `buildTestApp()` and override any mock as needed per test.

## Routes

- `GET /api/health`
- `GET /api/products`
- `GET /api/products/:id`
- `POST /api/products/extract`
- `PATCH /api/products/:id/status`

## Example Request

```json
{
  "productUrl": "https://example.com/products/sample"
}
```
