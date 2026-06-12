export interface ProductImage {
  id: number
  productId: number
  externalId: number
  position: number
  src: string
  alt: string
  width: number | null
  height: number | null
}

export interface ProductRow {
  id: number
  externalId: number
  status: string
  thumbnail: string | null
  price: number | null
  currency: string | null
  handle: string | null
  title: string | null
  brand: string | null
  inventoryQuantity: number | null
  weightUnit: string | null
  weight: number | null
  sku: string | null
  tags: string | null
  description: string | null
  createdAt: string
  updatedAt: string
  // Sales stats (from order_items, last 7/30/90 days)
  sold7d?: number
  revenue7d?: number
  sold30d?: number
  revenue30d?: number
  sold90d?: number
  revenue90d?: number
  // Competitor price stats (confirmed competitors only)
  avgCompetitorPrice?: number
  confirmedCompetitorCount?: number
  // Only present on GET /api/products/:id
  images?: ProductImage[]
}
