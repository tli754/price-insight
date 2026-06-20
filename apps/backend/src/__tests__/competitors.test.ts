import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildTestApp,
  makeCompetitorRepository,
  makeDataForSeoService,
  makeProductRepository
} from "./helpers/build-app.js";
import type { ProductRow, ProductImageRow } from "../db/schema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProductRow(overrides: Partial<ProductRow> = {}): ProductRow & { images: ProductImageRow[] } {
  return {
    id: 1,
    externalId: 123456789,
    status: "active",
    title: "Blue Widget",
    brand: "Acme",
    handle: "blue-widget",
    price: 49.99,
    currency: "NZD",
    thumbnail: null,
    tags: null,
    description: null,
    sku: null,
    weight: null,
    weightUnit: null,
    inventoryQuantity: 10,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    images: [],
    ...overrides
  };
}

// ── GET /api/competitors ──────────────────────────────────────────────────────

describe("GET /api/competitors", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with empty items when there are no competitors", async () => {
    const competitorRepository = makeCompetitorRepository();
    competitorRepository.getAllCompetitors.mockResolvedValue([]);
    ({ app } = await buildTestApp({ competitorRepository }));

    const response = await app.inject({ method: "GET", url: "/api/competitors" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it("returns 200 with populated competitors list", async () => {
    const competitorRepository = makeCompetitorRepository();
    competitorRepository.getAllCompetitors.mockResolvedValue([
      { id: 1, name: "Acme", state: "active", thumbnail: null, createdAt: new Date(), matchedProducts: 3, lastScraped: null }
    ]);
    ({ app } = await buildTestApp({ competitorRepository }));

    const response = await app.inject({ method: "GET", url: "/api/competitors" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].name).toBe("Acme");
  });
});

// ── GET /api/competitors/:id/products ─────────────────────────────────────────

describe("GET /api/competitors/:id/products", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with competitor detail and empty items", async () => {
    const competitorRepository = makeCompetitorRepository();
    competitorRepository.getCompetitorById.mockResolvedValue({
      id: 1,
      name: "Acme",
      state: "active",
      thumbnail: null,
      createdAt: new Date()
    });
    competitorRepository.getProductsByCompetitorId.mockResolvedValue([]);
    ({ app } = await buildTestApp({ competitorRepository }));

    const response = await app.inject({ method: "GET", url: "/api/competitors/1/products" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.competitor.id).toBe(1);
    expect(body.competitor.name).toBe("Acme");
    expect(body.items).toEqual([]);
  });

  it("returns 404 when competitor does not exist", async () => {
    const competitorRepository = makeCompetitorRepository();
    competitorRepository.getCompetitorById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ competitorRepository }));

    const response = await app.inject({ method: "GET", url: "/api/competitors/99/products" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("COMPETITOR_NOT_FOUND");
  });

  it("returns 400 for a non-integer competitor id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/competitors/abc/products" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_COMPETITOR_ID");
  });

  it("returns 400 for competitor id zero", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/competitors/0/products" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_COMPETITOR_ID");
  });
});

// ── GET /api/products/:id/saved-competitors ───────────────────────────────────

describe("GET /api/products/:id/saved-competitors", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with saved competitors for a known product", async () => {
    const productRepository = makeProductRepository();
    const competitorRepository = makeCompetitorRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    competitorRepository.getSavedCompetitorsWithPrice.mockResolvedValue([]);
    ({ app } = await buildTestApp({ productRepository, competitorRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/1/saved-competitors" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/99/saved-competitors" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 for an invalid product id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/products/abc/saved-competitors" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PRODUCT_ID");
  });
});

// ── POST /api/products/:id/competitors (save) ─────────────────────────────────

describe("POST /api/products/:id/competitors", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  const validCompetitor = {
    title: "Blue Widget XL",
    externalId: "ext-001",
    rawPrice: "$45.00",
    extractedPrice: 45.0,
    rawOldPrice: null,
    extractedOldPrice: null,
    currency: "NZD",
    source: "Acme Store",
    link: "https://acme.example.com/blue-widget-xl",
    thumbnail: null,
    tag: null
  };

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/99/competitors",
      payload: { competitors: [validCompetitor] }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 when competitors array is empty", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/1/competitors",
      payload: { competitors: [] }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 with saved items on success", async () => {
    const productRepository = makeProductRepository();
    const competitorAnalysisService = {
      fetchCompetitors: vi.fn(),
      saveCompetitors: vi.fn().mockResolvedValue([{ id: 1, title: "Blue Widget XL" }]),
      searchAndSuggest: vi.fn().mockResolvedValue([])
    };
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    ({ app } = await buildTestApp({ productRepository, competitorAnalysisService }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/1/competitors",
      payload: { competitors: [validCompetitor] }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });
});


