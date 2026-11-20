-- Proves: stakes match the bet ladder, rounds only move forward, a decided outcome is frozen
-- (no re-spin), rounds are never deleted, and the outbox is append-only and hides in-flight rows.
BEGIN;
\ir ../../../../../tools/sql/test_helpers.sql
SET search_path = kiln, public;

INSERT INTO game_session (session_hash, launch_session_id, player_id, operator_code, jurisdiction_code, currency, build_version, game_session_token, expires_at)
VALUES (sha256('s1'), 'ls-1', '8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b', 'kestrel', 'JUR-A', 'EUR', '1.0.0', 'jwt', now() + interval '4 hours');

\set mh '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
INSERT INTO round (round_id, session_hash, player_id, operator_code, jurisdiction_code, currency, build_version, math_model_sha256, line_bet_minor, stake_minor, stake_txn_id, win_txn_id)
VALUES ('00000000-0000-4000-8000-000000000001', sha256('s1'), '8a4b2f5e-3c1d-4e6f-9a7b-1c2d3e4f5a6b', 'kestrel', 'JUR-A', 'EUR', '1.0.0', :mh, 5, 50, gen_random_uuid(), gen_random_uuid());

SELECT pg_temp.throws($q$INSERT INTO kiln.round (round_id, session_hash, player_id, operator_code, jurisdiction_code, currency, build_version, math_model_sha256, line_bet_minor, stake_minor, stake_txn_id, win_txn_id)
  VALUES (gen_random_uuid(), sha256('s1'), gen_random_uuid(), 'kestrel', 'JUR-A', 'EUR', '1.0.0', repeat('a', 64), 3, 30, gen_random_uuid(), gen_random_uuid())$q$,
  '23514', 'a line bet off the ladder is rejected');
SELECT pg_temp.throws($q$INSERT INTO kiln.round (round_id, session_hash, player_id, operator_code, jurisdiction_code, currency, build_version, math_model_sha256, line_bet_minor, stake_minor, stake_txn_id, win_txn_id)
  VALUES (gen_random_uuid(), sha256('s1'), gen_random_uuid(), 'kestrel', 'JUR-A', 'EUR', '1.0.0', repeat('a', 64), 5, 40, gen_random_uuid(), gen_random_uuid())$q$,
  '23514', 'the stake must be the line bet times ten lines');
SELECT pg_temp.throws($q$INSERT INTO kiln.round (round_id, session_hash, player_id, operator_code, jurisdiction_code, currency, build_version, math_model_sha256, line_bet_minor, stake_minor, stake_txn_id, win_txn_id)
  VALUES ('00000000-0000-4000-8000-000000000001', sha256('s1'), gen_random_uuid(), 'kestrel', 'JUR-A', 'EUR', '1.0.0', repeat('a', 64), 5, 50, gen_random_uuid(), gen_random_uuid())$q$,
  '23505', 'a round id can only be used once');

SELECT pg_temp.throws($q$UPDATE kiln.round SET status = 'decided', stops = '{1,2,3,4,5}', outcome = '{}', win_minor = 0, decided_at = now()
  WHERE round_id = '00000000-0000-4000-8000-000000000001'$q$, '23514', 'an outcome cannot be decided before the stake is debited');

UPDATE round SET status = 'debited' WHERE round_id = '00000000-0000-4000-8000-000000000001';
SELECT pg_temp.throws($q$UPDATE kiln.round SET status = 'decided' WHERE round_id = '00000000-0000-4000-8000-000000000001'$q$,
  '23514', 'a decided round must carry its stops, outcome and win');
UPDATE round SET status = 'decided', stops = '{3,9,14,27,0}', outcome = '{"grid": []}', win_minor = 250, decided_at = now()
  WHERE round_id = '00000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok(true, 'debited -> decided with stops, outcome and win');

SELECT pg_temp.throws($q$UPDATE kiln.round SET stops = '{0,0,0,0,0}', win_minor = 50000 WHERE round_id = '00000000-0000-4000-8000-000000000001'$q$,
  '42501', 'a decided outcome cannot be re-drawn or re-priced (no re-spin)');
SELECT pg_temp.throws($q$UPDATE kiln.round SET status = 'rejected', reject_reason = 'x', outcome = NULL WHERE round_id = '00000000-0000-4000-8000-000000000001'$q$,
  '23514', 'a decided round cannot be rejected afterwards');
SELECT pg_temp.throws($q$UPDATE kiln.round SET stake_minor = 500, line_bet_minor = 50 WHERE round_id = '00000000-0000-4000-8000-000000000001'$q$,
  '42501', 'the stake of an open round cannot change');

UPDATE round SET status = 'settled', balance_after_minor = 10200, settled_at = now() WHERE round_id = '00000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok((SELECT status FROM round WHERE round_id = '00000000-0000-4000-8000-000000000001') = 'settled', 'decided -> settled');
SELECT pg_temp.throws($q$DELETE FROM kiln.round WHERE round_id = '00000000-0000-4000-8000-000000000001'$q$,
  '42501', 'rounds are never deleted');

INSERT INTO outbox (event_id, event_type, partition_key, payload) VALUES (gen_random_uuid(), 'RoundOutcomeRecorded', 'r1', '{"data": {}}');
SELECT pg_temp.throws($q$UPDATE kiln.outbox SET payload = '{"data": {"win": 1}}'$q$, '42501', 'outbox rows are append-only');
SELECT pg_temp.ok((SELECT count(*) FROM outbox WHERE tx_id < pg_snapshot_xmin(pg_current_snapshot())) = 0,
  'feed query hides events whose transaction is still in flight');

ROLLBACK;
