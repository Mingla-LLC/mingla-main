\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('18580000-0000-4000-8000-000000000001'),
  ('18580000-0000-4000-8000-000000000002'),
  ('18580000-0000-4000-8000-000000000003'),
  ('18580000-0000-4000-8000-000000000004'),
  ('18580000-0000-4000-8000-000000000005'),
  ('18580000-0000-4000-8000-000000000006');
INSERT INTO public.creator_accounts(id,email) VALUES
  ('18580000-0000-4000-8000-000000000001','owner-1858@example.test'),
  ('18580000-0000-4000-8000-000000000004','other-1858@example.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at) VALUES
  ('18580000-0000-4000-8000-000000000010','18580000-0000-4000-8000-000000000001','Brand A','issue-1858-a','USD',now(),now()),
  ('18580000-0000-4000-8000-000000000011','18580000-0000-4000-8000-000000000001','Brand B','issue-1858-b','USD',now(),now()),
  ('18580000-0000-4000-8000-000000000012','18580000-0000-4000-8000-000000000004','Brand C','issue-1858-c','USD',now(),now()),
  ('18580000-0000-4000-8000-000000000013','18580000-0000-4000-8000-000000000001','Deleted Brand','issue-1858-deleted','USD',now(),now());
UPDATE public.brands SET deleted_at=now() WHERE id='18580000-0000-4000-8000-000000000013';
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,removed_at) VALUES
  ('18580000-0000-4000-8000-000000000011','18580000-0000-4000-8000-000000000002','brand_admin',now(),NULL),
  ('18580000-0000-4000-8000-000000000011','18580000-0000-4000-8000-000000000003','event_manager',now(),NULL),
  ('18580000-0000-4000-8000-000000000011','18580000-0000-4000-8000-000000000005','brand_admin',NULL,NULL),
  ('18580000-0000-4000-8000-000000000011','18580000-0000-4000-8000-000000000006','brand_admin',now(),now());
INSERT INTO public.brand_people(id,brand_id,display_name) VALUES
  ('18580000-0000-4000-8000-000000000020','18580000-0000-4000-8000-000000000010','Person A'),
  ('18580000-0000-4000-8000-000000000021','18580000-0000-4000-8000-000000000011','Ada Lovelace');
INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,
  provenance_scope,is_exportable,suppression_eligible,is_primary) VALUES
  ('18580000-0000-4000-8000-000000000030','18580000-0000-4000-8000-000000000010','18580000-0000-4000-8000-000000000020','email','a@example.test','brand_owned',true,true,true),
  ('18580000-0000-4000-8000-000000000031','18580000-0000-4000-8000-000000000011','18580000-0000-4000-8000-000000000021','email','b@example.test','brand_owned',true,true,true);
INSERT INTO public.events(id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at)
VALUES('18580000-0000-4000-8000-000000000040','18580000-0000-4000-8000-000000000011',
  '18580000-0000-4000-8000-000000000001','rsvp','Roster','issue-1858-roster','scheduled','private',
  'USD','UTC','{}','auto',false,'{}',now(),now());
INSERT INTO public.guest_roster_brand_rollouts(brand_id,phase)
VALUES('18580000-0000-4000-8000-000000000011','ga') ON CONFLICT (brand_id) DO UPDATE SET phase='ga';
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='guest_roster_export_enabled';

DO $test$
DECLARE v_a uuid; v_b uuid; v_replay uuid; v_admin uuid; v_roster uuid; v_before bigint;
  v_audit_before bigint; v_rows jsonb; v_status jsonb;
  v_request uuid := '18580000-0000-4000-8000-000000000050';
