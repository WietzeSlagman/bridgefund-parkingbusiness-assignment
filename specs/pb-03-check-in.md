# PB-03: Check-in and resident registry

## Story and Outcome

PB-03 (`BRIEF.md`): an entrance gate checks a vehicle in, starts a parking session and receives an eligible space. This spec also covers the resident administration needed to determine eligibility, an agreed addition to the brief.

## Scope

### In Scope

- Authenticated entrance-gate check-in for pilot building `PB-AMS-2M8D`, with persistent sessions and safe allocation.
- Plate normalization, registry-based resident entitlement, category capacity and duplicate active plates.
- Admin-key-protected registration, listing and removal of plates by allowed building code.
- Durable gate request identity, successful retry replay and concurrent request protection.
- Pilot layout initialization, migrations and PostgreSQL-backed verification.

### Out of Scope

- Checkout, payments, pricing calculations, occupancy endpoint and physical departure confirmation. Later specs determine exit transitions; PB-03 must not implement them early.
- Resident profiles, self-service registration, a key-management API and an interface for configuring building layouts or tariffs.
- Check-in for other buildings: their layouts and tariffs are not specified even if their codes are allowed for resident administration.

## Sources and Dependencies

- `BRIEF.md` PB-02/PB-03 and pilot layout; `docs/gates.md` for gate IDs, request IDs and plate examples.
- `docs/architecture.md` for agreed eligibility, credentials and lifecycle direction; `docs/payment-provider.md` for downstream context only.
- Existing Express/Drizzle/PostgreSQL foundation and `docs/verification-procedure.md`. PB-03 parking schema and endpoints have since been implemented; see Handoff Status for open review findings.
- PB-04–PB-06 will specify checkout, release, payment and occupancy separately. PB-03 stores enough information for later work without implementing those features.

## Decisions, Assumptions, and Open Questions

### Decisions

- The check-in gate is associated with pilot building `PB-AMS-2M8D`. Configure a list of permitted building codes for resident administration; include the pilot. Registry records are scoped by building and plate.
- A registered plate receives a free resident space regardless of button selection or `CAR`/`MOTOR`. Reject an unregistered resident claim. An unregistered visitor gets a paid space for its vehicle type.
- Fix entitlement at check-in. A visitor session stays paid if the plate is subsequently registered; a registered plate's active resident session prevents its removal.
- Reject duplicate active normalized plates. Normalize ASCII letters to uppercase and remove ASCII spaces and hyphens; accepted input contains only ASCII letters, digits, spaces and hyphens and normalizes to 1–16 alphanumeric characters. Accented and non-Latin plates are unsupported in the pilot.
- Pilot resident capacity is 50 registrations. Only registered plates can occupy the 50 resident spaces. Visitor car and motorcycle categories have no fallback. Select the lowest-numbered available eligible space.
- Use distinct configuration-managed keys per gate, scoped to gate type, and a separate admin key. Caller identity comes from the authenticated key.
- Successful check-in retries with the same gate, operation, UUID request ID and validated request replay the original `201` while the session remains active; different request content with the same ID conflicts. After release, return `409 EVENT_CLOSED` and retain the request record. Treat equivalent normalized plate representations as the same content.
- Model buildings in the database. Register the pilot at startup/setup with resident capacity 50; configure allowed building codes and their per-building registration limits. No building management API is included.
- The gate owns each vehicle event and its request ID. The vendor notes say the barrier acts on the first `2xx` for the event. Responses are ordinary HTTP responses to gate requests, not callbacks.
- Use `Authorization: Bearer <key>`; admin create, list and delete use the routes and building-code placement below.
- Trust the authenticated gate's valid `CAR`/`MOTOR` value; do not independently classify the physical vehicle. Misclassification can assign an unsuitable space and tariff.
- Keys are independent, randomly generated and provided via server configuration; no live key appears in source, examples or logs.
- The same normalized plate and building registered twice yields `409`; deleting an absent registration yields `404`. Initially only the pilot is configured. Each additional building requires an explicit registration limit; its configured code alone does not enable check-in.
- Once a validated check-in has been bound to a request ID, business failures can be retried with that same ID and request and reevaluated; successful outcomes are replayed while active. Invalid or unauthenticated requests do not bind an ID. Bindings are retained for the pilot, including business failures, to make conflicting reuse detectable.
- Use a **1,500 ms per-attempt check-in processing budget**, measured from receipt by the application using a monotonic clock. The gate waits two seconds before retrying; the nominal 500 ms margin leaves time for the response to travel, but cannot guarantee delivery within that wait. Fail safely when work cannot complete in time and document the remaining risk of a committed but unacted-on response. Changes to building configuration require a coordinated stop, update and restart of all instances.
- `parkingSpaceId` is the physical space number within the pilot building, not an arbitrary database-generated identifier. Each space stores its building, physical number, floor and eligibility; future buildings need not use the pilot's numeric/category mapping.

