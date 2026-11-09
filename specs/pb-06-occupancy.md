# PB-06: Occupancy

## Story and Outcome

PB-06 (`BRIEF.md`): provide a public overview of spaces so an entrance display can show when a category is full.

## Scope

### In Scope
- Read-only occupancy looked up by building code, based on recorded allocations. `PB-AMS-2M8D` is the pilot building.
- Identify resident, visitor-car and visitor-motorcycle spaces, including unoccupied spaces.
- A convenience endpoint returning free-space counts by category.

### Out of Scope
- Building administration or layout configuration, an entrance-display UI, physical presence detection, reservations and historical occupancy.
- Check-in, checkout and payment changes; their existing lifecycle determines allocations.

## Sources and Dependencies

- `BRIEF.md` PB-06 and pilot layout; `docs/gates.md` and `docs/payment-provider.md` for integration context.
- `specs/pb-03-check-in.md` for eligibility and `specs/pb-04-check-out.md` for release; `docs/architecture.md` describes recorded occupancy and its limitations. Its implementation-status introduction is stale: checkout code exists, while the payment webhook is not yet implemented.
- Existing PostgreSQL `spaces` and `sessions` tables; `docs/verification-procedure.md` for isolated test verification.

## Decisions, Assumptions, and Open Questions

### Decisions
- Occupancy is public and contains no plates or payment information (`BRIEF.md`, `docs/architecture.md`).
- Registered residents use resident spaces for either vehicle type; visitors use their corresponding car or motorcycle category, with no fallback (PB-03).
- Occupied means a space has an active recorded session. Exit authorization releases it; actual departure or barrier opening is not confirmed (PB-04 and architecture).
- The user accepted the proposed `category` and `eligibleVehicleTypes` representation and chose lookup by building code.
- The user requested a separate availability-count endpoint and `404` when the building is not found.
- A known building without configured spaces returns an empty list and zero availability counts, rather than `404`.
- Use `GET /occupancy/{building}` and `GET /occupancy/{building}/availability` for building-scoped reads.

### Assumptions
- Error codes and messages below are proposed conventions, unless specified otherwise.

### Open Questions and Conflicts
- The brief suggests one `vehicleType` per space, but a resident space accepts both types even when empty. The accepted `category` and `eligibleVehicleTypes` representation changes that approximate shape rather than inventing a single type.
- The building-scoped list path extends the brief's unqualified `GET /occupancy`; callers need to supply a building code.
- Registry configuration alone does not establish that a building supports parking. An empty layout reports no configured spaces, not evidence that a physical garage is full.
- The screen cannot infer whether a particular vehicle is registered from its type alone. A visitor category is full when every space in that category is occupied; resident capacity is separately full when every resident space is occupied. Displaying a single vehicle-type full indicator without knowing residency would be misleading.
- Recorded release assumes departure, so the display can disagree with physical reality. This is an accepted pilot limitation, not a real-time sensor guarantee.

## Acceptance Criteria

- An unauthenticated caller receives all spaces for the requested building once, including free spaces, with their physical space number, category, eligible vehicle types and recorded occupancy; no plates, session IDs or payment information are exposed. Spaces from other buildings are excluded.
- Pilot spaces 1–50 are resident, 51–130 visitor cars and 131–150 visitor motorcycles. A resident space lists both vehicle types; visitor spaces list their matching type.
- An active session marks its assigned space occupied; after exit authorization releases the session, a subsequent read sees it free. A payment confirmation alone does not release a space.
- Availability counts equal the number of free spaces in each respective category for the requested building. Zero means that category is full; resident spaces are counted only as resident, not again as car or motorcycle.
- One response reflects a consistent database snapshot, including when check-in or checkout runs concurrently. Results are a point-in-time view, not a promise that a space remains available.
- If occupancy cannot be read, return an error rather than an empty or fabricated availability list. Public access must not require gate credentials or an `X-Request-Id`.

## API Contract

`GET /occupancy/{building}`, public caller, no authentication or request body required; for example `GET /occupancy/PB-AMS-2M8D`. Return `200` JSON array, sorted by `parkingSpaceId` ascending; `Cache-Control: no-store` prevents a cached response presenting stale availability. For example, showing only three entries of the full pilot response:

```json
[
  {"parkingSpaceId":1,"category":"RESIDENT","eligibleVehicleTypes":["CAR","MOTOR"],"isOccupied":false},
  {"parkingSpaceId":51,"category":"CAR","eligibleVehicleTypes":["CAR"],"isOccupied":true},
  {"parkingSpaceId":131,"category":"MOTOR","eligibleVehicleTypes":["MOTOR"],"isOccupied":false}
]
```

`category` denotes eligibility, not the vehicle currently occupying the space. `parkingSpaceId` is the physical number within the requested building. The pilot normally has 150 entries, not just these three. No request ID or idempotency mechanism is needed for this read; a retry performs a new read and may return changed occupancy.

`GET /occupancy/{building}/availability` is also public and returns `200` JSON with counts of **free** spaces, using the same building lookup and `Cache-Control: no-store`. For an entirely empty pilot garage:

```json
{"resident":50,"car":80,"motorcycle":20}
```

`car` and `motorcycle` count visitor spaces only. A category with no free spaces returns `0`; a category with no spaces in a configured layout also returns `0`. Counts and the list are separate point-in-time reads and may differ if allocations change between calls. Retries are fresh reads.

For a known building with no configured spaces, the list returns `200 []` and availability returns `200 {"resident":0,"car":0,"motorcycle":0}`. Both routes return `404` for an unknown building; the proposed error is `{"error":{"code":"BUILDING_NOT_FOUND","message":"Building not found"}}`. Proposed failures use the existing error envelope: `503` with `{"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable"}}` for database unavailability; `500` with `{"error":{"code":"INTERNAL_ERROR","message":"Internal error"}}` for unexpected failures. Never include database details or secrets.

## Error Cases

| Condition | Response or behavior | Notes |
| --------- | -------------------- | ----- |
| Database unavailable | `503 SERVICE_UNAVAILABLE` | No partial or fabricated occupancy |
| Unexpected server error | `500 INTERNAL_ERROR` | Sanitized error |
| State changes during read | Return one consistent snapshot | A later retry may differ |
| Unknown building | `404 BUILDING_NOT_FOUND` | No fabricated availability |
| Known building without spaces | `200` with empty list or zero counts | Registry configuration does not establish a layout |

## Behavior and State

Read the requested building's spaces and determine whether each has an active session in the same building and space number. Use a single database query or equivalent consistent snapshot; include free spaces and avoid counting inactive historical sessions. Existing active-space uniqueness prevents duplicate active allocations. Do not modify state or acquire allocation locks merely to read occupancy. A checkout awaiting payment stays occupied; release occurs on authorization, not on payment alone. Other buildings and physical presence are not inferred from pilot space numbers.

## Verification

- HTTP: public access with no credentials or request ID, response shape, ordering, no-store header, and no sensitive fields.
- Isolated PostgreSQL: empty pilot layout, mixed and full categories, active versus inactive sessions, and no leakage from another building with overlapping space numbers.
- Check availability for an empty pilot (50/80/20), mixed occupancy and full categories, comparing counts with the list when state is unchanged; verify unknown-building `404` and both empty-layout responses for a known building.
- Exercise check-in and release followed by reads, plus a pending-payment state; verify payment alone does not release. Use fixtures if PB-05 is not available.
- Check a read overlapping an allocation or release returns a consistent snapshot; test database failure and sanitized errors. Follow `docs/verification-procedure.md`; never use the development database as a disposable test database.

## Implementation Tasks

- [ ] **Read occupancy**: Add the public building-scoped route and a snapshot-consistent database read using existing space and session records. Dependencies: confirm route and building errors; PB-03 persistence and PB-04 release. Acceptance criteria: complete, accurate, privacy-preserving point-in-time list. Verification: HTTP and isolated PostgreSQL tests, including building isolation, concurrent updates and errors.
- [ ] **Expose availability counts**: Add the public building-scoped count route using the same allocation semantics. Dependencies: building lookup and occupancy rules. Acceptance criteria: counts include only free spaces in each category and return zero when full. Verification: empty, mixed, full and building-isolation PostgreSQL tests.
- [ ] **Document and verify**: Document the public contract and recorded-versus-physical limitation. Dependencies: agreed contract and route. Acceptance criteria: a display can distinguish visitor categories from resident capacity. Verification: run applicable configured checks and the scenarios above.

## Handoff Status

**User-reviewed; ready for implementation handoff** after the spec-first commit. Commit this spec **before** PB-06 implementation; a commit requires explicit user authorization. PB-05 need not be implemented first, but paid-exit end-to-end behavior depends on it. The public data reflects recorded allocation, not confirmed physical occupancy.
