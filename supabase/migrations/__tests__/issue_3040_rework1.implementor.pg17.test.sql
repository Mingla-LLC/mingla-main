-- Issue #3040 — rework 1 (independent tester FAIL) implementor suite for the
-- lane migrations 20271108003040 / 20271108013040.
--
--   R1 (P1-2) a venue-draft video that reached ready is retained by the live
--      reference guard, INCLUDING against its own job (no destroy path can
--      ask with p_exclude_job_id and get "unreferenced"); a venue-draft
--      upload that never reached ready is not.
--   R2 (P1-2) a ready venue-draft video never counts as ready-unclaimed or
--      stuck in the lane health view; any other ready video still does.
--   R3 (P1-3) house media provenance is recorded at creation: admin_upload is
--      impossible with an owning brand snapshot, so Host media that an admin
--      attached to a brand stays Host media after the brand and its account
--      are deleted.
--   R4 (P2)   a replaced READY ad video can be cancelled while it has no
--      creative, a cancelled ad video can never become a creative, and a ready
--      ad video that already has one (or any other ready video) is not
--      cancellable.
--   R5 (D-9)  the server owner (NULL requester) never overwrites a cover the
--      host changed after the upload began; a client caller still applies.
--
-- Invariant I-VENUE-DRAFT-VIDEO-RETAINED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_venue_draft_retained.test.ts): a venue-draft video that reached ready is reported as referenced, even to its own job
-- MINGLA-INVARIANT: I-CREATIVE-HOUSE-PROVENANCE-RECORDED | issue #3040 | source='admin_upload' is only ever recorded with no brand snapshot
-- MINGLA-INVARIANT: I-AD-VIDEO-CANCELLED-NEVER-MATERIALIZES | issue #3040 | a cancelled ad video job never becomes an ad_creatives row
--
-- FAILS ON REVERT:
--   R1  the venue_draft arm removed from cover_video_guid_live_references
--   R2  the target_kind <> 'venue_draft' filters removed from the view
--   R3  the ad_creatives_admin_upload_is_house CHECK dropped
--   R4  cover_video_cancel_once back to refusing every ready job, or the
--       trg_ad_creatives_job_not_cancelled trigger dropped
--   R5  the baseline clause removed from cover_video_apply_once's UPDATE
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_admin uuid := '30400000-0000-4000-8000-00000000e001';
  v_host uuid := '30400000-0000-4000-8000-00000000e002';
  v_brand uuid := '30400000-0000-4000-8000-00000000e003';
  v_event uuid := '30400000-0000-4000-8000-00000000e004';
  v_host3 uuid := '30400000-0000-4000-8000-00000000e022';
  v_brand3 uuid := '30400000-0000-4000-8000-00000000e023';
  v_vd public.event_cover_video_jobs;
  v_vd2 public.event_cover_video_jobs;
  v_ev public.event_cover_video_jobs;
  v_ad public.event_cover_video_jobs;
  v_ad2 public.event_cover_video_jobs;
  v_tmp public.event_cover_video_jobs;
  v_creative public.ad_creatives;
  v_kinds text[];
  v_raised boolean;
  v_before bigint;
  v_after bigint;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_admin,'issue-3040-rework-admin@test.local'),
    (v_host,'issue-3040-rework-host@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_host,'issue-3040-rework-host@test.local','Issue 3040 Rework Host');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_host,'Issue 3040 Rework Brand','issue-3040-rework-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme)
    VALUES(v_event,v_brand,v_host,'Issue 3040 Rework Event','issue-3040-rework-event','event','draft','draft','UTC','USD','{}'::jsonb);

  -- ── R1 venue-draft retention in the guard ────────────────────────────────
  v_vd := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e101','venue_draft',NULL,v_brand,NULL,'draft-e101',
    'published_manual','bunny','vd.mp4','video/mp4','mp4',repeat('a',64),3000000,9000,0,9000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e101-venue-draft' WHERE id=v_vd.id;
  v_kinds := public.cover_video_guid_live_references('guid-e101-venue-draft', v_vd.id);
  IF 'venue_draft' = ANY(v_kinds) THEN
    RAISE EXCEPTION 'R1 a venue-draft upload the device never received was retained';
  END IF;
  v_tmp := public.cover_video_transition_job(v_vd.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_vd.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e101-venue-draft/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e101-venue-draft/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'R1 setup: venue draft is %', v_tmp.status; END IF;
  v_kinds := public.cover_video_guid_live_references('guid-e101-venue-draft', v_vd.id);
  IF NOT ('venue_draft' = ANY(v_kinds)) THEN
    RAISE EXCEPTION 'R1 a ready venue-draft video was unreferenced to its own job: %', v_kinds;
  END IF;
  -- The host replaces the draft cover: the first job is superseded, and its
  -- asset (still in the device's draft until the host saves) stays retained.
  v_vd2 := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e102','venue_draft',NULL,v_brand,NULL,'draft-e101',
    'published_manual','bunny','vd2.mp4','video/mp4','mp4',repeat('b',64),3000000,9000,0,9000,true);
  SELECT * INTO v_tmp FROM public.event_cover_video_jobs WHERE id=v_vd.id;
  IF v_tmp.status <> 'superseded' THEN RAISE EXCEPTION 'R1 setup: first draft job is %', v_tmp.status; END IF;
  v_kinds := public.cover_video_guid_live_references('guid-e101-venue-draft', v_vd.id);
  IF NOT ('venue_draft' = ANY(v_kinds)) THEN
    RAISE EXCEPTION 'R1 a superseded venue-draft video still in a draft lost its retention: %', v_kinds;
  END IF;

  -- ── R2 the health view ignores retained venue drafts ─────────────────────
  SELECT ready_unclaimed_count INTO v_before FROM public.cover_video_lane_health_v;
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e102-venue-draft' WHERE id=v_vd2.id;
  v_tmp := public.cover_video_transition_job(v_vd2.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_vd2.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e102-venue-draft/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e102-venue-draft/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  UPDATE public.event_cover_video_jobs SET completed_at=now()-interval '3 days' WHERE id=v_vd2.id;
  SELECT ready_unclaimed_count INTO v_after FROM public.cover_video_lane_health_v;
  IF v_after <> v_before THEN RAISE EXCEPTION 'R2 a ready venue draft counted as unclaimed'; END IF;
  SELECT stuck_nonterminal_count INTO v_before FROM public.cover_video_lane_health_v;
  v_ev := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e103','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','ev.mp4','video/mp4','mp4',repeat('c',64),3000000,9000,0,9000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e103-event-0001' WHERE id=v_ev.id;
  v_tmp := public.cover_video_transition_job(v_ev.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_ev.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e103-event-0001/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e103-event-0001/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  UPDATE public.event_cover_video_jobs SET completed_at=now()-interval '3 days' WHERE id=v_ev.id;
  SELECT ready_unclaimed_count, stuck_nonterminal_count INTO v_after, v_before FROM public.cover_video_lane_health_v;
  IF v_after < 1 THEN RAISE EXCEPTION 'R2 an unclaimed event video stopped counting'; END IF;
  IF v_before < 1 THEN RAISE EXCEPTION 'R2 a 3-day-old ready event video is not stuck'; END IF;

  -- ── R3 house provenance is recorded at creation ──────────────────────────
  -- Its own Host with a brand and no events, so the account can be erased.
  INSERT INTO auth.users(id,email) VALUES (v_host3,'issue-3040-rework-host3@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_host3,'issue-3040-rework-host3@test.local','Issue 3040 Rework Host 3');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand3,v_host3,'Issue 3040 Rework Brand 3','issue-3040-rework-brand-3','USD',now(),now());
  v_raised := false;
  BEGIN
    INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,brand_id,created_by,source)
      VALUES('image','admin for host','https://x.test/r3.jpg',repeat('d',64),v_brand3,v_admin,'admin_upload');
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'R3 admin_upload was recorded for a Host brand'; END IF;
  v_raised := false;
  BEGIN
    INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,brand_id,source_brand_id,created_by,source)
      VALUES('image','snapshot only','https://x.test/r3b.jpg',repeat('e',64),NULL,v_brand3,v_admin,'admin_upload');
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'R3 admin_upload was recorded with a brand snapshot'; END IF;
  -- An admin attaching media to a Host brand records it as Host media.
  INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,brand_id,created_by,source)
    VALUES('image','admin for host ok','https://x.test/r3c.jpg',repeat('f',64),v_brand3,v_admin,'host_upload')
    RETURNING * INTO v_creative;
  -- A real house upload is still possible.
  INSERT INTO public.ad_creatives(kind,name,source_url,content_hash,brand_id,created_by,source)
    VALUES('image','house','https://x.test/r3d.jpg',repeat('1',64),NULL,v_admin,'admin_upload');
  -- The Host's account is deleted (GDPR erasure): brands cascade, brand_id
  -- goes NULL, and the row is still not house media.
  DELETE FROM auth.users WHERE id=v_host3;
  SELECT * INTO v_creative FROM public.ad_creatives WHERE id=v_creative.id;
  IF v_creative.id IS NULL THEN RAISE EXCEPTION 'R3 setup: the creative was deleted'; END IF;
  IF v_creative.brand_id IS NOT NULL THEN RAISE EXCEPTION 'R3 setup: brand_id survived the brand'; END IF;
  IF v_creative.source = 'admin_upload' OR v_creative.source_brand_id IS DISTINCT FROM v_brand3 THEN
    RAISE EXCEPTION 'R3 Host media became house media after the account was deleted (%/%)',
      v_creative.source, v_creative.source_brand_id;
  END IF;
END
$test$;

-- R4 and R5 use a Host whose event cover starts as a photo.
DO $test2$
DECLARE
  v_admin uuid := '30400000-0000-4000-8000-00000000e001';
  v_host uuid := '30400000-0000-4000-8000-00000000e012';
  v_brand uuid := '30400000-0000-4000-8000-00000000e013';
  v_event uuid := '30400000-0000-4000-8000-00000000e014';
  v_ad public.event_cover_video_jobs;
  v_ad2 public.event_cover_video_jobs;
  v_ev public.event_cover_video_jobs;
  v_tmp public.event_cover_video_jobs;
  v_raised boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_host,'issue-3040-rework-host2@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_host,'issue-3040-rework-host2@test.local','Issue 3040 Rework Host 2');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_host,'Issue 3040 Rework Brand 2','issue-3040-rework-brand-2','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme,
      cover_media_type,cover_media_url)
    VALUES(v_event,v_brand,v_host,'Issue 3040 Rework Event 2','issue-3040-rework-event-2','event','draft','draft','UTC','USD','{}'::jsonb,
      'image','https://cdn.test/base/cover.jpg');

  -- ── R4 a replaced ready ad video ────────────────────────────────────────
  v_ad := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e201','ad_creative',NULL,v_brand,NULL,'host-ad:draft-e201',
    'published_manual','bunny','ad.mp4','video/mp4','mp4',repeat('2',64),3000000,9000,0,9000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e201-ad-0001' WHERE id=v_ad.id;
  v_tmp := public.cover_video_transition_job(v_ad.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_ad.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e201-ad-0001/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e201-ad-0001/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  v_tmp := public.cover_video_cancel_once(v_ad.id);
  IF v_tmp.status <> 'cancelled' THEN RAISE EXCEPTION 'R4 a replaced ready ad video was not cancellable (%)', v_tmp.status; END IF;
  v_raised := false;
  BEGIN
    INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,
        created_by,source,source_job_id)
      VALUES('video','late','https://cdn.test/guid-e201-ad-0001/play_1080p.mp4','guid-e201-ad-0001',
        'https://cdn.test/guid-e201-ad-0001/thumbnail.jpg','https://cdn.test/guid-e201-ad-0001/play_1080p.mp4',
        v_brand,repeat('3',64),v_host,'host_upload',v_ad.id);
  EXCEPTION WHEN raise_exception THEN v_raised := (SQLERRM = 'ad_creative_job_not_materializable');
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'R4 a cancelled ad video was materialized into the library'; END IF;
  -- Already in the library: no longer cancellable.
  v_ad2 := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e202','ad_creative',NULL,v_brand,NULL,'host-ad:draft-e201',
    'published_manual','bunny','ad2.mp4','video/mp4','mp4',repeat('4',64),3000000,9000,0,9000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e202-ad-0002' WHERE id=v_ad2.id;
  v_tmp := public.cover_video_transition_job(v_ad2.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_ad2.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e202-ad-0002/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e202-ad-0002/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,
      created_by,source,source_job_id)
    VALUES('video','kept','https://cdn.test/guid-e202-ad-0002/play_1080p.mp4','guid-e202-ad-0002',
      'https://cdn.test/guid-e202-ad-0002/thumbnail.jpg','https://cdn.test/guid-e202-ad-0002/play_1080p.mp4',
      v_brand,repeat('5',64),v_host,'host_upload',v_ad2.id);
  v_tmp := public.cover_video_cancel_once(v_ad2.id);
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'R4 an ad video already in the library was cancelled'; END IF;

  -- ── R5 the server owner never overwrites a host change ───────────────────
  v_ev := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e203','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','ev.mp4','video/mp4','mp4',repeat('6',64),3000000,9000,0,9000,true);
  IF v_ev.target_cover_base_url IS DISTINCT FROM 'https://cdn.test/base/cover.jpg' THEN
    RAISE EXCEPTION 'R5 setup: baseline not recorded (%)', v_ev.target_cover_base_url;
  END IF;
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e203-event-0001' WHERE id=v_ev.id;
  v_tmp := public.cover_video_transition_job(v_ev.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_ev.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e203-event-0001/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e203-event-0001/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  -- A ready video cover is not cancellable.
  v_tmp := public.cover_video_cancel_once(v_ev.id);
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'R4 a ready cover video was cancelled'; END IF;
  -- The host sets a new photo after the reaper read the cover.
  UPDATE public.events SET cover_media_url='https://cdn.test/host/new-photo.jpg' WHERE id=v_event;
  v_tmp := public.cover_video_apply_once(v_ev.id,v_tmp.application_version,v_tmp.processed_url,NULL);
  IF v_tmp.status <> 'ready' THEN RAISE EXCEPTION 'R5 the server owner applied over the host''s new cover'; END IF;
  IF (SELECT cover_media_url FROM public.events WHERE id=v_event) <> 'https://cdn.test/host/new-photo.jpg' THEN
    RAISE EXCEPTION 'R5 the host''s new cover was overwritten';
  END IF;
  -- The host puts the baseline back: the server owner may apply.
  UPDATE public.events SET cover_media_url='https://cdn.test/base/cover.jpg' WHERE id=v_event;
  v_tmp := public.cover_video_apply_once(v_ev.id,v_tmp.application_version,v_tmp.processed_url,NULL);
  IF v_tmp.status <> 'applied' THEN RAISE EXCEPTION 'R5 the server owner could not apply over an unchanged cover'; END IF;
END
$test2$;

-- R5 continued: a client caller is unaffected by the baseline rule.
DO $test3$
DECLARE
  v_host uuid := '30400000-0000-4000-8000-00000000e012';
  v_brand uuid := '30400000-0000-4000-8000-00000000e013';
  v_event uuid := '30400000-0000-4000-8000-00000000e014';
  v_ev public.event_cover_video_jobs;
  v_tmp public.event_cover_video_jobs;
BEGIN
  v_ev := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-00000000e204','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','ev2.mp4','video/mp4','mp4',repeat('7',64),3000000,9000,0,9000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-e204-event-0002' WHERE id=v_ev.id;
  v_tmp := public.cover_video_transition_job(v_ev.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_tmp := public.cover_video_transition_job(v_ev.id,ARRAY['source_uploaded'],'ready',3,100,
    jsonb_build_object('processed_url','https://cdn.test/guid-e204-event-0002/play_1080p.mp4',
      'processed_poster_url','https://cdn.test/guid-e204-event-0002/thumbnail.jpg',
      'processed_mime_type','video/mp4','processed_bytes',30000000,'processed_duration_ms',9000));
  UPDATE public.events SET cover_media_url='https://cdn.test/host/another.jpg' WHERE id=v_event;
  v_tmp := public.cover_video_apply_once(v_ev.id,v_tmp.application_version,v_tmp.processed_url,v_host);
  IF v_tmp.status <> 'applied' THEN RAISE EXCEPTION 'R5 the host''s own apply was refused'; END IF;
END
$test3$;

ROLLBACK;
