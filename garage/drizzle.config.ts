import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { loadConfig } from "./src/config/index.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: { url: loadConfig(process.env).databaseUrl },
});
