-- Backstage V001: teams, service catalogue, golden-path templates, scorecards (tests, coverage,
-- SLOs, security, AI governance), a prompt registry with eval gates, change records for AI-assisted
-- review coverage, and onboarding. Read-heavy, internal users only.
CREATE SCHEMA backstage;
SET search_path = backstage, public;

CREATE TABLE team (
  team_code     text PRIMARY KEY CHECK (team_code ~ '^team-[a-z0-9-]{2,30}$'),
  display_name  text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('stream_aligned', 'platform', 'enabling', 'complicated_subsystem')),
  oncall_channel text NOT NULL
);

CREATE TABLE template (
  template_code text NOT NULL CHECK (template_code ~ '^[a-z][a-z0-9-]{2,40}$'),
  version       text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  description   text NOT NULL,
  includes      text[] NOT NULL,   -- e.g. {baton, ci, openapi, outbox, db-tests, otel}
  deprecated    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (template_code, version),
  CONSTRAINT golden_path_includes_baton CHECK ('baton' = ANY (includes) AND 'ci' = ANY (includes))
);

CREATE TABLE service (
  service_code     text PRIMARY KEY CHECK (service_code ~ '^[a-z][a-z0-9-]{2,30}$'),
  team_code        text NOT NULL REFERENCES team,
  tier             smallint NOT NULL CHECK (tier BETWEEN 0 AND 3),   -- 0 = money/regulated hot path
  repo_path        text NOT NULL UNIQUE CHECK (repo_path ~ '^(services|games)/[a-z0-9-]+$'),
  template_code    text NOT NULL,
  template_version text NOT NULL,
  lifecycle        text NOT NULL DEFAULT 'experimental' CHECK (lifecycle IN ('experimental', 'production', 'deprecated')),
  FOREIGN KEY (template_code, template_version) REFERENCES template
);

CREATE TABLE service_dependency (
  service_code   text NOT NULL REFERENCES service,
  depends_on     text NOT NULL REFERENCES service,
  style          text NOT NULL CHECK (style IN ('sync_http', 'event_feed')),
  PRIMARY KEY (service_code, depends_on, style),
  CONSTRAINT no_self_dependency CHECK (service_code <> depends_on)
);

CREATE TABLE scorecard_check (
  check_code  text PRIMARY KEY CHECK (check_code ~ '^[a-z_]+\.[a-z_]+$'),
  category    text NOT NULL CHECK (category IN ('tests', 'coverage', 'slo', 'security', 'ai_governance', 'docs')),
  description text NOT NULL,
  min_tier    smallint NOT NULL DEFAULT 3 CHECK (min_tier BETWEEN 0 AND 3),  -- applies to services with tier <= min_tier
  threshold   numeric(6,2)
);

CREATE TABLE scorecard_result (
  service_code text NOT NULL REFERENCES service,
  check_code   text NOT NULL REFERENCES scorecard_check,
  measured_at  timestamptz NOT NULL DEFAULT now(),
  value        numeric(8,2),
  passed       boolean NOT NULL,
  evidence_url text NOT NULL CHECK (evidence_url ~ '^https://'),
  PRIMARY KEY (service_code, check_code, measured_at)
);

CREATE VIEW scorecard_latest AS
SELECT DISTINCT ON (r.service_code, r.check_code) r.service_code, s.team_code, r.check_code, c.category, r.value, r.passed, r.measured_at
FROM scorecard_result r JOIN service s USING (service_code) JOIN scorecard_check c USING (check_code)
ORDER BY r.service_code, r.check_code, r.measured_at DESC;

CREATE VIEW team_score AS
SELECT team_code, count(*) AS checks, count(*) FILTER (WHERE passed) AS passing,
       round(100.0 * count(*) FILTER (WHERE passed) / count(*), 1) AS pct
FROM scorecard_latest GROUP BY team_code;

-- AI governance ------------------------------------------------------------------------------------
-- Every prompt used in production is versioned, hashed, owned and approved; an approved version is
-- immutable. A version may only be promoted after an eval run at or above its threshold.
CREATE TABLE prompt_version (
  prompt_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_code  text NOT NULL REFERENCES service,
  name          text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_.-]{2,60}$'),
  version       int  NOT NULL CHECK (version >= 1),
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  purpose       text NOT NULL,
  eval_suite    text NOT NULL,
  eval_threshold numeric(5,4) NOT NULL CHECK (eval_threshold BETWEEN 0 AND 1),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by   text,
  approved_at   timestamptz,
  UNIQUE (service_code, name, version),
  CONSTRAINT approval_complete CHECK ((status = 'draft') = (approved_by IS NULL AND approved_at IS NULL))
);

