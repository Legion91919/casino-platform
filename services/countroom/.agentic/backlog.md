# Backlog: Countroom

## Now
- [ ] **Slice 1**: BetSettled events from Cashier become bet facts and a daily GGR row; Kestrel downloads the day's GGR, and compliance seals a regulator export.
  - Given Cashier's feed has BetSettled events, when the consumer polls, then each delivery is stored raw and each event becomes exactly one bet fact in the partition for its business date (redeliveries are de-duplicated).
  - Given an event that fails validation or has no partition for its date, then it goes to quarantine with the reason, and the ingestion status shows it.
  - Given the day's facts, when the GGR rebuild runs twice, then ggr_daily is identical both times, voided rounds are excluded from round counts, and GGR = cash stakes - wins, NGR = GGR - bonus stakes.
  - Given Kestrel's credentials, when it requests GGR for a date range, then it receives only its rows with `dataAsOf`.
  - Given compliance requests a daily export for JUR-A, then the export is sealed with row count, SHA-256 and storage location, and cannot be altered or deleted afterwards.
  - Given the retention job, then raw partitions older than 30 days are detached for archive, never silently dropped.
  - Test notes: Unit: event-to-fact mapping, GGR maths. DB tests: partitions, de-duplication, rebuild re-runnability, reconciliation, sealed exports, retention. Contract: consumes the contract examples. Reconciliation test: sum of GGR for a day = Cashier's house-account net for that day (fixture).
  - API: `GET /v1/reports/ggr-daily`, `POST /v1/exports`, `GET /v1/exports/{id}`, `GET /v1/ingestion/status` (`api/openapi.yaml`).
  - Data: `db/migrations/V001__init.sql`; invariants proven by `db/tests/` (`tools/db-verify.sh`).

## Next
- See the suite backlog (root `.agentic/backlog.md`, "Next") for this team's follow-up slices.
