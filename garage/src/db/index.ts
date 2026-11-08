import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { watchPool } from "./connections.js";

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1000 });
  watchPool(pool);
  return { db: drizzle(pool), pool };
}
