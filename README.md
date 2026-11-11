# ParkingBusiness assignment

This TypeScript backend implements the ParkingBusiness parking pilot: check-in,
checkout, payment confirmation, resident administration and occupancy.

**Not ready for deployment:** vendor integration assumptions and payment and
occupancy limitations preclude production use. See the [architecture and
integration decisions](docs/architecture.md).

## Getting Started

Node.js 26 (verified with 26.13.0), npm (11.20.0), Docker and Docker Compose.
The backend uses Express, PostgreSQL, Drizzle and Vitest.

Clone with:

```sh
git clone --recurse-submodules https://github.com/WietzeSlagman/bridgefund-parkingbusiness-assignment.git
```

## Quick Demo

Install dependencies from the repository root:

```sh
cd garage
npm ci
cd ../simulator
npm ci
cd ../garage
```

The supplied simulator has known vulnerable dependencies; use only trusted local
data and destinations. This demo uses public throwaway credentials and no real
data. It requires free loopback ports **55434** (PostgreSQL) and **3301** (API).
Do not stop someone else's services or run the demo or load test against a shared
API or database. See [SECURITY.md](SECURITY.md) for simulator precautions.

From `garage/`, inspect projects and choose an unused project name. Clear
unintended `LOAD_*` exports in each terminal, including empty exports, and avoid
exporting `LOAD_DATABASE_URL`. Do not overwrite an existing `.env.load`.

```sh
docker compose ls -a
cp .env.load.example .env.load
export LOAD_PROJECT=parkingbusiness-load-yourname
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml up -d --wait
```

Before migrating, **verify ownership, loopback mapping, tmpfs storage, database
and user, and effective load settings** using [load database setup](docs/load-database.md).
Inspection can reveal credentials; do not share its output. Database/user identity
alone does not establish container ownership. Then, still in `garage/`:

```sh
npm run db:migrate:load
npm run start:demo-load-api
```

Leave the API running. In a second terminal, from `garage/`:

```sh
npm run start:demo
# Optional visual demo, after the fast demo finishes:
npm run start:demo:visual
# Optional load test, after the demo finishes and with exclusive use of the empty garage:
LOAD_SESSIONS=80 LOAD_CONCURRENCY=8 npm run start:load-test
```

All runners use `.env.load`, the API on `127.0.0.1:3301` and the disposable
database. A successful demo checks the simulator's declined/retry scenario and
four HTTP 204 results. A failed or interrupted run can leave active sessions; do
not retry against a nonempty garage. See [load database setup](docs/load-database.md)
for checks, recovery and the visual demo setup.

Stop the API with Ctrl-C. After confirming the project and container are still
yours, remove only that temporary service (this destroys its data). Run cleanup in
the shell where `LOAD_PROJECT` was exported:

```sh
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml down
```

The `.env.load` file remains for future use; remove it manually if desired.

## Local Development

This setup is separate from the demo. From `garage/`, install dependencies with
`npm ci`, then, if `.env` does not already exist:

```sh
cp .env.example .env
docker compose -p parkingbusiness-foundation up -d --wait
```

