import Fastify from "fastify";
import cors from "@fastify/cors";

import type { AppEnv } from "./config/env.js";
import { createDatabase } from "./db/index.js";
import { AppError } from "./lib/app-error.js";
import healthRoutes from "./routes/health.js";
import productRoutes from "./routes/products.js";
import { createRedis } from "./services/cache.js";
import { ExtractorService } from "./services/extractor-service.js";
import { JinaReaderService } from "./services/jina-reader.js";
import { OpenAIExtractorService } from "./services/openai-extractor.js";
import { ProductRepository } from "./services/product-repository.js";

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
  const jinaReader = new JinaReaderService(env.JINA_API_KEY);
  const openAIExtractor = new OpenAIExtractorService(env);
  const extractorService = new ExtractorService(
    env,
    redis,
    productRepository,
    jinaReader,
    openAIExtractor
  );

  app.decorate("env", env);
  app.decorate("productRepository", productRepository);
  app.decorate("extractorService", extractorService);

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

  return app;
}
