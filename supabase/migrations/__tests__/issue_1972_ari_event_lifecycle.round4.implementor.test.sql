\set ON_ERROR_STOP on
BEGIN;

-- Round-four happy path: draft-only structured fields must survive the
-- canonical graph and duplication, and publish must honor the stored private
-- request even when the confirmation supplies no visibility override.
DO $test$
DECLARE
  v_user constant uuid := '1972cafe-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972cafe-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1972cafe-0000-4000-8000-000000000003';
  v_publish_operation constant uuid := '1972cafe-0000-4000-8000-000000000004';
  v_unlisted_operation constant uuid := '1972dddd-0000-4000-8000-00000000ff04';
  v_private_publish_refused boolean;
  v_args jsonb;
  v_result jsonb;
  v_graph jsonb;
  v_event_id uuid;
  v_duplicate_id uuid;
  v_location constant jsonb := jsonb_build_object(
    'venueName','The Civic Centre',
    'address','Ozumba Mbadiwe Avenue, Victoria Island, Lagos',
    'instructions','Use the waterfront entrance'
  );
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round4@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round4@example.invalid','Issue 1972 Round 4');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 4 Events','issue-1972-round4-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Private Lagos dinner','when_mode','single',
    'start_at','2028-11-15T18:00:00Z','end_at','2028-11-15T22:00:00Z',
    'timezone','Africa/Lagos','visibility','private','city','Lagos',
    'location_text','The Civic Centre',
    'party_types',jsonb_build_array('birthday-party'),
    'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('afrobeats'),
    'tickets',jsonb_build_array(jsonb_build_object(
      'id','round4-free','name','Invitation','priceGbp',0,'isFree',true,
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

  UPDATE public.events SET theme=jsonb_set(
    theme,'{business_draft,location}',v_location,true
  ) WHERE id=v_event_id;

  v_graph:=public.business_event_draft_payload_from_graph(v_event_id);
  IF v_graph#>>'{theme,business_draft,requestedVisibility}' IS DISTINCT FROM 'private'
     OR v_graph#>'{theme,business_draft,location}' IS DISTINCT FROM v_location THEN
    RAISE EXCEPTION 'round4_canonical_draft_fields_not_preserved';
  END IF;

  v_result:=public.business_duplicate_event_as_draft(v_event_id);
  v_duplicate_id:=(v_result#>>'{event,id}')::uuid;
  IF NOT EXISTS(
    SELECT 1 FROM public.events
    WHERE id=v_duplicate_id
      AND theme#>>'{business_draft,requestedVisibility}'='private'
      AND theme#>'{business_draft,location}'=v_location
  ) THEN RAISE EXCEPTION 'round4_duplicate_did_not_preserve_draft_fields';END IF;

  v_args:=jsonb_build_object('event_id',v_event_id,'brand_id',v_brand);
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_publish_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  -- CARRIED FORWARD. This leg proved that a publish carrying NO visibility
  -- override still honours the draft's stored intent rather than silently
  -- defaulting to public. The intent here is `private`, which is now frozen
  -- platform-wide (#1931 shipped containment only; #2009's Private boundary
  -- guard fails closed for every writer until #2144). Honouring the stored
  -- intent therefore means REFUSING the publish — not publishing it as
  -- something the organiser never asked for, which is the defect this leg
  -- exists to catch. The row must be untouched.
  v_private_publish_refused:=false;
  BEGIN
    PERFORM public.ari_execute_event_operation(v_publish_operation,'publish_event',v_args);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT IN ('private_access_not_ready','private_visibility_unavailable') THEN
      RAISE EXCEPTION 'round4_private_publish_wrong_error:%',SQLERRM;
    END IF;
    v_private_publish_refused:=true;
  END;
  IF NOT v_private_publish_refused THEN
    RAISE EXCEPTION 'round4_private_publish_succeeded_despite_platform_freeze';
  END IF;
  IF (SELECT status FROM public.events WHERE id=v_event_id) IS DISTINCT FROM 'draft'
     OR (SELECT theme#>>'{business_draft,requestedVisibility}'
         FROM public.events WHERE id=v_event_id) IS DISTINCT FROM 'private' THEN
    RAISE EXCEPTION 'round4_refused_private_publish_still_changed_the_graph';
  END IF;

  -- An explicit, permitted override publishes and is honoured EXACTLY, which
  -- keeps the live atomic-update probe below reachable.
  v_args:=jsonb_build_object(
    'event_id',v_event_id,'brand_id',v_brand,'visibility','unlisted');
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_unlisted_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  PERFORM public.ari_execute_event_operation(v_unlisted_operation,'publish_event',v_args);
  IF (SELECT visibility FROM public.events WHERE id=v_event_id)
       IS DISTINCT FROM 'hidden' THEN
    RAISE EXCEPTION 'round4_permitted_override_publish_lost_its_visibility';
  END IF;

  PERFORM public.business_update_live_event_atomic(
    v_event_id,
    jsonb_build_object('core',jsonb_build_object('visibility','unlisted')),
    'Round four valid visibility update',1
  );
  IF (SELECT visibility FROM public.events WHERE id=v_event_id)
       IS DISTINCT FROM 'hidden' THEN
    RAISE EXCEPTION 'round4_valid_unlisted_visibility_rejected_or_mapped_wrong';
  END IF;
END;
$test$;

ROLLBACK;
