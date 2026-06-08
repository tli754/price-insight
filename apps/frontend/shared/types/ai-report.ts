export type ReportType = 'pricing' | 'competitorMatch' | 'salesTrend' | 'listingImprovement'

export interface PricingRecommendationReport {
  recommendation: 'HOLD_PRICE' | 'INCREASE_PRICE' | 'DECREASE_PRICE' | 'TEST_PRICE' | 'INSUFFICIENT_DATA'
  confidence: 'low' | 'medium' | 'high'
  currentPrice: number | null
  competitorLowestPrice: number | null
  competitorHighestPrice: number | null
  competitorAveragePrice: number | null
  competitorMedianPrice: number | null
  pricePosition: 'low' | 'lower-middle' | 'middle' | 'upper-middle' | 'high' | 'unknown'
  suggestedPriceRange: { min: number | null; max: number | null }
  summary: string
  reasoning: string[]
  action: string
  risks: string[]
}

export interface CompetitorMatchQualityReport {
  competitors: Array<{
    competitorProductId: number | string
    matchType: 'DIRECT_MATCH' | 'SIMILAR_PRODUCT' | 'WEAK_MATCH' | 'REJECTED' | 'UNKNOWN'
    matchScore: number
    confidence: 'low' | 'medium' | 'high'
    reasons: string[]
    warning: string | null
  }>
  summary: string
  recommendedActions: string[]
}

export interface SalesTrendSummaryReport {
  trend: 'GROWING' | 'STABLE' | 'SLOWING' | 'SEASONAL' | 'INSUFFICIENT_DATA'
  confidence: 'low' | 'medium' | 'high'
  bestMonth: string | null
  recentPerformance: string
  summary: string
  insights: string[]
  action: string
  risks: string[]
}

export interface ProductListingImprovementReport {
  listingScore: number
  mainIssues: string[]
  improvedTitle: string
  improvedBulletPoints: string[]
  recommendedDescriptionChanges: string[]
  riskWarnings: string[]
  seoKeywords: string[]
  imageSuggestions: string[]
  summary: string
}

export interface ProductAiReportsOutput {
  pricing?: PricingRecommendationReport
  competitorMatch?: CompetitorMatchQualityReport
  salesTrend?: SalesTrendSummaryReport
  listingImprovement?: ProductListingImprovementReport
}

export interface ProductAiReport {
  id: number
  productId: number
  status: 'pending' | 'success' | 'failed'
  model: string
  reportTypes: ReportType[]
  output: ProductAiReportsOutput | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface GetLatestAiReportResponse {
  productId: number
  report: ProductAiReport | null
}

export interface GenerateAiReportResponse {
  productId: number
  report: ProductAiReport
}
