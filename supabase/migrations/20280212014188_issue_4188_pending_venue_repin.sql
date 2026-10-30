-- #4188 — advance #2099's pending-venue dependency seal over Stay operations.
--
-- Stay reservation groups, quotes, links, Rooms and Places deliberately add
-- venue_id lanes. They remain disallowed dependencies for a pending-venue
-- identity correction; this migration only advances the reviewed schema pin
-- so an empty Stay lane does not strand every otherwise-safe correction.
--
BEGIN;

DO $issue_4188_pending_venue_repin$
DECLARE
  v_expected_live constant text := '91042e6f4a170c709d016d9a598d0faea36b280486bf634226a24cbbae34d415';
  v_2855_pin constant text := '(''52f4624c994529d2e63b8f70b79a3fcf'' || ''e28f3ff90dafe300bc45439e37cd2921'')';
  v_3872_pin constant text := '(''474371dd0c8edfdd734c8ef5fe78b167'' || ''bf5422e95b37493111c9a6cdc40213f2'')';
  v_new_pin constant text := '(''91042e6f4a170c709d016d9a598d0fae'' || ''a36b280486bf634226a24cbbae34d415'')';
  v_function_prefix constant text := 'CREATE OR REPLACE FUNCTION ';
  v_oid regprocedure;
  v_definition text;
  v_2855_count integer;
  v_3872_count integer;
  v_new_count integer;
  v_live text;
BEGIN
  v_live := public.issue_2099_pending_venue_dependency_inventory(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ) ->> 'schema_fingerprint';
  IF v_live IS DISTINCT FROM v_expected_live THEN
    RAISE EXCEPTION 'issue_4188_pending_venue_schema_unreviewed:%', v_live;
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    'public.preview_pending_venue_identity_correction(uuid)'::regprocedure,
    'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_2855_count := (length(v_definition)-length(replace(v_definition,v_2855_pin,'')))/length(v_2855_pin);
    v_3872_count := (length(v_definition)-length(replace(v_definition,v_3872_pin,'')))/length(v_3872_pin);
    v_new_count := (length(v_definition)-length(replace(v_definition,v_new_pin,'')))/length(v_new_pin);
    IF v_new_count=0 AND v_2855_count+v_3872_count=1 THEN
      IF left(v_definition,length(v_function_prefix))<>v_function_prefix THEN
        RAISE EXCEPTION 'issue_4188_pending_venue_rpc_definition_unreviewed:%',v_oid;
      END IF;
      v_definition := replace(v_definition,v_2855_pin,v_new_pin);
      v_definition := replace(v_definition,v_3872_pin,v_new_pin);
      EXECUTE pg_catalog.format(
        'CREATE OR REPLACE FUNCTION %s',
        substr(v_definition,length(v_function_prefix)+1)
      );
    ELSIF NOT (
      v_new_count=1 AND v_2855_count=0 AND v_3872_count=0
    ) THEN
      RAISE EXCEPTION
        'issue_4188_pending_venue_rpc_unreviewed:%:2855=%:3872=%:new=%',
        v_oid,v_2855_count,v_3872_count,v_new_count;
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
    RAISE EXCEPTION 'issue_4188_pending_venue_rpc_security_drift';
  END IF;
END;
$issue_4188_pending_venue_repin$;

COMMIT;
