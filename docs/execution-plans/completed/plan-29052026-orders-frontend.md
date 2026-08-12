# Plan: Build Read-Only Orders Frontend UI

**Date:** 2026-05-29
**Branch:** ai/implementer
**Task file:** `.ai/tasks/implementer-29052026-1.rm`
**Status:** Investigation updated (2026-05-29) — DB pushed (migration 0002 applied) — awaiting APPROVED TO IMPLEMENT

---

## Task Summary

Add read-only Orders UI to the frontend (`/orders`, `/orders/:id`) with backend `GET /api/orders` and `GET /api/orders/:id` endpoints. Also plug missing Shopify order fields into the DB schema before the UI can fully render.

---

## Files Inspected

| File | Purpose |
|---|---|
| `apps/frontend/app/components/AppNav.vue` | Navigation menu — needs Orders entry |
| `apps/frontend/app/layouts/default.vue` | Layout structure |
| `apps/frontend/app/pages/products/index.vue` | Listing page pattern (useFetch, UTable, skeleton, empty state) |
| `apps/frontend/app/pages/products/[id].vue` | Detail page pattern (UCard sections, UBadge, dl/dt/dd) |
| `apps/frontend/app/pages/competitors/index.vue` | Date formatting pattern (`en-NZ` locale) |
| `apps/frontend/shared/types/product.ts` | Type definition pattern |
| `apps/frontend/shared/types/competitor.ts` | Type definition pattern |
| `apps/frontend/nuxt.config.ts` | `apiUrl` via `useRuntimeConfig().public.apiUrl` |
| `apps/frontend/package.json` | No test framework installed |
| `apps/backend/src/services/order-repository.ts` | Existing DB methods (`importOrders`, `getLastSyncedAt`) |
| `apps/backend/src/routes/orders.ts` | Existing `POST /api/orders/sync` only |
| `apps/backend/src/db/schema.ts` | 4 order tables already created |
| `apps/backend/src/__tests__/helpers/build-app.ts` | `buildTestApp` + `makeOrderRepository` already wired |

---

## Key Findings

### 1. Schema gaps vs task spec

Several fields mentioned in the task spec do not exist in the current DB schema:

| Table | Missing columns |
|---|---|
| `orders` | `source_name`, `referring_site`, `landing_site`, `processed_at`, `total_weight` |
| `customers` | `state`, `currency`, `verified_email`, `tags` |
| `customer_addresses` | `name` (display name), `company` |
| `order_items` | `current_quantity` |

These must be added before the detail page can render those sections. This requires a new schema migration and updated Shopify type definitions + `importOrders` mapping.

### 2. No frontend test framework

`apps/frontend/package.json` has no vitest, Playwright, or @testing-library dependency. The task's "Testing" list is frontend-centric. Resolution: add backend route tests (matching the existing `products.test.ts` pattern) that cover the specified scenarios at the API level, and note that component-level frontend tests require a separate framework setup task.

### 3. Frontend patterns (all consistent)
- API: `useFetch<T>(url, { lazy: true })` → `{ data, pending, refresh }`
- Table: `<UTable :data :columns>` with `#xxx-cell` slots
- Cards: `<UCard>` with `<template #header>` + `<dl>` for key-value pairs
- Loading: `<USkeleton />` blocks
- Empty: `<UCard>` with descriptive text
- Badges: `<UBadge :color variant="soft">`
- Dates: `toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Auckland' })`
- Money: `${currency} ${amount.toFixed(2)}`

### 4. Pagination pattern needed
Existing list endpoints return all items (no pagination). Orders needs server-side pagination. Will use `?page=1&limit=20` with `{ items, total, page, limit }` response shape — consistent with common REST patterns.

### 5. Backend GET endpoints needed
Neither `GET /api/orders` nor `GET /api/orders/:id` exists. Both `OrderRepository` and the `orders.ts` route need new methods.

---

## Proposed Files to Change

