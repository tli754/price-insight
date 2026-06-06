export type QueueCounts = {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  paused: number
}

export type QueueJob = {
  id: string | undefined
  name: string
  data: {
    type: string
    source: 'scheduled_2am' | 'manual'
    shopifyOrderId?: string
    orderName?: string
    shopifyUpdatedAt?: string
    shopifyOrder?: unknown
  }
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  attemptsMade: number
  maxAttempts: number
  createdAt: string
  processedAt: string | null
  finishedAt: string | null
  failedReason: string | null
}

export type QueueResponse = {
  queueName: string
  lastRefreshedAt: string
  counts: QueueCounts
  jobs: QueueJob[]
}
