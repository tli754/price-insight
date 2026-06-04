/**
 * Batch competitor search for all active products.
 *
 * Posts shopping tasks to DataForSEO with a pingback URL and exits immediately.
 * Results are processed asynchronously by the webhook handler as DataForSEO
 * calls back for each completed task.
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
import { DataForSeoService } from "../services/dataforseo-service.js";
import type { ProductRow } from "../db/schema.js";

const LANGUAGE_CODE = "en";
const LOCATION_CODE = 2554;
const PRICE_MIN = 5;
const POST_BATCH_SIZE = 100;
const WEBHOOK_HOST = process.env.WEBHOOK_HOST ?? "https://www.qweyha520.bar";

const env = loadEnv();
const { db, pool } = createDatabase(env);
const svc = new DataForSeoService(env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD);

const BASE_URL = "https://api.dataforseo.com";
const AUTH = "Basic " + Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type TaskPostResponse = {
  tasks: Array<{ id: string | null; status_code: number }>;
};

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

console.log("[find-all-competitors] Starting batch competitor search…");

const activeProducts = (await db.select().from(products).where(eq(products.status, "active")))
  .filter((p): p is ProductRow & { title: string } => !!p.title);

console.log(`[find-all-competitors] ${activeProducts.length} active products with title`);

if (activeProducts.length === 0) {
  await pool.end();
  process.exit(0);
}

const pingbackUrl =
  `${WEBHOOK_HOST}/webhook/dataforseo/pingback/shopping` +
  `?secret=${env.DATAFORSEO_WEBHOOK_SECRET}&id=$id&tag=$tag`;

let submitted = 0;

for (const batch of chunks(activeProducts, POST_BATCH_SIZE)) {
  try {
    const data = await apiPost<TaskPostResponse>(
      "/v3/merchant/google/products/task_post",
      batch.map((p) => ({
        language_code: LANGUAGE_CODE,
        location_code: LOCATION_CODE,
        keyword: p.title,
        price_min: PRICE_MIN,
        tag: String(p.id),
        pingback_url: pingbackUrl
      }))
    );
    const ok = data.tasks.filter((t) => t.id).length;
    submitted += ok;
    console.log(`[find-all-competitors] batch of ${batch.length} → ${ok} tasks submitted`);
  } catch (err) {
    console.error("[find-all-competitors] batch POST failed:", err);
  }
}

console.log(`[find-all-competitors] Done. ${submitted} / ${activeProducts.length} shopping tasks submitted.`);
console.log(`[find-all-competitors] Pingback results will arrive at: ${WEBHOOK_HOST}/webhook/dataforseo/pingback/shopping`);

await pool.end();
