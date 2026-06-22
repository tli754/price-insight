import { afterEach, describe, it, expect } from "vitest";
import { buildTestApp } from "./helpers/build-app.js";

describe("requireSession (protected /api routes)", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>["app"];

  afterEach(async () => {
    await app?.close();
  });

  it("rejects a protected route with no session cookie", async () => {
    ({ app } = await buildTestApp({}, {}, { protectAuth: true }));

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Authentication required." } });
  });

  it("rejects a protected route with an invalid session cookie", async () => {
    ({ app } = await buildTestApp({}, {}, { protectAuth: true }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products",
      cookies: { "pi-session": "not-a-valid-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Invalid or expired session." } });
  });

  it("allows a protected route with a valid session cookie", async () => {
    let validSessionCookie: string;
    ({ app, validSessionCookie } = await buildTestApp({}, {}, { protectAuth: true }));

    const response = await app.inject({
      method: "GET",
      url: "/api/products",
      cookies: { "pi-session": validSessionCookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it("does not protect /auth/session even without a cookie", async () => {
    ({ app } = await buildTestApp({}, {}, { protectAuth: true }));

    const response = await app.inject({ method: "GET", url: "/auth/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ loggedIn: false });
  });

  it("does not protect /api/health even without a cookie", async () => {
    ({ app } = await buildTestApp({}, {}, { protectAuth: true }));

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
  });

  it("leaves protected routes open when protectAuth is not requested (default)", async () => {
    ({ app } = await buildTestApp());

    const response = await app.inject({ method: "GET", url: "/api/products" });

    expect(response.statusCode).toBe(200);
  });
});
