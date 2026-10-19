-- Issue #3040 (conductor decision): ad media never blocks brand or account
-- deletion, and a creative whose brand is deleted never becomes house media.
-- MINGLA-INVARIANT: I-AD-MEDIA-NEVER-BLOCKS-DELETION | issue #3040 | deleting a brand or account never fails because of ad media; provenance snapshots survive it
-- MINGLA-INVARIANT: I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE | issue #3697 | house reuse requires source='admin_upload', never brand_id IS NULL
--
-- FAILS ON REVERT: put ad_creatives.source_job_id back to ON DELETE RESTRICT
-- (or make the provenance trigger refuse the FK's SET NULL) and the brand
-- delete below raises; drop the snapshots and provenance is lost.
BEGIN;

DO $test$
DECLARE
  v_host uuid := '30400000-0000-4000-8000-000000000801';
  v_brand uuid := '30400000-0000-4000-8000-000000000802';
  v_job public.event_cover_video_jobs;
  v_creative public.ad_creatives;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_host,'issue-3040-delete@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_host,'issue-3040-delete@test.local','Delete');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_host,'Issue 3040 Delete Brand','issue-3040-delete-brand','USD',now(),now());

  v_job := public.cover_video_create_or_replay_job(
    v_host,'30400000-0000-4000-8000-000000000811','ad_creative',NULL,v_brand,NULL,'host-ad:draft-3040',
    'published_manual','bunny','ad.mp4','video/mp4','mp4',repeat('a',64),2000000,8000,0,8000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-3040-delete-0001' WHERE id=v_job.id;

  -- A Host ad video, materialized exactly as the edge does (snapshots filled
  -- by the insert default when a writer omits them).
  INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,
      created_by,source,source_job_id)
    VALUES('video','host ad','https://cdn.test/guid-3040-delete-0001/play_1080p.mp4','guid-3040-delete-0001',
      'https://cdn.test/guid-3040-delete-0001/thumbnail.jpg','https://cdn.test/guid-3040-delete-0001/play_1080p.mp4',
      v_brand,repeat('b',64),v_host,'host_upload',v_job.id)
    RETURNING * INTO v_creative;
  IF v_creative.source_job_ref IS DISTINCT FROM v_job.id OR v_creative.source_brand_id IS DISTINCT FROM v_brand THEN
    RAISE EXCEPTION '#3040 provenance snapshots were not taken at creation';
  END IF;

  -- 1. Hard brand deletion succeeds (it cascades the lane job).
  DELETE FROM public.brands WHERE id=v_brand;
  IF EXISTS (SELECT 1 FROM public.event_cover_video_jobs WHERE id=v_job.id) THEN
    RAISE EXCEPTION '#3040 the lane job outlived its brand';
  END IF;

  -- 2. The orphaned creative keeps its provenance and is NOT house media.
  SELECT * INTO v_creative FROM public.ad_creatives WHERE id=v_creative.id;
  IF v_creative.id IS NULL THEN RAISE EXCEPTION '#3040 the creative row was lost'; END IF;
  IF v_creative.brand_id IS NOT NULL OR v_creative.source_job_id IS NOT NULL THEN
    RAISE EXCEPTION '#3040 live links were not cleared';
  END IF;
  IF v_creative.source <> 'host_upload' OR v_creative.source_job_ref IS DISTINCT FROM v_job.id
     OR v_creative.source_brand_id IS DISTINCT FROM v_brand OR v_creative.bunny_video_id <> 'guid-3040-delete-0001' THEN
    RAISE EXCEPTION '#3040 provenance snapshots changed on deletion';
  END IF;
  IF v_creative.source = 'admin_upload' AND v_creative.brand_id IS NULL THEN
    RAISE EXCEPTION '#3040 a deleted brand turned Host media into house media';
  END IF;

  -- 3. The snapshots stay immutable, and the live link cannot be re-pointed.
  BEGIN
    UPDATE public.ad_creatives SET source='admin_upload' WHERE id=v_creative.id;
    RAISE EXCEPTION '#3040 source became mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ad_creative_provenance_immutable' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.ad_creatives SET source_brand_id=NULL WHERE id=v_creative.id;
    RAISE EXCEPTION '#3040 source_brand_id became mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ad_creative_provenance_immutable' THEN RAISE; END IF;
  END;

  -- 4. Deleting the creator's account succeeds too.
  DELETE FROM auth.users WHERE id=v_host;
  IF (SELECT created_by FROM public.ad_creatives WHERE id=v_creative.id) IS NOT NULL THEN
    RAISE EXCEPTION '#3040 the creator link survived account deletion';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_ad_media_never_blocks_deletion.implementor.pg17: PASS'
