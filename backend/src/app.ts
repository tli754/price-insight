import Fastify from "fastify";
import cors from "@fastify/cors";

import type { AppEnv } from "./config/env.js";
import { createDatabase } from "./db/index.js";
import { AppError } from "./lib/app-error.js";
import analysisRoutes from "./routes/analysis.js";
import healthRoutes from "./routes/health.js";
import productRoutes from "./routes/products.js";
import { createRedis } from "./services/cache.js";
import { CompetitorAnalysisService } from "./services/competitor-analysis-service.js";
import { CompetitorRepository } from "./services/competitor-repository.js";
import { ProductRepository } from "./services/product-repository.js";
import { SerpApiService } from "./services/serp-api-service.js";

export async function buildApp(env: AppEnv) {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true
  });

  const { db, pool } = createDatabase(env);
  const redis = createRedis(env);
  await redis.connect();

  const productRepository = new ProductRepository(db);
  const competitorRepository = new CompetitorRepository(db);
  const serpApi = new SerpApiService(env.SERPAPI_API_KEY);
  const competitorAnalysisService = new CompetitorAnalysisService(serpApi, redis, competitorRepository);

  app.decorate("env", env);
  app.decorate("productRepository", productRepository);
  app.decorate("competitorRepository", competitorRepository);
  app.decorate("competitorAnalysisService", competitorAnalysisService);

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error instanceof Error && error.name === "ZodError") {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error."
      }
    });
  });

  app.addHook("onClose", async () => {
    await redis.quit();
    await pool.end();
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(productRoutes, { prefix: "/api" });
  await app.register(analysisRoutes, { prefix: "/api" });

  return app;
}
