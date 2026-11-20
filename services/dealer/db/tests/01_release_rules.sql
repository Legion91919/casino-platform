-- Proves: published builds are immutable, uncertified builds can't roll out, rollouts never exceed 100%,
-- revocation pulls rollouts, the kill switch stops launches, and bucketing is deterministic.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, created_by)
  VALUES ('jungle-reels', '1.4.0', '{"entrypoint": "x", "assets": []}', sha256('x'), 'https://cdn.example.test/x/', 9600, 'ci')$q$,
  '23505', 'a game version can only be published once');
SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, created_by)
  VALUES ('jungle-reels', 'v2', '{"entrypoint": "x", "assets": []}', sha256('x'), 'https://cdn.example.test/x/', 9600, 'ci')$q$,
  '23514', 'version must be semantic (major.minor.patch)');
SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, created_by)
  VALUES ('jungle-reels', '2.0.0', '{"assets": []}', sha256('x'), 'https://cdn.example.test/x/', 9600, 'ci')$q$,
  '23514', 'manifest must name an entrypoint');
SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, created_by)
  VALUES ('jungle-reels', '2.0.1', '{"entrypoint": "x", "assets": []}', sha256('x'), 'http://cdn.example.test/x/', 9600, 'ci')$q$,
  '23514', 'assets must be served over https');
SELECT pg_temp.throws(format($q$UPDATE dealer.game_build SET manifest = '{"entrypoint": "evil.html", "assets": []}' WHERE build_id = %s$q$, :stable),
  '42501', 'a published build manifest is immutable');
UPDATE game_build SET manifest = '{"entrypoint": "index.html", "assets": ["a.js"]}' WHERE build_id = :draft;
SELECT pg_temp.ok(true, 'a draft build can still be edited');
SELECT pg_temp.throws(format($q$UPDATE dealer.game_build SET status = 'draft', published_at = NULL WHERE build_id = %s$q$, :stable),
  '23514', 'a published build cannot go back to draft');

SELECT pg_temp.throws(format($q$INSERT INTO dealer.rollout (operator_code, jurisdiction_code, game_code, build_id, percentage, created_by)
  VALUES ('kestrel', 'JUR-B', 'jungle-reels', %s, 100, 'release-bot')$q$, :stable),
  '23514', 'rollout of a build that is only pending certification in JUR-B is rejected');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.rollout (operator_code, jurisdiction_code, game_code, build_id, percentage, created_by)
  VALUES ('kestrel', 'JUR-C', 'jungle-reels', %s, 100, 'release-bot')$q$, :stable),
  '23514', 'rollout in a jurisdiction with no certificate at all is rejected');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.rollout (operator_code, jurisdiction_code, game_code, build_id, percentage, created_by)
  VALUES ('kestrel', 'JUR-A', 'other-game', %s, 100, 'release-bot')$q$, :stable),
  '23503', 'rollout cannot pair a build with a different game');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.certification (build_id, jurisdiction_code, status, certificate_ref, decided_by)
  VALUES (%s, 'JUR-C', 'certified', NULL, 'compliance')$q$, :stable), '23514', 'a certification needs a certificate reference');

INSERT INTO game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, status, published_at, created_by)
VALUES ('jungle-reels', '0.9.0', '{"entrypoint": "i", "assets": []}', sha256('m090'), 'https://cdn.example.test/j/0.9.0/', 8800, 'published', now(), 'ci');
SELECT pg_temp.throws($q$INSERT INTO dealer.certification (build_id, jurisdiction_code, status, certificate_ref, decided_by)
  SELECT build_id, 'JUR-A', 'certified', 'LAB-9', 'compliance' FROM dealer.game_build WHERE version = '0.9.0'$q$,
  '23514', 'a build below the jurisdiction minimum RTP cannot be certified there');

INSERT INTO rollout (operator_code, jurisdiction_code, game_code, build_id, percentage, created_by) VALUES
  ('kestrel', 'JUR-A', 'jungle-reels', :stable, 90, 'release-bot'),
  ('kestrel', 'JUR-A', 'jungle-reels', :canary, 10, 'release-bot');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.ok(true, 'stable 90% + canary 10% rollout is accepted');
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.throws(format($q$UPDATE dealer.rollout SET percentage = 20 WHERE build_id = %s$q$, :canary),
  '23514', 'raising the canary to 20% while stable holds 90% (110 percent) is rejected');
SELECT pg_temp.ok(dealer.resolve_build('kestrel', 'JUR-A', 'jungle-reels', 5) = :stable, 'bucket 5 gets the stable build');
SELECT pg_temp.ok(dealer.resolve_build('kestrel', 'JUR-A', 'jungle-reels', 95) = :canary, 'bucket 95 gets the canary build');
SELECT pg_temp.ok(dealer.resolve_build('baobab', 'JUR-A', 'jungle-reels', 5) IS NULL, 'an operator without a rollout gets nothing');

INSERT INTO kill_switch (game_code, build_id, operator_code, reason, activated_by)
VALUES ('jungle-reels', :canary, NULL, 'payout bug reported by studio', 'oncall-dealer');
SELECT pg_temp.ok(dealer.resolve_build('kestrel', 'JUR-A', 'jungle-reels', 95) IS NULL
              AND dealer.resolve_build('kestrel', 'JUR-A', 'jungle-reels', 5) = :stable,
  'killing the canary build stops only canary launches');
SELECT pg_temp.throws(format($q$INSERT INTO dealer.kill_switch (game_code, build_id, operator_code, reason, activated_by)
  VALUES ('jungle-reels', %s, NULL, 'again', 'oncall')$q$, :canary), '23505', 'one active kill switch per scope (NULLS NOT DISTINCT)');
INSERT INTO kill_switch (game_code, reason, activated_by) VALUES ('jungle-reels', 'regulator request', 'oncall-dealer');
SELECT pg_temp.ok(dealer.resolve_build('kestrel', 'JUR-A', 'jungle-reels', 5) IS NULL, 'a game-wide kill switch stops every launch');

UPDATE certification SET status = 'revoked' WHERE build_id = :stable AND jurisdiction_code = 'JUR-A';
SELECT pg_temp.ok((SELECT state FROM rollout WHERE build_id = :stable) = 'rolled_back',
  'revoking a certificate rolls back the active rollout automatically');
UPDATE game_build SET status = 'withdrawn' WHERE build_id = :canary;
SELECT pg_temp.ok((SELECT state FROM rollout WHERE build_id = :canary) = 'rolled_back',
  'withdrawing a build rolls back its rollouts automatically');
ROLLBACK;
