export type MockQueueStats = {
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

export type MockOrderSyncJob = {
  id: string
  type: 'sync-single-order' | 'sync-orders-scheduled' | 'sync-orders-manual-today'
  orderNumber?: string
  shopifyOrderId?: string
  scope?: 'single_order' | 'today' | 'scheduled_reconciliation'
  source: 'webhook' | 'scheduled_2am' | 'manual'
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'retrying' | 'paused'
  attemptsMade: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  finishedAt?: string
  errorMessage?: string
}
