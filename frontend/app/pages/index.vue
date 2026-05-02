<script setup lang="ts">
definePageMeta({
  middleware: ["auth"]
})

const { user, session } = useUserSession()
</script>

<template>
  <div class="mx-auto flex min-h-[calc(100vh-73px)] max-w-6xl items-center px-6 py-12">
    <div class="grid w-full gap-6 lg:grid-cols-[1.3fr_0.9fr]">
      <section class="rounded-2xl border border-default/70 bg-white/85 p-8 shadow-sm">
        <UBadge color="secondary" variant="soft" class="mb-4">
          Authenticated
        </UBadge>
        <h1 class="max-w-xl text-4xl font-semibold tracking-tight text-highlighted">
          Your Price Insight workspace is ready.
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-toned">
          This is the protected area for the extractor workflow. Once we connect the backend,
          this page can become the submission and review surface for product URLs.
        </p>

        <div class="mt-8 grid gap-4 md:grid-cols-3">
          <UCard>
            <template #header>
              Session
            </template>
            <p class="text-sm text-toned">
              Logged in at
            </p>
            <p class="mt-2 text-sm font-medium text-highlighted">
              {{ session.loggedInAt || "Just now" }}
            </p>
          </UCard>

          <UCard>
            <template #header>
              Profile
            </template>
            <p class="text-sm text-toned">
              Name
            </p>
            <p class="mt-2 text-sm font-medium text-highlighted">
              {{ user?.name || "Google user" }}
            </p>
          </UCard>

          <UCard>
            <template #header>
              Access
            </template>
            <p class="text-sm text-toned">
              Email
            </p>
            <p class="mt-2 break-all text-sm font-medium text-highlighted">
              {{ user?.email || "Unavailable" }}
            </p>
          </UCard>
        </div>
      </section>

      <aside class="rounded-2xl border border-default/70 bg-slate-950 p-8 text-white shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">
          Next steps
        </p>
        <ul class="mt-5 space-y-4 text-sm leading-6 text-white/80">
          <li>Connect the extractor submit form to a Nuxt server route.</li>
          <li>Store Google users and role decisions in MySQL.</li>
          <li>Limit access to approved reviewers if needed.</li>
        </ul>
      </aside>
    </div>
  </div>
</template>
