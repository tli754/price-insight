/**
 * Load orders from Shopify into the database via the BullMQ queue.
 * Safe to run multiple times — the worker skips orders that haven't changed
 * (staleness check on shopify_updated_at).
 *
 * Usage:
 *   cd apps/backend && npx tsx src/scripts/load-recent-orders.ts
 *
 * Options (env vars):
 *   SINCE=2024-01-01   Only fetch orders updated since this ISO date.
 *                      Omit to fetch ALL orders.
 *   BATCH_LOG=50       Log progress every N jobs enqueued (default: 50).
 */

import "dotenv/config";

import { loadEnv } from "../config/env.js";
import { createRedisConnection } from "../config/redis.js";
import { createOrderSyncQueue } from "../services/order-sync-queue.js";
import type { SyncOrderJobData } from "../services/order-sync-queue.js";
import { ShopifyGraphQLService } from "../services/shopify-graphql-service.js";
import { ShopifyService } from "../services/shopify-service.js";

const env = loadEnv();

if (
  !env.SHOPIFY_TOKEN_URL ||
  !env.SHOPIFY_PRODUCTS_URL ||
  !env.SHOPIFY_CLIENT_ID ||
  !env.SHOPIFY_CLIENT_SECRET
) {
  console.error("[load-orders] Shopify credentials are not configured. Check your .env file.");
  process.exit(1);
}

const since = process.env.SINCE ?? null;
const filter = since ? `updated_at:>=${since}` : "";
const batchLog = parseInt(process.env.BATCH_LOG ?? "50", 10);

console.log(
  since
    ? `[load-orders] Fetching orders updated since ${since}…`
    : "[load-orders] Fetching ALL orders from Shopify…"
);

const redis = createRedisConnection(env);
const queue = createOrderSyncQueue(redis);

const shopifyService = new ShopifyService(
  env.SHOPIFY_TOKEN_URL,
  env.SHOPIFY_PRODUCTS_URL,
  env.SHOPIFY_CLIENT_ID,
  env.SHOPIFY_CLIENT_SECRET,
  env.SHOPIFY_ORDERS_URL
);
const graphqlService = new ShopifyGraphQLService(env.SHOPIFY_PRODUCTS_URL);

try {
  const accessToken = await shopifyService.getAccessToken();
  const orders = await graphqlService.fetchOrders(accessToken, filter);
  console.log(`[load-orders] ${orders.length} orders fetched`);

  if (orders.length === 0) {
    console.log("[load-orders] Nothing to enqueue.");
  } else {
    let enqueued = 0;
    for (const order of orders) {
      const jobData: SyncOrderJobData = {
        type: "sync-order",
        source: "manual",
        shopifyOrderId: order.id,
        orderName: order.name,
        shopifyUpdatedAt: order.updatedAt,
        shopifyOrder: order,
      };
      await queue.add("sync-order", jobData);
      enqueued++;
      if (enqueued % batchLog === 0) {
        console.log(`[load-orders] Enqueued ${enqueued}/${orders.length}…`);
      }
    }
    console.log(`[load-orders] Done. ${enqueued} jobs enqueued. Worker will skip unchanged orders.`);
  }
} catch (err) {
  console.error("[load-orders] Failed:", err);
  process.exit(1);
} finally {
  await queue.close();
  await redis.quit();
}
