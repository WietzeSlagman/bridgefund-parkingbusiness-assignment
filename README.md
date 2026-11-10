# ParkingBusiness assignment

PB-03 check-in and resident administration are implemented but are **not ready
for deployment**. The three latest independent-review findings have fixes and
PostgreSQL-backed regression tests; the fixes have not had a further independent
review. The latest independent review did not independently run database tests.
PB-04 checkout and PB-06 occupancy are implemented as a pilot. PB-05 payment
confirmation and its migrations are in-progress working-tree changes, not a
committed release. All are subject to the limitations below and independent review.
See [PLAN.md](PLAN.md), [the checkout spec](specs/pb-04-check-out.md), and
[BRIEF.md](BRIEF.md).
The per-attempt timer closes an acquired database connection on timeout and
prevents a late success response. If COMMIT was already sent, its outcome may be
unknown: retry the same gate request ID to recover the durable result. Timers
cannot guarantee scheduling or network delivery, and the gate must correlate
responses to its current vehicle event.

Checkout accepts an exit-gate bearer credential, a unique `X-Request-Id` and
`{ "parkingSessionId": "<uuid>", "isResident": false }`. A `402` reports an
outstanding fixed quote and does not open the barrier; the gate must recheck the
same request without starting a new payment for each repeated response. A `200`
authorizes exit and releases the recorded space. Successful retries replay the
original response. New interactions require new IDs. This pilot contract and
rechecking behavior have not been confirmed by the gate vendor; it assumes that
the gate can correlate late responses and abandons old interactions correctly.

The signed `POST /webhooks/payments` records successful full-balance payments;
the webhook never releases a space. Configure a strong `WEBHOOK_SECRET` shared
with the provider, distinct from other credentials. It verifies exactly one
lowercase hexadecimal HMAC-SHA256 over the raw JSON bytes; unsigned legacy
requests are rejected. Identical successful payment IDs are idempotent, including
after checkout; conflicting IDs and unexpected amounts return 409. Failed events
for known sessions are logged without persistence. Operators must investigate
structured payment diagnostics manually; logs do not reconcile or refund external charges. The
provider may retry rejected events for 24 hours.

Checkout B replaces the current amount: if A displayed EUR 5 and B displays
EUR 10, retrying A returns `409 CHECKOUT_SUPERSEDED`, not EUR 5. A previously
committed `200` still replays. Gate handling of 409 is not vendor-confirmed.
Unmatched signed confirmations are rejected and logged for investigation. The
pilot assumes near-instant delivery; an old payment equal to a new balance is
indistinguishable from the intended payment, and may be accepted.
The schema holds fixed interaction amounts and session payment records, with a
shared building lock for checkout and confirmations.
The current payable amount is held on the current checkout request; PostgreSQL
enforces at most one current request per session. Payment consumes that current
request, and a later top-up makes a request current again.
An interaction stores the session's paid total when its amount is issued; a later
valid session payment indicates ordinary coverage, not payment-to-quote attribution.
The provider's unsigned legacy-terminal requests are intentionally unsupported:
`X-Terminal-Compat: 1` is not authentication. Drivers using those terminals cannot
complete payment-dependent exit until upgrade or a separately authenticated
integration. Delayed payments for abandoned or renewed quotes remain unresolved;
do not treat them as safely attributable. Recorded release assumes physical
departure, which is not detected. These limitations preclude production use.

Public `GET /occupancy/{building}` lists recorded spaces and eligibility;
`GET /occupancy/{building}/availability` counts free resident, visitor-car and
visitor-motorcycle spaces separately. Both are uncached point-in-time reads, not
physical sensors or guarantees of future availability. Unknown buildings return
404; known buildings without a layout return an empty list and zero counts.
Resident administration also uses a 1,500 ms transaction deadline, including
database statement, lock and idle bounds and connection disposal on cancellation.
An admin COMMIT interrupted after being sent can have an unknown outcome: inspect
the registry before retrying, since admin requests do not have gate request IDs.

## Pricing

The category recorded at check-in determines the tariff; the checkout
`isResident` field cannot change it. Residents park free. Visitor cars cost
EUR 5 per started hour, capped at EUR 30 per Amsterdam calendar day; motorcycles
cost EUR 3 per started hour, capped at EUR 18 per Amsterdam calendar day.
Amounts are integer euro cents.

The implementation divides actual elapsed time into one-hour blocks anchored at
check-in. Each started block is charged to the Amsterdam local date on which it
starts, with that date's cap applied independently. Midnight does not split a
block; daylight-saving transitions change local-date attribution, not elapsed
duration. Zero elapsed time costs zero, and reported session minutes are rounded
down independently of billing. For example, a car from 23:45 to 00:45 costs EUR 5,
attributed to the first day; one second more starts another EUR 5 block on the
second day, before caps. The brief's 09:00–10:40 example of EUR 8.33 conflicts
with its started-hour tariff: the implemented charge is EUR 10, not prorated.
See the [checkout spec](specs/pb-04-check-out.md) and
`garage/src/parking/helpers/pricing.ts`.

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
WEBHOOK_SECRET=<strong-unique-provider-secret>
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
JSON 404. There is no global body parser; the webhook installs a route-specific
raw parser and authenticates the original bytes.

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
The committed chain contains `0000`–`0002`; `0002` creates the PB-04 checkout
tables, not the final PB-05 schema. The working-tree journal adds the currently
uncommitted `0003`–`0005` migrations described above. An earlier, different
uncommitted checkout migration sequence was consolidated into `0002`; databases
that applied that earlier sequence can have incompatible bookkeeping and schema.
Do not confuse it with the current `0003`–`0005`, or reset, edit bookkeeping, or
migrate an incompatible database blindly. Preserve its data and obtain an explicit
migration/recovery decision. The in-progress chain may change before it lands.
Earlier versions of the current uncommitted `0005` have also been applied in
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
