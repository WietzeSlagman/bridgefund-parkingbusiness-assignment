import { EventEmitter } from "node:events";
import type pg from "pg";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { loadParkingConfig } from "../../src/parking/config.js";

it("responds by the budget and destroys a pool client acquired after the deadline", async () => {
  const release = vi.fn();
  const query = vi.fn();
  const client = Object.assign(new EventEmitter(), { release, query });
  const pool = Object.assign(new EventEmitter(), {
    connect: () =>
      new Promise((resolve) => setTimeout(() => resolve(client), 1750)),
  }) as unknown as pg.Pool;
  const config = loadParkingConfig({
    PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
    PARKING_KEYS:
      '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
  });
  const response = await request(createApp({ pool, config }))
    .post("/check-in")
    .set("Authorization", "Bearer a")
    .set("X-Request-Id", "d66c841d-2690-4a7d-8c54-d6978291ae98")
    .send({ vehicleType: "CAR", isResident: false, licensePlate: "TEST1" });
  expect(response.status).toBe(503);
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(release).toHaveBeenCalledWith(true);
  expect(query).not.toHaveBeenCalled();
}, 5000);

it.each(["begin", "set_config", "rollback"] as const)(
  "closes the client when %s stalls",
  async (stage) => {
    let rejectStall: ((error: Error) => void) | undefined;
    const release = vi.fn(() => rejectStall?.(new Error("connection closed")));
    const query = vi.fn((sql: string) => {
      if (
        (stage === "begin" && sql.startsWith("BEGIN")) ||
        (stage === "set_config" && sql.includes("set_config")) ||
        (stage === "rollback" && sql === "ROLLBACK")
      ) {
        return new Promise((_resolve, reject: (error: Error) => void) => {
          rejectStall = reject;
        });
      }
      if (
        stage === "rollback" &&
        sql.startsWith("SELECT code FROM buildings")
      ) {
        return Promise.reject(new Error("injected failure"));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const client = Object.assign(new EventEmitter(), { query, release });
    const pool = Object.assign(new EventEmitter(), {
      connect: () => Promise.resolve(client),
    }) as unknown as pg.Pool;
    const config = loadParkingConfig({
      PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
      PARKING_KEYS:
        '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
    });
    const response = await request(createApp({ pool, config }))
      .post("/check-in")
      .set("Authorization", "Bearer a")
      .set("X-Request-Id", "d66c841d-2690-4a7d-8c54-d6978291ae98")
      .send({ vehicleType: "CAR", isResident: false, licensePlate: "TEST1" });
    expect(response.status).toBe(503);
    expect(release).toHaveBeenCalledWith(true);
  },
  5000,
);
