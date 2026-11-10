import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import net from "node:net";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase } from "../../src/db/index.js";
import { loadParkingConfig } from "../../src/parking/config.js";
import { initializeParking } from "../../src/parking/initialize.js";
import { testDatabaseConfig } from "../test-database.js";

const url = process.env.TEST_DATABASE_URL;
const control = new pg.Pool(testDatabaseConfig(url));
const buildings = '{"PB-AMS-2M8D":50}';
const keys =
  '{"entrance-1":["a"],"entrance-2":["b"],"exit-1":["c"],"exit-2":["d"],"admin":["e"]}';
const config = loadParkingConfig({
  PARKING_BUILDINGS: buildings,
  PARKING_KEYS: keys,
});
const fixtures: { id: string; plate: string }[] = [];

beforeAll(async () => {
  const client = await control.connect();
  try {
    expect(
      (
        await client.query(
          "select current_database() as name, current_user as username",
        )
      ).rows[0],
    ).toEqual({ name: "garage_test", username: "garage_test" });
    await migrate(drizzle(client), { migrationsFolder: "./migrations" });
  } finally {
    client.release();
  }
  await initializeParking(control, config);
});
afterAll(async () => {
  for (const { id, plate } of fixtures) {
    await control.query(
      "delete from gate_requests where gate_id='entrance-1' and request_id=$1",
      [id],
    );
    await control.query("delete from sessions where plate=$1", [plate]);
  }
  await control.end();
});

function fixture() {
  const value = {
    id: randomUUID(),
    plate: randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase(),
  };
  fixtures.push(value);
  return value;
}
const payload = (plate: string) => ({
  vehicleType: "CAR",
  isResident: false,
  licensePlate: plate,
});

