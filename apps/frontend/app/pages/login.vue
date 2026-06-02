<script setup lang="ts">
const { loggedIn, fetch } = useUserSession()
const route = useRoute()
const config = useRuntimeConfig()
const devAuthBypass = config.public.devAuthBypass

const pending = ref(false)
const password = ref("")
const errorMessage = ref(
  typeof route.query.error === "string" ? route.query.error : ""
)

await fetch()

if (loggedIn.value) {
  await navigateTo("/")
}

async function loginWithGoogle() {
  pending.value = true
  try {
    await navigateTo("/auth/google", { external: true })
  } finally {
    pending.value = false
  }
}

async function loginWithPassword() {
  pending.value = true
  errorMessage.value = ""
  try {
    await $fetch("/auth/dev-login", {
      method: "POST",
      body: { password: password.value }
    })
    await navigateTo("/")
  } catch {
    errorMessage.value = "Invalid password"
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-[calc(100vh-73px)] max-w-[2000px] items-center px-6 py-12">
    <div class="grid w-full overflow-hidden rounded-3xl border border-default/70 bg-white/85 shadow-xl lg:grid-cols-[1.15fr_0.85fr]">
      <section class="p-8 sm:p-10">
        <UBadge color="primary" variant="soft">
          Secure Sign In
        </UBadge>
        <h1 class="mt-6 max-w-md text-4xl font-semibold tracking-tight text-highlighted">
          Sign in to review extracted products.
        </h1>
        <p class="mt-4 max-w-xl text-base leading-7 text-toned">
          Use your Google account to access the Price Insight frontend. Session state is handled by
          secure cookies through Nuxt Auth Utils.
        </p>

        <UAlert
          v-if="errorMessage"
          class="mt-6"
          color="error"
          variant="soft"
          title="Login failed"
          :description="errorMessage"
        />

        <div v-if="devAuthBypass" class="mt-8 flex max-w-sm flex-col gap-3">
          <UInput
            v-model="password"
            type="password"
            placeholder="Dev password"
            size="xl"
            @keyup.enter="loginWithPassword"
          />
          <UButton
            size="xl"
            color="primary"
            :loading="pending"
            @click="loginWithPassword"
          >
            Sign in
          </UButton>
        </div>

        <div v-else class="mt-8">
          <UButton
            size="xl"
            color="primary"
            :loading="pending"
            @click="loginWithGoogle"
          >
            Continue with Google
          </UButton>
        </div>
      </section>

      <aside class="border-t border-default/60 bg-slate-950 p-8 text-white lg:border-l lg:border-t-0 sm:p-10">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
          Access model
        </p>
        <div class="mt-6 space-y-5 text-sm leading-6 text-white/80">
          <p>Google OAuth authenticates the user before they enter the extractor workspace.</p>
          <p>The protected home page is only available to users with an active session.</p>
          <p>Manual product approval and delete actions can be added after the auth flow is in place.</p>
        </div>
      </aside>
    </div>
  </div>
</template>
