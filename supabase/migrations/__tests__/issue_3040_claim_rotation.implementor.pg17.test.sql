-- Issue #3040 (T-B12): the reconcile claim rotates, so long-lived ready rows cannot starve live work.
-- Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): every claimable job is reached within a bounded number of ticks
--
-- FAILS ON REVERT: restore the 20270604002715 claim ordering
-- (coalesce(provider_checked_at,created_at)) and the same 100 old ready rows
-- are claimed on every tick, so the processing job is never reached.
BEGIN;

DO $test$
DECLARE
  v_user uuid := '30400000-0000-4000-8000-000000000601';
  v_brand uuid := '30400000-0000-4000-8000-000000000602';
  v_event uuid := '30400000-0000-4000-8000-000000000603';
  v_live public.event_cover_video_jobs;
  v_job public.event_cover_video_jobs;
  v_tick integer;
  v_found boolean := false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_user,'issue-3040-claim@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_user,'issue-3040-claim@test.local','Claim');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 3040 Claim Brand','issue-3040-claim-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme)
    VALUES(v_event,v_brand,v_user,'Claim','issue-3040-claim','trip','draft','draft','UTC','USD','{"business_draft":{"clientRevision":0}}'::jsonb);

  FOR i IN 1..150 LOOP
    v_job := public.cover_video_create_or_replay_job(
      v_user,('30400000-0000-4000-9000-'||lpad(i::text,12,'0'))::uuid,'trip_day_media',v_event,v_brand,NULL,NULL,
      'published_manual','bunny','r'||i||'.mp4','video/mp4','mp4',repeat('a',64),1000000,10000,0,10000,true);
    UPDATE public.event_cover_video_jobs SET source_asset_id='guid-3040-ready-'||lpad(i::text,6,'0'),
      status='ready',processed_url='https://cdn.example.test/r'||i||'/play_720p.mp4',processed_mime_type='video/mp4',
      processed_bytes=1000,processed_duration_ms=10000,completed_at=now()-interval '2 days',
      provider_checked_at=now()-interval '2 days',created_at=now()-interval '3 days'+make_interval(secs=>i)
    WHERE id=v_job.id;
  END LOOP;
  v_live := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000611','trip_day_media',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','live.mp4','video/mp4','mp4',repeat('b',64),1000000,10000,0,10000,true);
  UPDATE public.event_cover_video_jobs SET source_asset_id='guid-3040-live-000001',status='processing',
    source_uploaded_at=now(),provider_checked_at=now()
  WHERE id=v_live.id;

  FOR v_tick IN 1..2 LOOP
    IF EXISTS (SELECT 1 FROM public.cover_video_claim_reconcile_jobs(100,60) c WHERE c.id=v_live.id) THEN
      v_found := true;
      EXIT;
    END IF;
    -- One minute later every lease has expired.
    UPDATE public.event_cover_video_jobs SET reconcile_lease_until=now()-interval '1 second'
      WHERE event_id=v_event;
  END LOOP;
  IF NOT v_found THEN
    RAISE EXCEPTION '#3040 a processing job was starved by 150 old ready rows for two ticks';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_claim_rotation.implementor.pg17: PASS'
