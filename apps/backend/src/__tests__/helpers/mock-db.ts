/**
 * Mock database builder for Drizzle ORM fluent API.
 *
 * Drizzle query chains end at different terminal methods depending on operation:
 *   SELECT  → .limit() or .orderBy()
 *   DELETE  → .where()
 *   UPDATE  → .set().where()
 *   INSERT  → .values() (direct await) or .values().$returningId()
 *
 * Strategy: separate sub-mock per operation type so terminals are independent.
 * Use mockResolvedValueOnce() on terminals to control return values per call.
 */

import { vi } from "vitest";

// ── Sub-builders ──────────────────────────────────────────────────────────────

/**
 * .groupBy() is sometimes terminal (awaited directly — product-repository.ts's
 * stats queries) and sometimes chained further with .orderBy()/.limit()/.offset()
 * (order-repository.ts, competitor-repository.ts). Since from/where/leftJoin/
 * innerJoin/groupBy all return the same builder via mockReturnThis(), making the
 * builder itself thenable (default-resolving to []) covers the terminal case
 * without disturbing chains that continue to the real orderBy/limit mocks below.
 */
export function makeSelectBuilder() {
  const resolved = Promise.resolve([]);
  const builder: Record<string, unknown> = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved)
  };
  return builder;
}

/**
 * The values() result must be both:
 *   - awaitable directly (for image inserts)
 *   - chainable with .$returningId() (for product inserts)
 * We achieve this by making it a thenable that also carries $returningId.
 */
function makeInsertValuesResult(returnedId = 1) {
  const resolved = Promise.resolve(undefined);
  const result: Record<string, unknown> = {
    $returningId: vi.fn().mockResolvedValue([{ id: returnedId }]),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved)
  };
  return result;
}

export function makeInsertBuilder(returnedId = 1) {
  return {
    values: vi.fn().mockReturnValue(makeInsertValuesResult(returnedId))
  };
}

export function makeUpdateBuilder() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined)
  };
}

export function makeDeleteBuilder() {
  return {
    where: vi.fn().mockResolvedValue(undefined)
  };
}

// ── Top-level mock db ─────────────────────────────────────────────────────────

export function makeMockDb() {
  const selectBuilder = makeSelectBuilder();
  const updateBuilder = makeUpdateBuilder();
  const deleteBuilder = makeDeleteBuilder();

  const db = {
    select: vi.fn().mockReturnValue(selectBuilder),
    // Each insert() call returns a fresh builder so calls don't share state
    insert: vi.fn().mockImplementation(() => makeInsertBuilder()),
    update: vi.fn().mockReturnValue(updateBuilder),
    delete: vi.fn().mockReturnValue(deleteBuilder),
    transaction: vi.fn().mockImplementation(async (cb: (tx: any) => unknown) => {
      const tx = {
        select: vi.fn().mockReturnValue(makeSelectBuilder()),
        insert: vi.fn().mockImplementation(() => makeInsertBuilder()),
        update: vi.fn().mockReturnValue(makeUpdateBuilder()),
        delete: vi.fn().mockReturnValue(makeDeleteBuilder())
      };
      return cb(tx);
    }),
    // Expose builders for per-test configuration
    _select: selectBuilder,
    _update: updateBuilder,
    _delete: deleteBuilder
  };

  return db;
}

export type MockDb = ReturnType<typeof makeMockDb>;
