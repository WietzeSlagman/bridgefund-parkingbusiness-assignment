import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadParkingConfig } from "../../src/parking/config.js";
import { Deadline } from "../../src/parking/helpers/deadline.js";
import { initializeParking } from "../../src/parking/initialize.js";
import { checkOut } from "../../src/parking/services/check-out.js";
import { testDatabaseConfig } from "../test-database.js";

const config = loadParkingConfig({
  PARKING_BUILDINGS: JSON.stringify({ "PB-AMS-2M8D": 50 }),
  PARKING_KEYS: JSON.stringify({
    "entrance-1": ["entry1"],
    "entrance-2": ["entry2"],
    "exit-1": ["exit1"],
    "exit-2": ["exit2"],
    admin: ["admin"],
  }),
});
const pool = new pg.Pool(testDatabaseConfig(process.env.TEST_DATABASE_URL));
const app = createApp({ pool, config });
const app2 = createApp({ pool, config });
const ids: string[] = [];
let verified = false;

beforeAll(async () => {
  const client = await pool.connect();
  try {
    const identity = await client.query(
      "select current_database() as name, current_user as username",
    );
    expect(identity.rows[0]).toEqual({
      name: "garage_test",
      username: "garage_test",
    });
    verified = true;
    await migrate(drizzle(client), { migrationsFolder: "./migrations" });
  } finally {
    client.release();
  }
  await initializeParking(pool, config);
});
afterAll(async () => {
  if (verified && ids.length) {
    await pool.query(
      "delete from gate_requests where session_id = any($1::uuid[])",
      [ids],
    );
    await pool.query(
      "delete from checkout_payments where session_id = any($1::uuid[])",
      [ids],
    );
    await pool.query(
      "delete from checkout_requests where session_id = any($1::uuid[])",
      [ids],
    );
    await pool.query("delete from sessions where id = any($1::uuid[])", [ids]);
  }
  await pool.end();
});

async function session(category: "CAR" | "RESIDENT", minutes: number) {
  const id = randomUUID();
  ids.push(id);
  const number = category === "CAR" ? 51 + ids.length : ids.length;
  await pool.query(
    "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,checked_in_at) values ($1,'PB-AMS-2M8D',$2,$3,'CAR',$4,now() - $5 * interval '1 minute')",
    [id, number, id, category, minutes],
  );
  return id;
}
const post = (
  sessionId: string,
  id: string,
  key = "exit1",
  resident = false,
  target = app,
) =>
  request(target)
    .post("/check-out")
    .set("Authorization", `Bearer ${key}`)
    .set("X-Request-Id", id)
    .send({ parkingSessionId: sessionId, isResident: resident });
async function confirm(id: string, requestId: string, ageMinutes = 0) {
  await pool.query(
    "insert into checkout_payments(payment_id,session_id,amount,confirmed_at) select $1,r.session_id,r.quoted_amount,now() - $4 * interval '1 minute' from checkout_requests r where r.gate_id='exit-1' and r.request_id=$2 and r.session_id=$3",
    [randomUUID(), requestId, id, ageMinutes],
  );
}
const due = (r: request.Response) =>
  (r.body as { amountDue: { value: number } }).amountDue.value;

