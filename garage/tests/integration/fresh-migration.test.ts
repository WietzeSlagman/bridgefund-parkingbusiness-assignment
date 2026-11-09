import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { expect, it } from "vitest";
import { loadParkingConfig } from "../../src/parking/config.js";
import { initializeParking } from "../../src/parking/initialize.js";
import { testDatabaseConfig } from "../test-database.js";

it("migrates and seeds a freshly created isolated database, then repeats safely", async () => {
  const base = testDatabaseConfig(process.env.TEST_DATABASE_URL);
  const admin = new pg.Client(base);
  const name = `garage_fresh_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  await admin.connect();
  try {
    const identity = await admin.query(
      "select current_database() as name, current_user as username",
    );
    expect(identity.rows[0]).toEqual({
      name: "garage_test",
      username: "garage_test",
    });
    // The generated identifier contains only fixed ASCII letters, digits and underscores.
    await admin.query(`create database "${name}"`);
    created = true;
    const pool = new pg.Pool({ ...base, database: name });
    try {
      const client = await pool.connect();
      try {
        const target = await client.query(
          "select current_database() as name, current_user as username",
        );
        expect(target.rows[0]).toEqual({ name, username: "garage_test" });
        await migrate(drizzle(client), { migrationsFolder: "./migrations" });
        await migrate(drizzle(client), { migrationsFolder: "./migrations" });
        const columns = await client.query(
          `select table_name, column_name from information_schema.columns
           where table_schema = 'public' and table_name in
             ('checkout_payments', 'checkout_requests', 'checkout_quotes')
           order by table_name, column_name`,
        );
        expect(columns.rows).toEqual(
          Object.entries({
            checkout_payments: [
              "amount",
              "confirmed_at",
              "payment_id",
              "session_id",
            ],
            checkout_requests: [
              "gate_id",
              "is_resident",
              "paid_at_quote",
              "quoted_amount",
              "request_id",
              "response",
              "session_id",
            ],
          }).flatMap(([table_name, names]) =>
            names.map((column_name) => ({ table_name, column_name })),
          ),
        );
      } finally {
        client.release();
      }
      const config = loadParkingConfig({
        PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
        PARKING_KEYS:
          '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
      });
      await initializeParking(pool, config);
      await initializeParking(pool, config);
      expect((await pool.query("select 1 from spaces")).rowCount).toBe(150);
      const layout = await pool.query(
        "select number, floor, category from spaces where building_code=$1 order by number",
        ["PB-AMS-2M8D"],
      );
      expect(layout.rows).toEqual(
        Array.from({ length: 150 }, (_, index) => {
          const number = index + 1;
          return {
            number,
            floor: number <= 75 ? 1 : 2,
            category:
              number <= 50 ? "RESIDENT" : number <= 130 ? "CAR" : "MOTOR",
          };
        }),
      );
    } finally {
      await pool.end();
    }
  } finally {
    if (created) {
      await admin.query(`drop database "${name}"`);
    }
    await admin.end();
  }
}, 15000);
