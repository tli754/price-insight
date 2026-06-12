import type { MockOrderSyncJob, MockQueueStats } from '~/shared/types/mock-queue'

const now = new Date()
const t = (offsetMinutes: number) => {
  const d = new Date(now)
  d.setMinutes(d.getMinutes() - offsetMinutes)
  return d.toISOString()
}
const todayAt = (hour: number, minute = 0) => {
  const d = new Date(now)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export const mockQueueStats: MockQueueStats = {
  queueName: 'shopify-order-sync',
  lastRefreshedAt: t(0),
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
  // 1. Completed webhook single-order sync
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
    createdAt: t(3),
    updatedAt: t(2),
    finishedAt: t(2),
  },
  // 2. Failed webhook single-order sync
  {
    id: 'job-002',
    type: 'sync-single-order',
    orderNumber: '#1052',
    shopifyOrderId: 'gid://shopify/Order/1000001052',
    scope: 'single_order',
    source: 'webhook',
    status: 'failed',
    attemptsMade: 5,
    maxAttempts: 5,
    createdAt: t(8),
    updatedAt: t(4),
    errorMessage: 'Shopify API timeout after 3 retries',
  },
  // 3. Active 2 AM scheduled sync
  {
    id: 'job-003',
    type: 'sync-orders-scheduled',
    scope: 'scheduled_reconciliation',
    source: 'scheduled_2am',
    status: 'active',
    attemptsMade: 1,
    maxAttempts: 1,
    createdAt: todayAt(2, 0),
    updatedAt: todayAt(2, 1),
  },
  // 4. Completed manual today sync
  {
    id: 'job-004',
    type: 'sync-orders-manual-today',
    scope: 'today',
    source: 'manual',
    status: 'completed',
    attemptsMade: 1,
    maxAttempts: 3,
    createdAt: t(55),
    updatedAt: t(53),
    finishedAt: t(53),
  },
  // 5. Delayed duplicate order sync
  {
    id: 'job-005',
    type: 'sync-single-order',
    orderNumber: '#1049',
    shopifyOrderId: 'gid://shopify/Order/1000001049',
    scope: 'single_order',
    source: 'webhook',
    status: 'delayed',
    attemptsMade: 1,
    maxAttempts: 5,
    createdAt: t(15),
    updatedAt: t(12),
    errorMessage: 'Duplicate webhook — delayed 30s before retry',
  },
  // 6. Retrying after Shopify API timeout
  {
    id: 'job-006',
    type: 'sync-single-order',
    orderNumber: '#1050',
    shopifyOrderId: 'gid://shopify/Order/1000001050',
    scope: 'single_order',
    source: 'webhook',
    status: 'retrying',
    attemptsMade: 3,
    maxAttempts: 5,
    createdAt: t(20),
    updatedAt: t(6),
    errorMessage: 'Shopify API 429 — rate limit exceeded',
  },
  // 7. Waiting job (newest webhook, not yet picked up)
  {
    id: 'job-007',
    type: 'sync-single-order',
    orderNumber: '#1053',
    shopifyOrderId: 'gid://shopify/Order/1000001053',
    scope: 'single_order',
    source: 'webhook',
    status: 'waiting',
    attemptsMade: 0,
    maxAttempts: 5,
    createdAt: t(1),
    updatedAt: t(1),
  },
  // 8. Second failed job (DB transaction error)
  {
    id: 'job-008',
    type: 'sync-single-order',
    orderNumber: '#1048',
    shopifyOrderId: 'gid://shopify/Order/1000001048',
    scope: 'single_order',
    source: 'manual',
    status: 'failed',
    attemptsMade: 3,
    maxAttempts: 3,
    createdAt: t(90),
    updatedAt: t(70),
    errorMessage: 'DB transaction deadlock — max attempts reached',
  },
]
