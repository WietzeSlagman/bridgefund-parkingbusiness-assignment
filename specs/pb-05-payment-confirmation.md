# PB-05: Payment confirmation

## Story and Outcome

PB-05 in `BRIEF.md`: record the provider's payment result so an active parking session can be checked out once its outstanding balance is paid. The webhook itself does not open the gate or release the space.

## Scope

### In Scope

- Authenticate provider deliveries, validate and durably record successful payments, log failed attempts, and expose successful payments to checkout.
- Support multiple distinct payments on an active session for successive full outstanding balances; protect against duplicate and concurrent deliveries.
- Document operational failures and the unsupported unsigned legacy-terminal integration.

### Out of Scope

- Payment initiation, partial payments, refunds, automatic reconciliation, physical departure detection, and a new quote-ID protocol.
- Accepting a new payment for an already closed session. Identical retries of previously recorded events remain idempotent after closure.

## Sources and Dependencies

- `BRIEF.md` PB-05; `docs/payment-provider.md`; `docs/gates.md`; `simulator/README.md`.
- `specs/pb-04-check-out.md`: fixed displayed amount, grace, checkout and release. PB-04 is in progress; its actual persistence and integration interface must be checked before implementing PB-05.
- `docs/verification-procedure.md`; current PostgreSQL schema and existing building-lock ordering.
- User decisions recorded in `JOURNAL.md`: signed-only calls, session-based balances, multiple payments for active sessions, no new payments for closed sessions, and rejection of unexpected confirmations despite provider retries.

## Decisions, Assumptions, and Open Questions

### Decisions

- Require HMAC-SHA256 using the provider secret over raw request bytes. Reject unsigned legacy calls: `X-Terminal-Compat` is not authentication. Affected drivers cannot use those terminals for payment-dependent exit until an authenticated integration or upgrade exists.
- Each new successful payment must equal the full amount currently open on an active session. A session may receive another distinct payment when a later outstanding balance arises. No new payment is accepted for a closed session; log it clearly. A replay of a previously recorded identical event is not a new payment.
- Use the provider's payment ID for durable deduplication; do not require or introduce a quote ID. The user rejects quote IDs as the payment model; PB-04 uses interaction amounts and session payment state, without attributing individual payments to quotes.
- An unexpected signed confirmation does not mark the session paid. Return non-2xx and log an actionable, sanitized diagnostic. The provider may retry it for up to 24 hours; investigation is manual and retries alone may not resolve a permanent error.
- Each accepted success starts the 15-minute grace period at its first durable server recording; a duplicate does not extend it. Checkout, not the webhook, authorizes exit and releases the space.
- A checkout request's displayed outstanding amount remains active until a later one replaces it; there is no separate 15-minute payment-window expiry. A new `PAID` confirmation must match an active session's current outstanding amount. The distinct 15-minute post-payment exit grace remains in effect.
- Do not store `FAILED` events in payment persistence. They are relevant only for logging and do not change session state, balances or grace. Because they are not stored, durable duplicate or conflicting-ID detection is not available for failed events.
- A later checkout request B replaces request A's displayed amount for the session; A's earlier amount is no longer payable. This simple rule relies on the pilot assumption of near-instant provider responses. A signed, valid `FAILED` notification for a known completed payment is logged and acknowledged with `204`, without changing payment or session state.
- A malformed session ID receives `400 INVALID_REQUEST`; a well-formed ID for a session that does not exist receives `404 SESSION_NOT_FOUND`. These responses also apply to failed-payment notifications. Invalid signatures are rejected before session lookup. A previously recorded identical successful payment is still acknowledged as a retry before checking whether its session is active.
- Retrying a superseded, not-yet-authorized checkout returns `409 CHECKOUT_SUPERSEDED`; it cannot reactivate its former amount. A valid signed `FAILED` notification for a known session is logged and acknowledged with `204`, without changing payment state or storing the failure. An unexpected signed success that does not match the current amount is rejected with a prominent structured diagnostic for manual investigation.

### Assumptions

