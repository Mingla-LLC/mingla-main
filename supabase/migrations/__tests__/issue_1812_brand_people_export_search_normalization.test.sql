\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '18120000-0000-4000-8000-000000000001';
  v_other uuid := '18120000-0000-4000-8000-000000000002';
  v_brand uuid := '18120000-0000-4000-8000-000000000003';
  v_event uuid := '18120000-0000-4000-8000-000000000004';
  v_book_job uuid;
  v_roster_job uuid;
  v_empty_job uuid;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  VALUES(
    v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'issue-1812-owner@example.test',now(),now()
  );
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_owner,'issue-1812-owner@example.test');
  INSERT INTO public.brands(id,account_id,slug,name,default_currency,created_at,updated_at)
  VALUES(v_brand,v_owner,'issue-1812-brand','Issue 1812 Brand','USD',now(),now());
  INSERT INTO public.events(
    id,brand_id,created_by,event_type,title,slug,description,status,visibility,
    currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,
    created_at,updated_at,theme
  ) VALUES(
    v_event,v_brand,v_owner,'rsvp','Issue 1812 Event','issue-1812-event','fixture',
    'scheduled','private','USD','UTC',ARRAY['house-party'],'auto',false,now(),now(),'{}'::jsonb
  );

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_book_job := (public.biz_export_brand_people(
    'brand_book',NULL,'all',E'  ADA  \t\n LOVELACE  ','name_asc','{}'::jsonb,
    '18120000-0000-4000-8000-000000000010'
  )->>'jobId')::uuid;
  v_roster_job := (public.biz_export_brand_people(
    'offering_guest_roster',v_event,'no_response','  Already Normalized  ','recent_first','{}'::jsonb,
    '18120000-0000-4000-8000-000000000011'
  )->>'jobId')::uuid;
  v_empty_job := (public.biz_export_brand_people(
    'brand_book',NULL,'all',NULL,'action_priority','{}'::jsonb,
    '18120000-0000-4000-8000-000000000012'
  )->>'jobId')::uuid;

  IF (SELECT filter_json->>'search' FROM public.brand_people_export_jobs WHERE id=v_book_job)<>'ada lovelace'
     OR (SELECT filter_json->>'search' FROM public.brand_people_export_jobs WHERE id=v_roster_job)<>'already normalized'
     OR (SELECT filter_json->>'search' FROM public.brand_people_export_jobs WHERE id=v_empty_job)<>'' THEN
    RAISE EXCEPTION 'issue_1812_search_normalization_failed';
  END IF;

  BEGIN
    PERFORM public.biz_export_brand_people(
      'offering_guest_roster',v_event,'invented_filter',NULL,'action_priority','{}'::jsonb,
      '18120000-0000-4000-8000-000000000013'
    );
    RAISE EXCEPTION 'issue_1812_unknown_filter_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.biz_export_brand_people(
      'brand_book',NULL,'all',NULL,'action_priority','{"rawWhere":"true"}'::jsonb,
      '18120000-0000-4000-8000-000000000014'
    );
    RAISE EXCEPTION 'issue_1812_arbitrary_snapshot_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
  BEGIN
    PERFORM public.biz_export_brand_people(
      'offering_guest_roster',v_event,'all',NULL,'action_priority','{}'::jsonb,
      '18120000-0000-4000-8000-000000000015'
    );
    RAISE EXCEPTION 'issue_1812_under_rank_actor_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF has_function_privilege('anon','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_offering_guest_roster_export_rows(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.biz_offering_guest_roster_export_rows(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1812_source_or_grant_boundary_failed';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_1812_brand_people_export_search_normalization: PASS' AS result;
