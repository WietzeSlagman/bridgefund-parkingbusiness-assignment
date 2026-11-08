# PB-04: Check-out and pricing

## Story and Outcome

An authenticated exit gate checks a session's amount and receives exit authorization when nothing remains due. Authorization ends the recorded session and releases its space. This is a planning artifact, not implemented behavior; the paid flow depends on PB-05.

## Scope

### In Scope

- Exit-gate checkout, pricing, an active payment quote, recorded exit authorization and safe release.
- Durable request identity, concurrent retries and replay; integration requirements for later payment confirmations.
- Pricing, HTTP, failure and isolated PostgreSQL verification plans.

### Out of Scope

- A public or test payment shortcut, payment webhook or simulated production confirmation in PB-04. PB-05 specifies and implements authenticated confirmation.
- Physical departure detection, refunds, provider reconciliation, a production-grade abandoned-payment workflow and occupancy API.

## Sources and Dependencies

- `BRIEF.md` PB-02, PB-04 and pricing; `docs/gates.md` and `docs/payment-provider.md` are supplied integration notes.
- `docs/architecture.md` records cross-feature decisions; it does not change the supplied vendor promises.
- `specs/pb-03-check-in.md`, current PB-03 persistence and `docs/verification-procedure.md`. PB-03 fixes await independent review per `PLAN.md`.
- PB-05 must specify amount validation, payment identity, confirmation and the unresolved quote lifecycle before the paid integration can be implemented safely. Each feature spec must be committed before its implementation, with explicit user authorization.

## Decisions, Assumptions, and Open Questions

### Decisions

- The session's category fixed at check-in determines entitlement and tariff. Checkout `isResident` is required but non-authoritative: mismatch neither changes the price nor rejects the request.
- Started elapsed hours apply, not prorating. The brief's 09:00–10:40 car example conflicts with its tariff: the agreed charge is EUR 10.00, not EUR 8.33. Use integer cents.
- An active terminal payment protects its fixed quote against tariff growth: if EUR 5.00 was quoted and the live tariff reaches EUR 10.00 during that interaction, a valid EUR 5.00 confirmation covers the quote for the subsequent grace period.
- A new checkout interaction, identified by a new request ID, recalculates the current charge, less recorded valid payments. Transport retries of the same interaction retain its quote while payment is pending. A recheck after confirmation applies the grace-period rule before requiring any recalculated balance.
- The first server recording of each valid successful payment starts a 15-minute grace period, inclusive at its start and exclusive at its end. Duplicate delivery of that payment does not extend it. After expiry recalculate the current tariff and subtract valid recorded payments; a new successful additional payment starts a new window. Free or zero-due sessions need no payment.
- Authorization releases the recorded space atomically and assumes departure. Same successful checkout ID and body replay its `200`; a different ID after authorization gets `409`, not another authorization. A pending `402` is reevaluated and may become `200` under the same ID.
- PB-04 has no publicly callable payment shortcut. PB-05 supplies the signed provider path later.
- The pilot does not track payment-in-progress or provide a payment-start API. After receiving `402` the gate continues rechecking with the same request ID and body until it receives `200`; checkout reads recorded payment state by session. Provider payment IDs independently deduplicate webhook deliveries. A checkout cannot authorize merely because payment may be in progress. If an interaction ends without authorization and a later vehicle event begins, that new checkout uses a new ID and recalculates.

### Assumptions

