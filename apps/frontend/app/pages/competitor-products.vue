<script setup lang="ts">

const rows = [
  {
    id: 1,
    product: 'Camping Tripod Portable Aluminum',
    competitor: 'amazon.com',
    competitorTitle: 'Camping Tripod Aluminum Triangle Fire Bonfire Frame 1.1M',
    price: '$28.99',
    oldPrice: null,
    source: 'amazon.com',
    googlePosition: 1,
    status: 'confirmed'
  },
  {
    id: 2,
    product: '1.2L Coffee Canister Black',
    competitor: 'trademe.co.nz',
    competitorTitle: 'Stainless Steel Coffee Canister Airtight Black 1.2L with Spoon',
    price: '$19.95',
    oldPrice: '$24.99',
    source: 'trademe.co.nz',
    googlePosition: 3,
    status: 'suggested'
  },
  {
    id: 3,
    product: '1.2L Coffee Canister Blue',
    competitor: 'thewarehouse.co.nz',
    competitorTitle: 'Airtight Coffee Storage Canister Blue Stainless',
    price: '$25.00',
    oldPrice: null,
    source: 'thewarehouse.co.nz',
    googlePosition: 2,
    status: 'confirmed'
  },
  {
    id: 4,
    product: '1.2L Coffee Canister Beige',
    competitor: 'amazon.com',
    competitorTitle: 'Coffee Canister Airtight Stainless Steel Beige 1.2L CO2 Valve',
    price: '$32.00',
    oldPrice: '$39.99',
    source: 'amazon.com',
    googlePosition: 5,
    status: 'suggested'
  },
  {
    id: 5,
    product: '1.2L Coffee Canister Silver',
    competitor: 'mitre10.co.nz',
    competitorTitle: 'Coffee Bean Storage Stainless Steel Silver 1.2L',
    price: '$27.50',
    oldPrice: null,
    source: 'mitre10.co.nz',
    googlePosition: 8,
    status: 'suggested'
  }
]

const columns = [
  { accessorKey: 'product', header: 'Product' },
  { accessorKey: 'competitor', header: 'Competitor' },
  { accessorKey: 'competitorTitle', header: 'Competitor Title' },
  { accessorKey: 'price', header: 'Price' },
  { accessorKey: 'oldPrice', header: 'Old Price' },
  { accessorKey: 'source', header: 'Source' },
  { accessorKey: 'googlePosition', header: 'Google Position' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">Competitor Products</h1>
    </div>

    <UCard>
      <UTable :data="rows" :columns="columns">
        <template #product-cell="{ row }">
          <span class="font-medium text-gray-900">{{ row.original.product }}</span>
        </template>
        <template #competitorTitle-cell="{ row }">
          <span class="max-w-xs truncate block text-sm text-gray-600" :title="row.original.competitorTitle">
            {{ row.original.competitorTitle }}
          </span>
        </template>
        <template #price-cell="{ row }">
          <span class="font-medium">{{ row.original.price }}</span>
        </template>
        <template #oldPrice-cell="{ row }">
          <span v-if="row.original.oldPrice" class="text-sm text-gray-400 line-through">
            {{ row.original.oldPrice }}
          </span>
          <span v-else class="text-gray-300">—</span>
        </template>
        <template #source-cell="{ row }">
          <span class="text-sm text-gray-500">{{ row.original.source }}</span>
        </template>
        <template #googlePosition-cell="{ row }">
          <UBadge color="neutral" variant="soft" size="sm">#{{ row.original.googlePosition }}</UBadge>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'confirmed' ? 'success' : 'warning'"
            variant="soft"
            size="sm"
          >
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #actions-cell>
          <UButton size="sm" variant="ghost" color="neutral" label="View" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
