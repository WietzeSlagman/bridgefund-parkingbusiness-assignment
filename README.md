# ParkingBusiness assignment

This TypeScript backend implements the ParkingBusiness parking pilot: check-in,
checkout, payment confirmation, resident administration and occupancy. PB-05
and its migrations `0003`–`0005` landed in commit `b1ded0c`.

**Not ready for deployment:** vendor integration assumptions and payment and
occupancy limitations preclude production use. See the [architecture and
integration decisions](docs/architecture.md) before deployment.

## Prerequisites

Node.js 26 (verified with 26.13.0), npm (11.20.0), Docker and
Docker Compose. The backend uses Express, PostgreSQL, `pg` and Drizzle. Zod
validates strict HTTP boundary schemas without coercion, reusing the shared plate
normalizer. Vitest
exercises HTTP and database integration. The lockfile pins installed packages.

## Quick demo: disposable database

Clone with `git clone --recurse-submodules <assignment-repository-url>` (shared
agent context requires private repository access; see below). From the repository
root install backend and supplied simulator dependencies:

```sh
cd garage
npm ci
cd ../simulator
npm ci
cd ../garage
```

The simulator has known vulnerable dependencies; use only trusted local data and
destinations. This demo uses public throwaway credentials and no real data. It
requires free loopback ports **55434** (PostgreSQL) and **3301** (API); do not
stop someone else's services. The scripts do **not** automatically start a database.
Do not run the demo or load test against a shared API or database.

From `garage/`, inspect projects and choose a unique unused project name (replace
the example name below after checking). Clear unintended `LOAD_*` exports in each
terminal: exports, even empty ones, override `.env.load`. Avoid exporting
`LOAD_DATABASE_URL` in this simple setup. Do not overwrite an existing `.env.load`.

```sh
docker compose ls -a
cp .env.load.example .env.load
export LOAD_PROJECT=parkingbusiness-load-yourname
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml up -d --wait
```

Before migrating, **verify ownership, loopback mapping, tmpfs storage, database and
user, and effective load settings** using the commands and cautions in
[load database setup](docs/load-database.md). Inspection can reveal credentials;
do not share its output. The expected database and user are `garage_load`; identity
alone does not establish container ownership. Then, still in `garage/`:

```sh
npm run db:migrate:load
npm run start:demo-load-api
```

Leave the API running. In a second terminal from the repository root:

```sh
cd garage
npm run start:demo
# Optional, after the demo finishes and with exclusive use of the empty garage:
LOAD_SESSIONS=80 LOAD_CONCURRENCY=8 npm run start:load-test
```

Both runners use `.env.load`, the API on `127.0.0.1:3301` and the same disposable
database, not the normal development API. A successful demo checks the supplied
simulator's declined/retry scenario and four HTTP 204 results. A failed or interrupted
run can leave active sessions; do not retry against a nonempty garage. See
[load database setup](docs/load-database.md) for checks, limitations and recovery.
Stop the API with Ctrl-C. After confirming the project and container are still yours,
remove only that temporary service (this destroys its data):

```sh
docker compose --env-file .env.load -p "$LOAD_PROJECT" -f compose.load.yaml down
```

Run cleanup in the first shell where `LOAD_PROJECT` was exported, not an unrelated
project. The `.env.load` file remains for future use; remove it manually if desired.

## Persistent local development setup

This is separate from the demo above. From `garage/`, install dependencies as
above, then, if `.env` does not already exist:

```sh
cp .env.example .env
docker compose -p parkingbusiness-foundation up -d --wait
```

The example contains publicly known passwords and API keys, **only for isolated
local development**. Never use them for a deployed service, real data or an
untrusted network. Shell exports override file values, including empty exports;
clear unintended exports before using this example. If overriding either database
password, also update the matching URL; Compose and the application read these
as separate variables.

