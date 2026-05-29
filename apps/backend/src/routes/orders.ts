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
};

export default ordersRoutes;
