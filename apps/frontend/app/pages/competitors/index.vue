<script setup lang="ts">
import type { CompetitorListItem } from '~/shared/types/competitor'


const { data, pending } = await useFetch<{ items: CompetitorListItem[] }>(
  '/api/competitors',
  { lazy: true }
)

const competitors = computed(() => data.value?.items ?? [])

const stateColor = (state: string) => state === 'active' ? 'success' : 'neutral'

const formatDate = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })
}

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'state', header: 'State' },
  { accessorKey: 'matchedProducts', header: 'Matched Products' },
  { accessorKey: 'lastScraped', header: 'Last Scraped' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">Competitors</h1>
      <UButton label="Add Competitor" icon="i-lucide-plus" size="sm" />
    </div>

    <UCard>
      <div v-if="pending" class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin text-gray-400" />
      </div>

      <UTable v-else :data="competitors" :columns="columns">
        <template #name-cell="{ row }">
          <div class="flex items-center gap-3">
            <UAvatar :alt="row.original.name" size="sm" />
            <span class="font-medium text-gray-900">{{ row.original.name }}</span>
          </div>
        </template>
        <template #state-cell="{ row }">
          <UBadge :color="stateColor(row.original.state)" variant="soft" size="sm">
            {{ row.original.state }}
          </UBadge>
        </template>
        <template #matchedProducts-cell="{ row }">
          <span class="text-gray-700">{{ row.original.matchedProducts }}</span>
        </template>
        <template #lastScraped-cell="{ row }">
          <span class="text-sm text-gray-500">{{ formatDate(row.original.lastScraped) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UButton size="sm" variant="ghost" color="neutral" label="View" @click="navigateTo('/competitors/' + row.original.id)" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
