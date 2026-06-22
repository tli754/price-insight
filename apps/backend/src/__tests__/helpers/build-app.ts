/**
 * Test helper: builds a Fastify app instance with all external dependencies
 * (database, external APIs) replaced by vi.fn() stubs.
 *
 * No real connections are opened. Call `app.close()` in afterEach/afterAll.
 */

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { vi } from "vitest";

import { AppError } from "../../lib/app-error.js";
import { requireSession } from "../../lib/require-session.js";
import analysisRoutes from "../../routes/analysis.js";
import authRoutes from "../../routes/auth.js";
import healthRoutes from "../../routes/health.js";
import ordersRoutes from "../../routes/orders.js";
import productRoutes from "../../routes/products.js";
import reportRoutes from "../../routes/reports.js";
import shopifyWebhookRoutes from "../../routes/shopify-webhook.js";
import shopifyRoutes from "../../routes/shopify.js";
import webhookRoutes from "../../routes/webhook.js";

// ── Minimal fake env ──────────────────────────────────────────────────────────
export const fakeEnv = {
  NODE_ENV: "test" as const,
  PORT: 4000,
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  DEV_AUTH_PASSWORD: "test-password",
  MYSQL_HOST: "localhost",
  MYSQL_PORT: 3306,
  MYSQL_USER: "test",
  MYSQL_PASSWORD: "",
  MYSQL_DATABASE: "test",
  OPENAI_API_KEY: "fake",
  OPENAI_MODEL: "gpt-4.1-mini",
  SHOPIFY_TOKEN_URL: undefined,
  SHOPIFY_PRODUCTS_URL: undefined,
  SHOPIFY_ORDERS_URL: undefined,
  SHOPIFY_CLIENT_ID: undefined,
  SHOPIFY_CLIENT_SECRET: "fake-shopify-secret",
  SERPAPI_LOCATION: "New Zealand",
  SERPAPI_GL: "nz",
  SERPAPI_HL: "en",
  SERPAPI_GOOGLE_DOMAIN: "google.co.nz",
  SERPAPI_NUM_RESULTS: 40,
  DATAFORSEO_LOGIN: "fake",
  DATAFORSEO_PASSWORD: "fake",
  DATAFORSEO_WEBHOOK_SECRET: "fake-webhook-secret",
  WEBHOOK_HOST: "https://www.qweyha520.bar",
  CLOUD_TASKS_PROJECT: undefined,
  CLOUD_TASKS_LOCATION: undefined,
  CLOUD_TASKS_QUEUE: undefined,
  ORDER_WORKER_URL: undefined,
  INTERNAL_OIDC_SERVICE_ACCOUNT: undefined,
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

export function makeShopifyGraphQLService() {
  return {
    fetchOrders: vi.fn().mockResolvedValue([]),
    fetchOrderById: vi.fn().mockResolvedValue(null),
  };
}

export function makeCloudTasksClient() {
  return {
    enqueueSyncOrder: vi.fn().mockResolvedValue(undefined),
  };
}

export function makeOrderRepository() {
  return {
    getShopifyOrderUpdatedAt: vi.fn().mockResolvedValue(null),
    getLastSyncedAt: vi.fn().mockResolvedValue(null),
    importOrders: vi.fn().mockResolvedValue(0),
    upsertMappedOrder: vi.fn().mockResolvedValue({ skipped: false }),
    listOrders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getOrderById: vi.fn().mockResolvedValue(null),
    getProductSalesHistory: vi.fn().mockResolvedValue({
      summary: { totalQty: 0, totalRevenue: 0, avgUnitPrice: null, orderCount: 0, lastSoldAt: null, sold7d: 0, sold30d: 0, sold90d: 0, revenue7d: 0, revenue30d: 0, revenue90d: 0 },
      monthly: [],
      items: [],
      total: 0,
    }),
  };
}

export function makeAiReportRepository() {
  return {
    getLatestSuccessful: vi.fn().mockResolvedValue(null),
    getById: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue(1),
    updateCompleted: vi.fn().mockResolvedValue(undefined),
  };
}

export function makeAiReportService() {
  return {
    getLatestReport: vi.fn().mockResolvedValue(null),
    generateReport: vi.fn().mockResolvedValue(null),
  };
}

export type TestMocks = {
  productRepository: ReturnType<typeof makeProductRepository>;
  competitorRepository: ReturnType<typeof makeCompetitorRepository>;
  competitorAnalysisService: ReturnType<typeof makeCompetitorAnalysisService>;
  dataForSeoService: ReturnType<typeof makeDataForSeoService>;
  orderRepository: ReturnType<typeof makeOrderRepository>;
  shopifyService: ReturnType<typeof makeShopifyService> | null;
  shopifyGraphQLService: ReturnType<typeof makeShopifyGraphQLService> | null;
  cloudTasksClient: ReturnType<typeof makeCloudTasksClient> | null;
  aiReportRepository: ReturnType<typeof makeAiReportRepository>;
  aiReportService: ReturnType<typeof makeAiReportService>;
};

export async function buildTestApp(
  overrides: Partial<TestMocks> = {},
  envOverrides: Partial<typeof fakeEnv & { OWN_STORE_NAME?: string }> = {},
  opts: { protectAuth?: boolean } = {}
) {
  const mocks: TestMocks = {
    productRepository: overrides.productRepository ?? makeProductRepository(),
    competitorRepository: overrides.competitorRepository ?? makeCompetitorRepository(),
    competitorAnalysisService: overrides.competitorAnalysisService ?? makeCompetitorAnalysisService(),
    dataForSeoService: overrides.dataForSeoService ?? makeDataForSeoService(),
    orderRepository: overrides.orderRepository ?? makeOrderRepository(),
    shopifyService: "shopifyService" in overrides ? overrides.shopifyService ?? null : null,
    shopifyGraphQLService: "shopifyGraphQLService" in overrides ? overrides.shopifyGraphQLService ?? null : null,
    cloudTasksClient: "cloudTasksClient" in overrides ? (overrides.cloudTasksClient as ReturnType<typeof makeCloudTasksClient> | null) : makeCloudTasksClient(),
    aiReportRepository: overrides.aiReportRepository ?? makeAiReportRepository(),
    aiReportService: overrides.aiReportService ?? makeAiReportService(),
  };

  const app = Fastify({ logger: false });

  const resolvedEnv = { ...fakeEnv, ...envOverrides } as typeof fakeEnv;
  app.decorate("env", resolvedEnv);

  await app.register(cors, {
    origin: resolvedEnv.APP_URL,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(cookie);
  await app.register(jwt, { secret: resolvedEnv.SESSION_SECRET });

  app.decorate("productRepository", mocks.productRepository as any);
  app.decorate("competitorRepository", mocks.competitorRepository as any);
  app.decorate("competitorAnalysisService", mocks.competitorAnalysisService as any);
  app.decorate("dataForSeoService", mocks.dataForSeoService as any);
  app.decorate("orderRepository", mocks.orderRepository as any);
  app.decorate("shopifyService", mocks.shopifyService as any);
  app.decorate("shopifyGraphQLService", mocks.shopifyGraphQLService as any);
  app.decorate("cloudTasksClient", mocks.cloudTasksClient as any);
  app.decorate("aiReportRepository", mocks.aiReportRepository as any);
  app.decorate("aiReportService", mocks.aiReportService as any);

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

  await app.register(authRoutes);
  await app.register(healthRoutes, { prefix: "/api" });

  await app.register(async (protectedApi) => {
    if (opts.protectAuth) {
      protectedApi.addHook("preHandler", requireSession(protectedApi));
    }
    await protectedApi.register(productRoutes, { prefix: "/api" });
    await protectedApi.register(ordersRoutes, { prefix: "/api" });
    await protectedApi.register(shopifyRoutes, { prefix: "/api" });
    await protectedApi.register(analysisRoutes, { prefix: "/api" });
    await protectedApi.register(reportRoutes, { prefix: "/api" });
  });

  await app.register(webhookRoutes);
  await app.register(shopifyWebhookRoutes);

  await app.ready();

  return { app, mocks, validSessionCookie: app.jwt.sign({ user: { id: "dev", email: "dev@local", name: "Dev User" } }) };
}
