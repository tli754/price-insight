<script setup lang="ts">
interface MonthlyBucket {
  month: string
  qty: number
  revenue: number
}

const props = defineProps<{ monthly: MonthlyBucket[] }>()

const W = 560
const H = 180
const P = { top: 16, right: 16, bottom: 36, left: 44 }
const cW = W - P.left - P.right
const cH = H - P.top - P.bottom

function niceMax(v: number): number {
  if (v <= 0) return 5
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

const maxQty = computed(() => Math.max(1, ...props.monthly.map(m => m.qty)))
const ceiling = computed(() => niceMax(maxQty.value))

const yTicks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map(f => ({
    value: Math.round(ceiling.value * f),
    y: P.top + cH - f * cH,
  }))
)

const slot = computed(() => (props.monthly.length > 0 ? cW / props.monthly.length : cW))
const barW = computed(() => Math.max(4, slot.value * 0.65))

const bars = computed(() =>
  props.monthly.map((m, i) => ({
    x: P.left + i * slot.value + (slot.value - barW.value) / 2,
    y: P.top + cH - (m.qty / ceiling.value) * cH,
    h: (m.qty / ceiling.value) * cH,
    label: fmtMonth(m.month),
    qty: m.qty,
    revenue: m.revenue,
  }))
)

function fmtMonth(month: string): string {
  const [y, m] = month.split('-')
  if (!y || !m) return month
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-NZ', { month: 'short' })
}
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full select-none" aria-label="Monthly sales chart">
    <!-- Grid lines + Y labels -->
    <g v-for="tick in yTicks" :key="tick.value">
      <line
        :x1="P.left" :y1="tick.y" :x2="P.left + cW" :y2="tick.y"
        stroke="#e5e7eb" stroke-width="1" stroke-dasharray="3 3"
      />
      <text
        :x="P.left - 6" :y="tick.y" text-anchor="end" dominant-baseline="middle"
        fill="#9ca3af" font-size="10"
      >{{ tick.value }}</text>
    </g>

    <!-- Axes -->
    <line :x1="P.left" :y1="P.top" :x2="P.left" :y2="P.top + cH" stroke="#d1d5db" stroke-width="1" />
    <line :x1="P.left" :y1="P.top + cH" :x2="P.left + cW" :y2="P.top + cH" stroke="#d1d5db" stroke-width="1" />

    <!-- Bars -->
    <g v-for="bar in bars" :key="bar.label + bar.x">
      <rect
        :x="bar.x" :y="bar.y" :width="barW" :height="Math.max(0, bar.h)"
        rx="2" fill="#3b82f6" fill-opacity="0.75"
      >
        <title>{{ bar.qty }} units · ${{ Math.round(bar.revenue).toLocaleString() }}</title>
      </rect>
      <text
        :x="bar.x + barW / 2" :y="P.top + cH + 14"
        text-anchor="middle" fill="#9ca3af" font-size="9"
      >{{ bar.label }}</text>
    </g>
  </svg>
</template>
