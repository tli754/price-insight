# Plan: Shopify Orders UI With Mock Data

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/load_orders
- Coordination repo: /srv/price-insight

## Source Task File
- Task file: task-05062026-shopify-orders-ui-mock-task.md

## Task Summary
Enhance the existing orders listing and detail pages with summary cards,
sync status display, mock sync history, pricing analysis impact, and
product mapping warnings. Both pages already exist and connect to the
real API — the task adds mock-data-powered UI sections on top.

## Files Inspected
- apps/frontend/app/pages/orders/index.vue (175 lines — listing page)
- apps/frontend/app/pages/orders/[id].vue (287 lines — detail page)
- apps/frontend/app/components/AppNav.vue
- apps/frontend/shared/types/order.ts
- apps/frontend/package.json (no test runner — lint only)

## Affected Apps / Packages
- apps/frontend (@price-insight/frontend)

## Proposed Files to Change

### New files
- apps/frontend/app/data/mock-orders.ts — mock order data (8 examples per task spec)
- apps/frontend/shared/types/mock-order.ts — MockOrder, MockOrderLineItem, MockSyncHistoryItem types

### Modified files
- apps/frontend/app/pages/orders/index.vue — add summary cards, sync status column, last sync header
- apps/frontend/app/pages/orders/[id].vue — add sync history section, pricing impact section, mapping warnings

## Existing Patterns Found
- UCard, UBadge, UTable, UButton, USkeleton all used on existing pages
- Status colours follow: success/warning/error/neutral pattern
- Dates formatted with en-NZ locale, Pacific/Auckland timezone
- NuxtLink for navigation, useFetch for API calls
- No mock data pattern exists yet — will introduce it
- No test runner in frontend package.json — typecheck only via turbo

## Implementation Plan

### 1. Types (shared/types/mock-order.ts)
Define MockOrder, MockOrderLineItem, MockSyncHistoryItem matching task spec shapes.

### 2. Mock data (app/data/mock-orders.ts)
8 mock orders covering all task-specified scenarios:
1. Normal paid + fulfilled
2. Unfulfilled paid
3. Refunded
4. Cancelled
5. Order with unlinked line item
6. Synced by webhook
7. Synced by scheduled 2 AM job
8. Sync failure

### 3. Listing page enhancements
- Header row: "Last scheduled sync: Jun 2, 2:00 AM · Webhook: Active"
- 4 summary cards: Orders Today / Revenue Today / Units Sold / Sync Failures
  (computed from mock data, filtered to today)
- Add Sync Status column to table (badge: synced/pending/failed/skipped)
- Add Sync Source column (webhook / scheduled / manual)
- Add item count column (already in OrderListItem type)
- Keep real API connection for the table rows — overlay mock sync fields

### 4. Detail page enhancements
- Sync status badge in header (from mock data keyed by order ID)
- Sync History section (from mock data)
- Pricing Analysis Impact section (computed from line items — units, revenue, discounted count)
- Product mapping warning badge on unlinked line items (already has "Local Match" column — upgrade to badge with warning colour for null productTitle)
- Resync Order button (disabled, mock-only)

## Risks / Edge Cases
- Mock sync fields won't match real order IDs — keyed by order number string for display only
- Summary cards show today's stats from mock data only until real sync-status tracking is built
- Listing page mixes real API data with mock sync fields — make this obvious in code comments
- No test runner exists — can only validate with typecheck + lint

## Database Impact
None — mock data only.

## API Impact
None — no new endpoints.

## UI Impact
Both orders pages get new sections. Existing functionality unchanged.

## Infrastructure / Config Impact
None.

## Dependency Impact
None.

## Validation Commands
```bash
pnpm turbo typecheck --filter=@price-insight/frontend
pnpm turbo lint --filter=@price-insight/frontend
```

## Approval Status
Waiting for Tony approval.
