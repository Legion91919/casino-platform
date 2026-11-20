-- Proves: the audit log is append-only and hash-chained (tampering is detected even by a superuser who
-- disables the guard), and row-level security keeps each operator inside its own players.
BEGIN;
\ir ../../../../tools/sql/test_helpers.sql
\ir 00_fixture.inc

INSERT INTO audit_event (operator_code, player_id, actor, action, detail) VALUES
  ('kestrel', '00000000-0000-4000-8000-0000000000a1', 'player', 'limit.set', '{"type": "loss", "amount": 5000}'),
  ('baobab',  '00000000-0000-4000-8000-0000000000b1', 'player', 'exclusion.created', '{"kind": "cool_off"}'),
  ('kestrel', '00000000-0000-4000-8000-0000000000a1', 'player', 'exclusion.created', '{"kind": "self_exclusion"}'),
  ('kestrel', '00000000-0000-4000-8000-0000000000a2', 'ops-17', 'kyc.updated', '{"status": "pending"}');
SELECT pg_temp.ok((SELECT array_agg(chain_seq ORDER BY audit_id) FROM audit_event WHERE operator_code = 'kestrel') = '{1,2,3}',
  'chain sequence is gap-free per operator');
SELECT pg_temp.ok((SELECT prev_hash FROM audit_event WHERE operator_code = 'kestrel' AND chain_seq = 2)
                = (SELECT row_hash FROM audit_event WHERE operator_code = 'kestrel' AND chain_seq = 1),
  'each audit row links to the previous row''s hash');
SELECT pg_temp.ok(pitboss.audit_first_broken('kestrel') IS NULL AND pitboss.audit_first_broken('baobab') IS NULL,
  'audit chains verify intact');
SELECT pg_temp.throws($q$UPDATE pitboss.audit_event SET detail = '{}'$q$, '42501', 'audit rows cannot be edited');
SELECT pg_temp.throws($q$DELETE FROM pitboss.audit_event$q$, '42501', 'audit rows cannot be deleted');

ALTER TABLE audit_event DISABLE TRIGGER audit_append_only;
UPDATE audit_event SET detail = '{"type": "loss", "amount": 999999}' WHERE operator_code = 'kestrel' AND chain_seq = 1;
SELECT pg_temp.ok(pitboss.audit_first_broken('kestrel') = (SELECT audit_id FROM audit_event WHERE operator_code = 'kestrel' AND chain_seq = 1),
  'tampering by someone who bypasses the guard is detected by the hash chain');
ALTER TABLE audit_event ENABLE TRIGGER audit_append_only;

CREATE ROLE pitboss_app_test NOLOGIN;
GRANT USAGE ON SCHEMA pitboss TO pitboss_app_test;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA pitboss TO pitboss_app_test;
SET LOCAL ROLE pitboss_app_test;
SELECT pg_temp.ok((SELECT count(*) FROM pitboss.player) = 0, 'without an operator context the app role sees no players');
SET LOCAL app.operator_code = 'kestrel';
SELECT pg_temp.ok((SELECT count(*) FROM pitboss.player) = 2 AND (SELECT bool_and(operator_code = 'kestrel') FROM pitboss.player),
  'operator kestrel sees only its own 2 players');
SELECT pg_temp.ok((SELECT count(*) FROM pitboss.audit_event WHERE operator_code = 'baobab') = 0,
  'operator kestrel cannot read baobab audit rows even when asking for them');
SELECT pg_temp.throws($q$INSERT INTO pitboss.player (operator_code, operator_player_ref, jurisdiction_code)
  VALUES ('baobab', 'B-9999', 'JUR-A')$q$, '42501', 'operator kestrel cannot create a player for baobab');
SET LOCAL app.operator_code = 'baobab';
SELECT pg_temp.ok((SELECT count(*) FROM pitboss.player) = 1, 'operator baobab sees only its own player');
RESET ROLE;
ROLLBACK;
