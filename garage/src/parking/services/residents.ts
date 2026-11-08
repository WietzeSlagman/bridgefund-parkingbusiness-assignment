import type pg from "pg";
import { failure } from "../helpers/http.js";
import { transaction } from "../transaction.js";
import { lockBuilding } from "./building-lock.js";

export function registerResident(
  pool: pg.Pool,
  building: string,
  plate: string,
  limit: number,
) {
  return transaction(pool, async (_client, q) => {
    await lockBuilding(q, building);
    if (
      (
        await q("SELECT 1 FROM residents WHERE building_code=$1 AND plate=$2", [
          building,
          plate,
        ])
      ).rowCount
    ) {
      return failure(409, "RESIDENT_ALREADY_REGISTERED");
    }
    const count = await q(
      "SELECT count(*)::int AS count FROM residents WHERE building_code=$1",
      [building],
    );
    if ((count.rows[0] as { count: number }).count >= limit) {
      return failure(409, "REGISTRY_FULL");
    }
    await q("INSERT INTO residents VALUES ($1,$2)", [building, plate]);
    return {
      status: 201,
      body: { buildingCode: building, licensePlate: plate },
    };
  });
}

export function listResidents(pool: pg.Pool, building: string) {
  return transaction(pool, async (_client, q) => {
    const records = await q(
      'SELECT plate FROM residents WHERE building_code=$1 ORDER BY plate COLLATE "C"',
      [building],
    );
    return {
      status: 200,
      body: {
        buildingCode: building,
        licensePlates: records.rows.map((row: { plate: string }) => row.plate),
      },
    };
  });
}

export function removeResident(pool: pg.Pool, building: string, plate: string) {
  return transaction(pool, async (_client, q) => {
    await lockBuilding(q, building);
    if (
      !(
        await q("SELECT 1 FROM residents WHERE building_code=$1 AND plate=$2", [
          building,
          plate,
        ])
      ).rowCount
    ) {
      return failure(404, "RESIDENT_NOT_FOUND");
    }
    if (
      (
        await q(
          "SELECT 1 FROM sessions WHERE building_code=$1 AND plate=$2 AND active AND category='RESIDENT'",
          [building, plate],
        )
      ).rowCount
    ) {
      return failure(409, "RESIDENT_HAS_ACTIVE_SESSION");
    }
    await q("DELETE FROM residents WHERE building_code=$1 AND plate=$2", [
      building,
      plate,
    ]);
    return { status: 204 };
  });
}
