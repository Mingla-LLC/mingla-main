BEGIN;

DO $tester$
DECLARE
  v_user uuid := '2715a000-0000-4000-8000-000000000001';
  v_brand uuid := '2715a000-0000-4000-8000-000000000002';
  v_operation_a uuid := '2715a000-0000-4000-8000-000000000003';
  v_operation_b uuid := '2715a000-0000-4000-8000-000000000004';
  v_replacement uuid := '2715a000-0000-4000-8000-000000000005';
  v_draft_a public.event_cover_video_jobs;
  v_draft_b public.event_cover_video_jobs;
  v_probe public.event_cover_video_jobs;
  v_replacement_job public.event_cover_video_jobs;
  v_claim public.event_cover_video_jobs;
  v_replay public.event_cover_video_jobs;
  v_first_apply public.event_cover_video_jobs;
  v_second_apply public.event_cover_video_jobs;
  v_lease uuid;
BEGIN
  INSERT INTO auth.users(id,email)
    VALUES(v_user,'issue-2715-tester@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name)
    VALUES(v_user,'issue-2715-tester@test.local','Issue 2715 Tester');
  INSERT INTO public.brands(id,account_id,name,slug,created_at,updated_at)
    VALUES(v_brand,v_user,'Issue 2715 Tester Brand','issue-2715-tester-brand',now(),now());

  -- A real accepted venue draft owns one immutable operation. A capacity/schema
  -- probe for a replacement must not supersede it until p_accept_new=true.
  v_draft_a := public.cover_video_create_or_replay_job(
    p_requested_by => v_user,
    p_client_operation_id => v_operation_a,
    p_target_kind => 'venue_draft',
    p_event_id => NULL,
    p_brand_id => v_brand,
    p_venue_id => NULL,
    p_draft_owner_key => 'draft-cloud-a',
    p_apply_mode => 'published_manual',
    p_provider => 'bunny',
    p_source_file_name => 'cloud-a.mov',
    p_source_mime_type => 'video/quicktime',
    p_source_extension => 'mov',
    p_source_sha256 => repeat('a',64),
    p_source_bytes => 716949,
    p_source_duration_ms => 4867,
    p_trim_start_ms => 0,
    p_trim_end_ms => 4867,
    p_accept_new => true
  );

  v_probe := public.cover_video_create_or_replay_job(
    p_requested_by => v_user,
    p_client_operation_id => v_replacement,
    p_target_kind => 'venue_draft',
    p_event_id => NULL,
    p_brand_id => v_brand,
    p_venue_id => NULL,
    p_draft_owner_key => 'draft-cloud-a',
    p_apply_mode => 'published_manual',
    p_provider => 'bunny',
    p_source_file_name => 'replacement.mp4',
    p_source_mime_type => 'video/mp4',
    p_source_extension => 'mp4',
    p_source_sha256 => repeat('b',64),
    p_source_bytes => 600000,
    p_source_duration_ms => 4800,
    p_trim_start_ms => 0,
    p_trim_end_ms => 4800,
    p_accept_new => false
  );
  IF v_probe.id IS NOT NULL THEN
    RAISE EXCEPTION '#2715 unaccepted replacement probe created a job';
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_draft_a.id) <> 'source_uploading' THEN
    RAISE EXCEPTION '#2715 capacity probe superseded the working upload';
  END IF;

  -- A second venue draft under the same brand is a different target. Neither
  -- intent, status, cancellation, nor a late provider event may cross-attach.
  v_draft_b := public.cover_video_create_or_replay_job(
    p_requested_by => v_user,
    p_client_operation_id => v_operation_b,
    p_target_kind => 'venue_draft',
    p_event_id => NULL,
    p_brand_id => v_brand,
    p_venue_id => NULL,
    p_draft_owner_key => 'draft-cloud-b',
    p_apply_mode => 'published_manual',
    p_provider => 'bunny',
    p_source_file_name => 'cloud-b.mov',
    p_source_mime_type => 'video/quicktime',
    p_source_extension => 'mov',
    p_source_sha256 => repeat('c',64),
    p_source_bytes => 700000,
    p_source_duration_ms => 5000,
    p_trim_start_ms => 0,
    p_trim_end_ms => 5000,
    p_accept_new => true
  );
  IF v_draft_a.id = v_draft_b.id OR
     (SELECT count(*) FROM public.event_cover_video_jobs
       WHERE brand_id=v_brand AND target_kind='venue_draft' AND status='source_uploading') <> 2 THEN
    RAISE EXCEPTION '#2715 concurrent venue drafts cross-attached under one brand';
  END IF;

  v_replay := public.cover_video_create_or_replay_job(
    p_requested_by => v_user,
    p_client_operation_id => v_operation_a,
    p_target_kind => 'venue_draft',
    p_event_id => NULL,
    p_brand_id => v_brand,
    p_venue_id => NULL,
    p_draft_owner_key => 'draft-cloud-a',
    p_apply_mode => 'published_manual',
    p_provider => 'bunny',
    p_source_file_name => 'cloud-a.mov',
    p_source_mime_type => 'video/quicktime',
    p_source_extension => 'mov',
    p_source_sha256 => repeat('a',64),
    p_source_bytes => 716949,
    p_source_duration_ms => 4867,
    p_trim_start_ms => 0,
    p_trim_end_ms => 4867,
    p_accept_new => false
  );
  IF v_replay.id <> v_draft_a.id THEN
    RAISE EXCEPTION '#2715 interrupted intent response minted a second job';
  END IF;

  -- Discard the commit response to model an uncertain network result. A replay
  -- must recover the canonical provider identity and never allocate a second.
  v_claim := public.cover_video_claim_provider_allocation(v_draft_a.id,60);
  v_lease := v_claim.provider_allocation_token;
  IF v_lease IS NULL THEN
    RAISE EXCEPTION '#2715 allocation owner did not receive a lease';
  END IF;
  PERFORM public.cover_video_commit_provider_allocation(
    v_draft_a.id,v_lease,'provider-a','provider-a',
    'https://tus.example.test/provider-a',716949,now()+interval '1 hour'
  );
  v_replay := public.cover_video_claim_provider_allocation(v_draft_a.id,60);
  IF v_replay.source_asset_id <> 'provider-a' OR
     v_replay.tus_resource_url <> 'https://tus.example.test/provider-a' OR
     v_replay.provider_allocation_token IS NOT NULL THEN
    RAISE EXCEPTION '#2715 uncertain allocation commit lost canonical provider truth';
  END IF;
  IF (SELECT count(*) FROM public.event_cover_video_jobs WHERE id=v_draft_a.id AND source_asset_id='provider-a') <> 1 THEN
    RAISE EXCEPTION '#2715 uncertain allocation response created a second asset identity';
  END IF;

  PERFORM public.cover_video_transition_job(v_draft_a.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}');
  PERFORM public.cover_video_transition_job(v_draft_a.id,ARRAY['source_uploaded'],'processing',2,NULL,'{}');
  UPDATE public.event_cover_video_jobs
    SET provider_checked_at=now()-interval '1105 seconds',created_at=now()-interval '1105 seconds'
    WHERE id=v_draft_a.id;

  -- Cancel B, then deliver out-of-order Processing and Finished. Canonical
  -- cancellation wins and A remains entirely untouched.
  v_draft_b := public.cover_video_cancel_once(v_draft_b.id);
  PERFORM public.cover_video_transition_job(v_draft_b.id,ARRAY['source_uploading'],'processing',2,20,'{}');
  PERFORM public.cover_video_transition_job(
    v_draft_b.id,ARRAY['source_uploading','processing'],'ready',4,100,
    jsonb_build_object('processed_url','https://cdn.example.test/late-b.mp4')
  );
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_draft_b.id) <> 'cancelled' THEN
    RAISE EXCEPTION '#2715 late provider event revived cancelled venue draft';
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_draft_a.id) <> 'processing' THEN
    RAISE EXCEPTION '#2715 venue-draft B status mutated venue-draft A';
  END IF;

  -- Server acceptance is the only point at which replacement supersedes A.
  v_replacement_job := public.cover_video_create_or_replay_job(
    p_requested_by => v_user,
    p_client_operation_id => v_replacement,
    p_target_kind => 'venue_draft',
    p_event_id => NULL,
    p_brand_id => v_brand,
    p_venue_id => NULL,
    p_draft_owner_key => 'draft-cloud-a',
    p_apply_mode => 'published_manual',
    p_provider => 'bunny',
    p_source_file_name => 'replacement.mp4',
    p_source_mime_type => 'video/mp4',
    p_source_extension => 'mp4',
    p_source_sha256 => repeat('b',64),
    p_source_bytes => 600000,
    p_source_duration_ms => 4800,
    p_trim_start_ms => 0,
    p_trim_end_ms => 4800,
    p_accept_new => true
  );
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_draft_a.id) <> 'superseded' OR
     v_replacement_job.status <> 'source_uploading' THEN
    RAISE EXCEPTION '#2715 accepted replacement did not atomically supersede prior work';
  END IF;
  PERFORM public.cover_video_transition_job(v_draft_a.id,ARRAY['processing'],'ready',4,100,'{}');
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_draft_a.id) <> 'superseded' THEN
    RAISE EXCEPTION '#2715 late Finished revived superseded work';
  END IF;

  v_claim := public.cover_video_claim_provider_allocation(v_replacement_job.id,60);
  v_lease := v_claim.provider_allocation_token;
  IF v_lease IS NULL THEN
    RAISE EXCEPTION '#2715 replacement allocation owner did not receive a lease';
  END IF;
  v_replacement_job := public.cover_video_commit_provider_allocation(
    v_replacement_job.id,v_lease,'provider-replacement','provider-replacement',
    'https://tus.example.test/provider-replacement',600000,now()+interval '1 hour'
  );
  PERFORM public.cover_video_transition_job(v_replacement_job.id,ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}');
  PERFORM public.cover_video_transition_job(
    v_replacement_job.id,ARRAY['source_uploaded'],'ready',4,100,
    jsonb_build_object(
      'processed_url','https://cdn.example.test/replacement.mp4',
      'processed_poster_url','https://cdn.example.test/replacement.jpg',
      'processed_mime_type','video/mp4',
      'processed_bytes',500000,
      'processed_duration_ms',4800,
      'processed_video_codec','x264'
    )
  );
  UPDATE public.event_cover_video_jobs
    SET provider_checked_at=now()-interval '1105 seconds',created_at=now()-interval '1105 seconds'
    WHERE id=v_replacement_job.id;
  SELECT * INTO v_claim
    FROM public.cover_video_claim_reconcile_jobs(100,60)
    WHERE id=v_replacement_job.id;
  IF v_claim.id IS NULL OR v_claim.status <> 'ready' OR v_claim.reaped_at IS NOT NULL THEN
    RAISE EXCEPTION '#2715 1105-second ready asset did not survive reaper reconciliation';
  END IF;

  -- Two apply contenders receive one canonical receipt/version. The RPC row
  -- lock is the serialization point; replay must never write twice.
  v_first_apply := public.cover_video_apply_once(
    v_replacement_job.id,0,'https://cdn.example.test/replacement.mp4',v_user
  );
  v_second_apply := public.cover_video_apply_once(
    v_replacement_job.id,0,'https://cdn.example.test/replacement.mp4',v_user
  );
  IF v_first_apply.status <> 'applied' OR v_second_apply.status <> 'applied' OR
     v_first_apply.application_version <> 1 OR v_second_apply.application_version <> 1 OR
     v_first_apply.application_receipt IS DISTINCT FROM v_second_apply.application_receipt THEN
    RAISE EXCEPTION '#2715 concurrent apply replay produced more than one application';
  END IF;
