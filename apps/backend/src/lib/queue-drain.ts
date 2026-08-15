import type { FastifyBaseLogger } from "fastify";

import type { PgmqClient } from "../services/pgmq-client.js";

export type DrainResult = { processed: number; failed: number; archived: number };

/**
 * Reads a pgmq queue one message at a time until empty. On failure, the
 * message is left in the queue (not deleted) so it's retried on the next
 * drain — no in-run retry/backoff. One message's failure doesn't abort the
 * rest of the batch. Once a message's read_ct crosses archiveAfterReadCount,
 * it's moved to the queue's (already-existing) pgmq archive table instead of
 * being retried forever. Failure details go to the logger only — nothing is
 * written onto the archived row. See ADR 0002 for the full rationale.
 */
export async function drainQueue<T>(opts: {
  pgmq: PgmqClient;
  queueName: string;
  visibilitySeconds: number;
  archiveAfterReadCount: number;
  processMessage: (message: T) => Promise<void>;
  logger: FastifyBaseLogger;
}): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, failed: 0, archived: 0 };

  while (true) {
    const msg = await opts.pgmq.read<T>(opts.queueName, opts.visibilitySeconds);
    if (!msg) break;

    try {
      await opts.processMessage(msg.message);
      await opts.pgmq.delete(opts.queueName, msg.msgId);
      result.processed++;
    } catch (err) {
      result.failed++;
      opts.logger.error(
        { queue: opts.queueName, msgId: msg.msgId, readCt: msg.readCt, err },
        "queue-drain: message processing failed"
      );
      if (msg.readCt >= opts.archiveAfterReadCount) {
        await opts.pgmq.archive(opts.queueName, msg.msgId);
        result.archived++;
      }
    }
  }

  return result;
}
