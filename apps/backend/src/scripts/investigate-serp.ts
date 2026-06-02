/**
 * Investigation script for searchShoppingPrices.
 *
 * Shows every step of the pipeline — shopping call, immersive expansion,
 * result filtering — with verbose counts so you can see exactly where
 * results are lost.
 *
 * Usage:
 *   cd apps/backend
 *   tsx src/scripts/investigate-serp.ts "Rechargeable Round Coffee Digital Scale with Timer – 3kg / 0.1g"
 *   tsx src/scripts/investigate-serp.ts                     # uses default title
 *
 * Requires SERPAPI_API_KEY in apps/backend/.env
 */

import "dotenv/config";

// ── Config ────────────────────────────────────────────────────────────────────

const API_KEY = process.env.SERPAPI_API_KEY;
const LOCATION = process.env.SERPAPI_LOCATION ?? "New Zealand";
const GL = process.env.SERPAPI_GL ?? "nz";
const HL = process.env.SERPAPI_HL ?? "en";
const GOOGLE_DOMAIN = process.env.SERPAPI_GOOGLE_DOMAIN ?? "google.co.nz";
const NUM = Number(process.env.SERPAPI_NUM_RESULTS ?? 40);

if (!API_KEY) {
  console.error("ERROR: SERPAPI_API_KEY is not set in .env");
  process.exit(1);
}

const RAW_TITLE = process.argv[2] ?? "Rechargeable Round Coffee Digital Scale with Timer – 3kg / 0.1g";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hr(label = "") {
  const line = "─".repeat(60);
  console.log(label ? `\n${line}\n  ${label}\n${line}` : line);
}

function sanitizeQuery(title: string): string {
  return title
    .replace(/\s*[–—]\s*.+$/, "")           // strip em/en-dash spec suffix
    .replace(/\s*\(.*?\)\s*/g, " ")          // strip parenthetical specs
    .replace(/\b\d+(\.\d+)?\s*(kg|g|ml|l|cm|mm|m|oz|lb|w|v|mah)\b/gi, "") // strip measurements
    .replace(/\s{2,}/g, " ")
    .trim();
}

type ShoppingResult = {
  position?: number;
  title?: string;
  product_id?: string;
  product_link?: string;
  immersive_product_page_token?: string;
  price?: string;
  extracted_price?: number;
  source?: string;
  thumbnail?: string;
};

type ImmersiveStore = {
  name?: string;
  link?: string;
  price?: string;
  extracted_price?: number;
};

async function fetchShopping(query: string, start = 0): Promise<ShoppingResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", API_KEY!);
  url.searchParams.set("location", LOCATION);
  url.searchParams.set("gl", GL);
  url.searchParams.set("hl", HL);
  url.searchParams.set("google_domain", GOOGLE_DOMAIN);
  url.searchParams.set("num", String(NUM));
  if (start > 0) url.searchParams.set("start", String(start));

  console.log(`  → GET ${url.toString().replace(API_KEY!, "***")}`);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { shopping_results?: ShoppingResult[] };
  return data.shopping_results ?? [];
}

async function fetchStores(token: string): Promise<ImmersiveStore[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_immersive_product");
  url.searchParams.set("page_token", token);
  url.searchParams.set("api_key", API_KEY!);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as { stores?: ImmersiveStore[] };
  return data.stores ?? [];
}

// ── Core probe ────────────────────────────────────────────────────────────────

async function probe(label: string, query: string) {
  hr(`PROBE: ${label}`);
  console.log(`  query  : ${query}`);
  console.log(`  num    : ${NUM}, locale: ${GL}/${GOOGLE_DOMAIN}`);

  let totalShopping = 0;
  let withToken = 0;
  let withoutToken = 0;
  let droppedNoPrice = 0;
  let finalResults = 0;

  for (let start = 0; ; start += NUM) {
    console.log(`\n  ── page start=${start} ──`);

    const page = await fetchShopping(query, start);
    totalShopping += page.length;
    console.log(`  shopping_results : ${page.length}`);

    if (page.length === 0) break;

    for (const r of page) {
      const hasToken = Boolean(r.immersive_product_page_token);
      const hasPrice = typeof r.extracted_price === "number" && r.extracted_price > 0;

      console.log(
        `    [${String(r.position).padStart(2)}] ${(r.title ?? "").slice(0, 50).padEnd(50)} ` +
        `price=${String(r.extracted_price ?? "—").padStart(8)}  ` +
        `token=${hasToken ? "yes" : "no "} ` +
        `source=${r.source ?? "—"}`
      );

      if (hasToken) {
        withToken++;
        const stores = await fetchStores(r.immersive_product_page_token!);
        const priced = stores.filter(
          (s) => typeof s.extracted_price === "number" && (s.extracted_price ?? 0) > 0
        );
        console.log(`         └─ immersive stores: ${stores.length} total, ${priced.length} with price`);
        for (const s of priced.slice(0, 5)) {
          console.log(`              ${(s.name ?? "").padEnd(30)} ${s.price ?? "—"}`);
        }
        if (priced.length > 5) console.log(`              …and ${priced.length - 5} more`);
        finalResults += priced.length;
      } else {
        withoutToken++;
        if (!hasPrice) {
          droppedNoPrice++;
          console.log(`         └─ fallback: DROPPED (no extracted_price)`);
        } else {
          finalResults++;
          console.log(`         └─ fallback: kept (price=${r.extracted_price})`);
        }
      }
    }

    if (page.length < NUM) break;
  }

  console.log("\n  ── Summary ──────────────────────────────────────────");
  console.log(`  Total shopping results fetched : ${totalShopping}`);
  console.log(`    with immersive token         : ${withToken}`);
  console.log(`    without token (fallback)     : ${withoutToken}`);
  console.log(`    dropped (no price, fallback) : ${droppedNoPrice}`);
  console.log(`  Final CompetitorResults        : ${finalResults}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const sanitized = sanitizeQuery(RAW_TITLE);

console.log("\n  Investigating searchShoppingPrices pipeline\n");
console.log(`  Raw title  : ${RAW_TITLE}`);
console.log(`  Sanitized  : ${sanitized}`);

await probe("raw title (current behavior)", RAW_TITLE);
await probe("sanitized title (spec suffix removed)", sanitized);

if (sanitized !== RAW_TITLE) {
  // Also try brand-agnostic core keywords to see the ceiling
  const keywords = sanitized.split(" ").slice(0, 5).join(" ");
  await probe(`first 5 words only ("${keywords}")`, keywords);
}

hr("DONE");
