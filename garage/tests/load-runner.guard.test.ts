import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const requests: string[] = [];
let scenario = "forbidden";
const server = createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`);
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/__load_target") {
    if (scenario === "forbidden") {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain");
      res.end("Forbidden");
      return;
    }
    res.end(
      JSON.stringify(
        scenario === "wrong-target"
          ? { target: "other", version: 1 }
          : { target: "garage_load", version: 1 },
      ),
    );
  } else if (req.url === "/occupancy/PB-AMS-2M8D") {
    res.end(
      JSON.stringify(
        Array.from({ length: 150 }, (_, i) => ({
          parkingSpaceId: i + 1,
          isOccupied: false,
        })),
      ),
    );
  } else if (req.url === "/check-in") {
    res.statusCode = 201;
    res.end(
      JSON.stringify({
        parkingSessionId: "00000000-0000-4000-8000-000000000001",
        parkingSpaceId: 50,
      }),
    );
  } else {
    res.statusCode = 500;
    res.end("{}");
  }
});
const run = (mode = "load") =>
  exec(process.execPath, ["--import", "tsx", "src/tools/run.ts", mode], {
    env: {
      ...process.env,
      LOAD_ENTRANCE_KEY: "entry",
      LOAD_ENTRANCE_2_KEY: "entry2",
      LOAD_EXIT_KEY: "exit",
      LOAD_EXIT_2_KEY: "exit2",
      LOAD_WEBHOOK_SECRET: "secret",
      LOAD_RUN_TOKEN: "token",
      LOAD_SESSIONS: "1",
      LOAD_CONCURRENCY: "1",
    },
    timeout: 10000,
  });

describe("load runner fails closed", () => {
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(3301, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  });
  afterAll(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
  beforeEach(() => {
    requests.length = 0;
  });
  it("rejects a 403 target response before any lifecycle or occupancy request", async () => {
    scenario = "forbidden";
    await expect(run()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "target verification: expected 200, received 403",
      ) as unknown,
    });
    expect(requests).toEqual(["GET /__load_target"]);
  });
  it("rejects an unexpected target identity before any lifecycle or occupancy request", async () => {
    scenario = "wrong-target";
    await expect(run()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Wrong API target") as unknown,
    });
    expect(requests).toEqual(["GET /__load_target"]);
  });
  it("applies the same target guard to the visual demo", async () => {
    scenario = "wrong-target";
    await expect(run("visual")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Wrong API target") as unknown,
    });
    expect(requests).toEqual(["GET /__load_target"]);
  });
  it("rejects a resident-space allocation to a visitor before checkout or payment", async () => {
    scenario = "bad-space";
    await expect(run()).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Invalid check-in response") as unknown,
    });
    expect(requests).toEqual([
      "GET /__load_target",
      "GET /occupancy/PB-AMS-2M8D",
      "POST /check-in",
    ]);
  });
});
