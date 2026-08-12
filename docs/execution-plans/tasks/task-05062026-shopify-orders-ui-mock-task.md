# Task: Shopify Orders UI With Mock Data

## Goal

Design and implement the first version of the Price Insight Shopify order listing page and order details page.

Use **mock data first**. Do not connect to the real Shopify order sync API in the first UI pass unless Tony approves.

The UI should not copy Shopify Admin. It should focus on sales data needed for Price Insight pricing analysis.

## Phase 1 — Investigation Only

Do not edit implementation files yet.

Investigate:

1. Existing frontend framework and UI patterns.
2. Existing page layout/navigation.
3. Existing table/card components.
4. Existing product/competitor pages.
5. Existing mock data patterns, fixtures, or demo data usage.
6. Existing API client patterns.
7. Current backend order sync API shape if available.
8. How products may be linked between Shopify and Price Insight.
9. How sync status and errors may be stored later.

Return:

- affected files
- proposed route structure
- proposed component structure
- proposed mock data structure
- proposed page layout
- reusable components
- backend API fields needed later
- risks
- testing plan
- validation commands

End with:

```text
Waiting for Tony approval.
```

---

## Required Pages

### 1. Order Listing Page

Route proposal:

```text
/orders
```

The listing page should include:

- page title: Orders
- manual `Sync Orders Now` button, disabled or mock-only for first version
- last sync status display
- webhook status display
- summary cards
- search input
- filters
- order table
- sync status badges
- row click to detail page

Recommended columns:

- order number
- created date
- customer label or anonymous customer
- item count
- total quantity
- total price
- payment status
- fulfillment status
- refund/cancel status
- sync source
- sync status
- action/view detail

### 2. Order Detail Page

Route proposal:

```text
/orders/:id
```

The detail page should include:

- order header
- order status badges
- `Resync Order` button, disabled or mock-only for first version
- order summary
- line items table
- pricing analysis impact
- refund/cancellation section if relevant
- sync history
- collapsed raw Shopify data/debug section if useful

---

## Use Mock Data First

Create mock data for:

```text
orders
order line items
sync history
pricing analysis impact
product mapping status
```

Mock order examples should include:

1. Normal paid order.
2. Unfulfilled paid order.
3. Refunded order.
4. Cancelled order.
5. Order with unlinked product line.
6. Order synced by webhook.
7. Order synced by scheduled 2 AM job.
8. Order with sync failure.

Example mock order shape:

```ts
type MockOrder = {
  id: string
  orderNumber: string
  shopifyOrderId: string
  createdAt: string
  updatedAt: string
  customerLabel: string
  itemCount: number
  totalQuantity: number
  currency: 'NZD'
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  total: number
  paymentStatus: 'paid' | 'pending' | 'refunded' | 'partially_refunded' | 'voided'
  fulfillmentStatus: 'unfulfilled' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'
  syncStatus: 'synced' | 'pending' | 'failed' | 'skipped'
  syncSource: 'webhook' | 'scheduled_2am' | 'manual'
  lineItems: MockOrderLineItem[]
  syncHistory: MockSyncHistoryItem[]
}
```

Example mock line item shape:

```ts
type MockOrderLineItem = {
  id: string
  title: string
  sku: string | null
  variantTitle: string | null
  quantity: number
  unitPrice: number
  discountTotal: number
  lineTotal: number
  currency: 'NZD'
  mappingStatus: 'linked' | 'unlinked' | 'sku_missing' | 'product_deleted'
  priceInsightProductId?: string
  priceInsightProductName?: string
}
```

Example mock sync history shape:

```ts
type MockSyncHistoryItem = {
  id: string
  time: string
  source: 'webhook' | 'scheduled_2am' | 'manual'
  topic?: 'orders/create' | 'orders/updated' | 'orders/paid' | 'orders/cancelled' | 'refunds/create'
  status: 'received' | 'queued' | 'processed' | 'failed' | 'skipped'
  message: string
}
```

---

## Suggested Wireframe — Order Listing

