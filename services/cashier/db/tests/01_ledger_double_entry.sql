-- Proves: postings balance, balances never go negative, money stays inside its operator and currency,
-- and the ledger is append-only.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.ok(true, 'balanced funding posting passes the deferred zero-sum check');
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.ok((SELECT balance_minor FROM account WHERE account_id = :player) = 10000,
                  'player running balance is 10000 after funding');
SELECT pg_temp.ok((SELECT balance_minor FROM account WHERE account_id = :settle) = 0,
                  'untracked operator account keeps no running balance (hot-row free)');

-- A stake of 2.50 and a win of 6.00 in round r-1
INSERT INTO wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id, player_id, currency,
                        amount_minor, request_sha256, outcome, response, pitboss_authorization_id, posting_id)
VALUES ('kestrel', 'gs-100', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        250, sha256('gs-100'), 'accepted', '{"balance": 9750}', gen_random_uuid(), 2),
       ('kestrel', 'gs-101', 'win', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        600, sha256('gs-101'), 'accepted', '{"balance": 10350}', NULL, 3);
INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor) VALUES
  (2, 'kestrel', 'gs-100', :player, 'EUR', -250), (2, 'kestrel', 'gs-100', :house, 'EUR', 250),
  (3, 'kestrel', 'gs-101', :house, 'EUR', -600),  (3, 'kestrel', 'gs-101', :player, 'EUR', 600);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.ok((SELECT balance_minor FROM account WHERE account_id = :player) = 10350,
                  'stake 250 then win 600 leaves player balance 10350');
SELECT pg_temp.ok((SELECT sum(amount_minor) FROM ledger_entry) = 0, 'whole ledger sums to zero');

SELECT pg_temp.throws(format($q$INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor)
  VALUES (4, 'kestrel', 'gs-100', %s, 'EUR', -500), (4, 'kestrel', 'gs-100', %s, 'EUR', 400)$q$, :player, :house),
  '23514', 'unbalanced posting (-500/+400) is rejected at commit');
SELECT pg_temp.throws(format($q$INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor)
  VALUES (5, 'kestrel', 'gs-100', %s, 'EUR', 100)$q$, :house),
  '23514', 'single-leg posting is rejected at commit');
SELECT pg_temp.throws(format($q$INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor)
  VALUES (6, 'kestrel', 'gs-100', %s, 'EUR', 0)$q$, :house),
  '23514', 'zero-amount entry is rejected');
SELECT pg_temp.throws(format($q$INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor)
  VALUES (7, 'kestrel', 'gs-100', %s, 'GBP', -100), (7, 'kestrel', 'gs-100', %s, 'GBP', 100)$q$, :player, :house),
  '23503', 'entry in GBP against a EUR account is rejected (currency travels in the FK)');
SELECT pg_temp.throws(format($q$INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor)
  VALUES (8, 'kestrel', 'gs-100', %s, 'EUR', -100), (8, 'kestrel', 'gs-100', %s, 'EUR', 100)$q$, :player, :baobab_house),
  '23503', 'posting into another operator''s account is rejected (tenant travels in the FK)');
SELECT pg_temp.throws(format($q$INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor)
  VALUES (9, 'kestrel', 'gs-100', %s, 'EUR', -20000), (9, 'kestrel', 'gs-100', %s, 'EUR', 20000)$q$, :player, :house),
  '23514', 'stake larger than the player balance cannot drive it negative');
SELECT pg_temp.throws('UPDATE cashier.ledger_entry SET amount_minor = amount_minor * 2', '42501',
  'UPDATE on ledger_entry is rejected (append-only)');
SELECT pg_temp.throws('DELETE FROM cashier.ledger_entry', '42501', 'DELETE on ledger_entry is rejected (append-only)');
SELECT pg_temp.throws($q$UPDATE cashier.wallet_txn SET amount_minor = 1 WHERE game_server_txn_id = 'gs-100'$q$, '42501',
  'UPDATE on wallet_txn is rejected (append-only)');
SELECT pg_temp.throws($q$UPDATE cashier.account SET balance_minor = -1 WHERE kind = 'player_cash'$q$, '23514',
  'player cash account can never hold a negative balance');
SELECT pg_temp.throws($q$INSERT INTO cashier.account (operator_code, kind, player_id, currency, track_balance, allow_negative)
  VALUES ('kestrel', 'player_cash', '00000000-0000-4000-8000-0000000000a1', 'EUR', true, false)$q$, '23505',
  'one cash account per player and currency');
SELECT pg_temp.throws($q$INSERT INTO cashier.account (operator_code, kind, player_id, currency, track_balance, allow_negative)
  VALUES ('kestrel', 'game_house', NULL, 'EUR', false, true)$q$, '23505',
  'one house account per operator and currency (NULLS NOT DISTINCT)');
ROLLBACK;
