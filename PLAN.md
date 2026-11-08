# Assignment implementation plan

## Purpose and status

This is the agreed overarching sequence for the ParkingBusiness assignment. It is a planning artifact, not an implementation specification. Feature-specific tasks and contracts belong in the corresponding specs. The foundation and PB-03 implementation exist; the latest review findings have fixes awaiting independent review.

Sources: `BRIEF.md`, `docs/gates.md`, `docs/payment-provider.md`, and `AGENTS.md`. The pilot building is `PB-AMS-2M8D`; future buildings may have different layouts and tariffs. Preserve the original assignment history and supplied integration material.

The agreed sequence established the server, database, isolated tests and tooling before parking business behavior. Resolve cross-feature decisions before the affected implementation. The configured stack is TypeScript, Node.js 26, Express, PostgreSQL, Drizzle ORM, `pg`, Drizzle Kit, Docker Compose and Vitest; see README for setup and commands.

## Working checkpoints

For each step: implement or document its agreed scope, verify acceptance criteria and failure cases, obtain an independent review, resolve or explicitly record findings, then mark it done. Keep changes small and preserve unrelated work.

**PB-03 through PB-06 require a feature spec committed before the corresponding implementation.** Substantive spec changes needed by implementation also require the spec-first checkpoint. Ask the user for explicit authorization before committing; do not rewrite or squash the original history. Specs must include acceptance criteria, API contract, error cases, assumptions and open questions, with implementation tasks and verification.

## 1. Project foundation

**Outcome:** A minimal Express service with a working PostgreSQL development and isolated test setup, ready for later feature work.

- [x] **Runtime and package:** Initialize the backend in `garage/`, pin or document the chosen runtime and dependencies, and configure TypeScript. Dependency: verify availability of the intended Node version. Verify installation and type-checking from a fresh setup.
- [x] **HTTP foundation:** Separate Express app construction from server startup, add minimal shared error handling, and make HTTP testing straightforward. Prepare the HTTP setup to support raw request bytes for later webhook verification without implementing the webhook. Verify app startup, an HTTP test, and sensible error handling.
- [x] **Configuration:** Validate required configuration at startup, provide an example environment file and prevent secrets from being committed. Verify missing or invalid configuration fails clearly and example configuration contains no secrets.
- [x] **Database and migrations:** Configure Compose PostgreSQL, `pg`, Drizzle and Drizzle Kit; establish a repeatable migration workflow without prematurely deciding the business schema. Verify connection and migration workflow against an isolated test database.
- [x] **Tests and tooling:** Configure Vitest, linting, type-checking and package scripts. Create a dedicated disposable PostgreSQL test database; do not use the development database as a test target. Verify a basic database integration test and HTTP test.
- [x] **Initial documentation:** Replace the placeholder README incrementally with verified fresh-clone setup, configuration and commands. Do not document proposed commands as already working.

**Review/done:** Fresh setup can start the service and database, run the migration workflow, lint, type-check and run tests; test isolation and secret handling are checked. Independent review findings are resolved or recorded. No check-in, checkout, payment or occupancy behavior is implemented in this step.

## 2. Delivery guardrails

**Outcome:** Repeatable checks and an honest agent-work record.

- [x] Add CI for lint, tests and dependency audit as required by PB-01, plus type-checking and PostgreSQL integration tests where configured. Exercise the workflow and record failures or audit findings; consider the supplied simulator's dependencies without silently altering supplied materials.
- [x] Check agent instructions and reusable procedures against actual commands; actually use at least one reusable procedure, as required by the brief.
- [x] Maintain dated `JOURNAL.md` entries with real decisions, rationale, mistakes and detection, tools and models used when known. Record time and cost only when known; never invent them.

**Dependencies:** Foundation commands and test isolation. Some configuration can proceed alongside step 1. **Review/done:** CI runs real checks, reusable-procedure use is demonstrated, and the journal is factual.

## 3. Cross-feature decisions

**Outcome:** A coherent set of decisions for each upcoming feature, without presenting recommendations as requirements.

- **Pricing conflict:** The brief says €5 per started hour for cars but its 100-minute example gives €8.33; ordinarily two started hours would be €10. Obtain a decision and define Amsterdam calendar-day caps, midnight, daylight-saving transitions, integer money and rounding.
- **Session lifecycle:** Decide when checkout fixes the amount, when a session ends, when a space becomes free, and how this interacts with pending payments and occupancy.
- **Gate payment status:** Define how the gate learns that an asynchronous payment succeeded or that nothing is due. The supplied integration notes do not fully specify this mechanism.
- **Payment authentication:** Provider notes require signatures but also request unsigned legacy-terminal calls. A compatibility header alone is not authentication. Recommendation: require valid signatures unless an independently authenticated legacy channel is agreed; document the resulting compatibility impact.
- **Gate authentication:** Choose and document a pilot-appropriate mechanism; the brief requires gate-only access but leaves the mechanism open.
- **Eligibility and identity:** Decide resident and motorcycle eligibility, trust or verification of resident selection, duplicate normalized plates, and mismatched resident status at checkout.
- **Concurrency and retries:** Specify scope and persistence of gate request IDs, overlapping retries and conflicting reuse; payment-attempt identity, duplicate deliveries and out-of-order events; and database-enforced allocation safety.

