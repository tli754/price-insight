export interface SavedCompetitor {
  id: number
  title: string
  source: string
  thumbnail: string | null
  productLink: string
  currency: string | null
  tag: string | null
  createdAt: string
  rawPrice: string | null
  extractedPrice: number | null
  capturedAt: string | null
}

export interface CompetitorResult {
  title: string
  externalId: string | null
  rawPrice: string | null
  extractedPrice: number
  rawOldPrice: string | null
  extractedOldPrice: number | null
  currency: string | null
  source: string
  link: string
  thumbnail: string | null
  tag: string | null
}

export interface FetchCompetitorsResponse {
  cached: boolean
  query: string
  competitors: CompetitorResult[]
}

export interface CompetitorItem {
  id: number
  title: string
  source: string
  thumbnail: string | null
  productLink: string
  currency: string | null
  tag: string | null
  country: string | null
  googlePosition: number | null
  status: string
  rating: number | null
  reviewCount: number | null
  shippingRaw: string | null
  shippingExtracted: number | null
  extractedOldPrice: number | null
  createdAt: string
  rawPrice: string | null
  extractedPrice: number | null
  capturedAt: string | null
}

export interface CompetitorsByProductResponse {
  items: CompetitorItem[]
}

export type CompetitorProductTableRow = {
  id: string
  thumbnail: string | null
  title: string
  productLink: string
  source: string
  googlePosition: number | null
  currentPrice: number | null
  currency: string
  lastCheckedAt: string | null
  matchedProduct: { id: string; title: string } | null
}

export interface CompetitorListItem {
  id: number
  name: string
  state: string
  thumbnail: string | null
  createdAt: string
  matchedProducts: number
  lastScraped: string | null
}

export interface CompetitorDetailProduct {
  id: number
  thumbnail: string | null
  title: string
  productLink: string
  source: string
  googlePosition: number | null
  currency: string | null
  currentPrice: number | null
  lastCheckedAt: string | null
  matchedProductId: number | null
  matchedProductTitle: string | null
}

export interface CompetitorDetailResponse {
  competitor: { id: number; name: string; state: string }
  items: CompetitorDetailProduct[]
}
