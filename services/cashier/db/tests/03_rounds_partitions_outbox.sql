-- Proves: round state machine, partitions exist and route rows, outbox hides in-flight events,
-- reconciliation cannot be marked matched with a difference.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SELECT pg_temp.throws($q$INSERT INTO cashier.game_round (operator_code, game_code, external_round_id, player_id, currency)
  VALUES ('kestrel', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR')$q$, '23505',
  'duplicate round id for the same operator and game is rejected');
UPDATE game_round SET status = 'closed', closed_at = now() WHERE external_round_id = 'r-1';
SELECT pg_temp.ok(true, 'open -> closed is allowed');
SELECT pg_temp.throws($q$UPDATE cashier.game_round SET status = 'open', closed_at = NULL WHERE external_round_id = 'r-1'$q$,
  '23514', 'closed -> open is rejected');
SELECT pg_temp.throws($q$UPDATE cashier.game_round SET player_id = gen_random_uuid() WHERE external_round_id = 'r-1'$q$,
  '23000', 'round identity (player) is immutable');
UPDATE game_round SET status = 'voided' WHERE external_round_id = 'r-1';
SELECT pg_temp.ok(true, 'closed -> voided is allowed (reversal after settlement)');
SELECT pg_temp.throws($q$UPDATE cashier.game_round SET status = 'closed' WHERE external_round_id = 'r-1'$q$,
  '23514', 'voided is terminal');
SELECT pg_temp.throws($q$INSERT INTO cashier.game_round (operator_code, game_code, external_round_id, player_id, currency, status)
  VALUES ('kestrel', 'jungle-reels', 'r-2', gen_random_uuid(), 'EUR', 'closed')$q$, '23514',
  'a closed round must have closed_at');

SELECT pg_temp.ok((SELECT count(*) FROM pg_inherits WHERE inhparent = 'cashier.wallet_txn'::regclass) = 16,
  'wallet_txn has 16 hash partitions');
SELECT pg_temp.ok((SELECT count(*) FROM pg_inherits WHERE inhparent = 'cashier.game_round'::regclass) = 16,
  'game_round has 16 hash partitions');
SELECT pg_temp.ok(to_regclass(format('cashier.ledger_entry_y%sm%s', to_char(now(), 'YYYY'), to_char(now(), 'MM'))) IS NOT NULL,
  'ledger_entry partition for the current month exists');
SELECT pg_temp.ok(to_regclass(format('cashier.ledger_entry_y%sm%s', to_char(now() + interval '1 month', 'YYYY'),
  to_char(now() + interval '1 month', 'MM'))) IS NOT NULL, 'ledger_entry partition for next month exists');
SELECT pg_temp.ok((SELECT bool_and(tableoid::regclass = to_regclass(format('cashier.ledger_entry_y%sm%s', to_char(posted_at, 'YYYY'), to_char(posted_at, 'MM'))))
  FROM ledger_entry), 'ledger rows land in the partition for their month');
SELECT pg_temp.ok(cashier.ensure_monthly_partitions('cashier.ledger_entry', now()::date, 2) = 0,
  'partition maintenance is idempotent');
SELECT pg_temp.throws(format($q$INSERT INTO cashier.ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor, posted_at)
  VALUES (99, 'kestrel', 'dep-1', %s, 'EUR', 1, '2099-01-01'), (99, 'kestrel', 'dep-1', %s, 'EUR', -1, '2099-01-01')$q$, :player, :settle),
  '23514', 'a posting with no partition for its month fails loudly instead of landing nowhere');
SELECT pg_temp.ok(to_regclass(format('cashier.outbox_d%s', to_char(current_date, 'YYYYMMDD'))) IS NOT NULL,
  'outbox partition for today exists');

INSERT INTO outbox (event_type, schema_version, operator_code, partition_key, payload)
VALUES ('BetPlaced', 1, 'kestrel', 'r-1', '{"roundId": "r-1"}');
SELECT pg_temp.ok((SELECT tx_id = pg_current_xact_id() FROM outbox LIMIT 1), 'outbox row records its writing transaction id');
SELECT pg_temp.ok((SELECT count(*) FROM outbox WHERE tx_id < pg_snapshot_xmin(pg_current_snapshot())) = 0,
  'feed query hides events whose transaction is still in flight');
SELECT pg_temp.throws($q$UPDATE cashier.outbox SET payload = '{}'$q$, '42501', 'published events are immutable');

SELECT pg_temp.throws($q$INSERT INTO cashier.recon_run (operator_code, business_date, currency, platform_net_minor, operator_net_minor, status)
  VALUES ('kestrel', current_date, 'EUR', 1000, 990, 'matched')$q$, '23514', 'reconciliation cannot be matched with a difference');
INSERT INTO recon_run (operator_code, business_date, currency, platform_net_minor, operator_net_minor, status)
VALUES ('kestrel', current_date, 'EUR', 1000, 990, 'mismatched');
SELECT pg_temp.ok((SELECT difference_minor FROM recon_run) = 10, 'reconciliation difference is computed (10)');
ROLLBACK;
