\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '19720000-0000-4000-8000-000000000001';
  v_brand constant uuid := '19720000-0000-4000-8000-000000000002';
  v_operation constant uuid := '19720000-0000-4000-8000-000000000003';
  v_duplicate_operation constant uuid := '19720000-0000-4000-8000-000000000004';
  v_forged_operation constant uuid := '19720000-0000-4000-8000-000000000005';
  v_multi_operation constant uuid := '19720000-0000-4000-8000-000000000006';
  v_recur_operation constant uuid := '19720000-0000-4000-8000-000000000007';
  v_args jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_duplicate jsonb;
  v_terminal jsonb;
  v_terminal_replay jsonb;
  v_event_id uuid;
  v_selection text := 'issue-1972-picker-selection';
  v_multi_id uuid;
  v_recur_id uuid;
  v_graph jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email) VALUES(v_user,'authenticated','authenticated','issue1972@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_user,'issue1972@example.invalid','Issue 1972');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES(v_brand,v_user,'Issue 1972 Events','issue-1972-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Exactly once launch','visibility','public','when_mode','single','start_at','2028-08-14T20:00:00Z',
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
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  SELECT to_jsonb(row) INTO v_terminal FROM public.terminalize_agent_pending_action(
    v_operation,v_user,'executing','executed',NULL,NULL,'tenant-v1','test-model',true
  ) row;
  SELECT to_jsonb(row) INTO v_terminal_replay FROM public.terminalize_agent_pending_action(
    v_operation,v_user,'executing','executed',NULL,NULL,'tenant-v1','test-model',true
  ) row;
  IF v_terminal->>'status'<>'executed' OR (v_terminal->>'cas_won')::boolean IS NOT TRUE
     OR (v_terminal_replay->>'replay')::boolean IS NOT TRUE
     OR v_terminal_replay->'executed_result' IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'atomic terminalization or same-outcome replay failed';
  END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  v_graph:=public.business_event_draft_payload_from_graph(v_event_id);
  BEGIN
    PERFORM public.business_update_event_draft(v_event_id,v_graph,0);
    RAISE EXCEPTION 'equal draft revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stale_client_revision%' THEN RAISE;END IF;
  END;
  BEGIN
    PERFORM public.business_update_event_draft(v_event_id,v_graph,2);
    RAISE EXCEPTION 'jumped draft revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stale_client_revision%' THEN RAISE;END IF;
  END;
  PERFORM public.business_update_event_draft(v_event_id,v_graph,1);
  IF (SELECT theme#>>'{business_draft,clientRevision}' FROM public.events WHERE id=v_event_id)<>'1' THEN
    RAISE EXCEPTION 'draft CAS did not persist its exact next revision';
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

  -- [TEST-MOD-APPROVED #1972] Cover provenance is now service-attested and
  -- storage-backed; the former arbitrary example.invalid fixture asserted the
  -- vulnerability. Prove caller minting fails, then attest a real object.
  BEGIN
    PERFORM public.business_register_event_cover_selection(v_user,v_event_id,v_selection,
      'https://example.invalid/cover.jpg','image','https://example.invalid/cover.jpg',
      'upload',NULL,NULL,NULL,'Launch cover');
    RAISE EXCEPTION 'authenticated caller minted a trusted cover selection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;
  INSERT INTO storage.objects(bucket_id,name,owner)
  VALUES('event_covers',v_brand::text||'/'||v_event_id::text||'/cover.jpg',v_user);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM public.business_register_event_cover_selection(v_user,v_event_id,v_selection,
    'https://local.invalid/storage/v1/object/public/event_covers/'||v_brand::text||'/'||v_event_id::text||'/cover.jpg',
    'image',
    'https://local.invalid/storage/v1/object/public/event_covers/'||v_brand::text||'/'||v_event_id::text||'/cover.jpg',
    'upload',NULL,NULL,NULL,'Launch cover');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  PERFORM public.business_set_event_cover_media(v_event_id,v_selection,
    'https://local.invalid/storage/v1/object/public/event_covers/'||v_brand::text||'/'||v_event_id::text||'/cover.jpg',
    'image',
    'https://local.invalid/storage/v1/object/public/event_covers/'||v_brand::text||'/'||v_event_id::text||'/cover.jpg',
    'upload',NULL,NULL,NULL,'Launch cover');
  IF NOT EXISTS(SELECT 1 FROM public.event_cover_selections WHERE selection_ref=v_selection AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cover selection was not consumed atomically';
  END IF;
  PERFORM public.business_clear_event_cover_media(v_event_id);
  IF EXISTS(SELECT 1 FROM public.events WHERE id=v_event_id AND (
    cover_media_url IS NOT NULL OR cover_media_type IS NOT NULL
    OR cover_media_poster_url IS NOT NULL OR cover_media_provider IS NOT NULL
  )) THEN RAISE EXCEPTION 'canonical cover clear left a partial tuple';END IF;

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Two date launch','visibility','public','when_mode','multi_date',
    'timezone','America/New_York','city','New York',
    'party_types',jsonb_build_array('birthday-party'),'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('house'),'multi_dates',jsonb_build_array(
      jsonb_build_object('id','night-1','date','2028-09-01','start_time','20:00','end_time','23:00'),
      jsonb_build_object('id','night-2','date','2028-09-08','start_time','20:00','end_time','23:00')),
    'tickets',jsonb_build_array(jsonb_build_object('id','multi-free','name','Free','priceGbp',0,
      'isFree',true,'isUnlimited',true,'visibility','public','displayOrder',0,
      'approvalRequired',false,'passwordProtected',false,'waitlistEnabled',false,
      'minPurchaseQty',1,'allowTransfers',true,'availableAt','both')));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,related_brand_id,server_proposed_at,execution_attested_at)
  VALUES(v_multi_operation,v_user,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());
  v_result:=public.ari_execute_event_operation(v_multi_operation,'create_event',v_args);
  v_multi_id:=(v_result#>>'{event,id}')::uuid;
  IF jsonb_array_length(v_result#>'{event,theme,business_draft,multiDates}')<>2
     OR (v_result#>>'{event,is_multi_date}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'multi-date create lost its canonical topology';
  END IF;
  PERFORM public.issue_1719_publish_event_with_poster(v_multi_id,
    public.business_event_draft_payload_from_graph(v_multi_id),0);
  IF (SELECT count(*) FROM public.event_dates WHERE event_id=v_multi_id)<>2 THEN
    RAISE EXCEPTION 'multi-date publish did not materialize both occurrences';
  END IF;
  BEGIN
    PERFORM public.business_update_live_event(v_multi_id,jsonb_build_object('name','Jumped'),
      'Testing exact revision',2);
    RAISE EXCEPTION 'jumped live revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stale_client_revision%' THEN RAISE;END IF;
  END;
  PERFORM public.business_update_live_event(v_multi_id,jsonb_build_object('name','Updated two date launch'),
    'Testing exact revision',1);
  BEGIN
    PERFORM public.business_update_live_event(v_multi_id,jsonb_build_object('name','Replay'),
      'Testing exact revision',1);
    RAISE EXCEPTION 'replayed live revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stale_client_revision%' THEN RAISE;END IF;
  END;

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Weekly launch','visibility','public','when_mode','recurring',
    'start_at','2028-10-01T20:00:00Z','end_at','2028-10-01T22:00:00Z','timezone','UTC','city','London',
    'party_types',jsonb_build_array('birthday-party'),'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('house'),
    'recurrence_rule',jsonb_build_object('preset','weekly','byDay','SU',
      'termination',jsonb_build_object('kind','count','count',4)),
    'tickets',jsonb_build_array(jsonb_build_object('id','recur-free','name','Free','priceGbp',0,
      'isFree',true,'isUnlimited',true,'visibility','public','displayOrder',0,
      'approvalRequired',false,'passwordProtected',false,'waitlistEnabled',false,
      'minPurchaseQty',1,'allowTransfers',true,'availableAt','both')));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,related_brand_id,server_proposed_at,execution_attested_at)
  VALUES(v_recur_operation,v_user,'create_event',v_args,'executing','hub_experience',v_brand,now(),now());
  v_result:=public.ari_execute_event_operation(v_recur_operation,'create_event',v_args);
  v_recur_id:=(v_result#>>'{event,id}')::uuid;
  IF v_result#>>'{event,theme,business_draft,recurrenceRule,preset}'<>'weekly'
     OR (v_result#>>'{event,is_recurring}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'recurring create lost its canonical rule';
  END IF;
  PERFORM public.issue_1719_publish_event_with_poster(v_recur_id,
    public.business_event_draft_payload_from_graph(v_recur_id),0);
  IF NOT EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=v_recur_id AND is_master)
     OR (SELECT recurrence_rules->>'preset' FROM public.events WHERE id=v_recur_id)<>'weekly' THEN
    RAISE EXCEPTION 'recurring publish did not preserve its master/rule';
  END IF;

  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,related_brand_id)
  VALUES(v_forged_operation,v_user,'duplicate_event',jsonb_build_object('event_id',v_event_id),'executing','hub_experience',v_brand);
  BEGIN
    PERFORM public.ari_execute_event_operation(v_forged_operation,'duplicate_event',jsonb_build_object('event_id',v_event_id));
    RAISE EXCEPTION 'unattested direct RPC unexpectedly executed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%operation_not_executing%' THEN RAISE;END IF;
  END;

  PERFORM public.issue_1719_publish_event_with_poster(
    v_event_id,public.business_event_draft_payload_from_graph(v_event_id),1
  );
  PERFORM public.business_cancel_event(v_event_id);
  IF NOT EXISTS(
    SELECT 1 FROM public.event_cancel_refund_runs
    WHERE event_id=v_event_id AND status='completed' AND total_objects=0
  ) THEN
    RAISE EXCEPTION 'cancel did not atomically open and finish its empty refund run';
  END IF;
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
