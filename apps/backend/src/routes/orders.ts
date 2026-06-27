import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { getLast7Days } from "../lib/nz-date-range.js";
import type { ScheduledSyncOrderPayload } from "../lib/sync-order-payload.js";

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/orders/sync", async (request, reply) => {
    if (!fastify.shopifyService || !fastify.shopifyGraphQLService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify credentials are not configured.");
    }
    if (!fastify.cloudTasksClient) {
      throw new AppError(503, "QUEUE_NOT_CONFIGURED", "Order sync queue is not available.");
    }

    const filter = `updated_at:>=${getLast7Days().toISOString()}`;
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
    return { status: "queued", jobsEnqueued: orders.length };
  });

  fastify.get("/orders", async (request, reply) => {
    const query = request.query as {
      page?: string;
      limit?: string;
      search?: string;
      financialStatus?: string;
      fulfillmentStatus?: string;
    };
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const { items, total, totalSales } = await fastify.orderRepository.listOrders({
      page,
      limit,
      search: query.search || undefined,
      financialStatus: query.financialStatus || undefined,
      fulfillmentStatus: query.fulfillmentStatus || undefined
    });
    reply.code(200);
    return { items, total, totalSales, page, limit };
  });

  fastify.get("/orders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = parseInt(id, 10);
    if (isNaN(parsed)) throw new AppError(400, "INVALID_ID", "Order id must be a number.");
    const result = await fastify.orderRepository.getOrderById(parsed);
    if (!result) throw new AppError(404, "ORDERS_NOT_FOUND", "Order not found.");
    reply.code(200);
    return { item: result };
  });
};

export default ordersRoutes;