- Gate/terminal can handle `402`, display the amount, initiate payment and continue rechecking with the same request ID until `200`, including beyond the documented timeout retry sequence. It does not start a new payment for each repeated `402` for the same quote; after a failed attempt the driver can try again. The pilot assumes a new checkout ID for a later interaction after grace, but checkout evaluates session state even if the same ID is rechecked. These capabilities, polling interval and timing are not confirmed by the gate vendor. The gate acts on the first `2xx`; a `200` authorizes opening, while `402` does not. It must correlate late responses to the correct vehicle event and end an abandoned interaction before starting another.
- A terminal abandons an unfinished interaction after a bit and starts a later interaction with a new ID. This is an unverified gate-side assumption: the backend has no abandonment signal or timeout and retains the quote for same-ID rechecks even for hours if the gate continues them.
- The terminal initiates payment and the provider promptly reports a final `PAID` or `FAILED` outcome; the gate rechecks after `402` as described above. Neither this timing nor the gate's recheck capability is guaranteed by the supplied integrations. Until confirmation arrives, the backend cannot distinguish a payment in progress from no payment started.
- HTTPS is provided by deployment. Physical departure is not confirmed, so recorded availability can diverge from the garage. The provider is assumed not to charge the same outstanding balance successfully twice; unexpected payments require investigation, not silent counting.

### Open Questions and Conflicts

- How are delayed successes for a previous interaction handled when a new interaction has recalculated the quote? Provider delivery can be delayed and retried for 24 hours, and the webhook has no quote ID or payment timestamp. The user defers a comprehensive solution for this small assignment; do not invent a timeout or claim this edge case works. It remains a pilot limitation and a production-integration risk. Never assume an old payment is invalid merely because delivery is late or silently count an ambiguous payment.
- Under the pilot assumption that only the current interaction is being paid and the same balance is not successfully charged twice, payment ID and session identify the ordinary flow; amount and currency still require validation. A newly recalculated quote does not by itself make the original issued amount invalid: a valid success for that original quote grants grace even if a recheck arrived first. Exceptional attribution across abandoned or renewed quotes is deferred. Failed or duplicate events must not grant exit or undo success.
- Vendor confirmation is needed for `402`, payment-triggered rechecks, event correlation and late-response handling. The brief illustrates `200` with an amount; returning `200` for money still due would open the barrier under the gate notes. The proposed `402` contract deliberately differs from that illustration.
- The provider requires raw-body HMAC but also requests unsigned legacy-terminal acceptance. A compatibility header is not authentication; reject unsigned calls in PB-05, leaving those terminals unsupported until an authenticated alternative or upgrade is agreed.
- Exact quote lifecycle, `402` payload and recheck behavior need agreement with the gate/provider. API shapes below are proposals, not vendor-confirmed details. The recorded confirmation time may be later than actual payment, giving extra time; this provider-delay risk is accepted in the architecture.

## Acceptance Criteria

- Only an authenticated exit gate can check out; invalid input or a residency mismatch cannot change recorded entitlement. A valid resident or zero-balance checkout returns `200` and releases exactly its own active session and space atomically.
- An unpaid visitor receives `402`, with an active fixed quote, and remains active and allocated. A price increase while its terminal interaction is active does not change that quote; a valid confirmation of the quoted EUR 5.00 permits exit within grace even if the live tariff is EUR 10.00.
- A new checkout ID recalculates the current balance; a matching retry of an unpaid interaction keeps that interaction's quote. For example, a visitor car quoted EUR 5.00 after a short stay, who abandons payment and starts a new interaction two hours later, is quoted EUR 15.00 when three started hours apply and no daily cap or payments affect the amount.
- Rechecks of the same checkout before the payment webhook must not authorize exit; they retain the original quote. Once its valid payment is recorded, a checkout within grace authorizes. At or after grace expiry, checkout evaluates the session's current state and recalculates the tariff less recorded payments; if nonzero, it creates a new fixed outstanding quote. Rechecks of that checkout retain the new quote until confirmation, even if the live tariff rises. Each newly confirmed additional payment starts a new grace window. The backend cannot detect a payment in progress or prevent an additional payment attempt because it has no payment-start signal.
- At exactly confirmation time plus 15 minutes the window is expired. Checkout after expiry calculates the tariff through that checkout time less valid payments, never below zero; authorize if zero, otherwise return `402` for the new fixed balance. Duplicate confirmation cannot extend grace. An earlier committed `200` is replayed for its original request ID without repeating authorization.
- Identical overlapping requests and retries across restarts produce at most one release. The successful gate/operation/request ID with the same body replays the committed `200` unchanged; another ID for the authorized session returns `409`. Same-ID changed content conflicts, including after authorization. `402` is not a permanently replayed result.
- Check-in, checkout, resident operations and future payment updates cannot race into double allocation, duplicate authorization, lost payment or a stale successful check-in replay after release. Errors and uncertain commits do not imply success without a known durable authorization.
- PB-04 alone cannot mark a paid session paid through a public endpoint. The paid end-to-end flow is not claimed complete until PB-05 and its unresolved decisions are complete.
- PB-04 implementation documentation must clearly state that unsigned legacy terminal payment calls are intentionally unsupported, that `X-Terminal-Compat: 1` is not authentication, and that affected drivers cannot complete payment-dependent exit through those terminals without an upgrade or separately authenticated integration. PB-04 does not implement the webhook; PB-05 must enforce signature verification.

