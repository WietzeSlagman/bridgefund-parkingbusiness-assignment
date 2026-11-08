import express from "express";
import type pg from "pg";
import type { ParkingConfig } from "../config.js";
import { RESIDENT_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
import { failure, requireJson, send } from "../helpers/http.js";
import {
  plateSchema,
  residentBodyShape,
  residentQuerySchema,
} from "../helpers/schemas.js";
import {
  listResidents,
  registerResident,
  removeResident,
} from "../services/residents.js";

export function residentRouter(pool: pg.Pool, config: ParkingConfig) {
  const router = express.Router();
  const validBuilding = (value: unknown): value is string =>
    typeof value === "string" && Object.hasOwn(config.buildings, value);
  router.post(
    "/",
    httpDeadline(RESIDENT_BUDGET_MS),
    requireJson,
    async (req, res) => {
      const parsed = residentBodyShape.safeParse(req.body as unknown);
      if (!parsed.success) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const body = parsed.data;
      if (!validBuilding(body.buildingCode)) {
        send(res, failure(400, "INVALID_BUILDING"));
        return;
      }
      const plate = plateSchema.safeParse(body.licensePlate);
      if (!plate.success) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      sendWithinDeadline(
        res,
        await registerResident(
          pool,
          body.buildingCode,
          plate.data,
          config.buildings[body.buildingCode],
          res.locals.deadline as Deadline,
        ),
      );
    },
  );
  router.get("/", httpDeadline(RESIDENT_BUDGET_MS), async (req, res) => {
    const building = req.query.buildingCode;
    if (!validBuilding(building)) {
      send(res, failure(400, "INVALID_BUILDING"));
      return;
    }
    if (!residentQuerySchema.safeParse(req.query).success) {
      send(res, failure(400, "INVALID_REQUEST"));
      return;
    }
    res.set("Cache-Control", "no-store");
    sendWithinDeadline(
      res,
      await listResidents(pool, building, res.locals.deadline as Deadline),
    );
  });
  router.delete(
    "/:plate",
    httpDeadline(RESIDENT_BUDGET_MS),
    async (req, res) => {
      const building = req.query.buildingCode;
      if (!validBuilding(building)) {
        send(res, failure(400, "INVALID_BUILDING"));
        return;
      }
      const plate = plateSchema.safeParse(req.params.plate);
      if (!plate.success || !residentQuerySchema.safeParse(req.query).success) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      sendWithinDeadline(
        res,
        await removeResident(
          pool,
          building,
          plate.data,
          res.locals.deadline as Deadline,
        ),
      );
    },
  );
  return router;
}
