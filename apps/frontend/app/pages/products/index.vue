<script setup lang="ts">
import type { ProductRow } from '~/shared/types/product'

definePageMeta({ middleware: ['auth'] })

const toast = useToast()

const { data, pending, refresh } = await useFetch<{ items: ProductRow[] }>(
  '/api/products',
  { lazy: true }
)
const products = computed(() => data.value?.items ?? [])

const route = useRoute()
const router = useRouter()

const search = ref(typeof route.query.search === 'string' ? route.query.search : '')

watch(search, (val) => {
  router.replace({ query: { ...route.query, search: val || undefined } })
})
const syncing = ref(false)

async function syncProducts() {
  syncing.value = true
  try {
    const result = await $fetch<{ synced: number }>('/api/products/sync', { method: 'POST' })
    toast.add({ title: `${result.synced} products synced`, color: 'success' })
    await refresh()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Shopify sync failed'
    toast.add({ title: msg, color: 'error' })
  } finally {
    syncing.value = false
  }
}


const statusColor = (status: string) => {
  if (status === 'active') return 'success'
  if (status === 'archived') return 'error'
  return 'neutral'
}

const filtered = computed(() =>
  products.value.filter(p =>
    p.status === 'active' && (
      !search.value ||
      p.title?.toLowerCase().includes(search.value.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.value.toLowerCase())
    )
  )
)

const columns = [
  { accessorKey: 'thumbnail', header: 'Image' },
  { accessorKey: 'title', header: 'Product Name' },
  { accessorKey: 'sku', header: 'SKU' },
  { accessorKey: 'price', header: 'Price' },
  { accessorKey: 'inventoryQuantity', header: 'Inventory' },
  { accessorKey: 'status', header: 'Status' },
]
</script>

<template>
  <div class="mx-auto max-w-[2000px] px-6 py-6">
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold text-gray-900">Products</h1>
        <UButton
          v-if="products.length"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh"
        />
      </div>
      <UInput v-model="search" placeholder="Search products..." icon="i-lucide-search" class="w-64" />
    </div>

    <!-- Loading skeleton -->
    <template v-if="pending">
      <UCard>
        <div class="space-y-3">
          <USkeleton v-for="i in 5" :key="i" class="h-12 w-full" />
        </div>
      </UCard>
    </template>

    <!-- Empty state -->
    <UCard v-else-if="!products.length" class="py-16 text-center">
      <p class="text-sm font-semibold text-highlighted">No products yet</p>
      <p class="mt-1 text-sm text-toned">Sync your Shopify catalog to get started.</p>
      <UButton class="mt-4" icon="i-lucide-download" :loading="syncing" @click="syncProducts">
        Load Products
      </UButton>
    </UCard>

    <!-- Products table -->
    <template v-else>
      <div class="mb-3 flex justify-end">
        <UButton size="sm" icon="i-lucide-download" :loading="syncing" @click="syncProducts">
          Load Products
        </UButton>
      </div>

      <UCard>
        <UTable :data="filtered" :columns="columns">
          <template #thumbnail-cell="{ row }">
            <NuxtLink :to="`/products/${row.original.id}`">
              <img
                v-if="row.original.thumbnail"
                :src="row.original.thumbnail"
                :alt="row.original.title ?? ''"
                class="h-[60px] w-[60px] rounded object-cover"
              />
              <div v-else class="h-[60px] w-[60px] rounded bg-gray-100" />
            </NuxtLink>
          </template>
          <template #title-cell="{ row }">
            <NuxtLink
              :to="`/products/${row.original.id}`"
              class="block max-w-[250px] truncate font-medium text-gray-900 hover:underline"
              :title="row.original.title ?? ''"
            >
              {{ row.original.title }}
            </NuxtLink>
          </template>
          <template #sku-cell="{ row }">
            <span class="font-mono text-sm text-gray-500">{{ row.original.sku }}</span>
          </template>
          <template #price-cell="{ row }">
            <span v-if="row.original.price != null">${{ Number(row.original.price).toFixed(2) }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>
          <template #status-cell="{ row }">
            <UBadge :color="statusColor(row.original.status)" variant="soft" size="sm">
              {{ row.original.status }}
            </UBadge>
          </template>
        </UTable>
      </UCard>
    </template>
  </div>
</template>
