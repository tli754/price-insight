import { timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";

import type { DfsProductInfoGetResponse, DfsShoppingGetResponse } from "../services/dataforseo-service.js";
import type { CompetitorProductInput } from "../services/competitor-repository.js";

const LANGUAGE_CODE = "en";
const LOCATION_CODE = 2554;

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

function normalizeSource(source: string): string {
  return source.trim().toLowerCase();
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

    let data: DfsShoppingGetResponse;
    try {
      data = await fastify.dataForSeoService.fetchShoppingTaskResult(taskId);
    } catch (err) {
      request.log.error({ taskId, productId, err }, "dataforseo/shopping pingback: task_get failed");
      return reply.status(200).send();
    }

    const candidates = fastify.dataForSeoService.parseShoppingCandidates(data, fastify.env.OWN_STORE_NAME);

    if (candidates.length === 0) {
      return reply.status(200).send();
    }

    const deletedIds = await fastify.competitorRepository.getDeletedExternalIds(productId);
    const filtered = deletedIds.size
      ? candidates.filter((c) => !deletedIds.has(c.productId))
      : candidates;

    if (filtered.length === 0) {
      return reply.status(200).send();
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

    const stub = { productId: "", seller: "", title: "", price: 0, currency: "NZD", oldPrice: null, thumbnail: null, rating: null, reviewCount: null, tag: null, googlePosition: null };
    const results = fastify.dataForSeoService.fetchProductInfoResults(data, stub);

    const ownStore = fastify.env.OWN_STORE_NAME ? normalizeSource(fastify.env.OWN_STORE_NAME) : null;
    const productPrice = product.price != null ? Number(product.price) : null;

    const toSave = results.filter((r) => {
      if (r.country !== "NZ" && r.country !== "AU") return false;
      if (productPrice != null) {
        if (r.extractedPrice < productPrice / 2 || r.extractedPrice > productPrice * 2) return false;
      }
      if (ownStore && normalizeSource(r.source) === ownStore) return false;
      return true;
    });

    if (toSave.length === 0) {
      return reply.status(200).send();
    }

    const rows: CompetitorProductInput[] = toSave.map((r) => ({
      competitorId: null,
      title: r.title,
      externalId: r.externalId,
      productLink: r.link,
      source: r.source.trim() || "Unknown",
      currency: r.currency,
      thumbnail: r.thumbnail,
      tag: r.tag ?? null,
      googlePosition: r.googlePosition ?? null,
      rawPrice: r.rawPrice,
      extractedPrice: r.extractedPrice,
      country: r.country ?? null,
      rating: r.rating ?? null,
      reviewCount: r.reviewCount ?? null,
      shippingRaw: r.shippingRaw ?? null,
      shippingExtracted: r.shippingExtracted ?? null,
      extractedOldPrice: r.extractedOldPrice ?? null
    }));

    await Promise.all(rows.map((row) =>
      fastify.competitorRepository.upsertSuggestedCompetitor(productId, row)
    ));

    await fastify.competitorRepository.recordPricesForConfirmed(productId, rows);

    request.log.info({ productId, saved: rows.length }, "dataforseo/product_info pingback: upserted suggested competitors");

    return reply.status(200).send();
  });
};

export default webhookRoutes;
