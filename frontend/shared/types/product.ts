export interface ProductRow {
  id: number
  externalId: string | null
  status: string
  sourceUrl: string
  productName: string | null
  brand: string | null
  modelOrVariant: string | null
  thumbnail: string | null
  price: number | null
  salesPrice: number | null
  currency: string | null
  availability: string | null
  sellerOrStore: string | null
  productCategory: string | null
  keySpecs: string[] | null
  confidence: string | null
  lastExtractedAt: string | null
  createdAt: string
  updatedAt: string
}
