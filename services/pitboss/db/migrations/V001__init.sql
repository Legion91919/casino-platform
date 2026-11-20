-- Pitboss V001: players (minimal personal data), KYC status, responsible-gambling limits, exclusions,
-- per-jurisdiction rule sets, idempotent stake authorisations, sessions with reality checks, and a
-- hash-chained audit log. Row-level security keeps every operator inside its own players.
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- for exclusion constraints mixing = and && (contrib)
CREATE SCHEMA pitboss;
SET search_path = pitboss, public;

-- Jurisdictions and their versioned rule sets --------------------------------------------------
CREATE TABLE jurisdiction (
  jurisdiction_code     text PRIMARY KEY CHECK (jurisdiction_code ~ '^JUR-[A-Z0-9]{1,8}$'),
  display_name          text NOT NULL,
  min_age               smallint NOT NULL CHECK (min_age BETWEEN 18 AND 25),
  limit_increase_delay  interval NOT NULL CHECK (limit_increase_delay >= interval '0'),
  reality_check_default interval NOT NULL CHECK (reality_check_default BETWEEN interval '5 minutes' AND interval '2 hours'),
  audit_retention       interval NOT NULL CHECK (audit_retention >= interval '5 years')
);

-- No two versions of a jurisdiction's rules may be in force at the same moment.
CREATE TABLE rule_set (
  rule_set_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jurisdiction_code text   NOT NULL REFERENCES jurisdiction,
  version           int    NOT NULL CHECK (version >= 1),
  in_force          tstzrange NOT NULL CHECK (NOT isempty(in_force) AND NOT lower_inf(in_force)),
  rules             jsonb  NOT NULL CHECK (jsonb_typeof(rules) = 'object' AND rules ? 'max_stake_minor' AND rules ? 'mandatory_limits'),
  approved_by       text   NOT NULL,
  UNIQUE (jurisdiction_code, version),
  EXCLUDE USING gist (jurisdiction_code WITH =, in_force WITH &&)
);

-- Players ----------------------------------------------------------------------------------------
-- Data minimisation: the operator keeps name, address and documents. Pitboss keeps the operator's
-- player reference, jurisdiction, KYC outcome and an application-encrypted date of birth.
CREATE TABLE player (
  player_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_code       text NOT NULL CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  operator_player_ref text NOT NULL CHECK (length(operator_player_ref) BETWEEN 1 AND 64),
  jurisdiction_code   text NOT NULL REFERENCES jurisdiction,
  kyc_status          text NOT NULL DEFAULT 'unverified'
                      CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'rejected', 'expired')),
  kyc_verified_at     timestamptz,
  age_verified        boolean NOT NULL DEFAULT false,
  dob_ciphertext      bytea,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_code, operator_player_ref),
  UNIQUE (player_id, operator_code),
  CONSTRAINT verified_means_age_checked CHECK (kyc_status <> 'verified' OR (age_verified AND kyc_verified_at IS NOT NULL))
);