### Assumptions

- The gate can submit one of the brief's supported vehicle types and honors the documented first-2xx behavior. Correct correlation of responses to the current vehicle event, including discarding old responses after that event ends, is a **required but unverified gate capability and a deployment precondition**, not a guarantee established by the notes.
- Deployment provides HTTPS between gates and the application or a trusted TLS terminator; this is not implemented by the existing foundation.

### Open Questions and Conflicts

- The initial building configuration contains only `PB-AMS-2M8D`; no other building's capacity is known. Rolling configuration changes are out of scope; they require a coordinated stop/restart as described below.
- The 1,500 ms application budget cannot guarantee that the gate receives or acts on a response within two seconds: network delays, scheduling and uncertain database commit outcomes remain possible. It does not establish an event expiration time or prove a vehicle entered.
- The notes do not detail handling of responses arriving after the gate moves to another vehicle event; confirm with the vendor for a real deployment. A server cannot retract a response already in flight. Retain deduplication records even after release; do not silently expire them. PB-04 must atomically make released sessions ineligible for a new `201` replay.
- The brief supplies `vehicleType` in the check-in request but does not say how the gate determines it. Trusting the gate is the agreed pilot policy, not evidence that classification is accurate.
- The intended later lifecycle releases the recorded space on exit authorization, not confirmed physical departure. PB-03 cannot guarantee physical resident capacity if a vehicle remains after authorization. PB-04 must specify the actual release transition.
- Gate credentials and deployment must use HTTPS as described by `docs/gates.md`; TLS termination/deployment is outside the current foundation and must be documented rather than claimed implemented.
- An independent review flagged an apparent departure-policy conflict in an earlier journal entry. The user subsequently chose release at exit authorization as a pilot approximation; `docs/architecture.md` records that later decision. Actual departure confirmation remains a recommended future capability, not a current assumption.

## Acceptance Criteria

- A valid entrance request creates one active session and returns an eligible space with `201`; the pilot's 150 spaces and floors match the brief.
- Registered cars and motorcycles get resident spaces even if visitor was selected; an unregistered resident selection fails without allocation; an unregistered visitor gets the matching vehicle category.
- Identical normalized active plates cannot check in twice, including across gates and concurrent requests. A space cannot be assigned to two active sessions, including under concurrent requests or bypass of application-level availability checks.
- Concurrent requests for the final eligible space yield at most one success; concurrent successful allocations select different spaces. A full visitor category returns `409 CATEGORY_FULL`; full resident capacity fails safely without paid fallback.
- No more than 50 pilot registrations exist, even with concurrent registration requests. Duplicate normalized registrations conflict. Removal cannot succeed while that plate has an active resident session; concurrent removal/check-in cannot violate resident capacity.
- Successful same-ID retries return the original session and space while the session remains active, after a timeout or restart and including overlapping requests. Once released, the same ID returns `409 EVENT_CLOSED`. Conflicting reuse of a bound ID returns `409`; failed work leaves no partial session or allocation.
- Unauthenticated callers, exit-gate credentials and admin credentials cannot check in. Gate credentials cannot administer residents. Keys and plates are not logged unnecessarily; public exposure is out of scope.
- Failures to access PostgreSQL cannot produce a success response without a committed allocation. Business rules remain correct across application instances.
- A check-in exceeding its processing budget fails closed when the transaction is known to have rolled back. An uncertain commit must never be reported as a definite rollback; same-ID recovery checks durable state. No success is sent without a known committed result.
- Instances with configuration inconsistent with the authoritative database building configuration fail startup before serving requests. Building configuration changes occur only when every instance is stopped.

