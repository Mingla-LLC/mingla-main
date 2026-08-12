\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('18580000-0000-4000-8000-000000000201'),
  ('18580000-0000-4000-8000-000000000202'),
  ('18580000-0000-4000-8000-000000000203'),
  ('18580000-0000-4000-8000-000000000204');
INSERT INTO public.creator_accounts(id,email) VALUES
  ('18580000-0000-4000-8000-000000000201','tester-owner-member-1858@example.test'),
  ('18580000-0000-4000-8000-000000000204','tester-owner-b-1858@example.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at) VALUES
  ('18580000-0000-4000-8000-000000000210','18580000-0000-4000-8000-000000000201','Tester Owned A','issue-1858-tester-a','USD',now(),now()),
  ('18580000-0000-4000-8000-000000000211','18580000-0000-4000-8000-000000000204','Tester Membership B','issue-1858-tester-b','USD',now(),now());
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,removed_at) VALUES
  ('18580000-0000-4000-8000-000000000211','18580000-0000-4000-8000-000000000201','brand_admin',now(),NULL),
  ('18580000-0000-4000-8000-000000000211','18580000-0000-4000-8000-000000000202','brand_admin',now(),now());

DO $test$
DECLARE
  v_job uuid;
  v_before_jobs bigint;
  v_before_audits bigint;
  v_request uuid := '18580000-0000-4000-8000-000000000250';
  v_actor uuid;
  v_target uuid;
BEGIN
  IF to_regprocedure('public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)') IS NOT NULL
     OR to_regprocedure('public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'T-1858-ADV-01 brandless overload resurrected';
  END IF;

  -- The actor owns A but reaches B only through an accepted rank-50 membership.
  -- Exact targeting must win over every ownership fallback.
  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000201',true);
  v_job := (public.biz_export_brand_people(
    'brand_book',NULL,'all',NULL,'action_priority','{}',v_request,
    '18580000-0000-4000-8000-000000000211'
  )->>'jobId')::uuid;
  IF (SELECT brand_id FROM public.brand_people_export_jobs WHERE id=v_job)
       <> '18580000-0000-4000-8000-000000000211'::uuid THEN
    RAISE EXCEPTION 'T-1858-ADV-02 owned-brand fallback overrode membership target';
  END IF;

  SELECT count(*) INTO v_before_jobs FROM public.brand_people_export_jobs;
  SELECT count(*) INTO v_before_audits FROM public.brand_people_export_audit;

  -- Removed member and unrelated actor must receive the same non-enumerating
  -- failure for a known brand; an unknown brand must be indistinguishable.
  FOR v_actor,v_target IN
    SELECT * FROM (VALUES
      ('18580000-0000-4000-8000-000000000202'::uuid,'18580000-0000-4000-8000-000000000211'::uuid),
      ('18580000-0000-4000-8000-000000000203'::uuid,'18580000-0000-4000-8000-000000000211'::uuid),
      ('18580000-0000-4000-8000-000000000203'::uuid,'18580000-0000-4000-8000-000000000299'::uuid)
    ) AS denied(actor_id,target_id)
  LOOP
    PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
    BEGIN
      PERFORM public.biz_export_brand_people(
        'brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),v_target
      );
      RAISE EXCEPTION 'T-1858-ADV-03 forbidden request unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE <> '42501' OR SQLERRM <> 'brand_people_export_forbidden' THEN
        RAISE EXCEPTION 'T-1858-ADV-03 denial leaked target state: % %',SQLSTATE,SQLERRM;
      END IF;
    END;
  END LOOP;

  IF (SELECT count(*) FROM public.brand_people_export_jobs) <> v_before_jobs
     OR (SELECT count(*) FROM public.brand_people_export_audit) <> v_before_audits THEN
    RAISE EXCEPTION 'T-1858-ADV-04 forbidden requests mutated jobs or audits';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_1858_explicit_brand_export.tester.adversarial: PASS' AS result;
