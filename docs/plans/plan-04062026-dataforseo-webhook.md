# Plan: DataForSEO Pingback Webhook for Batch Competitor Sync

## Environment
- Worker repo: /srv/price-insight
- Current branch: feature/dataforseo-sync
- Coordination repo: /srv/price-insight

## Source Task File
- No task file. Plan derived from design discussion on 2026-06-04.

## Task Summary

Replace the polling-based `find-all-competitors.ts` batch script with a DataForSEO pingback-driven
flow. The batch trigger posts shopping tasks and exits. DataForSEO calls the backend when each task
is ready. The backend fetches the result (one GET) and processes it directly — no polling loops,
no Redis, no counting state.

Two-layer validation:
1. **Nginx IP allowlist** — any request to `/webhook` from outside the DataForSEO IP list gets a 403 before reaching Fastify.
2. **Secret query param** — Fastify validates `?secret=` on every webhook request. Returns 401 if missing or wrong. Uses constant-time comparison to prevent timing attacks. Secret is redacted from Fastify request logs.

Upsert-on-arrival: each product_info pingback upserts its results directly to the DB as suggested
competitors. No delete, no batch accumulation. Existing suggested competitors get their price
history refreshed. New ones are inserted. Suggested competitors not found in a given batch run
stay in place with their last known price — the user can dismiss them manually.

---

## Files Inspected

| File | Notes |
|------|-------|
| `apps/backend/src/services/dataforseo-service.ts` | `parseShoppingCandidates` and `fetchProductInfoResults` are public — reusable in webhook handler |
| `apps/backend/src/services/competitor-repository.ts` | No upsert method for suggested — needs `upsertSuggestedCompetitor` |
| `apps/backend/src/scripts/find-all-competitors.ts` | Phases 2–3 are polling loops — full rewrite to fire-and-forget |
| `apps/backend/src/config/env.ts` | Add `DATAFORSEO_WEBHOOK_SECRET` |
| `apps/backend/src/app.ts` | All routes registered under `/api` prefix — webhook needs no prefix |
| `k8s/ingress.yaml` | No `/webhook` rule. IP restriction requires a separate ingress resource |
| `k8s/gateway/deployment.yaml` | Gateway proxies `/api` to backend. Webhook bypasses gateway — routes directly to backend service |

---

## Affected Apps / Packages

- `apps/backend` only
- `k8s/ingress.yaml` (infrastructure)
- `k8s/` new file: `webhook-ingress.yaml`

---

## Proposed Files to Change

| File | Action | Reason |
|------|--------|--------|
| `k8s/webhook-ingress.yaml` | **CREATE** | Separate ingress resource for `/webhook` with DataForSEO IP allowlist |
| `apps/backend/src/routes/webhook.ts` | **CREATE** | Two GET handlers: pingback/shopping and pingback/product_info |
| `apps/backend/src/app.ts` | **EDIT** | Register webhook routes with no `/api` prefix |
| `apps/backend/src/services/competitor-repository.ts` | **EDIT** | Add `upsertSuggestedCompetitor(productId, item)` method |
| `apps/backend/src/scripts/find-all-competitors.ts` | **REWRITE** | Remove all polling. Post shopping tasks with pingback_url and tag. Exit. |
| `apps/backend/src/config/env.ts` | **EDIT** | Add `DATAFORSEO_WEBHOOK_SECRET` |
| `apps/backend/.env.example` | **EDIT** | Add `DATAFORSEO_WEBHOOK_SECRET` |

---

## Existing Patterns Found

- Route files are Fastify plugins (`FastifyPluginAsync`) registered in `app.ts`
- Repository methods use Drizzle ORM transactions for multi-step writes
- `parseShoppingCandidates` and `fetchProductInfoResults` are already on `DataForSeoService` and can be called from the webhook handler
- `find-all-competitors.ts` already has `apiGet`/`apiPost` helpers and batch POST logic — keep the batch POST structure, remove all polling phases
- `recordPricesForConfirmed` already handles updating today's price history for confirmed competitors — call this from the product_info handler too

---

## Implementation Plan

