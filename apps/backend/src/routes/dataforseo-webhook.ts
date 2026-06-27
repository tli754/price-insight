import { timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";

import { filterByCountryAndPriceRange, mapToCompetitorProductInput, normalizeSourceForCompare } from "../lib/competitor-filter.js";
import type { DfsProductInfoGetResponse, DfsShoppingGetResponse } from "../services/dataforseo-service.js";

function validateSecret(incoming: string, expected: string): boolean {
  try {
    const a = Buffer.from(incoming);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/webhooks/dataforseo/pingback/shopping", async (request, reply) => {
    const query = request.query as Record<string, string>;

    if (!validateSecret(query.secret ?? "", fastify.env.DATAFORSEO_WEBHOOK_SECRET)) {
      return reply.status(401).send();
    }

    const taskId = query.id;
    const productId = Number(query.tag);

    if (!taskId || !Number.isInteger(productId) || productId <= 0) {
      request.log.warn({ taskId, tag: query.tag }, "dataforseo/shopping pingback: invalid params");
      return reply.status(200).send();
    }

    if (fastify.cloudTasksCompetitorClient) {
      await fastify.cloudTasksCompetitorClient.enqueue({ type: "process-shopping-pingback", taskId, productId });
      return reply.status(200).send();
    }

    // Inline fallback: Cloud Tasks not configured (local dev)
    request.log.warn({ taskId, productId }, "dataforseo/shopping pingback: cloudTasksCompetitorClient not configured — processing inline");

    let data: DfsShoppingGetResponse;
    try {
      data = await fastify.dataForSeoService.fetchShoppingTaskResult(taskId);
    } catch (err) {
      request.log.error({ taskId, productId, err }, "dataforseo/shopping pingback: task_get failed");
      return reply.status(200).send();
    }

    const candidates = fastify.dataForSeoService.parseShoppingCandidates(data, fastify.env.OWN_STORE_NAME);
    if (candidates.length === 0) return reply.status(200).send();

    const deletedIds = await fastify.competitorRepository.getDeletedExternalIds(productId);
    const filtered = deletedIds.size
      ? candidates.filter((c) => !deletedIds.has(c.productId))
      : candidates;

    if (filtered.length === 0) return reply.status(200).send();

    const webhookBase = `${fastify.env.WEBHOOK_HOST}/webhooks/dataforseo/pingback/product_info`;
    const secret = fastify.env.DATAFORSEO_WEBHOOK_SECRET;

    try {
      await fastify.dataForSeoService.postProductInfoTasks(
        filtered.map((c) => c.productId),
        productId,
        `${webhookBase}?secret=${secret}&id=$id&tag=$tag`
      );
    } catch (err) {
      request.log.error({ productId, err }, "dataforseo/shopping pingback: product_info task post failed");
    }

    return reply.status(200).send();
  });

  fastify.get("/webhooks/dataforseo/pingback/product_info", async (request, reply) => {
    const query = request.query as Record<string, string>;

    if (!validateSecret(query.secret ?? "", fastify.env.DATAFORSEO_WEBHOOK_SECRET)) {
      return reply.status(401).send();
    }

    const taskId = query.id;
    const productId = Number(query.tag);

    if (!taskId || !Number.isInteger(productId) || productId <= 0) {
      request.log.warn({ taskId, tag: query.tag }, "dataforseo/product_info pingback: invalid params");
      return reply.status(200).send();
    }

    if (fastify.cloudTasksCompetitorClient) {
      await fastify.cloudTasksCompetitorClient.enqueue({ type: "process-product-info-pingback", taskId, productId });
      return reply.status(200).send();
    }

    // Inline fallback: Cloud Tasks not configured (local dev)
    request.log.warn({ taskId, productId }, "dataforseo/product_info pingback: cloudTasksCompetitorClient not configured — processing inline");

    const product = await fastify.productRepository.getProductById(productId);
    if (!product) {
      request.log.warn({ productId }, "dataforseo/product_info pingback: product not found");
      return reply.status(200).send();
    }

    let data: DfsProductInfoGetResponse;
    try {
      data = await fastify.dataForSeoService.fetchProductInfoTaskResult(taskId);
    } catch (err) {
      request.log.error({ taskId, productId, err }, "dataforseo/product_info pingback: task_get failed");
      return reply.status(200).send();
    }

    const stub = {
      productId: "", seller: "", title: "", price: 0, currency: "NZD",
      oldPrice: null, thumbnail: null, rating: null, reviewCount: null, tag: null, googlePosition: null,
    };
    const results = fastify.dataForSeoService.fetchProductInfoResults(data, stub);

    const ownStore = fastify.env.OWN_STORE_NAME ? normalizeSourceForCompare(fastify.env.OWN_STORE_NAME) : null;
    const productPrice = product.price != null ? Number(product.price) : null;

    const filteredResults = filterByCountryAndPriceRange(results, productPrice);
    const toSave = ownStore
      ? filteredResults.filter((r) => normalizeSourceForCompare(r.source) !== ownStore)
      : filteredResults;

    if (toSave.length === 0) return reply.status(200).send();

    const rows = toSave.map((r) => mapToCompetitorProductInput(r));

    await Promise.all(rows.map((row) =>
      fastify.competitorRepository.upsertSuggestedCompetitor(productId, row)
    ));
    await fastify.competitorRepository.recordPricesForConfirmed(productId, rows);

    request.log.info({ productId, saved: rows.length }, "dataforseo/product_info pingback: upserted suggested competitors");
    return reply.status(200).send();
  });
};

export default webhookRoutes;
