# Plan: NZ-Localised SerpAPI + Immersive Product Store Fetch

**Date:** 2026-05-29
**Branch:** feature/serp-nz-locale *(to be created)*
**Status:** Investigation complete — awaiting APPROVED TO IMPLEMENT

---

## Task Summary

Upgrade the competitor search pipeline from a single SerpAPI call to a two-step fetch that returns real NZ merchant URLs and richer competitor data. All results are persisted immediately to `competitor_products` as `status = 'suggested'`. The user then confirms or removes records from the frontend. No Redis involved in this flow.

**Step 1 — Google Shopping (NZ-localised)**
```
engine=google_shopping&q=...&location=New+Zealand&gl=nz&hl=en&google_domain=google.co.nz
```

**Step 2 — Immersive product fetch (parallel, one per shopping result)**
```
engine=google_immersive_product&page_token={token}&api_key={key}
```
Returns a `stores[]` array — real merchant URLs, prices, shipping, ratings. Each store entry becomes one `competitor_products` row.

---

## Pipeline Flow

```
POST /api/products/:id/competitors/search  (manual trigger — user clicks "Find Competitors")
  └─ Step 1: SerpAPI google_shopping (NZ locale)
       └─ shopping_results[]
            └─ Step 2: SerpAPI google_immersive_product (parallel, one per result)
                 └─ stores[] — one entry per merchant
  └─ DELETE existing 'suggested' rows for this product_id (keep 'confirmed')
  └─ INSERT all stores as status = 'suggested' → competitor_products + price_history

GET /api/products/:id/competitors
  └─ query competitor_products WHERE product_id = :id
  └─ return all rows (suggested + confirmed) — empty if search not yet run

DELETE /api/products/:id/competitors/:competitorId
  └─ hard delete competitor_products row

PATCH /api/products/:id/competitors/:competitorId
  └─ { status: 'confirmed' }
```

---

## Files Inspected

| File | Relevance |
|---|---|
| `apps/backend/src/services/serp-api-service.ts` | Core change — locale params, immersive fetch, store expansion |
| `apps/backend/src/config/env.ts` | Add 4 optional locale env vars |
| `apps/backend/src/app.ts` | Pass locale config to `SerpApiService`; register new routes |
| `apps/backend/src/services/competitor-analysis-service.ts` | Replace `saveCompetitors` flow with `searchAndSuggest` |
| `apps/backend/src/services/competitor-repository.ts` | New methods: `insertSuggestedCompetitors`, `deleteSuggestedByProduct`, `deleteCompetitorProduct`, `updateStatus` |
| `apps/backend/src/db/schema.ts` | Add `status`, `source_icon`, `country` + rich fields to `competitor_products` |
| `apps/backend/src/db/migrate.ts` | Sync inline CREATE TABLE |
| `apps/backend/src/routes/competitors.ts` | New endpoints: `POST /search`, `DELETE /:id`, `PATCH /:id` |
| `apps/backend/.env.example` | Document 4 new optional locale vars |

---

## Data Map

### What each `shopping_results[]` entry carries to all its stores

| Field | Maps to | Notes |
|---|---|---|
| `position` | `googlePosition` | Parent result ranking |
| `product_id` | `externalId` | Shared across all stores for this product |
| `thumbnail` | `thumbnail` | Product image, shared across stores |
| `immersive_product_page_token` | *(internal)* | Used to call Step 2, not stored |

### Each `stores[]` entry → one `competitor_products` row

| `stores[]` field | DB column | Notes |
|---|---|---|
| `name` | `source` | Store name — also upserted into `competitor.name` |
| `logo` | `source_icon` *(new)* | Store favicon URL |
| `link` | `product_link` | Real merchant URL |
| *(derived from `link`)* | `country` *(new)* | `"NZ"` / `"AU"` / `null` |
| `title` | `title` | Product title at that store |
| `tag` | `tag` | `"Best price"`, `"Most popular"` |
| `rating` | `rating` *(new)* | `4.5` |
| `reviews` | `review_count` *(new)* | `21` |
| `shipping` | `shipping_raw` *(new)* | `"+ $7.00"` |
| `shipping_extracted` | `shipping_extracted` *(new)* | `7.0` |
| `total` | `total_raw` *(new)* | `"$206.00"` |
| `extracted_total` | `total_extracted` *(new)* | `206.0` |
| `original_price` | `raw_old_price` *(new)* | `"$399.99"` |
| `extracted_original_price` | `extracted_old_price` *(new)* | `399.99` |
| `price` | `price_history.price` | e.g. `"$199.00"` |
| `extracted_price` | `price_history.extracted_price` | `199.0` |
| *(from shopping)* | `google_position` | Parent result ranking |
| *(from shopping)* | `external_id` | Shopify-style product ID |
| *(from shopping)* | `thumbnail` | Product image |

