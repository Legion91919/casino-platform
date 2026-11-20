-- Shared assertion helpers for db/tests/*.sql. Included with \ir from each test file.
-- They live in pg_temp, so they vanish with the session and never touch a service schema.
-- Every passing assertion prints a NOTICE starting with "PASS:"; tools/db-verify.sh counts them.
-- A failing assertion raises an exception, and psql (ON_ERROR_STOP) exits non-zero.

CREATE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

-- Runs one SQL statement and passes only if it fails with the expected SQLSTATE.
-- Deferred constraint triggers are forced to fire, so commit-time checks are tested too.
-- The statement runs in a subtransaction, so its effects are rolled back either way.
CREATE FUNCTION pg_temp.throws(stmt text, expected_sqlstate text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_sqlstate THEN
      RAISE NOTICE 'PASS: % (% %)', label, SQLSTATE, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL: % (expected %, got % %)', label, expected_sqlstate, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (expected %, statement succeeded)', label, expected_sqlstate;
END $$;
