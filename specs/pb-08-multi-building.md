# PB-08: Multi-building operations

## Story and Outcome

As a ParkingBusiness operator, I want to onboard and operate garages with their own spaces, gates and tariffs, so that expansion does not require building-specific application code (`ROADMAP.md`). The brief identifies different layouts and tariffs as future needs; it specifies only the `PB-AMS-2M8D` pilot.

**Status: provisional, not implementation-ready.** The criteria below describe target safety and integration outcomes, not approved onboarding, pricing or API decisions. Resolve the blocking questions with the user and affected vendors, then amend and review this spec before implementation. This does not yet satisfy PB-07's request for a spec implementable without further questions.

## Scope

### In Scope

- Operating more than one building through the existing parking, resident, checkout, payment and occupancy flows, with building-specific layouts and tariffs.
- Provisioning and changing building data, gate associations and pricing safely; migration of the pilot and preservation of existing session and retry state.
- Isolation, security, concurrency, failure recovery and verification across buildings.

### Out of Scope

- Multi-organization SaaS tenancy, subscriptions, reservations, reporting, refunds and automatic payment reconciliation.
- Physical departure detection or a new gate/provider protocol. This feature cannot imply vendor support for behavior they have not confirmed.

## Sources and Current Foundation

- `BRIEF.md`, `ROADMAP.md`, `docs/gates.md`, `docs/payment-provider.md`, `docs/architecture.md` and `specs/pb-03-check-in.md` through `specs/pb-06-occupancy.md`. The architecture and some spec status statements are stale; inspect current work before implementation.
- The working tree contains ongoing changes, including payment and checkout work. Observations here are not a claim that these changes are committed, reviewed, tested or deployment-ready.
- `garage/src/db/schema.ts` scopes spaces and residents by building, sessions refer to building and space, and active-space and active-plate uniqueness are per building. Session IDs and successful payment IDs are database-wide keys. The global-versus-building plate policy for future operations still needs confirmation.
- `parking/config.ts` and `parking/auth.ts` currently define fixed pilot gate identities without building associations. Check-in, checkout and the in-progress payment router use `PILOT.code`; `parking/helpers/pricing.ts` hardcodes pilot rates and Amsterdam time. The current building setup manages registration limits and seeds only the pilot layout; configured registry buildings are not automatically operational garages.
- The occupancy router reads by building and its integration tests include overlapping space numbers and empty layouts. Existing tests and code are a starting point, not proof of end-to-end multi-building support. PB-05's in-progress webhook and PB-04/05 alignment require independent review.

## Decisions, Assumptions, and Open Questions

### Existing Pilot Decisions

- PB-03 fixes eligibility at check-in, uses stable gate identity and durable request bindings, selects the lowest eligible available space, and scopes resident records and active-plate uniqueness to a building. Existing pilot behavior must not silently change.
- PB-04 prices the pilot in integer euro cents using started elapsed hours, Amsterdam local calendar-day caps and the documented grace period. Its 09:00-10:40 example costs EUR 10, rather than the brief's conflicting EUR 8.33. These are pilot decisions, not automatically the policy for other buildings.
- PB-05 requires raw-body HMAC and rejects unsigned legacy-terminal calls despite the provider's request to accept them. A compatibility header is not authentication; affected drivers need a separately authenticated solution or upgrade. Payment confirmation alone does not release a space.
- PB-06 exposes public building-scoped recorded occupancy, including an empty layout for a known building; it is not physical presence. PB-04 releases on exit authorization, not confirmed departure.

### New Confirmed Decisions

