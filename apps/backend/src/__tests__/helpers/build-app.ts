/**
 * Test helper: builds a Fastify app instance with all external dependencies
 * (database, external APIs) replaced by vi.fn() stubs.
 *
 * No real connections are opened. Call `app.close()` in afterEach/afterAll.
 */

import Fastify from "fastify";
import { vi } from "vitest";

import { AppError } from "../../lib/app-error.js";
import analysisRoutes from "../../routes/analysis.js";
import healthRoutes from "../../routes/health.js";
import ordersRoutes from "../../routes/orders.js";
import productRoutes from "../../routes/products.js";
import webhookRoutes from "../../routes/webhook.js";

// ── Minimal fake env ──────────────────────────────────────────────────────────
export const fakeEnv = {
  NODE_ENV: "test" as const,
  PORT: 4000,
  MYSQL_HOST: "localhost",
  MYSQL_PORT: 3306,
  MYSQL_USER: "test",
  MYSQL_PASSWORD: "",
  MYSQL_DATABASE: "test",
  JINA_API_KEY: "fake",
  SERPAPI_API_KEY: "fake",
  OPENAI_API_KEY: "fake",
  OPENAI_MODEL: "gpt-4.1-mini",
  SHOPIFY_TOKEN_URL: undefined,
  SHOPIFY_PRODUCTS_URL: undefined,
  SHOPIFY_ORDERS_URL: undefined,
  SHOPIFY_CLIENT_ID: undefined,
  SHOPIFY_CLIENT_SECRET: undefined,
  SERPAPI_LOCATION: "New Zealand",
  SERPAPI_GL: "nz",
  SERPAPI_HL: "en",
  SERPAPI_GOOGLE_DOMAIN: "google.co.nz",
  SERPAPI_NUM_RESULTS: 40,
  DATAFORSEO_LOGIN: "fake",
  DATAFORSEO_PASSWORD: "fake",
  DATAFORSEO_WEBHOOK_SECRET: "fake-webhook-secret",
  WEBHOOK_HOST: "https://www.qweyha520.bar"
};

// ── Mock repository / service factories ──────────────────────────────────────

export function makeProductRepository() {
  return {
    listProducts: vi.fn().mockResolvedValue([]),
    getProductById: vi.fn().mockResolvedValue(null),
    getProductsByIds: vi.fn().mockResolvedValue([]),
    importProducts: vi.fn().mockResolvedValue(0),
    deleteProduct: vi.fn().mockResolvedValue(undefined)
  };
}

export function makeCompetitorRepository() {
  return {
    getAllCompetitors: vi.fn().mockResolvedValue([]),
    getCompetitorById: vi.fn().mockResolvedValue(null),
    getProductsByCompetitorId: vi.fn().mockResolvedValue([]),
    getCompetitorsByProductId: vi.fn().mockResolvedValue([]),
    getSavedCompetitorsWithPrice: vi.fn().mockResolvedValue([]),
    findOrCreateCompetitor: vi.fn().mockResolvedValue({ id: 1, name: "Acme", state: "active" }),
    replaceCompetitorProducts: vi.fn().mockResolvedValue([]),
    deleteCompetitorProduct: vi.fn().mockResolvedValue(undefined),
    deleteSuggestedByProduct: vi.fn().mockResolvedValue(undefined),
    getDeletedExternalIds: vi.fn().mockResolvedValue(new Set()),
    insertSuggestedCompetitors: vi.fn().mockResolvedValue(undefined),
    upsertSuggestedCompetitor: vi.fn().mockResolvedValue(undefined),
    updateCompetitorProductStatus: vi.fn().mockResolvedValue(undefined),
    confirmCompetitorProduct: vi.fn().mockResolvedValue(undefined),
    recordPricesForConfirmed: vi.fn().mockResolvedValue(undefined),
    recordPriceInsight: vi.fn().mockResolvedValue(undefined)
  };
}

export function makeDataForSeoService() {
  return {
    postShoppingTasks: vi.fn().mockResolvedValue(0),
    fetchShoppingTaskResult: vi.fn().mockResolvedValue({ tasks: [] }),
    fetchProductInfoTaskResult: vi.fn().mockResolvedValue({ tasks: [] }),
    postProductInfoTasks: vi.fn().mockResolvedValue(undefined),
    parseShoppingCandidates: vi.fn().mockReturnValue([]),
    fetchProductInfoResults: vi.fn().mockReturnValue([])
  };
}

export function makeCompetitorAnalysisService() {
  return {
    saveCompetitors: vi.fn().mockResolvedValue([]),
    searchAndSuggest: vi.fn().mockResolvedValue([])
  };
}

// ── App builder ───────────────────────────────────────────────────────────────

export function makeShopifyService() {
  return {
    getAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
    fetchAllProducts: vi.fn().mockResolvedValue([]),
    fetchOrders: vi.fn().mockResolvedValue([])
  };
}

export function makeOrderRepository() {
  return {
    getLastSyncedAt: vi.fn().mockResolvedValue(null),
    importOrders: vi.fn().mockResolvedValue(0),
    listOrders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getOrderById: vi.fn().mockResolvedValue(null)
  };
}

export type TestMocks = {
  productRepository: ReturnType<typeof makeProductRepository>;
  competitorRepository: ReturnType<typeof makeCompetitorRepository>;
  competitorAnalysisService: ReturnType<typeof makeCompetitorAnalysisService>;
  dataForSeoService: ReturnType<typeof makeDataForSeoService>;
  orderRepository: ReturnType<typeof makeOrderRepository>;
  shopifyService: ReturnType<typeof makeShopifyService> | null;
};

export async function buildTestApp(
  overrides: Partial<TestMocks> = {},
  envOverrides: Partial<typeof fakeEnv & { OWN_STORE_NAME?: string }> = {}
) {
  const mocks: TestMocks = {
    productRepository: overrides.productRepository ?? makeProductRepository(),
    competitorRepository: overrides.competitorRepository ?? makeCompetitorRepository(),
    competitorAnalysisService: overrides.competitorAnalysisService ?? makeCompetitorAnalysisService(),
    dataForSeoService: overrides.dataForSeoService ?? makeDataForSeoService(),
    orderRepository: overrides.orderRepository ?? makeOrderRepository(),
    shopifyService: "shopifyService" in overrides ? overrides.shopifyService ?? null : null
  };

  const app = Fastify({ logger: false });

  app.decorate("env", { ...fakeEnv, ...envOverrides } as typeof fakeEnv);
  app.decorate("productRepository", mocks.productRepository as any);
  app.decorate("competitorRepository", mocks.competitorRepository as any);
  app.decorate("competitorAnalysisService", mocks.competitorAnalysisService as any);
  app.decorate("dataForSeoService", mocks.dataForSeoService as any);
  app.decorate("orderRepository", mocks.orderRepository as any);
  app.decorate("shopifyService", mocks.shopifyService as any);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message }
      });
    }
    if (error instanceof Error && error.name === "ZodError") {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message }
      });
    }
    return reply.status(500).send({
      error: { code: "INTERNAL_SERVER_ERROR", message: "Unexpected server error." }
    });
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(productRoutes, { prefix: "/api" });
  await app.register(ordersRoutes, { prefix: "/api" });
  await app.register(analysisRoutes, { prefix: "/api" });
  await app.register(webhookRoutes);

  await app.ready();

  return { app, mocks };
}
