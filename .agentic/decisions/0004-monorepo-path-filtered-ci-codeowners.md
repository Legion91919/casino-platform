# ADR-0004: One monorepo, path-filtered CI, team ownership with CODEOWNERS

- Status: accepted
- Date: 2026-11-20

## Context
Six teams, six services, shared contracts and a golden-path template. Cross-service changes (a new
event field and its consumers) must be reviewable in one place; teams must still deploy independently
and not wait for each other's builds. AI agents work in the repo and need the same boundaries.

## Decision
- **One repository**: `services/<name>/` (code, `api/`, `db/`, `.agentic/`), `contracts/`, `docs/`, `tools/`.
- **Path-filtered CI** (`.github/workflows/ci.yml`): a change under `services/cashier/**` runs only
  Cashier's jobs; a change under `contracts/**` runs contract validation and the contract tests of
  every listed consumer; a change under `tools/sql/**` runs every service's DB tests. DB migrations
  and tests run against a `postgres:16` service container via `tools/db-verify.sh`.
- **Independent deploys**: each service has its own pipeline, image and version; no "release train".
- **CODEOWNERS** (`.github/CODEOWNERS`): each service folder is owned by its team; `contracts/events/<event>`
  requires the producer team *and* `team-backstage`; DB migrations of tier-0 services also require a
  second reviewer from the owning team. Branch protection makes CODEOWNERS reviews mandatory.
- **Baton per service**: each service has its own `.agentic/` so an agent working on Cashier loads
  Cashier's context only. The root `.agentic/` holds suite-level decisions.
- **AI governance in the pipeline**: privacy guard, secret scan, the change-record check in
  Backstage (AI-assisted change needs a human reviewer who is not the author; tier-0 also needs the
  critic agent's review), prompt registry and eval gates for any service that ships a prompt.

## Alternatives
- **Repo per service** (more isolation): cross-service changes become multi-repo choreography, and
  contracts drift. Rejected.
- **Monorepo without path filters** (simpler): every push builds everything; slow feedback, and one
  team's flaky test blocks another. Rejected.

## Consequences
- CI configuration must keep path filters in step with the folder layout (a test checks that every `services/*` folder has a CI job and a CODEOWNERS line).
- A shared-tool change (test helpers, templates) triggers many jobs; acceptable and intended.

## Revisit when
CI time for the busiest path exceeds 15 minutes, or the repo outgrows the forge's limits (then: build cache, or split Backstage and studio templates out).