The Compose command above starts both servers. The development database is
persisted in a Docker volume on loopback port 55432. The separate integration
test server uses loopback port 55433 and temporary storage;
its data disappears when its container is removed. These ports must be free.
Compose initializes a password only when a database is first created; changing
the environment variable does not rotate an existing database password. Do not
delete the development volume to fix a password mismatch without first protecting
its data.

### AI-agent development (secrets outside files)

Instead of the demo file, copy `garage/.env.agent.example` to `garage/.env`.
It contains only nonsecret settings. Before starting Compose, migrations, the
server or tests, inject the following into the parent shell environment using a
trusted secret manager or other private mechanism (not literal commands saved in
shell history). Compose requires both database passwords even when starting one
service. Use distinct local credentials, URL-encode special password characters
in URLs, and ensure each URL matches its corresponding Compose password.

```text
DEV_DB_PASSWORD, TEST_DB_PASSWORD
DATABASE_URL=postgresql://garage_dev:<url-encoded-dev-password>@localhost:55432/garage_dev
TEST_DATABASE_URL=postgresql://garage_test:<url-encoded-test-password>@localhost:55433/garage_test
WEBHOOK_SECRET=<strong-unique-secret>
PARKING_KEYS={"entrance-1":["<key-1>"],"entrance-2":["<key-2>"],"exit-1":["<key-3>"],"exit-2":["<key-4>"],"admin":["<key-5>"]}
```

Export each variable so child processes inherit it. Use different random keys
for each identity and the webhook. `.env` and `.env.*` are ignored except the
tracked examples; never put real secrets in the examples or source control. The
server and Drizzle commands load `garage/.env` through dotenv without overriding
the environment; Compose also prefers exported variables over its `.env` file.
Run these commands from `garage/`. Vitest does not load `.env`: export
`TEST_DATABASE_URL` separately for tests, including with the demo file. Avoid
printing environments, `docker compose config`, or secret-bearing URLs in agent
transcripts and logs. An agent or process inheriting secrets can still read them:
shell exports are not a security boundary against that process. Restrict agent
access and use only disposable credentials where exposure is unacceptable.

`DATABASE_URL` is required; `PORT` defaults to 3000 and must be an integer from
1 to 65535. The server checks the database connection at startup.

`WEBHOOK_SECRET` must be shared with the payment provider and distinct from the
gate and admin credentials. `PARKING_BUILDINGS` configures the resident-admin allowlist and per-building
registration limits, not layouts or gate routing. PB-03 fixes the pilot code,
its limit of 50 and its space layout in `garage/src/parking/pilot.ts`; changing
these requires a revised contract, not an environment override. Other configured
codes only enable resident administration, not check-in. Startup still checks the
complete configured building/limit set against the authoritative database.

Arrays permit old/new key overlap for rotation; keys cannot be duplicated. Gates
require HTTPS or a trusted TLS terminator, which this application does not provide.
The vendor has not confirmed that gates discard late responses from prior vehicle
events. A committed response may be lost, and an operator must investigate
potential orphaned sessions. Monitor retained request records and database capacity
without using plates or keys as monitoring labels. Initial startup creates the
configured buildings and pilot layout; subsequent startups reject mismatches.
To change allowed buildings or limits, stop **all** instances, configure the
complete new `PARKING_BUILDINGS` set and run `npm run db:update-buildings` from
`garage/` against the verified intended database. The update retains existing
buildings and rejects limits below existing registrations. Configure every
instance identically before restarting; rolling configuration changes are not
supported.

## Run and operate

For the persistent development setup, from `garage/`, verify `DATABASE_URL`
targets the intended development database, then run:

```sh
npm run db:migrate
npm run dev
```

Or run `npm run build` followed by `npm start`. The development API normally
uses port 3000, not the demo/load port 3301. An HTTP request to `/` returns a
JSON 404. There is no global body parser; the webhook installs a route-specific
raw parser and authenticates the original bytes.

### Entrance display

