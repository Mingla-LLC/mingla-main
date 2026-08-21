\set ON_ERROR_STOP on
BEGIN;

DO $tester$
DECLARE
  v_owner uuid := '2395a000-0000-4000-8000-000000000001';
  v_manager uuid := '2395a000-0000-4000-8000-000000000002';
  v_scanner uuid := '2395a000-0000-4000-8000-000000000003';
  v_rejected uuid := '2395a000-0000-4000-8000-000000000004';
  v_other_owner uuid := '2395a000-0000-4000-8000-000000000005';
  v_brand uuid := '2395a000-0000-4000-8000-000000000010';
  v_other_brand uuid := '2395a000-0000-4000-8000-000000000011';
  v_group uuid := '2395a000-0000-4000-8000-000000000020';
  v_other_group uuid := '2395a000-0000-4000-8000-000000000021';
  v_campaign uuid := '2395a000-0000-4000-8000-000000000030';
  v_request uuid := '2395a000-0000-4000-8000-000000000040';
  v_result jsonb;
  v_failures text[] := '{}';
  v_before bigint;
BEGIN
  INSERT INTO auth.users(id) VALUES
    (v_owner), (v_manager), (v_scanner), (v_rejected), (v_other_owner);
  INSERT INTO public.creator_accounts(id) VALUES
    (v_owner), (v_manager), (v_scanner), (v_rejected), (v_other_owner);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
    (v_brand,v_owner,'Issue 2395 Tester Brand','issue-2395-tester-brand','USD'),
    (v_other_brand,v_other_owner,'Issue 2395 Tester Other','issue-2395-tester-other','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_manager,'marketing_manager',clock_timestamp()),
    (v_brand,v_scanner,'scanner',clock_timestamp());
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_rejected,'marketing_manager',NULL);
  UPDATE public.feature_flags SET is_enabled=true
    WHERE flag_key IN ('manual_contact_groups_v1','brand_book_blast_v1','contact_import_v1');

  INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition,is_system_generated,created_by)
  VALUES
    (v_group,v_owner,v_brand,'Private Manual group','{"kind":"manual_group"}',false,v_owner),
    (v_other_group,v_other_owner,v_other_brand,'Other private group','{"kind":"manual_group"}',false,v_other_owner);
  INSERT INTO public.brand_people(id,brand_id,display_name)
  SELECT ('2395a000-0000-4000-8001-'||lpad(to_hex(g),12,'0'))::uuid,
         v_brand,
         'Paged person '||g
  FROM generate_series(1,51) g;
  INSERT INTO public.marketing_manual_group_memberships(brand_id,audience_id,brand_person_id,source,created_by)
  SELECT v_brand,v_group,p.id,'book_picker',v_owner
  FROM public.brand_people p
  WHERE p.brand_id=v_brand;

  -- Lower, rejected and anonymous callers fail before a group identifier can
  -- reveal whether the object exists.
  PERFORM set_config('request.jwt.claim.sub',v_scanner::text,true);
  BEGIN
    PERFORM public.biz_get_manual_group_v1(v_brand,v_group,NULL,NULL,1);
    v_failures:=array_append(v_failures,'accepted rank-10 caller read Manual detail');
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_rejected::text,true);
  BEGIN
    PERFORM public.biz_list_people_manual_groups_v1(v_brand);
    v_failures:=array_append(v_failures,'rejected rank-20 caller listed Manual groups');
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.biz_list_people_manual_groups_v1(v_brand);
    v_failures:=array_append(v_failures,'anonymous caller listed Manual groups');
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- A valid manager in one brand gets the same not-found posture for a real
  -- foreign UUID as for a random UUID.
  PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
  BEGIN
    PERFORM public.biz_get_manual_group_v1(v_brand,v_other_group,NULL,NULL,1);
    v_failures:=array_append(v_failures,'cross-brand group UUID revealed detail');
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  -- The exact RPC is paged. A one-row page must not smuggle every member ID
  -- into an unbounded side channel.
  v_result:=public.biz_get_manual_group_v1(v_brand,v_group,NULL,NULL,1);
  IF v_result ? 'allMemberIds' THEN
    v_failures:=array_append(v_failures,'paged detail returned unbounded allMemberIds');
  END IF;
  IF jsonb_array_length(v_result->'members')<>1 OR v_result->'nextCursor' IS NULL THEN
    v_failures:=array_append(v_failures,'large group did not honor one-row cursor page');
  END IF;

  -- A changed request under the same id is tampering, not a second mutation.
  v_result:=public.biz_create_manual_group_v1(v_brand,'Idempotent group','{}','{}',v_request);
  BEGIN
    PERFORM public.biz_create_manual_group_v1(v_brand,'Changed intent','{}','{}',v_request);
    v_failures:=array_append(v_failures,'changed request reused an immutable receipt');
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%manual_group_idempotency_conflict%' THEN
      v_failures:=array_append(v_failures,'changed request returned the wrong safe conflict');
    END IF;
  END;

  -- Permission loss must gate existing-result replay even when the caller is
  -- the campaign account_id. Otherwise the edge returns the sealed result
  -- before the live rank check runs.
  INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status)
  VALUES(v_campaign,v_rejected,v_brand,v_group,'Permission-loss replay','email',
    '{"kind":"email","subject":"Hello","body_html":"Hi","body_text":"Hi"}','draft');
  BEGIN
    PERFORM public.biz_marketing_book_existing_result_v1(
      v_rejected,v_campaign,'2395a000-0000-4000-8000-000000000041',repeat('a',64),
      clock_timestamp(),NULL,NULL,NULL);
    v_failures:=array_append(v_failures,'campaign account owner bypassed Manual rank on replay');
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Person deletion ends active memberships once and advances the group
  -- version without deleting the person row or group.
  SELECT membership_version INTO v_before FROM public.marketing_audiences WHERE id=v_group;
  UPDATE public.brand_people SET record_status='deleted',deleted_at=clock_timestamp()
    WHERE id='2395a000-0000-4000-8001-000000000001';
  IF EXISTS(
    SELECT 1 FROM public.marketing_manual_group_memberships
    WHERE audience_id=v_group
      AND brand_person_id='2395a000-0000-4000-8001-000000000001'
      AND state='active'
  ) OR (SELECT membership_version FROM public.marketing_audiences WHERE id=v_group)<>v_before+1 THEN
    v_failures:=array_append(v_failures,'person deletion left active membership or wrong version');
  END IF;

  UPDATE public.feature_flags SET is_enabled=false WHERE flag_key='manual_contact_groups_v1';
  BEGIN
    PERFORM public.biz_create_manual_group_v1(
      v_brand,'Feature-off mutation','{}','{}','2395a000-0000-4000-8000-000000000042');
    v_failures:=array_append(v_failures,'feature-off Manual mutation succeeded');
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  IF cardinality(v_failures)>0 THEN
    RAISE EXCEPTION 'issue #2395 tester failures: %',array_to_string(v_failures,'; ');
  END IF;
END $tester$;

ROLLBACK;
