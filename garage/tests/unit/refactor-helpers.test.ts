import { describe, expect, it } from "vitest";
import { isUnavailableCode } from "../../src/db/error-code.js";
import {
  availabilityCounts,
  occupancyList,
} from "../../src/parking/services/occupancy.js";

describe("database error codes", () => {
  it.each(["08006", "53300", "57014", "55P03", "ECONNRESET", "ETIMEDOUT"])(
    "recognizes %s",
    (code) => {
      expect(isUnavailableCode({ code })).toBe(true);
    },
  );
  it.each([null, "08006", {}, { code: 42 }, { code: "23505" }])(
    "does not classify %j as unavailable",
    (error) => {
      expect(isUnavailableCode(error)).toBe(false);
    },
  );
});

it("maps recorded spaces without mixing resident and visitor availability", () => {
  const spaces = [
    { number: 1, category: "RESIDENT" as const, occupied: false },
    { number: 51, category: "CAR" as const, occupied: true },
    { number: 131, category: "MOTOR" as const, occupied: false },
  ];
  expect(availabilityCounts(spaces)).toEqual({
    resident: 1,
    car: 0,
    motorcycle: 1,
  });
  expect(occupancyList(spaces)).toEqual([
    {
      parkingSpaceId: 1,
      category: "RESIDENT",
      eligibleVehicleTypes: ["CAR", "MOTOR"],
      isOccupied: false,
    },
    {
      parkingSpaceId: 51,
      category: "CAR",
      eligibleVehicleTypes: ["CAR"],
      isOccupied: true,
    },
    {
      parkingSpaceId: 131,
      category: "MOTOR",
      eligibleVehicleTypes: ["MOTOR"],
      isOccupied: false,
    },
  ]);
});
