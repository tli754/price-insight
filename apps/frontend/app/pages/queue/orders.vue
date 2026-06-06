<script setup lang="ts">
import type { QueueJob, QueueResponse } from '~/shared/types/queue'

const toast = useToast()

// ── Data fetch ─────────────────────────────────────────────────────────────
const { data, pending: loading, refresh } = await useFetch<QueueResponse>(
  '/api/shopify/orders/queue',
  { lazy: true }
)

onMounted(refresh)

const counts = computed(() => data.value?.counts ?? { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 })
const jobs = computed(() => data.value?.jobs ?? [])
const lastRefreshedAt = computed(() => data.value?.lastRefreshedAt)

const lastRefreshedLabel = computed(() => {
  if (!lastRefreshedAt.value) return '—'
  return new Date(lastRefreshedAt.value).toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland',
  })
})

// ── Refresh ────────────────────────────────────────────────────────────────
const refreshing = ref(false)
async function doRefresh() {
  refreshing.value = true
  try {
    await refresh()
  } finally {
    refreshing.value = false
  }
}

// ── Clean ──────────────────────────────────────────────────────────────────
const cleaning = ref(false)
async function cleanQueue() {
  cleaning.value = true
  try {
    const res = await $fetch<{ removed: { completed: number; failed: number; delayed: number } }>(
      '/api/shopify/orders/queue/clean',
      { method: 'POST' }
    )
    const total = res.removed.completed + res.removed.failed + res.removed.delayed
    toast.add({ title: 'Queue cleaned', description: `${total} job(s) removed.`, color: 'success' })
    await refresh()
  } catch {
    toast.add({ title: 'Clean failed', description: 'Could not clean the queue.', color: 'error' })
  } finally {
    cleaning.value = false
  }
}

// ── Summary cards ──────────────────────────────────────────────────────────
const summaryCards = computed(() => [
  { label: 'Waiting',   value: counts.value.waiting,   color: 'neutral' },
  { label: 'Active',    value: counts.value.active,    color: 'primary' },
  { label: 'Completed', value: counts.value.completed, color: 'success' },
  { label: 'Failed',    value: counts.value.failed,    color: 'error',   alert: counts.value.failed > 0 },
  { label: 'Delayed',   value: counts.value.delayed,   color: 'warning' },
  { label: 'Paused',    value: counts.value.paused,    color: 'neutral' },
])

// ── Failures ───────────────────────────────────────────────────────────────
const recentFailures = computed(() => jobs.value.filter(j => j.state === 'failed'))

// ── Jobs table ─────────────────────────────────────────────────────────────
const statusFilter = ref<QueueJob['state'] | 'all'>('all')
const search = ref('')

const filteredJobs = computed(() => {
  let list = jobs.value
  if (statusFilter.value !== 'all') {
    list = list.filter(j => j.state === statusFilter.value)
  }
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    list = list.filter(j =>
      (j.id ?? '').toLowerCase().includes(q) ||
      (j.data.orderName ?? '').toLowerCase().includes(q) ||
      (j.data.shopifyOrderId ?? '').toLowerCase().includes(q)
    )
  }
  return list
})

const filterOptions = [
  { label: 'All',       value: 'all' },
  { label: 'Waiting',   value: 'waiting' },
  { label: 'Active',    value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed',    value: 'failed' },
  { label: 'Delayed',   value: 'delayed' },
]

const jobColumns = [
  { accessorKey: 'name',      header: 'Job Type' },
  { accessorKey: 'orderName', header: 'Order' },
  { accessorKey: 'source',    header: 'Source' },
  { accessorKey: 'state',     header: 'Status' },
  { accessorKey: 'attempts',  header: 'Attempts' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'finishedAt',header: 'Finished' },
  { accessorKey: 'failedReason', header: 'Error' },
]

// ── Helpers ────────────────────────────────────────────────────────────────
const statusColor = (s: string) => {
  if (s === 'completed') return 'success'
  if (s === 'active')    return 'primary'
  if (s === 'failed')    return 'error'
  if (s === 'waiting' || s === 'delayed') return 'warning'
  return 'neutral'
}

const sourceLabel = (s: string) => {
  if (s === 'scheduled_2am') return '2 AM Sync'
  if (s === 'manual')        return 'Manual'
  return s
}

const typeLabel = (name: string) => {
  if (name === 'sync-order')      return 'Sync Order'
  if (name === 'discover-orders') return 'Discover Orders'
  return name
}

const fmt = (iso: string | null | undefined) => {
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
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-refresh-cw"
          size="sm"
          variant="soft"
          :loading="refreshing || loading"
          :disabled="refreshing || loading"
          @click="doRefresh"
        >
          Refresh
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          size="sm"
          color="error"
          variant="soft"
          :loading="cleaning"
          :disabled="cleaning"
          @click="cleanQueue"
        >
          Clean
        </UButton>
      </div>
    </div>

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <USkeleton v-for="n in 6" :key="n" class="h-20 w-full" />
      </div>
      <USkeleton class="mb-4 h-32 w-full" />
      <USkeleton class="h-64 w-full" />
    </template>

    <template v-else>
      <!-- Summary cards -->
      <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
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
            <span class="font-semibold text-gray-900">{{ job.data.orderName ?? job.id }}</span>
            <span class="text-gray-600">{{ typeLabel(job.name) }}</span>
            <UBadge color="neutral" variant="soft" size="sm">{{ sourceLabel(job.data.source) }}</UBadge>
            <span class="grow text-red-700">{{ job.failedReason ?? '—' }}</span>
            <span class="text-gray-400">{{ job.attemptsMade }}/{{ job.maxAttempts }} attempts</span>
            <span class="text-gray-400">{{ fmt(job.finishedAt ?? job.processedAt) }}</span>
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
          <template #name-cell="{ row }">
            <span class="text-sm">{{ typeLabel(row.original.name) }}</span>
          </template>
          <template #orderName-cell="{ row }">
            <span class="font-medium">{{ row.original.data.orderName ?? '—' }}</span>
          </template>
          <template #source-cell="{ row }">
            <span class="text-sm text-gray-600">{{ sourceLabel(row.original.data.source) }}</span>
          </template>
          <template #state-cell="{ row }">
            <UBadge :color="statusColor(row.original.state)" variant="soft" size="sm">
              {{ row.original.state }}
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
          <template #finishedAt-cell="{ row }">
            <span class="text-sm text-gray-500">{{ fmt(row.original.finishedAt) }}</span>
          </template>
          <template #failedReason-cell="{ row }">
            <span v-if="row.original.failedReason" class="text-xs text-red-600">
              {{ row.original.failedReason }}
            </span>
            <span v-else class="text-gray-300">—</span>
          </template>
        </UTable>
        <p v-else class="py-8 text-center text-sm text-gray-400">No jobs match the current filter.</p>
      </UCard>
    </template>

  </div>
</template>
