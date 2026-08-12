# Plan: Price Insight Product Page UX and Decision Dashboard Restructure

## 1. Summary

Restructure `/products/[id].vue` from one long vertical scroll into a tabbed layout (Decision Summary always visible up top, then Overview / Competition / Sales / AI Insights / Product Details tabs below), reusing existing data, components, and API responses almost entirely as-is. `@nuxt/ui` v4.8.0 (already installed, package.json declares `^4.6.1`) ships a `UTabs` component, so no new dependency is needed. Most of the Decision Summary's numbers can be sourced from data the page already fetches; the one real gap is a "last 30 days vs. previous 30 days" sales trend, which the current API doesn't expose and isn't safely derivable client-side. Recommended direction: **Option A (frontend-first restructuring)**, plus one small, separately-approved backend addition for the previous-30-day comparison — not a full new dashboard endpoint.

## 2. Current Implementation

`apps/frontend/app/pages/products/[id].vue` (857 lines) renders, top to bottom: header/status, a competitor table (11 resizable columns), two custom SVG charts (`PriceScatterChart`, `PriceBoxChart`) shown only when ≥2 confirmed competitors exist, an AI Insights card (4 structured sub-reports), a Sales History card (summary stats + monthly bar chart via `SalesBarChart` + paginated order-item table), and a two-column product info/gallery/description block. All data comes from plain `useFetch` calls (no composables layer exists) against:

- `GET /api/products/:id` → product + images
- `GET /api/products/:id/competitors` → all competitors (suggested + confirmed)
- `POST /api/products/:id/competitors/search`, `PATCH/DELETE .../competitors/:id`
- `GET /api/products/:id/sales?page=&limit=` → `{ summary, monthly, items, total }`
- `GET /api/products/:id/reports/ai/latest` (cached, lazy) and `POST /api/products/:id/reports/ai` (on-demand generation)

