import { describe, it, expect, vi } from "vitest";

import { drainQueue } from "../lib/queue-drain.js";

function makeFakePgmq(reads: Array<{ msgId: number; readCt: number; message: unknown } | null>) {
  const readMock = vi.fn();
  reads.forEach((r) => readMock.mockResolvedValueOnce(r));
  return {
    read: readMock,
    delete: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
  };
}

const logger = { error: vi.fn() } as any;

describe("drainQueue", () => {
  it("returns all-zero counts on an empty queue, no processMessage calls", async () => {
    const pgmq = makeFakePgmq([null]);
    const processMessage = vi.fn();

    const result = await drainQueue({
      pgmq: pgmq as any,
      queueName: "q",
      visibilitySeconds: 300,
      archiveAfterReadCount: 5,
      processMessage,
      logger,
    });

    expect(result).toEqual({ processed: 0, failed: 0, archived: 0 });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it("processes and deletes a message on success", async () => {
    const pgmq = makeFakePgmq([{ msgId: 1, readCt: 1, message: "hello" }, null]);
    const processMessage = vi.fn().mockResolvedValue(undefined);

    const result = await drainQueue({ pgmq: pgmq as any, queueName: "q", visibilitySeconds: 300, archiveAfterReadCount: 5, processMessage, logger });

    expect(result).toEqual({ processed: 1, failed: 0, archived: 0 });
    expect(processMessage).toHaveBeenCalledWith("hello");
    expect(pgmq.delete).toHaveBeenCalledWith("q", 1);
  });

  it("loops one-by-one until the queue is empty", async () => {
    const pgmq = makeFakePgmq([
      { msgId: 1, readCt: 1, message: "a" },
      { msgId: 2, readCt: 1, message: "b" },
      { msgId: 3, readCt: 1, message: "c" },
      null,
    ]);
    const processMessage = vi.fn().mockResolvedValue(undefined);

    const result = await drainQueue({ pgmq: pgmq as any, queueName: "q", visibilitySeconds: 300, archiveAfterReadCount: 5, processMessage, logger });

    expect(result.processed).toBe(3);
    expect(pgmq.read).toHaveBeenCalledTimes(4);
  });

  it("leaves a failed message in the queue (no delete, no archive) below the threshold", async () => {
    const pgmq = makeFakePgmq([{ msgId: 1, readCt: 2, message: "bad" }, null]);
    const processMessage = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await drainQueue({ pgmq: pgmq as any, queueName: "q", visibilitySeconds: 300, archiveAfterReadCount: 5, processMessage, logger });

    expect(result).toEqual({ processed: 0, failed: 1, archived: 0 });
    expect(pgmq.delete).not.toHaveBeenCalled();
    expect(pgmq.archive).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("archives a failed message once read_ct reaches the threshold", async () => {
    const pgmq = makeFakePgmq([{ msgId: 1, readCt: 5, message: "bad" }, null]);
    const processMessage = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await drainQueue({ pgmq: pgmq as any, queueName: "q", visibilitySeconds: 300, archiveAfterReadCount: 5, processMessage, logger });

    expect(result).toEqual({ processed: 0, failed: 1, archived: 1 });
    expect(pgmq.archive).toHaveBeenCalledWith("q", 1);
  });

  it("one message's failure doesn't stop the rest of the batch", async () => {
    const pgmq = makeFakePgmq([
      { msgId: 1, readCt: 1, message: "bad" },
      { msgId: 2, readCt: 1, message: "good" },
      null,
    ]);
    const processMessage = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const result = await drainQueue({ pgmq: pgmq as any, queueName: "q", visibilitySeconds: 300, archiveAfterReadCount: 5, processMessage, logger });

    expect(result).toEqual({ processed: 1, failed: 1, archived: 0 });
  });
});
