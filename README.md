# ParkingBusiness assignment

PB-03 check-in and resident administration are under development and are **not
ready for deployment**: implementation and verification are incomplete. Checkout,
payment and occupancy endpoints do not exist. See [PLAN.md](PLAN.md) and [BRIEF.md](BRIEF.md).
The per-attempt timer closes an acquired database connection on timeout and
prevents a late success response. If COMMIT was already sent, its outcome may be
unknown: retry the same gate request ID to recover the durable result. Timers
cannot guarantee scheduling or network delivery, and the gate must correlate
responses to its current vehicle event.

## Local setup

Parking-specific HTTP routers are in `garage/src/parking/routers/` and their
validation, timing and HTTP helpers are in `garage/src/parking/helpers/`.
Parking business operations are in `garage/src/parking/services/`; the shared
building row lock is acquired before request and session writes, and future
release paths must use the same lock order. Parking configuration, initialization and HTTP transaction failure mapping remain
in `garage/src/parking/`; generic transaction mechanics and shared database code
live in `garage/src/db/`.

Requirements: Node.js 26 (verified with 26.13.0), npm (11.20.0), Docker and
Docker Compose. The backend uses Express, PostgreSQL, `pg` and Drizzle. Zod
validates strict HTTP boundary schemas without coercion, reusing the shared plate
normalizer. Vitest
exercises HTTP and database integration. The lockfile pins installed packages.

Clone with submodules as below, then from the repository root:

```sh
cd garage
npm ci
```

Set two distinct local-only passwords in your shell; use URL-safe characters
or URL-encode them in the URLs. Do not reuse production credentials. Compose
requires both variables, even when starting only one service:

```sh
export DEV_DB_PASSWORD='<your-local-dev-password>'
export TEST_DB_PASSWORD='<your-local-test-password>'
docker compose -p parkingbusiness-foundation up -d --wait
```

The development database is persisted in a Docker volume on loopback port
55432. The separate test server uses loopback port 55433 and temporary storage;
its data disappears when its container is removed. These ports must be free.
Compose initializes a password only when a database is first created; changing
the environment variable does not rotate an existing database password. Do not
delete the development volume to fix a password mismatch without first protecting
its data.

Copy `garage/.env.example` to `garage/.env` and replace the placeholder with
the development password. `.env` is ignored by Git. `DATABASE_URL` is required;
`PORT` defaults to 3000 and must be an integer from 1 to 65535. The server
checks the database connection at startup. Parking startup also requires the
following environment variables, with each placeholder replaced by a different,
randomly generated secret. Keep real keys out of source control and shell history.

```text
PARKING_BUILDINGS={"PB-AMS-2M8D":50}
PARKING_KEYS={"entrance-1":["<key>"],"entrance-2":["<key>"],"exit-1":["<key>"],"exit-2":["<key>"],"admin":["<key>"]}
```

`PARKING_BUILDINGS` configures the resident-admin allowlist and per-building
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
supported. To run from `garage/`:

```sh
npm run db:migrate
npm run dev
```

Or run `npm run build` followed by `npm start`. An HTTP request to `/` returns a
JSON 404. There is no global body parser; future webhook work must install a raw
parser before any JSON parser and authenticate the original bytes.

## Verification and migrations

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
Configure the test URL
separately (a password is required):

```sh
export TEST_DATABASE_URL="postgresql://garage_test:${TEST_DB_PASSWORD}@localhost:55433/garage_test"
docker compose -p parkingbusiness-foundation exec -T test-db psql -U garage_test -d garage_test -c 'select current_database(), current_user;'
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
```

The initial migration is deliberately a no-op, apart from Drizzle's migration
bookkeeping. For later schema changes, update `src/db/schema.ts`, run
`npm run db:generate`, inspect the versioned SQL and metadata, and test the
migration against the isolated test database before applying it elsewhere.
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
