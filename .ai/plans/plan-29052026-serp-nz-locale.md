# Plan: NZ-Localised SerpAPI + Immersive Product Store Fetch

**Date:** 2026-05-29
**Branch:** fe
**Status:** Investigation complete — awaiting APPROVED TO IMPLEMENT

---

## Task Summary

Upgrade the competitor search pipeline from a single SerpAPI call to a two-step fetch that returns real NZ merchant URLs and richer competitor data.

**Step 1 — Google Shopping (NZ-localised)**
Add locale params so results target google.co.nz:
```
engine=google_shopping&q=...&location=New+Zealand&gl=nz&hl=en&google_domain=google.co.nz
```

**Step 2 — Immersive product fetch (one per shopping result)**
For each shopping result with an `immersive_product_page_token`, call:
```
engine=google_immersive_product&page_token={token}&api_key={key}
```
This returns a `stores[]` array with real merchant URLs, prices, shipping, ratings. Each store becomes one `CompetitorResult`.

**Cache first, store on confirm**
Full enriched results cached in Redis (7 days). DB written only when user selects and saves competitors.

---

## Pipeline Flow

```
GET /api/products/:id/competitors
  └─ Step 1: SerpAPI google_shopping (NZ locale)
       └─ shopping_results[] — one per product
            └─ Step 2: SerpAPI google_immersive_product (parallel, one per result)
                 └─ stores[] — one per merchant
                      └─ expand: N CompetitorResult items per shopping result
                           └─ cache full list → Redis (7 days)
                                └─ return to frontend

POST /api/products/:id/competitors  (user confirms selection)
  └─ write selected items → competitor_products + price_history
```

---

## Files Inspected

| File | Relevance |
|---|---|
| `apps/backend/src/services/serp-api-service.ts` | Core change — locale params, immersive fetch, store expansion |
| `apps/backend/src/config/env.ts` | Add 4 optional locale env vars |
| `apps/backend/src/app.ts` | Pass locale config to `SerpApiService` |
| `apps/backend/src/services/competitor-analysis-service.ts` | Calls `searchShoppingPrices(query)` — signature unchanged |
| `apps/backend/src/db/schema.ts` | Add `source_icon` column to `competitor_products` |
| `apps/backend/src/db/migrate.ts` | Add `source_icon` to inline CREATE TABLE |
| `apps/backend/src/services/competitor-repository.ts` | Map `sourceIcon` in `CompetitorProductInput` and insert |
| `apps/backend/src/__tests__/competitor-analysis-service.test.ts` | No changes needed |
| `apps/backend/.env.example` | Document 4 new optional vars |

---

## Data Map

### What each shopping result carries forward to all its stores

| `shopping_results[]` field | Maps to | Notes |
|---|---|---|
| `position` | `googlePosition` | Currently ignored — bug fix |
| `product_id` | `externalId` | Shared across all stores for this product |
| `thumbnail` | `thumbnail` | Product image, shared across all stores |
| `immersive_product_page_token` | *(internal)* | Used to call Step 2, not exposed |

### Each immersive `stores[]` entry → one `CompetitorResult`

| `stores[]` field | `CompetitorResult` field | Persisted to DB | Notes |
|---|---|---|---|
| `name` | `source` | Yes — `competitor_products.source` | Store name |
| `logo` | `sourceIcon` | Yes — `competitor_products.source_icon` *(new col)* | Store favicon URL |
| `link` | `link` | Yes — `competitor_products.product_link` | Real merchant URL |
| *(derived from `link`)* | `country` | Yes — `competitor_products.country` *(new col)* | `"NZ"` if `.co.nz`, `"AU"` if `.com.au`, else `null` |
| `title` | `title` | Yes — `competitor_products.title` | Product title at that store |
| `price` | `rawPrice` | Yes — `price_history.price` | e.g. `"$199.00"` |
| `extracted_price` | `extractedPrice` | Yes — `price_history.extracted_price` | `199.0` |
| `original_price` | `rawOldPrice` | Cache only | e.g. `"$399.99"` |
| `extracted_original_price` | `extractedOldPrice` | Cache only | `399.99` |
| `shipping` | `shippingRaw` | Cache only | e.g. `"+ $7.00"` |
| `shipping_extracted` | `shippingExtracted` | Cache only | `7.0` |
| `total` | `totalRaw` | Cache only | e.g. `"$206.00"` |
| `extracted_total` | `totalExtracted` | Cache only | `206.0` |
| `rating` | `rating` | Cache only | `4.5` |
| `reviews` | `reviewCount` | Cache only | `21` |
| `tag` | `tag` | Yes — `competitor_products.tag` | `"Best price"`, `"Most popular"` |
| `details_and_offers` | `details` | Cache only | `["In stock online", ...]` |
| *(from shopping)* | `googlePosition` | Yes — `competitor_products.google_position` | Parent result ranking |
| *(from shopping)* | `externalId` | Yes — `competitor_products.external_id` | Shopify-style product ID |
| *(from shopping)* | `thumbnail` | Yes — `competitor_products.thumbnail` | Product image |