-- Limits: money limits (deposit, loss, wager) per period, and session-time limits in minutes.
-- At most one limit of a type and period in force at any moment (exclusion constraint).
-- Lowering takes effect now; raising starts after the jurisdiction's limit_increase_delay (app rule,
-- recorded here as a future lower bound on in_force).
CREATE TABLE player_limit (
  limit_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id     uuid   NOT NULL,
  operator_code text   NOT NULL,
  limit_type    text   NOT NULL CHECK (limit_type IN ('deposit', 'loss', 'wager', 'session_time')),
  period        text   NOT NULL CHECK (period IN ('session', 'day', 'week', 'month')),
  amount_minor  bigint CHECK (amount_minor > 0),
  currency      char(3) CHECK (currency ~ '^[A-Z]{3}$'),
  minutes       int    CHECK (minutes BETWEEN 5 AND 1440),
  in_force      tstzrange NOT NULL CHECK (NOT isempty(in_force) AND NOT lower_inf(in_force)),
  set_by        text   NOT NULL CHECK (set_by IN ('player', 'operator', 'regulator')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (player_id, operator_code) REFERENCES player (player_id, operator_code),
  CONSTRAINT money_or_minutes CHECK (
    (limit_type = 'session_time' AND minutes IS NOT NULL AND amount_minor IS NULL AND currency IS NULL) OR
    (limit_type <> 'session_time' AND minutes IS NULL AND amount_minor IS NOT NULL AND currency IS NOT NULL)),
  CONSTRAINT no_backdated_limits CHECK (lower(in_force) >= requested_at - interval '1 second'),
  EXCLUDE USING gist (player_id WITH =, limit_type WITH =, period WITH =, in_force WITH &&)
);
CREATE INDEX player_limit_lookup ON player_limit USING gist (player_id, in_force);

-- Exclusions: cool-off (short, fixed end), self-exclusion (at least 6 months or indefinite),
-- operator- or regulator-imposed. Append-only: an exclusion can never be shortened or deleted.
CREATE TABLE exclusion (
  exclusion_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id     uuid   NOT NULL,
  operator_code text   NOT NULL,
  kind          text   NOT NULL CHECK (kind IN ('cool_off', 'self_exclusion', 'operator', 'regulator')),
  period        tstzrange NOT NULL CHECK (NOT isempty(period) AND NOT lower_inf(period)),
  reason        text   NOT NULL,
  created_by    text   NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (player_id, operator_code) REFERENCES player (player_id, operator_code),
  CONSTRAINT cool_off_is_short CHECK (kind <> 'cool_off' OR (NOT upper_inf(period) AND upper(period) - lower(period) <= interval '42 days')),
  CONSTRAINT self_exclusion_min_6_months CHECK (kind <> 'self_exclusion' OR upper_inf(period) OR upper(period) - lower(period) >= interval '180 days')
);
CREATE INDEX exclusion_active_lookup ON exclusion USING gist (player_id, period);

-- Stake authorisations (Cashier asks before accepting a stake). Idempotent per game-server txn id.
CREATE TABLE stake_authorization (
  authorization_id   uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_code      text   NOT NULL,
  player_id          uuid   NOT NULL,
  game_server_txn_id text   NOT NULL,
  game_code          text   NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL,
  decision           text   NOT NULL CHECK (decision IN ('approved', 'denied')),
  deny_reason        text   CHECK (deny_reason IN ('NOT_VERIFIED', 'EXCLUDED', 'COOL_OFF', 'LOSS_LIMIT', 'WAGER_LIMIT', 'SESSION_LIMIT', 'MAX_STAKE', 'UNKNOWN_PLAYER')),
  rule_set_id        bigint REFERENCES rule_set,
  decided_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_code, game_server_txn_id),
  FOREIGN KEY (player_id, operator_code) REFERENCES player (player_id, operator_code),
  CONSTRAINT deny_reason_iff_denied CHECK ((decision = 'denied') = (deny_reason IS NOT NULL))
);

-- Running usage per limit window, updated by authorisations (wager) and BetSettled events (loss).
CREATE TABLE limit_usage (
  player_id     uuid   NOT NULL,
  operator_code text   NOT NULL,
  limit_type    text   NOT NULL CHECK (limit_type IN ('deposit', 'loss', 'wager')),
  period        text   NOT NULL CHECK (period IN ('session', 'day', 'week', 'month')),
  window_start  timestamptz NOT NULL,
  used_minor    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, limit_type, period, window_start),
  FOREIGN KEY (player_id, operator_code) REFERENCES player (player_id, operator_code),
  CONSTRAINT only_net_loss_may_go_negative CHECK (limit_type = 'loss' OR used_minor >= 0)
);

