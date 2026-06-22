<script setup lang="ts">
import type { ProductRow } from '~/shared/types/product'
import type { ProductSalesSummary } from '~/shared/types/order'
import type { PricingRecommendationReport, SalesTrendSummaryReport } from '~/shared/types/ai-report'

interface ClosestCompetitor {
  title: string
  diff: number
}

interface Props {
  product: ProductRow
  salesSummary: ProductSalesSummary | null
  marketMedian: number | null
  confirmedCount: number
  totalCompetitors: number
  closestCompetitor: ClosestCompetitor | null
  pricing: PricingRecommendationReport | null
  salesTrend: SalesTrendSummaryReport | null
  hasAiReport: boolean
}

const props = defineProps<Props>()

const inventoryAlert = computed(() =>
  calcInventoryAlert(
    props.product.inventoryQuantity,
    props.salesSummary?.sold7d,
    props.salesSummary?.sold30d,
    props.salesSummary?.sold90d
  )
)

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${props.product.currency ? props.product.currency + ' ' : ''}${Number(v).toFixed(2)}`
}

function pricePositionLabel(position: string): string {
  return position.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
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
</script>

<template>
  <UCard class="mb-6">
    <template #header>Decision Summary</template>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-lg border border-default/50 bg-default/5 p-3">
        <p class="text-xs text-toned">Current Price</p>
        <p class="mt-1 text-xl font-semibold text-highlighted">{{ fmtMoney(product.price) }}</p>
      </div>
      <div class="rounded-lg border border-default/50 bg-default/5 p-3">
        <p class="text-xs text-toned">Inventory</p>
        <p class="mt-1 text-xl font-semibold text-highlighted">{{ product.inventoryQuantity ?? '—' }}</p>
        <UBadge v-if="inventoryAlert" :color="inventoryAlert.color" variant="soft" size="sm" class="mt-1">
          {{ inventoryAlert.text }}
        </UBadge>
      </div>
      <div class="rounded-lg border border-default/50 bg-default/5 p-3">
        <p class="text-xs text-toned">30-day Sales</p>
        <p class="mt-1 text-xl font-semibold text-highlighted">{{ salesSummary?.sold30d ?? 0 }} units</p>
        <p class="text-xs text-toned">{{ fmtMoney(salesSummary?.revenue30d) }} revenue</p>
      </div>
      <div class="rounded-lg border border-default/50 bg-default/5 p-3">
        <p class="text-xs text-toned">Competitors</p>
        <p class="mt-1 text-xl font-semibold text-highlighted">{{ confirmedCount }} confirmed</p>
        <p class="text-xs text-toned">
          of {{ totalCompetitors }} found
          <template v-if="closestCompetitor">
            · closest: {{ fmtMoney(Math.abs(closestCompetitor.diff)) }} {{ closestCompetitor.diff >= 0 ? 'above' : 'below' }}
          </template>
        </p>
      </div>
    </div>

    <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="rounded-lg border border-default/50 bg-default/5 p-3">
        <p class="text-xs text-toned">Market Median</p>
        <p class="mt-1 text-lg font-semibold text-highlighted">
          {{ marketMedian != null ? fmtMoney(marketMedian) : 'No confirmed competitor prices yet' }}
        </p>
      </div>
      <div class="rounded-lg border border-default/50 bg-default/5 p-3">
        <p class="text-xs text-toned">Price Position</p>
        <p class="mt-1 text-lg font-semibold text-highlighted">
          {{ pricing ? pricePositionLabel(pricing.pricePosition) : 'Generate an AI report for price position' }}
        </p>
      </div>
    </div>

    <div class="mt-3 rounded-lg border border-default/50 bg-default/5 p-3">
      <p class="text-xs text-toned">Sales Trend</p>
      <div v-if="salesTrend" class="mt-1 flex flex-wrap items-center gap-2">
        <UBadge :color="trendColor(salesTrend.trend)" variant="soft" size="sm">
          {{ salesTrend.trend.replace(/_/g, ' ') }}
        </UBadge>
        <span class="text-sm text-highlighted">{{ salesTrend.recentPerformance }}</span>
      </div>
      <p v-else class="mt-1 text-sm text-toned">Generate an AI report for a sales trend summary.</p>
    </div>

    <div class="mt-3 rounded-lg border border-default/50 p-4">
      <p class="mb-1 text-xs font-medium text-toned">Recommended Action</p>
      <template v-if="pricing">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <UBadge :color="pricingRecommendationColor(pricing.recommendation)" variant="soft" size="sm">
            {{ pricing.recommendation.replace(/_/g, ' ') }}
          </UBadge>
          <UBadge :color="confidenceColor(pricing.confidence)" variant="outline" size="sm">
            {{ pricing.confidence }} confidence
          </UBadge>
        </div>
        <p class="text-sm text-highlighted">{{ pricing.summary }}</p>
        <p class="mt-2 text-sm text-highlighted"><span class="font-medium text-toned">Action: </span>{{ pricing.action }}</p>
      </template>
      <p v-else class="text-sm text-toned">
        {{ hasAiReport
          ? 'The latest AI report has no pricing recommendation.'
          : 'No AI report yet — generate one from the AI Insights tab for a pricing recommendation.' }}
      </p>
    </div>
  </UCard>
</template>
