import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { loadParkingConfig } from "../../src/parking/config.js";
import { initializeParking } from "../../src/parking/initialize.js";
import { testDatabaseConfig } from "../test-database.js";

const secret = "test-only-payment-secret";
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
const app = createApp({ pool, config, webhookSecret: secret });
const app2 = createApp({ pool, config, webhookSecret: secret });
const session = randomUUID();
const a = randomUUID();
const b = randomUUID();
let verified = false;
const signed = (body: string, target = app) =>
  request(target)
    .post("/webhooks/payments")
    .set("Content-Type", "application/json")
    .set("X-Signature", createHmac("sha256", secret).update(body).digest("hex"))
    .send(body);
const checkout = (id: string) =>
  request(app)
    .post("/check-out")
    .set("Authorization", "Bearer exit1")
    .set("X-Request-Id", id)
    .send({ parkingSessionId: session, isResident: false });

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
  await pool.query(
    "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,checked_in_at) values ($1,'PB-AMS-2M8D',51,$2,'CAR','CAR',now()-interval '30 minutes')",
    [session, session],
  );
});
afterAll(async () => {
  if (verified) {
    await pool.query("delete from checkout_payments where session_id=$1", [
      session,
    ]);
    await pool.query("delete from checkout_requests where session_id=$1", [
      session,
    ]);
    await pool.query("delete from sessions where id=$1", [session]);
  }
  await pool.end();
});