- Onboard and manage buildings through an admin API, including adding and removing spaces and registering and deregistering residents. The exact operations, permissions, lifecycle and safety rules remain open; existing resident administration provides a starting point.
- Support multiple building layouts and tariffs.
- Prioritize multi-building operations before the roadmap's metrics feature.
- For this version, tariffs use the pilot's started-hour and daily-cap structure, with different rates and caps per building and vehicle category. Other pricing structures are deferred. Exact configuration, time-zone and rounding rules for other buildings remain to be specified.
- An active session retains the tariff in effect at check-in; tariff changes apply to new sessions only.
- An administrator may remove an unoccupied space, but removal must be rejected while the space has an active session.
- A new building is unavailable for check-in until its spaces, tariffs and gates are configured and an administrator explicitly activates it. Validation and treatment of later changes remain open.
- For this version, layouts use the three existing categories: resident, visitor car and visitor motorcycle. Floors, physical space numbers and quantities can differ per building. Additional categories are deferred.
- Each gate is assigned to exactly one building through admin configuration. Its authenticated identity determines the building; an exit gate must reject a session belonging to another building. Credential provisioning, reassignment and response details remain open.
- Each building has a configured IANA time zone for its calendar-day cap; the pilot remains `Europe/Amsterdam`.
- Preserve the pilot tariff for sessions already active at PB-08 migration; drivers need not exit before migration. The migration and safe cutover procedure remain to be defined.
- Admins manage gate-to-building assignments through the admin API; gate secrets remain in deployment configuration, not issued or rotated by that API. Exact synchronization and identity lifecycle remain open.
- A gate represents a physical access point and cannot be reassigned to a different building. Its building association is immutable; credential rotation must preserve that gate identity and association. A different building requires a distinct gate identity.
- One ParkingBusiness-wide admin credential is sufficient for this version; building-specific admin authorization is deferred.
- Admins may add or remove eligible spaces and update tariffs while a building is active. Reject invalid changes atomically, retaining occupied-space protection and check-in tariff retention.

### Assumptions To Confirm

- Existing gate roles, request IDs and provider payload remain usable for new sites, subject to vendor confirmation. The notes only describe pilot gates, timeout retries and first-2xx barrier behavior; they do not promise checkout `402` support, rechecks or late-response correlation.
- The provider supplies only a session UUID, payment ID, amount and status, not a building or quote ID. Session-based routing is a possible integration, subject to the decisions below; no provider change is presumed.
- HTTPS, secret provisioning and safe operator access are deployment responsibilities, not established by the application alone.

### Blocking Questions

1. **Onboarding and lifecycle:** Which building lifecycle operations are supported beyond creation and activation? Which API fields and validations establish that its spaces, tariffs and gates are configured before explicit activation? How are later changes, partial onboarding, rollback, auditing, instance synchronization and recovery handled? Existing coordinated stop/update/restart is a pilot constraint, not an approved future rollout policy.
2. **Layout and eligibility:** What floor and space number validations, category eligibility, selection order and resident limits apply? Can the same plate have active sessions in different buildings? How are renumbering, capacity decreases and eligibility changes handled while spaces, registrations or sessions exist? How is removal of an unoccupied space recorded without losing session history?
3. **Gates and authorization:** How are gate identities named and provisioned, and how is deployment-managed secret rotation synchronized with API-managed associations? Are IDs globally unique or scoped? How are gate retirement, delayed responses, request bindings and attempts to reuse a retired identity handled without circumventing immutable building association? What wrong-building response avoids inappropriate disclosure? The safety target is no cross-building unauthorized mutation.
4. **Tariffs:** Which currency, rounding and category eligibility rules apply per building? Does the pilot grace policy apply universally? What information must be retained to reproduce the check-in tariff, including timezone and later changes? How do pending amounts, confirmed payments, grace, retries and historical audit interact with changes? What happens for missing, invalid or overlapping tariff configurations? Do not apply the pilot tariff to another site by default.
5. **Provider integration:** Are payment IDs globally unique across all buildings and provider accounts, and is there one secret or a secure way to select the correct provider credential? The supplied payload has no building identifier. How are provider accounts, routing, key rotation and duplicate/conflicting IDs scoped without trusting unauthenticated input? What is the operational response to an externally charged but rejected payment?
6. **Existing clients and records:** Must pilot gate and admin contracts remain byte-for-byte compatible, and how will new sites identify their building without permitting caller-controlled authorization bypass? How are existing gate request IDs, sessions, payments and active quotes migrated with no changed replay behavior? Confirm data retention, cutover, rollback and reconciliation responsibilities.
7. **Vendor and payment limitations:** Confirm gate handling of `402`, polling, superseded `409`, event correlation and late responses. PB-05's near-instant-delivery assumption is not a provider guarantee: delayed or extra payments, especially equal amounts across successive interactions, cannot be reliably attributed from the supplied payload. Decide whether expansion requires a changed integration or an explicitly accepted operational risk.

