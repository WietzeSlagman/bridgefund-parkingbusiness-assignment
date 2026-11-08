import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { createDatabase } from "./db/index.js";
import { loadParkingConfig } from "./parking/config.js";
import { updateBuildings } from "./parking/initialize.js";

async function main() {
  const config = loadConfig(process.env);
  const parking = loadParkingConfig(process.env);
  const { pool } = createDatabase(config.databaseUrl);
  try {
    await updateBuildings(pool, parking);
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  // eslint-disable-next-line no-console -- do not expose connection details
  console.error(
    "Building update failed; verify configuration and registration limits",
  );
  process.exitCode = 1;
});
