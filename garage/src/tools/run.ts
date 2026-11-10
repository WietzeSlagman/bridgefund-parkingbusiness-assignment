import { createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  apiOrigin,
  assertSimulatorStatuses,
  isVisitorCarSpace,
  percentile,
  required,
} from "./safety.js";
import { runnerOptions, visualSchedule } from "./visual.js";

type Space = { parkingSpaceId: number; isOccupied: boolean };
type Session = {
  parkingSessionId: string;
  parkingSpaceId: number;
  checkoutId: string;
  amount?: number;
};
type Result = { status: number; data: unknown };
const exec = promisify(execFile);
const times: Record<string, number[]> = {};
const statuses: Record<string, number> = {};
const entry = required("LOAD_ENTRANCE_KEY");
const exit = required("LOAD_EXIT_KEY");
const secret = required("LOAD_WEBHOOK_SECRET");
const token = required("LOAD_RUN_TOKEN");
const interruption = new AbortController();
function logVisual(message: string): void {
  // eslint-disable-next-line no-console -- show visual phase transitions
  console.log(message);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    interruption.abort();
    // eslint-disable-next-line no-console -- warn that in-flight requests may have committed
    console.error(
      "Interrupted; active sessions may remain. Stop the API and discard only the verified owned disposable container.",
    );
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  });
}

async function request(
  name: string,
  path: string,
  init?: RequestInit,
): Promise<Result> {
  const start = performance.now();
  try {
    const response = await fetch(apiOrigin + path, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10000),
        interruption.signal,
      ]),
    });
    statuses[`${name}:${response.status}`] =
      (statuses[`${name}:${response.status}`] ?? 0) + 1;
    const text = await response.text();
    return {
      status: response.status,
      data:
        text &&
        response.headers.get("content-type")?.includes("application/json")
          ? (JSON.parse(text) as unknown)
          : null,
    };
  } finally {
    (times[name] ??= []).push(performance.now() - start);
  }
}
function expectStatus(result: Result, status: number, operation: string): void {
  if (result.status !== status) {
    throw new Error(
      `${operation}: expected ${status}, received ${result.status}`,
    );
  }
}
function post(body: string, key: string, id: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "x-request-id": id,
    },
    body,
  };
}
async function occupancy(): Promise<Space[]> {
  const result = await request("occupancy", "/occupancy/PB-AMS-2M8D");
  expectStatus(result, 200, "occupancy");
  if (!Array.isArray(result.data) || result.data.length !== 150) {
    throw new Error("Invalid occupancy response");
  }
  if (
    result.data.some((entry: unknown, index: number) => {
      if (!entry || typeof entry !== "object") {
        return true;
      }
      const space = entry as Partial<Space>;
      return (
        space.parkingSpaceId !== index + 1 ||
        typeof space.isOccupied !== "boolean"
      );
    })
  ) {
    throw new Error("Invalid occupancy entries");
  }
  return result.data as Space[];
}
async function phase<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(items.map(fn));
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    throw new Error(
      `Phase failed for ${failed.length} request(s): ${String(failed[0].reason)}`,
    );
  }
}
function verifySpaces(spaces: Space[], expected: number[]): void {
  const occupied = spaces
    .filter((space) => space.isOccupied)
    .map((space) => space.parkingSpaceId)
    .sort((a, b) => a - b);
  if (
    JSON.stringify(occupied) !==
    JSON.stringify([...expected].sort((a, b) => a - b))
  ) {
    throw new Error("Occupancy does not match expected allocations");
  }
}
async function checkIn(key: string): Promise<Session> {
  const body = JSON.stringify({
    vehicleType: "CAR",
    isResident: false,
    licensePlate: `L${randomUUID().replaceAll("-", "").slice(0, 15)}`,
  });
  const result = await request(
    "check-in",
    "/check-in",
    post(body, key, randomUUID()),
  );
  expectStatus(result, 201, "check-in");
  const data = result.data as {
    parkingSessionId?: unknown;
    parkingSpaceId?: unknown;
  };
  if (
    typeof data?.parkingSessionId !== "string" ||
    !isVisitorCarSpace(data.parkingSpaceId)
  ) {
    throw new Error("Invalid check-in response");
  }
  return {
    parkingSessionId: data.parkingSessionId,
    parkingSpaceId: data.parkingSpaceId,
    checkoutId: randomUUID(),
  };
}

async function quote(s: Session, key: string): Promise<void> {
  const result = await request(
    "checkout-quote",
    "/check-out",
    post(
      JSON.stringify({
        parkingSessionId: s.parkingSessionId,
        isResident: false,
      }),
      key,
      s.checkoutId,
    ),
  );
  expectStatus(result, 402, "checkout quote");
  const data = result.data as {
    amountDue?: { value?: unknown; currency?: unknown };
    parkingSpaceId?: unknown;
  };
  if (
    data.parkingSpaceId !== s.parkingSpaceId ||
    !Number.isSafeInteger(data.amountDue?.value) ||
    (data.amountDue?.value as number) <= 0 ||
    data.amountDue?.currency !== "EUR"
  ) {
    throw new Error("Invalid checkout quote");
  }
  s.amount = data.amountDue?.value as number;
}

