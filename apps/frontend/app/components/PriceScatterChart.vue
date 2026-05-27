<script setup lang="ts">
interface Props {
  prices: number[]
  labels: string[]
  ourPrice: number | null
}

const props = withDefaults(defineProps<Props>(), {
  ourPrice: null
})

const W = 420
const H = 220
const P = { top: 20, right: 48, bottom: 32, left: 52 }
const cW = W - P.left - P.right
const cH = H - P.top - P.bottom

const allVals = computed(() => [
  ...props.prices,
  ...(props.ourPrice != null ? [props.ourPrice] : [])
])

const minV = computed(() => Math.min(...allVals.value))
const maxV = computed(() => Math.max(...allVals.value))
const span = computed(() => (maxV.value - minV.value) || 1)

// Pad 10% so dots never sit on the axis edge
const pMin = computed(() => minV.value - span.value * 0.1)
const pSpan = computed(() => span.value * 1.2)

function toY(v: number): number {
  return P.top + cH - ((v - pMin.value) / pSpan.value) * cH
}

function toX(i: number): number {
  const n = props.prices.length
  if (n <= 1) return P.left + cW / 2
  return P.left + (i / (n - 1)) * cW
}

const yTicks = computed(() =>
  Array.from({ length: 5 }, (_, i) => minV.value + (i / 4) * span.value)
)
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full select-none" aria-label="Competitor price scatter chart">
    <!-- Horizontal grid lines -->
    <line
      v-for="tick in yTicks"
      :key="`g-${tick}`"
      :x1="P.left" :y1="toY(tick)"
      :x2="P.left + cW" :y2="toY(tick)"
      stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3"
    />

    <!-- Axes -->
    <line :x1="P.left" :y1="P.top" :x2="P.left" :y2="P.top + cH" stroke="#d1d5db" stroke-width="1" />
    <line :x1="P.left" :y1="P.top + cH" :x2="P.left + cW" :y2="P.top + cH" stroke="#d1d5db" stroke-width="1" />

    <!-- Y-axis tick labels -->
    <text
      v-for="tick in yTicks"
      :key="`l-${tick}`"
      :x="P.left - 6" :y="toY(tick)"
      text-anchor="end" dominant-baseline="middle"
      fill="#9ca3af" font-size="10"
    >{{ tick.toFixed(2) }}</text>

    <!-- Our price dashed line -->
    <g v-if="ourPrice != null">
      <line
        :x1="P.left" :y1="toY(ourPrice)"
        :x2="P.left + cW" :y2="toY(ourPrice)"
        stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5 3"
      />
      <text
        :x="P.left + cW + 4" :y="toY(ourPrice)"
        dominant-baseline="middle" fill="#ef4444" font-size="10" font-weight="600"
      >Ours</text>
    </g>

    <!-- Competitor dots -->
    <circle
      v-for="(price, i) in prices"
      :key="i"
      :cx="toX(i)" :cy="toY(price)"
      r="5.5" fill="#3b82f6" fill-opacity="0.75" stroke="#1d4ed8" stroke-width="1"
    >
      <title>{{ labels[i] }}: {{ price.toFixed(2) }}</title>
    </circle>

    <!-- X-axis label -->
    <text
      :x="P.left + cW / 2" :y="H - 4"
      text-anchor="middle" fill="#9ca3af" font-size="11"
    >Competitors</text>
  </svg>
</template>
