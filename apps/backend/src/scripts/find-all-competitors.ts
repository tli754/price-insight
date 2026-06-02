/**
 * Batch competitor search for all active products.
 *
 * Two-phase approach:
 *   Phase 1 — POST all shopping tasks in batches of 100
 *   Phase 2 — Poll products/tasks_ready → parse candidates →
 *             POST all product info tasks in batches of 100
 *   Phase 3 — Poll product_info/tasks_ready → parse seller results
 *   Phase 4 — Apply filters and write DB per product
 *
 * Usage (dev):
 *   cd apps/backend && npx tsx src/scripts/find-all-competitors.ts
 *
 * Usage (production / GKE):
 *   node dist/scripts/find-all-competitors.js
 *
 * GKE one-off:
 *   kubectl create job find-competitors-manual --from=cronjob/find-all-competitors
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { createDatabase } from "../db/index.js";
import { products } from "../db/schema.js";
import { CompetitorRepository } from "../services/competitor-repository.js";
import {
  DataForSeoService,
  type DfsProductInfoGetResponse,
  type DfsShoppingGetResponse,
  type ShoppingCandidate
} from "../services/dataforseo-service.js";
import type { ProductRow } from "../db/schema.js";

// ── Config ────────────────────────────────────────────────────────────────────

const LOCATION_CODE = 2554;
const LANGUAGE_CODE = "en";
const PRICE_MIN = 5;
const POST_BATCH_SIZE = 100;         // DataForSEO max tasks per request
const BULK_CANDIDATES_LIMIT = 10;    // candidates per product (lower than single-product to control cost)
const SHOPPING_POLL_RETRIES = 30;    // 30 × 10s = 5 min max
const INFO_POLL_RETRIES = 60;        // 60 × 10s = 10 min max
const POLL_DELAY_MS = 10_000;

// ── Init ──────────────────────────────────────────────────────────────────────

const env = loadEnv();
const { db, pool } = createDatabase(env);
const competitorRepository = new CompetitorRepository(db);
const svc = new DataForSeoService(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD);

const BASE_URL = "https://api.dataforseo.com";
const AUTH = "Basic " + Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeSource(source: string): string {
  const t = source.trim();
  return t.length > 0 ? t : "Unknown";
}

type TasksReadyResponse = {
  tasks: Array<{ result: Array<{ id: string; endpoint_advanced: string }> | null }>;
};

type TaskPostResponse = {
  tasks: Array<{ id: string | null; status_code: number }>;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("[find-all-competitors] Starting batch competitor search…");

const activeProducts = (await db.select().from(products).where(eq(products.status, "active")))
  .filter((p): p is ProductRow & { title: string } => !!p.title);

console.log(`[find-all-competitors] ${activeProducts.length} active products with title\n`);

if (activeProducts.length === 0) {
  await pool.end();
  process.exit(0);
}

// ── Phase 1: Batch POST all shopping tasks ────────────────────────────────────

console.log("── Phase 1: Posting shopping tasks ──────────────────────────────");

const taskToProduct = new Map<string, typeof activeProducts[0]>();

for (const batch of chunks(activeProducts, POST_BATCH_SIZE)) {
  try {
    const data = await apiPost<TaskPostResponse>("/v3/merchant/google/products/task_post",
      batch.map((p) => ({ language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, keyword: p.title, price_min: PRICE_MIN }))
    );
    for (let i = 0; i < data.tasks.length; i++) {
      const taskId = data.tasks[i]?.id;
      if (taskId) taskToProduct.set(taskId, batch[i]);
    }
    console.log(`  posted batch of ${batch.length}`);
  } catch (err) {
    console.error(`  batch failed:`, err);
  }
}

console.log(`  ${taskToProduct.size} / ${activeProducts.length} shopping tasks submitted\n`);

// ── Phase 2: Poll products/tasks_ready → collect candidates → POST info tasks ─

console.log("── Phase 2: Collecting shopping results + posting product info tasks ──");

const pendingShoppingIds = new Set(taskToProduct.keys());
const infoTaskToEntry = new Map<string, { candidate: ShoppingCandidate; product: typeof activeProducts[0] }>();

for (let attempt = 0; attempt < SHOPPING_POLL_RETRIES && pendingShoppingIds.size > 0; attempt++) {
  if (attempt > 0) await sleep(POLL_DELAY_MS);

  const ready = await apiGet<TasksReadyResponse>("/v3/merchant/google/products/tasks_ready");
  const readyItems = ready.tasks?.[0]?.result ?? [];
  const newlyReady = readyItems.filter((r) => pendingShoppingIds.has(r.id));

  if (newlyReady.length === 0) {
    console.log(`  [attempt ${attempt + 1}] ${pendingShoppingIds.size} shopping tasks still pending…`);
    continue;
  }

  // Fetch shopping results and post product info tasks for newly ready tasks
  const newCandidates: Array<{ candidate: ShoppingCandidate; product: typeof activeProducts[0] }> = [];

  for (const item of newlyReady) {
    pendingShoppingIds.delete(item.id);
    const product = taskToProduct.get(item.id)!;
    try {
      const data = await apiGet<DfsShoppingGetResponse>(item.endpoint_advanced);
      const candidates = svc.parseShoppingCandidates(data, env.OWN_STORE_NAME, BULK_CANDIDATES_LIMIT);
      for (const candidate of candidates) newCandidates.push({ candidate, product });
    } catch (err) {
      console.error(`  [${item.id}] fetch failed:`, err);
    }
  }

  // Batch POST product info tasks for all new candidates
  for (const batch of chunks(newCandidates, POST_BATCH_SIZE)) {
    try {
      const data = await apiPost<TaskPostResponse>("/v3/merchant/google/product_info/task_post",
        batch.map(({ candidate }) => ({ language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, product_id: candidate.productId }))
      );
      for (let i = 0; i < data.tasks.length; i++) {
        const taskId = data.tasks[i]?.id;
        if (taskId) infoTaskToEntry.set(taskId, batch[i]);
      }
    } catch (err) {
      console.error(`  product info batch POST failed:`, err);
    }
  }

  console.log(`  [attempt ${attempt + 1}] ${newlyReady.length} shopping tasks resolved, ${newCandidates.length} candidates → ${infoTaskToEntry.size} info tasks posted so far`);
}

if (pendingShoppingIds.size > 0) {
  console.warn(`  WARNING: ${pendingShoppingIds.size} shopping task(s) timed out\n`);
}

console.log(`  ${infoTaskToEntry.size} product info tasks submitted total\n`);

// ── Phase 3: Poll product_info/tasks_ready → collect results ─────────────────

console.log("── Phase 3: Collecting product info results ──────────────────────");

const pendingInfoIds = new Set(infoTaskToEntry.keys());
const resultsByProductId = new Map<number, ReturnType<typeof svc.fetchProductInfoResults>>();

for (let attempt = 0; attempt < INFO_POLL_RETRIES && pendingInfoIds.size > 0; attempt++) {
  if (attempt > 0) await sleep(POLL_DELAY_MS);

  const ready = await apiGet<TasksReadyResponse>("/v3/merchant/google/product_info/tasks_ready");
  const readyItems = ready.tasks?.[0]?.result ?? [];
  const newlyReady = readyItems.filter((r) => pendingInfoIds.has(r.id));

  if (newlyReady.length === 0) {
    console.log(`  [attempt ${attempt + 1}] ${pendingInfoIds.size} info tasks still pending…`);
    continue;
  }

  await Promise.all(newlyReady.map(async (item) => {
    pendingInfoIds.delete(item.id);
    const { candidate, product } = infoTaskToEntry.get(item.id)!;
    try {
      const data = await apiGet<DfsProductInfoGetResponse>(item.endpoint_advanced);
      const results = svc.fetchProductInfoResults(data, candidate);
      const bucket = resultsByProductId.get(product.id) ?? [];
      bucket.push(...results);
      resultsByProductId.set(product.id, bucket);
    } catch (err) {
      console.error(`  [${item.id}] fetch failed:`, err);
    }
  }));

  console.log(`  [attempt ${attempt + 1}] ${newlyReady.length} info tasks resolved, ${pendingInfoIds.size} remaining`);
}

if (pendingInfoIds.size > 0) {
  console.warn(`  WARNING: ${pendingInfoIds.size} product info task(s) timed out\n`);
}

// ── Phase 4: Filter + write DB ────────────────────────────────────────────────

console.log("\n── Phase 4: Writing to database ──────────────────────────────────");

let succeeded = 0;
let noResults = 0;
let dbErrors = 0;

for (const product of activeProducts) {
  const rawResults = resultsByProductId.get(product.id) ?? [];

  const filtered = rawResults.filter((r) => {
    if (r.country !== "NZ" && r.country !== "AU") return false;
    if (product.price != null) {
      const p = Number(product.price);
      if (r.extractedPrice < p / 2 || r.extractedPrice > p * 2) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    noResults++;
    continue;
  }

  const rows = filtered.map((r) => ({
    competitorId: null,
    title: r.title,
    externalId: r.externalId,
    productLink: r.link,
    source: normalizeSource(r.source),
    currency: r.currency,
    thumbnail: r.thumbnail,
    tag: r.tag,
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

  try {
    const existingKeys = await competitorRepository.getExistingCompetitorKeys(product.id);
    const newRows = rows.filter((r) => !existingKeys.has(`${r.externalId}:${r.source}`));

    await competitorRepository.recordPricesForConfirmed(product.id, rows);
    await competitorRepository.deleteSuggestedByProduct(product.id);
    await competitorRepository.insertSuggestedCompetitors(product.id, newRows);

    console.log(`  product=${product.id} "${product.title.slice(0, 45)}" — ${newRows.length} new, ${rows.length - newRows.length} skipped`);
    succeeded++;
  } catch (err) {
    console.error(`  product=${product.id} DB write failed:`, err);
    dbErrors++;
  }
}

console.log(`\n[find-all-competitors] Done.`);
console.log(`  succeeded=${succeeded}  noResults=${noResults}  dbErrors=${dbErrors}  total=${activeProducts.length}`);

await pool.end();
