# Plan: Replace SerpAPI competitor search with DataForSEO Google Shopping flow

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/serp-nz-locale
- Coordination repo: /srv/price-insight

## Task Summary

Migrate the competitor price search from SerpAPI (single HTTP call + immersive expansion) to a two-step async DataForSEO flow:

1. **Google Shopping Products** — POST task → GET results → filter & deduplicate candidates
2. **Product Info** — POST task per candidate (up to 20) → GET sellers → filter & save

The `CompetitorResult` type and all downstream DB/repository code is **unchanged**; only the service layer that produces `CompetitorResult[]` is replaced.

Source task: `~/workers/doc/tasks/task-31052026-dataforseo-migration.md`

---

## Files Inspected

| File | Notes |
|------|-------|
| `apps/backend/src/services/serp-api-service.ts` | Current SerpAPI implementation + `CompetitorResult` type |
| `apps/backend/src/services/competitor-analysis-service.ts` | Orchestrator — consumes `CompetitorResult[]`, writes to DB |
| `apps/backend/src/app.ts` | Wires `SerpApiService` → `CompetitorAnalysisService` → Fastify decoration |
| `apps/backend/src/config/env.ts` | Env schema — currently has `SERPAPI_*` keys |
| `apps/backend/src/types/fastify.d.ts` | Fastify instance declarations |
| `apps/backend/src/routes/analysis.ts` | Route layer — calls `competitorAnalysisService.searchAndSuggest()` |
| `apps/backend/src/db/schema.ts` | `competitor`, `competitorProducts`, `priceHistory` tables |
| `apps/backend/src/services/competitor-repository.ts` | DB write methods (`findOrCreateCompetitor`, `insertSuggestedCompetitors`, etc.) |
| `apps/backend/src/scripts/investigate-serp.ts` | Existing SerpAPI investigation script — pattern for new test script |
| `apps/backend/src/__tests__/serp-api-service.test.ts` | Unit tests for SerpAPI service |
| `apps/backend/src/__tests__/competitor-analysis-service.test.ts` | Unit tests for orchestrator |

---

## Affected Apps / Packages

- `apps/backend` only — no frontend changes, no DB schema changes, no shared packages

---

## Proposed Files to Change

| File | Action | Reason |
|------|--------|--------|
| `apps/backend/src/services/dataforseo-service.ts` | **CREATE** | New dedicated DataForSEO service (task post + task get for both Shopping and Product Info endpoints) |
| `apps/backend/src/scripts/investigate-dataforseo.ts` | **CREATE** | Shell-runnable test/investigation script for DataForSEO connection |
| `apps/backend/src/services/competitor-analysis-service.ts` | **EDIT** | Swap `SerpApiService` dependency for `DataForSeoService`; update `searchAndSuggest()` to call new flow |
| `apps/backend/src/app.ts` | **EDIT** | Instantiate `DataForSeoService` instead of `SerpApiService` |
| `apps/backend/src/config/env.ts` | **EDIT** | Add `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`; keep `SERPAPI_*` (task says keep for now) |
| `apps/backend/src/types/fastify.d.ts` | **NO CHANGE** | `competitorAnalysisService` type unchanged |
| `apps/backend/src/__tests__/serp-api-service.test.ts` | **NO CHANGE** | Keep until removal is approved |
| `apps/backend/src/__tests__/competitor-analysis-service.test.ts` | **EDIT** | Swap mock from `serpApi` to `dataForSeoService`; add new flow tests |
| `apps/backend/src/__tests__/dataforseo-service.test.ts` | **CREATE** | Unit tests for the new DataForSEO service |

---

## Proposed DataForSEO Service Structure

```
DataForSeoService
  constructor(login: string, password: string)
  
  // Step 1a — create Google Shopping task
  createShoppingTask(keyword: string): Promise<string>  // returns taskId
  
  // Step 1b — poll/fetch Shopping results
  getShoppingResults(taskId: string): Promise<DataForSeoShoppingItem[]>
  
  // Step 2a — create Product Info task
  createProductInfoTask(productId: string): Promise<string>  // returns taskId
  
  // Step 2b — fetch Product Info sellers
  getProductInfoSellers(taskId: string): Promise<DataForSeoSeller[]>
  
  // Public orchestration method (used by CompetitorAnalysisService)
  searchShoppingPrices(keyword: string): Promise<CompetitorResult[]>
```

**Auth**: DataForSEO uses HTTP Basic Auth (`login:password` base64 encoded).

