<script setup lang="ts">
import type { OrderListResponse } from '~/shared/types/order'
import { mockOrders, mockOrderMap } from '~/data/mock-orders'

const toast = useToast()

const page = ref(1)
const search = ref('')
const financialStatus = ref('')
const fulfillmentStatus = ref('')
const syncStatusFilter = ref('')
const debouncedSearch = ref('')

let searchTimeout: ReturnType<typeof setTimeout>
watch(search, (val) => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    debouncedSearch.value = val
    page.value = 1
  }, 300)
})

const url = computed(() => {
  const params = new URLSearchParams({ page: String(page.value), limit: '20' })
  if (debouncedSearch.value) params.set('search', debouncedSearch.value)
  if (financialStatus.value) params.set('financialStatus', financialStatus.value)
  if (fulfillmentStatus.value) params.set('fulfillmentStatus', fulfillmentStatus.value)
  return `/api/orders?${params}`
})

const { data, pending, error, refresh } = await useFetch<OrderListResponse>(url, { lazy: true, watch: [url] })

watch(error, (e) => {
  if (e) toast.add({ title: 'Failed to load orders', color: 'error' })
})

const syncing = ref(false)

async function syncOrders() {
  syncing.value = true
  try {
    const result = await $fetch<{ jobsEnqueued: number }>(
      '/api/shopify/orders/sync',
      { method: 'POST', body: { mode: 'last30days', source: 'manual' } }
    )
    toast.add({ title: 'Sync queued', description: `${result.jobsEnqueued} order(s) queued for sync.`, color: 'success' })
    await refresh()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Could not queue sync'
    toast.add({ title: msg, color: 'error' })
  } finally {
    syncing.value = false
  }
}

const orders = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const totalSales = computed(() => data.value?.totalSales ?? null)

const formattedSales = computed(() => {
  if (totalSales.value == null) return null
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(totalSales.value)
})

// ── Mock summary stats (computed from mock data for today) ──────────────────
const todayStr = new Date().toDateString()
const todayMockOrders = computed(() =>
  mockOrders.filter(o => new Date(o.createdAt).toDateString() === todayStr)
)
const summaryCards = computed(() => [
  {
    label: 'Orders Today',
    value: todayMockOrders.value.length,
    icon: 'i-lucide-shopping-bag',
  },
  {
    label: 'Revenue Today',
    value: `NZD ${todayMockOrders.value.reduce((s, o) => s + o.total, 0).toFixed(2)}`,
    icon: 'i-lucide-dollar-sign',
  },
  {
    label: 'Units Sold',
    value: todayMockOrders.value.reduce((s, o) => s + o.totalQuantity, 0),
    icon: 'i-lucide-package',
  },
  {
    label: 'Sync Failures',
    value: mockOrders.filter(o => o.syncStatus === 'failed').length,
    icon: 'i-lucide-alert-circle',
    alert: mockOrders.some(o => o.syncStatus === 'failed'),
  },
])

// ── Mock sync fields overlaid on real order rows ────────────────────────────
const syncStatusColor = (status: string) => {
  if (status === 'synced') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'error'
  return 'neutral'
}

const syncSourceLabel = (source: string) => {
  if (source === 'webhook') return 'Webhook'
  if (source === 'scheduled_2am') return '2 AM Job'
  if (source === 'manual') return 'Manual'
  return source
}

const lastSyncTime = 'Jun 2, 2026 2:00 AM'

const formatDate = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', {
    dateStyle: 'medium',
    timeZone: 'Pacific/Auckland',
  })
}

