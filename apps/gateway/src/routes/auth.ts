import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../config/env.js";

export default async function authRoutes(app: FastifyInstance, opts: { env: AppEnv }) {
  app.post("/auth/login", async (request, reply) => {
    const { password } = request.body as { password: string };

    if (!password || password !== opts.env.DEV_AUTH_PASSWORD) {
      return reply.status(401).send({ error: "Invalid password" });
    }

    const token = app.jwt.sign(
      { user: { id: "dev", email: "dev@local", name: "Dev User" } },
      { expiresIn: "7d" }
    );

    reply.setCookie("pi-session", token, {
      path: "/",
      httpOnly: true,
      secure: opts.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    return { ok: true };
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie("pi-session", { path: "/" });
    return { ok: true };
  });

  app.get("/auth/session", async (request) => {
    const token = request.cookies["pi-session"];
    if (!token) return { loggedIn: false };

    try {
      const payload = app.jwt.verify<{ user: { id: string; email: string; name: string } }>(token);
      return { loggedIn: true, user: payload.user };
    } catch {
      return { loggedIn: false };
    }
  });
}
