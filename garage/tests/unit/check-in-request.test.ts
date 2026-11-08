import { describe, expect, it } from "vitest";
import { parseCheckInRequest } from "../../src/parking/helpers/check-in-request.js";
import { requestIdSchema } from "../../src/parking/helpers/schemas.js";

describe("check-in request validation", () => {
  it("canonicalizes equivalent plates without changing the other fields", () => {
    expect(
      parseCheckInRequest({
        vehicleType: "MOTOR",
        isResident: false,
        licensePlate: "ab-123 c",
      }),
    ).toEqual({
      vehicleType: "MOTOR",
      isResident: false,
      licensePlate: "AB123C",
    });
  });
  it("rejects missing, extra and incorrectly typed fields", () => {
    const valid = { vehicleType: "CAR", isResident: false, licensePlate: "A1" };
    for (const input of [
      null,
      [],
      "text",
      {},
      { ...valid, extra: 1 },
      { ...valid, vehicleType: "car" },
      { ...valid, isResident: "false" },
      { ...valid, licensePlate: "車" },
    ]) {
      expect(parseCheckInRequest(input)).toBeUndefined();
    }
  });
});

describe("request ID validation", () => {
  it.each([
    "d66c841d-2690-4a7d-8c54-d6978291ae98",
    "D66C841D-2690-4A7D-8C54-D6978291AE98",
  ])("accepts UUID %s", (id) => {
    expect(requestIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    "not-a-uuid",
    "d66c841d-2690-9a7d-8c54-d6978291ae98",
    "d66c841d-2690-4a7d-0c54-d6978291ae98",
  ])("rejects invalid UUID %s", (id) => {
    expect(requestIdSchema.safeParse(id).success).toBe(false);
  });
});
