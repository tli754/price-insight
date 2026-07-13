<script setup lang="ts">
import type { LeadImportSummary, LeadListItem, LeadListResponse, LeadStatus, LeadStatusUpdateResponse } from '#shared/types/lead'
import { LIFECYCLE_STATUSES } from '#shared/types/lead'

const toast = useToast()

// ── Human-readable status label (e.g. `ai_analysed` → "Ai analysed") ──────────
function humanize(status: string): string {
  const s = status.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const statusItems = LIFECYCLE_STATUSES.map(s => ({ label: humanize(s), value: s }))

// ── Filters ───────────────────────────────────────────────────────────────────
// 'all' means no filter ('' values are disallowed by USelect).
const statusFilterItems = [{ label: 'All statuses', value: 'all' }, ...statusItems]
const minScoreItems = [
  { label: 'Any score', value: 'all' },
  { label: '60+', value: '60' },
  { label: '80+', value: '80' },
]

const statusFilter = ref<'all' | LeadStatus>('all')
const minScore = ref('all')

// ── Pagination ──────────────────────────────────────────────────────────────
const page = ref(1)
const pageSizeStr = ref('25')
const pageSize = computed(() => Number(pageSizeStr.value))
const pageSizeItems = [
  { label: '25 per page', value: '25' },
  { label: '50 per page', value: '50' },
  { label: '100 per page', value: '100' },
]

// Reset to page 1 whenever a filter or page size changes.
watch([statusFilter, minScore, pageSizeStr], () => { page.value = 1 })

// ── Data (server-side ranked list; the API returns total for pagination) ──────
const query = computed(() => {
  const q: Record<string, string | number> = {
    sort: 'score',
    order: 'desc',
    page: page.value,
    pageSize: pageSize.value,
  }
  if (statusFilter.value !== 'all') q.status = statusFilter.value
  if (minScore.value !== 'all') q.minScore = minScore.value
  return q
})

const { data, pending, error, refresh } = await useFetch<LeadListResponse>('/leads-api/leads', {
  query,
  lazy: true,
})

// Local editable copy so per-row status selects have two-way binding while the
// underlying fetch result stays immutable.
const items = ref<LeadListItem[]>([])
watch(data, (d) => { items.value = d?.items ?? [] }, { immediate: true })

const total = computed(() => data.value?.total ?? 0)

// ── Score badge banding ───────────────────────────────────────────────────────
function scoreColor(score: number | null): 'success' | 'warning' | 'neutral' {
  if (score == null) return 'neutral'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'neutral'
}

// ── Status update → PATCH /leads-api/leads/:id/status ────────────────────────
const updating = ref<Set<string>>(new Set())

async function updateStatus(item: LeadListItem, next: LeadStatus) {
  if (next === item.status) return
  const prev = item.status
  item.status = next
  updating.value = new Set(updating.value).add(item.id)
  try {
    const res = await $fetch<LeadStatusUpdateResponse>(`/leads-api/leads/${item.id}/status`, {
      method: 'PATCH',
      body: { status: next },
    })
    item.status = res.status
    toast.add({ title: `Status set to ${humanize(res.status)}`, color: 'success' })
  } catch (e: unknown) {
    item.status = prev
    toast.add({ title: getApiErrorMessage(e, 'Failed to update status'), color: 'error' })
  } finally {
    const s = new Set(updating.value)
    s.delete(item.id)
    updating.value = s
  }
}

// ── Import leads from an uploaded xlsx ────────────────────────────────────────
const importing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function triggerImport() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importing.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    const summary = await $fetch<LeadImportSummary>('/leads-api/leads/import', {
      method: 'POST',
      body: formData,
    })
    toast.add({
      title: `Imported ${summary.total} lead${summary.total === 1 ? '' : 's'}`,
      description: `${summary.scored} scored, ${summary.rejected} rejected`,
      color: 'success',
    })
    await refresh()
  } catch (e: unknown) {
    toast.add({ title: getApiErrorMessage(e, 'Import failed'), color: 'error' })
  } finally {
    importing.value = false
  }
}

// ── Row selection (AI-send shell; wiring deferred to Phase 3) ─────────────────
const selected = ref<Set<string>>(new Set())

function toggleRow(id: string, value: boolean) {
  const s = new Set(selected.value)
  if (value) s.add(id)
  else s.delete(id)
  selected.value = s
}

const allOnPageSelected = computed(() =>
  items.value.length > 0 && items.value.every(i => selected.value.has(i.id))
)

function toggleAll(value: boolean) {
  const s = new Set(selected.value)
  for (const i of items.value) {
    if (value) s.add(i.id)
    else s.delete(i.id)
  }
  selected.value = s
}

// Phase 3: this button will POST the selected ids to `/leads-api/leads/analyze`
// to manually trigger AI analysis on crawled leads. Disabled until then.
const selectedCount = computed(() => selected.value.size)

const columns = [
  { id: 'select', header: '' },
  { accessorKey: 'scoreOverall', header: 'Score' },
  { accessorKey: 'companyName', header: 'Company' },
  { accessorKey: 'vertical', header: 'Vertical' },
  { accessorKey: 'reasons', header: 'Reasons' },
  { accessorKey: 'primaryEmail', header: 'Email' },
  { accessorKey: 'status', header: 'Status' },
]
</script>

