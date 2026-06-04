<script setup lang="ts">
async function logout() {
  await $fetch("/auth/logout", { method: "POST" })
  await navigateTo("/login")
}
</script>

<template>
  <div class="mx-auto min-h-screen max-w-[1500px]">
    <header class="border-b border-default/60 bg-white/70 backdrop-blur">
      <div class="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-primary-600">
            Price Insight
          </p>
          <p class="text-sm text-toned">
            Extractor review workspace
          </p>
        </div>

        <UButton color="neutral" variant="solid" @click="logout">
          Sign out
        </UButton>
      </div>
    </header>

    <AppNav />

    <main>
      <slot />
    </main>
  </div>
</template>
