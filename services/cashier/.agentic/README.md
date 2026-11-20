# Cashier: project map

Suite-level context (architecture, money rules, event rules) lives in the repository root `.agentic/`.
This folder holds only what is specific to Cashier.

| Question | File |
|---|---|
| What problem, for whom, which traits? | `product.md` |
| Why is it built this way? | `decisions/` (and root `.agentic/decisions/` for suite rules) |
| What is being built next? | `backlog.md` |
| What is the API? | `../api/openapi.yaml` |
| What does the database guarantee? | `../db/migrations/`, proven by `../db/tests/` |
