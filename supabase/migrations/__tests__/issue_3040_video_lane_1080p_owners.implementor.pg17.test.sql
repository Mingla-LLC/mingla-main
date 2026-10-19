-- Issue #3040 (T-SQL-LANE, T-C12 SQL half): the 1080p lane migration contract.
-- Invariant I-VIDEO-LIMITS-PARITY (declared in packages/video-upload/__tests__/purity_and_parity.test.mjs): DB caps equal packages/video-upload/limits.js
-- Invariant I-AD-VIDEO-MIN-5S (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_ad_min_duration.test.ts): an ad_creative source shorter than 5 s is refused by the DB; covers have no minimum
-- Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): ready may fail only with an owned failure code
-- Invariant I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE (declared in supabase/functions/_shared/__tests__/adCreativeHouseProvenance.issue3040.test.ts): provenance is immutable
-- Invariant I-VIDEO-NO-DESTROY-WHILE-REFERENCED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_orphan_reclaim.test.ts): live references are reported per surface
--
-- FAILS ON REVERT: drop 20271108003040 (or any single clause below) and the
-- matching assertion raises: brandless ad_creative insert, the 100 MiB source
-- CHECK, the 5 s ad minimum, the 64 MiB processed cap, the owned ready->failed
-- edge, the ad_creative apply gate, the provenance trigger.
BEGIN;