// ── GET /api/products/:id/competitors ─────────────────────────────────────────

describe("GET /api/products/:id/competitors", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with linked competitor products", async () => {
    const productRepository = makeProductRepository();
    const competitorRepository = makeCompetitorRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    competitorRepository.getCompetitorsByProductId.mockResolvedValue([
      { id: 3, title: "Rival Widget", source: "Rival Store", extractedPrice: 79.99 }
    ]);
    ({ app } = await buildTestApp({ productRepository, competitorRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/1/competitors" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/99/competitors" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

// ── DELETE /api/products/:id/competitors/:competitorId ────────────────────────

describe("DELETE /api/products/:id/competitors/:competitorId", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 204 on successful delete", async () => {
    const productRepository = makeProductRepository();
    const competitorRepository = makeCompetitorRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    ({ app } = await buildTestApp({ productRepository, competitorRepository }));

    const response = await app.inject({ method: "DELETE", url: "/api/products/1/competitors/5" });

    expect(response.statusCode).toBe(204);
    expect(competitorRepository.deleteCompetitorProduct).toHaveBeenCalledWith(5);
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "DELETE", url: "/api/products/99/competitors/5" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 for a non-integer competitor id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "DELETE", url: "/api/products/1/competitors/abc" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_COMPETITOR_ID");
  });

  it("returns 400 for competitor id zero", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "DELETE", url: "/api/products/1/competitors/0" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_COMPETITOR_ID");
  });
});

// ── PATCH /api/products/:id/competitors/:competitorId ─────────────────────────

describe("PATCH /api/products/:id/competitors/:competitorId", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 when status confirmed", async () => {
    const productRepository = makeProductRepository();
    const competitorRepository = makeCompetitorRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    ({ app } = await buildTestApp({ productRepository, competitorRepository }));

    const response = await app.inject({
      method: "PATCH",
      url: "/api/products/1/competitors/5",
      payload: { status: "confirmed" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(competitorRepository.confirmCompetitorProduct).toHaveBeenCalledWith(5);
  });

  it("returns 400 when status is not 'confirmed'", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({
      method: "PATCH",
      url: "/api/products/1/competitors/5",
      payload: { status: "rejected" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_STATUS");
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({
      method: "PATCH",
      url: "/api/products/99/competitors/5",
      payload: { status: "confirmed" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 for a non-integer competitor id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: "PATCH",
      url: "/api/products/1/competitors/abc",
      payload: { status: "confirmed" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_COMPETITOR_ID");
  });
});

// ── POST /api/products/:id/competitors/search ─────────────────────────────────

describe("POST /api/products/:id/competitors/search", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 202 with submitted=1 when product has a title", async () => {
    const productRepository = makeProductRepository();
    const dataForSeoService = makeDataForSeoService();
    productRepository.getProductById.mockResolvedValue(makeProductRow({ title: "Blue Widget" }));
    dataForSeoService.postShoppingTasks.mockResolvedValue(1);
    ({ app } = await buildTestApp({ productRepository, dataForSeoService }));

    const response = await app.inject({ method: "POST", url: "/api/products/1/competitors/search" });

    expect(response.statusCode).toBe(202);
    expect(response.json().submitted).toBe(1);
    expect(dataForSeoService.postShoppingTasks).toHaveBeenCalledWith(
      [{ id: 1, title: "Blue Widget" }],
      expect.stringContaining("/webhooks/dataforseo/pingback/shopping")
    );
  });

  it("returns 202 with submitted=0 when product has no title", async () => {
    const productRepository = makeProductRepository();
    const dataForSeoService = makeDataForSeoService();
    productRepository.getProductById.mockResolvedValue(makeProductRow({ title: null as unknown as string }));
    ({ app } = await buildTestApp({ productRepository, dataForSeoService }));

    const response = await app.inject({ method: "POST", url: "/api/products/1/competitors/search" });

    expect(response.statusCode).toBe(202);
    expect(response.json().submitted).toBe(0);
    expect(dataForSeoService.postShoppingTasks).not.toHaveBeenCalled();
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "POST", url: "/api/products/99/competitors/search" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });
});
