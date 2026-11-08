import type pg from "pg";

// Take this row lock first in every transaction that changes registry membership,
// request bindings or allocations. It covers even an absent resident row and
// serializes lowest-space selection. Acquire it before gate request or session
// writes; future release paths must use the same order. Building configuration
// updates require all application instances to be stopped.
export async function lockBuilding(
  query: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
  building: string,
) {
  await query("SELECT code FROM buildings WHERE code=$1 FOR UPDATE", [
    building,
  ]);
}
