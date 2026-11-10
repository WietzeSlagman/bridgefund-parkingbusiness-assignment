import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import request from "supertest";
import { expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { openApiContract } from "../../src/openapi/contract.js";
import { loadParkingConfig } from "../../src/parking/config.js";

it("checks the committed contract is deterministic and covers the implemented operations", async () => {
  const contract = openApiContract();
  expect(
    await readFile(new URL("../../openapi/v1.json", import.meta.url), "utf8"),
  ).toBe(`${JSON.stringify(contract, null, 2)}\n`);
  expect(
    Object.entries(contract.paths)
      .flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .sort(),
  ).toEqual([
    "DELETE /admin/residents/{plate}",
    "GET /admin/residents",
    "GET /occupancy/{building}",
    "GET /occupancy/{building}/availability",
    "POST /admin/residents",
    "POST /check-in",
    "POST /check-out",
    "POST /webhooks/payments",
  ]);
  expect(contract.paths["/webhooks/payments"].post.security).toEqual([
    { paymentSignature: [] },
  ]);
  expect(contract.paths["/occupancy/{building}"].get.security).toEqual([]);
});

it("matches representative documented authentication and webhook validation behavior", async () => {
  const pool = new EventEmitter() as pg.Pool;
  const config = loadParkingConfig({
    PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
    PARKING_KEYS:
      '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
  });
  const app = createApp({ pool, config, webhookSecret: "test-secret" });
  const gate = await request(app).post("/check-in").send({});
  expect(gate.status).toBe(401);
  expect(gate.body).toEqual({
    error: { code: "UNAUTHORIZED", message: "Unauthorized" },
  });
  const unsigned = await request(app)
    .post("/webhooks/payments")
    .set("X-Terminal-Compat", "1")
    .send({});
  expect(unsigned.status).toBe(401);
  expect(unsigned.body).toEqual({
    error: { code: "UNAUTHORIZED", message: "UNAUTHORIZED" },
  });
  const wrongType = await request(app)
    .post("/webhooks/payments")
    .set("Content-Type", "text/plain")
    .send("{}");
  expect(wrongType.status).toBe(415);
});

it("documents checkout rechecks, replacement, replay and payment grace", () => {
  const description = openApiContract().paths["/check-out"].post.description;
  expect(description).toContain("same gate, request ID and body until 200");
  expect(description).toContain("replaces the current quote");
  expect(description).toContain("409 CHECKOUT_SUPERSEDED");
  expect(description).toContain("EVENT_CLOSED takes precedence");
  expect(description).toContain("committed 200 replays unchanged");
  expect(description).toContain(
    "inclusive at its start and exclusive at its end",
  );
  expect(description).toContain(
    "duplicate payment delivery does not extend it",
  );
  expect(description).toContain("unconfirmed by the vendor");
});

it.each([
  ["/occupancy/{building}", "/occupancy/%FF"],
  ["/occupancy/{building}/availability", "/occupancy/%FF/availability"],
] as const)(
  "documents and preserves the generic malformed-path 500 for %s",
  async (contractPath, url) => {
    const pool = new EventEmitter() as pg.Pool;
    const config = loadParkingConfig({
      PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
      PARKING_KEYS:
        '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
    });
    const result = await request(createApp({ pool, config })).get(url);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Internal server error" });
    expect(result.headers["cache-control"]).toBeUndefined();
    const documented =
      openApiContract().paths[contractPath].get.responses["500"];
    expect(documented.content?.["application/json"].schema).toEqual({
      oneOf: [
        {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
        {
          type: "object",
          required: ["error"],
          properties: { error: { const: "Internal server error" } },
          additionalProperties: false,
        },
      ],
    });
  },
);
