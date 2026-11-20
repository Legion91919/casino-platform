-- Proves: KYC and identity rules, one limit of a kind in force at a time, limits can be closed but not
-- edited, exclusions meet minimum lengths and can never be shortened, rule sets never overlap,
-- stake authorisations are idempotent.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SELECT pg_temp.throws($q$INSERT INTO pitboss.player (operator_code, operator_player_ref, jurisdiction_code, kyc_status, kyc_verified_at)
  VALUES ('kestrel', 'K-1003', 'JUR-A', 'verified', now())$q$, '23514', 'KYC cannot be verified without an age check');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player (operator_code, operator_player_ref, jurisdiction_code)
  VALUES ('kestrel', 'K-1001', 'JUR-A')$q$, '23505', 'operator player reference is unique per operator');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player (operator_code, operator_player_ref, jurisdiction_code)
  VALUES ('kestrel', 'K-1004', 'JUR-Z')$q$, '23503', 'unknown jurisdiction is rejected');

INSERT INTO player_limit (player_id, operator_code, limit_type, period, amount_minor, currency, in_force, set_by)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'loss', 'day', 5000, 'EUR', tstzrange(now(), NULL), 'player');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player_limit (player_id, operator_code, limit_type, period, amount_minor, currency, in_force, set_by)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'loss', 'day', 9000, 'EUR', tstzrange(now() + interval '1 day', NULL), 'player')$q$,
  '23P01', 'two daily loss limits in force at once are rejected (exclusion constraint)');
INSERT INTO player_limit (player_id, operator_code, limit_type, period, amount_minor, currency, in_force, set_by)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'loss', 'week', 20000, 'EUR', tstzrange(now(), NULL), 'player');
SELECT pg_temp.ok(true, 'a weekly loss limit can coexist with the daily one');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player_limit (player_id, operator_code, limit_type, period, amount_minor, minutes, currency, in_force, set_by)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'session_time', 'session', 100, 60, 'EUR', tstzrange(now(), NULL), 'player')$q$,
  '23514', 'a session-time limit carries minutes, not money');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player_limit (player_id, operator_code, limit_type, period, amount_minor, currency, in_force, set_by, requested_at)
  VALUES ('00000000-0000-4000-8000-0000000000a2', 'kestrel', 'deposit', 'day', 100, 'EUR', tstzrange(now() - interval '2 days', NULL), 'player', now())$q$,
  '23514', 'limits cannot be backdated');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player_limit (player_id, operator_code, limit_type, period, amount_minor, currency, in_force, set_by)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'baobab', 'deposit', 'day', 100, 'EUR', tstzrange(now(), NULL), 'player')$q$,
  '23503', 'a limit cannot attach a player to another operator');
SELECT pg_temp.throws($q$UPDATE pitboss.player_limit SET amount_minor = 999999 WHERE period = 'day'$q$, '23514',
  'raising a limit in place is rejected (must be a new, delayed row)');
SELECT pg_temp.throws($q$DELETE FROM pitboss.player_limit$q$, '42501', 'limits are never deleted');
UPDATE player_limit SET in_force = tstzrange(lower(in_force), now() + interval '1 hour') WHERE period = 'day';
INSERT INTO player_limit (player_id, operator_code, limit_type, period, amount_minor, currency, in_force, set_by)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'loss', 'day', 9000, 'EUR', tstzrange(now() + interval '1 hour', NULL), 'player');
SELECT pg_temp.ok((SELECT count(*) FROM player_limit WHERE period = 'day') = 2,
  'closing the old limit and starting the raised one after the delay is allowed');

SELECT pg_temp.throws($q$INSERT INTO pitboss.exclusion (player_id, operator_code, kind, period, reason, created_by)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'self_exclusion', tstzrange(now(), now() + interval '30 days'), 'player request', 'player')$q$,
  '23514', 'self-exclusion shorter than 6 months is rejected');
SELECT pg_temp.throws($q$INSERT INTO pitboss.exclusion (player_id, operator_code, kind, period, reason, created_by)
  VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'cool_off', tstzrange(now(), NULL), 'player request', 'player')$q$,
  '23514', 'cool-off must have an end date');
