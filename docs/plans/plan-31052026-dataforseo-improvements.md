# Plan: DataForSEO improvements — polling, mapping, schema, dedup

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/serp-nz-locale
- Coordination repo: /srv/price-insight

## Background

Following the initial DataForSEO migration and live connection test, four areas of improvement have been identified:
1. Replace per-task polling with `tasks_ready` endpoint
2. Fix field mapping — carry `tag` + `googlePosition`, drop 4 unused columns
3. Competitor name normalization
4. `competitor_products` upsert logic — preserve price history instead of wiping

---

## Change 1: Replace per-task polling with `tasks_ready`

**Problem:** Current code polls each task individually (`task_get` per task). 20 Product Info tasks = 20 parallel polling loops.

**New flow — Shopping:**
1. POST Shopping task → get `taskId`
2. Poll `GET /v3/merchant/google/products/tasks_ready` until `taskId` appears
3. Use `endpoint_advanced` from the ready response to fetch results

**New flow — Product Info:**
1. POST all 20 Product Info tasks → collect all task IDs into `pendingIds`
2. Poll `GET /v3/merchant/google/product_info/tasks_ready`
3. For each task ID in the response that is in `pendingIds` → fetch results immediately via `endpoint_advanced`, remove from `pendingIds`
4. Repeat until `pendingIds` is empty or retry limit hit
5. Any remaining IDs → log warning, skip

**`tasks_ready` response shape (confirmed):**
```json
{
  "tasks": [{
    "result": [
      {
        "id": "task-id",
        "endpoint_advanced": "/v3/merchant/google/products/task_get/advanced/task-id"
      }
    ]
  }]
}
```

Samples saved: `~/workers/doc/data/products-tasks_ready.json`, `product-info_tasks_ready.json`

---

## Change 2: Field mapping fixes

### 2a. Carry `tag` and `googlePosition` from Shopping to Product Info result

`tag` is already in `ShoppingCandidate` but not forwarded. `googlePosition` (`item.rank_absolute`) is not captured at all.

- Add `googlePosition: number | null` to `ShoppingCandidate` using `item.rank_absolute`
- In `getProductInfoResults()`, apply `candidate.tag` and `candidate.googlePosition` to each `CompetitorResult`

### 2b. Remove 4 unused columns from `competitor_products`

These fields will never be populated by DataForSEO:

| Column | Reason |
|--------|--------|
| `sourceIcon` | No seller logo in any DataForSEO endpoint |
| `totalRaw` | Not returned |
| `totalExtracted` | Not returned |
| `rawOldPrice` | `seller.price.regular` is numeric only — no display string |

**DB migration required to drop these columns.**

### 2c. Logging improvements
- `console.warn` in `searchShoppingPrices` catch block — failed candidates are visible without aborting
- Explicit null check on `result` after `20000` status — log warning and return `[]`

---

## Change 3: Competitor name normalization

**No new column — normalize at lookup time in application code.**

Normalization function:
```
lowercase + trim
"new zealand" → "nz"
"australia" → "au"
collapse multiple spaces
```

Examples:
- `"Harvey Norman New Zealand"` → `"harvey norman nz"`
- `"Harvey Norman NZ"` → `"harvey norman nz"` ✓ same
- `"Coffea Coffee Australia"` → `"coffea coffee au"`
- `"Coffea Coffee AU"` → `"coffea coffee au"` ✓ same

**`findOrCreateCompetitor(name)` new logic:**
1. Normalize input name
2. Fetch all competitors from DB
3. Find match by normalizing each stored name the same way
4. Found → return existing (original display name preserved)
5. Not found → insert with original display name

---

## Change 4: `competitor_products` upsert — preserve price history

**Problem:** `replaceCompetitorProducts()` deletes all records for a product then re-inserts. Price history is wiped on every search.

**New dedup key:** `productId` + `externalId` + `competitorId`

**New upsert logic per result:**
1. Look up existing record by `productId` + `externalId` + `competitorId`
2. Found → insert `price_history` entry only
3. Not found → insert new `competitor_products` + `price_history`

**Also update `listingUnique` DB index:**
- Current: `productId + competitorId + productLink` (wrong — productLink varies per seller)
- New: `productId + competitorId + externalId`

---

## Files to Change

