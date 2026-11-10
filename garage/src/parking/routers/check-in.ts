import express, { type Request, type Response } from "express";
import type pg from "pg";
import { createAuthenticator, requireRole, type Identity } from "../auth.js";
import { parseCheckInRequest } from "../helpers/check-in-request.js";
import { CHECK_IN_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
import { failure, requireJson, send, type Result } from "../helpers/http.js";
import { parseRequestId } from "../helpers/request-id.js";
import { checkIn, type CheckInOutcome } from "../services/check-in.js";

export function checkInResponse(outcome: CheckInOutcome): Result {
  switch (outcome.kind) {
    case "allocated":
      return {
        status: 201,
        body: {
          parkingSessionId: outcome.sessionId,
          parkingSpaceId: outcome.spaceNumber,
        },
      };
    case "request-conflict":
      return failure(409, "REQUEST_ID_CONFLICT");
    case "event-closed":
      return failure(409, "EVENT_CLOSED");
    case "resident-not-registered":
      return failure(409, "RESIDENT_NOT_REGISTERED");
    case "active-session-exists":
      return failure(409, "ACTIVE_SESSION_EXISTS");
    case "category-full":
      return failure(409, "CATEGORY_FULL");
    case "unavailable":
      return failure(503, "SERVICE_UNAVAILABLE");
    case "internal-error":
      return failure(500, "INTERNAL_ERROR");
  }
}

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
    async function handleCheckIn(req: Request, res: Response) {
      const deadline = res.locals.deadline as Deadline;
      if (deadline.expired()) {
        deadline.cancel();
        send(res, failure(503, "SERVICE_UNAVAILABLE"));
        return;
      }
      const body = parseCheckInRequest(req.body as unknown);
      const id = parseRequestId(req);
      if (!body || !id) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const gateId = (res.locals.identity as Identity & { gateId: string })
        .gateId;
      const result = await checkIn(pool, gateId, id, body, deadline);
      sendWithinDeadline(res, checkInResponse(result));
    },
  );
  return router;
}