- HTTPS is supplied by deployment. The provider does not successfully charge the same outstanding balance twice; unexpected extra payments require investigation, not silent acceptance or automatic refunds.
- A payment attempt produces one final result, with a stable ID and identical body on retry, as described by the provider. Gate handling of `402` and rechecks remains an unverified pilot integration assumption.
- For the pilot, assume the provider delivers payment confirmations and rejections near instantly. A signed `PAID` result can be handled when there is an active checkout request for the session and its displayed amount matches. This is an assumption, not a provider guarantee; the provider documents retries but not a delivery-time guarantee. Validation of `FAILED` results remains open below.

### Open Questions and Conflicts

- **Replacement and overlap:** Implement B replacing A atomically, including concurrent checkouts and a top-up issued on the same request; a retry of A returns `409 CHECKOUT_SUPERSEDED` and must not reactivate its replaced amount. The provider payload has no payment timestamp or checkout request ID; equal amounts alone cannot establish which interaction was paid.
- **Delayed or extra real payments:** Provider retries can continue for up to 24 hours, and the payload has no payment timestamp. Rejecting a confirmation does not undo an external charge; log unexpected payments for manual provider investigation. If an old extra payment equals a newly open balance, the payload alone cannot distinguish it from the intended top-up. Near-instant delivery and no double charge remain pilot assumptions, not guarantees.
- **Failed attempts:** Log without persistence or payment-state action. A valid signed failure for a known session receives `204`; malformed and unknown session IDs receive the defined `400` and `404` errors.
- **PB-04 alignment:** checkout uses a session paid-total baseline for ordinary interaction coverage. PB-05 must define and atomically validate session payment updates without attributing individual payments to quotes; the delayed-renewal ambiguity above remains unresolved.
- Provider notes require signatures but also ask for unsigned legacy acceptance. The user chose authentication and accepts the compatibility impact; vendor agreement on an authenticated alternative remains outstanding.
- Exact error status codes and response bodies below are proposals, not provider-confirmed requirements. All non-2xx responses may trigger retries.

## Acceptance Criteria

- Only a valid raw-body signature allows an event to affect durable payment or session state; unsigned legacy calls and malformed signatures cannot mark a session paid.
- A valid `PAID` event for the full currently open EUR amount of an active session is recorded once. A later full top-up for a new outstanding balance on the same active session is supported; partial and excess payments are not accepted as settlement.
- A new `PAID` confirmation must match the currently active checkout request's full displayed outstanding amount. Once covered, another distinct payment is rejected and logged unless a new outstanding amount has become active.
- A valid `FAILED` attempt never grants exit, reduces the balance, or reverses a successful payment, including if delivered late.
- A valid signed `FAILED` notification for a known completed payment is logged and acknowledged with `204`, without storing the failed event or altering the completed payment or session.
- An authenticated request with a malformed session ID returns `400 INVALID_REQUEST`; an authenticated request with a well-formed unknown session ID returns `404 SESSION_NOT_FOUND`. No such request changes payment or session state.
- When checkout B replaces a pending checkout A for a session, A's amount is no longer eligible for a new payment; retrying A returns `409 CHECKOUT_SUPERSEDED` without making that amount current again. Concurrent replacement and confirmation use shared durable ordering. A previously committed checkout `200` retains its PB-04 replay behavior.
- Identical successful-payment retries, including concurrent deliveries and retries after session closure, do not create another payment or extend grace. Reuse of a recorded successful payment ID with different content is rejected and logged. Failed events are not persisted and cannot have durable replay or conflict detection.
- A new successful-payment event for a closed session is rejected and clearly logged; no session or space is reopened or modified. Unknown sessions, wrong currency and invalid amounts do not mark a session paid.
- Payment recording and checkout use compatible database transactions and locks; races cannot double-count a payment, lose a payment, or authorize exit before durable confirmation. Transient failures return non-2xx without claiming success; retries resolve uncertain outcomes using the payment ID.

## API Contract