### Step 1 — `k8s/webhook-ingress.yaml` (new file)

Separate ingress resource with IP allowlist annotation. Routes `/webhook` directly to the
`backend` service (port 4000), bypassing the gateway.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: price-insight-webhook
  namespace: price-insight
  annotations:
    nginx.ingress.kubernetes.io/whitelist-source-range: >-
      144.76.154.130/32,144.76.153.113/32,144.76.153.106/32,
      94.130.155.89/32,178.63.193.217/32,94.130.93.29/32
spec:
  ingressClassName: nginx
  rules:
    - host: www.qweyha520.bar
      http:
        paths:
          - path: /webhook
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 4000
```

### Step 2 — `competitor-repository.ts` — add `upsertSuggestedCompetitor`

```typescript
async upsertSuggestedCompetitor(productId: number, item: CompetitorProductInput): Promise<void>
```

Logic (inside a transaction):
1. Look up existing suggested record by `productId + externalId + source`
2. If exists:
   - Insert a new `priceHistory` row with current datetime (always — no update, no dedup by date)
3. If not exists:
   - Insert new `competitorProducts` row (status = `"suggested"`, competitorId = null)
   - Insert new `priceHistory` row with current datetime

Also call `recordPricesForConfirmed` for the same item so confirmed competitor prices stay current.

No delete step anywhere in this method. The upsert handles all cases:
- Existing suggested found again → new price history record inserted
- New result → inserted as suggested with first price history record
- Existing suggested not found this run → untouched, last price history record unchanged

### Step 3 — `env.ts` — add webhook secret

```typescript
DATAFORSEO_WEBHOOK_SECRET: z.string().min(1)
```

### Step 4 — `routes/webhook.ts` (new file)

Two GET handlers registered as a Fastify plugin.

**Secret validation** (shared by both handlers):
```
1. Read secret = request.query.secret
2. Use timingSafeEqual(Buffer.from(secret), Buffer.from(env.DATAFORSEO_WEBHOOK_SECRET))
3. If mismatch → reply.status(401).send() and return
```

Use Node's `crypto.timingSafeEqual` to prevent timing attacks. Redact `secret` from Fastify
request logs via a custom `serializers.req` that strips the query param before logging.

**`GET /webhook/dataforseo/pingback/shopping?secret={s}&id={taskId}&tag={productId}`**

```
1. Validate secret (timingSafeEqual) → 401 if wrong
2. Parse taskId and productId from query params
3. Validate productId is a positive integer — if not, return 200 and log warning
4. GET task_get/advanced/{taskId} from DataForSEO
5. svc.parseShoppingCandidates(data, env.OWN_STORE_NAME) → candidates
6. competitorRepository.getDeletedExternalIds(productId) → deletedIds (Set<string>)
7. Filter candidates: skip any candidate where deletedIds.has(candidate.productId)
   (soft-deleted products must not be re-submitted to product_info API)
8. Batch POST product_info tasks for remaining candidates (single request):
   body: [{ language_code, location_code, product_id, tag: productId,
            pingback_url: .../product_info?secret=xxx&id=$id&tag=$tag }]
9. Return 200
```

Note: POST all product_info tasks in a single batch request (array of up to 40 items).

**`GET /webhook/dataforseo/pingback/product_info?secret={s}&id={taskId}&tag={productId}`**

```
1. Validate secret (timingSafeEqual) → 401 if wrong
2. Parse taskId and productId from query params
3. Validate productId — if invalid, return 200 and log warning
4. Look up product by productId — if not found, return 200 and log warning
5. GET task_get/advanced/{taskId} from DataForSEO
6. svc.fetchProductInfoResults(data, minimalCandidate) → sellers
7. Apply all three filters (drop result if any condition fails):
   - country must be "NZ" or "AU"
   - if product.price != null: extractedPrice must be within [price/2, price*2]
   - seller name (normalised, case-insensitive trim) must not equal env.OWN_STORE_NAME — skip own store (White Donkey)
8. For each remaining result:
     competitorRepository.upsertSuggestedCompetitor(productId, row)
