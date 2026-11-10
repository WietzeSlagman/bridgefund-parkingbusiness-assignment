export const apiOrigin = "http://127.0.0.1:3301";

export function isVisitorCarSpace(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 51 &&
    value <= 130
  );
}

export function loadDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("LOAD_DATABASE_URL is required");
  }
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55434" ||
    url.username !== "garage_load" ||
    !url.password ||
    url.pathname !== "/garage_load" ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error(
      "LOAD_DATABASE_URL must target the dedicated loopback load database",
    );
  }
  return value;
}

export function resolveLoadDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.LOAD_DATABASE_URL !== undefined) {
    return loadDatabaseUrl(env.LOAD_DATABASE_URL);
  }
  if (!env.LOAD_DB_PASSWORD) {
    throw new Error("LOAD_DB_PASSWORD is required");
  }
  const url = new URL("postgresql://garage_load@127.0.0.1:55434/garage_load");
  // URL.password preserves literal percent signs, so encode those as well.
  url.password = encodeURIComponent(env.LOAD_DB_PASSWORD);
  return loadDatabaseUrl(url.href);
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid positive integer");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new Error("Integer out of range");
  }
  return n;
}

export function percentile(values: number[], percentileValue: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1] ?? 0;
}

export function assertSimulatorStatuses(output: string): void {
  const codes = [...output.matchAll(/HTTP (\d{3})/g)].map((match) => match[1]);
  if (codes.length !== 4 || codes.some((code) => code !== "204")) {
    throw new Error("Simulator did not report four HTTP 204 responses");
  }
}
