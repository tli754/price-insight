/**
 * Load orders from Shopify into the database directly (bypassing Cloud Tasks).
 * Safe to run multiple times — upsertMappedOrder skips orders that haven't
 * changed (staleness check on shopify_updated_at).
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
import { createDatabase } from "../db/index.js";
import { mapGraphQLOrder } from "../lib/order-mapper.js";
import { OrderRepository } from "../services/order-repository.js";
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

const { db, pool } = createDatabase(env);
const orderRepository = new OrderRepository(db);

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

  let totalUpserted = 0;
  let pageNum = 0;

  for await (const page of graphqlService.streamOrders(accessToken, filter)) {
    pageNum++;

    if (page.length === 0) continue;

    for (const order of page) {
      const mapped = mapGraphQLOrder(order);
      await orderRepository.upsertMappedOrder(mapped);
      totalUpserted++;
    }

    console.log(`[load-orders] Page ${pageNum}: upserted ${page.length} orders (total: ${totalUpserted})…`);
  }

  if (totalUpserted === 0) {
    console.log("[load-orders] Nothing to upsert.");
  } else {
    console.log(`[load-orders] Done. ${totalUpserted} orders processed.`);
  }
} catch (err) {
  console.error("[load-orders] Failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
