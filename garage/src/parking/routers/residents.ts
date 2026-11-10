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

type ResidentOutcome = Awaited<
  | ReturnType<typeof registerResident>
  | ReturnType<typeof listResidents>
  | ReturnType<typeof removeResident>
>;
function residentResponse(outcome: ResidentOutcome) {
  switch (outcome.kind) {
    case "registered":
      return {
        status: 201,
        body: {
          buildingCode: outcome.buildingCode,
          licensePlate: outcome.licensePlate,
        },
      };
    case "listed":
      return {
        status: 200,
        body: {
          buildingCode: outcome.buildingCode,
          licensePlates: outcome.licensePlates,
        },
      };
    case "removed":
      return { status: 204 };
    case "already-registered":
      return failure(409, "RESIDENT_ALREADY_REGISTERED");
    case "registry-full":
      return failure(409, "REGISTRY_FULL");
    case "not-found":
      return failure(404, "RESIDENT_NOT_FOUND");
    case "active-session":
      return failure(409, "RESIDENT_HAS_ACTIVE_SESSION");
    case "unavailable":
      return failure(503, "SERVICE_UNAVAILABLE");
    case "internal-error":
      return failure(500, "INTERNAL_ERROR");
  }
}

export function residentRouter(pool: pg.Pool, config: ParkingConfig) {
  const router = express.Router();
  const validBuilding = (value: unknown): value is string =>
    typeof value === "string" && Object.hasOwn(config.buildings, value);
  router.post(
    "/",
    httpDeadline(RESIDENT_BUDGET_MS),
    requireJson,
    async function handleRegisterResident(req, res) {
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
        residentResponse(
          await registerResident(
            pool,
            body.buildingCode,
            plate.data,
            config.buildings[body.buildingCode],
            res.locals.deadline as Deadline,
          ),
        ),
      );
    },
  );
  router.get(
    "/",
    httpDeadline(RESIDENT_BUDGET_MS),
    async function handleListResidents(req, res) {
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
        residentResponse(
          await listResidents(pool, building, res.locals.deadline as Deadline),
        ),
      );
    },
  );
  router.delete(
    "/:plate",
    httpDeadline(RESIDENT_BUDGET_MS),
    async function handleRemoveResident(req, res) {
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
        residentResponse(
          await removeResident(
            pool,
            building,
            plate.data,
            res.locals.deadline as Deadline,
          ),
        ),
      );
    },
  );
  return router;
}