### DB schema changes summary

| Table | Change |
|---|---|
| `competitor_products` | Add `status VARCHAR(32) NOT NULL DEFAULT 'suggested'` |
| `competitor_products` | Add `source_icon TEXT NULL` |
| `competitor_products` | Add `country VARCHAR(8) NULL` |
| `competitor_products` | Add `rating DECIMAL(3,1) NULL` |
| `competitor_products` | Add `review_count INT NULL` |
| `competitor_products` | Add `shipping_raw VARCHAR(64) NULL` |
| `competitor_products` | Add `shipping_extracted DECIMAL(10,2) NULL` |
| `competitor_products` | Add `total_raw VARCHAR(64) NULL` |
| `competitor_products` | Add `total_extracted DECIMAL(10,2) NULL` |
| `competitor_products` | Add `raw_old_price VARCHAR(64) NULL` |
| `competitor_products` | Add `extracted_old_price DECIMAL(10,2) NULL` |

---

## Proposed Files to Change

### Backend

| File | Change |
|---|---|
| `apps/backend/src/config/env.ts` | Add `SERPAPI_LOCATION`, `SERPAPI_GL`, `SERPAPI_HL`, `SERPAPI_GOOGLE_DOMAIN` (optional, NZ defaults) |
| `apps/backend/src/services/serp-api-service.ts` | Locale config in constructor; NZ params in shopping call; `fetchStores()` private method; `deriveCountry()` helper; `expandToStores()` method; updated types |
| `apps/backend/src/app.ts` | Pass locale config to `SerpApiService` |
| `apps/backend/src/db/schema.ts` | Add 11 new columns to `competitorProducts` table |
| `apps/backend/drizzle/0004_*.sql` | Auto-generated migration |
| `apps/backend/src/db/migrate.ts` | Sync inline CREATE TABLE |
| `apps/backend/src/services/competitor-repository.ts` | Add `insertSuggestedCompetitors`, `deleteSuggestedByProduct`, `deleteCompetitorProduct`, `updateCompetitorProductStatus` |
| `apps/backend/src/services/competitor-analysis-service.ts` | Replace `saveCompetitors` with `searchAndSuggest(productId, query)` |
| `apps/backend/src/routes/competitors.ts` | Add `POST /search`, `DELETE /:competitorId`, `PATCH /:competitorId` |
| `apps/backend/.env.example` | Document 4 new optional locale vars |
| `apps/backend/src/__tests__/serp-api-service.test.ts` | New unit tests |

---

## Implementation Plan

### Step 1 — `env.ts`: locale vars (optional, NZ defaults)

```ts
SERPAPI_LOCATION:      z.string().default("New Zealand"),
SERPAPI_GL:            z.string().default("nz"),
SERPAPI_HL:            z.string().default("en"),
SERPAPI_GOOGLE_DOMAIN: z.string().default("google.co.nz"),
```

### Step 2 — `serp-api-service.ts`: locale + immersive fetch

**New/updated types:**

```ts
type SerpApiLocale = {
  location: string; gl: string; hl: string; google_domain: string;
};

type SerpApiShoppingResult = {
  position?: number;
  title?: string;
  product_id?: string;
  product_link?: string;
  immersive_product_page_token?: string;   // new
  price?: string;
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  source?: string;
  thumbnail?: string;
  tag?: string;
};

type SerpApiImmersiveStore = {
  name?: string; logo?: string; link?: string; title?: string;
  price?: string; extracted_price?: number;
  original_price?: string; extracted_original_price?: number;
  shipping?: string; shipping_extracted?: number;
  total?: string; extracted_total?: number;
  rating?: number; reviews?: number;
  tag?: string; details_and_offers?: string[];
};

export type CompetitorResult = {
  title: string; externalId: string | null;
  rawPrice: string | null; extractedPrice: number;
  rawOldPrice: string | null; extractedOldPrice: number | null;
  currency: string | null;
  source: string; sourceIcon: string | null;
  link: string; country: string | null;
  thumbnail: string | null; tag: string | null;
  googlePosition: number | null;
  rating: number | null; reviewCount: number | null;
  shippingRaw: string | null; shippingExtracted: number | null;
  totalRaw: string | null; totalExtracted: number | null;
};
```

