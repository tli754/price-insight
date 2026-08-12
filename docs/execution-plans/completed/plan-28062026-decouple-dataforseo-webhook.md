# Plan: Decouple DataForSEO Webhook Processing via Cloud Tasks

## Status
Implemented on 2026-06-28.

---

## 1. Summary

Decoupled the DataForSEO pingback webhook handlers from inline processing.
Webhook handlers now only validate the secret and enqueue a Cloud Tasks job.
A new pair of OIDC-protected internal routes on the main backend do the actual
DataForSEO fetch, filter, and DB writes. Inline fallback retained for local dev
(when Cloud Tasks is not configured).

Also includes the rename: `webhook.ts` → `dataforseo-webhook.ts` and
`webhook.test.ts` → `dataforseo-webhook.test.ts`.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `apps/backend/src/lib/competitor-task-payload.ts` | NEW — payload types |
| `apps/backend/src/services/cloud-tasks-competitor-client.ts` | NEW — Cloud Tasks client targeting main backend |
| `apps/backend/src/routes/internal-competitor.ts` | NEW — OIDC-protected worker routes |
| `apps/backend/src/__tests__/internal-competitor.test.ts` | NEW — 17 tests |
| `apps/backend/src/routes/webhook.ts` | DELETED (renamed) |
| `apps/backend/src/routes/dataforseo-webhook.ts` | RENAMED + thinned to validate+enqueue+fallback |
| `apps/backend/src/types/fastify.d.ts` | Added `cloudTasksCompetitorClient` |
| `apps/backend/src/app.ts` | Wired up new client and routes |
| `apps/backend/src/__tests__/helpers/build-app.ts` | Added `makeCloudTasksCompetitorClient`, registered `internalCompetitorRoutes` |
| `apps/backend/src/__tests__/dataforseo-webhook.test.ts` | RENAMED + updated: asserts on `enqueue`, inline fallback kept |

---

## 3. Architecture

```
DataForSEO pingback (GET /webhooks/dataforseo/pingback/shopping)
  → validate secret
  → enqueue { type: "process-shopping-pingback", taskId, productId } via Cloud Tasks
  → 200 immediately

Cloud Tasks → POST /internal/process-shopping-pingback (OIDC-protected)
  → fetch shopping result from DataForSEO
  → filter soft-deleted
  → post product_info tasks back to DataForSEO

DataForSEO pingback (GET /webhooks/dataforseo/pingback/product_info)
  → validate secret
  → enqueue { type: "process-product-info-pingback", taskId, productId } via Cloud Tasks
  → 200 immediately

Cloud Tasks → POST /internal/process-product-info-pingback (OIDC-protected)
  → fetch product info result from DataForSEO
  → filter by country, price range, own store
  → upsertSuggestedCompetitor + recordPricesForConfirmed
```

---

## 4. Key Decisions

- Worker routes live on the **main backend** (not order-worker) — DataForSEO credentials are scoped there
- Same Cloud Tasks queue as order-sync (`CLOUD_TASKS_QUEUE`)
- OIDC audience = `WEBHOOK_HOST` (main backend public URL)
- Inline fallback when `cloudTasksCompetitorClient` is null (local dev)
- `INTERNAL_OIDC_SERVICE_ACCOUNT` must be set in production for worker routes to accept Cloud Tasks requests

---

## 5. Validation

- `pnpm --filter @price-insight/backend test`: 308 passed
- `pnpm --filter @price-insight/backend build`: clean
