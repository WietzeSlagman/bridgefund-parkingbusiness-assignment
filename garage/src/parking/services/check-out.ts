import type pg from "pg";
import type { Deadline } from "../helpers/deadline.js";
import { parkingPrice } from "../helpers/pricing.js";
import { PILOT } from "../pilot.js";
import { domainTransaction, type TransactionError } from "../transaction.js";
import { lockBuilding } from "./building-lock.js";

export type CheckoutBody = { parkingSessionId: string; isResident: boolean };
// The successful payload remains stored unchanged for exact replay.
export type CheckoutDetails = {
  parkingSpaceId: number;
  sessionLengthInMinutes: number;
  amountDue: { value: number; currency: "EUR" };
};
export type CheckOutOutcome =
  | { kind: "authorized"; details: CheckoutDetails }
  | { kind: "payment-required"; details: CheckoutDetails }
  | {
      kind:
        | "request-conflict"
        | "session-not-found"
        | "event-closed"
        | "checkout-superseded";
    }
  | TransactionError;

export function checkOut(
  pool: pg.Pool,
  gateId: string,
  id: string,
  body: CheckoutBody,
  deadline: Deadline,
  clock: () => Date = () => new Date(),
): Promise<CheckOutOutcome> {
  return domainTransaction<Exclude<CheckOutOutcome, TransactionError>>(
    pool,
    async (_client, q) => {
      await lockBuilding(q, PILOT.code);
      await q(
        "INSERT INTO checkout_requests (gate_id,request_id,session_id,is_resident) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [gateId, id, body.parkingSessionId, body.isResident],
      );
      const binding = (
        await q(
          "SELECT * FROM checkout_requests WHERE gate_id=$1 AND request_id=$2",
          [gateId, id],
        )
      ).rows[0] as {
        session_id: string;
        is_resident: boolean;
        quoted_amount: number | null;
        paid_at_quote: number | null;
        response: CheckoutDetails | null;
        superseded: boolean;
      };
      if (
        binding.session_id !== body.parkingSessionId.toLowerCase() ||
        binding.is_resident !== body.isResident
      ) {
        return { kind: "request-conflict" };
      }
      if (binding.response) {
        return { kind: "authorized", details: binding.response };
      }
      const session = (
        await q("SELECT * FROM sessions WHERE id=$1 AND building_code=$2", [
          body.parkingSessionId,
          PILOT.code,
        ])
      ).rows[0] as
        | {
            active: boolean;
            space_number: number;
            category: "RESIDENT" | "CAR" | "MOTOR";
            checked_in_at: Date;
          }
        | undefined;
      if (!session) {
        return { kind: "session-not-found" };
      }
      if (!session.active) {
        return { kind: "event-closed" };
      }
      if (binding.superseded) {
        return { kind: "checkout-superseded" };
      }
      const now = clock();
      const price = parkingPrice(session.category, session.checked_in_at, now);
      const payments = (
        await q(
          "SELECT amount, confirmed_at FROM checkout_payments WHERE session_id=$1",
          [body.parkingSessionId],
        )
      ).rows as { amount: number; confirmed_at: Date }[];
      const paid = payments.reduce((sum, p) => sum + p.amount, 0);
      const inGrace = payments.some(
        (p) =>
          now.getTime() >= p.confirmed_at.getTime() &&
          now.getTime() < p.confirmed_at.getTime() + 15 * 60_000,
      );
      const covered =
        binding.paid_at_quote !== null && paid > binding.paid_at_quote;
      let amount = Math.max(0, price.cents - paid);
      if (!inGrace && binding.quoted_amount !== null && !covered) {
        amount = binding.quoted_amount;
      }
      if (inGrace || amount === 0) {
        const response: CheckoutDetails = {
          parkingSpaceId: session.space_number,
          sessionLengthInMinutes: price.minutes,
          amountDue: { value: 0, currency: "EUR" },
        };
        await q(
          "UPDATE checkout_requests SET is_current=false WHERE session_id=$1 AND is_current",
          [body.parkingSessionId],
        );
        await q("UPDATE sessions SET active=false WHERE id=$1 AND active", [
          body.parkingSessionId,
        ]);
        await q(
          "UPDATE checkout_requests SET response=$3::jsonb WHERE gate_id=$1 AND request_id=$2",
          [gateId, id, JSON.stringify(response)],
        );
        return { kind: "authorized", details: response };
      }
      if (binding.quoted_amount === null || covered) {
        await q(
          "UPDATE checkout_requests SET superseded=true, is_current=false WHERE session_id=$1 AND quoted_amount IS NOT NULL AND (gate_id,request_id) <> ($2,$3)",
          [body.parkingSessionId, gateId, id],
        );
        await q(
          "UPDATE checkout_requests SET quoted_amount=$3, paid_at_quote=$4, is_current=true WHERE gate_id=$1 AND request_id=$2",
          [gateId, id, amount, paid],
        );
      }
      return {
        kind: "payment-required",
        details: {
          parkingSpaceId: session.space_number,
          sessionLengthInMinutes: price.minutes,
          amountDue: { value: amount, currency: "EUR" },
        },
      };
    },
    deadline,
  );
}