**Review/done:** Decisions needed for the next feature are confirmed and recorded in its spec. Unresolved consequential questions are marked provisional or blocking, with their impact; do not implement dependent behavior as if settled.

## 4. PB-03 — Check-in

**Outcome:** An authenticated entrance gate receives an eligible space and session.

- [x] Write and review `specs/pb-03-check-in.md`: API and errors, eligibility, plate normalization, duplicate sessions, gate authentication, retries and concurrent allocation. Dependencies: relevant step 3 decisions.
- [x] Obtain user authorization and commit the spec before implementation. The spec commit `8a0891a` precedes implementation commit `564e3f9`.
- [x] Implement allocation and persistence with database-enforced protection against duplicate space assignment.
- [ ] Verify authentication, validation, capacity, plate rules, conflicting request IDs and overlapping requests against PostgreSQL.

**Review/done:** Spec, implementation and tests agree; concurrent successful requests cannot allocate the same space and retry behavior is demonstrated.

**Current handoff:** PB-03 is not deployment-ready. Fixes for the latest three independent-review findings (admin lock bounds, missing-building error, and request-record storage fault coverage) passed the developer's PostgreSQL-backed suite and configured checks, but have not been independently reviewed. The previous independent review did not independently run database tests. PB-04–PB-06 each still require their own spec-first commit before implementation.

## 5. PB-04 — Checkout and pricing

**Outcome:** An authenticated exit gate receives the specified checkout result and amount.

- [ ] Specify pricing, time zones, caps, rounding, errors, retries, residency mismatch, price fixation and session/space state; coordinate the contract with PB-05. Dependencies: pricing and lifecycle decisions and PB-03 persistence.
- [ ] Obtain user authorization and commit the spec before implementation.
- [ ] Implement checkout and pricing; verify normal and free cases, rate boundaries, caps, midnight, daylight-saving transitions, retries, errors and state transitions.

**Review/done:** Results are deterministic and traceable to documented decisions. Payment-dependent behavior remains clearly identified until PB-05 is complete.

## 6. PB-05 — Payment confirmation

**Outcome:** Authenticated payment events safely update payment and session state, and the gate can determine whether exit is permitted.

- [ ] Specify HMAC-SHA256 over raw bytes, amount/currency checks, payment IDs and attempts, duplicate/conflicting and out-of-order deliveries, retries, legacy compatibility and gate-facing status. Dependencies: checkout, lifecycle and authentication decisions.
- [ ] Obtain user authorization and commit the spec before implementation.
- [ ] Implement the webhook and agreed gate-facing status behavior. Verify valid/invalid signatures, altered bodies, amount mismatches, duplicates, conflicting IDs, concurrent delivery and failed-then-paid/out-of-order attempts against PostgreSQL.
- [ ] Exercise compatible scenarios using the supplied simulator; document intentionally unsupported legacy behavior and simulator limitations.

**Review/done:** Unauthenticated requests cannot mark a session paid; retries and ordering cannot corrupt payment state; the agreed exit flow works end to end.

## 7. PB-06 — Public occupancy

**Outcome:** A public endpoint describes occupancy usefully without exposing unnecessary personal data.

- [ ] Specify response, eligibility categories, lifecycle meaning and errors. Dependencies: agreed allocation and release rules.
- [ ] Obtain user authorization and commit the spec before implementation.
- [ ] Implement and verify empty, full and mixed eligibility cases and changes following check-in and the agreed release event.

**Review/done:** Public results are accurate, avoid unnecessary private data and support the entrance display's vehicle-eligibility use case.

## 8. PB-07 — Roadmap and future story

**Outcome:** `ROADMAP.md` proposes future business features or models, rationale and user stories; one selected story has an implementation-ready spec in `specs/`.

- [ ] Draft roadmap and choose one future story. This may proceed independently once the core direction is understood.
- [ ] Write and review its spec for complete criteria, contract, errors and decisions.

**Review/done:** A future implementer can implement the selected story without a critical unanswered question. Implementing the future feature is not required.

## 9. Final review and delivery

- [ ] Run the actual lint, type-check, tests, dependency audit and CI; record results and unresolved findings.
- [ ] Verify fresh-clone setup and an end-to-end gate, checkout, payment and occupancy flow; independently review security, concurrency, constraints, retries and pricing.
- [ ] Finish README, factual journal and evidence of reusable-procedure use; verify the spec-before-implementation commit history.
- [ ] Confirm private hosting, reviewer access and delivery route. The inspected `origin` was a local bundle, not proof of hosted delivery. Preserve original history and supplied materials.

**Review/done:** Deliverables are present, setup and important scenarios are verified, remaining limitations are disclosed, and delivery is ready for the user's explicit approval.

## Prioritization

The brief suggests roughly six hours and values a smaller verified result. Prioritize foundation and checks, critical decisions, spec-first core flows, end-to-end verification, and required roadmap and delivery artifacts. Optional UI and load testing do not replace required work. If time runs short, disclose incomplete items rather than skipping security, spec checkpoints or honest documentation.
