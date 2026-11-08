import express, { type Request, type Response } from "express";
import type pg from "pg";
import { createAuthenticator, requireRole, type Identity } from "../auth.js";
import { parseCheckInRequest } from "../helpers/check-in-request.js";
import { Deadline } from "../helpers/deadline.js";
import { failure, requireJson, send } from "../helpers/http.js";
import { requestIdSchema } from "../helpers/schemas.js";
import { checkIn } from "../services/check-in.js";

export function checkInRouter(
  pool: pg.Pool,
  auth: ReturnType<typeof createAuthenticator>,
) {
  const router = express.Router();
  router.post(
    "/check-in",
    (req, res, next) => {
      const deadline = new Deadline();
      res.locals.deadline = deadline;
      const timer = setTimeout(() => {
        deadline.cancel();
        send(res, failure(503, "SERVICE_UNAVAILABLE"));
        req.resume();
      }, deadline.remaining());
      res.once("finish", () => clearTimeout(timer));
      res.once("close", () => {
        clearTimeout(timer);
        if (!res.writableFinished) {
          deadline.cancel();
        }
      });
      next();
    },
    requireRole(auth, "entrance"),
    requireJson,
    async (req: Request, res: Response) => {
      const deadline = res.locals.deadline as Deadline;
      if (deadline.expired()) {
        deadline.cancel();
        send(res, failure(503, "SERVICE_UNAVAILABLE"));
        return;
      }
      const body = parseCheckInRequest(req.body as unknown);
      const id = req.get("x-request-id");
      const idCount = req.rawHeaders.filter(
        (_, i) =>
          i % 2 === 0 && req.rawHeaders[i].toLowerCase() === "x-request-id",
      ).length;
      if (
        !body ||
        idCount !== 1 ||
        !id ||
        !requestIdSchema.safeParse(id).success
      ) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const gateId = (res.locals.identity as Identity & { gateId: string })
        .gateId;
      const result = await checkIn(pool, gateId, id, body, deadline);
      if (deadline.expired()) {
        deadline.cancel();
        send(res, failure(503, "SERVICE_UNAVAILABLE"));
      } else {
        send(res, result);
      }
    },
  );
  return router;
}
