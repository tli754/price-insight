<script setup lang="ts">
import type { ProductRow } from '~/shared/types/product'

const toast = useToast()

const { data, pending, refresh } = await useFetch<{ items: ProductRow[] }>(
  '/api/products',
  { lazy: true }
)
const products = computed(() => data.value?.items ?? [])

const route = useRoute()
const router = useRouter()

const inputValue = ref(typeof route.query.search === 'string' ? route.query.search : '')
const search = ref(inputValue.value)

function applySearch() {
  search.value = inputValue.value
}

watch(search, (val) => {
  router.replace({ query: { ...route.query, search: val || undefined } })
})

const syncing = ref(false)
const findingCompetitors = ref(false)

async function findCompetitors() {
  findingCompetitors.value = true
  try {
    const result = await $fetch<{ submitted: number }>('/api/products/find-competitors', {
      method: 'POST',
      body: { productIds: paginated.value.map(p => p.id) }
    })
    toast.add({
      title: `${result.submitted} competitor search${result.submitted !== 1 ? 'es' : ''} submitted`,
      description: 'Results will appear shortly via background sync.',
      color: 'success'
    })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to submit competitor search'
    toast.add({ title: msg, color: 'error' })
  } finally {
    findingCompetitors.value = false
  }
}

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

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'title' | 'price' | 'inventoryQuantity' | 'sold7d' | 'sold30d' | 'sold90d'
const sortKey = ref<SortKey | null>('sold7d')
const sortDir = ref<'asc' | 'desc'>('desc')

const salesSortKeys: SortKey[] = ['sold7d', 'sold30d', 'sold90d']

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = salesSortKeys.includes(key) ? 'desc' : 'asc'
  }
  page.value = 1
}

const sorted = computed(() => {
  if (!sortKey.value) return filtered.value
  const key = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...filtered.value].sort((a, b) => {
    const av = a[key] ?? null
    const bv = b[key] ?? null
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'string' && typeof bv === 'string')
      return av.localeCompare(bv) * dir
    return ((av as number) - (bv as number)) * dir
  })
})

// ── Pagination ────────────────────────────────────────────────────────────────

const page = ref(typeof route.query.page === 'string' ? Math.max(1, parseInt(route.query.page) || 1) : 1)
const pageSizeStr = ref('20')
const pageSize = computed(() => Number(pageSizeStr.value))

const pageSizeOptions = [
  { label: '20 per page', value: '20' },
  { label: '30 per page', value: '30' },
  { label: '50 per page', value: '50' },
  { label: '100 per page', value: '100' },
]

watch(page, (val) => {
  router.replace({ query: { ...route.query, page: val > 1 ? String(val) : undefined } })
})
watch(pageSizeStr, () => { page.value = 1 })
watch(search, () => { page.value = 1 })

const paginated = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return sorted.value.slice(start, start + pageSize.value)
})

// ── Column resize ─────────────────────────────────────────────────────────────

const colWidths = reactive({
  thumbnail: 60,
  title: 400,
  price: 110,
  inventory: 110,
  inventoryAlert: 210,
  status: 100,
  avgCompetitor: 140,
  sales7d: 130,
  sales30d: 130,
  sales90d: 130,
})

type ColKey = keyof typeof colWidths
let resizing: { key: ColKey; startX: number; startW: number } | null = null

function startResize(e: MouseEvent, key: ColKey) {
  resizing = { key, startX: e.clientX, startW: colWidths[key] }
  e.preventDefault()
}

function onResizeMove(e: MouseEvent) {
  if (!resizing) return
  colWidths[resizing.key] = Math.max(40, resizing.startW + e.clientX - resizing.startX)
}

function stopResize() {
  resizing = null
}

function fmtSales(qty: number | undefined, rev: number | undefined): string {
  if (!qty) return '—'
  return `${qty} ($${Math.round(rev ?? 0).toLocaleString()})`
}

function inventoryAlert(p: ProductRow) {
  return calcInventoryAlert(p.inventoryQuantity, p.sold7d, p.sold30d, p.sold90d)
}

