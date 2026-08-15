import { getLast24Hours } from "../lib/nz-date-range.js";
import { extractGidId, mapGraphQLOrder } from "../lib/order-mapper.js";
import { SHOPIFY_ORDERS_QUEUE } from "../lib/queue-names.js";
import type { ScheduledSyncOrderPayload, SyncOrderPayload } from "../lib/sync-order-payload.js";
import type { OrderRepository } from "./order-repository.js";
import type { PgmqClient } from "./pgmq-client.js";
import type { ShopifyGraphQLService } from "./shopify-graphql-service.js";
import type { ShopifyService } from "./shopify-service.js";

export type OrderSyncDeps = {
  orderRepository: OrderRepository;
  shopifyService: ShopifyService | null;
  shopifyGraphQLService: ShopifyGraphQLService | null;
};

/**
 * Processes one message from the shopify_orders queue — moved here from the
 * old order-worker's `/internal/sync-order` handler unchanged (see ADR 0002).
 * Throws on failure so drainQueue can apply the leave-in-queue/archive
 * policy; the caller is responsible for catching.
 */
export async function processSyncOrderMessage(deps: OrderSyncDeps, payload: SyncOrderPayload): Promise<void> {
  if (payload.source === "webhook") {
    if (!deps.shopifyService || !deps.shopifyGraphQLService) {
      throw new Error("Shopify is not configured.");
    }

    const numericId = extractGidId(payload.shopifyOrderId);
    const storedUpdatedAt = await deps.orderRepository.getShopifyOrderUpdatedAt(numericId);
    if (storedUpdatedAt && new Date(payload.shopifyUpdatedAt) <= storedUpdatedAt) {
      return; // already up to date — matches the old staleness-guard skip
    }

    const accessToken = await deps.shopifyService.getAccessToken();
    const order = await deps.shopifyGraphQLService.fetchOrderById(accessToken, payload.shopifyOrderId);
    if (!order) {
      throw new Error(`Order not found in Shopify: ${payload.shopifyOrderId}`);
    }

    await deps.orderRepository.upsertMappedOrder(mapGraphQLOrder(order));
    return;
  }

  // scheduled_1am or manual — payload already carries the full Shopify order.
  await deps.orderRepository.upsertMappedOrder(mapGraphQLOrder(payload.shopifyOrder));
}

/**
 * Scans Shopify for orders updated in the last 24h and enqueues one
 * sync-order message per order — moved here from the old order-worker's
 * `/internal/scheduled-order-discovery` handler, now writing to pgmq
 * instead of Cloud Tasks. Used only by the scheduled path (see ADR 0002 —
 * the manual "Sync Orders" button on /orders keeps its own separate
 * 30-day discovery in routes/shopify.ts, unaffected by this).
 */
export async function discoverRecentOrders(deps: OrderSyncDeps, pgmq: PgmqClient): Promise<number> {
  if (!deps.shopifyService || !deps.shopifyGraphQLService) {
    throw new Error("Shopify is not configured.");
  }

  const from = getLast24Hours();
  const filter = `updated_at:>${from.toISOString()}`;
  const accessToken = await deps.shopifyService.getAccessToken();
  const orders = await deps.shopifyGraphQLService.fetchOrders(accessToken, filter);

  for (const order of orders) {
    const payload: ScheduledSyncOrderPayload = {
      type: "sync-order",
      source: "scheduled_1am",
      shopifyOrderId: order.id,
      orderName: order.name,
      shopifyUpdatedAt: order.updatedAt,
      shopifyOrder: order,
    };
    await pgmq.send(SHOPIFY_ORDERS_QUEUE, payload);
  }

  return orders.length;
}
