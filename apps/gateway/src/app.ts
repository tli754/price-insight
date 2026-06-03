import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import replyFrom from "@fastify/reply-from";

import type { AppEnv } from "./config/env.js";
import authRoutes from "./routes/auth.js";

const PUBLIC_API_PATHS = new Set(["/api/health"]);

export async function buildApp(env: AppEnv) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });

  await app.register(cookie);

  await app.register(jwt, { secret: env.SESSION_SECRET });

  await app.register(replyFrom, { base: env.BACKEND_URL });

  // Gateway health — used by k8s probes
  app.get("/health", async () => ({ status: "ok" }));

  // Auth routes (public)
  await app.register(authRoutes, { env });

  // Proxy all /api/* to backend, with session guard
  app.all("/api/*", async (request, reply) => {
    const path = request.url.split("?")[0];

    if (!PUBLIC_API_PATHS.has(path)) {
      const token = request.cookies["pi-session"];
      if (!token) return reply.status(401).send({ error: "Unauthorized" });

      try {
        app.jwt.verify(token);
      } catch {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    }

    return reply.from(request.url);
  });

  return app;
}
