# Plan: Shopify Webhook Real-Time Order Sync

## 1. Summary

Add `POST /webhooks/shopify/orders` to receive real-time Shopify order events. The route verifies Shopify HMAC using the raw request body, filters supported order topics, deduplicates via BullMQ `jobId = webhookId`, and enqueues a lightweight `SyncWebhookOrderJobData` job containing only the order ID and webhook metadata. The worker handles the new `source: "webhook"` branch by performing a staleness pre-check, fetching the full order from Shopify GraphQL via a new `fetchOrderById` method, then reusing the existing `mapGraphQLOrder` → `upsertMappedOrder` path.

Existing scheduled/manual sync code is **not changed**. The scheduler refactor and `shopifyOrder` payload cleanup are flagged as separate follow-up tasks.

---

## 2. Current Implementation

**Order sync flow (unchanged):** Scheduled and manual syncs fetch orders in bulk from Shopify GraphQL, enqueue `sync-order` jobs with the full `ShopifyGQLOrder` payload, and the worker maps directly from the stored payload. This is not touched in this task.

**Queue type:** `SyncOrderJobData` carries `shopifyOrder: ShopifyGQLOrder` and `source: "scheduled_2am" | "manual"`. A new `SyncWebhookOrderJobData` type will be added alongside it — no `shopifyOrder` field, `source: "webhook"`.

**ShopifyGraphQLService:** Has `fetchOrders` (batch) and `streamOrders`. No `fetchOrderById` — needs to be added for the webhook worker branch.

**Worker:** Processes `sync-order` jobs via `mapGraphQLOrder(job.data.shopifyOrder)`. A new branch for `source === "webhook"` will be added that fetches by ID instead.

**Webhook route:** `apps/backend/src/routes/webhook.ts` handles DataForSEO pingbacks only. A new `shopify-webhook.ts` plugin is needed for the Shopify order webhook.

**Raw body:** Fastify auto-parses JSON. HMAC requires raw bytes — handled via Fastify plugin-scoped content-type parser (`parseAs: 'buffer'`).

**Env:** `SHOPIFY_CLIENT_SECRET` already in `env.ts` as optional — used for HMAC per Shopify official sample. No new env var needed.

**Delete webhook payload:** `orders/delete` body is `{ "id": <integer> }` only. Not in supported topics — returns 200 silently.

**Scheduler:** BullMQ repeatable `discover-orders` job at 2am NZST — **unchanged**.

Main files:
- `apps/backend/src/services/order-sync-queue.ts`
- `apps/backend/src/services/shopify-graphql-service.ts`
- `apps/backend/src/workers/order-sync-worker.ts`
- `apps/backend/src/app.ts`
- `apps/backend/src/__tests__/helpers/build-app.ts`

---

## 3. Affected Areas

- **Frontend:** No
- **Backend:** Yes — new webhook route + HMAC util; `fetchOrderById` on GraphQL service; new worker branch; new job type
- **Database:** No — BullMQ jobId dedupe; no schema changes
- **Queue/jobs:** Yes — new `SyncWebhookOrderJobData` type added to `OrderSyncJobData` union; existing types unchanged
- **External APIs:** Yes — one Shopify GraphQL call per webhook job in the worker
- **Tests:** Yes — new `shopify-webhook.test.ts`; `build-app.ts` mock update; existing tests unchanged
- **Config/infra:** No new env var; Cloudflare Access bypass for `/webhooks/shopify/*` (manual, outside this task)

---

## 4. Risks

- **Raw body unavailable:** Fastify parses `application/json` globally before handlers. The webhook plugin must use `addContentTypeParser` in its own scope with `parseAs: 'buffer'` to capture raw bytes before parsing. Incorrect scoping causes HMAC to always fail.
- **Webhook endpoint blocked by Cloudflare Access:** Requires manual bypass rule for `/webhooks/shopify/*`. Backend has no app-level auth — not a risk from code side.
- **Shopify credentials not configured:** `shopifyService` and `shopifyGraphQLService` may be null. Worker must guard and fail the job with a clear error — not silently skip.
- **Shopify GraphQL throttling:** Worker makes one API call per webhook job. BullMQ concurrency: 1 and exponential backoff handle throttle retries.
- **Duplicate webhooks:** Mitigated by BullMQ `jobId = webhookId`. Shopify retries within hours — within the `removeOnComplete: { count: 200 }` window.
- **Staleness pre-check avoids unnecessary API calls:** `shopifyUpdatedAt` from the webhook is compared against `orders.shopify_updated_at` before calling Shopify. Stale webhooks skip the fetch entirely.
- **`orders/delete` has no order data:** Correctly handled as unsupported topic — 200, no enqueue.
- **Queue enqueue failure:** Redis unavailable → 500 → Shopify retries. Correct behaviour.

