<script setup lang="ts">
interface Props {
  prices: number[]
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
const cx = P.left + cW / 2  // horizontal center of the box
const BOX_W = 64

function median(arr: number[]): number {
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 !== 0 ? arr[mid]! : ((arr[mid - 1]! + arr[mid]!) / 2)
}

const stats = computed(() => {
  const sorted = [...props.prices].sort((a, b) => a - b)
  if (sorted.length < 2) return null

  const q2 = median(sorted)
  const half = Math.floor(sorted.length / 2)
  const q1 = median(sorted.slice(0, half))
  const q3 = median(sorted.slice(Math.ceil(sorted.length / 2)))
  const iqr = q3 - q1
  const lowerFence = q1 - 1.5 * iqr
  const upperFence = q3 + 1.5 * iqr
  const inliers = sorted.filter(v => v >= lowerFence && v <= upperFence)
  const whiskerLow = inliers[0] ?? sorted[0]!
  const whiskerHigh = inliers[inliers.length - 1] ?? sorted[sorted.length - 1]!
  const outliers = sorted.filter(v => v < lowerFence || v > upperFence)

  return { q1, q2, q3, whiskerLow, whiskerHigh, outliers }
})

const allVals = computed(() => [
  ...props.prices,
  ...(props.ourPrice != null ? [props.ourPrice] : [])
])

const minV = computed(() => Math.min(...allVals.value))
const maxV = computed(() => Math.max(...allVals.value))
const span = computed(() => (maxV.value - minV.value) || 1)

const pMin = computed(() => minV.value - span.value * 0.1)
const pSpan = computed(() => span.value * 1.2)

function toY(v: number): number {
  return P.top + cH - ((v - pMin.value) / pSpan.value) * cH
}

const yTicks = computed(() =>
  Array.from({ length: 5 }, (_, i) => minV.value + (i / 4) * span.value)
)
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full select-none" aria-label="Price distribution box chart">
    <!-- Horizontal grid lines -->
    <line
      v-for="tick in yTicks"
      :key="`g-${tick}`"
      :x1="P.left" :y1="toY(tick)"
      :x2="W - P.right" :y2="toY(tick)"
      stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3"
    />

    <!-- Y-axis -->
    <line :x1="P.left" :y1="P.top" :x2="P.left" :y2="P.top + cH" stroke="#d1d5db" stroke-width="1" />

    <!-- Y-axis tick labels -->
    <text
      v-for="tick in yTicks"
      :key="`l-${tick}`"
      :x="P.left - 6" :y="toY(tick)"
      text-anchor="end" dominant-baseline="middle"
      fill="#9ca3af" font-size="10"
    >{{ tick.toFixed(2) }}</text>

    <!-- Box plot -->
    <template v-if="stats">
      <!-- Upper whisker cap + stem -->
      <line :x1="cx - 12" :y1="toY(stats.whiskerHigh)" :x2="cx + 12" :y2="toY(stats.whiskerHigh)" stroke="#6b7280" stroke-width="1.5" />
      <line :x1="cx" :y1="toY(stats.whiskerHigh)" :x2="cx" :y2="toY(stats.q3)" stroke="#6b7280" stroke-width="1.5" />

      <!-- IQR box (Q1 → Q3) -->
      <rect
        :x="cx - BOX_W / 2" :y="toY(stats.q3)"
        :width="BOX_W" :height="Math.max(2, toY(stats.q1) - toY(stats.q3))"
        fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"
      />

      <!-- Median line -->
      <line
        :x1="cx - BOX_W / 2" :y1="toY(stats.q2)"
        :x2="cx + BOX_W / 2" :y2="toY(stats.q2)"
        stroke="#2563eb" stroke-width="2.5"
      >
        <title>Median: {{ stats.q2.toFixed(2) }}</title>
      </line>

      <!-- Lower whisker stem + cap -->
      <line :x1="cx" :y1="toY(stats.q1)" :x2="cx" :y2="toY(stats.whiskerLow)" stroke="#6b7280" stroke-width="1.5" />
      <line :x1="cx - 12" :y1="toY(stats.whiskerLow)" :x2="cx + 12" :y2="toY(stats.whiskerLow)" stroke="#6b7280" stroke-width="1.5" />

      <!-- Outlier dots -->
      <circle
        v-for="(o, i) in stats.outliers"
        :key="i"
        :cx="cx" :cy="toY(o)"
        r="4" fill="none" stroke="#f87171" stroke-width="1.5"
      >
        <title>Outlier: {{ o.toFixed(2) }}</title>
      </circle>
    </template>

    <!-- Our price dashed line -->
    <g v-if="ourPrice != null">
      <line
        :x1="P.left" :y1="toY(ourPrice)"
        :x2="W - P.right" :y2="toY(ourPrice)"
        stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5 3"
      />
      <!-- Left triangle marker -->
      <polygon
        :points="`${P.left},${toY(ourPrice)} ${P.left - 7},${toY(ourPrice) - 4} ${P.left - 7},${toY(ourPrice) + 4}`"
        fill="#ef4444"
      />
      <text
        :x="W - P.right + 4" :y="toY(ourPrice)"
        dominant-baseline="middle" fill="#ef4444" font-size="10" font-weight="600"
      >Ours</text>
    </g>

    <!-- X-axis label -->
    <text
      :x="cx" :y="H - 4"
      text-anchor="middle" fill="#9ca3af" font-size="11"
    >Price Range</text>
  </svg>
</template>