async function runBatch(count: number, demo: boolean): Promise<void> {
  const sessions: Session[] = [];
  const slots = Array.from({ length: count });
  await phase(slots, async () => {
    sessions.push(await checkIn(entry));
  });
  if (new Set(sessions.map((s) => s.parkingSpaceId)).size !== count) {
    throw new Error("Duplicate concurrent allocation");
  }
  verifySpaces(
    await occupancy(),
    sessions.map((s) => s.parkingSpaceId),
  );
  await phase(sessions, async (s) => quote(s, exit));
  verifySpaces(
    await occupancy(),
    sessions.map((s) => s.parkingSpaceId),
  );
  await phase(sessions, async (s) => pay(s, demo));
  verifySpaces(
    await occupancy(),
    sessions.map((s) => s.parkingSpaceId),
  );
  await phase(sessions, async (s) => release(s, exit));
  verifySpaces(await occupancy(), []);
}
async function pay(s: Session, demo: boolean): Promise<void> {
  if (demo) {
    const { stdout } = await exec(
      process.execPath,
      [
        "../simulator/send-webhook.mjs",
        "--session",
        s.parkingSessionId,
        "--amount",
        String(s.amount),
        "--scenario",
        "declined-retry",
        "--url",
        `${apiOrigin}/webhooks/payments`,
      ],
      {
        env: {
          ...process.env,
          WEBHOOK_SECRET: secret,
          NO_PROXY: "127.0.0.1",
          no_proxy: "127.0.0.1",
        },
        timeout: 15000,
        signal: interruption.signal,
      },
    );
    assertSimulatorStatuses(stdout);
    // eslint-disable-next-line no-console -- show actual simulator outcomes
    console.log(stdout.trim());
  } else {
    const raw =
      JSON.stringify({
        paymentId: randomUUID(),
        parkingSessionId: s.parkingSessionId,
        amount: { value: s.amount, currency: "EUR" },
        status: "PAID",
      }) + "\n";
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    const result = await request("payment", "/webhooks/payments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
      },
      body: raw,
    });
    expectStatus(result, 204, "payment");
  }
}
async function release(s: Session, key: string): Promise<void> {
  const result = await request(
    "checkout-release",
    "/check-out",
    post(
      JSON.stringify({
        parkingSessionId: s.parkingSessionId,
        isResident: false,
      }),
      key,
      s.checkoutId,
    ),
  );
  expectStatus(result, 200, "checkout release");
  const data = result.data as {
    parkingSpaceId?: unknown;
    amountDue?: { value?: unknown };
  };
  if (data.parkingSpaceId !== s.parkingSpaceId || data.amountDue?.value !== 0) {
    throw new Error("Invalid release response");
  }
}
async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "demo" && mode !== "load" && mode !== "visual") {
    throw new Error("Expected demo, visual or load");
  }
  const { count, concurrency, holdSeconds } = runnerOptions(mode, process.env);
  const target = await request("target", "/__load_target", {
    headers: { "x-load-token": token },
  });
  expectStatus(target, 200, "target verification");
  if (
    JSON.stringify(target.data) !==
    JSON.stringify({ target: "garage_load", version: 1 })
  ) {
    throw new Error("Wrong API target");
  }
  verifySpaces(await occupancy(), []);
  const start = performance.now();
  if (mode === "visual" && holdSeconds !== undefined) {
    const entrances = [entry, required("LOAD_ENTRANCE_2_KEY")];
    const exits = [exit, required("LOAD_EXIT_2_KEY")];
    await visualSchedule(
      count,
      holdSeconds,
      (gate) => checkIn(entrances[gate]),
      async (session, gate) => {
        await quote(session, exits[gate]);
        await pay(session, true);
        await release(session, exits[gate]);
      },
      async (sessions) =>
        verifySpaces(
          await occupancy(),
          sessions.map((s) => s.parkingSpaceId),
        ),
      (ms) => delay(ms, undefined, { signal: interruption.signal }),
      logVisual,
    );
  } else {
    for (let done = 0; done < count; done += concurrency) {
      await runBatch(Math.min(concurrency, count - done), mode !== "load");
    }
  }
  const elapsed = (performance.now() - start) / 1000;
  if (holdSeconds !== undefined) {
    // eslint-disable-next-line no-console -- visual demo summary, not a benchmark
    console.log(
      JSON.stringify(
        {
          mode,
          sessions: count,
          holdSeconds,
          elapsedSeconds: elapsed,
          statuses,
          note: "Simulator payment responses are printed separately; timings include intentional holds and are not a benchmark.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const metrics = Object.fromEntries(
    Object.entries(times).map(([name, values]) => [
      name,
      {
        count: values.length,
        p50Ms: percentile(values, 50),
        p95Ms: percentile(values, 95),
        maxMs: Math.max(...values),
      },
    ]),
  );
  // eslint-disable-next-line no-console -- local benchmark report
  console.log(
    JSON.stringify(
      {
        mode,
        sessions: count,
        concurrency,
        elapsedSeconds: elapsed,
        sessionsPerSecond: count / elapsed,
        statuses,
        metrics,
      },
      null,
      2,
    ),
  );
}
main().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- report incomplete runs without exposing request data
  console.error(
    "Run failed; the disposable database may contain active sessions. Inspect it or discard the owned container:",
    error instanceof Error ? error.message : "unknown error",
  );
  // eslint-disable-next-line no-console -- preserve observed status counts on failed runs
  console.error("Observed HTTP statuses:", JSON.stringify(statuses));
  process.exitCode ??= 1;
});
