<script setup lang="ts">
import type { OrderDetailResponse } from '~/shared/types/order'
import { mockOrders } from '~/data/mock-orders'

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

// ── Mock sync overlay (keyed by order number) ──────────────────────────────
const mockOrder = computed(() =>
  order.value ? mockOrders.find(o => o.orderNumber === order.value!.orderNumber) ?? null : null
)

// ── Helpers ────────────────────────────────────────────────────────────────
const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Auckland',
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

const syncStatusColor = (status: string) => {
  if (status === 'synced') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'error'
  return 'neutral'
}

const syncHistoryStatusColor = (status: string) => {
  if (status === 'processed' || status === 'received') return 'success'
  if (status === 'queued') return 'warning'
  if (status === 'failed') return 'error'
  return 'neutral'
}

// ── Pricing analysis impact (computed from line items) ─────────────────────
const pricingImpact = computed(() => {
  const linked = items.value.filter(i => i.productId != null)
  const units = linked.reduce((s, i) => s + i.quantity, 0)
  const revenue = linked.reduce((s, i) =>
    s + (i.unitPrice ?? 0) * i.quantity - (i.totalDiscount ?? 0), 0)
  const discounted = linked.filter(i => (i.totalDiscount ?? 0) > 0).length
  const unlinked = items.value.filter(i => i.productId == null).length
  return { units, revenue, discounted, unlinked }
})

const itemColumns = [
  { accessorKey: 'title', header: 'Product' },
  { accessorKey: 'sku', header: 'SKU' },
  { accessorKey: 'quantity', header: 'Qty' },
  { accessorKey: 'unitPrice', header: 'Unit Price' },
  { accessorKey: 'totalDiscount', header: 'Discount' },
  { accessorKey: 'lineTotal', header: 'Line Total' },
  { accessorKey: 'mapping', header: 'Mapping' },
]