## Acceptance Criteria

These are provisional invariants; final acceptance examples and any policy-dependent behavior require answers above.

- At least two approved, operational buildings can use distinct configured layouts and tariffs without a pilot-specific code change. An incomplete or invalid building configuration cannot silently allocate or price a session using another building's settings.
- Authorized administrators can onboard and manage buildings, add or remove spaces, and register or deregister residents via an admin API. Unauthorized requests cannot change them; precise contracts and live-state restrictions remain open.
- A new building cannot accept check-ins before an administrator explicitly activates it with the required spaces, tariffs and gates configured. Invalid or incomplete configuration prevents activation; exact validation remains open.
- Removing a space with an active session is rejected without changing that session or space. An unoccupied space can be removed while retaining required historical references; removal and check-in races cannot leave an active session on a removed space.
- Each session uses the started-hour and daily-cap tariff in effect at check-in; a later tariff change affects new sessions, not existing ones. Rates and caps can differ by building and vehicle category.
- Configured layouts support different floors, space numbers and quantities while using only the existing resident, visitor-car and visitor-motorcycle categories.
- Gate building association comes from its authenticated identity, not an untrusted request building field. Each gate is assigned to one building and a wrong-building exit cannot affect the session.
- A gate's building association cannot be changed, including by credential rotation. An attempted reassignment is rejected without changing the association; exact response and safe retirement and identity reuse rules remain open.
- The ParkingBusiness-wide admin can manage gate associations via the API; gate secrets are deployment-managed. Invalid active-building space and tariff changes are rejected atomically without modifying existing state.
- Daily caps use each building's configured IANA time zone, with `Europe/Amsterdam` retained for the pilot. Active pilot sessions retain the pilot tariff across migration.
- An authorized entrance uses only its authorized building's registry and eligible spaces. Concurrent allocation never assigns the same building/space pair twice, including across instances; overlapping physical space numbers in different buildings remain independent. Plate and capacity rules follow the eventual approved policy and are enforced under concurrency.
- A session retains an unambiguous building association through check-in, checkout, payment and release. An unauthorized or wrong-building gate cannot quote, authorize or release another building's session. Release, payment and retries cannot affect a later occupant or another building.
- The applicable approved tariff and timezone yield reproducible integer amounts, including across changes while sessions are active; existing pilot pricing, quotes, recorded payments, grace and replay are preserved according to the agreed migration policy. Missing or ambiguous pricing fails closed, not as a free exit.
- Gate retries, concurrent requests, key rotation and uncertain commits do not duplicate allocations or authorizations. Identity and building association cannot be changed by reusing a bound request ID. Provider retries cannot double-credit or cross-credit sessions; conflicts are rejected and investigated without claiming an external charge was reversed.
- Public occupancy remains building-scoped, snapshot-consistent and free of plates, session IDs and payment information. A payment alone does not release a space; recorded availability still does not prove physical departure. Unknown and known-empty buildings retain PB-06 behavior unless a reviewed change explicitly replaces it.
- Pilot data, active sessions, credentials and previously bound requests survive migration and restart without silent deletion or reinterpretation. Failed or concurrent configuration changes do not leave a partially usable building or corrupt existing operations.

## API Contract

Existing endpoints are integration baselines, not a finalized multi-building contract. JSON error envelopes, authorization and retries follow the relevant PB-03 through PB-06 specs until reviewed changes are agreed.

