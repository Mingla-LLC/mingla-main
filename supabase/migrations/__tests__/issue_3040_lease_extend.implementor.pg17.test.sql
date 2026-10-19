-- Issue #3040 (T-B7): a replayed upload signature extends the server lease, and only forwards.
-- Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): the transfer bound follows the latest signature the server handed out
--
-- FAILS ON REVERT: drop cover_video_extend_transport_lease (or make it assign
-- p_expires_at without greatest()) and the assertions below raise.
BEGIN;

DO $test$
DECLARE
  v_user uuid := '30400000-0000-4000-8000-000000000501';
  v_brand uuid := '30400000-0000-4000-8000-000000000502';
  v_event uuid := '30400000-0000-4000-8000-000000000503';
  v_job public.event_cover_video_jobs;
  v_out public.event_cover_video_jobs;
  v_base timestamptz := date_trunc('second', now()) + interval '10 minutes';
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_user,'issue-3040-lease@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_user,'issue-3040-lease@test.local','Lease');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 3040 Lease Brand','issue-3040-lease-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme)
    VALUES(v_event,v_brand,v_user,'Lease','issue-3040-lease','event','draft','draft','UTC','USD','{"business_draft":{"clientRevision":0}}'::jsonb);
  v_job := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000511','trip_day_media',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','a.mp4','video/mp4','mp4',repeat('a',64),1000000,10000,0,10000,true);
  UPDATE public.event_cover_video_jobs SET tus_expires_at=v_base WHERE id=v_job.id;

  v_out := public.cover_video_extend_transport_lease(v_job.id, v_base + interval '1 hour');
  IF v_out.tus_expires_at <> v_base + interval '1 hour' OR v_out.transport_lease_extended_at IS NULL THEN
    RAISE EXCEPTION '#3040 a fresh signature did not extend the lease: %', v_out.tus_expires_at;
  END IF;
  v_out := public.cover_video_extend_transport_lease(v_job.id, v_base);
  IF v_out.tus_expires_at <> v_base + interval '1 hour' THEN
    RAISE EXCEPTION '#3040 an older signature moved the lease backwards: %', v_out.tus_expires_at;
  END IF;

  PERFORM public.cover_video_transition_job(v_job.id,ARRAY['source_uploading'],'source_uploaded',NULL,NULL,'{}');
  v_out := public.cover_video_extend_transport_lease(v_job.id, v_base + interval '5 hours');
  IF v_out.id IS NOT NULL THEN RAISE EXCEPTION '#3040 a finished transfer had its lease extended'; END IF;
  IF (SELECT tus_expires_at FROM public.event_cover_video_jobs WHERE id=v_job.id) <> v_base + interval '1 hour' THEN
    RAISE EXCEPTION '#3040 a non-uploading job lease changed';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_lease_extend.implementor.pg17: PASS'