## API Contract

The following is a **proposed** pilot contract, subject to the open questions and vendor agreement. JSON errors follow PB-03: `{"error":{"code":"CODE","message":"..."}}`, without secrets or database details.

### `POST /check-out`

Caller: `exit-1` or `exit-2`, `Authorization: Bearer <key>`, over HTTPS. Require exactly one `X-Request-Id` UUID and JSON containing exactly:

```json
{"parkingSessionId":"b4862cc2-3b43-4acd-ab6d-5f1f7dab71f0","isResident":false}
```

Proposed `200 OK`, only after durable authorization and release:

```json
{"parkingSpaceId":51,"sessionLengthInMinutes":100,"amountDue":{"value":0,"currency":"EUR"}}
```

Proposed `402 Payment Required`, no release:

```json
{"parkingSpaceId":51,"sessionLengthInMinutes":60,"amountDue":{"value":500,"currency":"EUR"}}
```

`value` is integer cents outstanding, not total tariff or historical payment. A `200` therefore has zero due; pricing and paid amounts remain durable and auditable. Proposed `sessionLengthInMinutes` is elapsed whole minutes rounded down at evaluation, independent of started-hour billing. Store the complete successful response for exact replay; `402` may change when state changes. Exact response shape and minute rounding are proposed, not established vendor requirements.

Scope identity to stable authenticated gate ID, operation and request UUID. Canonical body includes both validated fields, including the non-authoritative boolean. Bind valid authenticated requests durably; retain bindings for the pilot, including failures, and monitor storage. A changed body yields `409 REQUEST_ID_CONFLICT` before session-state evaluation. Invalid or unauthenticated requests do not bind. Matching pending requests reevaluate payment state while retaining their interaction's quote; a new ID recalculates, subject to the paid grace period. Overlapping work serializes. The same successful ID replays `200` even after release and subsequent allocation of the space; a different ID, including one previously pending, returns `409 EVENT_CLOSED`. Same UUID at another gate or operation is a different identity. The existing `gate_requests` schema is check-in-specific and keyed only by gate/UUID; a migration or separate checkout record is needed, without weakening PB-03 replay.

## Error Cases

| Condition | Proposed response or behavior |
| --- | --- |
| Missing or invalid credential; known wrong role | `401 UNAUTHORIZED`; `403 FORBIDDEN` |
| Malformed JSON, wrong fields/types, invalid or repeated request ID | `400 INVALID_REQUEST`; non-JSON `415 UNSUPPORTED_MEDIA_TYPE` |
| Unknown session | `404 SESSION_NOT_FOUND`; matching request can be reevaluated |
| Changed body for a bound ID | `409 REQUEST_ID_CONFLICT`, no mutation |
| Different ID after authorization | `409 EVENT_CLOSED`, no release or `200` |
| Outstanding amount | `402` with quote; session stays active |
| Database unavailable or known lock/transaction failure | `503 SERVICE_UNAVAILABLE`; no uncommitted authorization |
| Unexpected internal failure | `500 INTERNAL_ERROR`, no sensitive details |
| Commit outcome unknown or response lost | Do not assert rollback or issue an unverified success; retry same ID to resolve durable outcome |

## Behavior and State

