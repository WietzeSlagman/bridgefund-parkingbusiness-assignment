import express, { type Request, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { createAuthenticator, requireRole, type Identity } from "../auth.js";
import { CHECK_IN_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
import { failure, requireJson, send } from "../helpers/http.js";
import { requestIdSchema } from "../helpers/schemas.js";
import { checkOut } from "../services/check-out.js";

const schema = z.strictObject({
  parkingSessionId: z.uuid(),
  isResident: z.boolean(),
});

export function checkOutRouter(
  pool: pg.Pool,
  auth: ReturnType<typeof createAuthenticator>,
) {
  const router = express.Router();
  router.post(
    "/check-out",
    httpDeadline(CHECK_IN_BUDGET_MS),
    requireRole(auth, "exit"),
    requireJson,
    async (req: Request, res: Response) => {
      const deadline = res.locals.deadline as Deadline;
      if (deadline.expired()) {
        deadline.cancel();
        send(res, failure(503, "SERVICE_UNAVAILABLE"));
        return;
      }
      const body = schema.safeParse(req.body as unknown);
      const id = req.get("x-request-id");
      const count = req.rawHeaders.filter(
        (_, i) =>
          i % 2 === 0 && req.rawHeaders[i].toLowerCase() === "x-request-id",
      ).length;
      if (
        !body.success ||
        count !== 1 ||
        !id ||
        !requestIdSchema.safeParse(id).success
      ) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const gateId = (res.locals.identity as Identity & { gateId: string })
        .gateId;
      sendWithinDeadline(
        res,
        await checkOut(pool, gateId, id, body.data, deadline),
      );
    },
  );
  return router;
}
