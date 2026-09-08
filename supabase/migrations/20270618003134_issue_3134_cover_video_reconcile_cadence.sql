-- ---------------------------------------------------------------------------
-- Issue #3134 — a cover video took 31 minutes to appear, and 31 of those
-- minutes were spent waiting for a webhook retry.
--
-- Measured on a real device 2026-09-08. Job 8d38ff2b:
--
--   17:06:15  bytes complete on Bunny (`source_uploaded`, TUS offset == length)
--   17:37:45  Bunny's "Finished" webhook lands, job applied 0.1s later
--
-- Compression took ~4s and the upload ~4s. Everything else was dead time.
--
-- The webhook handler answers 503 when Bunny has not yet computed
-- `originalHash` for the source (`source_identity_pending`), which is correct
-- as a refusal to publish an unverified asset — but the consequence is that
-- Bunny reschedules on ITS backoff, and we have no say in when it returns.
-- Directly observed for this job: `originalHash` was still null at 17:09 and
-- 17:11 while the video sat at status 2.
--
-- The reconciler is the answer, and it already does the whole job: for any
-- claimed candidate it fetches the provider video and drives the REAL
-- `handleBunnyWebhook` with a signed synthetic body, identity check included.
-- It simply ran too rarely to matter — every 6 hours — so a bounced webhook
-- meant waiting on Bunny, with a 6-hour floor underneath it.
--
-- Every minute makes the reconciler the primary liveness path rather than a
-- distant backstop: whatever the webhook does, a finished video is applied
-- within ~60s.
--
-- Safe at this cadence by construction:
--   * `cover_video_claim_reconcile_jobs` leases its candidates, so overlapping
--     ticks cannot double-drive a job.
--   * The stall (12h) and abandoned-draft (24h) deadlines are absolute times,
--     not tick counts. The #2905 note reasoned that 12h guarantees "at least
--     TWO full provider-truth attempts" at a 6-hour tick; at one minute a job
--     gets ~720, so that guarantee is strengthened, never weakened.
--   * A tick with no claimable candidate exits without touching Bunny, which
--     is the overwhelmingly common case.
-- ---------------------------------------------------------------------------

BEGIN;

DO $reschedule$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'meta_orch_1270_cover_video_reaper';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_3134: cover-video reaper cron not found; nothing to reschedule';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id := v_jobid, schedule := '* * * * *');
  RAISE NOTICE 'issue_3134: cover-video reconcile cadence is now every minute (job %)', v_jobid;
END;
$reschedule$;

COMMIT;
