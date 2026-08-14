\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '19720000-0000-4000-8000-000000000001';
  v_brand constant uuid := '19720000-0000-4000-8000-000000000002';
  v_operation constant uuid := '19720000-0000-4000-8000-000000000003';
  v_duplicate_operation constant uuid := '19720000-0000-4000-8000-000000000004';
  v_forged_operation constant uuid := '19720000-0000-4000-8000-000000000005';
  v_args jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_duplicate jsonb;
  v_event_id uuid;
  v_selection text := 'issue-1972-picker-selection';
BEGIN
  INSERT INTO auth.users(id,aud,role,email) VALUES(v_user,'authenticated','authenticated','issue1972@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_user,'issue1972@example.invalid','Issue 1972');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES(v_brand,v_user,'Issue 1972 Events','issue-1972-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Exactly once launch','start_at','2028-08-14T20:00:00Z',
    'end_at','2028-08-14T22:00:00Z','timezone','America/New_York','city','New York',
    'party_types',jsonb_build_array('birthday-party'),'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('house'),'tickets',jsonb_build_array(
      jsonb_build_object('id','draft-ticket','name','General','priceGbp',0,'isFree',true,
        'isUnlimited',true,'visibility','public','displayOrder',0,'approvalRequired',false,
        'passwordProtected',false,'waitlistEnabled',false,'minPurchaseQty',1,
        'maxPurchaseQty',NULL,'allowTransfers',true,'description',NULL,
        'saleStartAt',NULL,'saleEndAt',NULL,'availableAt','both')));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,related_brand_id,server_proposed_at,execution_attested_at)
  VALUES(v_operation,v_user,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());

  v_result:=public.ari_execute_event_operation(v_operation,'create_event',v_args);
  v_event_id:=(v_result#>>'{event,id}')::uuid;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'create did not return an event id';END IF;
  IF (SELECT count(*) FROM public.events WHERE id=v_event_id AND event_type='event' AND status='draft')<>1 THEN
    RAISE EXCEPTION 'create did not persist exactly one event draft';
  END IF;
  IF (SELECT theme#>>'{business_draft,when,date}' FROM public.events WHERE id=v_event_id)<>'2028-08-14' THEN
    RAISE EXCEPTION 'typed draft date graph was not stored';
  END IF;
  v_replay:=public.ari_execute_event_operation(v_operation,'create_event',v_args);
  IF v_replay IS DISTINCT FROM v_result OR (SELECT count(*) FROM public.events WHERE brand_id=v_brand)<>1 THEN
    RAISE EXCEPTION 'same operation did not replay exactly once';
  END IF;

  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,server_proposed_at,execution_attested_at)
  VALUES(v_duplicate_operation,v_user,'duplicate_event',jsonb_build_object('event_id',v_event_id),'executing','hub_experience',v_brand,v_event_id,now(),now());
  v_duplicate:=public.ari_execute_event_operation(v_duplicate_operation,'duplicate_event',jsonb_build_object('event_id',v_event_id));
  IF (v_duplicate#>>'{event,id}')::uuid=v_event_id OR (SELECT count(*) FROM public.events WHERE brand_id=v_brand)<>2 THEN
    RAISE EXCEPTION 'duplicate did not create exactly one distinct draft';
  END IF;
  IF v_duplicate#>'{event,theme,business_draft,tickets}' IS DISTINCT FROM v_result#>'{event,theme,business_draft,tickets}' THEN
    RAISE EXCEPTION 'duplicate lost the editable ticket graph';
  END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=(v_duplicate#>>'{event,id}')::uuid)
    OR EXISTS(SELECT 1 FROM public.tickets WHERE event_id=(v_duplicate#>>'{event,id}')::uuid) THEN
    RAISE EXCEPTION 'duplicate copied transactional buyer rows';
  END IF;

  PERFORM public.business_register_event_cover_selection(v_event_id,v_selection,
    'https://example.invalid/cover.jpg','image','https://example.invalid/cover.jpg',
    'upload',NULL,NULL,NULL,'Launch cover');
  PERFORM public.business_set_event_cover_media(v_event_id,v_selection,
    'https://example.invalid/cover.jpg','image','https://example.invalid/cover.jpg',
    'upload',NULL,NULL,NULL,'Launch cover');
  IF NOT EXISTS(SELECT 1 FROM public.event_cover_selections WHERE selection_ref=v_selection AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cover selection was not consumed atomically';
  END IF;

  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,related_brand_id)
  VALUES(v_forged_operation,v_user,'duplicate_event',jsonb_build_object('event_id',v_event_id),'executing','hub_experience',v_brand);
  BEGIN
    PERFORM public.ari_execute_event_operation(v_forged_operation,'duplicate_event',jsonb_build_object('event_id',v_event_id));
    RAISE EXCEPTION 'unattested direct RPC unexpectedly executed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%operation_not_executing%' THEN RAISE;END IF;
  END;
END;
$test$;

DO $test$
BEGIN
  IF has_function_privilege('anon','public.business_patch_event_when(uuid,jsonb,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'anonymous patch-when grant remains';
  END IF;
  IF has_function_privilege('anon','public.ari_execute_event_operation(uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'anonymous event dispatcher grant remains';
  END IF;
  IF has_table_privilege('authenticated','public.agent_pending_actions','INSERT')
    OR has_table_privilege('authenticated','public.agent_pending_actions','UPDATE')
    OR has_table_privilege('authenticated','public.agent_pending_actions','DELETE') THEN
    RAISE EXCEPTION 'authenticated pending-action write grant remains';
  END IF;
END;
$test$;

ROLLBACK;
