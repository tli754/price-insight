import { z } from "zod";

export const REPORT_TYPES = ["pricing", "competitorMatch", "salesTrend", "listingImprovement"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

// ── Individual report schemas ─────────────────────────────────────────────────

const pricingRecommendationSchema = z.object({
  recommendation: z.enum(["HOLD_PRICE", "INCREASE_PRICE", "DECREASE_PRICE", "TEST_PRICE", "INSUFFICIENT_DATA"]),
  confidence: z.enum(["low", "medium", "high"]),
  currentPrice: z.number().nullable(),
  competitorLowestPrice: z.number().nullable(),
  competitorHighestPrice: z.number().nullable(),
  competitorAveragePrice: z.number().nullable(),
  competitorMedianPrice: z.number().nullable(),
  pricePosition: z.enum(["low", "lower-middle", "middle", "upper-middle", "high", "unknown"]),
  suggestedPriceRange: z.object({ min: z.number().nullable(), max: z.number().nullable() }),
  summary: z.string(),
  reasoning: z.array(z.string()),
  action: z.string(),
  risks: z.array(z.string()),
});

const competitorMatchQualitySchema = z.object({
  competitors: z.array(
    z.object({
      competitorProductId: z.union([z.number(), z.string()]),
      matchType: z.enum(["DIRECT_MATCH", "SIMILAR_PRODUCT", "WEAK_MATCH", "REJECTED", "UNKNOWN"]),
      matchScore: z.number().min(0).max(100),
      confidence: z.enum(["low", "medium", "high"]),
      reasons: z.array(z.string()),
      warning: z.string().nullable(),
    })
  ),
  summary: z.string(),
  recommendedActions: z.array(z.string()),
});

const salesTrendSummarySchema = z.object({
  trend: z.enum(["GROWING", "STABLE", "SLOWING", "SEASONAL", "INSUFFICIENT_DATA"]),
  confidence: z.enum(["low", "medium", "high"]),
  bestMonth: z.string().nullable(),
  recentPerformance: z.string(),
  summary: z.string(),
  insights: z.array(z.string()),
  action: z.string(),
  risks: z.array(z.string()),
});

const productListingImprovementSchema = z.object({
  listingScore: z.number().min(0).max(100),
  mainIssues: z.array(z.string()),
  improvedTitle: z.string(),
  improvedBulletPoints: z.array(z.string()),
  recommendedDescriptionChanges: z.array(z.string()),
  riskWarnings: z.array(z.string()),
  seoKeywords: z.array(z.string()),
  imageSuggestions: z.array(z.string()),
  summary: z.string(),
});

export const productAiReportsOutputSchema = z.object({
  pricing: pricingRecommendationSchema.nullish(),
  competitorMatch: competitorMatchQualitySchema.nullish(),
  salesTrend: salesTrendSummarySchema.nullish(),
  listingImprovement: productListingImprovementSchema.nullish(),
});

export type ProductAiReportsOutput = z.infer<typeof productAiReportsOutputSchema>;
export type PricingRecommendationReport = z.infer<typeof pricingRecommendationSchema>;
export type CompetitorMatchQualityReport = z.infer<typeof competitorMatchQualitySchema>;
export type SalesTrendSummaryReport = z.infer<typeof salesTrendSummarySchema>;
export type ProductListingImprovementReport = z.infer<typeof productListingImprovementSchema>;
