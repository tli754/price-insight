import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProductAiReportRow } from "../db/schema.js";
import { AiReportService } from "../services/ai-report-service.js";
import { buildTestApp, makeAiReportService, makeProductRepository } from "./helpers/build-app.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAiReportRow(overrides: Partial<ProductAiReportRow> = {}): ProductAiReportRow {
  return {
    id: 1,
    productId: 42,
    status: "success",
    model: "gpt-4.1-mini",
    reportTypes: ["pricing", "salesTrend"],
    inputHash: "abc123",
    inputSnapshot: null,
    output: { pricing: null, salesTrend: null },
    errorMessage: null,
    generatedBy: null,
    createdAt: new Date("2026-06-08T10:00:00Z"),
    completedAt: new Date("2026-06-08T10:00:05Z"),
    ...overrides,
  };
}

function makeProductRow() {
  return {
    id: 42,
    externalId: 99999,
    status: "active",
    title: "Test Product",
    brand: "Acme",
    handle: "test-product",
    price: 99.99,
    currency: "NZD",
    thumbnail: null,
    tags: null,
    description: "A test product",
    sku: "TP-001",
    weight: null,
    weightUnit: null,
    inventoryQuantity: 10,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    images: [],
  };
}

// ── Route tests ───────────────────────────────────────────────────────────────

describe("GET /api/products/:id/reports/ai/latest", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with null report when no report exists", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());

    const aiReportService = makeAiReportService();
    aiReportService.getLatestReport.mockResolvedValue(null);

    ({ app } = await buildTestApp({ productRepository, aiReportService }));

    const response = await app.inject({ method: "GET", url: "/api/products/42/reports/ai/latest" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ productId: 42, report: null });
  });

  it("returns 200 with the latest successful report", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());

    const aiReportService = makeAiReportService();
    const row = makeAiReportRow();
    aiReportService.getLatestReport.mockResolvedValue(row);

    ({ app } = await buildTestApp({ productRepository, aiReportService }));

    const response = await app.inject({ method: "GET", url: "/api/products/42/reports/ai/latest" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.productId).toBe(42);
    expect(body.report.id).toBe(1);
    expect(body.report.status).toBe("success");
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);

    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "GET", url: "/api/products/99/reports/ai/latest" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 for invalid product id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/products/abc/reports/ai/latest" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PRODUCT_ID");
  });
});

describe("POST /api/products/:id/reports/ai", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("returns 201 with generated report", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());

    const aiReportService = makeAiReportService();
    const row = makeAiReportRow();
    aiReportService.generateReport.mockResolvedValue(row);

    ({ app } = await buildTestApp({ productRepository, aiReportService }));

    const response = await app.inject({
      method: "POST",
      url: "/api/products/42/reports/ai",
      payload: { reports: ["pricing", "salesTrend"] },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.productId).toBe(42);
    expect(body.report.id).toBe(1);
    expect(aiReportService.generateReport).toHaveBeenCalledWith(42, ["pricing", "salesTrend"]);
  });

  it("generates all four report types when body is empty", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(makeProductRow());

    const aiReportService = makeAiReportService();
    aiReportService.generateReport.mockResolvedValue(makeAiReportRow());

    ({ app } = await buildTestApp({ productRepository, aiReportService }));

    await app.inject({ method: "POST", url: "/api/products/42/reports/ai", payload: {} });

    const call = aiReportService.generateReport.mock.calls[0];
    expect(call[1]).toEqual(["pricing", "competitorMatch", "salesTrend", "listingImprovement"]);
  });

  it("returns 404 when product does not exist", async () => {
    const productRepository = makeProductRepository();
    productRepository.getProductById.mockResolvedValue(null);

    ({ app } = await buildTestApp({ productRepository }));

    const response = await app.inject({ method: "POST", url: "/api/products/99/reports/ai", payload: {} });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 400 for invalid product id", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "POST", url: "/api/products/abc/reports/ai", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PRODUCT_ID");
  });
});

// ── AiReportService unit tests ────────────────────────────────────────────────

