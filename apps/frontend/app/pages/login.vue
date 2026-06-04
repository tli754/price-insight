<script setup lang="ts">
definePageMeta({ layout: false })

const pending = ref(false)
const password = ref("")
const errorMessage = ref("")

async function hashPassword(plain: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

async function login() {
  pending.value = true
  errorMessage.value = ""
  try {
    const hash = await hashPassword(password.value)
    await $fetch("/auth/login", {
      method: "POST",
      body: { password: hash }
    })
    await navigateTo("/products")
  } catch {
    errorMessage.value = "Invalid password"
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-[1500px] items-center px-6 py-12">
    <div class="grid w-full overflow-hidden rounded-3xl border border-default/70 bg-white/85 shadow-xl lg:grid-cols-[1.15fr_0.85fr]">
      <section class="p-8 sm:p-10">
        <UBadge color="primary" variant="soft">
          Sign In
        </UBadge>
        <h1 class="mt-6 max-w-md text-4xl font-semibold tracking-tight text-highlighted">
          Sign in to Price Insight.
        </h1>
        <p class="mt-4 max-w-xl text-base leading-7 text-toned">
          Enter your password to access the extractor workspace.
        </p>

        <UAlert
          v-if="errorMessage"
          class="mt-6"
          color="error"
          variant="soft"
          title="Login failed"
          :description="errorMessage"
        />

        <div class="mt-8 flex max-w-sm flex-col gap-3">
          <UInput
            v-model="password"
            type="password"
            placeholder="Password"
            size="xl"
            @keyup.enter="login"
          />
          <UButton
            size="xl"
            color="primary"
            :loading="pending"
            @click="login"
          >
            Sign in
          </UButton>
        </div>
      </section>

      <aside class="border-t border-default/60 bg-slate-950 p-8 text-white lg:border-l lg:border-t-0 sm:p-10">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
          Price Insight
        </p>
        <div class="mt-6 space-y-5 text-sm leading-6 text-white/80">
          <p>Review and manage extracted product pricing data.</p>
          <p>Compare competitors, track price insights, and sync your Shopify catalogue.</p>
        </div>
      </aside>
    </div>
  </div>
</template>
