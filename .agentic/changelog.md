# Changelog

## Unreleased
- Slot and round review (ADR-0006): sample studio slot Ember Anvil (exact RTP 96.39%, game server that freezes outcomes before paying, signed RoundOutcomeRecorded via outbox, game client and replay renderer), new service Catwalk (player round history, RLS, wallet check, quarantine), Dealer V002 (replay rule, studio signing keys), studio SDK, dev floor (Dealer/Cashier contract doubles, demo lobby, `npm run floor`). DB assertions 175 → 220; 59 TypeScript tests; DESIGN.md section 15 with three rendered sequence diagrams; recorded demo.
- Visuals: "The system at a glance" in README.md: context map, bet-round step-through GIF and sequence, real `tools/db-verify.sh` run; diagrams rendered to `docs/media/*.svg|png` by `tools/visuals/`. Fixed three DESIGN.md sequence diagrams that failed to render (`;` inside message text ends a Mermaid statement); team topology diagram added to `docs/team-topology.md`; privacy guard hook runs once per commit (synced from the kit).

## 2026-11-20: design wave
- Framed and mapped the suite; six services designed with advisor-backed ADRs.
- Suite ADRs 0001–0005. Event contracts (11 events + envelope). OpenAPI 3.1 for every slice 1.
- PostgreSQL 16 migrations and DB tests for all six services, verified with `tools/db-verify.sh` (175 assertions).