| Operation and caller | Existing contract | Multi-building details still open |
| --- | --- | --- |
| Entrance gate: `POST /check-in` | Bearer entrance key, `X-Request-Id` UUID and `{vehicleType,isResident,licensePlate}`; `201` returns session UUID and physical space number. | Building is derived from the authenticated gate's immutable association; identity scope and retirement remain open. Preserve safe retry and conflict handling. |
| Exit gate: `POST /check-out` | Bearer exit key, request UUID and `{parkingSessionId,isResident}`; `402` means payment required, `200` authorizes release. | Building authorization and mismatch response, tariff selection and treatment of existing sessions and quotes. `402` and rechecks remain unconfirmed vendor capabilities. |
| Provider: `POST /webhooks/payments` | Raw-body `X-Signature` HMAC; `{paymentId,parkingSessionId,amount:{value,currency},status}`; PB-05 specifies `204` for accepted or identical successful retries. | Secure provider/secret selection, payment ID scope and session-to-building resolution; no building or quote ID is supplied. Maintain signed-only verification and PB-05's rejected-payment diagnostics. |
| Admin: `POST /admin/residents`, `GET /admin/residents?buildingCode=...`, `DELETE /admin/residents/{plate}?buildingCode=...` | Separate admin key and building-scoped registry under PB-03. | One ParkingBusiness-wide admin credential is sufficient; configuration of limits and changes needed for new buildings remain open. |
| Public: `GET /occupancy/{building}`, `GET /occupancy/{building}/availability` | PB-06 returns building-scoped list or free category counts, `Cache-Control: no-store`; unknown building `404`, known empty layout `200`. | Whether existing category/count shapes support all approved layouts; any versioning and client migration. |
| Building and space management | An admin API is required; no building-management API is currently specified. Current operator configuration update does not onboard layouts, gates or tariffs. | Admin authorization, methods/paths, payloads, responses, idempotency, audit and safe updates are open. Do not implement invented endpoints. |

## Error Cases

| Condition | Required outcome or open contract |
| --- | --- |
| Invalid credential, wrong role or unauthorized building | No state change or exit authorization; exact cross-building status and disclosure policy open. Existing role failures use `401`/`403`. |
| Unknown, inactive, incomplete or inconsistent building/layout/tariff | Fail safely without allocation or free exit; exact status and distinction between states open. Existing public occupancy returns `404` for unknown and `200` for known empty buildings. |
| Invalid request or conflicting request ID | No conflicting mutation; preserve existing validation and `409 REQUEST_ID_CONFLICT` semantics as applicable. Additional building fields and precedence are open. |
| Full category or conflicting active session | No allocation; existing pilot uses `409 CATEGORY_FULL` or `ACTIVE_SESSION_EXISTS`. Cross-building plate policy is open. |
| Invalid signature, unknown session, payment mismatch or conflicting payment ID | No unauthorized credit or release; retain PB-05 signed-only validation, replay and diagnostic principles. Provider may retry non-2xx and an external charge may already exist. Provider-account scoping and exact expanded errors are open. |
| Removal of a space with an active session | Reject without deleting the space or changing its session; exact response is open. Concurrent removal and allocation must not violate this rule. |
| Attempt to reassign a gate to another building | Reject without changing its association; exact response is open. Credential rotation is not reassignment. |
| Other configuration change conflicts with live state | No partial change or lost history; precise rejection, deferral or migration procedure is open. |
| Database unavailable or commit outcome uncertain | No unverified success; recover using durable identity and agreed scope. Existing conventions use `503` where appropriate; never claim rollback if commit is unknown. |

## Behavior and State

- Preserve relational integrity and database-enforced allocation uniqueness for `(building, space)`; retain history needed to resolve active sessions, payments and durable request replay. New layout and tariff models are not yet selected.
- Coordinate allocation, resident changes, checkout, payment and configuration updates using compatible database transactions and lock ordering across instances. The current pilot uses a building-row lock; any change needs an explicit deadlock and cross-building lock-order analysis. Bound waits and retain uncertain-commit recovery.
- Building activation must not expose a partially configured layout, authorization or pricing state. The actual activation model, allowed transitions, concurrent edits and rollback are decisions to make, not a mandate for a particular storage or deployment design.
- Preserve existing request identity and immutable building association across credential rotation; define safe retirement and identity reuse before supporting them. Provider deduplication must be compatible with the agreed account and payment-ID scope; independent building locks alone do not serialize a globally shared payment ID.
- Retain the check-in tariff for each active session when rates or caps change; define the retained version and timezone details before migration. Do not silently alter existing sessions, active quotations or prior payment records when changing layout or tariff.

