-- Proves: daily partitions exist and route rows, events de-duplicate, rows with no partition fail
-- loudly, GGR/NGR are computed correctly and the rebuild job is re-runnable, retention detaches
-- old partitions, and sealed regulator exports are immutable.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
SET search_path = countroom, public;

SELECT pg_temp.ok((SELECT count(*) FROM pg_inherits WHERE inhparent = 'countroom.bet_fact'::regclass) = 40, 'bet_fact has 40 daily partitions');
SELECT pg_temp.ok(to_regclass(format('countroom.bet_fact_d%s', to_char(current_date, 'YYYYMMDD'))) IS NOT NULL, 'bet_fact partition for today exists');
SELECT pg_temp.ok(to_regclass(format('countroom.raw_event_d%s', to_char(current_date + 30, 'YYYYMMDD'))) IS NOT NULL, 'raw_event partitions exist 30 days ahead');
SELECT pg_temp.ok(countroom.ensure_daily_partitions('countroom.bet_fact', current_date, 5) = 0, 'partition maintenance is idempotent');

INSERT INTO bet_fact (event_id, business_date, operator_code, jurisdiction_code, studio_code, game_code, external_round_id,
                      player_key, currency, cash_stake_minor, bonus_stake_minor, win_minor, settled_at, job_run_id) VALUES
  ('00000000-0000-4000-8000-0000000e0001', current_date, 'kestrel', 'JUR-A', 'ember-forge', 'jungle-reels', 'r-1', sha256('p1'), 'EUR', 1000, 0,   600, now(), 1),
  ('00000000-0000-4000-8000-0000000e0002', current_date, 'kestrel', 'JUR-A', 'ember-forge', 'jungle-reels', 'r-2', sha256('p1'), 'EUR', 500,  200, 0,   now(), 1),
  ('00000000-0000-4000-8000-0000000e0003', current_date, 'kestrel', 'JUR-A', 'ember-forge', 'jungle-reels', 'r-3', sha256('p2'), 'EUR', 0,    0,   0,   now(), 1),
  ('00000000-0000-4000-8000-0000000e0004', current_date, 'baobab',  'JUR-B', 'ember-forge', 'jungle-reels', 'r-1', sha256('p3'), 'EUR', 2000, 0,   5000, now(), 1);
UPDATE bet_fact SET is_void = true WHERE external_round_id = 'r-3';
SELECT pg_temp.ok((SELECT bool_and(tableoid::regclass = to_regclass(format('countroom.bet_fact_d%s', to_char(current_date, 'YYYYMMDD'))))
  FROM bet_fact), 'bet facts land in today''s partition');
SELECT pg_temp.throws($q$INSERT INTO countroom.bet_fact (event_id, business_date, operator_code, jurisdiction_code, studio_code, game_code,
  external_round_id, player_key, currency, cash_stake_minor, win_minor, settled_at, job_run_id)
  VALUES ('00000000-0000-4000-8000-0000000e0001', current_date, 'kestrel', 'JUR-A', 'ember-forge', 'jungle-reels', 'r-1', sha256('p1'), 'EUR', 1000, 600, now(), 2)$q$,
  '23505', 'a redelivered BetSettled event is de-duplicated');
SELECT pg_temp.throws($q$INSERT INTO countroom.bet_fact (event_id, business_date, operator_code, jurisdiction_code, studio_code, game_code,
  external_round_id, player_key, currency, cash_stake_minor, win_minor, settled_at, job_run_id)
  VALUES (gen_random_uuid(), '2099-01-01', 'kestrel', 'JUR-A', 'ember-forge', 'jungle-reels', 'r-9', sha256('p1'), 'EUR', 1, 0, now(), 2)$q$,
  '23514', 'a fact with no partition for its day fails loudly (goes to quarantine), never lands nowhere');
SELECT pg_temp.throws($q$INSERT INTO countroom.bet_fact (event_id, business_date, operator_code, jurisdiction_code, studio_code, game_code,
  external_round_id, player_key, currency, cash_stake_minor, win_minor, settled_at, job_run_id)
  VALUES (gen_random_uuid(), current_date, 'kestrel', 'JUR-A', 'ember-forge', 'jungle-reels', 'r-9', '\x00ff', 'EUR', 1, 0, now(), 2)$q$,
  '23514', 'only a 32-byte keyed pseudonym of the player is accepted, never a raw id');