// PostgreSQL's unencrypted simple-query protocol allows interception at the
// COMMIT boundary. Buffer complete frames: TCP chunks are not messages.
async function proxy(
  mode: "before" | "during" | "after" | "hold-after",
  initiallyArmed = true,
) {
  let trigger!: () => void;
  const reached = new Promise<void>((resolve) => {
    trigger = resolve;
  });
  const sockets = new Set<net.Socket>();
  let armed = initiallyArmed;
  const server = net.createServer((incoming) => {
    const upstream = net.connect(55433, "127.0.0.1");
    incoming.setNoDelay(true);
    upstream.setNoDelay(true);
    sockets.add(incoming);
    sockets.add(upstream);
    incoming.on("error", () => undefined);
    upstream.on("error", () => undefined);
    incoming.on("close", () => {
      sockets.delete(incoming);
      upstream.destroy();
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      incoming.destroy();
    });
    let startup = true;
    let input = Buffer.alloc(0);
    let output = Buffer.alloc(0);
    let committing = false;
    let holding = false;
    incoming.on("data", (chunk: Buffer) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= (startup ? 4 : 5)) {
        const length = input.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
        if (input.length < length) {
          break;
        }
        const frame = input.subarray(0, length);
        input = input.subarray(length);
        if (startup) {
          startup = false;
          upstream.write(frame);
          continue;
        }
        if (
          armed &&
          frame[0] === 81 &&
          frame.subarray(5, -1).toString() === "COMMIT"
        ) {
          armed = false;
          committing = true;
          if (mode === "before") {
            trigger();
            incoming.destroy();
            upstream.destroy();
            return;
          }
          upstream.write(frame);
          if (mode === "during") {
            trigger();
          }
        } else {
          upstream.write(frame);
        }
      }
    });
    upstream.on("data", (chunk: Buffer) => {
      output = Buffer.concat([output, chunk]);
      while (output.length >= 5) {
        const length = output.readInt32BE(1) + 1;
        if (output.length < length) {
          break;
        }
        const frame = output.subarray(0, length);
        output = output.subarray(length);
        if (holding) {
          continue;
        }
        if (
          committing &&
          (mode === "after" || mode === "hold-after") &&
          frame[0] === 67 &&
          frame.subarray(5, -1).toString() === "COMMIT"
        ) {
          trigger();
          if (mode === "hold-after") {
            holding = true;
            continue;
          }
          incoming.destroy();
          upstream.destroy();
          return;
        }
        incoming.write(frame);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Proxy has no port");
  }
  const proxied = new URL(url!);
  proxied.port = String(address.port);
  return {
    url: proxied.toString(),
    reached,
    arm: () => {
      armed = true;
    },
    disconnect: () => sockets.forEach((socket) => socket.destroy()),
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function state(id: string, plate: string) {
  const records = await control.query(
    "select session_id, plate from gate_requests where gate_id='entrance-1' and request_id=$1",
    [id],
  );
  const sessions = await control.query(
    "select id, space_number from sessions where plate=$1",
    [plate],
  );
  return {
    records: records.rows as { session_id: string; plate: string }[],
    sessions: sessions.rows as { id: string; space_number: number }[],
  };
}

it.each(["before", "during", "after"] as const)(
  "recovers after real connection loss %s COMMIT",
  async (mode) => {
    const { id, plate } = fixture();
    const fn = `test_commit_${randomUUID().replaceAll("-", "")}`;
    const triggerName = `${fn}_trigger`;
    if (mode === "during") {
      await control.query(
        `create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.plate = '${plate}' then perform pg_sleep(5); end if; return NEW; end $$`,
      );
      await control.query(
        `create constraint trigger ${triggerName} after insert on gate_requests deferrable initially deferred for each row execute function ${fn}()`,
      );
    }
    const link = await proxy(mode);
    const { pool } = createDatabase(link.url);
    const app = createApp({ pool, config });
    try {
      const attempt = request(app)
        .post("/check-in")
        .set("Authorization", "Bearer a")
        .set("X-Request-Id", id)
        .send(payload(plate))
        .then((r) => r);
      await Promise.race([
        link.reached,
        attempt.then((response) => {
          throw new Error(
            `Request completed before COMMIT: ${response.status}`,
          );
        }),
      ]);
      if (mode === "during") {
        let sleeping = false;
        for (let i = 0; i < 100 && !sleeping; i++) {
          sleeping = (
            await control.query<{ sleeping: boolean }>(
              "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and query='COMMIT') as sleeping",
            )
          ).rows[0].sleeping;
          if (!sleeping) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(sleeping).toBe(true);
        link.disconnect();
      }
      expect((await attempt).status).toBe(503);
      if (mode === "during") {
        await control.query(`drop trigger ${triggerName} on gate_requests`);
      }
      const prior = await state(id, plate);
      if (mode !== "during") {
        expect(prior.sessions.length).toBe(mode === "after" ? 1 : 0);
      }
      expect(prior.records.length).toBe(prior.sessions.length);
      const retry = await request(app)
        .post("/check-in")
        .set("Authorization", "Bearer a")
        .set("X-Request-Id", id)
        .send(payload(plate));
      expect(retry.status).toBe(201);
      const conflict = await request(app)
        .post("/check-in")
        .set("Authorization", "Bearer a")
        .set("X-Request-Id", id)
        .send(payload(`${plate}X`));
      expect(conflict.status).toBe(409);
      expect((conflict.body as { error: { code: string } }).error.code).toBe(
        "REQUEST_ID_CONFLICT",
      );
      const durable = await state(id, plate);
      expect(durable.records).toHaveLength(1);
      expect(durable.sessions).toHaveLength(1);
      expect(durable.records[0].session_id).toBe(durable.sessions[0].id);
      expect(retry.body).toEqual({
        parkingSessionId: durable.sessions[0].id,
        parkingSpaceId: durable.sessions[0].space_number,
      });
      if (prior.sessions.length) {
        expect(durable.sessions).toEqual(prior.sessions);
      }
    } finally {
      await pool.end();
      await link.close();
      if (mode === "during") {
        await control.query(
          `drop trigger if exists ${triggerName} on gate_requests`,
        );
        await control.query(`drop function if exists ${fn}()`);
      }
    }
  },
  15000,
);

it.each(["before", "after", "lost-response"] as const)(
  "recovers a signed payment after %s fault",
  async (phase) => {
    const id = randomUUID();
    const requestId = randomUUID();
    const paymentId = randomUUID();
    const secret = "test-only-payment-secret";
    const direct = createApp({ pool: control, config, webhookSecret: secret });
    const link = await proxy(phase === "lost-response" ? "hold-after" : phase);
    const { pool } = createDatabase(link.url);
    const app = createApp({ pool, config, webhookSecret: secret });
    const raw = JSON.stringify({
      paymentId,
      parkingSessionId: id,
      amount: { value: 500, currency: "EUR" },
      status: "PAID",
    });
    const call = () =>
      request(app)
        .post("/webhooks/payments")
        .set("Content-Type", "application/json")
        .set(
          "X-Signature",
          createHmac("sha256", secret).update(raw).digest("hex"),
        )
        .send(raw);
    const checkout = () =>
      request(direct)
        .post("/check-out")
        .set("Authorization", "Bearer c")
        .set("X-Request-Id", requestId)
        .send({ parkingSessionId: id, isResident: false });
    try {
      await control.query(
        "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,checked_in_at) select $1,s.building_code,s.number,$2,'CAR','CAR',now()-interval '30 minutes' from spaces s where s.building_code='PB-AMS-2M8D' and s.category='CAR' and not exists (select 1 from sessions x where x.building_code=s.building_code and x.space_number=s.number and x.active) order by s.number limit 1",
        [id, id],
      );
      expect((await checkout()).status).toBe(402);
      const pending = call();
      const attempt = pending.then(
        (response) => ({ status: response.status }),
        () => ({ status: undefined }),
      );
      await Promise.race([
        link.reached,
        attempt.then((response) => {
          throw new Error(`Payment returned before COMMIT: ${response.status}`);
        }),
      ]);
      if (phase === "lost-response") {
        pending.abort();
        expect((await attempt).status).toBeUndefined();
      } else {
        expect((await attempt).status).toBe(503);
      }
      const before = await control.query<{ confirmed_at: Date }>(
        "select confirmed_at from checkout_payments where payment_id=$1",
        [paymentId],
      );
      expect(before.rowCount).toBe(phase === "before" ? 0 : 1);
      expect((await call()).status).toBe(204);
      const after = await control.query<{ confirmed_at: Date }>(
        "select confirmed_at from checkout_payments where payment_id=$1",
        [paymentId],
      );
      expect(after.rowCount).toBe(1);
      if (before.rowCount) {
        expect(after.rows[0].confirmed_at).toEqual(before.rows[0].confirmed_at);
      }
      expect((await call()).status).toBe(204);
      expect((await checkout()).status).toBe(200);
    } finally {
      await pool.end();
      await link.close();
      await control.query("delete from checkout_payments where session_id=$1", [
        id,
      ]);
      await control.query("delete from checkout_requests where session_id=$1", [
        id,
      ]);
      await control.query("delete from sessions where id=$1", [id]);
    }
  },
  15000,
);

async function startServer(
  port: number,
  databaseUrl = url,
): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      PARKING_BUILDINGS: buildings,
      PARKING_KEYS: keys,
      WEBHOOK_SECRET: "test-only-webhook-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Server startup timed out"));
    }, 10000);
    child.stdout.on("data", (data: Buffer) => {
      if (data.toString().includes("Listening on port")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Server exited during startup"));
    });
  });
  return child;
}