## API Contract

This section specifies the proposed pilot contract. JSON responses use `Content-Type: application/json` unless empty. Errors have shape `{"error":{"code":"CODE","message":"..."}}`; messages contain no secrets or database details. Require JSON for request bodies and reject unexpected fields. Authorization uses `Authorization: Bearer <key>`; require exactly one valid credential. Missing/invalid credentials return `401 UNAUTHORIZED`; a valid key with the wrong role returns `403 FORBIDDEN`. Never echo keys.

### `POST /check-in`

Caller: authenticated `entrance-1` or `entrance-2`. Header: `X-Request-Id`, a UUID, required; no building code in the body because both pilot entrance keys are bound to `PB-AMS-2M8D`.

```json
{"vehicleType":"CAR","isResident":false,"licensePlate":"ab-123-c"}
```

Require exactly `vehicleType` (`CAR` or `MOTOR`), `isResident` (boolean) and `licensePlate` (string meeting the normalization rules). On success:

```http
HTTP/1.1 201 Created
Content-Type: application/json

{"parkingSessionId":"b4862cc2-3b43-4acd-ab6d-5f1f7dab71f0","parkingSpaceId":51}
```

The space shown is an example assuming no earlier eligible visitor-car space is occupied. Return `400 INVALID_REQUEST` for malformed JSON, missing/invalid headers or fields; `415 UNSUPPORTED_MEDIA_TYPE` for a non-JSON body; `409` with `RESIDENT_NOT_REGISTERED`, `ACTIVE_SESSION_EXISTS`, `CATEGORY_FULL`, `REQUEST_ID_CONFLICT` or `EVENT_CLOSED` as applicable; and `503 SERVICE_UNAVAILABLE` when the database cannot safely complete the operation. Unexpected internal failures return `500 INTERNAL_ERROR` without sensitive details.

Scope a request ID to authenticated gate identity plus `POST /check-in`; canonical content consists of vehicle type, resident selection and normalized plate. Bind a valid request before evaluating mutable business conditions; identical in-flight requests serialize or wait for the winner, then replay a committed success while the session is active or reevaluate a business failure. After release, return `409 EVENT_CLOSED` instead of replaying `201`; retain the binding. A conflicting body never mutates state. An error before durable binding can be retried; success, session creation, allocation and replay result commit together. A response lost after commit is replayed while active, including after process restart. No time-based automatic deletion is included.

After authentication and validation, request-ID conflict takes precedence over `EVENT_CLOSED` or business evaluation. For a matching request, a successful released session gives `EVENT_CLOSED`; a matching active success replays. For a fresh or previously failed attempt, evaluate in order: resident entitlement, duplicate active plate, then category availability. A known processing timeout returns `503 SERVICE_UNAVAILABLE`; an unknown commit outcome does not claim rollback, and must be resolved via the same request ID.

### Resident administration

Caller: the separately configured admin key. An entrance or exit key is forbidden. Building codes must be exact entries in the configured allowlist; missing or disallowed codes return `400 INVALID_BUILDING`. Check-in still only serves the pilot.

**`POST /admin/residents`** — JSON body:

```json
{"buildingCode":"PB-AMS-2M8D","licensePlate":"ab-123-c"}
```

