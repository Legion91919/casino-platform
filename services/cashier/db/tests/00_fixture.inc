-- Shared fixture for cashier tests (included with \ir; the test file's transaction is rolled back).
SET search_path = cashier, public;
INSERT INTO operator (operator_code, display_name, status) VALUES
  ('kestrel', 'Kestrel Gaming', 'active'), ('baobab', 'Baobab Casino', 'active');
INSERT INTO account (operator_code, kind, player_id, currency, track_balance, allow_negative) VALUES
  ('kestrel', 'player_cash', '00000000-0000-4000-8000-0000000000a1', 'EUR', true,  false),
  ('kestrel', 'game_house',  NULL,                                   'EUR', false, true),
  ('kestrel', 'operator_settlement', NULL,                           'EUR', false, true),
  ('baobab',  'game_house',  NULL,                                   'EUR', false, true);
SELECT account_id AS player FROM account WHERE operator_code = 'kestrel' AND kind = 'player_cash' \gset
SELECT account_id AS house  FROM account WHERE operator_code = 'kestrel' AND kind = 'game_house' \gset
SELECT account_id AS settle FROM account WHERE operator_code = 'kestrel' AND kind = 'operator_settlement' \gset
SELECT account_id AS baobab_house FROM account WHERE operator_code = 'baobab' AND kind = 'game_house' \gset
-- Fund the player with 100.00 EUR (operator transfer into the hosted wallet).
INSERT INTO wallet_txn (operator_code, game_server_txn_id, kind, player_id, currency, amount_minor,
                        request_sha256, outcome, response, posting_id, actor)
VALUES ('kestrel', 'dep-1', 'adjustment', '00000000-0000-4000-8000-0000000000a1', 'EUR', 10000,
        sha256('dep-1'), 'accepted', '{"balance": 10000}', 1, 'ops-onboarding');
INSERT INTO ledger_entry (posting_id, operator_code, game_server_txn_id, account_id, currency, amount_minor) VALUES
  (1, 'kestrel', 'dep-1', :player, 'EUR',  10000),
  (1, 'kestrel', 'dep-1', :settle, 'EUR', -10000);
INSERT INTO game_round (operator_code, game_code, external_round_id, player_id, currency)
VALUES ('kestrel', 'jungle-reels', 'r-1', '00000000-0000-4000-8000-0000000000a1', 'EUR');
