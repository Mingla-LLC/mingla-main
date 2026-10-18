BEGIN;

DO $test$
DECLARE
  v_user uuid := '30400000-0000-4000-8000-000000000201';
  v_brand uuid := '30400000-0000-4000-8000-000000000202';
  v_event uuid := '30400000-0000-4000-8000-000000000203';
  v_first public.event_cover_video_jobs;
  v_second public.event_cover_video_jobs;
  v_cover public.event_cover_video_jobs;
  v_applied public.event_cover_video_jobs;
BEGIN
  INSERT INTO auth.users(id,email)
    VALUES(v_user,'issue-3040-trip-media@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_user,'issue-3040-trip-media@test.local','Issue 3040 Trip Media');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 3040 Trip Media Brand','issue-3040-trip-media-brand','USD',now(),now());
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme
  ) VALUES(
    v_event,v_brand,v_user,'Issue 3040 Trip','issue-3040-trip-media','trip','draft','draft','UTC','USD',
    '{"business_draft":{"clientRevision":0}}'::jsonb
  );

  v_first := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000204','trip_day_media',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','first.mp4','video/mp4','mp4',repeat('a',64),1000000,15000,0,15000,true
  );
  v_second := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000205','trip_day_media',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','second.mp4','video/mp4','mp4',repeat('b',64),1000000,15000,0,15000,true
  );
  v_cover := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000206','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','cover.mp4','video/mp4','mp4',repeat('c',64),1000000,15000,0,15000,true
  );

  IF v_first.status <> 'source_uploading' OR v_second.status <> 'source_uploading'
     OR v_cover.status <> 'source_uploading' THEN
    RAISE EXCEPTION '#3040 gallery jobs or event cover unexpectedly superseded each other';
  END IF;
  IF (SELECT count(*) FROM public.event_cover_video_jobs
      WHERE event_id=v_event AND status='source_uploading') <> 3 THEN
    RAISE EXCEPTION '#3040 gallery jobs are not independently active';
  END IF;

  v_first := public.cover_video_transition_job(
    v_first.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}'
  );
  v_first := public.cover_video_transition_job(
    v_first.id,ARRAY['source_uploaded'],'ready',4,100,
    jsonb_build_object(
      'processed_url','https://cdn.example.test/3040/trip-day.mp4',
      'processed_poster_url','https://cdn.example.test/3040/trip-day.jpg',
      'processed_mime_type','video/mp4','processed_bytes',900000,
      'processed_duration_ms',15000,'processed_video_codec','h264'
    )
  );
  v_applied := public.cover_video_apply_once(
    v_first.id,v_first.application_version,v_first.processed_url,NULL
  );
  IF v_applied.status <> 'applied' OR v_applied.application_receipt IS NULL THEN
    RAISE EXCEPTION '#3040 gallery video did not receive an apply receipt';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.events
    WHERE id=v_event AND (cover_media_type IS NOT NULL OR cover_media_url IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '#3040 gallery apply incorrectly mutated the event cover';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_trip_day_bunny_transport.implementor.pg17: PASS'