### DB change summary

| Table | Change |
|---|---|
| `competitor_products` | Add `source_icon TEXT NULL` |
| `competitor_products` | Add `country VARCHAR(8) NULL` — `"NZ"`, `"AU"`, or `null` |
| `competitor_products` | `google_position` already exists — just needs to be populated |

---

## Proposed Files to Change

### Backend

| File | Change |
|---|---|
| `apps/backend/src/config/env.ts` | Add `SERPAPI_LOCATION`, `SERPAPI_GL`, `SERPAPI_HL`, `SERPAPI_GOOGLE_DOMAIN` (optional, NZ defaults) |
| `apps/backend/src/services/serp-api-service.ts` | Locale config in constructor; NZ params in shopping URL; `position` mapping; `fetchStores()` private method; `deriveCountry()` helper; expand stores → CompetitorResult[]; update `SerpApiShoppingResult` and `CompetitorResult` types |
| `apps/backend/src/app.ts` | Pass locale config from env to `SerpApiService` |
| `apps/backend/src/db/schema.ts` | Add `sourceIcon` and `country` to `competitorProducts` table |
| `apps/backend/drizzle/0004_*.sql` | Auto-generated — `ALTER TABLE competitor_products ADD source_icon TEXT, ADD country VARCHAR(8)` |
| `apps/backend/src/db/migrate.ts` | Add `source_icon TEXT` and `country VARCHAR(8)` to inline `CREATE TABLE competitor_products` |
| `apps/backend/src/services/competitor-repository.ts` | Add `sourceIcon` and `country` to `CompetitorProductInput`; map both in `replaceCompetitorProducts` insert |
| `apps/backend/.env.example` | Document 4 new optional locale vars |
| `apps/backend/src/__tests__/serp-api-service.test.ts` | New — unit tests for URL construction, immersive fetch, store expansion, country derivation, fallback |

---

## Implementation Plan

### Step 1 — `env.ts`: locale vars (optional, NZ defaults)

```ts
SERPAPI_LOCATION:      z.string().default("New Zealand"),
SERPAPI_GL:            z.string().default("nz"),
SERPAPI_HL:            z.string().default("en"),
SERPAPI_GOOGLE_DOMAIN: z.string().default("google.co.nz"),
```

No `.env` change required — defaults cover the NZ case out of the box.

### Step 2 — `serp-api-service.ts`: full rewrite of service internals

**Types to update:**

```ts
type SerpApiLocale = {
  location: string;
  gl: string;
  hl: string;
  google_domain: string;
};

type SerpApiShoppingResult = {
  position?: number;                         // add
  title?: string;
  product_id?: string;
  product_link?: string;
  immersive_product_page_token?: string;     // add
  price?: string;
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  source?: string;
  thumbnail?: string;
  tag?: string;
};

type SerpApiImmersiveStore = {
  name?: string;
  logo?: string;
  link?: string;
  title?: string;
  price?: string;
  extracted_price?: number;
  original_price?: string;
  extracted_original_price?: number;
  shipping?: string;
  shipping_extracted?: number;
  total?: string;
  extracted_total?: number;
  rating?: number;
  reviews?: number;
  tag?: string;
  details_and_offers?: string[];
};

type SerpApiImmersiveResponse = {
  stores?: SerpApiImmersiveStore[];
};
```

**Updated `CompetitorResult` type** (add new fields, keep existing):

```ts
export type CompetitorResult = {
  title: string;
  externalId: string | null;
  rawPrice: string | null;
  extractedPrice: number;
  rawOldPrice: string | null;
  extractedOldPrice: number | null;
  currency: string | null;
  source: string;
  sourceIcon: string | null;          // new
  link: string;
  country: string | null;             // new — derived from link domain
  thumbnail: string | null;
  tag: string | null;
  googlePosition: number | null;      // new (was always null before)
  rating: number | null;              // new
  reviewCount: number | null;         // new
  shippingRaw: string | null;         // new
  shippingExtracted: number | null;   // new
  totalRaw: string | null;            // new
  totalExtracted: number | null;      // new
  details: string[];                  // new
};
```

**`deriveCountry` module-level helper:**

```ts
function deriveCountry(link: string): string | null {
  try {
    const hostname = new URL(link).hostname;
    if (hostname.endsWith(".co.nz")) return "NZ";
    if (hostname.endsWith(".com.au")) return "AU";
  } catch {
    // invalid URL — return null
  }
  return null;
}
```

