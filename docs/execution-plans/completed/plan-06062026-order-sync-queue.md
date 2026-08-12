# Plan: BullMQ Order Sync Queue Backend

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/load_orders
- Coordination repo: /srv/price-insight

## Source Task File
- Task file: task-06062026-order-queue-implementation.md

## Task Summary
Implement Shopify order sync via BullMQ:
1. Scheduled 2 AM NZ rolling-window discovery (last 36 hours).
2. Manual "Sync Today" — Auckland today's date range only.
3. Discovery fetches orders via **Shopify GraphQL Admin API**, enqueues one BullMQ job per order (raw payload in job).
4. Worker processes one raw Shopify order at a time — map, staleness check, upsert.
5. Staleness guard: skip if incoming `shopify_updated_at <= stored orders.shopify_updated_at`.
6. No webhooks. No `shopify_sync_runs` table.

---

## Files Inspected

- `apps/backend/src/services/shopify-service.ts` — existing fetchOrders is **REST**, not GraphQL
- `apps/backend/src/services/order-repository.ts` — upsertOrder does blind update (no staleness check)
- `apps/backend/src/db/schema.ts` — `orders.shopify_order_id` bigint (numeric), `shopify_updated_at` indexed
- `apps/backend/src/routes/orders.ts` — existing `POST /api/orders/sync` is synchronous REST fetch+import
- `apps/backend/src/app.ts` — service wiring via `app.decorate()`
- `apps/backend/src/config/env.ts` — Redis vars NOT in schema; SHOPIFY_ORDERS_URL optional
- `apps/backend/.env.example` — REDIS_HOST/PORT/PASSWORD/DB present; SHOPIFY_ORDERS_URL missing
- `apps/backend/src/types/fastify.d.ts` — FastifyInstance augmentation pattern
- `apps/backend/src/server.ts` — plain startup, no scheduler
- `apps/backend/src/__tests__/helpers/build-app.ts` — vi.fn() mock pattern
- `apps/backend/package.json` — `ioredis ^5.7.0` installed; **BullMQ NOT installed**
- `~/workers/doc/data/shopify-orders.json` — sample data is REST format (see critical finding below)

---

## Critical Finding — REST vs GraphQL

The sample data file (`shopify-orders.json`) is **REST API format**:
- Field names are snake_case: `financial_status`, `total_price`
- Numeric IDs: `"id": 6283106812059`
- Line items as flat array: `line_items[]`

The task Rule 1 says: **use Shopify GraphQL Admin API**.

The existing `ShopifyService.fetchOrders()` uses REST (`SHOPIFY_ORDERS_URL`). The task allows staying on REST "if investigation proves changing it is too risky."

**Recommendation:** Build the GraphQL fetcher as a new service (`ShopifyGraphQLService`), keeping existing REST `ShopifyService` untouched. The existing `POST /api/orders/sync` (REST-based, synchronous) remains as-is. New endpoint `POST /api/shopify/orders/sync` uses GraphQL + queue.

**GraphQL → DB ID mapping:** GraphQL returns GIDs like `"gid://shopify/Order/6283106812059"`. Must extract numeric ID: `gid.split('/').pop()` → `6283106812059`. DB stores numeric bigint — mapping required.

---

## Affected Apps / Packages
- `apps/backend` only

---

## Proposed Files to Change

### New files
| File | Purpose |
|---|---|
| `src/config/redis.ts` | IORedis connection factory |
| `src/services/shopify-graphql-service.ts` | GraphQL order fetcher (discovery) |
| `src/services/order-sync-queue.ts` | BullMQ Queue + `SyncOrderJob` type |
| `src/workers/order-sync-worker.ts` | BullMQ Worker — processes one order payload |
| `src/lib/order-mapper.ts` | Maps GraphQL order → DB insert types |
| `src/lib/nz-date-range.ts` | Auckland today start/end → UTC converter |
| `src/routes/shopify.ts` | `POST /api/shopify/orders/sync` |
| `src/scheduler.ts` | BullMQ repeatable 2 AM NZT job (or optional — see decision) |
| `src/__tests__/order-mapper.test.ts` | Unit tests for mapper |
| `src/__tests__/nz-date-range.test.ts` | Unit tests for NZ date range |
| `src/__tests__/shopify-graphql.test.ts` | Route + queue payload tests |

