# Task: BullMQ Order Sync Queue UI

## Goal

Build a frontend UI page for monitoring the BullMQ-based Shopify order sync queue in Price Insight.

Use **mock data first**. Do not connect to the real BullMQ backend API in this first UI pass unless Tony approves.

The page should help Tony quickly see: (in last 24 hours. only store the figure for last 24 hours)

- how many order sync jobs are waiting
- how many are active
- how many completed successfully
- how many failed
- how many are delayed or retrying
- recent failed jobs
- recent completed jobs
- queue health for webhook, manual sync, and scheduled 2 AM sync jobs

---

## Phase 1 — Investigation Only

Do not edit implementation files yet.

Investigate:

1. Existing frontend route structure.
2. Existing navigation/sidebar structure.
3. Existing table, card, badge, and button components.
4. Existing mock data or fixture patterns.
5. Existing API client/composable patterns.
6. Existing page layout conventions.
7. Whether an Orders section already exists.
8. Whether `/queue/orders` is the right route.
9. Whether backend BullMQ endpoints already exist.

Return:

- affected files
- proposed route
- proposed component structure
- proposed mock data structure
- UI implementation plan
- risks
- testing plan
- validation commands

End with:

```text
Waiting for Tony approval.
```

---

## Proposed Route

```text
/queue/orders
```

Page title:

```text
Order Sync Queue
```

Subtitle:

```text
Monitor Shopify order sync jobs
```

---

## Business Context

Price Insight will use BullMQ to process Shopify order sync jobs.

Main job types:

```text
sync-single-order
sync-orders-scheduled
sync-orders-manual-today
```

Sources:

```text
webhook
scheduled_2am
manual
```

Examples:

```text
Shopify webhook arrives
→ enqueue sync-single-order job

2 AM scheduled sync starts
→ enqueue sync-orders-scheduled job

User clicks Sync Now on /orders
→ enqueue sync-orders-manual-today job
```

---

## Required UI Sections

### 1. Header

Show:

- `Order Sync Queue`
- subtitle: `Monitor Shopify order sync jobs`
- `Refresh` button
- `Last refreshed` timestamp

Refresh button behavior:

- use mock data refresh first
- update `Last refreshed`
- disable button while loading
- show loading state
- do not auto-refresh in MVP

---

### 2. Summary Cards

Show BullMQ-style queue counts:

```text
Waiting
Active
Completed
Failed
Delayed
Retrying
Manual Today
Webhook Today
```

Failed count should be visually obvious.

---

### 3. Recent Failures

Show recent failed jobs.

Columns/content:

```text
Order number
Job type
Source
Error message
Attempts
Updated time
```

Empty state:

```text
No failed order sync jobs.
```

---

### 4. Jobs Table

Show recent queue jobs.

Columns:

```text
Job Type
Order / Scope
Source
Status
Attempts
Created
Updated
Finished
Error
```

---

### 5. Filters and Search

MVP filters:

```text
All
Waiting
Active
Completed
Failed
Delayed
Retrying
```

Search placeholder:

```text
Search order number / Shopify ID / job ID
```

---

## Suggested Wireframe

```text
┌────────────────────────────────────────────────────────────┐
│ Order Sync Queue                              [Refresh]     │
│ Monitor Shopify order sync jobs                             │
│ Last refreshed: Jun 5, 2026 4:32 PM                         │
├──────────────┬──────────────┬──────────────┬───────────────┤
│ Waiting      │ Active       │ Completed    │ Failed        │
│ 8            │ 3            │ 245          │ 2             │
├──────────────┬──────────────┬──────────────┬───────────────┤
│ Delayed      │ Retrying     │ Manual Today │ Webhook Today │
│ 4            │ 1            │ 3            │ 257           │
├────────────────────────────────────────────────────────────┤
│ Recent Failures                                             │
│ #1052  Webhook sync failed  Shopify API timeout  2/5        │
│ #1048  Manual sync failed   DB transaction error 1/3        │
├────────────────────────────────────────────────────────────┤
│ Jobs                                                        │
│ [All] [Waiting] [Active] [Completed] [Failed] [Delayed]     │
│ Search order number / Shopify ID / job ID                   │
│                                                            │
│ Type       Order   Source      Status     Attempts Updated  │
│ Single     #1051   Webhook     Completed  1/5      4:31 PM  │
│ Single     #1052   Webhook     Failed     2/5      4:30 PM  │
│ Scheduled  2 AM    Scheduled   Active     1/1      2:00 AM  │
│ Manual     Today   Manual      Completed  1/3      4:10 PM  │
└────────────────────────────────────────────────────────────┘
```

---

## Mock Data First

Use local mock data for the UI.

Mock queue stats shape:

```ts
type MockQueueStats = {
  queueName: string
  lastRefreshedAt: string
  counts: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
    retrying: number
    paused: number
  }
  today: {
    total: number
    completed: number
    failed: number
    manual: number
    webhook: number
    scheduled: number
  }
}
```

Mock job shape:

```ts
type MockOrderSyncJob = {
  id: string
  type:
    | 'sync-single-order'
    | 'sync-orders-scheduled'
    | 'sync-orders-manual-today'
  orderNumber?: string
  shopifyOrderId?: string
  scope?: 'single_order' | 'today' | 'scheduled_reconciliation'
  source: 'webhook' | 'scheduled_2am' | 'manual'
  status:
    | 'waiting'
    | 'active'
    | 'completed'
    | 'failed'
    | 'delayed'
    | 'retrying'
    | 'paused'
  attemptsMade: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  finishedAt?: string
  errorMessage?: string
}
```