The optional separate React display uses the public pilot availability endpoint;
it needs no credentials in the browser. Start the persistent development API on
port 3000 as above first. In a second terminal from the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173). Its
development proxy forwards `/occupancy` to `http://127.0.0.1:3000`. If the API
uses another address, adjust `frontend/vite.config.js` for local development.
The proxy is not included in the production build: a deployment must serve the
built files with a same-origin proxy for `/occupancy` to the API. The display is
not a deployment-ready public server. Counts are recorded free allocations, not
physical presence or reservations; zero can also mean no configured spaces.
Updates poll approximately every five seconds; errors or readings at least 15
seconds old are marked stale. Recent changes are differences between successful
readings, not vehicle events, and intermediate changes can be missed.

From `frontend/`, run `npm test`, `npm run format:check`, `npm run build`, and
`npm audit` for frontend verification. There are no frontend lint or typecheck
scripts. These tests do not require a database.

The generated API contract is [`garage/openapi/v1.json`](garage/openapi/v1.json);
there is no documentation HTTP endpoint and the artifact version does not add a
URL prefix. After changing contract definitions or schemas, run
`npm run openapi:generate` from `garage/` and review the artifact. CI and local
verification use `npm run openapi:check` to detect drift. Runtime validation,
especially custom refinements and middleware ordering, remains authoritative.

If a gate transaction's COMMIT outcome is unknown, retry the same request ID to
recover its durable result. Admin requests have no gate request ID: inspect the
registry before retrying an interrupted COMMIT. Investigate payment diagnostics
manually; logs do not reconcile or refund external charges.

## Verification and migrations

For the manual isolated demo and load setup, including `npm run start:demo` and
`npm run start:load-test`, see [docs/load-database.md](docs/load-database.md).
The measured local result and limitations are in [docs/load-baseline.md](docs/load-baseline.md).

The reusable agent checklist is [docs/verification-procedure.md](docs/verification-procedure.md).
The GitHub Actions workflow is configured to run backend checks and PostgreSQL
integration tests on pushes and pull requests; a hosted run is still unverified.
The separate dependency-audit workflow runs full `npm audit` jobs for both `garage/` and the
supplied `simulator/`; known vulnerabilities cause those jobs to fail until fixed.
CI does not fetch the private shared-context submodule because its checks do not
need it; people and agents following the shared instructions still need access.
The supplied simulator currently has two high-severity dependency findings;
avoid using it with untrusted destinations or data and review its dependencies
before relying on it. Its supplied files have not been changed.
The documented risk acceptance and precautions are in [SECURITY.md](SECURITY.md).

Commands below run from `garage/`. Before migrating or testing, ensure the
containers and mapped ports are the intended isolated local instances; never
point tests or disposable operations at the development or production database.
The integration test rejects URL query parameters and fragments, builds fixed
local connection fields, and checks the server-reported database and user before
running migrations twice on that same connection. It compares the migration
bookkeeping to the checked-in migrations and verifies that a second run adds
nothing. This is a safeguard, not proof that the service on the port is the
intended disposable container: verify the container and mapping yourself first.
Tests apply migrations; parking tests delete only their randomly named fixtures
after verifying the database identity. The fresh-migration test also creates and
drops a uniquely named database on that verified isolated test server; its test
role therefore needs `CREATEDB` privileges. Never point it at a shared server.
Configure the test URL separately (a password is required). For the public
local development example, export `TEST_DATABASE_URL` as
`postgresql://garage_test:local_test_only@localhost:55433/garage_test`;
for the agent setup inject the matching secret URL. Then run:

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
`garage/` with the same test URL: `RUN_PAYMENT_SIMULATOR=1 npx vitest run
--no-file-parallelism tests/integration/payments.test.ts`. Use only local test
secrets and trusted destinations; see the simulator dependency risks above.

