import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../lib/app-error.js";
import { drainQueue } from "../lib/queue-drain.js";
import { QUEUE_ARCHIVE_AFTER_READ_COUNT, QUEUE_VISIBILITY_SECONDS, SHOPIFY_ORDERS_QUEUE } from "../lib/queue-names.js";
import type { SyncOrderPayload } from "../lib/sync-order-payload.js";
import { processSyncOrderMessage } from "../services/order-sync-service.js";

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
  // Manual "drain now" trigger (see ADR 0002 / plan-15082026-pgmq-queue-migration.md
  // Gap 1) — drains whatever's already in shopify_orders (webhook traffic +
  // whatever the "Sync Orders" button in routes/shopify.ts has enqueued), no
  // discovery step of its own. Runs inline, synchronously, in this request.
  fastify.post("/orders/sync-now", async (request, reply) => {
    if (!fastify.shopifyService || !fastify.shopifyGraphQLService) {
      throw new AppError(503, "SHOPIFY_NOT_CONFIGURED", "Shopify credentials are not configured.");
    }

    const deps = {
      orderRepository: fastify.orderRepository,
      shopifyService: fastify.shopifyService,
      shopifyGraphQLService: fastify.shopifyGraphQLService,
    };

    const result = await drainQueue<SyncOrderPayload>({
      pgmq: fastify.pgmqClient,
      queueName: SHOPIFY_ORDERS_QUEUE,
      visibilitySeconds: QUEUE_VISIBILITY_SECONDS,
      archiveAfterReadCount: QUEUE_ARCHIVE_AFTER_READ_COUNT,
      processMessage: (message) => processSyncOrderMessage(deps, message),
      logger: request.log,
    });

    reply.code(200);
    return { ok: true, ...result };
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
