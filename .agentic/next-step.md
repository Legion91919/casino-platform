# Next step

- **Doing:** design wave finished (suite + six services designed, SQL verified on PostgreSQL 16).
- **Done so far:** product brief, context map, 5 suite ADRs, per-service product/ADR/backlog/OpenAPI/migration/DB tests, event contracts, DESIGN.md, team topology, docker-compose sketch, db-verify and contract validation tools.
- **Next action:** build wave, walking skeleton: Cashier slice 1 first (`services/cashier/.agentic/backlog.md`), starting with the failing integration test "duplicate debit replays the stored response".
- **Blocked by:** nothing. Open questions: DESIGN §14 lists assumptions to confirm with operators (pass-through share, retention per jurisdiction).
