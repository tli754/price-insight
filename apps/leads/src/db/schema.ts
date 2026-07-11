import {
  bigint,
  boolean,
  char,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";

// Shared column shapes -------------------------------------------------------
const pk = { mode: "number" as const, unsigned: true } as const;
const money = { precision: 14, scale: 2, mode: "number" as const };
const unit = { precision: 6, scale: 4, mode: "number" as const };

// lead_companies — canonical, indexed pipeline row (system of record for the
// dashboard's filter/sort/status). Rich evidence/AI docs live in MongoDB and are
// referenced here by id (latest_crawl_snapshot_id / latest_ai_classification_id).
export const leadCompanies = mysqlTable(
  "lead_companies",
  {
    id: bigint("id", pk).autoincrement().primaryKey(),
    domain: varchar("domain", { length: 255 }).notNull(),
    companyName: varchar("company_name", { length: 255 }),
    platform: varchar("platform", { length: 50 }).notNull().default("unknown"),
    country: char("country", { length: 2 }),
    vertical: varchar("vertical", { length: 128 }),
    employeeCount: int("employee_count", { unsigned: true }),
    productCount: int("product_count", { unsigned: true }),
    // Deferred to enrichment (crawler) — NULL at import.
    trafficEstimate: int("traffic_estimate", { unsigned: true }),
    // Deferred to the scoring pass — 0 at import.
    overallScore: decimal("overall_score", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    grade: varchar("grade", { length: 2 }),
    status: mysqlEnum("status", ["new", "qualified", "contacted", "customer", "rejected"]).notNull().default("new"),
    filterReason: varchar("filter_reason", { length: 255 }),
    // MongoDB document references (Phase 2/3).
    latestCrawlSnapshotId: varchar("latest_crawl_snapshot_id", { length: 64 }),
    latestAiClassificationId: varchar("latest_ai_classification_id", { length: 64 }),
    lastCrawledAt: datetime("last_crawled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (t) => ({
    domainUnique: uniqueIndex("lead_companies_domain_unique").on(t.domain),
    statusIdx: index("lead_companies_status_idx").on(t.status),
    scoreIdx: index("lead_companies_overall_score_idx").on(t.overallScore),
    platformIdx: index("lead_companies_platform_idx").on(t.platform),
    countryIdx: index("lead_companies_country_idx").on(t.country)
  })
);

export type LeadCompanyRow = typeof leadCompanies.$inferSelect;
export type NewLeadCompanyRow = typeof leadCompanies.$inferInsert;

// lead_company_sources — provenance: one company can arrive from many imports.
export const leadCompanySources = mysqlTable(
  "lead_company_sources",
  {
    id: bigint("id", pk).autoincrement().primaryKey(),
    companyId: bigint("company_id", pk)
      .notNull()
      .references(() => leadCompanies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    source: varchar("source", { length: 64 }).notNull(),
    sourceFile: varchar("source_file", { length: 255 }),
    raw: json("raw").$type<Record<string, unknown>>(),
    importedAt: timestamp("imported_at").notNull().defaultNow()
  },
  (t) => ({
    companyIdx: index("lead_company_sources_company_id_idx").on(t.companyId),
    sourceUnique: uniqueIndex("lead_company_sources_company_source_unique").on(t.companyId, t.source)
  })
);

export type LeadCompanySourceRow = typeof leadCompanySources.$inferSelect;
export type NewLeadCompanySourceRow = typeof leadCompanySources.$inferInsert;

// lead_company_signals — 1:1 enrichment inputs the scorer/filter read.
export const leadCompanySignals = mysqlTable(
  "lead_company_signals",
  {
    id: bigint("id", pk).autoincrement().primaryKey(),
    companyId: bigint("company_id", pk)
      .notNull()
      .references(() => leadCompanies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    salesRevenue: decimal("sales_revenue", money),
    technologySpend: int("technology_spend", { unsigned: true }),
    pageRank: bigint("page_rank", { mode: "number", unsigned: true }),
    cruxRank: varchar("crux_rank", { length: 32 }),
    tranco: int("tranco", { unsigned: true }),
    socialFollowers: int("social_followers", { unsigned: true }),
    marketingAutomation: text("marketing_automation"),
    hasMarketingAutomation: boolean("has_marketing_automation").notNull().default(false),
    crmPlatform: varchar("crm_platform", { length: 128 }),
    hasCrm: boolean("has_crm").notNull().default(false),
    aiPlatform: varchar("ai_platform", { length: 128 }),
    hasAi: boolean("has_ai").notNull().default(false),
    paymentPlatforms: text("payment_platforms"),
    firstDetected: date("first_detected"),
    lastFound: date("last_found"),
    lastIndexed: date("last_indexed"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (t) => ({
    companyUnique: uniqueIndex("lead_company_signals_company_id_unique").on(t.companyId)
  })
);

export type LeadCompanySignalRow = typeof leadCompanySignals.$inferSelect;
export type NewLeadCompanySignalRow = typeof leadCompanySignals.$inferInsert;

// contacts — normalized emails / phones / people / socials.
export const contacts = mysqlTable(
  "contacts",
  {
    id: bigint("id", pk).autoincrement().primaryKey(),
    companyId: bigint("company_id", pk)
      .notNull()
      .references(() => leadCompanies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: mysqlEnum("type", ["email", "phone", "person", "social"]).notNull(),
    value: varchar("value", { length: 512 }).notNull(),
    label: varchar("label", { length: 128 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => ({
    companyIdx: index("contacts_company_id_idx").on(t.companyId),
    valueUnique: uniqueIndex("contacts_company_type_value_unique").on(t.companyId, t.type, t.value)
  })
);

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;

// score_history — one row per scoring run, with component breakdown + reasons.
export const scoreHistory = mysqlTable(
  "score_history",
  {
    id: bigint("id", pk).autoincrement().primaryKey(),
    companyId: bigint("company_id", pk)
      .notNull()
      .references(() => leadCompanies.id, { onDelete: "cascade", onUpdate: "cascade" }),
    overallScore: decimal("overall_score", { precision: 5, scale: 2, mode: "number" }).notNull(),
    valueScore: decimal("value_score", unit),
    gapScore: decimal("gap_score", unit),
    reachScore: decimal("reach_score", unit),
    recencyScore: decimal("recency_score", unit),
    reasons: json("reasons").$type<string[]>(),
    weights: json("weights").$type<Record<string, number>>(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (t) => ({
    companyCreatedIdx: index("score_history_company_created_idx").on(t.companyId, t.createdAt)
  })
);

export type ScoreHistoryRow = typeof scoreHistory.$inferSelect;
export type NewScoreHistoryRow = typeof scoreHistory.$inferInsert;
