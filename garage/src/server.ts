import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createDatabase } from "./db/index.js";
import { loadParkingConfig } from "./parking/config.js";
import { initializeParking } from "./parking/initialize.js";

async function main() {
  const config = loadConfig(process.env);
  const parkingConfig = loadParkingConfig(process.env);
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret.startsWith("CHANGE_ME")) {
    throw new Error("Invalid webhook configuration");
  }
  const { pool } = createDatabase(config.databaseUrl);
  try {
    await pool.query("SELECT 1");
  } catch {
    await pool.end();
    throw new Error("Database connection failed");
  }
  try {
    await initializeParking(pool, parkingConfig);
  } catch {
    await pool.end();
    throw new Error(
      "Parking initialization failed or building configuration mismatched",
    );
  }
  const server = createApp({
    pool,
    config: parkingConfig,
    webhookSecret,
  }).listen(config.port, () => {
    // Startup logging is the only logging currently available.
    // eslint-disable-next-line no-console
    console.log(`Listening on port ${config.port}`);
  });
  server.on("error", () => {
    // eslint-disable-next-line no-console -- report startup failure without internal details
    console.error("HTTP server failed to start");
    void pool.end().finally(() => {
      process.exitCode = 1;
    });
  });
  const shutdown = () =>
    server.close(() => {
      void pool.end();
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- report a sanitized startup failure
  console.error(error instanceof Error ? error.message : "Startup failed");
  process.exitCode = 1;
});
