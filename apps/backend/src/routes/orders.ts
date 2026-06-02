import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/orders/sync", async (request, reply) => {
    if (!fastify.shopifyService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify credentials are not configured.");
    }
    const lastSyncedAt = await fastify.orderRepository.getLastSyncedAt();
    const accessToken = await fastify.shopifyService.getAccessToken();
    const shopifyOrders = await fastify.shopifyService.fetchOrders(accessToken, lastSyncedAt ?? undefined);
    const synced = await fastify.orderRepository.importOrders(shopifyOrders);
    reply.code(200);
    return { synced };
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
    const { items, total } = await fastify.orderRepository.listOrders({
      page,
      limit,
      search: query.search || undefined,
      financialStatus: query.financialStatus || undefined,
      fulfillmentStatus: query.fulfillmentStatus || undefined
    });
    reply.code(200);
    return { items, total, page, limit };
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
