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
  // Only present on GET /api/products/:id
  images?: ProductImage[]
}