Applied when mapping each store:
```ts
country: deriveCountry(s.link ?? ""),
```

And in the fallback (shopping result, no immersive data):
```ts
country: deriveCountry(r.product_link ?? ""),
```

**Constructor:**
```ts
constructor(
  private readonly apiKey: string,
  private readonly locale: SerpApiLocale = NZ_LOCALE
) {}
```

**`searchShoppingPrices` — Step 1 (shopping search):**
```ts
// Build URL with NZ locale params
url.searchParams.set("location", this.locale.location);
url.searchParams.set("gl", this.locale.gl);
url.searchParams.set("hl", this.locale.hl);
url.searchParams.set("google_domain", this.locale.google_domain);

// Map position
const candidates = (data.shopping_results ?? [])
  .filter(r => typeof r.extracted_price === "number" && r.extracted_price > 0);

// Step 2: fetch stores for each result in parallel
const results = await Promise.all(
  candidates.map(r => this.expandToStores(r))
);

return results.flat();
```

**`expandToStores(r)` private method:**
```ts
private async expandToStores(r: SerpApiShoppingResult): Promise<CompetitorResult[]> {
  const stores = r.immersive_product_page_token
    ? await this.fetchStores(r.immersive_product_page_token)
    : null;

  // No immersive data — fall back to shopping result itself
  if (!stores || stores.length === 0) {
    return [{
      title: r.title ?? "",
      externalId: r.product_id ?? null,
      rawPrice: r.price ?? null,
      extractedPrice: r.extracted_price as number,
      rawOldPrice: r.old_price ?? null,
      extractedOldPrice: r.extracted_old_price ?? null,
      currency: null,
      source: r.source ?? "",
      sourceIcon: null,
      link: r.product_link ?? "",
      country: deriveCountry(r.product_link ?? ""),
      thumbnail: r.thumbnail ?? null,
      tag: r.tag ?? null,
      googlePosition: r.position ?? null,
      rating: null,
      reviewCount: null,
      shippingRaw: null,
      shippingExtracted: null,
      totalRaw: null,
      totalExtracted: null,
      details: []
    }];
  }

  return stores
    .filter(s => typeof s.extracted_price === "number" && (s.extracted_price ?? 0) > 0)
    .map(s => ({
      title: s.title ?? r.title ?? "",
      externalId: r.product_id ?? null,
      rawPrice: s.price ?? null,
      extractedPrice: s.extracted_price as number,
      rawOldPrice: s.original_price ?? null,
      extractedOldPrice: s.extracted_original_price ?? null,
      currency: null,
      source: s.name ?? "",
      sourceIcon: s.logo ?? null,
      link: s.link ?? "",
      country: deriveCountry(s.link ?? ""),
      thumbnail: r.thumbnail ?? null,
      tag: s.tag ?? null,
      googlePosition: r.position ?? null,
      rating: s.rating ?? null,
      reviewCount: s.reviews ?? null,
      shippingRaw: s.shipping ?? null,
      shippingExtracted: s.shipping_extracted ?? null,
      totalRaw: s.total ?? null,
      totalExtracted: s.extracted_total ?? null,
      details: s.details_and_offers ?? []
    }));
}
```

**`fetchStores(token)` private method:**
```ts
private async fetchStores(token: string): Promise<SerpApiImmersiveStore[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_immersive_product");
  url.searchParams.set("page_token", token);
  url.searchParams.set("api_key", this.apiKey);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return [];
    const data = (await response.json()) as SerpApiImmersiveResponse;
    return data?.stores ?? [];
  } catch {
    return [];   // graceful fallback — keep shopping result as single entry
  }
}
```

### Step 3 — `app.ts`: pass locale from env

```ts
const serpApi = new SerpApiService(env.SERPAPI_API_KEY, {
  location: env.SERPAPI_LOCATION,
  gl: env.SERPAPI_GL,
  hl: env.SERPAPI_HL,
  google_domain: env.SERPAPI_GOOGLE_DOMAIN
});
```

### Step 4 — `schema.ts`: add `source_icon` and `country` columns

```ts
// competitor_products table
sourceIcon: text("source_icon"),
country: varchar("country", { length: 8 }),
```

Run `db:generate` → review `0004_*.sql` → update `migrate.ts`.

### Step 5 — `competitor-repository.ts`: map `sourceIcon` and `country`

Add `sourceIcon: string | null` and `country: string | null` to `CompetitorProductInput`.
Map both in the `replaceCompetitorProducts` insert.

### Step 6 — `competitor-analysis-service.ts`: forward new fields

