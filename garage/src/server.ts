import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createDatabase } from "./db/index.js";

async function main() {
  const config = loadConfig(process.env);
  const { pool } = createDatabase(config.databaseUrl);
  try {
    await pool.query("SELECT 1");
  } catch {
    await pool.end();
    throw new Error("Database connection failed");
  }
  const server = createApp().listen(config.port, () => {
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
