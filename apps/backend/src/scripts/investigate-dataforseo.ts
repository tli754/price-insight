/**
 * Investigation/connection test script for DataForSEO Google Shopping flow.
 *
 * Runs the full two-step pipeline — Shopping task post/get, then Product Info
 * task post/get for each candidate — with verbose output at each step.
 *
 * Usage:
 *   cd apps/backend
 *   tsx src/scripts/investigate-dataforseo.ts "moka pot"
 *   tsx src/scripts/investigate-dataforseo.ts          # uses default keyword
 *
 * Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in apps/backend/.env
 */

import "dotenv/config";

const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

if (!LOGIN || !PASSWORD) {
  console.error("ERROR: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env");
  process.exit(1);
}

const KEYWORD = process.argv[2] ?? "moka pot";
const BASE_URL = "https://api.dataforseo.com";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");
const LOCATION_CODE = 2554;
const LANGUAGE_CODE = "en";
const POLL_RETRIES = 8;
const POLL_DELAY_MS = 3000;
const PRODUCT_INFO_LIMIT = 20;

function hr(label = "") {
  const line = "─".repeat(60);
  console.log(label ? `\n${line}\n  ${label}\n${line}` : line);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: AUTH }
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

async function pollUntilReady(getPath: string, label: string): Promise<any> {
  for (let i = 0; i < POLL_RETRIES; i++) {
    if (i > 0) {
      console.log(`    [attempt ${i + 1}] waiting ${POLL_DELAY_MS}ms…`);
      await sleep(POLL_DELAY_MS);
    }
    const data = await apiGet(getPath);
    const task = data.tasks?.[0];
    if (!task) continue;
    if (task.status_code === 20100 || task.status_code === 40602) {
      console.log(`    ${label}: task in queue (${task.status_code}), retrying…`);
      continue;
    }
    if (task.status_code !== 20000) {
      console.log(`    ${label}: unexpected status ${task.status_code} — ${task.status_message}`);
      return null;
    }
    console.log(`    ${label}: ready (20000)`);
    return task;
  }
  console.log(`    ${label}: timed out after ${POLL_RETRIES} attempts`);
  return null;
}

// ── Step 1: Shopping task ─────────────────────────────────────────────────────

hr(`STEP 1: Shopping task — keyword: "${KEYWORD}"`);

const shoppingPostData = await apiPost("/v3/merchant/google/products/task_post", [
  { language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, keyword: KEYWORD, price_min: 5 }
]);

const shoppingTaskId = shoppingPostData.tasks?.[0]?.id;
console.log(`  Task ID: ${shoppingTaskId}`);
console.log(`  Status : ${shoppingPostData.tasks?.[0]?.status_message}`);

if (!shoppingTaskId) {
  console.error("  ERROR: no task ID returned");
  process.exit(1);
}

const shoppingTask = await pollUntilReady(
  `/v3/merchant/google/products/task_get/advanced/${shoppingTaskId}`,
  "Shopping GET"
);

if (!shoppingTask) process.exit(1);

const allItems: any[] = shoppingTask.result?.[0]?.items ?? [];
const serpItems = allItems.filter((i: any) => i.type === "google_shopping_serp");

console.log(`\n  items total : ${allItems.length}`);
console.log(`  google_shopping_serp : ${serpItems.length}`);

// Filter and dedup
const seen = new Set<string>();
const candidates: any[] = [];

for (const item of serpItems) {
  if (!item.product_id) { console.log(`    skip: no product_id  — "${item.title}"`); continue; }
  if (!item.seller) { console.log(`    skip: no seller — "${item.title}"`); continue; }
  if (item.price == null) { console.log(`    skip: no price — "${item.title}"`); continue; }
  if (item.currency !== "NZD") { console.log(`    skip: currency=${item.currency} — "${item.title}"`); continue; }

  const key = `${item.product_id}:${item.seller}:${item.title ?? ""}`;
  if (seen.has(key)) { console.log(`    skip: duplicate — "${item.title}"`); continue; }
  seen.add(key);

  candidates.push(item);
  console.log(
    `    ✓ [${String(candidates.length).padStart(2)}] ${(item.title ?? "").slice(0, 45).padEnd(45)} ` +
    `NZD ${String(item.price).padStart(7)} | seller: ${item.seller}`
  );

  if (candidates.length >= PRODUCT_INFO_LIMIT) break;
}

console.log(`\n  Candidates for Product Info: ${candidates.length}`);

// ── Step 2: Product Info tasks ────────────────────────────────────────────────

hr("STEP 2: Product Info tasks");

let totalSellers = 0;
let filteredSellers = 0;

for (const [idx, candidate] of candidates.entries()) {
  console.log(`\n  [${idx + 1}/${candidates.length}] ${candidate.title?.slice(0, 50)} (product_id: ${candidate.product_id})`);

  const infoPostData = await apiPost("/v3/merchant/google/product_info/task_post", [
    { language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, product_id: candidate.product_id }
  ]);

  const infoTaskId = infoPostData.tasks?.[0]?.id;
  if (!infoTaskId) { console.log("    ERROR: no task ID"); continue; }

  const infoTask = await pollUntilReady(
    `/v3/merchant/google/product_info/task_get/advanced/${infoTaskId}`,
    "Product Info GET"
  );

  if (!infoTask) continue;

  const item = infoTask.result?.[0]?.items?.[0];
  if (!item) { console.log("    no item in result"); continue; }

  const sellers: any[] = item.sellers ?? [];
  totalSellers += sellers.length;
  console.log(`    sellers total: ${sellers.length}`);

  for (const seller of sellers) {
    const valid = seller.title && seller.url && seller.price?.current != null && seller.price?.currency === "NZD";
    if (valid) {
      filteredSellers++;
      console.log(
        `      ✓ ${(seller.title ?? "").padEnd(28)} NZD ${String(seller.price.current).padStart(8)} | ${seller.url?.slice(0, 50)}`
      );
    } else {
      console.log(
        `      ✗ ${(seller.title ?? "—").padEnd(28)} currency=${seller.price?.currency ?? "?"} url=${seller.url ? "ok" : "missing"}`
      );
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

hr("SUMMARY");
console.log(`  Keyword              : ${KEYWORD}`);
console.log(`  Shopping serp items  : ${serpItems.length}`);
console.log(`  Candidates (≤${PRODUCT_INFO_LIMIT})     : ${candidates.length}`);
console.log(`  Total sellers found  : ${totalSellers}`);
console.log(`  NZD sellers (kept)   : ${filteredSellers}`);
hr();
