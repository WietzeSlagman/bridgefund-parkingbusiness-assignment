import { createHash } from "node:crypto";
import type pg from "pg";
import type { Deadline } from "../helpers/deadline.js";
import { PILOT } from "../pilot.js";
import { domainTransaction } from "../transaction.js";
import { lockBuilding } from "./building-lock.js";

export type Payment = {
  paymentId: string;
  parkingSessionId: string;
  amount: { value: number; currency: "EUR" };
  status: "PAID" | "FAILED";
};

function diagnostic(reason: string, sessionId: string, paymentId: string) {
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

export function recordPayment(pool: pg.Pool, p: Payment, deadline: Deadline) {
  return domainTransaction(
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
            return { kind: "accepted" } as const;
          }
          diagnostic("PAYMENT_ID_CONFLICT", p.parkingSessionId, p.paymentId);
          return { kind: "payment-id-conflict" } as const;
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
        return { kind: "session-not-found" } as const;
      }
      if (p.status === "FAILED") {
        diagnostic("PAYMENT_FAILED", p.parkingSessionId, p.paymentId);
        return { kind: "accepted" } as const;
      }
      if (!session.active) {
        diagnostic("PAYMENT_SESSION_CLOSED", p.parkingSessionId, p.paymentId);
        return { kind: "session-closed" } as const;
      }
      const current = (
        await q(
          "SELECT quoted_amount FROM checkout_requests WHERE session_id=$1 AND is_current",
          [p.parkingSessionId],
        )
      ).rows[0] as { quoted_amount: number } | undefined;
      if (current?.quoted_amount !== p.amount.value) {
        diagnostic("PAYMENT_AMOUNT_MISMATCH", p.parkingSessionId, p.paymentId);
        return { kind: "amount-mismatch" } as const;
      }
      await q(
        "INSERT INTO checkout_payments(payment_id,session_id,amount,confirmed_at) VALUES ($1,$2,$3,clock_timestamp())",
        [p.paymentId, p.parkingSessionId, p.amount.value],
      );
      await q(
        "UPDATE checkout_requests SET is_current=false WHERE session_id=$1 AND is_current",
        [p.parkingSessionId],
      );
      return { kind: "accepted" } as const;
    },
    deadline,
  );
}
