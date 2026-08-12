# Plan: Add cost price & margin to products

Status: **Implemented (column-first) — awaiting Tao review; scope grant + deploy pending**
Date: 2026-07-10
Branch: feature/code-refactor

## Implementation notes (2026-07-10)

Implemented column-first (no margin filter). Changes:
- `apps/backend/src/db/schema.ts` — added nullable `cost` decimal(12,4) column.
- `apps/backend/drizzle/0006_dry_shooting_star.sql` — generated migration
  (`ALTER TABLE products ADD cost decimal(12,4)`), **not applied** (no db:push/deploy).
- `apps/backend/src/services/shopify-service.ts` — derives inventoryItemsUrl from
  productsUrl; `attachInventoryCosts()` best-effort enriches `variant.cost` via
  batched `inventory_items.json` (chunks of 100). 403/error/throw → cost left unset,
  sync unaffected. Requires `read_inventory` scope (NOT yet granted).
- `apps/backend/src/services/product-repository.ts` — maps `variant.cost` on import;
  update path preserves an existing cost when the sync produced none; `computeMargin()`
  helper; margin merged into `listProducts()` and `getProductById()`.
- `apps/backend/src/schemas/product.ts` — optional `inventory_item_id`/`cost` on the
  import zod schema.
- `apps/frontend/shared/types/product.ts` — `cost`, `marginAmount`, `marginPercent`.
- `apps/frontend/app/pages/products/index.vue` — sortable **Margin** column (%, $ amount,
  colour by band, cost in title tooltip).

Tests: +16 (product-repository cost/margin/upsert-preserve + computeMargin units;
new shopify-service enrichment incl. 403/no-id/throw). 324 passing.

Follow-up before this lights up in prod:
1. Grant `read_inventory` scope + re-authorize the Shopify app.
2. Review + commit migration `0006`, then deploy (generate→commit→deploy).
Until then cost is null and margin shows "—".

## 1. Summary

Add per-product **cost price** from Shopify and derive **margin ($ and %)** for
display, sorting, and (optionally) filtering on the products page. Cost is not in
Shopify's `products.json` REST payload — it lives on the variant's **InventoryItem**,
which requires a second API call and the `read_inventory` scope. Recommended:
enrich the existing REST import with a batched `inventory_items.json` lookup, store
`cost` as a new nullable column, and compute margin at read time (never store
derived values).

## 2. Current Implementation

- Product sync: `ShopifyService.streamProducts` (`apps/backend/src/services/shopify-service.ts:45`)
  pages `SHOPIFY_PRODUCTS_URL` (REST `products.json?limit=50`). No cost fetched.
- Upsert: `ProductRepository.importProducts` (`apps/backend/src/services/product-repository.ts:55-113`)
  maps `variants[0]` -> `price/sku/weight/inventoryQuantity`. `compare_at_price` is
  typed on `ShopifyVariant` but dropped; there is no cost field anywhere.
- Schema: `products` table (`apps/backend/src/db/schema.ts:26-50`) has `price`
  (decimal `moneyColumn`) but no `cost`/`margin`.
- Read: `listProducts` (`apps/backend/src/services/product-repository.ts:115-122`)
  merges sales + competitor stats into `ProductRow`.
- Frontend: `apps/frontend/app/pages/products/index.vue` renders/sorts columns from
  `ProductRow`; core lib's `analyzePrice` already accepts `cost` for margin but the
  backend never supplies it.

Main files:
- `apps/backend/src/services/shopify-service.ts`
- `apps/backend/src/services/product-repository.ts`
- `apps/backend/src/db/schema.ts`
- `apps/frontend/shared/types/product.ts`
- `apps/frontend/app/pages/products/index.vue`

## 3. Affected Areas

- Frontend: yes — new "Cost"/"Margin" column, optional sort/filter in
  `products/index.vue`, add `cost`/`margin` to `shared/types/product.ts`.
- Backend: yes — `ShopifyService` (new inventory fetch), `ProductRepository`
  (map + expose cost, compute margin).
- Database: yes — new nullable `cost` column (migration via `db:generate`).
- Queue/jobs: no.
- External APIs: yes — extra Shopify `inventory_items.json` calls;
  **`read_inventory` scope required**.
- Tests: yes — repository/import mapping tests; existing Shopify/import tests.
- Config/infra: Shopify app scope grant (`read_inventory`) — outside this repo
  (Shopify app config / OAuth install re-authorization).

## 4. Risks

- Missing scope -> `inventory_items.json` returns 403; sync could break if not
  handled gracefully.
- Extra API volume / rate limits — one more request per ~50 products (batch by
  `ids`); REST leaky-bucket throttling.
- Reinstall required — adding a scope means the Shopify app must be re-authorized
  to mint a token with `read_inventory`.
- Null cost — many products may have no cost set; margin must handle null (show
  `—`, exclude from margin sorts).
- Migration on shared DB — must go through `db:generate` -> commit -> deploy
  (never `db:push`).
- Currency — cost assumed same currency as price; no FX handling.

