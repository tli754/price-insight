<script setup lang="ts">
</script>

<template>
  <div class="mx-auto min-h-screen max-w-[2000px]">
    <header class="border-b border-default/60 bg-white/70 backdrop-blur">
      <div class="mx-auto flex max-w-[2000px] items-center px-6 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-primary-600">
            Price Insight
          </p>
          <p class="text-sm text-toned">
            Extractor review workspace
          </p>
        </div>
      </div>
    </header>

    <AppNav />

    <main>
      <slot />
    </main>
  </div>
</template>
