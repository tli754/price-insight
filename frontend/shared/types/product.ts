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
  createdAt: string
  updatedAt: string
}