CREATE TABLE eval_run (
  eval_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prompt_id   bigint NOT NULL REFERENCES prompt_version,
  model_ref   text   NOT NULL,
  cases       int    NOT NULL CHECK (cases >= 20),
  score       numeric(5,4) NOT NULL CHECK (score BETWEEN 0 AND 1),
  threshold   numeric(5,4) NOT NULL CHECK (threshold BETWEEN 0 AND 1),
  passed      boolean GENERATED ALWAYS AS (score >= threshold) STORED,
  run_at      timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION guard_prompt_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft'
     AND (NEW.content_sha256, NEW.name, NEW.version, NEW.service_code, NEW.eval_threshold)
         IS DISTINCT FROM (OLD.content_sha256, OLD.name, OLD.version, OLD.service_code, OLD.eval_threshold) THEN
    RAISE EXCEPTION 'approved prompt versions are immutable; create version %', OLD.version + 1 USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') AND NOT EXISTS (
       SELECT 1 FROM backstage.eval_run e WHERE e.prompt_id = NEW.prompt_id AND e.passed AND e.threshold >= NEW.eval_threshold) THEN
    RAISE EXCEPTION 'prompt % v% has no passing eval run at threshold %', NEW.name, NEW.version, NEW.eval_threshold USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prompt_version_guard BEFORE INSERT OR UPDATE ON prompt_version FOR EACH ROW EXECUTE FUNCTION guard_prompt_version();

-- Change records: every merged change, with whether an AI agent wrote any of it. An AI-assisted change
-- needs a human reviewer who is not the author; tier-0 services also need the critic-agent review.
CREATE TABLE change_record (
  change_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_code   text NOT NULL REFERENCES service,
  pr_ref         text NOT NULL,
  author         text NOT NULL,
  ai_assisted    boolean NOT NULL,
  human_reviewer text,
  critic_review  boolean NOT NULL DEFAULT false,
  tests_added    boolean NOT NULL,
  merged_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_code, pr_ref),
  CONSTRAINT someone_else_reviewed CHECK (human_reviewer IS NOT NULL AND human_reviewer <> author),
  CONSTRAINT ai_changes_reviewed_by_human CHECK (NOT ai_assisted OR human_reviewer IS NOT NULL)
);

CREATE FUNCTION guard_tier0_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ai_assisted AND NOT NEW.critic_review AND
     (SELECT tier FROM backstage.service WHERE service_code = NEW.service_code) = 0 THEN
    RAISE EXCEPTION 'AI-assisted change to a tier-0 service needs a critic review' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER change_record_tier0 BEFORE INSERT ON change_record FOR EACH ROW EXECUTE FUNCTION guard_tier0_change();

-- Share of AI-assisted changes in the last 30 days that had human + critic review (scorecard input).
CREATE VIEW ai_review_coverage AS
SELECT service_code,
       count(*) FILTER (WHERE ai_assisted) AS ai_changes,
       round(100.0 * count(*) FILTER (WHERE ai_assisted AND critic_review) / NULLIF(count(*) FILTER (WHERE ai_assisted), 0), 1) AS critic_pct
FROM change_record WHERE merged_at > now() - interval '30 days'
GROUP BY service_code;

CREATE TABLE onboarding_task (
  task_code   text PRIMARY KEY,
  title       text NOT NULL,
  applies_to  text NOT NULL CHECK (applies_to IN ('engineer', 'studio')),
  sort_order  int  NOT NULL
);

CREATE TABLE onboarding_progress (
  person_ref   text NOT NULL,
  task_code    text NOT NULL REFERENCES onboarding_task,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_ref, task_code)
);

INSERT INTO team VALUES
  ('team-cashier',   'Cashier team',   'stream_aligned',        '#cashier-oncall'),
  ('team-pitboss',   'Pitboss team',   'complicated_subsystem', '#pitboss-oncall'),
  ('team-dealer',    'Dealer team',    'stream_aligned',        '#dealer-oncall'),
  ('team-comps',     'Comps team',     'stream_aligned',        '#comps-oncall'),
  ('team-countroom', 'Countroom team', 'stream_aligned',        '#countroom-oncall'),
  ('team-backstage', 'Backstage team', 'platform',              '#backstage-help');
INSERT INTO template VALUES
  ('dotnet-service', '1.0.0', 'ASP.NET Core service with baton, CI, OpenAPI, Postgres migrations + DB tests, outbox, OpenTelemetry',
   '{baton, ci, openapi, outbox, db-tests, otel}', false),
  ('game-server-adapter', '1.0.0', 'Studio game-server starter: wallet client with idempotency keys, contract tests against Cashier',
   '{baton, ci, wallet-client, contract-tests}', false);
INSERT INTO scorecard_check VALUES
  ('tests.ci_green',          'tests',         'Main branch CI green in the last 24 hours', 3, NULL),
  ('coverage.line',           'coverage',      'Line coverage at or above the ratchet',     3, 70),
  ('tests.db_constraints',    'tests',         'db-verify passes for the service',          3, NULL),
  ('slo.error_budget',        'slo',           'Error budget remaining this month (%)',     1, 25),
  ('security.no_criticals',   'security',      'No critical dependency or secret findings', 3, NULL),
  ('ai_governance.review',    'ai_governance', 'AI-assisted changes with human review (%)', 3, 100),
  ('ai_governance.critic',    'ai_governance', 'AI-assisted tier-0 changes with critic review (%)', 0, 100),
  ('ai_governance.prompts',   'ai_governance', 'Production prompts registered with a passing eval', 3, NULL),
  ('docs.baton_fresh',        'docs',          '.agentic/next-step.md updated in the last 14 days', 3, NULL);
