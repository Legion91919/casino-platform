# Catwalk

Owner: `team-catwalk` · Tier 2 · Casino Platform suite (invented operators, studios and jurisdictions).

Players review the rounds they played. Named after the surveillance catwalk above a casino floor,
from where every hand can be reviewed. **Runnable**: Node 22 / TypeScript on PostgreSQL 16.

## Design at a glance
- **Style**: advisor says **CleanArchitecture** (ReadHeavy, RegulatoryAudit, ExternalPartnerIntegrations, MultiTenant, PersonalData, SmallTeam). Decision: `.agentic/decisions/0001-service-architecture.md`; suite decision ADR-0006.
- **Slice 1**: a player plays Ember Anvil at Kestrel, opens History, sees each round with its wallet check, opens one, and the game's replay renderer draws it and confirms the win.
- **API** (`api/openapi.yaml`): `GET /v1/me/rounds`, `GET /v1/me/rounds/{studioCode}/{roundId}`, `GET /v1/me/summary`, page at `/history`.
- **Consumes**: `RoundOutcomeRecorded` (each studio game server's feed, signed), `BetSettled` (Cashier). **Calls**: Dealer for studio signing keys, its own token keys and each build's replay URL. **Publishes**: nothing.
- **Database** (`db/migrations/V001__init.sql`, own database `catwalk`):

| Table | Notes |
|---|---|
| `round_record` | monthly partitions, append-only, signature kept with the row, RLS by operator + player |
| `wallet_settlement` | Cashier's view of each round, append-only, RLS |
| `round_view` | `security_invoker`; confirmed / mismatch / pending |
| `inbox`, `consumer_checkpoint` | exactly-once effect on the polled feeds (ADR-0003) |
| `quarantine` | events that failed validation or signature checks |

## Code
| Path | What |
|---|---|
| `src/domain/events.ts` | tolerant-reader validation of both events (integer money, wins add up) |
| `src/app/ingest.ts` | the rule: nothing reaches history unless the studio's signature verifies |
| `src/app/history.ts` | token to viewer, keyset pagination, summary, identical 404s |
| `src/adapters/pg-history-store.ts` | reads as `catwalk_reader` with the viewer set, so RLS filters every row |
| `src/adapters/dealer.ts` | cached key and build lookups, refetch on unknown key id at most every 10 s |
| `ui/` | the history page (no framework, strict CSP, token kept in memory) |

## Proof
`npm test` in this folder (with `PGHOST` set, or via `tools/with-postgres.sh`): tampered and re-pointed
events quarantined, IDOR returns the same 404 as a missing round, both event orders, pagination,
summary, another operator's token sees nothing, CSP. `tools/db-verify.sh` runs the 19 DB assertions,
including row-level security as the API's own role.
