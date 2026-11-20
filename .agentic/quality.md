# Quality

## Definition of done (every slice, every service)
- Acceptance criteria demonstrated; each criterion maps to at least one automated test.
- Rules: unit tests (domain without database). Seams: integration tests against PostgreSQL 16 (Testcontainers). DB invariants: `db/tests/*.sql` via `tools/db-verify.sh`.
- Contracts: OpenAPI 3.1 valid; events validate against `contracts/events/*.schema.json`; consumers replay the example events (`tools/validate-contracts.py`).
- CI green: build (warnings as errors), tests with coverage ratchet (start 70%, tier-0 services 85%), lint, secret scan, dependency scan, privacy guard.
- AI governance: AI-assisted change reviewed by a human who is not the author; tier-0 (cashier, pitboss) also reviewed by the critic agent; prompts registered with a passing eval.
- `.agentic/` updated in the same change (decisions, backlog, next-step).

## Service levels (detail per service in DESIGN §12)
| Service | SLI | SLO |
|---|---|---|
| cashier | wallet call success (non-5xx) | 99.95% / 30 days |
| cashier | wallet p99 latency (incl. Pitboss) | < 150 ms |
| pitboss | authorisation p99 | < 50 ms; success 99.95% |
| dealer | launch success | 99.9%; p95 < 300 ms; kill switch effective < 5 s |
| comps | BetSettled → wagering progress lag | p99 < 60 s |
| countroom | data freshness (newest bet fact vs now) | < 5 min; daily report by 06:00 local, 99% of days |
| backstage | portal availability | 99.5% business hours |

## Proven so far (design wave)
- `tools/db-verify.sh`: 6 databases, 6 migrations, 10 test files, 175 assertions passing on PostgreSQL 16.
- `tools/validate-contracts.py`: 12 event schemas, 15 examples (4 deliberately invalid), 6 OpenAPI 3.1 files valid.
