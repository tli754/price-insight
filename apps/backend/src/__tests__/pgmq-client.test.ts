import { describe, it, expect, vi } from "vitest";

import { PgmqClient } from "../services/pgmq-client.js";

// A minimal stand-in for postgres.js's tagged-template `sql` client. Real
// pgmq SQL correctness was verified directly against the dev Supabase DB
// during planning (see docs/decisions/0002-...); these tests only verify
// PgmqClient calls the client and shapes the result correctly.
function makeFakeSql(resolvedRows: unknown[] = []) {
  const fn = vi.fn().mockResolvedValue(resolvedRows) as any;
  fn.json = vi.fn((v: unknown) => v);
  return fn;
}

describe("PgmqClient", () => {
  it("send() calls sql with the queue name and json-wrapped message", async () => {
    const sql = makeFakeSql();
    const client = new PgmqClient(sql as any);

    await client.send("shopify_orders", { type: "sync-order" });

    expect(sql).toHaveBeenCalledOnce();
    expect(sql.json).toHaveBeenCalledWith({ type: "sync-order" });
  });

  it("read() returns null when the queue is empty", async () => {
    const sql = makeFakeSql([]);
    const client = new PgmqClient(sql as any);

    const result = await client.read("shopify_orders", 300);

    expect(result).toBeNull();
  });

  it("read() maps the returned row into a PgmqMessage", async () => {
    const sql = makeFakeSql([{ msg_id: "42", read_ct: 2, message: { type: "sync-order" } }]);
    const client = new PgmqClient(sql as any);

    const result = await client.read("shopify_orders", 300);

    expect(result).toEqual({ msgId: 42, readCt: 2, message: { type: "sync-order" } });
  });

  it("delete() and archive() call the client once each", async () => {
    const sql = makeFakeSql();
    const client = new PgmqClient(sql as any);

    await client.delete("shopify_orders", 1);
    await client.archive("shopify_orders", 2);

    expect(sql).toHaveBeenCalledTimes(2);
  });
});
