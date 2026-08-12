# Plan: Refactor Scheduled Discovery — BullMQ Repeatable → Direct Cron

## 1. Summary

Replace the current two-step BullMQ approach (repeatable `discover-orders` job → worker fans out `sync-order` jobs) with a single `node-cron` scheduler that calls `fetchOrders` and enqueues `sync-order` jobs directly at 2am NZST. This eliminates `DiscoverOrdersJobData`, the `discover-orders` worker branch, and the BullMQ repeatable job entirely.

---

## 2. Current Implementation

**`apps/backend/src/scheduler.ts`:** Registers a BullMQ repeatable job (`name: "scheduled-discovery"`, `pattern: "0 14 * * *"`) on every app startup. BullMQ deduplicates by name+pattern.

**Worker `discover-orders` branch (`order-sync-worker.ts`):** Runs when the repeatable fires — fetches orders via `getLast36Hours()` filter, enqueues one `sync-order` job per order with full `shopifyOrder` payload.

**`DiscoverOrdersJobData`** `{ type: "discover-orders"; source: "scheduled_2am" }` — carried in the queue only to trigger the fan-out. No business data.

**`app.ts`:** Calls `setupScheduler(orderSyncQueue)` only when both `shopifyService` and `shopifyGraphQLService` are configured.

No `node-cron` or cron-style package is currently in `package.json`.

Main files:
- `apps/backend/src/scheduler.ts`
- `apps/backend/src/workers/order-sync-worker.ts`
- `apps/backend/src/services/order-sync-queue.ts`
- `apps/backend/src/app.ts`

---

## 3. Affected Areas

- **Frontend:** No
- **Backend:** Yes — scheduler, worker, queue types, app wiring
- **Database:** No
- **Queue/jobs:** Yes — `DiscoverOrdersJobData` removed; `OrderSyncJobData` union simplified to `SyncOrderJobData | SyncWebhookOrderJobData`
- **External APIs:** No change in calls — `fetchOrders` moves into the cron callback; window changes from 36h → 24h
- **Tests:** Yes — discover-orders worker branch untested today; no test files reference `DiscoverOrdersJobData`; new `scheduler.test.ts` needed
- **Config/infra:** New dependency `node-cron` + `@types/node-cron` (approval required)

---

## 4. Risks

- **Existing repeatable still in Redis:** After deploy the old `scheduled-discovery` repeatable is still stored in Redis. Without cleanup, BullMQ fires it at 2am but the worker has no `discover-orders` handler → job fails silently. Must call `queue.removeRepeatable("scheduled-discovery", { pattern: "0 14 * * *" })` on startup before the scheduler runs.
- **New dependency:** `node-cron` not yet installed. Requires `pnpm add node-cron` + `pnpm add -D @types/node-cron`.
- **NZDT offset:** Cron `0 14 * * *` UTC = 2am NZST (UTC+12). In NZDT (Oct–Apr, UTC+13) this fires at 3am — noted as acceptable in the existing scheduler comment.
- **Window change 36h → 24h:** Current worker uses `getLast36Hours()`. The refactor reduces this to 24h. With the webhook now providing real-time updates, the 36h overlap is no longer needed. Any gaps from a missed cron run are now covered by the webhook flow.
- **No discovery-level retry on cron failure:** If Shopify is down when the cron fires, discovery silently fails. Individual `sync-order` jobs still retry via BullMQ exponential backoff. Real-time gaps are covered by the webhook.
- **Graceful shutdown in tests:** `node-cron` tasks must be stopped on `app.close()` / after tests to avoid dangling timers causing Vitest to hang.

---

## 5. Recommended Approach

### New `scheduler.ts`

```typescript
import cron from "node-cron";
import type { Queue } from "bullmq";
import type { OrderSyncJobData, SyncOrderJobData } from "./services/order-sync-queue.js";
import type { ShopifyGraphQLService } from "./services/shopify-graphql-service.js";
import type { ShopifyService } from "./services/shopify-service.js";
import { getLast24Hours } from "./lib/nz-date-range.js";

export function setupScheduler(
  queue: Queue<OrderSyncJobData>,
  shopifyService: ShopifyService,
  shopifyGraphQLService: ShopifyGraphQLService
): cron.ScheduledTask {
  return cron.schedule("0 14 * * *", async () => {
    try {
      const from = getLast24Hours();
      const filter = `updated_at:>${from.toISOString()}`;
      const accessToken = await shopifyService.getAccessToken();
      const orders = await shopifyGraphQLService.fetchOrders(accessToken, filter);
      for (const order of orders) {
        const jobData: SyncOrderJobData = {
          type: "sync-order",
          source: "scheduled_2am",
          shopifyOrderId: order.id,
          orderName: order.name,
          shopifyUpdatedAt: order.updatedAt,
          shopifyOrder: order,
        };
        await queue.add("sync-order", jobData);
      }
      console.info(`[scheduler] Scheduled discovery complete: ${orders.length} orders enqueued.`);
    } catch (err) {
      console.error("[scheduler] Scheduled discovery failed:", err);
    }
  });
}
```

### Wiring in `app.ts`

```typescript
if (shopifyService && shopifyGraphQLService) {
  // Remove old BullMQ repeatable to prevent stale discover-orders jobs firing after deploy
  await orderSyncQueue.removeRepeatable("scheduled-discovery", { pattern: "0 14 * * *" });
  const cronTask = setupScheduler(orderSyncQueue, shopifyService, shopifyGraphQLService);
  app.addHook("onClose", async () => { cronTask.stop(); });
}
```

The existing `onClose` hook (worker/queue/redis/pool cleanup) stays unchanged.

### Type changes in `order-sync-queue.ts`

