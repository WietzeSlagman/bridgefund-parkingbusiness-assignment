import { describe, expect, it } from "vitest";
import { testDatabaseConfig } from "../test-database.js";

describe("test database target", () => {
  const base = "postgresql://garage_test:secret@localhost:55433/garage_test";
  it("constructs fixed connection fields and decodes only the password", () => {
    expect(testDatabaseConfig(base.replace("secret", "a%40b"))).toMatchObject({
      host: "127.0.0.1",
      port: 55433,
      user: "garage_test",
      database: "garage_test",
      password: "a@b",
      ssl: false,
    });
  });
  it.each([
    "?host=remote.example",
    "?host=127.0.0.1&port=55432",
    "?database=garage_dev",
    "?user=garage_dev",
    "?%68ost=remote.example",
    "?",
    "#fragment",
  ])("rejects connection parameter or fragment override %s", (suffix) => {
    expect(() => testDatabaseConfig(base + suffix)).toThrow(
      "isolated local test database",
    );
  });
  it.each([
    undefined,
    "postgresql://garage_dev:secret@localhost:55432/garage_dev",
    "postgresql://garage_test@localhost:55433/garage_test",
    "postgresql://garage_test:secret@remote.example:55433/garage_test",
  ])("rejects invalid test target %s", (url) => {
    expect(() => testDatabaseConfig(url)).toThrow();
  });
});