**Polling strategy**: DataForSEO tasks are asynchronous — after POST, results may not be ready immediately. The service will poll `task_get` with up to N retries and a configurable delay (e.g. 3 attempts × 3s). On timeout, return empty.

---

## Field Mapping

> Confirmed against actual sample responses in `~/workers/doc/data/`.

### Step 1: Shopping Products GET — item structure (type `google_shopping_serp`)

The `items[]` array contains mixed types. Only use `item.type === "google_shopping_serp"`. Carousels (`google_shopping_carousel`) are ignored.

Key: fields are **flat on the item**, not nested under a `price` object.

| DataForSEO field | Notes |
|-----------------|-------|
| `item.type` | Must equal `"google_shopping_serp"` |
| `item.product_id` | String or `null` — required (drop if null) |
| `item.seller` | String — required (drop if missing) |
| `item.price` | **Number directly** (e.g. `73`, `60.86`) — required (drop if null) |
| `item.currency` | String directly (e.g. `"NZD"`) — must equal `"NZD"` |
| `item.old_price` | Number or `null` |
| `item.title` | String |
| `item.product_images[0]` | First image URL → thumbnail |
| `item.product_rating.value` | Number or null |
| `item.product_rating.votes_count` | Number or null |
| `item.tags[0]` | First tag string or null |

Dedup key: `${item.product_id}:${item.seller}:${item.title}`

Filter:
- `item.type !== "google_shopping_serp"` → skip
- `item.currency !== "NZD"` → drop
- missing `item.seller` → drop
- missing/null `item.price` → drop
- `item.product_id === null` → drop
- Limit to first 20 unique after dedup for Product Info enrichment

### Step 2: Product Info GET — seller structure

Path: `tasks[0].result[0].items[0]` (type `product_info_element`)

Product metadata (for all sellers from this product):
- `items[0].product_id` → `externalId`
- `items[0].title` → `title`
- `items[0].images[0]` → `thumbnail`

Per seller in `items[0].sellers[]`:

| DataForSEO field | Maps to `CompetitorResult` field | Notes |
|-----------------|----------------------------------|-------|
| `seller.title` | `source` | Required |
| `seller.url` | `link` | Required |
| `seller.price.current` | `extractedPrice` | Required (number) |
| `seller.price.currency` | `currency` | Must equal `"NZD"` |
| `seller.price.regular` | `extractedOldPrice` | Number or null (was `regular_price` — confirmed `regular`) |
| `seller.price.displayed_price` | `rawPrice` | String e.g. `"$52.77"` |
| `seller.seller_rating.value` | `rating` | Number or null |
| `seller.seller_rating.votes_count` | `reviewCount` | Number or null |
| `seller.delivery_info.delivery_price.current` | `shippingExtracted` | Number or null |
| `seller.delivery_info.delivery_message` | `shippingRaw` | String or null |
| — | `googlePosition` | null (not available) |
| — | `totalRaw/Extracted` | null (not available) |
| — | `country` | derive from `seller.url` via `deriveCountry()` helper |
| — | `tag` | null |
| — | `sourceIcon` | null |

### Task status codes

| Code | Meaning | Action |
|------|---------|--------|
| `20100` | Task Created — not ready | Poll again |
| `20000` | Ok — results ready | Read result |
| Other | Error | Log + return empty |

---

## Implementation Plan

