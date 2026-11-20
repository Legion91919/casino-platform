-- Shared fixture for dealer tests: one studio, one game, a stable and a canary build.
SET search_path = dealer, public;
INSERT INTO studio VALUES ('ember-forge', 'Ember Forge Studio', 'team-ember', now());
INSERT INTO game (game_code, studio_code, title, category) VALUES ('jungle-reels', 'ember-forge', 'Jungle Reels', 'slot');
INSERT INTO game_build (game_code, version, manifest, manifest_sha256, asset_base_url, rtp_bps, status, published_at, created_by) VALUES
  ('jungle-reels', '1.4.0', '{"entrypoint": "index.html", "assets": []}', sha256('m140'), 'https://cdn.example.test/jungle-reels/1.4.0/', 9600, 'published', now(), 'ci'),
  ('jungle-reels', '1.5.0-rc.1', '{"entrypoint": "index.html", "assets": []}', sha256('m150'), 'https://cdn.example.test/jungle-reels/1.5.0-rc.1/', 9600, 'published', now(), 'ci'),
  ('jungle-reels', '1.6.0', '{"entrypoint": "index.html", "assets": []}', sha256('m160'), 'https://cdn.example.test/jungle-reels/1.6.0/', 9600, 'draft', NULL, 'ci');
SELECT build_id AS stable FROM game_build WHERE version = '1.4.0' \gset
SELECT build_id AS canary FROM game_build WHERE version = '1.5.0-rc.1' \gset
SELECT build_id AS draft  FROM game_build WHERE version = '1.6.0' \gset
INSERT INTO certification (build_id, jurisdiction_code, status, certificate_ref, decided_by) VALUES
  (:stable, 'JUR-A', 'certified', 'LAB-0001', 'compliance'),
  (:canary, 'JUR-A', 'certified', 'LAB-0002', 'compliance'),
  (:stable, 'JUR-B', 'pending',   NULL,       'compliance');