Mock examples should include:

1. Completed webhook single-order sync.
2. Failed webhook single-order sync.
3. Active 2 AM scheduled sync.
4. Completed manual today sync.
5. Delayed duplicate order sync.
6. Retrying Shopify API timeout.
7. Waiting job.
8. No-failure empty state.

---

## Example Mock Data

```ts
export const mockQueueStats: MockQueueStats = {
  queueName: 'shopify-order-sync',
  lastRefreshedAt: '2026-06-05T04:32:00Z',
  counts: {
    waiting: 8,
    active: 3,
    completed: 245,
    failed: 2,
    delayed: 4,
    retrying: 1,
    paused: 0,
  },
  today: {
    total: 263,
    completed: 245,
    failed: 2,
    manual: 3,
    webhook: 257,
    scheduled: 3,
  },
}

export const mockOrderSyncJobs: MockOrderSyncJob[] = [
  {
    id: 'job-001',
    type: 'sync-single-order',
    orderNumber: '#1051',
    shopifyOrderId: 'gid://shopify/Order/1000001051',
    scope: 'single_order',
    source: 'webhook',
    status: 'completed',
    attemptsMade: 1,
    maxAttempts: 5,
    createdAt: '2026-06-05T04:30:00Z',
    updatedAt: '2026-06-05T04:31:00Z',
    finishedAt: '2026-06-05T04:31:00Z',
  },
  {
    id: 'job-002',
    type: 'sync-single-order',
    orderNumber: '#1052',
    shopifyOrderId: 'gid://shopify/Order/1000001052',
    scope: 'single_order',
    source: 'webhook',
    status: 'failed',
    attemptsMade: 2,
    maxAttempts: 5,
    createdAt: '2026-06-05T04:28:00Z',
    updatedAt: '2026-06-05T04:30:00Z',
    errorMessage: 'Shopify API timeout',
  },
  {
    id: 'job-003',
    type: 'sync-orders-scheduled',
    scope: 'scheduled_reconciliation',
    source: 'scheduled_2am',
    status: 'active',
    attemptsMade: 1,
    maxAttempts: 1,
    createdAt: '2026-06-05T14:00:00Z',
    updatedAt: '2026-06-05T14:01:00Z',
  },
  {
    id: 'job-004',
    type: 'sync-orders-manual-today',
    scope: 'today',
    source: 'manual',
    status: 'completed',
    attemptsMade: 1,
    maxAttempts: 3,
    createdAt: '2026-06-05T04:10:00Z',
    updatedAt: '2026-06-05T04:12:00Z',
    finishedAt: '2026-06-05T04:12:00Z',
  },
]
```

---

## Label Rules

Status labels:

```text
waiting   → Waiting
active    → Active
completed → Completed
failed    → Failed
delayed   → Delayed
retrying  → Retrying
paused    → Paused
```

Source labels:

```text
webhook       → Webhook
scheduled_2am → 2 AM Sync
manual        → Manual
```

Job type labels:

```text
sync-single-order        → Single Order
sync-orders-scheduled    → Scheduled Sync
sync-orders-manual-today → Sync Today
```

---

## Backend API Needed Later

Design the UI so it can later consume:

```text
GET /api/queue/orders/stats
GET /api/queue/orders/jobs?status=failed&limit=50
GET /api/queue/orders/jobs?status=all&limit=50
```

Do not build real backend integration in MVP unless approved.

Optional future endpoints, not MVP:

```text
POST /api/queue/orders/jobs/:jobId/retry
POST /api/queue/orders/jobs/:jobId/cancel
```

---

## UI Requirements

- Use mock data first.
- Use NZ/Auckland local time for display.
- Keep UTC timestamps in mock data.
- Use clear status badges.
- Failed jobs should be easy to notice.
- Keep the page read-only in MVP.
- Do not expose sensitive payloads.
- Do not expose Shopify tokens, HMAC values, or secrets.
- Keep UI consistent with existing Price Insight components.
- Avoid advanced charts in MVP.

---

## MVP Scope

Build:

1. `/queue/orders` page.
2. Mock queue stats.
3. Mock recent jobs.
4. Summary cards.
5. Refresh button.
6. Last refreshed timestamp.
7. Recent failures section.
8. Jobs table.
9. Status filters.
10. Search box.
11. Empty state.
12. Loading state.
13. Error state.

Do not build yet:

- real BullMQ API integration
- retry button
- cancel button
- delete job button
- auto-refresh
- charts
- advanced job payload viewer

---

## Testing Requirements

Investigate and propose suitable tests for:

- page renders correctly
- summary cards show correct values
- refresh button updates last refreshed timestamp
- loading state
- error state
- empty state
- failed jobs section
- status filter
- search by order number
- search by Shopify order ID
- status badge rendering
- source label rendering
- job type label rendering

---

## Validation Commands

Investigate project scripts first.

Only recommend commands that actually exist in the repo.

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

Phase 1 is investigation only.

Do not implement until Tony approves the route, UI structure, and mock data approach.

End Phase 1 with:

```text
Waiting for Tony approval.
```
