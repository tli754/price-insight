/**
 * Load orders from Shopify into the database via the BullMQ queue.
 * Safe to run multiple times — the worker skips orders that haven't changed
 * (staleness check on shopify_updated_at).
 *
 * Usage:
 *   cd apps/backend && npx tsx src/scripts/load-recent-orders.ts
 *
 * Options (env vars):
 *   SINCE=2024-01-01   Only fetch orders created on or after this date (NZST/NZDT).
 *                      Omit to fetch ALL orders.
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
// Use created_at so SINCE filters by order placement date, not modification date.
// Append T00:00:00+12:00 (NZST) to make the boundary unambiguous — Shopify would
// otherwise interpret a bare date in the store timezone, which can bleed into the
// previous UTC day.
const filter = since ? `created_at:>=${since}T00:00:00+12:00` : "";

console.log(
  since
    ? `[load-orders] Fetching orders created on or after ${since} (NZST)…`
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

  let totalEnqueued = 0;
  let pageNum = 0;

  for await (const page of graphqlService.streamOrders(accessToken, filter)) {
    pageNum++;

    if (page.length === 0) continue;

    const jobs = page.map((order) => ({
      name: "sync-order" as const,
      data: {
        type: "sync-order",
        source: "manual",
        shopifyOrderId: order.id,
        orderName: order.name,
        shopifyUpdatedAt: order.updatedAt,
        shopifyOrder: order,
      } satisfies SyncOrderJobData,
    }));

    await queue.addBulk(jobs);
    totalEnqueued += jobs.length;

    console.log(`[load-orders] Page ${pageNum}: enqueued ${jobs.length} orders (total: ${totalEnqueued})…`);
  }

  if (totalEnqueued === 0) {
    console.log("[load-orders] Nothing to enqueue.");
  } else {
    console.log(`[load-orders] Done. ${totalEnqueued} jobs enqueued. Worker will skip unchanged orders.`);
  }
} catch (err) {
  console.error("[load-orders] Failed:", err);
  process.exit(1);
} finally {
  await queue.close();
  await redis.quit();
}