END
$tester$;

ROLLBACK;

-- The transaction above proves the full race matrix without leaving fixtures.
-- This second, committed fixture exists only long enough for two independent
-- PostgreSQL sessions to contend on cover_video_apply_once's real row lock.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

BEGIN;
DELETE FROM public.event_cover_video_jobs
  WHERE id='2715b000-0000-4000-8000-000000000006';
DELETE FROM public.events WHERE id='2715b000-0000-4000-8000-000000000003';
DELETE FROM public.brands WHERE id='2715b000-0000-4000-8000-000000000002';
DELETE FROM public.creator_accounts WHERE id='2715b000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id='2715b000-0000-4000-8000-000000000001';

INSERT INTO auth.users(id,email)
  VALUES('2715b000-0000-4000-8000-000000000001','issue-2715-apply-race@test.local');
INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES('2715b000-0000-4000-8000-000000000001','issue-2715-apply-race@test.local','Issue 2715 Apply Race');
INSERT INTO public.brands(id,account_id,name,slug,created_at,updated_at)
  VALUES(
    '2715b000-0000-4000-8000-000000000002',
    '2715b000-0000-4000-8000-000000000001',
    'Issue 2715 Apply Race Brand','issue-2715-apply-race-brand',now(),now()
  );
INSERT INTO public.events(id,brand_id,created_by,title,slug,status,event_type,created_at,updated_at)
  VALUES(
    '2715b000-0000-4000-8000-000000000003',
    '2715b000-0000-4000-8000-000000000002',
    '2715b000-0000-4000-8000-000000000001',
    'Issue 2715 Apply Race','issue-2715-apply-race','draft','event',now(),now()
  );
