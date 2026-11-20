-- Proves: catalogue integrity, golden-path templates carry the baton, scorecards show the latest
-- result, prompts need a passing eval before approval and are immutable after, and AI-assisted
-- changes need human (and for tier 0, critic) review.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
SET search_path = backstage, public;

INSERT INTO service VALUES
  ('cashier',   'team-cashier',   0, 'services/cashier',   'dotnet-service', '1.0.0', 'production'),
  ('comps',     'team-comps',     1, 'services/comps',     'dotnet-service', '1.0.0', 'production');
SELECT pg_temp.throws($q$INSERT INTO backstage.service VALUES ('ghost', 'team-nobody', 2, 'services/ghost', 'dotnet-service', '1.0.0', 'experimental')$q$,
  '23503', 'every service has an owning team');
SELECT pg_temp.throws($q$INSERT INTO backstage.service VALUES ('dup', 'team-comps', 2, 'services/comps', 'dotnet-service', '1.0.0', 'experimental')$q$,
  '23505', 'one service per repo path');
SELECT pg_temp.throws($q$INSERT INTO backstage.template VALUES ('bare-api', '0.1.0', 'no baton', '{ci}', false)$q$,
  '23514', 'a golden-path template must include the baton and CI');
SELECT pg_temp.throws($q$INSERT INTO backstage.service_dependency VALUES ('cashier', 'cashier', 'sync_http')$q$,
  '23514', 'a service cannot depend on itself');

INSERT INTO scorecard_result (service_code, check_code, measured_at, value, passed, evidence_url) VALUES
  ('cashier', 'coverage.line', now() - interval '2 days', 64, false, 'https://ci.example.test/run/1'),
  ('cashier', 'coverage.line', now(),                     81, true,  'https://ci.example.test/run/2'),
  ('cashier', 'ai_governance.review', now(),             100, true,  'https://ci.example.test/run/2');
SELECT pg_temp.ok((SELECT passed FROM scorecard_latest WHERE service_code = 'cashier' AND check_code = 'coverage.line'),
  'scorecard shows the latest measurement, not the oldest');
SELECT pg_temp.ok((SELECT pct FROM team_score WHERE team_code = 'team-cashier') = 100.0, 'team score aggregates latest results');

INSERT INTO prompt_version (service_code, name, version, content_sha256, purpose, eval_suite, eval_threshold)
VALUES ('comps', 'bonus-terms.summary', 1, sha256('prompt v1'), 'Summarise bonus terms for support agents', 'evals/bonus-terms', 0.9000);
SELECT pg_temp.throws($q$UPDATE backstage.prompt_version SET status = 'approved', approved_by = 'ai-lead', approved_at = now()$q$,
  '23514', 'a prompt cannot be approved without a passing eval run');
INSERT INTO eval_run (prompt_id, model_ref, cases, score, threshold)
SELECT prompt_id, 'model-x-2026-10', 120, 0.8700, 0.9000 FROM prompt_version;
SELECT pg_temp.throws($q$UPDATE backstage.prompt_version SET status = 'approved', approved_by = 'ai-lead', approved_at = now()$q$,
  '23514', 'a failing eval run (0.87 < 0.90) does not unlock approval');
SELECT pg_temp.throws($q$INSERT INTO backstage.eval_run (prompt_id, model_ref, cases, score, threshold)
  SELECT prompt_id, 'model-x', 5, 1, 0.9 FROM backstage.prompt_version$q$, '23514', 'an eval run needs at least 20 cases');
INSERT INTO eval_run (prompt_id, model_ref, cases, score, threshold)
SELECT prompt_id, 'model-x-2026-10', 120, 0.9400, 0.9000 FROM prompt_version;
UPDATE prompt_version SET status = 'approved', approved_by = 'ai-lead', approved_at = now();
SELECT pg_temp.ok(true, 'a passing eval run (0.94 >= 0.90) unlocks approval');
SELECT pg_temp.throws($q$UPDATE backstage.prompt_version SET content_sha256 = sha256('sneaky edit')$q$, '42501',
  'an approved prompt cannot be edited in place');

INSERT INTO change_record (service_code, pr_ref, author, ai_assisted, human_reviewer, critic_review, tests_added)
VALUES ('comps', 'PR-101', 'dev-a', true, 'dev-b', false, true);
SELECT pg_temp.ok(true, 'AI-assisted change to a tier-1 service with a human reviewer is accepted');
SELECT pg_temp.throws($q$INSERT INTO backstage.change_record (service_code, pr_ref, author, ai_assisted, human_reviewer, tests_added)
  VALUES ('comps', 'PR-102', 'dev-a', true, NULL, true)$q$, '23514', 'an AI-assisted change without a human reviewer is rejected');
SELECT pg_temp.throws($q$INSERT INTO backstage.change_record (service_code, pr_ref, author, ai_assisted, human_reviewer, tests_added)
  VALUES ('comps', 'PR-103', 'dev-a', false, 'dev-a', true)$q$, '23514', 'authors cannot review their own change');
SELECT pg_temp.throws($q$INSERT INTO backstage.change_record (service_code, pr_ref, author, ai_assisted, human_reviewer, critic_review, tests_added)
  VALUES ('cashier', 'PR-201', 'dev-a', true, 'dev-b', false, true)$q$, '23514',
  'an AI-assisted change to a tier-0 (money) service needs a critic review');
INSERT INTO change_record (service_code, pr_ref, author, ai_assisted, human_reviewer, critic_review, tests_added)
VALUES ('cashier', 'PR-202', 'dev-a', true, 'dev-b', true, true);
SELECT pg_temp.ok((SELECT critic_pct FROM ai_review_coverage WHERE service_code = 'cashier') = 100.0,
  'AI review coverage view reports 100% critic coverage for cashier');
ROLLBACK;
