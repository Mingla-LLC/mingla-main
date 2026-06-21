-- ORCH-1186-A — hours single-owner seed/derive regression probe.
-- Hand-run after the migration applies (Management API). Asserts the bridge
-- helper exists + is wired into BOTH hours-write RPCs, then drives a real
-- seed/derive/edit/non-clobber cycle inside a single rolled-back transaction.
--
-- fails-on-revert: if the helper biz_derive_service_periods_from_brand_hours
-- is absent (migration reverted), F-01 RAISE EXCEPTIONs immediately; if either
-- RPC stops PERFORMing the helper, F-02/F-03 fail; if the weekday remap is
-- removed, T1/T2 fail (Saturday lands on the wrong pg-dow); if the non-clobber
-- merge is removed, T4 fails (operator periods get overwritten).
--
-- WEEKDAY REMAP (load-bearing): brand_hours Mon=0..Sun=6 ; service_periods.days[]
-- Postgres dow Sun=0..Sat=6 ; pg_dow = (weekday+1)%7.

\set ON_ERROR_STOP on

-- ─── F-01: the bridge helper exists, SECURITY DEFINER, pinned search_path ────
DO $$
DECLARE
  v_secdef boolean;
  v_cfg text[];
BEGIN
  SELECT prosecdef, proconfig INTO v_secdef, v_cfg
  FROM pg_proc
  WHERE proname = 'biz_derive_service_periods_from_brand_hours'
    AND pronamespace = 'public'::regnamespace
  LIMIT 1;
  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'F-01 FAIL: biz_derive_service_periods_from_brand_hours missing';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'F-01 FAIL: helper not SECURITY DEFINER';
  END IF;
  IF v_cfg IS NULL OR array_to_string(v_cfg, ',') NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION 'F-01 FAIL: helper missing pinned search_path';
  END IF;
  RAISE NOTICE 'F-01 PASS: helper exists (SECURITY DEFINER, pinned search_path)';
END$$;

-- ─── F-02: biz_create_venue_brand_authoring PERFORMs the helper ──────────────
DO $$
BEGIN
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='biz_create_venue_brand_authoring' LIMIT 1)
     NOT LIKE '%biz_derive_service_periods_from_brand_hours%' THEN
    RAISE EXCEPTION 'F-02 FAIL: create RPC does not call the derive helper (live bridge missing)';
  END IF;
  RAISE NOTICE 'F-02 PASS: create RPC wires the live bridge';
END$$;

-- ─── F-03: biz_upsert_brand_hours PERFORMs the helper ───────────────────────
DO $$
BEGIN
  IF (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='biz_upsert_brand_hours' LIMIT 1)
     NOT LIKE '%biz_derive_service_periods_from_brand_hours%' THEN
    RAISE EXCEPTION 'F-03 FAIL: upsert RPC does not call the derive helper (edit bridge missing)';
  END IF;
  RAISE NOTICE 'F-03 PASS: upsert RPC wires the edit bridge';
END$$;

-- ─── Behavioral cycle (rolled back): seed → remap → edit → non-clobber → idem ─
DO $$
DECLARE
  v_acct uuid;
  v_brand uuid;
  v_sp jsonb;
  v_sat jsonb;
  v_sun jsonb;
  v_first jsonb;
  v_updated_1 timestamptz;
  v_updated_2 timestamptz;