9. Return 200
```

### Step 5 — `app.ts` — register webhook routes

```typescript
import webhookRoutes from "./routes/webhook.js";
// ...
await app.register(webhookRoutes); // no prefix
```

### Step 6 — `find-all-competitors.ts` — rewrite to fire-and-forget

Keep:
- DB setup, active product fetch
- Batch POST logic (chunks of 100)

Remove:
- Phase 2 polling loop (`products/tasks_ready`)
- Phase 3 polling loop (`product_info/tasks_ready`)
- Phase 4 DB writes (moved to webhook handler)
- `sleep`, `TasksReadyResponse`, polling constants

New structure:
```
1. Load env, connect DB
2. Fetch active products with title
3. Batch POST shopping tasks:
   - language_code, location_code, keyword: product.title, price_min: 5
   - tag: product.id (string)
   - pingback_url: https://www.qweyha520.bar/webhook/dataforseo/pingback/shopping?id=$id&tag=$tag
4. Log: N tasks submitted
5. Close DB pool, exit
```

---

## Risks / Edge Cases

| Risk | Mitigation |
|------|------------|
| Nginx sees cluster-internal IP instead of real client IP | Confirm existing ingress uses `use-forwarded-headers` or `real_ip_header` — existing auth routes suggest this is already working |
| Shopping pingback fires but backend is temporarily down | DataForSEO retries pingback — acceptable; no data loss |
| product_info pingback arrives for a deleted product | `getProductById` returns null → log + return 200, skip write |
| Multiple pingbacks for the same product arrive concurrently | `upsertSuggestedCompetitor` uses transactions — concurrent upserts are safe |
| Old suggested competitors not found in a new batch run keep their last known price | Accepted — no delete in webhook flow. User can dismiss stale suggestions manually. Confirmed competitors are unaffected. |
| Batch POST of 40 product_info tasks in one request | DataForSEO max batch size is 100 — 40 is within limit |
| `fetchProductInfoResults` requires a `ShoppingCandidate` — the webhook doesn't have it | The product_info response already contains `title`, `product_id`, `images` — pass a minimal stub candidate; fallbacks are never needed |
| Own store appears in product_info seller results | Filter out results where `source` matches `env.OWN_STORE_NAME` (normalised, case-insensitive) before upsert |
| Soft-deleted candidate product_id reappears in shopping results | `getDeletedExternalIds` checked in shopping handler — candidate skipped before product_info task is posted |
| `DATAFORSEO_WEBHOOK_SECRET` length equality check leaks info via timingSafeEqual | Pad both buffers to equal length before comparison, or check length separately and return 401 uniformly |

---

## Database Impact

No schema changes. New `upsertSuggestedCompetitor` method uses existing `competitorProducts` and `priceHistory` tables.

---

## API Impact

Two new public GET routes:
- `GET /webhook/dataforseo/pingback/shopping`
- `GET /webhook/dataforseo/pingback/product_info`

Not under `/api`. No session auth. Protected by nginx IP allowlist (layer 1) + secret query param (layer 2).

---

## UI Impact

None.

---

## Infrastructure / Config Impact

- New `k8s/webhook-ingress.yaml` — must be applied before first batch run that uses pingback
- New env var `DATAFORSEO_WEBHOOK_SECRET` — needs GSM secret `backend-dataforseo-webhook-secret` created in production and wired into `deploy.yml` backend secrets sync
- New GSM secret required before first deploy
- `deploy.yml` may need to apply `webhook-ingress.yaml` — check if CI applies all `k8s/` manifests recursively (it does, based on existing deploy workflow)

---

## Dependency Impact

None. `ioredis` installed but not needed for this approach.

---

## Validation Commands

```bash
# Type check
pnpm --filter @price-insight/backend build

# Unit tests
pnpm --filter @price-insight/backend test

# Manual: trigger batch script locally (dry run — tasks will be posted to DataForSEO)
cd apps/backend && npx tsx src/scripts/find-all-competitors.ts

# Verify ingress IP restriction (from a non-allowlisted IP):
curl -i https://www.qweyha520.bar/webhook/dataforseo/pingback/shopping
# Expected: 403
```

---

## Approval Status
Waiting for Tony approval.