describe("PB-05 payments", () => {
  it("rejects invalid signatures and authenticated malformed payloads", async () => {
    const valid = {
      paymentId: "sensitive-payment-opaque",
      parkingSessionId: session,
      amount: { value: 500, currency: "EUR" },
      status: "PAID",
    };
    const raw = JSON.stringify(valid);
    expect(
      (
        await request(app)
          .post("/webhooks/payments")
          .set("Content-Type", "application/json")
          .set("X-Signature", "0".repeat(64))
          .send(raw)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/webhooks/payments")
          .set("Content-Type", "application/json")
          .set("X-Signature", "A".repeat(64))
          .send(raw)
      ).status,
    ).toBe(401);
    for (const body of [
      "{",
      JSON.stringify({ ...valid, extra: 1 }),
      JSON.stringify({ ...valid, paymentId: "a\nb" }),
      JSON.stringify({ ...valid, parkingSessionId: "bad" }),
      JSON.stringify({ ...valid, amount: { value: 0, currency: "EUR" } }),
      JSON.stringify({
        ...valid,
        amount: { value: 2147483648, currency: "EUR" },
      }),
      JSON.stringify({ ...valid, amount: { value: 500, currency: "USD" } }),
    ]) {
      expect((await signed(body)).status).toBe(400);
    }
    const missing = randomUUID();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(
        (await signed(JSON.stringify({ ...valid, parkingSessionId: missing })))
          .status,
      ).toBe(404);
      expect(log).toHaveBeenCalledOnce();
      const output = String(log.mock.calls[0][0]);
      expect(JSON.parse(output) as unknown).toMatchObject({
        event: "payment_notification",
        reason: "SESSION_NOT_FOUND",
        sessionId: missing,
        paymentIdHash: expect.any(String) as unknown,
      });
      expect(output).not.toContain(secret);
      expect(output).not.toContain(valid.paymentId);
      expect(output).not.toContain('"paymentId"');
      expect(output).not.toContain('"amount"');
    } finally {
      log.mockRestore();
    }
  });
  it("authenticates, replaces, deduplicates and authorizes", async () => {
    expect((await checkout(a)).status).toBe(402);
    await pool.query(
      "update sessions set checked_in_at=now()-interval '90 minutes' where id=$1",
      [session],
    );
    expect((await checkout(b)).body as unknown).toMatchObject({
      amountDue: { value: 1000 },
    });
    expect((await checkout(a)).body as unknown).toMatchObject({
      error: { code: "CHECKOUT_SUPERSEDED" },
    });
    const event = {
      paymentId: randomUUID(),
      parkingSessionId: session,
      amount: { value: 1000, currency: "EUR" },
      status: "PAID",
    };
    const raw = JSON.stringify(event) + "\n";
    expect(
      (
        await request(app)
          .post("/webhooks/payments")
          .set("X-Terminal-Compat", "1")
          .set("Content-Type", "application/json")
          .send(raw)
      ).status,
    ).toBe(401);
    expect(
      (
        await signed(
          JSON.stringify({ ...event, amount: { value: 500, currency: "EUR" } }),
        )
      ).body as unknown,
    ).toMatchObject({ error: { code: "PAYMENT_AMOUNT_MISMATCH" } });
    const deliveries = await Promise.all([
      signed(raw),
      signed(JSON.stringify(event), app2),
    ]);
    expect(deliveries.map((r) => r.status)).toEqual([204, 204]);
    const stored = await pool.query<{ amount: number; confirmed_at: Date }>(
      "select amount,confirmed_at from checkout_payments where session_id=$1",
      [session],
    );
    expect(stored.rowCount).toBe(1);
    expect(
      (
        await signed(
          JSON.stringify({ ...event, amount: { value: 999, currency: "EUR" } }),
        )
      ).body as unknown,
    ).toMatchObject({ error: { code: "PAYMENT_ID_CONFLICT" } });
    expect(
      (await signed(JSON.stringify({ ...event, status: "FAILED" }))).status,
    ).toBe(204);
    await pool.query(
      "update checkout_payments set confirmed_at=now()-interval '16 minutes' where session_id=$1",
      [session],
    );
    await pool.query(
      "update sessions set checked_in_at=now()-interval '150 minutes' where id=$1",
      [session],
    );
    expect((await checkout(b)).body as unknown).toMatchObject({
      amountDue: { value: 500 },
    });
    expect((await signed(raw)).status).toBe(204);
    expect(
      (
        await signed(
          JSON.stringify({
            ...event,
            paymentId: randomUUID(),
            amount: { value: 500, currency: "EUR" },
          }),
        )
      ).status,
    ).toBe(204);
    expect((await checkout(b)).status).toBe(200);
    expect((await checkout(a)).body as unknown).toMatchObject({
      error: { code: "EVENT_CLOSED" },
    });
    expect((await signed(raw)).status).toBe(204);
    expect(
      (await signed(JSON.stringify({ ...event, paymentId: randomUUID() })))
        .body as unknown,
    ).toMatchObject({ error: { code: "PAYMENT_SESSION_CLOSED" } });
    expect(
      (
        await pool.query(
          "select 1 from checkout_payments where session_id=$1",
          [session],
        )
      ).rowCount,
    ).toBe(2);
  });
  it.skipIf(process.env.RUN_PAYMENT_SIMULATOR !== "1")(
    "accepts the supplied simulator's declined and retried signed scenario",
    async () => {
      const id = randomUUID();
      const requestId = randomUUID();
      const server = app.listen(0, "127.0.0.1");
      try {
        await pool.query(
          "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,checked_in_at) values ($1,'PB-AMS-2M8D',51,$2,'CAR','CAR',now()-interval '30 minutes')",
          [id, id],
        );
        expect(
          (
            await request(app)
              .post("/check-out")
              .set("Authorization", "Bearer exit1")
              .set("X-Request-Id", requestId)
              .send({ parkingSessionId: id, isResident: false })
          ).status,
        ).toBe(402);
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("No simulator listener");
        }
        const result = await promisify(execFile)(
          process.execPath,
          [
            "../simulator/send-webhook.mjs",
            "--session",
            id,
            "--amount",
            "500",
            "--scenario",
            "declined-retry",
            "--url",
            `http://127.0.0.1:${address.port}/webhooks/payments`,
          ],
          { env: { ...process.env, WEBHOOK_SECRET: secret } },
        );
        expect(result.stdout.match(/HTTP 204/g)).toHaveLength(4);
        expect(
          (
            await request(app)
              .post("/check-out")
              .set("Authorization", "Bearer exit1")
              .set("X-Request-Id", requestId)
              .send({ parkingSessionId: id, isResident: false })
          ).status,
        ).toBe(200);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await pool.query("delete from checkout_payments where session_id=$1", [
          id,
        ]);
        await pool.query("delete from checkout_requests where session_id=$1", [
          id,
        ]);
        await pool.query("delete from sessions where id=$1", [id]);
      }
    },
  );
  it("serializes replacement against confirmation across application instances", async () => {
    const id = randomUUID();
    const first = randomUUID();
    const replacement = randomUUID();
    try {
      await pool.query(
        "insert into sessions(id,building_code,space_number,plate,vehicle_type,category,checked_in_at) values ($1,'PB-AMS-2M8D',51,$2,'CAR','CAR',now()-interval '30 minutes')",
        [id, id],
      );
      const sendCheckout = (target: typeof app, requestId: string) =>
        request(target)
          .post("/check-out")
          .set("Authorization", "Bearer exit1")
          .set("X-Request-Id", requestId)
          .send({ parkingSessionId: id, isResident: false });
      expect((await sendCheckout(app, first)).status).toBe(402);
      await pool.query(
        "update sessions set checked_in_at=now()-interval '90 minutes' where id=$1",
        [id],
      );
      const event = JSON.stringify({
        paymentId: randomUUID(),
        parkingSessionId: id,
        amount: { value: 500, currency: "EUR" },
        status: "PAID",
      });
      const [confirmation, next] = await Promise.all([
        signed(event, app2),
        sendCheckout(app, replacement),
      ]);
      expect([
        [204, 200],
        [409, 402],
      ]).toContainEqual([confirmation.status, next.status]);
      expect(
        (
          await pool.query(
            "select 1 from checkout_payments where session_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(confirmation.status === 204 ? 1 : 0);
    } finally {
      await pool.query("delete from checkout_payments where session_id=$1", [
        id,
      ]);
      await pool.query("delete from checkout_requests where session_id=$1", [
        id,
      ]);
      await pool.query("delete from sessions where id=$1", [id]);
    }
  });
});
