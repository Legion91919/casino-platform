-- Proves: a slot build can't be published without a replay renderer and math hash; studio
-- signing keys hold only public Ed25519 material, rotate with at most two active, and are
-- retired rather than edited or deleted.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, status, published_at, created_by)
  VALUES ('jungle-reels', '2.0.0', '{"entrypoint": "index.html", "assets": []}', sha256('x'), 'https://cdn.example.test/j/2.0.0/', 9600, 'published', now(), 'ci')$q$,
  '23514', 'a slot build without a replay renderer cannot be published');
SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, status, published_at, created_by)
  VALUES ('jungle-reels', '2.0.1', '{"entrypoint": "index.html", "replayEntrypoint": "../../evil.html", "mathModelSha256": "1111111111111111111111111111111111111111111111111111111111111111", "assets": []}', sha256('x'), 'https://cdn.example.test/j/2.0.1/', 9600, 'published', now(), 'ci')$q$,
  '23514', 'a replay entrypoint cannot climb out of the build''s own folder');
SELECT pg_temp.throws($q$INSERT INTO dealer.game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, status, published_at, created_by)
  VALUES ('jungle-reels', '2.0.2', '{"entrypoint": "index.html", "replayEntrypoint": "replay.html", "mathModelSha256": "short", "assets": []}', sha256('x'), 'https://cdn.example.test/j/2.0.2/', 9600, 'published', now(), 'ci')$q$,
  '23514', 'the math model hash must be a SHA-256');
INSERT INTO game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, created_by)
  VALUES ('jungle-reels', '2.1.0', '{"entrypoint": "index.html", "assets": []}', sha256('d'), 'https://cdn.example.test/j/2.1.0/', 9600, 'ci');
SELECT pg_temp.ok(true, 'a draft slot build may be incomplete while the studio works on it');
SELECT pg_temp.throws($q$UPDATE dealer.game_build SET status = 'published', published_at = now() WHERE version = '2.1.0'$q$,
  '23514', 'publishing the incomplete draft is refused');

INSERT INTO game (game_code, studio_code, title, category) VALUES ('rapid-roulette', 'ember-forge', 'Rapid Roulette', 'table');
INSERT INTO game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, status, published_at, created_by)
  VALUES ('rapid-roulette', '1.0.0', '{"entrypoint": "index.html", "assets": []}', sha256('r'), 'https://cdn.example.test/r/1.0.0/', 9730, 'published', now(), 'ci');
SELECT pg_temp.ok(true, 'the replay rule applies to slots only (other categories get their own rules)');

INSERT INTO studio_signing_key (studio_code, key_id, public_jwk, created_by) VALUES
  ('ember-forge', 'ef-2026-10', '{"kty": "OKP", "crv": "Ed25519", "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}', 'studio-ci'),
  ('ember-forge', 'ef-2026-11', '{"kty": "OKP", "crv": "Ed25519", "x": "22qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}', 'studio-ci');
SELECT pg_temp.ok(true, 'two active keys during a rotation');
SELECT pg_temp.throws($q$INSERT INTO dealer.studio_signing_key (studio_code, key_id, public_jwk, created_by) VALUES
  ('ember-forge', 'ef-2026-12', '{"kty": "OKP", "crv": "Ed25519", "x": "33qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}', 'studio-ci')$q$,
  '23514', 'a third active key is refused until one is retired');
SELECT pg_temp.throws($q$INSERT INTO dealer.studio_signing_key (studio_code, key_id, public_jwk, created_by) VALUES
  ('ember-forge', 'leak', '{"kty": "OKP", "crv": "Ed25519", "x": "44qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", "d": "private-half"}', 'studio-ci')$q$,
  '23514', 'a JWK that includes the private key is refused');
SELECT pg_temp.throws($q$UPDATE dealer.studio_signing_key SET public_jwk = '{"kty": "OKP", "crv": "Ed25519", "x": "55qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}' WHERE key_id = 'ef-2026-10'$q$,
  '42501', 'a registered key can never be swapped (that would re-sign history)');
UPDATE studio_signing_key SET status = 'retired', retired_at = now() WHERE key_id = 'ef-2026-10';
SELECT pg_temp.ok(true, 'keys are retired');
SELECT pg_temp.throws($q$UPDATE dealer.studio_signing_key SET status = 'active', retired_at = NULL WHERE key_id = 'ef-2026-10'$q$,
  '42501', 'a retired key cannot come back');
SELECT pg_temp.throws($q$DELETE FROM dealer.studio_signing_key WHERE key_id = 'ef-2026-10'$q$,
  '42501', 'a key is never deleted: rounds it signed must stay verifiable');
ROLLBACK;