`POST /webhooks/payments`, called by the provider over HTTPS. Authentication: exactly one `X-Signature`, lowercase hexadecimal HMAC-SHA256 of the raw body with the configured shared secret. Require JSON. The supplied provider payload is:

```json
{"paymentId":"pay-123","parkingSessionId":"b4862cc2-3b43-4acd-ab6d-5f1f7dab71f0","amount":{"value":500,"currency":"EUR"},"status":"PAID"}
```

`paymentId` is a nonempty string; `parkingSessionId` is a UUID; `value` is an integer number of euro cents; `status` is `PAID` or `FAILED`. Exact string limits, positivity and unknown-field handling require confirmation in implementation design. No quote ID is supplied.

Proposed response: `204 No Content` after durable acceptance of a successful payment, or for an identical previously recorded successful delivery. Duplicate detection precedes the closed-session check so a retry after checkout remains successful. A valid failure for a known session is logged and acknowledged with `204` without persistence. Malformed session IDs receive `400 INVALID_REQUEST`; well-formed unknown session IDs receive `404 SESSION_NOT_FOUND`. Validation, signature and conflict errors return non-2xx; database and other transient failures return non-2xx so the provider retries. Do not return success for an unrecorded new `PAID` event. Proposed errors use `{"error":{"code":"CODE","message":"..."}}` without sensitive details.

Example: an active session receives a 500-cent outstanding amount; `pay-1` for 500 cents is accepted once. After its grace expires, checkout determines a new 500-cent outstanding amount; `pay-2` for 500 cents can be accepted. A retry of `pay-1` never adds another 500 cents or restarts its grace window. The definition of an open amount in a delayed-renewal case remains open above.

## Error Cases

| Condition | Proposed response or behavior | Notes |
| --- | --- | --- |
| Missing, malformed or invalid signature, including unsigned legacy | `401`; no mutation | Do not expose the secret or signature calculation. |
| Malformed JSON or invalid field types | `400`; no mutation | Authenticate raw bytes before trusting the payload. |
| Unsupported media type | `415`; no mutation | Proposed contract. |
| Malformed session ID | `400 INVALID_REQUEST`; no mutation | After signature verification. |
| Well-formed unknown session ID | `404 SESSION_NOT_FOUND`; no mutation | Applies to `PAID` and `FAILED`; provider may retry for 24 hours. |
| New payment for closed session, wrong currency or amount | Non-2xx; no settlement; clearly log condition and safe identifiers | Exact status remains open. Provider retries may continue for 24 hours. |
| New payment arrives when no matching amount is currently open | Non-2xx; no settlement; clearly log for manual investigation | A real external charge may already have occurred; retries do not reverse it. |
| Recorded successful payment ID reused with different content | `409`; no settlement; log conflict | Identical recorded retry receives `204`, even after closure. Failed events are not stored. |
| Database unavailable, timeout or uncertain commit | `503` where possible; do not assert an unverified success | Same-ID retry resolves any committed result. |

## Behavior and State

- Validate the HMAC against the exact bytes received before parsing; use constant-time comparison after validating signature format. Keep the shared secret outside source control and avoid logging raw payloads, signatures or secrets.
- Persist enough successful-payment content to detect conflicting reuse of a recorded payment ID. Record the amount and first server confirmation time in one transaction with the balance/settlement state checkout uses. Enforce successful-payment ID uniqueness in PostgreSQL, not process memory. Log but do not persist `FAILED` events.
- Check an already recorded successful payment ID for identical replay before evaluating whether its session remains active. For a new `PAID` ID, serialize with checkout and evaluate active session and open balance atomically. A new payment after closure is rejected and logged. Log a valid `FAILED` for a known session and return `204`; it never changes payment state or requires the amount to match the current balance.
- For unexpected signed successes, emit a prominent structured log with safe session/payment identifiers and a specific reason, for example `PAYMENT_AMOUNT_MISMATCH`. Do not log raw payloads, signatures, secrets or card data. Operators can search these logs for manual investigation; log collection, retention and automated reconciliation are not part of the pilot. Duplicate retry logs must not imply another charge.
- PB-04's existing building lock is acquired before request/session writes; coordinate compatible lock ordering and bounded waits. Never let webhook processing release a space. The exact storage model must be agreed with PB-04 and must not require a quote ID from the provider.

