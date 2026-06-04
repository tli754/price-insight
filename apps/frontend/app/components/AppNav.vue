<script setup lang="ts">
const items = [
  { label: 'Products', to: '/products' },
  { label: 'Competitors', to: '/competitors' },
  { label: 'Competitor Products', to: '/competitor-products' },
  { label: 'Orders', to: '/orders' },
  { label: 'Insight', to: '/insight' }
]
</script>

<template>
  <div class="border-b border-gray-200 bg-white">
    <div class="mx-auto max-w-[1500px] px-6">
      <UNavigationMenu :items="items" />
    </div>
  </div>
</template>
