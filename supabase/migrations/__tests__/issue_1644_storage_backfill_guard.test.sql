-- Issue #1644 — contract test for the storage-guardrail measurement RPC.
--
-- The guard is only as trustworthy as this function. If it silently returned 0,
-- every backfill would sail past the ceiling and straight into the Fair-Use
-- restriction the guard exists to prevent. So this test is deliberately
-- NON-VACUOUS: it seeds objects with KNOWN sizes and asserts the exact total,
-- rather than only checking that the function exists and returns something.
--
-- It also pins the grant surface: service_role EXECUTE, anon/authenticated NOT.
-- A SECURITY DEFINER function over storage.objects that anon could call would
-- leak the whole project's storage footprint, and would additionally require an
-- entry in supabase/security/anon_executable_definer_allowlist.txt (ORCH-1392).

\set ON_ERROR_STOP on

BEGIN;

-- ── 1. The function exists, returns bigint, and is SECURITY DEFINER ─────────
DO $$
DECLARE
  v_secdef boolean;
  v_rettype text;
  v_volatile char;
BEGIN
  SELECT p.prosecdef, pg_catalog.format_type(p.prorettype, NULL), p.provolatile
    INTO v_secdef, v_rettype, v_volatile
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'issue_1644_storage_total_bytes'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'public.issue_1644_storage_total_bytes() does not exist';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'issue_1644_storage_total_bytes must be SECURITY DEFINER (storage.objects is not readable by service_role directly)';
  END IF;
  IF v_rettype <> 'bigint' THEN
    RAISE EXCEPTION 'expected bigint return, got %', v_rettype;
  END IF;
  IF v_volatile <> 's' THEN
    RAISE EXCEPTION 'expected STABLE volatility, got %', v_volatile;
  END IF;
END $$;

-- ── 2. Grants: service_role yes; anon / authenticated / PUBLIC no ───────────
DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.issue_1644_storage_total_bytes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role MUST be able to execute the guard RPC — the edge functions fail CLOSED without it';
  END IF;
  IF has_function_privilege('anon', 'public.issue_1644_storage_total_bytes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon MUST NOT execute the guard RPC (storage footprint leak + ORCH-1392 allowlist violation)';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_1644_storage_total_bytes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated MUST NOT execute the guard RPC';
  END IF;
END $$;

-- ── 3. NON-VACUOUS: seed known sizes and assert the exact sum ───────────────
-- Without this the test would pass against a function that always returns 0,
-- which is precisely the failure mode that would disable the guardrail.
DO $$
DECLARE
  v_before bigint;
  v_after  bigint;
  v_bucket text := 'issue-1644-test-bucket';
BEGIN
  SELECT public.issue_1644_storage_total_bytes() INTO v_before;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'guard RPC returned NULL; it must return 0 on an empty bucket set';
  END IF;

  -- Only (id, name): the stock supabase/postgres image ships a MINIMAL
  -- storage.buckets (id, name, owner, created_at, updated_at) with no `public`
  -- column, while production's is the full Storage-managed table. Naming only
  -- the two columns both definitely have keeps this test portable across the CI
  -- image and production.
  INSERT INTO storage.buckets (id, name)
  VALUES (v_bucket, v_bucket)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    (v_bucket, 'issue1644/a.png', jsonb_build_object('size', 1000)),
    (v_bucket, 'issue1644/b.png', jsonb_build_object('size', 2500)),
    -- A row with NO size key must not blow up the sum (COALESCE/NULL-safety).
    (v_bucket, 'issue1644/c.png', jsonb_build_object('mimetype', 'image/png'));

  SELECT public.issue_1644_storage_total_bytes() INTO v_after;

  IF v_after <> v_before + 3500 THEN
    RAISE EXCEPTION
      'guard RPC must sum metadata->>size exactly: expected % got % (before=%)',
      v_before + 3500, v_after, v_before;
  END IF;

  -- And it must agree with the direct sum the investigation used.
  IF v_after <> (SELECT COALESCE(SUM((metadata ->> 'size')::bigint), 0) FROM storage.objects) THEN
    RAISE EXCEPTION 'guard RPC disagrees with the direct sum over storage.objects';
  END IF;
END $$;

ROLLBACK;