COMMIT;

-- Two independent sessions start different venue drafts for one brand before
-- either result is collected. Target locking/keying must not serialize them as
-- one entity or let either operation supersede/cross-attach the other.
CREATE TEMP TABLE issue_2715_draft_race_results(draft_key text,id uuid);
SELECT extensions.dblink_connect(
  'issue2715_draft_a',
  'hostaddr=127.0.0.1'||
    ' port='||current_setting('port')||
    ' dbname='||current_database()||' user='||session_user
);
SELECT extensions.dblink_connect(
  'issue2715_draft_b',
  'hostaddr=127.0.0.1'||
    ' port='||current_setting('port')||
    ' dbname='||current_database()||' user='||session_user
);
SELECT extensions.dblink_send_query('issue2715_draft_a',$draft_a$
  SELECT 'draft-concurrent-a'::text,(public.cover_video_create_or_replay_job(
    '2715b000-0000-4000-8000-000000000001','2715b000-0000-4000-8000-000000000011',
    'venue_draft',NULL,'2715b000-0000-4000-8000-000000000002',NULL,
    'draft-concurrent-a','published_manual','bunny','draft-a.mp4','video/mp4','mp4',
    repeat('a',64),717000,4900,0,4900,true
  )).id
$draft_a$);
SELECT extensions.dblink_send_query('issue2715_draft_b',$draft_b$
  SELECT 'draft-concurrent-b'::text,(public.cover_video_create_or_replay_job(
    '2715b000-0000-4000-8000-000000000001','2715b000-0000-4000-8000-000000000012',
    'venue_draft',NULL,'2715b000-0000-4000-8000-000000000002',NULL,
    'draft-concurrent-b','published_manual','bunny','draft-b.mp4','video/mp4','mp4',
    repeat('b',64),718000,5000,0,5000,true
  )).id
$draft_b$);
INSERT INTO issue_2715_draft_race_results
  SELECT * FROM extensions.dblink_get_result('issue2715_draft_a') AS result(draft_key text,id uuid);
