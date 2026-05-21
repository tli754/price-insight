<script setup lang="ts">
import type { FetchCompetitorsResponse, SavedCompetitor } from '~/shared/types/competitor'
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

const { data: savedData, refresh: refreshSaved } =
  await useFetch<{ items: SavedCompetitor[] }>(
    `${apiUrl}/api/products/${route.params.id}/saved-competitors`,
    { lazy: true }
  )

const product = computed(() => data.value?.item ?? null)
const competitors = computed(() => competitorsData.value?.competitors ?? [])
const savedCompetitors = computed(() => savedData.value?.items ?? [])

// Image gallery
const selectedImageIndex = ref(0)
const images = computed(() => product.value?.images ?? [])
const activeImage = computed(() =>
  images.value[selectedImageIndex.value]?.src ?? product.value?.thumbnail ?? null
)
const activeImageAlt = computed(() =>
  images.value[selectedImageIndex.value]?.alt ?? product.value?.title ?? ''
)

watch(product, () => { selectedImageIndex.value = 0 })

// Competitors selection
const selected = ref<Set<number>>(new Set())
const saving = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)

const deletingId = ref<number | null>(null)

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
    selected.value = new Set(competitors.value.map((_c, i) => i))
  }
}

function clearCompetitors() {
  competitorsData.value = null
  selected.value = new Set()
  saveSuccess.value = false
  saveError.value = null
}

async function deleteCompetitor(id: number) {
  deletingId.value = id
  try {
    await $fetch(`${apiUrl}/api/products/${route.params.id}/saved-competitors/${id}`, {
      method: 'DELETE'
    })
    await refreshSaved()
  } catch {
    // silently ignore — row stays in the list if delete fails
  } finally {
    deletingId.value = null
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
    await refreshSaved()
  } catch (e: unknown) {
    saveError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to save competitors'
  } finally {
    saving.value = false
  }
}

// Chart data derived from saved competitors with a known price
const chartPrices = computed(() =>
  savedCompetitors.value
    .map(c => c.extractedPrice)
    .filter((p): p is number => p != null)
)
const chartLabels = computed(() =>
  savedCompetitors.value
    .filter(c => c.extractedPrice != null)
    .map(c => c.title)
)

function statusColor(status: string) {
  if (status === 'active') return 'success' as const
  if (status === 'archived') return 'error' as const
  return 'neutral' as const
}

function formatPrice(extracted: number, raw: string | null, currency: string | null) {
  if (raw) return raw
  return [currency, extracted].filter(Boolean).join(' ')
}