onMounted(() => {
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
})
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-6">
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
      <div class="flex items-center gap-2">
        <UInput v-model="inputValue" placeholder="Search products..." icon="i-lucide-search" class="w-56" @keyup.enter="applySearch" />
        <UButton size="sm" icon="i-lucide-search" @click="applySearch">Search</UButton>
      </div>
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
      <div class="mb-3 flex items-center justify-between">
        <USelect
          v-model="pageSizeStr"
          :items="pageSizeOptions"
          class="w-36"
        />
        <div class="flex items-center gap-2">
          <UButton size="sm" icon="i-lucide-download" :loading="syncing" @click="syncProducts">
            Load Products
          </UButton>
          <UButton size="sm" variant="soft" icon="i-lucide-search" :loading="findingCompetitors" @click="findCompetitors">
            Find Competitor
          </UButton>
        </div>
      </div>

      <UCard>
        <div class="overflow-x-auto rounded-lg border border-default/50">
          <table class="min-w-max table-fixed text-sm">
            <colgroup>
              <col :style="`width: ${colWidths.thumbnail}px`" />
              <col :style="`width: ${colWidths.title}px`" />
              <col :style="`width: ${colWidths.price}px`" />
              <col :style="`width: ${colWidths.inventory}px`" />
              <col :style="`width: ${colWidths.inventoryAlert}px`" />
              <col :style="`width: ${colWidths.status}px`" />
              <col :style="`width: ${colWidths.sales7d}px`" />
              <col :style="`width: ${colWidths.sales30d}px`" />
              <col :style="`width: ${colWidths.sales90d}px`" />
              <col :style="`width: ${colWidths.avgCompetitor}px`" />
            </colgroup>
            <thead>
              <tr class="border-b border-default/50 bg-default/20">
                <th class="w-[60px] p-0" />
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  <button class="flex cursor-pointer items-center gap-1 hover:text-highlighted" @click="toggleSort('title')">
                    Product Name
                    <UIcon v-if="sortKey === 'title'" :name="sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="h-3 w-3" />
                    <UIcon v-else name="i-lucide-arrow-up-down" class="h-3 w-3 opacity-40" />
                  </button>
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'title')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  <button class="flex w-full cursor-pointer items-center justify-end gap-1 hover:text-highlighted" @click="toggleSort('price')">
                    <UIcon v-if="sortKey === 'price'" :name="sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="h-3 w-3" />
                    <UIcon v-else name="i-lucide-arrow-up-down" class="h-3 w-3 opacity-40" />
                    Price
                  </button>
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'price')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  <button class="flex w-full cursor-pointer items-center justify-end gap-1 hover:text-highlighted" @click="toggleSort('inventoryQuantity')">
                    <UIcon v-if="sortKey === 'inventoryQuantity'" :name="sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="h-3 w-3" />
                    <UIcon v-else name="i-lucide-arrow-up-down" class="h-3 w-3 opacity-40" />
                    Inventory
                  </button>
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'inventory')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-center font-medium text-toned">
                  Inventory Alert
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'inventoryAlert')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Status
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'status')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  <button class="flex w-full cursor-pointer items-center justify-end gap-1 hover:text-highlighted" @click="toggleSort('sold7d')">
                    <UIcon v-if="sortKey === 'sold7d'" :name="sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="h-3 w-3" />
                    <UIcon v-else name="i-lucide-arrow-up-down" class="h-3 w-3 opacity-40" />
                    7d Sales
                  </button>
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'sales7d')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  <button class="flex w-full cursor-pointer items-center justify-end gap-1 hover:text-highlighted" @click="toggleSort('sold30d')">
                    <UIcon v-if="sortKey === 'sold30d'" :name="sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="h-3 w-3" />
                    <UIcon v-else name="i-lucide-arrow-up-down" class="h-3 w-3 opacity-40" />
                    30d Sales
                  </button>
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'sales30d')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  <button class="flex w-full cursor-pointer items-center justify-end gap-1 hover:text-highlighted" @click="toggleSort('sold90d')">
                    <UIcon v-if="sortKey === 'sold90d'" :name="sortDir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="h-3 w-3" />
                    <UIcon v-else name="i-lucide-arrow-up-down" class="h-3 w-3 opacity-40" />
                    90d Sales
                  </button>
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'sales90d')" />
                </th>
                <th class="px-3 py-2 text-right font-medium text-toned">
                  Avg Competitor
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in paginated"
                :key="p.id"
                class="border-b border-default/30 last:border-0 hover:bg-default/10"
              >
                <td class="w-[60px] p-0">
                  <NuxtLink :to="`/products/${p.id}`" class="block">
                    <img
                      v-if="p.thumbnail"
                      :src="p.thumbnail"
                      :alt="p.title ?? ''"
                      class="h-[60px] w-[60px] rounded object-cover"
                    />
                    <div v-else class="h-[60px] w-[60px] rounded bg-default/20" />
                  </NuxtLink>
                </td>
                <td class="px-3 py-2">
                  <NuxtLink
                    :to="`/products/${p.id}`"
                    class="block truncate font-medium text-gray-900 hover:underline"
                    :title="p.title ?? ''"
                  >
                    {{ p.title }}
                  </NuxtLink>
                </td>
                <td class="px-3 py-2 text-right">
                  <span v-if="p.price != null">${{ Number(p.price).toFixed(2) }}</span>
                  <span v-else class="text-gray-400">—</span>
                </td>
                <td class="px-3 py-2 text-right">
                  <span v-if="p.inventoryQuantity != null">{{ p.inventoryQuantity }}</span>
                  <span v-else class="text-gray-400">—</span>
                </td>
                <td class="px-3 py-2 text-center">
                  <UBadge v-if="inventoryAlert(p)" :color="inventoryAlert(p)!.color" variant="soft" size="sm">
                    {{ inventoryAlert(p)!.text }}
                  </UBadge>
                  <span v-else class="text-gray-400">—</span>
                </td>
                <td class="px-3 py-2">
                  <UBadge :color="statusColor(p.status)" variant="soft" size="sm">
                    {{ p.status }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-right font-mono text-sm text-gray-600">
                  {{ fmtSales(p.sold7d, p.revenue7d) }}
                </td>
                <td class="px-3 py-2 text-right font-mono text-sm text-gray-600">
                  {{ fmtSales(p.sold30d, p.revenue30d) }}
                </td>
                <td class="px-3 py-2 text-right font-mono text-sm text-gray-600">
                  {{ fmtSales(p.sold90d, p.revenue90d) }}
                </td>
                <td class="px-3 py-2 text-right font-mono text-sm">
                  <template v-if="p.avgCompetitorPrice != null">
                    <span :class="p.avgCompetitorPrice < (p.price ?? Infinity) ? 'text-red-500' : 'text-green-600'">
                      ${{ p.avgCompetitorPrice.toFixed(2) }}
                    </span>
                    <span class="ml-1 text-xs text-gray-400">({{ p.confirmedCompetitorCount }})</span>
                  </template>
                  <span v-else class="text-gray-400">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="filtered.length > pageSize" class="mt-4 flex justify-center">
          <UPagination v-model:page="page" :total="filtered.length" :items-per-page="pageSize" />
        </div>

      </UCard>
    </template>
  </div>
</template>
