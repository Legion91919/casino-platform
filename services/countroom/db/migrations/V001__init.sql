-- Countroom V001: bet facts from Cashier events, daily GGR/NGR per operator, game and jurisdiction,
-- regulator report exports and retention. Layers (data-flows skill): raw_event (exactly what arrived)
-- -> bet_fact (typed, de-duplicated) -> ggr_daily (business-shaped, rebuilt by a re-runnable job).
-- Personal data: only a keyed pseudonym of the player (player_key) ever reaches this database.
CREATE SCHEMA countroom;
SET search_path = countroom, public;

CREATE FUNCTION ensure_daily_partitions(parent regclass, first_day date, days int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE created int := 0; d date; part text; key_type regtype;
BEGIN
  -- partition bounds follow the parent's key type (date for business_date, timestamptz for received_at)
  SELECT a.atttypid::regtype INTO key_type
  FROM pg_partitioned_table p JOIN pg_attribute a ON a.attrelid = p.partrelid AND a.attnum = p.partattrs[0]
  WHERE p.partrelid = parent;
  FOR i IN 0..days - 1 LOOP
    d := first_day + i;
    part := format('%s_d%s', parent::text, to_char(d, 'YYYYMMDD'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %s PARTITION OF %s FOR VALUES FROM (%L::%s) TO (%L::%s)',
                     part, parent, d, key_type, d + 1, key_type);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

-- Retention: detach (not drop) day partitions older than the cutoff, so they can be exported to
-- the archive and checksummed before an operator drops them. Returns the detached partition names.
CREATE FUNCTION detach_partitions_before(parent regclass, cutoff date) RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS part
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = parent AND c.relname ~ '_d[0-9]{8}$'
      AND to_date(substring(c.relname from '_d([0-9]{8})$'), 'YYYYMMDD') < cutoff
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %s DETACH PARTITION %s', parent, r.part);
    RETURN NEXT r.part;
  END LOOP;
END $$;

-- Raw layer: every delivery as received, duplicates included (replayable after a bug fix). 30 days.
CREATE TABLE raw_event (
  event_id      uuid  NOT NULL,
  source        text  NOT NULL CHECK (source IN ('cashier', 'pitboss', 'comps', 'dealer')),
  event_type    text  NOT NULL,
  payload       jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  feed_cursor   text  NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (received_at);
CREATE INDEX raw_event_id_idx ON raw_event (event_id);

-- Clean layer: one row per settled bet round. Partitioned by business_date (the jurisdiction's
-- trading day of settlement). The event's business_date is fixed by the event, so (event_id,
-- business_date) is a global de-duplication key even though uniqueness is per partition.
CREATE TABLE bet_fact (
  event_id          uuid    NOT NULL,
  business_date     date    NOT NULL,
  operator_code     text    NOT NULL CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  jurisdiction_code text    NOT NULL CHECK (jurisdiction_code ~ '^JUR-[A-Z0-9]{1,8}$'),
  studio_code       text    NOT NULL,
  game_code         text    NOT NULL,
  external_round_id text    NOT NULL,
  player_key        bytea   NOT NULL CHECK (octet_length(player_key) = 32),
  currency          char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cash_stake_minor  bigint  NOT NULL CHECK (cash_stake_minor >= 0),
  bonus_stake_minor bigint  NOT NULL DEFAULT 0 CHECK (bonus_stake_minor >= 0),
  win_minor         bigint  NOT NULL CHECK (win_minor >= 0),
  is_void           boolean NOT NULL DEFAULT false,
  settled_at        timestamptz NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  job_run_id        bigint  NOT NULL,
  PRIMARY KEY (event_id, business_date),
  CONSTRAINT void_rounds_move_no_money CHECK (NOT is_void OR (cash_stake_minor = 0 AND bonus_stake_minor = 0 AND win_minor = 0))
) PARTITION BY RANGE (business_date);
CREATE INDEX bet_fact_report_idx ON bet_fact (business_date, operator_code, jurisdiction_code, game_code);
CREATE INDEX bet_fact_round_idx ON bet_fact (operator_code, game_code, external_round_id);

-- Rows that failed validation, with the reason. Never silently dropped.
CREATE TABLE ingest_quarantine (
  quarantine_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      uuid,
  payload       jsonb NOT NULL,
  reason        text  NOT NULL,
  job_run_id    bigint NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

-- Model layer: daily gross and net gaming revenue.
-- GGR = cash stakes - wins. NGR = GGR - bonus cost (bonus stakes converted) - jurisdiction gaming tax
-- is applied in the regulator export, not here, so NGR here is "GGR net of bonus".
CREATE TABLE ggr_daily (
  business_date     date    NOT NULL,
  operator_code     text    NOT NULL,
  jurisdiction_code text    NOT NULL,
  game_code         text    NOT NULL,
  currency          char(3) NOT NULL,
  rounds            bigint  NOT NULL CHECK (rounds >= 0),
  cash_stake_minor  bigint  NOT NULL,
  bonus_stake_minor bigint  NOT NULL,
  win_minor         bigint  NOT NULL,
  ggr_minor         bigint  GENERATED ALWAYS AS (cash_stake_minor - win_minor) STORED,
  ngr_minor         bigint  GENERATED ALWAYS AS (cash_stake_minor - win_minor - bonus_stake_minor) STORED,
  job_run_id        bigint  NOT NULL,
  PRIMARY KEY (business_date, operator_code, jurisdiction_code, game_code, currency)
);

CREATE TABLE job_run (
  job_run_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name      text   NOT NULL,
  business_date date,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_read     bigint NOT NULL DEFAULT 0,
  rows_written  bigint NOT NULL DEFAULT 0,
  rows_rejected bigint NOT NULL DEFAULT 0,
  status        text   NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT finished_iff_done CHECK ((status = 'running') = (finished_at IS NULL))
);

-- Re-runnable: same bet_fact in -> same ggr_daily out. Replaces one day atomically.
CREATE FUNCTION rebuild_ggr_daily(p_day date) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE run bigint; n bigint;
BEGIN
  INSERT INTO countroom.job_run (job_name, business_date) VALUES ('rebuild_ggr_daily', p_day) RETURNING job_run_id INTO run;
  DELETE FROM countroom.ggr_daily WHERE business_date = p_day;
  INSERT INTO countroom.ggr_daily (business_date, operator_code, jurisdiction_code, game_code, currency, rounds,
                                   cash_stake_minor, bonus_stake_minor, win_minor, job_run_id)
  SELECT business_date, operator_code, jurisdiction_code, game_code, currency, count(*) FILTER (WHERE NOT is_void),
         sum(cash_stake_minor), sum(bonus_stake_minor), sum(win_minor), run
  FROM countroom.bet_fact WHERE business_date = p_day
  GROUP BY business_date, operator_code, jurisdiction_code, game_code, currency;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE countroom.job_run SET status = 'succeeded', finished_at = clock_timestamp(), rows_written = n WHERE job_run_id = run;
  RETURN n;
END $$;

-- Regulator exports: once sealed (checksum recorded), the export record cannot change.
CREATE TABLE report_export (
  export_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_code     text   NOT NULL,
  jurisdiction_code text   NOT NULL,
  report_kind       text   NOT NULL CHECK (report_kind IN ('daily_ggr', 'monthly_ggr', 'game_performance', 'rg_interventions')),
  period            daterange NOT NULL CHECK (NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period)),
  format            text   NOT NULL CHECK (format IN ('csv', 'xml', 'json')),
  status            text   NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'sealed', 'submitted', 'superseded')),
  row_count         bigint CHECK (row_count >= 0),
  content_sha256    bytea  CHECK (octet_length(content_sha256) = 32),
  storage_uri       text,
  requested_by      text   NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sealed_at         timestamptz,
  CONSTRAINT sealed_has_evidence CHECK (status = 'building' OR (content_sha256 IS NOT NULL AND row_count IS NOT NULL AND storage_uri IS NOT NULL AND sealed_at IS NOT NULL))
);
CREATE UNIQUE INDEX report_export_one_live ON report_export (operator_code, jurisdiction_code, report_kind, period)
  WHERE status IN ('sealed', 'submitted');

