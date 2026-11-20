-- Shared fixture for pitboss tests (runs as the migration owner, so RLS is bypassed here).
SET search_path = pitboss, public;
INSERT INTO player (player_id, operator_code, operator_player_ref, jurisdiction_code, kyc_status, kyc_verified_at, age_verified) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'kestrel', 'K-1001', 'JUR-A', 'verified', now(), true),
  ('00000000-0000-4000-8000-0000000000a2', 'kestrel', 'K-1002', 'JUR-B', 'pending',  NULL,  false),
  ('00000000-0000-4000-8000-0000000000b1', 'baobab',  'B-2001', 'JUR-A', 'verified', now(), true);
