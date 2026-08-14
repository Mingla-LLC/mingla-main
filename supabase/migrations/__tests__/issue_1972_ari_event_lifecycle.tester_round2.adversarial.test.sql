\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '1972eeee-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972eeee-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1972eeee-0000-4000-8000-000000000003';
  v_publish_operation constant uuid := '1972eeee-0000-4000-8000-000000000004';
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

  v_args:=jsonb_build_object(
    'event_id',v_event_id,'brand_id',v_brand,'visibility','private');
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_publish_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  v_result:=public.ari_execute_event_operation(v_publish_operation,'publish_event',v_args);
  IF (SELECT visibility FROM public.events WHERE id=v_event_id)<>'private' THEN
    v_failures:=array_append(v_failures,
      'confirmed private publish was ignored and the event retained the draft payload visibility');
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
