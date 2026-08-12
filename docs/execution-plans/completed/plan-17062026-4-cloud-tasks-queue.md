# Plan: Replace BullMQ/Redis Order Sync with Cloud Tasks + Cloud Scheduler (PR 4)

## 1. Summary

Remove BullMQ and the Redis dependency for Shopify order sync, replacing it with **Cloud Tasks** (per-order async processing with built-in retry/backoff, triggered from the webhook handler) and **Cloud Scheduler** (replaces the in-process `node-cron` 2am job, which would silently stop firing on a scaled-to-zero Cloud Run instance). Both push to new authenticated `/internal/*` HTTP endpoints on the backend, verified via Google-signed OIDC ID tokens. This removes Redis as a backend dependency entirely — no Memorystore, no VPC connector needed for the Cloud Run migration.

This is PR 4 in the migration sequence (added to the 3-PR split already approved for gateway retirement):
- PR 1: move gateway auth/cookie/JWT/CORS into backend (planned — `plan-17062026-1-retire-gateway.md`).
- PR 2: Cloud Run infrastructure + routing (Terraform), deploy frontend + updated backend.
- PR 3: remove `apps/gateway`, K8s gateway resources, obsolete build/deploy steps.
- **PR 4 (this plan): replace BullMQ/Redis order sync with Cloud Tasks + Cloud Scheduler.**

Sequenced after PR 2, because Cloud Tasks/Cloud Scheduler need a stable HTTPS target (the Cloud Run domain/URL) to push to.

## 2. Current Implementation

- **Webhook → queue**: `routes/shopify-webhook.ts` verifies Shopify HMAC, then `queue.add("sync-order", jobData, { jobId: webhookId })` on a BullMQ `Queue` (`services/order-sync-queue.ts`), backed by `ioredis` (`config/redis.ts`). Responds 200 immediately.
- **Scheduled discovery**: `scheduler.ts` runs `node-cron` in-process at `0 14 * * *` UTC (2am NZST), fetches orders updated in the last 24h via Shopify GraphQL, and enqueues one BullMQ job per order.
- **Worker**: `workers/order-sync-worker.ts`, a BullMQ `Worker` with `concurrency: 1`, holds a persistent Redis connection. For webhook-sourced jobs it re-fetches the order via GraphQL (the REST webhook payload is partial), checks `orderRepository.getShopifyOrderUpdatedAt` for staleness (the real idempotency guard — not the BullMQ `jobId`), maps, and upserts. For scheduled-sourced jobs it uses the already-fetched GraphQL order directly.
- **Monitoring**: `routes/queue.ts` exposes `GET /api/shopify/orders/queue` (job counts/listing) and `POST /api/shopify/orders/queue/clean`.
- **Existing webhook-auth precedent in this repo**: `routes/webhook.ts` (DataForSEO callbacks) uses a shared-secret query param + `timingSafeEqual`, not OIDC — noted as an alternative, but OIDC is the GCP-native fit for Cloud Tasks/Scheduler calling back into Cloud Run and avoids minting/rotating another shared secret.
- **Why this is in scope for Cloud Run**: a BullMQ `Worker` is a long-lived polling connection — incompatible with scale-to-zero unless `min_instance_count >= 1` is forced (defeats the cost benefit of moving to Cloud Run). `node-cron` has the same problem: it only fires if an instance happens to be running at 2am.

## 3. Affected Areas

- Frontend: No
- Backend: Yes — remove queue/worker/scheduler modules, add two new internal routes, add Cloud Tasks client.
- Database: No schema change — `orderRepository`/`mapGraphQLOrder` logic is reused unchanged.
- Queue/jobs: Yes — this *is* the queue replacement.
- External APIs: No new third-party API; new GCP services (Cloud Tasks, Cloud Scheduler).
- Tests: Yes — replace `__tests__/shopify-queue.test.ts` coverage with tests for the new internal routes; update `__tests__/shopify-webhook.test.ts` (no longer asserts `queue.add`).
- Config/infra: Yes — new Terraform resources (`google_cloud_tasks_queue`, `google_cloud_scheduler_job`, service account + IAM for OIDC invocation), new env vars.