**Constructor** (no Redis):
```ts
constructor(
  private readonly apiKey: string,
  private readonly locale: SerpApiLocale = NZ_LOCALE
) {}
```

**`searchShoppingPrices`** — adds locale params, parallel immersive fetch:
```ts
url.searchParams.set("location", this.locale.location);
url.searchParams.set("gl", this.locale.gl);
url.searchParams.set("hl", this.locale.hl);
url.searchParams.set("google_domain", this.locale.google_domain);

const candidates = (data.shopping_results ?? [])
  .filter(r => typeof r.extracted_price === "number" && r.extracted_price > 0);

return (await Promise.all(candidates.map(r => this.expandToStores(r)))).flat();
```

**`fetchStores(token)` — simple HTTP fetch, no cache:**
```ts
private async fetchStores(token: string): Promise<SerpApiImmersiveStore[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_immersive_product");
  url.searchParams.set("page_token", token);
  url.searchParams.set("api_key", this.apiKey);
  try {
    const response = await fetch(url.toString());
    if (!response.ok) return [];
    const data = (await response.json()) as { stores?: SerpApiImmersiveStore[] };
    return data?.stores ?? [];
  } catch {
    return [];  // graceful fallback — keep shopping result as single entry
  }
}
```

**`deriveCountry` helper:**
```ts
function deriveCountry(link: string): string | null {
  try {
    const { hostname } = new URL(link);
    if (hostname.endsWith(".co.nz")) return "NZ";
    if (hostname.endsWith(".com.au")) return "AU";
  } catch { /* invalid URL */ }
  return null;
}
```

### Step 3 — `schema.ts`: new columns on `competitorProducts`

```ts
status: varchar("status", { length: 32 }).notNull().default("suggested"),
sourceIcon: text("source_icon"),
country: varchar("country", { length: 8 }),
rating: decimal("rating", { precision: 3, scale: 1 }),
reviewCount: int("review_count"),
shippingRaw: varchar("shipping_raw", { length: 64 }),
shippingExtracted: decimal("shipping_extracted", moneyColumn),
totalRaw: varchar("total_raw", { length: 64 }),
totalExtracted: decimal("total_extracted", moneyColumn),
rawOldPrice: varchar("raw_old_price", { length: 64 }),
extractedOldPrice: decimal("extracted_old_price", moneyColumn),
```

Run `db:generate` → review migration → update `migrate.ts`.

### Step 4 — `competitor-repository.ts`: new methods

```ts
// Delete all 'suggested' rows for a product before re-search
async deleteSuggestedByProduct(productId: number): Promise<void>

// Insert all stores from a search as 'suggested'
async insertSuggestedCompetitors(
  productId: number,
  items: CompetitorProductInput[]
): Promise<void>

// Hard delete a single competitor product row
async deleteCompetitorProduct(id: number): Promise<void>

// Update status on a single row
async updateCompetitorProductStatus(
  id: number,
  status: 'suggested' | 'confirmed'
): Promise<void>
```

`CompetitorProductInput` gains all new fields: `sourceIcon`, `country`, `rating`, `reviewCount`, `shippingRaw`, `shippingExtracted`, `totalRaw`, `totalExtracted`, `rawOldPrice`, `extractedOldPrice`.

The existing `replaceCompetitorProducts` stays untouched for now (used by existing flow).

### Step 5 — `competitor-analysis-service.ts`: `searchAndSuggest`

New method replacing the current search-then-save flow:

```ts
async searchAndSuggest(productId: number, query: string): Promise<CompetitorResult[]> {
  const results = await this.serpApi.searchShoppingPrices(query);

  // Clear stale suggestions, keep confirmed
  await this.repo.deleteSuggestedByProduct(productId);

  // Upsert competitor names, then insert all as suggested
  await this.repo.insertSuggestedCompetitors(productId, results.map(r => ({
    // map CompetitorResult → CompetitorProductInput
  })));

  return results;
}
```

### Step 6 — `competitors.ts` route: new endpoints

