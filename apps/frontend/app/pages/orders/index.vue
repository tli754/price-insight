<script setup lang="ts">
import type { OrderListResponse } from '~/shared/types/order'

const { public: { apiUrl } } = useRuntimeConfig()
const toast = useToast()

const page = ref(1)
const search = ref('')
const financialStatus = ref('')
const fulfillmentStatus = ref('')
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
  return `${apiUrl}/api/orders?${params}`
})

const { data, pending, error } = await useFetch<OrderListResponse>(url, { lazy: true, watch: [url] })

watch(error, (e) => {
  if (e) toast.add({ title: 'Failed to load orders', color: 'error' })
})

const orders = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

const formatDate = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland'
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
  if (status === 'unfulfilled' || !status) return 'neutral'
  return 'neutral'
}

const columns = [
  { accessorKey: 'orderNumber', header: 'Order' },
  { accessorKey: 'customer', header: 'Customer' },
  { accessorKey: 'financialStatus', header: 'Payment' },
  { accessorKey: 'fulfillmentStatus', header: 'Fulfillment' },
  { accessorKey: 'totalPrice', header: 'Total' },
  { accessorKey: 'totalShipping', header: 'Shipping' },
  { accessorKey: 'itemCount', header: 'Items' },
  { accessorKey: 'shopifyCreatedAt', header: 'Date' },
]
</script>

<template>
  <div class="mx-auto max-w-7xl px-6 py-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-lg font-semibold text-gray-900">Orders</h1>
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="search" placeholder="Search by order # or email..." icon="i-lucide-search" class="w-64" />
        <USelect v-model="financialStatus" :options="[{ label: 'All payments', value: '' }, { label: 'Paid', value: 'paid' }, { label: 'Pending', value: 'pending' }, { label: 'Refunded', value: 'refunded' }]" class="w-40" />
        <USelect v-model="fulfillmentStatus" :options="[{ label: 'All fulfillment', value: '' }, { label: 'Fulfilled', value: 'fulfilled' }, { label: 'Unfulfilled', value: 'unfulfilled' }, { label: 'Partial', value: 'partial' }]" class="w-44" />
      </div>
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
            <span v-else-if="row.original.email" class="text-gray-500 text-sm">{{ row.original.email }}</span>
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
            <span v-if="row.original.totalPrice != null">
              {{ row.original.currency ?? '' }} {{ Number(row.original.totalPrice).toFixed(2) }}
            </span>
            <span v-else class="text-gray-400">—</span>
          </template>
          <template #totalShipping-cell="{ row }">
            <span v-if="row.original.totalShipping != null">
              {{ Number(row.original.totalShipping).toFixed(2) }}
            </span>
            <span v-else class="text-gray-400">—</span>
          </template>
          <template #shopifyCreatedAt-cell="{ row }">
            {{ formatDate(row.original.shopifyCreatedAt) }}
          </template>
        </UTable>
      </UCard>

      <div v-if="total > 20" class="mt-4 flex justify-center">
        <UPagination v-model:page="page" :total="total" :items-per-page="20" />
      </div>
    </template>
  </div>
</template>