- For visitors, divide actual elapsed time since check-in into one-hour blocks anchored at check-in. Charge each started block to the Amsterdam local calendar date on which it starts, applying that day's cap: car 500 cents/hour, 3,000 cents/day; motorcycle 300 cents/hour, 1,800 cents/day. Zero elapsed time costs zero. Midnight does not restart a block; daylight-saving changes affect local date attribution, not elapsed duration. Resident price is zero. Instants before check-in must fail safely rather than produce negative charges.
- Examples for cars: 09:00–10:00 costs 500 cents; 09:00–10:00:01 costs 1,000; 23:45–00:45 costs 500 attributed to the first day; one second more adds a block attributed to the second day. Cap each local day independently.
- Proposed state: active session with no quote, active with an interaction-specific fixed quote, active with valid payment and grace, and authorized/released. A new interaction recalculates; matching rechecks return its quote until confirmation. Confirmation records valid paid amount and first server confirmation instant, without ending the session. Within grace, the covered quote authorizes even if the live tariff grew. After grace, checkout recalculates and subtracts valid paid amounts, then either authorizes or creates a fixed additional-balance quote; rechecks retain that quote until valid confirmation. A failed payment leaves the session active and does not authorize exit. Handling a late confirmation for an earlier interaction remains unspecified.
- PB-04 persistence and PB-05's later design must support durable session and interaction identity, current issued outstanding quote and currency, valid payment IDs and amounts, their covered quote in the ordinary current-interaction flow, and the first server confirmation instant per successful payment. Together these facts permit validation, duplicate detection, total paid and the current grace window. PB-05 must specify how these are recorded atomically; the provider payload has no quote ID, so attribution of ambiguous older interactions remains deferred rather than claimed solved.
- In the ordinary flow, record whether the current fixed quote has been covered by a valid payment, separately from the gate request ID. When its grace expires, the first subsequent checkout, using either the original or a new request ID, recalculates and, if necessary, atomically creates an uncovered fixed quote for the additional balance. Later rechecks of that quote retain it while uncovered rather than repeatedly recalculating because the previous payment's grace expired. A valid additional payment covers that quote and starts its own grace window. An already committed `200` for the original request remains an exact replay and never performs authorization again.
- Serialize checkout, quote and eventual payment changes on shared durable PostgreSQL state. Authorization, session `active=false`, release and successful response record commit together. Never release by space number alone: a retry must not touch a later occupant. Maintain PB-03's active-space and active-plate uniqueness constraints and make its prior check-in replay observe `EVENT_CLOSED` after release.
- Current `garage/src/parking/services/building-lock.ts` takes the building row lock first for request bindings and allocation; checkout release must acquire that same lock before request/session writes, with compatible ordering for future PB-05 updates. Bound lock waits and handle failures; do not substitute process-local locks. Coordinate with any migration changing this ordering. No successful response before a known commit; a retry resolves uncertain commit using the durable binding and result.
- A lost `200` or failure of a barrier to open can leave the recorded space released while the vehicle remains. Replaying that same successful ID supports transport recovery but cannot prove physical departure. Do not authorize a new ID to work around this approximation.

## Verification

