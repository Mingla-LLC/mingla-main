-- ORCH-0558 Step 4 — Match telemetry events table.
--
-- Establishes I-COLLAB-MATCH-OBSERVABLE: every attempted promotion emits
-- a telemetry event with a machine-readable reason. Consumed by admin
-- dashboard + Sentry alerts on reason='error' or event_type='collab_match_notification_failed'.
--
-- Written by:
--   - check_mutual_like trigger (migration 20260421000003)
--   - rpc_record_swipe_and_check_match RPC (migration 20260421000005)
--   - notify-session-match edge function (SPEC §4.2)
--   - collabSaveCard mobile helper (Mixpanel mirror — client-side)
--
-- Retention: 30 days rolling (per orchestrator decision D2). Implemented
-- via pg_cron job below — pg_cron 1.6.4 verified available in pre-flight.
-- If pg_cron is ever disabled/unavailable, the manual purge SQL is in
-- the header for ops to run quarterly.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.match_telemetry_events CASCADE;
--   SELECT cron.unschedule('orch_0558_match_telemetry_purge');  -- if scheduled

-- Must run BEFORE 20260421000003 (trigger writes to this table) and
-- BEFORE 20260421000005 (RPC writes to this table). Timestamp ordering
-- 000001 < 000002 < 000004 < 000003 < 000005 handled by Supabase's
-- filename-sort — BUT 000004 runs after 000003 by timestamp. To keep
-- dependencies clean, trigger/RPC migrations use INSERT ... ON CONFLICT
-- DO NOTHING (telemetry is advisory, not transactional) and tolerate
-- missing telemetry table via IF EXISTS guards where possible. In
-- practice the user runs all 5 in one `supabase db push`, so ordering
-- inside the push is by filename ascending: 001,002,003,004,005.
-- Therefore 003 MUST tolerate missing telemetry table (guard below).

-- ==========================================================================
-- Step 4a — Create telemetry table
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.match_telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'collab_match_attempt',
    'collab_match_promotion_success',
    'collab_match_promotion_skipped',
    'collab_match_notification_delivered',
    'collab_match_notification_failed'
  )),
  session_id UUID NOT NULL,
  experience_id TEXT NOT NULL,
  user_id UUID,
  saved_card_id UUID,
  reason TEXT,
  quorum_count INTEGER,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS match_telemetry_session_idx
  ON public.match_telemetry_events(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS match_telemetry_event_type_idx
  ON public.match_telemetry_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS match_telemetry_reason_idx
  ON public.match_telemetry_events(reason, created_at DESC)
  WHERE reason IS NOT NULL;

-- Index for retention purge
CREATE INDEX IF NOT EXISTS match_telemetry_created_at_idx
  ON public.match_telemetry_events(created_at);

COMMENT ON TABLE public.match_telemetry_events IS
  'ORCH-0558: Per-event log of collab match lifecycle. Written by '
  'check_mutual_like trigger, rpc_record_swipe_and_check_match RPC, '
  'and notify-session-match edge fn. Consumed by admin dashboard + Sentry '
  'alerts on reason=error. Retention: 30 days rolling via pg_cron.';

-- ==========================================================================
-- Step 4b — RLS
-- ==========================================================================

ALTER TABLE public.match_telemetry_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mte_service_read" ON public.match_telemetry_events
FOR SELECT USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "mte_trigger_insert" ON public.match_telemetry_events
FOR INSERT WITH CHECK (auth.role() = 'service_role' OR current_user = 'postgres');

-- ==========================================================================
-- Step 4c — 30-day retention via pg_cron
-- ==========================================================================

-- Create extension if not already installed (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily purge of rows older than 30 days.
-- Idempotent: if the job already exists, update it; otherwise create.
DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'orch_0558_match_telemetry_purge';

  IF existing_job_id IS NULL THEN
    PERFORM cron.schedule(
      'orch_0558_match_telemetry_purge',
      '0 3 * * *',  -- 03:00 UTC daily
      $cron$DELETE FROM public.match_telemetry_events WHERE created_at < NOW() - INTERVAL '30 days'$cron$
    );
    RAISE NOTICE 'ORCH-0558: scheduled match_telemetry purge job (daily @ 03:00 UTC)';
  ELSE
    RAISE NOTICE 'ORCH-0558: match_telemetry purge job already scheduled (jobid=%)', existing_job_id;
  END IF;
END $$;

-- Manual purge command (for ops, if pg_cron ever stops running):
--   DELETE FROM public.match_telemetry_events WHERE created_at < NOW() - INTERVAL '30 days';
