export type MockOrderLineItem = {
  id: string
  title: string
  sku: string | null
  variantTitle: string | null
  quantity: number
  unitPrice: number
  discountTotal: number
  lineTotal: number
  currency: 'NZD'
  mappingStatus: 'linked' | 'unlinked' | 'sku_missing' | 'product_deleted'
  priceInsightProductId?: string
  priceInsightProductName?: string
}

export type MockSyncHistoryItem = {
  id: string
  time: string
  source: 'webhook' | 'scheduled_2am' | 'manual'
  topic?: 'orders/create' | 'orders/updated' | 'orders/paid' | 'orders/cancelled' | 'refunds/create'
  status: 'received' | 'queued' | 'processed' | 'failed' | 'skipped'
  message: string
}

export type MockOrder = {
  id: string
  orderNumber: string
  shopifyOrderId: string
  createdAt: string
  updatedAt: string
  customerLabel: string
  itemCount: number
  totalQuantity: number
  currency: 'NZD'
  subtotal: number
  discountTotal: number
  shippingTotal: number
  taxTotal: number
  total: number
  paymentStatus: 'paid' | 'pending' | 'refunded' | 'partially_refunded' | 'voided'
  fulfillmentStatus: 'unfulfilled' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'
  syncStatus: 'synced' | 'pending' | 'failed' | 'skipped'
  syncSource: 'webhook' | 'scheduled_2am' | 'manual'
  lineItems: MockOrderLineItem[]
  syncHistory: MockSyncHistoryItem[]
}
