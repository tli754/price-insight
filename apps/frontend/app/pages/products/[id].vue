<script setup lang="ts">
import type { CompetitorsByProductResponse } from '~/shared/types/competitor'
import type { ProductRow } from '~/shared/types/product'

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { data, pending } = await useFetch<{ item: ProductRow }>(
  `${apiUrl}/api/products/${route.params.id}`,
  { lazy: true }
)

const { data: competitorsData, pending: competitorsPending, refresh: refreshCompetitors } =
  await useFetch<CompetitorsByProductResponse>(
    `${apiUrl}/api/products/${route.params.id}/competitors`,
    { lazy: true }
  )

const product = computed(() => data.value?.item ?? null)
const allCompetitors = computed(() => {
  const items = competitorsData.value?.items ?? []
  return [...items].sort((a, b) => {
    if (a.status === 'confirmed' && b.status !== 'confirmed') return -1
    if (a.status !== 'confirmed' && b.status === 'confirmed') return 1
    return 0
  })
})
const suggestedCompetitors = computed(() => allCompetitors.value.filter(c => c.status === 'suggested'))
const confirmedCompetitors = computed(() => allCompetitors.value.filter(c => c.status === 'confirmed'))

// Image gallery
const selectedImageIndex = ref(0)
const images = computed(() => product.value?.images ?? [])
const activeImage = computed(() =>
  images.value[selectedImageIndex.value]?.src ?? product.value?.thumbnail ?? null
)
const activeImageAlt = computed(() =>
  images.value[selectedImageIndex.value]?.alt ?? product.value?.title ?? ''
)
watch(product, () => { selectedImageIndex.value = 0 })

// Search
const searching = ref(false)
const searchError = ref<string | null>(null)

async function searchCompetitors() {
  searching.value = true
  searchError.value = null
  try {
    await $fetch(`${apiUrl}/api/products/${route.params.id}/competitors/search`, { method: 'POST' })
    await refreshCompetitors()
  } catch (e: unknown) {
    searchError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Search failed'
  } finally {
    searching.value = false
  }
}

// Per-row actions
const actioningId = ref<number | null>(null)

async function confirmCompetitor(id: number) {
  actioningId.value = id
  try {
    await $fetch(`${apiUrl}/api/products/${route.params.id}/competitors/${id}`, {
      method: 'PATCH',
      body: { status: 'confirmed' }
    })
    await refreshCompetitors()
  } finally {
    actioningId.value = null
  }
}

async function deleteCompetitor(id: number) {
  actioningId.value = id
  try {
    await $fetch(`${apiUrl}/api/products/${route.params.id}/competitors/${id}`, { method: 'DELETE' })
    await refreshCompetitors()
  } finally {
    actioningId.value = null
  }
}

// Chart data from confirmed competitors
const chartPrices = computed(() =>
  confirmedCompetitors.value
    .map(c => c.extractedPrice)
    .filter((p): p is number => p != null)
)
const chartLabels = computed(() =>
  confirmedCompetitors.value
    .filter(c => c.extractedPrice != null)
    .map(c => c.title)
)

function statusColor(status: string) {
  if (status === 'active') return 'success' as const
  if (status === 'archived') return 'error' as const
  return 'neutral' as const
}

function formatPrice(extracted: number | null, raw: string | null, currency: string | null) {
  if (raw) return raw
  if (extracted == null) return '—'
  return [currency, extracted].filter(Boolean).join(' ')
}

function priceDiff(competitorPrice: number | null): { label: string; color: string } | null {
  const ourPrice = product.value?.price
  if (ourPrice == null || competitorPrice == null) return null
  const diff = Number(ourPrice) - competitorPrice
  if (diff === 0) return null
  const sign = diff > 0 ? '+' : ''
  return {
    label: `${sign}${diff.toFixed(2)}`,
    color: diff > 0 ? 'text-red-500' : 'text-blue-500'
  }
}
</script>

