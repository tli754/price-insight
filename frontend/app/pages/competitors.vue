<script setup lang="ts">
const competitors = [
  {
    id: 1,
    name: 'amazon.com',
    state: 'active',
    matchedProducts: 12,
    lastScraped: '2026-05-19T08:30:00Z'
  },
  {
    id: 2,
    name: 'trademe.co.nz',
    state: 'active',
    matchedProducts: 8,
    lastScraped: '2026-05-19T06:00:00Z'
  },
  {
    id: 3,
    name: 'thewarehouse.co.nz',
    state: 'active',
    matchedProducts: 5,
    lastScraped: '2026-05-18T22:15:00Z'
  },
  {
    id: 4,
    name: 'mitre10.co.nz',
    state: 'inactive',
    matchedProducts: 2,
    lastScraped: '2026-05-10T14:00:00Z'
  }
]

const stateColor = (state: string) => state === 'active' ? 'success' : 'neutral'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'state', header: 'State' },
  { accessorKey: 'matchedProducts', header: 'Matched Products' },
  { accessorKey: 'lastScraped', header: 'Last Scraped' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">Competitors</h1>
      <UButton label="Add Competitor" icon="i-lucide-plus" size="sm" />
    </div>

    <UCard>
      <UTable :data="competitors" :columns="columns">
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
        <template #actions-cell>
          <UButton size="sm" variant="ghost" color="neutral" label="View" />
        </template>
      </UTable>
    </UCard>
  </div>
</template>