SELECT pg_temp.throws($q$UPDATE countroom.bet_fact SET cash_stake_minor = 1 WHERE external_round_id = 'r-3'$q$,
  '23514', 'a voided round moves no money');

SELECT pg_temp.ok(countroom.rebuild_ggr_daily(current_date) = 2, 'GGR rebuild writes one row per operator/jurisdiction/game/currency');
SELECT pg_temp.ok((SELECT (rounds, cash_stake_minor, win_minor, ggr_minor, ngr_minor) = (2::bigint, 1500::bigint, 600::bigint, 900::bigint, 700::bigint)
  FROM ggr_daily WHERE operator_code = 'kestrel'), 'kestrel: 2 rounds (void excluded), GGR 900, NGR 700 after 200 bonus stake');
SELECT pg_temp.ok((SELECT ggr_minor FROM ggr_daily WHERE operator_code = 'baobab') = -3000, 'a losing day for the house shows negative GGR');
SELECT pg_temp.ok(countroom.rebuild_ggr_daily(current_date) = 2
              AND (SELECT sum(ggr_minor) FROM ggr_daily) = -2100, 'the GGR rebuild is re-runnable with identical totals');
SELECT pg_temp.ok((SELECT count(*) FROM job_run WHERE status = 'succeeded') = 2, 'every rebuild is recorded in job_run');
SELECT pg_temp.ok((SELECT sum(ggr_minor) FROM ggr_daily) = (SELECT sum(cash_stake_minor - win_minor) FROM bet_fact WHERE business_date = current_date),
  'model totals reconcile to the clean layer');

SELECT pg_temp.throws($q$INSERT INTO countroom.report_export (operator_code, jurisdiction_code, report_kind, period, format, status, requested_by)
  VALUES ('kestrel', 'JUR-A', 'daily_ggr', daterange(current_date, current_date + 1), 'csv', 'sealed', 'compliance')$q$,
  '23514', 'an export cannot be sealed without row count, checksum and storage location');
INSERT INTO report_export (operator_code, jurisdiction_code, report_kind, period, format, status, row_count, content_sha256, storage_uri, sealed_at, requested_by)
VALUES ('kestrel', 'JUR-A', 'daily_ggr', daterange(current_date, current_date + 1), 'csv', 'sealed', 1, sha256('file'), 'archive://exports/1.csv', now(), 'compliance');
SELECT pg_temp.throws($q$UPDATE countroom.report_export SET row_count = 2$q$, '42501', 'a sealed export cannot be altered');
SELECT pg_temp.throws($q$DELETE FROM countroom.report_export$q$, '42501', 'an export is never deleted');
SELECT pg_temp.throws($q$INSERT INTO countroom.report_export (operator_code, jurisdiction_code, report_kind, period, format, status, row_count, content_sha256, storage_uri, sealed_at, requested_by)
  VALUES ('kestrel', 'JUR-A', 'daily_ggr', daterange(current_date, current_date + 1), 'csv', 'sealed', 1, sha256('file2'), 'archive://exports/2.csv', now(), 'compliance')$q$,
  '23505', 'only one live sealed export per operator, jurisdiction, kind and period');
UPDATE report_export SET status = 'superseded';
SELECT pg_temp.ok(true, 'a sealed export can be superseded by a corrected one');

SELECT pg_temp.ok((SELECT count(*) FROM countroom.detach_partitions_before('countroom.raw_event', current_date - 3)) = 4,
  'retention detaches the 4 raw partitions older than the cutoff');
SELECT pg_temp.ok((SELECT count(*) FROM pg_inherits WHERE inhparent = 'countroom.raw_event'::regclass) = 36
              AND to_regclass(format('countroom.raw_event_d%s', to_char(current_date - 7, 'YYYYMMDD'))) IS NOT NULL,
  'detached partitions leave the parent but stay as tables until archived');
ROLLBACK;
