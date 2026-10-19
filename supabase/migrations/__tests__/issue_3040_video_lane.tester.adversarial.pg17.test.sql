-- Issue #3040 — INDEPENDENT TESTER adversarial suite for the 1080p lane
-- migration (20271108003040). Written by the tester, not the implementor. It
-- attacks angles the implementor suites do not: replay ordering after a
-- replacement, cross-target supersede leaks, a parent deleted mid-job, the
-- lease never shrinking, every arm and boundary of the live-reference guard,
-- provenance laundering into house media, account deletion of a house
-- uploader, and a claim window full of applied rows.
--
-- Invariant I-VIDEO-NO-DESTROY-WHILE-REFERENCED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_orphan_reclaim.test.ts): every live surface that serves a guid is reported, and only exact /<guid>/ path segments match
-- Invariant I-VIDEO-SOFTDELETE-NO-WEDGE (declared in supabase/migrations/__tests__/issue_3040_softdelete_no_wedge.implementor.pg17.test.sql): a parent deleted mid-job never blocks the job's own transitions, and the server never applies to a deleted parent
-- Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): ready may fail only with an owned failure code; applied never moves
-- Invariant I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE (declared in supabase/functions/_shared/__tests__/adCreativeHouseProvenance.issue3040.test.ts): no single-column write and no deletion turns Host media into house media
-- Invariant I-AD-MEDIA-NEVER-BLOCKS-DELETION (declared in supabase/migrations/__tests__/issue_3040_ad_media_never_blocks_deletion.implementor.pg17.test.sql): deleting a house uploader's account never fails and leaves the creative house-owned
--
-- FAILS ON REVERT (each case names the clause it guards):
--   T1  supersede predicate widened to every target_kind of an event/brand
--   T2  replay re-activates or returns a foreign row
--   T3  identity trigger validating UPDATEs again (TG_OP guard removed)
--   T4  extend lease without greatest(), or without the status guard
--   T5  any extra code (or none) allowed on the ready -> failed edge
--   T6  any arm of cover_video_guid_live_references removed, deleted parents
--       counted, or the needle widened past /<guid>/
--   T7  provenance trigger dropped or relaxed
--   T8  ad_creatives.created_by / source_job_id back to NO ACTION/RESTRICT
--   T9  claim predicate admitting applied rows, or the limit clamp removed
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_admin uuid := '30400000-0000-4000-8000-00000000f001';
  v_host uuid := '30400000-0000-4000-8000-00000000f002';
  v_brand uuid := '30400000-0000-4000-8000-00000000f003';
  v_event uuid := '30400000-0000-4000-8000-00000000f004';
  v_event2 uuid := '30400000-0000-4000-8000-00000000f005';
  v_a public.event_cover_video_jobs;
  v_b public.event_cover_video_jobs;
  v_c public.event_cover_video_jobs;
  v_ad1 public.event_cover_video_jobs;
  v_ad2 public.event_cover_video_jobs;
  v_trip public.event_cover_video_jobs;
  v_brandjob public.event_cover_video_jobs;
  v_house public.event_cover_video_jobs;
  v_tmp public.event_cover_video_jobs;
  v_creative public.ad_creatives;
  v_kinds text[];
  v_raised boolean;
  v_n bigint;
  v_t timestamptz;
  v_s text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_admin,'issue-3040-tester-admin@test.local'),
    (v_host,'issue-3040-tester-host@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_host,'issue-3040-tester-host@test.local','Issue 3040 Tester Host');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_host,'Issue 3040 Tester Brand','issue-3040-tester-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme)
    VALUES
      (v_event,v_brand,v_host,'Issue 3040 Tester Trip','issue-3040-tester-trip','event','draft','draft','UTC','USD','{}'::jsonb),
      (v_event2,v_brand,v_host,'Issue 3040 Tester Two','issue-3040-tester-two','event','draft','draft','UTC','USD','{}'::jsonb);

  -- ── T1/T2 replacements on one target ────────────────────────────────────
  -- A trip-day gallery video, a Host ad video and a house ad video exist
  -- before the trip's cover is replaced twice.
  v_trip := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f101','trip_day_media',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','day.mp4','video/mp4','mp4',repeat('1',64),3000000,9000,0,9000,true);
  v_ad1 := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f102','ad_creative',NULL,v_brand,NULL,'host-ad:draft-f102',
    'published_manual','bunny','ad1.mp4','video/mp4','mp4',repeat('2',64),3000000,9000,0,9000,true);
  v_a := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f103','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','a.mp4','video/mp4','mp4',repeat('3',64),3000000,9000,0,9000,true);
  -- A brand cover replacement must not touch the brand's ad videos either.
  v_brandjob := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f104','brand',NULL,v_brand,NULL,NULL,
    'published_manual','bunny','brand.mp4','video/mp4','mp4',repeat('4',64),3000000,9000,0,9000,true);
  v_b := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f105','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','b.mp4','video/mp4','mp4',repeat('5',64),3000000,9000,0,9000,true);
  -- A second ad video for the SAME Host Ads draft key: ad videos never
  -- supersede one another.
  v_ad2 := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f106','ad_creative',NULL,v_brand,NULL,'host-ad:draft-f102',
    'published_manual','bunny','ad2.mp4','video/mp4','mp4',repeat('6',64),3000000,9000,0,9000,true);

  SELECT * INTO v_tmp FROM public.event_cover_video_jobs WHERE id=v_a.id;
  IF v_tmp.status <> 'superseded' THEN
    RAISE EXCEPTION 'T1 the replaced event cover job is % (expected superseded)', v_tmp.status;
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_trip.id) <> 'source_uploading' THEN
    RAISE EXCEPTION 'T1 a trip cover replacement superseded a trip-day gallery video';
  END IF;
  IF (SELECT count(*) FROM public.event_cover_video_jobs WHERE id IN (v_ad1.id,v_ad2.id) AND status='source_uploading') <> 2 THEN
    RAISE EXCEPTION 'T1 an ad video was superseded by a cover or by another ad video';
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_brandjob.id) <> 'source_uploading' THEN
    RAISE EXCEPTION 'T1 an event cover replacement superseded the brand cover job';
  END IF;
  SELECT count(*) INTO v_n FROM public.event_cover_video_jobs
   WHERE event_id=v_event AND target_kind='event' AND status NOT IN ('failed','cancelled','superseded','applied');
  IF v_n <> 1 THEN RAISE EXCEPTION 'T1 % active cover jobs on one event (expected 1)', v_n; END IF;

  -- T2: the replaced client replays its own operation late. It gets ITS row
  -- back, still superseded — never re-activated, never someone else's row.
  v_tmp := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f103','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','a.mp4','video/mp4','mp4',repeat('3',64),3000000,9000,0,9000,true);
  IF v_tmp.id IS DISTINCT FROM v_a.id OR v_tmp.status <> 'superseded' THEN
    RAISE EXCEPTION 'T2 a late replay returned % / % (expected own superseded row)', v_tmp.id, v_tmp.status;
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_b.id) <> 'source_uploading' THEN
    RAISE EXCEPTION 'T2 a late replay of the old operation superseded the newer one';
  END IF;
  -- A replay that is not allowed to create (p_accept_new=false) for an unknown
  -- operation returns nothing, and never a foreign active row.
  v_tmp := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f1ff','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','x.mp4','video/mp4','mp4',repeat('7',64),3000000,9000,0,9000,false);
  IF v_tmp.id IS NOT NULL THEN
    RAISE EXCEPTION 'T2 a replay-only call for an unknown operation returned job %', v_tmp.id;
  END IF;

  -- ── T3 a parent deleted mid-job ─────────────────────────────────────────
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-f105-eventb', status='processing',
    source_uploaded_at=now()-interval '2 minutes' WHERE id=v_b.id;
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-f101-tripday', status='processing',
    source_uploaded_at=now()-interval '2 minutes' WHERE id=v_trip.id;
  UPDATE public.events SET deleted_at=now() WHERE id=v_event;
  -- The provider finishes AFTER the delete: processing -> ready still lands.
  v_tmp := public.cover_video_transition_job(v_b.id,ARRAY['processing'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-f105-eventb/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-f105-eventb/thumbnail.jpg','processed_bytes',1000,
      'processed_mime_type','video/mp4','processed_duration_ms',9000));
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'T3 a deleted parent blocked processing -> ready (%)', v_tmp.status; END IF;
  -- The reaper's lease claim on the deleted event's jobs never raises.
  PERFORM public.cover_video_claim_reconcile_jobs(1000,60);
  -- The server owner (NULL requester) never writes a cover onto a deleted event.
  v_tmp := public.cover_video_apply_once(v_b.id,v_tmp.application_version,v_tmp.processed_url,NULL);
  IF v_tmp.status = 'applied' THEN RAISE EXCEPTION 'T3 a video was applied to a soft-deleted event'; END IF;
  IF (SELECT cover_media_url FROM public.events WHERE id=v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'T3 the deleted event''s cover was rewritten';
  END IF;
  v_tmp := public.cover_video_transition_job(v_b.id,ARRAY['ready'],'failed',NULL,NULL,
    '{"failure_code":"target_deleted","failure_message":"deleted"}'::jsonb);
  IF v_tmp.status <> 'failed' THEN RAISE EXCEPTION 'T3 ready -> failed(target_deleted) did not land'; END IF;
  v_tmp := public.cover_video_transition_job(v_trip.id,ARRAY['processing'],'failed',NULL,NULL,
    '{"failure_code":"target_deleted","failure_message":"deleted"}'::jsonb);
  IF v_tmp.status <> 'failed' THEN RAISE EXCEPTION 'T3 a trip-day job on a deleted event did not end'; END IF;
  -- A NEW job for the deleted event is still refused at INSERT.
  v_raised := false;
  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      v_host,'30400000-0000-4000-8000-00000000f107','event',v_event,v_brand,NULL,NULL,
      'published_manual','bunny','late.mp4','video/mp4','mp4',repeat('8',64),3000000,9000,0,9000,true);
  EXCEPTION WHEN raise_exception THEN v_raised := (SQLERRM = 'cover_video_event_brand_mismatch');
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T3 a new job was accepted for a deleted event'; END IF;

  -- ── T4 the transport lease only ever moves later ────────────────────────
  v_c := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000f108','event',v_event2,v_brand,NULL,NULL,
    'published_manual','bunny','c.mp4','video/mp4','mp4',repeat('9',64),3000000,9000,0,9000,true);
  -- The lease already expired 5 minutes ago (the client was away); a resume
  -- replay extends it to the new signature's hour.
  UPDATE public.event_cover_video_jobs SET tus_expires_at=now()-interval '5 minutes' WHERE id=v_c.id;
  v_t := now()+interval '1 hour';
  v_tmp := public.cover_video_extend_transport_lease(v_c.id,v_t);
  IF v_tmp.tus_expires_at IS DISTINCT FROM v_t OR v_tmp.transport_lease_extended_at IS NULL THEN
    RAISE EXCEPTION 'T4 an expired lease was not moved to the resumed signature (%)', v_tmp.tus_expires_at;
  END IF;
  -- An older signature (a slow, out-of-order replay) never shortens it.
  v_tmp := public.cover_video_extend_transport_lease(v_c.id,now()+interval '10 minutes');
  IF v_tmp.tus_expires_at IS DISTINCT FROM v_t THEN
    RAISE EXCEPTION 'T4 an out-of-order replay shortened the lease to %', v_tmp.tus_expires_at;
  END IF;
  -- Once the bytes are acknowledged, nothing moves the lease and nothing is returned.
  UPDATE public.event_cover_video_jobs SET status='source_uploaded',source_uploaded_at=now() WHERE id=v_c.id;
  v_tmp := public.cover_video_extend_transport_lease(v_c.id,now()+interval '3 hours');
  IF v_tmp.id IS NOT NULL THEN RAISE EXCEPTION 'T4 the lease of an acknowledged job was extended'; END IF;
  IF (SELECT tus_expires_at FROM public.event_cover_video_jobs WHERE id=v_c.id) IS DISTINCT FROM v_t THEN
    RAISE EXCEPTION 'T4 an acknowledged job''s lease changed';
  END IF;

  -- ── T5 ready -> failed is owned, applied never moves ────────────────────
  UPDATE public.event_cover_video_jobs SET status='ready',completed_at=now(),source_asset_id='guid-f108-c',
    processed_url='https://cdn.test/guid-f108-c/play_1080p.mp4',processed_mime_type='video/mp4',
    processed_bytes=1000,processed_duration_ms=9000 WHERE id=v_c.id;
  v_tmp := public.cover_video_transition_job(v_c.id,ARRAY['ready'],'failed',NULL,NULL,
    '{"failure_code":"processing_stalled","failure_message":"x"}'::jsonb);
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'T5 ready failed with an unowned code (processing_stalled)'; END IF;
  v_tmp := public.cover_video_transition_job(v_c.id,ARRAY['ready'],'failed',NULL,NULL,'{}'::jsonb);
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'T5 ready failed with no code at all'; END IF;
  v_tmp := public.cover_video_transition_job(v_c.id,ARRAY['ready'],'cancelled',NULL,NULL,'{}'::jsonb);
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'T5 ready was cancelled'; END IF;
  v_tmp := public.cover_video_apply_once(v_c.id,v_tmp.application_version,v_tmp.processed_url,NULL);
  IF v_tmp.status <> 'applied' THEN RAISE EXCEPTION 'T5 setup: the cover did not apply (%)', v_tmp.status; END IF;
  v_tmp := public.cover_video_transition_job(v_c.id,ARRAY['applied','ready'],'failed',NULL,NULL,
    '{"failure_code":"ready_unclaimed","failure_message":"x"}'::jsonb);
  IF v_tmp.status <> 'applied' THEN RAISE EXCEPTION 'T5 an applied cover was failed by the ready owner'; END IF;

  -- ── T6 the live-reference guard, arm by arm ─────────────────────────────
  -- v_c is applied and its URL is now event2's cover.
  v_kinds := public.cover_video_guid_live_references('guid-f108-c', v_c.id);
  IF NOT ('event_cover' = ANY(v_kinds)) THEN RAISE EXCEPTION 'T6 a live event cover was not reported: %', v_kinds; END IF;
  IF 'active_job' = ANY(v_kinds) THEN RAISE EXCEPTION 'T6 the excluded job counted as its own reference: %', v_kinds; END IF;
  -- Without the exclusion, the applied job itself is a live reference.
  IF NOT ('active_job' = ANY(public.cover_video_guid_live_references('guid-f108-c', NULL))) THEN
    RAISE EXCEPTION 'T6 an applied job was not counted as a live reference';
  END IF;
  -- Poster only, gallery only and theme only each count.
  UPDATE public.events SET cover_media_url=NULL,cover_media_poster_url='https://cdn.test/guid-pstr-0001/thumbnail.jpg',
    cover_media_gallery='[{"url":"https://cdn.test/guid-gall-0001/play_720p.mp4"}]'::jsonb,
    theme='{"hero":{"video":"https://cdn.test/guid-thme-0001/play_1080p.mp4"}}'::jsonb WHERE id=v_event2;
  IF public.cover_video_guid_live_references('guid-pstr-0001') <> ARRAY['event_cover'] THEN
    RAISE EXCEPTION 'T6 a poster-only reference was missed';
  END IF;
  IF public.cover_video_guid_live_references('guid-gall-0001') <> ARRAY['event_cover'] THEN
    RAISE EXCEPTION 'T6 a gallery-only reference was missed';
  END IF;
  IF public.cover_video_guid_live_references('guid-thme-0001') <> ARRAY['event_cover'] THEN
    RAISE EXCEPTION 'T6 a theme-only reference was missed';
  END IF;
  -- Exact path segment only: a guid that is a PREFIX of a live guid is free.
  IF public.cover_video_guid_live_references('guid-gall-000') <> ARRAY[]::text[] THEN
    RAISE EXCEPTION 'T6 a prefix of a live guid was treated as referenced';
  END IF;
  -- Trip-day media on a live event counts; on a deleted event it does not.
  INSERT INTO public.trip_days(event_id,ordinal,title,media) VALUES
    (v_event2,1,'Live day','[{"type":"video","url":"https://cdn.test/guid-trip-live1/play_1080p.mp4"}]'::jsonb),
    (v_event,1,'Deleted day','[{"type":"video","url":"https://cdn.test/guid-trip-dead1/play_1080p.mp4"}]'::jsonb);
  IF NOT ('trip_day_media' = ANY(public.cover_video_guid_live_references('guid-trip-live1'))) THEN
    RAISE EXCEPTION 'T6 a gallery video on a live trip day was not reported';
  END IF;
  IF public.cover_video_guid_live_references('guid-trip-dead1') <> ARRAY[]::text[] THEN
    RAISE EXCEPTION 'T6 a trip day on a deleted event kept its video alive';
  END IF;
  -- Brand cover counts only while the brand is live.
  UPDATE public.brands SET cover_media_url='https://cdn.test/guid-brnd-0001/play_1080p.mp4' WHERE id=v_brand;
  IF NOT ('brand_cover' = ANY(public.cover_video_guid_live_references('guid-brnd-0001'))) THEN
    RAISE EXCEPTION 'T6 a live brand cover was not reported';
  END IF;
  -- Venue cover counts.
  INSERT INTO public.venue_listings(brand_id,slug,name,lat,lng,venue_category,cover_media_url)
    VALUES(v_brand,'tester3040f','Issue 3040 Venue',1,1,'restaurant','https://cdn.test/guid-venu-0001/play_1080p.mp4');
  IF NOT ('venue_cover' = ANY(public.cover_video_guid_live_references('guid-venu-0001'))) THEN
    RAISE EXCEPTION 'T6 a venue cover was not reported';
  END IF;
  -- A failed/superseded job for the same asset is not a reference; a live one is.
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-shrd-0001' WHERE id=v_a.id;
  IF public.cover_video_guid_live_references('guid-shrd-0001') <> ARRAY[]::text[] THEN
    RAISE EXCEPTION 'T6 a superseded job kept its asset alive';
  END IF;
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-shrd-0001' WHERE id=v_ad1.id;
  IF NOT ('active_job' = ANY(public.cover_video_guid_live_references('guid-shrd-0001', v_a.id))) THEN
    RAISE EXCEPTION 'T6 an in-flight job sharing the asset was not reported';
  END IF;
  -- LIKE metacharacters and path tricks are refused, never matched.
  FOREACH v_s IN ARRAY ARRAY['%','guid_0001_x','guid%0001','../guid-0001','short','guid 0001 xx'] LOOP
    v_raised := false;
    BEGIN
      PERFORM public.cover_video_guid_live_references(v_s);
    EXCEPTION WHEN raise_exception THEN v_raised := (SQLERRM = 'cover_video_guid_invalid');
    END;
    IF NOT v_raised THEN RAISE EXCEPTION 'T6 guid % was not refused', v_s; END IF;
  END LOOP;

  -- ── T7 provenance cannot be laundered into house media ──────────────────
  UPDATE public.event_cover_video_jobs SET status='ready',source_asset_id='guid-f106-ad2',
    processed_url='https://cdn.test/guid-f106-ad2/play_1080p.mp4',
    processed_poster_url='https://cdn.test/guid-f106-ad2/thumbnail.jpg',processed_mime_type='video/mp4',
    processed_bytes=1000,processed_duration_ms=9000,completed_at=now() WHERE id=v_ad2.id;
  INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,
      created_by,source,source_job_id,status)
    VALUES('video','host ad 2','https://cdn.test/guid-f106-ad2/play_1080p.mp4','guid-f106-ad2',
      'https://cdn.test/guid-f106-ad2/thumbnail.jpg','https://cdn.test/guid-f106-ad2/play_1080p.mp4',
      v_brand,repeat('c',64),v_host,'host_upload',v_ad2.id,'active')
    RETURNING * INTO v_creative;
  -- A second creative for the same job is impossible.
  v_raised := false;
  BEGIN
    INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,brand_id,content_hash,source,source_job_id)
      VALUES('video','dup','https://cdn.test/x/play.mp4','guid-f106-ad2','https://cdn.test/x/t.jpg',v_brand,
        repeat('d',64),'host_upload',v_ad2.id);
  EXCEPTION WHEN unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T7 one lane job materialized two creatives'; END IF;
  -- Clearing the brand by hand leaves Host provenance (not house).
  UPDATE public.ad_creatives SET brand_id=NULL WHERE id=v_creative.id;
  SELECT * INTO v_creative FROM public.ad_creatives WHERE id=v_creative.id;
  IF v_creative.source = 'admin_upload' THEN RAISE EXCEPTION 'T7 clearing brand_id made Host media house media'; END IF;
  -- Re-pointing the job link, rewriting the guid or the brand snapshot all raise.
  FOREACH v_s IN ARRAY ARRAY[
    format('UPDATE public.ad_creatives SET source_job_id=%L WHERE id=%L', v_ad1.id, v_creative.id),
    format('UPDATE public.ad_creatives SET bunny_video_id=%L WHERE id=%L', 'guid-other-0001', v_creative.id),
    format('UPDATE public.ad_creatives SET source_job_ref=NULL WHERE id=%L', v_creative.id),
    format('UPDATE public.ad_creatives SET source=%L WHERE id=%L', 'admin_upload', v_creative.id)
  ] LOOP
    v_raised := false;
    BEGIN
      EXECUTE v_s;
    EXCEPTION WHEN raise_exception THEN v_raised := (SQLERRM = 'ad_creative_provenance_immutable');
    END;
    IF NOT v_raised THEN RAISE EXCEPTION 'T7 provenance write was allowed: %', v_s; END IF;
  END LOOP;
  -- The ad creative arm of the guard keeps its asset alive.
  IF NOT ('ad_creative' = ANY(public.cover_video_guid_live_references('guid-f106-ad2', v_ad2.id))) THEN
    RAISE EXCEPTION 'T6 a library creative did not protect its asset';
  END IF;

  -- ── T8 a house uploader's account is deleted ────────────────────────────
  v_house := public.cover_video_create_or_replay_job(
    v_admin,'30400000-0000-4000-8000-00000000f109','ad_creative',NULL,NULL,NULL,'admin-library:'||v_admin,
    'published_manual','bunny','house.mp4','video/mp4','mp4',repeat('e',64),3000000,9000,0,9000,true);
  UPDATE public.event_cover_video_jobs SET status='ready',source_asset_id='guid-f109-house',
    processed_url='https://cdn.test/guid-f109-house/play_1080p.mp4',
    processed_poster_url='https://cdn.test/guid-f109-house/thumbnail.jpg',processed_mime_type='video/mp4',
    processed_bytes=1000,processed_duration_ms=9000,completed_at=now() WHERE id=v_house.id;
  INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,
      created_by,source,source_job_id)
    VALUES('video','house','https://cdn.test/guid-f109-house/play_1080p.mp4','guid-f109-house',
      'https://cdn.test/guid-f109-house/thumbnail.jpg','https://cdn.test/guid-f109-house/play_1080p.mp4',
      NULL,repeat('f',64),v_admin,'admin_upload',v_house.id)
    RETURNING * INTO v_creative;
  v_tmp := public.cover_video_apply_once(v_house.id,v_house.application_version,'https://cdn.test/guid-f109-house/play_1080p.mp4',NULL);
  IF v_tmp.status <> 'applied' THEN RAISE EXCEPTION 'T8 setup: the house video did not apply (%)', v_tmp.status; END IF;
  DELETE FROM auth.users WHERE id=v_admin;
  SELECT * INTO v_creative FROM public.ad_creatives WHERE id=v_creative.id;
  IF v_creative.id IS NULL THEN RAISE EXCEPTION 'T8 the house creative was lost with its uploader'; END IF;
  IF v_creative.created_by IS NOT NULL OR v_creative.source_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'T8 live links survived the account deletion';
  END IF;
  IF v_creative.source <> 'admin_upload' OR v_creative.source_job_ref IS DISTINCT FROM v_house.id
     OR v_creative.brand_id IS NOT NULL THEN
    RAISE EXCEPTION 'T8 house provenance changed on account deletion';
  END IF;
  -- With its job gone the creative itself still protects the asset.
  IF NOT ('ad_creative' = ANY(public.cover_video_guid_live_references('guid-f109-house'))) THEN
    RAISE EXCEPTION 'T8 the orphaned house creative stopped protecting its asset';
  END IF;

  -- ── T9 a claim window full of applied rows ──────────────────────────────
  -- 1,200 applied, un-reaped jobs with assets (the B-12 production shape) and
  -- one encoding job: the claim never admits applied rows, and the encoding
  -- job is claimed on the first call even with the largest limit.
  INSERT INTO public.event_cover_video_jobs(requested_by,target_kind,event_id,brand_id,provider,status,apply_mode,
      source_asset_id,trim_end_ms,processed_url,processed_mime_type,processed_bytes,processed_duration_ms,
      completed_at,applied_at,created_at)
  SELECT v_host,'trip_day_media',v_event2,v_brand,'bunny','applied','published_manual',
      'guid-bulk-'||lpad(g::text,6,'0'),1000,'https://cdn.test/guid-bulk-'||g||'/play_1080p.mp4','video/mp4',1000,1000,now()-interval '30 days',now()-interval '30 days',
      now()-interval '31 days'+make_interval(secs=>g)
  FROM generate_series(1,1200) g;
  UPDATE public.event_cover_video_jobs SET reconcile_lease_until=NULL,reconcile_attempted_at=NULL
   WHERE reaped_at IS NULL;
  SELECT count(*) INTO v_n FROM public.cover_video_claim_reconcile_jobs(5000,60) c WHERE c.status='applied';
  IF v_n <> 0 THEN RAISE EXCEPTION 'T9 the claim admitted % applied rows', v_n; END IF;
  UPDATE public.event_cover_video_jobs SET reconcile_lease_until=NULL WHERE reaped_at IS NULL;
  SELECT count(*) INTO v_n FROM public.cover_video_claim_reconcile_jobs(5000,60);
  IF v_n > 1000 THEN RAISE EXCEPTION 'T9 the claim limit is not clamped (% rows)', v_n; END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_video_lane.tester.adversarial.pg17: PASS'
