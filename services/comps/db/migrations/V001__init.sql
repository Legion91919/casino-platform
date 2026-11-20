-- Comps V001: bonus campaigns, awards with wagering requirements, free-spin grants, wagering progress
-- from BetSettled events (idempotent per event), expiry. Bonus MONEY lives in Cashier's player_bonus
-- account; Comps owns the rules and the state, and asks Cashier to credit, convert or forfeit.
CREATE SCHEMA comps;
SET search_path = comps, public;

CREATE TABLE campaign (
  campaign_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_code       text   NOT NULL CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  code                text   NOT NULL CHECK (code ~ '^[A-Z0-9_]{3,32}$'),
  kind                text   NOT NULL CHECK (kind IN ('free_spins', 'deposit_match')),
  currency            char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  match_pct           smallint CHECK (match_pct BETWEEN 1 AND 200),
  max_award_minor     bigint NOT NULL CHECK (max_award_minor > 0),
  wagering_multiplier smallint NOT NULL CHECK (wagering_multiplier BETWEEN 0 AND 60),
  award_ttl           interval NOT NULL CHECK (award_ttl BETWEEN interval '1 day' AND interval '90 days'),
  valid               tstzrange NOT NULL CHECK (NOT isempty(valid) AND NOT lower_inf(valid) AND NOT upper_inf(valid)),
  jurisdictions       text[] NOT NULL CHECK (cardinality(jurisdictions) > 0),
  approved_by         text   NOT NULL,
  UNIQUE (operator_code, code),
  UNIQUE (campaign_id, operator_code, currency),
  CONSTRAINT match_pct_only_for_deposit_match CHECK ((kind = 'deposit_match') = (match_pct IS NOT NULL))
);

-- How much a stake on each game category counts towards wagering (e.g. slots 100%, table 10%).
CREATE TABLE game_contribution (
  operator_code text NOT NULL,
  category      text NOT NULL CHECK (category IN ('slot', 'table', 'live', 'instant', 'crash')),
  pct           smallint NOT NULL CHECK (pct BETWEEN 0 AND 100),
  PRIMARY KEY (operator_code, category)
);

CREATE TABLE award (
  award_id                uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id             bigint NOT NULL,
  operator_code           text   NOT NULL,
  player_id               uuid   NOT NULL,
  currency                char(3) NOT NULL,
  award_key               text   NOT NULL,
  awarded_minor           bigint NOT NULL CHECK (awarded_minor >= 0),
  wagering_required_minor bigint NOT NULL CHECK (wagering_required_minor >= 0),
  wagering_progress_minor bigint NOT NULL DEFAULT 0 CHECK (wagering_progress_minor >= 0),
  status                  text   NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'forfeited')),
  awarded_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  closed_at               timestamptz,
  cashier_credit_txn_id   text,
  FOREIGN KEY (campaign_id, operator_code, currency) REFERENCES campaign (campaign_id, operator_code, currency),
  -- award_key = the triggering fact (e.g. deposit id), so a redelivered trigger never awards twice
  UNIQUE (operator_code, award_key),
  CONSTRAINT expires_after_award CHECK (expires_at > awarded_at),
  CONSTRAINT completed_means_wagered CHECK (status <> 'completed' OR wagering_progress_minor >= wagering_required_minor),
  CONSTRAINT closed_at_iff_not_active CHECK ((status = 'active') = (closed_at IS NULL))
);
-- One active award per player per campaign.
CREATE UNIQUE INDEX award_one_active_per_campaign ON award (campaign_id, player_id) WHERE status = 'active';
CREATE INDEX award_active_by_player ON award (operator_code, player_id) WHERE status = 'active';
CREATE INDEX award_expiry_idx ON award (expires_at) WHERE status = 'active';

