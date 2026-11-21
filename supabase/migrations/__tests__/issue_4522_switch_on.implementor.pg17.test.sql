-- MINGLA-INVARIANT: I-4522-11 | issue #4522 | After M5 the server switch issue_4522_plan_v2_enabled() returns true with its M1 attributes and service-role-only grants, and a kill switch that returns false brings back payment_plan_v2_unavailable on every save path.
\set ON_ERROR_STOP on

-- Issue #4522 slice 13 (M5, 20281121014522, switch on). Runs after the full chain, M5 last.
-- Fails if M5 is reverted to `SELECT false`. The kill-switch proof and the
-- drift-guard proof redefine the switch only inside this transaction
-- (rolled back).

BEGIN;

SELECT set_config('request.jwt.claim.sub', '45221300-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('45221300-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('45221300-0000-4000-8000-000000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('45221300-0000-4000-8000-000000000010', '45221300-0000-4000-8000-000000000001',
        'Issue 4522 switch on', 'issue-4522-switch-on', 'USD');

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

CREATE FUNCTION pg_temp.raised(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.v2(p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('payment_plan', jsonb_build_object(
    'v', 2,
    'deposit', jsonb_build_object('mode', 'percent', 'pct', 25),
    'count', 3,
    'final_due_days_before_start', 30,
    'auto_adjust', true,
    'flex', jsonb_build_object('enabled', false),
    'custom_amounts_minor', NULL) || p_extra)
$$;

-- Saves one v2 plan through the draft graph; returns NULL or 'SQLSTATE:message'.
CREATE FUNCTION pg_temp.save_v2(p_key text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE g jsonb; v_event uuid;
BEGIN
  g := public.biz_create_trip_draft('45221300-0000-4000-8000-000000000010',
    jsonb_build_object('title', 'Switch trip ' || p_key),
    ('45221300-0000-4000-8000-0000000000' || p_key || '1')::uuid);
  v_event := (g#>>'{event,id}')::uuid;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', (g#>>'{tiers,0,ticket_type_id}')::uuid, 'price_cents', 120000,
        'tier_metadata', pg_temp.v2()))),
      pg_temp.rev(v_event), ('45221300-0000-4000-8000-0000000000' || p_key || '2')::uuid);
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
  END;
  IF (SELECT t.tier_metadata->'payment_plan' FROM public.trip_pricing_tiers t
       WHERE t.event_id = v_event) IS DISTINCT FROM pg_temp.v2()->'payment_plan' THEN
    RETURN 'saved:plan_not_stored';
  END IF;
  RETURN NULL;
END $$;

-- T-1..T-3: the shipped switch (M5) is on, with M1's attributes and grants.
DO $$
DECLARE p record; v_public boolean;
BEGIN
  IF public.issue_4522_plan_v2_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'T-1 after M5 the v2 switch must return true';
  END IF;
  SELECT provolatile, prosecdef, proconfig, prolang, prorettype, proacl
    INTO p FROM pg_proc WHERE oid = 'public.issue_4522_plan_v2_enabled()'::regprocedure;
  IF p.provolatile <> 's' OR p.prosecdef IS NOT TRUE
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR p.prorettype <> 'boolean'::regtype
     OR p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'sql') THEN
    RAISE EXCEPTION 'T-2 switch attributes drifted: %', row_to_json(p);
  END IF;
  SELECT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) INTO v_public;
  IF p.proacl IS NULL OR v_public
     OR has_function_privilege('anon', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-3 switch grants drifted: %', p.proacl;
  END IF;
  IF obj_description('public.issue_4522_plan_v2_enabled()'::regprocedure, 'pg_proc')
     NOT LIKE '%On since the M5 switch-on migration%' THEN
    RAISE EXCEPTION 'T-3 switch comment was not updated by M5';
  END IF;
END $$;

-- T-4: a v2 plan M1 refused (payment_plan_v2_unavailable) is now accepted by
-- the validator and saved through the draft graph.
DO $$
DECLARE v_raised text;
BEGIN
  v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_installment_schedule(%L::jsonb)', pg_temp.v2()));
  IF v_raised IS NOT NULL THEN
    RAISE EXCEPTION 'T-4 the validator must accept a v2 plan after M5, got %', v_raised;
  END IF;
  v_raised := pg_temp.save_v2('a');
  IF v_raised IS NOT NULL THEN
    RAISE EXCEPTION 'T-4 the draft graph must save a v2 plan after M5, got %', v_raised;
  END IF;
  -- Shape refusals still hold with the switch on.
  v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_installment_schedule(%L::jsonb)',
    pg_temp.v2() || '{"installments":{"deposit_pct":50,"installments":[{"ordinal":1,"pct":50,"days_after_booking":10}]}}'::jsonb));
  IF v_raised IS DISTINCT FROM '22023:payment_plan_shape_conflict' THEN
    RAISE EXCEPTION 'T-4 expected payment_plan_shape_conflict, got %', v_raised;
  END IF;