const itemsWithTotal = computed(() =>
  items.value.map(i => ({
    ...i,
    lineTotal: i.unitPrice != null ? i.unitPrice * i.quantity - (i.totalDiscount ?? 0) : null,
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

    <!-- Loading -->
    <template v-if="pending">
      <div class="space-y-4">
        <USkeleton class="h-40 w-full" />
        <USkeleton class="h-32 w-full" />
        <USkeleton class="h-48 w-full" />
      </div>
    </template>

    <template v-else-if="order">

      <!-- Order header -->
      <UCard class="mb-4">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-semibold text-gray-900">Order #{{ order.orderNumber }}</h2>
              <UBadge v-if="order.financialStatus" :color="financialColor(order.financialStatus)" variant="soft">
                {{ order.financialStatus }}
              </UBadge>
              <UBadge :color="fulfillmentColor(order.fulfillmentStatus)" variant="soft">
                {{ order.fulfillmentStatus ?? 'unfulfilled' }}
              </UBadge>
              <template v-if="mockOrder">
                <UBadge :color="syncStatusColor(mockOrder.syncStatus)" variant="soft">
                  {{ mockOrder.syncStatus === 'synced' ? `Synced via ${mockOrder.syncSource === 'webhook' ? 'Webhook' : mockOrder.syncSource === 'scheduled_2am' ? '2 AM Job' : 'Manual'}` : mockOrder.syncStatus }}
                </UBadge>
              </template>
            </div>
            <UButton size="sm" variant="soft" icon="i-lucide-refresh-cw" disabled>
              Resync Order
            </UButton>
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
            <dd class="text-base font-semibold">{{ fmt(order.totalPrice, order.currency) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Processed</dt>
            <dd class="font-medium">{{ formatDate(order.processedAt) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Created</dt>
            <dd class="font-medium">{{ formatDate(order.shopifyCreatedAt) }}</dd>
          </div>
          <div v-if="order.cancelledAt">
            <dt class="text-gray-500">Cancelled</dt>
            <dd class="font-medium text-red-600">{{ formatDate(order.cancelledAt) }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Pricing analysis impact -->
      <UCard class="mb-4">
        <template #header>
          <h2 class="font-semibold text-gray-900">Pricing Analysis Impact</h2>
        </template>
        <div class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div class="rounded-lg bg-gray-50 px-4 py-3">
            <p class="text-gray-500">Linked Units</p>
            <p class="mt-1 text-xl font-semibold text-gray-900">{{ pricingImpact.units }}</p>
          </div>
          <div class="rounded-lg bg-gray-50 px-4 py-3">
            <p class="text-gray-500">Product Revenue</p>
            <p class="mt-1 text-xl font-semibold text-gray-900">
              {{ order.currency ?? 'NZD' }} {{ pricingImpact.revenue.toFixed(2) }}
            </p>
          </div>
          <div class="rounded-lg px-4 py-3" :class="pricingImpact.discounted > 0 ? 'bg-amber-50' : 'bg-gray-50'">
            <p class="text-gray-500">Discounted Lines</p>
            <p class="mt-1 text-xl font-semibold" :class="pricingImpact.discounted > 0 ? 'text-amber-700' : 'text-gray-900'">
              {{ pricingImpact.discounted }}
            </p>
          </div>
          <div class="rounded-lg px-4 py-3" :class="pricingImpact.unlinked > 0 ? 'bg-red-50' : 'bg-gray-50'">
            <p class="text-gray-500">Unlinked Items</p>
            <p class="mt-1 text-xl font-semibold" :class="pricingImpact.unlinked > 0 ? 'text-red-700' : 'text-gray-900'">
              {{ pricingImpact.unlinked }}
            </p>
          </div>
        </div>
      </UCard>

      <!-- Line items -->
      <UCard class="mb-4">
        <template #header>
          <h2 class="font-semibold text-gray-900">Items ({{ items.length }})</h2>
        </template>
        <UTable v-if="items.length" :data="itemsWithTotal" :columns="itemColumns">
          <template #sku-cell="{ row }">
            <span class="font-mono text-sm text-gray-500">{{ row.original.sku ?? '—' }}</span>
          </template>
          <template #unitPrice-cell="{ row }">{{ fmt(row.original.unitPrice) }}</template>
          <template #totalDiscount-cell="{ row }">
            <span :class="(row.original.totalDiscount ?? 0) > 0 ? 'text-amber-700' : ''">
              {{ fmt(row.original.totalDiscount) }}
            </span>
          </template>
          <template #lineTotal-cell="{ row }">
            <span class="font-medium">{{ fmt(row.original.lineTotal) }}</span>
          </template>
          <template #mapping-cell="{ row }">
            <div>
              <UBadge
                v-if="row.original.productId != null"
                color="success"
                variant="soft"
                size="sm"
              >Linked</UBadge>
              <UBadge
                v-else
                color="error"
                variant="soft"
                size="sm"
              >Unlinked</UBadge>
              <p v-if="row.original.productTitle" class="mt-0.5 text-xs text-gray-500">
                {{ row.original.productTitle }}
              </p>
              <p v-else class="mt-0.5 text-xs text-gray-400">No local product match</p>
            </div>
          </template>
        </UTable>
        <p v-else class="text-sm text-gray-400">No items.</p>
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
          <div v-if="customer.tags">
            <dt class="text-gray-500">Tags</dt>
            <dd class="font-medium">{{ customer.tags }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Shipping address -->
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
            <dt class="text-gray-500">Country</dt>
            <dd class="font-medium">{{ address.country ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">ZIP</dt>
            <dd class="font-medium">{{ address.zip ?? '—' }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Sync history (mock) -->
      <UCard v-if="mockOrder" class="mb-4">
        <template #header>
          <h2 class="font-semibold text-gray-900">Sync History</h2>
        </template>
        <ul class="space-y-2">
          <li
            v-for="event in mockOrder.syncHistory"
            :key="event.id"
            class="flex items-start gap-3 text-sm"
          >
            <UBadge :color="syncHistoryStatusColor(event.status)" variant="soft" size="sm" class="mt-0.5 shrink-0">
              {{ event.status }}
            </UBadge>
            <div>
              <p class="font-medium text-gray-800">{{ event.message }}</p>
              <p class="text-xs text-gray-400">
                {{ formatDate(event.time) }} ·
                {{ event.source === 'webhook' ? 'Webhook' : event.source === 'scheduled_2am' ? '2 AM Job' : 'Manual' }}
                <template v-if="event.topic"> · {{ event.topic }}</template>
              </p>
            </div>
          </li>
        </ul>
      </UCard>

      <!-- Attribution -->
      <UCard v-if="order.sourceName || order.referringSite || order.landingSite" class="mb-4">
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
