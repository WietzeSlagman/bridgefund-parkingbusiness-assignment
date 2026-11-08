import express, { type ErrorRequestHandler, type Express } from "express";
import type pg from "pg";
import type { ParkingConfig } from "./parking/config.js";
import { parkingRouter } from "./parking/routers/router.js";

export const errorHandler: ErrorRequestHandler = (_err, _req, res, next) => {
  if (res.headersSent) {
    return next(_err);
  }
  if (
    _err instanceof URIError &&
    _req.method === "DELETE" &&
    _req.path.startsWith("/admin/residents/")
  ) {
    res
      .status(400)
      .json({ error: { code: "INVALID_REQUEST", message: "INVALID REQUEST" } });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
};

// No global body parser: a future webhook can install express.raw() before
// any JSON parser, retaining the exact signed bytes.
export function createApp(parking?: {
  pool: pg.Pool;
  config: ParkingConfig;
}): Express {
  const app = express();
  app.disable("x-powered-by");
  if (parking) {
    app.use(parkingRouter(parking.pool, parking.config));
  }
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