END $$;

-- T-5: the M5 drift guard, copied verbatim from 20281121014522 (the file wraps
-- itself in BEGIN/COMMIT, so it cannot be \ir'd inside this transaction),
-- passes only over the M1 `SELECT false` body and refuses the shipped (true) body.
CREATE FUNCTION pg_temp.m5_guard() RETURNS text
LANGUAGE plpgsql AS $guard$
BEGIN
  DECLARE r record; v_actual text;
  BEGIN
    FOR r IN SELECT * FROM (VALUES
      ('public.issue_4522_plan_v2_enabled()','c461f1f09b0984ad9135e918dbe65da8')
    ) v(sig,expected_md5) LOOP
      SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
      IF v_actual IS DISTINCT FROM r.expected_md5 THEN
        RAISE EXCEPTION 'issue #4522 M5 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
      END IF;
    END LOOP;
  END;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END $guard$;

DO $$
DECLARE v_raised text;
BEGIN
  v_raised := pg_temp.m5_guard();
  IF v_raised IS NULL OR v_raised NOT LIKE 'P0001:issue #4522 M5 drift: public.issue_4522_plan_v2_enabled()%' THEN
    RAISE EXCEPTION 'T-5 the M5 guard must refuse to re-run over the switched-on body, got %', v_raised;
  END IF;
END $$;

-- T-6 kill switch (this transaction only): a later migration that returns
-- false, written exactly as M1 wrote the switch.
CREATE OR REPLACE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;

DO $$
DECLARE v_raised text;
BEGIN
  IF public.issue_4522_plan_v2_enabled() IS NOT FALSE THEN
    RAISE EXCEPTION 'T-6 kill switch did not take';
  END IF;
  -- The guard accepts exactly the M1 body, so the constant is M1's.
  v_raised := pg_temp.m5_guard();
  IF v_raised IS NOT NULL THEN
    RAISE EXCEPTION 'T-5 the M5 guard must accept the M1 body, got %', v_raised;
  END IF;
  -- CREATE OR REPLACE keeps the grants.
  IF has_function_privilege('anon', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_4522_plan_v2_enabled()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-6 kill switch changed the grants';
  END IF;
  v_raised := pg_temp.raised(format('SELECT public.biz_validate_trip_installment_schedule(%L::jsonb)', pg_temp.v2()));
  IF v_raised IS DISTINCT FROM 'P0001:payment_plan_v2_unavailable' THEN
    RAISE EXCEPTION 'T-6 kill switch: validator expected payment_plan_v2_unavailable, got %', v_raised;
  END IF;
  v_raised := pg_temp.save_v2('b');
  IF v_raised IS DISTINCT FROM 'P0001:payment_plan_v2_unavailable' THEN
    RAISE EXCEPTION 'T-6 kill switch: draft graph expected payment_plan_v2_unavailable, got %', v_raised;
  END IF;
  -- Legacy v1 plans are untouched by the kill switch.
  PERFORM public.biz_validate_trip_installment_schedule(
    '{"installments":{"deposit_pct":50,"installments":[{"ordinal":1,"pct":50,"days_after_booking":10}]}}');
END $$;

ROLLBACK;
