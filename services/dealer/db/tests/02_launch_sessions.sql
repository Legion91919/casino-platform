-- Proves: launch tokens are short-lived, single-use, stored only as hashes, and partitioned by day.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SELECT pg_temp.throws(format($q$INSERT INTO dealer.launch_session (operator_code, player_id, jurisdiction_code, game_code, build_id, token_sha256, expires_at)
  VALUES ('kestrel', gen_random_uuid(), 'JUR-A', 'jungle-reels', %s, sha256('t1'), now() + interval '1 hour')$q$, :stable),
  '23514', 'a launch token valid for an hour is rejected (max 5 minutes)');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.launch_session (operator_code, player_id, jurisdiction_code, game_code, build_id, token_sha256, expires_at)
  VALUES ('kestrel', gen_random_uuid(), 'JUR-A', 'jungle-reels', %s, '\x0102', now() + interval '2 minutes')$q$, :stable),
  '23514', 'only a 32-byte token hash is stored, never the token');
INSERT INTO launch_session (operator_code, player_id, jurisdiction_code, game_code, build_id, token_sha256, expires_at)
VALUES ('kestrel', gen_random_uuid(), 'JUR-A', 'jungle-reels', :stable, sha256('t2'), now() + interval '2 minutes');
SELECT pg_temp.ok((SELECT tableoid::regclass = to_regclass(format('dealer.launch_session_d%s', to_char(current_date, 'YYYYMMDD'))) FROM launch_session),
  'launch session lands in today''s partition');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.launch_session (operator_code, player_id, jurisdiction_code, game_code, build_id, token_sha256, expires_at)
  VALUES ('kestrel', gen_random_uuid(), 'JUR-A', 'jungle-reels', %s, sha256('t2'), now() + interval '2 minutes')$q$, :stable),
  '23505', 'token hashes are unique');
UPDATE launch_session SET consumed_at = now() WHERE token_sha256 = sha256('t2');
SELECT pg_temp.ok(true, 'first use of a token is accepted');
SELECT pg_temp.throws($q$UPDATE dealer.launch_session SET consumed_at = now() WHERE token_sha256 = sha256('t2')$q$,
  '23514', 'a token cannot be used twice');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.game_health_minute VALUES (%s, 'kestrel', date_trunc('minute', now()), 10, 11, 900)$q$, :stable),
  '23514', 'health telemetry cannot report more errors than launches');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.game_health_minute VALUES (%s, 'kestrel', now(), 10, 1, 900)$q$, :stable),
  '23514', 'health telemetry is bucketed on whole minutes');
ROLLBACK;
