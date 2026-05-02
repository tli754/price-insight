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
