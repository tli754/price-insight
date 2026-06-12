export interface OrderListItem {
  id: number
  shopifyOrderId: number
  orderNumber: string
  email: string | null
  customerFirstName: string | null
  customerLastName: string | null
  financialStatus: string | null
  fulfillmentStatus: string | null
  currency: string | null
  totalPrice: number | null
  totalShipping: number | null
  itemCount: number
  shopifyCreatedAt: string | null
}

export interface OrderListResponse {
  items: OrderListItem[]
  total: number
  totalSales: number | null
  page: number
  limit: number
}

export interface OrderCustomer {
  id: number
  shopifyCustomerId: number
  email: string
  firstName: string
  lastName: string
  phone: string | null
  state: string | null
  currency: string | null
  verifiedEmail: boolean | null
  tags: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderAddress {
  id: number
  customerId: number
  shopifyAddressId: number | null
  addressName: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  country: string | null
  zip: string | null
  createdAt: string
}

export interface OrderItem {
  id: number
  orderId: number
  productId: number | null
  shopifyLineItemId: number
  shopifyProductId: number | null
  shopifyVariantId: number | null
  title: string
  variantTitle: string | null
  sku: string | null
  quantity: number
  currentQuantity: number | null
  unitPrice: number | null
  totalDiscount: number | null
  createdAt: string
  productTitle: string | null
}

export interface OrderOrder {
  id: number
  shopifyOrderId: number
  customerId: number | null
  orderNumber: string
  email: string | null
  financialStatus: string | null
  fulfillmentStatus: string | null
  currency: string | null
  subtotalPrice: number | null
  totalPrice: number | null
  totalTax: number | null
  totalShipping: number | null
  totalDiscounts: number | null
  sourceName: string | null
  referringSite: string | null
  landingSite: string | null
  processedAt: string | null
  totalWeight: number | null
  cancelledAt: string | null
  shopifyCreatedAt: string | null
  shopifyUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderDetail {
  order: OrderOrder
  customer: OrderCustomer | null
  address: OrderAddress | null
  items: OrderItem[]
}

export interface OrderDetailResponse {
  item: OrderDetail
}

export interface ProductSalesSummary {
  totalQty: number
  totalRevenue: number
  avgUnitPrice: number | null
  orderCount: number
  lastSoldAt: string | null
  sold7d: number
  sold30d: number
  sold90d: number
  revenue7d: number
  revenue30d: number
  revenue90d: number
}

export interface ProductSalesMonthly {
  month: string
  qty: number
  revenue: number
}

export interface ProductSalesLineItem {
  orderId: number
  orderNumber: string
  processedAt: string | null
  customerFirstName: string | null
  customerLastName: string | null
  financialStatus: string | null
  fulfillmentStatus: string | null
  currency: string | null
  qty: number
  unitPrice: number | null
  lineTotal: number
}

export interface ProductSalesHistoryResponse {
  summary: ProductSalesSummary
  monthly: ProductSalesMonthly[]
  items: ProductSalesLineItem[]
  total: number
}
