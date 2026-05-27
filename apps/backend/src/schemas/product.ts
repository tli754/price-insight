import { z } from "zod";

export const shopifyVariantSchema = z.object({
  id: z.number(),
  price: z.string(),
  compare_at_price: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  grams: z.number(),
  weight: z.number(),
  weight_unit: z.string(),
  inventory_quantity: z.number(),
  option1: z.string().nullable(),
  option2: z.string().nullable(),
  option3: z.string().nullable()
});

export const shopifyImageSchema = z.object({
  id: z.number(),
  position: z.number(),
  src: z.string(),
  alt: z.string().nullable(),
  width: z.number(),
  height: z.number()
});

export const shopifyProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  body_html: z.string().nullable(),
  vendor: z.string(),
  handle: z.string(),
  status: z.string(),
  tags: z.string(),
  variants: z.array(shopifyVariantSchema),
  images: z.array(shopifyImageSchema),
  image: shopifyImageSchema.nullable().optional()
});

export const importShopifyProductsSchema = z.object({
  products: z.array(shopifyProductSchema)
});

export type ShopifyVariant = z.infer<typeof shopifyVariantSchema>;
export type ShopifyImage = z.infer<typeof shopifyImageSchema>;
export type ShopifyProduct = z.infer<typeof shopifyProductSchema>;