```text
┌────────────────────────────────────────────────────────────┐
│ Orders                                      [Sync Now]      │
│ Last scheduled sync: Jun 2, 2:00 AM                         │
│ Webhook status: Active                                      │
├──────────────┬──────────────┬──────────────┬───────────────┤
│ Orders Today │ Revenue Today│ Units Sold   │ Sync Failures │
│ 12           │ $486.70      │ 31           │ 0             │
├────────────────────────────────────────────────────────────┤
│ Search orders, SKU, product title                           │
│ [Date Range] [Payment] [Fulfillment] [Sync Status]          │
├────────┬────────────┬───────┬────────┬────────┬────────────┤
│ Order  │ Date       │ Units │ Total  │ Status │ Sync       │
├────────┼────────────┼───────┼────────┼────────┼────────────┤
│ #1051  │ Jun 2 10:15│ 5     │ $129.5 │ Paid   │ Synced     │
│ #1050  │ Jun 2 09:40│ 1     │ $29.90 │ Paid   │ Synced     │
│ #1049  │ Jun 1 18:22│ 2     │ $58.80 │ Refund │ Synced     │
└────────┴────────────┴───────┴────────┴────────┴────────────┘
```

---

## Suggested Wireframe — Order Detail

```text
┌────────────────────────────────────────────────────────────┐
│ Order #1051                                  [Resync Order] │
│ Paid · Unfulfilled · Synced via Webhook                     │
├────────────────────────────────────────────────────────────┤
│ Summary                                                    │
│ Created: Jun 2, 2026 10:15 AM                               │
│ Total: $129.50 NZD                                          │
│ Discount: $10.00                                            │
│ Shipping: $7.50                                             │
├────────────────────────────────────────────────────────────┤
│ Line Items                                                 │
│ Product            SKU        Qty   Price   Total   Mapping │
│ 300ml Moka Pot     MOKA-300   2     29.90   59.80   Linked  │
│ Coffee Scale       SCALE-BLK  1     39.90   34.90   Linked  │
├────────────────────────────────────────────────────────────┤
│ Pricing Analysis Impact                                    │
│ +3 units included in sales summary                          │
│ $94.70 product revenue counted                              │
│ 1 discounted product detected                               │
├────────────────────────────────────────────────────────────┤
│ Sync History                                               │
│ 10:15 Webhook orders/create received                         │
│ 10:16 Single-order sync completed                            │
│ 02:00 Included in scheduled reconciliation                   │
└────────────────────────────────────────────────────────────┘
```

---

## UX Requirements

- Keep customer personal information minimal.
- Use anonymous or simple customer labels in mock data, for example `Customer #1`.
- Show NZD currency clearly.
- Show Auckland/NZ local time in UI.
- Use badges for:
  - payment status
  - fulfillment status
  - sync status
  - product mapping status
- Show warning when a line item is not linked to an internal Price Insight product.
- Show cancelled/refunded orders clearly.
- Make order rows clickable.
- Keep first version simple and reviewable.
- Avoid building full analytics dashboard in this task.

---

## MVP Scope

Build:

1. `/orders` listing page.
2. `/orders/:id` detail page.
3. Mock order data.
4. Summary cards using mock data.
5. Search and simple filters using local mock data.
6. Status badges.
7. Line item table.
8. Product mapping warning.
9. Sync history display.
10. Loading/empty/error visual states if existing app pattern supports it.

Do not build yet:

- real Shopify API connection
- real sync button action
- real webhook status
- real LLM recommendation panel
- advanced analytics dashboard
- customer profile page

---

## Future Backend API Fields Needed

The UI should be designed so it can later consume real backend fields like:

```text
order id
Shopify order ID
order number
created date
updated date
processed date
cancelled date
payment status
fulfillment status
currency
subtotal
discount total
shipping total
tax total
total
line items
SKU
Shopify product ID
Shopify variant ID
Price Insight product mapping
sync source
sync status
sync history
refund/cancellation state
```

---

## Testing Requirements

Investigate suitable tests for:

- order listing page rendering
- order detail page rendering
- mock data display
- summary card calculations
- search by order number
- search by SKU/product title
- filter by payment status
- filter by sync status
- status badge rendering
- unlinked product warning
- empty state
- failed sync visual state
- clicking order row opens detail page

---

## Validation Commands

Investigate project scripts first and recommend only commands that exist in the repo.

Likely examples:

```bash
pnpm typecheck
pnpm test
pnpm turbo test --filter=@price-insight/frontend
pnpm turbo lint --filter=@price-insight/frontend
```

Do not assume these commands exist. Verify package scripts before recommending final commands.

---

## Approval Gate

Claude should only investigate and propose the UI implementation plan first.

After Tony approves, implementation can start with mock data only.