describe("AiReportService.buildPayload", () => {
  it("strips customer PII from sales order lines", () => {
    const service = new AiReportService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      "gpt-4.1-mini"
    );

    const product = makeProductRow();
    const competitors: any[] = [];
    const salesHistory = {
      summary: { totalQty: 5, totalRevenue: 250, avgUnitPrice: 50, orderCount: 5, lastSoldAt: null, sold7d: 0, sold30d: 5, sold90d: 5, revenue7d: 0, revenue30d: 250, revenue90d: 250 },
      monthly: [],
      items: [
        {
          orderId: 1,
          orderNumber: "#1001",
          processedAt: "2026-06-01T00:00:00.000Z",
          customerFirstName: "Alice",
          customerLastName: "Smith",
          financialStatus: "paid",
          fulfillmentStatus: "fulfilled",
          currency: "NZD",
          qty: 1,
          unitPrice: 50,
          lineTotal: 50,
        },
      ],
      total: 1,
    };

    const payload = service.buildPayload(product, competitors, salesHistory as any, ["pricing"]);

    const orderLine = payload.sales.recentOrders[0];
    expect(orderLine).not.toHaveProperty("customerFirstName");
    expect(orderLine).not.toHaveProperty("customerLastName");
    expect(orderLine).not.toHaveProperty("orderId");
    expect(orderLine).not.toHaveProperty("orderNumber");
    expect(orderLine).toHaveProperty("qty", 1);
    expect(orderLine).toHaveProperty("financialStatus", "paid");
  });

  it("caps competitors at 20 and only includes confirmed ones", () => {
    const service = new AiReportService({} as any, {} as any, {} as any, {} as any, {} as any, "gpt-4.1-mini");

    const product = makeProductRow();
    const competitors = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      title: `Competitor ${i + 1}`,
      source: "google",
      currency: "NZD",
      country: "NZ",
      extractedPrice: 99,
      shippingRaw: null,
      status: i < 25 ? "confirmed" : "suggested",
      capturedAt: new Date(),
      thumbnail: null,
      productLink: "https://example.com",
      tag: null,
      googlePosition: null,
      rating: null,
      reviewCount: null,
      shippingExtracted: null,
      extractedOldPrice: null,
      createdAt: new Date(),
      rawPrice: null,
    }));
    const salesHistory = { summary: {} as any, monthly: [], items: [], total: 0 };

    const payload = service.buildPayload(product, competitors as any, salesHistory as any, ["competitorMatch"]);

    expect(payload.competitors.length).toBeLessThanOrEqual(20);
    expect(payload.competitors.every((c) => c.status === "confirmed")).toBe(true);
  });

  it("includes requested report types in payload", () => {
    const service = new AiReportService({} as any, {} as any, {} as any, {} as any, {} as any, "gpt-4.1-mini");
    const product = makeProductRow();
    const salesHistory = { summary: {} as any, monthly: [], items: [], total: 0 };

    const payload = service.buildPayload(product, [], salesHistory as any, ["pricing", "salesTrend"]);

    expect(payload.requestedReports).toEqual(["pricing", "salesTrend"]);
  });

  it("does not include product images src beyond first 5", () => {
    const service = new AiReportService({} as any, {} as any, {} as any, {} as any, {} as any, "gpt-4.1-mini");
    const product = {
      ...makeProductRow(),
      images: Array.from({ length: 10 }, (_, i) => ({ id: i, src: `img${i}.jpg`, alt: "", productId: 42, externalId: i, position: i, width: null, height: null })),
    };
    const salesHistory = { summary: {} as any, monthly: [], items: [], total: 0 };

    const payload = service.buildPayload(product, [], salesHistory as any, ["listingImprovement"]);

    expect(payload.product.imageUrls.length).toBe(5);
  });
});

describe("AiReportService OpenAI response validation", () => {
  it("rejects when OpenAI returns empty parsed output", async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          parse: vi.fn().mockResolvedValue({
            choices: [{ finish_reason: "stop", message: { parsed: null } }],
          }),
        },
      },
    };

    const service = new AiReportService({} as any, {} as any, {} as any, {} as any, mockOpenAI as any, "gpt-4.1-mini");

    await expect((service as any).callOpenAI({})).rejects.toThrow("OpenAI returned empty parsed output");
  });

  it("rejects when OpenAI hits token limit", async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          parse: vi.fn().mockResolvedValue({
            choices: [{ finish_reason: "length", message: { parsed: null } }],
          }),
        },
      },
    };

    const service = new AiReportService({} as any, {} as any, {} as any, {} as any, mockOpenAI as any, "gpt-4.1-mini");

    await expect((service as any).callOpenAI({})).rejects.toThrow("truncated");
  });
});
