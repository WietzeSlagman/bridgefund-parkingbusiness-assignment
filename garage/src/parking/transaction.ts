import type pg from "pg";
import { isUnavailableCode } from "../db/error-code.js";
import {
  transaction as runTransaction,
  TransactionFailure,
} from "../db/transaction.js";
import type { Deadline } from "./helpers/deadline.js";
import { failure, type Result } from "./helpers/http.js";

export type TransactionError = { kind: "unavailable" | "internal-error" };

export async function domainTransaction<T>(
  pool: pg.Pool,
  work: (
    client: pg.PoolClient,
    query: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
  ) => Promise<T>,
  deadline?: Deadline,
): Promise<T | TransactionError> {
  try {
    return await runTransaction(
      pool,
      work,
      deadline && { deadline, initialTimeoutMs: deadline.budgetMs },
    );
  } catch (failureError) {
    if (!(failureError instanceof TransactionFailure)) {
      throw failureError;
    }
    const error = failureError.original;
    const unavailable =
      failureError.committing ||
      failureError.broken ||
      failureError.clientMissing ||
      (error instanceof Error && error.message === "deadline") ||
      isUnavailableCode(error) ||
      (error instanceof Error &&
        error.message === "timeout exceeded when trying to connect");
    return { kind: unavailable ? "unavailable" : "internal-error" };
  }
}

export async function transaction(
  pool: pg.Pool,
  work: (
    client: pg.PoolClient,
    query: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
  ) => Promise<Result>,
  deadline?: Deadline,
): Promise<Result> {
  const result = await domainTransaction(pool, work, deadline);
  if ("kind" in result) {
    return result.kind === "unavailable"
      ? failure(503, "SERVICE_UNAVAILABLE")
      : failure(500, "INTERNAL_ERROR");
  }
  return result;
}
