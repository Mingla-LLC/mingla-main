-- #4490 guest list — advance #2099's pending-venue dependency seal over the
-- guest list lanes.
--
-- 20281203394490 adds venue_guest_list_terms, venue_guest_list_promoters and
-- venue_guest_list_entries (venue_id lanes). It was the only #4490 migration
-- after the P2 repin (20281203104490) to change the dependency schema, and it
-- did not re-pin, so a pending-venue identity correction refused every venue
-- with DEPENDENCY_SCHEMA_CHANGED. The new lanes remain DISALLOWED
-- dependencies, like the P1 and P2 lanes: a pending venue with a guest list
-- is corrected by hand (fail closed, the #2855 rule).
--
-- This file is the current pin owner. It carries the P1 owner's rewrites
-- (nine venue types, Google place-type mapping) so the #2099 workflow's D4
-- step can replay the original, #2855 and this file alone and reach the same
-- definitions. Idempotent; each rewrite replaces only text it finds and
-- refuses any definition it does not recognise.
--
BEGIN;

DO $issue_4490_guest_list_pending_venue_repin$
DECLARE
  -- One reviewed value, measured 2026-11-21 on a clean replay of every
  -- branch migration in filename order through the #4490 series (and again
  -- after the later files): the Supabase CLI local stack and the bare
  -- supabase/postgres:17.4.1.075 batch image read the same value.
  v_expected constant text := 'ab750f8323008afae8076dedc3a30de0357431d945a9a65662d534b4b6ce755f';
  v_old_pins constant text[] := ARRAY[
    '(''52f4624c994529d2e63b8f70b79a3fcf'' || ''e28f3ff90dafe300bc45439e37cd2921'')',
    '(''91042e6f4a170c709d016d9a598d0fae'' || ''a36b280486bf634226a24cbbae34d415'')',
    '(''0b2f6691528759d391240f966a45b350'' || ''ef523b38eaa40598f6a0ab99fc149711'')',
    '(''957efbc24ad78cc3ae5e0d5bf79162c8'' || ''caa6b36c39d215721dde27b47d07a47a'')',
    '(''605e626794ad2ae7b563567192151360'' || ''0ee5edc8efd1cd1376482a4ed728c0d2'')',
    '(''e52c7f88bca9e64e6b70b426f4bd2933'' || ''02f34f7b7b55d1acf9bf996a1dcacb37'')'
  ];
  v_old_category_check constant text :=
    'IF p_new_category NOT IN (''restaurant'',''play'',''creative_and_arts'',''stay'') THEN';
  v_new_category_check constant text :=
    'IF p_new_category NOT IN (''restaurant'',''play'',''creative_and_arts'',''stay'',''bar_lounge'',''club'',''cafe'',''event_space'',''coworking'') THEN';
  v_old_type_case constant text :=
    'WHEN ''creative_and_arts'' THEN ''art_gallery'' ELSE ''lodging'' END,';
  v_new_type_case constant text :=
    'WHEN ''creative_and_arts'' THEN ''art_gallery'' WHEN ''bar_lounge'' THEN ''bar'' WHEN ''club'' THEN ''night_club'' WHEN ''cafe'' THEN ''cafe'' WHEN ''event_space'' THEN ''event_venue'' WHEN ''coworking'' THEN ''coworking_space'' ELSE ''lodging'' END,';
  v_old_types_case constant text :=
    'WHEN ''creative_and_arts'' THEN ARRAY[''art_gallery'',''point_of_interest''] ELSE ARRAY[''lodging'',''point_of_interest'',''establishment''] END';
  v_new_types_case constant text :=
    'WHEN ''creative_and_arts'' THEN ARRAY[''art_gallery'',''point_of_interest''] WHEN ''bar_lounge'' THEN ARRAY[''bar'',''point_of_interest''] WHEN ''club'' THEN ARRAY[''night_club'',''point_of_interest''] WHEN ''cafe'' THEN ARRAY[''cafe'',''food'',''point_of_interest''] WHEN ''event_space'' THEN ARRAY[''event_venue'',''point_of_interest''] WHEN ''coworking'' THEN ARRAY[''coworking_space'',''point_of_interest''] ELSE ARRAY[''lodging'',''point_of_interest'',''establishment''] END';
  v_function_prefix constant text := 'CREATE OR REPLACE FUNCTION ';
  v_oid regprocedure;
  v_definition text;
  v_rewritten text;
  v_old_count integer;
  v_new_count integer;
  v_pin text;
  v_live text;
  v_new_pin text;
  v_is_correction boolean;
