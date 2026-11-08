import express, { type Request, type Response } from "express";
import type pg from "pg";
import { createAuthenticator, requireRole, type Identity } from "../auth.js";
import { parseCheckInRequest } from "../helpers/check-in-request.js";
import { CHECK_IN_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
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
    httpDeadline(CHECK_IN_BUDGET_MS),
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
      sendWithinDeadline(res, result);
    },
  );
  return router;
}
