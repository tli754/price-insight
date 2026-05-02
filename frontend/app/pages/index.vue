<script setup lang="ts">
import type { ProductRow } from '~/shared/types/product'

definePageMeta({ middleware: ['auth'] })

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { data: productsData, pending, refresh } = await useFetch<{ items: ProductRow[] }>(
  `${apiUrl}/api/products`,
  { lazy: true }
)

const url = ref('')
const extracting = ref(false)
const extractError = ref('')

async function extract() {
  if (!url.value.trim()) return
  extracting.value = true
  extractError.value = ''
  try {
    await $fetch(`${apiUrl}/api/products/extract`, {
      method: 'POST',
      body: { productUrl: url.value.trim() }
    })
    url.value = ''
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { error?: { message?: string } } }
    extractError.value = err.data?.error?.message ?? 'Extraction failed. Please try again.'
  } finally {
    extracting.value = false
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString()
}

function statusColor(status: string) {
  if (status === 'approved') return 'success' as const
  if (status === 'deleted') return 'error' as const
  return 'warning' as const
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-6 py-10">
    <section class="mb-8">
      <h1 class="mb-1 text-2xl font-semibold tracking-tight text-highlighted">
        Products
      </h1>
      <p class="mb-5 text-sm text-toned">
        Submit a product URL to extract and review.
      </p>
      <div class="flex gap-3">
        <UInput
          v-model="url"
          class="flex-1"
          size="lg"
          placeholder="https://shop.example.com/products/..."
          :disabled="extracting"
          @keyup.enter="extract"
        />
        <UButton size="lg" :loading="extracting" @click="extract">
          Extract
        </UButton>
      </div>
      <UAlert
        v-if="extractError"
        class="mt-4"
        color="error"
        variant="soft"
        title="Extraction failed"
        :description="extractError"
        :close-button="{ icon: 'i-lucide-x', color: 'error', variant: 'ghost' }"
        @close="extractError = ''"
      />
    </section>

    <div class="overflow-hidden rounded-xl border border-default/70 bg-white/85 shadow-sm">
      <template v-if="pending">
        <div class="space-y-3 p-4">
          <USkeleton v-for="i in 5" :key="i" class="h-10 w-full" />
        </div>
      </template>

      <template v-else>
        <div
          v-if="!productsData?.items?.length"
          class="flex flex-col items-center justify-center py-16 text-center"
        >
          <p class="text-sm font-medium text-highlighted">No products yet</p>
          <p class="mt-1 text-sm text-toned">Enter a product URL above to get started.</p>
        </div>

        <table v-else class="w-full text-sm">
          <thead>
            <tr class="border-b border-default/70 bg-default/30">
              <th class="px-4 py-3 text-left font-medium text-toned">Name</th>
              <th class="px-4 py-3 text-left font-medium text-toned">Brand</th>
              <th class="px-4 py-3 text-left font-medium text-toned">Price</th>
              <th class="px-4 py-3 text-left font-medium text-toned">Status</th>
              <th class="px-4 py-3 text-left font-medium text-toned">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="product in productsData.items"
              :key="product.id"
              class="cursor-pointer border-b border-default/30 transition-colors last:border-0 hover:bg-default/20"
              @click="navigateTo('/products/' + product.id)"
            >
              <td class="px-4 py-3 font-medium text-highlighted">
                {{ product.productName || '—' }}
              </td>
              <td class="px-4 py-3 text-toned">{{ product.brand || '—' }}</td>
              <td class="px-4 py-3 text-toned">
                {{ product.price != null ? `${product.currency || ''} ${product.price}`.trim() : '—' }}
              </td>
              <td class="px-4 py-3">
                <UBadge :color="statusColor(product.status)" variant="soft" size="sm">
                  {{ product.status }}
                </UBadge>
              </td>
              <td class="px-4 py-3 text-toned">{{ formatDate(product.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>
