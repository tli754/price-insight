<script setup lang="ts">

const stats = [
  { label: 'Total Products', value: '5', icon: 'i-lucide-package' },
  { label: 'Active Competitors', value: '3', icon: 'i-lucide-store' },
  { label: 'Price Changes Today', value: '2', icon: 'i-lucide-trending-up' },
  { label: 'Last Sync', value: '19 May, 09:15', icon: 'i-lucide-refresh-cw' }
]

const insights = [
  {
    id: 1,
    product: '1.2L Coffee Canister Black',
    minPrice: 19.95,
    maxPrice: 32.00,
    marketPosition: 'low',
    summary: 'Your price is below average — consider a small increase to improve margins.',
    capturedAt: '2026-05-19T09:00:00Z'
  },
  {
    id: 2,
    product: 'Camping Tripod Portable Aluminum',
    minPrice: 28.99,
    maxPrice: 35.00,
    marketPosition: 'fair',
    summary: 'Price is within the fair range compared to competitors.',
    capturedAt: '2026-05-19T08:30:00Z'
  },
  {
    id: 3,
    product: '1.2L Coffee Canister Beige',
    minPrice: 28.00,
    maxPrice: 39.99,
    marketPosition: 'high',
    summary: 'Your price is above average — may reduce competitiveness.',
    capturedAt: '2026-05-18T22:00:00Z'
  },
  {
    id: 4,
    product: '1.2L Coffee Canister Blue',
    minPrice: 22.00,
    maxPrice: 30.00,
    marketPosition: 'fair',
    summary: 'Well positioned within the market range.',
    capturedAt: '2026-05-18T20:00:00Z'
  }
]

const positionColor = (pos: string) => {
  if (pos === 'low') return 'success'
  if (pos === 'high') return 'error'
  return 'warning'
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })

const columns = [
  { accessorKey: 'product', header: 'Product' },
  { accessorKey: 'minPrice', header: 'Min Price' },
  { accessorKey: 'maxPrice', header: 'Max Price' },
  { accessorKey: 'marketPosition', header: 'Position' },
  { accessorKey: 'summary', header: 'Summary' },
  { accessorKey: 'capturedAt', header: 'Captured At' }
]
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-6 space-y-6">
    <h1 class="text-lg font-semibold text-gray-900">Insight</h1>

    <div class="grid grid-cols-4 gap-4">
      <UCard v-for="stat in stats" :key="stat.label">
        <div class="flex items-center gap-3">
          <UIcon :name="stat.icon" class="text-primary-500 size-5 shrink-0" />
          <div>
            <p class="text-xs text-gray-500">{{ stat.label }}</p>
            <p class="text-xl font-semibold text-gray-900">{{ stat.value }}</p>
          </div>
        </div>
      </UCard>
    </div>

    <UCard>
      <UTable :data="insights" :columns="columns">
        <template #product-cell="{ row }">
          <span class="font-medium text-gray-900">{{ row.original.product }}</span>
        </template>
        <template #minPrice-cell="{ row }">
          ${{ row.original.minPrice.toFixed(2) }}
        </template>
        <template #maxPrice-cell="{ row }">
          ${{ row.original.maxPrice.toFixed(2) }}
        </template>
        <template #marketPosition-cell="{ row }">
          <UBadge :color="positionColor(row.original.marketPosition)" variant="soft" size="sm">
            {{ row.original.marketPosition }}
          </UBadge>
        </template>
        <template #summary-cell="{ row }">
          <span class="max-w-sm truncate block text-sm text-gray-600" :title="row.original.summary">
            {{ row.original.summary }}
          </span>
        </template>
        <template #capturedAt-cell="{ row }">
          <span class="text-sm text-gray-500">{{ formatDate(row.original.capturedAt) }}</span>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
