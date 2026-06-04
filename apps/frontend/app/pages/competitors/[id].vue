<script setup lang="ts">
import type { CompetitorDetailResponse, CompetitorProductTableRow } from '~/shared/types/competitor'


const route = useRoute()

const { data, pending } = await useFetch<CompetitorDetailResponse>(
  `/api/competitors/${route.params.id}/products`,
  { lazy: true }
)

const competitorName = computed(() => data.value?.competitor.name ?? 'Competitor')

const rows = computed<CompetitorProductTableRow[]>(() =>
  (data.value?.items ?? []).map(item => ({
    id: String(item.id),
    thumbnail: item.thumbnail,
    title: item.title,
    productLink: item.productLink,
    source: item.source,
    googlePosition: item.googlePosition,
    currency: item.currency ?? 'NZD',
    currentPrice: item.currentPrice,
    lastCheckedAt: item.lastCheckedAt,
    matchedProduct: item.matchedProductId != null
      ? { id: String(item.matchedProductId), title: item.matchedProductTitle ?? '' }
      : null
  }))
)

const columns = [
  { id: 'thumbnail', header: '' },
  { accessorKey: 'title', header: 'Product' },
  { accessorKey: 'source', header: 'Source' },
  { accessorKey: 'googlePosition', header: 'Google Position' },
  { accessorKey: 'currentPrice', header: 'Current Price' },
  { accessorKey: 'lastCheckedAt', header: 'Last Checked' },
  { id: 'matchedProduct', header: 'Matched Product' }
]

const sourceColor = (source: string) => {
  const map: Record<string, string> = {
    'google-shopping': 'primary',
    'serpapi': 'info',
    'manual': 'neutral',
    'scraper': 'warning'
  }
  return map[source] ?? 'neutral'
}

const formatPrice = (price: number | null, currency: string): string => {
  if (price == null) return '—'
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: currency || 'NZD',
    minimumFractionDigits: 2
  }).format(price)
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
  const date = d.toLocaleDateString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  return `${time.toUpperCase()} ${date}`
}
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-6">
    <div class="mb-4 flex items-center gap-3">
      <UButton variant="ghost" color="neutral" icon="i-lucide-arrow-left" @click="navigateTo('/competitors')" />
      <h1 class="text-lg font-semibold text-gray-900">{{ competitorName }}</h1>
    </div>

    <UCard>
      <div v-if="pending" class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin text-gray-400" />
      </div>

      <div v-else-if="!rows.length" class="py-16 text-center">
        <p class="text-sm font-semibold text-highlighted">No competitor products saved yet.</p>
        <p class="mt-1 text-sm text-toned">Products found from searches or manual matching will appear here.</p>
      </div>

      <UTable v-else :data="rows" :columns="columns">
        <template #thumbnail-cell="{ row }">
          <img
            v-if="row.original.thumbnail"
            :src="row.original.thumbnail"
            :alt="row.original.title"
            class="h-[60px] w-[60px] rounded object-cover"
          />
          <div v-else class="h-[60px] w-[60px] rounded bg-gray-100" />
        </template>

        <template #title-cell="{ row }">
          <div class="flex min-w-0 max-w-[260px] flex-col gap-0.5">
            <span class="truncate font-medium text-gray-900" :title="row.original.title">
              {{ row.original.title }}
            </span>
            <a
              :href="row.original.productLink"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1 text-xs text-primary-600 hover:underline"
              @click.stop
            >
              <UIcon name="i-lucide-external-link" class="h-3 w-3 shrink-0" />
              View listing
            </a>
          </div>
        </template>

        <template #source-cell="{ row }">
          <UBadge :color="sourceColor(row.original.source)" variant="soft" size="sm">
            {{ row.original.source }}
          </UBadge>
        </template>

        <template #googlePosition-cell="{ row }">
          <span v-if="row.original.googlePosition != null" class="font-mono text-sm text-gray-700">
            #{{ row.original.googlePosition }}
          </span>
          <span v-else class="text-gray-400">—</span>
        </template>

        <template #currentPrice-cell="{ row }">
          <span class="font-medium text-gray-900">
            {{ formatPrice(row.original.currentPrice, row.original.currency) }}
          </span>
        </template>

        <template #lastCheckedAt-cell="{ row }">
          <span class="whitespace-nowrap text-sm text-gray-500">
            {{ formatDateTime(row.original.lastCheckedAt) }}
          </span>
        </template>

        <template #matchedProduct-cell="{ row }">
          <span v-if="row.original.matchedProduct" class="text-sm text-gray-700">
            {{ row.original.matchedProduct.title }}
          </span>
          <span v-else class="text-sm text-gray-400">Unmatched</span>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
