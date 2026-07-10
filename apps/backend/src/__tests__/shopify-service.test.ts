import { afterEach, describe, it, expect, vi } from "vitest";

import { ShopifyService } from "../services/shopify-service.js";

const PRODUCTS_URL = "https://shop.example.com/admin/api/2024-01/products.json";

function makeService() {
  return new ShopifyService("https://token", PRODUCTS_URL, "cid", "secret");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function collect(gen: AsyncGenerator<unknown[]>) {
  const pages: unknown[][] = [];
  for await (const page of gen) pages.push(page);
  return pages as any[][];
}

describe("ShopifyService.streamProducts() cost enrichment", () => {
  afterEach(() => vi.restoreAllMocks());

  it("attaches variant cost from InventoryItem.cost", async () => {
    const product = { id: 1, variants: [{ price: "10.00", inventory_item_id: 555 }], images: [] };
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("products.json")) return jsonResponse({ products: [product] });
      if (url.includes("inventory_items.json")) return jsonResponse({ inventory_items: [{ id: 555, cost: "4.50" }] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pages = await collect(makeService().streamProducts("tok"));

    expect(fetchMock).toHaveBeenCalledTimes(2); // products + inventory_items
    expect(pages[0][0].variants[0].cost).toBe("4.50");
  });

  it("records an explicit null cost when Shopify reports the cost as cleared", async () => {
    const product = { id: 1, variants: [{ price: "10.00", inventory_item_id: 555 }], images: [] };
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("products.json")) return jsonResponse({ products: [product] });
      if (url.includes("inventory_items.json")) return jsonResponse({ inventory_items: [{ id: 555, cost: null }] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pages = await collect(makeService().streamProducts("tok"));

    // null (recorded), not undefined — lets the importer clear a stale cost.
    expect(pages[0][0].variants[0].cost).toBeNull();
  });

  it("leaves cost undefined when the item is absent from the inventory response", async () => {
    const product = { id: 1, variants: [{ price: "10.00", inventory_item_id: 555 }], images: [] };
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("products.json")) return jsonResponse({ products: [product] });
      if (url.includes("inventory_items.json")) return jsonResponse({ inventory_items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const pages = await collect(makeService().streamProducts("tok"));

    expect(pages[0][0].variants[0].cost).toBeUndefined();
  });

  it("leaves cost unset when inventory fetch is forbidden (missing read_inventory scope)", async () => {
    const product = { id: 1, variants: [{ price: "10.00", inventory_item_id: 555 }], images: [] };
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("products.json")) return jsonResponse({ products: [product] });
      return new Response("Forbidden", { status: 403 });
    });

    const pages = await collect(makeService().streamProducts("tok"));

    expect(pages[0][0].variants[0].cost).toBeUndefined();
  });

  it("skips the inventory fetch entirely when no variant has an inventory_item_id", async () => {
    const product = { id: 1, variants: [{ price: "10.00" }], images: [] };
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("products.json")) return jsonResponse({ products: [product] });
      throw new Error("should not fetch inventory");
    });

    await collect(makeService().streamProducts("tok"));

    expect(fetchMock).toHaveBeenCalledTimes(1); // products only
  });

  it("does not fail the sync when the inventory request throws", async () => {
    const product = { id: 1, variants: [{ price: "10.00", inventory_item_id: 555 }], images: [] };
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("products.json")) return jsonResponse({ products: [product] });
      throw new Error("network down");
    });

    const pages = await collect(makeService().streamProducts("tok"));

    expect(pages[0][0].variants[0].cost).toBeUndefined();
  });
});