INSERT INTO issue_2715_draft_race_results
  SELECT * FROM extensions.dblink_get_result('issue2715_draft_b') AS result(draft_key text,id uuid);
SELECT extensions.dblink_disconnect('issue2715_draft_a');
SELECT extensions.dblink_disconnect('issue2715_draft_b');

DO $concurrent_drafts$
BEGIN
  IF (SELECT count(DISTINCT id) FROM issue_2715_draft_race_results) <> 2 OR
     (SELECT count(*) FROM public.event_cover_video_jobs j
       JOIN issue_2715_draft_race_results r ON r.id=j.id AND r.draft_key=j.draft_owner_key
       WHERE j.brand_id='2715b000-0000-4000-8000-000000000002'
         AND j.target_kind='venue_draft' AND j.status='source_uploading') <> 2 THEN
    RAISE EXCEPTION '#2715 concurrent same-brand venue drafts cross-attached or superseded';
  END IF;
END
$concurrent_drafts$;

BEGIN;

SELECT (public.cover_video_create_or_replay_job(
  p_requested_by => '2715b000-0000-4000-8000-000000000001',
  p_client_operation_id => '2715b000-0000-4000-8000-000000000004',
  p_target_kind => 'event',
  p_event_id => '2715b000-0000-4000-8000-000000000003',
  p_brand_id => '2715b000-0000-4000-8000-000000000002',
  p_venue_id => NULL,
  p_draft_owner_key => NULL,
  p_apply_mode => 'published_manual',
  p_provider => 'bunny',
  p_source_file_name => 'apply-race.mp4',
  p_source_mime_type => 'video/mp4',
  p_source_extension => 'mp4',
  p_source_sha256 => repeat('d',64),
  p_source_bytes => 500000,
  p_source_duration_ms => 4000,
  p_trim_start_ms => 0,
  p_trim_end_ms => 4000,
  p_accept_new => true
)).id AS id \gset apply_job_