it("replays durable state after killing and restarting the actual server process", async () => {
  const { id, plate } = fixture();
  const listener = net.createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const address = listener.address();
  if (!address || typeof address === "string") {
    throw new Error("No test port");
  }
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let child: ChildProcess | undefined;
  const stop = async () => {
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) =>
        child!.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await exited;
    }
  };
  try {
    child = await startServer(port);
    const endpoint = `http://127.0.0.1:${port}`;
    const call = (p: string) =>
      request(endpoint)
        .post("/check-in")
        .set("Authorization", "Bearer a")
        .set("X-Request-Id", id)
        .send(payload(p));
    const first = await call(plate);
    expect(first.status).toBe(201);
    await stop();
    child = await startServer(port);
    const replay = await call(plate);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const conflict = await call(`${plate}X`);
    expect(conflict.status).toBe(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe(
      "REQUEST_ID_CONFLICT",
    );
    const durable = await state(id, plate);
    expect(durable.records).toHaveLength(1);
    expect(durable.sessions).toHaveLength(1);
    expect(durable.records[0].session_id).toBe(durable.sessions[0].id);
    expect(replay.body).toEqual({
      parkingSessionId: durable.sessions[0].id,
      parkingSpaceId: durable.sessions[0].space_number,
    });
  } finally {
    await stop();
  }
}, 30000);

