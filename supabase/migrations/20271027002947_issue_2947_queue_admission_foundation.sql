-- ===========================================================================
-- #2879 / #2947 slice 2 (foundation) — the waiting room's admission driver,
-- and the cron job that calls it, in ONE migration.
--
-- WHAT THIS IS. The first shippable piece of the approved #2947 design:
-- "hold first, then queue". A queued buyer already holds stock at
-- `ticket_checkout_sessions.expires_at = 'infinity'`; the 15-minute clock starts
-- only when this driver admits them. This migration ships the queue tables, the
-- admission settings, the admission batch, the driver, its production caller, and
-- the SECURITY DEFINER queue functions (arm / join / state) later slices call.
--
-- WHAT THIS IS NOT. Nothing here makes a buyer queue: `ticket-checkout-create`
-- is untouched and no tier is armed. With zero armed tiers the driver returns
-- after one empty probe (the quiet path, which is 99% of Mingla events). The
-- sweep split, the waitlist handoff, the pre-sale re-emit and the monitor are
-- later slices on #2879.
--
-- THE CARRIER IS NOT RE-EMITTED. Held readers filter `expires_at > now()`, and
-- 'infinity'::timestamptz > now() is true, so a queued hold counts with zero
-- reader changes. `pg_direct_event_checkout_bundle`,
-- `issue_1930_ticket_checkout_create_session_base` and `issue_2491_derived_held`
-- are NOT redefined here; the probe at the foot of this file refuses to apply
-- if any of them has stopped reading `expires_at > now()`.
--
-- FUNCTION AND CALLER SHIP TOGETHER. `issue_2947_queue_admit_batch` has exactly
-- one production caller, `issue_2947_queue_admit_due`, and that has exactly one,
-- the pg_cron job `issue_2947_queue_admission_driver`, scheduled below. Without
-- the caller nothing ever admits, no clock ever starts, and every queued hold is
-- permanent (the sweep's `expires_at < now()` filter can never reach 'infinity').
--
-- GOVERNOR (approved amendment): n = LEAST(token_bucket, max_concurrent_live_holds
-- - current_live_holds). The bucket is time-derived, so the long-run rate is exact
-- whatever the cadence and a double fire admits nothing.
--
-- NOT A SECOND EXPIRY MECHANISM. Admission only moves `expires_at` FORWARD from
-- 'infinity' to a real timestamp. It never stamps `status = 'expired'`. The probe
-- below scans cron.job and refuses to apply if any job other than this driver
-- performs a time-based expiry of ticket_checkout_sessions.
--
-- PLACEHOLDERS. The arming threshold (250) and admission rate (20/sec) are
-- placeholders from the #2947 spec, NOT the Sunday at Ilashe numbers. Seth sets
-- the Ilashe values on ticket_queue_admission_settings (Gate 0, #2879) before
-- arming any tier. Paystack's Initialize capacity is unanswered and is not guessed.
--
-- OPS: after applying, read back `SELECT jobname, schedule, active, command FROM
-- cron.job WHERE jobname = 'issue_2947_queue_admission_driver'` before any slice
-- that calls these functions from an edge function merges.
-- ===========================================================================

BEGIN;

-- ── 1. Admission settings (one row, platform-wide) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.ticket_queue_admission_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  arm_threshold_concurrent_holds integer NOT NULL DEFAULT 250
    CHECK (arm_threshold_concurrent_holds > 0),
  admission_rate_per_sec integer NOT NULL DEFAULT 20
    CHECK (admission_rate_per_sec > 0),
  max_concurrent_live_holds integer
    CHECK (max_concurrent_live_holds IS NULL OR max_concurrent_live_holds > 0),
  hold_window_seconds integer NOT NULL DEFAULT 900
    CHECK (hold_window_seconds > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ticket_queue_admission_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE public.ticket_queue_admission_settings IS
  'issue #2947 slice 2 — platform-wide waiting-room settings, exactly one row. '
  'Per-tier overrides live on ticket_queue_arming. Service role only.';
COMMENT ON COLUMN public.ticket_queue_admission_settings.arm_threshold_concurrent_holds IS
  'PLACEHOLDER 250 (issue #2947 spec). Seth sets the Sunday at Ilashe value from that '
  'event''s expected demand before arming any tier (#2879 Gate 0). An ARMED tier stays '
  'quiet (no queue is offered) while its concurrent holds are below this number.';
COMMENT ON COLUMN public.ticket_queue_admission_settings.admission_rate_per_sec IS
  'PLACEHOLDER 20 (issue #2947 spec). Provider initialize capacity, Paystack included, '
  'is unanswered and is not guessed here; Seth sets it before arming.';
COMMENT ON COLUMN public.ticket_queue_admission_settings.max_concurrent_live_holds IS
  'Ceiling on admitted buyers holding a live clock at once. NULL means '
  'admission_rate_per_sec * hold_window_seconds. This, not the rate alone, protects the provider.';

-- ── 2. Arming: a row's presence is the arming; its absence is the quiet path ──
CREATE TABLE IF NOT EXISTS public.ticket_queue_arming (
  ticket_type_id uuid PRIMARY KEY
    REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  armed_at timestamptz NOT NULL DEFAULT now(),
  -- Rule 6: written once, NEVER updated, so the pre-sale order is recomputable.
  order_seed text NOT NULL DEFAULT md5(gen_random_uuid()::text || clock_timestamp()::text),
  admission_rate_per_sec integer
    CHECK (admission_rate_per_sec IS NULL OR admission_rate_per_sec > 0),
  max_concurrent_live_holds integer
    CHECK (max_concurrent_live_holds IS NULL OR max_concurrent_live_holds > 0),
  -- Snapshot of ticket_types.sale_start_at at arming; the pre-sale/live boundary
  -- is read from here so a mid-sale edit cannot reshuffle a queue that formed.
  sale_opens_at timestamptz,
  -- The token bucket's persisted anchor; initialised to armed_at by the guard.
  last_admitted_at timestamptz,
  disarmed_at timestamptz
);

COMMENT ON TABLE public.ticket_queue_arming IS
  'issue #2947 slice 2 — one row per armed ticket type. Absence is the quiet path. '
  'Written through issue_2947_queue_arm by the service role only.';

CREATE OR REPLACE FUNCTION public.issue_2947_queue_arming_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_admitted_at := COALESCE(NEW.last_admitted_at, NEW.armed_at);
    RETURN NEW;
  END IF;
  IF NEW.order_seed IS DISTINCT FROM OLD.order_seed
     OR NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
     OR NEW.armed_at IS DISTINCT FROM OLD.armed_at THEN
    RAISE EXCEPTION 'issue_2947_arming_identity_immutable'
      USING HINT = 'order_seed, ticket_type_id and armed_at are written once so the queue order stays auditable';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS issue_2947_queue_arming_guard ON public.ticket_queue_arming;
CREATE TRIGGER issue_2947_queue_arming_guard
  BEFORE INSERT OR UPDATE ON public.ticket_queue_arming
  FOR EACH ROW EXECUTE FUNCTION public.issue_2947_queue_arming_guard();

-- ── 3. Queue entries: one per hold; an entry cannot exist without its session ──
CREATE TABLE IF NOT EXISTS public.ticket_queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id uuid NOT NULL
    REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  -- Rule 2, enforced by the schema: no hold, no entry. CASCADE so deleting an
  -- event never blocks on queue rows that no longer hold anything.
  checkout_session_id uuid NOT NULL
    REFERENCES public.ticket_checkout_sessions(id) ON DELETE CASCADE,
  -- Rule 7: identity is the device token's hash, never an IP address.
  device_token_hash text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  admitted_at timestamptz,
  released_at timestamptz,
  release_reason text
    CHECK (release_reason IS NULL OR release_reason IN (
      'abandoned_past_expiry', 'capacity_reduced_by_organiser', 'completed'))
);

COMMENT ON TABLE public.ticket_queue_entries IS
  'issue #2947 slice 2 — one row per queued buyer. admitted_at is also the moment the '
  '15-minute hold clock starts. Column names are deliberately not status-shaped '
  '(issue-2305 gate). Written by issue_2947_queue_join.';

CREATE UNIQUE INDEX IF NOT EXISTS ticket_queue_entries_session_uidx
  ON public.ticket_queue_entries (checkout_session_id);
-- The free rail's automatic retry cannot double-enqueue.
CREATE UNIQUE INDEX IF NOT EXISTS ticket_queue_entries_device_uidx
  ON public.ticket_queue_entries (ticket_type_id, device_token_hash)
  WHERE released_at IS NULL AND admitted_at IS NULL;
-- The ordering scan, and the driver's quiet-path probe.
CREATE INDEX IF NOT EXISTS ticket_queue_entries_waiting_idx
  ON public.ticket_queue_entries (ticket_type_id, joined_at, id)
  WHERE admitted_at IS NULL AND released_at IS NULL;

-- ── 4. Lock the tables down. New public tables inherit anon/authenticated ALL. ──
ALTER TABLE public.ticket_queue_admission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_admission_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_arming ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_arming FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_queue_entries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ticket_queue_admission_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ticket_queue_arming FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ticket_queue_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ticket_queue_admission_settings TO service_role;
GRANT ALL ON TABLE public.ticket_queue_arming TO service_role;
GRANT ALL ON TABLE public.ticket_queue_entries TO service_role;

REVOKE ALL ON FUNCTION public.issue_2947_queue_arming_guard() FROM PUBLIC, anon, authenticated;

-- ── 5. Effective limits for one tier: tier override, else platform setting ──
CREATE OR REPLACE FUNCTION public.issue_2947_queue_tier_limits(p_ticket_type_id uuid)
RETURNS TABLE (
  admission_rate_per_sec integer,
  max_concurrent_live_holds integer,
  hold_window_seconds integer,
  arm_threshold_concurrent_holds integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(a.admission_rate_per_sec, s.admission_rate_per_sec),
         COALESCE(a.max_concurrent_live_holds, s.max_concurrent_live_holds,
                  COALESCE(a.admission_rate_per_sec, s.admission_rate_per_sec) * s.hold_window_seconds),
         s.hold_window_seconds,
         s.arm_threshold_concurrent_holds
    FROM public.ticket_queue_admission_settings s
    LEFT JOIN public.ticket_queue_arming a ON a.ticket_type_id = p_ticket_type_id
   WHERE s.singleton;
$fn$;

-- ── 6. Arm a tier (service role). Seed and sale boundary are written once. ──
CREATE OR REPLACE FUNCTION public.issue_2947_queue_arm(
  p_ticket_type_id uuid,
  p_admission_rate_per_sec integer DEFAULT NULL,
  p_max_concurrent_live_holds integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_sale_start timestamptz;
BEGIN
  SELECT tt.sale_start_at INTO v_sale_start
    FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id AND tt.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_2947_ticket_type_not_found';
  END IF;

  INSERT INTO public.ticket_queue_arming AS a
    (ticket_type_id, admission_rate_per_sec, max_concurrent_live_holds, sale_opens_at)
  VALUES (p_ticket_type_id, p_admission_rate_per_sec, p_max_concurrent_live_holds, v_sale_start)
  ON CONFLICT (ticket_type_id) DO UPDATE
     SET disarmed_at = NULL,
         admission_rate_per_sec = EXCLUDED.admission_rate_per_sec,
         max_concurrent_live_holds = EXCLUDED.max_concurrent_live_holds,
         last_admitted_at = clock_timestamp();
END
$fn$;

-- ── 7. Rule 7: the room is invisible below the arming threshold ─────────────
-- Engaged only when the tier is armed AND (a queue already formed OR concurrent
-- holds, 'infinity' ones included, have reached the threshold). The "queue already
-- formed" arm is hysteresis: once people wait, the room never switches off under
-- them. No arming row, or a tier below the threshold, answers false.
CREATE OR REPLACE FUNCTION public.issue_2947_queue_engaged(p_ticket_type_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_threshold integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_queue_arming a
     WHERE a.ticket_type_id = p_ticket_type_id AND a.disarmed_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ticket_queue_entries q
     WHERE q.ticket_type_id = p_ticket_type_id
       AND q.admitted_at IS NULL AND q.released_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  SELECT l.arm_threshold_concurrent_holds INTO v_threshold
    FROM public.issue_2947_queue_tier_limits(p_ticket_type_id) l;

  RETURN public.issue_2491_derived_held(p_ticket_type_id) >= v_threshold;
END
$fn$;

-- ── 8. The ordering, in ONE place ───────────────────────────────────────────
-- Pre-sale joiners (joined before the snapshotted sale_opens_at) come first, in a
-- seeded md5 order anyone can recompute from (order_seed, id); everyone else is
-- strict first-come-first-served. The leading boolean is deliberate: a bare CASE
-- over md5 hex and a zero-padded epoch string would sort a pre-sale buyer after
-- live buyers whenever their md5 started with a high hex digit.
CREATE OR REPLACE FUNCTION public.issue_2947_queue_ordered_waiting(p_ticket_type_id uuid)
RETURNS TABLE (entry_id uuid, checkout_session_id uuid, queue_position bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT q.id,
         q.checkout_session_id,
         row_number() OVER (
           ORDER BY
             (a.sale_opens_at IS NULL OR q.joined_at >= a.sale_opens_at),
             CASE WHEN a.sale_opens_at IS NOT NULL AND q.joined_at < a.sale_opens_at
                  THEN md5(a.order_seed || q.id::text) END,
             q.joined_at,
             q.id
         ) AS queue_position
    FROM public.ticket_queue_entries q
    LEFT JOIN public.ticket_queue_arming a ON a.ticket_type_id = q.ticket_type_id
   WHERE q.ticket_type_id = p_ticket_type_id
     AND q.admitted_at IS NULL
     AND q.released_at IS NULL;
$fn$;

-- ── 9. Join: the hold already exists (hold first), the entry just queues it ──
-- A session only exists if the capacity guard found stock for it, so a buyer is
-- never queued for zero stock: sold out is refused upstream (ticket_capacity_exceeded)
-- and belongs to the waitlist, not here.
CREATE OR REPLACE FUNCTION public.issue_2947_queue_state(p_ticket_type_id uuid, p_device_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  q record;
  v_pos bigint;
  v_expires timestamptz;
BEGIN
  SELECT e.* INTO q
    FROM public.ticket_queue_entries e
   WHERE e.ticket_type_id = p_ticket_type_id
     AND e.device_token_hash = p_device_token_hash
   ORDER BY (e.released_at IS NULL) DESC, e.joined_at DESC, e.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('queued', false, 'admitted', false, 'released', false);
  END IF;

  IF q.released_at IS NOT NULL THEN
    RETURN jsonb_build_object('queued', false, 'admitted', q.admitted_at IS NOT NULL,
                              'released', true, 'releaseReason', q.release_reason);
  END IF;

  IF q.admitted_at IS NOT NULL THEN
    SELECT s.expires_at INTO v_expires
      FROM public.ticket_checkout_sessions s WHERE s.id = q.checkout_session_id;
    -- Never the raw timestamp: 'infinity' would reach a client date formatter.
    RETURN jsonb_build_object(
      'queued', false, 'admitted', true, 'released', false,
      'holdSecondsRemaining',
        CASE WHEN v_expires IS NULL OR v_expires = 'infinity'::timestamptz THEN NULL
             ELSE GREATEST(ceil(EXTRACT(EPOCH FROM (v_expires - now())))::integer, 0) END);
  END IF;

  SELECT o.queue_position INTO v_pos
    FROM public.issue_2947_queue_ordered_waiting(p_ticket_type_id) o
   WHERE o.entry_id = q.id;

  RETURN jsonb_build_object(
    'queued', true, 'admitted', false, 'released', false,
    'queuePosition', v_pos,
    'aheadOfYou', GREATEST(COALESCE(v_pos, 1) - 1, 0),
    'gettingOne', true,
    'holdSecondsRemaining', NULL);
END
$fn$;

CREATE OR REPLACE FUNCTION public.issue_2947_queue_join(p_checkout_session_id uuid, p_device_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_session record;
  v_tiers uuid[];
  v_tier uuid;
  v_existing record;
  v_dupe uuid;
BEGIN
  IF p_device_token_hash IS NULL OR p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'issue_2947_device_token_invalid';
  END IF;

  SELECT s.id, s.status, s.expires_at INTO v_session
    FROM public.ticket_checkout_sessions s
   WHERE s.id = p_checkout_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_2947_session_not_found';
  END IF;

  SELECT array_agg(DISTINCT i.ticket_type_id) INTO v_tiers
    FROM public.ticket_checkout_session_items i
   WHERE i.checkout_session_id = p_checkout_session_id;
  IF v_tiers IS NULL OR array_length(v_tiers, 1) <> 1 THEN
    RAISE EXCEPTION 'issue_2947_queue_single_tier_only';
  END IF;
  v_tier := v_tiers[1];

  -- Idempotent replay: the same hold joining twice returns the same entry.
  SELECT e.id INTO v_existing FROM public.ticket_queue_entries e
   WHERE e.checkout_session_id = p_checkout_session_id;
  IF FOUND THEN
    RETURN public.issue_2947_queue_state(v_tier, p_device_token_hash)
           || jsonb_build_object('joined', false, 'replay', true);
  END IF;

  IF v_session.status NOT IN ('pending_free', 'requires_payment')
     OR v_session.expires_at <> 'infinity'::timestamptz THEN
    RAISE EXCEPTION 'issue_2947_session_not_queued_hold'
      USING HINT = 'only a pending hold carried at expires_at = infinity can join';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ticket_queue_arming a
                  WHERE a.ticket_type_id = v_tier AND a.disarmed_at IS NULL) THEN
    RAISE EXCEPTION 'issue_2947_queue_not_armed';
  END IF;
  IF NOT public.issue_2947_queue_engaged(v_tier) THEN
    RAISE EXCEPTION 'issue_2947_queue_not_engaged'
      USING HINT = 'below the arming threshold the room is invisible; admit the buyer directly';
  END IF;

  -- The same device already waiting on this tier with another hold (free-rail retry).
  SELECT e.checkout_session_id INTO v_dupe FROM public.ticket_queue_entries e
   WHERE e.ticket_type_id = v_tier AND e.device_token_hash = p_device_token_hash
     AND e.released_at IS NULL AND e.admitted_at IS NULL;
  IF FOUND THEN
    RETURN public.issue_2947_queue_state(v_tier, p_device_token_hash)
           || jsonb_build_object('joined', false, 'duplicate', true,
                                 'duplicateOfCheckoutSessionId', v_dupe);
  END IF;

  INSERT INTO public.ticket_queue_entries (ticket_type_id, checkout_session_id, device_token_hash)
  VALUES (v_tier, p_checkout_session_id, p_device_token_hash);

  RETURN public.issue_2947_queue_state(v_tier, p_device_token_hash)
         || jsonb_build_object('joined', true);
END
$fn$;

-- ── 10. Admit up to N, in order — the single moment a hold clock starts ─────
CREATE OR REPLACE FUNCTION public.issue_2947_queue_admit_batch(p_ticket_type_id uuid, p_n integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hold_seconds integer;
  v_now timestamptz := clock_timestamp();
  v_sessions uuid[];
  v_admitted integer := 0;
BEGIN
  IF p_ticket_type_id IS NULL OR p_n IS NULL OR p_n < 0 THEN
    RAISE EXCEPTION 'issue_2947_admit_batch_bad_arguments';
  END IF;
  IF p_n = 0 THEN
    RETURN 0;
  END IF;

  -- Never queue behind another admitter of the same tier.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('issue_2947_admit:' || p_ticket_type_id::text, 0)) THEN
    RETURN 0;
  END IF;

  SELECT l.hold_window_seconds INTO v_hold_seconds
    FROM public.issue_2947_queue_tier_limits(p_ticket_type_id) l;

  -- Liveness: an entry whose session no longer holds at 'infinity' can never be
  -- admitted. Release it by name instead of leaving it neither admitted nor
  -- released. This touches the entry only, never the session.
  UPDATE public.ticket_queue_entries q
     SET released_at = v_now,
         release_reason = 'abandoned_past_expiry'
   WHERE q.ticket_type_id = p_ticket_type_id
     AND q.admitted_at IS NULL
     AND q.released_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.ticket_checkout_sessions s
        WHERE s.id = q.checkout_session_id
          AND s.expires_at = 'infinity'::timestamptz
          AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
     );

  -- The clock starts here, and only moves FORWARD from 'infinity'.
  WITH picked AS (
    SELECT o.checkout_session_id
      FROM public.issue_2947_queue_ordered_waiting(p_ticket_type_id) o
     ORDER BY o.queue_position
     LIMIT p_n
  ),
  started AS (
    UPDATE public.ticket_checkout_sessions s
       SET expires_at = v_now + make_interval(secs => v_hold_seconds),
           updated_at = v_now
      FROM picked p
     WHERE s.id = p.checkout_session_id
       AND s.expires_at = 'infinity'::timestamptz
       AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
    RETURNING s.id
  )
  SELECT COALESCE(array_agg(started.id), ARRAY[]::uuid[]) INTO v_sessions FROM started;

  UPDATE public.ticket_queue_entries q
     SET admitted_at = v_now
   WHERE q.checkout_session_id = ANY (v_sessions)
     AND q.admitted_at IS NULL
     AND q.released_at IS NULL;
  GET DIAGNOSTICS v_admitted = ROW_COUNT;

  RETURN v_admitted;
END
$fn$;

-- ── 11. The driver — the production caller of the admission batch ───────────
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
  -- Quiet path: no armed tier and no queue standing means nothing below runs.
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
    -- A double fire must be a no-op, never queue behind itself.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('issue_2947_admit:' || r.ticket_type_id::text, 0)) THEN
      CONTINUE;
    END IF;

    v_now := clock_timestamp();

    SELECT l.admission_rate_per_sec, l.max_concurrent_live_holds, l.hold_window_seconds
      INTO v_rate, v_max_live, v_hold_seconds
      FROM public.issue_2947_queue_tier_limits(r.ticket_type_id) l;

    -- Nobody waiting: restart the bucket so an idle tier cannot bank credit and
    -- then burst through the rate when a queue forms.
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

    -- Time-derived token bucket. Stall credit is bounded by one hold window.
    v_base := GREATEST(COALESCE(r.last_admitted_at, r.armed_at),
                       v_now - make_interval(secs => v_hold_seconds));
    v_elapsed := GREATEST(EXTRACT(EPOCH FROM (v_now - v_base)), 0);
    v_bucket := floor(v_rate * v_elapsed)::integer;

    -- Concurrent-live-holds ceiling: sessions with a running clock, not 'infinity'.
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

    -- Consume exactly the credit used, keeping the fractional remainder.
    IF v_k > 0 THEN
      UPDATE public.ticket_queue_arming a
         SET last_admitted_at = LEAST(v_now, v_base + make_interval(secs => v_k::double precision / v_rate))
       WHERE a.ticket_type_id = r.ticket_type_id;
    END IF;
  END LOOP;

  RETURN v_total;
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_queue_admit_due() IS
  'issue #2947 slice 2 — the ONLY production caller of issue_2947_queue_admit_batch. '
  'Scheduled every minute by cron job issue_2947_queue_admission_driver. Admission '
  'moves expires_at forward from infinity; it is not a time-based expiry.';

REVOKE ALL ON FUNCTION public.issue_2947_queue_tier_limits(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_arm(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_engaged(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_ordered_waiting(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_state(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_join(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_admit_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2947_queue_admit_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_tier_limits(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_arm(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_engaged(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_ordered_waiting(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_state(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_join(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_admit_batch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_2947_queue_admit_due() TO service_role;

-- ── 12. The production caller, in THIS migration ────────────────────────────
-- Direct SQL on pg_cron's finest cadence: pure database work, no http hop, no
-- vault read, no deploy step. Deliberately not guarded on cron being present: a
-- database without pg_cron must fail this migration rather than ship a driver
-- nobody calls.
SELECT cron.unschedule('issue_2947_queue_admission_driver')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_2947_queue_admission_driver');

SELECT cron.schedule(
  'issue_2947_queue_admission_driver',
  '* * * * *',
  $cron$SELECT public.issue_2947_queue_admit_due();$cron$
);

-- ── 13. Probes: the migration refuses to apply unless all of this is true ───
DO $probe$
DECLARE
  v_jobs integer;
  v_offenders text;
  v_src text;
  v_reader text;
BEGIN
  -- (a) the caller exists, from the database, and is the cheap direct-SQL shape.
  SELECT count(*) INTO v_jobs
    FROM cron.job j
   WHERE j.jobname = 'issue_2947_queue_admission_driver'
     AND j.schedule = '* * * * *'
     AND j.active
     AND j.command LIKE '%issue_2947_queue_admit_due%'
     AND j.command NOT LIKE '%net.http_post%';
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: issue_2947_queue_admission_driver is not scheduled exactly once, every minute, active (found %)', v_jobs;
  END IF;

  -- (b) one-expiry-owner enforcement (I-PROPOSED-2947-ONE-EXPIRY-OWNER-AND-IT-FILTERS):
  -- no cron job other than the admission driver may stamp a checkout session expired.
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_offenders
    FROM cron.job j
   WHERE j.jobname <> 'issue_2947_queue_admission_driver'
     AND j.command ~* 'ticket_checkout_sessions'
     AND j.command ~* $re$status\s*=\s*'expired'$re$;
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: a second time-based expiry of ticket_checkout_sessions is scheduled by cron job(s): %', v_offenders;
  END IF;
  IF (SELECT command FROM cron.job WHERE jobname = 'issue_2947_queue_admission_driver') ~* 'expired' THEN
    RAISE EXCEPTION 'PROBE FAIL: the admission driver must never stamp a session expired';
  END IF;

  -- (c) the carrier: 'infinity' holds in every held reader because each still
  -- filters expires_at > now(), and the sentinel semantics are what we rely on.
  IF NOT ('infinity'::timestamptz > now()) OR ('infinity'::timestamptz < now()) THEN
    RAISE EXCEPTION 'PROBE FAIL: infinity no longer compares as a future timestamp';
  END IF;
  IF (NULL::timestamptz > now()) IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: NULL expiry no longer compares as unknown';
  END IF;
  FOR v_reader IN
    SELECT unnest(ARRAY[
      'public.issue_2491_derived_held(uuid)',
      'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[])',
      'public.pg_direct_event_checkout_bundle(uuid,text,text)'])
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_reader::regprocedure;
    IF v_src IS NULL OR v_src !~ 's\.expires_at\s*>\s*now\(\)' THEN
      RAISE EXCEPTION 'PROBE FAIL: held reader % no longer filters s.expires_at > now(); an infinity hold would stop counting', v_reader;
    END IF;
    IF v_src ~* 's\.expires_at\s+IS\s+(NOT\s+)?NULL' OR v_src ~* 's\.expires_at\s*<>\s*''infinity''' THEN
      RAISE EXCEPTION 'PROBE FAIL: held reader % special-cases the expiry sentinel', v_reader;
    END IF;
  END LOOP;

  -- (d) no new status was introduced for queued sessions.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.ticket_checkout_sessions'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ~* 'queued'
  ) THEN
    RAISE EXCEPTION 'PROBE FAIL: ticket_checkout_sessions grew a queued status; the carrier is expires_at = infinity';
  END IF;

  -- (e) lockdown: no anon/authenticated privilege on any new table or function.
  IF EXISTS (
    SELECT 1
      FROM (VALUES ('public.ticket_queue_admission_settings'),
                   ('public.ticket_queue_arming'),
                   ('public.ticket_queue_entries')) t(rel),
           LATERAL unnest(ARRAY['anon', 'authenticated']) r(role_name),
           LATERAL unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
     WHERE has_table_privilege(r.role_name, t.rel, p.priv)
  ) THEN
    RAISE EXCEPTION 'PROBE FAIL: anon/authenticated still hold a privilege on a waiting-room table';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        'public.issue_2947_queue_tier_limits(uuid)',
        'public.issue_2947_queue_arm(uuid,integer,integer)',
        'public.issue_2947_queue_engaged(uuid)',
        'public.issue_2947_queue_ordered_waiting(uuid)',
        'public.issue_2947_queue_state(uuid,text)',
        'public.issue_2947_queue_join(uuid,text)',
        'public.issue_2947_queue_admit_batch(uuid,integer)',
        'public.issue_2947_queue_admit_due()']) f(sig),
           unnest(ARRAY['anon', 'authenticated']) r(role_name)
     WHERE has_function_privilege(r.role_name, f.sig::regprocedure, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'PROBE FAIL: anon/authenticated can execute a waiting-room function';
  END IF;

  -- (f) the quiet path: nothing armed, nothing queued, the driver admits nothing.
  IF (SELECT count(*) FROM public.ticket_queue_arming) = 0
     AND public.issue_2947_queue_admit_due() <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: the driver admitted someone with no armed tier';
  END IF;
  IF (SELECT count(*) FROM public.ticket_queue_admission_settings) <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: ticket_queue_admission_settings must hold exactly one row';
  END IF;
END
$probe$;

COMMIT;
