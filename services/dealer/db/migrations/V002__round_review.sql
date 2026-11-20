-- Dealer V002: what round review (Catwalk) needs from the release side.
-- 1. Every published slot build ships a replay renderer and declares the hash of its math model,
--    so any round a player looks back at can be redrawn and re-checked by the certified rules.
-- 2. Studios register the Ed25519 public keys they sign round outcomes with. Keys are never
--    edited or deleted, only retired, so an old round can still be verified years later.
SET search_path = dealer, public;

CREATE FUNCTION guard_slot_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published'
     AND EXISTS (SELECT 1 FROM dealer.game g WHERE g.game_code = NEW.game_code AND g.category = 'slot')
     AND NOT (jsonb_typeof(NEW.manifest -> 'replayEntrypoint') = 'string'
              AND NEW.manifest ->> 'replayEntrypoint' ~ '^[A-Za-z0-9._/-]{1,128}$'
              AND NEW.manifest ->> 'replayEntrypoint' !~ '\.\.'
              AND coalesce(NEW.manifest ->> 'mathModelSha256', '') ~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'slot build %@% must declare replayEntrypoint and mathModelSha256 before it is published', NEW.game_code, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER game_build_slot_manifest BEFORE INSERT OR UPDATE ON game_build FOR EACH ROW EXECUTE FUNCTION guard_slot_manifest();

CREATE TABLE studio_signing_key (
  studio_code text  NOT NULL REFERENCES studio,
  key_id      text  NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  public_jwk  jsonb NOT NULL CHECK (public_jwk ->> 'kty' = 'OKP' AND public_jwk ->> 'crv' = 'Ed25519'
                                    AND public_jwk ->> 'x' ~ '^[A-Za-z0-9_-]{43}$' AND NOT public_jwk ? 'd'),
  status      text  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text  NOT NULL,
  retired_at  timestamptz,
  PRIMARY KEY (studio_code, key_id),
  CONSTRAINT retired_has_time CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

-- At most two active keys per studio: the current one and the next one during a rotation.
CREATE FUNCTION guard_signing_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing keys are retired, never deleted (old rounds must stay verifiable)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND ((NEW.public_jwk, NEW.studio_code, NEW.key_id) IS DISTINCT FROM (OLD.public_jwk, OLD.studio_code, OLD.key_id)
                           OR (OLD.status = 'retired' AND NEW.status = 'active')) THEN
    RAISE EXCEPTION 'a signing key can only be retired' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'active' AND (SELECT count(*) FROM dealer.studio_signing_key
                                WHERE studio_code = NEW.studio_code AND status = 'active' AND key_id <> NEW.key_id) >= 2 THEN
    RAISE EXCEPTION 'studio % already has two active signing keys; retire one first', NEW.studio_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER studio_signing_key_guard BEFORE INSERT OR UPDATE OR DELETE ON studio_signing_key FOR EACH ROW EXECUTE FUNCTION guard_signing_key();
