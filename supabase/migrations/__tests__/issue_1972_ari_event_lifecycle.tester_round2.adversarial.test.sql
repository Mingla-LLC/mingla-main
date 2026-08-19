\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '1972eeee-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972eeee-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1972eeee-0000-4000-8000-000000000003';
  v_publish_operation constant uuid := '1972eeee-0000-4000-8000-000000000004';
  v_unlisted_operation constant uuid := '1972eeee-0000-4000-8000-000000000006';
  v_dst_operation constant uuid := '1972eeee-0000-4000-8000-000000000005';
  v_args jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_listed jsonb;
  v_failures text[] := ARRAY[]::text[];
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round2@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round2@example.invalid','Issue 1972 Round 2');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 2 Events','issue-1972-round2-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Private launch','when_mode','single',
    'start_at','2028-11-10T20:00:00Z','end_at','2028-11-10T22:00:00Z',
    'timezone','America/New_York','visibility','public','city','New York',
    'party_types',jsonb_build_array('birthday-party'),
    'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('house'),
    'tickets',jsonb_build_array(jsonb_build_object(
      'id','round2-free','name','Free','priceGbp',0,'isFree',true,
      'isUnlimited',true,'visibility','public','displayOrder',0,
      'approvalRequired',false,'passwordProtected',false,
      'waitlistEnabled',false,'minPurchaseQty',1,'allowTransfers',true,
      'availableAt','both')));
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_create_operation,v_user,'create_event',v_args,'executing','hub_experience',v_brand,
    now(),now()
  );
  v_result:=public.ari_execute_event_operation(v_create_operation,'create_event',v_args);
  v_event_id:=(v_result#>>'{event,id}')::uuid;

  v_listed:=public.business_list_events_for_ari(ARRAY[v_brand],20,false);
  IF COALESCE((v_listed#>>'{0,tickets,count}')::integer,0)<>1 THEN
    v_failures:=array_append(v_failures,
      'draft list/readback reports zero ticket tiers even though its canonical draft has one');
  END IF;

  -- ROUND-2 P0, CARRIED FORWARD. The defect this probe was written against is
  -- "the confirmed visibility is ignored and the draft payload value is
  -- published instead". That invariant is unchanged; what changed underneath it
  -- is that `private` is now FROZEN platform-wide. #1931 shipped containment
  -- only (its transition functions are refusal stubs) and #2009's write guard
  -- fails the Private boundary closed for EVERY writer, so
  -- `business_publish_event_draft` refuses a private-intent publish with
  -- `private_access_not_ready`. Honouring a confirmed `private` therefore MEANS
  -- refusing it — silently publishing it as something else is the very defect.
  -- Both legs are asserted: private fails closed with the row untouched, and a
  -- confirmed `unlisted` is honoured EXACTLY.
  v_args:=jsonb_build_object(
    'event_id',v_event_id,'brand_id',v_brand,'visibility','private');
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_publish_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  BEGIN
    v_result:=public.ari_execute_event_operation(v_publish_operation,'publish_event',v_args);
    v_failures:=array_append(v_failures,
      'a confirmed private publish succeeded while the platform private freeze is in force');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT IN ('private_access_not_ready','private_visibility_unavailable') THEN
      v_failures:=array_append(v_failures,
        'private publish failed with an unexpected code: '||SQLERRM);
    END IF;
  END;
  IF (SELECT status FROM public.events WHERE id=v_event_id)<>'draft' THEN
    v_failures:=array_append(v_failures,
      'the refused private publish still moved the event out of draft');
  END IF;

  v_args:=jsonb_build_object(
    'event_id',v_event_id,'brand_id',v_brand,'visibility','unlisted');
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_unlisted_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  v_result:=public.ari_execute_event_operation(v_unlisted_operation,'publish_event',v_args);
  IF (SELECT visibility FROM public.events WHERE id=v_event_id)<>'hidden' THEN
    v_failures:=array_append(v_failures,
      'confirmed unlisted publish was ignored and the event retained the draft payload visibility');
  END IF;

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','DST gap','when_mode','multi_date',
    'timezone','America/New_York',
    'multi_dates',jsonb_build_array(
      jsonb_build_object('date','2028-03-12','start_time','02:30','end_time','03:30'),
      jsonb_build_object('date','2028-03-13','start_time','20:00','end_time','22:00')));
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_dst_operation,v_user,'create_event',v_args,'executing','hub_experience',v_brand,
    now(),now()
  );
  BEGIN
    PERFORM public.ari_execute_event_operation(v_dst_operation,'create_event',v_args);
    v_failures:=array_append(v_failures,
      'multi-date create silently normalized the nonexistent America/New_York 02:30 DST time');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF cardinality(v_failures)>0 THEN
    RAISE EXCEPTION '#1972 round-2 adversarial failures: %',
      array_to_string(v_failures,'; ');
  END IF;
END;
$test$;

ROLLBACK;
