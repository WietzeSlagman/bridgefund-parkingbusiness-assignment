# Local load baseline — 2026-11-10

One observed run, not a production capacity claim or performance guarantee.
Method and setup: [load-database.md](load-database.md). The API and client ran
on the same WSL2 host; PostgreSQL 17.11 ran in Docker using tmpfs. The dedicated
Compose project and loopback port 55434 were checked along with tmpfs and the
`garage_load` database/user before migration. Neither the development nor the
existing test database was used. The demo was run first as a warm-up.

Host: Linux WSL2 5.15.153.1, x86-64, AMD Ryzen 7 7800X3D (16 logical CPUs
visible), 23 GiB memory visible; Node 26.13.0, npm 11.20.0, Docker 27.4.1,
Compose 2.32.1, PostgreSQL image `postgres:17` (image ID prefix `eb0fb2377534`).
Other local services were running; no CPU isolation or repeated trials were used.

Command: `LOAD_SESSIONS=80 LOAD_CONCURRENCY=8 npm run start:load-test`.
Ten sequential batches each performed eight concurrent check-ins, checkout
quotes, signed payments and releases, with occupancy checks between phases.
The HTTP client and server share the machine. Elapsed time includes the batch
checks but not startup, the target check or initial occupancy. It was 1.632 s,
or 49.02 completed sessions/s. The runner's checks passed: visitor-car spaces
were within 51–130 and distinct within each batch, recorded occupancy matched
the allocated spaces through payment and was empty after release, and quotes
were positive integer EUR amounts. There were
80 each of `201` check-in, `402` quote, `204` signed payment and `200` release,
plus 41 occupancy `200` responses and one target `200`. No unexpected status
was observed. After the subsequent integration tests, a direct database query
reported 84 sessions, 84 payments and zero active sessions (one demo, 80 load,
one integration demo and two integration-load sessions).

| Operation | Samples | p50 ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: |
| Check-in | 80 | 26.89 | 43.28 | 58.64 |
| Checkout quote | 80 | 23.43 | 37.71 | 42.30 |
| Signed payment | 80 | 19.72 | 31.32 | 34.93 |
| Checkout release | 80 | 24.56 | 40.97 | 44.06 |
| Occupancy | 41 | 1.45 | 1.78 | 3.15 |

Percentiles use nearest rank and include client-side overhead. The batched,
closed-loop workload is short and coordinated, with a single API instance,
no network latency, and an empty garage between batches. It does not verify the
exact tariff or pricing boundaries: the payment uses the returned quote rather
than an independently calculated amount. It does not measure
long-duration stability, multi-instance contention, failures, real gate timing,
or a production workload. Results will vary with host and concurrent work.
