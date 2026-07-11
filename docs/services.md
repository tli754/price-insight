# Services

Backend service and repository classes (`apps/backend/src/services/`). Services
hold integration + orchestration logic; `*-repository.ts` classes own Drizzle
data access. All are constructed once in `app.ts` `buildApp` and attached via
`app.decorate` (typed in `types/fastify.d.ts`).

## Integration services

### `DataForSeoService` (`dataforseo-service.ts`)
Wraps the DataForSEO REST API with basic auth (`login`, `password`). Runs the
competitor-discovery task lifecycle:
- `postShoppingTasks(products, pingbackUrl)` / `createShoppingTask(keyword)` —
  submit Google Shopping tasks (`location_code 2554`, `language_code en`).
- `fetchShoppingTaskResult` / `parseShoppingCandidates(data, ownStoreName)` —
  read results, keep `google_shopping_serp` items with seller/price/product_id,
  drop the store's own listings, dedupe.
- `postProductInfoTasks` / `fetchProductInfoResults` — enrich candidates with
  per-seller offers (NZD only).
- `searchShoppingPrices(keyword, excludeExternalIds, ownStoreName)` — synchronous
  convenience path used by `CompetitorAnalysisService`.

### `ShopifyService` (`shopify-service.ts`)
REST client. `getAccessToken()` does the client-credentials exchange;
`streamProducts()` pages the catalogue; `attachInventoryCosts()` enriches cost;
`fetchOrders()` pulls orders. Only constructed when all `SHOPIFY_*` env vars are
set, else `null` (routes then return `503 SHOPIFY_NOT_CONFIGURED`).

### `ShopifyGraphQLService` (`shopify-graphql-service.ts`)
GraphQL client derived from `SHOPIFY_PRODUCTS_URL`. `fetchOrderById` /
`fetchOrders` return richer order data than REST; used by order sync
(`routes/internal-sync.ts`) and mapped via `lib/order-mapper.ts`.

### `AiReportService` (`ai-report-service.ts`)
Builds the LLM payload and calls OpenAI.
- `generateReport(productId, reportTypes)` — loads product + competitors + sales
  in parallel, `buildPayload(...)`, hashes input (sha256), inserts a `pending`
  report, calls OpenAI, records `success`/`failed`.
- `buildPayload` — includes ≤20 **confirmed** competitors, ≤12 monthly sales,
  ≤50 recent orders with PII stripped (no names/emails/addresses), ≤5 image URLs.
- `callOpenAI` — `chat.completions.parse` with `zodResponseFormat(productAiReportsOutputSchema)`;
  throws on truncation (`finish_reason === "length"`) or empty parse.
- Inline `SYSTEM_PROMPT` constant: "use only supplied data, don't invent, return
  JSON only." There is no `/prompts` directory.

### `CompetitorAnalysisService` (`competitor-analysis-service.ts`)
Orchestrates synchronous search-and-suggest and confirmed-save:
- `searchAndSuggest(product)` — query DataForSEO, `filterByCountryAndPriceRange`,
  dedupe against existing/deleted, record prices, replace suggested rows.
- `saveCompetitors(product, selected)` — `findOrCreateCompetitor` per source,
  `replaceCompetitorProducts`, then `analyzePrice(...)` and `recordPriceInsight`.

### Cloud Tasks clients
- `CloudTasksOrderSyncClient` (`cloud-tasks-client.ts`) — `enqueueSyncOrder`
  pushes an OIDC-authenticated task to order-worker `/internal/sync-order`.
- `CloudTasksCompetitorClient` (`cloud-tasks-competitor-client.ts`) — `enqueue`
  pushes competitor-pingback processing to `/internal/process-*-pingback`.
Both are `null` when Cloud Tasks env is unset → webhooks/discovery fall back to
inline processing (local dev).

### `SerpApiService` (`serp-api-service.ts`) — legacy
Present with `searchShoppingPrices`/store expansion, but **not wired into
`app.ts`**; superseded by DataForSEO. Retained code (see `docs/roadmap.md` and
Technical Debt in `AI_CONTEXT.md`).

## Repositories

| Class | File | Owns |
|-------|------|------|
| `ProductRepository` | `product-repository.ts` | product/image upsert (`importProducts`), list with competitor+sales+margin stats, get/delete |
| `CompetitorRepository` | `competitor-repository.ts` | competitor + competitor_products + price_history + price_insights CRUD; suggested/confirmed state transitions; dedupe key helpers |
| `OrderRepository` | `order-repository.ts` | customer/address/order/order_item upsert (REST + mapped GraphQL), idempotent `upsertMappedOrder`, `listOrders`, `getProductSalesHistory` |
| `AiReportRepository` | `ai-report-repository.ts` | `product_ai_reports` insert/update/get-latest-successful |

## Why this split

Routes stay thin and framework-facing; services encapsulate each third party so
that (a) integrations can be `null`/stubbed for local dev and tests
(`helpers/mock-db.ts`, `helpers/build-app.ts`), and (b) the narrow
`order-worker-server.ts` can reuse just `OrderRepository` + Shopify + Cloud Tasks
without pulling in OpenAI/DataForSEO.
