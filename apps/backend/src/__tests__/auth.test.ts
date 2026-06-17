import { createHash } from "crypto";
import { afterEach, describe, it, expect } from "vitest";
import { buildTestApp, fakeEnv } from "./helpers/build-app.js";

function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

const VALID_PASSWORD_HASH = hashPassword(fakeEnv.DEV_AUTH_PASSWORD);

describe("auth routes", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  describe("POST /auth/login", () => {
    it("sets a pi-session cookie on correct password", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { password: VALID_PASSWORD_HASH },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });

      const cookie = response.cookies.find((c) => c.name === "pi-session");
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("Lax");
    });

    it("rejects an incorrect password without setting a cookie", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { password: "wrong-hash" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.cookies.find((c) => c.name === "pi-session")).toBeUndefined();
    });

    it("rejects a missing password", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /auth/session", () => {
    it("returns loggedIn: false when no cookie is present", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({ method: "GET", url: "/auth/session" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ loggedIn: false });
    });

    it("returns loggedIn: true with the session user when the cookie is valid", async () => {
      ({ app } = await buildTestApp());

      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { password: VALID_PASSWORD_HASH },
      });
      const sessionCookie = login.cookies.find((c) => c.name === "pi-session");

      const response = await app.inject({
        method: "GET",
        url: "/auth/session",
        cookies: { "pi-session": sessionCookie!.value },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        loggedIn: true,
        user: { id: "dev", email: "dev@local", name: "Dev User" },
      });
    });

    it("returns loggedIn: false for a tampered cookie value", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({
        method: "GET",
        url: "/auth/session",
        cookies: { "pi-session": "not-a-real-jwt" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ loggedIn: false });
    });
  });

  describe("POST /auth/logout", () => {
    it("clears the pi-session cookie", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({ method: "POST", url: "/auth/logout" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });

      const cookie = response.cookies.find((c) => c.name === "pi-session");
      expect(cookie?.value).toBe("");
    });
  });

  describe("CORS", () => {
    it("reflects the configured APP_URL as Access-Control-Allow-Origin, never *", async () => {
      ({ app } = await buildTestApp());

      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/health",
        headers: {
          origin: fakeEnv.APP_URL,
          "access-control-request-method": "GET",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBe(fakeEnv.APP_URL);
      expect(response.headers["access-control-allow-origin"]).not.toBe("*");
    });
  });
});
