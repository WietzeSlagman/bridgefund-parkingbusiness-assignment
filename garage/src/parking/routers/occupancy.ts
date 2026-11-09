import express from "express";
import type pg from "pg";
import { acquireClient } from "../../db/connections.js";

type Space = {
  number: number | null;
  category: "RESIDENT" | "CAR" | "MOTOR" | null;
  occupied: boolean;
};

export function occupancyRouter(pool: pg.Pool) {
  const router = express.Router();
  router.get(
    ["/occupancy/:building", "/occupancy/:building/availability"],
    async (req, res) => {
      res.set("Cache-Control", "no-store");
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
          [req.params.building],
        );
        if (!result.rows.length) {
          res.status(404).json({
            error: {
              code: "BUILDING_NOT_FOUND",
              message: "Building not found",
            },
          });
          return;
        }
        const spaces = result.rows.filter(
          (s) => s.number !== null && s.category !== null,
        );
        if (/^\/occupancy\/[^/]+\/availability\/?$/i.test(req.path)) {
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
          res.json(counts);
        } else {
          res.json(
            spaces.map((s) => ({
              parkingSpaceId: s.number,
              category: s.category,
              eligibleVehicleTypes:
                s.category === "RESIDENT" ? ["CAR", "MOTOR"] : [s.category],
              isOccupied: s.occupied,
            })),
          );
        }
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "";
        const unavailable =
          !acquired ||
          acquired.isBroken() ||
          /^(08|53|57|55P03|57014|ECONN|ETIMEDOUT)/.test(code);
        res.status(unavailable ? 503 : 500).json({
          error: unavailable
            ? { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" }
            : { code: "INTERNAL_ERROR", message: "Internal error" },
        });
      } finally {
        acquired?.release();
      }
    },
  );
  return router;
}
