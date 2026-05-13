import {
  decimal,
  index,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";

const moneyColumn = {
  precision: 12,
  scale: 4,
  mode: "number" as const
};

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    externalId: varchar("external_id", { length: 225 }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    sourceUrlHash: varchar("source_url_hash", { length: 64 }).notNull(),
    sourceUrl: varchar("source_url", { length: 2048 }).notNull(),
    productName: varchar("product_name", { length: 500 }),
    brand: varchar("brand", { length: 255 }),
    modelOrVariant: varchar("model_or_variant", { length: 255 }),
    thumbnail: text("thumbnail"),
    price: decimal("price", moneyColumn),
    salesPrice: decimal("sales_price", moneyColumn),
    currency: varchar("currency", { length: 16 }),
    availability: varchar("availability", { length: 128 }),
    sellerOrStore: varchar("seller_or_store", { length: 255 }),
    productCategory: varchar("product_category", { length: 255 }),
    keySpecs: json("key_specs").$type<string[] | null>(),
    confidence: varchar("confidence", { length: 16 }),
    rawReaderContent: text("raw_reader_content"),
    extractionPayload: json("extraction_payload").$type<Record<string, unknown> | null>(),
    lastExtractedAt: timestamp("last_extracted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (table) => ({
    sourceUrlHashUnique: uniqueIndex("products_source_url_hash_unique").on(table.sourceUrlHash)
  })
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;

export const competitor = mysqlTable(
  "competitor",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    state: varchar("state", { length: 32 }).notNull().default("active"),
    thumbnail: text("thumbnail"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    nameUnique: uniqueIndex("competitor_name_unique").on(table.name)
  })
);

export type CompetitorRow = typeof competitor.$inferSelect;
export type NewCompetitorRow = typeof competitor.$inferInsert;

export const competitorProducts = mysqlTable(
  "competitor_products",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade", onUpdate: "cascade" }),
    competitorId: int("competitor_id")
      .notNull()
      .references(() => competitor.id, { onDelete: "restrict", onUpdate: "cascade" }),
    state: varchar("state", { length: 32 }).notNull().default("active"),
    title: text("title").notNull(),
    externalId: varchar("external_id", { length: 255 }),
    productLinkHash: varchar("product_link_hash", { length: 64 }).notNull(),
    productLink: text("product_link").notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    price: varchar("price", { length: 64 }),
    extractedPrice: decimal("extracted_price", moneyColumn).notNull(),
    oldPrice: varchar("old_price", { length: 64 }),
    extractedOldPrice: decimal("extracted_old_price", moneyColumn),
    currency: varchar("currency", { length: 16 }),
    thumbnail: text("thumbnail"),
    tag: text("tag"),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (table) => ({
    productIdx: index("competitor_products_product_id_idx").on(table.productId),
    competitorIdx: index("competitor_products_competitor_id_idx").on(table.competitorId),
    productStateIdx: index("competitor_products_product_state_idx").on(table.productId, table.state),
    productListingUnique: uniqueIndex("competitor_products_product_listing_unique").on(
      table.productId,
      table.competitorId,
      table.productLinkHash
    )
  })
);

export type CompetitorProductRow = typeof competitorProducts.$inferSelect;
export type NewCompetitorProductRow = typeof competitorProducts.$inferInsert;

export const priceHistory = mysqlTable(
  "price_history",
  {
    id: int("id").autoincrement().primaryKey(),
    competitorProductId: int("competitor_product_id")
      .notNull()
      .references(() => competitorProducts.id, { onDelete: "cascade", onUpdate: "cascade" }),
    price: decimal("price", moneyColumn).notNull(),
    oldPrice: decimal("old_price", moneyColumn),
    currency: varchar("currency", { length: 16 }),
    observedAt: timestamp("observed_at").notNull().defaultNow()
  },
  (table) => ({
    competitorProductIdx: index("price_history_competitor_product_id_idx").on(table.competitorProductId),
    observedAtIdx: index("price_history_observed_at_idx").on(table.observedAt)
  })
);

export type PriceHistoryRow = typeof priceHistory.$inferSelect;
export type NewPriceHistoryRow = typeof priceHistory.$inferInsert;

export const priceInsights = mysqlTable(
  "price_insights",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade", onUpdate: "cascade" }),
    referenceCount: int("reference_count").notNull(),
    minimumPrice: decimal("minimum_price", moneyColumn).notNull(),
    maximumPrice: decimal("maximum_price", moneyColumn).notNull(),
    averagePrice: decimal("average_price", moneyColumn).notNull(),
    medianPrice: decimal("median_price", moneyColumn).notNull(),
    positionLabel: varchar("position_label", { length: 32 }).notNull(),
    percentile: decimal("percentile", { precision: 7, scale: 4, mode: "number" }).notNull(),
    differenceToAverage: decimal("difference_to_average", moneyColumn).notNull(),
    differenceToAveragePercent: decimal("difference_to_average_percent", {
      precision: 8,
      scale: 4,
      mode: "number"
    }).notNull(),
    recommendation: text("recommendation").notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull(),
    analysisPayload: json("analysis_payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    productIdx: index("price_insights_product_id_idx").on(table.productId),
    productCreatedAtIdx: index("price_insights_product_created_at_idx").on(table.productId, table.createdAt)
  })
);

export type PriceInsightRow = typeof priceInsights.$inferSelect;
export type NewPriceInsightRow = typeof priceInsights.$inferInsert;
