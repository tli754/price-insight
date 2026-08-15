import type postgres from "postgres";

/**
 * Thin wrapper around Postgres/Supabase's pgmq extension (already installed —
 * see docs/decisions/0002-pgmq-order-sync-competitor-queue-migration.md).
 * Replaces CloudTasksOrderSyncClient/CloudTasksCompetitorClient: no push
 * target, no OIDC token construction — just DB calls over the same
 * `postgres` client `db/index.ts` already creates.
 *
 * One-message-at-a-time by design (qty=1 on read) — every queue consumer in
 * this codebase processes exactly one order/one pingback per call, so a
 * larger batch size would only add complexity with no throughput win at this
 * volume (see ADR 0002, "Alternatives considered").
 */
export type PgmqMessage<T> = {
  msgId: number;
  readCt: number;
  message: T;
};

export class PgmqClient {
  constructor(private readonly sql: postgres.Sql) {}

  async send(queueName: string, message: unknown): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- message is an app-defined payload shape (SyncOrderPayload | CompetitorTaskPayload), always JSON-serializable in practice; postgres.js's JSONValue type is stricter than worth threading through every call site.
    await this.sql`select pgmq.send(${queueName}, ${this.sql.json(message as any)})`;
  }

  async read<T>(queueName: string, visibilitySeconds: number): Promise<PgmqMessage<T> | null> {
    const rows = await this.sql<{ msg_id: string; read_ct: number; message: T }[]>`
      select msg_id, read_ct, message from pgmq.read(${queueName}, ${visibilitySeconds}, 1)
    `;
    const row = rows[0];
    if (!row) return null;
    return { msgId: Number(row.msg_id), readCt: row.read_ct, message: row.message };
  }

  async delete(queueName: string, msgId: number): Promise<void> {
    await this.sql`select pgmq.delete(${queueName}, ${msgId}::bigint)`;
  }

  async archive(queueName: string, msgId: number): Promise<void> {
    await this.sql`select pgmq.archive(${queueName}, ${msgId}::bigint)`;
  }
}