### Required checkout update for PB-05

- Extend PB-04 checkout so that issuing a later payable checkout request B atomically replaces request A as the session's current displayed amount; a later top-up issued on the same request likewise becomes the current amount. This is session state, not a provider-facing quote ID.
- A retry of pending A cannot reactivate or offer its replaced amount for payment and returns `409 CHECKOUT_SUPERSEDED`; a previously committed `200` continues to replay as required by PB-04. Payment validation reads the same current amount under compatible locking. These requirements amend the PB-04 handoff; they are not a claim that its current implementation already does this.
- The development agent must clearly describe this interaction in application/operator documentation: A displays EUR 5; B later replaces it with EUR 10; a retry of A receives `409` rather than displaying EUR 5 again; an unmatched signed payment is rejected and logged for manual investigation. Explain the accepted near-instant-delivery assumption, the unverified gate behavior on `409`, and that same-ID replay of an already committed `200` remains successful. Do not imply logs automatically reconcile or refund a payment.

## Verification

- Unit/HTTP: exact raw bytes including whitespace and newline; valid, missing, malformed and wrong signatures; unsigned compatibility header; JSON and field validation; safe errors and logging.
- Isolated PostgreSQL: repeated and simultaneous identical IDs, changed-body conflict, `FAILED` then `PAID` and late `FAILED`, full amount validation, successive top-ups, retry after closure versus a new ID after closure, and unchanged space/session on rejected events.
- Verify a fixed displayed amount across a tariff boundary, replacement by a later checkout, rejection and logging of a second distinct payment when no amount is open, and a later valid top-up. Exercise signed webhook through checkout authorization and release.
- Race webhook against checkout and another delivery across application instances; verify atomic persistence, no duplicate credit, fixed first confirmation time, grace boundaries, and recovery after a lost response or uncertain commit.
- Exercise signed simulator scenarios against a local isolated setup; the simulator does not demonstrate real provider retries or vendor gate support. Follow `docs/verification-procedure.md` and verify the test database is isolated before migrations or tests.

## Implementation Tasks

- [ ] **Update checkout and align PB-04**: Implement the required current-amount replacement rule without a provider quote ID. Dependencies: PB-04 state and compatible locking. Acceptance: B replaces A, pending A retries return `409 CHECKOUT_SUPERSEDED`, and full-balance validation uses B. Verification: tariff-boundary, replacement, overlapping checkout and webhook race examples.
- [ ] **Commit reviewed spec first**: Obtain explicit authorization for a spec-only commit before PB-05 implementation. Dependencies: resolve blocking contract question. Acceptance: spec commit is an ancestor of implementation. Verification: inspect Git history.
- [ ] **Authenticate and validate webhook**: Implement route-specific raw body verification and strict payload handling. Dependencies: reviewed contract. Acceptance: only signed, valid events reach payment handling. Verification: HTTP signature and validation tests.
- [ ] **Persist payment results atomically**: Deduplicate payment IDs and update active session settlement under compatible locks. Dependencies: PB-04 state and migration design. Acceptance: full outstanding amounts only, no duplicate credit or new closed-session payment. Verification: PostgreSQL concurrency and recovery tests.
- [ ] **Integrate and document**: Connect checkout, document configuration, retry and legacy-terminal limitations, and run the verification procedure. Dependencies: PB-04 and payment persistence. Acceptance: ordinary signed simulator flow works and operational limitations are visible. Verification: isolated end-to-end tests and independent review.

## Handoff Status

**User-reviewed; provisional for implementation.** The user accepted the draft on 2026-11-09 and subsequently confirmed replacement, superseded-checkout `409`, failure acknowledgement and session-error decisions. PB-04 implementation alignment, exact unexpected-payment status and vendor gate behavior remain open. The latest amendments need review. PB-05's spec must be committed before its implementation; no commit is authorized here.
