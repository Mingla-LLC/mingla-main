\set ON_ERROR_STOP on
BEGIN;

-- Round five closes the event-visibility contract. Every durable draft writer,
-- reconstruction path, and publish transition must share one closed enum and
-- must leave the complete event graph byte-identical when validation fails.
DO $test$
DECLARE
  v_user constant uuid := '1972d00d-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972d00d-0000-4000-8000-000000000002';
  v_event_id uuid;
  v_result jsonb;
  v_payload jsonb;
  v_before jsonb;
  v_after jsonb;
  v_visibility text;
  v_expected text;
  v_invalid_label text;
  v_invalid_value jsonb;
  v_operation_id uuid;
  v_count_before bigint;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round5@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round5@example.invalid','Issue 1972 Round 5');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 5 Events','issue-1972-round5-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  -- All three valid values survive create exactly; no fallback or remapping is
  -- allowed while the event is still a private draft.
  FOREACH v_visibility IN ARRAY ARRAY['public','unlisted','private'] LOOP
    v_payload:=jsonb_build_object(
      'title','Valid create '||v_visibility,'timezone','Africa/Lagos','currency','USD',
      'theme',jsonb_build_object('business_draft',jsonb_build_object(
        'requestedVisibility',v_visibility,'clientRevision',0))
    );
    v_event_id:=((public.business_create_event_draft(v_brand,v_payload))#>>'{event,id}')::uuid;
    IF (SELECT theme#>>'{business_draft,requestedVisibility}'
        FROM public.events WHERE id=v_event_id) IS DISTINCT FROM v_visibility THEN
      RAISE EXCEPTION 'valid_create_visibility_changed:%',v_visibility;
    END IF;
  END LOOP;

  -- Missing, JSON null, every non-string shape, empty, and unknown text all
  -- produce the same product error and never leave an event row behind.
  FOR v_invalid_label,v_invalid_value IN
    SELECT * FROM (VALUES
      ('missing',NULL::jsonb),
      ('null','null'::jsonb),
      ('boolean','true'::jsonb),
      ('object','{}'::jsonb),
      ('array','[]'::jsonb),
      ('empty','""'::jsonb),
      ('unknown','"friends_only"'::jsonb)
    ) invalid(label,value)
  LOOP
    SELECT count(*) INTO v_count_before FROM public.events WHERE brand_id=v_brand;
    v_payload:=jsonb_build_object(
      'title','Rejected create '||v_invalid_label,
      'timezone','Africa/Lagos','currency','USD',
      'theme',jsonb_build_object('business_draft',jsonb_build_object('clientRevision',0))
    );
    IF v_invalid_label<>'missing' THEN
      v_payload:=jsonb_set(
        v_payload,'{theme,business_draft,requestedVisibility}',v_invalid_value,true
      );
    END IF;
    BEGIN
      PERFORM public.business_create_event_draft(v_brand,v_payload);
      RAISE EXCEPTION 'invalid_create_was_accepted:%',v_invalid_label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'invalid_create_was_accepted:%' THEN RAISE;END IF;
      IF SQLERRM<>'event_visibility_invalid' THEN
        RAISE EXCEPTION 'invalid_create_wrong_error:%:%',v_invalid_label,SQLERRM;
      END IF;
    END;
    IF (SELECT count(*) FROM public.events WHERE brand_id=v_brand)<>v_count_before THEN
      RAISE EXCEPTION 'invalid_create_left_durable_row:%',v_invalid_label;
    END IF;
  END LOOP;

  -- A valid private draft is the byte-identity subject for every malformed
  -- full-payload update and every malformed publish attempt.
  v_payload:=jsonb_build_object(
    'title','Round five byte identity','timezone','Africa/Lagos','currency','USD',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'requestedVisibility','private','clientRevision',0))
  );
  v_event_id:=((public.business_create_event_draft(v_brand,v_payload))#>>'{event,id}')::uuid;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE id=v_event_id;

  FOR v_invalid_label,v_invalid_value IN
    SELECT * FROM (VALUES
      ('missing',NULL::jsonb),('null','null'::jsonb),('boolean','false'::jsonb),
      ('object','{}'::jsonb),('array','[]'::jsonb),('empty','""'::jsonb),
      ('unknown','"all_users"'::jsonb)
    ) invalid(label,value)
  LOOP
    v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
    v_payload:=jsonb_set(
      v_payload,'{theme,business_draft,clientRevision}','1'::jsonb,true
    );
    IF v_invalid_label='missing' THEN
      v_payload:=jsonb_set(
        v_payload,'{theme,business_draft}',
        (v_payload#>'{theme,business_draft}')-'requestedVisibility',true
      );
    ELSE
      v_payload:=jsonb_set(
        v_payload,'{theme,business_draft,requestedVisibility}',v_invalid_value,true
      );
    END IF;
    BEGIN
      PERFORM public.business_update_event_draft(v_event_id,v_payload,1);
      RAISE EXCEPTION 'invalid_update_was_accepted:%',v_invalid_label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'invalid_update_was_accepted:%' THEN RAISE;END IF;
      IF SQLERRM<>'event_visibility_invalid' THEN
        RAISE EXCEPTION 'invalid_update_wrong_error:%:%',v_invalid_label,SQLERRM;
      END IF;
    END;
    SELECT to_jsonb(e) INTO v_after FROM public.events e WHERE id=v_event_id;
    IF v_after IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'invalid_update_changed_event_or_revision:%',v_invalid_label;
    END IF;

    BEGIN
      PERFORM public.issue_1719_publish_event_with_poster(v_event_id,v_payload,0);
      RAISE EXCEPTION 'invalid_publish_was_accepted:%',v_invalid_label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'invalid_publish_was_accepted:%' THEN RAISE;END IF;
      IF SQLERRM<>'event_visibility_invalid' THEN
        RAISE EXCEPTION 'invalid_publish_wrong_error:%:%',v_invalid_label,SQLERRM;
      END IF;
    END;
    SELECT to_jsonb(e) INTO v_after FROM public.events e WHERE id=v_event_id;
    IF v_after IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'invalid_publish_changed_event_graph:%',v_invalid_label;
    END IF;
  END LOOP;

  -- Ari's create adapter must enforce the same contract even when called below
  -- the JSON-schema layer. This proves missing and non-string values cannot
  -- become an implicitly public draft.
  FOR v_invalid_label,v_invalid_value IN
    SELECT * FROM (VALUES
      ('missing',NULL::jsonb),('null','null'::jsonb),('boolean','true'::jsonb),
      ('object','{}'::jsonb),('unknown','"followers"'::jsonb)
    ) invalid(label,value)
  LOOP
    v_operation_id:=gen_random_uuid();
    v_payload:=jsonb_build_object(
      'brand_id',v_brand,'title','Rejected Ari '||v_invalid_label,
      'when_mode','single','start_at','2028-11-15T18:00:00Z'
    );
    IF v_invalid_label<>'missing' THEN
      v_payload:=jsonb_set(v_payload,'{visibility}',v_invalid_value,true);
    END IF;
    INSERT INTO public.agent_pending_actions(
      id,user_id,tool_name,tool_args,status,source,related_brand_id,
      server_proposed_at,execution_attested_at
    ) VALUES(
      v_operation_id,v_user,'create_event',v_payload,'executing','hub_experience',
      v_brand,now(),now()
    );
    SELECT count(*) INTO v_count_before FROM public.events WHERE brand_id=v_brand;
    BEGIN
      PERFORM public.ari_execute_event_operation(
        v_operation_id,'create_event',v_payload
      );
      RAISE EXCEPTION 'invalid_ari_create_was_accepted:%',v_invalid_label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'invalid_ari_create_was_accepted:%' THEN RAISE;END IF;
      IF SQLERRM<>'event_visibility_invalid' THEN
        RAISE EXCEPTION 'invalid_ari_create_wrong_error:%:%',v_invalid_label,SQLERRM;
      END IF;
    END;
    IF (SELECT count(*) FROM public.events WHERE brand_id=v_brand)<>v_count_before THEN
      RAISE EXCEPTION 'invalid_ari_create_left_event:%',v_invalid_label;
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.agent_operation_receipts WHERE operation_id=v_operation_id
    ) THEN RAISE EXCEPTION 'invalid_ari_create_left_receipt:%',v_invalid_label;END IF;
  END LOOP;

  -- Malformed legacy draft state must also fail through reconstruction and
  -- duplication, with no duplicate row or source mutation.
  UPDATE public.events SET theme=jsonb_set(
    theme,'{business_draft,requestedVisibility}','{}'::jsonb,true
  ) WHERE id=v_event_id;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE id=v_event_id;
  SELECT count(*) INTO v_count_before FROM public.events WHERE brand_id=v_brand;
  BEGIN
    PERFORM public.business_event_draft_payload_from_graph(v_event_id);
    RAISE EXCEPTION 'malformed_graph_readback_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='malformed_graph_readback_was_accepted' THEN RAISE;END IF;
    IF SQLERRM<>'event_visibility_invalid' THEN
      RAISE EXCEPTION 'malformed_graph_wrong_error:%',SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.business_duplicate_event_as_draft(v_event_id);
    RAISE EXCEPTION 'malformed_duplicate_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='malformed_duplicate_was_accepted' THEN RAISE;END IF;
    IF SQLERRM<>'event_visibility_invalid' THEN
      RAISE EXCEPTION 'malformed_duplicate_wrong_error:%',SQLERRM;
    END IF;
  END;
  IF (SELECT count(*) FROM public.events WHERE brand_id=v_brand)<>v_count_before
     OR (SELECT to_jsonb(e) FROM public.events e WHERE id=v_event_id)
        IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'malformed_duplicate_changed_graph';
  END IF;

  -- The final trigger is a direct-RPC backstop. It rejects a malformed legacy
  -- publish transition even if a caller bypasses the wrapper and adapter.
  BEGIN
    UPDATE public.events SET
      status='scheduled',visibility='public',
      theme=(theme-'business_draft')||jsonb_build_object(
        'business_event',theme->'business_draft'
      )
    WHERE id=v_event_id;
    RAISE EXCEPTION 'direct_publish_transition_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='direct_publish_transition_was_accepted' THEN RAISE;END IF;
    IF SQLERRM<>'event_visibility_invalid' THEN
      RAISE EXCEPTION 'direct_publish_transition_wrong_error:%',SQLERRM;
    END IF;
  END;
  IF (SELECT to_jsonb(e) FROM public.events e WHERE id=v_event_id)
       IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'direct_publish_transition_changed_graph';
  END IF;

  -- Every valid choice survives the complete publish -> unpublish -> republish
  -- lifecycle. Public maps to public, unlisted maps only to hidden, and private
  -- remains private; reconstruction restores the original user-facing value.
  FOREACH v_visibility IN ARRAY ARRAY['public','unlisted','private'] LOOP
    v_operation_id:=gen_random_uuid();
    v_payload:=jsonb_build_object(
      'brand_id',v_brand,'title','Lifecycle '||v_visibility,
      'when_mode','single','start_at','2028-11-15T18:00:00Z',
      'end_at','2028-11-15T22:00:00Z','timezone','Africa/Lagos',
      'visibility',v_visibility,'city','Lagos','location_text','Civic Centre',
      'currency','USD','party_types',jsonb_build_array('birthday-party'),
      'vibe_tags',jsonb_build_array('social'),
      'music_genres',jsonb_build_array('afrobeats'),
      'tickets',jsonb_build_array(jsonb_build_object(
        'id','round5-free','name','Invitation','priceGbp',0,'isFree',true,
        'isUnlimited',true,'visibility','public','displayOrder',0,
        'approvalRequired',false,'passwordProtected',false,
        'waitlistEnabled',false,'minPurchaseQty',1,'allowTransfers',true,
        'availableAt','both'))
    );
    INSERT INTO public.agent_pending_actions(
      id,user_id,tool_name,tool_args,status,source,related_brand_id,
      server_proposed_at,execution_attested_at
    ) VALUES(
      v_operation_id,v_user,'create_event',v_payload,'executing','hub_experience',
      v_brand,now(),now()
    );
    v_result:=public.ari_execute_event_operation(
      v_operation_id,'create_event',v_payload
    );
    v_event_id:=(v_result#>>'{event,id}')::uuid;
    v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
    PERFORM public.issue_1719_publish_event_with_poster(v_event_id,v_payload,0);
    v_expected:=CASE v_visibility WHEN 'unlisted' THEN 'hidden' ELSE v_visibility END;
    IF (SELECT visibility FROM public.events WHERE id=v_event_id)
         IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'publish_visibility_changed:%',v_visibility;
    END IF;

    PERFORM public.business_unpublish_event_to_draft(v_event_id);
    IF (SELECT theme#>>'{business_draft,requestedVisibility}'
        FROM public.events WHERE id=v_event_id) IS DISTINCT FROM v_visibility THEN
      RAISE EXCEPTION 'unpublish_visibility_changed:%',v_visibility;
    END IF;
    v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
    PERFORM public.issue_1719_publish_event_with_poster(v_event_id,v_payload,0);
    IF (SELECT visibility FROM public.events WHERE id=v_event_id)
         IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'republish_visibility_changed:%',v_visibility;
    END IF;

    -- A malformed live enum must fail closed before unpublish can rewrite it.
    UPDATE public.events SET visibility='draft' WHERE id=v_event_id;
    SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE id=v_event_id;
    BEGIN
      PERFORM public.business_unpublish_event_to_draft(v_event_id);
      RAISE EXCEPTION 'malformed_unpublish_was_accepted:%',v_visibility;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'malformed_unpublish_was_accepted:%' THEN RAISE;END IF;
      IF SQLERRM<>'event_visibility_invalid' THEN
        RAISE EXCEPTION 'malformed_unpublish_wrong_error:%:%',v_visibility,SQLERRM;
      END IF;
    END;
    IF (SELECT to_jsonb(e) FROM public.events e WHERE id=v_event_id)
         IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'malformed_unpublish_changed_graph:%',v_visibility;
    END IF;
    UPDATE public.events SET visibility=v_expected WHERE id=v_event_id;
  END LOOP;
END;
$test$;

ROLLBACK;
