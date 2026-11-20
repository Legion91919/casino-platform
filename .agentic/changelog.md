# Changelog

## Unreleased
- Visuals: "The system at a glance" in README.md: context map, bet-round step-through GIF and sequence, real `tools/db-verify.sh` run; diagrams rendered to `docs/media/*.svg|png` by `tools/visuals/`. Fixed three DESIGN.md sequence diagrams that failed to render (`;` inside message text ends a Mermaid statement); team topology diagram added to `docs/team-topology.md`; privacy guard hook runs once per commit (synced from the kit).

## 2026-11-20: design wave
- Framed and mapped the suite; six services designed with advisor-backed ADRs.
- Suite ADRs 0001–0005. Event contracts (11 events + envelope). OpenAPI 3.1 for every slice 1.
- PostgreSQL 16 migrations and DB tests for all six services, verified with `tools/db-verify.sh` (175 assertions).