UPDATE public.event_cover_video_jobs
SET id='2715b000-0000-4000-8000-000000000006'
WHERE id=:'apply_job_id';
SELECT public.cover_video_transition_job(
  '2715b000-0000-4000-8000-000000000006',ARRAY['source_uploading'],'source_uploaded',1,NULL,'{}'
);
SELECT public.cover_video_transition_job(
  '2715b000-0000-4000-8000-000000000006',ARRAY['source_uploaded'],'ready',4,100,
  jsonb_build_object(
    'processed_url','https://cdn.example.test/concurrent-apply.mp4',
    'processed_poster_url','https://cdn.example.test/concurrent-apply.jpg',
    'processed_mime_type','video/mp4','processed_bytes',450000,
    'processed_duration_ms',4000,'processed_video_codec','x264'
  )
);
COMMIT;

CREATE TEMP TABLE issue_2715_apply_race_results(version bigint);
SELECT extensions.dblink_connect(
  'issue2715_apply_a',
  'hostaddr=127.0.0.1'||
    ' port='||current_setting('port')||
    ' dbname='||current_database()||' user='||session_user
);
SELECT extensions.dblink_connect(
  'issue2715_apply_b',
  'hostaddr=127.0.0.1'||
    ' port='||current_setting('port')||
    ' dbname='||current_database()||' user='||session_user
);
SELECT extensions.dblink_send_query(
  'issue2715_apply_a',
  $$SELECT (public.cover_video_apply_once(
    '2715b000-0000-4000-8000-000000000006',0,
    'https://cdn.example.test/concurrent-apply.mp4',NULL
  )).application_version$$
);
SELECT extensions.dblink_send_query(
  'issue2715_apply_b',
  $$SELECT (public.cover_video_apply_once(
    '2715b000-0000-4000-8000-000000000006',0,
    'https://cdn.example.test/concurrent-apply.mp4',NULL
  )).application_version$$
);
INSERT INTO issue_2715_apply_race_results
  SELECT version FROM extensions.dblink_get_result('issue2715_apply_a') AS result(version bigint);
INSERT INTO issue_2715_apply_race_results
  SELECT version FROM extensions.dblink_get_result('issue2715_apply_b') AS result(version bigint);
SELECT extensions.dblink_disconnect('issue2715_apply_a');
SELECT extensions.dblink_disconnect('issue2715_apply_b');

DO $concurrent_apply$
BEGIN
  IF (SELECT count(*) FROM issue_2715_apply_race_results WHERE version=1) <> 2 OR
     (SELECT application_version FROM public.event_cover_video_jobs
       WHERE id='2715b000-0000-4000-8000-000000000006') <> 1 OR
     (SELECT cover_media_url FROM public.events
       WHERE id='2715b000-0000-4000-8000-000000000003') <>
       'https://cdn.example.test/concurrent-apply.mp4' THEN
    RAISE EXCEPTION '#2715 concurrent apply did not converge on one canonical write';
  END IF;
END
$concurrent_apply$;

BEGIN;
DELETE FROM public.event_cover_video_jobs
  WHERE brand_id='2715b000-0000-4000-8000-000000000002';
DELETE FROM public.events WHERE id='2715b000-0000-4000-8000-000000000003';
DELETE FROM public.brands WHERE id='2715b000-0000-4000-8000-000000000002';
DELETE FROM public.creator_accounts WHERE id='2715b000-0000-4000-8000-000000000001';
DELETE FROM auth.users WHERE id='2715b000-0000-4000-8000-000000000001';
COMMIT;
