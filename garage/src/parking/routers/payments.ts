import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import type pg from "pg";
import { z } from "zod";
import { CHECK_IN_BUDGET_MS, type Deadline } from "../helpers/deadline.js";
import { httpDeadline, sendWithinDeadline } from "../helpers/deadline-http.js";
import { failure, send } from "../helpers/http.js";
import { transaction } from "../transaction.js";
import { lockBuilding } from "../services/building-lock.js";
import { PILOT } from "../pilot.js";

const payloadSchema = z.strictObject({
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

function diagnostic(reason: string, sessionId: string, paymentId: string) {
  // The opaque provider ID may contain sensitive data; log only a digest.
  const paymentIdHash = createHash("sha256").update(paymentId).digest("hex");
  // eslint-disable-next-line no-console -- structured, sanitized operator diagnostic
  console.error(
    JSON.stringify({
      event: "payment_notification",
      reason,
      sessionId,
      paymentIdHash,
    }),
  );
}

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
    async (req, res) => {
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
      const p = parsed.data;
      const result = await transaction(
        pool,
        async (_client, q) => {
          await lockBuilding(q, PILOT.code);
          if (p.status === "PAID") {
            const existing = (
              await q(
                "SELECT session_id, amount FROM checkout_payments WHERE payment_id=$1",
                [p.paymentId],
              )
            ).rows[0] as { session_id: string; amount: number } | undefined;
            if (existing) {
              if (
                existing.session_id === p.parkingSessionId &&
                existing.amount === p.amount.value
              ) {
                return { status: 204 };
              }
              diagnostic(
                "PAYMENT_ID_CONFLICT",
                p.parkingSessionId,
                p.paymentId,
              );
              return failure(409, "PAYMENT_ID_CONFLICT");
            }
          }
          const session = (
            await q(
              "SELECT active FROM sessions WHERE id=$1 AND building_code=$2",
              [p.parkingSessionId, PILOT.code],
            )
          ).rows[0] as { active: boolean } | undefined;
          if (!session) {
            if (p.status === "PAID") {
              diagnostic("SESSION_NOT_FOUND", p.parkingSessionId, p.paymentId);
            }
            return failure(404, "SESSION_NOT_FOUND");
          }
          if (p.status === "FAILED") {
            diagnostic("PAYMENT_FAILED", p.parkingSessionId, p.paymentId);
            return { status: 204 };
          }
          if (!session.active) {
            diagnostic(
              "PAYMENT_SESSION_CLOSED",
              p.parkingSessionId,
              p.paymentId,
            );
            return failure(409, "PAYMENT_SESSION_CLOSED");
          }
          const current = (
            await q(
              "SELECT quoted_amount FROM checkout_requests WHERE session_id=$1 AND is_current",
              [p.parkingSessionId],
            )
          ).rows[0] as { quoted_amount: number } | undefined;
          if (current?.quoted_amount !== p.amount.value) {
            diagnostic(
              "PAYMENT_AMOUNT_MISMATCH",
              p.parkingSessionId,
              p.paymentId,
            );
            return failure(409, "PAYMENT_AMOUNT_MISMATCH");
          }
          await q(
            "INSERT INTO checkout_payments(payment_id,session_id,amount,confirmed_at) VALUES ($1,$2,$3,clock_timestamp())",
            [p.paymentId, p.parkingSessionId, p.amount.value],
          );
          await q(
            "UPDATE checkout_requests SET is_current=false WHERE session_id=$1 AND is_current",
            [p.parkingSessionId],
          );
          return { status: 204 };
        },
        res.locals.deadline as Deadline,
      );
      sendWithinDeadline(res, result);
    },
  );
  return router;
}
