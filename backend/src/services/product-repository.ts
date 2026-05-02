import { createHash } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import type { Database } from "../db/index.js";
import { products, type ProductRow } from "../db/schema.js";
import type { ProductExtraction } from "../schemas/product.js";

type SaveProductInput = {
  extraction: ProductExtraction;
  rawReaderContent: string;
};

export class ProductRepository {
  constructor(private readonly db: Database) {}

  async listProducts(): Promise<ProductRow[]> {
    return this.db.select().from(products).orderBy(desc(products.updatedAt));
  }

  async getProductById(id: number): Promise<ProductRow | null> {
    const [product] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    return product ?? null;
  }

  async getProductBySourceUrl(sourceUrl: string): Promise<ProductRow | null> {
    const sourceUrlHash = hashSourceUrl(sourceUrl);
    const [product] = await this.db
      .select()
      .from(products)
      .where(eq(products.sourceUrlHash, sourceUrlHash))
      .limit(1);
    return product ?? null;
  }

  async saveExtractedProduct(input: SaveProductInput): Promise<ProductRow> {
    const existing = await this.getProductBySourceUrl(input.extraction.source_url);

    const payload = {
      sourceUrlHash: hashSourceUrl(input.extraction.source_url),
      sourceUrl: input.extraction.source_url,
      productName: input.extraction.product_name,
      brand: input.extraction.brand,
      modelOrVariant: input.extraction.model_or_variant,
      thumbnail: input.extraction.thumbnail,
      price: input.extraction.price,
      salesPrice: input.extraction.sales_price,
      currency: input.extraction.currency,
      availability: input.extraction.availability,
      sellerOrStore: input.extraction.seller_or_store,
      productCategory: input.extraction.product_category,
      keySpecs: input.extraction.key_specs,
      confidence: input.extraction.confidence,
      rawReaderContent: input.rawReaderContent,
      extractionPayload: input.extraction,
      lastExtractedAt: new Date()
    };

    if (existing) {
      await this.db
        .update(products)
        .set(payload)
        .where(eq(products.id, existing.id));

      return (await this.getProductById(existing.id))!;
    }

    const insertPayload = {
      externalId: null,
      status: "pending",
      ...payload
    };

    const result = await this.db.insert(products).values(insertPayload).$returningId();
    const insertedId = Number(result[0]?.id);
    return (await this.getProductById(insertedId))!;
  }

  async updateStatus(id: number, status: "pending" | "approved" | "deleted"): Promise<ProductRow | null> {
    await this.db.update(products).set({ status }).where(eq(products.id, id));
    return this.getProductById(id);
  }
}

function hashSourceUrl(sourceUrl: string) {
  return createHash("sha256").update(sourceUrl).digest("hex");
}