## 4. Risks

- **OIDC verification bugs**: a misconfigured audience/issuer check could either reject legitimate Cloud Tasks/Scheduler calls (silent sync failures) or, worse, accept forged tokens (anyone could trigger order re-sync). Must verify both signature *and* expected service-account email, not just "is this a valid Google-signed token."
- **Idempotency regression**: BullMQ's `jobId: webhookId` prevented duplicate *enqueues*; the actual functional guard is `getShopifyOrderUpdatedAt` staleness comparison, which carries over unchanged — but worth an explicit test since the queue-level dedup is going away.
- **Webhook handler latency**: creating a Cloud Task is a synchronous outbound call to the Cloud Tasks API from the webhook handler — adds latency vs. the previous local Redis `LPUSH`-equivalent. Should still be well within Shopify's webhook timeout, but worth a manual timing check.
- **Scheduled discovery fan-out**: 2am job creates one Cloud Tasks task per order found in the last 24h — for a high-order-volume day this could hit Cloud Tasks queue rate limits; mitigate with the queue's built-in `maxDispatchesPerSecond` config rather than custom throttling code.
- **Lost queue dashboard**: `routes/queue.ts`'s job inspection UI/API goes away. Cloud Tasks has its own GCP Console view for queue depth/failures, but nothing inside this app's `/api` surface — acceptable trade, not a blocker.
- **Dependency on PR 2**: this PR can't be deployed/tested end-to-end until a Cloud Run URL or domain exists for Cloud Tasks/Scheduler to target.

## 5. Recommended Approach

Summary:
- Add `@google-cloud/tasks` and `google-auth-library` to `apps/backend`.
- Add two new routes, registered at root (no `/api` prefix, consistent with `webhookRoutes`):
  - `POST /internal/sync-order` — does what `order-sync-worker.ts`'s handler does today (fetch via GraphQL if webhook-sourced, staleness check, map, upsert), verified via OIDC.
  - `POST /internal/scheduled-order-discovery` — does what `scheduler.ts`'s cron callback does today (fetch last-24h orders, create one Cloud Tasks task per order targeting `/internal/sync-order`), verified via OIDC.
- `routes/shopify-webhook.ts`: replace `queue.add(...)` with a Cloud Tasks client call creating a task targeting `/internal/sync-order`, with the same payload shape.
- Delete `services/order-sync-queue.ts`, `workers/order-sync-worker.ts`, `scheduler.ts`, `routes/queue.ts`, and the `cronTask`/`orderSyncWorker`/`orderSyncQueue` wiring in `app.ts`.
- Remove `ioredis` dependency, `REDIS_*` env vars, and `config/redis.ts` once nothing else references them (confirmed in the earlier Redis-usage investigation — nothing else does).
- New env vars: `CLOUD_TASKS_PROJECT`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_QUEUE`, `INTERNAL_OIDC_AUDIENCE`, `INTERNAL_OIDC_SERVICE_ACCOUNT` (the GSA email Cloud Tasks/Scheduler sign tokens with — used to validate the token's `email` claim).
- Terraform: `google_cloud_tasks_queue` (with `retry_config` mirroring today's `attempts: 3, backoff: exponential`), `google_cloud_scheduler_job` (cron `0 14 * * *`, HTTP target with OIDC token config pointing at the backend's Cloud Run URL), a dedicated GSA for Cloud Tasks/Scheduler to invoke with, and IAM bindings (`roles/cloudtasks.enqueuer` for the backend SA, `roles/run.invoker` if the backend service requires authentication on those specific routes via Cloud Armor/LB config — needs confirming against the PR 2 routing setup since `/api` and `/auth` must stay public).

Likely files:
- `apps/backend/package.json`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/app.ts`
- `apps/backend/src/routes/internal-sync.ts` (new — both `/internal/*` routes)
- `apps/backend/src/lib/verify-oidc.ts` (new)
- `apps/backend/src/services/cloud-tasks-client.ts` (new)
- `apps/backend/src/routes/shopify-webhook.ts`
- `apps/backend/src/__tests__/shopify-webhook.test.ts`
- `apps/backend/src/__tests__/internal-sync.test.ts` (new)
- `apps/backend/src/__tests__/helpers/build-app.ts`
- Delete: `apps/backend/src/services/order-sync-queue.ts`, `apps/backend/src/workers/order-sync-worker.ts`, `apps/backend/src/scheduler.ts`, `apps/backend/src/routes/queue.ts`, `apps/backend/src/config/redis.ts`, `apps/backend/src/__tests__/shopify-queue.test.ts`, `apps/backend/src/__tests__/scheduler.test.ts`
- `infra/terraform/main.tf` (or a new `cloud-tasks.tf`) for the queue/scheduler/IAM resources