### Modified files
| File | Change |
|---|---|
| `src/config/env.ts` | Add `REDIS_HOST/PORT/PASSWORD/DB` (no new Shopify var needed) |
| `src/app.ts` | Wire Redis, queue, worker, scheduler, new route |
| `src/types/fastify.d.ts` | Add `orderSyncQueue` to FastifyInstance |
| `src/services/order-repository.ts` | Add staleness check to `upsertOrder()` |
| `src/__tests__/helpers/build-app.ts` | Add `orderSyncQueue` mock, `shopifyGraphQLService` mock |
| `apps/backend/.env.example` | Add `SHOPIFY_ORDERS_URL` (missing from example) |

---

## GraphQL Query Shape

```graphql
query GetOrders($cursor: String, $query: String) {
  orders(first: 100, after: $cursor, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      updatedAt
      processedAt
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      currencyCode
      tags
      sourceName
      subtotalPriceSet     { shopMoney { amount currencyCode } }
      totalDiscountsSet    { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet          { shopMoney { amount currencyCode } }
      totalPriceSet        { shopMoney { amount currencyCode } }
      customer {
        id
        email
        firstName
        lastName
        phone
        state
        tags
        defaultAddress { id address1 address2 city province country zip name company }
      }
      shippingAddress { address1 address2 city province country zip name firstName lastName company }
      lineItems(first: 50) {
        nodes {
          id
          title
          sku
          vendor
          quantity
          variantTitle
          variant { id }
          product { id }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedTotalSet   { shopMoney { amount currencyCode } }
        }
      }
    }
  }
}
```

**Filter strings:**
- Scheduled: `"updated_at:>2026-06-05T02:00:00Z"` (last 36 hours)
- Manual today: `"updated_at:>=2026-06-05T12:00:00Z updated_at:<=2026-06-06T11:59:59Z"` (Auckland day in UTC)

**GraphQL URL:** Derived from existing `SHOPIFY_PRODUCTS_URL` — no new env var needed:
```ts
const graphqlUrl = env.SHOPIFY_PRODUCTS_URL!.replace(/\/products\.json$/, '/graphql.json')
```

---

## Job Payload Type

```ts
type SyncOrderJob = {
  type: 'sync-order'
  source: 'scheduled_2am' | 'manual'
  shopifyOrderId: string      // GID string: "gid://shopify/Order/..."
  orderName: string           // "#WD3550"
  shopifyUpdatedAt: string    // ISO UTC
  shopifyOrder: ShopifyGraphQLOrder  // raw GraphQL node
}
```

Queue: `shopify-order-sync`
Retry: `{ attempts: 3, backoff: { type: 'exponential', delay: 2000 } }`
`removeOnComplete: { count: 200 }` — keep recent for queue UI
`removeOnFail: false` — keep all failed for debugging

---

## Implementation Plan

### Step 1 — Dependency install (requires Tony approval)
```bash
pnpm --filter @price-insight/backend add bullmq
```

### Step 2 — Env schema
Add to `config/env.ts`:
```ts
REDIS_HOST: z.string().default("127.0.0.1"),
REDIS_PORT: z.coerce.number().int().positive().default(6379),
REDIS_PASSWORD: z.string().default(""),
REDIS_DB: z.coerce.number().int().min(0).default(0),
// No new Shopify var — GraphQL URL derived from SHOPIFY_PRODUCTS_URL at runtime
```

### Step 3 — Redis factory (`config/redis.ts`)
```ts
export function createRedisConnection(env: AppEnv): IORedis {
  return new IORedis({
    host: env.REDIS_HOST, port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null  // required by BullMQ
  })
}
```

### Step 4 — GraphQL service (`services/shopify-graphql-service.ts`)
- `fetchOrdersUpdatedSince(accessToken, fromDate, toDate?)` → paginates via cursor
- Auth: `X-Shopify-Access-Token` header (same as REST)
- Returns `ShopifyGraphQLOrder[]`

### Step 5 — Order mapper (`lib/order-mapper.ts`)
- `extractId(gid: string): number` — strips GID prefix
- `mapGraphQLOrderToUpsert(order: ShopifyGraphQLOrder)` → DB payload shapes
- `mapGraphQLLineItemsToUpsert(items, orderId)` → order_items payload
- Maps `displayFinancialStatus` (PAID) → lowercase `financial_status` (paid)
- Maps `displayFulfillmentStatus` (UNFULFILLED) → lowercase

### Step 6 — NZ date range (`lib/nz-date-range.ts`)
```ts
export function getTodayNZRange(): { from: Date; to: Date } {
  // Auckland = UTC+12 (NZST) or UTC+13 (NZDT)
  // Use Intl.DateTimeFormat to get correct local date
  const tz = 'Pacific/Auckland'
  const nowNZ = new Date().toLocaleDateString('en-NZ', { timeZone: tz })
  // build midnight NZT start/end, convert to UTC
}
```