CREATE FUNCTION guard_award_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.campaign_id, NEW.player_id, NEW.awarded_minor, NEW.wagering_required_minor, NEW.awarded_at, NEW.expires_at, NEW.award_key)
     IS DISTINCT FROM (OLD.campaign_id, OLD.player_id, OLD.awarded_minor, OLD.wagering_required_minor, OLD.awarded_at, OLD.expires_at, OLD.award_key) THEN
    RAISE EXCEPTION 'award terms are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'active' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'award % is % and final', OLD.award_id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.wagering_progress_minor < OLD.wagering_progress_minor THEN
    RAISE EXCEPTION 'wagering progress never goes down' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER award_transition BEFORE UPDATE ON award FOR EACH ROW EXECUTE FUNCTION guard_award_transition();

CREATE TABLE free_spin_grant (
  grant_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  award_id         uuid   NOT NULL UNIQUE REFERENCES award,
  game_code        text   NOT NULL,
  spin_value_minor bigint NOT NULL CHECK (spin_value_minor > 0),
  spins_total      int    NOT NULL CHECK (spins_total BETWEEN 1 AND 500),
  spins_used       int    NOT NULL DEFAULT 0,
  CONSTRAINT spins_within_grant CHECK (spins_used BETWEEN 0 AND spins_total)
);

-- One row per (award, bet event): BetSettled can be delivered twice, wagering counts once.
CREATE TABLE wagering_contribution (
  contribution_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  award_id         uuid   NOT NULL REFERENCES award,
  bet_event_id     uuid   NOT NULL,
  game_category    text   NOT NULL,
  stake_minor      bigint NOT NULL CHECK (stake_minor > 0),
  contribution_pct smallint NOT NULL CHECK (contribution_pct BETWEEN 0 AND 100),
  contributed_minor bigint GENERATED ALWAYS AS (stake_minor * contribution_pct / 100) STORED,
  bet_settled_at   timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (award_id, bet_event_id)
);

-- Contributions only count for an active award, for bets settled before it expires; progress
-- moves in the same transaction and the award completes when the requirement is met.
CREATE FUNCTION apply_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a comps.award%ROWTYPE;
BEGIN
  SELECT * INTO a FROM comps.award WHERE award_id = NEW.award_id FOR UPDATE;
  IF a.status <> 'active' THEN
    RAISE EXCEPTION 'award % is % and takes no more wagering', a.award_id, a.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.bet_settled_at >= a.expires_at OR NEW.bet_settled_at < a.awarded_at THEN
    RAISE EXCEPTION 'bet settled outside the award window' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE comps.award
     SET wagering_progress_minor = wagering_progress_minor + NEW.contributed_minor,
         status    = CASE WHEN wagering_progress_minor + NEW.contributed_minor >= wagering_required_minor THEN 'completed' ELSE status END,
         closed_at = CASE WHEN wagering_progress_minor + NEW.contributed_minor >= wagering_required_minor THEN now() ELSE closed_at END
   WHERE award_id = NEW.award_id;
  RETURN NULL;
END $$;
CREATE TRIGGER wagering_contribution_apply AFTER INSERT ON wagering_contribution FOR EACH ROW EXECUTE FUNCTION apply_contribution();

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER wagering_contribution_append_only BEFORE UPDATE OR DELETE ON wagering_contribution
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Events -----------------------------------------------------------------------------------------------
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

CREATE TABLE inbox (
  event_id    uuid PRIMARY KEY,
  source      text NOT NULL CHECK (source IN ('cashier', 'pitboss', 'dealer')),
  event_type  text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consumer_checkpoint (
  source     text PRIMARY KEY,
  cursor     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Expiry sweep (scheduled every minute): returns how many awards expired; each emits BonusExpired.
CREATE FUNCTION expire_awards(p_now timestamptz DEFAULT now()) RETURNS int LANGUAGE sql AS $$
  WITH expired AS (
    UPDATE comps.award SET status = 'expired', closed_at = p_now
     WHERE status = 'active' AND expires_at <= p_now
     RETURNING award_id, operator_code, player_id, currency)
  , events AS (
    INSERT INTO comps.outbox (event_type, schema_version, operator_code, partition_key, payload)
    SELECT 'BonusExpired', 1, operator_code, player_id::text,
           jsonb_build_object('awardId', award_id, 'playerId', player_id, 'currency', currency)
    FROM expired RETURNING 1)
  SELECT count(*)::int FROM events
$$;