### Backend
| File | Change |
|---|---|
| `apps/backend/src/db/schema.ts` | Add missing columns to 4 tables |
| `apps/backend/drizzle/0003_*.sql` | Auto-generated migration |
| `apps/backend/src/db/migrate.ts` | Update CREATE TABLE blocks with new columns |
| `apps/backend/src/services/order-repository.ts` | Add `listOrders(opts)` and `getOrderById(id)` |
| `apps/backend/src/services/shopify-service.ts` | Update `ShopifyOrder`, `ShopifyCustomer`, `ShopifyAddress`, `ShopifyLineItem` types with new fields |
| `apps/backend/src/routes/orders.ts` | Add `GET /api/orders` and `GET /api/orders/:id` |
| `apps/backend/src/__tests__/orders.test.ts` | Route tests for both GET endpoints |

### Frontend
| File | Change |
|---|---|
| `apps/frontend/app/components/AppNav.vue` | Add `{ label: 'Orders', to: '/orders' }` between "Competitor Products" and "Insight" |
| `apps/frontend/shared/types/order.ts` | New — TypeScript types for OrderListItem, OrderDetail, OrderItem |
| `apps/frontend/app/pages/orders/index.vue` | New — orders listing page |
| `apps/frontend/app/pages/orders/[id].vue` | New — order detail page |

---

## Implementation Plan

### Step 0 — Schema extension

Add missing columns to `schema.ts`:

```
orders:           source_name VARCHAR(255), referring_site TEXT, landing_site TEXT,
                  processed_at TIMESTAMP NULL, total_weight DECIMAL(10,3)

customers:        state VARCHAR(32), currency VARCHAR(16), verified_email BOOLEAN,
                  customer_tags TEXT

customer_addresses: address_name VARCHAR(255), company VARCHAR(255)

order_items:      current_quantity INT
```

**DB already pushed (migration 0002 applied).** The 4 tables exist in the DB without the extra columns. Running `db:generate` will produce `0003_*.sql` with `ALTER TABLE ADD COLUMN` statements — not CREATE TABLE.

Run `db:generate` → review `0003_*.sql` → also add the same columns to the inline `CREATE TABLE` blocks in `migrate.ts` (that script is drop-and-recreate for fresh installs).

Update `ShopifyOrder` / `ShopifyCustomer` / `ShopifyAddress` / `ShopifyLineItem` types with new fields.
Update `importOrders` to map the new fields.

### Step 1 — Backend: `OrderRepository` list + detail

**`listOrders(opts: { page, limit, search?, financialStatus?, fulfillmentStatus? })`**
- LEFT JOIN `customers` for customer name/email in listing
- `COUNT(order_items.id)` for items count
- Default `ORDER BY orders.shopify_created_at DESC`
- Returns `{ items: OrderListRow[], total: number }`

**`getOrderById(id: number)`**
- Fetch order row
- Fetch customer row (if customerId set)
- Fetch customer_address row (by customerId)
- Fetch order_items rows LEFT JOIN products (for `productTitle` match)
- Return combined object or null

### Step 2 — Backend: GET routes

```
GET /api/orders?page=1&limit=20&search=&financialStatus=&fulfillmentStatus=
  → orderRepository.listOrders(opts)
  → return { items, total, page, limit }

GET /api/orders/:id
  → orderRepository.getOrderById(parseInt(id))
  → 404 if null
  → return { item: ... }
```

Note: route param is local DB `id` (not Shopify order ID). Frontend will link by DB id.

### Step 3 — Frontend types (`shared/types/order.ts`)

```typescript
OrderListItem { id, shopifyOrderId, orderNumber, email, customer { firstName, lastName },
  financialStatus, fulfillmentStatus, currency, totalPrice, totalShipping, itemCount,
  shopifyCreatedAt }

OrderCustomer { ... all customer fields ... }
OrderAddress  { ... all address fields ... }
OrderItem     { ... all order_item fields + productTitle }
OrderDetail   { order fields, customer, address, items }
```