DO $test$
DECLARE
  v_admin uuid := '30400000-0000-4000-8000-000000000301';
  v_host uuid := '30400000-0000-4000-8000-000000000302';
  v_brand uuid := '30400000-0000-4000-8000-000000000303';
  v_event uuid := '30400000-0000-4000-8000-000000000304';
  v_house public.event_cover_video_jobs;
  v_cover public.event_cover_video_jobs;
  v_job public.event_cover_video_jobs;
  v_creative uuid;
  v_kinds text[];
  v_raised boolean;
  v_count bigint;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_admin,'issue-3040-lane-admin@test.local'),
    (v_host,'issue-3040-lane-host@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_host,'issue-3040-lane-host@test.local','Issue 3040 Lane Host');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_host,'Issue 3040 Lane Brand','issue-3040-lane-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme,cover_media_url)
    VALUES(v_event,v_brand,v_host,'Issue 3040 Lane','issue-3040-lane','event','draft','draft','UTC','USD',
      '{"business_draft":{"clientRevision":0}}'::jsonb,'https://cdn.example.test/prior/cover.jpg');

  -- 1. A brandless (house) ad_creative job is accepted.
  v_house := public.cover_video_create_or_replay_job(
    v_admin,'30400000-0000-4000-8000-000000000311','ad_creative',NULL,NULL,NULL,'admin-library:'||v_admin,
    'published_manual','bunny','house.mp4','video/mp4','mp4',repeat('a',64),2000000,8000,0,8000,true);
  IF v_house.id IS NULL OR v_house.brand_id IS NOT NULL OR v_house.status <> 'source_uploading' THEN
    RAISE EXCEPTION '#3040 brandless ad_creative job was not created';
  END IF;

  -- 2. brand_id NULL on any other target is a check violation.
  v_raised := false;
  BEGIN
    INSERT INTO public.event_cover_video_jobs(requested_by,target_kind,event_id,brand_id,provider,status,apply_mode,trim_end_ms)
      VALUES(v_host,'event',v_event,NULL,'bunny','failed','published_manual',1000);
  EXCEPTION WHEN check_violation OR raise_exception THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 brandless event job was accepted'; END IF;

  -- 3. A source over 100 MiB raises.
  v_raised := false;
  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      v_host,'30400000-0000-4000-8000-000000000312','trip_day_media',v_event,v_brand,NULL,NULL,
      'published_manual','bunny','big.mp4','video/mp4','mp4',repeat('b',64),104857601,30000,0,30000,true);
  EXCEPTION WHEN check_violation OR raise_exception THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 a 104857601-byte source was accepted'; END IF;

  -- 4. An ad video under 5 s raises; a 3 s cover video is accepted.
  v_raised := false;
  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      v_admin,'30400000-0000-4000-8000-000000000313','ad_creative',NULL,NULL,NULL,'admin-library:'||v_admin,
      'published_manual','bunny','short.mp4','video/mp4','mp4',repeat('c',64),900000,4999,0,4999,true);
  EXCEPTION WHEN check_violation OR raise_exception THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 a 4999 ms ad video was accepted'; END IF;
  v_raised := false;
  BEGIN
    INSERT INTO public.event_cover_video_jobs(requested_by,target_kind,brand_id,draft_owner_key,provider,status,apply_mode,
      source_duration_ms,trim_end_ms)
      VALUES(v_admin,'ad_creative',NULL,'admin-library:legacy','bunny','failed','published_manual',4999,4999);
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 event_cover_video_jobs_ad_min_duration did not refuse 4999 ms'; END IF;
  v_cover := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-000000000314','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','short-cover.mp4','video/mp4','mp4',repeat('d',64),900000,3000,0,3000,true);
  IF v_cover.status <> 'source_uploading' THEN RAISE EXCEPTION '#3040 a 3 s cover video was refused'; END IF;

  -- 5. The event cover captured at intent is recorded for the ready owner.
  IF v_cover.target_cover_base_url IS DISTINCT FROM 'https://cdn.example.test/prior/cover.jpg' THEN
    RAISE EXCEPTION '#3040 target_cover_base_url was not captured: %', v_cover.target_cover_base_url;
  END IF;

  -- 6. The processed cap is 64 MiB.
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-3040-cover-0001' WHERE id=v_cover.id;
  v_job := public.cover_video_transition_job(v_cover.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_raised := false;
  BEGIN
    PERFORM public.cover_video_transition_job(v_cover.id,ARRAY['source_uploaded'],'ready',3,100,
      jsonb_build_object('processed_url','https://cdn.example.test/guid-3040-cover-0001/play_1080p.mp4',
        'processed_mime_type','video/mp4','processed_bytes',67108865,'processed_duration_ms',3000));
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 a 67108865-byte derivative was accepted'; END IF;
  v_job := public.cover_video_transition_job(v_cover.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.example.test/guid-3040-cover-0001/play_1080p.mp4',
      'processed_poster_url','https://cdn.example.test/guid-3040-cover-0001/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',67108864,'processed_duration_ms',3000));
  IF v_job.status <> 'ready' THEN RAISE EXCEPTION '#3040 a 64 MiB derivative was refused'; END IF;

  -- 7. ready -> failed only with an owned failure code.
  v_job := public.cover_video_transition_job(v_cover.id,ARRAY['ready'],'failed',NULL,NULL,
    jsonb_build_object('failure_code','provider_failed'));
  IF v_job.status <> 'ready' THEN RAISE EXCEPTION '#3040 ready failed with an unowned code'; END IF;
  v_job := public.cover_video_transition_job(v_cover.id,ARRAY['ready'],'failed',NULL,NULL,
    jsonb_build_object('failure_code','ready_unclaimed','failure_message','x'));
  IF v_job.status <> 'failed' OR v_job.failure_code <> 'ready_unclaimed' THEN
    RAISE EXCEPTION '#3040 ready did not fail with ready_unclaimed';
  END IF;

  -- 8. apply_once on an ad_creative job waits for its creative row.
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-3040-house-0001' WHERE id=v_house.id;
  v_job := public.cover_video_transition_job(v_house.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_job := public.cover_video_transition_job(v_house.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.example.test/guid-3040-house-0001/play_1080p.mp4',
      'processed_poster_url','https://cdn.example.test/guid-3040-house-0001/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',8000));
  v_job := public.cover_video_apply_once(v_job.id,v_job.application_version,v_job.processed_url,NULL);
  IF v_job.status <> 'ready' THEN RAISE EXCEPTION '#3040 ad_creative applied without a creative row'; END IF;
  -- A different client caller is refused even when the row exists.
  INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,
      created_by,source,source_job_id,rendition_height)
    VALUES('video','house','https://cdn.example.test/guid-3040-house-0001/play_1080p.mp4','guid-3040-house-0001',
      'https://cdn.example.test/guid-3040-house-0001/thumbnail.jpg',
      'https://cdn.example.test/guid-3040-house-0001/play_1080p.mp4',NULL,repeat('e',64),v_admin,'admin_upload',v_house.id,1080)
    RETURNING id INTO v_creative;
  v_job := public.cover_video_apply_once(v_job.id,v_job.application_version,v_job.processed_url,v_host);
  IF v_job.status <> 'ready' THEN RAISE EXCEPTION '#3040 another user applied an admin ad video'; END IF;
  v_job := public.cover_video_apply_once(v_job.id,v_job.application_version,v_job.processed_url,v_admin);
  IF v_job.status <> 'applied' THEN RAISE EXCEPTION '#3040 ad_creative did not apply once its creative existed'; END IF;

  -- 9. Provenance is immutable; source is constrained and defaulted.
  v_raised := false;
  BEGIN
    UPDATE public.ad_creatives SET source='host_upload' WHERE id=v_creative;
  EXCEPTION WHEN raise_exception THEN
    v_raised := SQLERRM = 'ad_creative_provenance_immutable';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 ad_creatives.source was mutable'; END IF;
  v_raised := false;
  BEGIN
    UPDATE public.ad_creatives SET bunny_video_id='guid-3040-other-0001' WHERE id=v_creative;
  EXCEPTION WHEN raise_exception THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 ad_creatives.bunny_video_id was mutable'; END IF;
  UPDATE public.ad_creatives SET name='renamed' WHERE id=v_creative;
  v_raised := false;
  BEGIN
    INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,source) VALUES('image','x','https://x.test/a.jpg',repeat('f',64),'stolen');
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 an unknown creative source was accepted'; END IF;
  INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,brand_id)
    VALUES('image','legacy writer','https://x.test/b.jpg',repeat('1',64),v_brand);
  IF (SELECT source FROM public.ad_creatives WHERE name='legacy writer') <> 'host_upload' THEN
    RAISE EXCEPTION '#3040 an older writer without source was not defaulted to host_upload';
  END IF;
  v_raised := false;
  BEGIN
    INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,content_hash,source,source_job_id)
      VALUES('video','dup','https://x.test/c.mp4','guid-3040-house-0001','https://x.test/c.jpg',repeat('2',64),'admin_upload',v_house.id);
  EXCEPTION WHEN unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 two creatives were materialized from one job'; END IF;

  -- 10. Live references.
  UPDATE public.events SET cover_media_url='https://cdn.example.test/guid-3040-cover-0001/play_1080p.mp4' WHERE id=v_event;
  v_kinds := public.cover_video_guid_live_references('guid-3040-cover-0001',v_cover.id);
  IF NOT ('event_cover' = ANY(v_kinds)) THEN RAISE EXCEPTION '#3040 a live event cover was not reported: %', v_kinds; END IF;
  v_kinds := public.cover_video_guid_live_references('guid-3040-house-0001',v_house.id);
  IF NOT ('ad_creative' = ANY(v_kinds)) THEN RAISE EXCEPTION '#3040 a live ad creative was not reported: %', v_kinds; END IF;
  v_kinds := public.cover_video_guid_live_references('guid-3040-house-0001',NULL);
  IF NOT ('active_job' = ANY(v_kinds)) THEN RAISE EXCEPTION '#3040 the applied job was not reported without exclusion'; END IF;
  v_kinds := public.cover_video_guid_live_references('guid-3040-nobody-0001',NULL);
  IF cardinality(v_kinds) <> 0 THEN RAISE EXCEPTION '#3040 an unreferenced guid reported %', v_kinds; END IF;
  UPDATE public.events SET deleted_at=now() WHERE id=v_event;
  v_kinds := public.cover_video_guid_live_references('guid-3040-cover-0001',v_cover.id);
  IF 'event_cover' = ANY(v_kinds) THEN RAISE EXCEPTION '#3040 a soft-deleted event still counted as a live reference'; END IF;
  v_raised := false;
  BEGIN
    PERFORM public.cover_video_guid_live_references('%',NULL);
  EXCEPTION WHEN raise_exception THEN v_raised := SQLERRM = 'cover_video_guid_invalid';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '#3040 a wildcard guid was not refused'; END IF;

  -- 11. The lane health view is readable and counts ready-unclaimed jobs.
  SELECT ready_unclaimed_count INTO v_count FROM public.cover_video_lane_health_v;
  IF v_count IS NULL THEN RAISE EXCEPTION '#3040 lane health view returned no row'; END IF;

  -- 12. Client roles cannot call the new RPCs or read the view.
  IF has_function_privilege('authenticated','public.cover_video_guid_live_references(text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.cover_video_extend_transport_lease(uuid,timestamptz)','EXECUTE')
     OR has_table_privilege('authenticated','public.cover_video_lane_health_v','SELECT') THEN
    RAISE EXCEPTION '#3040 a privileged lane object leaked to a client role';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_video_lane_1080p_owners.implementor.pg17: PASS'