CREATE TABLE play_session (
  session_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id             uuid NOT NULL,
  operator_code         text NOT NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  reality_check_every   interval NOT NULL CHECK (reality_check_every BETWEEN interval '5 minutes' AND interval '2 hours'),
  last_reality_check_at timestamptz,
  ended_at              timestamptz,
  end_reason            text CHECK (end_reason IN ('player', 'timeout', 'session_limit', 'excluded', 'operator')),
  FOREIGN KEY (player_id, operator_code) REFERENCES player (player_id, operator_code),
  CONSTRAINT end_reason_iff_ended CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX one_open_session_per_player ON play_session (player_id) WHERE ended_at IS NULL;

-- Hash-chained audit log -----------------------------------------------------------------------------
-- Each row's hash covers the previous row's hash for the same operator, so a removed or edited row
-- breaks the chain. An advisory lock per operator serialises appends; chain_seq is assigned under
-- that lock (identity values are not, so they can interleave). Writers use READ COMMITTED.
CREATE TABLE audit_event (
  audit_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_code text   NOT NULL,
  player_id     uuid,
  actor         text   NOT NULL,
  action        text   NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  detail        jsonb  NOT NULL DEFAULT '{}',
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  chain_seq     bigint NOT NULL DEFAULT 0,
  prev_hash     bytea,
  row_hash      bytea  NOT NULL DEFAULT '\x00',
  UNIQUE (operator_code, chain_seq)
);
CREATE INDEX audit_event_player_idx ON audit_event (operator_code, player_id, occurred_at);

CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pitboss.audit:' || NEW.operator_code, 0));
  SELECT row_hash, chain_seq + 1 INTO NEW.prev_hash, NEW.chain_seq FROM pitboss.audit_event
   WHERE operator_code = NEW.operator_code ORDER BY chain_seq DESC LIMIT 1;
  NEW.chain_seq := coalesce(NEW.chain_seq, 1);
  NEW.row_hash := sha256(coalesce(NEW.prev_hash, '\x') || convert_to(
      concat_ws('|', NEW.chain_seq, NEW.operator_code, NEW.player_id, NEW.actor, NEW.action, NEW.detail::text,
                to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8'));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_event_chain BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_chain();

-- Re-computes the chain for one operator; returns the first broken audit_id, or NULL if intact.
CREATE FUNCTION audit_first_broken(p_operator text) RETURNS bigint LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT a.*, lag(row_hash) OVER (ORDER BY chain_seq) AS expected_prev,
           lag(chain_seq, 1, 0::bigint) OVER (ORDER BY chain_seq) AS expected_seq
    FROM pitboss.audit_event a WHERE operator_code = p_operator)
  SELECT audit_id FROM ordered
  WHERE prev_hash IS DISTINCT FROM expected_prev OR chain_seq <> expected_seq + 1
     OR row_hash <> sha256(coalesce(prev_hash, '\x') || convert_to(
          concat_ws('|', chain_seq, operator_code, player_id, actor, action, detail::text,
                    to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8'))
  ORDER BY chain_seq LIMIT 1
$$;

-- Append-only guards ---------------------------------------------------------------------------------
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER exclusion_append_only BEFORE UPDATE OR DELETE ON exclusion FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_append_only     BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER authz_append_only     BEFORE UPDATE OR DELETE ON stake_authorization FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A limit row may only be closed early (upper bound moved earlier, never into the past); nothing else changes.
CREATE FUNCTION guard_limit_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'limits are never deleted; close them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.player_id, NEW.limit_type, NEW.period, NEW.amount_minor, NEW.currency, NEW.minutes, NEW.set_by, lower(NEW.in_force))
     IS DISTINCT FROM (OLD.player_id, OLD.limit_type, OLD.period, OLD.amount_minor, OLD.currency, OLD.minutes, OLD.set_by, lower(OLD.in_force))
     OR upper_inf(NEW.in_force) OR (NOT upper_inf(OLD.in_force) AND upper(NEW.in_force) > upper(OLD.in_force))
     OR upper(NEW.in_force) < now() - interval '1 second' THEN
    RAISE EXCEPTION 'a limit can only be closed, not edited' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER player_limit_guard BEFORE UPDATE OR DELETE ON player_limit FOR EACH ROW EXECUTE FUNCTION guard_limit_update();

-- Is the player blocked right now? (used by the authorisation path and by tests)
CREATE FUNCTION active_block(p_player uuid, p_at timestamptz DEFAULT now()) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN e.kind = 'cool_off' THEN 'COOL_OFF' ELSE 'EXCLUDED' END
  FROM pitboss.exclusion e WHERE e.player_id = p_player AND e.period @> p_at
  ORDER BY (e.kind = 'cool_off') LIMIT 1
$$;

-- Tenant isolation ---------------------------------------------------------------------------------
-- The application connects as a non-owner role and sets app.operator_code per request (from the
-- operator's mTLS identity). Without it, a query sees nothing.
ALTER TABLE player              ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_limit        ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stake_authorization ENABLE ROW LEVEL SECURITY;
ALTER TABLE limit_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_session        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event         ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['player', 'player_limit', 'exclusion', 'stake_authorization', 'limit_usage', 'play_session', 'audit_event'] LOOP
    EXECUTE format($p$CREATE POLICY tenant_isolation ON pitboss.%I
                      USING (operator_code = current_setting('app.operator_code', true))
                      WITH CHECK (operator_code = current_setting('app.operator_code', true))$p$, t);
  END LOOP;
END $$;

-- Events -------------------------------------------------------------------------------------------
CREATE TABLE outbox (
  position       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid   NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type     text   NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
  schema_version int    NOT NULL CHECK (schema_version >= 1),
  operator_code  text   NOT NULL,
  partition_key  text   NOT NULL,
  payload        jsonb  NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  tx_id          xid8   NOT NULL DEFAULT pg_current_xact_id(),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_feed_idx ON outbox (tx_id, position);

-- Inbox: consumed events (BetSettled from Cashier) are processed at most once.
CREATE TABLE inbox (
  event_id    uuid PRIMARY KEY,
  source      text NOT NULL CHECK (source IN ('cashier', 'dealer', 'comps')),
  event_type  text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consumer_checkpoint (
  source      text PRIMARY KEY,
  cursor      text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO jurisdiction VALUES
  ('JUR-A', 'Jurisdiction A', 18, interval '24 hours', interval '60 minutes', interval '5 years'),
  ('JUR-B', 'Jurisdiction B', 21, interval '72 hours', interval '30 minutes', interval '7 years'),
  ('JUR-C', 'Jurisdiction C', 18, interval '7 days',   interval '60 minutes', interval '6 years');
