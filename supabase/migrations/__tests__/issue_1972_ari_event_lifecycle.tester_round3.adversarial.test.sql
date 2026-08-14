\set ON_ERROR_STOP on
BEGIN;

-- Independent round-three adversarial coverage for #1972.  This exercises the
-- canonical graph readback used by list/update/duplicate/publish, then probes
-- the authenticated atomic live owner as an RPC boundary.  It intentionally
-- uses a Business-shaped draft location (venue name + full address), because
-- Ari-created fixtures only carry the legacy location_text projection and
-- would not expose lossy graph reconstruction.
DO $test$
DECLARE
  v_user constant uuid := '1972dddd-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972dddd-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1972dddd-0000-4000-8000-000000000003';
  v_publish_operation constant uuid := '1972dddd-0000-4000-8000-000000000004';
  v_args jsonb;
  v_result jsonb;
  v_graph jsonb;
  v_event_id uuid;
  v_duplicate_id uuid;
  v_failures text[] := ARRAY[]::text[];
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round3-tester@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round3-tester@example.invalid','Issue 1972 Round 3 Tester');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 3 Tester Events','issue-1972-round3-tester-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,'title','Private Lagos launch','when_mode','single',
    'start_at','2028-11-10T20:00:00Z','end_at','2028-11-10T22:00:00Z',
    'timezone','Africa/Lagos','visibility','private','city','Lagos',
    'location_text','Ari Hall',
    'party_types',jsonb_build_array('birthday-party'),
    'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('afrobeats'),
    'tickets',jsonb_build_array(jsonb_build_object(
      'id','round3-tester-free','name','Free','priceGbp',0,'isFree',true,
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

  -- Reproduce a draft saved by the Business wizard, whose canonical location
  -- has more information than the legacy events.location_text projection.
  UPDATE public.events
  SET theme=jsonb_set(
    theme,
    '{business_draft,location}',
    jsonb_build_object('venueName','Ari Hall','address','12 Broad Street, Lagos'),
    true
  )
  WHERE id=v_event_id;

  v_graph:=public.business_event_draft_payload_from_graph(v_event_id);
  IF v_graph#>>'{theme,business_draft,requestedVisibility}' IS DISTINCT FROM 'private' THEN
    v_failures:=array_append(v_failures,
      'canonical draft graph replaced requested private visibility with public');
  END IF;
  IF v_graph#>'{theme,business_draft,location}' IS DISTINCT FROM
       jsonb_build_object('venueName','Ari Hall','address','12 Broad Street, Lagos') THEN
    v_failures:=array_append(v_failures,
      'canonical draft graph discarded the saved structured location/address');
  END IF;

  v_result:=public.business_duplicate_event_as_draft(v_event_id);
  v_duplicate_id:=(v_result#>>'{event,id}')::uuid;
  IF (SELECT theme#>>'{business_draft,requestedVisibility}'
      FROM public.events WHERE id=v_duplicate_id) IS DISTINCT FROM 'private' THEN
    v_failures:=array_append(v_failures,
      'duplicate inherited public instead of the source draft private visibility');
  END IF;
  IF (SELECT theme#>'{business_draft,location}'
      FROM public.events WHERE id=v_duplicate_id) IS DISTINCT FROM
       jsonb_build_object('venueName','Ari Hall','address','12 Broad Street, Lagos') THEN
    v_failures:=array_append(v_failures,
      'duplicate lost the source draft structured location/address');
  END IF;

  -- Publish explicitly as private so the next probe reaches the live atomic
  -- mutation boundary without relying on the lossy graph value above.
  v_args:=jsonb_build_object(
    'event_id',v_event_id,'brand_id',v_brand,'visibility','private');
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,related_event_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_publish_operation,v_user,'publish_event',v_args,'executing','hub_experience',v_brand,
    v_event_id,now(),now()
  );
  PERFORM public.ari_execute_event_operation(v_publish_operation,'publish_event',v_args);

  BEGIN
    PERFORM public.business_update_live_event_atomic(
      v_event_id,
      jsonb_build_object('core',jsonb_build_object('visibility','not-a-real-visibility')),
      'Reject invalid visibility',1
    );
    v_failures:=array_append(v_failures,
      'authenticated atomic RPC accepted an unknown visibility and coerced it to public');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'event_visibility_invalid' THEN
      v_failures:=array_append(v_failures,
        'authenticated atomic RPC rejected invalid visibility with an unstable error: '||SQLERRM);
    END IF;
  END;

  IF cardinality(v_failures)>0 THEN
    RAISE EXCEPTION '#1972 round-3 adversarial failures: %',
      array_to_string(v_failures,'; ');
  END IF;
END;
$test$;

ROLLBACK;
