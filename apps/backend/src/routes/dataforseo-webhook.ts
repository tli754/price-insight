import { timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";

import { DATAFORSEO_COMPETITORS_QUEUE } from "../lib/queue-names.js";

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

// Receives DataForSEO's pingback callbacks and enqueues them onto
// dataforseo_competitors for later processing (see ADR 0002) — this route
// only validates and enqueues, it never processes inline. Processing lives
// in services/competitor-drain-service.ts, run by
// routes/competitor-drain-internal.ts (scheduled) and
// routes/products.ts's /products/competitors/drain (manual).
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

    await fastify.pgmqClient.send(DATAFORSEO_COMPETITORS_QUEUE, { type: "process-shopping-pingback", taskId, productId });
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

    await fastify.pgmqClient.send(DATAFORSEO_COMPETITORS_QUEUE, { type: "process-product-info-pingback", taskId, productId });
    return reply.status(200).send();
  });
};

export default webhookRoutes;
