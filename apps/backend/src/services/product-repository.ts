import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "../db/index.js";
import { competitorProducts, orderItems, orders, priceHistory, productImages, products, type ProductImageRow, type ProductRow } from "../db/schema.js";

export type ProductSalesStats = {
  sold7d: number;
  revenue7d: number;
  sold30d: number;
  revenue30d: number;
  sold90d: number;
  revenue90d: number;
};

export type ProductCompetitorStats = {
  avgCompetitorPrice: number;
  confirmedCompetitorCount: number;
};

export type ShopifyVariant = {
  price: string;
  compare_at_price: string | null;
  sku: string | null;
  barcode: string | null;
  grams: number;
  weight: number;
  weight_unit: string;
  inventory_quantity: number;
};

export type ShopifyImage = {
  id: number;
  position: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
};

export type ShopifyProduct = {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string;
  handle: string;
  status: string;
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
};

export class ProductRepository {
  constructor(private readonly db: Database) {}

  async importProducts(shopifyProducts: ShopifyProduct[]): Promise<number> {
    let count = 0;

    for (const sp of shopifyProducts) {
      const variant = sp.variants[0];
      const primaryImage = sp.images.find((img) => img.position === 1) ?? sp.images[0];

      const productPayload = {
        externalId: sp.id,
        status: sp.status,
        title: sp.title,
        brand: sp.vendor || null,
        handle: sp.handle,
        tags: sp.tags || null,
        description: sp.body_html || null,
        thumbnail: primaryImage?.src ?? null,
        price: variant ? parseFloat(variant.price) : null,
        sku: variant?.sku ?? null,
        weight: variant?.weight ?? null,
        weightUnit: variant?.weight_unit ?? null,
        inventoryQuantity: variant?.inventory_quantity ?? null
      };

      const [existing] = await this.db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.externalId, sp.id))
        .limit(1);

      let productId: number;

      if (existing) {
        await this.db.update(products).set(productPayload).where(eq(products.id, existing.id));
        productId = existing.id;
        // Remove old images and re-insert
        await this.db.delete(productImages).where(eq(productImages.productId, productId));
      } else {
        const result = await this.db.insert(products).values(productPayload).$returningId();
        productId = Number(result[0]?.id);
        count++;
      }

      if (sp.images.length > 0) {
        await this.db.insert(productImages).values(
          sp.images.map((img) => ({
            productId,
            externalId: img.id,
            position: img.position,
            src: img.src,
            alt: img.alt?.trim() || sp.title,
            width: img.width,
            height: img.height
          }))
        );
      }
    }

    return count;
  }

  async listProducts(): Promise<(ProductRow & Partial<ProductSalesStats> & Partial<ProductCompetitorStats>)[]> {
    const [productRows, salesMap, competitorMap] = await Promise.all([
      this.db.select().from(products).orderBy(desc(products.updatedAt)),
      this.getProductSalesStats(),
      this.getCompetitorPriceStats()
    ]);
    return productRows.map(p => ({ ...p, ...salesMap.get(p.id), ...competitorMap.get(p.id) }));
  }

  private async getCompetitorPriceStats(): Promise<Map<number, ProductCompetitorStats>> {
    const rows = await this.db
      .select({
        productId: competitorProducts.productId,
        confirmedCount: sql<string>`COUNT(*)`,
        avgPrice: sql<string>`AVG(${priceHistory.extractedPrice})`,
      })
      .from(competitorProducts)
      .innerJoin(
        priceHistory,
        sql`${priceHistory.id} = (SELECT MAX(ph2.id) FROM price_history ph2 WHERE ph2.competitor_product_id = ${competitorProducts.id})`
      )
      .where(
        and(
          eq(competitorProducts.status, "confirmed"),
          isNotNull(competitorProducts.productId)
        )
      )
      .groupBy(competitorProducts.productId);

    const map = new Map<number, ProductCompetitorStats>();
    for (const row of rows) {
      if (row.productId == null) continue;
      map.set(row.productId, {
        confirmedCompetitorCount: Number(row.confirmedCount ?? 0),
        avgCompetitorPrice: parseFloat(row.avgPrice ?? "0"),
      });
    }
    return map;
  }

  private async getProductSalesStats(): Promise<Map<number, ProductSalesStats>> {
    const rows = await this.db
      .select({
        productId: orderItems.productId,
        sold7d: sql<string>`SUM(CASE WHEN ${orders.processedAt} >= NOW() - INTERVAL 7 DAY THEN IFNULL(${orderItems.currentQuantity}, ${orderItems.quantity}) ELSE 0 END)`,
        revenue7d: sql<string>`SUM(CASE WHEN ${orders.processedAt} >= NOW() - INTERVAL 7 DAY THEN IFNULL(${orderItems.currentQuantity}, ${orderItems.quantity}) * IFNULL(${orderItems.unitPrice}, 0) ELSE 0 END)`,
        sold30d: sql<string>`SUM(CASE WHEN ${orders.processedAt} >= NOW() - INTERVAL 30 DAY THEN IFNULL(${orderItems.currentQuantity}, ${orderItems.quantity}) ELSE 0 END)`,
        revenue30d: sql<string>`SUM(CASE WHEN ${orders.processedAt} >= NOW() - INTERVAL 30 DAY THEN IFNULL(${orderItems.currentQuantity}, ${orderItems.quantity}) * IFNULL(${orderItems.unitPrice}, 0) ELSE 0 END)`,
        sold90d: sql<string>`SUM(IFNULL(${orderItems.currentQuantity}, ${orderItems.quantity}))`,
        revenue90d: sql<string>`SUM(IFNULL(${orderItems.currentQuantity}, ${orderItems.quantity}) * IFNULL(${orderItems.unitPrice}, 0))`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          isNotNull(orderItems.productId),
          isNotNull(orders.processedAt),
          isNull(orders.cancelledAt),
          sql`(${orders.financialStatus} IS NULL OR ${orders.financialStatus} NOT IN ('voided', 'refunded'))`,
          sql`${orders.processedAt} >= NOW() - INTERVAL 90 DAY`
        )
      )
      .groupBy(orderItems.productId);

    const map = new Map<number, ProductSalesStats>();
    for (const row of rows) {
      if (row.productId == null) continue;
      map.set(row.productId, {
        sold7d: Number(row.sold7d ?? 0),
        revenue7d: parseFloat(row.revenue7d ?? "0"),
        sold30d: Number(row.sold30d ?? 0),
        revenue30d: parseFloat(row.revenue30d ?? "0"),
        sold90d: Number(row.sold90d ?? 0),
        revenue90d: parseFloat(row.revenue90d ?? "0"),
      });
    }
    return map;
  }

  async getProductsByIds(ids: number[]): Promise<ProductRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(products).where(inArray(products.id, ids));
  }

  async deleteProduct(id: number): Promise<void> {
    await this.db.delete(products).where(eq(products.id, id));
  }

  async getProductById(id: number): Promise<(ProductRow & { images: ProductImageRow[] }) | null> {
    const [product] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!product) return null;

    const images = await this.db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(productImages.position);

    return { ...product, images };
  }
}
