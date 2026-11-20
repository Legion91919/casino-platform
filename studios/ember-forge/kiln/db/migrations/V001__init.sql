-- Kiln game server V001: the schema every Ember Forge game server uses in its own database
-- (one database per game; a studio database, not a platform one).
-- Game sessions, rounds and a transactional outbox for RoundOutcomeRecorded events.
-- The rule that matters most: once a round's outcome is decided it can never change. A retry,
-- a crash or a wallet timeout can delay the payout, but it can never re-draw the reels.
CREATE SCHEMA kiln;
SET search_path = kiln, public;

-- Only a hash of the session token is stored, so a database leak does not hand out live sessions.
CREATE TABLE game_session (
  session_hash      bytea PRIMARY KEY CHECK (octet_length(session_hash) = 32),
  launch_session_id text  NOT NULL UNIQUE,              -- Dealer's launch session; redeemed once
  player_id         uuid  NOT NULL,                     -- pseudonymous platform id; no names here
  operator_code     text  NOT NULL CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  jurisdiction_code text  NOT NULL CHECK (jurisdiction_code ~ '^JUR-[A-Z0-9]{1,8}$'),
  currency          text  NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  build_version     text  NOT NULL,
  game_session_token text NOT NULL,                     -- Dealer-signed, <= 12 h; only accepted by Cashier with our mTLS client certificate
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE TABLE round (
  round_id            uuid   PRIMARY KEY,               -- chosen by the client: the idempotency key
  session_hash        bytea  NOT NULL REFERENCES game_session,
  player_id           uuid   NOT NULL,
  operator_code       text   NOT NULL,
  jurisdiction_code   text   NOT NULL,
  currency            text   NOT NULL,
  build_version       text   NOT NULL,
  math_model_sha256   text   NOT NULL CHECK (math_model_sha256 ~ '^[0-9a-f]{64}$'),
  line_bet_minor      int    NOT NULL CHECK (line_bet_minor IN (1, 2, 5, 10, 20, 50)),
  stake_minor         bigint NOT NULL,
  stake_txn_id        uuid   NOT NULL UNIQUE,           -- wallet idempotency keys, minted (UUIDv7) when the round opens
  win_txn_id          uuid   NOT NULL UNIQUE,
  status              text   NOT NULL DEFAULT 'opened' CHECK (status IN ('opened', 'debited', 'decided', 'settled', 'rejected')),
  reject_reason       text,
  stops               int[],
  outcome             jsonb,
  win_minor           bigint CHECK (win_minor >= 0),
  balance_after_minor bigint,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  settled_at          timestamptz,
  CONSTRAINT stake_is_ten_lines CHECK (stake_minor = line_bet_minor * 10),
  CONSTRAINT decided_has_outcome CHECK (status NOT IN ('decided', 'settled')
    OR (stops IS NOT NULL AND cardinality(stops) >= 1 AND outcome IS NOT NULL AND win_minor IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT settled_has_balance CHECK (status <> 'settled' OR (balance_after_minor IS NOT NULL AND settled_at IS NOT NULL)),
  CONSTRAINT rejected_has_reason_and_no_outcome CHECK (status <> 'rejected' OR (reject_reason IS NOT NULL AND outcome IS NULL))
);
CREATE INDEX round_unsettled_idx ON round (opened_at) WHERE status IN ('debited', 'decided');

-- Forward-only state machine, and a decided outcome is frozen.
CREATE FUNCTION guard_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.status = NEW.status
          OR (OLD.status, NEW.status) IN (('opened', 'debited'), ('opened', 'rejected'), ('debited', 'decided'), ('debited', 'rejected'), ('decided', 'settled'))) THEN
    RAISE EXCEPTION 'illegal round transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('decided', 'settled')
     AND (NEW.stops, NEW.outcome, NEW.win_minor, NEW.decided_at) IS DISTINCT FROM (OLD.stops, OLD.outcome, OLD.win_minor, OLD.decided_at) THEN
    RAISE EXCEPTION 'round % outcome is decided and cannot change', OLD.round_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.round_id, NEW.player_id, NEW.stake_minor, NEW.line_bet_minor, NEW.session_hash, NEW.math_model_sha256, NEW.stake_txn_id, NEW.win_txn_id)
     IS DISTINCT FROM (OLD.round_id, OLD.player_id, OLD.stake_minor, OLD.line_bet_minor, OLD.session_hash, OLD.math_model_sha256, OLD.stake_txn_id, OLD.win_txn_id) THEN
    RAISE EXCEPTION 'round % identity and stake are fixed', OLD.round_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER round_guard BEFORE UPDATE ON round FOR EACH ROW EXECUTE FUNCTION guard_round();

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER round_no_delete BEFORE DELETE ON round FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Transactional outbox (suite ADR-0003). The settle transaction writes the round and its event together.
CREATE TABLE outbox (
  position      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      uuid   NOT NULL UNIQUE,
  event_type    text   NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
  partition_key text   NOT NULL,
  payload       jsonb  NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload ? 'data'),
  tx_id         xid8   NOT NULL DEFAULT pg_current_xact_id(),
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_feed_idx ON outbox (tx_id, position);
CREATE TRIGGER outbox_append_only BEFORE UPDATE ON outbox FOR EACH ROW EXECUTE FUNCTION reject_mutation();