## 4b. Rollback Plan

- Scope/403 failure: make inventory enrichment best-effort (try/catch -> cost
  `null`, log). Detect via sync error logs. Revert = deploy prior image.
  Data-safe: **yes**.
- Migration: `cost` is a nullable additive column. Rollback = drop column via a
  follow-up migration; no data loss to existing columns. Data-safe: **yes**
  (dropping loses only cost values, re-fetchable on next sync).
- API volume issue: feature-flag the inventory fetch (env toggle) to disable
  enrichment without a full redeploy. Data-safe: **yes**.

## 5. Recommended Approach

Summary:
- Add nullable `cost` decimal column to `products` (migration).
- In `ShopifyService`, after fetching each product page, collect
  `variant.inventory_item_id`s and batch-fetch
  `GET {shop}/admin/api/{ver}/inventory_items.json?ids=<comma-list>`; map
  `inventory_item_id -> cost`. Wrap in try/catch so a 403/absent scope yields
  `cost: null` and does not fail the sync.
- In `importProducts`, set `cost` from the resolved map.
- Compute `marginAmount = price - cost` and
  `marginPercent = (price - cost) / price * 100` at read time in `listProducts`
  (and `:id`), added to `ProductRow` as optional fields — **do not store derived
  margin**.
- Frontend: add `cost`/`margin` to the `ProductRow` type, a "Margin" column (with
  sort), and optionally a margin filter later.

Likely files:
- `apps/backend/src/db/schema.ts` (+ generated migration)
- `apps/backend/src/services/shopify-service.ts`
- `apps/backend/src/services/product-repository.ts`
- `apps/frontend/shared/types/product.ts`
- `apps/frontend/app/pages/products/index.vue`

Why this approach:
- Reuses the existing REST pipeline; batched call keeps request count low.
- Additive nullable column + derived-at-read margin is safe and reversible.
- Best-effort enrichment means missing scope degrades gracefully instead of
  breaking sync.

Avoid:
- Storing computed margin (drifts from price/cost).
- Per-variant N+1 inventory calls (batch by `ids`).
- `db:push` on shared envs.

## 6. Approval Needed

Tao approval required before:
- Database schema change — adding `products.cost` + migration (shared-env deploy).
- External API / scope change — enabling `read_inventory` and extra Shopify
  inventory calls (requires app re-authorization).
- Sync behavior change — enriching import with a second network call.

## 7. Test Plan

Automated tests:
- `ProductRepository.importProducts` maps `cost` from inventory map; leaves `null`
  when absent.
- `listProducts` margin math: normal, `cost > price` (negative margin), `cost = 0`,
  `price = null`, `cost = null`.

Edge case tests:
- Inventory fetch 403 (no scope) -> cost null, sync still succeeds.
- Variant missing `inventory_item_id`.
- Page with zero products / product with no variants.
- Large `ids` list splitting if it exceeds Shopify's per-request cap.

Manual validation:
- Run sync against a store with costs set; verify column + margin values and null
  handling.

Regression checks:
- Existing product sync/import tests still pass; frontend build/typecheck.

## 8. Validation Commands

```bash
pnpm --filter @price-insight/backend build            # expect: exit 0
pnpm --filter @price-insight/backend test             # expect: pass
pnpm --filter @price-insight/backend db:generate      # expect: one new migration file (review before commit)
pnpm --filter @price-insight/frontend build           # expect: build complete
```

(Do not run `db:push`/deploy — approval-gated.)

## 9. Next Implementation Prompt

```markdown
# Task: Add product cost price and derived margin

## Goal

Fetch Shopify per-product cost via InventoryItem, store as products.cost, and
expose derived margin ($ and %) in the products list and detail.

## Scope

Implement only:
- Add nullable `cost` decimal column to products (db:generate migration).
- ShopifyService: batched inventory_items.json enrichment mapping
  inventory_item_id -> cost, best-effort (403/missing scope -> null).
- ProductRepository.importProducts: set cost from map.
- ProductRepository read paths: add marginAmount/marginPercent computed at read time.
- Frontend: add cost/margin to ProductRow type + a sortable Margin column.

## Boundaries

Do not: store derived margin; add N+1 calls; run migrations/db:push; change
deployment config; expand beyond cost+margin.

## Tests

See section 7.

## Definition of Done

- Cost persists on sync where Shopify has it; margin shows correctly incl.
  null/negative.
- Missing read_inventory scope degrades to cost=null without breaking sync.
- Backend + frontend build/tests pass; one reviewed migration generated.
```

## 10. Final Status

Blocked on approval:
- DB schema change (`products.cost` + migration) — schema changes to shared envs
  must go through generate->commit->deploy per CLAUDE.md.
- `read_inventory` scope + extra Shopify calls — new external permission and app
  re-authorization.
- Sync behavior change (inventory enrichment) — alters the import pipeline's
  external calls.

Open question: margin **filter** on the products page now (e.g. "low margin
< X%"), or add the **cost + margin column** first and defer filtering?
Recommendation: column-first.

Waiting for Tao approval.
