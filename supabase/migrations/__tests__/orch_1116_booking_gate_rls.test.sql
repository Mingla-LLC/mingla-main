-- ORCH-1116 — behavioral regression test for the booking-gate RLS false-positive.
-- Hand-run AFTER 20260927000000_orch_1116_booking_gate_rls.sql lands (or against
-- the live remote read-and-rollback to prove fails-on-revert before apply).
--
-- WHY THIS TEST EXISTS / WHY IT IS DIFFERENT FROM ORCH-1076's G-00:
-- ORCH-1076's G-00 asserted only that anon holds the EXECUTE *grant* on
-- pg_brand_can_charge — it NEVER ran the RPC `SET ROLE anon` against a READY
-- brand to assert it returns TRUE. The body seeded rows and ran as the migration
-- superuser, so RLS never bit in the test. That is the exact CI gap that let the
-- ORCH-1116 SECURITY-INVOKER-over-RLS false-positive ship green. An EXECUTE-grant
-- check is NEVER sufficient for a predicate that reads an RLS-protected table —
-- the test MUST exercise the anon (and non-owner authenticated) role and assert
-- the RETURN VALUE. This test does exactly that.
--
-- WRITE-SAFE: every behavioral case seeds fixtures (as the migration superuser —
-- anon cannot INSERT into stripe_connect_accounts) inside its own transaction
-- that ROLLBACKs, then wraps ONLY the RPC assertion in SET LOCAL ROLE anon /
-- authenticated. No fixture data survives.
--
-- fails-on-revert: if the migration is reverted (predicate back to SECURITY
-- INVOKER), anon sees 0 rows on stripe_connect_accounts -> pg_brand_can_charge
-- returns false for a READY brand -> G-01's `IS NOT TRUE` branch RAISEs and the
-- test fails. PASSES only when the SECURITY DEFINER fix is in place.
--
-- Covers SPEC §5 SC-1..SC-6 and §7 T-01..T-08 + T-10 (fails-on-revert).

\set ON_ERROR_STOP on

-- ─── G-00: catalog probe — both predicates are SECURITY DEFINER with a locked
--           search_path (SC-6). Catches a revert to INVOKER at the catalog level
--           even before any role-scoped behavioral case runs. ─────────────────
DO $$
DECLARE
  v_secdef_single boolean;
  v_secdef_batch  boolean;
  v_cfg_single    text[];
  v_cfg_batch     text[];
BEGIN
  SELECT prosecdef, proconfig INTO v_secdef_single, v_cfg_single
    FROM pg_proc
   WHERE proname = 'pg_brand_can_charge'
     AND pronamespace = 'public'::regnamespace;
  SELECT prosecdef, proconfig INTO v_secdef_batch, v_cfg_batch
    FROM pg_proc
   WHERE proname = 'pg_brands_can_charge'
     AND pronamespace = 'public'::regnamespace;

  IF v_secdef_single IS NOT TRUE THEN
    RAISE EXCEPTION 'G-00 FAIL: pg_brand_can_charge is NOT SECURITY DEFINER (prosecdef=%). The ORCH-1116 RLS-INVOKER booking-gate false-positive is back.', v_secdef_single;
  END IF;
  IF v_secdef_batch IS NOT TRUE THEN
    RAISE EXCEPTION 'G-00 FAIL: pg_brands_can_charge is NOT SECURITY DEFINER (prosecdef=%). The ORCH-1116 RLS-INVOKER booking-gate false-positive is back.', v_secdef_batch;
  END IF;
  IF v_cfg_single IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg_single) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'G-00 FAIL: pg_brand_can_charge is missing a locked search_path (proconfig=%). SECURITY DEFINER hardening dropped.', v_cfg_single;
  END IF;
  IF v_cfg_batch IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg_batch) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'G-00 FAIL: pg_brands_can_charge is missing a locked search_path (proconfig=%). SECURITY DEFINER hardening dropped.', v_cfg_batch;
  END IF;

  RAISE NOTICE 'G-00 PASS: both predicates are SECURITY DEFINER with a locked search_path';
END$$;

-- ─── G-01: anon TRUE-POSITIVE — THE fails-on-revert case (SC-1 / T-01).
--           Seed a READY brand (attached, non-detached, non-null account id,
--           charges_enabled=true) as superuser, then assert anon gets TRUE. ────
BEGIN;
DO $$
DECLARE
  v_ready uuid;
  v_anon_result boolean;
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-ready-brand', 'ORCH1116 Ready', 'USD', now(), now())
  RETURNING id INTO v_ready;

  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_ready, 'acct_orch1116_ready', true, NULL, now(), now());

  -- Superuser precondition (RLS-exempt) — must be ready before role-scoped check.
  ASSERT public.pg_brand_can_charge(v_ready) = true,
    'precondition: seeded brand must be ready under superuser';

  SET LOCAL ROLE anon;
  v_anon_result := public.pg_brand_can_charge(v_ready);
  RESET ROLE;

  IF v_anon_result IS NOT TRUE THEN
    RAISE EXCEPTION 'G-01 FAIL: anon got % for a READY brand (the ORCH-1116 RLS-INVOKER booking-gate false-positive is back — predicate is not SECURITY DEFINER)', v_anon_result;
  END IF;

  RAISE NOTICE 'G-01 PASS: anon pg_brand_can_charge(ready) = true';
END$$;
ROLLBACK;

