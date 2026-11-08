import express, { type Response } from "express";

export type Result = { status: number; body?: unknown };
export const failure = (status: number, code: string): Result => ({
  status,
  body: { error: { code, message: code.replaceAll("_", " ") } },
});
export const send = (res: Response, result: Result) =>
  res.headersSent || res.destroyed
    ? undefined
    : result.body === undefined
      ? res.status(result.status).end()
      : res.status(result.status).json(result.body);

const json = express.json({ strict: true, limit: "16kb" });
export const requireJson: express.RequestHandler = (req, res, next) => {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.get("content-type") ?? "")) {
    send(res, failure(415, "UNSUPPORTED_MEDIA_TYPE"));
    return;
  }
  json(req, res, (error) => {
    if (error) {
      send(res, failure(400, "INVALID_REQUEST"));
      return;
    }
    next();
  });
};
