<script setup lang="ts">
import type { CompetitorItem, CompetitorsByProductResponse } from '~/shared/types/competitor'
import type { ProductSalesHistoryResponse } from '~/shared/types/order'
import type { ProductRow } from '~/shared/types/product'
import type { GetLatestAiReportResponse, GenerateAiReportResponse, ProductAiReport } from '~/shared/types/ai-report'


const route = useRoute()

const { data, pending } = await useFetch<{ item: ProductRow }>(
  `/api/products/${route.params.id}`,
  { lazy: true }
)

const { data: competitorsData, pending: competitorsPending, refresh: refreshCompetitors } =
  await useFetch<CompetitorsByProductResponse>(
    `/api/products/${route.params.id}/competitors`,
    { lazy: true }
  )

const salesPage = ref(1)
const salesPageSize = 20
const salesUrl = computed(() =>
  `/api/products/${route.params.id}/sales?page=${salesPage.value}&limit=${salesPageSize}`
)
const { data: salesData, pending: salesPending } = await useFetch<ProductSalesHistoryResponse>(
  salesUrl,
  { lazy: true, watch: [salesUrl] }
)

const product = computed(() => data.value?.item ?? null)

// Stable display list — sorted once on load/search, then mutated in-place for confirm/delete
const displayCompetitors = ref<CompetitorItem[]>([])
watch(competitorsData, (val) => {
  displayCompetitors.value = [...(val?.items ?? [])].sort((a, b) => {
    if (a.status === 'confirmed' && b.status !== 'confirmed') return -1
    if (a.status !== 'confirmed' && b.status === 'confirmed') return 1
    return 0
  })
}, { immediate: true })

const confirmedCompetitors = computed(() => displayCompetitors.value.filter(c => c.status === 'confirmed'))

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
const toast = useToast()

async function searchCompetitors() {
  searching.value = true
  searchError.value = null
  try {
    const result = await $fetch<{ submitted: number }>(`/api/products/${route.params.id}/competitors/search`, { method: 'POST' })
    if (result.submitted > 0) {
      toast.add({ title: 'Competitor search submitted', description: 'Results will appear shortly — refresh to check.', color: 'success' })
    } else {
      toast.add({ title: 'No search submitted', description: 'Product has no title to search with.', color: 'warning' })
    }
  } catch (e: unknown) {
    const err = e as { data?: { error?: { message?: string }; message?: string } }
    searchError.value = err?.data?.error?.message ?? err?.data?.message ?? 'Search failed'
  } finally {
    searching.value = false
  }
}

// Per-row actions
const actioningId = ref<number | null>(null)

async function confirmCompetitor(id: number) {
  actioningId.value = id
  try {
    await $fetch(`/api/products/${route.params.id}/competitors/${id}`, {
      method: 'PATCH',
      body: { status: 'confirmed' }
    })
    const item = displayCompetitors.value.find(c => c.id === id)
    if (item) item.status = 'confirmed'
  } finally {
    actioningId.value = null
  }
}

