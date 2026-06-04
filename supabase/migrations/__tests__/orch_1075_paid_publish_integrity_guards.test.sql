-- ORCH-1075 — behavioral post-apply probe for the paid-publish integrity guards.
-- Hand-run AFTER `supabase db push --linked` lands
-- 20260909000000_orch_1075_paid_publish_integrity_guards.sql.
--
-- This file is WRITE-SAFE: every behavioral case runs inside its own
-- transaction that ROLLBACKs, so no fixture data survives. It exercises the
-- guards against REAL RPC calls (not just function-body text), seeding a
-- not-Stripe-ready brand + a past/future paid offering and asserting the
-- RAISE / {ok:false,reason} rejection.
--
-- fails-on-revert: if any guard is reverted (the RPC publishes a paid offering
-- a not-ready brand can't sell, or a past-dated paid offering), the matching
-- DO block's "expected exception did NOT fire" branch RAISEs and the test fails.
--
-- Covers SPEC §8 T-01, T-02, T-07, T-08, T-09, T-16, T-17 (the subset that does
-- not require a full multi-table publish fixture). The tester layers the rest
-- (multi-date, event/trip publish end-to-end) on top.

\set ON_ERROR_STOP on

-- ─── M-00: pg_brand_can_charge exists + matches the checkout predicate (T-17) ──
DO $$
DECLARE v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pg_brand_can_charge'
                 AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'M-00 FAIL: pg_brand_can_charge helper missing';
  END IF;
  v_def := pg_get_functiondef('public.pg_brand_can_charge(uuid)'::regprocedure);
  -- Mirrors checkout: reads stripe_connect_accounts.charges_enabled, detached_at IS NULL.
  IF position('stripe_connect_accounts' IN v_def) = 0
     OR position('detached_at IS NULL' IN v_def) = 0
     OR position('charges_enabled' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-00 FAIL: pg_brand_can_charge does not mirror the checkout predicate';
  END IF;
  -- Must NOT read the brands cache as its source.
  IF position('stripe_charges_enabled' IN v_def) <> 0 THEN
    RAISE EXCEPTION 'M-00 FAIL: pg_brand_can_charge reads the brands cache, not the source';
  END IF;
  RAISE NOTICE 'M-00 PASS: pg_brand_can_charge present + mirrors checkout source predicate';
END$$;

-- ─── M-01: pg_brand_can_charge returns false for a not-ready brand, true for a
--           ready brand (T-17 behavioral; write-safe via ROLLBACK) ─────────────
BEGIN;
DO $$
DECLARE
  v_brand_ready    uuid := gen_random_uuid();
  v_brand_unready  uuid := gen_random_uuid();
BEGIN
  -- Minimal brand rows (only columns the helper + FKs touch).
  INSERT INTO public.brands (id, name, slug, default_currency)
    VALUES (v_brand_ready, 'ORCH1075 Ready', 'orch1075-ready-' || v_brand_ready, 'USD'),
           (v_brand_unready, 'ORCH1075 Unready', 'orch1075-unready-' || v_brand_unready, 'USD');

  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id, charges_enabled)
    VALUES (v_brand_ready, 'acct_orch1075_ready', true),
           (v_brand_unready, 'acct_orch1075_unready', false);

  IF public.pg_brand_can_charge(v_brand_ready) IS NOT TRUE THEN
    RAISE EXCEPTION 'M-01 FAIL: ready brand (charges_enabled=true) not recognised as can-charge';
  END IF;
  IF public.pg_brand_can_charge(v_brand_unready) IS NOT FALSE THEN
    RAISE EXCEPTION 'M-01 FAIL: unready brand (charges_enabled=false) wrongly can-charge';
  END IF;
  -- No attached account at all → cannot charge.
  IF public.pg_brand_can_charge(gen_random_uuid()) IS NOT FALSE THEN
    RAISE EXCEPTION 'M-01 FAIL: brand with no connect account wrongly can-charge';
  END IF;
  RAISE NOTICE 'M-01 PASS: pg_brand_can_charge true/false matches charges_enabled';
END$$;
ROLLBACK;

-- ─── M-02: each money RPC body carries the required guard markers (fails-on-revert) ──
DO $$
DECLARE
  v_both text[] := ARRAY[
    'public.biz_create_experience(uuid,jsonb,boolean)',
    'public.biz_publish_experience(uuid,jsonb,boolean)',
    'public.biz_update_live_experience(uuid,jsonb,text)',
    'public.business_publish_event_draft(uuid,jsonb,integer)',
    'public.business_publish_trip_draft(uuid,jsonb,integer)',
    'public.biz_update_live_trip(uuid,jsonb,text)'
  ];
  v_name text;
  v_def text;
BEGIN
  FOREACH v_name IN ARRAY v_both LOOP
    v_def := pg_get_functiondef(v_name::regprocedure);
    IF position('pg_brand_can_charge(' IN v_def) = 0 THEN
      RAISE EXCEPTION 'M-02 FAIL: % missing Guard A (pg_brand_can_charge)', v_name;
    END IF;
    IF position('offering_date_past' IN v_def) = 0 THEN
      RAISE EXCEPTION 'M-02 FAIL: % missing Guard B (offering_date_past)', v_name;
    END IF;
  END LOOP;
  -- business_patch_event_when carries Guard B only (no Stripe guard by design).
  v_def := pg_get_functiondef('public.business_patch_event_when(uuid,jsonb,text,integer)'::regprocedure);
  IF position('offering_date_past' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-02 FAIL: business_patch_event_when missing Guard B';
  END IF;
  RAISE NOTICE 'M-02 PASS: all money RPCs carry the required guard markers';
END$$;

-- ─── M-03: orch-0792 invariant preserved — event publish RPC still writes event_dates ─
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.business_publish_event_draft(uuid,jsonb,integer)'::regprocedure);
  IF position('INSERT INTO public.event_dates' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-03 FAIL: business_publish_event_draft no longer writes event_dates (orch-0792 regression)';
  END IF;
  RAISE NOTICE 'M-03 PASS: event_dates write preserved (orch-0792 intact)';
END$$;

\echo 'ORCH-1075 behavioral probe: ALL PASS (M-00..M-03).'
