import type { FastifyPluginAsync } from "fastify";

import { drainQueue } from "../lib/queue-drain.js";
import { QUEUE_ARCHIVE_AFTER_READ_COUNT, QUEUE_VISIBILITY_SECONDS, SHOPIFY_ORDERS_QUEUE } from "../lib/queue-names.js";
import type { SyncOrderPayload } from "../lib/sync-order-payload.js";
import { verifyOidcToken } from "../lib/verify-oidc.js";
import { discoverRecentOrders, processSyncOrderMessage } from "../services/order-sync-service.js";

/**
 * Scheduled entrypoint for the daily shopify_orders discovery+drain — the
 * Cloud Scheduler target that replaces order-worker's old
 * /internal/scheduled-order-discovery + Cloud Tasks push (see ADR 0002).
 * Runs discovery (last-24h Shopify scan, enqueues into pgmq) then
 * immediately drains the same queue, in one execution, so discovery output
 * is never left waiting for the *next* day's run.
 *
 * The manual "drain now" button on /orders (routes/orders.ts) is
 * deliberately NOT this same route — it drains only, no discovery, per the
 * plan's Gap 1 resolution (keeps the existing 30-day "Sync Orders" button in
 * routes/shopify.ts as the manual discovery path, unchanged).
 */
const orderSyncInternalRoutes: FastifyPluginAsync = async (fastify) => {
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

  fastify.post("/internal/order-sync-run", async (request, reply) => {
    const deps = {
      orderRepository: fastify.orderRepository,
      shopifyService: fastify.shopifyService,
      shopifyGraphQLService: fastify.shopifyGraphQLService,
    };

    let discovered = 0;
    try {
      discovered = await discoverRecentOrders(deps, fastify.pgmqClient);
    } catch (err) {
      // A discovery failure must not block draining whatever's already
      // queued (webhook traffic, or a prior manual enqueue) — see plan
      // Risks in plan-15082026-pgmq-queue-migration.md.
      request.log.error({ err }, "order-sync-run: discovery failed, continuing to drain");
    }

    const result = await drainQueue<SyncOrderPayload>({
      pgmq: fastify.pgmqClient,
      queueName: SHOPIFY_ORDERS_QUEUE,
      visibilitySeconds: QUEUE_VISIBILITY_SECONDS,
      archiveAfterReadCount: QUEUE_ARCHIVE_AFTER_READ_COUNT,
      processMessage: (message) => processSyncOrderMessage(deps, message),
      logger: request.log,
    });

    return reply.status(200).send({ ok: true, discovered, ...result });
  });
};

export default orderSyncInternalRoutes;
