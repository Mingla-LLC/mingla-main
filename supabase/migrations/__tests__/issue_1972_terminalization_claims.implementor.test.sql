\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '19720000-0000-4000-8000-000000000071';
  v_brand constant uuid := '19720000-0000-4000-8000-000000000072';
  v_operation constant uuid := '19720000-0000-4000-8000-000000000073';
  v_denied_authenticated constant uuid := '19720000-0000-4000-8000-000000000074';
  v_denied_anon constant uuid := '19720000-0000-4000-8000-000000000075';
  v_denied_scalar constant uuid := '19720000-0000-4000-8000-000000000076';
  v_selection constant text := 'issue-1972-claims-cover-valid';
  v_cover_url text;
  v_cover_result jsonb;
  v_args jsonb;
  v_result jsonb;
  v_terminal jsonb;
  v_replay jsonb;
  v_event_id uuid;
  v_event_count integer;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-terminal@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-terminal@example.invalid','Issue 1972 Terminal');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Terminal Events','issue-1972-terminal-events','USD');

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_user,'role','authenticated')::text,
    true
  );
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_args:=jsonb_build_object(
    'brand_id',v_brand,
    'title','Receipt recovery launch',
    'visibility','public',
    'when_mode','single',
    'start_at','2028-11-14T20:00:00Z',
    'end_at','2028-11-14T22:00:00Z',
    'timezone','America/New_York',
    'city','New York',
    'party_types',jsonb_build_array('birthday-party'),
    'vibe_tags',jsonb_build_array('social'),
    'music_genres',jsonb_build_array('house'),
    'tickets',jsonb_build_array(jsonb_build_object(
      'id','recovery-free',
      'name','Free',
      'priceGbp',0,
      'isFree',true,
      'isUnlimited',true,
      'visibility','public',
      'displayOrder',0,
      'approvalRequired',false,
      'passwordProtected',false,
      'waitlistEnabled',false,
      'minPurchaseQty',1,
      'allowTransfers',true,
      'availableAt','both'
    ))
  );
  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES(
    v_operation,v_user,'create_event',v_args,'executing','hub_experience',
    v_brand,now(),now()
  );

  -- Commit the domain effect and operation receipt while deliberately leaving
  -- the proposal executing, matching the exact lost-terminal-response state.
  v_result:=public.ari_execute_event_operation(v_operation,'create_event',v_args);
  v_event_id:=(v_result#>>'{event,id}')::uuid;
  SELECT count(*) INTO v_event_count FROM public.events WHERE brand_id=v_brand;
  IF v_event_id IS NULL OR v_event_count<>1
     OR (SELECT count(*) FROM public.agent_operation_receipts
         WHERE operation_id=v_operation)<>1
     OR (SELECT status FROM public.agent_pending_actions
         WHERE id=v_operation)<>'executing'
     OR EXISTS(
       SELECT 1 FROM public.agent_pending_action_terminal_receipts
       WHERE pending_action_id=v_operation
     ) THEN
    RAISE EXCEPTION 'failed to establish one stranded committed receipt';
  END IF;

  -- Real PostgREST service requests populate only the canonical claims JSON.
  PERFORM set_config('request.jwt.claim.role','',true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role','service_role')::text,
    true
  );
  SELECT to_jsonb(row) INTO v_terminal
  FROM public.terminalize_agent_pending_action(
    v_operation,v_user,'executing','executed',NULL,NULL,
    'tenant-v1','test-model',true
  ) row;
  SELECT to_jsonb(row) INTO v_replay
  FROM public.terminalize_agent_pending_action(
    v_operation,v_user,'executing','executed',NULL,NULL,
    'tenant-v1','test-model',true
  ) row;

  IF v_terminal->>'status'<>'executed'
     OR (v_terminal->>'cas_won')::boolean IS NOT TRUE
     OR (v_replay->>'replay')::boolean IS NOT TRUE
     OR v_terminal->'executed_result' IS DISTINCT FROM v_result
     OR v_replay->'executed_result' IS DISTINCT FROM v_result
     OR (SELECT count(*) FROM public.events WHERE brand_id=v_brand)<>v_event_count
     OR (SELECT count(*) FROM public.agent_operation_receipts
         WHERE operation_id=v_operation)<>1
     OR (SELECT count(*) FROM public.agent_pending_action_terminal_receipts
         WHERE pending_action_id=v_operation)<>1 THEN
    RAISE EXCEPTION 'claims-json recovery repeated or failed to terminalize the effect';
  END IF;

  INSERT INTO public.agent_pending_actions(
    id,user_id,tool_name,tool_args,status,source,related_brand_id,server_proposed_at
  ) VALUES
    (v_denied_authenticated,v_user,'discard_event_draft',
      jsonb_build_object('event_id',v_event_id),'pending','hub_experience',v_brand,now()),
    (v_denied_anon,v_user,'discard_event_draft',
      jsonb_build_object('event_id',v_event_id),'pending','hub_experience',v_brand,now()),
    (v_denied_scalar,v_user,'discard_event_draft',
      jsonb_build_object('event_id',v_event_id),'pending','hub_experience',v_brand,now());

  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  BEGIN
    PERFORM public.terminalize_agent_pending_action(
      v_denied_authenticated,v_user,'pending','cancelled',NULL,NULL,
      'tenant-v1','test-model',false
    );
    RAISE EXCEPTION 'authenticated claims terminalized server-owned state';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_terminal_attestation_required%' THEN RAISE;END IF;
  END;

  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  BEGIN
    PERFORM public.terminalize_agent_pending_action(
      v_denied_anon,v_user,'pending','cancelled',NULL,NULL,
      'tenant-v1','test-model',false
    );
    RAISE EXCEPTION 'anonymous claims terminalized server-owned state';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_terminal_attestation_required%' THEN RAISE;END IF;
  END;

  -- A forged/stale dotted scalar never overrides the signed claims object.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  BEGIN
    PERFORM public.terminalize_agent_pending_action(
      v_denied_scalar,v_user,'pending','cancelled',NULL,NULL,
      'tenant-v1','test-model',false
    );
    RAISE EXCEPTION 'legacy scalar role overrode canonical claims';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_terminal_attestation_required%' THEN RAISE;END IF;
  END;

  IF EXISTS(
    SELECT 1 FROM public.agent_pending_actions
    WHERE id IN(v_denied_authenticated,v_denied_anon,v_denied_scalar)
      AND status<>'pending'
  ) OR EXISTS(
    SELECT 1 FROM public.agent_pending_action_terminal_receipts
    WHERE pending_action_id IN(
      v_denied_authenticated,v_denied_anon,v_denied_scalar
    )
  ) THEN
    RAISE EXCEPTION 'denied caller changed terminal state';
  END IF;

  v_cover_url:=
    'https://local.invalid/storage/v1/object/public/event_covers/'
    ||v_brand::text||'/'||v_event_id::text||'/claims-cover.jpg';
  INSERT INTO storage.objects(bucket_id,name,owner)
  VALUES(
    'event_covers',
    v_brand::text||'/'||v_event_id::text||'/claims-cover.jpg',
    v_user
  );

  -- The cover attestation Edge path uses the same claims-only service client.
  PERFORM set_config('request.jwt.claim.role','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  v_cover_result:=public.business_register_event_cover_selection(
    v_user,v_event_id,v_selection,v_cover_url,'image',v_cover_url,
    'upload',NULL,'Issue 1972','https://example.invalid/credit','Cover alt'
  );
  IF v_cover_result->>'selection_ref' IS DISTINCT FROM v_selection
     OR (v_cover_result->>'event_id')::uuid IS DISTINCT FROM v_event_id
     OR (v_cover_result->>'expires_at')::timestamptz NOT BETWEEN now()
       AND now()+interval '31 minutes'
     OR (SELECT count(*) FROM public.event_cover_selections
         WHERE user_id=v_user AND event_id=v_event_id)<>1
     OR NOT EXISTS(
       SELECT 1 FROM public.event_cover_selections
       WHERE selection_ref=v_selection
         AND user_id=v_user
         AND event_id=v_event_id
         AND media_url=v_cover_url
         AND media_type='image'
         AND poster_url=v_cover_url
         AND provider='upload'
         AND source_url IS NULL
         AND credit='Issue 1972'
         AND credit_url='https://example.invalid/credit'
         AND alt='Cover alt'
         AND consumed_at IS NULL
         AND expires_at BETWEEN now() AND now()+interval '31 minutes'
     ) THEN
    RAISE EXCEPTION 'claims-only cover attestation was not persisted exactly';
  END IF;

  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  BEGIN
    PERFORM public.business_register_event_cover_selection(
      v_user,v_event_id,'issue-1972-cover-auth-denied',v_cover_url,'image',
      v_cover_url,'upload',NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'authenticated claims minted a trusted cover selection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;

  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  BEGIN
    PERFORM public.business_register_event_cover_selection(
      v_user,v_event_id,'issue-1972-cover-anon-denied',v_cover_url,'image',
      v_cover_url,'upload',NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'anonymous claims minted a trusted cover selection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;

  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  BEGIN
    PERFORM public.business_register_event_cover_selection(
      v_user,v_event_id,'issue-1972-cover-scalar-denied',v_cover_url,'image',
      v_cover_url,'upload',NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'legacy scalar overrode canonical cover claims';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;

  PERFORM set_config('request.jwt.claims','not-json',true);
  BEGIN
    PERFORM public.business_register_event_cover_selection(
      v_user,v_event_id,'issue-1972-cover-malformed-denied',v_cover_url,'image',
      v_cover_url,'upload',NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'malformed claims minted a trusted cover selection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;

  PERFORM set_config('request.jwt.claims','',true);
  BEGIN
    PERFORM public.business_register_event_cover_selection(
      v_user,v_event_id,'issue-1972-cover-absent-denied',v_cover_url,'image',
      v_cover_url,'upload',NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'absent claims minted a trusted cover selection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;

  PERFORM set_config('request.jwt.claims','"service_role"',true);
  BEGIN
    PERFORM public.business_register_event_cover_selection(
      v_user,v_event_id,'issue-1972-cover-nonobject-denied',v_cover_url,'image',
      v_cover_url,'upload',NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'non-object claims minted a trusted cover selection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%trusted_cover_attestation_required%' THEN RAISE;END IF;
  END;

  IF (SELECT count(*) FROM public.event_cover_selections
      WHERE user_id=v_user AND event_id=v_event_id)<>1 THEN
    RAISE EXCEPTION 'denied cover caller changed selection state';
  END IF;
END;
$test$;

ROLLBACK;