On registration return `201` and `{"buildingCode":"PB-AMS-2M8D","licensePlate":"AB123C"}`. Duplicate normalized building/plate returns `409 RESIDENT_ALREADY_REGISTERED`, including when the registry is full; otherwise a full registry returns `409 REGISTRY_FULL`. Validate the same plate rules as check-in.

**`GET /admin/residents?buildingCode=PB-AMS-2M8D`** — `200` with `{"buildingCode":"PB-AMS-2M8D","licensePlates":["AB123C"]}`; return an empty array when none exist. Sort normalized plates ascending. Responses contain no names or other person profile. Set `Cache-Control: no-store` on this sensitive listing.

**`DELETE /admin/residents/AB123C?buildingCode=PB-AMS-2M8D`** — normalize the URL-decoded plate using the same rules. Return `204` with no body on removal, `404 RESIDENT_NOT_FOUND` if absent, or `409 RESIDENT_HAS_ACTIVE_SESSION` if its active resident session prevents removal. A second deletion is therefore `404`, not a replayed `204`.

Admin requests with malformed values return `400 INVALID_REQUEST`, unauthorized/forbidden as above, `415` for a non-JSON POST body, `503 SERVICE_UNAVAILABLE` for database unavailability and `500 INTERNAL_ERROR` for unexpected failures. Unlike gates, the supplied vendor `X-Request-Id` contract does not apply to admin calls; duplicate creates are conflicts.

## Error Cases

| Condition | Response or behavior | Notes |
| --------- | -------------------- | ----- |
| Missing/invalid key; wrong role | `401`; `403` for known wrong role | No business state changed |
| Invalid request, UUID, plate or building | `400`; non-JSON body `415` | Do not disclose secrets |
| Unregistered resident claim | `409 RESIDENT_NOT_REGISTERED` | May retry as visitor with a new request ID |
| Plate already active | `409 ACTIVE_SESSION_EXISTS` | Includes same plate on another gate |
| Eligible category full | `409 CATEGORY_FULL` | No fallback; resident full also fails safely |
| Request ID reused with different canonical request | `409 REQUEST_ID_CONFLICT` | Existing binding unchanged |
| Retry of successful check-in after session release | `409 EVENT_CLOSED` | Retain binding; release is a future feature |
| Duplicate registration / 51st registration | `409 RESIDENT_ALREADY_REGISTERED` / `REGISTRY_FULL` | Under concurrency as well |
| Remove missing / active resident registration | `404 RESIDENT_NOT_FOUND` / `409 RESIDENT_HAS_ACTIVE_SESSION` | No removal on conflict |
| DB unavailable or transaction fails | `503` if unavailable; otherwise `500` | No success without commit; recovery retry is safe |

## Behavior and State