Why this approach:
- Preserves the existing mapping/upsert/staleness logic untouched (`lib/order-mapper.ts`, `orderRepository`) — only the trigger/transport mechanism changes.
- OIDC is the GCP-native way to authenticate Cloud Tasks/Scheduler → Cloud Run callbacks, no shared secret to mint or rotate.
- Matches the existing root-mounted-routes convention already used for `webhookRoutes`/`shopifyWebhookRoutes`.
- Fully eliminates Redis, simplifying PR 2's infra (no Memorystore, no VPC connector).

Avoid:
- Do not reuse the DataForSEO shared-secret-in-query-string pattern for `/internal/*` — that convention exists for a third-party webhook we don't control; OIDC is stronger and appropriate here since we control both ends (Cloud Tasks/Scheduler and the backend).
- Do not let `/internal/*` fall under the public `/api` or `/auth` LB path rules from PR 2 without an explicit decision on how they're protected (OIDC check in-app is the minimum; consider whether the LB/Cloud Run IAM layer should also restrict access).
- Do not change `lib/order-mapper.ts` or `orderRepository` upsert logic — out of scope.

## 6. Approval Needed

Tao approval is required before:
- Implementing (per CLAUDE.md, requires literal `APPROVED TO IMPLEMENT`)
- Creating the Cloud Tasks queue, Cloud Scheduler job, and new service account in GCP (production-impacting infra)
- Deciding how `/internal/*` is protected at the LB/Cloud Run IAM layer (beyond in-app OIDC verification) — depends on PR 2's routing decisions
- Removing `REDIS_*` secrets from GSM/Terraform once confirmed nothing else needs them

## 7. Test Plan

Automated tests (new, `__tests__/internal-sync.test.ts`):
- `POST /internal/sync-order` with valid OIDC token + webhook-sourced payload → fetches via mocked `shopifyGraphQLService`, calls `upsertMappedOrder`.
- `POST /internal/sync-order` with valid token but stale `shopifyUpdatedAt` (older than stored) → skips upsert.
- `POST /internal/sync-order` with missing/invalid/expired OIDC token → 401, no upsert call.
- `POST /internal/sync-order` with token signed by an unexpected service account email → 401.
- `POST /internal/scheduled-order-discovery` with valid token → fetches last-24h orders, creates one Cloud Tasks task per order (assert `CloudTasksClient.createTask` call count/payload).
- `POST /internal/scheduled-order-discovery` with invalid token → 401, no Shopify calls made.

Updated tests:
- `__tests__/shopify-webhook.test.ts` — assert Cloud Tasks task creation instead of `queue.add`.

