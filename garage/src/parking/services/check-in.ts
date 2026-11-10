import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { CheckInRequest } from "../helpers/check-in-request.js";
import type { Deadline } from "../helpers/deadline.js";
import { PILOT } from "../pilot.js";
import { domainTransaction, type TransactionError } from "../transaction.js";
import { lockBuilding } from "./building-lock.js";

export type CheckInOutcome =
  | { kind: "allocated"; sessionId: string; spaceNumber: number }
  | {
      kind:
        | "request-conflict"
        | "event-closed"
        | "resident-not-registered"
        | "active-session-exists"
        | "category-full";
    }
  | TransactionError;

export function checkIn(
  pool: pg.Pool,
  gateId: string,
  id: string,
  body: CheckInRequest,
  deadline: Deadline,
): Promise<CheckInOutcome> {
  return domainTransaction<Exclude<CheckInOutcome, TransactionError>>(
    pool,
    async (_client, q) => {
      await lockBuilding(q, PILOT.code);
      await q(
        "INSERT INTO gate_requests (gate_id,request_id,vehicle_type,is_resident,plate) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [gateId, id, body.vehicleType, body.isResident, body.licensePlate],
      );
      const records = await q(
        "SELECT * FROM gate_requests WHERE gate_id=$1 AND request_id=$2",
        [gateId, id],
      );
      const record = records.rows[0] as {
        vehicle_type: string;
        is_resident: boolean;
        plate: string;
        session_id: string | null;
      };
      if (
        record.vehicle_type !== body.vehicleType ||
        record.is_resident !== body.isResident ||
        record.plate !== body.licensePlate
      ) {
        return { kind: "request-conflict" };
      }
      if (record.session_id) {
        const existing = await q(
          "SELECT active, space_number FROM sessions WHERE id=$1",
          [record.session_id],
        );
        const session = existing.rows[0] as {
          active: boolean;
          space_number: number;
        };
        return session.active
          ? {
              kind: "allocated",
              sessionId: record.session_id,
              spaceNumber: session.space_number,
            }
          : { kind: "event-closed" };
      }
      const resident =
        (
          await q(
            "SELECT 1 FROM residents WHERE building_code=$1 AND plate=$2",
            [PILOT.code, body.licensePlate],
          )
        ).rowCount !== 0;
      if (!resident && body.isResident) {
        return { kind: "resident-not-registered" };
      }
      if (
        (
          await q(
            "SELECT 1 FROM sessions WHERE building_code=$1 AND plate=$2 AND active",
            [PILOT.code, body.licensePlate],
          )
        ).rowCount
      ) {
        return { kind: "active-session-exists" };
      }
      const category = resident ? "RESIDENT" : body.vehicleType;
      const available = await q(
        "SELECT number FROM spaces s WHERE building_code=$1 AND category=$2 AND NOT EXISTS (SELECT 1 FROM sessions p WHERE p.building_code=s.building_code AND p.space_number=s.number AND p.active) ORDER BY number LIMIT 1",
        [PILOT.code, category],
      );
      if (!available.rowCount) {
        return { kind: "category-full" };
      }
      const number = (available.rows[0] as { number: number }).number;
      const sessionId = randomUUID();
      await q(
        "INSERT INTO sessions (id,building_code,space_number,plate,vehicle_type,category) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          sessionId,
          PILOT.code,
          number,
          body.licensePlate,
          body.vehicleType,
          category,
        ],
      );
      await q(
        "UPDATE gate_requests SET session_id=$3 WHERE gate_id=$1 AND request_id=$2",
        [gateId, id, sessionId],
      );
      return {
        kind: "allocated",
        sessionId,
        spaceNumber: number,
      };
    },
    deadline,
  );
}
