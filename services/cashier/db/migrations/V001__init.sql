-- Cashier V001: seamless wallet, rounds, idempotent wallet transactions, double-entry ledger, outbox.
-- Rules (suite ADR-0005):
--   * Money is bigint minor units plus a currency code. Never float; never a shared multi-currency amount.
--   * The ledger is append-only. A correction is a new, reversing posting.
--   * Every posting sums to zero per currency (deferred constraint trigger, checked at commit).
--   * The game server's transaction id is the idempotency key, unique per operator while in the hot
--     store (90 days). Ids are time-ordered (UUIDv7/ULID); ids older than 30 days are refused upstream.
CREATE SCHEMA cashier;
SET search_path = cashier, public;

-- Reference data -----------------------------------------------------------------------------
CREATE TABLE currency (
  code        char(3)  PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4)
);

CREATE TABLE operator (
  operator_code text PRIMARY KEY CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  display_name  text NOT NULL,
  wallet_mode   text NOT NULL DEFAULT 'hosted' CHECK (wallet_mode IN ('hosted', 'pass_through')),
  status        text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Accounts -----------------------------------------------------------------------------------
-- Signed-balance convention: a positive entry raises the account's balance, a negative one lowers it.
-- Player accounts keep a running balance (row lock serialises bets per player) and can never go negative.
-- House accounts are hot rows shared by every bet, so they do not keep a running balance: their
-- balance is the sum of their ledger entries (reported by Countroom and the reconciliation job).
CREATE TABLE account (
  account_id     bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_code  text    NOT NULL REFERENCES operator,
  kind           text    NOT NULL CHECK (kind IN ('player_cash', 'player_bonus', 'game_house', 'bonus_cost', 'operator_settlement')),
  player_id      uuid,
  currency       char(3) NOT NULL REFERENCES currency,
  track_balance  boolean NOT NULL,
  allow_negative boolean NOT NULL,
  balance_minor  bigint  NOT NULL DEFAULT 0,
  version        bigint  NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_owner_uq UNIQUE NULLS NOT DISTINCT (operator_code, player_id, currency, kind),
  CONSTRAINT account_fk_target_uq UNIQUE (account_id, operator_code, currency),
  CONSTRAINT player_kinds_have_player CHECK ((kind IN ('player_cash', 'player_bonus')) = (player_id IS NOT NULL)),
  CONSTRAINT player_accounts_tracked_and_never_negative
    CHECK (kind NOT IN ('player_cash', 'player_bonus') OR (track_balance AND NOT allow_negative)),
  CONSTRAINT balance_never_below_zero_unless_allowed CHECK (allow_negative OR balance_minor >= 0),
  CONSTRAINT untracked_balance_stays_zero CHECK (track_balance OR balance_minor = 0)
);

-- Rounds ---------------------------------------------------------------------------------------
-- Hash partitioned on the game server's round id: the natural key stays globally unique
-- (the partition key is part of it) and writes spread evenly across 16 partitions.
CREATE TABLE game_round (
  operator_code     text    NOT NULL REFERENCES operator,
  game_code         text    NOT NULL CHECK (game_code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  external_round_id text    NOT NULL CHECK (length(external_round_id) BETWEEN 1 AND 128),
  player_id         uuid    NOT NULL,
  currency          char(3) NOT NULL REFERENCES currency,
  status            text    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'voided')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  PRIMARY KEY (operator_code, game_code, external_round_id),
  CONSTRAINT closed_at_iff_not_open CHECK ((status = 'open') = (closed_at IS NULL))
) PARTITION BY HASH (external_round_id);

DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE TABLE cashier.game_round_h%s PARTITION OF cashier.game_round FOR VALUES WITH (MODULUS 16, REMAINDER %s)', lpad(i::text, 2, '0'), i);
  END LOOP;
END $$;

CREATE INDEX game_round_open_idx ON game_round (operator_code, opened_at) WHERE status = 'open';

-- open -> closed | voided; closed -> voided (reversal after settlement). Nothing leaves 'voided'.
CREATE FUNCTION guard_round_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operator_code IS DISTINCT FROM OLD.operator_code OR NEW.game_code IS DISTINCT FROM OLD.game_code
     OR NEW.external_round_id IS DISTINCT FROM OLD.external_round_id OR NEW.player_id IS DISTINCT FROM OLD.player_id
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'round identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT ((OLD.status = NEW.status)
       OR (OLD.status = 'open'   AND NEW.status IN ('closed', 'voided'))
       OR (OLD.status = 'closed' AND NEW.status = 'voided')) THEN
    RAISE EXCEPTION 'illegal round transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER game_round_transition BEFORE UPDATE ON game_round FOR EACH ROW EXECUTE FUNCTION guard_round_transition();

