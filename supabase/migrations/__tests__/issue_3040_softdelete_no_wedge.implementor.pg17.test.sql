-- Issue #3040 (T-B4): a soft-deleted parent never wedges the reaper claim.
-- MINGLA-INVARIANT: I-VIDEO-SOFTDELETE-NO-WEDGE | issue #3040 | parent soft-delete never blocks job UPDATEs or the reconcile claim
--
-- FAILS ON REVERT: restore the 20271105003040 body of
-- cover_video_require_new_identity (no TG_OP='UPDATE' guard) and the claim
-- below raises cover_video_event_brand_mismatch for the whole batch, so the
-- healthy sibling job is never claimed and the job can never move again.
BEGIN;

DO $test$
DECLARE
  v_user uuid := '30400000-0000-4000-8000-000000000401';
  v_brand uuid := '30400000-0000-4000-8000-000000000402';
  v_deleted_event uuid := '30400000-0000-4000-8000-000000000403';
  v_live_event uuid := '30400000-0000-4000-8000-000000000404';
  v_orphan public.event_cover_video_jobs;
  v_healthy public.event_cover_video_jobs;
  v_claimed uuid[];
  v_job public.event_cover_video_jobs;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_user,'issue-3040-softdelete@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_user,'issue-3040-softdelete@test.local','Issue 3040 Softdelete');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 3040 Softdelete Brand','issue-3040-softdelete-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme) VALUES
    (v_deleted_event,v_brand,v_user,'Deleted','issue-3040-softdelete-a','event','draft','draft','UTC','USD','{"business_draft":{"clientRevision":0}}'::jsonb),
    (v_live_event,v_brand,v_user,'Live','issue-3040-softdelete-b','event','draft','draft','UTC','USD','{"business_draft":{"clientRevision":0}}'::jsonb);

  v_orphan := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000411','event',v_deleted_event,v_brand,NULL,NULL,
    'published_manual','bunny','a.mp4','video/mp4','mp4',repeat('a',64),1000000,10000,0,10000,true);
  v_healthy := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000412','event',v_live_event,v_brand,NULL,NULL,
    'published_manual','bunny','b.mp4','video/mp4','mp4',repeat('b',64),1000000,10000,0,10000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-3040-softdel-'||right(id::text,4)
    WHERE id IN (v_orphan.id,v_healthy.id);
  PERFORM public.cover_video_transition_job(v_orphan.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  PERFORM public.cover_video_transition_job(v_orphan.id,ARRAY['source_uploaded'],'processing',2,10,'{}');
  PERFORM public.cover_video_transition_job(v_healthy.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');

  -- The host deletes the event while its video is still encoding.
  UPDATE public.events SET deleted_at=now() WHERE id=v_deleted_event;

  SELECT array_agg(id) INTO v_claimed FROM public.cover_video_claim_reconcile_jobs(100,60);
  IF v_claimed IS NULL OR NOT (v_orphan.id = ANY(v_claimed)) OR NOT (v_healthy.id = ANY(v_claimed)) THEN
    RAISE EXCEPTION '#3040 the claim did not return both the orphaned and the healthy job: %', v_claimed;
  END IF;

  v_job := public.cover_video_transition_job(v_orphan.id,ARRAY['processing'],'failed',NULL,NULL,
    jsonb_build_object('failure_code','target_deleted','failure_message','The event was deleted.'));
  IF v_job.status <> 'failed' OR v_job.failure_code <> 'target_deleted' THEN
    RAISE EXCEPTION '#3040 a job on a soft-deleted event could not be failed';
  END IF;
  UPDATE public.event_cover_video_jobs SET reaped_at=now() WHERE id=v_orphan.id;
END
$test$;

ROLLBACK;

\echo 'issue_3040_softdelete_no_wedge.implementor.pg17: PASS'
