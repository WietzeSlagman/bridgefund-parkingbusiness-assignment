import type pg from "pg";
import { domainTransaction } from "../transaction.js";
import { lockBuilding } from "./building-lock.js";
import type { Deadline } from "../helpers/deadline.js";

export function registerResident(
  pool: pg.Pool,
  building: string,
  plate: string,
  limit: number,
  deadline: Deadline,
) {
  return domainTransaction(
    pool,
    async (_client, q) => {
      await lockBuilding(q, building);
      if (
        (
          await q(
            "SELECT 1 FROM residents WHERE building_code=$1 AND plate=$2",
            [building, plate],
          )
        ).rowCount
      ) {
        return { kind: "already-registered" } as const;
      }
      const count = await q(
        "SELECT count(*)::int AS count FROM residents WHERE building_code=$1",
        [building],
      );
      if ((count.rows[0] as { count: number }).count >= limit) {
        return { kind: "registry-full" } as const;
      }
      await q("INSERT INTO residents VALUES ($1,$2)", [building, plate]);
      return {
        kind: "registered" as const,
        buildingCode: building,
        licensePlate: plate,
      };
    },
    deadline,
  );
}

export function listResidents(
  pool: pg.Pool,
  building: string,
  deadline: Deadline,
) {
  return domainTransaction(
    pool,
    async (_client, q) => {
      const records = await q(
        'SELECT plate FROM residents WHERE building_code=$1 ORDER BY plate COLLATE "C"',
        [building],
      );
      return {
        kind: "listed" as const,
        buildingCode: building,
        licensePlates: records.rows.map((row: { plate: string }) => row.plate),
      };
    },
    deadline,
  );
}

export function removeResident(
  pool: pg.Pool,
  building: string,
  plate: string,
  deadline: Deadline,
) {
  return domainTransaction(
    pool,
    async (_client, q) => {
      await lockBuilding(q, building);
      if (
        !(
          await q(
            "SELECT 1 FROM residents WHERE building_code=$1 AND plate=$2",
            [building, plate],
          )
        ).rowCount
      ) {
        return { kind: "not-found" } as const;
      }
      if (
        (
          await q(
            "SELECT 1 FROM sessions WHERE building_code=$1 AND plate=$2 AND active AND category='RESIDENT'",
            [building, plate],
          )
        ).rowCount
      ) {
        return { kind: "active-session" } as const;
      }
      await q("DELETE FROM residents WHERE building_code=$1 AND plate=$2", [
        building,
        plate,
      ]);
      return { kind: "removed" } as const;
    },
    deadline,
  );
}