### Step 4 — Frontend: Orders listing page (`/orders`)

- `useFetch` to `GET /api/orders?page=${page}&limit=20`
- UTable with columns: Order Name (link), Customer, Financial Status, Fulfillment Status, Total Price, Total Shipping, Items Count, Created At
- Order Name cell links to `/orders/:id`
- Financial/fulfillment status as `<UBadge>`
- Pagination using `<UPagination>`
- Search input (debounced, appended to query)
- Loading: USkeleton rows
- Empty: UCard with message
- Error: toast on fetch failure

### Step 5 — Frontend: Order detail page (`/orders/:id`)

- `useFetch` to `GET /api/orders/:id`
- 5 UCard sections:
  1. Order Summary — all order-level fields
  2. Customer Summary — customer fields (hidden if no customer)
  3. Address — address fields (hidden if no address)
  4. Order Items — UTable with Product, SKU, Qty, Current Qty, Unit Price, Discount, Line Total, Local Match
  5. Source/Attribution — source_name, referring_site, landing_site
- Back button → `/orders`
- No edit/delete actions
- Null/missing values → "—"
- Dates → Auckland timezone

### Step 6 — AppNav

Add `{ label: 'Orders', to: '/orders' }` after "Competitor Products" and before "Insight".

### Step 7 — Backend route tests (`orders.test.ts`)

Using `buildTestApp` pattern (matching `products.test.ts`):
- `GET /api/orders` returns 200 with `{ items, total, page, limit }`
- `GET /api/orders` sorts newest first by default
- `GET /api/orders` returns 200 with empty items array (empty state)
- `GET /api/orders?search=1001` calls listOrders with search param
- `GET /api/orders?financialStatus=paid` passes filter through
- `GET /api/orders?page=2&limit=5` passes pagination params
- `GET /api/orders/:id` returns 200 with full detail
- `GET /api/orders/:id` returns 404 when order not found
- `GET /api/orders/:id` returns detail with null customer (guest order)
- No POST/PUT/DELETE on `/api/orders/:id` (orders are read-only)

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Schema extension requires new migration + sync restart | Medium | Run `db:generate` + `db:push` before testing |
| `listOrders` JOIN query is more complex than existing repos | Medium | Use Drizzle's `leftJoin` + `count` — well-supported |
| No frontend test framework | Medium | Substitute with backend API route tests; note limitation |
| `referring_site` / `landing_site` can be very long strings | Low | Use `class="truncate"` in table; wrap safely in detail |
| Pagination state not preserved on browser back | Low | Use query params `?page=N` so URL is shareable/bookmarkable |
| `UPagination` component API may differ from Nuxt UI v4 | Low | Check `.nuxt/ui/pagination.ts` for exact prop names before using |

---

## Test Plan

**Backend route tests** (vitest, `buildTestApp` pattern):
- [ ] GET /api/orders → 200, items array, total, page, limit
- [ ] GET /api/orders — empty DB → empty items, total=0
- [ ] GET /api/orders?search= → search forwarded to repository
- [ ] GET /api/orders?financialStatus= → filter forwarded
- [ ] GET /api/orders?page=2&limit=5 → pagination forwarded
- [ ] GET /api/orders/:id → 200, full detail object
- [ ] GET /api/orders/999 → 404 ORDERS_NOT_FOUND
- [ ] GET /api/orders/:id with no customer → customer/address null in response
- [ ] No destructive routes exist on orders

---

## Estimated Complexity

**Large** — 8–12 hours.
Schema extension + updated import logic + two new repository methods + two new routes + two frontend pages + pagination. All pieces are well-defined but the volume is significant.

---

## Validation Commands

```bash
pnpm --filter @price-insight/backend db:generate
pnpm --filter @price-insight/backend build
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/frontend build
```

---

## Waiting for: APPROVED TO IMPLEMENT
