import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildApp } from "../app.js";
import type { CompanyRepository, UpsertInput } from "../repo/company-repository.js";
import type { LeadsEnv } from "../env.js";

const env: LeadsEnv = {
  NODE_ENV: "test",
  PORT: 4100,
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
  MONGODB_URI: "mongodb://127.0.0.1:27017/leads-test"
};

/** In-memory repository that records every upsert. */
function fakeRepo(): CompanyRepository & { calls: UpsertInput[] } {
  const calls: UpsertInput[] = [];
  return {
    calls,
    async upsertByDomain(input: UpsertInput) {
      calls.push(input);
    },
    async list() {
      return { items: [], total: 0 };
    },
    async getById() {
      return null;
    },
    async updateStatus() {
      return false;
    }
  };
}

/** Build an in-memory .xlsx buffer from an array-of-arrays. */
function xlsxBuffer(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HEADERS = [
  "Root Domain",
  "Company",
  "eCommerce Platform",
  "Sales Revenue",
  "Technology Spend",
  "SKU",
  "Page Rank",
  "Emails",
  "Country",
  "Last Indexed"
];

function validRow(domain: string): unknown[] {
  return [domain, "A", "Shopify", 100000, 2000, 50, 1000, `hi@${domain}`, "NZ", 46300];
}

/** Encode a multipart/form-data body using the standard Web FormData/Response globals. */
async function multipartPayload(
  fields: Record<string, string>,
  file?: { fieldName: string; filename: string; buffer: Buffer }
): Promise<{ body: Buffer; contentType: string }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) {
    form.append(file.fieldName, new Blob([new Uint8Array(file.buffer)]), file.filename);
  }
  const res = new Response(form);
  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type")!;
  return { body, contentType };
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

describe("POST /api/leads/import", () => {
  it("401s without the pi-session cookie", async () => {
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "leads.xlsx",
      buffer: xlsxBuffer([HEADERS, validRow("a.com")])
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(401);
  });

  it("imports valid rows and returns the ImportSummary", async () => {
    const buf = xlsxBuffer([HEADERS, validRow("a.com"), validRow("b.com")]);
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "leads.xlsx",
      buffer: buf
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 2, rejected: 0, scored: 2, byReason: {} });
    expect(repo.calls).toHaveLength(2);
    expect(repo.calls.map((c) => c.domain)).toEqual(["a.com", "b.com"]);
    expect(repo.calls.every((c) => c.status === "scored")).toBe(true);
  });

  it("counts a no-domain row as rejected and does not persist it", async () => {
    const buf = xlsxBuffer([HEADERS, validRow("c.com"), validRow("  ")]);
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "leads.xlsx",
      buffer: buf
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 2, rejected: 1, scored: 1, byReason: { no_domain: 1 } });
  });

  it("returns an empty summary for a header-only workbook", async () => {
    const buf = xlsxBuffer([HEADERS]);
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "empty.xlsx",
      buffer: buf
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 0, rejected: 0, scored: 0, byReason: {} });
  });

  it("400s when no file is uploaded", async () => {
    const { body, contentType } = await multipartPayload({ note: "no file here" });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NO_FILE");
  });

  it("400s on a non-.xlsx filename", async () => {
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "leads.csv",
      buffer: xlsxBuffer([HEADERS, validRow("a.com")])
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_FILE_TYPE");
  });

  it("400s on a malformed .xlsx that fails to parse", async () => {
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "bad.xlsx",
      // A PK zip-signature header followed by junk bytes makes XLSX.read throw
      // (plain text alone gets silently parsed as a single-cell CSV sheet).
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_XLSX");
  });

  it("413s when the file exceeds the upload limit", async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
    const { body, contentType } = await multipartPayload({}, {
      fieldName: "file",
      filename: "huge.xlsx",
      buffer: oversized
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/leads/import",
      cookies: { "pi-session": token },
      headers: { "content-type": contentType },
      payload: body
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("FILE_TOO_LARGE");
  });
});
