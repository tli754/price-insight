import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { saveCompetitorsSchema } from "../schemas/competitor.js";

const competitorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/products/:id/competitors", async (request) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    return fastify.competitorAnalysisService.fetchCompetitors(product);
  });

  fastify.post("/products/:id/competitors", async (request) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    const body = saveCompetitorsSchema.parse(request.body);
    const saved = await fastify.competitorAnalysisService.saveCompetitors(product, body.competitors);

    return { items: saved };
  });
};

export default competitorRoutes;

function parseProductId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "INVALID_PRODUCT_ID", "Product id must be a positive integer.");
  }
  return id;
}
