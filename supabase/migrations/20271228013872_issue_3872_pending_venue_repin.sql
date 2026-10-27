-- #3872 R4 — advance #2099's pending-venue schema pin over the Local lane.
--
-- local_months.place_id (20271228003872_issue_3872_r4_locals.sql) is a new,
-- deliberate FK lane into place_pool. #2099's inventory keeps it disallowed;
-- this file advances the two correction RPCs over the reviewed schema shape so
-- an empty lane does not strand every correction.
--
-- WHY A FILE OF ITS OWN (load-bearing): the #2099 lane's D4 step replays the
-- historical pin owners (20270418002099, then 20270610002855) on a fully
-- migrated database, and each replay writes the 2027-06 pin back. The current
-- pin owner must be replayed after them or every correction afterwards returns
-- DEPENDENCY_SCHEMA_CHANGED. r4_locals creates tables and cannot be replayed;
-- this block can: it accepts the old pin (rewrites it) or the new pin (no-op)
-- and refuses anything else, and it refuses an unreviewed live schema. A live
-- schema that still equals the 2027-06 pin (no Local lane) is left untouched.
--
-- Invariant I-3872-LOCAL-PENDING-VENUE-FENCE is declared in its test suite
-- (issue_3872_r4_locals.implementor.pg17.test.sql).

BEGIN;

DO $issue_3872_pending_venue_repin$
DECLARE
  v_expected_live constant text := '474371dd0c8edfdd734c8ef5fe78b167bf5422e95b37493111c9a6cdc40213f2';
  v_old_pin constant text := '(''52f4624c994529d2e63b8f70b79a3fcf'' || ''e28f3ff90dafe300bc45439e37cd2921'')';
  v_new_pin constant text := '(''474371dd0c8edfdd734c8ef5fe78b167'' || ''bf5422e95b37493111c9a6cdc40213f2'')';
  v_function_prefix constant text := 'CREATE OR REPLACE FUNCTION ';
  v_oid regprocedure;
  v_definition text;
  v_old_count integer;
  v_new_count integer;
  v_live text;
BEGIN
  v_live := public.issue_2099_pending_venue_dependency_inventory(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ) ->> 'schema_fingerprint';
  -- A database without the Local lane (a deliberately filtered replay that
  -- skips r4_locals) still has exactly the 2027-06 schema: the old pin is
  -- correct there and there is nothing to advance.
  IF v_live = '52f4624c994529d2e63b8f70b79a3fcf' || 'e28f3ff90dafe300bc45439e37cd2921' THEN
    RETURN;
  END IF;
  IF v_live IS DISTINCT FROM v_expected_live THEN
    RAISE EXCEPTION 'issue_3872_pending_venue_schema_unreviewed:%', v_live;
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    'public.preview_pending_venue_identity_correction(uuid)'::regprocedure,
    'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    v_old_count := (length(v_definition)-length(replace(v_definition,v_old_pin,'')))/length(v_old_pin);
    v_new_count := (length(v_definition)-length(replace(v_definition,v_new_pin,'')))/length(v_new_pin);
    IF v_old_count=1 AND v_new_count=0 THEN
      -- pg_get_functiondef is the sole statement source and is sealed to a
      -- CREATE OR REPLACE FUNCTION prefix before the catalog text is reused.
      -- Keeping that prefix literal also lets the public-table RLS gate prove
      -- that this dynamic statement cannot create an unprotected table.
      IF left(v_definition,length(v_function_prefix))<>v_function_prefix THEN
        RAISE EXCEPTION 'issue_3872_pending_venue_rpc_definition_unreviewed:%',v_oid;
      END IF;
      EXECUTE pg_catalog.format(
        'CREATE OR REPLACE FUNCTION %s',
        substr(replace(v_definition,v_old_pin,v_new_pin),length(v_function_prefix)+1)
      );
    ELSIF NOT (v_old_count=0 AND v_new_count=1) THEN
      RAISE EXCEPTION 'issue_3872_pending_venue_rpc_unreviewed:%:old=%:new=%',v_oid,v_old_count,v_new_count;
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
    RAISE EXCEPTION 'issue_3872_pending_venue_rpc_security_drift';
  END IF;
END;
$issue_3872_pending_venue_repin$;

COMMIT;
