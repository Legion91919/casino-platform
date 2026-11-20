-- Proves: the game server's transaction id is a unique idempotency key per operator, stakes need a
-- Pitboss authorisation, a rollback-before-stake tombstone blocks the late stake, and a transaction
-- can be reversed at most once.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

INSERT INTO wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id, player_id, currency,
                        amount_minor, request_sha256, outcome, response, pitboss_authorization_id, posting_id)
VALUES ('kestrel', 'gs-200', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        100, sha256('gs-200'), 'accepted', '{"balance": 9900}', gen_random_uuid(), 20);
INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor) VALUES
  (20, 'kestrel', 'gs-200', :player, 'EUR', -100), (20, 'kestrel', 'gs-200', :house, 'EUR', 100);

SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response, pitboss_authorization_id, posting_id)
  VALUES ('kestrel', 'gs-200', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          100, sha256('gs-200'), 'accepted', '{}', gen_random_uuid(), 21)$q$,
  '23505', 'duplicate game-server transaction id for the same operator is rejected');

INSERT INTO game_round (operator_code, game_code, external_round_id, player_id, currency)
VALUES ('baobab', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000b1', 'EUR');
INSERT INTO wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id, player_id, currency,
                        amount_minor, request_sha256, outcome, reject_code, response)
VALUES ('baobab', 'gs-200', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000b1', 'EUR',
        100, sha256('baobab-gs-200'), 'rejected', 'INSUFFICIENT_FUNDS', '{"error": "INSUFFICIENT_FUNDS"}');
SELECT pg_temp.ok((SELECT count(*) FROM wallet_txn WHERE game_server_txn_id = 'gs-200') = 2,
  'the same transaction id under another operator is a different key');
SELECT pg_temp.ok((SELECT response->>'error' FROM wallet_txn WHERE operator_code = 'baobab' AND game_server_txn_id = 'gs-200') = 'INSUFFICIENT_FUNDS',
  'a rejected request is stored, so its retry replays the same rejection');

SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response, posting_id)
  VALUES ('kestrel', 'gs-201', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          100, sha256('gs-201'), 'accepted', '{}', 22)$q$,
  '23514', 'accepted stake without a Pitboss authorisation is rejected');
SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response)
  VALUES ('kestrel', 'gs-202', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          100, sha256('gs-202'), 'rejected', '{}')$q$,
  '23514', 'rejected transaction must carry a reject code');
SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response, pitboss_authorization_id)
  VALUES ('kestrel', 'gs-203', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          100, sha256('gs-203'), 'accepted', '{}', gen_random_uuid())$q$,
  '23514', 'accepted non-zero transaction must reference its ledger posting');
SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response)
  VALUES ('kestrel', 'gs-204', 'rollback', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          100, sha256('gs-204'), 'accepted', '{}')$q$,
  '23514', 'rollback without the transaction it reverses is rejected');
SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response)
  VALUES ('kestrel', 'gs-205', 'win', 'jungle-reels', 'no-such-round', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          0, sha256('gs-205'), 'accepted', '{}')$q$,
  '23503', 'transaction for an unknown round is rejected');

-- Rollback arrives before its stake (stake timed out upstream): record a tombstone for the unseen stake.
INSERT INTO wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id, player_id, currency,
                        amount_minor, reference_txn_id, request_sha256, outcome, reject_code, response)
VALUES ('kestrel', 'gs-300', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        0, NULL, NULL, 'rejected', 'ROLLED_BACK_BEFORE_SEEN', '{"error": "ROLLED_BACK"}'),
       ('kestrel', 'gs-301', 'rollback', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        0, 'gs-300', sha256('gs-301'), 'accepted', NULL, '{"balance": 9900}');
INSERT INTO txn_reversal VALUES ('kestrel', 'gs-300', 'gs-301');
SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id,
  player_id, currency, amount_minor, request_sha256, outcome, response, pitboss_authorization_id, posting_id)
  VALUES ('kestrel', 'gs-300', 'stake', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
          100, sha256('gs-300'), 'accepted', '{}', gen_random_uuid(), 30)$q$,
  '23505', 'late stake after its rollback hits the tombstone and is refused');
SELECT pg_temp.throws($q$INSERT INTO cashier.wallet_txn (operator_code, game_server_txn_id, kind, player_id, currency,
  amount_minor, outcome, reject_code, response)
  VALUES ('kestrel', 'gs-302', 'adjustment', '00000000-0000-4000-8000-0000000000a1', 'EUR', 0, 'rejected', 'BAD', '{}')$q$,
  '23514', 'only a rollback tombstone may omit the request hash');

-- Proper rollback of gs-200 (refund 1.00), then a second rollback of the same stake.
INSERT INTO wallet_txn (operator_code, game_server_txn_id, kind, game_code, external_round_id, player_id, currency,
                        amount_minor, reference_txn_id, request_sha256, outcome, reject_code, response, posting_id)
VALUES ('kestrel', 'gs-210', 'rollback', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        100, 'gs-200', sha256('gs-210'), 'accepted', NULL, '{"balance": 10000}', 23),
       ('kestrel', 'gs-211', 'rollback', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR',
        100, 'gs-200', sha256('gs-211'), 'rejected', 'ALREADY_REVERSED', '{"error": "ALREADY_REVERSED"}', NULL);
INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor) VALUES
  (23, 'kestrel', 'gs-210', :house, 'EUR', -100), (23, 'kestrel', 'gs-210', :player, 'EUR', 100);
INSERT INTO txn_reversal VALUES ('kestrel', 'gs-200', 'gs-210');
SELECT pg_temp.throws($q$INSERT INTO cashier.txn_reversal VALUES ('kestrel', 'gs-200', 'gs-211')$q$, '23505',
  'a transaction can be reversed at most once');
SELECT pg_temp.throws($q$INSERT INTO cashier.txn_reversal VALUES ('kestrel', 'gs-999', 'gs-211')$q$, '23503',
  'reversal must point at a recorded transaction (or its tombstone)');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.ok((SELECT balance_minor FROM account WHERE account_id = :player) = 10000,
  'after stake and its rollback the player is back to 10000');
ROLLBACK;