-- ─── G-01b: authenticated NON-OWNER TRUE-POSITIVE (SC-3 / T-05). A signed-in
--           buyer who is NOT the brand's payments-admin must also get TRUE under
--           DEFINER (the owner-only RLS predicate is irrelevant once the body
--           runs as definer). ──────────────────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_ready uuid;
  v_authed_result boolean;
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-ready-authed', 'ORCH1116 Ready Authed', 'USD', now(), now())
  RETURNING id INTO v_ready;

  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_ready, 'acct_orch1116_authed', true, NULL, now(), now());

  -- A random non-owner authenticated subject (no payments-admin grant on this brand).
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000abcde","role":"authenticated"}';
  v_authed_result := public.pg_brand_can_charge(v_ready);
  RESET ROLE;

  IF v_authed_result IS NOT TRUE THEN
    RAISE EXCEPTION 'G-01b FAIL: authenticated non-owner got % for a READY brand (DEFINER not honored under authenticated)', v_authed_result;
  END IF;

  RAISE NOTICE 'G-01b PASS: authenticated non-owner pg_brand_can_charge(ready) = true';
END$$;
ROLLBACK;

-- ─── G-02: anon TRUE-NEGATIVE preserved (SC-2 / T-02 / T-03 / T-04). A genuinely
--           not-ready brand must STILL return false under anon — guards against
--           an over-correction that returns true for everyone. Three not-ready
--           shapes: no account, charges_enabled=false, detached. ───────────────
BEGIN;
DO $$
DECLARE
  v_no_account uuid;
  v_charges_off uuid;
  v_detached uuid;
  v_r1 boolean;
  v_r2 boolean;
  v_r3 boolean;
BEGIN
  -- (a) no stripe_connect_accounts row at all.
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-no-account', 'ORCH1116 No Account', 'USD', now(), now())
  RETURNING id INTO v_no_account;

  -- (b) attached account but charges_enabled = false.
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-charges-off', 'ORCH1116 Charges Off', 'USD', now(), now())
  RETURNING id INTO v_charges_off;
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_charges_off, 'acct_orch1116_off', false, NULL, now(), now());

  -- (c) account exists but detached.
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-detached', 'ORCH1116 Detached', 'USD', now(), now())
  RETURNING id INTO v_detached;
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_detached, 'acct_orch1116_detached', true, now(), now(), now());

  SET LOCAL ROLE anon;
  v_r1 := public.pg_brand_can_charge(v_no_account);
  v_r2 := public.pg_brand_can_charge(v_charges_off);
  v_r3 := public.pg_brand_can_charge(v_detached);
  RESET ROLE;

  IF v_r1 IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'G-02 FAIL: anon got % for a no-account brand (expected false)', v_r1;
  END IF;
  IF v_r2 IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'G-02 FAIL: anon got % for a charges_enabled=false brand (expected false)', v_r2;
  END IF;
  IF v_r3 IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'G-02 FAIL: anon got % for a detached-account brand (expected false)', v_r3;
  END IF;

  RAISE NOTICE 'G-02 PASS: anon true-negative preserved (no-account / charges-off / detached all false)';
END$$;
ROLLBACK;

-- ─── G-03: batched resolver, anon (SC-4 / T-06). A mixed array must return ONLY
--           the ready brand-id, never the not-ready one. ──────────────────────
BEGIN;
DO $$
DECLARE
  v_ready uuid;
  v_notready uuid;
  v_returned uuid[];
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-batch-ready', 'ORCH1116 Batch Ready', 'USD', now(), now())
  RETURNING id INTO v_ready;
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_ready, 'acct_orch1116_batch', true, NULL, now(), now());

  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-batch-notready', 'ORCH1116 Batch NotReady', 'USD', now(), now())
  RETURNING id INTO v_notready;

  SET LOCAL ROLE anon;
  SELECT array_agg(brand_id ORDER BY brand_id)
    INTO v_returned
    FROM public.pg_brands_can_charge(ARRAY[v_ready, v_notready]::uuid[]);
  RESET ROLE;

  IF v_returned IS DISTINCT FROM ARRAY[v_ready] THEN
    RAISE EXCEPTION 'G-03 FAIL: anon batched resolver returned % (expected exactly the ready id %)', v_returned, v_ready;
  END IF;

  RAISE NOTICE 'G-03 PASS: anon pg_brands_can_charge returns only the ready brand-id';
END$$;
ROLLBACK;

-- ─── G-04: NO ROW LEAK (SC-5 / T-07). The base-table RLS is untouched — anon
--           must still see ZERO stripe_connect_accounts rows. The DEFINER change
--           grants the boolean answer, never row visibility. ──────────────────
BEGIN;
DO $$
DECLARE
  v_ready uuid;
  v_visible bigint;
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), 'orch1116-noleak', 'ORCH1116 No Leak', 'USD', now(), now())
  RETURNING id INTO v_ready;
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id,
    charges_enabled, detached_at, created_at, updated_at)
  VALUES (v_ready, 'acct_orch1116_noleak', true, NULL, now(), now());

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_visible
    FROM public.stripe_connect_accounts
   WHERE brand_id = v_ready;
  RESET ROLE;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'G-04 FAIL: anon can SELECT % stripe_connect_accounts row(s) directly (base-table RLS leaked; expected 0)', v_visible;
  END IF;

  RAISE NOTICE 'G-04 PASS: anon still sees 0 stripe_connect_accounts rows (no row leak)';
END$$;
ROLLBACK;

-- ─── Done. All cases passing => the SECURITY DEFINER fix is in place and the
--           true-negative + no-leak guarantees hold.
DO $$
BEGIN
  RAISE NOTICE 'ORCH-1116 booking-gate-RLS behavioral test: ALL CASES PASSED';
END$$;
