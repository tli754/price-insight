# ADR 0002: Replace Cloud Tasks + `order-worker` with pgmq, batch-drained

- Status: Accepted
- Date: 2026-08-15
- Related plan: `docs/execution-plans/completed/plan-15082026-pgmq-queue-migration.md`
  (not yet synced from `~/workers/doc/plans/` at time of writing)

## Context

Two async workflows in this repo — Shopify order sync and DataForSEO
competitor-pingback processing — are currently built on Google Cloud Tasks
as a push-based HTTP queue: `CloudTasksOrderSyncClient` and
`CloudTasksCompetitorClient` both enqueue tasks onto one shared queue
(`order_sync`, `infra/terraform/cloud-tasks.tf`), which Cloud Tasks then
delivers as an authenticated (OIDC) HTTP POST to a target endpoint —
`order-worker` (a separate, least-privilege Cloud Run service,
`apps/backend/src/order-worker-server.ts`) for order-sync, and `backend`
itself (`env.BACKEND_CLOUD_RUN_URL`) for competitor pingbacks. A separate
Cloud Scheduler job (`scheduled_order_discovery`) fires at 2am NZST to scan
Shopify for orders updated in the last 24h and fan them out onto the same
queue.

`order-worker`'s deploy step was disabled on 2026-08-15 (`24a71b20`),
ahead of this decision, as part of a rewrite already in flight.

Separately, Postgres/Supabase's `pgmq` extension was installed and two
empty queues (`shopify_orders`, `dataforseo_competitors`) were manually
created against the dev `DATABASE_URL` on 2026-08-15, before this ADR was
written — this decision formalizes and completes that already-started
migration rather than proposing pgmq from a blank slate.

A day earlier (2026-08-14), an unrelated Terraform change
(`plan-14082026-supabase-production-cutover.md`, section 0) broke
`order-worker` in production: rewiring its env/volume mounts ahead of
deploying a compatible image caused a crash-loop, fixed by `git revert`
(`8cbb67d4`). That plan is still unapproved. This decision was made in
light of that incident — see "Alternatives considered" and the sequencing
note under Consequences.

## Decision

Move both queues from Cloud Tasks (push) to pgmq (pull, Postgres-native),
batch-consumed rather than processed as each message arrives:

- **Consumption model**: no always-on poller, no Cloud Run Job. Two
  independent Cloud Scheduler jobs, each firing once daily at **1am NZT**,
  call a dedicated `backend` route per queue (OIDC-authenticated, same
  pattern `scheduled_order_discovery` already uses). Each route reads
  `pgmq.read(queue, vt, qty=1)` in a loop, one message at a time, until the
  queue is empty — matching the existing one-item-per-call shape of every
  handler (`sync-order`, `process-shopping-pingback`,
  `process-product-info-pingback`); no new batch-processing logic needed.
- **Manual trigger**: a button on `/orders` (drains `shopify_orders`) and
  a button on `/products` (drains `dataforseo_competitors`), calling the
  *same* drain function inline within `backend` — no Cloud Run Jobs Admin
  API call, no execution-status polling UI. Scheduled and manual paths are
  the literal same code, different trigger.
