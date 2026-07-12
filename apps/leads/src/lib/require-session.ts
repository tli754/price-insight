import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "./app-error.js";

/**
 * preHandler guard for the protected `/api` group. Verifies the shared
 * `pi-session` JWT cookie (issued by the price-insight backend) against the
 * shared `SESSION_SECRET`. Leads never issues the cookie — it only verifies it.
 */
export function requireSession(fastify: FastifyInstance) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.cookies["pi-session"];
    if (!token) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
    }

    try {
      fastify.jwt.verify(token);
    } catch {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired session.");
    }
  };
}
