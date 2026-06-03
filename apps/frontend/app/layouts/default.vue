<script setup lang="ts">
const { data: session, refresh } = await useFetch<{ loggedIn: boolean; user?: { name: string; email: string } }>('/auth/session')

async function logout() {
  await $fetch('/auth/logout', { method: 'POST' })
  await refresh()
}
</script>

<template>
  <div class="mx-auto min-h-screen max-w-[2000px]">
    <header class="border-b border-default/60 bg-white/70 backdrop-blur">
      <div class="mx-auto flex max-w-[2000px] items-center justify-between px-6 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-primary-600">
            Price Insight
          </p>
          <p class="text-sm text-toned">
            Extractor review workspace
          </p>
        </div>

        <div v-if="session?.loggedIn" class="flex items-center gap-3">
          <div class="text-right">
            <p class="text-sm font-medium text-highlighted">
              {{ session.user?.name }}
            </p>
            <p class="text-xs text-toned">
              {{ session.user?.email }}
            </p>
          </div>
          <UButton color="neutral" variant="soft" @click="logout">
            Sign out
          </UButton>
        </div>
      </div>
    </header>

    <AppNav />

    <main>
      <slot />
    </main>
  </div>
</template>
