BEGIN;

INSERT INTO auth.users (id) VALUES
  ('27940000-0000-4000-8000-000000000101'),
  ('27940000-0000-4000-8000-000000000102');
INSERT INTO public.brands (id, account_id, name, slug)
VALUES ('27940000-0000-4000-8000-000000000110', '27940000-0000-4000-8000-000000000101', 'Recent Adversarial', 'recent-adversarial');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000102', true);

DO $test$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000110');
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'non-member could list Recent'; END IF;

  denied := false;
  BEGIN
    PERFORM public.biz_hydrate_recent_entities(
      '27940000-0000-4000-8000-000000000110', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN denied := SQLERRM = 'recent_brand_forbidden'; END;
  IF NOT denied THEN RAISE EXCEPTION 'non-member could hydrate Recent'; END IF;

  denied := false;
  BEGIN EXECUTE 'SELECT count(*) FROM public.business_recent_entity_opens';
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'authenticated direct table read was allowed'; END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.biz_hydrate_recent_entities(uuid,jsonb)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'hydrate is not security definer';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.biz_hydrate_recent_entities(uuid,jsonb)'::regprocedure)
       <> ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'hydrate search_path is not pinned';
  END IF;
  IF has_function_privilege('anon', 'public.biz_hydrate_recent_entities(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute hydrate';
  END IF;
END;
$test$;

RESET ROLE;
DO $catalog$
DECLARE fn regprocedure;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.business_recent_entity_opens'::regclass) THEN
    RAISE EXCEPTION 'Recent table RLS is not enabled and forced';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.business_recent_entity_opens'::regclass AND contype = 'u') <> 2 THEN
    RAISE EXCEPTION 'Recent uniqueness constraints drifted';
  END IF;
  IF to_regclass('public.business_recent_scope_order_idx') IS NULL THEN
    RAISE EXCEPTION 'Recent ordering index is missing';
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid)'::regprocedure,
    'public.biz_list_recent_entity_index(uuid)'::regprocedure,
    'public.biz_hydrate_recent_entities(uuid,jsonb)'::regprocedure
  ] LOOP
    IF NOT (SELECT prosecdef AND pg_get_userbyid(proowner) = 'postgres' AND proconfig = ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc WHERE oid = fn) THEN
      RAISE EXCEPTION 'Recent RPC owner/mode/search_path drifted: %', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') OR NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Recent RPC grants drifted: %', fn;
    END IF;
  END LOOP;
END;
$catalog$;

DO $terminal$
BEGIN
  IF has_table_privilege('authenticated', 'public.business_recent_entity_opens', 'SELECT') THEN
    RAISE EXCEPTION 'issue_2794_terminal_direct_table_denial';
  END IF;
END;
$terminal$;

ROLLBACK;
