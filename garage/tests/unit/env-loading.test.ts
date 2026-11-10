import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "dotenv";
import { loadConfig } from "../../src/config/index.js";
import { loadParkingConfig } from "../../src/parking/config.js";

describe("local environment examples", () => {
  it("exposes the demo/load API script with the same explicit environment as the runners", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["start:demo-load-api"]).toBe(
      "node --env-file=.env.load --import tsx src/tools/load-api.ts",
    );
    for (const script of ["start:demo", "start:load-test", "db:migrate:load"]) {
      expect(pkg.scripts[script]).toContain("--env-file=.env.load");
    }
    expect(pkg.scripts["start:load-api"]).toBeUndefined();
  });

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

  it("loads the separate load example explicitly with process values taking precedence", () => {
    const env = parse(readFileSync(".env.load.example"));
    expect(env.LOAD_DB_PASSWORD).toBeTruthy();
    expect(env.LOAD_DATABASE_URL).toBeUndefined();
    const result = execFileSync(
      process.execPath,
      [
        "--env-file=.env.load.example",
        "--eval",
        "process.stdout.write(JSON.stringify([process.env.LOAD_DB_PASSWORD, process.env.LOAD_RUN_TOKEN]))",
      ],
      {
        env: { LOAD_DB_PASSWORD: "", LOAD_RUN_TOKEN: "exported" },
        encoding: "utf8",
      },
    );
    expect(JSON.parse(result)).toEqual(["", "exported"]);
  });

  it("rejects an explicit unsafe migration URL before invoking Drizzle", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--env-file=.env.load.example",
        "--import",
        "tsx",
        "src/tools/migrate-load.ts",
      ],
      {
        env: { ...process.env, LOAD_DATABASE_URL: "postgresql://remote/db" },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("migration not started");
    expect(result.stdout).not.toContain("drizzle");
  });
});
