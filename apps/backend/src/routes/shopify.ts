import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { getTodayNZRange } from "../lib/nz-date-range.js";
import type { ScheduledSyncOrderPayload } from "../lib/sync-order-payload.js";

const shopifyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/shopify/orders/sync", async (request, reply) => {
    const body = request.body as { mode?: string; source?: string } | null;

    if (!body || body.mode !== "today") {
      throw new AppError(400, "INVALID_MODE", 'Request body must include mode: "today".');
    }

    if (!fastify.shopifyService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify credentials are not configured.");
    }
    if (!fastify.shopifyGraphQLService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify GraphQL service is not configured.");
    }
    if (!fastify.cloudTasksClient) {
      throw new AppError(503, "QUEUE_NOT_CONFIGURED", "Order sync queue is not available.");
    }

    const { from, to } = getTodayNZRange();
    const filter = `updated_at:>=${from.toISOString()} updated_at:<=${to.toISOString()}`;

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
      await fastify.cloudTasksClient.enqueueSyncOrder(fastify.env.ORDER_WORKER_URL!, payload);
    }

    reply.code(202);
    return {
      status: "queued",
      source: "manual",
      mode: "today",
      ordersDiscovered: orders.length,
      jobsEnqueued: orders.length,
      message: "Today's Shopify orders have been queued for sync.",
    };
  });
};

export default shopifyRoutes;
