import { createHash } from "crypto";
import type { FastifyPluginAsync } from "fastify";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const expectedHash = sha256(fastify.env.DEV_AUTH_PASSWORD);

  fastify.post("/auth/login", async (request, reply) => {
    const { password } = request.body as { password: string };

    if (!password || password !== expectedHash) {
      return reply.status(401).send({ error: "Invalid password" });
    }

    const token = fastify.jwt.sign(
      { user: { id: "dev", email: "dev@local", name: "Dev User" } },
      { expiresIn: "7d" }
    );

    reply.setCookie("pi-session", token, {
      path: "/",
      httpOnly: true,
      secure: fastify.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    return { ok: true };
  });

  fastify.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("pi-session", { path: "/" });
    return { ok: true };
  });

  fastify.get("/auth/session", async (request) => {
    const token = request.cookies["pi-session"];
    if (!token) return { loggedIn: false };

    try {
      const payload = fastify.jwt.verify<{ user: { id: string; email: string; name: string } }>(token);
      return { loggedIn: true, user: payload.user };
    } catch {
      return { loggedIn: false };
    }
  });
};

export default authRoutes;
