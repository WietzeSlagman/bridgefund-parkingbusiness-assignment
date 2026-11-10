# ParkingBusiness roadmap

This is a proposed direction after the pilot, not a commitment to deliver all
features. Multi-building operations are prioritized before metrics; commercial
terms remain to be confirmed. The pilot's
payment and gate-integration limitations must be addressed before relying on
its data or expanding operations.

## Building performance and payment metrics

**User story:** As a ParkingBusiness operator, I want to see payment and
occupancy trends for each building, so that I can understand performance and
identify underused capacity and payment problems.

**Value:** Daily confirmed payment totals and payment sizes help assess takings;
average occupancy, available capacity and time-of-day trends reveal when and
where space is underused. Payment failure counts and rates can expose problems
at the exit. Initially the audience is ParkingBusiness; building managers may
receive access later.

**Dependencies and limitations:** Current occupancy is a point-in-time record,
not a physical sensor. Historical reporting needs appropriate retained data and
clear definitions for time zones, averages and empty layouts. Confirmed payments
are not necessarily accounting revenue. The payment webhook is not yet
implemented; the current PB-05 decision is to log, not persist, failed events,
so dependable failure metrics need additional design, including deduplication.
Business reporting should not expose plates unnecessarily. Start with reporting
in the existing application; a separate service is an option if justified.

## Complete multi-building operations

**User story:** As a ParkingBusiness operator, I want to onboard and operate
garages with their own spaces, gates and tariffs, so that we can expand without
building-specific application code.

**Value:** Supports expansion beyond the pilot while preserving building
isolation and allowing different layouts and prices. An admin API will onboard
and manage buildings, spaces and resident registrations.

**Starting point:** Building-scoped records, resident administration and
occupancy already provide a partial foundation. Other configured buildings do
not yet have full check-in, layouts or tariffs; gate identities and pricing are
pilot-specific. The provisional spec describes how the new
behavior integrates with existing check-in, checkout, occupancy, payment and
administration flows, and how changes affect active sessions. Gate-to-building
authorization, safe configuration changes, tariff history and cross-building
isolation need explicit decisions and verification.

**Status:** [PB-08 spec](specs/pb-08-multi-building.md) records the approved
defaults and detailed contracts. Its handoff remains conditional on the
reviewed cross-spec checkpoint and migration checks identified there; vendor confirmation
and other operational prerequisites remain necessary before deployment.

## Parking garage subscriptions and reservations

**Concept:** Sell predictable parking access in ParkingBusiness garages to
commuters, local residents and employers. Offer a recurring subscription for
regular use and paid advance reservations for occasional visits. An employer
could purchase a shared allowance for staff, subject to agreed limits.

**How it makes money:** Subscriptions provide recurring income; reservations
provide an additional fee or a prepaid parking charge. Prices, billing periods,
cancellation terms and whether reservation fees offset parking charges are
commercial decisions, not established rules. The aim is to attract repeat
customers and fill capacity without unnecessarily displacing higher-value visits.

**Operations and risks:** Limit sales to capacity available for the relevant
building and time, and define entitlement, access, no-shows, cancellations and
refunds. A guaranteed physical space is harder to offer safely than an access
entitlement: recorded occupancy does not prove physical availability. Resident
and existing visitor needs must be protected.

**Validation:** Interview drivers and local employers, compare willingness to
pay with current parking income, and run a limited manual pilot. Measure uptake,
renewal, utilization and income after discounts against comparable periods;
check whether subscribers displace existing customers. Do not infer profitability
without accounting for support, payment fees and operational costs.
