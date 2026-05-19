<script setup lang="ts">
const search = ref('')

const products = [
  {
    id: 1,
    image: 'https://cdn.shopify.com/s/files/1/0628/1429/0075/files/10468792167_704503530.jpg?v=1714818467',
    title: 'Camping Tripod Portable Aluminum',
    sku: 'CT-S-110',
    brand: 'White Donkey',
    price: 30.00,
    inventory: 0,
    status: 'draft'
  },
  {
    id: 2,
    image: 'https://cdn.shopify.com/s/files/1/0628/1429/0075/files/O1CN01ExJA711rhhg6bw3tr__3447585663-0-cib.jpg?v=1714650553',
    title: '1.2L Coffee Canister Beige',
    sku: 'CC-120-BEIGE',
    brand: 'White Donkey',
    price: 30.00,
    inventory: 0,
    status: 'draft'
  },
  {
    id: 3,
    image: 'https://cdn.shopify.com/s/files/1/0628/1429/0075/files/O1CN01yBTdAA1yZe1XYdm46__2200533016593-0-cib.jpg?v=1714650631',
    title: '1.2L Coffee Canister Black',
    sku: 'CC-120-BLACK',
    brand: 'White Donkey',
    price: 22.00,
    inventory: 5,
    status: 'active'
  },
  {
    id: 4,
    image: 'https://cdn.shopify.com/s/files/1/0628/1429/0075/files/20609815861_900202913.jpg?v=1714650794',
    title: '1.2L Coffee Canister Silver',
    sku: 'CC-120-STEEL',
    brand: 'White Donkey',
    price: 30.00,
    inventory: 0,
    status: 'archived'
  },
  {
    id: 5,
    image: 'https://cdn.shopify.com/s/files/1/0628/1429/0075/files/WeChat_Image_20240807104555.jpg?v=1726567369',
    title: '1.2L Coffee Canister Blue',
    sku: 'CC-120-BLUE',
    brand: 'White Donkey',
    price: 30.00,
    inventory: 12,
    status: 'active'
  }
]

const statusColor = (status: string) => {
  if (status === 'active') return 'success'
  if (status === 'archived') return 'error'
  return 'neutral'
}

const filtered = computed(() =>
  products.filter(p =>
    !search.value || p.title.toLowerCase().includes(search.value.toLowerCase()) || p.sku.toLowerCase().includes(search.value.toLowerCase())
  )
)

const columns = [
  { accessorKey: 'image', header: 'Image' },
  { accessorKey: 'title', header: 'Product Name' },
  { accessorKey: 'sku', header: 'SKU' },
  { accessorKey: 'brand', header: 'Brand' },
  { accessorKey: 'price', header: 'Price' },
  { accessorKey: 'inventory', header: 'Inventory' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">Products</h1>
      <UInput v-model="search" placeholder="Search products..." icon="i-lucide-search" class="w-64" />
    </div>

    <UCard>
      <UTable :data="filtered" :columns="columns">
        <template #image-cell="{ row }">
          <img :src="row.original.image" :alt="row.original.title" class="h-10 w-10 rounded object-cover" />
        </template>
        <template #title-cell="{ row }">
          <span class="font-medium text-gray-900">{{ row.original.title }}</span>
        </template>
        <template #sku-cell="{ row }">
          <span class="font-mono text-sm text-gray-500">{{ row.original.sku }}</span>
        </template>
        <template #price-cell="{ row }">
          ${{ row.original.price.toFixed(2) }}
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="statusColor(row.original.status)" variant="soft" size="sm">
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <UButton size="sm" variant="ghost" color="neutral" label="View" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
