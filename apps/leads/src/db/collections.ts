// MongoDB document schemas + typed collection accessors for the leads service.
//
// The document schemas are defined STANDALONE with Zod (they deliberately do NOT
// import from `src/domain/types.ts`) so the persistence layer stays decoupled
// from the deterministic scoring types. Zod is the source of truth for the shape;
// TS types are inferred from it.

import type { Collection } from "mongodb";
import { z } from "zod";

import { getDb } from "./mongo.js";

// Collection names -----------------------------------------------------------
export const COLLECTIONS = {
  companies: "companies",
  crawlSnapshots: "crawl_snapshots",
  aiAnalyses: "ai_analyses"
} as const;

// Lifecycle status -----------------------------------------------------------
// Canonical casing: lower_snake_case tokens, exactly as listed here. `imported`
// is the default assigned by the importer at insert time.
export const LIFECYCLE_STATUSES = [
  "new",
  "imported",
  "filtered",
  "qualified",
  "queued",
  "crawling",
  "crawled",
  "scored",
  "ai_analysed",
  "ready",
  "contacted",
  "meeting",
  "customer",
  "rejected",
  "archived",
  "failed"
] as const;

export const lifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;

// Shared sub-schemas ---------------------------------------------------------
export const scoreComponentsSchema = z.object({
  value: z.number(),
  gap: z.number(),
  reach: z.number(),
  recency: z.number()
});
export type ScoreComponents = z.infer<typeof scoreComponentsSchema>;

export const companySignalsSchema = z.object({
  salesRevenue: z.number().optional(),
  technologySpend: z.number().optional(),
  tranco: z.number().optional(),
  pageRank: z.number().optional(),
  cruxRank: z.string().optional(),
  socialFollowers: z.number().optional(),
  marketingAutomation: z.string().optional(),
  hasMarketingAutomation: z.boolean().default(false),
  crmPlatform: z.string().optional(),
  hasCrm: z.boolean().default(false),
  aiPlatform: z.string().optional(),
  hasAi: z.boolean().default(false),
  paymentPlatforms: z.string().optional(),
  firstDetected: z.date().optional(),
  lastFound: z.date().optional(),
  lastIndexed: z.date().optional()
});
export type CompanySignals = z.infer<typeof companySignalsSchema>;

export const contactSchema = z.object({
  type: z.enum(["email", "phone", "person", "social"]),
  value: z.string(),
  label: z.string().optional(),
  isPrimary: z.boolean().default(false)
});
export type Contact = z.infer<typeof contactSchema>;

export const sourceSchema = z.object({
  source: z.string(),
  sourceFile: z.string().optional(),
  raw: z.record(z.unknown()).optional(),
  importedAt: z.date()
});
export type CompanySource = z.infer<typeof sourceSchema>;

export const companyScoreSchema = z.object({
  overall: z.number(),
  components: scoreComponentsSchema,
  reasons: z.array(z.string()),
  weights: z.record(z.number()),
  scoredAt: z.date()
});
export type CompanyScore = z.infer<typeof companyScoreSchema>;

export const scoreHistoryEntrySchema = z.object({
  overall: z.number(),
  components: scoreComponentsSchema,
  reasons: z.array(z.string()),
  weights: z.record(z.number()),
  createdAt: z.date()
});
export type ScoreHistoryEntry = z.infer<typeof scoreHistoryEntrySchema>;

// companies ------------------------------------------------------------------
// Canonical, queryable pipeline document (system of record for the dashboard's
// filter/sort/status). Rich P2/P3 evidence lives in crawl_snapshots / ai_analyses
// and is referenced here by id.
export const companySchema = z.object({
  domain: z.string(), // unique key, lowercased bare host
  companyName: z.string().optional(),
  platform: z.string().default("unknown"),
  country: z.string().optional(), // 2-letter
  vertical: z.string().optional(),
  employeeCount: z.number().optional(),
  productCount: z.number().optional(),
  status: lifecycleStatusSchema.default("imported"),
  filterReason: z.string().nullish(),
  signals: companySignalsSchema,
  contacts: z.array(contactSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  score: companyScoreSchema.optional(),
  scoreHistory: z.array(scoreHistoryEntrySchema).default([]),
  latestCrawlSnapshotId: z.string().optional(), // ref into crawl_snapshots (P2)
  latestAiAnalysisId: z.string().optional(), // ref into ai_analyses (P3)
  lastCrawledAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date()
});
export type CompanyDoc = z.infer<typeof companySchema>;

// crawl_snapshots (P2) — kept minimal/permissive; populated by the crawler.
export const crawlSnapshotSchema = z.object({
  companyId: z.string().optional(),
  domain: z.string(),
  data: z.record(z.unknown()).default({}),
  createdAt: z.date()
});
export type CrawlSnapshotDoc = z.infer<typeof crawlSnapshotSchema>;

// ai_analyses (P3) — kept minimal/permissive; populated by the AI pass.
export const aiAnalysisSchema = z.object({
  companyId: z.string().optional(),
  domain: z.string(),
  data: z.record(z.unknown()).default({}),
  createdAt: z.date()
});
export type AiAnalysisDoc = z.infer<typeof aiAnalysisSchema>;

// Typed accessors ------------------------------------------------------------
// Require a completed connect() (getDb() throws otherwise).
export function companies(): Collection<CompanyDoc> {
  return getDb().collection<CompanyDoc>(COLLECTIONS.companies);
}

export function crawlSnapshots(): Collection<CrawlSnapshotDoc> {
  return getDb().collection<CrawlSnapshotDoc>(COLLECTIONS.crawlSnapshots);
}

export function aiAnalyses(): Collection<AiAnalysisDoc> {
  return getDb().collection<AiAnalysisDoc>(COLLECTIONS.aiAnalyses);
}
