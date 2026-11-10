import express, { type Request, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import { createAuthenticator, requireRole, type Identity } from "../auth.js";
import { CHECK_IN_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
import { failure, requireJson, send, type Result } from "../helpers/http.js";
import { parseRequestId } from "../helpers/request-id.js";
import { checkOut, type CheckOutOutcome } from "../services/check-out.js";

export function checkOutResponse(outcome: CheckOutOutcome): Result {
  switch (outcome.kind) {
    case "authorized":
      return { status: 200, body: outcome.details };
    case "payment-required":
      return { status: 402, body: outcome.details };
    case "request-conflict":
      return failure(409, "REQUEST_ID_CONFLICT");
    case "session-not-found":
      return failure(404, "SESSION_NOT_FOUND");
    case "event-closed":
      return failure(409, "EVENT_CLOSED");
    case "checkout-superseded":
      return failure(409, "CHECKOUT_SUPERSEDED");
    case "unavailable":
      return failure(503, "SERVICE_UNAVAILABLE");
    case "internal-error":
      return failure(500, "INTERNAL_ERROR");
  }
}

export const checkOutSchema = z.strictObject({
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
    async function handleCheckOut(req: Request, res: Response) {
      const deadline = res.locals.deadline as Deadline;
      if (deadline.expired()) {
        deadline.cancel();
        send(res, failure(503, "SERVICE_UNAVAILABLE"));
        return;
      }
      const body = checkOutSchema.safeParse(req.body as unknown);
      const id = parseRequestId(req);
      if (!body.success || !id) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const gateId = (res.locals.identity as Identity & { gateId: string })
        .gateId;
      sendWithinDeadline(
        res,
        checkOutResponse(await checkOut(pool, gateId, id, body.data, deadline)),
      );
    },
  );
  return router;
}
