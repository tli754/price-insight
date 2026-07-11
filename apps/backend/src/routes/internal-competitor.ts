import type { FastifyPluginAsync } from "fastify";

import { filterByCountryAndPriceRange, mapToCompetitorProductInput, normalizeSourceForCompare } from "../lib/competitor-filter.js";
import { verifyOidcToken } from "../lib/verify-oidc.js";
import type { DfsProductInfoGetResponse, DfsShoppingGetResponse } from "../services/dataforseo-service.js";

const internalCompetitorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request, reply) => {
    if (!fastify.env.INTERNAL_OIDC_SERVICE_ACCOUNT) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "OIDC not configured." } });
    }
    const verified = await verifyOidcToken(
      request.headers.authorization,
      fastify.env.INTERNAL_OIDC_SERVICE_ACCOUNT,
      fastify.env.BACKEND_CLOUD_RUN_URL ?? fastify.env.WEBHOOK_HOST
    );
    if (!verified) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or missing OIDC token." } });
    }
  });

  fastify.post("/internal/process-shopping-pingback", async (request, reply) => {
    const { taskId, productId } = request.body as { taskId: string; productId: number };

    let data: DfsShoppingGetResponse;
    try {
      data = await fastify.dataForSeoService.fetchShoppingTaskResult(taskId);
    } catch (err) {
      request.log.error({ taskId, productId, err }, "process-shopping-pingback: task_get failed");
      return reply.status(200).send({ ok: true });
    }

    const candidates = fastify.dataForSeoService.parseShoppingCandidates(data, fastify.env.OWN_STORE_NAME);
    if (candidates.length === 0) {
      return reply.status(200).send({ ok: true });
    }

    const deletedIds = await fastify.competitorRepository.getDeletedExternalIds(productId);
    const filtered = deletedIds.size
      ? candidates.filter((c) => !deletedIds.has(c.productId))
      : candidates;

    if (filtered.length === 0) {
      return reply.status(200).send({ ok: true });
    }

    const webhookBase = `${fastify.env.WEBHOOK_HOST}/webhooks/dataforseo/pingback/product_info`;
    const secret = fastify.env.DATAFORSEO_WEBHOOK_SECRET;

    try {
      await fastify.dataForSeoService.postProductInfoTasks(
        filtered.map((c) => c.productId),
        productId,
        `${webhookBase}?secret=${secret}&id=$id&tag=$tag`
      );
    } catch (err) {
      request.log.error({ productId, err }, "process-shopping-pingback: product_info task post failed");
    }

    return reply.status(200).send({ ok: true });
  });

  fastify.post("/internal/process-product-info-pingback", async (request, reply) => {
    const { taskId, productId } = request.body as { taskId: string; productId: number };

    const product = await fastify.productRepository.getProductById(productId);
    if (!product) {
      request.log.warn({ productId }, "process-product-info-pingback: product not found");
      return reply.status(200).send({ ok: true });
    }

    let data: DfsProductInfoGetResponse;
    try {
      data = await fastify.dataForSeoService.fetchProductInfoTaskResult(taskId);
    } catch (err) {
      request.log.error({ taskId, productId, err }, "process-product-info-pingback: task_get failed");
      return reply.status(200).send({ ok: true });
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

    if (toSave.length === 0) {
      return reply.status(200).send({ ok: true });
    }

    const rows = toSave.map((r) => mapToCompetitorProductInput(r));

    await Promise.all(rows.map((row) =>
      fastify.competitorRepository.upsertSuggestedCompetitor(productId, row)
    ));
    await fastify.competitorRepository.recordPricesForConfirmed(productId, rows);

    request.log.info({ productId, saved: rows.length }, "process-product-info-pingback: upserted suggested competitors");
    return reply.status(200).send({ ok: true });
  });
};

export default internalCompetitorRoutes;
