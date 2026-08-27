-- ===========================================================================
-- #2491 C2 step 1b — the counter is now WATCHED. Without this it is latent.
--
-- Step 1 added sold_count/held_count and the triggers that maintain them, plus
-- issue_2491_reconcile_ticket_type_counters() to detect drift. That reconciler
-- HAD NO CALLER. A detector nothing runs is the same defect as a worker nothing
-- schedules (I-2290-QUEUE-WORKER-HAS-CRON-CALLER) — the code is correct, the
-- tests pass, and it is dead in production.
--
-- It also made the 72-hour shadow period a promise rather than a measurement:
-- nothing was accumulating evidence, so on day 3 there would have been nothing
-- to read and the honest answer would have been "run it now and hope".
--
-- This migration makes the shadow period RUN ITSELF and leave a record.
--
-- A ZERO IS MEANINGLESS WITHOUT ITS DENOMINATOR. Every run writes a row
-- carrying checked_count, so `drift_count = 0 over 412 checked` is a pass and
-- the ABSENCE of rows is a failed job — those two must never look alike.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ticket_type_counter_shadow_runs (
  id              bigserial PRIMARY KEY,
  observed_at     timestamptz NOT NULL DEFAULT now(),
  checked_count   integer     NOT NULL,
  drift_count     integer     NOT NULL,
  drift           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  duration_ms     numeric     NOT NULL
);

COMMENT ON TABLE public.ticket_type_counter_shadow_runs IS
  'issue #2491 C2 — one row per shadow reconciliation run. checked_count is the DENOMINATOR: drift_count=0 is only a pass when checked_count>0. No rows at all means the cron job is not running, which is a failure, not a pass.';

CREATE INDEX IF NOT EXISTS idx_2491_shadow_runs_observed_at
  ON public.ticket_type_counter_shadow_runs (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_2491_shadow_runs_drift
  ON public.ticket_type_counter_shadow_runs (observed_at DESC) WHERE drift_count > 0;

-- Internal observability only. No client of any kind reads this table, so it
-- gets NO anon/authenticated grants — new public tables inherit them by default
-- and RLS would only hide the rows, not the grant.
REVOKE ALL ON public.ticket_type_counter_shadow_runs FROM anon, authenticated;
ALTER TABLE public.ticket_type_counter_shadow_runs ENABLE ROW LEVEL SECURITY;

-- ── the observer ───────────────────────────────────────────────────────────
-- Deliberately does NOT repair. Step 1 repairs nothing; it is earning trust.
-- It records rather than raising, because a RAISE inside pg_cron leaves its
-- evidence in cron.job_run_details where no dashboard looks and retention is
-- not ours to control.
CREATE OR REPLACE FUNCTION public.issue_2491_observe_counter_shadow()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_started timestamptz := clock_timestamp();
        v_report jsonb; v_checked int; v_drift_n int;
BEGIN
  SELECT count(*) INTO v_checked
    FROM public.ticket_types tt WHERE tt.deleted_at IS NULL;

  v_report := public.issue_2491_reconcile_ticket_type_counters(false);
  v_drift_n := COALESCE(jsonb_array_length(v_report->'drift'), 0);

  INSERT INTO public.ticket_type_counter_shadow_runs
    (checked_count, drift_count, drift, duration_ms)
  VALUES (v_checked, v_drift_n, COALESCE(v_report->'drift','[]'::jsonb),
          EXTRACT(milliseconds FROM clock_timestamp() - v_started));

  RETURN jsonb_build_object('checked', v_checked, 'drift', v_drift_n);
END $$;

REVOKE ALL ON FUNCTION public.issue_2491_observe_counter_shadow() FROM PUBLIC, anon, authenticated;

-- ── the caller ─────────────────────────────────────────────────────────────
-- Every 15 minutes: 72 hours of shadow is then ~288 independent observations,
-- which is a measurement. Cheap: the reconciler is a scan of ticket_types.
SELECT cron.unschedule('issue_2491_counter_shadow_observer')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='issue_2491_counter_shadow_observer');
SELECT cron.schedule('issue_2491_counter_shadow_observer', '*/15 * * * *',
                     $cron$SELECT public.issue_2491_observe_counter_shadow();$cron$);

-- ── the readout ────────────────────────────────────────────────────────────
-- What step 2 asks on day 3. Named so the answer is a query, not an archaeology
-- expedition. Returns verdict='insufficient_evidence' when the window is thin,
-- so a job that silently stopped can never read as a clean pass.
CREATE OR REPLACE FUNCTION public.issue_2491_counter_shadow_verdict(p_hours integer DEFAULT 72)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT * FROM public.ticket_type_counter_shadow_runs
     WHERE observed_at > now() - make_interval(hours => p_hours)
  )
  SELECT jsonb_build_object(
    'windowHours', p_hours,
    'runs', (SELECT count(*) FROM w),
    'expectedRuns', (p_hours * 4),
    'ticketTypesChecked', COALESCE((SELECT max(checked_count) FROM w), 0),
    'runsWithDrift', (SELECT count(*) FROM w WHERE drift_count > 0),
    'lastRunAt', (SELECT max(observed_at) FROM w),
    'verdict', CASE
      WHEN (SELECT count(*) FROM w) < (p_hours * 4 * 0.9) THEN 'insufficient_evidence'
      WHEN (SELECT count(*) FROM w WHERE drift_count > 0) > 0 THEN 'drift_detected'
      ELSE 'clean' END);
$$;

REVOKE ALL ON FUNCTION public.issue_2491_counter_shadow_verdict(integer) FROM PUBLIC, anon, authenticated;

-- ── probe ──────────────────────────────────────────────────────────────────
DO $probe$
DECLARE v jsonb; v_rows int; v_sched int;
BEGIN
  -- 1. the observer actually WRITES a row (a recorder that records nothing is
  --    indistinguishable from a clean run)
  PERFORM public.issue_2491_observe_counter_shadow();
  SELECT count(*) INTO v_rows FROM public.ticket_type_counter_shadow_runs;
  IF v_rows < 1 THEN RAISE EXCEPTION 'PROBE FAIL: observer wrote no row'; END IF;

  -- 2. the recorded denominator must equal the real one. On a from-zero CI
  --    replay both are 0, which is honest; what must never happen is the
  --    observer reporting 0 while ticket types exist.
  SELECT checked_count INTO v_rows FROM public.ticket_type_counter_shadow_runs
   ORDER BY id DESC LIMIT 1;
  SELECT count(*) INTO v_sched FROM public.ticket_types WHERE deleted_at IS NULL;
  IF v_rows <> v_sched THEN
    RAISE EXCEPTION 'PROBE FAIL: observer recorded checked_count=% but % live ticket types exist', v_rows, v_sched;
  END IF;
  RAISE NOTICE 'PROBE: observer checked % ticket types (denominator matches)', v_rows;

  -- 3. THE CALLER EXISTS. This is the whole point of the migration.
  SELECT count(*) INTO v_sched FROM cron.job WHERE jobname='issue_2491_counter_shadow_observer';
  IF v_sched <> 1 THEN RAISE EXCEPTION 'PROBE FAIL: cron caller absent — detector is dead code'; END IF;

  -- 4. a thin window must NOT read as clean
  v := public.issue_2491_counter_shadow_verdict(72);
  IF v->>'verdict' <> 'insufficient_evidence' THEN
    RAISE EXCEPTION 'PROBE FAIL: 1 run in a 72h window reported %, must be insufficient_evidence', v->>'verdict';
  END IF;
  RAISE NOTICE 'PROBE: fresh window correctly reports %', v->>'verdict';
END $probe$;

COMMIT;
