# Backlog: Backstage

## Now
- [ ] **Slice 1**: A team scaffolds a new service from the golden path and sees its scorecard filled by CI, including AI-governance checks.
  - Given team-comps, when it scaffolds `comps-reports` from dotnet-service 1.0.0 with a purpose and traits, then a pull request opens containing `.agentic/` (product, advisor recommendation, backlog), CI, an OpenAPI stub, a V001 migration and a DB test harness.
  - Given a template without the Baton or CI, then it cannot be registered as a golden path.
  - Given CI posts results for the service, then its scorecard shows the latest result per check and the team score updates.
  - Given an AI-assisted pull request with no human reviewer, or reviewed by its author, then the change record is refused and the merge bot blocks the merge.
  - Given an AI-assisted change to a tier-0 service without a critic review, then it is refused.
  - Given a prompt version without a passing eval run (at least 20 cases, score >= threshold), then it cannot be approved; once approved it cannot be edited.
  - Test notes: DB tests for every governance rule; API tests for scaffolding (template snapshot test: the generated folder matches the expected tree); a test that every `services/*` folder has a CODEOWNERS line and a CI path filter.
  - API: `GET/POST /v1/services`, `GET /v1/services/{code}/scorecard`, `POST /v1/scorecard-results`, `POST /v1/prompts`, `POST /v1/eval-runs`, `POST /v1/change-records` (`api/openapi.yaml`).
  - Data: `db/migrations/V001__init.sql`; invariants proven by `db/tests/` (`tools/db-verify.sh`).

## Next
- See the suite backlog (root `.agentic/backlog.md`, "Next") for this team's follow-up slices.
