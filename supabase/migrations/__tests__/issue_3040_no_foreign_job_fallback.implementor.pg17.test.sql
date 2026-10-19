-- Issue #3040 (T-B17): a unique violation never hands the caller another operation's job.
-- MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | a caller only ever receives its own operation's job and transport
--
-- FAILS ON REVERT: restore the any-active-row fallback in the
-- cover_video_create_or_replay_job unique_violation handler and the call below
-- returns the first host's job instead of raising.
BEGIN;

DO $test$
DECLARE
  v_first_user uuid := '30400000-0000-4000-8000-000000000701';
  v_second_user uuid := '30400000-0000-4000-8000-000000000702';
  v_brand uuid := '30400000-0000-4000-8000-000000000703';
  v_event uuid := '30400000-0000-4000-8000-000000000704';
  v_first public.event_cover_video_jobs;
  v_second public.event_cover_video_jobs;
  v_raised boolean := false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_first_user,'issue-3040-foreign-a@test.local'),(v_second_user,'issue-3040-foreign-b@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES(v_first_user,'issue-3040-foreign-a@test.local','A');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_first_user,'Issue 3040 Foreign Brand','issue-3040-foreign-brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme)
    VALUES(v_event,v_brand,v_first_user,'Foreign','issue-3040-foreign','event','draft','draft','UTC','USD','{"business_draft":{"clientRevision":0}}'::jsonb);

  v_first := public.cover_video_create_or_replay_job(
    v_first_user,'30400000-0000-4000-8000-000000000711','event',v_event,v_brand,NULL,NULL,
    'published_manual','bunny','a.mp4','video/mp4','mp4',repeat('a',64),1000000,10000,0,10000,true);

  -- Stand-in for a writer that does not take the advisory lock: a test-only
  -- unique index that the supersede step cannot clear forces the INSERT to
  -- hit unique_violation exactly as a lost race would.
  CREATE UNIQUE INDEX issue_3040_force_unique_violation
    ON public.event_cover_video_jobs(event_id) WHERE target_kind='event' AND client_operation_id IS NOT NULL;

  BEGIN
    v_second := public.cover_video_create_or_replay_job(
      v_second_user,'30400000-0000-4000-8000-000000000712','event',v_event,v_brand,NULL,NULL,
      'published_manual','bunny','b.mp4','video/mp4','mp4',repeat('b',64),1000000,10000,0,10000,true);
  EXCEPTION WHEN unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '#3040 a unique violation returned job % (first host job %) instead of raising',
      v_second.id, v_first.id;
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id=v_first.id) <> 'source_uploading' THEN
    RAISE EXCEPTION '#3040 the failed attempt still superseded the first host job';
  END IF;
END
$test$;

ROLLBACK;

\echo 'issue_3040_no_foreign_job_fallback.implementor.pg17: PASS'
