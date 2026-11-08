import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";
import { testDatabaseConfig } from "../test-database.js";

it("verifies the isolated database and applies migrations idempotently", async () => {
  const client = new pg.Client(
    testDatabaseConfig(process.env.TEST_DATABASE_URL),
  );
  await client.connect();
  try {
    const db = drizzle(client);
    const result = await db.execute(
      sql`select current_database() as name, current_user as username`,
    );
    expect(result.rows[0]).toEqual({
      name: "garage_test",
      username: "garage_test",
    });
    // Both migration passes use the very same verified connection. No reset or
    // cleanup is performed; the database must already be disposable.
    const config = { migrationsFolder: "./migrations" };
    const expected = readMigrationFiles(config).map((m) => ({
      hash: m.hash,
      created_at: String(m.folderMillis),
    }));
    expect(expected.length).toBeGreaterThan(0);
    const bookkeeping = () =>
      client.query(
        "select hash, created_at from drizzle.__drizzle_migrations order by created_at, id",
      );
    await migrate(db, config);
    const first = (await bookkeeping()).rows;
    expect(first).toEqual(expected);
    await migrate(db, config);
    expect((await bookkeeping()).rows).toEqual(first);
  } finally {
    await client.end();
  }
});
