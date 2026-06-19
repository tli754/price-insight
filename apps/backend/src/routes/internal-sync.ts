import type { FastifyPluginAsync } from "fastify";

import { getLast24Hours } from "../lib/nz-date-range.js";
import { extractGidId, mapGraphQLOrder } from "../lib/order-mapper.js";
import type { SyncOrderPayload } from "../lib/sync-order-payload.js";
import { verifyOidcToken } from "../lib/verify-oidc.js";
import type { CloudTasksOrderSyncClient } from "../services/cloud-tasks-client.js";
import type { OrderRepository } from "../services/order-repository.js";
import type { ShopifyGraphQLService } from "../services/shopify-graphql-service.js";
import type { ShopifyService } from "../services/shopify-service.js";

export type InternalSyncDeps = {
  orderRepository: OrderRepository;
  shopifyService: ShopifyService | null;
  shopifyGraphQLService: ShopifyGraphQLService | null;
  cloudTasksClient: CloudTasksOrderSyncClient | null;
  internalOidcServiceAccount: string;
};

const internalSyncRoutes: FastifyPluginAsync<InternalSyncDeps> = async (fastify, opts) => {
  fastify.addHook("preHandler", async (request, reply) => {
    const audience = `https://${request.headers.host}`;
    const verified = await verifyOidcToken(request.headers.authorization, opts.internalOidcServiceAccount, audience);
    if (!verified) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or missing OIDC token." } });
    }
  });

  fastify.post("/internal/sync-order", async (request, reply) => {
    const payload = request.body as SyncOrderPayload;

    if (payload.source === "webhook") {
      if (!opts.shopifyService || !opts.shopifyGraphQLService) {
        return reply.status(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Shopify is not configured." } });
      }

      const numericId = extractGidId(payload.shopifyOrderId);
      const storedUpdatedAt = await opts.orderRepository.getShopifyOrderUpdatedAt(numericId);
      if (storedUpdatedAt && new Date(payload.shopifyUpdatedAt) <= storedUpdatedAt) {
        return reply.status(200).send({ ok: true, skipped: true });
      }

      const accessToken = await opts.shopifyService.getAccessToken();
      const order = await opts.shopifyGraphQLService.fetchOrderById(accessToken, payload.shopifyOrderId);
      if (!order) {
        // 5xx (not 404) so Cloud Tasks retries — matches BullMQ's prior throw-on-not-found behavior.
        return reply.status(502).send({ error: { code: "ORDER_NOT_FOUND", message: "Order not found in Shopify." } });
      }

      const mapped = mapGraphQLOrder(order);
      await opts.orderRepository.upsertMappedOrder(mapped);
      return reply.status(200).send({ ok: true });
    }

    const mapped = mapGraphQLOrder(payload.shopifyOrder);
    await opts.orderRepository.upsertMappedOrder(mapped);
    return reply.status(200).send({ ok: true });
  });

  fastify.post("/internal/scheduled-order-discovery", async (request, reply) => {
    if (!opts.shopifyService || !opts.shopifyGraphQLService) {
      return reply.status(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Shopify is not configured." } });
    }
    if (!opts.cloudTasksClient) {
      return reply.status(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Cloud Tasks is not configured." } });
    }

    const selfUrl = `https://${request.headers.host}`;
    const from = getLast24Hours();
    const filter = `updated_at:>${from.toISOString()}`;
    const accessToken = await opts.shopifyService.getAccessToken();
    const orders = await opts.shopifyGraphQLService.fetchOrders(accessToken, filter);

    for (const order of orders) {
      await opts.cloudTasksClient.enqueueSyncOrder(selfUrl, {
        type: "sync-order",
        source: "scheduled_2am",
        shopifyOrderId: order.id,
        orderName: order.name,
        shopifyUpdatedAt: order.updatedAt,
        shopifyOrder: order,
      });
    }

    return reply.status(200).send({ ok: true, count: orders.length });
  });
};

export default internalSyncRoutes;
