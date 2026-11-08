import type pg from "pg";
import { acquireClient } from "./connections.js";

export interface TransactionDeadline {
  remaining(): number;
  expired(): boolean;
  onCancel(listener: () => void): () => void;
}

export class TransactionFailure extends Error {
  constructor(
    readonly original: unknown,
    readonly committing: boolean,
    readonly broken: boolean,
    readonly clientMissing: boolean,
  ) {
    super("Transaction failed");
  }
}

export async function transaction<T>(
  pool: pg.Pool,
  work: (
    client: pg.PoolClient,
    query: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
  ) => Promise<T>,
  options?: { deadline: TransactionDeadline; initialTimeoutMs: number },
): Promise<T> {
  const deadline = options?.deadline;
  let client: pg.PoolClient | undefined;
  let lease: Awaited<ReturnType<typeof acquireClient>> | undefined;
  let committing = false;
  let removeCancellation: (() => void) | undefined;
  try {
    lease = await acquireClient(pool);
    client = lease.client;
    const acquired = client;
    removeCancellation = deadline?.onCancel(() => {
      if (client === acquired) {
        client = undefined;
        lease?.release(true);
      }
    });
    if (!client || deadline?.expired()) {
      throw new Error("deadline");
    }
    const query = async (sql: string, values?: unknown[]) => {
      if (deadline) {
        const remaining = deadline.remaining();
        if (remaining <= 0) {
          throw new Error("deadline");
        }
        await client!.query(
          "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)",
          [`${remaining}ms`],
        );
      }
      if (!client || lease?.isBroken() || deadline?.expired()) {
        throw new Error("deadline");
      }
      return client.query(sql, values);
    };
    // Bound idle transactions even if the client is lost immediately after BEGIN.
    await client.query(
      deadline
        ? `BEGIN; SET LOCAL idle_in_transaction_session_timeout = '${options.initialTimeoutMs}ms'; SET LOCAL statement_timeout = '${options.initialTimeoutMs}ms'; SET LOCAL lock_timeout = '${options.initialTimeoutMs}ms'`
        : "BEGIN",
    );
    const result = await work(client, query);
    if (!client || lease.isBroken() || deadline?.expired()) {
      throw new Error("deadline");
    }
    committing = true;
    await client.query("COMMIT");
    if (lease.isBroken() || deadline?.expired()) {
      throw new Error("deadline");
    }
    return result;
  } catch (error) {
    if (client && !committing && !lease?.isBroken()) {
      const rollbackClient = client;
      try {
        await rollbackClient.query("ROLLBACK");
      } catch {
        if (client === rollbackClient) {
          client = undefined;
          lease?.release(true);
        }
      }
    } else if (client && committing) {
      lease?.release(true);
      client = undefined;
    }
    throw new TransactionFailure(
      error,
      committing,
      lease?.isBroken() === true,
      !client,
    );
  } finally {
    removeCancellation?.();
    lease?.release();
  }
}