-- Wallet transactions (the idempotency record) ---------------------------------------------------
-- One row per game-server request, accepted or rejected, so a retry replays the stored response.
-- Same key + same request hash -> replay; same key + different hash -> 409 (decided in the app).
-- A rollback that arrives before its stake writes a tombstone stake row (outcome rejected,
-- reject_code ROLLED_BACK_BEFORE_SEEN), so the late stake hits the unique key and is refused.
CREATE SEQUENCE wallet_txn_id_seq;
CREATE TABLE wallet_txn (
  operator_code       text    NOT NULL REFERENCES operator,
  game_server_txn_id  text    NOT NULL CHECK (length(game_server_txn_id) BETWEEN 1 AND 128),
  txn_id              bigint  NOT NULL DEFAULT nextval('wallet_txn_id_seq'),
  kind                text    NOT NULL CHECK (kind IN ('stake', 'win', 'rollback', 'bonus_credit', 'adjustment')),
  game_code           text,
  external_round_id   text,
  player_id           uuid    NOT NULL,
  currency            char(3) NOT NULL REFERENCES currency,
  amount_minor        bigint  NOT NULL CHECK (amount_minor >= 0),
  reference_txn_id    text,
  request_sha256      bytea   CHECK (octet_length(request_sha256) = 32),
  outcome             text    NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  reject_code         text,
  response            jsonb   NOT NULL,
  pitboss_authorization_id uuid,
  posting_id          bigint,
  actor               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_code, game_server_txn_id),
  FOREIGN KEY (operator_code, game_code, external_round_id) REFERENCES game_round,
  CONSTRAINT reject_code_iff_rejected CHECK ((outcome = 'rejected') = (reject_code IS NOT NULL)),
  CONSTRAINT request_hash_unless_tombstone CHECK (request_sha256 IS NOT NULL OR reject_code = 'ROLLED_BACK_BEFORE_SEEN'),
  CONSTRAINT rollback_has_reference CHECK ((kind = 'rollback') = (reference_txn_id IS NOT NULL)),
  CONSTRAINT game_kinds_have_round CHECK (kind NOT IN ('stake', 'win', 'rollback') OR (game_code IS NOT NULL AND external_round_id IS NOT NULL)),
  CONSTRAINT accepted_stake_was_authorised CHECK (kind <> 'stake' OR outcome <> 'accepted' OR pitboss_authorization_id IS NOT NULL),
  CONSTRAINT accepted_nonzero_has_posting CHECK (outcome = 'rejected' OR amount_minor = 0 OR posting_id IS NOT NULL),
  CONSTRAINT rejected_has_no_posting CHECK (outcome = 'accepted' OR posting_id IS NULL),
  CONSTRAINT adjustment_has_actor CHECK (kind <> 'adjustment' OR actor IS NOT NULL)
) PARTITION BY HASH (game_server_txn_id);

DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE TABLE cashier.wallet_txn_h%s PARTITION OF cashier.wallet_txn FOR VALUES WITH (MODULUS 16, REMAINDER %s)', lpad(i::text, 2, '0'), i);
  END LOOP;
END $$;

CREATE INDEX wallet_txn_round_idx ON wallet_txn (operator_code, game_code, external_round_id);
CREATE INDEX wallet_txn_player_idx ON wallet_txn (operator_code, player_id, created_at);

-- A transaction can be reversed at most once (rare, so a small unpartitioned table enforces it globally).
CREATE TABLE txn_reversal (
  operator_code                text NOT NULL,
  reversed_game_server_txn_id  text NOT NULL,
  reversing_game_server_txn_id text NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_code, reversed_game_server_txn_id),
  UNIQUE (operator_code, reversing_game_server_txn_id),
  FOREIGN KEY (operator_code, reversed_game_server_txn_id)  REFERENCES wallet_txn,
  FOREIGN KEY (operator_code, reversing_game_server_txn_id) REFERENCES wallet_txn,
  CONSTRAINT not_self_reversal CHECK (reversed_game_server_txn_id <> reversing_game_server_txn_id)
);

-- Ledger ----------------------------------------------------------------------------------------
-- Range partitioned by month on posted_at: cheap retention (detach + archive) and partition pruning.
CREATE SEQUENCE posting_id_seq;
CREATE SEQUENCE ledger_entry_id_seq;
CREATE TABLE ledger_entry (
  entry_id           bigint  NOT NULL DEFAULT nextval('ledger_entry_id_seq'),
  posting_id         bigint  NOT NULL,
  operator_code      text    NOT NULL,
  game_server_txn_id text    NOT NULL,
  account_id         bigint  NOT NULL,
  currency           char(3) NOT NULL,
  amount_minor       bigint  NOT NULL CHECK (amount_minor <> 0),
  posted_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, posted_at),
  -- operator and currency travel in the FK, so an entry can never hit another operator's or currency's account
  FOREIGN KEY (account_id, operator_code, currency) REFERENCES account (account_id, operator_code, currency),
  FOREIGN KEY (operator_code, game_server_txn_id) REFERENCES wallet_txn
) PARTITION BY RANGE (posted_at);

CREATE INDEX ledger_entry_posting_idx ON ledger_entry (posting_id, posted_at);
CREATE INDEX ledger_entry_account_idx ON ledger_entry (account_id, posted_at);