### Step 7 — Queue service (`services/order-sync-queue.ts`)
- `createOrderSyncQueue(redis)` → `Queue<SyncOrderJob>`
- BullMQ queue named `shopify-order-sync`

### Step 8 — Worker (`workers/order-sync-worker.ts`)
- `concurrency: 1` to serialise writes
- Processor: staleness check → `orderRepository.upsertOneOrder(mappedOrder)` (new method)
- Mark complete on skip (not failure)

### Step 9 — Staleness check (`services/order-repository.ts`)
Add `upsertOneOrder(graphqlOrder)` method (or modify `upsertOrder` to accept staleness check):
```ts
if (existing?.shopifyUpdatedAt) {
  const stored = new Date(existing.shopifyUpdatedAt)
  const incoming = new Date(data.shopifyUpdatedAt)
  if (incoming <= stored) return { skipped: true }
}
// proceed with upsert + line item replace
```
Line items: delete existing then insert fresh (simpler than per-item upsert; safe within transaction).

### Step 10 — New route (`routes/shopify.ts`)
`POST /api/shopify/orders/sync`:
- Body: `{ mode: 'today', source: 'manual' }`
- Validates `mode === 'today'`
- Calculates NZ today range
- Calls GraphQL service, enqueues one job per order
- Returns `{ status: 'queued', ordersDiscovered: N, jobsEnqueued: N, ... }`

### Step 11 — Scheduler (`scheduler.ts`)
BullMQ repeatable job: `{ repeat: { pattern: '0 14 * * *' } }` (14:00 UTC = 2 AM NZST)
- Job payload: `{ type: 'scheduled-discovery', source: 'scheduled_2am' }`
- Worker branch: if `type === 'scheduled-discovery'`, fetch last 36 hours, enqueue per-order jobs
- If Option B (GKE), skip in-process scheduler and build a script instead

### Step 12 — App wiring (`app.ts`)
- Create Redis connection, queue, worker
- `onClose`: close worker → close queue → quit Redis

---

## Risks / Edge Cases

| Risk | Mitigation |
|---|---|
| `bullmq` not installed — no code runs without it | Stop before Phase 2; Tony must approve install |
| GID → numeric ID extraction | Unit-tested in mapper; `parseInt(gid.split('/').pop()!)` |
| GraphQL `displayFinancialStatus` is uppercase | Mapper lowercases before DB insert |
| `customer.state` is uppercase in GraphQL (DISABLED) | Mapper lowercases |
| `verified_email` not in GraphQL Customer | Store as `null` — column is nullable |
| `customer.currency` not on GraphQL Customer | Store as `null` — take from order.currencyCode if needed |
| NZ DST: 2 AM NZST = 14:00 UTC, 2 AM NZDT = 13:00 UTC | cron at `0 14 * * *` runs 1h early in summer — acceptable MVP, documented |
| `lineItems(first: 50)` pagination | Flag if line item count can exceed 50; may need nested pagination |
| Existing `POST /api/orders/sync` (REST) kept as-is | No breaking change to existing route |
| Worker `concurrency: 1` limits throughput | Acceptable for MVP; can raise after staleness check is verified |
| `SHOPIFY_GRAPHQL_URL` not in `.env.example` | Must add before implementation |

---

## Database Impact
None — no new migrations. Existing schema is sufficient.
Staleness guard and line-item replace/insert are application-level only.

## API Impact
- **New**: `POST /api/shopify/orders/sync` — queues today's orders, returns 202 + counts
- **Existing** `POST /api/orders/sync` — unchanged (REST, synchronous, backward-compatible)

## UI Impact
- `/orders` "Sync Now" button currently calls `POST /api/orders/sync`
- Task requires it to call `POST /api/shopify/orders/sync` with `{ mode: 'today', source: 'manual' }`
- Toast copy changes to reflect "queued" vs "synced"
- Frontend needs to handle 202 + new response shape

## Infrastructure / Config Impact
- Redis must be available (already in dev stack)
- `SHOPIFY_GRAPHQL_URL` must be set in each environment

## Dependency Impact
- `bullmq` must be added — **requires Tony approval**

## Decision Point Required
**Scheduler approach:**
- **Option A** (recommended): BullMQ repeatable job in Fastify process — `0 14 * * *` UTC, stored in Redis
- **Option B**: Standalone script + GKE CronJob — matches `find-all-competitors` pattern

---

## Validation Commands
```bash
pnpm turbo test --filter=@price-insight/backend
pnpm --filter @price-insight/backend build
```
(No separate lint script in backend package.json scripts — use turbo lint if available)

## Approval Status
Waiting for Tony approval.
