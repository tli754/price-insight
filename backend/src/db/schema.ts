import {
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  double
} from "drizzle-orm/mysql-core";

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
    price: double("price"),
    salesPrice: double("sales_price"),
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

export const competitorProducts = mysqlTable("competitor_products", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  competitorId: int("competitor_id").notNull(),
  title: text("title"),
  externalId: text("external_id"),
  productLink: text("product_link"),
  source: varchar("source", { length: 255 }),
  price: varchar("price", { length: 64 }),
  extractedPrice: double("extracted_price"),
  oldPrice: varchar("old_price", { length: 64 }),
  extractedOldPrice: double("extracted_old_price"),
  thumbnail: text("thumbnail"),
  tag: text("tag"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export type CompetitorProductRow = typeof competitorProducts.$inferSelect;
export type NewCompetitorProductRow = typeof competitorProducts.$inferInsert;
