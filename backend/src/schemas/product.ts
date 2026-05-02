import { z } from "zod";

export const productStatusSchema = z.enum(["pending", "approved", "deleted"]);

export const productExtractionSchema = z.object({
  source_url: z.string().url(),
  product_name: z.string().trim().min(1).nullable(),
  brand: z.string().trim().min(1).nullable(),
  model_or_variant: z.string().trim().min(1).nullable(),
  thumbnail: z.string().url().nullable(),
  price: z.number().nonnegative().nullable(),
  sales_price: z.number().nonnegative().nullable(),
  currency: z.string().trim().min(1).max(16).nullable(),
  availability: z.string().trim().min(1).nullable(),
  seller_or_store: z.string().trim().min(1).nullable(),
  product_category: z.string().trim().min(1).nullable(),
  key_specs: z.array(z.string().trim().min(1)).max(20),
  confidence: z.enum(["high", "medium", "low"])
});

export type ProductExtraction = z.infer<typeof productExtractionSchema>;

export const extractProductRequestSchema = z.object({
  productUrl: z.string().url()
});

export const updateProductStatusSchema = z.object({
  status: productStatusSchema
});

export const openAIExtractionJsonSchema = {
  name: "product_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      source_url: { type: "string" },
      product_name: { type: ["string", "null"] },
      brand: { type: ["string", "null"] },
      model_or_variant: { type: ["string", "null"] },
      thumbnail: { type: ["string", "null"] },
      price: { type: ["number", "null"] },
      sales_price: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      availability: { type: ["string", "null"] },
      seller_or_store: { type: ["string", "null"] },
      product_category: { type: ["string", "null"] },
      key_specs: {
        type: "array",
        items: { type: "string" },
        maxItems: 20
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"]
      }
    },
    required: [
      "source_url",
      "product_name",
      "brand",
      "model_or_variant",
      "thumbnail",
      "price",
      "sales_price",
      "currency",
      "availability",
      "seller_or_store",
      "product_category",
      "key_specs",
      "confidence"
    ]
  }
} as const;

export function validateExtractionRules(extraction: ProductExtraction): ProductExtraction {
  if (extraction.sales_price !== null && extraction.price !== null && extraction.sales_price > extraction.price) {
    throw new Error("sales_price cannot be greater than price.");
  }

  return extraction;
}
