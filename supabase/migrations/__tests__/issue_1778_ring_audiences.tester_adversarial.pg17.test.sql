\set ON_ERROR_STOP on
BEGIN;

DO $adversarial$
DECLARE
  v_actor uuid:='17780000-0000-4000-8000-000000000101';
  v_member uuid:='17780000-0000-4000-8000-000000000102';
  v_outsider uuid:='17780000-0000-4000-8000-000000000103';
  v_brand uuid:='17780000-0000-4000-8000-000000000110';
  v_audience uuid:='17780000-1000-4000-8000-000000000101';
  v_campaign uuid:='17780000-2000-4000-8000-000000000101';
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id) VALUES(v_actor),(v_member),(v_outsider);
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_actor,'owner-adversarial-1778@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
  VALUES(v_brand,v_actor,'Issue 1778 Adversarial','issue-1778-adversarial','USD',now(),now());
  INSERT INTO public.profiles(
    id,first_name,last_name,display_name,username,active,
    has_completed_onboarding,visibility_mode
  ) VALUES(v_member,'Private','Follower','Ignored','private-1778',true,true,'friends');

  -- Exact JSON prevents a client from smuggling filters or another brand.
  v_failed:=false;
  BEGIN
    INSERT INTO public.marketing_audiences(
      account_id,brand_id,name,query_definition,is_system_generated
    ) VALUES(
      v_actor,v_brand,'Malformed',jsonb_build_object(
        'kind','brand_followers','brand_id',v_brand::text,'email','stolen@example.test'
      ),true
    );
  EXCEPTION WHEN check_violation THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#1778 accepted a malformed ring audience'; END IF;

  -- Only a current marketing manager for this brand may create the row.
  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  v_failed:=false;
  BEGIN
    PERFORM public.biz_get_or_create_marketing_circle_audience_v1(
      v_outsider,v_brand,'brand_followers'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed:=SQLERRM LIKE '%circle_blast_forbidden%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '#1778 outsider created a ring audience'; END IF;

  INSERT INTO public.marketing_audiences(
    id,account_id,brand_id,name,query_definition,is_system_generated
  ) VALUES(
    v_audience,v_actor,v_brand,'Followers',
    jsonb_build_object('kind','brand_followers','brand_id',v_brand::text),true
  );
  INSERT INTO public.marketing_campaigns(
    id,account_id,brand_id,audience_id,name,channel,channel_payload,status
  ) VALUES(
    v_campaign,v_actor,v_brand,v_audience,'Dark campaign','sms',
    '{"kind":"sms","body":"Never send while dark"}'::jsonb,'draft'
  );
  INSERT INTO public.brand_follows(user_id,brand_id) VALUES(v_member,v_brand);
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN(
    'contact_import_v1','brand_book_blast_v1','brand_circle_followers_v1'
  );
  PERFORM public.issue_1777_refresh_brand_reach(v_brand,'follower');

  -- #1778's channel switch remains OFF: even service-role quote must refuse.
  v_failed:=false;
  BEGIN
    PERFORM public.biz_marketing_circle_quote_candidates_v1(v_actor,v_campaign);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    v_failed:=SQLERRM LIKE '%circle_blast_flag_disabled%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '#1778 default-off delivery gate was bypassed'; END IF;

  IF has_function_privilege(
    'anon','public.biz_get_or_create_marketing_circle_audience_v1(uuid,uuid,text)','EXECUTE'
  ) THEN RAISE EXCEPTION '#1778 anon can create a ring audience'; END IF;
  IF NOT has_function_privilege(
    'authenticated','public.biz_get_or_create_marketing_circle_audience_v1(uuid,uuid,text)','EXECUTE'
  ) THEN RAISE EXCEPTION '#1778 authenticated picker RPC missing'; END IF;
END;
$adversarial$;

ROLLBACK;
