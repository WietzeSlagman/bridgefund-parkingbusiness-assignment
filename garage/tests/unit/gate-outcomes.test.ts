import { describe, expect, it } from "vitest";
import { checkInResponse } from "../../src/parking/routers/check-in.js";
import { checkOutResponse } from "../../src/parking/routers/check-out.js";
import type { CheckInOutcome } from "../../src/parking/services/check-in.js";
import type { CheckOutOutcome } from "../../src/parking/services/check-out.js";

describe("gate business outcome HTTP mappings", () => {
  it("maps all check-in outcomes", () => {
    expect(
      checkInResponse({
        kind: "allocated",
        sessionId: "session",
        spaceNumber: 51,
      }),
    ).toEqual({
      status: 201,
      body: { parkingSessionId: "session", parkingSpaceId: 51 },
    });
    const cases: [CheckInOutcome, number, string][] = [
      [{ kind: "request-conflict" }, 409, "REQUEST_ID_CONFLICT"],
      [{ kind: "event-closed" }, 409, "EVENT_CLOSED"],
      [{ kind: "resident-not-registered" }, 409, "RESIDENT_NOT_REGISTERED"],
      [{ kind: "active-session-exists" }, 409, "ACTIVE_SESSION_EXISTS"],
      [{ kind: "category-full" }, 409, "CATEGORY_FULL"],
      [{ kind: "unavailable" }, 503, "SERVICE_UNAVAILABLE"],
      [{ kind: "internal-error" }, 500, "INTERNAL_ERROR"],
    ];
    for (const [outcome, status, code] of cases) {
      expect(checkInResponse(outcome)).toEqual({
        status,
        body: { error: { code, message: code.replaceAll("_", " ") } },
      });
    }
  });

  it("maps checkout outcomes without changing details", () => {
    const details = {
      parkingSpaceId: 51,
      sessionLengthInMinutes: 42,
      amountDue: { value: 0, currency: "EUR" as const },
    };
    expect(checkOutResponse({ kind: "authorized", details })).toEqual({
      status: 200,
      body: details,
    });
    const quote = {
      ...details,
      amountDue: { value: 500, currency: "EUR" as const },
    };
    expect(
      checkOutResponse({ kind: "payment-required", details: quote }),
    ).toEqual({ status: 402, body: quote });
    const cases: [CheckOutOutcome, number, string][] = [
      [{ kind: "request-conflict" }, 409, "REQUEST_ID_CONFLICT"],
      [{ kind: "session-not-found" }, 404, "SESSION_NOT_FOUND"],
      [{ kind: "event-closed" }, 409, "EVENT_CLOSED"],
      [{ kind: "checkout-superseded" }, 409, "CHECKOUT_SUPERSEDED"],
      [{ kind: "unavailable" }, 503, "SERVICE_UNAVAILABLE"],
      [{ kind: "internal-error" }, 500, "INTERNAL_ERROR"],
    ];
    for (const [outcome, status, code] of cases) {
      expect(checkOutResponse(outcome)).toEqual({
        status,
        body: { error: { code, message: code.replaceAll("_", " ") } },
      });
    }
  });
});
