import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import type pg from "pg";
import { z } from "zod";
import { CHECK_IN_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
import { failure, send } from "../helpers/http.js";
import { recordPayment } from "../services/payments.js";

export const payloadSchema = z.strictObject({
  paymentId: z
    .string()
    .min(1)
    .max(255)
    .refine((id) =>
      [...id].every((character) => {
        const code = character.codePointAt(0)!;
        return code > 31 && (code < 127 || code > 159);
      }),
    ),
  parkingSessionId: z.uuid().transform((id) => id.toLowerCase()),
  amount: z.strictObject({
    value: z.number().int().min(1).max(2147483647),
    currency: z.literal("EUR"),
  }),
  status: z.enum(["PAID", "FAILED"]),
});

export function paymentsRouter(pool: pg.Pool, secret: string) {
  const router = express.Router();
  const raw = express.raw({
    type: "application/json",
    limit: "16kb",
    inflate: false,
  });
  router.post(
    "/webhooks/payments",
    httpDeadline(CHECK_IN_BUDGET_MS),
    (req, res, next) => {
      if (
        !/^application\/json(?:\s*;|\s*$)/i.test(req.get("content-type") ?? "")
      ) {
        send(res, failure(415, "UNSUPPORTED_MEDIA_TYPE"));
        return;
      }
      raw(req, res, (error) => {
        if (error) {
          send(res, failure(400, "INVALID_REQUEST"));
          return;
        }
        next();
      });
    },
    async function handlePayment(req, res) {
      const signatures = req.rawHeaders.filter(
        (_, i) =>
          i % 2 === 0 && req.rawHeaders[i].toLowerCase() === "x-signature",
      ).length;
      const signature = req.get("x-signature") ?? "";
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (
        signatures !== 1 ||
        !/^[0-9a-f]{64}$/.test(signature) ||
        !timingSafeEqual(
          Buffer.from(signature, "hex"),
          createHmac("sha256", secret).update(bytes).digest(),
        )
      ) {
        send(res, failure(401, "UNAUTHORIZED"));
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) as unknown;
      } catch {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const parsed = payloadSchema.safeParse(json);
      if (!parsed.success) {
        send(res, failure(400, "INVALID_REQUEST"));
        return;
      }
      const result = await recordPayment(
        pool,
        parsed.data,
        res.locals.deadline as Deadline,
      );
      const response =
        result.kind === "accepted"
          ? { status: 204 }
          : result.kind === "session-not-found"
            ? failure(404, "SESSION_NOT_FOUND")
            : result.kind === "payment-id-conflict"
              ? failure(409, "PAYMENT_ID_CONFLICT")
              : result.kind === "session-closed"
                ? failure(409, "PAYMENT_SESSION_CLOSED")
                : result.kind === "amount-mismatch"
                  ? failure(409, "PAYMENT_AMOUNT_MISMATCH")
                  : result.kind === "unavailable"
                    ? failure(503, "SERVICE_UNAVAILABLE")
                    : failure(500, "INTERNAL_ERROR");
      sendWithinDeadline(res, response);
    },
  );
  return router;
}
