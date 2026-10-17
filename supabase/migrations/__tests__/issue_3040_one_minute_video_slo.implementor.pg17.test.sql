BEGIN;

DO $test$
DECLARE
  v_user uuid := '30400000-0000-4000-8000-000000000001';
  v_brand uuid := '30400000-0000-4000-8000-000000000002';
  v_job public.event_cover_video_jobs;
  v_breach public.event_cover_video_jobs;
  v_before bigint;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_user,'issue-3040@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_user,'issue-3040@test.local','Issue 3040 Owner');
  INSERT INTO public.brands(id,account_id,name,slug,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 3040 Brand','issue-3040-brand',now(),now());

  v_job := public.cover_video_create_or_replay_job(
    v_user,'30400000-0000-4000-8000-000000000003','venue_draft',NULL,v_brand,NULL,
    'issue-3040-exact-minute','published_manual','bunny','minute.mp4','video/mp4','mp4',
    repeat('a',64),9000000,60000,0,60000,true
  );
  IF v_job.source_duration_ms <> 60000 OR v_job.trim_end_ms <> 60000 THEN
    RAISE EXCEPTION '#3040 exact one-minute source was not preserved';
  END IF;

  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      v_user,'30400000-0000-4000-8000-000000000004','venue_draft',NULL,v_brand,NULL,
      'issue-3040-over-minute','published_manual','bunny','over.mp4','video/mp4','mp4',
      repeat('b',64),9000000,60001,0,60001,true
    );
    RAISE EXCEPTION '#3040 60001ms source unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_source_contract_invalid' THEN RAISE; END IF;
  END;

  v_job := public.cover_video_transition_job(
    v_job.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}'
  );
  IF v_job.source_uploaded_at IS NULL THEN
    RAISE EXCEPTION '#3040 transition did not stamp authoritative final-byte clock';
  END IF;
  PERFORM public.cover_video_transition_job(
    v_job.id,ARRAY['source_uploaded'],'processing',2,10,'{}'
  );
  UPDATE public.event_cover_video_jobs
  SET source_uploaded_at=now()-interval '61 seconds'
  WHERE id=v_job.id;

  SELECT count(*) INTO v_before
  FROM public.api_health_checks
  WHERE service_key='bunny'
    AND detail->>'signal'='cover_video_processing_slo_breach'
    AND detail->>'job_id'=v_job.id::text;
  SELECT breach.* INTO v_breach
  FROM public.cover_video_record_processing_slo_breaches(100) breach
  WHERE breach.id=v_job.id;
  IF v_breach.id IS DISTINCT FROM v_job.id OR v_breach.processing_slo_alerted_at IS NULL THEN
    RAISE EXCEPTION '#3040 60-second unresolved job did not record a durable breach';
  END IF;
  IF (SELECT count(*) FROM public.api_health_checks
      WHERE service_key='bunny'
        AND detail->>'signal'='cover_video_processing_slo_breach'
        AND detail->>'job_id'=v_job.id::text) <> v_before + 1 THEN
    RAISE EXCEPTION '#3040 breach did not append exactly one Bunny health record';
  END IF;
  PERFORM public.cover_video_record_processing_slo_breaches(100);
  IF (SELECT count(*) FROM public.api_health_checks
      WHERE service_key='bunny'
        AND detail->>'signal'='cover_video_processing_slo_breach'
        AND detail->>'job_id'=v_job.id::text) <> v_before + 1 THEN
    RAISE EXCEPTION '#3040 repeated sweep duplicated the job alert';
  END IF;

  BEGIN
    PERFORM public.cover_video_transition_job(
      v_job.id,ARRAY['processing'],'ready',4,100,
      jsonb_build_object(
        'processed_url','https://cdn.example.test/3040/over.mp4',
        'processed_poster_url','https://cdn.example.test/3040/poster.jpg',
        'processed_mime_type','video/mp4','processed_bytes',1000000,
        'processed_duration_ms',60001,'processed_video_codec','h264'
      )
    );
    RAISE EXCEPTION '#3040 60001ms derivative unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  PERFORM public.cover_video_transition_job(
    v_job.id,ARRAY['processing'],'ready',4,100,
    jsonb_build_object(
      'processed_url','https://cdn.example.test/3040/minute.mp4',
      'processed_poster_url','https://cdn.example.test/3040/poster.jpg',
      'processed_mime_type','video/mp4','processed_bytes',1000000,
      'processed_duration_ms',60000,'processed_video_codec','h264'
    )
  );
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_job.id) <> 'ready' THEN
    RAISE EXCEPTION '#3040 exact one-minute derivative did not reach ready';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_one_minute_video_slo.implementor.pg17: PASS'
