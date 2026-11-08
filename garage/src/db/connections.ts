import type pg from "pg";

const watchedPools = new WeakSet<pg.Pool>();

/** pg emits idle-client failures on the pool; never log the underlying error. */
export function watchPool(pool: pg.Pool): void {
  if (watchedPools.has(pool)) {
    return;
  }
  watchedPools.add(pool);
  pool.on("error", () => {
    // eslint-disable-next-line no-console -- sanitized operational signal
    console.error("An idle database connection failed");
  });
}

/** Own errors while checked out, and never return a broken client to the pool. */
export async function acquireClient(pool: pg.Pool) {
  watchPool(pool);
  const client = await pool.connect();
  let broken = false;
  let released = false;
  const onError = () => {
    broken = true;
  };
  client.on("error", onError);
  return {
    client,
    isBroken: () => broken,
    release: (destroy = false) => {
      if (released) {
        return;
      }
      released = true;
      client.release(destroy || broken);
      client.removeListener("error", onError);
    },
  };
}