it.each(["after", "during"] as const)(
  "recovers after process death %s COMMIT before an HTTP response",
  async (phase) => {
    const { id, plate } = fixture();
    const fn = `test_crash_${randomUUID().replaceAll("-", "")}`;
    const triggerName = `${fn}_trigger`;
    const listener = net.createServer();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    if (!address || typeof address === "string") {
      throw new Error("No test port");
    }
    const port = address.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const link = await proxy(
      phase === "after" ? "hold-after" : "during",
      false,
    );
    let child: ChildProcess | undefined;
    const kill = async () => {
      if (child?.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) =>
          child!.once("exit", () => resolve()),
        );
        child.kill("SIGKILL");
        await exited;
        expect(child.signalCode).toBe("SIGKILL");
      }
    };
    try {
      child = await startServer(port, link.url);
      if (phase === "during") {
        await control.query(
          `create function ${fn}() returns trigger language plpgsql as $$ begin if NEW.plate = '${plate}' then perform pg_sleep(5); end if; return NEW; end $$`,
        );
        await control.query(
          `create constraint trigger ${triggerName} after insert on gate_requests deferrable initially deferred for each row execute function ${fn}()`,
        );
      }
      link.arm();
      const endpoint = `http://127.0.0.1:${port}`;
      const call = (p: string) =>
        request(endpoint)
          .post("/check-in")
          .set("Authorization", "Bearer a")
          .set("X-Request-Id", id)
          .send(payload(p));
      let responded = false;
      const attempt = call(plate).then(
        (response) => {
          responded = true;
          return { status: response.status };
        },
        () => ({ status: undefined }),
      );
      await Promise.race([
        link.reached,
        attempt.then((result) => {
          throw new Error(
            `Request ended before crash point: ${String(result.status)}`,
          );
        }),
      ]);
      if (phase === "during") {
        let sleeping = false;
        for (let i = 0; i < 100 && !sleeping; i++) {
          sleeping = (
            await control.query<{ sleeping: boolean }>(
              "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and query='COMMIT') as sleeping",
            )
          ).rows[0].sleeping;
          if (!sleeping) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(sleeping).toBe(true);
      }
      const beforeKill = await state(id, plate);
      if (phase === "after") {
        expect(beforeKill.records).toHaveLength(1);
        expect(beforeKill.sessions).toHaveLength(1);
        expect(beforeKill.records[0].session_id).toBe(
          beforeKill.sessions[0].id,
        );
      } else {
        expect(beforeKill.records).toHaveLength(0);
        expect(beforeKill.sessions).toHaveLength(0);
      }
      expect(responded).toBe(false);
      await kill();
      expect((await attempt).status).toBeUndefined();
      if (phase === "during") {
        // DROP waits for the original COMMIT to finish, regardless of outcome.
        await control.query(`drop trigger ${triggerName} on gate_requests`);
      }
      const prior = await state(id, plate);
      expect(prior.records.length).toBe(prior.sessions.length);
      if (phase === "after") {
        expect(prior).toEqual(beforeKill);
      }
      child = await startServer(port);
      const replay = await call(plate);
      expect(replay.status).toBe(201);
      const conflict = await call(`${plate}X`);
      expect(conflict.status).toBe(409);
      expect((conflict.body as { error: { code: string } }).error.code).toBe(
        "REQUEST_ID_CONFLICT",
      );
      const durable = await state(id, plate);
      expect(durable.records).toHaveLength(1);
      expect(durable.sessions).toHaveLength(1);
      expect(durable.records[0].session_id).toBe(durable.sessions[0].id);
      expect(replay.body).toEqual({
        parkingSessionId: durable.sessions[0].id,
        parkingSpaceId: durable.sessions[0].space_number,
      });
      if (prior.sessions.length) {
        expect(durable).toEqual(prior);
      }
    } finally {
      await kill();
      await link.close();
      if (phase === "during") {
        await control.query(
          `drop trigger if exists ${triggerName} on gate_requests`,
        );
        await control.query(`drop function if exists ${fn}()`);
      }
    }
  },
  30000,
);
