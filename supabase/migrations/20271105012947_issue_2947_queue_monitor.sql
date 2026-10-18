-- ===========================================================================
-- #2879 / #2947 — queue monitors with the EVENT denominator
--
-- #2864's shadow reported `clean` over observations that compared 0 to 0. Every
-- monitor here records both the check's denominator (`checks_run`) and the
-- event's (`queue_windows_observed`). A window with zero queued opportunity
-- returns `insufficient_evidence`, never `clean`.
--
-- Counters are WRITE-DRIVEN via append-only event rows (not a locked singleton
-- totals row — that deadlocked against per-tier ticket_types locks during
-- concurrent admit / expiry). `issue_2947_queue_monitor_observe` rolls up what
-- was already recorded and runs on the same `issue_2947_queue_admit_due` tick.
-- ===========================================================================

BEGIN;

-- ── Append-only write-driven events (no cross-tier singleton lock) ─────────
CREATE TABLE IF NOT EXISTS public.ticket_queue_monitor_events (
  id              bigserial PRIMARY KEY,
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind            text NOT NULL
    CHECK (kind IN ('join', 'admission', 'release', 'waitlist_invite')),
  ticket_type_id  uuid NULL,
  checkout_session_id uuid NULL,
  -- Per-event ack: observe claims rows with consumed_at IS NULL. Never advance
  -- a max(id) watermark — uncommitted lower ids would be skipped forever.
  consumed_at     timestamptz NULL
);

COMMENT ON TABLE public.ticket_queue_monitor_events IS
  'issue #2947 — one row per queue join/admission/release/waitlist invite. '
  'Append-only history; observe atomically acknowledges each consumed row.';

CREATE INDEX IF NOT EXISTS idx_2947_queue_monitor_events_id
  ON public.ticket_queue_monitor_events (id);

CREATE INDEX IF NOT EXISTS idx_2947_queue_monitor_events_unconsumed
  ON public.ticket_queue_monitor_events (id)
  WHERE consumed_at IS NULL;

-- Retained for older reset helpers; observe no longer advances last_event_id.
CREATE TABLE IF NOT EXISTS public.ticket_queue_monitor_watermark (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_event_id   bigint NOT NULL DEFAULT 0
);

INSERT INTO public.ticket_queue_monitor_watermark (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

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
  -- Waiting buyers the driver could admit now (sale open + live-hold room).
  eligible_waiting_entries  integer NOT NULL DEFAULT 0,
  orphan_infinity_count     integer NOT NULL DEFAULT 0,
  duration_ms               numeric NOT NULL
);

ALTER TABLE public.ticket_queue_monitor_runs
  ADD COLUMN IF NOT EXISTS eligible_waiting_entries integer NOT NULL DEFAULT 0;

ALTER TABLE public.ticket_queue_monitor_events
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz NULL;

COMMENT ON TABLE public.ticket_queue_monitor_runs IS
  'issue #2947 — one row per monitor observe. queue_windows_observed is the '
  'EVENT denominator. A zero-event window must never read as clean.';

CREATE INDEX IF NOT EXISTS idx_2947_queue_monitor_runs_observed_at
  ON public.ticket_queue_monitor_runs (observed_at DESC);

REVOKE ALL ON TABLE public.ticket_queue_monitor_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ticket_queue_monitor_watermark FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ticket_queue_monitor_runs FROM PUBLIC, anon, authenticated;
ALTER TABLE public.ticket_queue_monitor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_watermark ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_watermark FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_monitor_runs FORCE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.ticket_queue_monitor_events TO service_role;
GRANT ALL ON TABLE public.ticket_queue_monitor_watermark TO service_role;
GRANT ALL ON TABLE public.ticket_queue_monitor_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticket_queue_monitor_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ticket_queue_monitor_runs_id_seq TO service_role;