- Remove `DiscoverOrdersJobData` export
- Update `OrderSyncJobData = SyncOrderJobData | SyncWebhookOrderJobData`

### Worker change in `order-sync-worker.ts`

- Remove `SyncOrderJobData` import (no longer needed for fan-out)
- Remove entire `if (job.data.type === "discover-orders")` branch — worker now only handles `sync-order`

### Summary of changed files

1. `apps/backend/package.json` — add `node-cron`; add `@types/node-cron` to devDependencies *(approval required)*
2. `apps/backend/src/lib/nz-date-range.ts` — add `getLast24Hours()` (mirrors `getLast36Hours` at 24h)
3. `apps/backend/src/scheduler.ts` — rewrite: direct cron using `getLast24Hours`, no BullMQ repeatable
4. `apps/backend/src/services/order-sync-queue.ts` — remove `DiscoverOrdersJobData`; simplify union
5. `apps/backend/src/workers/order-sync-worker.ts` — remove `discover-orders` branch
6. `apps/backend/src/app.ts` — call `removeRepeatable`, pass services to `setupScheduler`, stop cron on close
7. `apps/backend/src/__tests__/scheduler.test.ts` *(new)* — unit tests for the cron callback

Avoid:
- Changing `SyncOrderJobData.shopifyOrder` (Follow-up A, separate task)
- Moving cron into a Fastify plugin

---

## 6. Approval Needed

- **`pnpm add node-cron` + `pnpm add -D @types/node-cron`** — new runtime dependency
- **`queue.removeRepeatable("scheduled-discovery", { pattern: "0 14 * * *" })`** — modifies Redis state on deploy; confirm the job name and pattern match the existing repeatable exactly

---

## 7. Test Plan

New tests (`apps/backend/src/__tests__/scheduler.test.ts`):
- Cron callback fetches orders with the correct 36h filter and enqueues one `sync-order` job per order
- Cron callback enqueues nothing when `fetchOrders` returns empty
- Cron callback catches and logs errors without throwing (does not crash the process)
- Enqueued job has `type: "sync-order"`, `source: "scheduled_2am"`, `shopifyOrderId`, `shopifyUpdatedAt`, `shopifyOrder`

Regression checks (no changes expected):
- `shopify-orders-sync.test.ts` — manual sync passes unchanged
- `shopify-webhook.test.ts` — passes unchanged
- `shopify-queue.test.ts` — passes unchanged
- `order-mapper.test.ts` — passes unchanged

Manual validation post-deploy:
- Confirm no `discover-orders` repeatable remains in BullMQ (check Redis or queue UI)

---

## 8. Validation Commands

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
```

---

## 9. Next Implementation Prompt

```markdown
# Task: Scheduler Refactor — BullMQ Repeatable → Direct Cron

## Goal

Replace the BullMQ repeatable `discover-orders` job with a `node-cron` scheduler
that directly fetches orders and enqueues `sync-order` jobs. Eliminate
`DiscoverOrdersJobData` and the worker `discover-orders` branch.

## Background

Backend: Fastify 5 + BullMQ + MySQL. `node-cron` is not yet installed.
`scheduler.ts` currently calls `queue.add(..., { repeat: ... })`.
The worker has a `discover-orders` branch that fans out `sync-order` jobs.
Both are being replaced by a direct cron callback using a 24-hour lookback window.

A `removeRepeatable` call on startup is required to clean up the existing
BullMQ repeatable stored in Redis from prior deployments.

## Scope

1. `apps/backend/package.json` — add `node-cron` (runtime) and `@types/node-cron` (dev)
2. `apps/backend/src/lib/nz-date-range.ts` — add `getLast24Hours(now = new Date()): Date`
3. `apps/backend/src/scheduler.ts` — rewrite: `node-cron` schedules `"0 14 * * *"`, callback uses `getLast24Hours`, enqueues `sync-order` jobs; errors caught and logged
4. `apps/backend/src/services/order-sync-queue.ts` — remove `DiscoverOrdersJobData`; `OrderSyncJobData = SyncOrderJobData | SyncWebhookOrderJobData`
5. `apps/backend/src/workers/order-sync-worker.ts` — remove `discover-orders` branch
6. `apps/backend/src/app.ts` — call `queue.removeRepeatable("scheduled-discovery", { pattern: "0 14 * * *" })` before scheduler setup; pass `shopifyService` + `shopifyGraphQLService` to `setupScheduler`; stop cron task in `onClose`
7. `apps/backend/src/__tests__/scheduler.test.ts` *(new)* — unit tests for cron callback

## Boundaries

Do not:
- Change `SyncOrderJobData.shopifyOrder` or any existing producer
- Change `SyncWebhookOrderJobData` or the webhook route
- Move cron into a Fastify plugin

## Key implementation note

`setupScheduler` signature change:
```typescript
// Before
export async function setupScheduler(queue: Queue<OrderSyncJobData>): Promise<void>

// After
export function setupScheduler(
  queue: Queue<OrderSyncJobData>,
  shopifyService: ShopifyService,
  shopifyGraphQLService: ShopifyGraphQLService
): cron.ScheduledTask
```

## Tests

`apps/backend/src/__tests__/scheduler.test.ts`:
- Callback fetches orders and enqueues one job per order with correct fields
- Callback enqueues nothing for empty result
- Callback catches errors without throwing

Run:
```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
```

## Definition of Done

* `node-cron` installed and TypeScript build passes
* `scheduler.ts` uses `node-cron`, no BullMQ repeatable
* `DiscoverOrdersJobData` removed everywhere
* Worker handles only `sync-order`
* All existing tests pass unchanged
* New scheduler tests pass
```

---

## 10. Final Status

Waiting for Tao approval.
