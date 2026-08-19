\set ON_ERROR_STOP on
BEGIN;

DO $grants$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.business_update_live_event(uuid,jsonb,text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.business_patch_event_when(uuid,jsonb,text,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated_can_bypass_atomic_live_event_owner';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.business_update_live_event_atomic(uuid,jsonb,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated_cannot_execute_atomic_live_event_owner';
  END IF;
END;
$grants$;

DO $test$
DECLARE
  v_user constant uuid := '1972ffff-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972ffff-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1972ffff-0000-4000-8000-000000000003';
  v_publish_operation constant uuid := '1972ffff-0000-4000-8000-000000000004';
  v_args jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_event_before_failure jsonb;
  v_dates_before_failure jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round3@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round3@example.invalid','Issue 1972 Round 3');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 3 Events','issue-1972-round3-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Atomic draft','when_mode','single',
    'start_at','2028-11-10T20:00:00Z','end_at','2028-11-10T22:00:00Z',
    'timezone','America/New_York','visibility','public','city','New York',
    'party_types',jsonb_build_array('birthday-party'),
    'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('house'),
    'tickets',jsonb_build_array(jsonb_build_object(
      'id','round3-free','name','Free','priceGbp',0,'isFree',true,
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

  v_args:=jsonb_build_object(
    'event_id',v_event_id,'brand_id',v_brand,'visibility','public');
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_publish_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  PERFORM public.ari_execute_event_operation(v_publish_operation,'publish_event',v_args);

  INSERT INTO public.event_cover_selections(
    selection_ref,user_id,event_id,media_url,media_type,poster_url,provider,
    source_url,credit,credit_url,alt,expires_at
  ) VALUES(
    'round3-cover-selection',v_user,v_event_id,
    'https://storage.example.invalid/atomic-cover.jpg','image',
    'https://storage.example.invalid/atomic-cover.jpg','upload',NULL,
    'Organizer credit',NULL,'Atomic cover',now()+interval '10 minutes'
  );

  PERFORM public.business_update_live_event_atomic(
    v_event_id,
    jsonb_build_object(
      'core',jsonb_build_object('name','Atomic live event','description','Saved together'),
      'taxonomy',jsonb_build_object(
        'city','Atlanta','partyTypes',jsonb_build_array('birthday-party'),
        'vibeTags',jsonb_build_array('social'),'musicGenres',jsonb_build_array('afrobeats'),
        'locationGeo',NULL,'locationText','Atlanta, GA'),
      'when',jsonb_build_object(
        'whenMode','single','timezone','America/New_York',
        'when',jsonb_build_object('date','2028-11-11','doorsOpen','18:00','endsAt','20:00'),
        'multiDates',NULL,'recurrenceRule',NULL),
      'theme',jsonb_build_object('color','#112233','font','fraunces','animation','none'),
      'pricing',jsonb_build_object('passTax',true,'passMinglaFee',false,'passServiceFee',true),
      'cover',jsonb_build_object('selectionRef','round3-cover-selection')
    ),
    'Round three atomic save',1
  );

  IF NOT EXISTS(
    SELECT 1 FROM public.events e
    WHERE e.id=v_event_id AND e.title='Atomic live event'
      AND e.description='Saved together' AND e.city='Atlanta'
      AND e.party_types=ARRAY['birthday-party']::text[]
      AND e.vibe_tags=ARRAY['social']::text[]
      AND e.music_genres=ARRAY['afrobeats']::text[]
      AND e.theme_color_override='#112233'
      AND e.theme_font_override='fraunces'
      AND e.theme_animation_override='none'
      AND e.pass_tax=true AND e.pass_mingla_fee=false AND e.pass_service_fee=true
      AND e.cover_media_url='https://storage.example.invalid/atomic-cover.jpg'
      AND e.cover_media_credit='Organizer credit' AND e.cover_media_alt='Atomic cover'
      AND (e.theme#>>'{business_event,clientRevision}')::integer=1
  ) THEN RAISE EXCEPTION 'atomic_mixed_save_did_not_persist_complete_graph';END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.event_cover_selections
    WHERE selection_ref='round3-cover-selection' AND consumed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'atomic_mixed_save_did_not_consume_cover_attestation';END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.event_dates ed
    WHERE ed.event_id=v_event_id AND ed.is_master
      AND (ed.start_at AT TIME ZONE 'America/New_York')=timestamp '2028-11-11 18:00:00'
      AND (ed.end_at AT TIME ZONE 'America/New_York')=timestamp '2028-11-11 20:00:00'
  ) THEN RAISE EXCEPTION 'atomic_mixed_save_did_not_persist_when';END IF;

  SELECT to_jsonb(e) INTO v_event_before_failure
    FROM public.events e WHERE id=v_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at),'[]'::jsonb)
    INTO v_dates_before_failure FROM public.event_dates ed
    WHERE ed.event_id=v_event_id;
  BEGIN
    PERFORM public.business_update_live_event_atomic(
      v_event_id,
      jsonb_build_object(
        'core',jsonb_build_object('name','Must roll back'),
        'taxonomy',jsonb_build_object(
          'city','Chicago','partyTypes',jsonb_build_array('birthday-party'),
          'vibeTags',jsonb_build_array('social'),'musicGenres',jsonb_build_array('afrobeats'),
          'locationGeo',NULL,'locationText','Chicago, IL'),
        'when',jsonb_build_object(
          'whenMode','single','timezone','America/Chicago',
          'when',jsonb_build_object('date','2028-11-12','doorsOpen','19:00','endsAt','21:00'),
          'multiDates',NULL,'recurrenceRule',NULL),
        'theme',jsonb_build_object('color','#445566','font','inter','animation','confetti'),
        'pricing',jsonb_build_object('passTax',false,'passMinglaFee',true,'passServiceFee',false),
        'cover',jsonb_build_object('selectionRef','missing-late-cover-selection')
      ),
      'Force late rollback',2
    );
    RAISE EXCEPTION 'atomic_late_failure_was_not_rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='atomic_late_failure_was_not_rejected' THEN RAISE;END IF;
    IF SQLERRM<>'cover_selection_unverified' THEN
      RAISE EXCEPTION 'atomic_late_failure_wrong_error:%',SQLERRM;
    END IF;
  END;
  IF (SELECT to_jsonb(e) FROM public.events e WHERE e.id=v_event_id)
       IS DISTINCT FROM v_event_before_failure THEN
    RAISE EXCEPTION 'atomic_late_failure_left_partial_event_commit';
  END IF;
  IF (SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at),'[]'::jsonb)
        FROM public.event_dates ed WHERE ed.event_id=v_event_id)
       IS DISTINCT FROM v_dates_before_failure THEN
    RAISE EXCEPTION 'atomic_late_failure_left_partial_date_commit';
  END IF;
END;
$test$;

ROLLBACK;
