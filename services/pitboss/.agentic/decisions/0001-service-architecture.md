# ADR-0001 (Pitboss): Clean Architecture inside the service, launch vs global scale

- Status: accepted
- Date: 2026-11-20
- Owner: `team-pitboss`

## Context
Player accounts and responsible gambling: KYC status, deposit/loss/wager/session limits, cool-off and self-exclusion, per-jurisdiction rule sets, reality checks, and a tamper-evident audit log. Cashier asks Pitboss before accepting every stake.

Launch traits: `PersonalData RegulatoryAudit ComplexBusinessRules MultiTenant SmallTeam`. Global-scale traits: `PersonalData RegulatoryAudit ComplexBusinessRules MultiTenant GlobalScale`.

## Advisor output
`arch-advisor recommend PersonalData RegulatoryAudit ComplexBusinessRules MultiTenant SmallTeam` → **CleanArchitecture**: One business area with rules that must be tested without the database or UI. Keep the domain at the centre.
Patterns: AuditTrail, PersonalDataProtection, TenantIsolation.
Closest reference systems:
- Clinic or hospital patient system (similarity 0.50): Clean Architecture or modular monolith, with a full audit history.
- Document extraction with human review (similarity 0.50): Clean Architecture API plus a worker fed by a queue; fields the model is unsure about wait for a person.

`arch-advisor compare` at launch:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Clean Architecture monolith | Recommended | 2 | Matches the advisor's recommended style (CleanArchitecture). |
| Layered monolith | Possible | 1 | Small team: low enough operational load to run comfortably. |
| Vertical slice monolith | Possible | 2 | Small team: low enough operational load to run comfortably. |
| Modular monolith | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Modular monolith + CQRS read models | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Serverless functions + queues | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Event-sourced core with CQRS | Possible | 4 | Audit: the event log is the audit trail, with replay for free. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Microservices (request/response) | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |
| Event-driven microservices | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |

`arch-advisor compare` at global scale (top rows) → **Microservices**:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Microservices (request/response) | Recommended | 5 | Matches the advisor's recommended style (Microservices). |
| Serverless functions + queues | Good alternative | 3 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Event-driven microservices | Good alternative | 5 | Same family as the recommendation (Microservices); a valid variant if its trade-offs suit the team. |
| Modular monolith | Possible | 3 | Workable, but nothing in the profile calls for it. |

## Decision
Accept Clean Architecture: the rule engine (jurisdiction rule set + player limits + exclusions -> decision) is pure and table-tested per jurisdiction. Keep the decision synchronous and fail closed. Add two database-level guarantees beyond the advisor's patterns: exclusion constraints (no overlapping limits or rule sets) and a hash-chained audit log, because the audit must survive a buggy or malicious writer.

## Why not the alternatives
- **Layered monolith (simpler)**: per-jurisdiction rules need to be tested without HTTP or SQL; layering alone lets them leak.
- **Rules engine product / externalised rule DSL (more complex)**: three jurisdictions fit in versioned JSON rule sets plus code; a DSL adds a second language to certify. Revisit at ~10 jurisdictions.
- **Splitting authorisation from player admin now (global-scale answer)**: the authorisation needs the same data; split it as a read-optimised replica or an allowance lease (DESIGN §9) when the per-bet call becomes the bottleneck.

## Consequences
- Domain rules are unit-tested without PostgreSQL; the database independently enforces the invariants that must never break (`db/tests/` proves them).
- The service exposes only its API and its event feed; nothing else reads its database.

## Revisit when (advisor's triggers, plus ours)
- A second business area appears with its own language: make it a module of a modular monolith.
- At global scale the advisor says Microservices: the first step is a stake-allowance lease so Cashier checks a short-lived pre-authorised budget locally; the second is a separate authorisation service reading a replica.
