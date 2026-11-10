import type pg from "pg";
import { acquireClient } from "../../db/connections.js";
import { isUnavailableCode } from "../../db/error-code.js";

type Space = {
  number: number | null;
  category: "RESIDENT" | "CAR" | "MOTOR" | null;
  occupied: boolean;
};

export type OccupancyOutcome =
  | { kind: "found"; spaces: Space[] }
  | { kind: "not-found" | "unavailable" | "internal-error" };

export async function readOccupancy(
  pool: pg.Pool,
  building: string,
): Promise<OccupancyOutcome> {
  let acquired: Awaited<ReturnType<typeof acquireClient>> | undefined;
  try {
    acquired = await acquireClient(pool);
    // The building lookup and all allocation states share one statement snapshot.
    const result = await acquired.client.query<Space>(
      `select s.number, s.category, exists (
          select 1 from sessions x where x.building_code = s.building_code
          and x.space_number = s.number and x.active
        ) as occupied
        from buildings b left join spaces s on s.building_code = b.code
        where b.code = $1 order by s.number`,
      [building],
    );
    if (!result.rows.length) {
      return { kind: "not-found" };
    }
    return {
      kind: "found",
      spaces: result.rows.filter(
        (s) => s.number !== null && s.category !== null,
      ),
    };
  } catch (error) {
    return {
      kind:
        !acquired || acquired.isBroken() || isUnavailableCode(error)
          ? "unavailable"
          : "internal-error",
    };
  } finally {
    acquired?.release();
  }
}

export function occupancyList(spaces: Space[]) {
  return spaces.map((s) => ({
    parkingSpaceId: s.number,
    category: s.category,
    eligibleVehicleTypes:
      s.category === "RESIDENT" ? ["CAR", "MOTOR"] : [s.category],
    isOccupied: s.occupied,
  }));
}

export function availabilityCounts(spaces: Space[]) {
  const counts = { resident: 0, car: 0, motorcycle: 0 };
  for (const space of spaces) {
    if (!space.occupied) {
      if (space.category === "RESIDENT") {
        counts.resident++;
      }
      if (space.category === "CAR") {
        counts.car++;
      }
      if (space.category === "MOTOR") {
        counts.motorcycle++;
      }
    }
  }
  return counts;
}
