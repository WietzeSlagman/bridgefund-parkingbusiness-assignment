# Disposable load database

This is a **manual** setup, separate from the development and integration-test
databases. The load database has temporary storage: removing its container destroys
its contents. Never put real data in it. The demo and load runner are intended
only for this setup, not for a shared or production API.

From `garage/`, copy the separate public throwaway configuration, choose a new
Compose project name that is not in use, and start only the load database:

```sh
docker compose ls -a
cp .env.load.example .env.load
# Choose an unused name and export it as LOAD_PROJECT, for example a unique
# name starting with parkingbusiness-load-. Do not reuse an existing project.
export LOAD_PROJECT=parkingbusiness-load-yourname
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml up -d --wait
```

The fixed host port 55434 must be free; do not stop another service to free it.
Verify the container belongs to the project you just created, maps only
`127.0.0.1:55434` to PostgreSQL port 5432, and uses tmpfs rather than a named
volume or bind mount. Check the server identity as well:

```sh
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml ps
docker inspect "$(docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml ps -q load-db)"
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml exec -T load-db psql -U garage_load -d garage_load -c 'select current_database(), current_user;'
```

Inspect output locally; container inspection includes the disposable password,
so do not paste it into logs or share it. Expected database and user are both
`garage_load`. These checks are necessary before migration, but identity alone
does not prove the port is connected to this container. Verify the mapping and
storage too. Migration configuration must explicitly use this database, not the
development `DATABASE_URL` or `TEST_DATABASE_URL`. Do not run the existing
integration tests against this database: their safety guard expects the separate
test server and they may create and drop databases there.

## Start the isolated API

Install dependencies with `npm ci` in `garage/` and separately in `simulator/`.
The supplied simulator has known dependency vulnerabilities; use it only with
trusted local data and destinations. Ensure port 3301 is free and no other API is
running there. The tracked example contains public, distinct throwaway values;
never use real credentials or real data. `.env.load` is ignored. Every load npm
script explicitly loads it from `garage/`; it does not load `.env` for these
settings. Compose must always be invoked with `--env-file .env.load`.

Exported process values take precedence over file values, even empty ones, for
both Node and Compose. Clear unintended `LOAD_*` exports in every terminal; a
password override must be the same when starting Compose and running the API and
migration. Scripts derive the guarded load URL from `LOAD_DB_PASSWORD` using URL
encoding. An explicitly set `LOAD_DATABASE_URL` takes precedence (even if empty,
in which case it fails); if used, its password must match Compose and its target
must pass the same guard. Avoid exporting it for the simple workflow. The load
migration deliberately replaces `DATABASE_URL` only in its Drizzle child, even
if it was exported or present in `.env`; normal commands remain unchanged.

Only after verifying the container, mapping, tmpfs, database/user **and the
effective load configuration**, run from `garage/`:

```sh
npm run db:migrate:load
npm run start:demo-load-api
```

Keep the API running in that terminal. It binds `127.0.0.1:3301`, checks the
URL and server-reported database/user, and requires distinct configured gate
keys. Its target-token endpoint helps the runners avoid a wrong API but is **not
proof** of container identity or a security boundary; any local process knowing
the token could imitate it. The migration command applies the URL guard but cannot
prove container identity. Verify it manually, including exported values and Compose identity.
These precautions do not make the local service suitable for an untrusted host.

## Exercise and measure

In another terminal, from `garage/` (the scripts load the same file):

```sh
npm run start:demo
LOAD_SESSIONS=80 LOAD_CONCURRENCY=8 npm run start:load-test
RUN_LOAD_INTEGRATION=1 node --env-file=.env.load ./node_modules/vitest/vitest.mjs run --no-file-parallelism tests/load-runner.integration.test.ts
```

The separate `tests/load-runner.guard.test.ts` starts an instrumented fake API
on port 3301. Run it only after stopping the load API; it refuses to bind an
already occupied port. Run it separately from the opt-in real-API test above.

The demo runs the **supplied simulator** declined/retry scenario and requires
four HTTP 204 results, not merely a successful simulator process exit. Both
runners require an initially empty pilot garage and check that visitor-car spaces
are in the 51–130 range and distinct in each batch, and that occupancy matches
through pending checkout, payment and release. They check that quotes are positive
integer EUR amounts, but do **not** independently verify the tariff or pricing
boundaries: payment uses the returned amount. The load runner sends signed
JSON bytes including a trailing newline, with a unique plate, gate request IDs
and payment ID for each session. Work is in batches with at most 20 concurrent
sessions; `LOAD_SESSIONS` defaults to 40 (maximum 10000), and
`LOAD_CONCURRENCY` defaults to 8 (maximum 20). Each phase waits for the batch,
so this is not a constant-arrival-rate or saturation test. It reports per-route
status counts and nearest-rank p50/p95/max latency, plus completed sessions per
second. Request timings include client-side processing; the elapsed measurement
includes the batch occupancy checks but excludes initial target/empty checks.

The runners require exclusive use of this disposable API/database. A failed or
interrupted run can leave active sessions or retained request/payment records;
it exits nonzero and does not delete records. Stop the API and discard the
owned temporary container to clean up; never clean another database. A successful
run releases its sessions but intentionally leaves the service's durable history
until the disposable container is removed. Simulator payment calls are reported
in simulator output rather than included in the demo's per-route timings. See
[load baseline](load-baseline.md) for the measured example and its limitations.

When finished, stop the API, then confirm that the project and container are still the ones
you created, then remove only that project's load service. This permanently
destroys its temporary database; do not use `down -v` on another project.

```sh
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml down
```