## Verification

- Review the answered decisions, finalized API examples and migration/cutover plan against all four existing feature specs and both vendor notes; obtain vendor confirmation where required. Record unresolved operational risks separately from test results.
- Unit and HTTP tests for approved layouts, eligibility, authorization, configuration validation, pricing boundaries, currency and time zones, plus wrong-building access, malformed requests, secret handling and public data minimization.
- Use an identified isolated disposable PostgreSQL target, never the development database. Exercise two buildings with overlapping space numbers and different tariffs; race final-space allocations, registrations, checkout, payment, configuration changes and retries across instances. Check database constraints directly, lock ordering and bounded failures.
- Exercise gate retry/conflict behavior across restart and credential rotation; verify reassignment is rejected, and test any approved retirement rules, lost responses and uncertain commits. Test payment duplicates and conflicting IDs across buildings/accounts, out-of-order events, closed sessions, amount validation and webhook/checkout races. Verify no cross-credit or duplicate release.
- Test approved tariff-change policy with an active session, pending amount and existing payment, including midnight, DST, caps and pilot regression cases. Test layout changes against occupied spaces and resident limits. Verify no fallback when configuration is missing.
- Migrate representative existing pilot data including active sessions, request bindings and payments; verify fresh setup, repeated setup, failure recovery and the agreed cutover/rollback. Verify public occupancy isolation, known-empty/unknown responses and snapshot consistency.
- Follow `docs/verification-procedure.md` for applicable lint, formatting, type-check, build, tests, actual results and independent review. A simulator or test double is not vendor confirmation.

## Implementation Tasks

1. **Resolve product and integration decisions.** Obtain answers to the blocking questions, especially onboarding, gate authorization, tariff evolution, payment identity and migration. Review concrete failure and timing scenarios with stakeholders and vendors. Acceptance: no consequential behavior is left implicit. Verification: reviewed examples and updated cross-feature contracts.
2. **Finalize the spec and checkpoint.** Amend acceptance criteria, API, error precedence, state transitions and migration after decisions; reconcile affected PB-03 through PB-06 specs. Seek independent review. The mandatory committed-spec-first rule applies to PB-03 through PB-06 and substantive amendments; follow the project's spec-first handoff for this new feature as well, with explicit user authorization for any commit. No commit is authorized here.
3. **Plan provisioning and persistence.** Design the approved layout, gate, tariff and lifecycle representation, constraints, cutover and rollback without losing pilot data. Dependency: task 1. Acceptance: safe activation and reproducible active-session behavior. Verification: isolated migrations, repeat setup, fault injection and direct constraint tests.
4. **Integrate existing flows.** Adapt check-in, resident administration, checkout, signed payments and occupancy using approved authorization and pricing rules. Dependency: reviewed contracts and persistence. Acceptance: building isolation, correct replay and no pilot regression. Verification: HTTP and PostgreSQL cross-building concurrency and recovery tests.
5. **Document and validate operations.** Document fresh-clone setup, provisioning, secrets, changes, vendor limitations, monitoring and manual payment investigation. Dependency: implemented and reviewed flows. Acceptance: operators can safely execute the approved procedure. Verification: follow the verification procedure and record actual checks and independent review.

## Handoff Status

**Provisional and blocked on the questions above.** Admin API management, activation prerequisites, occupied-space protection and the basic tariff structure and check-in retention policy are confirmed; detailed contracts, timezone and pricing boundaries, cross-building gate contract and migration policy are not. Existing PB-04/PB-05 work and vendor limitations must be reconciled before implementation. This artifact does not authorize code changes, a commit, or a claim of end-to-end multi-building support.
