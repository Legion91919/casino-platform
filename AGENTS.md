# AGENTS.md

Casino Platform: Casino operators cannot offer many studios' games to players across several regulated jurisdictions without each integration re-building wallet, responsible-gambling, release and reporting rules, because there is no shared, auditable platform between operators and game teams, and it costs months per integration plus licence risk on every money or limit mistake.

## Read first
Everything about this project lives in the hidden `.agentic/` folder.
Start with `.agentic/README.md`; it says which file answers which question.
Load only the files your task needs.
This is a monorepo: each `services/<name>/` has its own `.agentic/`. Work inside one service at a time;
cross-service changes go through `contracts/` (producer and consumers approve).

## Hard rules
- Work in thin vertical slices: one ticket from `.agentic/backlog.md` at a time.
- No change without a test that fails first. Run the full test suite before you finish.
- A decision that is hard to reverse gets an ADR in `.agentic/decisions/`.
- Never commit secrets, real client data or personal data. Use `.env.example`.
- Do not grow this file. New knowledge goes in the right `.agentic/` file; history goes in `.agentic/changelog.md`.
- Money: integer minor units, append-only ledger, idempotency keys (ADR-0005). Never weaken a DB constraint to make a test pass.
- Run `tools/db-verify.sh` after any SQL change and `python3 tools/validate-contracts.py` after any contract or API change.
- All companies, studios and jurisdictions are invented; never add real names.
- When you learn something that would help on the next project, add it to `.agentic/lessons.md`.