Key backend facts that shape the plan:
- **Market median / price position already exist**, but only inside the cached AI report (`output.pricing.competitorMedianPrice`, `pricePosition`), computed server-side from **confirmed-only** competitors (max 20) — `apps/backend/src/services/ai-report-service.ts`. Nothing forces a fresh OpenAI call to show these; the page already fetches the latest cached report on load.
- **No total landed price** (price + shipping) is computed anywhere — `extractedPrice` and `shippingExtracted` are returned separately per competitor by `GET .../competitors`. Trivial to sum client-side.
- **No backend inventory-runway calculation** exists; `/products/index.vue` already has a frontend `inventoryAlert()` using a weighted 7/30/90-day blend (recently fixed). This task's spec describes a *simpler*, 30-day-only formula with different thresholds for the detail page — see Risk below.
- **No "previous 30 days" sales window** is exposed anywhere (`summary` only has `sold7d/30d/90d`, not a prior-period comparison) — would need a small backend addition to compute reliably.
- **Existing data bug**: `order-repository.ts:getProductSalesHistory()` (feeds this page's Sales tab) does **not** filter `orders.cancelledAt` and sums `orderItems.quantity` instead of `currentQuantity` — the exact bug already fixed in `product-repository.ts:getProductSalesStats()` for the `/products` list page, but never applied here.

Main files:
- `apps/frontend/app/pages/products/[id].vue`
- `apps/frontend/app/components/{PriceScatterChart,PriceBoxChart,SalesBarChart}.vue`
- `apps/frontend/shared/types/{product,competitor,order,ai-report}.ts`
- `apps/backend/src/routes/{products,analysis,reports}.ts`
- `apps/backend/src/services/{order-repository,ai-report-service}.ts`
- `apps/backend/src/db/schema.ts`

## 3. Affected Areas

- Frontend: yes — page restructure into tabs, new small components (Decision Summary card, price-position bar, possibly a shared inventory-runway util)
- Backend: small, optional — additive sales-summary field(s) for previous-30-day comparison; separately, a correctness fix to `getProductSalesHistory()`'s cancelled-order/`currentQuantity` filtering
- Database: no schema change required (additive query changes only, no new columns)
- Queue/jobs: no
- External APIs: no change to the OpenAI/DataForSEO integration logic
- Tests: frontend currently has **zero** automated tests (no `*.test.*` files, no test script in `apps/frontend/package.json`) — manual validation is the primary safety net unless Tao wants tests introduced as part of this
- Config/infra: no

## 4. Risks

- **Inventory runway formula mismatch**: this task's target format ("Sales rate: 0.6 units/day... Based on the last 30 days") and status ranges (Healthy >45 / Watch 21–45 / Low 8–20 / Critical ≤7) differ from the weighted 7/30/90-day blend and thresholds (90+/Critical≤15/Low 16–30) just shipped on `/products/index.vue`. Showing two different "days remaining" numbers for the same product on two pages will confuse merchants switching between list and detail views.
- **Existing sales-data correctness gap**: `getProductSalesHistory()` overcounts cancelled orders and ignores partial refunds (same bug already fixed elsewhere) — any Decision Summary or Sales tab numbers built on top of it inherit that inaccuracy until fixed.
- **Median/price position depend on a cached AI report that may not exist or be stale** — first-time view of a product with no AI report yet will have an empty Decision Summary for the pricing block; needs an explicit "Generate insights" empty state rather than blank/zero values.
- Pulling `competitorMedianPrice`/`pricePosition` from the AI report ties a "decision-critical" summary number to an LLM call rather than a deterministic calculation — if the model omits/changes a field shape, the summary card silently breaks. The existing `priceInsights` table already computes median/average/percentile via `analyzePrice()` but only persists `minPrice`/`maxPrice`/`marketPosition` — extending that persistence is a smaller, deterministic alternative worth considering.
- No existing frontend test coverage means this restructure has no regression safety net beyond manual click-through.
- Risk of duplicating "total landed price" / "inventory runway" calculation logic in multiple frontend files if not centralized into a shared util now.
- Scope creep: this task alone covers 6 tab sections, 2 new visualizations, and AI-card redesign — must stay disciplined about what ships in one PR (see Complexity).

## 5. Recommended Approach

Summary:
- **Option A — frontend-first restructuring.** Keep all current API contracts. Wrap the existing 5 sections into `UTabs` (Overview / Competition / Sales / AI Insights / Product Details), and add a new always-visible Decision Summary block above the tabs that reuses data already being fetched: `product` (price, inventory), `sales.summary` (sold30d/revenue30d, computed client-side `inventoryRunway`), `competitors` (count, computed landed price), and the cached `aiReport.output.pricing` (median, position, recommendation, confidence) with an explicit empty state when no report exists yet.
- Extract one shared frontend util (e.g. `apps/frontend/app/utils/inventory.ts`) for the runway calculation so list page and detail page both call the same function — even if Tao decides they should use different formulas/thresholds, the decision is then made once, explicitly, in one place instead of two divergent inline implementations.
- Replace `PriceScatterChart` + `PriceBoxChart` with one new small component (e.g. `PricePositionBar.vue`) for the "lowest / median / highest / your price" target visualization — built the same way as the existing custom-SVG charts (no new chart library).
- As a **separately approved, small backend fix** (not bundled into the same PR by default): apply the same `cancelledAt`/`currentQuantity` fix to `order-repository.ts:getProductSalesHistory()` that was already applied to `product-repository.ts`.
- As a **separately approved, small backend addition** (only if Tao wants real previous-30-day trend data rather than skipping that card or computing it from the imprecise `monthly` calendar buckets): add `soldPrev30d`/`revenuePrev30d` to the existing summary query in the same file — additive fields, not a contract break, not a new endpoint.

Likely files:
- `apps/frontend/app/pages/products/[id].vue` (restructure)
- `apps/frontend/app/components/product/DecisionSummary.vue` (new)
- `apps/frontend/app/components/PricePositionBar.vue` (new, replaces 2 existing chart components)
- `apps/frontend/app/utils/inventory.ts` (new, shared with `products/index.vue`)
- `apps/frontend/app/pages/products/index.vue` (small change: switch to shared util, no behavior change unless Tao picks one formula)
- `apps/backend/src/services/order-repository.ts` (gated fix + optional additive fields)

Why this approach:
- The task's own recommendation rule says to prefer Option A when existing APIs already expose reliable data for decision metrics — true here for everything except the previous-30d comparison.
- Avoids a speculative new "dashboard endpoint" (Option B) that would need API-contract approval and more implementation time for data the frontend can already assemble safely.
- Keeps the AI generation/caching model unchanged — no prompt or backend AI logic touched, per task boundaries.

Avoid:
- Don't compute median/price-position independently in the frontend from raw competitor prices — that duplicates the backend's `analyzePrice()` logic with a different (and possibly inconsistent) result. Source it from the cached AI report or, if accuracy without an LLM call matters more, extend `priceInsights` persistence instead (separate approval).
- Don't silently change the `/products/index.vue` inventory formula while doing this — that's the approval item below.
- Don't bundle the `cancelledAt`/`currentQuantity` sales-history fix into the same change as the UI restructure — it's an independent, separately-testable correctness fix.

## 6. Approval Needed

Tao approval is required before:
- Picking one inventory-runway formula/thresholds for both pages (reuse the weighted 7/30/90 blend from `/products`, or adopt this task's simpler 30-day-only spec everywhere) — or confirming it's acceptable for the two pages to intentionally differ.
- Fixing the `cancelledAt`/`currentQuantity` gap in `order-repository.ts:getProductSalesHistory()` (backend correctness change, affects displayed Sales tab numbers).
- Adding `soldPrev30d`/`revenuePrev30d` to the sales summary query, if the Sales tab's "30d vs previous 30d" comparison card is in scope for this round (new analytics query, additive API field).
- Removing `PriceScatterChart`/`PriceBoxChart` in favor of a new `PricePositionBar` (UI behavior change merchants currently see).
- Any decision to extend `priceInsights` persistence (median/average) as a deterministic alternative to AI-report-sourced numbers.

## 7. Test Plan

Automated tests:
- None currently exist for the frontend; this plan doesn't propose adding a test framework unless Tao asks for it explicitly.
- Backend: if the `getProductSalesHistory()` fix is approved, add cases mirroring the existing `product-repository` tests (cancelled order excluded, partial-refund `currentQuantity` honored).

Edge case tests (manual, since no frontend test runner exists):
- Product with no competitors at all (Decision Summary's competitor/median fields empty state)
- Product with only "suggested" (unconfirmed) competitors (median/position still empty, since AI report only uses confirmed)
- Product with no AI report ever generated (empty state + "Generate insights" CTA)
- Product with a stale AI report (generated before current price/competitors changed) — confirm timestamp is visible
- Zero inventory, zero sales, and zero-sales-but-positive-inventory (no divide-by-zero in runway calc)
- Product with no orders at all (Sales tab empty state)
- Mobile viewport: tab bar usability, table overflow inside a tab

Manual validation:
- `pnpm --filter @price-insight/frontend dev`, click through all 6 tabs/Decision Summary on at least 3 real products (with competitors, without, with no AI report)
- Compare `/products` list inventory badge vs detail-page runway widget for the same product once the formula decision is made

Regression checks:
- Existing competitor confirm/delete actions and AI report generation still work unchanged after the restructure
- Pagination on the sales line-items table still works inside its new tab

## 8. Validation Commands

Suggested commands:

```bash
pnpm --filter @price-insight/frontend build
pnpm --filter @price-insight/backend test
```

## 9. Next Implementation Prompt

```markdown
# Task: Product detail page tabbed restructure (Decision Summary + tabs)

## Goal
Restructure apps/frontend/app/pages/products/[id].vue into a Decision Summary
header plus UTabs (Overview / Competition / Sales / AI Insights / Product
Details), reusing existing API responses with no backend contract changes.

## Background
Approved plan: "Price Insight Product Page UX and Decision Dashboard
Restructure". Decision needed first: which inventory-runway formula to use
(see Approval Needed #1) before writing the shared util.

## Scope

Implement only:
- New apps/frontend/app/utils/inventory.ts shared runway calculation, used by
  both products/index.vue and the new Decision Summary.
- New apps/frontend/app/components/product/DecisionSummary.vue.
- New apps/frontend/app/components/PricePositionBar.vue, replacing
  PriceScatterChart/PriceBoxChart usage on this page.
- Wrap existing Overview/Competition/Sales/AI Insights/Product Details
  content in UTabs, with no change to the underlying API calls.

## Boundaries

Do not:
- Change any backend route, service, or schema in this task.
- Change AI prompts or AI report generation logic.
- Change competitor matching/status logic.
- Add a new chart library or dependency (UTabs and custom SVG charts only).
- Touch apps/frontend/app/pages/products/index.vue beyond switching to the
  shared inventory util.

## Expected Changes

Likely files:
- `apps/frontend/app/pages/products/[id].vue`
- `apps/frontend/app/components/product/DecisionSummary.vue`
- `apps/frontend/app/components/PricePositionBar.vue`
- `apps/frontend/app/utils/inventory.ts`
- `apps/frontend/app/pages/products/index.vue`

## Tests

Manual validation (no frontend test runner exists):
- 3 products: with confirmed competitors, with only suggested competitors, with none
- Product with no AI report yet (empty state)
- Zero inventory / zero sales product
- Mobile viewport tab behavior

Run:
```bash
pnpm --filter @price-insight/frontend build
```

## Definition of Done
- All 6 sections accessible via tabs with no functional regression
- Decision Summary shows real numbers for at least price, inventory runway,
  30d sales, competitor count on a product with data
- Empty/loading states match existing patterns (USkeleton, "—" fallback)
```

## 10. Final Status

Waiting for Tao approval.
