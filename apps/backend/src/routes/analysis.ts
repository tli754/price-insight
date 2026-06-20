import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { saveCompetitorsSchema } from "../schemas/competitor.js";

const competitorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/competitors", async () => {
    const items = await fastify.competitorRepository.getAllCompetitors();
    return { items };
  });

  fastify.get("/competitors/:id/products", async (request) => {
    const params = request.params as { id: string };
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError(400, "INVALID_COMPETITOR_ID", "Competitor id must be a positive integer.");
    }

    const comp = await fastify.competitorRepository.getCompetitorById(id);
    if (!comp) {
      throw new AppError(404, "COMPETITOR_NOT_FOUND", "Competitor not found.");
    }

    const items = await fastify.competitorRepository.getProductsByCompetitorId(id);
    return { competitor: { id: comp.id, name: comp.name, state: comp.state }, items };
  });

  fastify.get("/products/:id/saved-competitors", async (request) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    const items = await fastify.competitorRepository.getSavedCompetitorsWithPrice(id);
    return { items };
  });

  fastify.get("/products/:id/competitors", async (request) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    const items = await fastify.competitorRepository.getCompetitorsByProductId(id);
    return { items };
  });

  fastify.post("/products/:id/competitors/search", async (request, reply) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);

    const product = await fastify.productRepository.getProductById(id);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    if (!product.title) {
      reply.code(202);
      return { submitted: 0 };
    }

    const pingbackUrl =
      `${fastify.env.WEBHOOK_HOST}/webhooks/dataforseo/pingback/shopping` +
      `?secret=${fastify.env.DATAFORSEO_WEBHOOK_SECRET}&id=$id&tag=$tag`;

    const submitted = await fastify.dataForSeoService.postShoppingTasks(
      [{ id: product.id, title: product.title }],
      pingbackUrl
    );

    reply.code(202);
    return { submitted };
  });

  fastify.patch("/products/:id/competitors/:competitorId", async (request) => {
    const params = request.params as { id: string; competitorId: string };
    const productId = parseProductId(params.id);
    const competitorId = Number(params.competitorId);

    if (!Number.isInteger(competitorId) || competitorId <= 0) {
      throw new AppError(400, "INVALID_COMPETITOR_ID", "Competitor id must be a positive integer.");
    }

    const product = await fastify.productRepository.getProductById(productId);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    const body = request.body as { status?: string };
    if (body?.status !== "confirmed") {
      throw new AppError(400, "INVALID_STATUS", "Only 'confirmed' status is accepted.");
    }

    await fastify.competitorRepository.confirmCompetitorProduct(competitorId);
    return { ok: true };
  });

  fastify.delete("/products/:id/competitors/:competitorId", async (request, reply) => {
    const params = request.params as { id: string; competitorId: string };
    const productId = parseProductId(params.id);
    const competitorId = Number(params.competitorId);

    if (!Number.isInteger(competitorId) || competitorId <= 0) {
      throw new AppError(400, "INVALID_COMPETITOR_ID", "Competitor id must be a positive integer.");
    }

    const product = await fastify.productRepository.getProductById(productId);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    await fastify.competitorRepository.deleteCompetitorProduct(competitorId);
    reply.status(204).send();
  });

  fastify.delete("/products/:id/saved-competitors/:competitorId", async (request, reply) => {
    const params = request.params as { id: string; competitorId: string };
    const productId = parseProductId(params.id);
    const competitorId = Number(params.competitorId);

    if (!Number.isInteger(competitorId) || competitorId <= 0) {
      throw new AppError(400, "INVALID_COMPETITOR_ID", "Competitor id must be a positive integer.");
    }

    const product = await fastify.productRepository.getProductById(productId);
    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    await fastify.competitorRepository.deleteCompetitorProduct(competitorId);
    reply.status(204).send();
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
