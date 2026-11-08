import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { acquireClient } from "../../src/db/connections.js";
import { createDatabase } from "../../src/db/index.js";
import { loadParkingConfig } from "../../src/parking/config.js";
import { initializeParking } from "../../src/parking/initialize.js";
import { testDatabaseConfig } from "../test-database.js";

const url = process.env.TEST_DATABASE_URL;
const safe = testDatabaseConfig(url);
const control = new pg.Pool(safe);
const config = loadParkingConfig({
  PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
  PARKING_KEYS:
    '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
});

beforeAll(async () => {
  const client = await control.connect();
  try {
    expect(
      (
        await client.query(
          "select current_database() as name, current_user as username",
        )
      ).rows[0],
    ).toEqual({ name: "garage_test", username: "garage_test" });
    await migrate(drizzle(client), { migrationsFolder: "./migrations" });
  } finally {
    client.release();
  }
  await initializeParking(control, config);
});
afterAll(async () => {
  await control.end();
});

async function waitForLock(pid: number) {
  for (let i = 0; i < 80; i++) {
    const result = await control.query<{ waiting: boolean }>(
      "select exists (select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') as waiting",
      [pid],
    );
    if (result.rows[0].waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Test backend did not enter lock wait");
}

it("survives termination of a pooled idle connection and reconnects", async () => {
  const { pool } = createDatabase(url!);
  const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const result = await pool.query<{ pid: number }>(
      "select pg_backend_pid() as pid",
    );
    const failed = new Promise<void>((resolve) =>
      pool.once("error", () => resolve()),
    );
    expect(
      (
        await control.query<{ killed: boolean }>(
          "select pg_terminate_backend($1) as killed",
          [result.rows[0].pid],
        )
      ).rows[0].killed,
    ).toBe(true);
    await failed;
    expect(logger).toHaveBeenCalledWith("An idle database connection failed");
    expect((await pool.query("select 1 as value")).rows[0]).toEqual({
      value: 1,
    });
  } finally {
    logger.mockRestore();
    await pool.end();
  }
});

it("discards a terminated checked-out idle client", async () => {
  const { pool } = createDatabase(url!);
  try {
    const lease = await acquireClient(pool);
    const pid = (
      await lease.client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      )
    ).rows[0].pid;
    const failed = new Promise<void>((resolve) =>
      lease.client.once("error", () => resolve()),
    );
    await control.query("select pg_terminate_backend($1)", [pid]);
    await failed;
    expect(lease.isBroken()).toBe(true);
    lease.release();
    expect(
      (await pool.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0].pid,
    ).not.toBe(pid);
  } finally {
    await pool.end();
  }
});

it("survives termination during a check-in and recovers using the same ID", async () => {
  const { pool } = createDatabase(url!);
  const held = await control.connect();
  const p = randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase();
  const id = randomUUID();
  try {
    const pid = (
      await pool.query<{ pid: number }>("select pg_backend_pid() as pid")
    ).rows[0].pid;
    await held.query("begin");
    await held.query("select code from buildings where code=$1 for update", [
      "PB-AMS-2M8D",
    ]);
    const attempt = request(createApp({ pool, config }))
      .post("/check-in")
      .set("Authorization", "Bearer a")
      .set("X-Request-Id", id)
      .send({ vehicleType: "CAR", isResident: false, licensePlate: p })
      .then((r) => r);
    await waitForLock(pid);
    await control.query("select pg_terminate_backend($1)", [pid]);
    const failed = await attempt;
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).not.toContain("terminating connection");
    await held.query("rollback");
    const retry = await request(createApp({ pool, config }))
      .post("/check-in")
      .set("Authorization", "Bearer a")
      .set("X-Request-Id", id)
      .send({ vehicleType: "CAR", isResident: false, licensePlate: p });
    expect(retry.status).toBe(201);
    expect(
      (
        await control.query(
          "select 1 from sessions where plate=$1 and active",
          [p],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await held.query("rollback");
    held.release();
    await control.query(
      "delete from gate_requests where gate_id=$1 and request_id=$2",
      ["entrance-1", id],
    );
    await control.query("delete from sessions where plate=$1", [p]);
    await pool.end();
  }
});

it("survives a connection interruption during startup initialization", async () => {
  const { pool } = createDatabase(url!);
  const held = await control.connect();
  try {
    const pid = (
      await pool.query<{ pid: number }>("select pg_backend_pid() as pid")
    ).rows[0].pid;
    await held.query("begin");
    await held.query("select pg_advisory_xact_lock(132974523, 3)");
    const attempt = initializeParking(pool, config).then(
      () => "success",
      () => "failure",
    );
    await waitForLock(pid);
    await control.query("select pg_terminate_backend($1)", [pid]);
    expect(await attempt).toBe("failure");
    await held.query("rollback");
    await expect(initializeParking(pool, config)).resolves.toBeUndefined();
  } finally {
    await held.query("rollback");
    held.release();
    await pool.end();
  }
});
