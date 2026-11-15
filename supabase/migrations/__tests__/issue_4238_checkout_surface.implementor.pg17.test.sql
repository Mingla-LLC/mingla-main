\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4238-NATIVE-PURCHASE-SURFACE-COLUMN | issue #4238 | ticket_checkout_sessions.checkout_surface accepts only web, mobile-web, native or NULL, so the finalize-time conversion can tell a native app purchase from a website one.

-- Issue #4238 Wave 4 (M-3) — run after the full migration chain on PostgreSQL 17
-- as supabase_admin over 127.0.0.1.
--
--   S1  the column exists, is nullable text.
--   S2  the CHECK allows NULL and the three surfaces and refuses anything else.

CREATE OR REPLACE FUNCTION pg_temp.cs_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 checkout-surface FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

SELECT pg_temp.cs_assert(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ticket_checkout_sessions'
      AND column_name = 'checkout_surface'
      AND data_type = 'text'
      AND is_nullable = 'YES'
  ),
  'S1 checkout_surface is a nullable text column'
);

-- S2: copy the live constraint expression onto a one-column probe table, so the
-- real CHECK is exercised without building a full checkout session fixture.
BEGIN;
DO $t$
DECLARE
  v_def text;
  v_refused boolean := false;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conname = 'ticket_checkout_sessions_checkout_surface_check'
    AND c.conrelid = 'public.ticket_checkout_sessions'::regclass;
  PERFORM pg_temp.cs_assert(v_def IS NOT NULL, 'S2 the checkout_surface CHECK exists');

  EXECUTE format(
    'CREATE TEMP TABLE cs_probe (checkout_surface text, CONSTRAINT cs_probe_check %s)',
    v_def
  );
  INSERT INTO cs_probe VALUES (NULL), ('web'), ('mobile-web'), ('native');
  PERFORM pg_temp.cs_assert(
    (SELECT count(*) FROM cs_probe) = 4,
    'S2 NULL, web, mobile-web and native are allowed'
  );
  BEGIN
    INSERT INTO cs_probe VALUES ('desktop');
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  PERFORM pg_temp.cs_assert(v_refused, 'S2 an unknown surface is refused');
END
$t$;
ROLLBACK;