The initial migration is deliberately a no-op, apart from Drizzle's migration
bookkeeping. For later schema changes, update `src/db/schema.ts`, run
`npm run db:generate`, inspect the versioned SQL and metadata, and test the
migration against the isolated test database before applying it elsewhere.
Migration `0003` deliberately refuses to run if active sessions have existing
checkout amounts: older records do not preserve replacement ordering. Stop all
instances and obtain an operator recovery decision for these sessions; do not
delete records or guess the current amount to force the migration.
Migration `0004` transfers an existing `0003` session amount to its matching
current request only when the match is unambiguous; otherwise it aborts for
operator investigation. Stop all old application instances before migrating;
old and new versions cannot safely run together. The migration does not discard
or automatically repair ambiguous records.
Migration `0005` also refuses unsafe noncurrent, unsuperseded checkout quotes,
including different-amount stale quotes that `0004` could not identify. Resolve
these and multiple unsuperseded pending quotes (even when covered) manually with
the application stopped; it does not guess which request
was replaced or alter payment data.
The committed chain contains `0000`–`0005`; `0002` creates the PB-04 checkout
tables and `0003`–`0005` are the PB-05 migrations described above. An earlier, different
uncommitted checkout migration sequence was consolidated into `0002`; databases
that applied that earlier sequence can have incompatible bookkeeping and schema.
Do not confuse it with the current `0003`–`0005`, or reset, edit bookkeeping, or
migrate an incompatible database blindly. Preserve its data and obtain an explicit
migration/recovery decision.
Earlier versions of `0005` before it landed have also been applied in
testing; matching migration names alone do not establish matching SQL or hashes.
`db:generate` also requires a valid `DATABASE_URL`. The integration test uses
Drizzle ORM's migrator on its verified connection; the separate `db:migrate`
command uses Drizzle Kit and targets `DATABASE_URL`, not `TEST_DATABASE_URL`.
Unlike the test, that command has no test-target guard: verify its target before
running it. Do not use `db:push` as a substitute for reviewed migrations.

Stop the local services with `docker compose -p parkingbusiness-foundation stop`;
this does not remove the development volume. No reset or destructive cleanup
command is provided.

The latest full `npm audit` reported 11 moderate development-dependency findings:
the Drizzle Kit loader uses vulnerable esbuild 0.18.20, and typescript-eslint
uses vulnerable minimatch 10.2.6. The production-only audit reported zero. No
overrides are used: the latest stable upstream packages still require affected
versions. Recheck for compatible upstream fixes before updating. npm also reports
deprecated Drizzle loader packages and ESLint 9, and install-script approval
warnings. Do not expose development tooling to untrusted networks or process
untrusted glob patterns with lint tooling.

Linting uses type-aware TypeScript rules and import checks for TypeScript files;
ESLint configuration JavaScript uses the base recommended rules. Drizzle Kit's
required default configuration export and the startup logger have narrow rule
exceptions. `eslint-config-prettier` disables conflicting formatting rules.
Run `npm run format` from `garage/` to format backend-owned files with Prettier's
defaults, or `npm run format:check` to check them without writing. The scope is
limited to `garage/`; generated migrations, lockfile, dependencies and build
outputs are excluded. Prettier runs separately from ESLint.
TypeScript targets ES2023 for the supported Node 26 runtime rather than emitting
whatever syntax a future TypeScript version regards as ESNext.

## Shared Agent Context

Reusable agent rules and the shared planning workflow live in the private
repository `git@github.com:WietzeSlagman/bridgefund-shared-agent-context.git`,
consumed at `shared/agent-context`. Reviewers and CI need access to that
repository and working Git credentials. Clone with submodules using
`git clone --recurse-submodules <assignment-repository-url>`, or run
`git submodule update --init --recursive` in an existing clone.

A frontend repository can add the same submodule and reference its shared rules
from its own `AGENTS.md`, keeping frontend-specific instructions locally. Its
planning agent can also reference the shared planning workflow. See the shared
repository's README for consumer setup.
