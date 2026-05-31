/**
 * Investigation script for DataForSEO Google Shopping flow.
 * Delegates all API and filtering logic to DataForSeoService.
 *
 * Usage:
 *   cd apps/backend
 *   npx tsx src/scripts/investigate-dataforseo.ts "moka pot"
 *   npx tsx src/scripts/investigate-dataforseo.ts     # uses default keyword
 *
 * Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in apps/backend/.env
 */

import "dotenv/config";
import { DataForSeoService, type DfsProductInfoGetResponse, type ShoppingCandidate } from "../services/dataforseo-service.js";

const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

if (!LOGIN || !PASSWORD) {
  console.error("ERROR: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env");
  process.exit(1);
}

const KEYWORD = process.argv[2] ?? "moka pot";
const BASE_URL = "https://api.dataforseo.com";
const AUTH = "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64");
const POLL_RETRIES = 10;
const POLL_DELAY_MS = 3000;
const PENDING_STATUS_CODES = new Set([40601, 40602]);

const svc = new DataForSeoService(LOGIN, PASSWORD);

function hr(label = "") {
  const line = "─".repeat(60);
  console.log(label ? `\n${line}\n  ${label}\n${line}` : line);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Step 1: Shopping task ─────────────────────────────────────────────────────

hr(`STEP 1: Shopping task — keyword: "${KEYWORD}"`);

const shoppingTaskId = await svc.createShoppingTask(KEYWORD);
console.log(`  Task ID: ${shoppingTaskId}`);

const candidates = await svc.getShoppingCandidates(shoppingTaskId);

for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  console.log(
    `    ✓ [${String(i + 1).padStart(2)}] ${c.title.slice(0, 45).padEnd(45)} ` +
    `NZD ${String(c.price).padStart(7)} | seller: ${c.seller}`
  );
}

console.log(`\n  Candidates for Product Info: ${candidates.length}`);

// ── Step 2: POST all Product Info tasks ───────────────────────────────────────

hr("STEP 2: POST all Product Info tasks");

const idToCandidate = new Map<string, ShoppingCandidate>();

for (const candidate of candidates) {
  try {
    const taskId = await svc.createProductInfoTask(candidate.productId);
    idToCandidate.set(taskId, candidate);
    console.log(`  posted: ${taskId} — ${candidate.title.slice(0, 45)}`);
  } catch (e: unknown) {
    console.warn(`  WARN: failed to post task for ${candidate.productId}:`, e);
  }
}

console.log(`\n  ${idToCandidate.size} tasks posted`);

// ── Step 3: Poll task_get directly and fetch results ──────────────────────────

hr("STEP 3: Poll task_get directly and fetch results");

let totalResults = 0;

for (const [taskId, candidate] of idToCandidate) {
  const endpoint = `/v3/merchant/google/product_info/task_get/advanced/${taskId}`;
  console.log(`\n  ${candidate.title.slice(0, 50)} (task: ${taskId})`);

  let data: DfsProductInfoGetResponse | null = null;

  for (let i = 0; i < POLL_RETRIES; i++) {
    if (i > 0) {
      console.log(`    [attempt ${i + 1}] waiting ${POLL_DELAY_MS}ms…`);
      await sleep(POLL_DELAY_MS);
    }
    const res = await fetch(`${BASE_URL}${endpoint}`, { headers: { Authorization: AUTH } });
    const json = await res.json() as DfsProductInfoGetResponse;
    const statusCode = json.tasks?.[0]?.status_code;
    if (statusCode === 20000) { data = json; break; }
    if (!PENDING_STATUS_CODES.has(statusCode)) {
      console.log(`    ERROR: unexpected status ${statusCode}`);
      break;
    }
    console.log(`    not ready yet (status ${statusCode})`);
  }

  if (!data) {
    console.log(`    TIMEOUT: task never became ready`);
    continue;
  }

  const results = svc.fetchProductInfoResults(data, candidate);
  totalResults += results.length;
  console.log(`    sellers kept: ${results.length}`);
  for (const r of results) {
    console.log(
      `      ✓ ${r.source.padEnd(30)} ${r.currency} ${String(r.extractedPrice).padStart(8)} | ${r.link.slice(0, 50)}`
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

hr("SUMMARY");
console.log(`  Keyword              : ${KEYWORD}`);
console.log(`  Candidates (≤40)     : ${candidates.length}`);
console.log(`  Tasks posted         : ${idToCandidate.size}`);
console.log(`  Total results (kept) : ${totalResults}`);
hr();
