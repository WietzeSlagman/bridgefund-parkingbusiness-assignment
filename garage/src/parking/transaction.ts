import type pg from "pg";
import {
  transaction as runTransaction,
  TransactionFailure,
} from "../db/transaction.js";
import type { Deadline } from "./helpers/deadline.js";
import { failure, type Result } from "./helpers/http.js";

export async function transaction(
  pool: pg.Pool,
  work: (
    client: pg.PoolClient,
    query: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
  ) => Promise<Result>,
  deadline?: Deadline,
): Promise<Result> {
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
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";
    const unavailable =
      failureError.committing ||
      failureError.broken ||
      failureError.clientMissing ||
      (error instanceof Error && error.message === "deadline") ||
      /^(08|53|57|55P03|57014|ECONN|ETIMEDOUT)/.test(code) ||
      (error instanceof Error &&
        error.message === "timeout exceeded when trying to connect");
    return unavailable
      ? failure(503, "SERVICE_UNAVAILABLE")
      : failure(500, "INTERNAL_ERROR");
  }
}
