<script setup lang="ts">
import { mockOrderSyncJobs, mockQueueStats } from '~/data/mock-queue'
import type { MockOrderSyncJob } from '~/shared/types/mock-queue'

// ── Refresh ────────────────────────────────────────────────────────────────
const refreshing = ref(false)
const lastRefreshed = ref(new Date(mockQueueStats.lastRefreshedAt))

async function refresh() {
  refreshing.value = true
  await new Promise(r => setTimeout(r, 300))
  lastRefreshed.value = new Date()
  refreshing.value = false
}

const lastRefreshedLabel = computed(() =>
  lastRefreshed.value.toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland',
  })
)

// ── Summary cards ──────────────────────────────────────────────────────────
const summaryCards = computed(() => [
  { label: 'Waiting',       value: mockQueueStats.counts.waiting,            color: 'neutral' },
  { label: 'Active',        value: mockQueueStats.counts.active,             color: 'primary' },
  { label: 'Completed',     value: mockQueueStats.counts.completed,          color: 'success' },
  { label: 'Failed',        value: mockQueueStats.counts.failed,             color: 'error',  alert: mockQueueStats.counts.failed > 0 },
  { label: 'Delayed',       value: mockQueueStats.counts.delayed,            color: 'warning' },
  { label: 'Retrying',      value: mockQueueStats.counts.retrying,           color: 'warning' },
  { label: 'Manual Today',  value: mockQueueStats.today.manual,              color: 'neutral' },
  { label: 'Webhook Today', value: mockQueueStats.today.webhook,             color: 'neutral' },
])

// ── Failures ───────────────────────────────────────────────────────────────
const recentFailures = computed(() =>
  mockOrderSyncJobs.filter(j => j.status === 'failed')
)

// ── Jobs table ─────────────────────────────────────────────────────────────
const statusFilter = ref<MockOrderSyncJob['status'] | 'all'>('all')
const search = ref('')

const filteredJobs = computed(() => {
  let jobs = mockOrderSyncJobs
  if (statusFilter.value !== 'all') {
    jobs = jobs.filter(j => j.status === statusFilter.value)
  }
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    jobs = jobs.filter(j =>
      j.id.toLowerCase().includes(q) ||
      (j.orderNumber ?? '').toLowerCase().includes(q) ||
      (j.shopifyOrderId ?? '').toLowerCase().includes(q)
    )
  }
  return jobs
})