### Step 1 — Add env vars
In `config/env.ts`: add `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (both `z.string().min(1)`). Keep existing `SERPAPI_*` keys.

### Step 2 — Create `dataforseo-service.ts`
- HTTP Basic Auth header built from `login:password`
- `createShoppingTask(keyword)` → POST `/v3/merchant/google/products/task_post` with `{ language_code: "en", location_code: 2554, keyword, price_min: 5 }`
- `getShoppingResults(taskId)` → GET `/v3/merchant/google/products/task_get/advanced/{taskId}` → extract `tasks[0].result[0].items[]`, filter `type === "google_shopping_serp"`, filter currency/seller/price/product_id, dedup by composite key, limit 20
- `createProductInfoTask(productId)` → POST `/v3/merchant/google/product_info/task_post` with `{ language_code: "en", location_code: 2554, product_id }`
- `getProductInfoSellers(taskId)` → GET `/v3/merchant/google/product_info/task_get/advanced/{taskId}` → extract `tasks[0].result[0].items[0]`, filter sellers (title + url + price.current + price.currency === NZD)
- `searchShoppingPrices(keyword)` → orchestrates full flow; returns `CompetitorResult[]`
- Polling: each `task_get` call will retry up to 5 times with 3s delay if the task status is not `"ok"` or result is empty
- Export `CompetitorResult` type from this file (or re-export from `serp-api-service.ts` — decide at implementation time to minimize diff)

### Step 3 — Create investigation/test script
`apps/backend/src/scripts/investigate-dataforseo.ts` — shell-runnable via `tsx`, reads `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` from `.env`, accepts a keyword as argv, runs the full two-step flow, prints step-by-step output with counts.

### Step 4 — Update `competitor-analysis-service.ts`
- Change constructor parameter from `SerpApiService` to `DataForSeoService`
- Keep the `searchAndSuggest()` and `saveCompetitors()` logic identical (they only depend on `CompetitorResult[]`)

### Step 5 — Update `app.ts`
- Import `DataForSeoService` instead of `SerpApiService`
- Instantiate with `env.DATAFORSEO_LOGIN` and `env.DATAFORSEO_PASSWORD`
- Remove `SerpApiService` instantiation (but keep the import commented or the file — per task "keep SerpAPI code temporarily unless removal is approved")

### Step 6 — Update tests
- Create `__tests__/dataforseo-service.test.ts` (mocked fetch, covers: Shopping task post/get, Product Info post/get, full `searchShoppingPrices` orchestration, NZD filter, dedup, 20-item limit)
- Update `__tests__/competitor-analysis-service.test.ts` to use a `dataForSeoService` mock instead of `serpApi`

---

## Risks / Edge Cases

| Risk | Mitigation |
|------|-----------|
| DataForSEO tasks are async — results may be delayed | Polling with retries (5 × 3s); log warning if timeout |
| Product Info endpoint may return 0 sellers after filtering | Return empty array for that candidate; don't throw |
| All 20 Product Info tasks run in parallel — rate limit risk | Consider `Promise.all` with concurrency limiter or sequential batches (start parallel, fall back if 429) |
| `location_code: 2554` is NZ — hardcoded per task spec | Fine for MVP; note in code |
| `price_min: 5` filter in Shopping task | Per task spec; may drop legitimate cheap products |
| Existing `competitor-analysis-service.test.ts` references `CompetitorResult` from `serp-api-service.ts` | Need to update import path if type moves; simplest is to keep type in `serp-api-service.ts` and re-export or import from new file |
| `SERPAPI_API_KEY` is currently `required` in env schema | Keep as-is for now (task: keep SerpAPI code temporarily) |
| DataForSEO task_get returns status codes other than `"ok"` | Handle: `"in_queue"`, `"in_progress"` → retry; any other → log + return empty |

---

## Test Plan

### Unit tests — `dataforseo-service.test.ts`
- Shopping task POST returns taskId
- Shopping task GET filters items correctly (NZD only, missing seller dropped, dedup, 50-item cap)
- Product Info task POST returns taskId
- Product Info sellers GET filters correctly (NZD, missing title/url/price dropped)
- `searchShoppingPrices()` orchestrates full flow end-to-end (mocked fetch)
- Polling retries when task not ready, succeeds on 2nd attempt
- Polling exhausted returns empty array

### Unit tests — `competitor-analysis-service.test.ts`
- Update `makeSerpApi` mock → `makeDataForSeoService` mock (same interface: `searchShoppingPrices`)
- All existing tests still pass (logic unchanged)

### Manual / integration test
- Run `tsx apps/backend/src/scripts/investigate-dataforseo.ts "some product"` against live API

---

## Validation Commands

```bash
# Type check
pnpm --filter @price-insight/backend build

# Unit tests
pnpm --filter @price-insight/backend test

# Manual connection test (after .env has DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD)
cd apps/backend
tsx src/scripts/investigate-dataforseo.ts "Breville Barista Express"
```

---

## Approval Status
APPROVED TO IMPLEMENT — implementation complete.

## Implementation Notes
- `CompetitorResult` type uses optional fields (`?`) for sourceIcon, country, googlePosition, rating, reviewCount, shipping, total — consistent with existing schema and routes
- `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` added to `fakeEnv` in test helper
- SerpAPI files (`serp-api-service.ts`, `serp-api-service.test.ts`) kept per task rule
- `SERPAPI_*` env vars kept in `env.ts` per task rule
- Product Info limit: 20 (per Tony's update to plan)
- 159 tests pass, `tsc` clean