```ts
// Manual search trigger
POST /api/products/:id/competitors/search
  → competitorAnalysisService.searchAndSuggest(productId, query)
  → 200 { competitors: CompetitorResult[] }

// Remove a suggested (or confirmed) competitor
DELETE /api/products/:id/competitors/:competitorId
  → competitorRepository.deleteCompetitorProduct(competitorId)
  → 204

// Confirm a suggested competitor
PATCH /api/products/:id/competitors/:competitorId
  body: { status: 'confirmed' }
  → competitorRepository.updateCompetitorProductStatus(competitorId, 'confirmed')
  → 200
```

### Step 7 — `app.ts`: pass locale to `SerpApiService`

```ts
const serpApi = new SerpApiService(env.SERPAPI_API_KEY, {
  location: env.SERPAPI_LOCATION,
  gl: env.SERPAPI_GL,
  hl: env.SERPAPI_HL,
  google_domain: env.SERPAPI_GOOGLE_DOMAIN
});
```

### Step 8 — `.env.example`

```
# SerpAPI locale (defaults to New Zealand)
SERPAPI_LOCATION=New Zealand
SERPAPI_GL=nz
SERPAPI_HL=en
SERPAPI_GOOGLE_DOMAIN=google.co.nz
```

### Step 9 — `serp-api-service.test.ts`: new unit tests

Using `vi.spyOn(global, 'fetch')`:

- Shopping URL has NZ locale params by default
- Custom locale passed via constructor is used
- `position` → `googlePosition` on each result
- 1 shopping result with 3 stores → 3 `CompetitorResult` items
- Store fields (`sourceIcon`, `link`, `rating`, `reviewCount`, `shippingExtracted`, `totalExtracted`) mapped correctly
- `thumbnail` and `externalId` inherited from shopping result into each store
- `deriveCountry`: `.co.nz` → `"NZ"`, `.com.au` → `"AU"`, other → `null`, invalid URL → `null`
- Immersive fetch non-OK → fallback single result from shopping data
- Immersive fetch empty `stores` → fallback single result
- No token → no immersive call, single result returned
- Store with no `extracted_price` filtered out
- `SERPAPI_FAILED` thrown on non-OK shopping response

---

## Frontend Impact

New endpoints exposed — `GET /api/products/:id/competitors` now returns `status` per row. Frontend needs:
- "Find Competitors" button → `POST .../search`
- Remove button per row → `DELETE .../competitors/:id`
- Confirm button per row → `PATCH .../competitors/:id`

Frontend changes are a separate task.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Immersive response shape differs — `stores` vs `sellers` | Medium | `fetchStores` returns `[]` on unknown shape → falls back to shopping result |
| Parallel immersive calls (up to 20) on each manual search | Medium | User-triggered only — not a hot path; add a cap if credits are a concern |
| SerpAPI credits: up to 21 per search | Medium | Manual trigger limits frequency |
| 11 new DB columns — migration must be reviewed carefully | Medium | Run `db:generate`, inspect SQL before `db:push` |
| `listingUnique` index on `(productId, competitorId, productLink)` — re-search inserts same links | Medium | `deleteSuggestedByProduct` clears old rows before insert; no conflict |
| Existing `replaceCompetitorProducts` flow still in use | Low | Left untouched; new methods are additive |
| API key pasted in chat — treat as compromised | High | Rotate the SerpAPI key before deploying |

---

## Test Plan

**New `serp-api-service.test.ts`** — see Step 9 above.

**`competitor-repository.test.ts`** (new or extend):
- [ ] `deleteSuggestedByProduct` removes only `suggested` rows, leaves `confirmed` rows
- [ ] `insertSuggestedCompetitors` inserts all rows with `status = 'suggested'`
- [ ] `deleteCompetitorProduct` hard-deletes the row
- [ ] `updateCompetitorProductStatus` changes status to `confirmed`

**Existing tests — zero changes needed:**
- `competitor-analysis-service.test.ts` — mocks `serpApi.searchShoppingPrices` — unaffected
- `competitors.test.ts` — mocks the whole service — unaffected (until new endpoints added)

---

## Validation Commands

```bash
pnpm --filter @price-insight/backend db:generate
pnpm --filter @price-insight/backend build
pnpm --filter @price-insight/backend test
```

---

## Estimated Complexity

**Medium** — 5–7 hours. Core complexity is the DB schema additions and the new repository methods. SerpAPI changes are straightforward. No Redis changes.

---

## Waiting for: APPROVED TO IMPLEMENT
