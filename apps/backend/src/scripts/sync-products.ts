/**
 * Syncs all products from Shopify into the local database.
 *
 * Usage (dev):
 *   cd apps/backend && npx tsx src/scripts/sync-products.ts
 *
 * Usage (production / Cloud Run):
 *   node dist/scripts/sync-products.js
 */

import "dotenv/config";
import { loadEnv } from "../config/env.js";
import { createDatabase } from "../db/index.js";
import { ProductRepository } from "../services/product-repository.js";
import { ShopifyService } from "../services/shopify-service.js";

const env = loadEnv();

if (!env.SHOPIFY_TOKEN_URL || !env.SHOPIFY_PRODUCTS_URL || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
  console.error("ERROR: Shopify credentials are not configured in environment.");
  process.exit(1);
}

const { db, pool } = createDatabase(env);
const productRepository = new ProductRepository(db);
const shopifyService = new ShopifyService(
  env.SHOPIFY_TOKEN_URL,
  env.SHOPIFY_PRODUCTS_URL,
  env.SHOPIFY_CLIENT_ID,
  env.SHOPIFY_CLIENT_SECRET,
  env.SHOPIFY_ORDERS_URL
);

console.log(`[sync-products] Starting product sync…`);

try {
  const accessToken = await shopifyService.getAccessToken();
  console.log(`[sync-products] Access token obtained.`);

  let synced = 0;
  let pageNum = 0;
  for await (const page of shopifyService.streamProducts(accessToken)) {
    pageNum++;
    console.log(`[sync-products] Page ${pageNum}: ${page.length} products, upserting…`);
    synced += await productRepository.importProducts(page);
  }
  console.log(`[sync-products] Done. ${synced} products upserted across ${pageNum} page(s).`);
} catch (err) {
  console.error("[sync-products] Failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