<template>
  <div class="mx-auto max-w-[2000px] px-6 py-10">
    <template v-if="pending">
      <USkeleton class="mb-6 h-8 w-64" />
      <USkeleton class="mb-6 h-64 w-full rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-2">
        <USkeleton class="h-80 w-full rounded-xl" />
        <USkeleton class="h-80 w-full rounded-xl" />
      </div>
    </template>

    <div v-else-if="!product" class="py-20 text-center">
      <p class="text-sm font-medium text-highlighted">Product not found</p>
      <UButton class="mt-4" variant="soft" color="neutral" @click="navigateTo('/products')">
        Back to products
      </UButton>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="mb-6 flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <UButton variant="ghost" color="neutral" icon="i-lucide-arrow-left" @click="navigateTo('/products')" />
          <UBadge :color="statusColor(product.status)" variant="soft">
            {{ product.status }}
          </UBadge>
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">
            {{ product.title || 'Unnamed product' }}
          </h1>
        </div>
        <div class="flex flex-col items-end gap-1">
          <UButton
            variant="soft"
            color="primary"
            icon="i-lucide-search"
            :loading="searching || competitorsPending"
            @click="searchCompetitors"
          >
            Find Competitors
          </UButton>
          <p v-if="searchError" class="text-xs text-error-600">{{ searchError }}</p>
        </div>
      </div>

      <!-- Competitors — full width, at top -->
      <UCard class="mb-6">
        <template #header>
          <span>Competitors</span>
        </template>

        <!-- Loading -->
        <div v-if="competitorsPending" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
        </div>

        <div v-else-if="!allCompetitors.length" class="py-6 text-center text-sm text-toned">
          No competitors found — click Find Competitors to search.
        </div>

        <!-- Unified competitors table -->
        <div v-else class="overflow-hidden rounded-lg border border-default/50">
          <table class="w-full table-fixed text-sm">
            <thead>
              <tr class="border-b border-default/50 bg-default/20">
                <th class="w-[60px] p-0" />
                <th class="px-3 py-2 text-left font-medium text-toned">Product</th>
                <th class="w-[150px] px-3 py-2 text-left font-medium text-toned">Store</th>
                <th class="w-[95px] px-3 py-2 text-left font-medium text-toned">Status</th>
                <th class="w-[65px] px-3 py-2 text-left font-medium text-toned">Currency</th>
                <th class="w-[55px] px-3 py-2 text-left font-medium text-toned">Country</th>
                <th class="w-[130px] px-3 py-2 text-left font-medium text-toned">Shipping</th>
                <th class="w-[210px] px-3 py-2 text-left font-medium text-toned">Reviews</th>
                <th class="w-[110px] px-3 py-2 text-right font-medium text-toned">Price</th>
                <th class="w-[75px] px-3 py-2 text-right font-medium text-toned">Diff</th>
                <th class="w-[72px] px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in allCompetitors"
                :key="c.id"
                class="border-b border-default/30 last:border-0"
              >
                <td class="p-0">
                  <img
                    v-if="c.thumbnail"
                    :src="c.thumbnail"
                    :alt="c.title"
                    class="h-[60px] w-[60px] rounded object-cover"
                  />
                  <div v-else class="h-[60px] w-[60px] rounded bg-default/20" />
                </td>
                <td class="overflow-hidden px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <a
                      :href="c.productLink"
                      :title="c.title"
                      target="_blank"
                      rel="noopener"
                      class="min-w-0 truncate text-primary-600 hover:underline"
                      @click.stop
                    >
                      {{ c.title }}
                    </a>
                    <UBadge v-if="c.tag" size="xs" color="neutral" variant="soft" class="shrink-0">
                      {{ c.tag }}
                    </UBadge>
                  </div>
                </td>
                <td class="truncate px-3 py-2 text-toned" :title="c.source">{{ c.source }}</td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="c.status === 'confirmed' ? 'success' : 'warning'"
                    variant="soft"
                    size="sm"
                  >
                    {{ c.status }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-toned">{{ c.currency || '—' }}</td>
                <td class="px-3 py-2 text-toned">{{ c.country || '—' }}</td>
                <td class="truncate px-3 py-2 text-toned" :title="c.shippingRaw ?? undefined">{{ c.shippingRaw || '—' }}</td>
                <td class="px-3 py-2 text-xs text-toned">
                  <span v-if="c.rating != null && c.reviewCount != null">
                    {{ c.rating }} out of 5 stars from {{ c.reviewCount }} reviews
                  </span>
                  <span v-else-if="c.rating != null">{{ c.rating }} / 5</span>
                  <span v-else>—</span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span class="font-medium text-highlighted">
                    {{ formatPrice(c.extractedPrice, c.rawPrice, c.currency) }}
                  </span>
                  <span v-if="c.extractedOldPrice" class="ml-1 text-xs text-toned line-through">
                    {{ c.currency }} {{ Number(c.extractedOldPrice).toFixed(2) }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span v-if="priceDiff(c.extractedPrice)" :class="priceDiff(c.extractedPrice)!.color" class="font-medium">
                    {{ priceDiff(c.extractedPrice)!.label }}
                  </span>
                  <span v-else class="text-toned">—</span>
                </td>
                <td class="px-2 py-2 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <UButton
                      v-if="c.status === 'suggested'"
                      size="xs"
                      variant="soft"
                      color="primary"
                      icon="i-lucide-check"
                      :loading="actioningId === c.id"
                      @click="confirmCompetitor(c.id)"
                    />
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="error"
                      icon="i-lucide-trash-2"
                      :loading="actioningId === c.id"
                      @click="deleteCompetitor(c.id)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Price charts (confirmed only) -->
        <div v-if="chartPrices.length >= 2" class="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p class="mb-1 text-xs font-medium text-toned">Scatter Plot</p>
            <div class="rounded-lg border border-default/50 bg-default/5 p-2">
              <PriceScatterChart :prices="chartPrices" :labels="chartLabels" :our-price="product.price" />
            </div>
          </div>
          <div>
            <p class="mb-1 text-xs font-medium text-toned">Price Distribution</p>
            <div class="rounded-lg border border-default/50 bg-default/5 p-2">
              <PriceBoxChart :prices="chartPrices" :our-price="product.price" />
            </div>
          </div>
        </div>
      </UCard>

      <!-- Product info grid -->
      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Left: image gallery -->
        <div class="space-y-3">
          <div class="overflow-hidden rounded-xl border border-default/70 bg-white/85">
            <img
              v-if="activeImage"
              :src="activeImage"
              :alt="activeImageAlt"
              class="w-full object-contain p-4"
              style="max-height: 320px"
            />
            <div v-else class="flex h-64 items-center justify-center text-sm text-toned">
              No image
            </div>
          </div>

          <!-- Thumbnail strip -->
          <div v-if="images.length > 1" class="flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="(img, i) in images"
              :key="img.id"
              class="shrink-0 overflow-hidden rounded-lg border-2 transition-colors"
              :class="i === selectedImageIndex ? 'border-primary-500' : 'border-transparent hover:border-default'"
              @click="selectedImageIndex = i"
            >
              <img :src="img.src" :alt="img.alt" class="h-14 w-14 object-cover bg-white" />
            </button>
          </div>
        </div>

        <!-- Right: details -->
        <div class="space-y-4">
          <UCard>
            <template #header>Pricing</template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-toned">Price</dt>
                <dd class="font-medium text-highlighted">
                  <span v-if="product.price != null">
                    {{ product.currency ? `${product.currency} ` : '' }}{{ Number(product.price).toFixed(2) }}
                  </span>
                  <span v-else>—</span>
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Inventory</dt>
                <dd class="text-highlighted">{{ product.inventoryQuantity ?? '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>Details</template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-toned">SKU</dt>
                <dd class="font-mono text-highlighted">{{ product.sku || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Brand</dt>
                <dd class="text-highlighted">{{ product.brand || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Weight</dt>
                <dd class="text-highlighted">
                  <span v-if="product.weight != null">{{ product.weight }} {{ product.weightUnit }}</span>
                  <span v-else>—</span>
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Tags</dt>
                <dd class="text-highlighted">{{ product.tags || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Last updated</dt>
                <dd class="text-highlighted">{{ new Date(product.updatedAt).toLocaleString() }}</dd>
              </div>
            </dl>
          </UCard>
        </div>
      </div>

      <!-- Description -->
      <UCard class="mt-6">
        <template #header>Description</template>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="product.description" class="prose prose-sm max-w-none text-sm text-highlighted" v-html="product.description" />
        <p v-else class="text-sm text-toned">No description available.</p>
      </UCard>
    </template>
  </div>
</template>
