import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const run = (mode: string, env: NodeJS.ProcessEnv) =>
  exec(process.execPath, ["--import", "tsx", "src/tools/run.ts", mode], {
    env: { ...process.env, ...env },
    timeout: 30000,
  });

// The operator must start and verify the isolated load API and its container first.
describe.skipIf(process.env.RUN_LOAD_INTEGRATION !== "1")(
  "load runner with real API",
  () => {
    it("rejects the wrong API target token before making lifecycle requests", async () => {
      await expect(
        run("load", { LOAD_RUN_TOKEN: "incorrect-token" }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "target verification: expected 200, received 403",
        ) as unknown,
      });
    });
    it("runs the real simulator and a concurrent signed lifecycle", async () => {
      const demo = await run("demo", {});
      expect(demo.stdout.match(/HTTP 204/g)).toHaveLength(4);
      expect(demo.stdout).toContain('"checkout-release:200": 1');
      const load = await run("load", {
        LOAD_SESSIONS: "2",
        LOAD_CONCURRENCY: "2",
      });
      expect(load.stdout).toContain('"check-in:201": 2');
      expect(load.stdout).toContain('"checkout-quote:402": 2');
      expect(load.stdout).toContain('"payment:204": 2');
      expect(load.stdout).toContain('"checkout-release:200": 2');
    }, 30000);
  },
);
