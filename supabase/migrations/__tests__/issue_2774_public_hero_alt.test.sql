\set ON_ERROR_STOP on

-- Issue #2774 implementor contract: all four canonical anonymous offering RPCs
-- expose exactly one root coverMediaAlt key sourced from events.cover_media_alt.
-- Existing execution grants and pinned search paths remain intact.
DO $test$
DECLARE
  v_name text;
  v_definition text;
  v_cover_key_count integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'pg_public_event_by_slug',
    'pg_public_rsvp_by_slug',
    'pg_public_trip_by_slug',
    'pg_public_experience_by_slug'
  ] LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO v_definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = v_name
       AND pg_get_function_identity_arguments(p.oid) IN (
         'p_brand_slug text, p_event_slug text',
         'p_brand_slug text, p_experience_slug text'
       );

    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'issue_2774_missing_rpc_%', v_name;
    END IF;
    SELECT count(*) INTO v_cover_key_count
      FROM regexp_matches(v_definition, '''coverMediaAlt''', 'g');
    IF v_cover_key_count <> 1 THEN
      RAISE EXCEPTION 'issue_2774_%_coverMediaAlt_count_%', v_name, v_cover_key_count;
    END IF;
    IF position('cover_media_alt' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'issue_2774_%_missing_source_column', v_name;
    END IF;
    IF position('SECURITY DEFINER' IN v_definition) = 0 OR
       position('SET search_path' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'issue_2774_%_security_contract_drift', v_name;
    END IF;
    IF NOT has_function_privilege('anon', format('public.%I(text,text)', v_name), 'EXECUTE') THEN
      RAISE EXCEPTION 'issue_2774_%_anon_execute_missing', v_name;
    END IF;
  END LOOP;
END
$test$;

SELECT 'issue_2774_public_hero_alt: PASS' AS result;
