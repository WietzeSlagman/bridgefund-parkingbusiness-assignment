import express, { type Request, type Response } from "express";
import type pg from "pg";
import {
  availabilityCounts,
  occupancyList,
  readOccupancy,
} from "../services/occupancy.js";

async function respondToOccupancy(
  pool: pg.Pool,
  req: Request<{ building: string }>,
  res: Response,
  availability: boolean,
): Promise<void> {
  res.set("Cache-Control", "no-store");
  const outcome = await readOccupancy(pool, req.params.building);
  if (outcome.kind === "found") {
    res.json(
      availability
        ? availabilityCounts(outcome.spaces)
        : occupancyList(outcome.spaces),
    );
    return;
  }
  const [status, code, message] =
    outcome.kind === "not-found"
      ? ([404, "BUILDING_NOT_FOUND", "Building not found"] as const)
      : outcome.kind === "unavailable"
        ? ([503, "SERVICE_UNAVAILABLE", "Service unavailable"] as const)
        : ([500, "INTERNAL_ERROR", "Internal error"] as const);
  res.status(status).json({ error: { code, message } });
}

export function occupancyRouter(pool: pg.Pool) {
  const router = express.Router();
  // Keep Express's default case-insensitive, non-strict routing semantics.
  router.get(
    "/occupancy/:building/availability",
    async function handleAvailability(req, res) {
      await respondToOccupancy(pool, req, res, true);
    },
  );
  router.get(
    "/occupancy/:building",
    async function handleOccupancyList(req, res) {
      await respondToOccupancy(pool, req, res, false);
    },
  );
  return router;
}