SELECT pg_temp.ok(pitboss.active_block('00000000-0000-4000-8000-0000000000a1') IS NULL, 'player is not blocked before exclusion');
INSERT INTO exclusion (player_id, operator_code, kind, period, reason, created_by)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'self_exclusion', tstzrange(now(), NULL), 'player request', 'player');
SELECT pg_temp.ok(pitboss.active_block('00000000-0000-4000-8000-0000000000a1') = 'EXCLUDED', 'indefinite self-exclusion blocks the player now');
SELECT pg_temp.ok(pitboss.active_block('00000000-0000-4000-8000-0000000000a1', now() + interval '10 years') = 'EXCLUDED', 'and still in 10 years');
SELECT pg_temp.throws($q$UPDATE pitboss.exclusion SET period = tstzrange(lower(period), now())$q$, '42501', 'an exclusion cannot be shortened');
SELECT pg_temp.throws($q$DELETE FROM pitboss.exclusion$q$, '42501', 'an exclusion cannot be deleted');

INSERT INTO rule_set (jurisdiction_code, version, in_force, rules, approved_by)
VALUES ('JUR-A', 1, tstzrange('2026-01-01', '2027-01-01'), '{"max_stake_minor": 10000, "mandatory_limits": ["deposit"]}', 'compliance-lead');
SELECT pg_temp.throws($q$INSERT INTO pitboss.rule_set (jurisdiction_code, version, in_force, rules, approved_by)
  VALUES ('JUR-A', 2, tstzrange('2026-06-01', NULL), '{"max_stake_minor": 500, "mandatory_limits": []}', 'compliance-lead')$q$,
  '23P01', 'two rule-set versions in force at the same time are rejected');
INSERT INTO rule_set (jurisdiction_code, version, in_force, rules, approved_by)
VALUES ('JUR-A', 2, tstzrange('2027-01-01', NULL), '{"max_stake_minor": 500, "mandatory_limits": []}', 'compliance-lead');
SELECT pg_temp.ok(true, 'a rule-set version starting when the last one ends is accepted');
SELECT pg_temp.throws($q$INSERT INTO pitboss.rule_set (jurisdiction_code, version, in_force, rules, approved_by)
  VALUES ('JUR-B', 1, tstzrange('2026-01-01', NULL), '{"max_stake_minor": 500}', 'compliance-lead')$q$,
  '23514', 'a rule set must state its mandatory limits');

INSERT INTO stake_authorization (operator_code, player_id, game_server_txn_id, game_code, amount_minor, currency, decision, deny_reason)
VALUES ('kestrel', '00000000-0000-4000-8000-0000000000a1', 'gs-100', 'jungle-reels', 250, 'EUR', 'denied', 'EXCLUDED');
SELECT pg_temp.throws($q$INSERT INTO pitboss.stake_authorization (operator_code, player_id, game_server_txn_id, game_code, amount_minor, currency, decision)
  VALUES ('kestrel', '00000000-0000-4000-8000-0000000000a1', 'gs-100', 'jungle-reels', 250, 'EUR', 'approved')$q$,
  '23505', 'a retried authorisation cannot flip a denial into an approval');
SELECT pg_temp.throws($q$INSERT INTO pitboss.stake_authorization (operator_code, player_id, game_server_txn_id, game_code, amount_minor, currency, decision)
  VALUES ('kestrel', '00000000-0000-4000-8000-0000000000a1', 'gs-101', 'jungle-reels', 250, 'EUR', 'denied')$q$,
  '23514', 'a denial must give a reason');
SELECT pg_temp.throws($q$UPDATE pitboss.stake_authorization SET decision = 'approved', deny_reason = NULL$q$, '42501',
  'authorisation decisions are immutable');

INSERT INTO play_session (player_id, operator_code, reality_check_every) VALUES ('00000000-0000-4000-8000-0000000000a2', 'kestrel', interval '30 minutes');
SELECT pg_temp.throws($q$INSERT INTO pitboss.play_session (player_id, operator_code, reality_check_every)
  VALUES ('00000000-0000-4000-8000-0000000000a2', 'kestrel', interval '30 minutes')$q$, '23505', 'one open session per player');
SELECT pg_temp.throws($q$INSERT INTO pitboss.play_session (player_id, operator_code, reality_check_every)
  VALUES ('00000000-0000-4000-8000-0000000000b1', 'baobab', interval '1 minute')$q$, '23514', 'reality checks at most every 2 hours, at least every 5 minutes');
SELECT pg_temp.throws($q$INSERT INTO pitboss.limit_usage (player_id, operator_code, limit_type, period, window_start, used_minor)
  VALUES ('00000000-0000-4000-8000-0000000000b1', 'baobab', 'wager', 'day', date_trunc('day', now()), -1)$q$, '23514',
  'wager usage cannot be negative (only net loss can)');
ROLLBACK;
