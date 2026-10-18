-- ===========================================================================
-- #2879 / #2947 — queue monitors with the EVENT denominator
--
-- #2864's shadow reported `clean` over observations that compared 0 to 0. Every
-- monitor here records both the check's denominator (`checks_run`) and the
-- event's (`queue_windows_observed`). A window with zero queued opportunity
-- returns `insufficient_evidence`, never `clean`. A window with opportunity
-- and zero admissions returns `stalled` (caller missing or dead).
--
-- Counters are WRITE-DRIVEN (triggers on the rows the work mutates), not
-- sample-driven. `issue_2947_queue_monitor_observe` only rolls up what was
-- already recorded and is invoked from the same `issue_2947_queue_admit_due`
-- tick that runs admission — one caller, one cadence.
--
-- Binding (I-PROPOSED-2947-MONITORS-CARRY-THE-EVENT-DENOMINATOR): never return
-- `clean` while `queue_windows_observed = 0`.
-- ===========================================================================

BEGIN;

-- ── Write-driven totals (singleton) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_queue_monitor_totals (
  id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  joins_performed         bigint NOT NULL DEFAULT 0,
  admissions_performed    bigint NOT NULL DEFAULT 0,
  holds_released          bigint NOT NULL DEFAULT 0,
  waitlist_invites_sent   bigint NOT NULL DEFAULT 0,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ticket_queue_monitor_totals IS
  'issue #2947 — write-driven queue event counters. Incremented by triggers on '
  'the rows the work mutates; the observe function only rolls up deltas.';

INSERT INTO public.ticket_queue_monitor_totals (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ticket_queue_monitor_watermark (
  id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  joins_seen              bigint NOT NULL DEFAULT 0,
  admissions_seen         bigint NOT NULL DEFAULT 0,
  releases_seen           bigint NOT NULL DEFAULT 0,
  waitlist_invites_seen   bigint NOT NULL DEFAULT 0
);

INSERT INTO public.ticket_queue_monitor_watermark (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ── One row per observe tick ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_queue_monitor_runs (
  id                        bigserial PRIMARY KEY,
  observed_at               timestamptz NOT NULL DEFAULT now(),
  checks_run                integer NOT NULL,
  queue_windows_observed    integer NOT NULL,
  joins_performed           integer NOT NULL,
  admissions_performed      integer NOT NULL,
  holds_released            integer NOT NULL,
  waitlist_invites_sent     integer NOT NULL,
  waiting_entries           integer NOT NULL,
  orphan_infinity_count     integer NOT NULL DEFAULT 0,
  duration_ms               numeric NOT NULL
);

COMMENT ON TABLE public.ticket_queue_monitor_runs IS
  'issue #2947 — one row per monitor observe. queue_windows_observed is the '
  'EVENT denominator (1 when at least one entry was waiting this tick). '
  'checks_run is the check denominator. A zero-event window must never read as clean.';

CREATE INDEX IF NOT EXISTS idx_2947_queue_monitor_runs_observed_at
  ON public.ticket_queue_monitor_runs (observed_at DESC);

REVOKE ALL ON TABLE public.ticket_queue_monitor_totals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ticket_queue_monitor_watermark FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ticket_queue_monitor_runs FROM PUBLIC, anon, authenticated;
ALTER TABLE public.ticket_queue_monitor_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_totals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_watermark ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_watermark FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_runs FORCE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.ticket_queue_monitor_totals TO service_role;
GRANT ALL ON TABLE public.ticket_queue_monitor_watermark TO service_role;
GRANT ALL ON TABLE public.ticket_queue_monitor_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticket_queue_monitor_runs_id_seq TO service_role;

-- ── Triggers: count at the write, never at the sample ──────────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_monitor_on_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ticket_queue_monitor_totals
       SET joins_performed = joins_performed + 1,
           updated_at = clock_timestamp()
     WHERE id = 1;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.admitted_at IS NOT NULL AND OLD.admitted_at IS NULL THEN
      UPDATE public.ticket_queue_monitor_totals
         SET admissions_performed = admissions_performed + 1,
             updated_at = clock_timestamp()
       WHERE id = 1;
    END IF;
    IF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL THEN
      UPDATE public.ticket_queue_monitor_totals
         SET holds_released = holds_released + 1,
             updated_at = clock_timestamp()
       WHERE id = 1;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS issue_2947_queue_monitor_entry_ai ON public.ticket_queue_entries;
CREATE TRIGGER issue_2947_queue_monitor_entry_ai
  AFTER INSERT ON public.ticket_queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.issue_2947_queue_monitor_on_entry();

DROP TRIGGER IF EXISTS issue_2947_queue_monitor_entry_au ON public.ticket_queue_entries;
CREATE TRIGGER issue_2947_queue_monitor_entry_au
  AFTER UPDATE OF admitted_at, released_at ON public.ticket_queue_entries
  FOR EACH ROW EXECUTE FUNCTION public.issue_2947_queue_monitor_on_entry();

CREATE OR REPLACE FUNCTION public.issue_2947_queue_monitor_on_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'invited'
     AND (OLD.status IS DISTINCT FROM 'invited') THEN
    UPDATE public.ticket_queue_monitor_totals
       SET waitlist_invites_sent = waitlist_invites_sent + 1,
           updated_at = clock_timestamp()
     WHERE id = 1;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS issue_2947_queue_monitor_waitlist_au ON public.waitlist_entries;
CREATE TRIGGER issue_2947_queue_monitor_waitlist_au
  AFTER UPDATE OF status ON public.waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION public.issue_2947_queue_monitor_on_waitlist();

REVOKE ALL ON FUNCTION public.issue_2947_queue_monitor_on_entry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_monitor_on_waitlist() FROM PUBLIC, anon, authenticated;

-- ── Observe: roll up write-driven deltas + event denominator ───────────────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_monitor_observe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_waiting integer;
  v_orphans integer;
  v_totals record;
  v_mark record;
  v_d_joins integer;
  v_d_admits integer;
  v_d_releases integer;
  v_d_invites integer;
  v_windows integer;
  v_id bigint;
BEGIN
  -- Orphan invariant (recorded, not raised here): an infinity hold without a
  -- live queue entry. Observe must not RAISE — create→join is two statements
  -- and a mid-tick race would abort admission. The dedicated assert below
  -- raises; verdict surfaces `orphaned` when any run recorded orphans.
  SELECT count(*)::integer INTO v_orphans
    FROM public.ticket_checkout_sessions s
   WHERE s.expires_at = 'infinity'::timestamptz
     AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
     AND NOT EXISTS (
       SELECT 1 FROM public.ticket_queue_entries q
        WHERE q.checkout_session_id = s.id
          AND q.released_at IS NULL
     );

  SELECT count(*)::integer INTO v_waiting
    FROM public.ticket_queue_entries q
   WHERE q.admitted_at IS NULL AND q.released_at IS NULL;

  SELECT * INTO v_totals FROM public.ticket_queue_monitor_totals WHERE id = 1 FOR UPDATE;
  SELECT * INTO v_mark FROM public.ticket_queue_monitor_watermark WHERE id = 1 FOR UPDATE;

  v_d_joins := GREATEST(v_totals.joins_performed - v_mark.joins_seen, 0)::integer;
  v_d_admits := GREATEST(v_totals.admissions_performed - v_mark.admissions_seen, 0)::integer;
  v_d_releases := GREATEST(v_totals.holds_released - v_mark.releases_seen, 0)::integer;
  v_d_invites := GREATEST(v_totals.waitlist_invites_sent - v_mark.waitlist_invites_seen, 0)::integer;
  -- Opportunity to admit: someone was waiting at sample time, OR this tick's
  -- write-driven deltas show a queue existed (admit runs before observe and
  -- may clear the waiting set in the same tick).
  v_windows := CASE
    WHEN v_waiting > 0 OR v_d_admits > 0 OR v_d_joins > 0 THEN 1
    ELSE 0
  END;

  INSERT INTO public.ticket_queue_monitor_runs (
    checks_run, queue_windows_observed,
    joins_performed, admissions_performed, holds_released, waitlist_invites_sent,
    waiting_entries, orphan_infinity_count, duration_ms
  ) VALUES (
    1, v_windows,
    v_d_joins, v_d_admits, v_d_releases, v_d_invites,
    v_waiting, v_orphans,
    EXTRACT(milliseconds FROM clock_timestamp() - v_started)
  ) RETURNING id INTO v_id;

  UPDATE public.ticket_queue_monitor_watermark
     SET joins_seen = v_totals.joins_performed,
         admissions_seen = v_totals.admissions_performed,
         releases_seen = v_totals.holds_released,
         waitlist_invites_seen = v_totals.waitlist_invites_sent
   WHERE id = 1;

  RETURN jsonb_build_object(
    'runId', v_id,
    'checksRun', 1,
    'queueWindowsObserved', v_windows,
    'waitingEntries', v_waiting,
    'joinsPerformed', v_d_joins,
    'admissionsPerformed', v_d_admits,
    'holdsReleased', v_d_releases,
    'waitlistInvitesSent', v_d_invites
  );
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_monitor_observe() IS
  'issue #2947 — roll up write-driven queue counters into one monitor run. '
  'Records orphan infinity holds without raising (create→join race). '
  'Called from issue_2947_queue_admit_due.';

-- Hard raise for probes / ops — not on the admit tick.
CREATE OR REPLACE FUNCTION public.issue_2947_queue_assert_no_orphan_infinity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*)::integer INTO v_orphans
    FROM public.ticket_checkout_sessions s
   WHERE s.expires_at = 'infinity'::timestamptz
     AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
     AND NOT EXISTS (
       SELECT 1 FROM public.ticket_queue_entries q
        WHERE q.checkout_session_id = s.id
          AND q.released_at IS NULL
     );
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'issue_2947_orphan_infinity_hold'
      USING HINT = format('%s infinity session(s) lack a live queue entry', v_orphans);
  END IF;
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_assert_no_orphan_infinity() IS
  'issue #2947 — raises when an infinity hold has no live queue entry. '
  'Used by migration probes and ops; not called from the admission tick.';

-- ── Verdict: never clean on a zero event denominator ───────────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_verdict(p_hours integer DEFAULT 72)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH w AS (
    SELECT * FROM public.ticket_queue_monitor_runs
     WHERE observed_at > now() - make_interval(hours => GREATEST(p_hours, 0))
  )
  SELECT jsonb_build_object(
    'windowHours', p_hours,
    'checksRun', COALESCE((SELECT sum(checks_run) FROM w), 0),
    'queueWindowsObserved', COALESCE((SELECT sum(queue_windows_observed) FROM w), 0),
    'joinsPerformed', COALESCE((SELECT sum(joins_performed) FROM w), 0),
    'admissionsPerformed', COALESCE((SELECT sum(admissions_performed) FROM w), 0),
    'holdsReleased', COALESCE((SELECT sum(holds_released) FROM w), 0),
    'waitlistInvitesSent', COALESCE((SELECT sum(waitlist_invites_sent) FROM w), 0),
    'orphanInfinityCount', COALESCE((SELECT sum(orphan_infinity_count) FROM w), 0),
    'runs', (SELECT count(*) FROM w),
    'lastRunAt', (SELECT max(observed_at) FROM w),
    'verdict', CASE
      WHEN COALESCE((SELECT sum(orphan_infinity_count) FROM w), 0) > 0
        THEN 'orphaned'
      WHEN COALESCE((SELECT sum(queue_windows_observed) FROM w), 0) = 0
        THEN 'insufficient_evidence'
      WHEN COALESCE((SELECT sum(admissions_performed) FROM w), 0) = 0
        THEN 'stalled'
      ELSE 'clean'
    END
  );
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_verdict(integer) IS
  'issue #2947 — queue health. orphaned if any infinity hold lacked a queue '
  'entry; insufficient_evidence when no queue window was observed; stalled when '
  'a queue existed but nobody was admitted; clean only when both the event '
  'denominator and admissions are positive.';

REVOKE ALL ON FUNCTION public.issue_2947_queue_monitor_observe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_verdict(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_assert_no_orphan_infinity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_monitor_observe() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_verdict(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_assert_no_orphan_infinity() TO service_role;

-- ── Hook observe into the admission driver (same tick) ─────────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_admit_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_now timestamptz;
  v_rate integer;
  v_max_live integer;
  v_hold_seconds integer;
  v_base timestamptz;
  v_elapsed double precision;
  v_bucket integer;
  v_live integer;
  v_room integer;
  v_n integer;
  v_k integer;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT a.ticket_type_id, a.last_admitted_at, a.armed_at
      FROM public.ticket_queue_arming a
     WHERE a.disarmed_at IS NULL
        OR EXISTS (
          SELECT 1 FROM public.ticket_queue_entries q
           WHERE q.ticket_type_id = a.ticket_type_id
             AND q.admitted_at IS NULL AND q.released_at IS NULL)
     ORDER BY a.armed_at, a.ticket_type_id
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('issue_2947_admit:' || r.ticket_type_id::text, 0)) THEN
      CONTINUE;
    END IF;

    v_now := clock_timestamp();

    SELECT l.admission_rate_per_sec, l.max_concurrent_live_holds, l.hold_window_seconds
      INTO v_rate, v_max_live, v_hold_seconds
      FROM public.issue_2947_queue_tier_limits(r.ticket_type_id) l;

    IF NOT EXISTS (
      SELECT 1 FROM public.ticket_queue_entries q
       WHERE q.ticket_type_id = r.ticket_type_id
         AND q.admitted_at IS NULL AND q.released_at IS NULL
    ) THEN
      UPDATE public.ticket_queue_arming a
         SET last_admitted_at = v_now
       WHERE a.ticket_type_id = r.ticket_type_id
         AND a.last_admitted_at < v_now;
      CONTINUE;
    END IF;

    v_base := GREATEST(COALESCE(r.last_admitted_at, r.armed_at),
                       v_now - make_interval(secs => v_hold_seconds));
    v_elapsed := GREATEST(EXTRACT(EPOCH FROM (v_now - v_base)), 0);
    v_bucket := floor(v_rate * v_elapsed)::integer;

    SELECT count(DISTINCT s.id)::integer INTO v_live
      FROM public.ticket_checkout_sessions s
      JOIN public.ticket_checkout_session_items i ON i.checkout_session_id = s.id
     WHERE i.ticket_type_id = r.ticket_type_id
       AND s.expires_at > v_now
       AND s.expires_at <> 'infinity'::timestamptz
       AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
    v_room := GREATEST(v_max_live - v_live, 0);

    v_n := LEAST(v_bucket, v_room);
    IF v_n <= 0 THEN
      CONTINUE;
    END IF;

    v_k := public.issue_2947_queue_admit_batch(r.ticket_type_id, v_n);
    v_total := v_total + v_k;

    IF v_k > 0 THEN
      UPDATE public.ticket_queue_arming a
         SET last_admitted_at = LEAST(v_now, v_base + make_interval(secs => v_k::double precision / v_rate))
       WHERE a.ticket_type_id = r.ticket_type_id;
    END IF;
  END LOOP;

  -- Same tick as admission: roll up write-driven counters. A missing caller
  -- that never reaches this line is what `stalled` is designed to catch when
  -- observe is invoked independently (or after the driver is disarmed).
  PERFORM public.issue_2947_queue_monitor_observe();

  RETURN v_total;
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_admit_due() IS
  'issue #2947 — production caller of issue_2947_queue_admit_batch, then '
  'issue_2947_queue_monitor_observe on the same tick. Scheduled every minute '
  'by cron job issue_2947_queue_admission_driver.';

REVOKE ALL ON FUNCTION public.issue_2947_queue_admit_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_admit_due() TO service_role;

-- ── Probes ─────────────────────────────────────────────────────────────────
DO $probe$
DECLARE
  v jsonb;
  v_rows integer;
BEGIN
  -- Zero-event window must never read as clean.
  DELETE FROM public.ticket_queue_monitor_runs;
  UPDATE public.ticket_queue_monitor_watermark
     SET joins_seen = 0, admissions_seen = 0, releases_seen = 0, waitlist_invites_seen = 0
   WHERE id = 1;
  UPDATE public.ticket_queue_monitor_totals
     SET joins_performed = 0, admissions_performed = 0,
         holds_released = 0, waitlist_invites_sent = 0
   WHERE id = 1;

  v := public.issue_2947_queue_monitor_observe();
  IF (v->>'queueWindowsObserved')::integer <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: fresh DB reported a queue window';
  END IF;

  v := public.issue_2947_queue_verdict(72);
  IF v->>'verdict' <> 'insufficient_evidence' THEN
    RAISE EXCEPTION 'PROBE FAIL: zero-event window reported %, must be insufficient_evidence', v->>'verdict';
  END IF;

  SELECT count(*) INTO v_rows FROM public.ticket_queue_monitor_runs;
  IF v_rows < 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: observe wrote no row';
  END IF;

  -- Driver still present and now calls observe (source check).
  IF position('issue_2947_queue_monitor_observe' IN
       pg_get_functiondef('public.issue_2947_queue_admit_due'::regproc)) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: admit_due no longer calls the monitor';
  END IF;

  IF (SELECT count(*) FROM cron.job WHERE jobname = 'issue_2947_queue_admission_driver') <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: admission driver cron absent';
  END IF;

  -- Hard orphan assert is clean on a fresh DB.
  PERFORM public.issue_2947_queue_assert_no_orphan_infinity();

  RAISE NOTICE 'issue #2947 monitor probe: insufficient_evidence on zero-event window OK';
END
$probe$;

COMMIT;