| File | Change |
|------|--------|
| `services/dataforseo-service.ts` | Replace per-task polling with `tasks_ready` flow; add `googlePosition` to `ShoppingCandidate`; carry `tag`+`googlePosition` in results; add warn logging; explicit null result check |
| `scripts/investigate-dataforseo.ts` | Already updated to use `tasks_ready` — verify aligns with service changes |
| `db/schema.ts` | Remove `sourceIcon`, `totalRaw`, `totalExtracted`, `rawOldPrice`; update `listingUnique` index |
| `services/competitor-repository.ts` | Add `normalizeCompetitorName()`; update `findOrCreateCompetitor()`; replace `replaceCompetitorProducts()` with upsert logic |
| `services/competitor-analysis-service.ts` | Remove dropped fields from row mapping |
| `services/serp-api-service.ts` | Remove dropped fields from `CompetitorResult` type |
| `schemas/competitor.ts` | Remove `rawOldPrice` from `saveCompetitorsSchema` |
| `__tests__/dataforseo-service.test.ts` | Update for `tasks_ready` flow; add `googlePosition`/`tag` tests; add warn/null tests |
| `__tests__/competitor-repository.test.ts` | Add normalization tests; add upsert/price history tests |
| `__tests__/competitor-analysis-service.test.ts` | Remove dropped field references |
| `__tests__/competitors.test.ts` | Remove dropped field references |
| `__tests__/helpers/build-app.ts` | Remove dropped field references if any |

**DB migrations required:**
- Drop 4 columns from `competitor_products`
- Update `listingUnique` index

---

## Field Mapping Reference (Final)

### `competitor_products`
| Column | Source | Step |
|--------|--------|------|
| `title` | `items[0].title` | Product Info |
| `externalId` | `items[0].product_id` | Product Info |
| `productLink` | `seller.url` | Product Info |
| `source` | `seller.title` | Product Info |
| `currency` | `seller.price.currency` | Product Info |
| `thumbnail` | `items[0].images[0]` | Product Info |
| `tag` | `item.tags[0]` | Shopping — carried via candidate |
| `googlePosition` | `item.rank_absolute` | Shopping — carried via candidate |
| `rating` | `seller.seller_rating.value` | Product Info |
| `reviewCount` | `seller.seller_rating.votes_count` | Product Info |
| `shippingRaw` | `seller.delivery_info.delivery_message` | Product Info |
| `shippingExtracted` | `seller.delivery_info.delivery_price.current` | Product Info |
| `extractedOldPrice` | `seller.price.regular` | Product Info |
| `country` | derived from `seller.url` | `.co.nz` → NZ, `.com.au` → AU |
| ~~`sourceIcon`~~ | removed | |
| ~~`totalRaw`~~ | removed | |
| ~~`totalExtracted`~~ | removed | |
| ~~`rawOldPrice`~~ | removed | |

### `price_history`
| Column | Source |
|--------|--------|
| `price` | `seller.price.displayed_price` |
| `extractedPrice` | `seller.price.current` |

---

## Risks / Edge Cases

- Migration drops columns permanently — acceptable since DataForSEO never populates them
- `listingUnique` index change: old index removed, new one created — existing rows unaffected
- `externalId` nullable: if null, code-level dedup won't match — will create a new record. Acceptable since DataForSEO always provides `product_id` after filtering
- Fetching all competitors for normalization: acceptable for small table; revisit if table grows large
- Suggested flow (`insertSuggestedCompetitors`) is unchanged — upsert only applies to confirmed `saveCompetitors()` path

---

## Test Plan

- `tasks_ready` polling: not ready first → ready second → correct `endpoint_advanced` used
- Partial ready: some tasks never appear → partial results returned, warning logged
- `googlePosition` from `rank_absolute` carried to `CompetitorResult`
- `tag` carried from candidate to `CompetitorResult`
- Normalization: "Harvey Norman New Zealand" and "Harvey Norman NZ" → same competitor
- Upsert: same key → price_history only; new key → new record + price_history
- Build passes with no references to removed fields

---

## Validation Commands

```bash
pnpm --filter @price-insight/backend db:generate
pnpm --filter @price-insight/backend db:push
pnpm --filter @price-insight/backend build
pnpm --filter @price-insight/backend test
npx tsx src/scripts/investigate-dataforseo.ts "moka pot"
```

---

## Approval Status
Waiting for Tony approval.
