import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { drainQueue } from "../lib/queue-drain.js";
import { DATAFORSEO_COMPETITORS_QUEUE, QUEUE_ARCHIVE_AFTER_READ_COUNT, QUEUE_VISIBILITY_SECONDS } from "../lib/queue-names.js";
import type { CompetitorTaskPayload } from "../lib/competitor-task-payload.js";
import { importShopifyProductsSchema } from "../schemas/product.js";
import { processCompetitorTaskMessage } from "../services/competitor-drain-service.js";

const productRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/products", async () => {
    const products = await fastify.productRepository.listProducts();
    return { items: products };
  });

  fastify.get("/products/:id", async (request) => {
    const params = request.params as { id: string };
    const id = parseProductId(params.id);
    const product = await fastify.productRepository.getProductById(id);

    if (!product) {
      throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    }

    return { item: product };
  });

  fastify.post("/products/import", async (request, reply) => {
    const body = importShopifyProductsSchema.parse(request.body);
    const imported = await fastify.productRepository.importProducts(body.products);
    reply.code(201);
    return { imported };
  });

  fastify.post("/products/sync", async (request, reply) => {
    if (!fastify.shopifyService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify credentials are not configured.");
    }
    const accessToken = await fastify.shopifyService.getAccessToken();
    let synced = 0;
    for await (const page of fastify.shopifyService.streamProducts(accessToken)) {
      synced += await fastify.productRepository.importProducts(page);
    }
    reply.code(200);
    return { synced };
  });

  fastify.post("/products/find-competitors", async (request, reply) => {
    const body = request.body as { productIds?: unknown };
    const raw = Array.isArray(body?.productIds) ? body.productIds : [];
    const productIds = raw.filter((id): id is number => Number.isInteger(id) && id > 0);

    if (productIds.length === 0) {
      throw new AppError(400, "INVALID_PRODUCT_IDS", "productIds must be a non-empty array of positive integers.");
    }

    const rows = await fastify.productRepository.getProductsByIds(productIds);
    const withTitle = rows.filter((p): p is typeof p & { title: string } => !!p.title);

    if (withTitle.length === 0) {
      reply.code(202);
      return { submitted: 0 };
    }

    const pingbackUrl =
      `${fastify.env.WEBHOOK_HOST}/webhooks/dataforseo/pingback/shopping` +
      `?secret=${fastify.env.DATAFORSEO_WEBHOOK_SECRET}&id=$id&tag=$tag`;

    const submitted = await fastify.dataForSeoService.postShoppingTasks(withTitle, pingbackUrl);

    reply.code(202);
    return { submitted };
  });

  // Manual "drain now" trigger for the competitor-pingback queue (see ADR
  // 0002) — drains whatever pingbacks are already queued from prior "Find
  // Competitor" submissions. No discovery step: discovery is
  // /products/find-competitors above, which submits new DataForSEO tasks.
  fastify.post("/products/competitors/drain", async (request, reply) => {
    const deps = {
      dataForSeoService: fastify.dataForSeoService,
      competitorRepository: fastify.competitorRepository,
      productRepository: fastify.productRepository,
      ownStoreName: fastify.env.OWN_STORE_NAME,
      webhookHost: fastify.env.WEBHOOK_HOST,
      dataForSeoWebhookSecret: fastify.env.DATAFORSEO_WEBHOOK_SECRET,
    };

    const result = await drainQueue<CompetitorTaskPayload>({
      pgmq: fastify.pgmqClient,
      queueName: DATAFORSEO_COMPETITORS_QUEUE,
      visibilitySeconds: QUEUE_VISIBILITY_SECONDS,
      archiveAfterReadCount: QUEUE_ARCHIVE_AFTER_READ_COUNT,
      processMessage: (message) => processCompetitorTaskMessage(deps, message),
      logger: request.log,
    });

    reply.code(200);
    return { ok: true, ...result };
  });

  fastify.get("/products/:id/sales", async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { page?: string; limit?: string };
    const id = parseProductId(params.id);
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));

    const product = await fastify.productRepository.getProductById(id);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");

    return fastify.orderRepository.getProductSalesHistory(id, { page, limit });
  });

  fastify.delete("/products/:id", async (request, reply) => {
    const id = parseProductId((request.params as { id: string }).id);
    const product = await fastify.productRepository.getProductById(id);
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product not found.");
    await fastify.productRepository.deleteProduct(id);
    reply.code(204).send();
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
