import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "dotenv";
import { loadConfig } from "../../src/config/index.js";
import { loadParkingConfig } from "../../src/parking/config.js";

describe("local environment examples", () => {
  it("provides internally consistent, valid throwaway configuration", () => {
    const env = parse(readFileSync(".env.example"));
    expect(loadConfig(env).port).toBe(3000);
    expect(loadParkingConfig(env).credentials).toHaveLength(5);
    expect(env.WEBHOOK_SECRET).toBeTruthy();
    expect(new URL(env.DATABASE_URL).password).toBe(env.DEV_DB_PASSWORD);
    expect(new URL(env.TEST_DATABASE_URL).password).toBe(env.TEST_DB_PASSWORD);
    expect(env.DEV_DB_PASSWORD).not.toBe(env.TEST_DB_PASSWORD);
  });

  it("keeps the agent example free of credential variables", () => {
    const env = parse(readFileSync(".env.agent.example"));
    expect(Object.keys(env).sort()).toEqual(["PARKING_BUILDINGS", "PORT"]);
  });

  it("uses exported values ahead of the file through the actual dotenv preload", () => {
    const result = execFileSync(
      process.execPath,
      [
        "--import",
        "dotenv/config",
        "--eval",
        'process.stdout.write(String(process.env.WEBHOOK_SECRET === "exported-test" && process.env.PORT === "3000" && process.env.PARKING_KEYS === ""))',
      ],
      {
        env: {
          DOTENV_CONFIG_PATH: ".env.example",
          WEBHOOK_SECRET: "exported-test",
          PARKING_KEYS: "",
        },
        encoding: "utf8",
      },
    );
    expect(result).toBe("true");
  });
});
