import { describe, expect, it } from "vitest";
import { parkingPrice } from "../../src/parking/helpers/pricing.js";

const price = (
  start: string,
  end: string,
  category: "RESIDENT" | "CAR" | "MOTOR" = "CAR",
) => parkingPrice(category, new Date(start), new Date(end));

describe("parking pricing", () => {
  it("charges started hours and reports elapsed whole minutes", () => {
    expect(price("2026-01-01T08:00:00Z", "2026-01-01T08:00:00Z")).toEqual({
      cents: 0,
      minutes: 0,
    });
    expect(price("2026-01-01T08:00:00Z", "2026-01-01T09:00:00Z").cents).toBe(
      500,
    );
    expect(price("2026-01-01T08:00:00Z", "2026-01-01T09:00:01Z")).toEqual({
      cents: 1000,
      minutes: 60,
    });
    expect(
      price("2026-01-01T08:00:00Z", "2026-01-01T09:40:00Z", "MOTOR").cents,
    ).toBe(600);
    expect(
      price("2026-01-01T08:00:00Z", "2026-01-01T09:40:00Z", "RESIDENT").cents,
    ).toBe(0);
  });
  it("caps each Amsterdam day and attributes blocks by start", () => {
    expect(price("2026-01-01T00:00:00Z", "2026-01-01T12:00:00Z").cents).toBe(
      3000,
    );
    expect(
      price("2026-01-01T00:00:00Z", "2026-01-01T12:00:00Z", "MOTOR").cents,
    ).toBe(1800);
    expect(price("2026-01-01T22:45:00Z", "2026-01-01T23:45:01Z").cents).toBe(
      1000,
    );
  });
  it("uses elapsed time through DST changes", () => {
    expect(price("2026-03-29T00:30:00Z", "2026-03-29T02:30:00Z").cents).toBe(
      1000,
    );
    expect(price("2026-10-25T00:30:00Z", "2026-10-25T02:30:00Z").cents).toBe(
      1000,
    );
  });
  it("rejects invalid and negative intervals", () => {
    expect(() =>
      price("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"),
    ).toThrow();
    expect(() => price("invalid", "2026-01-01T00:00:00Z")).toThrow();
  });
});