BEGIN
  v_live := public.issue_2099_pending_venue_dependency_inventory(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ) ->> 'schema_fingerprint';
  IF v_live IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'issue_4490_pending_venue_schema_unreviewed:%', v_live;
  END IF;
  v_new_pin := pg_catalog.format('(''%s'' || ''%s'')', left(v_live, 32), substr(v_live, 33));

  FOREACH v_oid IN ARRAY ARRAY[
    'public.preview_pending_venue_identity_correction(uuid)'::regprocedure,
    'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure
  ] LOOP
    v_is_correction := v_oid = 'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure;
    SELECT pg_get_functiondef(v_oid) INTO v_definition;
    IF left(v_definition, length(v_function_prefix)) <> v_function_prefix THEN
      RAISE EXCEPTION 'issue_4490_pending_venue_rpc_definition_unreviewed:%', v_oid;
    END IF;
    v_rewritten := v_definition;

    -- The pin: exactly one known pin (old or new) must be present.
    v_old_count := 0;
    FOREACH v_pin IN ARRAY v_old_pins LOOP
      v_old_count := v_old_count + (length(v_rewritten) - length(replace(v_rewritten, v_pin, ''))) / length(v_pin);
      v_rewritten := replace(v_rewritten, v_pin, v_new_pin);
    END LOOP;
    v_new_count := (length(v_definition) - length(replace(v_definition, v_new_pin, ''))) / length(v_new_pin);
    IF v_old_count + v_new_count <> 1 THEN
      RAISE EXCEPTION 'issue_4490_pending_venue_rpc_unreviewed:%:old=%:new=%', v_oid, v_old_count, v_new_count;
    END IF;

    -- The nine venue types (correction only): each old fragment exactly once,
    -- or the new fragment exactly once.
    IF v_is_correction THEN
      IF strpos(v_rewritten, v_old_category_check) > 0 THEN
        v_rewritten := replace(v_rewritten, v_old_category_check, v_new_category_check);
      ELSIF strpos(v_rewritten, v_new_category_check) = 0 THEN
        RAISE EXCEPTION 'issue_4490_pending_venue_category_check_unreviewed';
      END IF;
      IF strpos(v_rewritten, v_old_type_case) > 0 THEN
        v_rewritten := replace(v_rewritten, v_old_type_case, v_new_type_case);
      ELSIF strpos(v_rewritten, v_new_type_case) = 0 THEN
        RAISE EXCEPTION 'issue_4490_pending_venue_type_case_unreviewed';
      END IF;
      IF strpos(v_rewritten, v_old_types_case) > 0 THEN
        v_rewritten := replace(v_rewritten, v_old_types_case, v_new_types_case);
      ELSIF strpos(v_rewritten, v_new_types_case) = 0 THEN
        RAISE EXCEPTION 'issue_4490_pending_venue_types_case_unreviewed';
      END IF;
    END IF;

    IF v_rewritten <> v_definition THEN
      EXECUTE pg_catalog.format(
        'CREATE OR REPLACE FUNCTION %s',
        substr(v_rewritten, length(v_function_prefix) + 1)
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid = p.proowner
    WHERE p.oid IN (
      'public.preview_pending_venue_identity_correction(uuid)'::regprocedure,
      'public.correct_pending_venue_identity(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text,text,uuid,text,text,text,uuid)'::regprocedure
    ) AND (
      owner.rolname <> 'postgres' OR NOT p.prosecdef
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
  ) THEN
    RAISE EXCEPTION 'issue_4490_pending_venue_rpc_security_drift';
  END IF;
END;
$issue_4490_guest_list_pending_venue_repin$;

COMMIT;

-- Reverse (local use only): re-apply 20281203104490_issue_4490_p2_pending_venue_repin.sql
-- after dropping the #4490 guest list lanes.