-- Creates monthly partitions named <table>_yYYYYmMM. Idempotent; run by a daily job 3 months ahead.
CREATE FUNCTION ensure_monthly_partitions(parent regclass, first_month date, months int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  created int := 0; m date; part text;
BEGIN
  FOR i IN 0..months - 1 LOOP
    m := (date_trunc('month', first_month) + make_interval(months => i))::date;
    part := format('%s_y%sm%s', parent::text, to_char(m, 'YYYY'), to_char(m, 'MM'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %s PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                     part, parent, m::timestamptz, (m + interval '1 month')::timestamptz);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

SELECT ensure_monthly_partitions('cashier.ledger_entry', (now() - interval '1 month')::date, 5);

-- Every posting must sum to zero per currency. Deferred, so all legs of a posting are inserted first.
-- Filtering on posted_at prunes to one partition (all legs of a posting share the transaction's now()).
CREATE FUNCTION assert_posting_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad record;
BEGIN
  SELECT currency, sum(amount_minor) AS net INTO bad
  FROM cashier.ledger_entry
  WHERE posting_id = NEW.posting_id AND posted_at = NEW.posted_at
  GROUP BY currency
  HAVING sum(amount_minor) <> 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'posting % is unbalanced: % % off', NEW.posting_id, bad.net, bad.currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_posting_balanced
  AFTER INSERT ON ledger_entry DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_posting_balanced();

-- Running balance for tracked (player) accounts, in the same transaction as the entry.
CREATE FUNCTION apply_entry_to_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cashier.account
     SET balance_minor = balance_minor + NEW.amount_minor, version = version + 1
   WHERE account_id = NEW.account_id AND track_balance;
  RETURN NULL;
END $$;
CREATE TRIGGER ledger_apply_balance AFTER INSERT ON ledger_entry FOR EACH ROW EXECUTE FUNCTION apply_entry_to_balance();

-- Append-only: no UPDATE or DELETE on money records, ever (and the app role is granted only SELECT, INSERT on them).
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON ledger_entry FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER wallet_txn_append_only  BEFORE UPDATE OR DELETE ON wallet_txn  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER txn_reversal_append_only BEFORE UPDATE OR DELETE ON txn_reversal FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Reconciliation with operators --------------------------------------------------------------------
CREATE TABLE recon_run (
  recon_run_id       bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_code      text    NOT NULL REFERENCES operator,
  business_date      date    NOT NULL,
  currency           char(3) NOT NULL REFERENCES currency,
  platform_net_minor bigint  NOT NULL,
  operator_net_minor bigint  NOT NULL,
  difference_minor   bigint  GENERATED ALWAYS AS (platform_net_minor - operator_net_minor) STORED,
  status             text    NOT NULL CHECK (status IN ('matched', 'mismatched', 'resolved')),
  resolved_by        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_code, business_date, currency),
  CONSTRAINT matched_means_equal CHECK (status <> 'matched' OR platform_net_minor = operator_net_minor),
  CONSTRAINT resolved_has_actor CHECK (status <> 'resolved' OR resolved_by IS NOT NULL)
);

-- Transactional outbox (suite ADR-0003) ----------------------------------------------------------
-- Written in the same transaction as the money change. Consumers poll GET /v1/events with a
-- (tx_id, position) cursor and only see rows whose transaction is older than every in-flight one
-- (tx_id < pg_snapshot_xmin(pg_current_snapshot())), so a slow commit can never be skipped.
-- Daily partitions: purge = drop partitions older than the 14-day replay window.
CREATE SEQUENCE outbox_position_seq;
CREATE TABLE outbox (
  position       bigint NOT NULL DEFAULT nextval('outbox_position_seq'),
  event_id       uuid   NOT NULL DEFAULT gen_random_uuid(),
  event_type     text   NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
  schema_version int    NOT NULL CHECK (schema_version >= 1),
  operator_code  text   NOT NULL,
  partition_key  text   NOT NULL,
  payload        jsonb  NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  tx_id          xid8   NOT NULL DEFAULT pg_current_xact_id(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (position, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX outbox_feed_idx ON outbox (tx_id, position);

CREATE FUNCTION ensure_daily_partitions(parent regclass, first_day date, days int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  created int := 0; d date; part text;
BEGIN
  FOR i IN 0..days - 1 LOOP
    d := first_day + i;
    part := format('%s_d%s', parent::text, to_char(d, 'YYYYMMDD'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %s PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                     part, parent, d::timestamptz, (d + 1)::timestamptz);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

SELECT ensure_daily_partitions('cashier.outbox', current_date - 2, 10);
CREATE TRIGGER outbox_append_only BEFORE UPDATE ON outbox FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Seed reference data (invented). Operators and accounts come from onboarding, not migrations.
INSERT INTO currency (code, minor_units) VALUES ('EUR', 2), ('GBP', 2), ('USD', 2), ('ZAR', 2), ('JPY', 0);
