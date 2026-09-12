\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE v_fn regprocedure;
BEGIN
  IF (SELECT count(*) FROM public.feature_flags
      WHERE flag_key IN(
        'brand_circle_followers_email_v1','brand_circle_followers_sms_v1',
        'brand_circle_extended_email_v1','brand_circle_extended_sms_v1'
      ) AND NOT is_enabled)<>4
  THEN RAISE EXCEPTION '#1778 delivery flags are not all default-off'; END IF;
  IF has_table_privilege('authenticated','public.marketing_book_send_targets','SELECT')
  THEN RAISE EXCEPTION '#1778 sealed Circle targets leaked to authenticated'; END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_1778_ring_channel_enabled(text,text)'::regprocedure,
    'public.issue_1778_circle_authorized_contact(uuid,uuid,text)'::regprocedure,
    'public.biz_marketing_circle_quote_candidates_v1(uuid,uuid)'::regprocedure,
    'public.biz_confirm_marketing_circle_send_v1(uuid,uuid,uuid,jsonb,timestamptz)'::regprocedure,
    'public.biz_marketing_circle_send_audience_v1(uuid)'::regprocedure
  ] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_proc
      WHERE oid=v_fn AND prosecdef AND pg_get_userbyid(proowner)='postgres'
    ) THEN RAISE EXCEPTION '#1778 service function security drift: %',v_fn; END IF;
    IF has_function_privilege('authenticated',v_fn,'EXECUTE')
    THEN RAISE EXCEPTION '#1778 service function leaked: %',v_fn; END IF;
  END LOOP;
END;
$catalog$;

DO $behavior$
DECLARE
  v_actor uuid:='17780000-0000-4000-8000-000000000001';
  v_member uuid:='17780000-0000-4000-8000-000000000002';
  v_brand uuid:='17780000-0000-4000-8000-000000000010';
  v_campaign uuid:='17780000-1000-4000-8000-000000000001';
  v_request uuid:='17780000-2000-4000-8000-000000000001';
  v_audience uuid; v_created jsonb; v_candidates jsonb; v_snapshot jsonb;
  v_confirmed jsonb; v_resolved jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(v_actor),(v_member);
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_actor,'owner-1778@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
  VALUES(v_brand,v_actor,'Issue 1778 Circle','issue-1778-circle','USD',now(),now());
  INSERT INTO public.profiles(
    id,first_name,last_name,display_name,username,active,
    has_completed_onboarding,visibility_mode
  ) VALUES(
    v_member,'Current','Follower','Ignored','follower-1778',true,true,'friends'
  );
  INSERT INTO public.verified_phone_identities(user_id,phone_e164)
  VALUES(v_member,'+12025550178');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN(
    'contact_import_v1','brand_book_blast_v1','brand_circle_followers_v1',
    'brand_circle_followers_sms_v1'
  );
  INSERT INTO public.brand_follows(user_id,brand_id) VALUES(v_member,v_brand);
  PERFORM public.issue_1777_refresh_brand_reach(v_brand,'follower');

  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  v_created:=public.biz_get_or_create_marketing_circle_audience_v1(
    v_actor,v_brand,'brand_followers'
  );
  v_audience:=(v_created->>'audienceId')::uuid;
  IF v_audience IS NULL THEN RAISE EXCEPTION '#1778 audience was not created'; END IF;
  IF (public.biz_get_or_create_marketing_circle_audience_v1(
        v_actor,v_brand,'brand_followers'
      )->>'audienceId')::uuid IS DISTINCT FROM v_audience
  THEN RAISE EXCEPTION '#1778 audience creation was not idempotent'; END IF;

  INSERT INTO public.marketing_campaigns(
    id,account_id,brand_id,audience_id,name,channel,channel_payload,status
  ) VALUES(
    v_campaign,v_actor,v_brand,v_audience,'Follower update','sms',
    '{"kind":"sms","body":"Hello followers"}'::jsonb,'draft'
  );
  v_candidates:=public.biz_marketing_circle_quote_candidates_v1(v_actor,v_campaign);
  IF (v_candidates->>'selectedCount')::integer<>1
    OR v_candidates->>'audienceKind'<>'brand_followers'
    OR v_candidates#>>'{candidates,0,recipientUserId}'<>v_member::text
    OR v_candidates#>>'{candidates,0,normalizedContact}'<>'+12025550178'
  THEN RAISE EXCEPTION '#1778 current follower candidate incorrect: %',v_candidates; END IF;

  v_snapshot:=v_candidates || jsonb_build_object(
    'quoteVersion',1,'quoteHash',repeat('a',64),'contentHash',repeat('b',64),
    'quotedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reachableCount',1,'suppressedCount',0,'unavailableCount',0,
    'smsSegments',1,'estimatedCostMinor',10,'currency','USD',
    'costKind','provider_estimate','rateIds','[]'::jsonb,
    'sourceReferences','[]'::jsonb,
    'candidates',(
      SELECT jsonb_agg(x || jsonb_build_object(
        'segments',1,'allocatedCostMinor',10,'rateId','test-rate',
        'sourceReference','issue-1778-test'
      )) FROM jsonb_array_elements(v_candidates->'candidates') x
    )
  );
  v_confirmed:=public.biz_confirm_marketing_circle_send_v1(
    v_actor,v_campaign,v_request,v_snapshot,clock_timestamp()+interval '1 hour'
  );
  IF v_confirmed->>'executionId' IS NULL
  THEN RAISE EXCEPTION '#1778 sealed confirmation failed'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.marketing_book_send_targets t
    WHERE t.recipient_user_id=v_member AND t.brand_person_id IS NULL
      AND t.ring='follower' AND t.outcome='queued'
      AND t.contact_value_digest=encode(
        extensions.digest(convert_to('+12025550178','UTF8'),'sha256'),'hex'
      )
  ) THEN RAISE EXCEPTION '#1778 immutable Circle target missing'; END IF;

  v_resolved:=public.biz_marketing_circle_send_audience_v1(v_campaign);
  IF jsonb_array_length(v_resolved->'rows')<>1
    OR v_resolved#>>'{rows,0,raw_phone}'<>'+12025550178'
  THEN RAISE EXCEPTION '#1778 confirmed follower did not resolve: %',v_resolved; END IF;

  -- Current truth may only shrink the sealed set after confirmation.
  INSERT INTO public.brand_circle_exits(
    brand_id,user_id,visibility_exited_at,delivery_exited_at
  ) VALUES(v_brand,v_member,clock_timestamp(),clock_timestamp());
  v_resolved:=public.biz_marketing_circle_send_audience_v1(v_campaign);
  IF jsonb_array_length(v_resolved->'rows')<>0
  THEN RAISE EXCEPTION '#1778 post-confirm exit still delivered'; END IF;
  DELETE FROM public.brand_circle_exits WHERE brand_id=v_brand AND user_id=v_member;
  UPDATE public.verified_phone_identities
  SET phone_e164='+12025550179' WHERE user_id=v_member;
  v_resolved:=public.biz_marketing_circle_send_audience_v1(v_campaign);
  IF jsonb_array_length(v_resolved->'rows')<>0
  THEN RAISE EXCEPTION '#1778 changed identifier redirected sealed delivery'; END IF;
END;
$behavior$;

ROLLBACK;