- Maintain a building record, configuration allowlist and configured registration capacity for each allowed building; initialize the pilot building at capacity 50. Seed pilot spaces once with stable physical numbers, floor and category: 1–50 resident, 51–75 car floor 1, 76–130 car floor 2, 131–150 motorcycle floor 2. Numbers are unique within a building; any internal key must not replace the physical number returned as `parkingSpaceId`. The gate does not submit a space ID. Migrations/setup must be repeatable without overwriting existing registry data or allocations. Never silently remove building records or lower capacity below existing registrations; fail clearly on inconsistent configuration. Choose and document a safe initialization mechanism.
- Database building configuration is authoritative at runtime. All instances validate their complete configured code/limit set against the database at startup and refuse to serve on mismatch. Operators stop all instances before applying a serialized, transactional configuration update; the update must reject capacity below existing registrations and must not delete existing data. Restart only after each instance has the same updated configuration. Rolling changes and building administration APIs are out of scope.
- Store normalized plate, vehicle type, actual resident/visitor category, assigned building and space, and check-in instant for each session. The actual category remains fixed. A session is active until a future feature explicitly releases it; PB-03 provides no production release endpoint. Tests may create isolated fixture states without pretending checkout exists.
- Enforce uniqueness of active space allocation and active normalized plate within the pilot building at the database level, for example with appropriate partial unique indexes. Maintain referential integrity between sessions and valid spaces. Allocation, session creation and successful idempotency result commit together.
- Coordinate allocation so selection is the **lowest available eligible** space even under contention: do not treat a temporarily locked lower space as unavailable and falsely report full or assign a higher space. Use a transaction/locking strategy whose concurrency behavior is verified against PostgreSQL.
- Define a serialization order per building and category: at a successful allocation's serialization point, select the lowest eligible space not assigned by earlier committed operations in that order. All allocation and future release paths must use compatible coordination. Bound database lock waiting and return a non-2xx on timeout; a gate timeout does not itself cancel a transaction.
- Enforce the 1,500 ms per-attempt budget with database-side statement/lock bounds and cancellation/rollback for work that has not committed, checking the remaining budget before starting the commit. The budget covers application processing from receipt, including authentication, validation, pool/lock waits and transaction work; each HTTP retry has its own budget, not a new vehicle-event lifetime. On timeout, do not abandon a still-running transaction in a pool. A commit already sent may have an unknown result; reconcile using the durable request record rather than assume cancellation. No server-side deadline guarantees that a committed response is delivered or that the barrier opened.
- Serialize registration capacity changes per building and coordinate resident registration removal with check-in's eligibility lookup and session creation. The 50-registration limit and removal rule must hold for overlapping transactions. Use database constraints where applicable and transactional locking for cross-row limits.
- Binding an authenticated gate request ID and canonical content is durable before a business failure is returned. A successful binding/result and its allocation commit atomically; no incomplete attempt may strand a permanently unresolvable in-progress record after a crash. Specify transaction and recovery behavior in implementation; do not rely on a single-process mutex.
- Registration and check-in involving a plate must serialize such that the check-in has a consistent before-or-after view: category is fixed by the registry state at its check-in transaction. The later paid-visitor registration case is permitted.
- Use a shared database-backed lock domain that also covers an absent registry row, with a consistent lock order for requests, registrations and allocations. If registration wins, a subsequent check-in is resident; if visitor check-in wins, it remains paid. If removal wins, a subsequent resident claim fails; if resident check-in wins, removal conflicts.
- Request identity is a stable configured gate ID, not the key value. Rotating a key must preserve that identity; reject ambiguous duplicate credentials at startup. During rotation, allow old and new keys for the same gate and role to overlap, mapping both to that stable identity; never permit a key to identify multiple gates or roles, and never persist raw keys as request IDs. Operators remove the old key after deployment.
- The externally observable request lifecycle is absent → bound/pending → successful; bound business failures may be reevaluated and canonical content cannot change. Success and allocation commit together. After a crash or uncertain commit, serialize through database state and return success only when the durable result is known; retry the same ID safely.
- For PB-03 the agreed ID scope remains gate plus operation; gate notes say one UUID per vehicle event but do not define cross-operation reuse. PB-04 must explicitly resolve cross-operation scope before sharing request records or changing gate roles; key rotation is not a new gate identity.
- Request records are retained, including failures. Monitor database space and request-record growth and alert an operator before exhaustion; do not log plates or secrets as monitoring labels. If durable binding or allocation cannot be written, fail closed rather than admit without a record. An operator investigates potentially orphaned sessions; this spec supplies no automatic release or cleanup API and cannot prove a vehicle entered.

## Verification

