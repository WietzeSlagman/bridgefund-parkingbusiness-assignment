import express from "express";
import type pg from "pg";
import { watchPool } from "../../db/connections.js";
import { createAuthenticator, requireRole } from "../auth.js";
import { checkInRouter } from "./check-in.js";
import { checkOutRouter } from "./check-out.js";
import type { ParkingConfig } from "../config.js";
import { residentRouter } from "./residents.js";

export function parkingRouter(pool: pg.Pool, config: ParkingConfig) {
  watchPool(pool);
  const router = express.Router();
  const auth = createAuthenticator(config.credentials);
  // Authenticate before Express decodes the resident path parameter.
  router.use("/admin/residents", requireRole(auth, "admin"));
  router.use("/admin/residents", residentRouter(pool, config));
  router.use(checkInRouter(pool, auth));
  router.use(checkOutRouter(pool, auth));
  return router;
}
