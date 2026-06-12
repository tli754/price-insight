import { Worker } from "bullmq";
import type { Redis as IORedis } from "ioredis";
import type { Queue } from "bullmq";

import { extractGidId, mapGraphQLOrder } from "../lib/order-mapper.js";
import { getLast36Hours } from "../lib/nz-date-range.js";
import type { OrderRepository } from "../services/order-repository.js";
import type { OrderSyncJobData, SyncOrderJobData } from "../services/order-sync-queue.js";
import type { ShopifyGraphQLService } from "../services/shopify-graphql-service.js";
import type { ShopifyService } from "../services/shopify-service.js";

export function createOrderSyncWorker(
  orderRepository: OrderRepository,
  queue: Queue<OrderSyncJobData>,
  shopifyService: ShopifyService | null,
  shopifyGraphQLService: ShopifyGraphQLService | null,
  redis: IORedis
): Worker<OrderSyncJobData> {
  return new Worker<OrderSyncJobData>(
    "shopify-order-sync",
    async (job) => {
      if (job.data.type === "discover-orders") {
        if (!shopifyService || !shopifyGraphQLService) {
          throw new Error("Shopify is not configured — cannot run scheduled discovery.");
        }
        const from = getLast36Hours();
        const filter = `updated_at:>${from.toISOString()}`;
        const accessToken = await shopifyService.getAccessToken();
        const orders = await shopifyGraphQLService.fetchOrders(accessToken, filter);

        for (const order of orders) {
          const jobData: SyncOrderJobData = {
            type: "sync-order",
            source: "scheduled_2am",
            shopifyOrderId: order.id,
            orderName: order.name,
            shopifyUpdatedAt: order.updatedAt,
            shopifyOrder: order,
          };
          await queue.add("sync-order", jobData);
        }
        return;
      }

      // sync-order (webhook): fetch from Shopify GraphQL, check staleness, then map + upsert.
      if (job.data.source === "webhook") {
        if (!shopifyService || !shopifyGraphQLService) {
          throw new Error("Shopify is not configured — cannot process webhook order.");
        }
        const numericId = extractGidId(job.data.shopifyOrderId);
        const storedUpdatedAt = await orderRepository.getShopifyOrderUpdatedAt(numericId);
        if (storedUpdatedAt && new Date(job.data.shopifyUpdatedAt) <= storedUpdatedAt) {
          return;
        }
        const accessToken = await shopifyService.getAccessToken();
        const order = await shopifyGraphQLService.fetchOrderById(accessToken, job.data.shopifyOrderId);
        if (!order) {
          throw new Error(`Order not found in Shopify: ${job.data.shopifyOrderId}`);
        }
        const mapped = mapGraphQLOrder(order);
        await orderRepository.upsertMappedOrder(mapped);
        return;
      }

      // sync-order (scheduled_2am / manual): use shopifyOrder directly.
      const mapped = mapGraphQLOrder(job.data.shopifyOrder);
      await orderRepository.upsertMappedOrder(mapped);
    },
    {
      connection: redis,
      concurrency: 1,
    }
  );
}
