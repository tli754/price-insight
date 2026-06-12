import { Queue } from "bullmq";
import type { Redis as IORedis } from "ioredis";

import type { ShopifyGQLOrder } from "./shopify-graphql-service.js";

export type SyncOrderJobData = {
  type: "sync-order";
  source: "scheduled_2am" | "manual";
  shopifyOrderId: string;
  orderName: string;
  shopifyUpdatedAt: string;
  shopifyOrder: ShopifyGQLOrder;
};

export type SyncWebhookOrderJobData = {
  type: "sync-order";
  source: "webhook";
  webhookId: string;
  topic: string;
  shopDomain: string;
  shopifyOrderId: string;
  orderName: string;
  shopifyUpdatedAt: string;
};

export type DiscoverOrdersJobData = {
  type: "discover-orders";
  source: "scheduled_2am";
};

export type OrderSyncJobData = SyncOrderJobData | SyncWebhookOrderJobData | DiscoverOrdersJobData;

export const ORDER_SYNC_QUEUE = "shopify-order-sync";

export function createOrderSyncQueue(redis: IORedis): Queue<OrderSyncJobData> {
  return new Queue<OrderSyncJobData>(ORDER_SYNC_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    },
  });
}
