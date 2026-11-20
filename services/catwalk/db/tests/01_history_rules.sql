-- Proves: players only ever see their own rounds (RLS through the view too), rounds are append-only,
-- the wallet check is confirmed / mismatch / pending whichever event arrives first, money and
-- outcome shapes are enforced, and retention drops whole months only.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
SET search_path = catwalk, public;

\set A '''8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b'''
\set B '''1f2e3d4c-5b6a-4789-8abc-def012345678'''
CREATE TEMP TABLE ids AS SELECT gen_random_uuid() AS r1, gen_random_uuid() AS r2, gen_random_uuid() AS r3, gen_random_uuid() AS r4;
GRANT SELECT ON ids TO catwalk_reader;

INSERT INTO round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256, jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
SELECT 'ember-forge', x.rid, now() - x.ago, x.op, x.player::uuid, 'ember-anvil', '1.0.0', repeat('a', 64), 'JUR-A', 'EUR', 50, x.win, 1000, '{"stops": [1,2,3,4,5], "grid": []}', '{"keyId": "k", "value": "v"}', gen_random_uuid()
FROM ids, LATERAL (VALUES (ids.r1, 'kestrel', :A, 120::bigint, interval '1 minute'),
                          (ids.r2, 'kestrel', :A, 0::bigint,   interval '2 minutes'),
                          (ids.r3, 'kestrel', :B, 500::bigint, interval '3 minutes'),
                          (ids.r4, 'baobab',  :A, 10::bigint,  interval '4 minutes')) AS x(rid, op, player, win, ago);

-- Cashier's view of r1 agrees; r2 disagrees on the win; r3 has not arrived yet.
INSERT INTO wallet_settlement (operator_code, external_round_id, game_code, player_id, currency, stake_minor, win_minor, settled_at, event_id)
SELECT 'kestrel', r1::text, 'ember-anvil', :A::uuid, 'EUR', 50, 120, now(), gen_random_uuid() FROM ids
UNION ALL SELECT 'kestrel', r2::text, 'ember-anvil', :A::uuid, 'EUR', 50, 900, now(), gen_random_uuid() FROM ids;

SELECT pg_temp.ok((SELECT wallet_check FROM round_view, ids WHERE round_id = r1) = 'confirmed', 'game outcome and wallet agree: confirmed');
SELECT pg_temp.ok((SELECT wallet_check FROM round_view, ids WHERE round_id = r2) = 'mismatch', 'wallet paid a different amount: mismatch');
SELECT pg_temp.ok((SELECT wallet_check FROM round_view, ids WHERE round_id = r3) = 'pending', 'no wallet event yet: pending');

-- A settlement that arrives before the round: the round is confirmed the moment it lands.
INSERT INTO wallet_settlement (operator_code, external_round_id, game_code, player_id, currency, stake_minor, win_minor, settled_at, event_id)
VALUES ('kestrel', '00000000-0000-4000-8000-0000000000ee', 'ember-anvil', :A, 'EUR', 50, 0, now(), gen_random_uuid());
INSERT INTO round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256, jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
VALUES ('ember-forge', '00000000-0000-4000-8000-0000000000ee', now(), 'kestrel', :A, 'ember-anvil', '1.0.0', repeat('a', 64), 'JUR-A', 'EUR', 50, 0, 950, '{"stops": [], "grid": []}', '{"keyId": "k", "value": "v"}', gen_random_uuid());
SELECT pg_temp.ok((SELECT wallet_check FROM round_view WHERE round_id = '00000000-0000-4000-8000-0000000000ee') = 'confirmed', 'order does not matter: settlement first, round second');

-- Row-level security, as the API's role.
SET LOCAL ROLE catwalk_reader;
SELECT set_config('catwalk.operator_code', 'kestrel', true), set_config('catwalk.player_id', :A, true);
SELECT pg_temp.ok((SELECT count(*) FROM round_view) = 3, 'player A at Kestrel sees exactly their 3 Kestrel rounds');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM round_view, ids WHERE round_id = r3), 'player A cannot see player B''s round even by id');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM round_view, ids WHERE round_id = r4), 'player A''s rounds at another operator are not visible through Kestrel');
SELECT pg_temp.ok((SELECT count(*) FROM wallet_settlement) = 3, 'settlements are filtered the same way');
SELECT set_config('catwalk.player_id', '', true);
SELECT pg_temp.ok((SELECT count(*) FROM round_view) = 0, 'no verified player set: nothing is visible (fails closed)');
SELECT pg_temp.throws($q$INSERT INTO catwalk.round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256, jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
  VALUES ('ember-forge', gen_random_uuid(), now(), 'kestrel', gen_random_uuid(), 'ember-anvil', '1.0.0', repeat('a', 64), 'JUR-A', 'EUR', 50, 0, 0, '{"stops": [], "grid": []}', '{"keyId": "k", "value": "v"}', gen_random_uuid())$q$,
  '42501', 'the reader role cannot write history');
RESET ROLE;

SELECT pg_temp.throws($q$UPDATE catwalk.round_record SET win_minor = 999999$q$, '42501', 'a recorded round can never be edited');
SELECT pg_temp.throws($q$DELETE FROM catwalk.round_record$q$, '42501', 'a recorded round can never be deleted row by row');
SELECT pg_temp.throws($q$UPDATE catwalk.wallet_settlement SET win_minor = 120$q$, '42501', 'a wallet settlement can never be edited to hide a mismatch');
SELECT pg_temp.throws($q$INSERT INTO catwalk.round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256, jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
  VALUES ('ember-forge', gen_random_uuid(), now(), 'kestrel', gen_random_uuid(), 'ember-anvil', '1.0.0', repeat('a', 64), 'JUR-A', 'EUR', 0, 0, 0, '{"stops": [], "grid": []}', '{"keyId": "k", "value": "v"}', gen_random_uuid())$q$,
  '23514', 'a round must have a positive stake');
SELECT pg_temp.throws($q$INSERT INTO catwalk.round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256, jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
  VALUES ('ember-forge', gen_random_uuid(), now(), 'kestrel', gen_random_uuid(), 'ember-anvil', '1.0.0', repeat('a', 64), 'JUR-A', 'EUR', 50, 0, 0, '{"grid": []}', '{"keyId": "k", "value": "v"}', gen_random_uuid())$q$,
  '23514', 'an outcome without its reel stops is rejected (it could not be replayed)');
SELECT pg_temp.throws($q$INSERT INTO catwalk.round_record (studio_code, round_id, played_at, operator_code, player_id, game_code, build_version, math_model_sha256, jurisdiction_code, currency, stake_minor, win_minor, balance_after_minor, outcome, signature, event_id)
  VALUES ('ember-forge', gen_random_uuid(), now() - interval '5 years', 'kestrel', gen_random_uuid(), 'ember-anvil', '1.0.0', repeat('a', 64), 'JUR-A', 'EUR', 50, 0, 0, '{"stops": [], "grid": []}', '{"keyId": "k", "value": "v"}', gen_random_uuid())$q$,
  '23514', 'a round outside every partition is refused rather than silently stored');

SELECT pg_temp.ok(ensure_monthly_partitions(current_date, 2) = 0, 'partition maintenance is idempotent');
SELECT pg_temp.ok(drop_partitions_before((date_trunc('month', current_date) - interval '12 months')::date) >= 1, 'retention drops whole months older than the cutoff');
SELECT pg_temp.ok((SELECT count(*) FROM round_view) = 5, 'retention never touches the months still served');
ROLLBACK;