Edge cases:
- Cloud Tasks API call fails when creating a task from the webhook handler — webhook should return 5xx so Shopify retries, not silently swallow the error.
- Duplicate webhook delivery (same order, same `shopifyUpdatedAt`) — staleness check still dedupes correctly without queue-level `jobId`.
- Cloud Scheduler fires with zero orders found — `/internal/scheduled-order-discovery` returns success with `0` tasks created, no error.

Regression checks:
- `orderRepository`/`order-mapper` test suites unaffected.
- No remaining references to `ioredis`, `bullmq`, or `REDIS_*` env vars after cleanup (`grep -ri redis apps/backend/src` returns nothing).

## 8. Validation Commands

```bash
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build
grep -ri "redis\|bullmq" apps/backend/src apps/backend/package.json
```

## 9. Next Implementation Prompt

```markdown
# Task: Replace BullMQ/Redis order sync with Cloud Tasks + Cloud Scheduler (PR 4)

## Goal
Remove the Redis/BullMQ dependency for Shopify order sync, replacing it with Cloud Tasks
(per-order async retry) and Cloud Scheduler (2am discovery), both calling authenticated
/internal/* endpoints on the backend via OIDC.

## Background
BullMQ's Worker and node-cron both require an always-running process, which is incompatible
with Cloud Run's scale-to-zero model. This is PR 4 of the GKE->Cloud Run migration, sequenced
after PR 2 (Cloud Run infra must exist so Cloud Tasks/Scheduler have a stable HTTPS target).

## Scope
Implement only:
- Add @google-cloud/tasks, google-auth-library to apps/backend
- Add POST /internal/sync-order and POST /internal/scheduled-order-discovery, OIDC-verified
- Replace queue.add(...) in routes/shopify-webhook.ts with a Cloud Tasks createTask call
- Delete services/order-sync-queue.ts, workers/order-sync-worker.ts, scheduler.ts,
  routes/queue.ts, config/redis.ts, and their tests
- Remove ioredis dependency and REDIS_* env vars
- Add google_cloud_tasks_queue, google_cloud_scheduler_job, service account + IAM to Terraform
- Add tests per Plan section 7

## Boundaries
Do not:
- change lib/order-mapper.ts or orderRepository upsert logic
- change how /api or /auth routes are authenticated
- finalize /internal/* LB-layer protection without Tao's input on PR 2's routing setup
- run `terraform apply` without approval

## Expected Changes
- apps/backend/package.json
- apps/backend/src/config/env.ts
- apps/backend/src/app.ts
- apps/backend/src/routes/internal-sync.ts (new)
- apps/backend/src/lib/verify-oidc.ts (new)
- apps/backend/src/services/cloud-tasks-client.ts (new)
- apps/backend/src/routes/shopify-webhook.ts
- apps/backend/src/__tests__/shopify-webhook.test.ts
- apps/backend/src/__tests__/internal-sync.test.ts (new)
- apps/backend/src/__tests__/helpers/build-app.ts
- infra/terraform/ (new Cloud Tasks/Scheduler resources)
- Deletions: services/order-sync-queue.ts, workers/order-sync-worker.ts, scheduler.ts,
  routes/queue.ts, config/redis.ts, __tests__/shopify-queue.test.ts, __tests__/scheduler.test.ts

## Tests
Run:
pnpm --filter @price-insight/backend test
pnpm --filter @price-insight/backend build

## Definition of Done
- No references to redis/bullmq remain in apps/backend
- Order sync behavior (webhook + scheduled) is functionally equivalent, verified by tests
- New /internal/* routes reject requests without a valid OIDC token from the expected service account
```

## 10. Complexity

**Medium** — no DB schema change and the core mapping logic is reused, but it introduces a new GCP service (Cloud Tasks), a new auth mechanism (OIDC verification) not used elsewhere in this codebase, and several Terraform resources. Coordination with PR 2 (needs a stable target URL) adds sequencing risk if done out of order.

## 11. Final Status

Waiting for Tao approval.
