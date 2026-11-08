import { EventEmitter } from "node:events";
import type pg from "pg";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { loadParkingConfig } from "../../src/parking/config.js";

it.each([
  "not-a-uuid",
  "d66c841d-2690-9a7d-8c54-d6978291ae98",
  "d66c841d-2690-4a7d-0c54-d6978291ae98",
])(
  "returns INVALID_REQUEST without accessing the database for %s",
  async (id) => {
    const connect = vi.fn();
    const pool = Object.assign(new EventEmitter(), {
      connect,
    }) as unknown as pg.Pool;
    const config = loadParkingConfig({
      PARKING_BUILDINGS: '{"PB-AMS-2M8D":50}',
      PARKING_KEYS:
        '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}',
    });
    const response = await request(createApp({ pool, config }))
      .post("/check-in")
      .set("Authorization", "Bearer a")
      .set("X-Request-Id", id)
      .send({ vehicleType: "CAR", isResident: false, licensePlate: "TEST1" });
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe(
      "INVALID_REQUEST",
    );
    expect(connect).not.toHaveBeenCalled();
  },
);
