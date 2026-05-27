/**
 * Test helper: builds a Fastify app instance with all external dependencies
 * (database, Redis, external APIs) replaced by vi.fn() stubs.
 *
 * No real connections are opened. Call `app.close()` in afterEach/afterAll.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { vi } from "vitest";

import { AppError } from "../../lib/app-error.js";
import analysisRoutes from "../../routes/analysis.js";
import healthRoutes from "../../routes/health.js";
import productRoutes from "../../routes/products.js";

// ── Minimal fake env ──────────────────────────────────────────────────────────
export const fakeEnv = {
  NODE_ENV: "test" as const,
  PORT: 4000,
  APP_URL: "http://localhost:3000",
  MYSQL_HOST: "localhost",
  MYSQL_PORT: 3306,
  MYSQL_USER: "test",
  MYSQL_PASSWORD: "",
  MYSQL_DATABASE: "test",
  REDIS_HOST: "localhost",
  REDIS_PORT: 6379,
  REDIS_DB: 0,
  REDIS_TTL_SECONDS: 86400,
  JINA_API_KEY: "fake",
  SERPAPI_API_KEY: "fake",
  OPENAI_API_KEY: "fake",
  OPENAI_MODEL: "gpt-4.1-mini",
  SHOPIFY_TOKEN_URL: undefined,
  SHOPIFY_PRODUCTS_URL: undefined,
  SHOPIFY_CLIENT_ID: undefined,
  SHOPIFY_CLIENT_SECRET: undefined
};

// ── Mock repository / service factories ──────────────────────────────────────

export function makeProductRepository() {
  return {
    listProducts: vi.fn().mockResolvedValue([]),
    getProductById: vi.fn().mockResolvedValue(null),
    importProducts: vi.fn().mockResolvedValue(0),
    deleteProduct: vi.fn().mockResolvedValue(undefined)
  };
}

export function makeCompetitorRepository() {
  return {
    getAllCompetitors: vi.fn().mockResolvedValue([]),
    getCompetitorById: vi.fn().mockResolvedValue(null),
    getProductsByCompetitorId: vi.fn().mockResolvedValue([]),
    getSavedCompetitorsWithPrice: vi.fn().mockResolvedValue([]),
    findOrCreateCompetitor: vi.fn().mockResolvedValue({ id: 1, name: "Acme", state: "active" }),
    replaceCompetitorProducts: vi.fn().mockResolvedValue([]),
    deleteCompetitorProduct: vi.fn().mockResolvedValue(undefined),
    recordPriceInsight: vi.fn().mockResolvedValue(undefined)
  };
}

export function makeCompetitorAnalysisService() {
  return {
    fetchCompetitors: vi.fn().mockResolvedValue({ cached: false, query: "", competitors: [] }),
    saveCompetitors: vi.fn().mockResolvedValue([])
  };
}

// ── App builder ───────────────────────────────────────────────────────────────

export type TestMocks = {
  productRepository: ReturnType<typeof makeProductRepository>;
  competitorRepository: ReturnType<typeof makeCompetitorRepository>;
  competitorAnalysisService: ReturnType<typeof makeCompetitorAnalysisService>;
  shopifyService: null;
};

export async function buildTestApp(overrides: Partial<TestMocks> = {}) {
  const mocks: TestMocks = {
    productRepository: overrides.productRepository ?? makeProductRepository(),
    competitorRepository: overrides.competitorRepository ?? makeCompetitorRepository(),
    competitorAnalysisService: overrides.competitorAnalysisService ?? makeCompetitorAnalysisService(),
    shopifyService: null
  };

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: fakeEnv.APP_URL, credentials: true });

  app.decorate("env", fakeEnv);
  app.decorate("productRepository", mocks.productRepository);
  app.decorate("competitorRepository", mocks.competitorRepository);
  app.decorate("competitorAnalysisService", mocks.competitorAnalysisService);
  app.decorate("shopifyService", mocks.shopifyService);

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
  await app.register(analysisRoutes, { prefix: "/api" });

  await app.ready();

  return { app, mocks };
}
