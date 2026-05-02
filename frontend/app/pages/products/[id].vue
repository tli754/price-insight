<script setup lang="ts">
import type { ProductRow } from '~/shared/types/product'

const route = useRoute()
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { data, pending } = await useFetch<{ item: ProductRow }>(
  `${apiUrl}/api/products/${route.params.id}`,
  { lazy: true }
)

const product = computed(() => data.value?.item ?? null)

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
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-10">
    <template v-if="pending">
      <USkeleton class="mb-6 h-8 w-64" />
      <div class="grid gap-6 lg:grid-cols-2">
        <USkeleton class="h-80 w-full rounded-xl" />
        <USkeleton class="h-80 w-full rounded-xl" />
      </div>
    </template>

    <div v-else-if="!product" class="py-20 text-center">
      <p class="text-sm font-medium text-highlighted">Product not found</p>
      <UButton class="mt-4" variant="soft" color="neutral" @click="navigateTo('/')">
        Back to products
      </UButton>
    </div>

    <template v-else>
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
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
            {{ product.productName || 'Unnamed product' }}
          </h1>
          <a
            :href="product.sourceUrl"
            target="_blank"
            rel="noopener"
            class="mt-1 inline-block text-sm text-primary-600 hover:underline"
          >
            {{ product.sourceUrl }}
          </a>
        </div>
        <UButton variant="soft" color="neutral" @click="navigateTo('/')">
          Back
        </UButton>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
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
    </template>
  </div>
</template>
