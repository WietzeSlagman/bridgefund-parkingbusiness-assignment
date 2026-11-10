import { createApp } from "../app.js";
import express from "express";
import { createDatabase } from "../db/index.js";
import { loadParkingConfig } from "../parking/config.js";
import { initializeParking } from "../parking/initialize.js";
import { required, resolveLoadDatabaseUrl } from "./safety.js";

async function main() {
  const url = resolveLoadDatabaseUrl(process.env);
  const entry = required("LOAD_ENTRANCE_KEY");
  const exit = required("LOAD_EXIT_KEY");
  const secret = required("LOAD_WEBHOOK_SECRET");
  const runToken = required("LOAD_RUN_TOKEN");
  const config = loadParkingConfig({
    PARKING_BUILDINGS: JSON.stringify({ "PB-AMS-2M8D": 50 }),
    PARKING_KEYS: JSON.stringify({
      "entrance-1": [entry],
      "entrance-2": [required("LOAD_ENTRANCE_2_KEY")],
      "exit-1": [exit],
      "exit-2": [required("LOAD_EXIT_2_KEY")],
      admin: [required("LOAD_ADMIN_KEY")],
    }),
  });
  const { pool } = createDatabase(url);
  try {
    const result = await pool.query<{ name: string; username: string }>(
      "select current_database() as name, current_user as username",
    );
    if (
      result.rows[0]?.name !== "garage_load" ||
      result.rows[0].username !== "garage_load"
    ) {
      throw new Error("Wrong load database identity");
    }
    await initializeParking(pool, config);
    const wrapper = express();
    wrapper.get("/__load_target", (req, res) => {
      if (req.get("x-load-token") !== runToken) {
        res.sendStatus(403);
        return;
      }
      res.json({ target: "garage_load", version: 1 });
    });
    wrapper.use(createApp({ pool, config, webhookSecret: secret }));
    const server = wrapper.listen(3301, "127.0.0.1", () => {
      // eslint-disable-next-line no-console -- local operator startup message
      console.log("Load API listening on 127.0.0.1:3301");
    });
    server.on("error", () => {
      void pool.end();
      process.exitCode = 1;
    });
    const stop = () =>
      server.close(() => {
        void pool.end();
      });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    await pool.end();
    throw error;
  }
}
main().catch(() => {
  // eslint-disable-next-line no-console -- sanitized operator error
  console.error(
    "Load API startup failed; check isolated database and configuration",
  );
  process.exitCode = 1;
});