function priceDiff(competitorPrice: number | null): { label: string; color: string } | null {
  const ourPrice = product.value?.price
  if (ourPrice == null || competitorPrice == null) return null
  const diff = Number(ourPrice) - competitorPrice
  if (diff === 0) return null
  const sign = diff > 0 ? '+' : ''
  return {
    label: `${sign}${diff.toFixed(2)}`,
    color: diff > 0 ? 'text-red-500' : 'text-blue-500'
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-10">
    <template v-if="pending">
      <USkeleton class="mb-6 h-8 w-64" />
      <USkeleton class="mb-6 h-64 w-full rounded-xl" />
      <div class="grid gap-6 lg:grid-cols-2">
        <USkeleton class="h-80 w-full rounded-xl" />
        <USkeleton class="h-80 w-full rounded-xl" />
      </div>
    </template>

    <div v-else-if="!product" class="py-20 text-center">
      <p class="text-sm font-medium text-highlighted">Product not found</p>
      <UButton class="mt-4" variant="soft" color="neutral" @click="navigateTo('/products')">
        Back to products
      </UButton>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="mb-6 flex items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <UButton variant="ghost" color="neutral" icon="i-lucide-arrow-left" @click="navigateTo('/products')" />
          <UBadge :color="statusColor(product.status)" variant="soft">
            {{ product.status }}
          </UBadge>
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">
            {{ product.title || 'Unnamed product' }}
          </h1>
        </div>
        <UButton
          variant="soft"
          color="primary"
          icon="i-lucide-refresh-cw"
          :loading="competitorsPending"
          @click="refreshCompetitors"
        >
          New Competitors
        </UButton>
      </div>

      <!-- Competitors — full width, at top -->
      <UCard class="mb-6">
        <template #header>
          <span>Competitors</span>
        </template>

        <!-- Saved competitors (top) -->
        <div v-if="savedCompetitors.length" class="overflow-hidden rounded-lg border border-default/50">
          <table class="w-full table-fixed text-sm">
            <thead>
              <tr class="border-b border-default/50 bg-default/20">
                <th class="w-[60px] px-3 py-2" />
                <th class="w-[250px] px-3 py-2 text-left font-medium text-toned">Product</th>
                <th class="w-[200px] px-3 py-2 text-left font-medium text-toned">Store</th>
                <th class="w-[100px] px-3 py-2 text-left font-medium text-toned">Created</th>
                <th class="px-3 py-2 text-right font-medium text-toned">Price</th>
                <th class="px-3 py-2 text-right font-medium text-toned">Diff</th>
                <th class="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in savedCompetitors"
                :key="c.id"
                class="border-b border-default/30 last:border-0"
              >
                <td class="px-3 py-2">
                  <img
                    v-if="c.thumbnail"
                    :src="c.thumbnail"
                    :alt="c.title"
                    class="h-[60px] w-[60px] rounded object-contain bg-white"
                  />
                  <div v-else class="h-[60px] w-[60px] rounded bg-default/20" />
                </td>
                <td class="overflow-hidden px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <a
                      :href="c.productLink"
                      :title="c.title"
                      target="_blank"
                      rel="noopener"
                      class="min-w-0 truncate text-primary-600 hover:underline"
                      @click.stop
                    >
                      {{ c.title }}
                    </a>
                    <UBadge v-if="c.tag" size="xs" color="neutral" variant="soft" class="shrink-0">
                      {{ c.tag }}
                    </UBadge>
                  </div>
                </td>
                <td class="truncate px-3 py-2 text-toned" :title="c.source">{{ c.source }}</td>
                <td class="px-3 py-2 text-toned">{{ new Date(c.createdAt).toLocaleDateString() }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span class="font-medium text-highlighted">
                    {{ formatPrice(c.extractedPrice ?? 0, c.rawPrice, c.currency) }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span v-if="priceDiff(c.extractedPrice)" :class="priceDiff(c.extractedPrice)!.color" class="font-medium">
                    {{ priceDiff(c.extractedPrice)!.label }}
                  </span>
                  <span v-else class="text-toned">—</span>
                </td>
                <td class="px-2 py-2 text-right">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-trash-2"
                    :loading="deletingId === c.id"
                    @click="deleteCompetitor(c.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Price charts -->
        <div v-if="chartPrices.length >= 2" class="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p class="mb-1 text-xs font-medium text-toned">Scatter Plot</p>
            <div class="rounded-lg border border-default/50 bg-default/5 p-2">
              <PriceScatterChart :prices="chartPrices" :labels="chartLabels" :our-price="product.price" />
            </div>
          </div>
          <div>
            <p class="mb-1 text-xs font-medium text-toned">Price Distribution</p>
            <div class="rounded-lg border border-default/50 bg-default/5 p-2">
              <PriceBoxChart :prices="chartPrices" :our-price="product.price" />
            </div>
          </div>
        </div>

        <!-- Divider between saved and new/cached -->
        <div v-if="savedCompetitors.length && competitors.length" class="my-4 flex items-center gap-3">
          <div class="h-px flex-1 bg-default/40" />
          <span class="text-xl font-medium text-toned uppercase tracking-wide">New / Cached</span>
          <div class="h-px flex-1 bg-default/40" />
        </div>

        <!-- New / cached actions -->
        <div v-if="competitors.length" class="mb-2 flex items-center justify-end gap-2">
          <p v-if="saveSuccess" class="text-xs text-success-600">Saved!</p>
          <p v-if="saveError" class="text-xs text-error-600">{{ saveError }}</p>
          <UButton size="xs" variant="soft" color="error" icon="i-lucide-trash-2" @click="clearCompetitors">
            Delete
          </UButton>
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

        <!-- New / cached competitors (bottom) -->
        <div v-if="competitorsPending" class="space-y-2">
          <USkeleton v-for="i in 3" :key="i" class="h-12 w-full" />
        </div>

        <div v-else-if="!competitors.length && !savedCompetitors.length" class="py-6 text-center text-sm text-toned">
          No competitors found — click New Competitors to search.
        </div>

        <div v-else-if="competitors.length" class="overflow-hidden rounded-lg border border-default/50">
          <table class="w-full table-fixed text-sm">
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
                <th class="w-[60px] px-3 py-2" />
                <th class="w-[250px] px-3 py-2 text-left font-medium text-toned">Product</th>
                <th class="w-[200px] px-3 py-2 text-left font-medium text-toned">Store</th>
                <th class="px-3 py-2 text-right font-medium text-toned">Price</th>
                <th class="px-3 py-2 text-right font-medium text-toned">Diff</th>
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
                    class="h-[60px] w-[60px] rounded object-contain bg-white"
                  />
                  <div v-else class="h-[60px] w-[60px] rounded bg-default/20" />
                </td>
                <td class="overflow-hidden px-3 py-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <a
                      :href="c.link"
                      :title="c.title"
                      target="_blank"
                      rel="noopener"
                      class="min-w-0 truncate text-primary-600 hover:underline"
                      @click.stop
                    >
                      {{ c.title }}
                    </a>
                    <UBadge v-if="c.tag" size="xs" color="neutral" variant="soft" class="shrink-0">
                      {{ c.tag }}
                    </UBadge>
                  </div>
                </td>
                <td class="truncate px-3 py-2 text-toned" :title="c.source">{{ c.source }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span class="font-medium text-highlighted">
                    {{ formatPrice(c.extractedPrice, c.rawPrice, c.currency) }}
                  </span>
                  <span v-if="c.rawOldPrice" class="ml-1 text-xs text-toned line-through">
                    {{ c.rawOldPrice }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <span v-if="priceDiff(c.extractedPrice)" :class="priceDiff(c.extractedPrice)!.color" class="font-medium">
                    {{ priceDiff(c.extractedPrice)!.label }}
                  </span>
                  <span v-else class="text-toned">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <!-- Product info grid -->
      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Left: image gallery -->
        <div class="space-y-3">
          <div class="overflow-hidden rounded-xl border border-default/70 bg-white/85">
            <img
              v-if="activeImage"
              :src="activeImage"
              :alt="activeImageAlt"
              class="w-full object-contain p-4"
              style="max-height: 320px"
            />
            <div v-else class="flex h-64 items-center justify-center text-sm text-toned">
              No image
            </div>
          </div>

          <!-- Thumbnail strip -->
          <div v-if="images.length > 1" class="flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="(img, i) in images"
              :key="img.id"
              class="shrink-0 overflow-hidden rounded-lg border-2 transition-colors"
              :class="i === selectedImageIndex ? 'border-primary-500' : 'border-transparent hover:border-default'"
              @click="selectedImageIndex = i"
            >
              <img :src="img.src" :alt="img.alt" class="h-14 w-14 object-cover bg-white" />
            </button>
          </div>
        </div>

        <!-- Right: details -->
        <div class="space-y-4">
          <UCard>
            <template #header>Pricing</template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-toned">Price</dt>
                <dd class="font-medium text-highlighted">
                  <span v-if="product.price != null">
                    {{ product.currency ? `${product.currency} ` : '' }}{{ Number(product.price).toFixed(2) }}
                  </span>
                  <span v-else>—</span>
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Inventory</dt>
                <dd class="text-highlighted">{{ product.inventoryQuantity ?? '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>Details</template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between">
                <dt class="text-toned">SKU</dt>
                <dd class="font-mono text-highlighted">{{ product.sku || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Brand</dt>
                <dd class="text-highlighted">{{ product.brand || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Weight</dt>
                <dd class="text-highlighted">
                  <span v-if="product.weight != null">{{ product.weight }} {{ product.weightUnit }}</span>
                  <span v-else>—</span>
                </dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Tags</dt>
                <dd class="text-highlighted">{{ product.tags || '—' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-toned">Last updated</dt>
                <dd class="text-highlighted">{{ new Date(product.updatedAt).toLocaleString() }}</dd>
              </div>
            </dl>
          </UCard>
        </div>
      </div>

      <!-- Description -->
      <UCard v-if="product.description" class="mt-6">
        <template #header>Description</template>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="prose prose-sm max-w-none text-sm text-highlighted" v-html="product.description" />
      </UCard>
    </template>
  </div>
</template>