<template>
  <div class="mx-auto max-w-[1500px] px-6 py-6 space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold text-gray-900">Leads</h1>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh"
        />
        <UButton
          size="xs"
          variant="soft"
          icon="i-lucide-upload"
          :loading="importing"
          @click="triggerImport"
        >
          Import Leads
        </UButton>
        <input
          ref="fileInput"
          type="file"
          accept=".xlsx"
          class="hidden"
          @change="handleFileChange"
        >
      </div>
      <div class="flex items-center gap-2">
        <USelect v-model="statusFilter" :items="statusFilterItems" icon="i-lucide-filter" class="w-44" />
        <USelect v-model="minScore" :items="minScoreItems" icon="i-lucide-gauge" class="w-36" />
      </div>
    </div>

    <!-- AI-select toolbar (Phase 3 shell — disabled) -->
    <div class="flex items-center justify-between">
      <USelect v-model="pageSizeStr" :items="pageSizeItems" class="w-36" />
      <UTooltip text="Available after crawl (Phase 3)">
        <UButton
          size="sm"
          variant="soft"
          icon="i-lucide-sparkles"
          disabled
        >
          Send to AI<span v-if="selectedCount"> ({{ selectedCount }})</span>
        </UButton>
      </UTooltip>
    </div>

    <!-- Loading skeleton -->
    <template v-if="pending">
      <UCard>
        <div class="space-y-3">
          <USkeleton v-for="i in 6" :key="i" class="h-12 w-full" />
        </div>
      </UCard>
    </template>

    <!-- Error state (e.g. leads service not running → proxy 502) -->
    <UCard v-else-if="error" class="py-16 text-center">
      <p class="text-sm font-semibold text-highlighted">Couldn't load leads</p>
      <p class="mt-1 text-sm text-toned">The leads service may not be running yet.</p>
      <UButton class="mt-4" variant="soft" icon="i-lucide-refresh-cw" @click="refresh">Retry</UButton>
    </UCard>

    <!-- Empty state -->
    <UCard v-else-if="!items.length" class="py-16 text-center">
      <p class="text-sm font-semibold text-highlighted">No leads yet</p>
      <p class="mt-1 text-sm text-toned">Imported and scored companies will appear here, ranked by score.</p>
    </UCard>

    <!-- Leads table -->
    <template v-else>
      <UCard>
        <UTable :data="items" :columns="columns">
          <template #select-header>
            <UCheckbox
              :model-value="allOnPageSelected"
              aria-label="Select all on page"
              @update:model-value="toggleAll(Boolean($event))"
            />
          </template>
          <template #select-cell="{ row }">
            <UCheckbox
              :model-value="selected.has(row.original.id)"
              :aria-label="`Select ${row.original.companyName}`"
              @update:model-value="toggleRow(row.original.id, Boolean($event))"
            />
          </template>

          <template #scoreOverall-cell="{ row }">
            <UBadge
              v-if="row.original.scoreOverall != null"
              :color="scoreColor(row.original.scoreOverall)"
              variant="soft"
              size="sm"
            >
              {{ row.original.scoreOverall }}
            </UBadge>
            <span v-else class="text-gray-400">—</span>
          </template>

          <template #companyName-cell="{ row }">
            <div class="flex min-w-0 max-w-[280px] flex-col gap-0.5">
              <NuxtLink
                :to="`/leads/${row.original.id}`"
                class="truncate font-medium text-gray-900 hover:underline"
                :title="row.original.companyName"
              >
                {{ row.original.companyName }}
              </NuxtLink>
              <a
                v-if="row.original.domain"
                :href="`https://${row.original.domain}`"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1 truncate text-xs text-primary-600 hover:underline"
                @click.stop
              >
                <UIcon name="i-lucide-external-link" class="h-3 w-3 shrink-0" />
                {{ row.original.domain }}
              </a>
            </div>
          </template>

          <template #vertical-cell="{ row }">
            <span v-if="row.original.vertical" class="text-sm text-gray-700">{{ row.original.vertical }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>

          <template #reasons-cell="{ row }">
            <span
              v-if="row.original.reasons?.length"
              class="block max-w-sm truncate text-sm text-gray-600"
              :title="row.original.reasons.join(', ')"
            >
              {{ row.original.reasons.join(', ') }}
            </span>
            <span v-else class="text-gray-400">—</span>
          </template>

          <template #primaryEmail-cell="{ row }">
            <a
              v-if="row.original.primaryEmail"
              :href="`mailto:${row.original.primaryEmail}`"
              class="text-sm text-primary-600 hover:underline"
            >
              {{ row.original.primaryEmail }}
            </a>
            <span v-else class="text-gray-400">—</span>
          </template>

          <template #status-cell="{ row }">
            <USelect
              :model-value="row.original.status"
              :items="statusItems"
              :loading="updating.has(row.original.id)"
              size="sm"
              class="w-40"
              @update:model-value="updateStatus(row.original, $event as LeadStatus)"
            />
          </template>
        </UTable>

        <div v-if="total > pageSize" class="mt-4 flex justify-center">
          <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
        </div>
      </UCard>
    </template>
  </div>
</template>
