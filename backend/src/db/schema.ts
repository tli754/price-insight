import {
  bigint,
  decimal,
  index,
  int,
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

const shopifyId = {
  mode: "number" as const,
  unsigned: true
} as const;

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    externalId: bigint("external_id", shopifyId).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    thumbnail: text("thumbnail"),
    price: decimal("price", moneyColumn),
    currency: varchar("currency", { length: 16 }),
    handle: varchar("handle", { length: 500 }),
    title: varchar("title", { length: 500 }),
    brand: varchar("brand", { length: 255 }),
    inventoryQuantity: int("inventory_quantity"),
    weightUnit: varchar("weight_unit", { length: 16 }),
    weight: decimal("weight", { precision: 10, scale: 3, mode: "number" }),
    sku: varchar("sku", { length: 255 }),
    tags: text("tags"),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (table) => ({
    externalIdIdx: index("products_external_id_idx").on(table.externalId)
  })
);

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;

export const productImages = mysqlTable(
  "product_images",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade", onUpdate: "cascade" }),
    externalId: bigint("external_id", shopifyId).notNull(),
    position: int("position").notNull(),
    alt: varchar("alt", { length: 512 }).notNull(),
    width: int("width"),
    height: int("height"),
    src: text("src").notNull()
  },
  (table) => ({
    productImageUnique: uniqueIndex("product_images_product_external_unique").on(
      table.productId,
      table.externalId
    )
  })
);

export type ProductImageRow = typeof productImages.$inferSelect;
export type NewProductImageRow = typeof productImages.$inferInsert;

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
    title: text("title").notNull(),
    externalId: text("external_id"),
    productLink: text("product_link").notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 16 }),
    thumbnail: text("thumbnail"),
    tag: text("tag"),
    googlePosition: int("google_position"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    productIdx: index("competitor_products_product_id_idx").on(table.productId),
    competitorIdx: index("competitor_products_competitor_id_idx").on(table.competitorId),
    listingUnique: uniqueIndex("competitor_products_listing_unique").on(
      table.productId,
      table.competitorId,
      table.productLink
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
    price: varchar("price", { length: 64 }),
    extractedPrice: decimal("extracted_price", moneyColumn).notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow()
  },
  (table) => ({
    competitorProductIdx: index("price_history_competitor_product_id_idx").on(
      table.competitorProductId
    )
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
    minPrice: decimal("min_price", moneyColumn).notNull(),
    maxPrice: decimal("max_price", moneyColumn).notNull(),
    summary: text("summary").notNull(),
    marketPosition: varchar("market_position", { length: 32 }).notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow()
  },
  (table) => ({
    productIdx: index("price_insights_product_id_idx").on(table.productId)
  })
);

export type PriceInsightRow = typeof priceInsights.$inferSelect;
export type NewPriceInsightRow = typeof priceInsights.$inferInsert;