In `saveCompetitors`, the `rows` mapping already spreads `CompetitorResult` fields. Add:
```ts
googlePosition: r.googlePosition ?? null,
sourceIcon: r.sourceIcon ?? null,
country: r.country ?? null,
```

### Step 7 — `serp-api-service.test.ts`: new unit tests

Using `vi.spyOn(global, 'fetch')` to intercept both the shopping and immersive requests:

- Shopping URL contains `location=New+Zealand`, `gl=nz`, `hl=en`, `google_domain=google.co.nz`
- Custom locale passed via constructor is used
- `position` mapped to `googlePosition`
- `fetchStores` called in parallel for each result with a token
- Stores expanded: 1 shopping result with 3 stores → 3 `CompetitorResult` items
- Each store entry has `sourceIcon`, real `link`, `rating`, `reviewCount`, `shippingExtracted`
- Immersive fetch fails (non-OK) → falls back to single item from shopping result
- Immersive fetch succeeds but `stores` is empty → falls back to single item
- Shopping result has no token → no immersive fetch, single item returned
- Store with no `extracted_price` filtered out
- `SERPAPI_FAILED` thrown on non-OK shopping response

### Step 8 — `.env.example`: document new vars

```
# SerpAPI locale (defaults to New Zealand)
SERPAPI_LOCATION=New Zealand
SERPAPI_GL=nz
SERPAPI_HL=en
SERPAPI_GOOGLE_DOMAIN=google.co.nz
```

---

## Frontend impact

`CompetitorResult` has new fields (`sourceIcon`, `googlePosition`, `rating`, `reviewCount`, `shippingRaw`, `shippingExtracted`, `totalRaw`, `totalExtracted`, `details`). These are all additive. The frontend shared type `FetchCompetitorsResponse` / `CompetitorResult` in `shared/types/competitor.ts` needs updating, but **the existing display columns (title, source, price, link, thumbnail, tag) are unchanged** so no layout changes are required unless we choose to display the new fields.

This plan does **not** include frontend display changes for new fields — that is a separate task.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Immersive response shape differs — `stores` vs `sellers` | Medium | `fetchStores` returns `[]` on unknown shape → falls back to shopping result |
| Parallel immersive calls (up to 20) slow first-load | Medium | Acceptable — result cached for 7 days; subsequent loads are instant |
| SerpAPI credits: up to 21 per search (1 shopping + up to 20 immersive) | Medium | If credit usage is a concern, add a `limit` param to cap immersive calls |
| `CompetitorResult` type has more fields — existing `saveCompetitorsSchema` Zod validation in `competitor.ts` needs new optional fields | Medium | Add new fields as `.optional()` to the Zod schema so old frontend versions still work |
| API key pasted in chat — treat as compromised | High | Rotate the SerpAPI key before deploying |
| Existing test line 108 asserts `searchShoppingPrices("Acme Blue Widget")` — signature is unchanged | None | Mock is unaffected |

---

## Test Plan

**New `serp-api-service.test.ts`** (all via fetch mock):
- [ ] Shopping URL has NZ locale params by default
- [ ] Shopping URL uses custom locale when provided
- [ ] `position` → `googlePosition` on each result
- [ ] 1 shopping result + 3 stores → 3 `CompetitorResult` items
- [ ] Store fields (`sourceIcon`, `link`, `rating`, `reviewCount`, `shippingExtracted`, `totalExtracted`) mapped correctly
- [ ] `thumbnail` and `externalId` inherited from shopping result into each store
- [ ] `deriveCountry`: `.co.nz` hostname → `"NZ"`
- [ ] `deriveCountry`: `.com.au` hostname → `"AU"`
- [ ] `deriveCountry`: other hostname (`.com`, `.co.uk`) → `null`
- [ ] `deriveCountry`: empty or invalid URL → `null` (no throw)
- [ ] `country` present on store results and fallback results
- [ ] Immersive non-OK → fallback single result from shopping data
- [ ] Immersive empty `stores` → fallback single result
- [ ] No token → no immersive call, single result
- [ ] Store with missing price filtered out
- [ ] `SERPAPI_FAILED` on non-OK shopping response

**Existing tests — zero changes needed:**
- `competitor-analysis-service.test.ts` — mocks `serpApi.searchShoppingPrices` — unaffected
- `competitors.test.ts` — mocks the whole service — unaffected

---

## Validation Commands

```bash
pnpm --filter @price-insight/backend db:generate
pnpm --filter @price-insight/backend build
pnpm --filter @price-insight/backend test
```

---

## Estimated Complexity

**Medium** — 4–6 hours. All changes contained in the backend services layer. No frontend layout changes. One new DB column. Core complexity is the async parallel immersive fetch + fallback logic in `SerpApiService`.

---

## Waiting for: APPROVED TO IMPLEMENT