describe("PB-04 checkout", () => {
  it("authenticates, validates and retains failed bindings", async () => {
    const id = randomUUID();
    const missing = randomUUID();
    expect((await post(missing, id, "entry1")).status).toBe(403);
    expect((await post(missing, id, "invalid")).status).toBe(401);
    expect((await post(missing, id)).status).toBe(404);
    expect((await post(randomUUID(), id)).status).toBe(409);
    expect(
      (
        await request(app)
          .post("/check-out")
          .set("Authorization", "Bearer exit1")
          .set("X-Request-Id", randomUUID())
          .send({ parkingSessionId: missing, isResident: false, extra: true })
      ).status,
    ).toBe(400);
    await pool.query(
      "delete from checkout_requests where gate_id='exit-1' and request_id=$1",
      [id],
    );
  });
  it("atomically releases and exactly replays one winner across instances", async () => {
    const s = await session("RESIDENT", 12);
    const a = randomUUID();
    const b = randomUUID();
    const [first, second] = await Promise.all([
      post(s, a),
      post(s, b, "exit2", true, app2),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner =
      first.status === 200
        ? { id: a, key: "exit1", resident: false, response: first }
        : { id: b, key: "exit2", resident: true, response: second };
    const replay = await post(s, winner.id, winner.key, winner.resident);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(winner.response.body);
    expect(
      (await post(s, winner.id, winner.key, !winner.resident)).status,
    ).toBe(409);
    expect(
      (await pool.query("select active from sessions where id=$1", [s]))
        .rows[0],
    ).toEqual({ active: false });
  });
  it("closes check-in replay and does not release a later occupant on checkout replay", async () => {
    const entryId = randomUUID();
    const vehicle = {
      vehicleType: "CAR",
      isResident: false,
      licensePlate: randomUUID().replaceAll("-", "").slice(0, 14),
    };
    const enter = (requestId: string, payload: typeof vehicle) =>
      request(app)
        .post("/check-in")
        .set("Authorization", "Bearer entry1")
        .set("X-Request-Id", requestId)
        .send(payload);
    const first = await enter(entryId, vehicle);
    expect(first.status).toBe(201);
    const firstBody = first.body as {
      parkingSessionId: string;
      parkingSpaceId: number;
    };
    ids.push(firstBody.parkingSessionId);
    // Make the original session a free one without changing the assigned space.
    await pool.query("update sessions set category='RESIDENT' where id=$1", [
      firstBody.parkingSessionId,
    ]);
    const exitId = randomUUID();
    const exit = await post(firstBody.parkingSessionId, exitId);
    expect(exit.status).toBe(200);
    expect((await enter(entryId, vehicle)).status).toBe(409);
    const next = await enter(randomUUID(), {
      ...vehicle,
      licensePlate: randomUUID().replaceAll("-", "").slice(0, 14),
    });
    expect(next.status).toBe(201);
    const nextBody = next.body as {
      parkingSessionId: string;
      parkingSpaceId: number;
    };
    ids.push(nextBody.parkingSessionId);
    expect(nextBody.parkingSpaceId).toBe(firstBody.parkingSpaceId);
    expect((await post(firstBody.parkingSessionId, exitId)).body).toEqual(
      exit.body,
    );
    expect(
      (
        await pool.query("select active from sessions where id=$1", [
          nextBody.parkingSessionId,
        ])
      ).rows[0],
    ).toEqual({ active: true });
  });
  it("retains pending quote and authorizes a covered quote during grace", async () => {
    const s = await session("CAR", 5);
    const id = randomUUID();
    const [one, two] = await Promise.all([
      post(s, id),
      post(s, id, "exit1", false, app2),
    ]);
    expect([one.status, two.status]).toEqual([402, 402]);
    expect(due(one)).toBe(500);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '70 minutes' where id=$1",
      [s],
    );
    expect(due(await post(s, id))).toBe(500);
    await confirm(s, id);
    expect((await post(s, id)).status).toBe(200);
  });
  it("uses a fresh quote for a new interaction", async () => {
    const s = await session("CAR", 5);
    const a = randomUUID();
    expect(due(await post(s, a))).toBe(500);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '130 minutes' where id=$1",
      [s],
    );
    expect(due(await post(s, a))).toBe(500);
    const b = randomUUID();
    expect(due(await post(s, b, "exit2"))).toBe(1500);
  });
  it("uses session payment grace for another gate without a payment-to-interaction link", async () => {
    const s = await session("CAR", 5);
    const a = randomUUID();
    expect(due(await post(s, a))).toBe(500);
    await confirm(s, a);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '70 minutes' where id=$1",
      [s],
    );
    expect((await post(s, randomUUID(), "exit2")).status).toBe(200);
  });
  it("enforces payment identity and positive amounts", async () => {
    const s = await session("CAR", 5);
    const id = randomUUID();
    expect((await post(s, id)).status).toBe(402);
    await expect(
      pool.query(
        "insert into checkout_payments(payment_id,session_id,amount,confirmed_at) values ($1,$2,0,now())",
        [randomUUID(), s],
      ),
    ).rejects.toThrow();
    await confirm(s, id);
    await expect(
      pool.query(
        "insert into checkout_payments select * from checkout_payments where session_id=$1",
        [s],
      ),
    ).rejects.toThrow();
    expect((await post(s, id)).status).toBe(200);
  });
  it("recalculates a new interaction and retains post-grace top-ups", async () => {
    const s = await session("CAR", 5);
    const a = randomUUID();
    const b = randomUUID();
    expect(due(await post(s, a))).toBe(500);
    await confirm(s, a, 16);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '70 minutes' where id=$1",
      [s],
    );
    expect(due(await post(s, b))).toBe(500);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '130 minutes' where id=$1",
      [s],
    );
    expect(due(await post(s, b))).toBe(500);
    await confirm(s, b);
    expect((await post(s, b)).status).toBe(200);
  });
  it("recalculates after expiry on the original request", async () => {
    const s = await session("CAR", 5);
    const id = randomUUID();
    expect(due(await post(s, id))).toBe(500);
    await confirm(s, id, 16);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '70 minutes' where id=$1",
      [s],
    );
    expect(due(await post(s, id))).toBe(500);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '130 minutes' where id=$1",
      [s],
    );
    expect(due(await post(s, id))).toBe(500);
    await confirm(s, id);
    expect((await post(s, id)).status).toBe(200);
  });
  it("uses an inclusive grace start and exclusive 15-minute end", async () => {
    for (const offset of [0, 899_999, 900_000]) {
      const s = await session("CAR", 5);
      const id = randomUUID();
      expect(due(await post(s, id))).toBe(500);
      await confirm(s, id);
      const payment = await pool.query(
        "select confirmed_at from checkout_payments where session_id=$1",
        [s],
      );
      const confirmed = (payment.rows[0] as { confirmed_at: Date })
        .confirmed_at;
      await pool.query(
        "update sessions set checked_in_at=$2::timestamptz - interval '70 minutes' where id=$1",
        [s, confirmed],
      );
      const result = await checkOut(
        pool,
        "exit-1",
        id,
        { parkingSessionId: s, isResident: false },
        new Deadline(1500),
        () => new Date(confirmed.getTime() + offset),
      );
      expect(result.kind).toBe(
        offset === 900_000 ? "payment-required" : "authorized",
      );
    }
  });
});
