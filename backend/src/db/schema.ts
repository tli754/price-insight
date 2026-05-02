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
