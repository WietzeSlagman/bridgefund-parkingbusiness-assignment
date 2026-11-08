import express, { type ErrorRequestHandler, type Express } from "express";

export const errorHandler: ErrorRequestHandler = (_err, _req, res, next) => {
  if (res.headersSent) {
    return next(_err);
  }
  res.status(500).json({ error: "Internal server error" });
};

// No global body parser: a future webhook can install express.raw() before
// any JSON parser, retaining the exact signed bytes.
export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
