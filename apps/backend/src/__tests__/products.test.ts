import { afterEach, describe, it, expect } from "vitest";
import { buildTestApp, makeProductRepository, makeShopifyService } from "./helpers/build-app.js";
import type { ProductRow, ProductImageRow } from "../db/schema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProductRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 1,
    externalId: 123456789,
    status: "active",
    title: "Test Product",
    brand: "Acme",
    handle: "test-product",
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
    ...overrides
  };
}

function makeFullProduct(overrides: Partial<ProductRow> = {}): ProductRow & { images: ProductImageRow[] } {
  return { ...makeProductRow(overrides), images: [] };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/products", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with empty items when there are no products", async () => {
    const productRepository = makeProductRepository();
    productRepository.listProducts.mockResolvedValue([]);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it("returns 200 with populated items list", async () => {
    const productRepository = makeProductRepository();
    productRepository.listProducts.mockResolvedValue([makeProductRow(), makeProductRow({ id: 2, title: "Another" })]);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: ProductRow[] }>();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].title).toBe("Test Product");
  });

  it("returns 500 when the repository throws", async () => {
    const productRepository = makeProductRepository();
    productRepository.listProducts.mockRejectedValue(new Error("DB connection lost"));
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("GET /api/products/:id", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with the product when found", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeFullProduct());
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.id).toBe(1);
    expect(response.json().item.title).toBe("Test Product");
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/99" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 for a non-integer id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/products/abc" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PRODUCT_ID");
  });

  it("returns 400 for id zero", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/products/0" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PRODUCT_ID");
  });

  it("returns 400 for a negative id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/products/-5" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PRODUCT_ID");
  });
});

describe("POST /api/products/import", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  const validPayload = {
    products: [
      {
        id: 1234567890,
        title: "Blue Widget",
        body_html: "<p>A widget</p>",
        vendor: "Acme",
        handle: "blue-widget",
        status: "active",
        tags: "widget",
        variants: [
          {
            id: 1,
            price: "29.99",
            compare_at_price: null,
            sku: "BW-001",
            barcode: null,
            grams: 200,
            weight: 0.2,
            weight_unit: "kg",
            inventory_quantity: 50,
            option1: null,
            option2: null,
            option3: null
          }
        ],
        images: [],
        image: null
      }
    ]
  };

  it("returns 201 with imported count on success", async () => {
    const productRepository = makeProductRepository();
    productRepository.importProducts.mockResolvedValue(1);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/import",
      payload: validPayload
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ imported: 1 });
  });

  it("returns 400 when body fails Zod validation", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: "POST",
      url: "/api/products/import",
      payload: { products: "not-an-array" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when products array is missing", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({
      method: "POST",
      url: "/api/products/import",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("DELETE /api/products/:id", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 204 on successful delete", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeFullProduct());
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "DELETE", url: "/api/products/1" });

    expect(response.statusCode).toBe(204);
    expect(productRepository.deleteProduct).toHaveBeenCalledWith(1);
  });

  it("returns 404 when product to delete does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);
    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "DELETE", url: "/api/products/99" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("POST /api/products/sync", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 503 SHOPIFY_NOT_CONFIGURED when shopifyService is null", async () => {
    ({ app } = await buildTestApp({ shopifyService: null }));

    const response = await app.inject({ method: "POST", url: "/api/products/sync" });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SHOPIFY_NOT_CONFIGURED");
  });

  it("returns 200 with synced count on success", async () => {
    const productRepository = makeProductRepository();
    productRepository.importProducts.mockResolvedValue(5);

    const shopifyService = makeShopifyService();
    shopifyService.getAccessToken.mockResolvedValue("tok_abc");
    shopifyService.streamProducts.mockImplementation(async function* () {
      yield [];
    });

    ({ app } = await buildTestApp({ productRepository, shopifyService }));

    const response = await app.inject({ method: "POST", url: "/api/products/sync" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ synced: 5 });
    expect(shopifyService.getAccessToken).toHaveBeenCalledOnce();
    expect(shopifyService.streamProducts).toHaveBeenCalledWith("tok_abc");
  });
});
