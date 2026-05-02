<script setup lang="ts">
import type { FetchCompetitorsResponse } from '~/shared/types/competitor'
import type { ProductRow } from '~/shared/types/product'

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { data, pending } = await useFetch<{ item: ProductRow }>(
  `${apiUrl}/api/products/${route.params.id}`,
  { lazy: true }
)

const { data: competitorsData, pending: competitorsPending, refresh: refreshCompetitors } =
  await useFetch<FetchCompetitorsResponse>(
    `${apiUrl}/api/products/${route.params.id}/competitors`,
    { lazy: true }
  )

const product = computed(() => data.value?.item ?? null)
const competitors = computed(() => competitorsData.value?.competitors ?? [])

const selected = ref<Set<number>>(new Set())
const saving = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)

watch(competitors, () => {
  selected.value = new Set()
  saveError.value = null
  saveSuccess.value = false
})

function toggleRow(i: number) {
  const next = new Set(selected.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  selected.value = next
}

function toggleAll() {
  if (selected.value.size === competitors.value.length) {
    selected.value = new Set()
  } else {
    selected.value = new Set(competitors.value.map((_, i) => i))
  }
}

async function saveSelected() {
  const items = [...selected.value].map(i => competitors.value[i])
  saving.value = true
  saveError.value = null
  saveSuccess.value = false
  try {
    await $fetch(`${apiUrl}/api/products/${route.params.id}/competitors`, {
      method: 'POST',
      body: { competitors: items }
    })
    saveSuccess.value = true
    selected.value = new Set()
  } catch (e: unknown) {
    saveError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to save competitors'
  } finally {
    saving.value = false
  }
}

function statusColor(status: string) {
  if (status === 'approved') return 'success' as const
  if (status === 'deleted') return 'error' as const
  return 'warning' as const
}

function confidenceColor(confidence: string | null) {
  if (confidence === 'high') return 'success' as const
  if (confidence === 'low') return 'error' as const
  return 'warning' as const
}

function formatDate(date: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleString()
}

function formatPrice(extracted: number, raw: string | null, currency: string | null) {
  if (raw) return raw
  return [currency, extracted].filter(Boolean).join(' ')
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-10">
    <template v-if="pending">
      <USkeleton class="mb-6 h-8 w-64" />
      <div class="mb-6 grid gap-6 lg:grid-cols-2">
        <USkeleton class="h-80 w-full rounded-xl" />
        <USkeleton class="h-80 w-full rounded-xl" />
      </div>
      <USkeleton class="h-64 w-full rounded-xl" />
    </template>

    <div v-else-if="!product" class="py-20 text-center">
      <p class="text-sm font-medium text-highlighted">Product not found</p>
      <UButton class="mt-4" variant="soft" color="neutral" @click="navigateTo('/')">
        Back to products
      </UButton>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="mb-6 flex items-start justify-between gap-4">
        <div>
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <UBadge :color="statusColor(product.status)" variant="soft">
              {{ product.status }}
            </UBadge>
            <UBadge
              v-if="product.confidence"
              :color="confidenceColor(product.confidence)"
              variant="soft"
            >
              {{ product.confidence }} confidence
            </UBadge>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight">
            <a
              :href="product.sourceUrl"
              target="_blank"
              rel="noopener"
              class="text-highlighted hover:text-primary-600 hover:underline"
            >
              {{ product.productName || 'Unnamed product' }}
            </a>
          </h1>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UButton
            variant="soft"
            color="primary"
            :loading="competitorsPending"
            @click="refreshCompetitors"
          >
            New Competitors
          </UButton>
          <UButton variant="soft" color="neutral" @click="navigateTo('/')">
            Back
          </UButton>
        </div>
      </div>

      <!-- Product info grid -->
      <div class="mb-6 grid gap-6 lg:grid-cols-2">
        <div class="space-y-4">
          <div
            v-if="product.thumbnail"
            class="overflow-hidden rounded-xl border border-default/70 bg-white/85"
          >
            <img
              :src="product.thumbnail"
              :alt="product.productName || 'Product image'"
              class="w-full object-contain p-4"
              style="max-height: 320px"
            />
          </div>

          <UCard v-if="product.keySpecs?.length">
            <template #header>
              Key specs
            </template>
            <ul class="space-y-1">
              <li v-for="spec in product.keySpecs" :key="spec" class="text-sm text-toned">
                {{ spec }}
              </li>
            </ul>
          </UCard>
        </div>

        <div class="space-y-4">
          <UCard>
            <template #header>
              Pricing
            </template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-toned">Price</dt>
                <dd class="font-medium text-highlighted">
                  {{ product.price != null ? `${product.currency || ''} ${product.price}`.trim() : '—' }}
                </dd>
              </div>
              <div v-if="product.salesPrice != null" class="flex justify-between">
                <dt class="text-toned">Sale price</dt>
                <dd class="font-medium text-highlighted">
                  {{ `${product.currency || ''} ${product.salesPrice}`.trim() }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Availability</dt>
                <dd class="text-highlighted">{{ product.availability || '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              Details
            </template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-toned">Brand</dt>
                <dd class="text-highlighted">{{ product.brand || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Model / variant</dt>
                <dd class="text-highlighted">{{ product.modelOrVariant || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Category</dt>
                <dd class="text-highlighted">{{ product.productCategory || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Seller</dt>
                <dd class="text-highlighted">{{ product.sellerOrStore || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Last extracted</dt>
                <dd class="text-highlighted">{{ formatDate(product.lastExtractedAt) }}</dd>
              </div>
            </dl>
          </UCard>
        </div>
      </div>

      <!-- Competitors — full width -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span>Competitors</span>
            <div v-if="competitors.length" class="flex items-center gap-2">
              <p v-if="saveSuccess" class="text-xs text-success-600">Saved!</p>
              <p v-if="saveError" class="text-xs text-error-600">{{ saveError }}</p>
              <UButton
                size="xs"
                variant="soft"
                color="primary"
                :disabled="selected.size === 0"
                :loading="saving"
                @click="saveSelected"
              >
                Save {{ selected.size > 0 ? `(${selected.size})` : '' }}
              </UButton>
            </div>
          </div>
        </template>

        <div v-if="competitorsPending" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
        </div>

        <div
          v-else-if="!competitors.length"
          class="py-6 text-center text-sm text-toned"
        >
          No competitors found — click New Competitors to search.
        </div>

        <div v-else class="overflow-hidden rounded-lg border border-default/50">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default/50 bg-default/20">
                <th class="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    :checked="selected.size === competitors.length"
                    :indeterminate="selected.size > 0 && selected.size < competitors.length"
                    class="cursor-pointer"
                    @change="toggleAll"
                  />
                </th>
                <th class="w-12 px-3 py-2" />
                <th class="px-3 py-2 text-left font-medium text-toned">Product</th>
                <th class="px-3 py-2 text-left font-medium text-toned">Store</th>
                <th class="px-3 py-2 text-right font-medium text-toned">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(c, i) in competitors"
                :key="i"
                class="cursor-pointer border-b border-default/30 last:border-0 hover:bg-default/10"
                :class="{ 'bg-primary-50/40': selected.has(i) }"
                @click="toggleRow(i)"
              >
                <td class="px-3 py-2" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selected.has(i)"
                    class="cursor-pointer"
                    @change="toggleRow(i)"
                  />
                </td>
                <td class="px-3 py-2" @click.stop>
                  <img
                    v-if="c.thumbnail"
                    :src="c.thumbnail"
                    :alt="c.title"
                    class="h-10 w-10 rounded object-contain bg-white"
                  />
                  <div v-else class="h-10 w-10 rounded bg-default/20" />
                </td>
                <td class="px-3 py-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <a
                      :href="c.link"
                      target="_blank"
                      rel="noopener"
                      class="text-primary-600 hover:underline"
                      @click.stop
                    >
                      {{ c.title }}
                    </a>
                    <UBadge v-if="c.tag" size="xs" color="neutral" variant="soft">
                      {{ c.tag }}
                    </UBadge>
                  </div>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-toned">{{ c.source }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span class="font-medium text-highlighted">
                    {{ formatPrice(c.extractedPrice, c.rawPrice, c.currency) }}
                  </span>
                  <span
                    v-if="c.rawOldPrice"
                    class="ml-1 text-xs text-toned line-through"
                  >
                    {{ c.rawOldPrice }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>
  </div>
</template>
