/**
 * Load orders from Shopify updated in the last 7 days (for testing).
 *
 * Usage:
 *   cd apps/backend && npx tsx src/scripts/load-recent-orders.ts
 *
 * Optional: pass a custom number of days
 *   cd apps/backend && DAYS=14 npx tsx src/scripts/load-recent-orders.ts
 */

import "dotenv/config";

import { loadEnv } from "../config/env.js";
import { createDatabase } from "../db/index.js";
import { OrderRepository } from "../services/order-repository.js";
import { ShopifyService } from "../services/shopify-service.js";

const env = loadEnv();

if (!env.SHOPIFY_TOKEN_URL || !env.SHOPIFY_PRODUCTS_URL || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
  console.error("Shopify credentials are not configured. Check your .env file.");
  process.exit(1);
}

if (!env.SHOPIFY_ORDERS_URL) {
  console.error("SHOPIFY_ORDERS_URL is not configured. Check your .env file.");
  process.exit(1);
}

const days = parseInt(process.env.DAYS ?? "7", 10);
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

console.log(`[load-recent-orders] Fetching orders updated since ${since} (last ${days} days)…`);

const { db, pool } = createDatabase(env);
const shopify = new ShopifyService(
  env.SHOPIFY_TOKEN_URL,
  env.SHOPIFY_PRODUCTS_URL,
  env.SHOPIFY_CLIENT_ID,
  env.SHOPIFY_CLIENT_SECRET,
  env.SHOPIFY_ORDERS_URL
);
const orderRepo = new OrderRepository(db);

try {
  const accessToken = await shopify.getAccessToken();
  const orders = await shopify.fetchOrders(accessToken, since);
  console.log(`[load-recent-orders] ${orders.length} orders fetched from Shopify`);

  if (orders.length === 0) {
    console.log("[load-recent-orders] Nothing to import.");
  } else {
    const synced = await orderRepo.importOrders(orders);
    console.log(`[load-recent-orders] Done. ${synced} orders imported.`);
  }
} catch (err) {
  console.error("[load-recent-orders] Failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