The example contains publicly known credentials for **isolated local development
only**. Never use them with real data, deployed services or untrusted networks.
Shell exports override file values, even when empty. For private credentials and
configuration details, see [Configuration](#configuration).

Compose starts a persistent development database on loopback port 55432 and a
separate temporary integration-test server on port 55433; both ports must be free.
Compose initializes a password only when a database is first created; changing an
environment variable does not rotate an existing password. Do not delete the
development volume to fix a mismatch without first protecting its data.

Verify `DATABASE_URL` targets the intended development database, then run from
`garage/`:

```sh
npm run db:migrate
npm run dev
```

Alternatively, run `npm run build` followed by `npm start`. The development API
normally uses port 3000; `/` returns a JSON 404. The generated API contract is
[`garage/openapi/v1.json`](garage/openapi/v1.json).

Stop the local services with `docker compose -p parkingbusiness-foundation stop`;
this preserves the development volume.

### Configuration

The server and Drizzle commands load `garage/.env` without overriding shell
exports. Compose also prefers exports, while Vitest does not load `.env` at all.
If overriding a database password, update its corresponding URL too; Compose
and the application read these as separate variables.

For credentials outside files, copy `garage/.env.agent.example` to `garage/.env`
instead of `.env.example`. Inject and export the following using a trusted secret
manager or other private mechanism, not literal commands saved in shell history:

```text
DEV_DB_PASSWORD, TEST_DB_PASSWORD
DATABASE_URL=postgresql://garage_dev:<url-encoded-dev-password>@localhost:55432/garage_dev
TEST_DATABASE_URL=postgresql://garage_test:<url-encoded-test-password>@localhost:55433/garage_test
WEBHOOK_SECRET=<strong-unique-secret>
PARKING_KEYS={"entrance-1":["<key-1>"],"entrance-2":["<key-2>"],"exit-1":["<key-3>"],"exit-2":["<key-4>"],"admin":["<key-5>"]}
```

Compose requires both database passwords even when starting one service. Use
distinct credentials, URL-encode special password characters, and ensure each
URL matches its Compose password. Use different random keys for each identity
and the webhook. Never commit real secrets or print secret-bearing environments,
Compose configuration or URLs in logs or agent transcripts. An agent or process
inheriting secrets can still read them; shell exports are not a security boundary.

`DATABASE_URL` is required. `PORT` defaults to 3000 and must be an integer from
1 to 65535. The server checks its database connection at startup. The webhook
secret must be shared with the payment provider and distinct from gate and admin
credentials. Key arrays permit old/new overlap for rotation; keys cannot be
duplicated. Gate traffic requires HTTPS or a trusted TLS terminator, which this
application does not provide.

`PARKING_BUILDINGS` configures the resident-admin allowlist and per-building
registration limits, not layouts or gate routing. Only the pilot supports
check-in; its code, limit of 50 and layout are fixed in
`garage/src/parking/pilot.ts`. Changing those requires a revised contract.
Initial startup creates the configured buildings and pilot layout; subsequent
startups reject mismatches with the database. To change allowed buildings or
limits, stop **all** instances, configure the complete new set and run
`npm run db:update-buildings` from `garage/` against the verified intended
database. Existing buildings are retained, and limits below existing registrations
are rejected. Configure every instance identically before restarting; rolling
configuration changes are not supported.

### Entrance display

The optional React display reads the public pilot availability endpoint without
browser credentials. Start the development API first, then in another terminal:

```sh
cd frontend
npm ci
DISPLAY_API_TARGET=http://127.0.0.1:3000 npm run dev
```

Open the URL printed by Vite, normally <http://127.0.0.1:5173>. For the disposable
demo API, use `DISPLAY_API_TARGET=http://127.0.0.1:3301` instead and run
`npm run start:demo:visual` in `garage/`. Set the target explicitly and restart
Vite after changing it. Counts reflect recorded allocations, not physical
presence or reservations; zero can also mean no configured spaces. The display
polls approximately every five seconds and marks errors or readings at least 15
seconds old as stale. Changes between readings are not vehicle events and can be
missed. Requests taking over five seconds are aborted and retried; a development
React Strict Mode remount can also cancel the first request and immediately retry.
The Vite proxy is not included in the production build: deployment requires a
same-origin proxy for `/occupancy` to the API. The display is not a
deployment-ready public server.

## Testing

Before database tests, verify the intended isolated test container, its port
mapping, temporary storage and database/user identity. Never point tests at a
development, production or shared database. Tests apply migrations and create
fixtures; the fresh-migration test also creates and drops a uniquely named database
on the test server, so the test role needs `CREATEDB` privileges. The test's
identity checks do not prove that the service on the port is your intended
container.

Vitest requires `TEST_DATABASE_URL` to be exported separately. For the public
local example, use
`postgresql://garage_test:local_test_only@localhost:55433/garage_test`; otherwise
inject the matching secret URL. After verifying the container and mapping, run
from `garage/`:

```sh
docker compose -p parkingbusiness-foundation exec -T test-db psql -U garage_test -d garage_test -c 'select current_database(), current_user;'
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run openapi:check
npm test
```

To exercise the supplied simulator against an isolated in-process server and
the verified test database, first run `npm ci` in `simulator/`, then run from
`garage/` with the same test URL:

```sh
RUN_PAYMENT_SIMULATOR=1 npx vitest run --no-file-parallelism tests/integration/payments.test.ts
```

Use only trusted local data, destinations and test secrets; see [SECURITY.md](SECURITY.md).
For frontend verification, run `npm test`, `npm run format:check`, `npm run build`
and `npm audit` from `frontend/`. Frontend tests do not require a database; there
are no frontend lint or typecheck scripts.

GitHub Actions is configured to run backend checks and PostgreSQL integration
tests on pushes and pull requests; a hosted run is still unverified. Separate
dependency-audit jobs run full `npm audit` for `garage/` and `simulator/` and fail
while known vulnerabilities remain. The [verification procedure](docs/verification-procedure.md)
is the reusable checklist for agents.

## Operations

### Migrations

`npm run db:migrate` targets `DATABASE_URL`, not `TEST_DATABASE_URL`, and has no
test-target guard. Verify the target before running it. For schema changes, update
`garage/src/db/schema.ts`, run `npm run db:generate` from `garage/` with a valid
`DATABASE_URL`, review the generated SQL and metadata, and test the migration
against an isolated test database. Do not use `db:push` as a substitute for
reviewed migrations.

Stop all old application instances before migrating; old and new versions cannot
safely run together. Migrations `0003` through `0005` refuse certain ambiguous
checkout records rather than guessing or changing payment data. An earlier
uncommitted migration sequence and earlier test versions of `0005` can have
incompatible schema or bookkeeping; matching migration names alone do not prove
matching SQL or hashes. Preserve affected data and obtain an explicit recovery
decision rather than deleting records, editing bookkeeping or migrating blindly.

### Recovery

If a gate transaction's COMMIT outcome is unknown, retry the same request ID to
recover its durable result. Admin requests have no gate request ID: inspect the
registry before retrying an interrupted COMMIT. A committed gate response can
still be lost, and the vendor has not confirmed that gates discard late responses
from earlier vehicle events. Operators may need to investigate orphaned sessions.
Monitor retained request records and database capacity without using plates or
keys as monitoring labels. Payment diagnostics do not reconcile or refund external
charges; investigate them manually.

### API contract

After changing contract definitions or schemas, run `npm run openapi:generate`
from `garage/` and review the generated artifact. `npm run openapi:check` detects
drift. There is no documentation HTTP endpoint or URL version prefix; runtime
validation, including custom refinements and middleware ordering, remains
authoritative.

## Further Documentation

- [Architecture and integration decisions](docs/architecture.md): pilot behavior, assumptions and deployment blockers.
- [Load database setup](docs/load-database.md) and [load baseline](docs/load-baseline.md): disposable demo, load checks and measured limitations.
- [Security](SECURITY.md): dependency risks and precautions.

## Shared Agent Context

Reusable agent rules and the shared planning workflow live in the private
repository `git@github.com:WietzeSlagman/bridgefund-shared-agent-context.git`,
consumed at `shared/agent-context`. People and agents following those rules need
access and working Git credentials. In an existing clone, run
`git submodule update --init --recursive`. CI does not fetch the submodule because
its checks do not need it. See the shared repository's README for consumer setup.
