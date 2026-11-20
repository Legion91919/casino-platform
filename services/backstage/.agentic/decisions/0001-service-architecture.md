# ADR-0001 (Backstage): Layered monolith inside the service, launch vs global scale

- Status: accepted
- Date: 2026-11-20
- Owner: `team-backstage`

## Context
Developer portal for platform teams and game studios: golden-path templates that come with the kit's Baton (`.agentic/`), CI, OpenAPI stub, migrations with DB tests, outbox and telemetry; a service catalogue; scorecards per team (tests, coverage, SLOs, security, AI governance: review coverage, critic reviews, prompt registry, eval gates); onboarding.

Launch traits: `InternalUsersOnly ReadHeavy SmallTeam`. Global-scale traits: `InternalUsersOnly ReadHeavy SeveralBusinessAreas`.

## Advisor output
`arch-advisor recommend InternalUsersOnly ReadHeavy SmallTeam` → **LayeredMonolith**: A single, simple business area. Layers are enough; anything more is ceremony.
Patterns: CachedReadModel.
Closest reference systems:
- Employee tool (leave, timesheets) (similarity 0.50): Monolith: layered, or Clean Architecture if the approval rules are complex.
- Reporting warehouse fed by many sources (similarity 0.40): One re-runnable import job per source into a single warehouse, and a plain read-only reporting app on top.

`arch-advisor compare` at launch:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Layered monolith | Recommended | 1 | Matches the advisor's recommended style (LayeredMonolith). |
| Vertical slice monolith | Good alternative | 2 | Same family as the recommendation (LayeredMonolith); a valid variant if its trade-offs suit the team. |
| Clean Architecture monolith | Possible | 2 | Small team: low enough operational load to run comfortably. |
| Modular monolith | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Modular monolith + CQRS read models | Possible | 3 | Read-heavy: separate read models keep queries fast. |
| Serverless functions + queues | Possible | 3 | Small team: low enough operational load to run comfortably. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |
| Event-sourced core with CQRS | Poor fit | 4 | Event sourcing's cost isn't repaid without audit, money or replay needs. |
| Microservices (request/response) | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |
| Event-driven microservices | Poor fit | 5 | A small team can't run a distributed system well (deployments, tracing, on-call). |

`arch-advisor compare` at global scale (top rows) → **ModularMonolith**:

| Option | Fit | Complexity (1-5) | Main reason |
|---|---|---|---|
| Modular monolith + CQRS read models | Recommended | 3 | Matches the advisor's recommended style (ModularMonolith). |
| Modular monolith | Good alternative | 3 | Same family as the recommendation (ModularMonolith); a valid variant if its trade-offs suit the team. |
| Serverless functions + queues | Possible | 3 | Workable, but nothing in the profile calls for it. |
| Static site + serverless function | Poor fit | 1 | The product has real server-side behaviour and data; a static site can't hold it. |

## Decision
Accept the advisor's layered monolith: no money, no personal data, internal users. The one rule-heavy part (AI-governance rules: no self-review, AI changes need a human reviewer, tier-0 AI changes need the critic, approved prompts immutable and gated by evals) is enforced in the database so the merge bot, the API and ad-hoc scripts all obey it.

## Why not the alternatives
- **Clean Architecture (more structure)**: not needed until rules leak into controllers (advisor's evolve trigger).
- **Adopting an off-the-shelf portal framework (bought)**: a plausible later choice; for the portfolio the catalogue and scorecards are small, and the governance rules are the point.
- **Static site generated from the repo (simpler)**: can't accept CI results, change records or eval runs.

## Consequences
- Domain rules are unit-tested without PostgreSQL; the database independently enforces the invariants that must never break (`db/tests/` proves them).
- The service exposes only its API and its event feed; nothing else reads its database.

## Revisit when (advisor's triggers, plus ours)
- Business rules start leaking into controllers or SQL: move to Clean Architecture.
- A second business area appears: split into modules.
- Search becomes the bottleneck: move it to a dedicated search service.
- If catalogue, templates and governance grow apart (global answer: modular monolith), split into modules with their own tables; no reason to become a separate set of services.