BEGIN
  SELECT id INTO v_acct FROM public.creator_accounts LIMIT 1;
  IF v_acct IS NULL THEN
    RAISE EXCEPTION 'T-PRE FAIL: no creator_account available to anchor the probe';
  END IF;

  INSERT INTO public.brands (account_id, name, slug, claim_status, venue_category)
  VALUES (v_acct, 'ORCH1186 Test', 'orch1186test' || floor(random()*1000000)::text,
          'pending_review', 'restaurant')
  RETURNING id INTO v_brand;

  -- Mon–Fri 09:00–17:00, Sat 10:00–14:00, Sun closed (brand_hours Mon=0..Sun=6).
  INSERT INTO public.brand_hours (brand_id, weekday, open_time, close_time, is_closed) VALUES
    (v_brand,0,'09:00','17:00',false),
    (v_brand,1,'09:00','17:00',false),
    (v_brand,2,'09:00','17:00',false),
    (v_brand,3,'09:00','17:00',false),
    (v_brand,4,'09:00','17:00',false),
    (v_brand,5,'10:00','14:00',false),
    (v_brand,6,NULL,NULL,true);

  PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand);
  SELECT service_periods INTO v_sp FROM public.venue_availability_config WHERE brand_id=v_brand;

  -- T1: 6 derived periods, all tagged derived_from_hours.
  IF jsonb_array_length(v_sp) <> 6 THEN
    RAISE EXCEPTION 'T1 FAIL: expected 6 derived periods, got %', jsonb_array_length(v_sp);
  END IF;

  -- T1/T2: Saturday (brand_hours weekday 5) MUST remap to pg-dow 6.
  SELECT e INTO v_sat FROM jsonb_array_elements(v_sp) e WHERE (e->'days'->>0)::int = 6;
  IF v_sat IS NULL THEN
    RAISE EXCEPTION 'T2 FAIL: weekday remap broken — no Saturday (pg-dow 6) period';
  END IF;
  IF (v_sat->>'start') <> '10:00' OR (v_sat->>'end') <> '14:00' THEN
    RAISE EXCEPTION 'T1 FAIL: Saturday times wrong: %', v_sat;
  END IF;
  IF (v_sat->>'type') <> 'derived_from_hours' THEN
    RAISE EXCEPTION 'T1 FAIL: Saturday missing derived_from_hours provenance';
  END IF;

  -- T1: Sunday (brand_hours weekday 6, pg-dow 0) is closed → absent.
  SELECT e INTO v_sun FROM jsonb_array_elements(v_sp) e WHERE (e->'days'->>0)::int = 0;
  IF v_sun IS NOT NULL THEN
    RAISE EXCEPTION 'T1 FAIL: closed Sunday (pg-dow 0) must be absent, got %', v_sun;
  END IF;
  RAISE NOTICE 'T1/T2 PASS: 6 periods, Sat->pg-dow 6 (10:00-14:00), Sun absent (remap correct)';

  -- T3 (edit bridge): change Mon to 08:00–16:00, re-derive.
  UPDATE public.brand_hours SET open_time='08:00', close_time='16:00'
  WHERE brand_id=v_brand AND weekday=0;
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand);
  SELECT service_periods INTO v_sp FROM public.venue_availability_config WHERE brand_id=v_brand;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_sp) e
    WHERE (e->'days'->>0)::int = 1 AND e->>'start'='08:00' AND e->>'end'='16:00'
  ) THEN
    RAISE EXCEPTION 'T3 FAIL: Monday (pg-dow 1) not re-derived to 08:00-16:00';
  END IF;
  RAISE NOTICE 'T3 PASS: edit re-derives Monday';

  -- T5 (idempotent): re-run with unchanged hours → updated_at unchanged.
  SELECT updated_at INTO v_updated_1 FROM public.venue_availability_config WHERE brand_id=v_brand;
  PERFORM pg_sleep(0.05);
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand);
  SELECT updated_at INTO v_updated_2 FROM public.venue_availability_config WHERE brand_id=v_brand;
  IF v_updated_1 IS DISTINCT FROM v_updated_2 THEN
    RAISE EXCEPTION 'T5 FAIL: idempotent re-run bumped updated_at (% -> %)', v_updated_1, v_updated_2;
  END IF;
  RAISE NOTICE 'T5 PASS: idempotent (updated_at unchanged on no-op re-run)';

  -- T4 (non-clobber): operator-authored period (no type) survives a helper call.
  UPDATE public.venue_availability_config
  SET service_periods = '[{"name":"Dinner","days":[5],"start":"18:00","end":"22:00"}]'::jsonb
  WHERE brand_id=v_brand;
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand);
  SELECT service_periods INTO v_sp FROM public.venue_availability_config WHERE brand_id=v_brand;
  IF jsonb_array_length(v_sp) <> 1 OR (v_sp->0->>'name') <> 'Dinner' THEN
    RAISE EXCEPTION 'T4 FAIL: operator-authored period clobbered: %', v_sp;
  END IF;
  RAISE NOTICE 'T4 PASS: operator-authored periods preserved (non-clobber)';

  -- Force rollback — the probe leaves no surviving data.
  RAISE EXCEPTION 'PROBE_OK_ROLLBACK';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'PROBE_OK_ROLLBACK' THEN
      RAISE NOTICE 'ORCH-1186-A behavioral cycle: ALL PASS (rolled back, no surviving data)';
    ELSE
      RAISE;
    END IF;
END$$;

\echo 'ORCH-1186-A hours single-owner seed probe: ALL PASS'
