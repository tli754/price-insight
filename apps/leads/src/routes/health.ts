import type { FastifyPluginAsync } from "fastify";

/** Unprotected liveness probe. */
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async () => {
    return { ok: true };
  });
};

export default healthRoutes;
