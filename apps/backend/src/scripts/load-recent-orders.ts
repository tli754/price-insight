/**
 * Load orders from Shopify by enqueueing one Cloud Task per order — same
 * path as the "Sync Orders" button (source: "manual"). order-worker does
 * the actual upsert; this script needs no direct DB/Cloud SQL access, just
 * Cloud Tasks API access.
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
import { CloudTasksOrderSyncClient } from "../services/cloud-tasks-client.js";
import type { ScheduledSyncOrderPayload } from "../lib/sync-order-payload.js";
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

if (
  !env.CLOUD_TASKS_PROJECT ||
  !env.CLOUD_TASKS_LOCATION ||
  !env.CLOUD_TASKS_QUEUE ||
  !env.ORDER_WORKER_URL ||
  !env.INTERNAL_OIDC_SERVICE_ACCOUNT
) {
  console.error("[load-orders] Cloud Tasks is not configured. Check your .env file.");
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

const cloudTasksClient = new CloudTasksOrderSyncClient(
  env.CLOUD_TASKS_PROJECT,
  env.CLOUD_TASKS_LOCATION,
  env.CLOUD_TASKS_QUEUE,
  env.INTERNAL_OIDC_SERVICE_ACCOUNT
);

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

    for (const order of page) {
      const payload: ScheduledSyncOrderPayload = {
        type: "sync-order",
        source: "manual",
        shopifyOrderId: order.id,
        orderName: order.name,
        shopifyUpdatedAt: order.updatedAt,
        shopifyOrder: order,
      };
      await cloudTasksClient.enqueueSyncOrder(env.ORDER_WORKER_URL, payload);
      totalEnqueued++;
    }

    console.log(`[load-orders] Page ${pageNum}: enqueued ${page.length} orders (total: ${totalEnqueued})…`);
  }

  if (totalEnqueued === 0) {
    console.log("[load-orders] Nothing to enqueue.");
  } else {
    console.log(`[load-orders] Done. ${totalEnqueued} orders enqueued. order-worker will skip unchanged orders.`);
  }
} catch (err) {
  console.error("[load-orders] Failed:", err);
  process.exit(1);
}
