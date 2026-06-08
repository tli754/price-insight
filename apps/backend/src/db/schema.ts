import {
  bigint,
  boolean,
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
      .references(() => competitor.id, { onDelete: "restrict", onUpdate: "cascade" }),
    title: text("title").notNull(),
    externalId: varchar("external_id", { length: 255 }),
    productLink: text("product_link").notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 16 }),
    thumbnail: text("thumbnail"),
    tag: text("tag"),
    googlePosition: int("google_position"),
    status: varchar("status", { length: 32 }).notNull().default("suggested"),
    country: varchar("country", { length: 8 }),
    rating: decimal("rating", { precision: 3, scale: 1, mode: "number" }),
    reviewCount: int("review_count"),
    shippingRaw: varchar("shipping_raw", { length: 64 }),
    shippingExtracted: decimal("shipping_extracted", moneyColumn),
    extractedOldPrice: decimal("extracted_old_price", moneyColumn),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    productIdx: index("competitor_products_product_id_idx").on(table.productId),
    competitorIdx: index("competitor_products_competitor_id_idx").on(table.competitorId),
    listingUnique: uniqueIndex("competitor_products_listing_unique").on(
      table.productId,
      table.competitorId,
      table.externalId
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

export const customers = mysqlTable(
  "customers",
  {
    id: int("id").autoincrement().primaryKey(),
    shopifyCustomerId: bigint("shopify_customer_id", shopifyId).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    firstName: varchar("first_name", { length: 255 }).notNull(),
    lastName: varchar("last_name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 64 }),
    state: varchar("state", { length: 32 }),
    currency: varchar("currency", { length: 16 }),
    verifiedEmail: boolean("verified_email"),
    tags: text("customer_tags"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (table) => ({
    shopifyCustomerIdUnique: uniqueIndex("customers_shopify_customer_id_unique").on(table.shopifyCustomerId)
  })
);

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;

export const customerAddresses = mysqlTable(
  "customer_addresses",
  {
    id: int("id").autoincrement().primaryKey(),
    customerId: int("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    shopifyAddressId: bigint("shopify_address_id", shopifyId),
    addressName: varchar("address_name", { length: 255 }),
    company: varchar("company", { length: 255 }),
    address1: varchar("address1", { length: 255 }),
    address2: varchar("address2", { length: 255 }),
    city: varchar("city", { length: 128 }),
    province: varchar("province", { length: 128 }),
    country: varchar("country", { length: 128 }),
    zip: varchar("zip", { length: 32 }),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    shopifyAddressIdUnique: uniqueIndex("customer_addresses_shopify_address_id_unique").on(table.shopifyAddressId),
    customerIdx: index("customer_addresses_customer_id_idx").on(table.customerId)
  })
);

export type CustomerAddressRow = typeof customerAddresses.$inferSelect;
export type NewCustomerAddressRow = typeof customerAddresses.$inferInsert;

export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    shopifyOrderId: bigint("shopify_order_id", shopifyId).notNull(),
    customerId: int("customer_id").references(() => customers.id, { onDelete: "set null", onUpdate: "cascade" }),
    orderNumber: varchar("order_number", { length: 64 }).notNull(),
    email: varchar("email", { length: 255 }),
    financialStatus: varchar("financial_status", { length: 64 }),
    fulfillmentStatus: varchar("fulfillment_status", { length: 64 }),
    currency: varchar("currency", { length: 16 }),
    subtotalPrice: decimal("subtotal_price", moneyColumn),
    totalPrice: decimal("total_price", moneyColumn),
    totalTax: decimal("total_tax", moneyColumn),
    totalShipping: decimal("total_shipping", moneyColumn),
    totalDiscounts: decimal("total_discounts", moneyColumn),
    sourceName: varchar("source_name", { length: 255 }),
    referringSite: text("referring_site"),
    landingSite: text("landing_site"),
    processedAt: timestamp("processed_at"),
    totalWeight: decimal("total_weight", { precision: 10, scale: 3, mode: "number" }),
    cancelledAt: timestamp("cancelled_at"),
    shopifyCreatedAt: timestamp("shopify_created_at"),
    shopifyUpdatedAt: timestamp("shopify_updated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (table) => ({
    shopifyOrderIdUnique: uniqueIndex("orders_shopify_order_id_unique").on(table.shopifyOrderId),
    customerIdx: index("orders_customer_id_idx").on(table.customerId),
    shopifyUpdatedAtIdx: index("orders_shopify_updated_at_idx").on(table.shopifyUpdatedAt)
  })
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;

export const orderItems = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    productId: int("product_id").references(() => products.id, { onDelete: "set null", onUpdate: "cascade" }),
    shopifyLineItemId: bigint("shopify_line_item_id", shopifyId).notNull(),
    shopifyProductId: bigint("shopify_product_id", shopifyId),
    shopifyVariantId: bigint("shopify_variant_id", shopifyId),
    title: varchar("title", { length: 500 }).notNull(),
    variantTitle: varchar("variant_title", { length: 255 }),
    sku: varchar("sku", { length: 255 }),
    quantity: int("quantity").notNull(),
    currentQuantity: int("current_quantity"),
    unitPrice: decimal("unit_price", moneyColumn),
    totalDiscount: decimal("total_discount", moneyColumn),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => ({
    shopifyLineItemIdUnique: uniqueIndex("order_items_shopify_line_item_id_unique").on(table.shopifyLineItemId),
    orderIdx: index("order_items_order_id_idx").on(table.orderId),
    productIdx: index("order_items_product_id_idx").on(table.productId)
  })
);

export type OrderItemRow = typeof orderItems.$inferSelect;
export type NewOrderItemRow = typeof orderItems.$inferInsert;

export const productAiReports = mysqlTable(
  "product_ai_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: varchar("status", { length: 20 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    reportTypes: json("report_types").$type<string[]>().notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    inputSnapshot: json("input_snapshot").$type<unknown>(),
    output: json("output").$type<unknown>(),
    errorMessage: text("error_message"),
    generatedBy: varchar("generated_by", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    productCreatedIdx: index("idx_product_ai_reports_product_created").on(table.productId, table.createdAt),
    productStatusIdx: index("idx_product_ai_reports_product_status").on(table.productId, table.status),
    inputHashIdx: index("idx_product_ai_reports_input_hash").on(table.inputHash),
  })
);

export type ProductAiReportRow = typeof productAiReports.$inferSelect;
export type NewProductAiReportRow = typeof productAiReports.$inferInsert;