CREATE FUNCTION guard_sealed_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'exports are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'building' AND (
       (NEW.content_sha256, NEW.row_count, NEW.storage_uri, NEW.period, NEW.operator_code, NEW.jurisdiction_code)
       IS DISTINCT FROM (OLD.content_sha256, OLD.row_count, OLD.storage_uri, OLD.period, OLD.operator_code, OLD.jurisdiction_code)
       OR NOT ((OLD.status = 'sealed' AND NEW.status IN ('sealed', 'submitted', 'superseded'))
            OR (OLD.status = 'submitted' AND NEW.status IN ('submitted', 'superseded'))
            OR (OLD.status = 'superseded' AND NEW.status = 'superseded'))) THEN
    RAISE EXCEPTION 'export % is sealed', OLD.export_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_export_sealed BEFORE UPDATE OR DELETE ON report_export FOR EACH ROW EXECUTE FUNCTION guard_sealed_export();

-- Retention rules per jurisdiction and data class (applied by the nightly retention job).
CREATE TABLE retention_policy (
  jurisdiction_code text NOT NULL,
  data_class        text NOT NULL CHECK (data_class IN ('raw_event', 'bet_fact', 'ggr_daily', 'report_export')),
  retain_for        interval NOT NULL CHECK (retain_for >= interval '30 days'),
  PRIMARY KEY (jurisdiction_code, data_class)
);

CREATE TABLE consumer_checkpoint (
  source     text PRIMARY KEY,
  cursor     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT ensure_daily_partitions('countroom.raw_event', current_date - 7, 40);
SELECT ensure_daily_partitions('countroom.bet_fact',  current_date - 7, 40);

INSERT INTO retention_policy VALUES
  ('JUR-A', 'raw_event', interval '30 days'), ('JUR-A', 'bet_fact', interval '5 years'),  ('JUR-A', 'ggr_daily', interval '10 years'),
  ('JUR-B', 'raw_event', interval '30 days'), ('JUR-B', 'bet_fact', interval '7 years'),  ('JUR-B', 'ggr_daily', interval '10 years'),
  ('JUR-C', 'raw_event', interval '30 days'), ('JUR-C', 'bet_fact', interval '6 years'),  ('JUR-C', 'ggr_daily', interval '10 years');
