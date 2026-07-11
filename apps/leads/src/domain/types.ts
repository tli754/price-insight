// Shared domain types for the deterministic (no-DB) core: filtering + scoring.

export type Platform =
  | "shopify"
  | "woocommerce"
  | "bigcommerce"
  | "magento"
  | "generic"
  | "unknown";

export type LeadStatus = "new" | "qualified" | "contacted" | "customer" | "rejected";

/** Inputs the hard-filter engine gates on (available at import time). */
export interface HardFilterInput {
  domain: string | null;
  country: string | null;
  platform: Platform | string | null;
  salesRevenue: number | null;
}

export interface HardFilterResult {
  pass: boolean;
  /** machine-readable rejection reason, or null when passed */
  reason: string | null;
}

/** Inputs the deterministic scorer reads (from import + later enrichment). */
export interface ScoreInput {
  salesRevenue: number | null; // higher is better
  technologySpend: number | null; // higher is better
  productCount: number | null; // higher is better
  prominenceRank: number | null; // LOWER is better (Tranco/CRuX/PageRank position)
  hasAi: boolean;
  hasCrm: boolean;
  hasMarketingAutomation: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasNamedPerson: boolean;
  lastActivityAt: Date | null;
}

export interface ScoreComponents {
  value: number; // 0..1
  gap: number; // 0..1
  reach: number; // 0..1
  recency: number; // 0..1
}

export interface ScoreResult {
  overall: number; // 0..100
  components: ScoreComponents;
  reasons: string[];
}
