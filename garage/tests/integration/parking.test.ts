import { randomUUID } from "node:crypto";
import http from "node:http";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadParkingConfig } from "../../src/parking/config.js";
import {
  initializeParking,
  updateBuildings,
} from "../../src/parking/initialize.js";
import { testDatabaseConfig } from "../test-database.js";

const config = loadParkingConfig({
  PARKING_BUILDINGS: JSON.stringify({ "PB-AMS-2M8D": 50 }),
  PARKING_KEYS: JSON.stringify({
    "entrance-1": ["test-entry-1"],
    "entrance-2": ["test-entry-2"],
    "exit-1": ["test-exit-1"],
    "exit-2": ["test-exit-2"],
    admin: ["test-admin"],
  }),
});
const pool = new pg.Pool({
  ...testDatabaseConfig(process.env.TEST_DATABASE_URL),
  connectionTimeoutMillis: 1000,
});
const app = createApp({ pool, config });
const building = "PB-AMS-2M8D";
const body = (response: request.Response) =>
  response.body as { parkingSpaceId: number; error: { code: string } };
const plates: string[] = [];
let verified = false;
const plate = () => {
  const value = randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase();
  plates.push(value);
  return value;
};
const checkin = (
  key: string,
  id: string,
  licensePlate: string,
  isResident = false,
) =>
  request(app)
    .post("/check-in")
    .set("Authorization", `Bearer ${key}`)
    .set("X-Request-Id", id)
    .send({ vehicleType: "CAR", isResident, licensePlate });

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
  if (verified && plates.length) {
    await pool.query(
      "delete from gate_requests where plate = any($1::text[])",
      [plates],
    );
    await pool.query("delete from sessions where plate = any($1::text[])", [
      plates,
    ]);
    await pool.query("delete from residents where plate = any($1::text[])", [
      plates,
    ]);
  }
  await pool.end();
});

