/**
 * Investigation/connection test script for DataForSEO Google Shopping flow.
 *
 * Uses tasks_ready endpoints to detect when tasks are done instead of
 * polling each task individually.
 *
 * Usage:
 *   cd apps/backend
 *   npx tsx src/scripts/investigate-dataforseo.ts "moka pot"
 *   npx tsx src/scripts/investigate-dataforseo.ts     # uses default keyword
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
const POLL_RETRIES = 10;
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

// ── tasks_ready polling helpers ───────────────────────────────────────────────

async function waitForShoppingReady(taskId: string): Promise<string | null> {
  console.log(`  Polling products/tasks_ready for task: ${taskId}`);
  for (let i = 0; i < POLL_RETRIES; i++) {
    if (i > 0) {
      console.log(`    [attempt ${i + 1}] waiting ${POLL_DELAY_MS}ms…`);
      await sleep(POLL_DELAY_MS);
    }
    const data = await apiGet("/v3/merchant/google/products/tasks_ready");
    const readyItems: any[] = data.tasks?.[0]?.result ?? [];
    const match = readyItems.find((r: any) => r.id === taskId);
    if (match) {
      console.log(`    ready — endpoint: ${match.endpoint_advanced}`);
      return match.endpoint_advanced;
    }
    console.log(`    not ready yet (${readyItems.length} other tasks in queue)`);
  }
  console.log(`    timed out after ${POLL_RETRIES} attempts`);
  return null;
}

async function waitForProductInfoReady(
  pendingIds: Set<string>,
  idToCandidate: Map<string, any>
): Promise<Map<string, string>> {
  // Returns map of taskId → endpoint_advanced for all that became ready
  const readyEndpoints = new Map<string, string>();

  console.log(`  Polling product_info/tasks_ready for ${pendingIds.size} tasks…`);

  for (let i = 0; i < POLL_RETRIES; i++) {
    if (i > 0) {
      console.log(`    [attempt ${i + 1}] waiting ${POLL_DELAY_MS}ms… (${pendingIds.size} still pending)`);
      await sleep(POLL_DELAY_MS);
    }

    const data = await apiGet("/v3/merchant/google/product_info/tasks_ready");
    const readyItems: any[] = data.tasks?.[0]?.result ?? [];

    for (const item of readyItems) {
      if (pendingIds.has(item.id)) {
        const candidate = idToCandidate.get(item.id);
        console.log(`    ✓ ready: ${item.id} — ${candidate?.title?.slice(0, 40)}`);
        readyEndpoints.set(item.id, item.endpoint_advanced);
        pendingIds.delete(item.id);
      }
    }

    if (pendingIds.size === 0) break;
  }

  if (pendingIds.size > 0) {
    console.log(`    WARNING: ${pendingIds.size} task(s) never became ready — skipping`);
    for (const id of pendingIds) {
      console.log(`      - ${id} (${idToCandidate.get(id)?.title?.slice(0, 40)})`);
    }
  }

  return readyEndpoints;
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

const shoppingEndpoint = await waitForShoppingReady(shoppingTaskId);
if (!shoppingEndpoint) process.exit(1);

const shoppingData = await apiGet(shoppingEndpoint);
const shoppingTask = shoppingData.tasks?.[0];

if (!shoppingTask || shoppingTask.status_code !== 20000) {
  console.error("  ERROR: unexpected status on task_get");
  process.exit(1);
}

const allItems: any[] = shoppingTask.result?.[0]?.items ?? [];
const serpItems = allItems.filter((i: any) => i.type === "google_shopping_serp");

console.log(`\n  items total          : ${allItems.length}`);
console.log(`  google_shopping_serp : ${serpItems.length}`);

// Filter and dedup
const seen = new Set<string>();
const candidates: any[] = [];

for (const item of serpItems) {
  if (!item.product_id) { console.log(`    skip: no product_id — "${item.title}"`); continue; }
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

// ── Step 2: POST all Product Info tasks ───────────────────────────────────────

hr("STEP 2: POST all Product Info tasks");

const idToCandidate = new Map<string, any>();
const pendingIds = new Set<string>();

for (const candidate of candidates) {
  try {
    const postData = await apiPost("/v3/merchant/google/product_info/task_post", [
      { language_code: LANGUAGE_CODE, location_code: LOCATION_CODE, product_id: candidate.product_id }
    ]);
    const taskId = postData.tasks?.[0]?.id;
    if (!taskId) { console.log(`  ERROR: no task ID for ${candidate.product_id}`); continue; }
    idToCandidate.set(taskId, candidate);
    pendingIds.add(taskId);
    console.log(`  posted: ${taskId} — ${candidate.title?.slice(0, 45)}`);
  } catch (e: any) {
    console.warn(`  WARN: failed to post task for ${candidate.product_id}: ${e.message}`);
  }
}

console.log(`\n  ${pendingIds.size} tasks posted`);

// ── Step 3: Poll tasks_ready + fetch as they become ready ─────────────────────

hr("STEP 3: Poll tasks_ready and fetch results");

const readyEndpoints = await waitForProductInfoReady(pendingIds, idToCandidate);

console.log(`\n  ${readyEndpoints.size} tasks ready — fetching results…`);

let totalSellers = 0;
let filteredSellers = 0;

for (const [taskId, endpoint] of readyEndpoints) {
  const candidate = idToCandidate.get(taskId)!;
  console.log(`\n  ${candidate.title?.slice(0, 50)} (task: ${taskId})`);

  try {
    const data = await apiGet(endpoint);
    const item = data.tasks?.[0]?.result?.[0]?.items?.[0];
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
  } catch (e: any) {
    console.warn(`    WARN: failed to fetch results: ${e.message}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

hr("SUMMARY");
console.log(`  Keyword              : ${KEYWORD}`);
console.log(`  Shopping serp items  : ${serpItems.length}`);
console.log(`  Candidates (≤${PRODUCT_INFO_LIMIT})     : ${candidates.length}`);
console.log(`  Tasks posted         : ${idToCandidate.size}`);
console.log(`  Tasks ready          : ${readyEndpoints.size}`);
console.log(`  Total sellers found  : ${totalSellers}`);
console.log(`  NZD sellers (kept)   : ${filteredSellers}`);
hr();
