import { describe, expect, it } from "vitest";
import { normalizePlate } from "../../src/parking/helpers/plate.js";

describe("pilot plate normalization", () => {
  it("canonicalizes ASCII case, spaces and hyphens", () => {
    for (const plate of ["ab-123-c", "AB 123 C", "ab123c"]) {
      expect(normalizePlate(plate)).toBe("AB123C");
    }
  });

  it("enforces normalized length boundaries", () => {
    expect(normalizePlate(" a ")).toBe("A");
    expect(normalizePlate("a".repeat(16))).toBe("A".repeat(16));
    expect(normalizePlate("a".repeat(17))).toBeUndefined();
    expect(normalizePlate(" - ")).toBeUndefined();
    expect(normalizePlate("")).toBeUndefined();
  });

  it("rejects non-ASCII characters, other whitespace, punctuation and non-strings", () => {
    for (const plate of ["é", "車", "Ａ", "A\n", "A\t", "A_1", null, 123]) {
      expect(normalizePlate(plate)).toBeUndefined();
    }
  });
});
