/**
 * Drain DataForSEO backlog — processes tasks sitting in tasks_ready queues
 * that were never delivered via webhook (e.g. callback URL was unreachable).
 *
 * Phase 1: product_info tasks_ready → fetch results → filter → save to DB
 * Phase 2: shopping tasks_ready → parse candidates → post product_info tasks
 *          (with live pingback URL so DataForSEO calls back when they complete)
 *
 * Usage:
 *   cd apps/backend && npx tsx src/scripts/drain-dataforseo-backlog.ts
 */

import "dotenv/config";

import { loadEnv } from "../config/env.js";
import { createDatabase } from "../db/index.js";
import { CompetitorRepository } from "../services/competitor-repository.js";
import type { CompetitorProductInput } from "../services/competitor-repository.js";
import { DataForSeoService } from "../services/dataforseo-service.js";
import { ProductRepository } from "../services/product-repository.js";

const env = loadEnv();
const { db, pool } = createDatabase(env);
const dfs = new DataForSeoService(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD);
const productRepo = new ProductRepository(db);
const competitorRepo = new CompetitorRepository(db);

const BASE_URL = "https://api.dataforseo.com";
const AUTH = "Basic " + Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");

type TasksReadyItem = { id: string; tag: string };
type TasksReadyResponse = {
  tasks: Array<{ status_code: number; result: TasksReadyItem[] | null }>;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

function normalizeSource(s: string): string {
  return s.trim().toLowerCase();
}

// Phase 1: product_info tasks_ready → save results directly to DB
async function drainProductInfoReady(): Promise<void> {
  console.log("\n[Phase 1] Fetching product_info tasks_ready…");
  const data = await apiGet<TasksReadyResponse>("/v3/merchant/google/product_info/tasks_ready");
  const items = data.tasks?.[0]?.result ?? [];
  console.log(`[Phase 1] ${items.length} product_info tasks ready`);
  if (items.length === 0) return;

  const ownStore = env.OWN_STORE_NAME ? normalizeSource(env.OWN_STORE_NAME) : null;
  let savedTotal = 0;

  for (const item of items) {
    const productId = Number(item.tag);
    if (!Number.isInteger(productId) || productId <= 0) {
      console.warn(`  skip task ${item.id}: invalid tag "${item.tag}"`);
      continue;
    }

    const product = await productRepo.getProductById(productId);
    if (!product) {
      console.warn(`  skip task ${item.id}: product ${productId} not found`);
      continue;
    }

    let taskData;
    try {
      taskData = await dfs.fetchProductInfoTaskResult(item.id);
    } catch (err) {
      console.error(`  failed to fetch product_info task ${item.id}:`, err);
      continue;
    }

    const stub = {
      productId: "", seller: "", title: "", price: 0, currency: "NZD",
      oldPrice: null, thumbnail: null, rating: null, reviewCount: null,
      tag: null, googlePosition: null
    };
    const results = dfs.fetchProductInfoResults(taskData, stub);
    const productPrice = product.price != null ? Number(product.price) : null;

    const toSave = results.filter((r) => {
      if (r.country !== "NZ" && r.country !== "AU") return false;
      if (productPrice != null) {
        if (r.extractedPrice < productPrice / 2 || r.extractedPrice > productPrice * 2) return false;
      }
      if (ownStore && normalizeSource(r.source) === ownStore) return false;
      return true;
    });

    if (toSave.length === 0) continue;

    const rows: CompetitorProductInput[] = toSave.map((r) => ({
      competitorId: null,
      title: r.title,
      externalId: r.externalId,
      productLink: r.link,
      source: r.source.trim() || "Unknown",
      currency: r.currency,
      thumbnail: r.thumbnail,
      tag: r.tag ?? null,
      googlePosition: r.googlePosition ?? null,
      rawPrice: r.rawPrice,
      extractedPrice: r.extractedPrice,
      country: r.country ?? null,
      rating: r.rating ?? null,
      reviewCount: r.reviewCount ?? null,
      shippingRaw: r.shippingRaw ?? null,
      shippingExtracted: r.shippingExtracted ?? null,
      extractedOldPrice: r.extractedOldPrice ?? null
    }));

    await Promise.all(rows.map((row) => competitorRepo.upsertSuggestedCompetitor(productId, row)));
    await competitorRepo.recordPricesForConfirmed(productId, rows);
    console.log(`  product ${productId}: saved ${rows.length} competitors`);
    savedTotal += rows.length;
  }

  console.log(`[Phase 1] Done. Saved ${savedTotal} competitor entries.`);
}

// Phase 2: shopping tasks_ready → parse candidates → post product_info tasks with pingback
async function drainShoppingReady(): Promise<void> {
  console.log("\n[Phase 2] Fetching shopping tasks_ready…");
  const data = await apiGet<TasksReadyResponse>("/v3/merchant/google/products/tasks_ready");
  const items = data.tasks?.[0]?.result ?? [];
  console.log(`[Phase 2] ${items.length} shopping tasks ready`);
  if (items.length === 0) return;

  const pingbackUrl =
    `${env.WEBHOOK_HOST}/webhooks/dataforseo/pingback/product_info` +
    `?secret=${env.DATAFORSEO_WEBHOOK_SECRET}&id=$id&tag=$tag`;

  let processed = 0;

  for (const item of items) {
    const productId = Number(item.tag);
    if (!Number.isInteger(productId) || productId <= 0) {
      console.warn(`  skip shopping task ${item.id}: invalid tag "${item.tag}"`);
      continue;
    }

    let taskData;
    try {
      taskData = await dfs.fetchShoppingTaskResult(item.id);
    } catch (err) {
      console.error(`  failed to fetch shopping task ${item.id}:`, err);
      continue;
    }

    const candidates = dfs.parseShoppingCandidates(taskData, env.OWN_STORE_NAME);
    if (candidates.length === 0) {
      console.log(`  shopping task ${item.id} (product ${productId}): no NZD candidates`);
      continue;
    }

    const deletedIds = await competitorRepo.getDeletedExternalIds(productId);
    const filtered = deletedIds.size
      ? candidates.filter((c) => !deletedIds.has(c.productId))
      : candidates;

    if (filtered.length === 0) {
      console.log(`  shopping task ${item.id} (product ${productId}): all candidates filtered`);
      continue;
    }

    try {
      await dfs.postProductInfoTasks(filtered.map((c) => c.productId), productId, pingbackUrl);
      console.log(`  product ${productId}: posted ${filtered.length} product_info tasks → webhook will deliver results`);
      processed++;
    } catch (err) {
      console.error(`  failed to post product_info tasks for product ${productId}:`, err);
    }
  }

  console.log(`[Phase 2] Done. Triggered product_info tasks for ${processed}/${items.length} shopping tasks.`);
  if (processed > 0) {
    console.log(`          Results will arrive via webhook at: ${env.WEBHOOK_HOST}/webhooks/dataforseo/pingback/product_info`);
  }
}

try {
  await drainProductInfoReady();
  await drainShoppingReady();
} finally {
  await pool.end();
}
