<script setup lang="ts">
import type { OrderDetailResponse } from '~/shared/types/order'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()

const { data, pending } = await useFetch<OrderDetailResponse>(
  `/api/orders/${route.params.id}`,
  { lazy: true }
)

const detail = computed(() => data.value?.item ?? null)
const order = computed(() => detail.value?.order ?? null)
const customer = computed(() => detail.value?.customer ?? null)
const address = computed(() => detail.value?.address ?? null)
const items = computed(() => detail.value?.items ?? [])

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland'
  })
}

const fmt = (val: number | null | undefined, currency?: string | null) => {
  if (val == null) return '—'
  return currency ? `${currency} ${Number(val).toFixed(2)}` : Number(val).toFixed(2)
}

const financialColor = (status: string | null) => {
  if (status === 'paid') return 'success'
  if (status === 'refunded' || status === 'voided') return 'error'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

const fulfillmentColor = (status: string | null) => {
  if (status === 'fulfilled') return 'success'
  if (status === 'partial') return 'warning'
  return 'neutral'
}

const itemColumns = [
  { accessorKey: 'title', header: 'Product' },
  { accessorKey: 'sku', header: 'SKU' },
  { accessorKey: 'quantity', header: 'Qty' },
  { accessorKey: 'currentQuantity', header: 'Current Qty' },
  { accessorKey: 'unitPrice', header: 'Unit Price' },
  { accessorKey: 'totalDiscount', header: 'Discount' },
  { accessorKey: 'lineTotal', header: 'Line Total' },
  { accessorKey: 'productTitle', header: 'Local Match' },
]

const itemsWithTotal = computed(() =>
  items.value.map(i => ({
    ...i,
    lineTotal: i.unitPrice != null ? i.unitPrice * i.quantity - (i.totalDiscount ?? 0) : null
  }))
)
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-6">
    <div class="mb-4">
      <NuxtLink to="/orders" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <UIcon name="i-lucide-arrow-left" class="h-4 w-4" />
        Back to Orders
      </NuxtLink>
    </div>

    <!-- Loading skeleton -->
    <template v-if="pending">
      <div class="space-y-4">
        <USkeleton class="h-40 w-full" />
        <USkeleton class="h-32 w-full" />
        <USkeleton class="h-48 w-full" />
      </div>
    </template>

    <template v-else-if="order">
      <!-- Order Summary -->
      <UCard class="mb-4">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-gray-900">Order #{{ order.orderNumber }}</h2>
            <div class="flex items-center gap-2">
              <UBadge v-if="order.financialStatus" :color="financialColor(order.financialStatus)" variant="soft">
                {{ order.financialStatus }}
              </UBadge>
              <UBadge :color="fulfillmentColor(order.fulfillmentStatus)" variant="soft">
                {{ order.fulfillmentStatus ?? 'unfulfilled' }}
              </UBadge>
            </div>
          </div>
        </template>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt class="text-gray-500">Email</dt>
            <dd class="font-medium">{{ order.email ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Currency</dt>
            <dd class="font-medium">{{ order.currency ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Subtotal</dt>
            <dd class="font-medium">{{ fmt(order.subtotalPrice, order.currency) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Tax</dt>
            <dd class="font-medium">{{ fmt(order.totalTax, order.currency) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Shipping</dt>
            <dd class="font-medium">{{ fmt(order.totalShipping, order.currency) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Discounts</dt>
            <dd class="font-medium">{{ fmt(order.totalDiscounts, order.currency) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Total</dt>
            <dd class="font-semibold">{{ fmt(order.totalPrice, order.currency) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Weight (g)</dt>
            <dd class="font-medium">{{ order.totalWeight ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Processed At</dt>
            <dd class="font-medium">{{ formatDate(order.processedAt) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Created</dt>
            <dd class="font-medium">{{ formatDate(order.shopifyCreatedAt) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Updated</dt>
            <dd class="font-medium">{{ formatDate(order.shopifyUpdatedAt) }}</dd>
          </div>
          <div v-if="order.cancelledAt">
            <dt class="text-gray-500">Cancelled</dt>
            <dd class="font-medium text-red-600">{{ formatDate(order.cancelledAt) }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Customer -->
      <UCard v-if="customer" class="mb-4">
        <template #header>
          <h2 class="font-semibold text-gray-900">Customer</h2>
        </template>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt class="text-gray-500">Name</dt>
            <dd class="font-medium">{{ customer.firstName }} {{ customer.lastName }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Email</dt>
            <dd class="font-medium">{{ customer.email }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Phone</dt>
            <dd class="font-medium">{{ customer.phone ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">State</dt>
            <dd class="font-medium">{{ customer.state ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Currency</dt>
            <dd class="font-medium">{{ customer.currency ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Verified Email</dt>
            <dd class="font-medium">{{ customer.verifiedEmail == null ? '—' : customer.verifiedEmail ? 'Yes' : 'No' }}</dd>
          </div>
          <div v-if="customer.tags">
            <dt class="text-gray-500">Tags</dt>
            <dd class="font-medium">{{ customer.tags }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Address -->
      <UCard v-if="address" class="mb-4">
        <template #header>
          <h2 class="font-semibold text-gray-900">Shipping Address</h2>
        </template>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div v-if="address.addressName">
            <dt class="text-gray-500">Name</dt>
            <dd class="font-medium">{{ address.addressName }}</dd>
          </div>
          <div v-if="address.company">
            <dt class="text-gray-500">Company</dt>
            <dd class="font-medium">{{ address.company }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Address</dt>
            <dd class="font-medium">
              {{ [address.address1, address.address2].filter(Boolean).join(', ') || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">City</dt>
            <dd class="font-medium">{{ address.city ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Province</dt>
            <dd class="font-medium">{{ address.province ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Country</dt>
            <dd class="font-medium">{{ address.country ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">ZIP</dt>
            <dd class="font-medium">{{ address.zip ?? '—' }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Order Items -->
      <UCard class="mb-4">
        <template #header>
          <h2 class="font-semibold text-gray-900">Items ({{ items.length }})</h2>
        </template>
        <UTable v-if="items.length" :data="itemsWithTotal" :columns="itemColumns">
          <template #sku-cell="{ row }">
            <span class="font-mono text-sm text-gray-500">{{ row.original.sku ?? '—' }}</span>
          </template>
          <template #currentQuantity-cell="{ row }">
            {{ row.original.currentQuantity ?? '—' }}
          </template>
          <template #unitPrice-cell="{ row }">
            {{ fmt(row.original.unitPrice) }}
          </template>
          <template #totalDiscount-cell="{ row }">
            {{ fmt(row.original.totalDiscount) }}
          </template>
          <template #lineTotal-cell="{ row }">
            {{ fmt(row.original.lineTotal) }}
          </template>
          <template #productTitle-cell="{ row }">
            <span v-if="row.original.productTitle" class="text-success-600 text-sm">
              {{ row.original.productTitle }}
            </span>
            <span v-else class="text-gray-400">—</span>
          </template>
        </UTable>
        <p v-else class="text-sm text-gray-400">No items.</p>
      </UCard>

      <!-- Attribution -->
      <UCard v-if="order.sourceName || order.referringSite || order.landingSite">
        <template #header>
          <h2 class="font-semibold text-gray-900">Attribution</h2>
        </template>
        <dl class="grid grid-cols-1 gap-y-3 text-sm">
          <div v-if="order.sourceName">
            <dt class="text-gray-500">Source</dt>
            <dd class="font-medium">{{ order.sourceName }}</dd>
          </div>
          <div v-if="order.referringSite">
            <dt class="text-gray-500">Referring Site</dt>
            <dd class="font-medium break-all">{{ order.referringSite }}</dd>
          </div>
          <div v-if="order.landingSite">
            <dt class="text-gray-500">Landing Site</dt>
            <dd class="font-medium break-all">{{ order.landingSite }}</dd>
          </div>
        </dl>
      </UCard>
    </template>

    <!-- Not found -->
    <UCard v-else class="py-16 text-center">
      <p class="text-sm font-semibold text-highlighted">Order not found</p>
      <NuxtLink to="/orders" class="mt-3 inline-block text-sm text-primary hover:underline">
        Back to orders
      </NuxtLink>
    </UCard>
  </div>
</template>