- **`shopify_orders`' discovery step merges into its own drain**: the
  last-24h Shopify scan (today's separate 2am job) runs as the first step
  of the same execution — discovery enqueues, then the same call
  immediately drains — for both the scheduled and manual paths. This
  avoids a same-day race where discovery output would otherwise wait for
  the *next* day's drain. `dataforseo_competitors` has no equivalent
  discovery stage (purely webhook-fed), so its route is drain-only.
- **`order-worker` is retired entirely.** Its Shopify-sync handler logic
  moves into `backend`. Delete: the `order-worker` Cloud Run service, its
  dedicated runtime service account and IAM bindings, the shared
  `order_sync` Cloud Tasks queue, the old `scheduled_order_discovery`
  Cloud Scheduler job (replaced by the two new ones above),
  `CloudTasksOrderSyncClient`/`CloudTasksCompetitorClient` and their
  outbound OIDC push-auth construction, and the
  `ORDER_WORKER_URL`/`CLOUD_TASKS_*` env vars/secrets that existed only to
  support them.
- **Failure handling**: a failed message is left in the queue (not
  deleted) so it's naturally retried on the next drain — no
  application-level retry/backoff loop. One message's failure doesn't
  abort the rest of the batch. Once a message's `read_ct >= 5`, it's moved
  via `pgmq.archive()` into the queue's existing, already-auto-created
  archive table (`pgmq.a_shopify_orders` / `pgmq.a_dataforseo_competitors`)
  instead of continuing to retry it forever — no new dead-letter queue is
  provisioned. Failure reasons go to Cloud Run logs only (searchable by
  `msg_id`), not stored on the archived row. No automated requeue-from-
  archive tooling yet.
- **Sequencing**: this migration lands standalone — before, and
  independent of, the pending Supabase production cutover
  (`plan-14082026-supabase-production-cutover.md`). It is not gated on
  that cutover and does not wait for it.

## Alternatives considered

- **Always-on poller** (Cloud Run Service, min-instances=1, tight
  `pgmq.read` loop): rejected. Preserves near-real-time latency, but Tao
  chose the once-daily/manual-trigger model explicitly over that
  recommendation — cost and operational simplicity outweighed latency here
  for both queues.
- **Manual trigger via real Cloud Run Job execution** (Jobs Admin API,
  mirroring `backend-script-runner`/`backend-migrate`'s
  externally-invoked pattern): rejected in favor of running the drain
  function inline in `backend`. Avoids new IAM surface
  (`run.jobs.run`) and an execution-status-polling UI; the two entrypoints
  (schedule, button) stay the same function.
- **Keeping `order-worker` as a separate least-privilege service**, with
  `backend` calling into it over HTTP instead of Cloud Tasks: rejected.
  Once it's no longer a push target reachable from Cloud Tasks, the
  security boundary it bought is marginal, and running two services for a
  once-a-day batch job added operational cost without a clear win.
- **A dedicated dead-letter queue per queue** (`shopify_orders_dlq`, etc.):
  rejected in favor of pgmq's built-in archive tables, which already
  existed (auto-created alongside the queues) and needed no new
  provisioning.
- **Landing this together with the Supabase production cutover** in one
  change window: rejected. Bundling two independently-risky infra changes
  is the exact pattern that caused the 2026-08-14 incident (see Context).
  Landing this first is a pure subtraction — deleting `order-worker`
  doesn't depend on whether `backend` is on MySQL or Postgres at the time
  — and shrinks the cutover plan's own Terraform diff (one fewer service
  to rewire).

## Consequences

- Order-sync and competitor-discovery results are no longer near-real-time
  — up to ~24h latency (or up to ~48h for the two-stage
  shopping→product_info competitor-pingback chain) unless someone uses the
  manual trigger button. Accepted explicitly as "keep it simple, improve
  later if it's not good enough" (Tao) — not a permanent commitment if it
  proves insufficient in practice.
- Retry/backoff is coarser than Cloud Tasks' previous 3-attempts/
  2s–60s-exponential-backoff: a failed message now waits up to a full day
  before its next retry attempt.
- `plan-14082026-supabase-production-cutover.md` needs its
  `order-worker`-specific Terraform scope removed once this lands (that
  service will already be gone) — a small follow-up edit to that plan, not
  a new decision.
- No dead-letter alerting or requeue tooling exists yet — archived rows in
  `pgmq.a_*` are inspectable only via direct SQL query. Explicitly
  deferred, not forgotten.
- Any future ADR touching Postgres extensions, queueing, or scheduled
  batch jobs in this repo should link back here rather than re-deriving
  the pgmq-vs-Cloud-Tasks trade-offs from scratch.
