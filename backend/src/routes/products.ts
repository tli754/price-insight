import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { extractProductRequestSchema, updateProductStatusSchema } from "../schemas/product.js";

const productRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/products", async () => {
    const products = await fastify.productRepository.listProducts();
    return {
      items: products
    };
  });

  fastify.get("/products/:id", async (request) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);
    const product = await fastify.productRepository.getProductById(id);

    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    return {
      item: product
    };
  });

  fastify.post("/products/extract", async (request, reply) => {
    const body = extractProductRequestSchema.parse(request.body);
    const result = await fastify.extractorService.extractFromUrl(body.productUrl);

    reply.code(result.cached ? 200 : 201);
    return result;
  });

  fastify.patch("/products/:id/status", async (request) => {
    const params = request.params as { id: string };
    const body = updateProductStatusSchema.parse(request.body);
    const id = parseProductId(params.id);

    const product = await fastify.productRepository.updateStatus(id, body.status);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    return {
      item: product
    };
  });
};

export default productRoutes;

function parseProductId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "INVALID_PRODUCT_ID", "Product id must be a positive integer.");
  }

  return id;
}
