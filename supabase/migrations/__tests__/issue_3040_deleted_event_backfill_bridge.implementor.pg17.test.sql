-- Issue #3040 production-reproduction proof.
--
-- The full chain has already applied both #3040 migrations. This test creates
-- the exact historical shape found in production, proves the canonical strict
-- trigger blocks an unrelated update, then reapplies the bridge followed by
-- the one-minute migration. Both files own their BEGIN/COMMIT because the
-- production failure happened at migration-apply time, not inside an RPC.

\set ON_ERROR_STOP on

INSERT INTO auth.users(id,email)
VALUES('30400000-0000-4000-8000-000000000101','issue-3040-deleted@test.local');
INSERT INTO public.creator_accounts(id,email,display_name)
VALUES('30400000-0000-4000-8000-000000000101','issue-3040-deleted@test.local','Issue 3040 Deleted Event');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES(
  '30400000-0000-4000-8000-000000000102',
  '30400000-0000-4000-8000-000000000101',
  'Issue 3040 Deleted Event Brand',
  'issue-3040-deleted-event-brand',
  'USD',
  now(),now()
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme
)
VALUES(
  '30400000-0000-4000-8000-000000000103',
  '30400000-0000-4000-8000-000000000102',
  '30400000-0000-4000-8000-000000000101',
  'Issue 3040 Deleted Event',
  'issue-3040-deleted-event',
  'event',
  'draft',
  'draft',
  'UTC',
  'USD',
  '{"business_draft":{"clientRevision":0}}'::jsonb
);

SELECT public.cover_video_create_or_replay_job(
  '30400000-0000-4000-8000-000000000101',
  '30400000-0000-4000-8000-000000000104',
  'event',
  '30400000-0000-4000-8000-000000000103',
  '30400000-0000-4000-8000-000000000102',
  NULL,
  NULL,
  'published_manual',
  'bunny',
  'deleted-event.mp4',
  'video/mp4',
  'mp4',
  repeat('d',64),
  1000000,
  15000,
  0,
  15000,
  true
);

UPDATE public.event_cover_video_jobs
SET status='applied',
    processed_url='https://video-cdn.test/issue-3040/deleted-event.mp4',
    processed_mime_type='video/mp4',
    processed_bytes=900000,
    processed_duration_ms=15000,
    source_uploaded_at=NULL
WHERE client_operation_id='30400000-0000-4000-8000-000000000104';
UPDATE public.events
SET deleted_at=now()
WHERE id='30400000-0000-4000-8000-000000000103';

DO $strict_trigger_reproduces_production$
BEGIN
  BEGIN
    UPDATE public.event_cover_video_jobs
    SET provider_checked_at=now()
    WHERE client_operation_id='30400000-0000-4000-8000-000000000104';
    RAISE EXCEPTION '#3040 strict trigger unexpectedly updated a deleted-event job';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_event_brand_mismatch' THEN RAISE; END IF;
  END;
END
$strict_trigger_reproduces_production$;

\ir ../20271102003039_issue_3040_deleted_event_backfill_bridge.sql

-- The bridge refuses every unrelated update; only the exact clock backfill in
-- the following migration receives the narrow deleted-event exception.
DO $bridge_refuses_unrelated_update$
BEGIN
  BEGIN
    UPDATE public.event_cover_video_jobs
    SET provider_checked_at=now()
    WHERE client_operation_id='30400000-0000-4000-8000-000000000104';
    RAISE EXCEPTION '#3040 bridge unexpectedly permitted an unrelated update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_event_brand_mismatch' THEN RAISE; END IF;
  END;
END
$bridge_refuses_unrelated_update$;

-- The bridge does not permit an identity rewrite while the target is deleted.
DO $bridge_keeps_identity_immutable$
BEGIN
  BEGIN
    UPDATE public.event_cover_video_jobs
    SET brand_id='30400000-0000-4000-8000-000000000199'
    WHERE client_operation_id='30400000-0000-4000-8000-000000000104';
    RAISE EXCEPTION '#3040 bridge unexpectedly permitted an identity rewrite';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN (
      'cover_video_identity_immutable',
      'cover_video_event_brand_mismatch'
    ) THEN RAISE; END IF;
  END;
END
$bridge_keeps_identity_immutable$;

-- Reapply the exact migration that production rejected. Its backfill must now
-- succeed and the migration must restore the strict canonical trigger body.
\ir ../20271102003040_issue_3040_one_minute_video_slo.sql

DO $verify$
DECLARE
  v_job public.event_cover_video_jobs;
BEGIN
  SELECT * INTO v_job
  FROM public.event_cover_video_jobs
  WHERE client_operation_id='30400000-0000-4000-8000-000000000104';
  IF v_job.source_uploaded_at IS NULL OR v_job.status <> 'applied'
     OR v_job.event_id <> '30400000-0000-4000-8000-000000000103'::uuid
     OR v_job.brand_id <> '30400000-0000-4000-8000-000000000102'::uuid THEN
    RAISE EXCEPTION '#3040 bridge changed identity/status or failed to backfill the clock';
  END IF;

  BEGIN
    UPDATE public.event_cover_video_jobs
    SET provider_checked_at=now()
    WHERE id=v_job.id;
    RAISE EXCEPTION '#3040 one-minute migration did not restore the strict trigger';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_event_brand_mismatch' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.cover_video_create_or_replay_job(
      '30400000-0000-4000-8000-000000000101',
      '30400000-0000-4000-8000-000000000105',
      'event',
      '30400000-0000-4000-8000-000000000103',
      '30400000-0000-4000-8000-000000000102',
      NULL,NULL,'published_manual','bunny','new.mp4','video/mp4','mp4',repeat('e',64),
      1000000,15000,0,15000,true
    );
    RAISE EXCEPTION '#3040 bridge permitted a new job for a deleted event';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cover_video_event_brand_mismatch' THEN RAISE; END IF;
  END;
END
$verify$;

DELETE FROM public.event_cover_video_jobs
WHERE client_operation_id IN (
  '30400000-0000-4000-8000-000000000104',
  '30400000-0000-4000-8000-000000000105'
);
DELETE FROM public.events WHERE id='30400000-0000-4000-8000-000000000103';
DELETE FROM public.brands WHERE id='30400000-0000-4000-8000-000000000102';
DELETE FROM public.creator_accounts WHERE id='30400000-0000-4000-8000-000000000101';
DELETE FROM auth.users WHERE id='30400000-0000-4000-8000-000000000101';

\echo 'issue_3040_deleted_event_backfill_bridge.implementor.pg17: PASS'
