# Handover

Owner at the end: the (invented) platform organisation's six teams, each owning its `services/<name>/`.
Portfolio piece: no real client, no real data, no secrets.

- [x] Architecture and decisions explained (`architecture.md`, `decisions/`, `docs/DESIGN.md`)
- [x] Database design verified against PostgreSQL 16 (`tools/db-verify.sh`)
- [ ] Source, infrastructure-as-code and pipelines in the owner's accounts (build wave)
- [ ] Runbook rehearsed by an engineer from each team (incident drills, DESIGN §12)
- [x] AI agent setup documented (Baton per service, governance checks in Backstage)

## Known issues
- Comps does not yet decrement wagering progress after a SettlementReversed; awards are held for manual review (backlog "Next").
- The 90-day hot key window depends on studios sending time-ordered transaction ids; the studio certification checklist must test it (DESIGN §9, §14).

## Recommended next steps
Build the walking skeleton (backlog "Now"), then run the first incident drill (wallet unavailable).