- Unit pricing: zero, exact hour and one second beyond, both tariffs, multiple blocks, both daily caps, Amsterdam midnight and DST spring/fall including repeated local hours, long stays, integer money and pre-check-in times. Verify minute display rounding separately.
- HTTP: role separation, invalid/repeated credentials and IDs, UUID/body/content-type validation, unknown session, resident mismatch, exact `402`/`200` shapes, changed-body precedence and no secret leakage.
- Isolated PostgreSQL: concurrent same-ID and different-ID checkouts, pending-to-success recheck, one winner and stable replay, retries after lost response/restart and uncertain commit, rollback/storage failure, and direct invariant checks. Race release against PB-03 check-in, check-in replay, resident removal and future webhook; verify lock ordering, timeouts, no deadlock-induced corruption and no release of a new occupant. Test multiple app instances.
- Use isolated database fixtures or internal test seams, not a public payment endpoint, to represent valid confirmations. Verify EUR 5 quote versus EUR 10 live tariff, failed payment, duplicate confirmation, immediately before and exactly at grace expiry, post-expiry zero balance and additional balance. PB-05 must separately test signed webhooks, duplicates, conflicting IDs, out-of-order events and the eventually agreed late/abandoned quote cases.
- Test a pending same-ID retry across a tariff boundary retains its quote, and a fresh ID two hours later, including at the other exit gate, recalculates it. As a separate new-interaction case, test checkout inside grace authorizes rather than charging for tariff growth.
- Test a EUR 5 payment, expiry of its grace period, and a new-ID checkout with a EUR 5 additional-balance quote: same-ID rechecks of that new checkout retain its quote when the tariff grows again, and a valid additional EUR 5 confirmation starts a new grace window. Verify the gate contract does not initiate another attempt merely for repeated identical `402`s and permits a retry after failure; gate behavior requires a simulator or test double, not a claim of vendor verification.
- Repeat the expired-grace top-up scenario with the original ID when it has no committed `200`: the first recheck creates the additional quote, later rechecks retain it after a tariff increase, and a valid top-up starts a new grace window. Separately verify a committed `200` always replays without a second release.
- Test checkout A quotes EUR 5, repeated A requests before the webhook remain `402` with EUR 5 even after the live tariff reaches EUR 10, then a valid EUR 5 confirmation followed by A during grace authorizes. Test `FAILED` and duplicate payment events independently of gate request IDs; do not claim payment-in-progress detection.
- Before migrations or database tests verify isolated disposable test container, port, storage and database/user identity; never use development data. Follow `docs/verification-procedure.md` for configured checks, fresh setup, actual results and independent review. No tests are run as part of this planning-only artifact.

## Implementation Tasks

1. **Review the pilot contract.** Confirm the proposed API and document the deferred abandonment, renewal and late-confirmation limitation in the PB-05 handoff. Dependency: product review; vendor confirmation remains outstanding. Acceptance: ordinary payment behavior and unsupported edge cases are explicit. Verification: review concrete timing and failure scenarios.
2. **Spec-first checkpoint.** Review this spec, obtain explicit authorization and commit it before PB-04 implementation; substantive follow-up spec changes also require the checkpoint. No commit is authorized by this request.
3. **Pricing and persistence.** After applicable decisions and checkpoint, implement tariff calculation and migrations for durable checkout identity, quote and authorization without breaking PB-03. Acceptance: deterministic cents and safe constraints. Verification: pricing unit tests, isolated migration and constraint tests. Pricing work can be designed independently of vendor response but must not assume the unresolved lifecycle.
4. **Checkout and release.** Implement authenticated validation, pending `402`, atomic authorization/replay and compatible building lock order. Dependencies: accepted contract and persistence. Acceptance: no public payment shortcut or duplicate release. Verification: HTTP, fault-injection and PostgreSQL races.
5. **PB-05 integration.** After its own reviewed, committed spec, implement signed confirmations and rechecks for the agreed pilot flow. Acceptance: quote protection and grace work without counting ambiguous or duplicate payments; unsupported abandoned and late-payment cases are not claimed as solved. Verification: PostgreSQL webhook races and provider simulator where compatible.
6. **Document and review.** Clearly document the intentional unsupported unsigned legacy-terminal behavior and its impact in user/operator-facing system documentation; update architecture and fresh-clone documentation as applicable. Run the applicable verification procedure against an identified isolated DB and obtain independent review. Record actual results and remaining pilot limitations.

## Handoff Status

**User-reviewed draft; not yet committed.** The user accepted the independent review's top-up and repeated-402 clarifications; the latest edits have not had a further independent review. Quote abandonment and delayed webhook matching are deferred pilot limitations, not solved workflows. Vendor capabilities are assumptions, not confirmations. PB-03 has outstanding independent review. This spec must land in a commit before PB-04 implementation, with explicit authorization; PB-04 alone cannot complete a paid checkout.
