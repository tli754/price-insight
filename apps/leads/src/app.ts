import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { ZodError } from "zod";

import { close, connect, getDb } from "./db/mongo.js";
import { ensureIndexes } from "./db/indexes.js";
import type { LeadsEnv } from "./env.js";
import { AppError } from "./lib/app-error.js";
import { requireSession } from "./lib/require-session.js";
import { companyRepository, type CompanyRepository } from "./repo/company-repository.js";
import healthRoutes from "./routes/health.js";
import leadsRoutes from "./routes/leads.js";

export interface AppDeps {
  /**
   * Inject a repository (e.g. a mock in tests) to bypass the live Mongo
   * connection. When provided, buildApp does NOT connect to MongoDB.
   */
  repository?: CompanyRepository;
}

export async function buildApp(env: LeadsEnv, deps: AppDeps = {}) {
  const app = Fastify({ logger: true });

  const repository = deps.repository ?? companyRepository;
  const useDb = deps.repository === undefined;

  app.decorate("env", env);

  await app.register(cors, {
    origin: env.APP_URL,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
  });
  await app.register(cookie);
  await app.register(jwt, { secret: env.SESSION_SECRET });

  app.decorate("companyRepository", repository);

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

    if (error instanceof ZodError) {
      const message = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; ");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: message || "Validation failed."
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

  // Connect + ensure indexes on boot only when using the real Mongo repository.
  if (useDb) {
    await connect();
    await ensureIndexes(getDb());
    app.addHook("onClose", async () => {
      await close();
    });
  }

  await app.register(healthRoutes, { prefix: "/api" });

  await app.register(async (protectedApi) => {
    protectedApi.addHook("preHandler", requireSession(protectedApi));
    await protectedApi.register(leadsRoutes, { prefix: "/api" });
  });

  return app;
}
