import type { FastifyPluginAsync } from "fastify";

import type { WebhookSyncOrderPayload } from "../lib/sync-order-payload.js";
import { verifyShopifyHmac } from "../lib/shopify-hmac.js";

const SUPPORTED_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "orders/paid",
  "orders/cancelled",
  "refunds/create",
]);

const shopifyWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Plugin-scoped raw body parser — must come before handlers so HMAC can read raw bytes.
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  fastify.post("/webhooks/shopify/orders", async (request, reply) => {
    const secret = fastify.env.SHOPIFY_CLIENT_SECRET;
    if (!secret) {
      return reply.status(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Shopify webhook not configured." } });
    }

    const hmacHeader = request.headers["x-shopify-hmac-sha256"];
    if (!hmacHeader || typeof hmacHeader !== "string") {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Missing HMAC signature." } });
    }

    const rawBody = request.body as Buffer;
    if (!verifyShopifyHmac(rawBody, hmacHeader, secret)) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid HMAC signature." } });
    }

    const topic = request.headers["x-shopify-topic"];
    if (!topic || typeof topic !== "string" || !SUPPORTED_TOPICS.has(topic)) {
      return reply.status(200).send({ ok: true });
    }

    const webhookId = request.headers["x-shopify-webhook-id"];
    if (!webhookId || typeof webhookId !== "string") {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Missing webhook ID." } });
    }

    const shopDomain = request.headers["x-shopify-shop-domain"];

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Invalid JSON body." } });
    }

    const shopifyOrderId = body["admin_graphql_api_id"];
    const orderName = body["name"];
    const shopifyUpdatedAt = body["updated_at"];

    if (typeof shopifyOrderId !== "string" || !shopifyOrderId) {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Missing admin_graphql_api_id." } });
    }
    if (typeof orderName !== "string" || !orderName) {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Missing order name." } });
    }
    if (typeof shopifyUpdatedAt !== "string" || !shopifyUpdatedAt) {
      return reply.status(400).send({ error: { code: "BAD_REQUEST", message: "Missing updated_at." } });
    }

    if (!fastify.cloudTasksClient) {
      return reply.status(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Cloud Tasks is not configured." } });
    }

    const payload: WebhookSyncOrderPayload = {
      type: "sync-order",
      source: "webhook",
      webhookId,
      topic,
      shopDomain: typeof shopDomain === "string" ? shopDomain : "",
      shopifyOrderId,
      orderName,
      shopifyUpdatedAt,
    };

    try {
      await fastify.cloudTasksClient.enqueueSyncOrder(fastify.env.ORDER_WORKER_URL!, payload);
    } catch (err) {
      request.log.error(err, "Failed to enqueue webhook order task");
      return reply.status(500).send({ error: { code: "INTERNAL_SERVER_ERROR", message: "Failed to enqueue task." } });
    }

    return reply.status(200).send({ ok: true });
  });
};

export default shopifyWebhookRoutes;