- Unit/HTTP: plate normalization, 1/16/17-character boundaries, unsupported/non-Latin characters, invalid JSON/types/UUID, exact field handling, role permissions, building allowlist, and no secrets in errors.
- Registry: create/list/delete with canonical plates; duplicates, full registry, missing records and removal of an active resident session; separate configured buildings and pilot-only check-in.
- PostgreSQL concurrency: simultaneous 50th/51st registrations, same-plate registration, removal versus resident check-in, registration versus visitor check-in, same and different plates at two gates, final space contention, and DB-level uniqueness against direct conflicting writes.
- Deterministically pause a transaction holding the lowest eligible candidate and exercise both commit and rollback while a competing request waits; verify the serialization order and no false-full outcome. Exercise both registry/check-in orderings, including an initially absent registration and separate application instances.
- Retry/failure: identical overlapping requests, normalized-equivalent requests, changed-body conflict, failure followed by successful retry, DB failure/rollback, response lost after commit, process restart and replay. Demonstrate no stranded request binding or partial allocation.
- Force check-in past the configured budget, including lock waits and uncertain commit/response timing; verify rollback where known, same-ID recovery where uncertain and no duplicate allocation. Test duplicate-versus-full and conflicting-ID-versus-closed precedence.
- Verify mismatched building configuration fails startup, coordinated capacity updates reject values below registrations, and instances agree after restart. Test request-record storage failure fails closed; document monitoring and operator response.
- Fault-inject before and after binding, allocation commit and response transmission, including competing bodies; test retry across key rotation and reject duplicate configured keys. Using an isolated released-session fixture, test `EVENT_CLOSED` and retained request identity; actual release is a PB-04 responsibility. Gate handling after a later vehicle event begins remains unspecified by the vendor.
- Allocation: all eligibility combinations, floor boundaries, lowest eligible space, full categories, and no fallback. Ensure tests use isolated disposable PostgreSQL, never development data.
- Verify migrations and initial layout from a fresh isolated database and on repeat application, then run the configured lint, formatting, type-check, build and tests per `docs/verification-procedure.md`. Tests must not assume PB-04/05 already exist.

## Implementation Tasks

- [ ] **Configure identities and buildings**: Validate allowed building codes, per-gate role/key configuration and separate admin key; document safe provisioning and HTTPS assumptions. Dependencies: confirmed API/auth assumptions. Acceptance criteria: only authorized roles access operations. Verification: startup and HTTP authorization tests.
- [ ] **Create schema and pilot layout**: Add migrations and safe initialization for spaces, registry, active sessions and request records; add database uniqueness and referential constraints. Dependencies: accepted persistence design. Acceptance criteria: stable layout and enforced allocation/plate uniqueness. Verification: migration and direct-constraint integration tests.
- [ ] **Implement registry**: Add administration and transaction-safe per-building limits/removal. Dependencies: schema and admin authentication. Acceptance criteria: allowed buildings, registration rules and resident capacity under contention. Verification: HTTP and PostgreSQL concurrency tests.
- [ ] **Implement check-in**: Validate and normalize input, determine fixed category, allocate the lowest eligible space and create a session atomically. Dependencies: schema, entrance authentication and registry. Acceptance criteria: eligibility and allocation rules hold under concurrency. Verification: HTTP and PostgreSQL race tests.
- [ ] **Implement request replay**: Persist gate identity, canonical content and successful outcome; handle failures, overlapping retries and crash recovery. Dependencies: schema and check-in transaction design. Acceptance criteria: no duplicate side effects or conflicting reuse. Verification: retry, failure and restart integration tests.
- [ ] **Document and verify**: Document configuration, initialization, limitations and actual commands; execute verification procedure and seek independent review. Dependencies: preceding tasks. Acceptance criteria: fresh setup and tests support the contract without exposing secrets. Verification: isolated database checks and recorded review.

## Handoff Status

The PB-03 spec was committed in `8a0891a` before implementation in `564e3f9`. The implementation tasks above have corresponding code and tests, but remain unchecked pending independent review and verification of all acceptance criteria. Fixes for the latest three independent-review findings (admin lock bounds, missing-building error, and request-record storage fault coverage) passed the developer's PostgreSQL-backed suite and configured checks; they have not had further independent review. The previous independent review did not independently run database tests. PB-03 is not deployment-ready. The 1,500 ms budget and physical-space-number mapping are confirmed pilot decisions; safe deployment requires verification of the gate's event-correlation capability. PB-04–PB-06 still require their own specs committed before their corresponding implementations, with explicit user authorization for commits.
