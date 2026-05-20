import { desc, eq } from "drizzle-orm";

import type { Database } from "../db/index.js";
import { productImages, products, type ProductImageRow, type ProductRow } from "../db/schema.js";

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

  async listProducts(): Promise<ProductRow[]> {
    return this.db.select().from(products).orderBy(desc(products.updatedAt));
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
