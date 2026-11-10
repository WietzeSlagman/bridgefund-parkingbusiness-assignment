import { boundedInteger } from "./safety.js";

export function runnerOptions(
  mode: "demo" | "load" | "visual",
  env: NodeJS.ProcessEnv,
): { count: number; concurrency: number; holdSeconds?: number } {
  if (mode === "demo") {
    return { count: 1, concurrency: 1 };
  }
  if (mode === "visual") {
    const { sessions, holdSeconds } = visualOptions(env);
    return { count: sessions, concurrency: 1, holdSeconds };
  }
  return {
    count: boundedInteger(env.LOAD_SESSIONS, 40, 10000),
    concurrency: boundedInteger(env.LOAD_CONCURRENCY, 8, 20),
  };
}

export function visualOptions(env: NodeJS.ProcessEnv): {
  sessions: number;
  holdSeconds: number;
} {
  const sessions = boundedInteger(env.VISUAL_SESSIONS, 8, 20);
  const holdSeconds = boundedInteger(env.VISUAL_HOLD_SECONDS, 12, 60);
  if (sessions < 2 || holdSeconds < 6) {
    throw new Error(
      "Visual demo requires at least 2 sessions and 6 seconds per hold",
    );
  }
  return { sessions, holdSeconds };
}

export async function visualSchedule<T>(
  count: number,
  seconds: number,
  arrive: (gate: number) => Promise<T>,
  depart: (session: T, gate: number) => Promise<void>,
  verify: (sessions: T[]) => Promise<void>,
  wait: (milliseconds: number) => Promise<void>,
  log: (message: string) => void,
): Promise<void> {
  const active: T[] = [];
  let arrivals = 0;
  let departures = 0;
  async function hold() {
    await verify(active);
    log(
      `Visual state: ${active.length} visitor cars allocated; holding ${seconds}s`,
    );
    await wait(seconds * 1000);
  }
  while (arrivals < count) {
    active.push(await arrive(arrivals % 2));
    arrivals++;
    await hold();
    // Keep one car parked while alternating arrivals and departures.
    if (active.length === 2 && arrivals < count) {
      await depart(active[0], departures % 2);
      active.shift();
      departures++;
      await hold();
    }
  }
  while (active.length) {
    await depart(active[0], departures % 2);
    active.shift();
    departures++;
    await hold();
  }
}
