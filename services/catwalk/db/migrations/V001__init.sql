-- Catwalk V001: the player's round history. A read model built from two independent sources:
--   * RoundOutcomeRecorded from studio game servers (what the certified game decided, signed)
--   * BetSettled from Cashier (what the wallet actually paid)
-- A round is shown with a wallet check: confirmed when both agree, mismatch when they don't,
-- pending until Cashier's event arrives. Either event may arrive first.
-- The rules that matter most: a player only ever sees their own rounds (row-level security,
-- enforced by PostgreSQL, not by the API), and a recorded round never changes.
CREATE SCHEMA catwalk;
SET search_path = catwalk, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catwalk_reader') THEN CREATE ROLE catwalk_reader NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catwalk_ingest') THEN CREATE ROLE catwalk_ingest NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA catwalk TO catwalk_reader, catwalk_ingest;

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

-- Monthly partitions: player history is served for 12 months; older partitions are detached and
-- archived per jurisdiction retention rules (drop_partitions_before), never row-deleted.
CREATE TABLE round_record (
  studio_code         text   NOT NULL CHECK (studio_code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  round_id            uuid   NOT NULL,
  played_at           timestamptz NOT NULL,
  operator_code       text   NOT NULL CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  player_id           uuid   NOT NULL,                     -- pseudonymous; Catwalk holds no names or contact details
  game_code           text   NOT NULL CHECK (game_code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  build_version       text   NOT NULL,
  math_model_sha256   text   NOT NULL CHECK (math_model_sha256 ~ '^[0-9a-f]{64}$'),
  jurisdiction_code   text   NOT NULL CHECK (jurisdiction_code ~ '^JUR-[A-Z0-9]{1,8}$'),
  currency            text   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stake_minor         bigint NOT NULL CHECK (stake_minor > 0),
  win_minor           bigint NOT NULL CHECK (win_minor >= 0),
  balance_after_minor bigint NOT NULL,
  outcome             jsonb  NOT NULL CHECK (jsonb_typeof(outcome) = 'object' AND outcome ? 'stops' AND outcome ? 'grid'),
  signature           jsonb  NOT NULL CHECK (signature ? 'keyId' AND signature ? 'value'),
  event_id            uuid   NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_code, round_id, played_at)
) PARTITION BY RANGE (played_at);
CREATE INDEX round_record_player_idx ON round_record (operator_code, player_id, played_at DESC, round_id DESC);
CREATE TRIGGER round_record_append_only BEFORE UPDATE OR DELETE ON round_record FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- What the wallet paid, keyed the way Cashier knows the round (externalRoundId = the studio's round id).
CREATE TABLE wallet_settlement (
  operator_code     text   NOT NULL,
  external_round_id text   NOT NULL CHECK (length(external_round_id) BETWEEN 1 AND 128),
  game_code         text   NOT NULL,
  player_id         uuid   NOT NULL,
  currency          text   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stake_minor       bigint NOT NULL CHECK (stake_minor >= 0),
  win_minor         bigint NOT NULL CHECK (win_minor >= 0),
  settled_at        timestamptz NOT NULL,
  event_id          uuid   NOT NULL UNIQUE,
  PRIMARY KEY (operator_code, external_round_id)
);
CREATE INDEX wallet_settlement_player_idx ON wallet_settlement (operator_code, player_id);
CREATE TRIGGER wallet_settlement_append_only BEFORE UPDATE OR DELETE ON wallet_settlement FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- security_invoker: the view runs with the caller's rights, so row-level security still applies.
CREATE VIEW round_view WITH (security_invoker = true) AS
SELECT r.*,
       w.win_minor   AS wallet_win_minor,
       w.stake_minor AS wallet_stake_minor,
       CASE
         WHEN w.external_round_id IS NULL THEN 'pending'
         WHEN w.stake_minor = r.stake_minor AND w.win_minor = r.win_minor AND w.player_id = r.player_id AND w.currency = r.currency THEN 'confirmed'
         ELSE 'mismatch'
       END AS wallet_check
FROM round_record r
LEFT JOIN wallet_settlement w ON w.operator_code = r.operator_code AND w.external_round_id = r.round_id::text;

-- Row-level security: the API reads as catwalk_reader after setting the verified player and operator.
ALTER TABLE round_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_settlement ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_reads_own_rounds ON round_record FOR SELECT TO catwalk_reader
  USING (operator_code = current_setting('catwalk.operator_code', true)
         AND player_id = nullif(current_setting('catwalk.player_id', true), '')::uuid);
CREATE POLICY player_reads_own_settlements ON wallet_settlement FOR SELECT TO catwalk_reader
  USING (operator_code = current_setting('catwalk.operator_code', true)
         AND player_id = nullif(current_setting('catwalk.player_id', true), '')::uuid);
CREATE POLICY ingest_writes ON round_record FOR ALL TO catwalk_ingest USING (true) WITH CHECK (true);
CREATE POLICY ingest_writes_settlements ON wallet_settlement FOR ALL TO catwalk_ingest USING (true) WITH CHECK (true);
GRANT SELECT ON round_record, wallet_settlement, round_view TO catwalk_reader;
GRANT SELECT, INSERT ON round_record, wallet_settlement TO catwalk_ingest;

-- Consumer bookkeeping (suite ADR-0003): exactly-once effect on at-least-once delivery.
CREATE TABLE inbox (
  event_id     uuid PRIMARY KEY,
  feed         text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consumer_checkpoint (
  feed       text PRIMARY KEY,
  cursor     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Events that failed validation or signature checks. Never shown to players; paged to on-call.
CREATE TABLE quarantine (
  event_id    uuid,
  feed        text  NOT NULL,
  reason      text  NOT NULL,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON inbox, consumer_checkpoint, quarantine TO catwalk_ingest;
GRANT UPDATE ON consumer_checkpoint TO catwalk_ingest;

CREATE FUNCTION ensure_monthly_partitions(first_month date, months int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE created int := 0; m date; part text;
BEGIN
  FOR i IN 0..months - 1 LOOP
    m := (date_trunc('month', first_month) + make_interval(months => i))::date;
    part := format('catwalk.round_record_m%s', to_char(m, 'YYYYMM'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %s PARTITION OF catwalk.round_record FOR VALUES FROM (%L) TO (%L)',
                     part, m::timestamptz, (m + interval '1 month')::timestamptz);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Retention: detach and drop whole months older than the cutoff (archive first in production).
CREATE FUNCTION drop_partitions_before(cutoff date) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE dropped int := 0; r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
           WHERE i.inhparent = 'catwalk.round_record'::regclass AND c.relname ~ '^round_record_m\d{6}$' LOOP
    IF to_date(substring(r.relname from '\d{6}$'), 'YYYYMM') + interval '1 month' <= cutoff THEN
      EXECUTE format('ALTER TABLE catwalk.round_record DETACH PARTITION catwalk.%I', r.relname);
      EXECUTE format('DROP TABLE catwalk.%I', r.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END $$;

SELECT ensure_monthly_partitions((current_date - interval '13 months')::date, 16);
