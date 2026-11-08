import type pg from "pg";
import { acquireClient } from "../db/connections.js";
import type { ParkingConfig } from "./config.js";
import { PILOT } from "./pilot.js";

/** Serialize first setup. Existing authoritative configuration is never overwritten. */
export async function initializeParking(
  pool: pg.Pool,
  config: ParkingConfig,
): Promise<void> {
  const lease = await acquireClient(pool);
  const { client } = lease;
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(132974523, 3)");
    const existing = await client.query<{
      code: string;
      registration_limit: number;
    }>("SELECT code, registration_limit FROM buildings ORDER BY code");
    const expected = Object.entries(config.buildings).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (existing.rowCount === 0) {
      for (const [code, limit] of expected) {
        await client.query("INSERT INTO buildings VALUES ($1,$2)", [
          code,
          limit,
        ]);
      }
      for (const range of PILOT.spaces) {
        await client.query(
          `INSERT INTO spaces (building_code, number, floor, category)
           SELECT $1, n, $2, $3 FROM generate_series($4::integer, $5::integer) AS n`,
          [PILOT.code, range.floor, range.category, range.first, range.last],
        );
      }
    } else if (
      existing.rows.length !== expected.length ||
      existing.rows.some(
        (row) => config.buildings[row.code] !== row.registration_limit,
      )
    ) {
      throw new Error("Building configuration does not match database");
    }
    await client.query("COMMIT");
  } catch (error) {
    if (!lease.isBroken()) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw error;
  } finally {
    lease.release(discard);
  }
}

/** Operator-only operation: all application instances must be stopped first. */
export async function updateBuildings(
  pool: pg.Pool,
  config: ParkingConfig,
): Promise<void> {
  const lease = await acquireClient(pool);
  const { client } = lease;
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(132974523, 3)");
    const existing = await client.query<{ code: string }>(
      "SELECT code FROM buildings FOR UPDATE",
    );
    if (!existing.rows.some(({ code }) => code === PILOT.code)) {
      throw new Error("Initialize the pilot first");
    }
    for (const { code } of existing.rows) {
      if (!Object.hasOwn(config.buildings, code)) {
        throw new Error("Cannot remove a building");
      }
    }
    for (const [code, limit] of Object.entries(config.buildings)) {
      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM residents WHERE building_code=$1",
        [code],
      );
      if (count.rows[0].count > limit) {
        throw new Error("Registration limit below existing registrations");
      }
      await client.query(
        "INSERT INTO buildings (code,registration_limit) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET registration_limit=EXCLUDED.registration_limit",
        [code, limit],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    if (!lease.isBroken()) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw error;
  } finally {
    lease.release(discard);
  }
}