const filterOptions = [
  { label: 'All',       value: 'all' },
  { label: 'Waiting',   value: 'waiting' },
  { label: 'Active',    value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed',    value: 'failed' },
  { label: 'Delayed',   value: 'delayed' },
  { label: 'Retrying',  value: 'retrying' },
]

const jobColumns = [
  { accessorKey: 'type',        header: 'Job Type' },
  { accessorKey: 'orderNumber', header: 'Order / Scope' },
  { accessorKey: 'source',      header: 'Source' },
  { accessorKey: 'status',      header: 'Status' },
  { accessorKey: 'attempts',    header: 'Attempts' },
  { accessorKey: 'createdAt',   header: 'Created' },
  { accessorKey: 'updatedAt',   header: 'Updated' },
  { accessorKey: 'finishedAt',  header: 'Finished' },
  { accessorKey: 'errorMessage',header: 'Error' },
]

// ── Helpers ────────────────────────────────────────────────────────────────
const statusColor = (s: string) => {
  if (s === 'completed') return 'success'
  if (s === 'active')    return 'primary'
  if (s === 'failed')    return 'error'
  if (s === 'waiting' || s === 'delayed' || s === 'retrying') return 'warning'
  return 'neutral'
}

const sourceLabel = (s: string) => {
  if (s === 'webhook')       return 'Webhook'
  if (s === 'scheduled_2am') return '2 AM Sync'
  if (s === 'manual')        return 'Manual'
  return s
}

const typeLabel = (t: string) => {
  if (t === 'sync-single-order')        return 'Single Order'
  if (t === 'sync-orders-scheduled')    return 'Scheduled Sync'
  if (t === 'sync-orders-manual-today') return 'Sync Today'
  return t
}

const fmt = (iso: string | undefined) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland',
  })
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-6">

    <!-- Header -->
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold text-gray-900">Order Sync Queue</h1>
        <p class="mt-0.5 text-sm text-gray-500">Monitor Shopify order sync jobs</p>
        <p class="mt-0.5 text-xs text-gray-400">Last refreshed: {{ lastRefreshedLabel }}</p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        size="sm"
        variant="soft"
        :loading="refreshing"
        :disabled="refreshing"
        @click="refresh"
      >
        Refresh
      </UButton>
    </div>

    <!-- Loading skeleton -->
    <template v-if="refreshing">
      <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <USkeleton v-for="n in 8" :key="n" class="h-20 w-full" />
      </div>
      <USkeleton class="mb-4 h-32 w-full" />
      <USkeleton class="h-64 w-full" />
    </template>

    <template v-else>
      <!-- Summary cards -->
      <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <UCard
          v-for="card in summaryCards"
          :key="card.label"
          :class="card.alert ? 'ring-1 ring-red-300' : ''"
          class="py-3"
        >
          <div class="px-1">
            <p class="text-xs text-gray-500">{{ card.label }}</p>
            <p
              class="mt-1 text-2xl font-semibold"
              :class="card.alert ? 'text-red-600' : 'text-gray-900'"
            >
              {{ card.value }}
            </p>
          </div>
        </UCard>
      </div>

      <!-- Recent failures -->
      <UCard class="mb-6">
        <template #header>
          <div class="flex items-center gap-2">
            <h2 class="font-semibold text-gray-900">Recent Failures</h2>
            <UBadge v-if="recentFailures.length" color="error" variant="soft" size="sm">
              {{ recentFailures.length }}
            </UBadge>
          </div>
        </template>
        <div v-if="recentFailures.length" class="space-y-3">
          <div
            v-for="job in recentFailures"
            :key="job.id"
            class="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg bg-red-50 px-4 py-3 text-sm"
          >
            <span class="font-semibold text-gray-900">{{ job.orderNumber ?? job.scope ?? job.id }}</span>
            <span class="text-gray-600">{{ typeLabel(job.type) }}</span>
            <UBadge color="neutral" variant="soft" size="sm">{{ sourceLabel(job.source) }}</UBadge>
            <span class="grow text-red-700">{{ job.errorMessage ?? '—' }}</span>
            <span class="text-gray-400">{{ job.attemptsMade }}/{{ job.maxAttempts }} attempts</span>
            <span class="text-gray-400">{{ fmt(job.updatedAt) }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-gray-400">No failed order sync jobs.</p>
      </UCard>

      <!-- Jobs table -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold text-gray-900">Jobs</h2>
            <div class="flex flex-wrap items-center gap-2">
              <USelect
                v-model="statusFilter"
                :items="filterOptions"
                value-key="value"
                class="w-36"
              />
              <UInput
                v-model="search"
                placeholder="Search order #, Shopify ID, job ID…"
                icon="i-lucide-search"
                class="w-64"
              />
            </div>
          </div>
        </template>

        <UTable v-if="filteredJobs.length" :data="filteredJobs" :columns="jobColumns">
          <template #type-cell="{ row }">
            <span class="text-sm">{{ typeLabel(row.original.type) }}</span>
          </template>
          <template #orderNumber-cell="{ row }">
            <span class="font-medium">
              {{ row.original.orderNumber ?? row.original.scope ?? '—' }}
            </span>
          </template>
          <template #source-cell="{ row }">
            <span class="text-sm text-gray-600">{{ sourceLabel(row.original.source) }}</span>
          </template>
          <template #status-cell="{ row }">
            <UBadge :color="statusColor(row.original.status)" variant="soft" size="sm">
              {{ row.original.status }}
            </UBadge>
          </template>
          <template #attempts-cell="{ row }">
            <span class="text-sm text-gray-600">
              {{ row.original.attemptsMade }}/{{ row.original.maxAttempts }}
            </span>
          </template>
          <template #createdAt-cell="{ row }">
            <span class="text-sm text-gray-500">{{ fmt(row.original.createdAt) }}</span>
          </template>
          <template #updatedAt-cell="{ row }">
            <span class="text-sm text-gray-500">{{ fmt(row.original.updatedAt) }}</span>
          </template>
          <template #finishedAt-cell="{ row }">
            <span class="text-sm text-gray-500">{{ fmt(row.original.finishedAt) }}</span>
          </template>
          <template #errorMessage-cell="{ row }">
            <span v-if="row.original.errorMessage" class="text-xs text-red-600">
              {{ row.original.errorMessage }}
            </span>
            <span v-else class="text-gray-300">—</span>
          </template>
        </UTable>
        <p v-else class="py-8 text-center text-sm text-gray-400">No jobs match the current filter.</p>
      </UCard>
    </template>

  </div>
</template>
