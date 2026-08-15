import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { getLast30Days } from "../lib/nz-date-range.js";
import { SHOPIFY_ORDERS_QUEUE } from "../lib/queue-names.js";
import type { ScheduledSyncOrderPayload } from "../lib/sync-order-payload.js";

const shopifyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/shopify/orders/sync", async (request, reply) => {
    const body = request.body as { mode?: string; source?: string } | null;

    if (!body || body.mode !== "last30days") {
      throw new AppError(400, "INVALID_MODE", 'Request body must include mode: "last30days".');
    }

    if (!fastify.shopifyService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify credentials are not configured.");
    }
    if (!fastify.shopifyGraphQLService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify GraphQL service is not configured.");
    }

    const since = getLast30Days();
    const filter = `updated_at:>=${since.toISOString()}`;

    const accessToken = await fastify.shopifyService.getAccessToken();
    const orders = await fastify.shopifyGraphQLService.fetchOrders(accessToken, filter);

    for (const order of orders) {
      const payload: ScheduledSyncOrderPayload = {
        type: "sync-order",
        source: "manual",
        shopifyOrderId: order.id,
        orderName: order.name,
        shopifyUpdatedAt: order.updatedAt,
        shopifyOrder: order,
      };
      await fastify.pgmqClient.send(SHOPIFY_ORDERS_QUEUE, payload);
    }

    reply.code(202);
    return {
      status: "queued",
      source: "manual",
      mode: "last30days",
      ordersDiscovered: orders.length,
      jobsEnqueued: orders.length,
      message: "Shopify orders from the last 30 days have been queued for sync.",
    };
  });
};

export default shopifyRoutes;
