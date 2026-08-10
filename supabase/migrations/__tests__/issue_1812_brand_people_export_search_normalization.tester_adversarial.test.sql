\set ON_ERROR_STOP on
BEGIN;

-- Independent tester guard: normalization is part of the idempotency identity,
-- not only a display cleanup. Whitespace-equivalent requests must reuse one job,
-- while a genuinely different normalized search must still reject key reuse.
DO $test$
DECLARE
  v_owner uuid := '18120100-0000-4000-8000-000000000001';
  v_brand uuid := '18120100-0000-4000-8000-000000000002';
  v_request uuid := '18120100-0000-4000-8000-000000000003';
  v_first_job uuid;
  v_replay_job uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES(
    v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'issue-1812-tester-owner@example.test',now(),now()
  );
  INSERT INTO public.creator_accounts(id,created_at) VALUES(v_owner,now());
  INSERT INTO public.brands(id,account_id,slug,name,default_currency,created_at,updated_at)
  VALUES(v_brand,v_owner,'issue-1812-tester-brand','Issue 1812 Tester Brand','USD',now(),now());

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  v_first_job := (public.biz_export_brand_people(
    'brand_book',NULL,'all',E'  Grace\r\n\f Hopper  ','name_asc','{}'::jsonb,v_request
  )->>'jobId')::uuid;
  v_replay_job := (public.biz_export_brand_people(
    'brand_book',NULL,'all','grace hopper','name_asc','{}'::jsonb,v_request
  )->>'jobId')::uuid;

  IF v_first_job IS DISTINCT FROM v_replay_job
     OR (SELECT count(*) FROM public.brand_people_export_jobs
         WHERE brand_id=v_brand AND client_request_id=v_request)<>1
     OR (SELECT filter_json->>'search' FROM public.brand_people_export_jobs WHERE id=v_first_job)<>'grace hopper' THEN
    RAISE EXCEPTION 'issue_1812_whitespace_equivalent_replay_diverged';
  END IF;

  BEGIN
    PERFORM public.biz_export_brand_people(
      'brand_book',NULL,'all','grace m hopper','name_asc','{}'::jsonb,v_request
    );
    RAISE EXCEPTION 'issue_1812_distinct_search_reused_idempotency_key';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  IF (SELECT count(*) FROM public.brand_people_export_jobs
      WHERE brand_id=v_brand AND client_request_id=v_request)<>1 THEN
    RAISE EXCEPTION 'issue_1812_failed_replay_mutated_job_count';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_1812_brand_people_export_search_normalization_tester_adversarial: PASS' AS result;
