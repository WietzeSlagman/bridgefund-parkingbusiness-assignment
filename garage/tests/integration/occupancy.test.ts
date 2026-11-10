import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadParkingConfig } from "../../src/parking/config.js";
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
const building = `OCC-${randomUUID()}`;
const empty = `OCC-${randomUUID()}`;
const other = `OCC-${randomUUID()}`;
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
    await client.query(
      "insert into buildings(code, registration_limit) values ($1,0),($2,0),($3,0)",
      [building, empty, other],
    );
    await client.query(
      "insert into spaces(building_code,number,floor,category) values ($1,1,1,'RESIDENT'),($1,51,1,'CAR'),($1,131,2,'MOTOR'),($2,51,1,'CAR')",
      [building, other],
    );
  } finally {
    client.release();
  }
});
afterAll(async () => {
  if (verified) {
    await pool.query(
      "delete from checkout_payments where session_id in (select id from sessions where building_code = any($1::text[]))",
      [[building, empty, other]],
    );
    await pool.query(
      "delete from sessions where building_code = any($1::text[])",
      [[building, empty, other]],
    );
    await pool.query(
      "delete from spaces where building_code = any($1::text[])",
      [[building, empty, other]],
    );
    await pool.query("delete from buildings where code = any($1::text[])", [
      [building, empty, other],
    ]);
  }
  await pool.end();
});

describe("PB-06 occupancy", () => {
  it("returns public ordered, private-data-free building-scoped snapshots and counts", async () => {
    const id = randomUUID();
    await pool.query(
      "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,active) values ($1,$2,51,'SECRET','CAR','CAR',true),($3,$4,51,'OTHER','CAR','CAR',true),($5,$2,131,'OLD','MOTOR','MOTOR',false)",
      [id, building, randomUUID(), other, randomUUID()],
    );
    const list = await request(app).get(`/occupancy/${building}`);
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.body).toEqual([
      {
        parkingSpaceId: 1,
        category: "RESIDENT",
        eligibleVehicleTypes: ["CAR", "MOTOR"],
        isOccupied: false,
      },
      {
        parkingSpaceId: 51,
        category: "CAR",
        eligibleVehicleTypes: ["CAR"],
        isOccupied: true,
      },
      {
        parkingSpaceId: 131,
        category: "MOTOR",
        eligibleVehicleTypes: ["MOTOR"],
        isOccupied: false,
      },
    ]);
    expect(
      (await request(app).get(`/occupancy/${building}/availability`)).body,
    ).toEqual({ resident: 1, car: 0, motorcycle: 1 });
    await pool.query(
      "insert into checkout_payments(payment_id,session_id,amount,confirmed_at) values ($1,$2,500,now())",
      [randomUUID(), id],
    );
    expect(
      (await request(app).get(`/occupancy/${building}/availability`)).body,
    ).toEqual({ resident: 1, car: 0, motorcycle: 1 });
    await pool.query("update sessions set active=false where id=$1", [id]);
    expect(
      (await request(app).get(`/occupancy/${building}/availability`)).body,
    ).toEqual({ resident: 1, car: 1, motorcycle: 1 });
  });
  it("distinguishes unknown buildings and known empty layouts", async () => {
    expect((await request(app).get(`/occupancy/${empty}`)).body).toEqual([]);
    expect(
      (await request(app).get(`/occupancy/${empty}/availability`)).body,
    ).toEqual({ resident: 0, car: 0, motorcycle: 0 });
    const missing = await request(app).get(`/occupancy/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: { code: "BUILDING_NOT_FOUND", message: "Building not found" },
    });
  });
  it("retains case-insensitive routes and optional trailing slashes", async () => {
    const list = await request(app).get(`/OCCUPANCY/${empty}/`);
    const counts = await request(app).get(`/OCCUPANCY/${empty}/AVAILABILITY/`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
    expect(counts.status).toBe(200);
    expect(counts.body).toEqual({ resident: 0, car: 0, motorcycle: 0 });
    expect(counts.headers["cache-control"]).toBe("no-store");
  });
  it("uses a point-in-time snapshot during an uncommitted allocation", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into sessions(id,building_code,space_number,plate,vehicle_type,category) values ($1,$2,1,'CONCURRENT','CAR','RESIDENT')",
        [randomUUID(), building],
      );
      const before = await request(app).get(
        `/occupancy/${building}/availability`,
      );
      expect(before.body).toEqual({ resident: 1, car: 1, motorcycle: 1 });
      await client.query("commit");
      const after = await request(app).get(
        `/occupancy/${building}/availability`,
      );
      expect(after.body).toEqual({ resident: 0, car: 1, motorcycle: 1 });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("counts a complete pilot-shaped layout and full categories", async () => {
    await pool.query(
      `insert into spaces(building_code,number,floor,category)
       select $1,n,case when n <= 75 then 1 else 2 end,
       case when n <= 50 then 'RESIDENT' when n <= 130 then 'CAR' else 'MOTOR' end
       from generate_series(1,150) n`,
      [empty],
    );
    const list = await request(app).get(`/occupancy/${empty}`);
    expect((list.body as unknown[]).length).toBe(150);
    expect(
      (await request(app).get(`/occupancy/${empty}/availability`)).body,
    ).toEqual({ resident: 50, car: 80, motorcycle: 20 });
    await pool.query(
      `insert into sessions(id,building_code,space_number,plate,vehicle_type,category)
       select gen_random_uuid(),$1,number,'FULL' || number,'MOTOR','MOTOR'
       from spaces where building_code=$1 and category='MOTOR'`,
      [empty],
    );
    expect(
      (await request(app).get(`/occupancy/${empty}/availability`)).body,
    ).toEqual({ resident: 50, car: 80, motorcycle: 0 });
    await pool.query("delete from sessions where building_code=$1", [empty]);
    await pool.query("delete from spaces where building_code=$1", [empty]);
  });
  it("returns a sanitized error when the database is unavailable", async () => {
    const closed = new pg.Pool(
      testDatabaseConfig(process.env.TEST_DATABASE_URL),
    );
    const unavailableApp = createApp({ pool: closed, config });
    await closed.end();
    const response = await request(unavailableApp).get(
      `/occupancy/${building}`,
    );
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" },
    });
  });
});
