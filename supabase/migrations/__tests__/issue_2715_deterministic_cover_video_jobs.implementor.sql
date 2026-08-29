BEGIN;

DO $test$
DECLARE
  v_user uuid := '27150000-0000-4000-8000-000000000001';
  v_brand uuid := '27150000-0000-4000-8000-000000000002';
  v_other_brand uuid := '27150000-0000-4000-8000-000000000010';
  v_venue uuid := '27150000-0000-4000-8000-000000000011';
  v_event uuid := '27150000-0000-4000-8000-000000000003';
  v_legacy_event uuid := '27150000-0000-4000-8000-000000000007';
  v_event_op uuid := '27150000-0000-4000-8000-000000000004';
  v_replacement_op uuid := '27150000-0000-4000-8000-000000000009';
  v_draft_op uuid := '27150000-0000-4000-8000-000000000005';
  v_missing_target_op uuid := '27150000-0000-4000-8000-000000000006';
  v_uncertain_op uuid := '27150000-0000-4000-8000-000000000012';
  v_first public.event_cover_video_jobs;
  v_replay public.event_cover_video_jobs;
  v_applied public.event_cover_video_jobs;
  v_draft public.event_cover_video_jobs;
  v_claim public.event_cover_video_jobs;
  v_loser public.event_cover_video_jobs;
  v_reconcile public.event_cover_video_jobs;
  v_lease_token uuid;
  v_url text := 'https://cdn.example.test/2715/final.mp4';
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_user,'issue-2715@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_user,'issue-2715@test.local','Issue 2715 Owner');
  INSERT INTO public.brands(id,account_id,name,slug,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 2715 Brand','issue-2715-brand',now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,created_at,updated_at)
    VALUES(v_other_brand,v_user,'Issue 2715 Other Brand','issue-2715-other-brand',now(),now());
  INSERT INTO public.venue_listings(id,brand_id,slug,name,lat,lng,venue_category,claim_status)
    VALUES(v_venue,v_brand,'issue2715venue','Issue 2715 Venue',40.7,-74.0,'restaurant','verified');
  INSERT INTO public.events(id,brand_id,created_by,title,slug,status,event_type,created_at,updated_at)
    VALUES(v_event,v_brand,v_user,'Issue 2715 Event','issue-2715-event','draft','event',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,status,event_type,created_at,updated_at)
    VALUES(v_legacy_event,v_brand,v_user,'Issue 2715 Legacy Event','issue-2715-legacy-event','draft','event',now(),now());

  BEGIN
    INSERT INTO public.event_cover_video_jobs(
      requested_by,event_id,brand_id,venue_id,provider,status,apply_mode,target_kind
    ) VALUES(v_user,NULL,v_other_brand,v_venue,'bunny','source_uploading','published_manual','venue');
    RAISE EXCEPTION '#2715 legacy venue-brand mismatch unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_venue_brand_mismatch' THEN RAISE; END IF;
  END;

  -- A12 migration gap: the legacy insert shape remains transition-safe while
  -- the final edge rejects it with 426 before this table is reached.
  INSERT INTO public.event_cover_video_jobs(
    requested_by,event_id,brand_id,provider,status,apply_mode,target_kind,
    source_asset_id,source_duration_ms,trim_start_ms,trim_end_ms
  ) VALUES(
    v_user,v_legacy_event,v_brand,'bunny','source_uploading','draft_auto','event',
    'legacy-guid',20000,0,20000
  ) RETURNING * INTO v_reconcile;
  v_reconcile := public.cover_video_cancel_once(v_reconcile.id);
  IF v_reconcile.status <> 'cancelled' THEN
    RAISE EXCEPTION '#2715 legacy migration-gap row could not transition';
  END IF;

  v_first := public.cover_video_create_or_replay_job(
    v_user,v_event_op,'event',v_event,v_brand,NULL,NULL,'draft_auto','bunny',
    'local.mp4','video/mp4','mp4',repeat('a',64),700000,4900,0,4900,true
  );
  v_replay := public.cover_video_create_or_replay_job(
    v_user,v_replacement_op,'event',v_event,v_brand,NULL,NULL,'draft_auto','bunny',
    'replacement.mp4','video/mp4','mp4',repeat('f',64),710000,5000,0,5000,false
  );
  IF v_replay IS NOT NULL OR
     (SELECT status FROM public.event_cover_video_jobs WHERE id=v_first.id) <> 'source_uploading' OR
     EXISTS(SELECT 1 FROM public.event_cover_video_jobs WHERE client_operation_id=v_replacement_op) THEN
    RAISE EXCEPTION '#2715 capacity preflight probe created replacement or superseded working job';
  END IF;
  v_replay := public.cover_video_create_or_replay_job(
    v_user,v_event_op,'event',v_event,v_brand,NULL,NULL,'draft_auto','bunny',
    'local.mp4','video/mp4','mp4',repeat('a',64),700000,4900,0,4900,true
  );
  IF v_first.id <> v_replay.id OR
     (SELECT count(*) FROM public.event_cover_video_jobs WHERE requested_by=v_user AND client_operation_id=v_event_op) <> 1 THEN
    RAISE EXCEPTION '#2715 duplicate event intent created another job';
  END IF;

  v_claim := public.cover_video_claim_provider_allocation(v_first.id,60);
  v_lease_token := v_claim.provider_allocation_token;
  v_loser := public.cover_video_claim_provider_allocation(v_first.id,60);
  IF v_lease_token IS NULL OR v_loser.id <> v_first.id OR v_loser.provider_allocation_token IS NOT NULL THEN
    RAISE EXCEPTION '#2715 allocation loser received or failed to reread winner lease truth';
  END IF;
  IF NOT public.cover_video_renew_provider_allocation(v_first.id,v_lease_token,60) THEN
    RAISE EXCEPTION '#2715 live allocation owner could not renew its lease';
  END IF;
  v_claim := public.cover_video_begin_provider_create(
    v_first.id,v_lease_token,v_first.id::text
  );
  IF v_claim.provider_allocation_uncertain_at IS NULL OR
     v_claim.provider_allocation_identity <> v_first.id::text THEN
    RAISE EXCEPTION '#2715 provider Create was not durably marked uncertain first';
  END IF;
  v_claim := public.cover_video_record_provider_allocation_attempt(
    v_first.id,v_lease_token,'event-guid','tus_create_network'
  );
  IF v_claim.source_asset_id <> 'event-guid' OR v_claim.status <> 'source_uploading' OR
     v_claim.provider_allocation_attempts <> 1 OR v_claim.provider_allocation_last_error <> 'tus_create_network' OR
     v_claim.provider_allocation_uncertain_at IS NOT NULL THEN
    RAISE EXCEPTION '#2715 uncertain provider allocation was not retained as active reconcilable truth';
  END IF;
  v_first := public.cover_video_commit_provider_allocation(
    v_first.id,v_lease_token,'event-guid','event-guid','https://tus.example.test/event',700000,now()+interval '1 hour'
  );
  IF v_first.source_asset_id <> 'event-guid' OR v_first.provider_allocation_token IS NOT NULL THEN
    RAISE EXCEPTION '#2715 provider allocation did not commit atomically';
  END IF;

  v_draft := public.cover_video_create_or_replay_job(
    v_user,v_draft_op,'venue_draft',NULL,v_brand,NULL,'draft-owner-cloud-a',
    'published_manual','bunny','cloud.mov','video/quicktime','mov',repeat('b',64),800000,5000,0,5000,true
  );
  IF (SELECT count(*) FROM public.event_cover_video_jobs WHERE brand_id=v_brand AND status='source_uploading') <> 2 THEN
    RAISE EXCEPTION '#2715 exact event and venue-draft targets collided';
  END IF;

  PERFORM public.cover_video_transition_job(v_draft.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}');
  PERFORM public.cover_video_transition_job(
    v_draft.id,ARRAY['source_uploaded'],'ready',4,100,
    jsonb_build_object('processed_url','https://cdn.example.test/2715/draft.mp4',
      'processed_poster_url','https://cdn.example.test/2715/draft.jpg',
      'processed_mime_type','video/mp4','processed_bytes',600000,'processed_duration_ms',5000,
      'processed_video_codec','h264','processed_audio_codec','aac')
  );
  v_replay := public.cover_video_cancel_once(v_draft.id);
  IF v_replay.status <> 'ready' THEN
    RAISE EXCEPTION '#2715 cancel/ready race destroyed authoritative ready truth';
  END IF;

  PERFORM public.cover_video_transition_job(v_first.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}');
  PERFORM public.cover_video_transition_job(v_first.id,ARRAY['source_uploaded'],'processing',2,63,'{}');
  PERFORM public.cover_video_transition_job(v_first.id,ARRAY['processing'],'processing',2,40,'{}');
  IF (SELECT provider_progress FROM public.event_cover_video_jobs WHERE id=v_first.id) <> 63 THEN
    RAISE EXCEPTION '#2715 provider progress regressed';
  END IF;
  PERFORM public.cover_video_transition_job(
    v_first.id,ARRAY['processing'],'ready',4,100,
    jsonb_build_object('processed_url',v_url,'processed_poster_url','https://cdn.example.test/2715/poster.jpg',
      'processed_mime_type','video/mp4','processed_bytes',600000,'processed_duration_ms',4900)
  );
  PERFORM public.cover_video_transition_job(v_first.id,ARRAY['ready'],'ready',4,100,'{}');

  v_applied := public.cover_video_apply_once(v_first.id,0,v_url,NULL);
  v_replay := public.cover_video_apply_once(v_first.id,0,v_url,NULL);
  IF v_applied.id <> v_replay.id OR v_replay.status <> 'applied' OR v_replay.application_version <> 1 THEN
    RAISE EXCEPTION '#2715 duplicate apply was not canonical/idempotent';
  END IF;
  IF (SELECT cover_media_url FROM public.events WHERE id=v_event) <> v_url THEN
    RAISE EXCEPTION '#2715 event target write missing';
  END IF;

  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      v_user,v_event_op,'event',v_event,v_brand,NULL,NULL,'draft_auto','bunny',
      'other.mp4','video/mp4','mp4',repeat('c',64),700000,4900,0,4900,true
    );
    RAISE EXCEPTION '#2715 immutable replay mismatch unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_operation_identity_mismatch' THEN RAISE; END IF;
  END;

  v_claim := public.cover_video_create_or_replay_job(
    v_user,v_uncertain_op,'venue_draft',NULL,v_brand,NULL,'uncertain-provider-create',
    'published_manual','bunny','uncertain.mov','video/quicktime','mov',repeat('9',64),810000,5100,0,5100,true
  );
  v_claim := public.cover_video_claim_provider_allocation(v_claim.id,60);
  v_lease_token := v_claim.provider_allocation_token;
  v_claim := public.cover_video_begin_provider_create(v_claim.id,v_lease_token,v_claim.id::text);
  UPDATE public.event_cover_video_jobs
    SET provider_allocation_lease_until=now()-interval '1 second'
    WHERE id=v_claim.id;
  SELECT claimed.* INTO v_reconcile
    FROM public.cover_video_claim_reconcile_jobs(100,60) claimed
    WHERE claimed.id=v_claim.id;
  IF v_reconcile.id IS DISTINCT FROM v_claim.id OR v_reconcile.source_asset_id IS NOT NULL OR
     v_reconcile.provider_allocation_uncertain_at IS NULL THEN
    RAISE EXCEPTION '#2715 null-GUID uncertain Create was not leased for reconciliation';
  END IF;
  -- The set-returning claim atomically leases the whole selected batch before
  -- this proof filters its output; release terminal fixtures for the ordering
  -- assertion below without changing the uncertain row under test.
  UPDATE public.event_cover_video_jobs
    SET reconcile_lease_token=NULL,reconcile_lease_until=NULL
    WHERE status IN ('failed','cancelled','superseded');

  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      v_user,'27150000-0000-4000-8000-000000000008','event',v_event,v_brand,NULL,NULL,'draft_auto','bunny',
      'wrong.mp4','video/webm','mp4',repeat('e',64),700000,4900,0,4900,true
    );
    RAISE EXCEPTION '#2715 mismatched MIME/container unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_source_type_not_allowed' THEN RAISE; END IF;
  END;

  v_first := public.cover_video_create_or_replay_job(
    v_user,v_missing_target_op,'event',v_event,v_brand,NULL,NULL,'draft_auto','bunny',
    'missing.mp4','video/mp4','mp4',repeat('d',64),700000,4900,0,4900,true
  );
  PERFORM public.cover_video_transition_job(v_first.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}');
  PERFORM public.cover_video_transition_job(
    v_first.id,ARRAY['source_uploaded'],'ready',4,100,
    jsonb_build_object('processed_url','https://cdn.example.test/2715/missing.mp4',
      'processed_poster_url','https://cdn.example.test/2715/missing.jpg',
      'processed_mime_type','video/mp4','processed_bytes',600000,'processed_duration_ms',4900,
      'processed_video_codec','h264','processed_audio_codec','aac')
  );
  UPDATE public.events SET deleted_at=now() WHERE id=v_event;
  v_replay := public.cover_video_apply_once(
    v_first.id,0,'https://cdn.example.test/2715/missing.mp4',NULL
  );
  IF v_replay.status <> 'ready' OR v_replay.application_version <> 0 THEN
    RAISE EXCEPTION '#2715 zero-row target apply was marked applied';
  END IF;

  BEGIN
    UPDATE public.event_cover_video_jobs SET draft_owner_key='cross-attach' WHERE client_operation_id=v_draft_op;
    RAISE EXCEPTION '#2715 immutable identity update unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_identity_immutable' THEN RAISE; END IF;
  END;


  SELECT * INTO v_reconcile FROM public.cover_video_claim_reconcile_jobs(1,60);
  IF v_reconcile.status <> 'cancelled' OR v_reconcile.reconcile_lease_token IS NULL OR
     v_reconcile.reconcile_lease_until <= now() THEN
    RAISE EXCEPTION '#2715 reconciler did not lease terminal cleanup first';
  END IF;

  IF EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='event_cover_video_jobs'
      AND qual LIKE '%e.brand_id = e.brand_id%'
  ) THEN
    RAISE EXCEPTION '#2715 event RLS lost outer target brand coherence';
  END IF;
END
$test$;

ROLLBACK;
