import { ObjectId, type WithId } from "mongodb";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { CompanyDoc } from "../db/collections.js";
import type {
  CompanyRepository,
  ListQuery,
  ListResult,
  UpsertInput
} from "../repo/company-repository.js";
import type { LeadsEnv } from "../env.js";

const env: LeadsEnv = {
  NODE_ENV: "test",
  PORT: 4100,
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
  MONGODB_URI: "mongodb://127.0.0.1:27017/leads-test"
};

const NOW = new Date("2026-07-12T00:00:00Z");
const ID_A = new ObjectId("64b7f0000000000000000001");
const ID_B = new ObjectId("64b7f0000000000000000002");

function doc(overrides: Partial<WithId<CompanyDoc>> = {}): WithId<CompanyDoc> {
  return {
    _id: ID_A,
    domain: "a.com",
    companyName: "Alpha",
    platform: "shopify",
    country: "NZ",
    vertical: "outdoor",
    status: "scored",
    signals: { hasMarketingAutomation: false, hasCrm: false, hasAi: false },
    contacts: [
      { type: "email", value: "secondary@a.com", isPrimary: false },
      { type: "email", value: "primary@a.com", isPrimary: true },
      { type: "phone", value: "+64 21 000 0000", isPrimary: false }
    ],
    sources: [],
    score: {
      overall: 87,
      components: { value: 0.8, gap: 0.9, reach: 0.7, recency: 0.9 },
      reasons: ["strong revenue", "no CRM detected"],
      weights: { value: 0.4 },
      scoredAt: NOW
    },
    scoreHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

/**
 * In-memory repository. `list` echoes the query it received so the route's
 * parsing/defaulting can be asserted; docs are returned canned.
 */
function fakeRepo(): CompanyRepository & {
  docs: WithId<CompanyDoc>[];
  lastQuery?: ListQuery;
  statusCalls: Array<{ id: string; status: string }>;
} {
  const docs = [
    doc(),
    doc({ _id: ID_B, domain: "b.com", companyName: "Beta", score: undefined, contacts: [] })
  ];
  const statusCalls: Array<{ id: string; status: string }> = [];
  return {
    docs,
    statusCalls,
    async upsertByDomain(_input: UpsertInput) {
      // unused in these tests
    },
    async list(query: ListQuery): Promise<ListResult> {
      this.lastQuery = query;
      return { items: docs, total: docs.length };
    },
    async getById(id: string): Promise<WithId<CompanyDoc> | null> {
      return docs.find((d) => d._id.toString() === id) ?? null;
    },
    async updateStatus(id: string, status): Promise<boolean> {
      statusCalls.push({ id, status });
      return docs.some((d) => d._id.toString() === id);
    }
  };
}

let app: FastifyInstance;
let repo: ReturnType<typeof fakeRepo>;
let token: string;

beforeAll(async () => {
  repo = fakeRepo();
  app = await buildApp(env, { repository: repo });
  await app.ready();
  token = app.jwt.sign({ user: { id: "dev", email: "dev@local", name: "Dev" } });
});

afterAll(async () => {
  await app.close();
});

describe("health", () => {
  it("GET /api/health is unprotected and returns { ok: true }", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("auth guard", () => {
  it("401s without the pi-session cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/api/leads" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("401s with an invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leads",
      cookies: { "pi-session": "not-a-jwt" }
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/leads", () => {
  it("returns mapped list items with defaults (score desc, page 1, size 25)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leads",
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
    expect(repo.lastQuery).toMatchObject({ sort: "score", order: "desc", page: 1, pageSize: 25 });

    const [first, second] = body.items;
    expect(first).toEqual({
      id: ID_A.toString(),
      domain: "a.com",
      companyName: "Alpha",
      platform: "shopify",
      country: "NZ",
      vertical: "outdoor",
      status: "scored",
      scoreOverall: 87,
      reasons: ["strong revenue", "no CRM detected"],
      primaryEmail: "primary@a.com"
    });
    // Unscored doc → scoreOverall null, reasons empty, no email → null.
    expect(second.scoreOverall).toBeNull();
    expect(second.reasons).toEqual([]);
    expect(second.primaryEmail).toBeNull();
  });

  it("parses filters + coerces numeric params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leads?status=scored&platform=shopify&country=NZ&minScore=50&sort=company&order=asc&page=2&pageSize=10",
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(200);
    expect(repo.lastQuery).toEqual({
      status: "scored",
      platform: "shopify",
      country: "NZ",
      minScore: 50,
      sort: "company",
      order: "asc",
      page: 2,
      pageSize: 10
    });
    expect(res.json().pageSize).toBe(10);
  });

  it("400s on pageSize over the max", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leads?pageSize=500",
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("400s on an unknown sort value", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leads?sort=bogus",
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s on a non-numeric minScore", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/leads?minScore=abc",
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/leads/:id", () => {
  it("returns the full document with id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/leads/${ID_A.toString()}`,
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(ID_A.toString());
    expect(body._id).toBeUndefined();
    expect(body.domain).toBe("a.com");
    expect(body.score.overall).toBe(87);
  });

  it("404s when the lead is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/leads/${new ObjectId().toString()}`,
      cookies: { "pi-session": token }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("LEAD_NOT_FOUND");
  });
});

describe("PATCH /api/leads/:id/status", () => {
  it("updates a valid status and echoes { ok, status }", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/leads/${ID_A.toString()}/status`,
      cookies: { "pi-session": token },
      payload: { status: "contacted" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: "contacted" });
    expect(repo.statusCalls).toContainEqual({ id: ID_A.toString(), status: "contacted" });
  });

  it("400s on an invalid status", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/leads/${ID_A.toString()}/status`,
      cookies: { "pi-session": token },
      payload: { status: "not-a-status" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("404s when the lead is missing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/leads/${new ObjectId().toString()}/status`,
      cookies: { "pi-session": token },
      payload: { status: "contacted" }
    });
    expect(res.statusCode).toBe(404);
  });
});
