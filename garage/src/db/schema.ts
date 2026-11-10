import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const buildings = pgTable(
  "buildings",
  {
    code: text().primaryKey(),
    registrationLimit: integer("registration_limit").notNull(),
  },
  (t) => [
    check("building_limit_nonnegative", sql`${t.registrationLimit} >= 0`),
  ],
);

export const spaces = pgTable(
  "spaces",
  {
    buildingCode: text("building_code")
      .notNull()
      .references(() => buildings.code),
    number: integer().notNull(),
    floor: integer().notNull(),
    category: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.buildingCode, t.number] }),
    check("space_category", sql`${t.category} in ('RESIDENT','CAR','MOTOR')`),
  ],
);

export const residents = pgTable(
  "residents",
  {
    buildingCode: text("building_code")
      .notNull()
      .references(() => buildings.code),
    plate: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.buildingCode, t.plate] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey(),
    buildingCode: text("building_code").notNull(),
    spaceNumber: integer("space_number").notNull(),
    plate: text().notNull(),
    vehicleType: text("vehicle_type").notNull(),
    category: text().notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    active: boolean().notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.buildingCode, t.spaceNumber],
      foreignColumns: [spaces.buildingCode, spaces.number],
    }),
    uniqueIndex("active_session_plate")
      .on(t.buildingCode, t.plate)
      .where(sql`${t.active}`),
    uniqueIndex("active_session_space")
      .on(t.buildingCode, t.spaceNumber)
      .where(sql`${t.active}`),
    check("session_vehicle", sql`${t.vehicleType} in ('CAR','MOTOR')`),
    check("session_category", sql`${t.category} in ('RESIDENT','CAR','MOTOR')`),
  ],
);

export const gateRequests = pgTable(
  "gate_requests",
  {
    gateId: text("gate_id").notNull(),
    requestId: uuid("request_id").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    isResident: boolean("is_resident").notNull(),
    plate: text().notNull(),
    sessionId: uuid("session_id").references(() => sessions.id),
  },
  (t) => [primaryKey({ columns: [t.gateId, t.requestId] })],
);

// Checkout bindings deliberately do not reference sessions: an unknown session
// must still bind its request identity and be eligible for later reevaluation.
export const checkoutRequests = pgTable(
  "checkout_requests",
  {
    gateId: text("gate_id").notNull(),
    requestId: uuid("request_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    isResident: boolean("is_resident").notNull(),
    quotedAmount: integer("quoted_amount"),
    paidAtQuote: integer("paid_at_quote"),
    response: jsonb(),
    superseded: boolean().notNull().default(false),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.gateId, t.requestId] }),
    uniqueIndex("checkout_current_session")
      .on(t.sessionId)
      .where(sql`${t.isCurrent}`),
    check(
      "checkout_current_valid",
      sql`not ${t.isCurrent} or (${t.quotedAmount} is not null and ${t.quotedAmount} > 0 and ${t.paidAtQuote} is not null and ${t.paidAtQuote} >= 0 and not ${t.superseded} and ${t.response} is null)`,
    ),
  ],
);

// Only authenticated successful PB-05 confirmations are persisted here.
export const checkoutPayments = pgTable(
  "checkout_payments",
  {
    paymentId: text("payment_id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    amount: integer().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  },
  (t) => [check("checkout_payment_positive", sql`${t.amount} > 0`)],
);