-- ── Triggers: append an event at the write ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_monitor_on_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ticket_queue_monitor_events (kind, ticket_type_id, checkout_session_id)
    VALUES ('join', NEW.ticket_type_id, NEW.checkout_session_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.admitted_at IS NOT NULL AND OLD.admitted_at IS NULL THEN
      INSERT INTO public.ticket_queue_monitor_events (kind, ticket_type_id, checkout_session_id)
      VALUES ('admission', NEW.ticket_type_id, NEW.checkout_session_id);
    END IF;
    IF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL THEN
      INSERT INTO public.ticket_queue_monitor_events (kind, ticket_type_id, checkout_session_id)
      VALUES ('release', NEW.ticket_type_id, NEW.checkout_session_id);
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
    INSERT INTO public.ticket_queue_monitor_events (kind, ticket_type_id, checkout_session_id)
    VALUES ('waitlist_invite', NEW.ticket_type_id, NULL);
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

-- Persistent orphans only: ignore the create→join registration window.
CREATE OR REPLACE FUNCTION public.issue_2947_queue_orphan_infinity_count(
  p_grace interval DEFAULT interval '2 minutes'
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer
    FROM public.ticket_checkout_sessions s
   WHERE s.expires_at = 'infinity'::timestamptz
     AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
     AND s.created_at < clock_timestamp() - p_grace
     AND NOT EXISTS (
       SELECT 1 FROM public.ticket_queue_entries q
        WHERE q.checkout_session_id = s.id
          AND q.released_at IS NULL
     );
$fn$;

REVOKE ALL ON FUNCTION public.issue_2947_queue_orphan_infinity_count(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_orphan_infinity_count(interval) TO service_role;

-- Waiting buyers the admission driver could take now: sale open + live-hold room.
CREATE OR REPLACE FUNCTION public.issue_2947_queue_eligible_waiting_count()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_now timestamptz := clock_timestamp();
  v_max_live integer;
  v_live integer;
  v_room integer;
  v_total integer := 0;
  v_waiting integer;
BEGIN
  FOR r IN
    SELECT a.ticket_type_id, a.sale_opens_at
      FROM public.ticket_queue_arming a
     WHERE a.disarmed_at IS NULL
       AND (a.sale_opens_at IS NULL OR a.sale_opens_at <= v_now)
  LOOP
    SELECT count(*)::integer INTO v_waiting
      FROM public.ticket_queue_entries q
     WHERE q.ticket_type_id = r.ticket_type_id
       AND q.admitted_at IS NULL AND q.released_at IS NULL;
    IF v_waiting <= 0 THEN
      CONTINUE;
    END IF;

    SELECT l.max_concurrent_live_holds INTO v_max_live
      FROM public.issue_2947_queue_tier_limits(r.ticket_type_id) l;

    SELECT count(DISTINCT s.id)::integer INTO v_live
      FROM public.ticket_checkout_sessions s
      JOIN public.ticket_checkout_session_items i ON i.checkout_session_id = s.id
     WHERE i.ticket_type_id = r.ticket_type_id
       AND s.expires_at > v_now
       AND s.expires_at <> 'infinity'::timestamptz
       AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

    v_room := GREATEST(COALESCE(v_max_live, 0) - COALESCE(v_live, 0), 0);
    IF v_room > 0 THEN
      v_total := v_total + v_waiting;
    END IF;
  END LOOP;

  RETURN v_total;
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_2947_queue_eligible_waiting_count()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_eligible_waiting_count() TO service_role;

-- ── Observe: claim unconsumed events + event denominator ───────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_monitor_observe()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_waiting integer;
  v_eligible integer;
  v_orphans integer;
  v_d_joins integer;
  v_d_admits integer;
  v_d_releases integer;
  v_d_invites integer;
  v_windows integer;
  v_id bigint;
BEGIN
  v_orphans := public.issue_2947_queue_orphan_infinity_count(interval '2 minutes');

  SELECT count(*)::integer INTO v_waiting
    FROM public.ticket_queue_entries q
   WHERE q.admitted_at IS NULL AND q.released_at IS NULL;

  v_eligible := public.issue_2947_queue_eligible_waiting_count();

  -- Claim only committed, still-unconsumed rows. SKIP LOCKED lets concurrent
  -- observers share work without skipping a later-committed lower id.
  WITH to_claim AS (
    SELECT e.id
      FROM public.ticket_queue_monitor_events e
     WHERE e.consumed_at IS NULL
     ORDER BY e.id
       FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.ticket_queue_monitor_events e
       SET consumed_at = clock_timestamp()
      FROM to_claim t
     WHERE e.id = t.id
    RETURNING e.kind
  )
  SELECT
    count(*) FILTER (WHERE kind = 'join')::integer,
    count(*) FILTER (WHERE kind = 'admission')::integer,
    count(*) FILTER (WHERE kind = 'release')::integer,
    count(*) FILTER (WHERE kind = 'waitlist_invite')::integer
    INTO v_d_joins, v_d_admits, v_d_releases, v_d_invites
    FROM claimed;

  v_d_joins := COALESCE(v_d_joins, 0);
  v_d_admits := COALESCE(v_d_admits, 0);
  v_d_releases := COALESCE(v_d_releases, 0);
  v_d_invites := COALESCE(v_d_invites, 0);

  -- Opportunity: waiting now, or this tick's writes show a queue existed
  -- (admit may clear waiting before observe runs on the same tick).
  v_windows := CASE
    WHEN v_waiting > 0 OR v_d_admits > 0 OR v_d_joins > 0 THEN 1
    ELSE 0
  END;

  INSERT INTO public.ticket_queue_monitor_runs (
    checks_run, queue_windows_observed,
    joins_performed, admissions_performed, holds_released, waitlist_invites_sent,
    waiting_entries, eligible_waiting_entries, orphan_infinity_count, duration_ms
  ) VALUES (
    1, v_windows,
    v_d_joins, v_d_admits, v_d_releases, v_d_invites,
    v_waiting, v_eligible, v_orphans,
    EXTRACT(milliseconds FROM clock_timestamp() - v_started)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'runId', v_id,
    'checksRun', 1,
    'queueWindowsObserved', v_windows,
    'waitingEntries', v_waiting,
    'eligibleWaitingEntries', v_eligible,
    'joinsPerformed', v_d_joins,
    'admissionsPerformed', v_d_admits,
    'holdsReleased', v_d_releases,
    'waitlistInvitesSent', v_d_invites,
    'orphanInfinityCount', v_orphans
  );
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_monitor_observe() IS
  'issue #2947 — claim unconsumed queue events into one monitor run. '
  'Called from issue_2947_queue_admit_due after admission.';

CREATE OR REPLACE FUNCTION public.issue_2947_queue_assert_no_orphan_infinity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_orphans integer;
BEGIN
  v_orphans := public.issue_2947_queue_orphan_infinity_count(interval '2 minutes');
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'issue_2947_orphan_infinity_hold'
      USING HINT = format('%s persistent infinity session(s) lack a live queue entry', v_orphans);
  END IF;
END
$fn$;

-- Verdict: never clean on a zero event denominator. Progress / waiting state
-- comes from the latest run (so release-only recovery clears stalled). Stalled
-- only when that run still had admission-eligible waiting and no admissions.
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
  ),
  last_run AS (
    SELECT *
      FROM w
     ORDER BY observed_at DESC, id DESC
     LIMIT 1
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
      WHEN EXISTS (
        SELECT 1 FROM last_run lr
         WHERE COALESCE(lr.eligible_waiting_entries, 0) > 0
           AND lr.admissions_performed = 0
      )
        THEN 'stalled'
      ELSE 'clean'
    END
  );
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_verdict(integer) IS
  'issue #2947 — queue health. orphaned / insufficient_evidence / stalled / clean. '
  'stalled when the latest run still had eligible waiting buyers and zero admissions.';

REVOKE ALL ON FUNCTION public.issue_2947_queue_monitor_observe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_verdict(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_assert_no_orphan_infinity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_monitor_observe() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_verdict(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_assert_no_orphan_infinity() TO service_role;

-- ── admit_due: sale boundary + observe on the same tick ────────────────────
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
  v_sale_opens timestamptz;
BEGIN
  FOR r IN
    SELECT a.ticket_type_id, a.last_admitted_at, a.armed_at, a.sale_opens_at
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
    v_sale_opens := r.sale_opens_at;

    -- Rule 6: do not start hold clocks before the sale opens. Pre-sale joiners
    -- stay at infinity until sale_opens_at so the randomised cohort can form.
    IF v_sale_opens IS NOT NULL AND v_sale_opens > v_now THEN
      CONTINUE;
    END IF;

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

    -- Bucket credit starts at sale open, not at arming, so a long pre-sale
    -- window cannot bank a burst for the first live tick.
    v_base := GREATEST(
      COALESCE(r.last_admitted_at, r.armed_at),
      COALESCE(v_sale_opens, '-infinity'::timestamptz),
      v_now - make_interval(secs => v_hold_seconds)
    );
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

  PERFORM public.issue_2947_queue_monitor_observe();

  RETURN v_total;
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_admit_due() IS
  'issue #2947 — production caller of issue_2947_queue_admit_batch (only after '
  'sale_opens_at), then issue_2947_queue_monitor_observe on the same tick.';

REVOKE ALL ON FUNCTION public.issue_2947_queue_admit_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_admit_due() TO service_role;

-- Deployment probe: structural only. Live queue activity and orphan state are
-- covered by the isolated SQL suites — do not reset monitor data or assume an
-- empty waiting set on a database that already has buyers.
DO $probe$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public.issue_2947_queue_monitor_observe()') IS NULL
     OR to_regprocedure('public.issue_2947_queue_verdict(integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: monitor functions missing';
  END IF;

  v_def := pg_get_functiondef('public.issue_2947_queue_admit_due'::regproc);
  IF position('issue_2947_queue_monitor_observe' IN v_def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: admit_due no longer calls the monitor';
  END IF;
  IF position('sale_opens_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: admit_due lost the sale_opens_at boundary';
  END IF;

  IF (SELECT count(*) FROM cron.job WHERE jobname = 'issue_2947_queue_admission_driver') <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: admission driver cron absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ticket_queue_monitor_events'
  ) THEN
    RAISE EXCEPTION 'PROBE FAIL: monitor events table missing';
  END IF;

  RAISE NOTICE 'issue #2947 monitor probe: structural OK';
END
$probe$;

COMMIT;
