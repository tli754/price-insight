import { describe, it, expect } from "vitest";

import { ProductRepository } from "../services/product-repository.js";
import type { ShopifyProduct } from "../services/product-repository.js";
import { makeMockDb } from "./helpers/mock-db.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeShopifyProduct(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 999888777,
    title: "Blue Widget",
    body_html: "<p>A great widget</p>",
    vendor: "Acme",
    handle: "blue-widget",
    status: "active",
    tags: "widget,blue",
    variants: [
      {
        price: "49.99",
        compare_at_price: null,
        sku: "BW-001",
        barcode: null,
        grams: 200,
        weight: 0.2,
        weight_unit: "kg",
        inventory_quantity: 50
      }
    ],
    images: [],
    ...overrides
  };
}

const fakeProductRow = {
  id: 1,
  externalId: 999888777,
  status: "active",
  title: "Blue Widget",
  brand: "Acme",
  handle: "blue-widget",
  price: 49.99,
  currency: null,
  thumbnail: null,
  tags: "widget,blue",
  description: "<p>A great widget</p>",
  sku: "BW-001",
  weight: 0.2,
  weightUnit: "kg",
  inventoryQuantity: 50,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01")
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProductRepository.listProducts()", () => {
  it("returns all rows ordered by updatedAt desc", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([fakeProductRow]);
    const repo = new ProductRepository(db as any);

    const result = await repo.listProducts();

    expect(db._select.orderBy).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Blue Widget");
  });

  it("returns an empty array when there are no products", async () => {
    const db = makeMockDb();
    db._select.orderBy.mockResolvedValueOnce([]);
    const repo = new ProductRepository(db as any);

    const result = await repo.listProducts();

    expect(result).toEqual([]);
  });
});

describe("ProductRepository.getProductById()", () => {
  it("returns the product with its images when found", async () => {
    const db = makeMockDb();
    // First select: product lookup
    db._select.limit.mockResolvedValueOnce([fakeProductRow]);
    // Second select: images lookup
    db._select.orderBy.mockResolvedValueOnce([{ id: 10, src: "https://cdn.example.com/img.jpg" }]);
    const repo = new ProductRepository(db as any);

    const result = await repo.getProductById(1);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.images).toHaveLength(1);
  });

  it("returns null when no product matches the id", async () => {
    const db = makeMockDb();
    db._select.limit.mockResolvedValueOnce([]);
    const repo = new ProductRepository(db as any);

    const result = await repo.getProductById(999);

    expect(result).toBeNull();
  });
});

describe("ProductRepository.deleteProduct()", () => {
  it("calls db.delete with the correct product id", async () => {
    const db = makeMockDb();
    const repo = new ProductRepository(db as any);

    await repo.deleteProduct(42);

    expect(db.delete).toHaveBeenCalledOnce();
    expect(db._delete.where).toHaveBeenCalledOnce();
  });
});

describe("ProductRepository.importProducts()", () => {
  it("inserts a new product and returns count 1", async () => {
    const db = makeMockDb();
    // select: no existing product found
    db._select.limit.mockResolvedValueOnce([]);
    const repo = new ProductRepository(db as any);

    const count = await repo.importProducts([makeShopifyProduct()]);

    expect(count).toBe(1);
    expect(db.insert).toHaveBeenCalledOnce(); // products insert only (no images)
  });

  it("inserts a new product and its images", async () => {
    const db = makeMockDb();
    db._select.limit.mockResolvedValueOnce([]);
    const repo = new ProductRepository(db as any);

    const productWithImages = makeShopifyProduct({
      images: [{ id: 1, position: 1, src: "https://cdn.example.com/img.jpg", alt: "Widget", width: 800, height: 600 }]
    });

    const count = await repo.importProducts([productWithImages]);

    expect(count).toBe(1);
    expect(db.insert).toHaveBeenCalledTimes(2); // products + product_images
  });

  it("updates an existing product (upsert) and returns count 0", async () => {
    const db = makeMockDb();
    // select: existing product found
    db._select.limit.mockResolvedValueOnce([{ id: 5 }]);
    const repo = new ProductRepository(db as any);

    const count = await repo.importProducts([makeShopifyProduct()]);

    expect(count).toBe(0); // update, not insert → count stays 0
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.delete).toHaveBeenCalledOnce(); // old images cleared
  });

  it("inserts products for each item in the array", async () => {
    const db = makeMockDb();
    // Both products are new (no existing found)
    db._select.limit
      .mockResolvedValueOnce([]) // first product
      .mockResolvedValueOnce([]); // second product
    const repo = new ProductRepository(db as any);

    const count = await repo.importProducts([
      makeShopifyProduct({ id: 111 }),
      makeShopifyProduct({ id: 222 })
    ]);

    expect(count).toBe(2);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});
