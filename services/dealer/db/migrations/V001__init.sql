-- Dealer V001: studios, games, immutable versioned builds, certification per jurisdiction,
-- percentage rollouts per operator, kill switches, signed launch sessions and health telemetry.
-- The rule that matters most: a build is never served in a jurisdiction where it is not certified.
CREATE SCHEMA dealer;
SET search_path = dealer, public;

CREATE TABLE studio (
  studio_code  text PRIMARY KEY CHECK (studio_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  display_name text NOT NULL,
  owner_team   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jurisdiction (
  jurisdiction_code text PRIMARY KEY CHECK (jurisdiction_code ~ '^JUR-[A-Z0-9]{1,8}$'),
  min_rtp_bps       int  NOT NULL CHECK (min_rtp_bps BETWEEN 7000 AND 10000)
);

CREATE TABLE game (
  game_code   text PRIMARY KEY CHECK (game_code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  studio_code text NOT NULL REFERENCES studio,
  title       text NOT NULL,
  category    text NOT NULL CHECK (category IN ('slot', 'table', 'live', 'instant', 'crash')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Builds: a manifest (entrypoint, asset list with hashes) whose assets live on the CDN under an
-- immutable, content-addressed path. Once published a build never changes; a fix is a new version.
CREATE TABLE game_build (
  build_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_code       text   NOT NULL REFERENCES game,
  version         text   NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'),
  manifest        jsonb  NOT NULL CHECK (jsonb_typeof(manifest) = 'object' AND manifest ? 'entrypoint' AND manifest ? 'assets'),
  manifest_sha256 bytea  NOT NULL CHECK (octet_length(manifest_sha256) = 32),
  asset_base_url  text   NOT NULL CHECK (asset_base_url ~ '^https://'),
  rtp_bps         int    NOT NULL CHECK (rtp_bps BETWEEN 7000 AND 10000),
  status          text   NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  published_at    timestamptz,
  created_by      text   NOT NULL,
  UNIQUE (game_code, version),
  UNIQUE (build_id, game_code),
  CONSTRAINT published_at_iff_not_draft CHECK ((status = 'draft') = (published_at IS NULL))
);

CREATE FUNCTION guard_build_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.manifest, NEW.manifest_sha256, NEW.asset_base_url, NEW.version, NEW.rtp_bps, NEW.game_code)
       IS DISTINCT FROM (OLD.manifest, OLD.manifest_sha256, OLD.asset_base_url, OLD.version, OLD.rtp_bps, OLD.game_code) THEN
    RAISE EXCEPTION 'build % is published and immutable', OLD.build_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (OLD.status = NEW.status OR (OLD.status = 'draft' AND NEW.status = 'published')
          OR (OLD.status = 'published' AND NEW.status = 'withdrawn')) THEN
    RAISE EXCEPTION 'illegal build transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER game_build_guard BEFORE UPDATE ON game_build FOR EACH ROW EXECUTE FUNCTION guard_build_update();

-- Certification per build and jurisdiction (recorded from the test lab's certificate).
CREATE TABLE certification (
  build_id          bigint NOT NULL REFERENCES game_build,
  jurisdiction_code text   NOT NULL REFERENCES jurisdiction,
  status            text   NOT NULL CHECK (status IN ('pending', 'certified', 'revoked')),
  certificate_ref   text,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  decided_by        text   NOT NULL,
  PRIMARY KEY (build_id, jurisdiction_code),
  CONSTRAINT certified_has_reference CHECK (status <> 'certified' OR certificate_ref IS NOT NULL)
);

-- A build whose return-to-player is below the jurisdiction's minimum can never be certified there.
CREATE FUNCTION guard_certification_rtp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'certified' AND EXISTS (
       SELECT 1 FROM dealer.game_build b JOIN dealer.jurisdiction j ON j.jurisdiction_code = NEW.jurisdiction_code
       WHERE b.build_id = NEW.build_id AND b.rtp_bps < j.min_rtp_bps) THEN
    RAISE EXCEPTION 'build % RTP is below the % minimum', NEW.build_id, NEW.jurisdiction_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER certification_rtp BEFORE INSERT OR UPDATE ON certification FOR EACH ROW EXECUTE FUNCTION guard_certification_rtp();

-- Rollouts: per operator and jurisdiction, a game may run up to 100% across builds
-- (e.g. stable 90% + canary 10%). Player bucket = hash(player) mod 100, so a player sticks to a build.
CREATE TABLE rollout (
  rollout_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_code     text   NOT NULL CHECK (operator_code ~ '^[a-z][a-z0-9-]{1,31}$'),
  jurisdiction_code text   NOT NULL REFERENCES jurisdiction,
  game_code         text   NOT NULL,
  build_id          bigint NOT NULL,
  percentage        smallint NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  state             text   NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'completed', 'rolled_back')),
  created_by        text   NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (build_id, game_code) REFERENCES game_build (build_id, game_code)
);
CREATE UNIQUE INDEX rollout_one_active_per_build ON rollout (operator_code, jurisdiction_code, build_id) WHERE state = 'active';
CREATE INDEX rollout_resolve_idx ON rollout (operator_code, jurisdiction_code, game_code) WHERE state = 'active';

-- Deferred check: an active rollout needs a published build certified in that jurisdiction,
-- and active percentages per (operator, jurisdiction, game) never exceed 100.
CREATE FUNCTION assert_rollout_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total int;
BEGIN
  IF NEW.state <> 'active' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM dealer.certification c JOIN dealer.game_build b USING (build_id)
                 WHERE c.build_id = NEW.build_id AND c.jurisdiction_code = NEW.jurisdiction_code
                   AND c.status = 'certified' AND b.status = 'published') THEN
    RAISE EXCEPTION 'build % is not published and certified in %', NEW.build_id, NEW.jurisdiction_code
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT sum(percentage) INTO total FROM dealer.rollout
   WHERE operator_code = NEW.operator_code AND jurisdiction_code = NEW.jurisdiction_code
     AND game_code = NEW.game_code AND state = 'active';
  IF total > 100 THEN
    RAISE EXCEPTION 'active rollouts for % in % / % add up to % percent', NEW.game_code, NEW.operator_code, NEW.jurisdiction_code, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER rollout_valid AFTER INSERT OR UPDATE ON rollout
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_rollout_valid();

-- Revoking a certificate (or withdrawing a build) pulls every active rollout of it at once.
CREATE FUNCTION pull_rollouts_on_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    UPDATE dealer.rollout SET state = 'rolled_back'
     WHERE build_id = NEW.build_id AND jurisdiction_code = NEW.jurisdiction_code AND state IN ('active', 'paused');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER certification_revocation AFTER UPDATE ON certification FOR EACH ROW EXECUTE FUNCTION pull_rollouts_on_revocation();

CREATE FUNCTION pull_rollouts_on_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'withdrawn' AND OLD.status <> 'withdrawn' THEN
    UPDATE dealer.rollout SET state = 'rolled_back' WHERE build_id = NEW.build_id AND state IN ('active', 'paused');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER game_build_withdrawal AFTER UPDATE ON game_build FOR EACH ROW EXECUTE FUNCTION pull_rollouts_on_withdrawal();

-- Kill switch: per game, optionally narrowed to a build and/or an operator (NULL = all).
CREATE TABLE kill_switch (
  kill_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_code      text   NOT NULL REFERENCES game,
  build_id       bigint REFERENCES game_build,
  operator_code  text,
  reason         text   NOT NULL,
  activated_by   text   NOT NULL,
  activated_at   timestamptz NOT NULL DEFAULT now(),
  deactivated_by text,
  deactivated_at timestamptz,
  CONSTRAINT deactivation_complete CHECK ((deactivated_at IS NULL) = (deactivated_by IS NULL)),
  CONSTRAINT deactivated_after_activation CHECK (deactivated_at IS NULL OR deactivated_at >= activated_at)
);
CREATE UNIQUE INDEX kill_switch_one_active ON kill_switch (game_code, build_id, operator_code) NULLS NOT DISTINCT
  WHERE deactivated_at IS NULL;

-- Which build should this player get? NULL means "do not launch" (no rollout, killed, or bucket
-- outside the rollout). Deterministic: the same player bucket always gets the same build.
CREATE FUNCTION resolve_build(p_operator text, p_jurisdiction text, p_game text, p_bucket int)
RETURNS bigint LANGUAGE sql STABLE AS $$
  WITH live AS (
    SELECT r.build_id, r.percentage,
           sum(r.percentage) OVER (ORDER BY r.build_id) AS upper_bound
    FROM dealer.rollout r
    JOIN dealer.certification c ON c.build_id = r.build_id AND c.jurisdiction_code = r.jurisdiction_code AND c.status = 'certified'
    WHERE r.operator_code = p_operator AND r.jurisdiction_code = p_jurisdiction AND r.game_code = p_game
      AND r.state = 'active' AND r.percentage > 0)
  SELECT l.build_id FROM live l
  WHERE p_bucket >= l.upper_bound - l.percentage AND p_bucket < l.upper_bound
    AND NOT EXISTS (SELECT 1 FROM dealer.kill_switch k
                    WHERE k.deactivated_at IS NULL AND k.game_code = p_game
                      AND (k.build_id IS NULL OR k.build_id = l.build_id)
                      AND (k.operator_code IS NULL OR k.operator_code = p_operator))
$$;

-- Launch sessions: the game URL carries a random token; only its hash is stored. Short-lived and
-- single-use. Daily partitions make the 30-day retention a DROP, not a DELETE.
CREATE TABLE launch_session (
  launch_id         uuid   NOT NULL DEFAULT gen_random_uuid(),
  operator_code     text   NOT NULL,
  player_id         uuid   NOT NULL,
  jurisdiction_code text   NOT NULL,
  game_code         text   NOT NULL,
  build_id          bigint NOT NULL,
  token_sha256      bytea  NOT NULL CHECK (octet_length(token_sha256) = 32),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consumed_at       timestamptz,
  PRIMARY KEY (launch_id, issued_at),
  UNIQUE (token_sha256, issued_at),
  CONSTRAINT short_lived CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
  CONSTRAINT consumed_inside_window CHECK (consumed_at IS NULL OR (consumed_at >= issued_at AND consumed_at <= expires_at))
) PARTITION BY RANGE (issued_at);

CREATE FUNCTION ensure_daily_partitions(parent regclass, first_day date, days int) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE created int := 0; d date; part text;
BEGIN
  FOR i IN 0..days - 1 LOOP
    d := first_day + i;
    part := format('%s_d%s', parent::text, to_char(d, 'YYYYMMDD'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format('CREATE TABLE %s PARTITION OF %s FOR VALUES FROM (%L) TO (%L)', part, parent, d::timestamptz, (d + 1)::timestamptz);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;
SELECT ensure_daily_partitions('dealer.launch_session', current_date - 1, 9);

CREATE FUNCTION guard_launch_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'launch token already used' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.launch_id, NEW.token_sha256, NEW.player_id, NEW.build_id, NEW.expires_at)
     IS DISTINCT FROM (OLD.launch_id, OLD.token_sha256, OLD.player_id, OLD.build_id, OLD.expires_at) THEN
    RAISE EXCEPTION 'only consumed_at may change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER launch_session_single_use BEFORE UPDATE ON launch_session FOR EACH ROW EXECUTE FUNCTION guard_launch_update();

-- Health telemetry, pre-aggregated per minute by the game client SDK collector.
CREATE TABLE game_health_minute (
  build_id      bigint NOT NULL REFERENCES game_build,
  operator_code text   NOT NULL,
  minute        timestamptz NOT NULL CHECK (minute = date_trunc('minute', minute)),
  launches      int NOT NULL CHECK (launches >= 0),
  load_errors   int NOT NULL CHECK (load_errors >= 0),
  p95_load_ms   int CHECK (p95_load_ms >= 0),
  PRIMARY KEY (build_id, operator_code, minute),
  CONSTRAINT errors_within_launches CHECK (load_errors <= launches)
);

-- Events ---------------------------------------------------------------------------------------------
CREATE TABLE outbox (
  position       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid   NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type     text   NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
  schema_version int    NOT NULL CHECK (schema_version >= 1),
  operator_code  text,
  partition_key  text   NOT NULL,
  payload        jsonb  NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  tx_id          xid8   NOT NULL DEFAULT pg_current_xact_id(),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_feed_idx ON outbox (tx_id, position);

INSERT INTO jurisdiction VALUES ('JUR-A', 9000), ('JUR-B', 9200), ('JUR-C', 8500);
