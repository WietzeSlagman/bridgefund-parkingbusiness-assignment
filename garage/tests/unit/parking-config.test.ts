import { describe, expect, it } from "vitest";
import { loadParkingConfig } from "../../src/parking/config.js";

const buildings = JSON.stringify({ "PB-AMS-2M8D": 50 });
const keys = {
  "entrance-1": ["a", "a-old"],
  "entrance-2": ["b"],
  "exit-1": ["c"],
  "exit-2": ["d"],
  admin: ["e"],
};

describe("parking configuration", () => {
  it("requires all identities and the pilot capacity", () => {
    expect(
      loadParkingConfig({
        PARKING_BUILDINGS: buildings,
        PARKING_KEYS: JSON.stringify(keys),
      }).credentials,
    ).toHaveLength(6);
    expect(() =>
      loadParkingConfig({
        PARKING_BUILDINGS: "{}",
        PARKING_KEYS: JSON.stringify(keys),
      }),
    ).toThrow();
    expect(() =>
      loadParkingConfig({ PARKING_BUILDINGS: buildings, PARKING_KEYS: "{}" }),
    ).toThrow();
    expect(() =>
      loadParkingConfig({
        PARKING_BUILDINGS: '{"PB-AMS-2M8D":49}',
        PARKING_KEYS: JSON.stringify(keys),
      }),
    ).toThrow();
    expect(
      loadParkingConfig({
        PARKING_BUILDINGS: '{"PB-AMS-2M8D":50,"PB-OTHER":12}',
        PARKING_KEYS: JSON.stringify(keys),
      }).buildings,
    ).toEqual({ "PB-AMS-2M8D": 50, "PB-OTHER": 12 });
  });
  it("rejects credentials shared by roles or gates without disclosing them", () => {
    expect(() =>
      loadParkingConfig({
        PARKING_BUILDINGS: buildings,
        PARKING_KEYS: JSON.stringify({ ...keys, admin: ["a"] }),
      }),
    ).toThrow("Invalid or duplicate configured credential");
  });
});
