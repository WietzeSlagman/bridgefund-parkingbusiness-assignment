import { EventEmitter } from "node:events";
import type pg from "pg";
import { expect, it, vi } from "vitest";
import { transaction, TransactionFailure } from "../../src/db/transaction.js";
import { transaction as parkingTransaction } from "../../src/parking/transaction.js";

function fixture(failSql?: string, error = new Error("unexpected")) {
  const query = vi.fn((sql: string) =>
    sql === failSql ? Promise.reject(error) : Promise.resolve({ rows: [] }),
  );
  const release = vi.fn();
  const client = Object.assign(new EventEmitter(), { query, release });
  const pool = Object.assign(new EventEmitter(), {
    connect: () => Promise.resolve(client),
  }) as unknown as pg.Pool;
  return { pool, query, release };
}

it("returns arbitrary committed values without HTTP coupling", async () => {
  const { pool, query, release } = fixture();
  expect(await transaction(pool, () => Promise.resolve(42))).toBe(42);
  expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
  expect(release).toHaveBeenCalledExactlyOnceWith(false);
});

it("rolls back work failures and leaves HTTP classification to the caller", async () => {
  const { pool, query, release } = fixture();
  const error = new Error("unexpected");
  await expect(
    transaction(pool, () => Promise.reject(error)),
  ).rejects.toMatchObject({
    original: error,
    committing: false,
    clientMissing: false,
  });
  expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
  expect(release).toHaveBeenCalledExactlyOnceWith(false);
});

it("discards an uncertain commit without attempting rollback", async () => {
  const { pool, query, release } = fixture("COMMIT");
  const failure = await transaction(pool, () => Promise.resolve("value")).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(TransactionFailure);
  expect(failure).toMatchObject({ committing: true, clientMissing: true });
  expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
});

it("maps ordinary failures to 500 and uncertain commits to 503", async () => {
  const ordinary = fixture();
  const uncertain = fixture("COMMIT");
  expect(
    await parkingTransaction(ordinary.pool, () =>
      Promise.reject(new Error("unexpected")),
    ),
  ).toMatchObject({ status: 500 });
  expect(
    await parkingTransaction(uncertain.pool, () =>
      Promise.resolve({ status: 201 }),
    ),
  ).toMatchObject({ status: 503 });
});