const financialColor = (status: string | null) => {
  if (status === 'paid') return 'success'
  if (status === 'refunded' || status === 'voided') return 'error'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

const fulfillmentColor = (status: string | null) => {
  if (status === 'fulfilled') return 'success'
  if (status === 'partial') return 'warning'
  return 'neutral'
}

const columns = [
  { accessorKey: 'orderNumber', header: 'Order' },
  { accessorKey: 'customer', header: 'Customer' },
  { accessorKey: 'itemCount', header: 'Items' },
  { accessorKey: 'totalPrice', header: 'Total' },
  { accessorKey: 'financialStatus', header: 'Payment' },
  { accessorKey: 'fulfillmentStatus', header: 'Fulfillment' },
  { accessorKey: 'syncStatus', header: 'Sync' },
  { accessorKey: 'syncSource', header: 'Source' },
  { accessorKey: 'shopifyCreatedAt', header: 'Date' },
]
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-6">

    <!-- Header -->
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="flex items-center gap-2 text-lg font-semibold text-gray-900">
          Orders
          <UBadge v-if="data" color="neutral" variant="soft" size="sm">{{ total.toLocaleString() }}</UBadge>
          <UBadge v-if="formattedSales" color="neutral" variant="soft" size="sm">{{ formattedSales }}</UBadge>
        </h1>
        <p class="mt-0.5 text-xs text-gray-500">
          Last scheduled sync: {{ lastSyncTime }} ·
          <span class="text-green-600 font-medium">Webhook active</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="search" placeholder="Search by order # or email..." icon="i-lucide-search" class="w-56" />
        <USelect
          v-model="financialStatus"
          :items="[{ label: 'Paid', value: 'paid' }, { label: 'Pending', value: 'pending' }, { label: 'Refunded', value: 'refunded' }]"
          placeholder="All payments"
          class="w-36"
        />
        <USelect
          v-model="fulfillmentStatus"
          :items="[{ label: 'Fulfilled', value: 'fulfilled' }, { label: 'Unfulfilled', value: 'unfulfilled' }, { label: 'Partial', value: 'partial' }]"
          placeholder="All fulfillment"
          class="w-40"
        />
        <USelect
          v-model="syncStatusFilter"
          :items="[{ label: 'Synced', value: 'synced' }, { label: 'Failed', value: 'failed' }, { label: 'Pending', value: 'pending' }]"
          placeholder="All sync"
          class="w-32"
        />
        <UButton size="sm" color="primary" icon="i-lucide-play" :loading="syncing" @click="syncOrders">
          Sync Orders
        </UButton>
      </div>
    </div>

    <!-- Summary cards (mock data) -->
    <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UCard v-for="card in summaryCards" :key="card.label" class="py-3">
        <div class="flex items-center gap-3">
          <UIcon :name="card.icon" class="h-5 w-5 shrink-0" :class="card.alert ? 'text-red-500' : 'text-gray-400'" />
          <div>
            <p class="text-xs text-gray-500">{{ card.label }}</p>
            <p class="text-lg font-semibold" :class="card.alert ? 'text-red-600' : 'text-gray-900'">{{ card.value }}</p>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Loading skeleton -->
    <template v-if="pending">
      <UCard>
        <div class="space-y-3">
          <USkeleton v-for="i in 8" :key="i" class="h-12 w-full" />
        </div>
      </UCard>
    </template>

    <!-- Empty state -->
    <UCard v-else-if="!orders.length" class="py-16 text-center">
      <p class="text-sm font-semibold text-highlighted">No orders found</p>
      <p class="mt-1 text-sm text-toned">Sync orders from Shopify to see them here.</p>
      <UButton class="mt-4" color="primary" icon="i-lucide-play" :loading="syncing" @click="syncOrders">
        Sync Orders
      </UButton>
    </UCard>

    <!-- Orders table -->
    <template v-else>
      <UCard>
        <UTable :data="orders" :columns="columns">
          <template #orderNumber-cell="{ row }">
            <NuxtLink
              :to="`/orders/${row.original.id}`"
              class="font-medium text-primary hover:underline"
            >
              #{{ row.original.orderNumber }}
            </NuxtLink>
          </template>
          <template #customer-cell="{ row }">
            <span v-if="row.original.customerFirstName || row.original.customerLastName">
              {{ row.original.customerFirstName }} {{ row.original.customerLastName }}
            </span>
            <span v-else-if="row.original.email" class="text-sm text-gray-500">{{ row.original.email }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>
          <template #financialStatus-cell="{ row }">
            <UBadge v-if="row.original.financialStatus" :color="financialColor(row.original.financialStatus)" variant="soft" size="sm">
              {{ row.original.financialStatus }}
            </UBadge>
            <span v-else class="text-gray-400">—</span>
          </template>
          <template #fulfillmentStatus-cell="{ row }">
            <UBadge :color="fulfillmentColor(row.original.fulfillmentStatus)" variant="soft" size="sm">
              {{ row.original.fulfillmentStatus ?? 'unfulfilled' }}
            </UBadge>
          </template>
          <template #totalPrice-cell="{ row }">
            <span v-if="row.original.totalPrice != null" class="font-medium">
              {{ row.original.currency ?? '' }} {{ Number(row.original.totalPrice).toFixed(2) }}
            </span>
            <span v-else class="text-gray-400">—</span>
          </template>
          <!-- Mock sync fields keyed by order number -->
          <template #syncStatus-cell="{ row }">
            <template v-if="mockOrderMap.has(row.original.orderNumber)">
              <UBadge :color="syncStatusColor(mockOrderMap.get(row.original.orderNumber)!.syncStatus)" variant="soft" size="sm">
                {{ mockOrderMap.get(row.original.orderNumber)!.syncStatus }}
              </UBadge>
            </template>
            <UBadge v-else color="success" variant="soft" size="sm">synced</UBadge>
          </template>
          <template #syncSource-cell="{ row }">
            <span class="text-xs text-gray-500">
              {{ mockOrderMap.has(row.original.orderNumber)
                ? syncSourceLabel(mockOrderMap.get(row.original.orderNumber)!.syncSource)
                : 'Webhook' }}
            </span>
          </template>
          <template #shopifyCreatedAt-cell="{ row }">
            <span class="text-sm text-gray-600">{{ formatDate(row.original.shopifyCreatedAt) }}</span>
          </template>
        </UTable>
      </UCard>

      <div v-if="total > 20" class="mt-4 flex justify-center">
        <UPagination v-model:page="page" :total="total" :items-per-page="20" />
      </div>
    </template>
  </div>
</template>
