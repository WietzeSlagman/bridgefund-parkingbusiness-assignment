import { describe, expect, it } from "vitest";
import {
  assertSimulatorStatuses,
  boundedInteger,
  isVisitorCarSpace,
  loadDatabaseUrl,
  percentile,
  resolveLoadDatabaseUrl,
} from "../src/tools/safety.js";

describe("load tooling safeguards", () => {
  it("accepts only pilot visitor-car space numbers", () => {
    for (const value of [51, 52, 129, 130]) {
      expect(isVisitorCarSpace(value)).toBe(true);
    }
    for (const value of [50, 131, 51.5, -1, NaN, "51", null]) {
      expect(isVisitorCarSpace(value)).toBe(false);
    }
  });
  it("encodes passwords and respects explicit URLs, including invalid or empty overrides", () => {
    const password = "p@ss:/?#% ü";
    const url = resolveLoadDatabaseUrl({ LOAD_DB_PASSWORD: password });
    expect(decodeURIComponent(new URL(url).password)).toBe(password);
    const explicit =
      "postgresql://garage_load:other@127.0.0.1:55434/garage_load";
    expect(
      resolveLoadDatabaseUrl({
        LOAD_DB_PASSWORD: password,
        LOAD_DATABASE_URL: explicit,
      }),
    ).toBe(explicit);
    expect(() =>
      resolveLoadDatabaseUrl({
        LOAD_DB_PASSWORD: password,
        LOAD_DATABASE_URL: "",
      }),
    ).toThrow();
    expect(() =>
      resolveLoadDatabaseUrl({
        LOAD_DB_PASSWORD: password,
        LOAD_DATABASE_URL: "postgresql://remote/db",
      }),
    ).toThrow();
    expect(() => resolveLoadDatabaseUrl({})).toThrow();
  });
  it("accepts only the dedicated loopback database and rejects URL overrides", () => {
    const url =
      "postgresql://garage_load:temporary@127.0.0.1:55434/garage_load";
    expect(loadDatabaseUrl(url)).toBe(url);
    for (const invalid of [
      undefined,
      url.replace("55434", "55432"),
      url.replace("127.0.0.1", "localhost"),
      `${url}?host=remote`,
      `${url}#fragment`,
      url.replace("garage_load", "garage_test"),
      url.replace(":temporary", ""),
    ]) {
      expect(() => loadDatabaseUrl(invalid)).toThrow();
    }
  });
  it("limits workload and calculates nearest-rank percentiles", () => {
    expect(boundedInteger(undefined, 8, 20)).toBe(8);
    expect(boundedInteger("20", 8, 20)).toBe(20);
    for (const value of ["0", "21", "1.5", "-1", "Infinity"]) {
      expect(() => boundedInteger(value, 8, 20)).toThrow();
    }
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
    expect(percentile([], 95)).toBe(0);
  });
  it("requires every simulator delivery to succeed, not just its exit status", () => {
    expect(() =>
      assertSimulatorStatuses("HTTP 204\nHTTP 204\nHTTP 204\nHTTP 204"),
    ).not.toThrow();
    expect(() =>
      assertSimulatorStatuses("HTTP 204\nHTTP 401\nHTTP 204\nHTTP 204"),
    ).toThrow();
    expect(() => assertSimulatorStatuses("HTTP 204")).toThrow();
  });
});
