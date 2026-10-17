-- #3720 Completion Wave 4 — independent privacy and authority proof.
\set ON_ERROR_STOP on
BEGIN;
DO $proof$
DECLARE
  v_outsider constant uuid := '37200000-0000-4000-8000-000000000499';
  v_denied boolean:=false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_outsider,'wave4-adversary@test.local');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  BEGIN
    PERFORM public.issue_3720_queue_product_avengers_command(gen_random_uuid(),'search','{}'::jsonb,gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'outsider_queued_github_command'; END IF;
  IF has_table_privilege('anon','public.product_avengers_reviews','SELECT')
     OR has_table_privilege('authenticated','public.product_avengers_commands','INSERT')
     OR has_table_privilege('authenticated','public.product_avengers_items','UPDATE') THEN
    RAISE EXCEPTION 'bridge_relation_acl_open';
  END IF;
  IF has_function_privilege('anon','public.issue_3720_queue_product_avengers_command(uuid,text,jsonb,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_claim_product_avengers_command(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_apply_product_avengers_snapshot(uuid,uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'bridge_function_acl_open';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'issue_3720_%' AND p.prosrc ILIKE '%api.github.com%') THEN
    RAISE EXCEPTION 'database_function_contains_github_transport';
  END IF;
  IF (SELECT count(*) FROM information_schema.table_privileges
      WHERE grantee='authenticated' AND table_schema='public'
        AND table_name LIKE 'product_avengers%' AND privilege_type IN ('INSERT','UPDATE','DELETE'))<>0 THEN
    RAISE EXCEPTION 'authenticated_direct_mutation_grant_found';
  END IF;
END;
$proof$;
ROLLBACK;
