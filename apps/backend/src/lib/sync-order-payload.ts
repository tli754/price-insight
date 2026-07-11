import type { ShopifyGQLOrder } from "../services/shopify-graphql-service.js";

export type ScheduledSyncOrderPayload = {
  type: "sync-order";
  source: "scheduled_2am" | "manual";
  shopifyOrderId: string;
  orderName: string;
  shopifyUpdatedAt: string;
  shopifyOrder: ShopifyGQLOrder;
};

export type WebhookSyncOrderPayload = {
  type: "sync-order";
  source: "webhook";
  webhookId: string;
  topic: string;
  shopDomain: string;
  shopifyOrderId: string;
  orderName: string;
  shopifyUpdatedAt: string;
};

export type SyncOrderPayload = ScheduledSyncOrderPayload | WebhookSyncOrderPayload;
