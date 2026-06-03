import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import replyFrom from "@fastify/reply-from";

import type { AppEnv } from "./config/env.js";
import authRoutes from "./routes/auth.js";

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

  // Proxy all /api/* to backend
  // Auth enforcement is disabled until login is wired up — enable by
  // uncommenting the session check below and setting AUTH_ENABLED=true.
  app.all("/api/*", async (request, reply) => {
    return reply.from(request.url);
  });

  return app;
}
