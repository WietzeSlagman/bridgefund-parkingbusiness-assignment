import { spawnSync } from "node:child_process";
import { resolveLoadDatabaseUrl } from "./safety.js";

try {
  const url = resolveLoadDatabaseUrl(process.env);
  // The load target intentionally replaces DATABASE_URL for this child only.
  const result = spawnSync(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "migrate"],
    {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    },
  );
  if (result.error || result.status !== 0) {
    process.exitCode = 1;
  }
} catch {
  // eslint-disable-next-line no-console -- do not expose URLs or credentials
  console.error(
    "Invalid isolated load database configuration; migration not started",
  );
  process.exitCode = 1;
}