async function deleteCompetitor(id: number) {
  actioningId.value = id
  try {
    await $fetch(`/api/products/${route.params.id}/competitors/${id}`, { method: 'DELETE' })
    displayCompetitors.value = displayCompetitors.value.filter(c => c.id !== id)
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

// Decision Summary
const tabItems = [
  { label: 'Overview', value: 'overview', slot: 'overview' },
  { label: 'Competition', value: 'competition', slot: 'competition' },
  { label: 'Sales', value: 'sales', slot: 'sales' },
  { label: 'AI Insights', value: 'ai', slot: 'ai' },
  { label: 'Product Details', value: 'details', slot: 'details' }
]

const marketMedian = computed(() => median(chartPrices.value))

const closestCompetitor = computed(() => {
  const ourPrice = product.value?.price != null ? Number(product.value.price) : null
  if (ourPrice == null) return null
  let best: { title: string; diff: number } | null = null
  for (const c of confirmedCompetitors.value) {
    if (c.extractedPrice == null) continue
    const diff = ourPrice - c.extractedPrice
    if (!best || Math.abs(diff) < Math.abs(best.diff)) {
      best = { title: c.title, diff }
    }
  }
  return best
})

function statusColor(status: string) {
  if (status === 'active') return 'success' as const
  if (status === 'archived') return 'error' as const
  return 'neutral' as const
}

function financialColor(status: string | null) {
  if (status === 'paid') return 'success' as const
  if (status === 'refunded' || status === 'voided') return 'error' as const
  if (status === 'pending') return 'warning' as const
  return 'neutral' as const
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatCapturedAt(val: string | null): string {
  if (!val) return '—'
  const d = new Date(val)
  return d.toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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

// Column resizing
const colWidths = reactive({
  thumbnail: 60,
  product: 500,
  store: 150,
  status: 95,
  currency: 65,
  country: 55,
  shipping: 130,
  price: 110,
  diff: 75,
  updated: 130,
  actions: 72,
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

onMounted(() => {
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
})

// AI Report
const { data: aiReportData } = await useFetch<GetLatestAiReportResponse>(
  `/api/products/${route.params.id}/reports/ai/latest`,
  { lazy: true }
)

const aiReport = computed<ProductAiReport | null>(() => aiReportData.value?.report ?? null)
const aiGenerating = ref(false)
const aiError = ref<string | null>(null)

async function generateAiReport() {
  aiGenerating.value = true
  aiError.value = null
  try {
    const result = await $fetch<GenerateAiReportResponse>(
      `/api/products/${route.params.id}/reports/ai`,
      { method: 'POST' }
    )
    aiReportData.value = { productId: result.productId, report: result.report }
  } catch (e: unknown) {
    aiError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Report generation failed'
  } finally {
    aiGenerating.value = false
  }
}

function fmtAiDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function confidenceColor(confidence: string) {
  if (confidence === 'high') return 'success' as const
  if (confidence === 'medium') return 'warning' as const
  return 'neutral' as const
}

function pricingRecommendationColor(rec: string) {
  if (rec === 'INCREASE_PRICE') return 'success' as const
  if (rec === 'DECREASE_PRICE') return 'error' as const
  if (rec === 'HOLD_PRICE') return 'primary' as const
  return 'neutral' as const
}

function trendColor(trend: string) {
  if (trend === 'GROWING') return 'success' as const
  if (trend === 'SLOWING') return 'error' as const
  if (trend === 'STABLE') return 'primary' as const
  return 'neutral' as const
}

function matchTypeColor(matchType: string) {
  if (matchType === 'DIRECT_MATCH') return 'success' as const
  if (matchType === 'SIMILAR_PRODUCT') return 'primary' as const
  if (matchType === 'WEAK_MATCH') return 'warning' as const
  if (matchType === 'REJECTED') return 'error' as const
  return 'neutral' as const
}
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-10">
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

      <UTabs :items="tabItems" default-value="overview" class="mb-6">
        <template #overview>
          <ProductDecisionSummary
            :product="product"
            :sales-summary="salesData?.summary ?? null"
            :market-median="marketMedian"
            :confirmed-count="confirmedCompetitors.length"
            :total-competitors="displayCompetitors.length"
            :closest-competitor="closestCompetitor"
            :pricing="aiReport?.output?.pricing ?? null"
            :sales-trend="aiReport?.output?.salesTrend ?? null"
            :has-ai-report="!!aiReport"
          />
        </template>

        <template #competition>
      <!-- Competitors -->
      <UCard class="mb-6">
        <template #header>
          <span>Competitor Products</span>
        </template>

        <!-- Loading -->
        <div v-if="competitorsPending" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
        </div>

        <div v-else-if="!displayCompetitors.length" class="py-6 text-center text-sm text-toned">
          No competitors found — click Find Competitors to search.
        </div>

        <!-- Unified competitors table -->
        <div v-else class="overflow-x-auto rounded-lg border border-default/50">
          <table class="table-fixed text-sm">
            <colgroup>
              <col :style="`width: ${colWidths.thumbnail}px`" />
              <col :style="`width: ${colWidths.product}px`" />
              <col :style="`width: ${colWidths.store}px`" />
              <col :style="`width: ${colWidths.status}px`" />
              <col :style="`width: ${colWidths.currency}px`" />
              <col :style="`width: ${colWidths.country}px`" />
              <col :style="`width: ${colWidths.shipping}px`" />
              <col :style="`width: ${colWidths.price}px`" />
              <col :style="`width: ${colWidths.diff}px`" />
              <col :style="`width: ${colWidths.updated}px`" />
              <col :style="`width: ${colWidths.actions}px`" />
            </colgroup>
            <thead>
              <tr class="border-b border-default/50 bg-default/20">
                <th class="p-0" />
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Product
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'product')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Store
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'store')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Status
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'status')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Currency
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'currency')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Country
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'country')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Shipping
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'shipping')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  Price
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'price')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-right font-medium text-toned">
                  Diff
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'diff')" />
                </th>
                <th class="relative border-r border-default/30 px-3 py-2 text-left font-medium text-toned">
                  Last Updated
                  <div class="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-primary-400/40" @mousedown.prevent="startResize($event, 'updated')" />
                </th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in displayCompetitors"
                :key="c.id"
                class="border-b border-default/30 last:border-0"
              >
                <td class="p-0">
                  <img
                    v-if="c.thumbnail"
                    :src="c.thumbnail"
                    :alt="c.title"
                    class="h-[60px] w-auto rounded"
                  />
                  <div v-else class="h-[60px] w-[60px] rounded bg-default/20" />
                </td>
                <td class="px-3 py-2">
                  <div class="flex min-w-0 flex-wrap items-start gap-2">
                    <a
                      :href="c.productLink"
                      :title="c.title"
                      target="_blank"
                      rel="noopener"
                      class="break-words text-primary-600 hover:underline"
                      @click.stop
                    >
                      {{ c.title }}
                    </a>
                    <UBadge v-if="c.tag" size="xs" color="neutral" variant="soft" class="shrink-0">
                      {{ c.tag }}
                    </UBadge>
                  </div>
                </td>
                <td class="break-words px-3 py-2 text-toned">{{ c.source }}</td>
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
                <td class="break-words px-3 py-2 text-toned">{{ c.shippingRaw || '—' }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span class="font-medium text-highlighted">
                    {{ formatCurrencyRaw(c.extractedPrice, c.rawPrice, c.currency) }}
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
                <td class="whitespace-nowrap px-3 py-2 text-xs text-toned">{{ formatCapturedAt(c.capturedAt) }}</td>
                <td class="px-2 py-2 text-right">
                  <div class="flex items-center justify-end gap-3">
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

        <!-- Price position (confirmed only) -->
        <div v-if="chartPrices.length >= 1" class="mt-4 rounded-lg border border-default/50 bg-default/5 p-4">
          <p class="mb-1 text-xs font-medium text-toned">Price Position</p>
          <PricePositionBar :prices="chartPrices" :our-price="product.price" :currency="product.currency" />
        </div>
      </UCard>
        </template>

        <template #ai>
      <!-- AI Insights -->
      <UCard class="mb-6">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span>AI Insights</span>
            <div class="flex items-center gap-2">
              <span v-if="aiReport?.completedAt" class="text-xs text-toned">
                Generated {{ fmtAiDate(aiReport.completedAt) }}
              </span>
              <UButton
                size="xs"
                :variant="aiReport ? 'soft' : 'solid'"
                color="primary"
                icon="i-lucide-sparkles"
                :loading="aiGenerating"
                :disabled="aiGenerating"
                @click="generateAiReport"
              >
                {{ aiReport ? 'Refresh AI Report' : 'Generate AI Report' }}
              </UButton>
            </div>
          </div>
        </template>

        <p v-if="aiError" class="mb-3 text-sm text-error-600">{{ aiError }}</p>

        <!-- Empty state -->
        <div v-if="!aiReport && !aiGenerating" class="py-8 text-center text-sm text-toned">
          No AI report has been generated for this product yet. Click <strong>Generate AI Report</strong> to analyse
          pricing, competitors, sales trend, and listing quality.
        </div>

        <!-- Failed state -->
        <div v-else-if="aiReport?.status === 'failed'" class="py-6 text-center text-sm text-error-600">
          Report generation failed: {{ aiReport.errorMessage ?? 'Unknown error' }}
        </div>

        <!-- Report output -->
        <div v-else-if="aiReport?.output" class="space-y-5">

          <!-- Pricing Recommendation -->
          <div v-if="aiReport.output.pricing" class="rounded-lg border border-default/50 p-4">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-highlighted">Pricing Recommendation</h3>
              <UBadge :color="pricingRecommendationColor(aiReport.output.pricing.recommendation)" variant="soft" size="sm">
                {{ aiReport.output.pricing.recommendation.replace(/_/g, ' ') }}
              </UBadge>
              <UBadge :color="confidenceColor(aiReport.output.pricing.confidence)" variant="outline" size="sm">
                {{ aiReport.output.pricing.confidence }} confidence
              </UBadge>
            </div>
            <p class="mb-2 text-sm text-highlighted">{{ aiReport.output.pricing.summary }}</p>
            <p class="mb-1 text-xs font-medium text-toned">Action</p>
            <p class="mb-2 text-sm text-highlighted">{{ aiReport.output.pricing.action }}</p>
            <div v-if="aiReport.output.pricing.reasoning.length" class="mb-2">
              <p class="mb-1 text-xs font-medium text-toned">Reasoning</p>
              <ul class="list-inside list-disc space-y-0.5 text-sm text-highlighted">
                <li v-for="r in aiReport.output.pricing.reasoning" :key="r">{{ r }}</li>
              </ul>
            </div>
            <div v-if="aiReport.output.pricing.risks.length">
              <p class="mb-1 text-xs font-medium text-toned">Risks</p>
              <ul class="list-inside list-disc space-y-0.5 text-sm text-error-600">
                <li v-for="r in aiReport.output.pricing.risks" :key="r">{{ r }}</li>
              </ul>
            </div>
          </div>

          <!-- Sales Trend -->
          <div v-if="aiReport.output.salesTrend" class="rounded-lg border border-default/50 p-4">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-highlighted">Sales Trend</h3>
              <UBadge :color="trendColor(aiReport.output.salesTrend.trend)" variant="soft" size="sm">
                {{ aiReport.output.salesTrend.trend.replace(/_/g, ' ') }}
              </UBadge>
              <UBadge :color="confidenceColor(aiReport.output.salesTrend.confidence)" variant="outline" size="sm">
                {{ aiReport.output.salesTrend.confidence }} confidence
              </UBadge>
            </div>
            <p class="mb-2 text-sm text-highlighted">{{ aiReport.output.salesTrend.summary }}</p>
            <p class="mb-2 text-sm text-highlighted">{{ aiReport.output.salesTrend.recentPerformance }}</p>
            <div v-if="aiReport.output.salesTrend.insights.length" class="mb-2">
              <p class="mb-1 text-xs font-medium text-toned">Insights</p>
              <ul class="list-inside list-disc space-y-0.5 text-sm text-highlighted">
                <li v-for="i in aiReport.output.salesTrend.insights" :key="i">{{ i }}</li>
              </ul>
            </div>
            <p v-if="aiReport.output.salesTrend.action" class="text-sm text-highlighted">
              <span class="font-medium text-toned">Action: </span>{{ aiReport.output.salesTrend.action }}
            </p>
          </div>

          <!-- Competitor Match Quality -->
          <div v-if="aiReport.output.competitorMatch" class="rounded-lg border border-default/50 p-4">
            <h3 class="mb-2 text-sm font-semibold text-highlighted">Competitor Match Quality</h3>
            <p class="mb-3 text-sm text-highlighted">{{ aiReport.output.competitorMatch.summary }}</p>
            <div v-if="aiReport.output.competitorMatch.competitors.length" class="mb-3 space-y-2">
              <div
                v-for="c in aiReport.output.competitorMatch.competitors"
                :key="String(c.competitorProductId)"
                class="flex flex-wrap items-start gap-2 text-sm"
              >
                <UBadge :color="matchTypeColor(c.matchType)" variant="soft" size="sm">
                  {{ c.matchType.replace(/_/g, ' ') }}
                </UBadge>
                <span class="text-toned">Score: {{ c.matchScore }}/100</span>
                <span v-if="c.warning" class="text-warning-600">⚠ {{ c.warning }}</span>
                <span class="text-highlighted">{{ c.reasons.join(' · ') }}</span>
              </div>
            </div>
            <div v-if="aiReport.output.competitorMatch.recommendedActions.length">
              <p class="mb-1 text-xs font-medium text-toned">Recommended Actions</p>
              <ul class="list-inside list-disc space-y-0.5 text-sm text-highlighted">
                <li v-for="a in aiReport.output.competitorMatch.recommendedActions" :key="a">{{ a }}</li>
              </ul>
            </div>
          </div>

          <!-- Listing Improvement -->
          <div v-if="aiReport.output.listingImprovement" class="rounded-lg border border-default/50 p-4">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-highlighted">Listing Improvement</h3>
              <span class="text-sm text-toned">
                Score: <strong class="text-highlighted">{{ aiReport.output.listingImprovement.listingScore }}/100</strong>
              </span>
            </div>
            <p class="mb-3 text-sm text-highlighted">{{ aiReport.output.listingImprovement.summary }}</p>
            <div v-if="aiReport.output.listingImprovement.mainIssues.length" class="mb-3">
              <p class="mb-1 text-xs font-medium text-toned">Main Issues</p>
              <ul class="list-inside list-disc space-y-0.5 text-sm text-error-600">
                <li v-for="i in aiReport.output.listingImprovement.mainIssues" :key="i">{{ i }}</li>
              </ul>
            </div>
            <div class="mb-3">
              <p class="mb-1 text-xs font-medium text-toned">Improved Title</p>
              <p class="text-sm text-highlighted">{{ aiReport.output.listingImprovement.improvedTitle }}</p>
            </div>
            <div v-if="aiReport.output.listingImprovement.improvedBulletPoints.length" class="mb-3">
              <p class="mb-1 text-xs font-medium text-toned">Bullet Points</p>
              <ul class="list-inside list-disc space-y-0.5 text-sm text-highlighted">
                <li v-for="b in aiReport.output.listingImprovement.improvedBulletPoints" :key="b">{{ b }}</li>
              </ul>
            </div>
            <div v-if="aiReport.output.listingImprovement.seoKeywords.length">
              <p class="mb-1 text-xs font-medium text-toned">SEO Keywords</p>
              <div class="flex flex-wrap gap-1">
                <UBadge v-for="k in aiReport.output.listingImprovement.seoKeywords" :key="k" color="neutral" variant="soft" size="xs">
                  {{ k }}
                </UBadge>
              </div>
            </div>
          </div>

        </div>
      </UCard>
        </template>

        <template #sales>
      <!-- Sales History -->
      <UCard class="mb-6">
        <template #header>Sales History</template>

        <div v-if="salesPending" class="space-y-3">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <USkeleton v-for="i in 4" :key="i" class="h-20 rounded-lg" />
          </div>
          <USkeleton class="h-44 w-full rounded-lg" />
          <USkeleton class="h-48 w-full rounded-lg" />
        </div>

        <template v-else-if="salesData">
          <!-- Summary cards -->
          <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-lg border border-default/50 bg-default/5 p-3">
              <p class="text-xs text-toned">Total Sold</p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">{{ salesData.summary.totalQty }}</p>
              <p class="text-xs text-toned">units all-time</p>
            </div>
            <div class="rounded-lg border border-default/50 bg-default/5 p-3">
              <p class="text-xs text-toned">Total Revenue</p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">${{ Math.round(salesData.summary.totalRevenue).toLocaleString() }}</p>
              <p class="text-xs text-toned">all-time</p>
            </div>
            <div class="rounded-lg border border-default/50 bg-default/5 p-3">
              <p class="text-xs text-toned">Orders</p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">{{ salesData.summary.orderCount }}</p>
              <p class="text-xs text-toned">containing this product</p>
            </div>
            <div class="rounded-lg border border-default/50 bg-default/5 p-3">
              <p class="text-xs text-toned">Last Sale</p>
              <p class="mt-1 text-lg font-semibold text-highlighted">{{ fmtDate(salesData.summary.lastSoldAt) }}</p>
              <p v-if="salesData.summary.avgUnitPrice" class="text-xs text-toned">
                avg ${{ Number(salesData.summary.avgUnitPrice).toFixed(2) }}
              </p>
            </div>
          </div>

          <!-- Period stats -->
          <div class="mb-4 flex flex-wrap gap-6 rounded-lg border border-default/50 bg-default/5 px-4 py-3 text-sm">
            <div>
              <span class="text-toned">7d:</span>
              <span class="ml-1 font-medium text-highlighted">{{ salesData.summary.sold7d }} units</span>
              <span class="ml-1 text-toned">(${{ Math.round(salesData.summary.revenue7d).toLocaleString() }})</span>
            </div>
            <div>
              <span class="text-toned">30d:</span>
              <span class="ml-1 font-medium text-highlighted">{{ salesData.summary.sold30d }} units</span>
              <span class="ml-1 text-toned">(${{ Math.round(salesData.summary.revenue30d).toLocaleString() }})</span>
            </div>
            <div>
              <span class="text-toned">90d:</span>
              <span class="ml-1 font-medium text-highlighted">{{ salesData.summary.sold90d }} units</span>
              <span class="ml-1 text-toned">(${{ Math.round(salesData.summary.revenue90d).toLocaleString() }})</span>
            </div>
          </div>

          <!-- Monthly chart -->
          <div v-if="salesData.monthly.length" class="mb-4">
            <p class="mb-1 text-xs font-medium text-toned">Units Sold — Last 12 Months</p>
            <div class="rounded-lg border border-default/50 bg-default/5 p-3">
              <SalesBarChart :monthly="salesData.monthly" />
            </div>
          </div>

          <!-- Line items table -->
          <div v-if="salesData.total > 0" class="rounded-lg border border-default/50">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-default/50 bg-default/20">
                    <th class="px-3 py-2 text-left font-medium text-toned">Date</th>
                    <th class="px-3 py-2 text-left font-medium text-toned">Order</th>
                    <th class="px-3 py-2 text-left font-medium text-toned">Customer</th>
                    <th class="px-3 py-2 text-right font-medium text-toned">Qty</th>
                    <th class="px-3 py-2 text-right font-medium text-toned">Unit Price</th>
                    <th class="px-3 py-2 text-right font-medium text-toned">Line Total</th>
                    <th class="px-3 py-2 text-left font-medium text-toned">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in salesData.items"
                    :key="`${item.orderId}-${item.qty}`"
                    class="border-b border-default/30 last:border-0 hover:bg-default/10"
                  >
                    <td class="whitespace-nowrap px-3 py-2 text-xs text-toned">{{ fmtDate(item.processedAt) }}</td>
                    <td class="px-3 py-2">
                      <NuxtLink :to="`/orders/${item.orderId}`" class="font-mono text-primary-600 hover:underline">
                        {{ item.orderNumber }}
                      </NuxtLink>
                    </td>
                    <td class="px-3 py-2 text-toned">
                      {{ [item.customerFirstName, item.customerLastName].filter(Boolean).join(' ') || '—' }}
                    </td>
                    <td class="px-3 py-2 text-right font-medium">{{ item.qty }}</td>
                    <td class="px-3 py-2 text-right">
                      {{ item.unitPrice != null ? `$${Number(item.unitPrice).toFixed(2)}` : '—' }}
                    </td>
                    <td class="px-3 py-2 text-right font-medium">
                      ${{ Number(item.lineTotal).toFixed(2) }}
                    </td>
                    <td class="px-3 py-2">
                      <UBadge :color="financialColor(item.financialStatus)" variant="soft" size="xs">
                        {{ item.financialStatus || '—' }}
                      </UBadge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="flex items-center justify-between border-t border-default/30 px-3 py-2">
              <p class="text-xs text-toned">{{ salesData.total }} total line items</p>
              <UPagination
                v-if="salesData.total > salesPageSize"
                v-model:page="salesPage"
                :total="salesData.total"
                :items-per-page="salesPageSize"
              />
            </div>
          </div>
          <div v-else class="py-6 text-center text-sm text-toned">No sales recorded for this product.</div>
        </template>

        <div v-else class="py-6 text-center text-sm text-toned">No sales data available.</div>
      </UCard>
        </template>

        <template #details>
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
      </UTabs>
    </template>
  </div>
</template>