---

## 5. Recommended Approach

### New job type

```typescript
// apps/backend/src/services/order-sync-queue.ts

// Existing — unchanged
export type SyncOrderJobData = {
  type: "sync-order";
  source: "scheduled_2am" | "manual";
  shopifyOrderId: string;
  orderName: string;
  shopifyUpdatedAt: string;
  shopifyOrder: ShopifyGQLOrder;
};

// New — webhook trigger only, no shopifyOrder
export type SyncWebhookOrderJobData = {
  type: "sync-order";
  source: "webhook";
  webhookId: string;
  topic: string;
  shopDomain: string;
  shopifyOrderId: string;   // order.admin_graphql_api_id from webhook payload
  orderName: string;        // order.name
  shopifyUpdatedAt: string; // order.updated_at (ISO string)
};

// Existing union — add new type
export type OrderSyncJobData =
  | SyncOrderJobData
  | SyncWebhookOrderJobData
  | DiscoverOrdersJobData;
```

### Worker webhook branch

```
if source === "webhook":
  1. Staleness pre-check: compare job.shopifyUpdatedAt vs DB orders.shopify_updated_at
     → skip if stale (avoid unnecessary Shopify API call)
  2. fetchOrderById(shopifyOrderId) → ShopifyGQLOrder
  3. mapGraphQLOrder(order)
  4. upsertMappedOrder(mapped)
```

Existing `scheduled_2am` / `manual` branch unchanged — still uses `job.data.shopifyOrder` directly.

### Webhook route flow

```
POST /webhooks/shopify/orders
  1. Read raw body as Buffer (plugin-scoped content-type parser)
  2. verifyShopifyHmac(rawBody, X-Shopify-Hmac-SHA256, SHOPIFY_CLIENT_SECRET) → 401 if invalid
  3. Check X-Shopify-Topic is in SUPPORTED_TOPICS → 200 no-op if unsupported
  4. Parse JSON from raw body
  5. Extract admin_graphql_api_id, name, updated_at
  6. queue.add("sync-order", jobData, { jobId: webhookId }) → 500 if enqueue fails
  7. Return 200
```

### Summary of changes

1. `apps/backend/src/lib/shopify-hmac.ts` *(new)* — `verifyShopifyHmac(rawBody, sig, secret): boolean`
2. `apps/backend/src/routes/shopify-webhook.ts` *(new)* — Fastify plugin, raw body parser, HMAC, topic filter, enqueue
3. `apps/backend/src/services/shopify-graphql-service.ts` — add `fetchOrderById(accessToken, gid): Promise<ShopifyGQLOrder | null>`
4. `apps/backend/src/services/order-sync-queue.ts` — add `SyncWebhookOrderJobData`, update `OrderSyncJobData` union
5. `apps/backend/src/workers/order-sync-worker.ts` — add `source === "webhook"` branch
6. `apps/backend/src/app.ts` — register `shopifyWebhookRoutes` without prefix
7. `apps/backend/src/__tests__/helpers/build-app.ts` — add `SHOPIFY_CLIENT_SECRET` to fakeEnv; add `fetchOrderById: vi.fn()` to `makeShopifyGraphQLService`
8. `apps/backend/src/__tests__/shopify-webhook.test.ts` *(new)* — route tests

Avoid:
- Changing existing `SyncOrderJobData` or any existing producer
- Changing `scheduler.ts` or `DiscoverOrdersJobData`
- Changing `mapGraphQLOrder` or `ShopifyGQLOrder`
- Changing existing `webhook.ts` (DataForSEO)
- Adding raw body to global Fastify request type
- DB schema changes
- Storing HMAC or webhook secret in job payload

