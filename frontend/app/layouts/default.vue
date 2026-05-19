<script setup lang="ts">
const { loggedIn, user, clear, ready } = useUserSession()
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-default/60 bg-white/70 backdrop-blur">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-primary-600">
            Price Insight
          </p>
          <p class="text-sm text-toned">
            Extractor review workspace
          </p>
        </div>

        <AuthState>
          <template #default>
            <div v-if="loggedIn" class="flex items-center gap-3">
              <div class="text-right">
                <p class="text-sm font-medium text-highlighted">
                  {{ user?.name || user?.email }}
                </p>
                <p class="text-xs text-toned">
                  {{ user?.email }}
                </p>
              </div>
              <UButton color="neutral" variant="soft" @click="clear()">
                Sign out
              </UButton>
            </div>
            <div v-else-if="ready">
              <UButton to="/login" color="primary" variant="solid">
                Sign in
              </UButton>
            </div>
          </template>
          <template #placeholder>
            <USkeleton class="h-9 w-28" />
          </template>
        </AuthState>
      </div>
    </header>

    <AppNav />

    <main>
      <slot />
    </main>
  </div>
</template>
