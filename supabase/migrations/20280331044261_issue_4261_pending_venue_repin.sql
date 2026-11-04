-- #4261 — advance #2099's pending-venue dependency seal over group-chat plans.
--
-- chat_plans.place_pool_id (20280331014261) and
-- chat_plan_place_options.place_pool_id (20280331024261) deliberately add
-- place_pool lanes. They remain disallowed dependencies for a pending-venue
-- identity correction (a plan pointing at a pending venue's pool row blocks
-- that venue's correction: fail-closed); this migration only advances the
-- reviewed schema pin, replacing #4188's, so an empty plan lane does not
-- strand every otherwise-safe correction.
--
BEGIN;

DO $issue_4261_pending_venue_repin$
DECLARE
  -- One reviewed value. Measured 2026-11-03 on clean replays of the merged
  -- branch: the Supabase CLI runner (the #2099 workflow), the direct
  -- PostgreSQL 17 batch (the migrations lane) and the CI-batch pre-#1857 and
  -- pre-#2117 template replays all read it. (#4188's second value came from the
  -- filtered pre-#1931 template replay, which now skips this file together
  -- with the plan migrations it reviews.) An unknown planner or dependency
  -- shape must still strand the correction until it is reviewed.
  v_expected constant text := '957efbc24ad78cc3ae5e0d5bf79162c8caa6b36c39d215721dde27b47d07a47a';
  -- The RPCs hold #4188's pin (either runner's value) on a forward replay, and
  -- #2855's forward pin when the 2099 workflow's D4 step re-applies the
  -- original and #2855 before this file.
  v_2855_pin constant text := '(''52f4624c994529d2e63b8f70b79a3fcf'' || ''e28f3ff90dafe300bc45439e37cd2921'')';
  v_4188_supabase_pin constant text := '(''91042e6f4a170c709d016d9a598d0fae'' || ''a36b280486bf634226a24cbbae34d415'')';
  v_4188_pg17_pin constant text := '(''0b2f6691528759d391240f966a45b350'' || ''ef523b38eaa40598f6a0ab99fc149711'')';
  v_function_prefix constant text := 'CREATE OR REPLACE FUNCTION ';
  v_oid regprocedure;
  v_definition text;
  v_2855_count integer;
  v_4188_supabase_count integer;
  v_4188_pg17_count integer;
  v_new_count integer;
  v_live text;
  v_new_pin text;
BEGIN
  v_live := public.issue_2099_pending_venue_dependency_inventory(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ) ->> 'schema_fingerprint';
  IF v_live IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'issue_4261_pending_venue_schema_unreviewed:%', v_live;
  END IF;
  v_new_pin := pg_catalog.format(
    '(''%s'' || ''%s'')',
    left(v_live,32),
    substr(v_live,33)
  );

  FOREACH v_oid IN ARRAY ARRAY[
    'public.preview_pending_venue_identity_correction(uuid)'::regprocedure,
    'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_2855_count := (length(v_definition)-length(replace(v_definition,v_2855_pin,'')))/length(v_2855_pin);
    v_4188_supabase_count := (length(v_definition)-length(replace(v_definition,v_4188_supabase_pin,'')))/length(v_4188_supabase_pin);
    v_4188_pg17_count := (length(v_definition)-length(replace(v_definition,v_4188_pg17_pin,'')))/length(v_4188_pg17_pin);
    v_new_count := (length(v_definition)-length(replace(v_definition,v_new_pin,'')))/length(v_new_pin);
    IF v_new_count=0 AND v_2855_count+v_4188_supabase_count+v_4188_pg17_count=1 THEN
      IF left(v_definition,length(v_function_prefix))<>v_function_prefix THEN
        RAISE EXCEPTION 'issue_4261_pending_venue_rpc_definition_unreviewed:%',v_oid;
      END IF;
      v_definition := replace(v_definition,v_2855_pin,v_new_pin);
      v_definition := replace(v_definition,v_4188_supabase_pin,v_new_pin);
      v_definition := replace(v_definition,v_4188_pg17_pin,v_new_pin);
      EXECUTE pg_catalog.format(
        'CREATE OR REPLACE FUNCTION %s',
        substr(v_definition,length(v_function_prefix)+1)
      );
    ELSIF NOT (
      v_new_count=1 AND v_2855_count=0 AND v_4188_supabase_count=0 AND v_4188_pg17_count=0
    ) THEN
      RAISE EXCEPTION
        'issue_4261_pending_venue_rpc_unreviewed:%:2855=%:4188_supabase=%:4188_pg17=%:new=%',
        v_oid,v_2855_count,v_4188_supabase_count,v_4188_pg17_count,v_new_count;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE p.oid IN (
      'public.preview_pending_venue_identity_correction(uuid)'::regprocedure,
      'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure
    ) AND (
      owner.rolname<>'postgres' OR NOT p.prosecdef
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('service_role',p.oid,'EXECUTE')
      OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    )
  ) THEN
    RAISE EXCEPTION 'issue_4261_pending_venue_rpc_security_drift';
  END IF;
END;
$issue_4261_pending_venue_repin$;

COMMIT;