describe("PB-03 database integration", () => {
  it("preserves resident validation precedence and rejects extra or coerced inputs", async () => {
    const post = (payload: object) =>
      request(app)
        .post("/admin/residents")
        .set("Authorization", "Bearer test-admin")
        .send(payload);
    for (const [payload, code] of [
      [
        { buildingCode: "unknown", licensePlate: "車", extra: 1 },
        "INVALID_REQUEST",
      ],
      [{ buildingCode: "unknown", licensePlate: "車" }, "INVALID_BUILDING"],
      [{ buildingCode: building, licensePlate: 123 }, "INVALID_REQUEST"],
      [{ buildingCode: "unknown" }, "INVALID_REQUEST"],
      [{ licensePlate: "A1" }, "INVALID_BUILDING"],
      [{ licensePlate: "A1", extra: 1 }, "INVALID_REQUEST"],
    ] as const) {
      const response = await post(payload);
      expect(response.status).toBe(400);
      expect(body(response).error.code).toBe(code);
    }
    for (const [key, status] of [
      ["", 401],
      ["test-entry-1", 403],
    ] as const) {
      const response = await request(app)
        .post("/admin/residents")
        .set("Authorization", `Bearer ${key}`)
        .send({ licensePlate: "A1" });
      expect(response.status).toBe(status);
    }
    for (const [query, code] of [
      [{ buildingCode: "unknown", extra: "x" }, "INVALID_BUILDING"],
      [{ buildingCode: building, extra: "x" }, "INVALID_REQUEST"],
      [{ buildingCode: [building, building] }, "INVALID_BUILDING"],
    ] as const) {
      const response = await request(app)
        .get("/admin/residents")
        .set("Authorization", "Bearer test-admin")
        .query(query);
      expect(response.status).toBe(400);
      expect(body(response).error.code).toBe(code);
    }
    const deleted = await request(app)
      .delete("/admin/residents/%E8%BB%8A")
      .set("Authorization", "Bearer test-admin")
      .query({ buildingCode: "unknown", extra: "x" });
    expect(body(deleted).error.code).toBe("INVALID_BUILDING");
    const invalidCheckIn = await request(app)
      .post("/check-in")
      .set("Authorization", "Bearer test-entry-1")
      .set("X-Request-Id", randomUUID())
      .send({ vehicleType: "CAR", isResident: "false", licensePlate: "A1" });
    expect(invalidCheckIn.status).toBe(400);
    expect(body(invalidCheckIn).error.code).toBe("INVALID_REQUEST");
  });
  it("lists registered plates through the authenticated resident route without caching", async () => {
    const p = plate();
    expect(
      (
        await request(app)
          .get("/admin/residents")
          .query({ buildingCode: building })
      ).status,
    ).toBe(401);
    const created = await request(app)
      .post("/admin/residents")
      .set("Authorization", "Bearer test-admin")
      .send({ buildingCode: building, licensePlate: p.toLowerCase() });
    expect(created.status).toBe(201);
    const listing = await request(app)
      .get("/admin/residents")
      .query({ buildingCode: building })
      .set("Authorization", "Bearer test-admin");
    expect(listing.status).toBe(200);
    expect(listing.headers["cache-control"]).toBe("no-store");
    const result = listing.body as {
      buildingCode: string;
      licensePlates: string[];
    };
    expect(result.buildingCode).toBe(building);
    expect(result.licensePlates).toContain(p);
  });
  it("initializes a stable pilot layout and rejects mismatched config", async () => {
    await initializeParking(pool, config);
    const spaces = await pool.query(
      "select number, floor, category from spaces order by number",
    );
    expect(spaces.rowCount).toBe(150);
    expect(spaces.rows[0]).toEqual({
      number: 1,
      floor: 1,
      category: "RESIDENT",
    });
    expect(spaces.rows[75]).toEqual({ number: 76, floor: 2, category: "CAR" });
    expect(spaces.rows[130]).toEqual({
      number: 131,
      floor: 2,
      category: "MOTOR",
    });
    await expect(
      initializeParking(pool, {
        ...config,
        buildings: { ...config.buildings, OTHER: 1 },
      }),
    ).rejects.toThrow();
  });
  it("registers, checks in and protects resident removal", async () => {
    const p = plate();
    const register = await request(app)
      .post("/admin/residents")
      .set("Authorization", "Bearer test-admin")
      .send({ buildingCode: building, licensePlate: p.toLowerCase() });
    expect(register.status).toBe(201);
    const response = await checkin("test-entry-1", randomUUID(), p);
    expect(response.status).toBe(201);
    expect(body(response).parkingSpaceId).toBeLessThanOrEqual(50);
    const remove = await request(app)
      .delete(`/admin/residents/${p}`)
      .query({ buildingCode: building })
      .set("Authorization", "Bearer test-admin");
    expect(remove.status).toBe(409);
    expect(body(remove).error.code).toBe("RESIDENT_HAS_ACTIVE_SESSION");
  });
  it("serializes overlapping retries and detects changed body", async () => {
    const p = plate();
    const id = randomUUID();
    const responses = await Promise.all([
      checkin("test-entry-1", id, p),
      checkin("test-entry-1", id, p.toLowerCase()),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    const conflict = await checkin("test-entry-1", id, plate());
    expect(body(conflict).error.code).toBe("REQUEST_ID_CONFLICT");
    const duplicate = await checkin("test-entry-2", randomUUID(), p);
    expect(body(duplicate).error.code).toBe("ACTIVE_SESSION_EXISTS");
  });
  it("allocates different spaces concurrently and enforces uniqueness in PostgreSQL", async () => {
    const results = await Promise.all([
      checkin("test-entry-1", randomUUID(), plate()),
      checkin("test-entry-2", randomUUID(), plate()),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(body(results[0]).parkingSpaceId).not.toBe(
      body(results[1]).parkingSpaceId,
    );
    await expect(
      pool.query(
        "insert into sessions (id,building_code,space_number,plate,vehicle_type,category) values ($1,$2,$3,$4,'CAR','CAR')",
        [randomUUID(), building, body(results[0]).parkingSpaceId, plate()],
      ),
    ).rejects.toThrow();
    const existing = await pool.query<{ plate: string }>(
      "select plate from sessions where building_code=$1 and space_number=$2 and active",
      [building, body(results[0]).parkingSpaceId],
    );
    const free = await pool.query<{ number: number }>(
      "select s.number from spaces s where s.building_code=$1 and s.category='CAR' and not exists (select 1 from sessions p where p.building_code=s.building_code and p.space_number=s.number and p.active) order by s.number limit 1",
      [building],
    );
    await expect(
      pool.query(
        "insert into sessions (id,building_code,space_number,plate,vehicle_type,category) values ($1,$2,$3,$4,'CAR','CAR')",
        [randomUUID(), building, free.rows[0].number, existing.rows[0].plate],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "active_session_plate",
    });
  });
  it("returns 400 for malformed percent-encoded resident paths", async () => {
    const missing = await request(app).delete("/admin/residents/%E0%A4%A");
    expect(missing.status).toBe(401);
    expect(body(missing).error.code).toBe("UNAUTHORIZED");
    const wrongRole = await request(app)
      .delete("/admin/residents/%E0%A4%A")
      .set("Authorization", "Bearer test-entry-1");
    expect(wrongRole.status).toBe(403);
    expect(body(wrongRole).error.code).toBe("FORBIDDEN");
    const response = await request(app)
      .delete("/admin/residents/%E0%A4%A")
      .query({ buildingCode: building })
      .set("Authorization", "Bearer test-admin");
    expect(response.status).toBe(400);
    expect(body(response).error.code).toBe("INVALID_REQUEST");
  });
  it("times out while receiving a slow body without binding the request", async () => {
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("No test port");
    }
    const id = randomUUID();
    const response = await new Promise<{
      status: number | undefined;
      body: string;
    }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: address.port,
          path: "/check-in",
          method: "POST",
          headers: {
            authorization: "Bearer test-entry-1",
            "x-request-id": id,
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            text += chunk;
          });
          res.on("end", () => {
            req.destroy();
            resolve({ status: res.statusCode, body: text });
          });
        },
      );
      req.on("error", reject);
      req.write('{"vehicleType":');
    });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    expect(response.status).toBe(503);
    expect(response.body).toContain("SERVICE_UNAVAILABLE");
    expect(
      (
        await pool.query(
          "select 1 from gate_requests where gate_id=$1 and request_id=$2",
          ["entrance-1", id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("replays across application recreation and gate key rotation", async () => {
    const p = plate();
    const id = randomUUID();
    const original = await checkin("test-entry-1", id, p);
    expect(original.status).toBe(201);
    const rotated = {
      ...config,
      credentials: config.credentials.map((entry) =>
        entry.key === "test-entry-1"
          ? { ...entry, key: "rotated-entry" }
          : entry,
      ),
    };
    const restarted = createApp({ pool, config: rotated });
    const replay = await request(restarted)
      .post("/check-in")
      .set("Authorization", "Bearer rotated-entry")
      .set("X-Request-Id", id)
      .send({ vehicleType: "CAR", isResident: false, licensePlate: p });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(original.body);
  });
  it("recovers a committed result whose acknowledgement arrives after the deadline", async () => {
    const p = plate();
    const id = randomUUID();
    const delayedPool = {
      on: pool.on.bind(pool),
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return (sql: string, values?: unknown[]) => {
                const result = target.query(sql, values);
                if (sql !== "COMMIT") {
                  return result;
                }
                return result.then(async (value) => {
                  await new Promise((resolve) => setTimeout(resolve, 1800));
                  return value;
                });
              };
            }
            if (property === "release") {
              return target.release.bind(target);
            }
            return Reflect.get(target, property) as unknown;
          },
        });
      },
    } as unknown as pg.Pool;
    const delayedApp = createApp({ pool: delayedPool, config });
    const response = await request(delayedApp)
      .post("/check-in")
      .set("Authorization", "Bearer test-entry-1")
      .set("X-Request-Id", id)
      .send({ vehicleType: "CAR", isResident: false, licensePlate: p });
    expect(response.status).toBe(503);
    const committed = await pool.query<{ id: string }>(
      "select id from sessions where building_code=$1 and plate=$2 and active",
      [building, p],
    );
    expect(committed.rowCount).toBe(1);
    const replay = await checkin("test-entry-1", id, p);
    expect(replay.status).toBe(201);
    expect((replay.body as { parkingSessionId: string }).parkingSessionId).toBe(
      committed.rows[0].id,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
  }, 5000);
  it("allows only one allocation of the final car space across instances", async () => {
    const secondPool = new pg.Pool({
      ...testDatabaseConfig(process.env.TEST_DATABASE_URL),
      connectionTimeoutMillis: 1000,
    });
    const secondApp = createApp({ pool: secondPool, config });
    const fixturePlates: string[] = [];
    const tracked = () => {
      const p = plate();
      fixturePlates.push(p);
      return p;
    };
    try {
      const free = await pool.query<{ number: number }>(
        "select s.number from spaces s where s.building_code=$1 and s.category='CAR' and not exists (select 1 from sessions p where p.building_code=s.building_code and p.space_number=s.number and p.active) order by s.number",
        [building],
      );
      expect(free.rows.length).toBeGreaterThan(1);
      for (const space of free.rows.slice(1)) {
        await pool.query(
          "insert into sessions (id,building_code,space_number,plate,vehicle_type,category) values ($1,$2,$3,$4,'CAR','CAR')",
          [randomUUID(), building, space.number, tracked()],
        );
      }
      const p1 = tracked();
      const p2 = tracked();
      const second = request(secondApp)
        .post("/check-in")
        .set("Authorization", "Bearer test-entry-2")
        .set("X-Request-Id", randomUUID())
        .send({ vehicleType: "CAR", isResident: false, licensePlate: p2 });
      const results = await Promise.all([
        checkin("test-entry-1", randomUUID(), p1),
        second,
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(body(results.find((r) => r.status === 409)!).error.code).toBe(
        "CATEGORY_FULL",
      );
      expect(body(results.find((r) => r.status === 201)!).parkingSpaceId).toBe(
        free.rows[0].number,
      );
    } finally {
      await pool.query(
        "delete from gate_requests where plate=any($1::text[])",
        [fixturePlates],
      );
      await pool.query("delete from sessions where plate=any($1::text[])", [
        fixturePlates,
      ]);
      await secondPool.end();
    }
  });
  it.each(["registration", "check-in"] as const)(
    "serializes %s first across app instances",
    async (first) => {
      const secondPool = new pg.Pool({
        ...testDatabaseConfig(process.env.TEST_DATABASE_URL),
        connectionTimeoutMillis: 1000,
      });
      const otherApp = createApp({ pool: secondPool, config });
      const p = plate();
      const suffix = randomUUID().replaceAll("-", "");
      const fn = `test_order_${suffix}`;
      const trigger = `test_order_trigger_${suffix}`;
      const table = first === "registration" ? "residents" : "sessions";
      await pool.query(
        `create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.plate = '${p}' then perform pg_sleep(0.4); end if; return NEW; end $$`,
      );
      try {
        await pool.query(
          `create trigger ${trigger} before insert on ${table} for each row execute function ${fn}()`,
        );
        const registration = () =>
          request(app)
            .post("/admin/residents")
            .set("Authorization", "Bearer test-admin")
            .send({ buildingCode: building, licensePlate: p });
        const entrance = () =>
          request(otherApp)
            .post("/check-in")
            .set("Authorization", "Bearer test-entry-2")
            .set("X-Request-Id", randomUUID())
            .send({ vehicleType: "CAR", isResident: false, licensePlate: p });
        const leading =
          first === "registration"
            ? registration().then((r) => r)
            : entrance().then((r) => r);
        let sleeping = false;
        for (let i = 0; i < 30 && !sleeping; i++) {
          const activity = await pool.query<{ sleeping: boolean }>(
            "select exists (select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and lower(query) like $1) as sleeping",
            [`%insert into ${table}%`],
          );
          sleeping = activity.rows[0].sleeping;
          if (!sleeping) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(sleeping).toBe(true);
        const following =
          first === "registration"
            ? entrance().then((r) => r)
            : registration().then((r) => r);
        const results = await Promise.all([leading, following]);
        expect(results.map((r) => r.status)).toEqual([201, 201]);
        const session = await pool.query<{ category: string }>(
          "select category from sessions where building_code=$1 and plate=$2 and active",
          [building, p],
        );
        expect(session.rows[0].category).toBe(
          first === "registration" ? "RESIDENT" : "CAR",
        );
      } finally {
        await pool.query(`drop trigger if exists ${trigger} on ${table}`);
        await pool.query(`drop function if exists ${fn}()`);
        await secondPool.end();
      }
    },
  );
  it.each(["removal", "check-in"] as const)(
    "serializes resident %s first across instances",
    async (first) => {
      const secondPool = new pg.Pool({
        ...testDatabaseConfig(process.env.TEST_DATABASE_URL),
        connectionTimeoutMillis: 1000,
      });
      const other = createApp({ pool: secondPool, config });
      const p = plate();
      const suffix = randomUUID().replaceAll("-", "");
      const fn = `test_remove_${suffix}`;
      const trigger = `test_remove_trigger_${suffix}`;
      const table = first === "removal" ? "residents" : "sessions";
      const op = first === "removal" ? "delete" : "insert";
      try {
        await pool.query(
          "insert into residents (building_code,plate) values ($1,$2)",
          [building, p],
        );
        await pool.query(
          `create function ${fn}() returns trigger language plpgsql as $$ begin if ${first === "removal" ? "OLD" : "NEW"}.plate = '${p}' then perform pg_sleep(0.4); end if; return ${first === "removal" ? "OLD" : "NEW"}; end $$`,
        );
        await pool.query(
          `create trigger ${trigger} before ${op} on ${table} for each row execute function ${fn}()`,
        );
        const remove = () =>
          request(app)
            .delete(`/admin/residents/${p}`)
            .query({ buildingCode: building })
            .set("Authorization", "Bearer test-admin");
        const entrance = () =>
          request(other)
            .post("/check-in")
            .set("Authorization", "Bearer test-entry-2")
            .set("X-Request-Id", randomUUID())
            .send({ vehicleType: "CAR", isResident: true, licensePlate: p });
        const leading =
          first === "removal"
            ? remove().then((r) => r)
            : entrance().then((r) => r);
        let sleeping = false;
        for (let i = 0; i < 30 && !sleeping; i++) {
          const activity = await pool.query<{ sleeping: boolean }>(
            "select exists (select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and lower(query) like $1) as sleeping",
            [`%${op}%${table}%`],
          );
          sleeping = activity.rows[0].sleeping;
          if (!sleeping) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(sleeping).toBe(true);
        const following =
          first === "removal"
            ? entrance().then((r) => r)
            : remove().then((r) => r);
        const [one, two] = await Promise.all([leading, following]);
        expect([one.status, two.status]).toEqual(
          first === "removal" ? [204, 409] : [201, 409],
        );
        expect(body(two).error.code).toBe(
          first === "removal"
            ? "RESIDENT_NOT_REGISTERED"
            : "RESIDENT_HAS_ACTIVE_SESSION",
        );
      } finally {
        await pool.query(`drop trigger if exists ${trigger} on ${table}`);
        await pool.query(`drop function if exists ${fn}()`);
        await secondPool.end();
      }
    },
  );
  it.each(["commit", "rollback"] as const)(
    "waits for the lowest space's %s before selecting",
    async (outcome) => {
      const client = await pool.connect();
      const heldPlate = plate();
      const waitingPlate = plate();
      try {
        await client.query("begin");
        await client.query(
          "select code from buildings where code=$1 for update",
          [building],
        );
        const available = await client.query<{ number: number }>(
          "select number from spaces s where building_code=$1 and category='CAR' and not exists (select 1 from sessions p where p.building_code=s.building_code and p.space_number=s.number and p.active) order by number limit 2",
          [building],
        );
        expect(available.rowCount).toBe(2);
        await client.query(
          "insert into sessions (id,building_code,space_number,plate,vehicle_type,category) values ($1,$2,$3,$4,'CAR','CAR')",
          [randomUUID(), building, available.rows[0].number, heldPlate],
        );
        let finished = false;
        const pending = checkin(
          "test-entry-2",
          randomUUID(),
          waitingPlate,
        ).then((result) => {
          finished = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(finished).toBe(false);
        await client.query(outcome);
        const response = await pending;
        expect(response.status).toBe(201);
        expect(body(response).parkingSpaceId).toBe(
          available.rows[outcome === "commit" ? 1 : 0].number,
        );
      } finally {
        await client.query("rollback");
        client.release();
      }
    },
  );
  it.each(["commit", "rollback"] as const)(
    "uses registry state after concurrent registration %s",
    async (outcome) => {
      const client = await pool.connect();
      const p = plate();
      try {
        await client.query("begin");
        await client.query(
          "select code from buildings where code=$1 for update",
          [building],
        );
        await client.query(
          "insert into residents (building_code,plate) values ($1,$2)",
          [building, p],
        );
        const pending = checkin("test-entry-1", randomUUID(), p);
        const responsePromise = pending.then((result) => result);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await client.query(outcome);
        const response = await responsePromise;
        expect(response.status).toBe(201);
        const rows = await pool.query<{ category: string }>(
          "select category from sessions where building_code=$1 and plate=$2 and active",
          [building, p],
        );
        expect(rows.rows[0].category).toBe(
          outcome === "commit" ? "RESIDENT" : "CAR",
        );
      } finally {
        await client.query("rollback");
        client.release();
      }
    },
  );
  it("authenticates roles and retains failed request bindings", async () => {
    const id = randomUUID();
    const p = plate();
    expect((await checkin("test-exit-1", id, p)).status).toBe(403);
    expect(body(await checkin("test-entry-1", id, p, true)).error.code).toBe(
      "RESIDENT_NOT_REGISTERED",
    );
    expect(body(await checkin("test-entry-1", id, p, false)).error.code).toBe(
      "REQUEST_ID_CONFLICT",
    );
    expect(
      (
        await request(app)
          .post("/admin/residents")
          .set("Authorization", "Bearer test-admin")
          .send({ buildingCode: building, licensePlate: p })
      ).status,
    ).toBe(201);
    expect((await checkin("test-entry-1", id, p, true)).status).toBe(201);
  });
  it("times out waiting for the building lock and permits a same-ID retry", async () => {
    const client = await pool.connect();
    const id = randomUUID();
    const p = plate();
    try {
      await client.query("begin");
      await client.query(
        "select code from buildings where code=$1 for update",
        [building],
      );
      expect((await checkin("test-entry-1", id, p)).status).toBe(503);
      const binding = await pool.query(
        "select 1 from gate_requests where gate_id=$1 and request_id=$2",
        ["entrance-1", id],
      );
      expect(binding.rowCount).toBe(0);
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect((await checkin("test-entry-1", id, p)).status).toBe(201);
  });
  it.each(["insert", "update"] as const)(
    "rolls back a gate request %s storage failure and safely retries",
    async (operation) => {
      const p = plate();
      const id = randomUUID();
      const suffix = randomUUID().replaceAll("-", "");
      const fn = `test_fault_${suffix}`;
      const trigger = `test_fault_trigger_${suffix}`;
      await pool.query(
        `create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.plate = '${p}' then raise exception 'injected storage failure'; end if; return NEW; end $$`,
      );
      try {
        await pool.query(
          `create trigger ${trigger} before ${operation} on gate_requests for each row execute function ${fn}()`,
        );
        const response = await checkin("test-entry-1", id, p);
        expect(response.status).toBe(500);
        expect(body(response).error.code).toBe("INTERNAL_ERROR");
        expect(
          (
            await pool.query(
              "select 1 from gate_requests where gate_id=$1 and request_id=$2",
              ["entrance-1", id],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await pool.query(
              "select 1 from sessions where building_code=$1 and plate=$2",
              [building, p],
            )
          ).rowCount,
        ).toBe(0);
        await pool.query(`drop trigger ${trigger} on gate_requests`);
        const retry = await checkin("test-entry-1", id, p);
        expect(retry.status).toBe(201);
        expect((await checkin("test-entry-1", id, p)).body).toEqual(retry.body);
        expect(
          (
            await pool.query(
              "select 1 from sessions where building_code=$1 and plate=$2 and active",
              [building, p],
            )
          ).rowCount,
        ).toBe(1);
      } finally {
        await pool.query(`drop trigger if exists ${trigger} on gate_requests`);
        await pool.query(`drop function if exists ${fn}()`);
      }
    },
  );
  it("disposes a stalled admin connection after acquiring the building lock and allows gate recovery", async () => {
    const p = plate();
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const delayedPool = {
      on: pool.on.bind(pool),
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return async (sql: string, values?: unknown[]) => {
                const result = await target.query(sql, values);
                if (sql.startsWith("SELECT code FROM buildings")) {
                  locked();
                  await new Promise((resolve) => setTimeout(resolve, 2200));
                }
                return result;
              };
            }
            if (property === "release") {
              return target.release.bind(target);
            }
            return Reflect.get(target, property) as unknown;
          },
        });
      },
    } as unknown as pg.Pool;
    const admin = request(createApp({ pool: delayedPool, config }))
      .post("/admin/residents")
      .set("Authorization", "Bearer test-admin")
      .send({ buildingCode: building, licensePlate: p })
      .then((r) => r);
    await acquired;
    const result = await admin;
    expect(result.status).toBe(503);
    const gate = await checkin("test-entry-1", randomUUID(), p);
    expect(gate.status).toBe(201);
    expect(body(gate).parkingSpaceId).toBeGreaterThan(50);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(
      (
        await pool.query(
          "select 1 from residents where building_code=$1 and plate=$2",
          [building, p],
        )
      ).rowCount,
    ).toBe(0);
  }, 8000);
  it.each(["allocation", "commit"] as const)(
    "fails closed during a stalled %s and recovers with the same ID",
    async (stage) => {
      const suffix = randomUUID().replaceAll("-", "");
      const fn = `test_delay_${suffix}`;
      const trigger = `test_trigger_${suffix}`;
      const table = stage === "allocation" ? "sessions" : "gate_requests";
      const p = plate();
      const id = randomUUID();
      await pool.query(
        `create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.plate = '${p}' then perform pg_sleep(2.2); end if; return NEW; end $$`,
      );
      try {
        await pool.query(
          stage === "allocation"
            ? `create trigger ${trigger} before insert on ${table} for each row execute function ${fn}()`
            : `create constraint trigger ${trigger} after insert on ${table} deferrable initially deferred for each row execute function ${fn}()`,
        );
        const response = await checkin("test-entry-1", id, p);
        expect(response.status).toBe(503);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await pool.query(`drop trigger ${trigger} on ${table}`);
        const before = await pool.query<{ id: string }>(
          "select id from sessions where building_code=$1 and plate=$2 and active",
          [building, p],
        );
        if (stage === "allocation") {
          expect(before.rowCount).toBe(0);
        }
        const retry = await checkin("test-entry-1", id, p);
        expect(retry.status).toBe(201);
        const after = await pool.query<{ id: string }>(
          "select id from sessions where building_code=$1 and plate=$2 and active",
          [building, p],
        );
        expect(after.rowCount).toBe(1);
        if (before.rowCount) {
          expect(after.rows[0].id).toBe(before.rows[0].id);
        }
      } finally {
        await pool.query(`drop trigger if exists ${trigger} on ${table}`);
        await pool.query(`drop function if exists ${fn}()`);
      }
    },
    10000,
  );
  it("serializes the last registration and rejects the excess", async () => {
    const count = await pool.query<{ count: number }>(
      "select count(*)::int as count from residents where building_code=$1",
      [building],
    );
    const missing = 49 - count.rows[0].count;
    expect(missing).toBeGreaterThanOrEqual(0);
    const fixtures = Array.from({ length: missing }, () => plate());
    for (const p of fixtures) {
      await pool.query(
        "insert into residents (building_code, plate) values ($1,$2)",
        [building, p],
      );
    }
    const register = (p: string) =>
      request(app)
        .post("/admin/residents")
        .set("Authorization", "Bearer test-admin")
        .send({ buildingCode: building, licensePlate: p });
    const results = await Promise.all([register(plate()), register(plate())]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(body(results.find((r) => r.status === 409)!).error.code).toBe(
      "REGISTRY_FULL",
    );
    if (fixtures.length) {
      await pool.query(
        "delete from residents where building_code=$1 and plate = any($2::text[])",
        [building, fixtures],
      );
    }
  });
  it("retains the request after a fixture release and prioritizes conflicting content", async () => {
    const id = randomUUID();
    const p = plate();
    expect((await checkin("test-entry-1", id, p)).status).toBe(201);
    await pool.query(
      "update sessions set active=false where building_code=$1 and plate=$2",
      [building, p],
    );
    expect(body(await checkin("test-entry-1", id, p)).error.code).toBe(
      "EVENT_CLOSED",
    );
    expect(body(await checkin("test-entry-1", id, plate())).error.code).toBe(
      "REQUEST_ID_CONFLICT",
    );
  });
  it("updates building limits without deleting registrations or lowering below them", async () => {
    const code = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
    const updated = {
      ...config,
      buildings: { ...config.buildings, [code]: 1 },
    };
    const p = plate();
    try {
      await updateBuildings(pool, updated);
      await pool.query(
        "insert into residents (building_code,plate) values ($1,$2)",
        [code, p],
      );
      await expect(
        updateBuildings(pool, {
          ...updated,
          buildings: { ...updated.buildings, [code]: 0 },
        }),
      ).rejects.toThrow("below existing registrations");
      await expect(updateBuildings(pool, config)).rejects.toThrow(
        "Cannot remove a building",
      );
      await initializeParking(pool, updated);
    } finally {
      await pool.query(
        "delete from residents where building_code=$1 and plate=$2",
        [code, p],
      );
      await pool.query("delete from buildings where code=$1", [code]);
    }
  });
});