---

## 6. Approval Needed

- **`SHOPIFY_CLIENT_SECRET` for HMAC** — already in env as optional; must be set in production before webhook is live
- **Cloudflare Access bypass** for `/webhooks/shopify/*` — manual infra change, outside this task
- **`fetchOrderById` on `ShopifyGraphQLService`** — new GraphQL query; review query shape and error handling
- **Worker webhook branch** — live Shopify API call per webhook job; staleness pre-check logic must be correct

---

## 7. Test Plan

Automated tests:

- `verifyShopifyHmac`: valid → true; invalid → false; missing/empty → false
- `fetchOrderById`: returns order; null when not found; throws on API error
- Route (`shopify-webhook.test.ts`):
  - Valid HMAC + supported topic → 200, job enqueued with `source: "webhook"`, `jobId = webhookId`, `shopifyOrderId`, `shopifyUpdatedAt`, no `shopifyOrder`
  - Invalid HMAC → 401
  - Missing `X-Shopify-Hmac-SHA256` → 401
  - Unsupported topic → 200, no enqueue
  - Queue enqueue failure → 500
  - No `SHOPIFY_CLIENT_SECRET` → 503
  - Route requires no user session
- Worker webhook branch:
  - Stale `shopifyUpdatedAt` → skips Shopify API call, job completes
  - Fresh order → fetches, maps, upserts
  - `fetchOrderById` returns null → job fails with clear error
  - Shopify credentials not configured → job fails with clear error

Edge cases:
- Missing `X-Shopify-Webhook-Id` header → 400 after HMAC
- Missing `admin_graphql_api_id` in payload → 400 after HMAC
- Missing `updated_at` in payload → 400 after HMAC
- Empty body → HMAC fails → 401
- Malformed JSON → 400 after HMAC
- Shopify retry same `webhookId` → same `jobId`, BullMQ deduplicates
- Older webhook after newer scheduled sync → staleness pre-check skips

Regression checks (no changes expected):
- `shopify-orders-sync.test.ts` — passes unchanged
- `shopify-queue.test.ts` — passes unchanged
- `order-mapper.test.ts` — passes unchanged
- `webhook.test.ts` (DataForSEO) — passes unchanged

---

## 8. Validation Commands

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
```

---

## 9. Follow-up Tasks (out of scope for this PR)

### Follow-up A: Remove `shopifyOrder` from queue job payload

The existing `SyncOrderJobData` carries the full `ShopifyGQLOrder` payload — a pattern from the initial bulk load. All existing producers (`routes/shopify.ts`, `routes/orders.ts`, `scripts/load-recent-orders.ts`, `order-sync-worker.ts`) should be updated to drop `shopifyOrder`. Worker `sync-order` handler for scheduled/manual should also call `fetchOrderById` — same as the webhook branch.

### Follow-up B: Scheduler refactor

The `discover-orders` BullMQ repeatable job adds complexity — the worker handles two separate concerns. Consider replacing with a direct cron (e.g. `node-cron`) that calls `fetchOrders` and enqueues `sync-order` jobs directly, eliminating `DiscoverOrdersJobData` entirely.

---

## 10. Next Implementation Prompt

```markdown
# Task: Shopify Webhook Real-Time Order Sync — Implementation

## Goal

Implement `POST /webhooks/shopify/orders` as a lightweight webhook endpoint. Verify HMAC, filter supported topics, deduplicate via BullMQ jobId, enqueue a small job. Worker fetches the full order from Shopify GraphQL and processes via existing mapper.

Do not change any existing order sync producers, scheduler, or queue types.

## Background

Backend: Fastify 5 + BullMQ + MySQL. Existing `sync-order` jobs carry `shopifyOrder: ShopifyGQLOrder` — leave these unchanged. New webhook jobs use `SyncWebhookOrderJobData` (no `shopifyOrder` field). Worker branches on `source === "webhook"` to fetch by ID.

HMAC uses `SHOPIFY_CLIENT_SECRET` (already in env, optional). Raw body required — use Fastify plugin-scoped content-type parser.

