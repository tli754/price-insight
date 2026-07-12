<script setup lang="ts">
import type { LeadDetail } from '#shared/types/lead'

const route = useRoute()

const { data, pending, error } = await useFetch<LeadDetail>(
  `/leads-api/leads/${route.params.id}`,
  { lazy: true }
)

const lead = computed(() => data.value)
const title = computed(() => lead.value?.companyName ?? 'Lead')

function humanize(status: string): string {
  const s = status.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function scoreColor(score: number | null | undefined): 'success' | 'warning' | 'neutral' {
  if (score == null) return 'neutral'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'neutral'
}
</script>

<template>
  <div class="mx-auto max-w-[1000px] px-6 py-6 space-y-4">
    <div class="flex items-center gap-3">
      <UButton variant="ghost" color="neutral" icon="i-lucide-arrow-left" @click="navigateTo('/leads')" />
      <h1 class="text-lg font-semibold text-gray-900">{{ title }}</h1>
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin text-gray-400" />
    </div>

    <UCard v-else-if="error || !lead" class="py-16 text-center">
      <p class="text-sm font-semibold text-highlighted">Couldn't load this lead</p>
      <p class="mt-1 text-sm text-toned">The leads service may not be running yet.</p>
    </UCard>

    <template v-else>
      <!-- Overview -->
      <UCard>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 space-y-1">
            <a
              v-if="lead.domain"
              :href="`https://${lead.domain}`"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1 text-sm text-primary-600 hover:underline"
            >
              <UIcon name="i-lucide-external-link" class="h-3.5 w-3.5 shrink-0" />
              {{ lead.domain }}
            </a>
            <div class="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span v-if="lead.vertical">{{ lead.vertical }}</span>
              <span v-if="lead.platform" class="text-gray-400">· {{ lead.platform }}</span>
              <span v-if="lead.country" class="text-gray-400">· {{ lead.country }}</span>
            </div>
            <a
              v-if="lead.primaryEmail"
              :href="`mailto:${lead.primaryEmail}`"
              class="text-sm text-primary-600 hover:underline"
            >
              {{ lead.primaryEmail }}
            </a>
          </div>
          <div class="flex items-center gap-3">
            <UBadge variant="soft" size="sm">{{ humanize(lead.status) }}</UBadge>
            <div class="text-right">
              <p class="text-xs text-gray-500">Score</p>
              <UBadge :color="scoreColor(lead.scoreOverall)" variant="soft" size="lg">
                {{ lead.scoreOverall ?? '—' }}
              </UBadge>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Score breakdown -->
      <UCard v-if="lead.scoreComponents?.length || lead.reasons?.length">
        <template #header>
          <h2 class="text-sm font-semibold text-gray-900">Score breakdown</h2>
        </template>
        <div v-if="lead.scoreComponents?.length" class="space-y-2">
          <div
            v-for="c in lead.scoreComponents"
            :key="c.label"
            class="flex items-center justify-between text-sm"
          >
            <span class="text-gray-600">{{ c.label }}</span>
            <span class="font-mono text-gray-900">{{ c.value }}</span>
          </div>
        </div>
        <ul v-if="lead.reasons?.length" class="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li v-for="(r, i) in lead.reasons" :key="i">{{ r }}</li>
        </ul>
      </UCard>

      <!-- Signals -->
      <UCard v-if="lead.signals?.length">
        <template #header>
          <h2 class="text-sm font-semibold text-gray-900">Signals</h2>
        </template>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div
            v-for="(s, i) in lead.signals"
            :key="i"
            class="flex items-center justify-between rounded border border-default/40 px-3 py-2 text-sm"
          >
            <span class="text-gray-600">{{ s.label }}</span>
            <span class="text-gray-900">{{ s.value ?? s.detail ?? '—' }}</span>
          </div>
        </div>
      </UCard>

      <!-- Contacts -->
      <UCard v-if="lead.contacts?.length">
        <template #header>
          <h2 class="text-sm font-semibold text-gray-900">Contacts</h2>
        </template>
        <div class="space-y-2">
          <div
            v-for="(c, i) in lead.contacts"
            :key="i"
            class="flex flex-wrap items-center justify-between gap-2 rounded border border-default/40 px-3 py-2 text-sm"
          >
            <div class="min-w-0">
              <span class="font-medium text-gray-900">{{ c.name ?? 'Unknown' }}</span>
              <span v-if="c.role" class="ml-2 text-gray-500">{{ c.role }}</span>
            </div>
            <div class="flex items-center gap-3">
              <a v-if="c.email" :href="`mailto:${c.email}`" class="text-primary-600 hover:underline">{{ c.email }}</a>
              <span v-if="c.phone" class="text-gray-600">{{ c.phone }}</span>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>
