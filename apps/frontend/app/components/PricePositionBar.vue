<script setup lang="ts">
interface Props {
  prices: number[]
  ourPrice: number | null
  currency?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  currency: null
})

const sorted = computed(() => [...props.prices].sort((a, b) => a - b))
const lowest = computed(() => sorted.value[0] ?? null)
const highest = computed(() => sorted.value[sorted.value.length - 1] ?? null)
const priceMedian = computed(() => median(props.prices))

const allVals = computed(() => [...props.prices, ...(props.ourPrice != null ? [props.ourPrice] : [])])
const minV = computed(() => Math.min(...allVals.value))
const maxV = computed(() => Math.max(...allVals.value))
const span = computed(() => (maxV.value - minV.value) || 1)

function pct(v: number): number {
  return ((v - minV.value) / span.value) * 100
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  return `${props.currency ? props.currency + ' ' : ''}${v.toFixed(2)}`
}

const vsLowest = computed(() => {
  if (props.ourPrice == null || lowest.value == null) return null
  return props.ourPrice - lowest.value
})

const vsMedianPercent = computed(() => {
  if (props.ourPrice == null || !priceMedian.value) return null
  return ((props.ourPrice - priceMedian.value) / priceMedian.value) * 100
})
</script>

<template>
  <div class="w-full">
    <div class="relative mt-6 h-1.5 rounded-full bg-gray-200">
      <div
        v-if="priceMedian != null"
        class="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-blue-400"
        :style="`left: ${pct(priceMedian)}%`"
      />
      <div
        v-if="ourPrice != null"
        class="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-500 shadow"
        :style="`left: ${pct(ourPrice)}%`"
        :title="`Your price: ${fmt(ourPrice)}`"
      />
    </div>
    <div class="mt-2 flex justify-between text-xs text-toned">
      <span>Lowest<br><strong class="text-highlighted">{{ fmt(lowest) }}</strong></span>
      <span class="text-center">Median<br><strong class="text-highlighted">{{ fmt(priceMedian) }}</strong></span>
      <span class="text-right">Highest<br><strong class="text-highlighted">{{ fmt(highest) }}</strong></span>
    </div>
    <p v-if="vsLowest != null" class="mt-3 text-sm text-highlighted">
      You are {{ fmt(Math.abs(vsLowest)) }} {{ vsLowest >= 0 ? 'above' : 'below' }} the lowest competitor.
    </p>
    <p v-if="vsMedianPercent != null" class="text-sm text-highlighted">
      You are {{ Math.abs(vsMedianPercent).toFixed(0) }}% {{ vsMedianPercent >= 0 ? 'above' : 'below' }} the market median.
    </p>
  </div>
</template>