Webhook payload includes `admin_graphql_api_id` (GID string) — use directly as `shopifyOrderId`.

Supported topics: `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `refunds/create`.

## Scope

1. `apps/backend/src/lib/shopify-hmac.ts` *(new)* — `verifyShopifyHmac(rawBody: Buffer, sig: string, secret: string): boolean`
2. `apps/backend/src/routes/shopify-webhook.ts` *(new)* — Fastify plugin, raw body parser, HMAC, topic filter, enqueue with `jobId = webhookId`
3. `apps/backend/src/services/shopify-graphql-service.ts` — add `fetchOrderById(accessToken: string, gid: string): Promise<ShopifyGQLOrder | null>`
4. `apps/backend/src/services/order-sync-queue.ts` — add `SyncWebhookOrderJobData`, update `OrderSyncJobData` union
5. `apps/backend/src/workers/order-sync-worker.ts` — add `source === "webhook"` branch: staleness pre-check → `fetchOrderById` → `mapGraphQLOrder` → `upsertMappedOrder`
6. `apps/backend/src/app.ts` — register `shopifyWebhookRoutes` without prefix
7. `apps/backend/src/__tests__/helpers/build-app.ts` — add `SHOPIFY_CLIENT_SECRET: "fake-shopify-secret"` to fakeEnv; add `fetchOrderById: vi.fn().mockResolvedValue(null)` to `makeShopifyGraphQLService`
8. `apps/backend/src/__tests__/shopify-webhook.test.ts` *(new)* — route tests

## Boundaries

Do not:
- Change `SyncOrderJobData` or any existing producer (`shopify.ts`, `orders.ts`, `load-recent-orders.ts`)
- Change `scheduler.ts`, `DiscoverOrdersJobData`, or the BullMQ repeatable job
- Change existing `webhook.ts` (DataForSEO pingbacks)
- Change `mapGraphQLOrder` or `ShopifyGQLOrder`
- Add DB schema changes
- Add `rawBody` to global Fastify request type
- Store HMAC values or webhook secret in job payload

## New type

```typescript
export type SyncWebhookOrderJobData = {
  type: "sync-order";
  source: "webhook";
  webhookId: string;
  topic: string;
  shopDomain: string;
  shopifyOrderId: string;   // order.admin_graphql_api_id
  orderName: string;        // order.name
  shopifyUpdatedAt: string; // order.updated_at
};
```

## Key implementation notes

**Raw body:**
```typescript
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
  done(null, body);
});
// request.body is Buffer — HMAC on buffer, JSON.parse manually
```

**HMAC (per Shopify official sample):**
```typescript
import { createHmac, timingSafeEqual } from "crypto";
const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
const providedBuf = Buffer.from(hmacHeader, "utf8");
const computedBuf = Buffer.from(computed, "utf8");
if (providedBuf.length !== computedBuf.length) return false;
return timingSafeEqual(providedBuf, computedBuf);
```

**BullMQ dedupe:**
```typescript
await queue.add("sync-order", jobData, { jobId: webhookId });
```

**Staleness pre-check in worker:**
Compare `new Date(job.data.shopifyUpdatedAt)` against existing `orders.shopify_updated_at` — skip `fetchOrderById` if stale.

**`fetchOrderById`:**
Use `order(id: $id)` GraphQL query returning the same fields as the existing `ORDERS_QUERY` nodes block.

## Tests

`apps/backend/src/__tests__/shopify-webhook.test.ts`:
- Valid HMAC + supported topic → 200, enqueue with correct fields
- Invalid HMAC → 401
- Missing HMAC header → 401
- Unsupported topic → 200, no enqueue
- Queue failure → 500
- No `SHOPIFY_CLIENT_SECRET` → 503

Run:
```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
```

## Definition of Done

* `POST /webhooks/shopify/orders` returns 401 for invalid HMAC
* Valid webhook returns 200, enqueues `SyncWebhookOrderJobData` with `jobId = webhookId`
* Worker webhook branch fetches from Shopify, maps, upserts
* Staleness pre-check skips Shopify API call when stale
* All existing tests pass without modification
* TypeScript build passes
```

---

## 11. Final Status

Waiting for Tao approval.
