-- Proves: awards are idempotent per triggering fact, wagering counts once per bet event, weighted by
-- game category, completes the award when met, never goes down, and stops at expiry.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SELECT pg_temp.throws(format($q$INSERT INTO comps.award (campaign_id, operator_code, player_id, currency, award_key, awarded_minor, wagering_required_minor, expires_at)
  VALUES (%s, 'kestrel', '00000000-0000-4000-8000-0000000000a1', 'EUR', 'deposit:dep-1', 2000, 60000, now() + interval '30 days')$q$, :welcome),
  '23505', 'a redelivered deposit cannot award the bonus twice');
SELECT pg_temp.throws(format($q$INSERT INTO comps.award (campaign_id, operator_code, player_id, currency, award_key, awarded_minor, wagering_required_minor, expires_at)
  VALUES (%s, 'kestrel', '00000000-0000-4000-8000-0000000000a1', 'EUR', 'deposit:dep-2', 2000, 60000, now() + interval '30 days')$q$, :welcome),
  '23505', 'one active award per player per campaign');
SELECT pg_temp.throws(format($q$INSERT INTO comps.award (campaign_id, operator_code, player_id, currency, award_key, awarded_minor, wagering_required_minor, expires_at)
  VALUES (%s, 'kestrel', gen_random_uuid(), 'GBP', 'deposit:dep-3', 2000, 60000, now() + interval '30 days')$q$, :welcome),
  '23503', 'award currency must match the campaign currency');
SELECT pg_temp.throws(format($q$INSERT INTO comps.award (campaign_id, operator_code, player_id, currency, award_key, awarded_minor, wagering_required_minor, expires_at)
  VALUES (%s, 'baobab', gen_random_uuid(), 'EUR', 'deposit:dep-4', 2000, 60000, now() + interval '30 days')$q$, :welcome),
  '23503', 'an operator cannot award from another operator''s campaign');
SELECT pg_temp.throws($q$INSERT INTO comps.campaign (operator_code, code, kind, currency, max_award_minor, wagering_multiplier, award_ttl, valid, jurisdictions, approved_by)
  VALUES ('kestrel', 'BADMATCH', 'deposit_match', 'EUR', 5000, 30, interval '30 days', tstzrange(now(), now() + interval '1 day'), '{JUR-A}', 'crm')$q$,
  '23514', 'a deposit match campaign must state its match percentage');

INSERT INTO wagering_contribution (award_id, bet_event_id, game_category, stake_minor, contribution_pct, bet_settled_at)
VALUES ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000e0001', 'slot', 10000, 100, now()),
       ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000e0002', 'table', 10000, 10, now());
SELECT pg_temp.ok((SELECT wagering_progress_minor FROM award) = 11000, 'slot stake counts 100%, table stake 10% (10000 + 1000)');
SELECT pg_temp.throws($q$INSERT INTO comps.wagering_contribution (award_id, bet_event_id, game_category, stake_minor, contribution_pct, bet_settled_at)
  VALUES ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000e0001', 'slot', 10000, 100, now())$q$,
  '23505', 'the same BetSettled event never counts twice');
SELECT pg_temp.throws($q$INSERT INTO comps.wagering_contribution (award_id, bet_event_id, game_category, stake_minor, contribution_pct, bet_settled_at)
  VALUES ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000e0009', 'slot', 100, 100, now() + interval '31 days')$q$,
  '23514', 'a bet settled after expiry does not count');
SELECT pg_temp.throws($q$UPDATE comps.award SET wagering_progress_minor = 0$q$, '23514', 'wagering progress never goes down');
SELECT pg_temp.throws($q$UPDATE comps.award SET awarded_minor = 999999$q$, '42501', 'award terms are immutable');
SELECT pg_temp.throws($q$UPDATE comps.award SET status = 'completed', closed_at = now()$q$, '23514',
  'an award cannot be completed before its wagering is met');
SELECT pg_temp.throws($q$DELETE FROM comps.wagering_contribution$q$, '42501', 'wagering contributions are append-only');

INSERT INTO wagering_contribution (award_id, bet_event_id, game_category, stake_minor, contribution_pct, bet_settled_at)
VALUES ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000e0003', 'slot', 49000, 100, now());
SELECT pg_temp.ok((SELECT status FROM award) = 'completed', 'meeting the requirement completes the award in the same transaction');
SELECT pg_temp.throws($q$INSERT INTO comps.wagering_contribution (award_id, bet_event_id, game_category, stake_minor, contribution_pct, bet_settled_at)
  VALUES ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000e0004', 'slot', 100, 100, now())$q$,
  '23514', 'a completed award takes no more wagering');
SELECT pg_temp.throws($q$UPDATE comps.award SET status = 'forfeited'$q$, '23514', 'a completed award is final');

INSERT INTO award (campaign_id, operator_code, player_id, currency, award_key, awarded_minor, wagering_required_minor, awarded_at, expires_at)
VALUES (:welcome, 'kestrel', '00000000-0000-4000-8000-0000000000a2', 'EUR', 'deposit:dep-9', 1000, 30000,
        now() - interval '31 days', now() - interval '1 day');
SELECT pg_temp.ok(comps.expire_awards() = 1, 'the expiry sweep expires exactly the overdue award');
SELECT pg_temp.ok((SELECT count(*) FROM outbox WHERE event_type = 'BonusExpired') = 1, 'expiry writes a BonusExpired event in the same transaction');
SELECT pg_temp.ok(comps.expire_awards() = 0, 'the expiry sweep is re-runnable');

INSERT INTO free_spin_grant (award_id, game_code, spin_value_minor, spins_total)
VALUES ('00000000-0000-4000-8000-00000000aa01', 'jungle-reels', 20, 50);
SELECT pg_temp.throws($q$UPDATE comps.free_spin_grant SET spins_used = 51$q$, '23514', 'cannot use more free spins than granted');
ROLLBACK;