BEGIN
  IF to_regprocedure('public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)') IS NOT NULL
     OR to_regprocedure('public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid,uuid)') IS NULL
     OR has_function_privilege('anon','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'T-1858-06 signature or ACL drift';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000001',true);
  v_b := (public.biz_export_brand_people('brand_book',NULL,'all',E'  ADA\t\n LOVELACE  ','name_asc','{}',v_request,
    '18580000-0000-4000-8000-000000000011')->>'jobId')::uuid;
  v_replay := (public.biz_export_brand_people('brand_book',NULL,'all',E'  ADA\t\n LOVELACE  ','name_asc','{}',v_request,
    '18580000-0000-4000-8000-000000000011')->>'jobId')::uuid;
  v_a := (public.biz_export_brand_people('brand_book',NULL,'all',NULL,'name_asc','{}',v_request,
    '18580000-0000-4000-8000-000000000010')->>'jobId')::uuid;
  SELECT COALESCE(jsonb_agg(row_data),'[]') INTO v_rows FROM public.biz_brand_people_export_rows(v_b);
  IF v_b<>v_replay OR v_a=v_b
     OR (SELECT brand_id FROM public.brand_people_export_jobs WHERE id=v_b)<>'18580000-0000-4000-8000-000000000011'
     OR (SELECT filter_json->>'search' FROM public.brand_people_export_jobs WHERE id=v_b)<>'ada lovelace'
     OR jsonb_array_length(v_rows)<>1 OR v_rows->0->>'name'<>'Ada Lovelace'
     OR v_rows::text LIKE '%a@example.test%' THEN
    RAISE EXCEPTION 'T-1858-01/07/12/13 exact target, replay, normalization, or provenance isolation failed: %',v_rows;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000002',true);
  v_admin := (public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',
    '18580000-0000-4000-8000-000000000051','18580000-0000-4000-8000-000000000011')->>'jobId')::uuid;
  IF (SELECT brand_id FROM public.brand_people_export_jobs WHERE id=v_admin)<>'18580000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'T-1858-02 membership admin target failed';
  END IF;
  v_status:=public.biz_get_brand_people_export_job(v_admin);
  IF v_status->>'jobId'<>v_admin::text OR v_status->>'status' IS NULL THEN
    RAISE EXCEPTION 'T-1858-11 membership admin status contract failed: %',v_status;
  END IF;

  SELECT count(*) INTO v_before FROM public.brand_people_export_jobs;
  SELECT count(*) INTO v_audit_before FROM public.brand_people_export_audit;
  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000003',true);
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),
      '18580000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'T-1858-03 lower role accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH v_admin IN ARRAY ARRAY[
    '18580000-0000-4000-8000-000000000005'::uuid,
    '18580000-0000-4000-8000-000000000006'::uuid
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
    BEGIN
      PERFORM public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),
        '18580000-0000-4000-8000-000000000011');
      RAISE EXCEPTION 'T-1858-03 invalid membership accepted: %',v_admin;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000004',true);
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),
      '18580000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'T-1858-04 cross-brand actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000001',true);
  FOREACH v_admin IN ARRAY ARRAY[
    '18580000-0000-4000-8000-000000000013'::uuid,
    '18580000-0000-4000-8000-000000000099'::uuid
  ] LOOP
    BEGIN
      PERFORM public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),v_admin);
      RAISE EXCEPTION 'T-1858-04 deleted/unknown brand accepted: %',v_admin;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),
      '18580000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'T-1858-04 anonymous actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public.brand_people_export_jobs)<>v_before
     OR (SELECT count(*) FROM public.brand_people_export_audit)<>v_audit_before THEN
    RAISE EXCEPTION 'T-1858-03/04 forbidden request mutated jobs';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','18580000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book',NULL,'all',NULL,'action_priority','{}',gen_random_uuid(),NULL);
    RAISE EXCEPTION 'T-1858-05 null brand accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book','18580000-0000-4000-8000-000000000040','all',NULL,'action_priority','{}',gen_random_uuid(),
      '18580000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'T-1858-05 brand-book event accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.biz_export_brand_people('offering_guest_roster','18580000-0000-4000-8000-000000000040','all',NULL,'action_priority','{}',gen_random_uuid(),
      '18580000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'T-1858-05 roster brand accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM public.brand_people_export_jobs)<>v_before
     OR (SELECT count(*) FROM public.brand_people_export_audit)<>v_audit_before THEN
    RAISE EXCEPTION 'T-1858-05 invalid shape mutated jobs/audit';
  END IF;
  v_roster := (public.biz_export_brand_people('offering_guest_roster','18580000-0000-4000-8000-000000000040',
    'all',NULL,'action_priority','{}','18580000-0000-4000-8000-000000000052')->>'jobId')::uuid;
  IF (SELECT brand_id FROM public.brand_people_export_jobs WHERE id=v_roster)<>'18580000-0000-4000-8000-000000000011' THEN
    RAISE EXCEPTION 'T-1858-08 seven-positional roster compatibility failed';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_1858_explicit_brand_export: PASS' AS result;
