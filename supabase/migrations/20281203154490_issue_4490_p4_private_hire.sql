-- #4490 P4-1 — private hire: requests, holds, space claims, the calendar.
--
-- A venue hires out one space or a named combination of spaces for a session
-- (Full day, Evening, ...). Offer kind `private_hire`.
--
-- Spaces are never double booked: `venue_space_claims` holds one row per
-- atomic space a booking, an exclusive event or a host's block uses, over the
-- booked range widened by the offer's setup time before and cleanup time
-- after. An exclusion constraint (space, range) over active claims makes the
-- database itself refuse an overlap, so a combination blocks its parts and a
-- part blocks the combination (a combination claims every part).
--
-- Request flow (reconciliation ruling 4: a pending request never holds
-- capacity):
--   * The guest sends a request: the booking is `request_pending` with a
--     timer-only hold (no hold slices, no claims) until the reply deadline.
--   * The host approves (optionally editing the price: an applied
--     `balance_adjust` amendment), declines with a reason (and up to three
--     other dates), queues the request behind a hold on the same space, gives
--     more time to pay, or releases a hold early. Approval takes the space
--     (held claims until the pay deadline), checks the day's entry limit
--     ("hire cut") and moves the booking to `approved_payment_required`
--     ("On hold until <time>").
--   * The guest pays the deposit (or all of it); the hold converts and the
--     claims become committed. The balance is paid later (stage `balance`).
--   * An unanswered request or an unpaid hold expires with the existing
--     sweep; claims follow the hold through triggers.
--   * A hire on a day lowers that day's entry / group day limit by the hired
--     spaces' capacity; when every space of the pool is hired the day closes
--     for entry ("Close entry when the whole venue is hired" is automatic,
--     reconciliation conflict 49).
--
-- Also: the hire price grid (one price row per space or combination and
-- group size, bounded by its capacity), sessions with labels, deposit,
-- balance due, refundable damage deposit (a refundable fee: always refunded
-- on cancel), extra-guest price, overtime, minimum spend, request or instant
-- booking, venue-level reply / pay timers; the Host calendar and requests
-- reads; manual blocks; exclusive events claim their space; the guest's hire
-- options; withdraw; next free dates; Admin dispute read and force-expire.
--
-- New tables hang off spaces and bookings only (no venue_id column, no venue
-- foreign key), so #2099's pending-venue dependency seal does not move.
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): drop the new tables and functions, restore the
-- redefined functions from 20281203084490 / 20281203144490, drop the added
-- columns.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Columns: session labels, hire price rows on a space or combination, the
--    hire charge label and the hired combinations of an offer.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stay_place_schedule_rules
  ADD COLUMN session_label text
    CHECK (session_label IS NULL OR char_length(btrim(session_label)) BETWEEN 1 AND 40);

ALTER TABLE public.venue_offer_price_options
  ADD COLUMN space_id uuid REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  ADD COLUMN combination_id uuid REFERENCES public.venue_space_combinations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT venue_offer_price_options_one_place CHECK (space_id IS NULL OR combination_id IS NULL);

ALTER TABLE public.stay_offerings
  ADD COLUMN hire_charge text
    CHECK (hire_charge IS NULL OR hire_charge IN ('hire_fee', 'min_spend', 'per_guest')),
  ADD COLUMN hire_combination_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
    CHECK (cardinality(hire_combination_ids) <= 20);
ALTER TABLE public.stay_offerings
  ADD CONSTRAINT stay_offering_hire_columns_shape CHECK (
    kind = 'private_hire' OR (hire_charge IS NULL AND hire_combination_ids = '{}'::uuid[])
  );

-- A new private hire offer asks first (request) unless the host chooses
-- "Book instantly".
CREATE OR REPLACE FUNCTION public.issue_4490_hire_default_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.kind = 'private_hire' THEN
    NEW.confirmation_mode := 'request';
    NEW.hire_charge := COALESCE(NEW.hire_charge, 'hire_fee');
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_hire_default_mode
  BEFORE INSERT ON public.stay_offerings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_hire_default_mode();

-- ---------------------------------------------------------------------------
-- 2. Space claims (one row per atomic space; the exclusion constraint is the
--    no-double-booking rule), the request queue, staff action receipts.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_space_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('booking', 'event', 'block')),
  group_id uuid REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  reservation_line_id uuid REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  hold_id uuid REFERENCES public.stay_inventory_holds(id) ON DELETE RESTRICT,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id uuid,
  via_combination_id uuid REFERENCES public.venue_space_combinations(id) ON DELETE RESTRICT,
  booked_range tstzrange NOT NULL,
  claim_range tstzrange NOT NULL,
  state text NOT NULL CHECK (state IN ('held', 'committed', 'released')),
  held_until timestamptz,
  released_at timestamptz,
  release_reason text CHECK (release_reason IS NULL OR char_length(release_reason) BETWEEN 1 AND 80),
  block_reason text CHECK (block_reason IS NULL OR char_length(btrim(block_reason)) BETWEEN 1 AND 200),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_space_claims_ranges CHECK (
    NOT isempty(booked_range) AND claim_range @> booked_range
    AND NOT lower_inf(booked_range) AND NOT upper_inf(booked_range)
  ),
  CONSTRAINT venue_space_claims_held_shape CHECK ((state = 'held') = (held_until IS NOT NULL)),
  CONSTRAINT venue_space_claims_released_shape CHECK ((state = 'released') = (released_at IS NOT NULL)),
  CONSTRAINT venue_space_claims_booking_shape CHECK (
    (source = 'booking') = (group_id IS NOT NULL AND reservation_line_id IS NOT NULL)
  ),
  CONSTRAINT venue_space_claims_event_shape CHECK ((source = 'event') = (event_id IS NOT NULL)),
  CONSTRAINT venue_space_claims_no_overlap
    EXCLUDE USING gist (
      space_id extensions.gist_uuid_ops WITH OPERATOR(pg_catalog.=),
      claim_range WITH OPERATOR(pg_catalog.&&)
    ) WHERE (state IN ('held', 'committed'))
);
CREATE INDEX venue_space_claims_group_idx ON public.venue_space_claims (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX venue_space_claims_hold_idx ON public.venue_space_claims (hold_id) WHERE state = 'held';
CREATE INDEX venue_space_claims_event_idx ON public.venue_space_claims (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX venue_space_claims_space_lower_idx ON public.venue_space_claims (space_id, lower(claim_range));
COMMENT ON TABLE public.venue_space_claims IS
  '#4490 P4: who uses a space when (bookings, exclusive events, host blocks). The exclusion constraint refuses overlapping active claims on one space; a combination claims each part.';

-- A request waiting behind another booking's hold on the same space.
CREATE TABLE public.venue_request_queue (
  group_id uuid PRIMARY KEY REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  blocked_by_group_id uuid REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  queued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT venue_request_queue_not_self CHECK (blocked_by_group_id IS DISTINCT FROM group_id)
);
CREATE INDEX venue_request_queue_blocker_idx ON public.venue_request_queue (blocked_by_group_id)
  WHERE released_at IS NULL;

-- Idempotent replay of staff actions made through the venue-offer-staff edge
-- function (the edge acts for the user it verified; auth.uid() is empty).
CREATE TABLE public.venue_offer_staff_receipts (
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 120),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  actor_user_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, actor_user_id, idempotency_key)
);

ALTER TABLE public.venue_space_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_request_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_offer_staff_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_space_claims, public.venue_request_queue, public.venue_offer_staff_receipts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_space_claims, public.venue_request_queue TO authenticated;
GRANT ALL ON public.venue_space_claims, public.venue_request_queue, public.venue_offer_staff_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4490_can_view_space(p_space_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT public.issue_4490_can_view_venue(s.venue_id)
                   FROM public.venue_spaces s WHERE s.id = p_space_id), false);
$function$;
CREATE POLICY "venue space claims readable by venue viewers"
  ON public.venue_space_claims FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_space(space_id));
CREATE POLICY "venue request queue readable by venue viewers"
  ON public.venue_request_queue FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_booking(group_id));

-- ---------------------------------------------------------------------------
-- 3. Space helpers.
-- ---------------------------------------------------------------------------
-- A space holds its larger layout (standing or seated).
CREATE OR REPLACE FUNCTION public.issue_4490_space_capacity(p_space_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT GREATEST(COALESCE(s.capacity_standing, 0), COALESCE(s.capacity_seated, 0))
  FROM public.venue_spaces s WHERE s.id = p_space_id;
$function$;

-- The atomic spaces a hire price row uses (a combination = all its parts).
CREATE OR REPLACE FUNCTION public.issue_4490_option_spaces(p_option_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN o.space_id IS NOT NULL THEN ARRAY[o.space_id]
    WHEN o.combination_id IS NOT NULL THEN (
      SELECT array_agg(p ORDER BY p) FROM public.venue_space_combinations c, unnest(c.space_ids) p
      WHERE c.id = o.combination_id)
    ELSE NULL END
  FROM public.venue_offer_price_options o WHERE o.id = p_option_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_option_capacity(p_option_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(sum(public.issue_4490_space_capacity(s)), 0)::integer
  FROM unnest(public.issue_4490_option_spaces(p_option_id)) s;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_option_place_name(p_option_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(s.name, c.name)
  FROM public.venue_offer_price_options o
  LEFT JOIN public.venue_spaces s ON s.id = o.space_id
  LEFT JOIN public.venue_space_combinations c ON c.id = o.combination_id
  WHERE o.id = p_option_id;
$function$;

-- The booked range of a hire on a window (plus any overtime) and the claim
-- range (setup time before, cleanup time after).
CREATE OR REPLACE FUNCTION public.issue_4490_hire_ranges(
  p_offering_id uuid,
  p_window_id uuid,
  p_overtime_minutes integer DEFAULT 0
)
RETURNS TABLE (booked tstzrange, claim tstzrange)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT tstzrange(w.starts_at, w.ends_at + make_interval(mins => COALESCE(p_overtime_minutes, 0)), '[)'),
         tstzrange(w.starts_at - make_interval(mins => o.buffer_before_minutes),
                   w.ends_at + make_interval(mins => COALESCE(p_overtime_minutes, 0) + o.buffer_after_minutes), '[)')
  FROM public.stay_offerings o
  JOIN public.stay_place_windows w ON w.id = p_window_id AND w.offering_id = o.id
  WHERE o.id = p_offering_id;
$function$;

-- A held claim whose hold has lapsed (but not been swept yet) never blocks:
-- it is released before any new claim is written on its spaces (mirrors the
-- lapsed-hold rule of the Stays engine).
CREATE OR REPLACE FUNCTION public.issue_4490_release_lapsed_claims(p_space_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'hold_lapsed', updated_at = now()
  WHERE space_id = ANY(p_space_ids) AND state = 'held' AND held_until <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Who uses these spaces over a range (ignoring one booking): 'free', 'held'
-- (only by holds that have not lapsed) or 'taken' (a confirmed booking, an
-- exclusive event or a block), with the first blocker.
CREATE OR REPLACE FUNCTION public.issue_4490_spaces_status(
  p_space_ids uuid[],
  p_range tstzrange,
  p_exclude_group uuid DEFAULT NULL
)
RETURNS TABLE (
  status text,
  blocking_space_id uuid,
  blocking_source text,
  blocking_group_id uuid,
  held_until timestamptz,
  blocking_combination_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH active AS (
    SELECT c.* FROM public.venue_space_claims c
    WHERE c.space_id = ANY(p_space_ids)
      AND c.claim_range && p_range
      AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))
      AND (p_exclude_group IS NULL OR c.group_id IS DISTINCT FROM p_exclude_group)
  )
  SELECT
    CASE WHEN NOT EXISTS (SELECT 1 FROM active) THEN 'free'
         WHEN EXISTS (SELECT 1 FROM active WHERE state = 'committed') THEN 'taken'
         ELSE 'held' END,
    b.space_id, b.source, b.group_id, b.held_until, b.via_combination_id
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT a.space_id, a.source, a.group_id, a.held_until, a.via_combination_id FROM active a
    ORDER BY (a.state = 'committed') DESC, lower(a.claim_range), a.id LIMIT 1
  ) b ON true;
$function$;

-- Write the claims of one booking line (one per atomic space). An overlap is
-- refused by the exclusion constraint and reported as PT409 offer_space_taken.
CREATE OR REPLACE FUNCTION public.issue_4490_claim_spaces(
  p_group_id uuid,
  p_line_id uuid,
  p_hold_id uuid,
  p_space_ids uuid[],
  p_combination_id uuid,
  p_booked tstzrange,
  p_claim tstzrange,
  p_held_until timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  PERFORM public.issue_4490_release_lapsed_claims(p_space_ids);
  BEGIN
    INSERT INTO public.venue_space_claims (
      space_id, source, group_id, reservation_line_id, hold_id, via_combination_id,
      booked_range, claim_range, state, held_until
    )
    SELECT s, 'booking', p_group_id, p_line_id, p_hold_id, p_combination_id,
           p_booked, p_claim, CASE WHEN p_held_until IS NULL THEN 'committed' ELSE 'held' END, p_held_until
    FROM unnest(p_space_ids) s
    ORDER BY s;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
  END;
  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Claims follow holds and commitments (no Stays function edits): a hold
--    converted by payment commits its claims; an expired or released hold
--    releases them; a new hold deadline moves held_until; a released
--    commitment (cancel) frees the space. A request queued behind a booking
--    is told when that booking lets the space go.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_sync_claims_from_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state IN ('active', 'reconciliation_required') AND NEW.state = 'converted' THEN
      UPDATE public.venue_space_claims
      SET state = 'committed', held_until = NULL, updated_at = now()
      WHERE hold_id = NEW.id AND state = 'held';
    ELSIF NEW.state IN ('released', 'expired') THEN
      UPDATE public.venue_space_claims
      SET state = 'released', held_until = NULL, released_at = now(),
          release_reason = left(COALESCE(NEW.reason, NEW.state), 80), updated_at = now()
      WHERE hold_id = NEW.id AND state = 'held';
    END IF;
  ELSIF NEW.state = 'active' AND NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    UPDATE public.venue_space_claims
    SET held_until = NEW.expires_at, updated_at = now()
    WHERE hold_id = NEW.id AND state = 'held';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_claims_follow_hold
  AFTER UPDATE OF state, expires_at ON public.stay_inventory_holds
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_sync_claims_from_hold();

CREATE OR REPLACE FUNCTION public.issue_4490_sync_claims_from_commitment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.state = 'active' AND NEW.state = 'released' THEN
    UPDATE public.venue_space_claims
    SET state = 'released', released_at = now(), release_reason = left(COALESCE(NEW.release_reason, 'released'), 80),
        updated_at = now()
    WHERE reservation_line_id = NEW.reservation_line_id AND state = 'committed';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_claims_follow_commitment
  AFTER UPDATE OF state ON public.stay_inventory_commitments
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_sync_claims_from_commitment();

CREATE OR REPLACE FUNCTION public.issue_4490_release_request_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row record;
BEGIN
  IF NEW.state <> 'released' OR OLD.state = 'released' OR NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only once the booking holds no space any more.
  IF EXISTS (SELECT 1 FROM public.venue_space_claims c
             WHERE c.group_id = NEW.group_id AND c.state IN ('held', 'committed')) THEN
    RETURN NEW;
  END IF;
  FOR v_row IN
    UPDATE public.venue_request_queue q SET released_at = now()
    WHERE q.blocked_by_group_id = NEW.group_id AND q.released_at IS NULL
    RETURNING q.group_id
  LOOP
    IF EXISTS (SELECT 1 FROM public.stay_reservation_groups g
               WHERE g.id = v_row.group_id AND g.state = 'request_pending') THEN
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, idempotency_key, safe_metadata
      ) VALUES (
        v_row.group_id, 'stay_offer_queue_released', 'service',
        'queue-released:' || v_row.group_id || ':' || NEW.group_id,
        jsonb_build_object('releasedBy', NEW.group_id, 'reason', 'next_in_line')
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_claims_release_queue
  AFTER UPDATE OF state ON public.venue_space_claims
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_release_request_queue();

-- ---------------------------------------------------------------------------
-- 5. Exclusive events claim their space for every date (P1 stored the choice;
--    P4 enforces it). A clash with a hire or a block rolls the event change
--    back with PT409 event_space_taken.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_sync_event_space_claims(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event record;
BEGIN
  SELECT e.id, e.space_id, e.space_use, e.status, e.deleted_at INTO v_event
  FROM public.events e WHERE e.id = p_event_id;
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'event_changed', updated_at = now()
  WHERE event_id = p_event_id AND state IN ('held', 'committed');
  IF NOT FOUND AND v_event.id IS NULL THEN
    RETURN;
  END IF;
  IF v_event.id IS NULL OR v_event.space_id IS NULL OR v_event.space_use <> 'exclusive'
     OR v_event.status NOT IN ('scheduled', 'live') OR v_event.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.venue_space_claims (
      space_id, source, event_id, event_date_id, booked_range, claim_range, state
    )
    SELECT v_event.space_id, 'event', v_event.id, d.id,
           tstzrange(d.start_at, d.end_at, '[)'), tstzrange(d.start_at, d.end_at, '[)'), 'committed'
    FROM public.event_dates d
    WHERE d.event_id = v_event.id AND d.end_at > now()
    ORDER BY d.start_at;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'event_space_taken' USING ERRCODE = 'PT409';
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_on_event_space_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    IF TG_OP = 'INSERT' OR NEW.space_id IS DISTINCT FROM OLD.space_id
       OR NEW.space_use IS DISTINCT FROM OLD.space_use OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF NEW.space_id IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD.space_id IS NOT NULL) THEN
        PERFORM public.issue_4490_sync_event_space_claims(NEW.id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- event_dates
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = OLD.event_id AND e.space_id IS NOT NULL) THEN
      PERFORM public.issue_4490_sync_event_space_claims(OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.space_id IS NOT NULL) THEN
    PERFORM public.issue_4490_sync_event_space_claims(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_event_space_claims
  AFTER INSERT OR UPDATE OF space_id, space_use, status, deleted_at ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_event_space_change();
CREATE TRIGGER issue_4490_event_date_space_claims
  AFTER INSERT OR UPDATE OF start_at, end_at OR DELETE ON public.event_dates
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_event_space_change();

-- Existing exclusive events with a space (none expected; P1 only stored the flag).
DO $backfill$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT e.id FROM public.events e
    WHERE e.space_id IS NOT NULL AND e.space_use = 'exclusive' AND e.status IN ('scheduled', 'live')
      AND e.deleted_at IS NULL
    ORDER BY e.id
  LOOP
    BEGIN
      PERFORM public.issue_4490_sync_event_space_claims(v_id);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      RAISE NOTICE 'issue_4490: exclusive event % overlaps another; left without claims', v_id;
    END;
  END LOOP;
END;
$backfill$;

-- ---------------------------------------------------------------------------
-- 6. Private hire is built.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry',
               'group_packages', 'private_hire']::text[];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_built_offer_kinds()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['entry', 'group_package', 'private_hire']::text[];
$function$;

-- ---------------------------------------------------------------------------
-- 7. The hire cut: a day's entry / package limit drops by the capacity of the
--    pool's spaces under an active private hire or exclusive event that day;
--    when every space of the pool is hired the day is closed for entry.
--    (Adds two output columns: hire_cut, venue_hired.)
-- ---------------------------------------------------------------------------
DROP FUNCTION public.issue_4490_pool_day_usage(uuid, date);
CREATE FUNCTION public.issue_4490_pool_day_usage(p_pool_id uuid, p_local_date date)
RETURNS TABLE (
  limit_effective integer,
  kept integer,
  used integer,
  online_left integer,
  gate_left integer,
  closed boolean,
  used_online integer,
  used_gate integer,
  kept_left integer,
  hire_cut integer,
  venue_hired boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_override public.venue_capacity_overrides%ROWTYPE;
  v_limit integer;
  v_base integer;
  v_kept integer;
  v_online integer;
  v_gate integer;
  v_closed boolean;
  v_tz text;
  v_day tstzrange;
  v_scope uuid[];
  v_cut integer := 0;
  v_hired integer := 0;
BEGIN
  SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_override FROM public.venue_capacity_overrides
  WHERE pool_id = p_pool_id AND local_date = p_local_date;
  v_closed := COALESCE(v_override.closed, false)
    OR public.issue_4490_day_closed(v_pool.venue_id, p_local_date);
  v_base := COALESCE(v_override.daily_limit, v_pool.daily_limit);
  -- #4490 P4: spaces under an active private hire or exclusive event that day.
  v_tz := public.issue_4490_venue_timezone(v_pool.venue_id);
  v_day := tstzrange(p_local_date::timestamp AT TIME ZONE v_tz, (p_local_date + 1)::timestamp AT TIME ZONE v_tz, '[)');
  v_scope := COALESCE(v_pool.space_ids, (
    SELECT array_agg(s.id) FROM public.venue_spaces s
    WHERE s.venue_id = v_pool.venue_id AND s.is_active AND s.archived_at IS NULL));
  IF v_scope IS NOT NULL THEN
    SELECT COALESCE(sum(COALESCE(s.capacity_standing, s.capacity_seated, 0)), 0)::integer, count(*)::integer
    INTO v_cut, v_hired
    FROM public.venue_spaces s
    WHERE s.id = ANY(v_scope)
      AND EXISTS (
        SELECT 1 FROM public.venue_space_claims c
        LEFT JOIN public.stay_reservation_groups g ON g.id = c.group_id
        WHERE c.space_id = s.id
          AND c.booked_range && v_day
          AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))
          AND (c.source = 'event' OR (c.source = 'booking' AND g.offer_kind = 'private_hire')));
  END IF;
  venue_hired := v_scope IS NOT NULL AND v_hired > 0 AND v_hired >= cardinality(v_scope);
  hire_cut := CASE WHEN venue_hired THEN v_base ELSE LEAST(v_cut, v_base) END;
  v_closed := v_closed OR venue_hired;
  v_limit := CASE WHEN v_closed THEN 0 ELSE GREATEST(v_base - hire_cut, 0) END;
  v_kept := LEAST(COALESCE(v_override.kept_for_walk_ins, v_pool.kept_for_walk_ins), v_limit);
  -- Usage by channel: gate sales (walk-in bookings) draw the kept seats first.
  SELECT COALESCE(sum(quantity) FILTER (WHERE NOT is_gate), 0)::integer,
         COALESCE(sum(quantity) FILTER (WHERE is_gate), 0)::integer
  INTO v_online, v_gate
  FROM (
    SELECT slice_row.quantity, group_row.booking_source = 'walk_in' AS is_gate
    FROM public.stay_inventory_hold_slices slice_row
    JOIN public.stay_inventory_holds hold_row ON hold_row.id = slice_row.hold_id
    JOIN public.stay_reservation_groups group_row ON group_row.id = hold_row.group_id
    JOIN public.stay_place_windows window_row ON window_row.id = slice_row.place_window_id
    JOIN public.stay_offerings offering ON offering.id = slice_row.offering_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND window_row.local_date = p_local_date
      AND (
        (hold_row.state = 'active' AND hold_row.expires_at > now())
        OR hold_row.state = 'reconciliation_required'
      )
    UNION ALL
    SELECT commitment.quantity, group_row.booking_source = 'walk_in'
    FROM public.stay_inventory_commitments commitment
    JOIN public.stay_reservation_groups group_row ON group_row.id = commitment.group_id
    JOIN public.stay_place_windows window_row ON window_row.id = commitment.place_window_id
    JOIN public.stay_offerings offering ON offering.id = commitment.offering_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND window_row.local_date = p_local_date
      AND commitment.state = 'active'
  ) usage_rows;
  limit_effective := v_limit;
  kept := v_kept;
  used := v_online + v_gate;
  used_online := v_online;
  used_gate := v_gate;
  kept_left := GREATEST(v_kept - v_gate, 0);
  online_left := GREATEST(v_limit - v_kept - v_online - GREATEST(v_gate - v_kept, 0), 0);
  gate_left := GREATEST(v_limit - v_online - v_gate, 0);
  closed := v_closed;
  RETURN NEXT;
END;
$function$;

-- A hire may not cut a day below what entry / packages already sold
-- (decision default 7: refuse). Locks every pool the hire touches.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_hire_capacity(
  p_venue_id uuid,
  p_space_ids uuid[],
  p_booked tstzrange
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text := public.issue_4490_venue_timezone(p_venue_id);
  v_pool record;
  v_day date;
  v_usage record;
BEGIN
  FOR v_pool IN
    SELECT p.id, p.name FROM public.venue_capacity_pools p
    WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL
      AND (p.space_ids IS NULL OR p.space_ids && p_space_ids)
    ORDER BY p.id
    FOR UPDATE
  LOOP
    FOR v_day IN
      SELECT d::date FROM generate_series(
        (lower(p_booked) AT TIME ZONE v_tz)::date,
        ((upper(p_booked) - interval '1 microsecond') AT TIME ZONE v_tz)::date,
        interval '1 day') d
    LOOP
      PERFORM 1 FROM public.venue_capacity_overrides WHERE pool_id = v_pool.id AND local_date = v_day FOR UPDATE;
      SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_pool.id, v_day);
      IF v_usage.used > v_usage.limit_effective THEN
        RAISE EXCEPTION 'offer_capacity_conflict' USING ERRCODE = 'PT409',
          DETAIL = jsonb_build_object('localDate', v_day, 'poolName', v_pool.name,
            'sold', v_usage.used, 'limitAfterHire', v_usage.limit_effective)::text;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Offer readiness (hire: spaces, a place on every price row, rows within
--    their place's capacity, sessions, guest or booking pricing) and the
--    offer read (hire: places, price rows, sessions, terms, timers).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_offer_readiness(p_offering_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_reasons text[] := '{}'::text[];
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_max_guests integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN ARRAY['not_found'];
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_offer.venue_id;
  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    v_reasons := v_reasons || 'kind_not_available_yet'::text;
  END IF;
  IF NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    v_reasons := v_reasons || 'feature_off'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    JOIN public.stay_price_versions p
      ON p.price_option_id = o.id AND p.offering_id = o.offering_id AND p.effective_to IS NULL
    WHERE o.offering_id = v_offer.id AND o.status = 'active'
  ) THEN
    v_reasons := v_reasons || 'no_price_option'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_policy_versions p
    WHERE p.offering_id = v_offer.id AND p.effective_to IS NULL
  ) THEN
    v_reasons := v_reasons || 'no_policy'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active
  ) THEN
    v_reasons := v_reasons || 'no_schedule'::text;
  END IF;
  IF v_offer.kind IN ('entry', 'group_package') THEN
    SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id;
    IF NOT FOUND OR v_pool.archived_at IS NOT NULL THEN
      v_reasons := v_reasons || 'no_day_limit'::text;
    ELSE
      SELECT max(o.guest_max) INTO v_max_guests
      FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active';
      IF v_max_guests IS NOT NULL AND v_max_guests > v_pool.daily_limit THEN
        v_reasons := v_reasons || 'guest_max_over_capacity'::text;
      END IF;
    END IF;
  END IF;
  IF v_offer.kind IN ('private_hire', 'by_the_hour') AND NOT EXISTS (
    SELECT 1 FROM public.venue_offer_spaces s WHERE s.offering_id = v_offer.id
  ) THEN
    v_reasons := v_reasons || 'no_spaces'::text;
  END IF;
  IF v_offer.deposit_kind <> 'none' AND v_offer.kind NOT IN ('group_package', 'private_hire') THEN
    v_reasons := v_reasons || 'deposit_not_available_yet'::text;
  END IF;
  -- #4490 P3: packages are priced per guest or per booking, and start at set times.
  IF v_offer.kind IN ('group_package', 'private_hire') AND EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    WHERE o.offering_id = v_offer.id AND o.status = 'active' AND o.unit NOT IN ('guest', 'booking')
  ) THEN
    v_reasons := v_reasons || 'option_unit_invalid'::text;
  END IF;
  IF v_offer.kind IN ('group_package', 'private_hire') AND EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active AND r.mode = 'full_day'
  ) THEN
    v_reasons := v_reasons || 'no_start_times'::text;
  END IF;
  -- #4490 P4: every hire price row names a space or combination of this
  -- offer, and its largest group fits there.
  IF v_offer.kind = 'private_hire' THEN
    IF EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND (public.issue_4490_option_spaces(o.id) IS NULL
             OR EXISTS (SELECT 1 FROM unnest(public.issue_4490_option_spaces(o.id)) p
                        WHERE NOT EXISTS (SELECT 1 FROM public.venue_offer_spaces s
                                          WHERE s.offering_id = v_offer.id AND s.space_id = p)))
    ) THEN
      v_reasons := v_reasons || 'hire_price_space_missing'::text;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND public.issue_4490_option_spaces(o.id) IS NOT NULL
        AND o.guest_max > public.issue_4490_option_capacity(o.id)
    ) THEN
      v_reasons := v_reasons || 'guest_max_over_capacity'::text;
    END IF;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    v_reasons := v_reasons || 'stay_venue'::text;
  END IF;
  RETURN v_reasons;
END;
$function$;

-- The hire part of an offer read (Host and guest): places, price rows,
-- sessions, terms and the venue's reply / pay timers. NULL for other kinds.
CREATE OR REPLACE FUNCTION public.issue_4490_hire_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN o.kind <> 'private_hire' THEN NULL ELSE jsonb_build_object(
    'charge', COALESCE(o.hire_charge, 'hire_fee'),
    'bookingMode', COALESCE(o.confirmation_mode, 'request'),
    'spaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'setting', s.setting,
        'capacityStanding', s.capacity_standing, 'capacitySeated', s.capacity_seated,
        'capacity', public.issue_4490_space_capacity(s.id)) ORDER BY s.sort_order, s.name)
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = o.id), '[]'::jsonb),
    'combinations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'spaceIds', to_jsonb(c.space_ids),
        'capacity', (SELECT COALESCE(sum(public.issue_4490_space_capacity(p)), 0) FROM unnest(c.space_ids) p))
        ORDER BY c.name)
      FROM public.venue_space_combinations c
      WHERE c.id = ANY(o.hire_combination_ids) AND c.archived_at IS NULL), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'optionId', opt.id, 'name', opt.name, 'unit', opt.unit,
        'spaceId', opt.space_id, 'combinationId', opt.combination_id,
        'placeName', public.issue_4490_option_place_name(opt.id),
        'capacity', public.issue_4490_option_capacity(opt.id),
        'guestMin', opt.guest_min, 'guestMax', opt.guest_max,
        'weekdays', to_jsonb(opt.weekdays), 'priceMinor', price.amount_minor) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price
        ON price.price_option_id = opt.id AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ruleId', r.id, 'label', r.session_label,
        'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
        'pastMidnight', r.local_end_time <= r.local_start_time,
        'minutes', r.slot_duration_minutes, 'weekdays', to_jsonb(r.weekdays),
        'startDate', r.local_start_date, 'endDate', r.local_end_date) ORDER BY r.local_start_time, r.session_label)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows'), '[]'::jsonb),
    'setupMinutes', o.buffer_before_minutes,
    'cleanupMinutes', o.buffer_after_minutes,
    'damageDepositMinor', o.damage_deposit_minor,
    'minSpendMinor', o.min_spend_minor,
    'extraGuestMinor', o.extra_guest_minor,
    'overtimeMinorPerHour', o.overtime_minor_per_hour,
    'requestResponseHours', COALESCE(s.request_response_hours, 48),
    'approvedPaymentMinutes', COALESCE(s.approved_payment_minutes, 4320)
  ) END
  FROM public.stay_offerings o
  LEFT JOIN public.venue_booking_settings s ON s.venue_id = o.venue_id
  WHERE o.id = p_offering_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_offer_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', o.id,
    'venueId', o.venue_id,
    'kind', o.kind,
    'entryStyle', o.entry_style,
    'name', o.name,
    'summary', NULLIF(o.summary, ''),
    'description', NULLIF(o.description, ''),
    'status', o.status,
    'version', o.version,
    'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
    'sessionCapacity', CASE WHEN o.entry_style = 'timed_session' THEN o.capacity ELSE NULL END,
    'minNoticeMinutes', o.min_notice_minutes,
    'maxAdvanceDays', o.max_advance_days,
    'sortOrder', o.sort_order,
    'pool', public.issue_4490_pool_projection(o.capacity_pool_id),
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', opt.id,
        'name', opt.name,
        'unit', opt.unit,
        'guestMin', opt.guest_min,
        'guestMax', opt.guest_max,
        'weekdays', to_jsonb(opt.weekdays),
        'startTime', to_char(opt.local_start_time, 'HH24:MI'),
        'endTime', to_char(opt.local_end_time, 'HH24:MI'),
        'eligibility', CASE WHEN opt.eligibility IS NULL THEN NULL ELSE jsonb_build_object(
          'label', opt.eligibility->>'label',
          'checkAtGate', (opt.eligibility->>'check_at_gate')::boolean) END,
        'busyRules', opt.busy_rules,
        'sortOrder', opt.sort_order,
        'status', opt.status,
        'version', opt.version,
        'priceMinor', price.amount_minor,
        'priceVersionId', price.id,
        -- #4490 P4: a hire price row sits on a space or a combination.
        'spaceId', opt.space_id,
        'combinationId', opt.combination_id
      ) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price
        ON price.price_option_id = opt.id AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'
    ), '[]'::jsonb),
    'policy', (
      SELECT jsonb_build_object(
        'versionId', p.id,
        'cancellationPolicy', p.cancellation_policy,
        'refundLadder', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'minMinutesBefore', (r->>'min_minutes_before')::integer,
            'refundBps', (r->>'refund_bps')::integer) ORDER BY ord)
          FROM jsonb_array_elements(p.refund_ladder) WITH ORDINALITY AS l(r, ord)
        ), '[]'::jsonb),
        'dateChangeRule', jsonb_strip_nulls(jsonb_build_object(
          'allowedUntilMinutesBefore', (p.date_change_rule->>'allowed_until_minutes_before')::integer,
          'feeBps', (p.date_change_rule->>'fee_bps')::integer,
          'maxChanges', (p.date_change_rule->>'max_changes')::integer,
          'guestChangeUntilMinutesBefore', (p.date_change_rule->>'guest_change_until_minutes_before')::integer)),
        'operatorCancelRefundBps', p.operator_cancel_refund_basis_points)
      FROM public.stay_policy_versions p
      WHERE p.offering_id = o.id AND p.effective_to IS NULL
    ),
    'schedule', (
      SELECT jsonb_build_object(
        'ruleId', r.id,
        'mode', CASE r.mode WHEN 'full_day' THEN 'full_day' ELSE 'sessions' END,
        'weekdays', to_jsonb(r.weekdays),
        'startTime', to_char(COALESCE(r.full_day_start_time, r.local_start_time), 'HH24:MI'),
        'endTime', to_char(COALESCE(r.full_day_end_time, r.local_end_time), 'HH24:MI'),
        'sessionMinutes', r.slot_duration_minutes,
        'sessionEveryMinutes', r.slot_interval_minutes,
        'startDate', r.local_start_date,
        'endDate', r.local_end_date,
        'timezone', r.timezone)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active
      ORDER BY r.created_at DESC
      LIMIT 1
    ),
    'inclusions', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'kind', COALESCE(i->>'kind', 'item'),
        'label', i->>'label',
        'qtyPer', i->>'qty_per',
        'menuItemId', i->>'menu_item_id',
        'staffRatio', (i->>'staff_ratio')::integer,
        'options', i->'options')) ORDER BY ord)
      FROM jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)), '[]'::jsonb),
    'extras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e->>'id', 'name', e->>'name', 'priceMinor', (e->>'price_minor')::bigint, 'per', e->>'per') ORDER BY ord)
      FROM jsonb_array_elements(o.extras) WITH ORDINALITY AS ex(e, ord)), '[]'::jsonb),
    'staffRoleLabel', o.staff_role_label,
    'deposit', jsonb_build_object(
      'kind', o.deposit_kind,
      'value', o.deposit_value,
      'balanceDueDaysBefore', o.balance_due_days_before),
    'payModes', CASE WHEN o.deposit_kind = 'none' THEN '["full"]'::jsonb ELSE '["deposit","full"]'::jsonb END,
    'durationMinutes', (SELECT r.slot_duration_minutes FROM public.stay_place_schedule_rules r
                        WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows'
                        ORDER BY r.created_at DESC LIMIT 1),
    'startTimes', COALESCE((
      SELECT jsonb_agg(st.t ORDER BY st.t) FROM (
      SELECT DISTINCT to_char(r.local_start_time + make_interval(mins => k * r.slot_interval_minutes), 'HH24:MI') AS t
      FROM public.stay_place_schedule_rules r
      CROSS JOIN LATERAL generate_series(0, GREATEST((
        (CASE WHEN r.local_end_time <= r.local_start_time
              THEN extract(epoch FROM (r.local_end_time - r.local_start_time))::integer / 60 + 1440
              ELSE extract(epoch FROM (r.local_end_time - r.local_start_time))::integer / 60 END)
        - r.slot_duration_minutes) / r.slot_interval_minutes, 0)) k
      WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows') st), '[]'::jsonb),
    'readiness', to_jsonb(public.issue_4490_offer_readiness(o.id)),
    'canCollectOnline', public.issue_4490_can_collect_online(o.brand_id, o.venue_id),
    'warnings', to_jsonb(CASE WHEN public.issue_4490_can_collect_online(o.brand_id, o.venue_id)
                              THEN '{}'::text[] ELSE ARRAY['online_payments_off']::text[] END),
    'hire', public.issue_4490_hire_projection(o.id),
    'createdAt', o.created_at,
    'updatedAt', o.updated_at
  )
  FROM public.stay_offerings o
  WHERE o.id = p_offering_id;
$function$;

-- The refundable damage deposit is one fee version per offer (fixed per
-- booking, refundable: always refunded in full on a cancellation).
CREATE OR REPLACE FUNCTION public.issue_4490_sync_offer_damage(p_offering_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_current public.stay_fee_versions%ROWTYPE;
  v_currency text;
  v_next integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_offer.brand_id;
  SELECT * INTO v_current FROM public.stay_fee_versions
  WHERE offering_id = p_offering_id AND fee_key = 'damage_deposit' AND effective_to IS NULL
  FOR UPDATE;
  IF COALESCE(v_offer.damage_deposit_minor, 0) = 0 THEN
    IF FOUND THEN
      UPDATE public.stay_fee_versions SET effective_to = now() WHERE id = v_current.id;
    END IF;
    RETURN;
  END IF;
  IF FOUND AND v_current.amount_minor = v_offer.damage_deposit_minor AND v_current.currency_code = v_currency THEN
    RETURN;
  END IF;
  IF FOUND THEN
    UPDATE public.stay_fee_versions SET effective_to = now() WHERE id = v_current.id;
  END IF;
  SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
  FROM public.stay_fee_versions WHERE offering_id = p_offering_id AND fee_key = 'damage_deposit';
  INSERT INTO public.stay_fee_versions (
    offering_id, brand_id, venue_id, fee_key, label, version_number, fee_kind,
    calculation, amount_minor, currency_code, display_mode, refund_treatment, created_by,
    supersedes_version_id
  ) VALUES (
    p_offering_id, v_offer.brand_id, v_offer.venue_id, 'damage_deposit', 'Damage deposit (refundable)', v_next,
    'mandatory_fee', 'fixed_per_place_booking', v_offer.damage_deposit_minor, v_currency, 'separate', 'refundable',
    auth.uid(), CASE WHEN v_current.id IS NULL THEN NULL ELSE v_current.id END
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Hire authoring (Host). issue_4490_manage_offer keeps create_draft
--    (kind 'private_hire'), name, refund ladder (set_policy), publish / pause
--    / archive, archive_price_option; issue_4490_manage_package keeps
--    set_change_rules. This adds:
--      set_spaces      the spaces and combinations guests can hire
--      set_price_row   one price row per space or combination and group size
--      set_sessions    named sessions (Full day, Evening, ...) and weekdays
--      set_terms       charge, deposit, balance due, damage deposit, setup /
--                      cleanup time, extra-guest price, overtime, min spend
--      set_booking     request first or book instantly; the venue's reply and
--                      pay-within timers (venue-wide)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_manage_hire(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_spaces uuid[];
  v_combos uuid[];
  v_parts uuid[];
  v_space uuid;
  v_combo uuid;
  v_capacity integer;
  v_place text;
  v_weekdays smallint[];
  v_amount bigint;
  v_next integer;
  v_currency text;
  v_opt_id uuid;
  v_session jsonb;
  v_start time;
  v_end time;
  v_minutes integer;
  v_windows integer := 0;
  v_kind text;
  v_value bigint;
  v_days integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('set_spaces', 'set_price_row', 'set_sessions', 'set_terms', 'set_booking')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venue', p_venue_id, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('manage_hire:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = NULLIF(p_payload->>'offerId', '')::uuid AND venue_id = p_venue_id
    AND kind NOT IN ('room', 'place')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR v_offer.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.status = 'archived' THEN
    RAISE EXCEPTION 'offer_archived' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.kind <> 'private_hire' THEN
    RAISE EXCEPTION 'offer_kind_invalid' USING ERRCODE = '22023';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  IF p_action = 'set_spaces' THEN
    IF jsonb_typeof(COALESCE(p_payload->'spaceIds', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(p_payload->'combinationIds', '[]'::jsonb)) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_payload->'spaceIds', '[]'::jsonb)) x
                  WHERE x !~ '^[0-9a-f-]{36}$')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_payload->'combinationIds', '[]'::jsonb)) x
                  WHERE x !~ '^[0-9a-f-]{36}$') THEN
      RAISE EXCEPTION 'hire_spaces_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_spaces
    FROM jsonb_array_elements_text(COALESCE(p_payload->'spaceIds', '[]'::jsonb)) x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_combos
    FROM jsonb_array_elements_text(COALESCE(p_payload->'combinationIds', '[]'::jsonb)) x;
    IF cardinality(v_spaces) + cardinality(v_combos) = 0 OR cardinality(v_combos) > 20 THEN
      RAISE EXCEPTION 'hire_spaces_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_spaces) s WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_spaces vs WHERE vs.id = s AND vs.venue_id = p_venue_id
           AND vs.is_active AND vs.archived_at IS NULL AND vs.can_be_hired)) THEN
      RAISE EXCEPTION 'hire_space_not_hirable' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_combos) c WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_space_combinations vc WHERE vc.id = c AND vc.venue_id = p_venue_id
           AND vc.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM unnest(vc.space_ids) p WHERE NOT EXISTS (
             SELECT 1 FROM public.venue_spaces vs WHERE vs.id = p AND vs.is_active AND vs.archived_at IS NULL
               AND vs.can_be_hired)))) THEN
      RAISE EXCEPTION 'hire_space_not_hirable' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT p), '{}'::uuid[]) INTO v_parts
    FROM (SELECT unnest(v_spaces) p
          UNION SELECT unnest(vc.space_ids) FROM public.venue_space_combinations vc WHERE vc.id = ANY(v_combos)) all_parts;
    -- A price row on a place no longer offered must be archived first.
    IF EXISTS (SELECT 1 FROM public.venue_offer_price_options o
               WHERE o.offering_id = v_offer.id AND o.status = 'active'
                 AND ((o.space_id IS NOT NULL AND NOT o.space_id = ANY(v_spaces))
                      OR (o.combination_id IS NOT NULL AND NOT o.combination_id = ANY(v_combos)))) THEN
      RAISE EXCEPTION 'hire_space_in_use' USING ERRCODE = 'PT409';
    END IF;
    DELETE FROM public.venue_offer_spaces WHERE offering_id = v_offer.id AND NOT space_id = ANY(v_parts);
    INSERT INTO public.venue_offer_spaces (offering_id, space_id, venue_id, brand_id)
    SELECT v_offer.id, p, p_venue_id, v_venue.brand_id FROM unnest(v_parts) p
    ON CONFLICT (offering_id, space_id) DO NOTHING;
    UPDATE public.stay_offerings
    SET hire_combination_ids = v_combos, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_price_row' THEN
    IF char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'option_name_required' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'unit', '') NOT IN ('guest', 'booking') THEN
      RAISE EXCEPTION 'option_unit_invalid' USING ERRCODE = '22023';
    END IF;
    v_space := CASE WHEN COALESCE(p_payload->>'spaceId', '') ~ '^[0-9a-f-]{36}$' THEN (p_payload->>'spaceId')::uuid END;
    v_combo := CASE WHEN COALESCE(p_payload->>'combinationId', '') ~ '^[0-9a-f-]{36}$'
                    THEN (p_payload->>'combinationId')::uuid END;
    IF (v_space IS NULL) = (v_combo IS NULL)
       OR (v_space IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.venue_offer_spaces s
             WHERE s.offering_id = v_offer.id AND s.space_id = v_space))
       OR (v_combo IS NOT NULL AND NOT v_combo = ANY(v_offer.hire_combination_ids)) THEN
      RAISE EXCEPTION 'hire_price_space_missing' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'guestMin', '') !~ '^[0-9]{1,6}$' OR COALESCE(p_payload->>'guestMax', '') !~ '^[0-9]{1,6}$'
       OR (p_payload->>'guestMin')::integer < 1
       OR (p_payload->>'guestMax')::integer < (p_payload->>'guestMin')::integer THEN
      RAISE EXCEPTION 'option_guests_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_space IS NOT NULL THEN
      v_capacity := public.issue_4490_space_capacity(v_space);
      SELECT name INTO v_place FROM public.venue_spaces WHERE id = v_space;
    ELSE
      SELECT COALESCE(sum(public.issue_4490_space_capacity(p)), 0), min(c.name) INTO v_capacity, v_place
      FROM public.venue_space_combinations c, unnest(c.space_ids) p WHERE c.id = v_combo;
    END IF;
    IF (p_payload->>'guestMax')::integer > v_capacity THEN
      -- "More than <Space> holds (N)"
      RAISE EXCEPTION 'option_over_space_capacity' USING ERRCODE = '22023',
        DETAIL = jsonb_build_object('capacity', v_capacity, 'placeName', v_place)::text;
    END IF;
    IF jsonb_typeof(p_payload->'priceMinor') <> 'number' OR (p_payload->>'priceMinor') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'option_price_invalid' USING ERRCODE = '22023';
    END IF;
    v_amount := (p_payload->>'priceMinor')::bigint;
    IF p_payload ? 'weekdays' THEN
      IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
        RAISE EXCEPTION 'option_weekdays_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    ELSE
      v_weekdays := '{0,1,2,3,4,5,6}'::smallint[];
    END IF;
    v_opt_id := CASE WHEN COALESCE(p_payload->>'optionId', '') ~ '^[0-9a-f-]{36}$' THEN (p_payload->>'optionId')::uuid END;
    IF v_opt_id IS NULL THEN
      INSERT INTO public.venue_offer_price_options (
        offering_id, venue_id, brand_id, name, unit, guest_min, guest_max, weekdays,
        space_id, combination_id, sort_order, updated_by
      ) VALUES (
        v_offer.id, p_venue_id, v_venue.brand_id, btrim(p_payload->>'name'), p_payload->>'unit',
        (p_payload->>'guestMin')::integer, (p_payload->>'guestMax')::integer, v_weekdays,
        v_space, v_combo,
        COALESCE((p_payload->>'sortOrder')::integer,
                 (SELECT COALESCE(max(sort_order), -1) + 1 FROM public.venue_offer_price_options WHERE offering_id = v_offer.id)),
        v_uid
      ) RETURNING * INTO v_option;
    ELSE
      UPDATE public.venue_offer_price_options
      SET name = btrim(p_payload->>'name'), unit = p_payload->>'unit',
          guest_min = (p_payload->>'guestMin')::integer, guest_max = (p_payload->>'guestMax')::integer,
          weekdays = v_weekdays, space_id = v_space, combination_id = v_combo,
          sort_order = COALESCE((p_payload->>'sortOrder')::integer, sort_order),
          version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE id = v_opt_id AND offering_id = v_offer.id AND status = 'active'
      RETURNING * INTO v_option;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'option_not_found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
    SELECT * INTO v_price FROM public.stay_price_versions
    WHERE offering_id = v_offer.id AND price_option_id = v_option.id AND effective_to IS NULL
    FOR UPDATE;
    IF NOT FOUND OR v_price.amount_minor <> v_amount
       OR v_price.pricing_unit <> public.issue_4490_option_pricing_unit(v_option.unit)
       OR v_price.currency_code <> v_currency THEN
      IF FOUND THEN
        UPDATE public.stay_price_versions SET effective_to = now() WHERE id = v_price.id;
      END IF;
      SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
      FROM public.stay_price_versions WHERE offering_id = v_offer.id;
      INSERT INTO public.stay_price_versions (
        offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
        pricing_unit, price_option_id, supersedes_version_id, created_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, v_next, v_amount, v_currency,
        public.issue_4490_option_pricing_unit(v_option.unit), v_option.id,
        CASE WHEN v_price.id IS NULL THEN NULL ELSE v_price.id END, v_uid
      );
    END IF;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_sessions' THEN
    IF jsonb_typeof(p_payload->'sessions') <> 'array' OR jsonb_array_length(p_payload->'sessions') NOT BETWEEN 1 AND 6 THEN
      RAISE EXCEPTION 'hire_sessions_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'sessions') s
               WHERE jsonb_typeof(s) <> 'object'
                  OR char_length(btrim(COALESCE(s->>'label', ''))) NOT BETWEEN 1 AND 40
                  OR COALESCE(s->>'startTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                  OR COALESCE(s->>'endTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                  OR s->>'startTime' = s->>'endTime')
       OR (SELECT count(DISTINCT lower(btrim(s->>'label'))) FROM jsonb_array_elements(p_payload->'sessions') s)
          <> jsonb_array_length(p_payload->'sessions') THEN
      RAISE EXCEPTION 'hire_sessions_invalid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
      RAISE EXCEPTION 'schedule_weekdays_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    -- Retire the old sessions: future windows with nothing held or sold stop selling.
    UPDATE public.stay_place_windows w
    SET stop_sell = true, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE w.offering_id = v_offer.id AND w.starts_at > now() AND NOT w.stop_sell
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.place_window_id = w.id AND h.state IN ('active', 'reconciliation_required'))
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_inventory_commitments c
        WHERE c.place_window_id = w.id AND c.state = 'active')
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_reservation_lines l
        JOIN public.stay_reservation_groups g ON g.id = l.group_id
        WHERE l.place_window_id = w.id AND g.state IN ('request_pending', 'approved_payment_required'));
    UPDATE public.stay_place_schedule_rules
    SET active = false, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE offering_id = v_offer.id AND active;
    FOR v_session IN SELECT s FROM jsonb_array_elements(p_payload->'sessions') s ORDER BY s->>'startTime'
    LOOP
      v_start := (v_session->>'startTime')::time;
      v_end := (v_session->>'endTime')::time;
      v_minutes := (extract(epoch FROM (v_end - v_start))::integer / 60);
      IF v_minutes <= 0 THEN
        v_minutes := v_minutes + 1440;
      END IF;
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone, local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, slot_duration_minutes, slot_interval_minutes,
        full_day_start_time, full_day_end_time, session_label, created_by, updated_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, 'repeating_windows', v_settings.timezone,
        COALESCE(NULLIF(p_payload->>'startDate', '')::date, (now() AT TIME ZONE v_settings.timezone)::date),
        NULLIF(p_payload->>'endDate', '')::date,
        v_weekdays, v_start, v_end, v_minutes, v_minutes, NULL, NULL,
        btrim(v_session->>'label'), v_uid, v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    IF v_offer.status = 'live' THEN
      v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
    END IF;

  ELSIF p_action = 'set_terms' THEN
    IF (p_payload ? 'hireCharge' AND COALESCE(p_payload->>'hireCharge', '') NOT IN ('hire_fee', 'min_spend', 'per_guest'))
       OR (p_payload ? 'setupMinutes' AND (COALESCE(p_payload->>'setupMinutes', '') !~ '^[0-9]{1,4}$'
           OR (p_payload->>'setupMinutes')::integer > 1440))
       OR (p_payload ? 'cleanupMinutes' AND (COALESCE(p_payload->>'cleanupMinutes', '') !~ '^[0-9]{1,4}$'
           OR (p_payload->>'cleanupMinutes')::integer > 1440))
       OR (p_payload ? 'damageDepositMinor' AND COALESCE(p_payload->>'damageDepositMinor', '') !~ '^[0-9]{1,12}$')
       OR (p_payload ? 'minSpendMinor' AND COALESCE(p_payload->>'minSpendMinor', '') !~ '^[0-9]{1,12}$')
       OR (p_payload ? 'extraGuestMinor' AND p_payload->'extraGuestMinor' <> 'null'::jsonb
           AND COALESCE(p_payload->>'extraGuestMinor', '') !~ '^[0-9]{1,12}$')
       OR (p_payload ? 'overtimeMinorPerHour' AND p_payload->'overtimeMinorPerHour' <> 'null'::jsonb
           AND COALESCE(p_payload->>'overtimeMinorPerHour', '') !~ '^[0-9]{1,12}$') THEN
      RAISE EXCEPTION 'hire_terms_invalid' USING ERRCODE = '22023';
    END IF;
    v_kind := COALESCE(p_payload->>'depositKind', v_offer.deposit_kind);
    IF v_kind NOT IN ('none', 'percent', 'fixed') THEN
      RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_kind <> 'none' THEN
      IF COALESCE(p_payload->>'depositValue', v_offer.deposit_value::text, '') !~ '^[0-9]{1,12}$'
         OR COALESCE(p_payload->>'balanceDueDaysBefore', v_offer.balance_due_days_before::text, '') !~ '^[0-9]{1,3}$'
         OR COALESCE(p_payload->>'balanceDueDaysBefore', v_offer.balance_due_days_before::text)::integer > 365 THEN
        RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
      END IF;
      v_value := COALESCE(p_payload->>'depositValue', v_offer.deposit_value::text)::bigint;
      v_days := COALESCE(p_payload->>'balanceDueDaysBefore', v_offer.balance_due_days_before::text)::integer;
      IF (v_kind = 'percent' AND v_value NOT BETWEEN 1 AND 9999) OR (v_kind = 'fixed' AND v_value < 1) THEN
        RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE public.stay_offerings
    SET hire_charge = COALESCE(p_payload->>'hireCharge', hire_charge),
        deposit_kind = v_kind,
        deposit_value = CASE WHEN v_kind = 'none' THEN NULL ELSE v_value END,
        balance_due_days_before = CASE WHEN v_kind = 'none' THEN NULL ELSE v_days END,
        buffer_before_minutes = COALESCE((p_payload->>'setupMinutes')::integer, buffer_before_minutes),
        buffer_after_minutes = COALESCE((p_payload->>'cleanupMinutes')::integer, buffer_after_minutes),
        damage_deposit_minor = COALESCE((p_payload->>'damageDepositMinor')::bigint, damage_deposit_minor),
        min_spend_minor = COALESCE((p_payload->>'minSpendMinor')::bigint, min_spend_minor),
        extra_guest_minor = CASE WHEN p_payload ? 'extraGuestMinor' THEN NULLIF(p_payload->>'extraGuestMinor', '')::bigint
                                 ELSE extra_guest_minor END,
        overtime_minor_per_hour = CASE WHEN p_payload ? 'overtimeMinorPerHour'
                                       THEN NULLIF(p_payload->>'overtimeMinorPerHour', '')::bigint
                                       ELSE overtime_minor_per_hour END,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    PERFORM public.issue_4490_sync_offer_damage(v_offer.id);

  ELSIF p_action = 'set_booking' THEN
    IF COALESCE(p_payload->>'mode', COALESCE(v_offer.confirmation_mode, 'request')) NOT IN ('request', 'instant')
       OR (p_payload ? 'requestResponseHours' AND (COALESCE(p_payload->>'requestResponseHours', '') !~ '^[0-9]{1,3}$'
           OR (p_payload->>'requestResponseHours')::integer NOT BETWEEN 1 AND 168))
       OR (p_payload ? 'approvedPaymentMinutes' AND (COALESCE(p_payload->>'approvedPaymentMinutes', '') !~ '^[0-9]{1,5}$'
           OR (p_payload->>'approvedPaymentMinutes')::integer NOT BETWEEN 10 AND 10080)) THEN
      RAISE EXCEPTION 'hire_booking_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'requestResponseHours' OR p_payload ? 'approvedPaymentMinutes' THEN
      -- "Applies to every request at <venue>" (reconciliation conflict 43).
      UPDATE public.venue_booking_settings
      SET request_response_hours = COALESCE((p_payload->>'requestResponseHours')::smallint, request_response_hours),
          approved_payment_minutes = COALESCE((p_payload->>'approvedPaymentMinutes')::integer, approved_payment_minutes),
          version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE venue_id = p_venue_id;
    END IF;
    UPDATE public.stay_offerings
    SET confirmation_mode = COALESCE(p_payload->>'mode', confirmation_mode),
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  END IF;

  v_result := public.issue_4490_offer_projection(v_offer.id) || jsonb_build_object('windowsCreated', v_windows);
  PERFORM public.issue_4490_receipt_store('manage_hire:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Publishing a hire also writes its damage deposit fee (publish itself is
-- issue_4490_manage_offer's; this keeps the fee in step with the offer).
CREATE OR REPLACE FUNCTION public.issue_4490_on_hire_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.kind = 'private_hire' AND NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' THEN
    PERFORM public.issue_4490_sync_offer_damage(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_hire_published
  AFTER UPDATE OF status ON public.stay_offerings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_hire_published();

-- ---------------------------------------------------------------------------
-- 10. Availability (anon): private hire windows say available / held / taken
--     for the chosen price row's places (or the best of all rows); the guest's
--     hire options per window; the Host's next free dates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_offer_availability(
  p_offering_id uuid,
  p_from date,
  p_to date,
  p_guests integer DEFAULT NULL,
  p_price_option_id uuid DEFAULT NULL
)
RETURNS TABLE (
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  window_id uuid,
  status text,
  reason text,
  remaining integer,
  price_minor bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_usage record;
  v_today date;
  v_last date;
  v_remaining integer;
  v_reason text;
  v_opt record;
  v_ranges record;
  v_state record;
  v_best integer;
  v_rank integer;
  v_price bigint;
  v_considered integer;
BEGIN
  IF p_offering_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from
     OR p_to - p_from > 62 OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN 1 AND 100000) THEN
    RAISE EXCEPTION 'availability_range_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN
    RETURN;
  END IF;
  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind NOT IN ('room', 'place') AND o.status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RETURN;
  END IF;
  SELECT * INTO v_settings FROM public.venue_booking_settings WHERE venue_id = v_offer.venue_id;
  v_today := (now() AT TIME ZONE COALESCE(v_settings.timezone, 'UTC'))::date;
  v_last := v_today + LEAST(COALESCE(v_settings.booking_horizon_days, 365), COALESCE(v_offer.max_advance_days, 730));
  FOR v_window IN
    SELECT w.* FROM public.stay_place_windows w
    WHERE w.offering_id = v_offer.id AND w.local_date BETWEEN p_from AND p_to AND NOT w.stop_sell
    ORDER BY w.starts_at, w.id
  LOOP
    local_date := v_window.local_date;
    starts_at := v_window.starts_at;
    ends_at := v_window.ends_at;
    window_id := v_window.id;
    reason := NULL;
    remaining := 0;
    IF v_offer.kind = 'private_hire' THEN
      -- #4490 P4: a hire window is free, on hold or booked for its places.
      price_minor := NULL;
      IF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
        status := 'closed'; reason := 'bookings_paused';
      ELSIF public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date) THEN
        status := 'closed';
      ELSIF v_window.local_date > v_last THEN
        status := 'too_far';
      ELSIF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
        status := 'too_soon';
      ELSE
        v_best := 0; v_considered := 0; v_price := NULL;
        SELECT * INTO v_ranges FROM public.issue_4490_hire_ranges(v_offer.id, v_window.id, 0);
        FOR v_opt IN
          SELECT opt.id, opt.guest_min, opt.guest_max,
                 public.issue_4490_option_window_reason(opt.id, v_window.id) AS why,
                 public.issue_4490_option_capacity(opt.id) AS cap
          FROM public.venue_offer_price_options opt
          WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
            AND (p_price_option_id IS NULL OR opt.id = p_price_option_id)
            AND public.issue_4490_option_spaces(opt.id) IS NOT NULL
          ORDER BY opt.sort_order, opt.id
        LOOP
          IF v_opt.why IS NOT NULL THEN
            v_reason := v_opt.why;
            CONTINUE;
          END IF;
          IF p_guests IS NOT NULL AND (p_guests < v_opt.guest_min OR p_guests > CASE
               WHEN v_offer.extra_guest_minor IS NOT NULL THEN v_opt.cap ELSE v_opt.guest_max END) THEN
            CONTINUE;
          END IF;
          v_considered := v_considered + 1;
          SELECT * INTO v_state FROM public.issue_4490_spaces_status(
            public.issue_4490_option_spaces(v_opt.id), v_ranges.claim, NULL);
          v_rank := CASE v_state.status WHEN 'free' THEN 3 WHEN 'held' THEN 2 ELSE 1 END;
          IF v_rank > v_best THEN
            v_best := v_rank;
            v_price := public.issue_4490_option_price_at(v_opt.id, v_window.id);
          ELSIF v_rank = v_best THEN
            v_price := LEAST(v_price, public.issue_4490_option_price_at(v_opt.id, v_window.id));
          END IF;
        END LOOP;
        IF v_considered = 0 THEN
          IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
            status := 'wrong_weekday'; reason := v_reason;
          ELSE
            status := 'closed'; reason := 'no_space_fits';
          END IF;
        ELSE
          status := CASE v_best WHEN 3 THEN 'available' WHEN 2 THEN 'held' ELSE 'taken' END;
          remaining := CASE WHEN v_best = 3 THEN 1 ELSE 0 END;
          price_minor := v_price;
        END IF;
      END IF;
      v_reason := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;
    price_minor := CASE WHEN p_price_option_id IS NOT NULL
      THEN public.issue_4490_option_price_at(p_price_option_id, v_window.id)
      ELSE (SELECT min(public.issue_4490_option_price_at(opt.id, v_window.id))
            FROM public.venue_offer_price_options opt
            WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
              AND public.issue_4490_option_window_reason(opt.id, v_window.id) IS NULL) END;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
    IF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
      status := 'closed'; reason := 'bookings_paused';
    ELSIF COALESCE(v_usage.closed, public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date)) THEN
      status := 'closed';
      reason := CASE WHEN COALESCE(v_usage.venue_hired, false) THEN 'venue_hired' END;
    ELSIF v_window.local_date > v_last THEN
      status := 'too_far';
    ELSIF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
      status := 'too_soon';
    ELSE
      v_reason := CASE WHEN p_price_option_id IS NOT NULL
        THEN public.issue_4490_option_window_reason(p_price_option_id, v_window.id) END;
      IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
        status := 'wrong_weekday'; reason := v_reason;
      ELSIF v_reason IS NOT NULL THEN
        status := 'closed'; reason := v_reason;
      ELSE
        v_remaining := COALESCE(v_usage.online_left, 0);
        IF v_offer.entry_style = 'timed_session' THEN
          v_remaining := LEAST(v_remaining,
            GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
        END IF;
        remaining := v_remaining;
        IF v_remaining >= COALESCE(p_guests, 1) THEN
          status := 'available';
        ELSIF v_remaining = 0 AND COALESCE(v_usage.gate_left, 0) > 0 THEN
          status := 'gate_only';
        ELSE
          status := 'sold_out';
          reason := CASE WHEN v_remaining > 0 THEN 'not_enough_left' END;
        END IF;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- The guest's choice of places for one hire window: every price row with
-- whether it fits the party and whether its places are free, held or booked
-- (and by which place, so "Green + Lounge" can say "The Lounge Side is
-- booked"). Spaces too small are listed as too_small, never as an error.
CREATE OR REPLACE FUNCTION public.pg_venue_hire_options(
  p_offering_id uuid,
  p_window_id uuid,
  p_guests integer DEFAULT NULL
)
RETURNS TABLE (
  price_option_id uuid,
  name text,
  space_id uuid,
  combination_id uuid,
  place_name text,
  setting text,
  capacity integer,
  guest_min integer,
  guest_max integer,
  unit text,
  price_minor bigint,
  status text,
  reason text,
  blocked_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_ranges record;
  v_state record;
  v_opt record;
  v_max integer;
BEGIN
  IF p_offering_id IS NULL OR p_window_id IS NULL OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN 1 AND 100000) THEN
    RAISE EXCEPTION 'availability_range_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN
    RETURN;
  END IF;
  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind = 'private_hire' AND o.status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, 'private_hire') THEN
    RETURN;
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows
  WHERE id = p_window_id AND offering_id = v_offer.id AND NOT stop_sell;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_ranges FROM public.issue_4490_hire_ranges(v_offer.id, v_window.id, 0);
  FOR v_opt IN
    SELECT opt.* FROM public.venue_offer_price_options opt
    WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
      AND public.issue_4490_option_spaces(opt.id) IS NOT NULL
    ORDER BY opt.sort_order, opt.created_at
  LOOP
    price_option_id := v_opt.id;
    name := v_opt.name;
    space_id := v_opt.space_id;
    combination_id := v_opt.combination_id;
    place_name := public.issue_4490_option_place_name(v_opt.id);
    setting := (SELECT s.setting FROM public.venue_spaces s WHERE s.id = v_opt.space_id);
    capacity := public.issue_4490_option_capacity(v_opt.id);
    guest_min := v_opt.guest_min;
    guest_max := v_opt.guest_max;
    unit := v_opt.unit;
    price_minor := public.issue_4490_option_price_at(v_opt.id, v_window.id);
    reason := NULL;
    blocked_by := NULL;
    v_max := CASE WHEN v_offer.extra_guest_minor IS NOT NULL THEN capacity ELSE v_opt.guest_max END;
    IF public.issue_4490_option_window_reason(v_opt.id, v_window.id) IS NOT NULL THEN
      status := 'wrong_weekday';
      reason := public.issue_4490_option_window_reason(v_opt.id, v_window.id);
    ELSIF p_guests IS NOT NULL AND p_guests > v_max THEN
      status := 'too_small';
    ELSIF p_guests IS NOT NULL AND p_guests < v_opt.guest_min THEN
      status := 'too_big';
      reason := 'below_minimum';
    ELSE
      SELECT * INTO v_state FROM public.issue_4490_spaces_status(
        public.issue_4490_option_spaces(v_opt.id), v_ranges.claim, NULL);
      status := CASE v_state.status WHEN 'free' THEN 'available' ELSE v_state.status END;
      IF v_state.status <> 'free' THEN
        reason := v_state.blocking_source;
        blocked_by := COALESCE(
          (SELECT c.name FROM public.venue_space_combinations c WHERE c.id = v_state.blocking_combination_id),
          (SELECT s.name FROM public.venue_spaces s WHERE s.id = v_state.blocking_space_id));
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- "Offer her <next free date>": the next windows where a price row's places
-- are free (no booking, hold, event or block), venue open, not too soon.
CREATE OR REPLACE FUNCTION public.issue_4490_next_free_dates(
  p_offering_id uuid,
  p_price_option_id uuid,
  p_from date DEFAULT NULL,
  p_limit integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_spaces uuid[];
  v_from date;
  v_window record;
  v_ranges record;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id AND kind = 'private_hire';
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(v_offer.venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_spaces := public.issue_4490_option_spaces(p_price_option_id);
  IF v_spaces IS NULL OR NOT EXISTS (SELECT 1 FROM public.venue_offer_price_options o
                                     WHERE o.id = p_price_option_id AND o.offering_id = v_offer.id) THEN
    RAISE EXCEPTION 'option_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_from := COALESCE(p_from, (now() AT TIME ZONE public.issue_4490_venue_timezone(v_offer.venue_id))::date);
  FOR v_window IN
    SELECT w.id, w.local_date, w.starts_at, w.ends_at, r.session_label
    FROM public.stay_place_windows w
    JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
    WHERE w.offering_id = v_offer.id AND NOT w.stop_sell AND w.local_date BETWEEN v_from AND v_from + 180
      AND now() < public.issue_4490_window_cutoff(v_offer.id, w.id)
      AND public.issue_4490_option_window_reason(p_price_option_id, w.id) IS NULL
      AND NOT public.issue_4490_day_closed(v_offer.venue_id, w.local_date)
    ORDER BY w.starts_at, w.id
  LOOP
    SELECT * INTO v_ranges FROM public.issue_4490_hire_ranges(v_offer.id, v_window.id, 0);
    IF (SELECT s.status FROM public.issue_4490_spaces_status(v_spaces, v_ranges.claim, NULL) s) = 'free' THEN
      v_out := v_out || jsonb_build_object('windowId', v_window.id, 'localDate', v_window.local_date,
        'startsAt', v_window.starts_at, 'endsAt', v_window.ends_at, 'sessionLabel', v_window.session_label);
      EXIT WHEN jsonb_array_length(v_out) >= LEAST(GREATEST(COALESCE(p_limit, 3), 1), 10);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Quote a private hire (service role; the edge function authenticates the
--     buyer): one price row (a place) for one session, the party size, any
--     extra hours, extras and the answers (occasion, a note, site visit, any
--     "guests choose one"). Request-first hires may be asked for a place on
--     hold (the host can queue it); a booked place is refused.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_quote_hire_internal(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_extras jsonb,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_existing public.stay_quotes%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_item jsonb;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_request_hash text;
  v_currency text;
  v_guests integer;
  v_overtime integer := 0;
  v_cap integer;
  v_max integer;
  v_unit bigint;
  v_base bigint;
  v_hire bigint;
  v_extra_guests integer := 0;
  v_extra_guest_minor bigint := 0;
  v_overtime_minor bigint := 0;
  v_extras jsonb := '[]'::jsonb;
  v_extras_minor bigint := 0;
  v_answers jsonb;
  v_tax bigint;
  v_total bigint;
  v_last date;
  v_spaces uuid[];
  v_ranges record;
  v_state record;
  v_mode text;
  v_minutes integer;
BEGIN
  IF p_offering_id IS NULL OR p_window_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) <> 1 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_item := p_lines->0;
  IF jsonb_typeof(v_item) <> 'object'
     OR COALESCE(v_item->>'priceOptionId', '') !~ '^[0-9a-f-]{36}$'
     OR jsonb_typeof(v_item->'guests') <> 'number' OR (v_item->>'guests') !~ '^[0-9]{1,6}$'
     OR (v_item->>'guests')::integer NOT BETWEEN 1 AND 100000
     OR (v_item ? 'overtimeHours' AND (COALESCE(v_item->>'overtimeHours', '') !~ '^[0-9]{1,2}$'
         OR (v_item->>'overtimeHours')::integer > 12)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_extras, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_extras, '[]'::jsonb)) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
                WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') !~ '^[a-z0-9][a-z0-9-]{0,39}$'
                   OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
     OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e)
        <> jsonb_array_length(COALESCE(p_extras, '[]'::jsonb))
     OR jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'offering', p_offering_id, 'window', p_window_id, 'lines', p_lines,
    'extras', COALESCE(p_extras, '[]'::jsonb), 'answers', COALESCE(p_answers, '{}'::jsonb))::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-quote:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_quotes
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_quote_projection(v_existing.id);
  END IF;

  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind = 'private_hire';
  IF NOT FOUND OR v_offer.status <> 'live' OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, 'private_hire') THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id AND offering_id = v_offer.id;
  IF NOT FOUND OR v_window.stop_sell THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' OR public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_last := (now() AT TIME ZONE v_settings.timezone)::date
    + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  IF v_window.local_date > v_last THEN
    RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
  END IF;
  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_policy FROM public.stay_policy_versions WHERE offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_offer.brand_id;

  SELECT * INTO v_option FROM public.venue_offer_price_options
  WHERE id = (v_item->>'priceOptionId')::uuid AND offering_id = v_offer.id AND status = 'active';
  v_spaces := public.issue_4490_option_spaces(v_option.id);
  IF NOT FOUND OR v_spaces IS NULL THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF public.issue_4490_option_window_reason(v_option.id, v_window.id) IS NOT NULL THEN
    RAISE EXCEPTION 'offer_%', public.issue_4490_option_window_reason(v_option.id, v_window.id) USING ERRCODE = 'PT409';
  END IF;
  v_guests := (v_item->>'guests')::integer;
  v_cap := public.issue_4490_option_capacity(v_option.id);
  v_max := CASE WHEN v_offer.extra_guest_minor IS NOT NULL THEN v_cap ELSE v_option.guest_max END;
  IF v_guests < v_option.guest_min OR v_guests > v_max THEN
    RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
  END IF;
  IF v_item ? 'overtimeHours' AND (v_item->>'overtimeHours')::integer > 0 THEN
    IF v_offer.overtime_minor_per_hour IS NULL THEN
      RAISE EXCEPTION 'offer_overtime_unavailable' USING ERRCODE = '22023';
    END IF;
    v_overtime := (v_item->>'overtimeHours')::integer;
  END IF;
  SELECT * INTO v_price FROM public.stay_price_versions
  WHERE price_option_id = v_option.id AND offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND OR v_price.currency_code <> v_currency THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- Answers: every "guests choose one" answered; occasion, a note, site visit.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.inclusions) i
             WHERE i->>'kind' = 'choice'
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(i->'options') o
                               WHERE o = COALESCE(p_answers->>(i->>'label'), '')))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_answers, '{}'::jsonb)) k
                WHERE k NOT IN ('occasion', 'note', 'siteVisit')
                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.inclusions) i
                                  WHERE i->>'kind' = 'choice' AND i->>'label' = k))
     OR (p_answers ? 'occasion' AND (jsonb_typeof(p_answers->'occasion') <> 'string'
         OR char_length(btrim(p_answers->>'occasion')) NOT BETWEEN 1 AND 60))
     OR (p_answers ? 'note' AND (jsonb_typeof(p_answers->'note') <> 'string' OR char_length(p_answers->>'note') > 500))
     OR (p_answers ? 'siteVisit' AND jsonb_typeof(p_answers->'siteVisit') <> 'boolean') THEN
    RAISE EXCEPTION 'offer_answer_required' USING ERRCODE = '22023';
  END IF;
  v_answers := jsonb_strip_nulls(COALESCE(p_answers, '{}'::jsonb)
    || jsonb_build_object('note', NULLIF(btrim(COALESCE(p_answers->>'note', '')), ''),
                          'occasion', NULLIF(btrim(COALESCE(p_answers->>'occasion', '')), '')));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
    RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- The place must not be booked; an instant hire also needs it free (a
  -- request may wait behind someone else's hold).
  SELECT * INTO v_ranges FROM public.issue_4490_hire_ranges(v_offer.id, v_window.id, v_overtime * 60);
  SELECT * INTO v_state FROM public.issue_4490_spaces_status(v_spaces, v_ranges.claim, NULL);
  v_mode := CASE WHEN COALESCE(v_offer.confirmation_mode, 'request') = 'instant' THEN 'instant' ELSE 'request' END;
  IF v_state.status = 'taken' OR (v_state.status = 'held' AND v_mode = 'instant') THEN
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
  END IF;

  -- Price: the row (per booking, or per guest), guests above the row, extra
  -- hours, extras.
  v_unit := public.issue_4490_option_price_at(v_option.id, v_window.id);
  v_hire := CASE v_option.unit WHEN 'guest' THEN v_unit * LEAST(v_guests, v_option.guest_max) ELSE v_unit END;
  IF v_guests > v_option.guest_max THEN
    v_extra_guests := v_guests - v_option.guest_max;
    v_extra_guest_minor := v_extra_guests * v_offer.extra_guest_minor;
  END IF;
  v_overtime_minor := v_overtime * COALESCE(v_offer.overtime_minor_per_hour, 0);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
           'unitPriceMinor', (x->>'price_minor')::bigint,
           'qty', CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END,
           'amountMinor', (x->>'price_minor')::bigint
              * CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END)
           ORDER BY x->>'name'), '[]'::jsonb)
  INTO v_extras
  FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
  JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
  SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_extras_minor FROM jsonb_array_elements(v_extras) x;
  v_base := v_hire + v_extra_guest_minor + v_overtime_minor + v_extras_minor;
  IF v_base > 9000000000000000 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  v_minutes := (extract(epoch FROM (upper(v_ranges.booked) - lower(v_ranges.booked)))::integer / 60);

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, p_user_id, p_actor_key, v_offer.venue_id, v_offer.brand_id, v_currency,
    v_mode, 'building', 0, 0, 0, 0,
    v_request_hash, repeat('0', 64), repeat('0', 64), repeat('0', 64),
    btrim(p_idempotency_key), now() + interval '15 minutes', 'private_hire'
  );
  INSERT INTO public.stay_quote_lines (
    id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
    base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
    offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot,
    price_option_id, booked_minutes
  ) VALUES (
    v_line_id, v_quote_id, v_offer.id, 'private_hire', v_mode, v_window.id, LEAST(v_guests, 1000),
    v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
    jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
      'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
      'localDate', v_window.local_date, 'spaceIds', to_jsonb(v_spaces), 'combinationId', v_option.combination_id,
      'bookedFrom', lower(v_ranges.booked), 'bookedTo', upper(v_ranges.booked),
      'claimFrom', lower(v_ranges.claim), 'claimTo', upper(v_ranges.claim)),
    jsonb_build_object('name', v_offer.name, 'kind', v_offer.kind, 'venueId', v_offer.venue_id,
      'sessionLabel', (SELECT r.session_label FROM public.stay_place_schedule_rules r WHERE r.id = v_window.schedule_rule_id)),
    jsonb_build_object('optionName', v_option.name, 'unit', v_option.unit, 'unitPriceMinor', v_unit,
      'listPriceMinor', v_price.amount_minor, 'currencyCode', v_currency, 'sortOrder', v_option.sort_order,
      'placeName', public.issue_4490_option_place_name(v_option.id), 'spaceIds', to_jsonb(v_spaces),
      'spaceId', v_option.space_id, 'combinationId', v_option.combination_id,
      'guests', v_guests, 'packageMinor', v_hire,
      'extraGuests', v_extra_guests, 'extraGuestMinor', v_extra_guest_minor,
      'overtimeHours', v_overtime, 'overtimeMinor', v_overtime_minor,
      'extras', v_extras, 'extrasMinor', v_extras_minor, 'answers', v_answers,
      'hireCharge', COALESCE(v_offer.hire_charge, 'hire_fee'), 'minSpendMinor', v_offer.min_spend_minor),
    to_jsonb(v_policy) - 'created_by',
    v_option.id, LEAST(GREATEST(v_minutes, 15), 10080)
  );
  FOR v_fee IN
    SELECT * FROM public.stay_fee_versions
    WHERE offering_id = v_offer.id AND effective_to IS NULL
    ORDER BY fee_key, id
  LOOP
    v_tax := CASE
      WHEN v_fee.calculation = 'percentage_of_line_base' AND v_fee.display_mode = 'included'
        THEN round(v_base::numeric * v_fee.basis_points / (10000 + v_fee.basis_points))::bigint
      WHEN v_fee.calculation = 'percentage_of_line_base'
        THEN round(v_base::numeric * v_fee.basis_points / 10000)::bigint
      WHEN v_fee.calculation = 'fixed_per_place_booking' THEN v_fee.amount_minor
      WHEN v_fee.calculation = 'fixed_per_place_guest' THEN v_fee.amount_minor * v_guests
      ELSE 0 END;
    INSERT INTO public.stay_quote_fee_lines (
      quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor,
      included_in_base, refund_treatment, snapshot
    ) VALUES (
      v_quote_id, v_line_id, v_fee.id, v_fee.label, v_fee.fee_kind, v_tax,
      v_fee.display_mode = 'included', v_fee.refund_treatment, to_jsonb(v_fee)
    );
  END LOOP;
  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor, tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;
  SELECT total_minor INTO v_total FROM public.stay_quote_lines WHERE id = v_line_id;
  IF v_total > 9000000000000000 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = l.base_minor, fee_total_minor = l.fee_minor,
      tax_total_minor = l.tax_minor, total_minor = l.total_minor,
      price_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.price_version_id::text || ':' || l.price_snapshot::text, 'UTF8')), 'hex'),
      inventory_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text, 'UTF8')), 'hex'),
      policy_snapshot_hash = encode(pg_catalog.sha256(convert_to(
        l.policy_version_id::text || ':' || l.policy_snapshot::text, 'UTF8')), 'hex')
  FROM public.stay_quote_lines l
  WHERE q.id = v_quote_id AND l.id = v_line_id;
  RETURN public.issue_4490_quote_projection(v_quote_id) || jsonb_build_object(
    'hire', jsonb_build_object(
      'placeName', public.issue_4490_option_place_name(v_option.id),
      'spaceIds', to_jsonb(v_spaces),
      'guests', v_guests,
      'placeStatus', v_state.status,
      'bookedFrom', lower(v_ranges.booked), 'bookedTo', upper(v_ranges.booked),
      'hireMinor', v_hire, 'extraGuests', v_extra_guests, 'extraGuestMinor', v_extra_guest_minor,
      'overtimeHours', v_overtime, 'overtimeMinor', v_overtime_minor,
      'damageDepositMinor', COALESCE((SELECT sum(f.amount_minor) FROM public.stay_quote_fee_lines f
                                      WHERE f.quote_id = v_quote_id AND f.snapshot->>'fee_key' = 'damage_deposit'), 0),
      'requestResponseHours', v_settings.request_response_hours,
      'payPlan', public.issue_4490_deposit_plan(v_offer.id, v_window.id,
        v_total - COALESCE((SELECT sum(f.amount_minor)::bigint FROM public.stay_quote_fee_lines f
                            WHERE f.quote_id = v_quote_id AND f.snapshot->>'fee_key' = 'damage_deposit'), 0))));
END;
$function$;

-- The public quote entry point: a private hire takes the hire path; every
-- other kind is unchanged.
CREATE OR REPLACE FUNCTION public.issue_4490_quote_offer(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_extras jsonb DEFAULT '[]'::jsonb,
  p_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_offerings o WHERE o.id = p_offering_id AND o.kind = 'private_hire') THEN
    RETURN public.issue_4490_quote_hire_internal(
      p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, p_extras, p_answers);
  END IF;
  RETURN public.issue_4490_quote_offer_internal(
    p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, false, p_extras, p_answers);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. Send the request (or hold an instant hire). A request takes no space
--     and no capacity (ruling 4): a timer-only hold until the reply deadline.
--     An instant hire holds its places (held claims) until the pay deadline
--     and checks the day's entry limit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_hold_hire_internal(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_request_hash text;
  v_hold_id uuid := gen_random_uuid();
  v_line_id uuid;
  v_hold_expires timestamptz;
  v_deadline timestamptz;
  v_policy jsonb;
  v_plan jsonb;
  v_damage bigint;
  v_spaces uuid[];
  v_ranges record;
  v_state record;
  v_request boolean;
BEGIN
  IF p_group_id IS NULL OR p_quote_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR p_buyer_token_hash IS NULL OR octet_length(p_buyer_token_hash) <> 32 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM public.issue_4490_assert_offer_guest(p_guest, true);
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'quoteId', p_quote_id, 'guest', p_guest)::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-group:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_reservation_groups
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash OR v_existing.offer_kind IS NULL THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_quote FROM public.stay_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> p_actor_key OR v_quote.offer_kind IS DISTINCT FROM 'private_hire' THEN
    RAISE EXCEPTION 'offer_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' THEN
      UPDATE public.stay_quotes SET status = 'expired', version = version + 1 WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'offer_quote_expired' USING ERRCODE = 'PT409';
  END IF;
  PERFORM 1 FROM public.brands WHERE id = v_quote.brand_id FOR UPDATE;
  SELECT * INTO v_line FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY id LIMIT 1;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id FOR UPDATE;
  IF v_offer.status <> 'live' OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, 'private_hire')
     OR v_line.offering_version <> v_offer.version
     OR NOT EXISTS (SELECT 1 FROM public.stay_price_versions p WHERE p.id = v_line.price_version_id AND p.effective_to IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.stay_policy_versions p WHERE p.id = v_line.policy_version_id AND p.effective_to IS NULL) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id FOR UPDATE;
  IF v_window.stop_sell OR now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  IF NOT public.pg_brand_can_collect(v_quote.brand_id)
     OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = v_quote.brand_id
                    AND upper(b.default_currency) = v_quote.currency_code) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  v_request := v_quote.mode = 'request';
  v_spaces := ARRAY(SELECT jsonb_array_elements_text(v_line.inventory_snapshot->'spaceIds')::uuid);
  SELECT tstzrange((v_line.inventory_snapshot->>'bookedFrom')::timestamptz, (v_line.inventory_snapshot->>'bookedTo')::timestamptz, '[)') AS booked,
         tstzrange((v_line.inventory_snapshot->>'claimFrom')::timestamptz, (v_line.inventory_snapshot->>'claimTo')::timestamptz, '[)') AS claim
  INTO v_ranges;
  SELECT * INTO v_state FROM public.issue_4490_spaces_status(v_spaces, v_ranges.claim, NULL);
  IF v_state.status = 'taken' OR (v_state.status = 'held' AND NOT v_request) THEN
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
  END IF;

  v_policy := v_line.policy_snapshot;
  SELECT COALESCE(sum(f.amount_minor), 0) INTO v_damage FROM public.stay_quote_fee_lines f
  WHERE f.quote_id = v_quote.id AND f.snapshot->>'fee_key' = 'damage_deposit';
  -- The deposit is worked out on the total less the refundable damage deposit
  -- (collected with the balance).
  v_plan := public.issue_4490_deposit_plan(v_offer.id, v_window.id, v_quote.total_minor - v_damage);
  IF v_request THEN
    v_deadline := LEAST(now() + make_interval(hours => v_settings.request_response_hours), v_window.starts_at);
    v_hold_expires := v_deadline;
  ELSE
    v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  END IF;
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection, created_by_staff_user_id,
    deposit_minor, balance_due_at, booking_answers
  ) VALUES (
    p_group_id,
    'VB-' || upper(substr(replace(p_group_id::text, '-', ''), 1, 20)),
    v_quote.id, p_user_id, p_actor_key, v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    v_quote.mode, CASE WHEN v_request THEN 'request_pending' ELSE 'instant_payment_pending' END,
    v_deadline, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(p_guest->>'name'),
      'email', NULLIF(lower(btrim(COALESCE(p_guest->>'email', ''))), ''),
      'phone', NULLIF(btrim(COALESCE(p_guest->>'phone', '')), ''),
      'phoneCountryIso', NULLIF(p_guest->>'phoneCountryIso', ''))),
    v_quote.source_subtotal_minor, v_quote.fee_total_minor, v_quote.tax_total_minor, v_quote.total_minor,
    btrim(p_idempotency_key), v_request_hash, 'private_hire', p_buyer_token_hash,
    jsonb_build_object(
      'stagePlan', CASE WHEN v_plan->>'depositMinor' IS NOT NULL THEN 'deposit_or_full' ELSE 'full' END,
      'depositKind', COALESCE(v_plan->>'depositKind', 'none'),
      'depositValue', (v_plan->>'depositValue')::bigint,
      'depositMinor', (v_plan->>'depositMinor')::bigint,
      'balanceDueAt', v_plan->>'balanceDueAt',
      'payModes', v_plan->'payModes',
      'currencyCode', v_quote.currency_code,
      'vatMode', v_settings.vat_mode,
      'refundLadder', COALESCE(v_policy->'refund_ladder', '[]'::jsonb),
      'dateChangeRule', COALESCE(v_policy->'date_change_rule', '{}'::jsonb),
      'policyText', v_policy->>'cancellation_policy',
      'operatorCancelRefundBps', (v_policy->>'operator_cancel_refund_basis_points')::integer,
      'damageDepositMinor', v_damage,
      'minSpendMinor', v_offer.min_spend_minor,
      'hireCharge', COALESCE(v_offer.hire_charge, 'hire_fee'),
      'setupMinutes', v_offer.buffer_before_minutes,
      'cleanupMinutes', v_offer.buffer_after_minutes,
      'requestResponseHours', v_settings.request_response_hours,
      'approvedPaymentMinutes', v_settings.approved_payment_minutes,
      'localDate', v_window.local_date),
    'guest', 'mingla', NULL,
    (v_plan->>'depositMinor')::bigint,
    (v_plan->>'balanceDueAt')::timestamptz,
    COALESCE(v_line.price_snapshot->'answers', '{}'::jsonb)
  );
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_units, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
  )
  SELECT gen_random_uuid(), p_group_id, l.id, l.offering_id, l.kind,
         CASE WHEN v_request THEN 'request_pending' ELSE 'payment_pending' END, l.place_window_id,
         l.place_units, l.place_guests, 0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id, l.booked_minutes
  FROM public.stay_quote_lines l WHERE l.id = v_line.id
  RETURNING id INTO v_line_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, p_group_id, 'active', v_hold_expires, CASE WHEN v_request THEN 'request' ELSE 'instant_payment' END);
  IF NOT v_request THEN
    INSERT INTO public.stay_inventory_hold_slices (
      hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
    ) VALUES (v_hold_id, v_line_id, 'place_window', v_offer.id, v_window.id, v_line.place_guests);
    PERFORM public.issue_4490_claim_spaces(p_group_id, v_line_id, v_hold_id, v_spaces,
      (v_line.inventory_snapshot->>'combinationId')::uuid, v_ranges.booked, v_ranges.claim, v_hold_expires);
    PERFORM public.issue_4490_assert_hire_capacity(v_offer.venue_id, v_spaces, v_ranges.booked);
  END IF;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, CASE WHEN v_request THEN 'stay_offer_request_sent' ELSE 'stay_offer_hold_created' END,
    'guest', p_user_id, 'offer-hold:' || btrim(p_idempotency_key),
    jsonb_build_object('holdExpiresAt', v_hold_expires, 'guests', v_line.price_snapshot->'guests',
      'localDate', v_window.local_date, 'placeName', v_line.price_snapshot->>'placeName')
  );
  RETURN p_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_create_offer_group(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_quotes q WHERE q.id = p_quote_id AND q.offer_kind = 'private_hire') THEN
    v_id := public.issue_4490_hold_hire_internal(
      p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash, p_idempotency_key);
  ELSE
    v_id := public.issue_4490_hold_offer_internal(
      p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash,
      p_idempotency_key, false, NULL, 'mingla');
  END IF;
  RETURN public.issue_4490_booking_projection(v_id, NULL);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 13. Pay: an approved hire pays its deposit ("holds your date") or all of
--     it while on hold; what is owed includes an edited quote (applied
--     amendment). The refundable damage deposit is never part of a deposit
--     payment and never carries the platform fee.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_prepare_offer_payment(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_idempotency_key text,
  p_expected_version bigint,
  p_pay_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_money record;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness bigint;
  v_stage text;
  v_amount bigint;
  v_outstanding bigint;
  v_damage_out bigint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_expected_version IS NULL
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (p_pay_mode IS NOT NULL AND p_pay_mode NOT IN ('deposit', 'full')) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer-payment:' || p_group_id::text || ':' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_attempt FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> encode(pg_catalog.sha256(convert_to(jsonb_build_object(
         'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_attempt.stage,
         'amountMinor', v_attempt.amount_minor::text)::text, 'UTF8')), 'hex')
       AND v_attempt.request_hash <> encode(pg_catalog.sha256(convert_to(jsonb_build_object(
         'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_attempt.stage)::text, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_attempt.stage);
  END IF;
  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stay_payment_attempts a
    WHERE a.group_id = p_group_id AND a.state IN ('pending', 'ambiguous')
  ) THEN
    RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);

  IF v_group.state IN ('instant_payment_pending', 'approved_payment_required') THEN
    IF v_group.payment_collection <> 'mingla' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
      RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = p_group_id AND a.state = 'succeeded') THEN
      RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
    END IF;
    IF p_pay_mode = 'deposit' THEN
      IF v_group.deposit_minor IS NULL OR v_group.balance_due_at IS NULL OR v_group.balance_due_at <= now() THEN
        RAISE EXCEPTION 'offer_pay_mode_unavailable' USING ERRCODE = '22023';
      END IF;
      v_stage := 'deposit';
      v_amount := v_group.deposit_minor;
    ELSE
      v_stage := 'full';
      -- #4490 P4: the total owed (an approved hire's edited quote included).
      v_amount := COALESCE(v_money.total_due, v_group.total_minor);
    END IF;
  ELSIF v_group.state IN ('confirmed', 'partially_cancelled') THEN
    IF COALESCE(v_money.balance, 0) <= 0 THEN
      RAISE EXCEPTION 'offer_nothing_to_pay' USING ERRCODE = 'PT409';
    END IF;
    v_stage := 'balance';
    v_amount := v_money.balance;
  ELSE
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF v_amount > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_stage,
    'amountMinor', v_amount::text)::text, 'UTF8')), 'hex');
  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack' THEN pricing.paystack_subaccount_code ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(v_group.brand_id, v_group.venue_id) pricing
  LIMIT 1;
  SELECT b.payout_hold_cutover_at, b.discovery_currency_state_version INTO v_cutover, v_readiness
  FROM public.brands b WHERE b.id = v_group.brand_id;
  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR v_cutover IS NULL
     OR (v_provider = 'stripe' AND v_account IS NULL)
     OR (v_provider = 'paystack' AND v_currency <> 'NGN')
     OR (v_provider = 'paystack' AND NULLIF(v_group.guest_snapshot->>'email', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  -- What can take this payment: a deposit never touches the damage deposit.
  SELECT COALESCE(sum(c.outstanding_minor) FILTER (
           WHERE NOT (v_stage = 'deposit' AND c.component = 'fee' AND c.snapshot->>'fee_key' = 'damage_deposit')), 0),
         COALESCE(sum(c.outstanding_minor) FILTER (
           WHERE c.component = 'fee' AND c.snapshot->>'fee_key' = 'damage_deposit'), 0)
  INTO v_outstanding, v_damage_out
  FROM public.issue_4490_payment_components(p_group_id) c;
  IF v_outstanding < v_amount THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  v_app_fee := LEAST(v_amount, round(
    (v_amount - CASE WHEN v_stage = 'deposit' THEN 0 ELSE LEAST(v_damage_out, v_amount) END)::numeric
    * COALESCE(v_take_rate, 0) / 10000)::bigint);
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts WHERE group_id = p_group_id;
  PERFORM set_config('mingla.issue_4490_offer_rail', p_group_id::text, true);
  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref, amount_minor, currency_code,
    application_fee_minor, state, idempotency_key, request_hash, readiness_revision, stage
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account, v_amount, v_group.currency_code,
    v_app_fee, 'created', btrim(p_idempotency_key), v_request_hash, COALESCE(v_readiness, 1), v_stage
  ) RETURNING * INTO v_attempt;
  WITH comp AS (
    SELECT * FROM public.issue_4490_payment_components(p_group_id) c
    WHERE c.outstanding_minor > 0
      AND NOT (v_stage = 'deposit' AND c.component = 'fee' AND c.snapshot->>'fee_key' = 'damage_deposit')
  ), tot AS (
    SELECT sum(outstanding_minor) AS s FROM comp
  ), fl AS (
    SELECT comp.*,
      floor(v_amount::numeric * comp.outstanding_minor / tot.s)::bigint AS f,
      (v_amount::numeric * comp.outstanding_minor)
        - floor(v_amount::numeric * comp.outstanding_minor / tot.s) * tot.s AS rem
    FROM comp, tot
  ), rk AS (
    SELECT fl.*,
      row_number() OVER (ORDER BY fl.rem DESC, fl.sort_key, fl.reservation_line_id, fl.component_ref) AS rn,
      v_amount - sum(fl.f) OVER () AS extra
    FROM fl
  )
  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref, charged_minor, refund_treatment, snapshot
  )
  SELECT v_attempt.id, rk.reservation_line_id, rk.component, rk.component_ref,
         rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END,
         rk.refund_treatment, rk.snapshot || jsonb_build_object('stage', v_stage)
  FROM rk
  WHERE rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END > 0
  ORDER BY rk.reservation_line_id, rk.sort_key, rk.component_ref;
  IF (SELECT COALESCE(sum(charged_minor), 0) FROM public.stay_payment_allocations
      WHERE payment_attempt_id = v_attempt.id) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', p_user_id, 'payment-prepared:' || v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id, 'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text, 'currencyCode', v_attempt.currency_code, 'stage', v_stage)
  );
  RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_stage);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Staff: answer a request (edge venue-offer-staff acts for the user it
--     verified). Authority: venue.manage_bookings or brand rank >=
--     event_manager; changing the price also needs money rights.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_user_can_manage_bookings(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_brand_effective_rank(venue.brand_id, p_user_id) >= public.biz_role_rank('event_manager')
        OR public.issue_4490_user_has_venue_capability(venue.id, p_user_id, 'venue.manage_bookings')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_staff_receipt(
  p_scope text,
  p_user_id uuid,
  p_key text,
  p_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.venue_offer_staff_receipts%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_scope || ':' || btrim(p_key), 4490));
  SELECT * INTO v_row FROM public.venue_offer_staff_receipts
  WHERE scope = p_scope AND actor_user_id = p_user_id AND idempotency_key = btrim(p_key);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_row.request_hash <> p_hash THEN
    RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  RETURN v_row.result || jsonb_build_object('replayed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_manage_request_for(
  p_user_id uuid,
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_money record;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_scope text;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_spaces uuid[];
  v_booked tstzrange;
  v_claim tstzrange;
  v_expires timestamptz;
  v_plan jsonb;
  v_damage bigint;
  v_new_base bigint;
  v_delta bigint;
  v_tax_delta bigint := 0;
  v_vat_bps integer;
  v_vat_included boolean;
  v_reason text;
  v_alternatives jsonb;
  v_blocker record;
  v_position integer;
  v_hours integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_group_id IS NULL
     OR p_action NOT IN ('approve', 'decline', 'queue', 'extend_hold', 'release_hold')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR char_length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_user_can_manage_bookings(v_group.venue_id, p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'approve' AND p_payload ? 'quoteEdit'
     AND NOT public.issue_4490_can_manage_money(v_group.venue_id, p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_scope := 'request:' || p_group_id::text;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_staff_receipt(v_scope, p_user_id, v_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF p_expected_version IS NULL OR v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_line FROM public.stay_reservation_lines WHERE group_id = v_group.id ORDER BY created_at, id LIMIT 1;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id;
  SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = v_group.id FOR UPDATE;
  v_settings := public.issue_4490_ensure_booking_settings(v_group.venue_id);
  v_spaces := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_line.price_snapshot->'spaceIds', '[]'::jsonb))::uuid);
  SELECT q.inventory_snapshot INTO v_result FROM public.stay_quote_lines q WHERE q.id = v_line.quote_line_id;
  v_booked := tstzrange((v_result->>'bookedFrom')::timestamptz, (v_result->>'bookedTo')::timestamptz, '[)');
  v_claim := tstzrange((v_result->>'claimFrom')::timestamptz, (v_result->>'claimTo')::timestamptz, '[)');
  v_result := NULL;

  IF p_action = 'approve' THEN
    IF v_group.state <> 'request_pending' OR v_hold.id IS NULL OR v_hold.state <> 'active' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    IF v_hold.expires_at <= now() THEN
      RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
    END IF;
    IF now() >= v_window.starts_at THEN
      RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
    END IF;
    IF cardinality(v_spaces) = 0 OR lower(v_booked) IS NULL THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    -- Edit the quote before approving: an applied amendment, so what the guest
    -- is asked for always equals what is owed.
    IF p_payload ? 'quoteEdit' THEN
      IF jsonb_typeof(p_payload->'quoteEdit') <> 'object'
         OR COALESCE(p_payload->'quoteEdit'->>'baseMinor', '') !~ '^[0-9]{1,15}$'
         OR (p_payload->'quoteEdit' ? 'note' AND char_length(COALESCE(p_payload->'quoteEdit'->>'note', '')) > 500) THEN
        RAISE EXCEPTION 'quote_edit_invalid' USING ERRCODE = '22023';
      END IF;
      v_new_base := (p_payload->'quoteEdit'->>'baseMinor')::bigint;
      v_delta := v_new_base - v_line.base_minor;
      IF v_delta <> 0 THEN
        SELECT (fee.snapshot->>'basis_points')::integer, fee.included_in_base INTO v_vat_bps, v_vat_included
        FROM public.stay_quote_fee_lines fee
        WHERE fee.quote_line_id = v_line.quote_line_id AND fee.fee_kind = 'tax'
        ORDER BY fee.id LIMIT 1;
        IF v_vat_bps IS NOT NULL AND NOT COALESCE(v_vat_included, false) THEN
          v_tax_delta := round(v_new_base::numeric * v_vat_bps / 10000)::bigint - v_line.tax_minor;
        END IF;
        PERFORM set_config('mingla.issue_4490_booking_change', v_group.id::text, true);
        INSERT INTO public.venue_booking_amendments (
          group_id, reservation_line_id, kind, price_delta_minor, tax_delta_minor, actor_type, actor_user_id,
          idempotency_key, request_hash, summary
        ) VALUES (
          v_group.id, v_line.id, 'balance_adjust', v_delta, v_tax_delta, 'staff', p_user_id,
          'quote-edit:' || md5(v_key), v_hash,
          jsonb_strip_nulls(jsonb_build_object('action', 'quote_edit', 'fromBaseMinor', v_line.base_minor,
            'toBaseMinor', v_new_base, 'taxDeltaMinor', v_tax_delta,
            'note', NULLIF(btrim(COALESCE(p_payload->'quoteEdit'->>'note', '')), ''))));
      END IF;
    END IF;
    -- Take the place until the pay deadline. A clash is offer_space_taken;
    -- a day whose entry is already sold beyond the hire cut is
    -- offer_capacity_conflict (both roll everything back).
    v_expires := LEAST(now() + make_interval(mins => v_settings.approved_payment_minutes), v_window.starts_at);
    INSERT INTO public.stay_inventory_hold_slices (
      hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
    ) VALUES (v_hold.id, v_line.id, 'place_window', v_line.offering_id, v_line.place_window_id, v_line.place_guests);
    PERFORM public.issue_4490_claim_spaces(v_group.id, v_line.id, v_hold.id, v_spaces,
      NULLIF(v_line.price_snapshot->>'combinationId', '')::uuid, v_booked, v_claim, v_expires);
    PERFORM public.issue_4490_assert_hire_capacity(v_group.venue_id, v_spaces, v_booked);
    UPDATE public.stay_inventory_holds
    SET expires_at = v_expires, reason = 'approved', version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    SELECT * INTO v_money FROM public.issue_4490_booking_money(v_group.id);
    v_damage := COALESCE((v_group.payment_plan_snapshot->>'damageDepositMinor')::bigint, 0);
    v_plan := public.issue_4490_deposit_plan(v_offer.id, v_window.id, v_money.total_due - v_damage);
    UPDATE public.stay_reservation_groups
    SET state = 'approved_payment_required', payment_deadline = v_expires,
        deposit_minor = (v_plan->>'depositMinor')::bigint,
        balance_due_at = (v_plan->>'balanceDueAt')::timestamptz,
        version = version + 1, updated_at = now()
    WHERE id = v_group.id RETURNING * INTO v_group;
    UPDATE public.stay_reservation_lines
    SET state = 'approved_payment_required', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id AND state = 'request_pending';
    UPDATE public.venue_request_queue SET released_at = COALESCE(released_at, now()) WHERE group_id = v_group.id;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_offer_request_approved', 'staff', p_user_id, 'request-approved:' || v_key,
      jsonb_strip_nulls(jsonb_build_object('holdUntil', v_expires,
        'amountMinor', COALESCE((v_plan->>'depositMinor')::bigint, v_money.total_due)::text,
        'depositMinor', (v_plan->>'depositMinor')::bigint, 'totalDueMinor', v_money.total_due,
        'note', NULLIF(btrim(COALESCE(p_payload->>'note', p_payload->'quoteEdit'->>'note', '')), ''))));
    v_result := jsonb_build_object('groupId', v_group.id, 'state', v_group.state, 'holdUntil', v_expires,
      'depositMinor', v_group.deposit_minor, 'balanceDueAt', v_group.balance_due_at,
      'totalDueMinor', v_money.total_due, 'amountDueNowMinor', COALESCE(v_group.deposit_minor, v_money.total_due),
      'groupVersion', v_group.version);

  ELSIF p_action = 'decline' THEN
    IF v_group.state <> 'request_pending' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    v_reason := btrim(COALESCE(p_payload->>'reason', ''));
    v_alternatives := COALESCE(p_payload->'alternatives', '[]'::jsonb);
    IF char_length(v_reason) NOT BETWEEN 3 AND 500 OR jsonb_typeof(v_alternatives) <> 'array'
       OR jsonb_array_length(v_alternatives) > 3
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_alternatives) d WHERE d !~ '^\d{4}-\d{2}-\d{2}$') THEN
      RAISE EXCEPTION 'decline_reason_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_reservation_groups SET state = 'declined', version = version + 1, updated_at = now()
    WHERE id = v_group.id RETURNING * INTO v_group;
    UPDATE public.stay_reservation_lines SET state = 'declined', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds SET state = 'released', reason = 'declined', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id AND state = 'active';
    UPDATE public.venue_request_queue SET released_at = COALESCE(released_at, now()) WHERE group_id = v_group.id;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_offer_request_declined', 'staff', p_user_id, 'request-declined:' || v_key,
      jsonb_build_object('reason', v_reason, 'alternatives', v_alternatives));
    v_result := jsonb_build_object('groupId', v_group.id, 'state', v_group.state, 'groupVersion', v_group.version);

  ELSIF p_action = 'queue' THEN
    IF v_group.state <> 'request_pending' OR v_hold.state <> 'active' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    SELECT c.group_id, g.public_reference, h.expires_at AS hold_until, c.state INTO v_blocker
    FROM public.venue_space_claims c
    JOIN public.stay_reservation_groups g ON g.id = c.group_id
    LEFT JOIN public.stay_inventory_holds h ON h.group_id = g.id AND h.state = 'active'
    WHERE c.space_id = ANY(v_spaces) AND c.claim_range && v_claim AND c.group_id <> v_group.id
      AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))
    ORDER BY (c.state = 'held') DESC, c.created_at LIMIT 1;
    IF v_blocker.group_id IS NULL THEN
      RAISE EXCEPTION 'offer_queue_not_needed' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.venue_request_queue (group_id, blocked_by_group_id, queued_by)
    VALUES (v_group.id, v_blocker.group_id, p_user_id)
    ON CONFLICT (group_id) DO UPDATE
      SET blocked_by_group_id = EXCLUDED.blocked_by_group_id, queued_by = EXCLUDED.queued_by,
          queued_at = now(), released_at = NULL;
    -- She keeps her place in line while the hold ahead of her runs.
    v_expires := LEAST(GREATEST(v_hold.expires_at,
        COALESCE(v_blocker.hold_until, now()) + make_interval(hours => v_settings.request_response_hours)),
      v_window.starts_at);
    UPDATE public.stay_inventory_holds SET expires_at = v_expires, version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    UPDATE public.stay_reservation_groups SET request_deadline = v_expires, version = version + 1, updated_at = now()
    WHERE id = v_group.id RETURNING * INTO v_group;
    SELECT count(*)::integer INTO v_position FROM public.venue_request_queue q
    WHERE q.blocked_by_group_id = v_blocker.group_id AND q.released_at IS NULL
      AND q.queued_at <= (SELECT q2.queued_at FROM public.venue_request_queue q2 WHERE q2.group_id = v_group.id);
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_offer_request_queued', 'staff', p_user_id, 'request-queued:' || v_key,
      jsonb_build_object('blockedBy', v_blocker.group_id, 'position', v_position, 'replyBy', v_expires));
    v_result := jsonb_build_object('groupId', v_group.id, 'state', v_group.state, 'position', v_position,
      'blockedByReference', v_blocker.public_reference, 'blockedByHoldUntil', v_blocker.hold_until,
      'replyBy', v_expires, 'groupVersion', v_group.version);

  ELSIF p_action = 'extend_hold' THEN
    v_hours := CASE WHEN COALESCE(p_payload->>'hours', '') ~ '^[0-9]{1,2}$' THEN (p_payload->>'hours')::integer END;
    IF v_hours IS NULL OR v_hours NOT IN (12, 24, 48) THEN
      RAISE EXCEPTION 'extend_hours_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_group.state <> 'approved_payment_required' OR v_hold.state <> 'active' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    IF v_hold.expires_at <= now() THEN
      RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
    END IF;
    v_expires := LEAST(v_hold.expires_at + make_interval(hours => v_hours), v_window.starts_at);
    IF v_expires <= v_hold.expires_at THEN
      RAISE EXCEPTION 'offer_hold_not_extendable' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.stay_inventory_holds SET expires_at = v_expires, version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    UPDATE public.stay_reservation_groups SET payment_deadline = v_expires, version = version + 1, updated_at = now()
    WHERE id = v_group.id RETURNING * INTO v_group;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_offer_hold_extended', 'staff', p_user_id, 'hold-extended:' || v_key,
      jsonb_build_object('holdUntil', v_expires, 'hours', v_hours));
    v_result := jsonb_build_object('groupId', v_group.id, 'state', v_group.state, 'holdUntil', v_expires,
      'groupVersion', v_group.version);

  ELSE -- release_hold
    IF v_group.state <> 'approved_payment_required' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a
               WHERE a.group_id = v_group.id AND a.state IN ('pending', 'ambiguous', 'succeeded')) THEN
      RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
    END IF;
    v_reason := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
    IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_reservation_groups SET state = 'request_expired', version = version + 1, updated_at = now()
    WHERE id = v_group.id RETURNING * INTO v_group;
    UPDATE public.stay_reservation_lines SET state = 'expired', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id AND state = 'approved_payment_required';
    UPDATE public.stay_inventory_holds SET state = 'released', reason = 'released_by_host', version = version + 1,
      updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_offer_hold_released', 'staff', p_user_id, 'hold-released:' || v_key,
      jsonb_strip_nulls(jsonb_build_object('reason', v_reason)));
    v_result := jsonb_build_object('groupId', v_group.id, 'state', v_group.state, 'groupVersion', v_group.version);
  END IF;

  INSERT INTO public.venue_offer_staff_receipts (scope, idempotency_key, actor_user_id, request_hash, result)
  VALUES (v_scope, v_key, p_user_id, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Block a space (or a combination: every part) for a time range, or unblock.
CREATE OR REPLACE FUNCTION public.issue_4490_manage_block_for(
  p_user_id uuid,
  p_venue_id uuid,
  p_action text,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_scope text := 'block:' || p_venue_id::text;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_spaces uuid[];
  v_combo uuid;
  v_range tstzrange;
  v_claim public.venue_space_claims%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_venue_id IS NULL OR p_action NOT IN ('block', 'unblock')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR char_length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.issue_4490_user_can_manage_bookings(p_venue_id, p_user_id)
          OR public.issue_4490_user_has_venue_capability(p_venue_id, p_user_id, 'venue.manage_offers')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'payload', p_payload)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_staff_receipt(v_scope, p_user_id, v_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF p_action = 'block' THEN
    v_combo := CASE WHEN COALESCE(p_payload->>'combinationId', '') ~ '^[0-9a-f-]{36}$'
                    THEN (p_payload->>'combinationId')::uuid END;
    IF v_combo IS NOT NULL THEN
      SELECT c.space_ids INTO v_spaces FROM public.venue_space_combinations c
      WHERE c.id = v_combo AND c.venue_id = p_venue_id AND c.archived_at IS NULL;
    ELSIF jsonb_typeof(p_payload->'spaceIds') = 'array' THEN
      SELECT array_agg(DISTINCT x::uuid) INTO v_spaces
      FROM jsonb_array_elements_text(p_payload->'spaceIds') x WHERE x ~ '^[0-9a-f-]{36}$';
    END IF;
    IF v_spaces IS NULL OR cardinality(v_spaces) = 0
       OR EXISTS (SELECT 1 FROM unnest(v_spaces) s WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_spaces vs WHERE vs.id = s AND vs.venue_id = p_venue_id AND vs.archived_at IS NULL)) THEN
      RAISE EXCEPTION 'block_spaces_invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_range := tstzrange((p_payload->>'from')::timestamptz, (p_payload->>'to')::timestamptz, '[)');
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'block_range_invalid' USING ERRCODE = '22023';
    END;
    IF v_range IS NULL OR isempty(v_range) OR lower_inf(v_range) OR upper_inf(v_range)
       OR upper(v_range) - lower(v_range) > interval '31 days'
       OR (p_payload ? 'reason' AND char_length(btrim(COALESCE(p_payload->>'reason', ''))) > 200) THEN
      RAISE EXCEPTION 'block_range_invalid' USING ERRCODE = '22023';
    END IF;
    PERFORM public.issue_4490_release_lapsed_claims(v_spaces);
    BEGIN
      WITH ins AS (
        INSERT INTO public.venue_space_claims (
          space_id, source, via_combination_id, booked_range, claim_range, state, block_reason, created_by
        )
        SELECT s, 'block', v_combo, v_range, v_range, 'committed',
               NULLIF(btrim(COALESCE(p_payload->>'reason', '')), ''), p_user_id
        FROM unnest(v_spaces) s ORDER BY s
        RETURNING id
      )
      SELECT array_agg(id) INTO v_ids FROM ins;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
    END;
    v_result := jsonb_build_object('claimIds', to_jsonb(v_ids), 'from', lower(v_range), 'to', upper(v_range));
  ELSE
    SELECT * INTO v_claim FROM public.venue_space_claims c
    WHERE c.id = CASE WHEN COALESCE(p_payload->>'claimId', '') ~ '^[0-9a-f-]{36}$' THEN (p_payload->>'claimId')::uuid END
      AND c.source = 'block'
      AND EXISTS (SELECT 1 FROM public.venue_spaces s WHERE s.id = c.space_id AND s.venue_id = p_venue_id)
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'block_not_found' USING ERRCODE = 'P0002';
    END IF;
    WITH upd AS (
      UPDATE public.venue_space_claims c
      SET state = 'released', released_at = now(), release_reason = 'unblocked', updated_at = now()
      WHERE c.source = 'block' AND c.state = 'committed'
        AND c.booked_range = v_claim.booked_range AND c.created_at = v_claim.created_at
        AND c.via_combination_id IS NOT DISTINCT FROM v_claim.via_combination_id
        AND (c.id = v_claim.id OR v_claim.via_combination_id IS NOT NULL)
      RETURNING c.id
    )
    SELECT array_agg(id) INTO v_ids FROM upd;
    v_result := jsonb_build_object('released', to_jsonb(COALESCE(v_ids, '{}'::uuid[])));
  END IF;
  INSERT INTO public.venue_offer_staff_receipts (scope, idempotency_key, actor_user_id, request_hash, result)
  VALUES (v_scope, v_key, p_user_id, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- The guest withdraws a request (or an approved hold not yet paid). Booking
-- token or the booking's own signed-in buyer only.
CREATE OR REPLACE FUNCTION public.issue_4490_withdraw_request(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_reservation_events e
             WHERE e.group_id = v_group.id AND e.event_type = 'stay_offer_request_withdrawn') THEN
    RETURN public.issue_4490_booking_projection(v_group.id, NULL) || jsonb_build_object('replayed', true);
  END IF;
  IF v_group.state NOT IN ('request_pending', 'approved_payment_required') THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a
             WHERE a.group_id = v_group.id AND a.state IN ('pending', 'ambiguous', 'succeeded')) THEN
    RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_reservation_groups
  SET state = CASE WHEN state = 'request_pending' THEN 'request_expired' ELSE 'cancelled' END,
      version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_reservation_lines
  SET state = CASE WHEN state = 'request_pending' THEN 'expired' ELSE 'cancelled' END,
      version = version + 1, updated_at = now()
  WHERE group_id = v_group.id AND state IN ('request_pending', 'approved_payment_required');
  UPDATE public.stay_inventory_holds SET state = 'released', reason = 'withdrawn', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id AND state = 'active';
  UPDATE public.venue_request_queue SET released_at = COALESCE(released_at, now()) WHERE group_id = v_group.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_offer_request_withdrawn', 'guest', p_user_id, 'request-withdrawn:' || v_group.id,
    jsonb_build_object('priorState', v_group.state));
  RETURN public.issue_4490_booking_projection(v_group.id, NULL) || jsonb_build_object('replayed', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 15. Reads: the booking (hire details, what is due now while on hold), the
--     Host's requests list and calendar, Admin's dispute view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_closed_reason(p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN g.state = 'declined' THEN 'declined'
    WHEN g.state = 'reconciliation_required' THEN 'needs_checking'
    WHEN EXISTS (SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id = g.id
                 AND e.event_type = 'stay_offer_request_withdrawn') THEN 'withdrawn'
    WHEN EXISTS (SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id = g.id
                 AND e.event_type = 'stay_offer_hold_released') THEN 'released'
    WHEN EXISTS (SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id = g.id
                 AND e.event_type = 'stay_offer_hold_force_expired') THEN 'expired'
    WHEN g.state = 'request_expired' AND EXISTS (
      SELECT 1 FROM public.stay_reservation_events e WHERE e.group_id = g.id
        AND e.event_type = 'stay_request_expired' AND e.safe_metadata->>'priorState' = 'approved_payment_required')
      THEN 'not_paid'
    WHEN g.state = 'request_expired' THEN 'expired'
    WHEN g.state = 'cancelled' THEN 'cancelled'
    ELSE NULL END
  FROM public.stay_reservation_groups g WHERE g.id = p_group_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hire_booking_facts(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN g.offer_kind <> 'private_hire' THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'placeName', l.price_snapshot->>'placeName',
    'spaceIds', l.price_snapshot->'spaceIds',
    'combinationId', l.price_snapshot->'combinationId',
    'sessionLabel', l.offering_snapshot->>'sessionLabel',
    'bookedFrom', q.inventory_snapshot->>'bookedFrom',
    'bookedTo', q.inventory_snapshot->>'bookedTo',
    'setupFrom', q.inventory_snapshot->>'claimFrom',
    'cleanupUntil', q.inventory_snapshot->>'claimTo',
    'guests', COALESCE((l.price_snapshot->>'guests')::integer, l.place_guests),
    'hireMinor', (l.price_snapshot->>'packageMinor')::bigint,
    'extraGuests', (l.price_snapshot->>'extraGuests')::integer,
    'extraGuestMinor', (l.price_snapshot->>'extraGuestMinor')::bigint,
    'overtimeHours', (l.price_snapshot->>'overtimeHours')::integer,
    'overtimeMinor', (l.price_snapshot->>'overtimeMinor')::bigint,
    'hireCharge', l.price_snapshot->>'hireCharge',
    'minSpendMinor', (g.payment_plan_snapshot->>'minSpendMinor')::bigint,
    'damageDepositMinor', COALESCE((g.payment_plan_snapshot->>'damageDepositMinor')::bigint, 0),
    'occasion', g.booking_answers->>'occasion',
    'note', g.booking_answers->>'note',
    'siteVisit', (g.booking_answers->>'siteVisit')::boolean,
    'replyWithinHours', (g.payment_plan_snapshot->>'requestResponseHours')::integer,
    'declineReason', (SELECT e.safe_metadata->>'reason' FROM public.stay_reservation_events e
                      WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_declined'
                      ORDER BY e.created_at DESC LIMIT 1),
    'alternatives', (SELECT e.safe_metadata->'alternatives' FROM public.stay_reservation_events e
                     WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_declined'
                     ORDER BY e.created_at DESC LIMIT 1),
    'hostNote', (SELECT e.safe_metadata->>'note' FROM public.stay_reservation_events e
                 WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_approved'
                 ORDER BY e.created_at DESC LIMIT 1),
    'closedReason', public.issue_4490_closed_reason(g.id)
  )) END
  FROM public.stay_reservation_groups g
  JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
  LEFT JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
  WHERE g.id = p_group_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_booking_projection(p_group_id uuid, p_qr_pepper text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'groupId', g.id,
    'reference', g.public_reference,
    'offerKind', g.offer_kind,
    'state', g.state,
    'version', g.version,
    'bookingSource', g.booking_source,
    'paymentCollection', g.payment_collection,
    'currencyCode', g.currency_code,
    'subtotalMinor', g.source_subtotal_minor,
    'feeMinor', g.fee_total_minor,
    'taxMinor', g.tax_total_minor,
    'totalMinor', g.total_minor,
    'paidMinor', COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
                           WHERE a.group_id = g.id AND a.state = 'succeeded'), 0),
    'refundedMinor', COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                               WHERE r.group_id = g.id AND r.state IN ('submitted', 'processing', 'succeeded')), 0),
    'balanceDueMinor', money.balance,
    -- #4490 P4: while an approved hire is on hold, what is due now is the
    -- deposit (or everything when no deposit applies).
    'amountDueNowMinor', CASE
      WHEN g.state = 'instant_payment_pending' AND g.payment_collection = 'mingla' THEN g.total_minor
      WHEN g.state = 'approved_payment_required' AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now() THEN g.deposit_minor ELSE money.total_due END
      ELSE money.balance END,
    'holdUntil', (SELECT h.expires_at FROM public.stay_inventory_holds h
                  WHERE h.group_id = g.id AND h.state = 'active'),
    'guest', jsonb_build_object(
      'name', g.guest_snapshot->>'name',
      'email', g.guest_snapshot->>'email',
      'phone', g.guest_snapshot->>'phone'),
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug,
                'brandSlug', b.slug, 'brandName', b.name, 'address', v.address, 'city', v.city,
                'lat', v.lat, 'lng', v.lng, 'timezone', public.issue_4490_venue_timezone(v.id))
              FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = g.venue_id),
    'offer', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style)
              FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
              WHERE l.group_id = g.id ORDER BY l.created_at, l.id LIMIT 1),
    'window', (SELECT jsonb_build_object('windowId', w.id, 'localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
               FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id, 'state', l.state, 'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName', 'guests', public.issue_4490_line_guests(l.id),
        'bookedGuests', l.place_guests, 'unit', l.price_snapshot->>'unit',
        'packageMinor', (l.price_snapshot->>'packageMinor')::bigint,
        'extrasMinor', (l.price_snapshot->>'extrasMinor')::bigint,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor, 'taxMinor', l.tax_minor, 'feeMinor', l.fee_minor, 'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel')
        ORDER BY COALESCE((l.price_snapshot->>'sortOrder')::integer, 0), l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = g.id), '[]'::jsonb),
    'policy', jsonb_build_object(
      'text', g.payment_plan_snapshot->>'policyText',
      'refundLadder', g.payment_plan_snapshot->'refundLadder',
      'dateChangeRule', g.payment_plan_snapshot->'dateChangeRule'),
    'vatMode', g.payment_plan_snapshot->>'vatMode',
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'passId', p.id, 'status', p.status, 'admits', p.admits, 'admittedCount', p.admitted_count,
        'validLocalDate', p.valid_local_date, 'validFrom', p.valid_from, 'validTo', p.valid_to,
        'holderName', p.holder_name, 'idCheckLabel', p.id_check_label, 'idCheckCount', p.id_check_count,
        'qrPayload', CASE WHEN p_qr_pepper IS NOT NULL AND p.status = 'valid'
                          THEN public.issue_4490_pass_qr_payload(p.id, p.qr_token_hash, p_qr_pepper) END)
        ORDER BY p.created_at)
      FROM public.venue_passes p WHERE p.group_id = g.id), '[]'::jsonb),
    'createdAt', g.created_at,
    'updatedAt', g.updated_at
  ) || jsonb_build_object(
    'totalDueMinor', money.total_due,
    'paidOnlineMinor', money.paid_online,
    'paidAtVenueMinor', money.paid_offline,
    'changesMinor', money.changes_minor,
    'depositMinor', g.deposit_minor,
    'balanceDueAt', g.balance_due_at,
    'payModes', CASE
      WHEN g.state IN ('instant_payment_pending', 'approved_payment_required') AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now()
             THEN jsonb_build_array(
               jsonb_build_object('mode', 'deposit', 'amountMinor', g.deposit_minor),
               jsonb_build_object('mode', 'full', 'amountMinor', money.total_due))
             ELSE jsonb_build_array(jsonb_build_object('mode', 'full', 'amountMinor', money.total_due)) END
      ELSE '[]'::jsonb END,
    'extras', COALESCE((
      SELECT jsonb_agg(x ORDER BY ord)
      FROM (
        SELECT x, 1 AS ord FROM public.stay_reservation_lines l, jsonb_array_elements(COALESCE(l.price_snapshot->'extras', '[]'::jsonb)) x
        WHERE l.group_id = g.id
        UNION ALL
        SELECT x || jsonb_build_object('addedAt', a.created_at), 2 FROM public.venue_booking_amendments a,
          jsonb_array_elements(a.extras) x
        WHERE a.group_id = g.id AND a.kind = 'add_extras'
      ) all_extras), '[]'::jsonb),
    'answers', g.booking_answers,
    'inclusions', (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'kind', COALESCE(i->>'kind', 'item'), 'label', i->>'label', 'qtyPer', i->>'qty_per',
          'staffRatio', (i->>'staff_ratio')::integer)) ORDER BY ord), '[]'::jsonb)
        FROM public.stay_reservation_lines l
        JOIN public.stay_offerings o ON o.id = l.offering_id,
        jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)
        WHERE l.id = (SELECT l2.id FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                      ORDER BY l2.created_at, l2.id LIMIT 1)),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'changeId', a.id, 'kind', a.kind, 'fromGuests', a.from_guests, 'toGuests', a.to_guests,
        'fromDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.from_window_id),
        'toDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.to_window_id),
        'extras', CASE WHEN jsonb_array_length(a.extras) > 0 THEN a.extras END,
        'amountMinor', a.price_delta_minor + a.fee_delta_minor + a.tax_delta_minor + a.policy_fee_minor,
        'feeMinor', a.policy_fee_minor, 'refundMinor', a.refund_minor, 'by', a.actor_type,
        'createdAt', a.created_at)) ORDER BY a.created_at)
      FROM public.venue_booking_amendments a WHERE a.group_id = g.id), '[]'::jsonb),
    'changeRules', public.issue_4490_change_rules(g.id),
    'requestDeadline', g.request_deadline,
    'paymentDeadline', g.payment_deadline,
    'hire', public.issue_4490_hire_booking_facts(g.id)
  )
  FROM public.stay_reservation_groups g
  CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) money
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
$function$;

-- Change rules: a private hire's day and party size are changed with the
-- venue (not by the guest online, and not through a booking change: moving
-- a hire moves its space claims, which the first build does not do).
CREATE OR REPLACE FUNCTION public.issue_4490_change_rules(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (
    SELECT g.*, g.payment_plan_snapshot->'dateChangeRule' AS rule,
      (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)) AS starts_at,
      COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id), 0) AS admitted,
      (SELECT count(*) FROM public.venue_booking_amendments a WHERE a.group_id = g.id AND a.kind = 'move_date') AS moves
    FROM public.stay_reservation_groups g WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL
  ), r AS (
    SELECT g.*,
      CASE WHEN g.rule ? 'allowed_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'allowed_until_minutes_before')::integer) END AS move_until,
      CASE WHEN g.rule ? 'guest_change_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'guest_change_until_minutes_before')::integer)
           WHEN g.rule ? 'allowed_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'allowed_until_minutes_before')::integer) END AS guests_until
    FROM g
  )
  SELECT jsonb_build_object(
    'moveUntil', r.move_until,
    'guestChangeUntil', r.guests_until,
    'maxChanges', (r.rule->>'max_changes')::integer,
    'changesUsed', r.moves,
    'feeBps', COALESCE((r.rule->>'fee_bps')::integer, 0),
    'canMove', r.offer_kind <> 'private_hire'
               AND r.state = 'confirmed' AND r.admitted = 0 AND r.move_until IS NOT NULL AND now() < r.move_until
               AND (r.rule->>'max_changes' IS NULL OR r.moves < (r.rule->>'max_changes')::integer),
    'canChangeGuests', r.offer_kind <> 'private_hire'
                       AND r.state = 'confirmed' AND r.guests_until IS NOT NULL AND now() < r.guests_until,
    'canAddExtras', r.state = 'confirmed' AND r.guests_until IS NOT NULL AND now() < r.guests_until
                    AND EXISTS (SELECT 1 FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
                                WHERE l.group_id = r.id AND jsonb_array_length(o.extras) > 0))
  FROM r;
$function$;

-- Amendment rail: a private hire cannot change guests or day through a
-- booking change (staff included); quote edits and extras are fine.
CREATE OR REPLACE FUNCTION public.issue_4490_guard_booking_money_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_groups g WHERE g.id = NEW.group_id AND g.offer_kind IS NOT NULL
  ) OR current_setting('mingla.issue_4490_booking_change', true) IS DISTINCT FROM NEW.group_id::text THEN
    RAISE EXCEPTION 'offer_rail_required' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'venue_booking_amendments' THEN
    IF to_jsonb(NEW)->>'kind' IN ('change_guests', 'move_date')
       AND EXISTS (SELECT 1 FROM public.stay_reservation_groups g
                   WHERE g.id = NEW.group_id AND g.offer_kind = 'private_hire') THEN
      RAISE EXCEPTION 'offer_change_not_allowed' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Requests (Host): To answer · Waiting for deposit · Confirmed · Closed, and
-- money due. Rows carry the place, the day, the clock and the queue.
CREATE OR REPLACE FUNCTION public.issue_4490_requests_list(p_venue_id uuid, p_filter text DEFAULT 'to_answer')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_filter, '') NOT IN ('to_answer', 'waiting_for_deposit', 'confirmed', 'closed', 'money_due', 'all') THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH base AS (
      SELECT g.*,
        CASE
          WHEN g.state = 'request_pending' THEN 'to_answer'
          WHEN g.state IN ('approved_payment_required', 'finalizing', 'instant_payment_pending') THEN 'waiting_for_deposit'
          WHEN g.state IN ('confirmed', 'partially_cancelled') THEN 'confirmed'
          ELSE 'closed' END AS tab,
        m.balance, m.total_due, m.net_paid,
        l.id AS line_id, l.price_snapshot, l.offering_snapshot, l.place_window_id,
        q.inventory_snapshot
      FROM public.stay_reservation_groups g
      CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
      JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                    ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
      LEFT JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL
        AND (g.mode = 'request' OR g.offer_kind = 'private_hire')
    ), rows AS (
      SELECT b.*, w.local_date, w.starts_at, w.ends_at FROM base b
      JOIN public.stay_place_windows w ON w.id = b.place_window_id
      WHERE p_filter = 'all' OR b.tab = p_filter OR (p_filter = 'money_due' AND b.tab = 'confirmed' AND b.balance > 0)
    )
    SELECT jsonb_build_object(
      'venueId', p_venue_id,
      'filter', p_filter,
      'counts', (SELECT jsonb_build_object(
          'toAnswer', count(*) FILTER (WHERE tab = 'to_answer'),
          'waitingForDeposit', count(*) FILTER (WHERE tab = 'waiting_for_deposit'),
          'confirmed', count(*) FILTER (WHERE tab = 'confirmed'),
          'closed', count(*) FILTER (WHERE tab = 'closed'),
          'moneyDue', count(*) FILTER (WHERE tab = 'confirmed' AND balance > 0)) FROM base),
      'requests', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'groupId', r.id, 'reference', r.public_reference, 'state', r.state, 'tab', r.tab,
          'version', r.version, 'offerKind', r.offer_kind, 'offerName', r.offering_snapshot->>'name',
          'guestName', r.guest_snapshot->>'name', 'guestEmail', r.guest_snapshot->>'email',
          'guestPhone', r.guest_snapshot->>'phone',
          'guests', COALESCE((r.price_snapshot->>'guests')::integer, public.issue_4490_line_guests(r.line_id)),
          'placeName', r.price_snapshot->>'placeName', 'spaceIds', r.price_snapshot->'spaceIds',
          'sessionLabel', r.offering_snapshot->>'sessionLabel',
          'localDate', r.local_date, 'startsAt', r.starts_at, 'endsAt', r.ends_at,
          'setupFrom', r.inventory_snapshot->>'claimFrom', 'cleanupUntil', r.inventory_snapshot->>'claimTo',
          'requestedAt', r.created_at, 'replyBy', r.request_deadline, 'holdUntil', r.payment_deadline,
          'currencyCode', r.currency_code, 'totalDueMinor', r.total_due, 'depositMinor', r.deposit_minor,
          'paidMinor', r.net_paid, 'balanceMinor', r.balance, 'balanceDueAt', r.balance_due_at,
          'occasion', r.booking_answers->>'occasion', 'note', r.booking_answers->>'note',
          'siteVisit', (r.booking_answers->>'siteVisit')::boolean,
          'closedReason', CASE WHEN r.tab = 'closed' THEN public.issue_4490_closed_reason(r.id) END,
          'declineReason', CASE WHEN r.state = 'declined' THEN (
            SELECT e.safe_metadata->>'reason' FROM public.stay_reservation_events e
            WHERE e.group_id = r.id AND e.event_type = 'stay_offer_request_declined' ORDER BY e.created_at DESC LIMIT 1) END,
          'placeStatus', CASE WHEN r.state = 'request_pending' AND r.inventory_snapshot ? 'claimFrom' THEN (
            SELECT s.status FROM public.issue_4490_spaces_status(
              ARRAY(SELECT jsonb_array_elements_text(r.price_snapshot->'spaceIds')::uuid),
              tstzrange((r.inventory_snapshot->>'claimFrom')::timestamptz, (r.inventory_snapshot->>'claimTo')::timestamptz, '[)'),
              r.id) s) END,
          'queue', (SELECT jsonb_strip_nulls(jsonb_build_object(
              'position', (SELECT count(*) FROM public.venue_request_queue q2
                           WHERE q2.blocked_by_group_id = q.blocked_by_group_id AND q2.released_at IS NULL
                             AND q2.queued_at <= q.queued_at),
              'blockedByGroupId', q.blocked_by_group_id,
              'blockedByReference', bg.public_reference,
              'blockedByGuestName', bg.guest_snapshot->>'name',
              'blockedByHoldUntil', bg.payment_deadline,
              'queuedAt', q.queued_at, 'releasedAt', q.released_at))
            FROM public.venue_request_queue q
            LEFT JOIN public.stay_reservation_groups bg ON bg.id = q.blocked_by_group_id
            WHERE q.group_id = r.id),
          'nextInLine', EXISTS (SELECT 1 FROM public.venue_request_queue q
                                WHERE q.group_id = r.id AND q.released_at IS NOT NULL AND r.state = 'request_pending'),
          'waitingBehind', (SELECT count(*) FROM public.venue_request_queue q
                            WHERE q.blocked_by_group_id = r.id AND q.released_at IS NULL),
          'nextInLineGuest', (SELECT g2.guest_snapshot->>'name' FROM public.venue_request_queue q
                              JOIN public.stay_reservation_groups g2 ON g2.id = q.group_id
                              WHERE q.blocked_by_group_id = r.id AND q.released_at IS NULL
                              ORDER BY q.queued_at LIMIT 1)
        )) ORDER BY CASE WHEN r.tab = 'to_answer' THEN r.request_deadline ELSE r.starts_at END, r.id)
        FROM rows r), '[]'::jsonb)
    )
  );
END;
$function$;

-- Calendar (Host): spaces down, days across; claims (hires, holds, events,
-- blocks) with setup and cleanup, parts blocked by a combination, open
-- requests that would collide, each day's entry limit after the hire cut,
-- special hours, events at the venue and group bookings.
CREATE OR REPLACE FUNCTION public.issue_4490_venue_calendar(p_venue_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_range tstzrange;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'calendar_range_invalid' USING ERRCODE = '22023';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_range := tstzrange(p_from::timestamp AT TIME ZONE v_tz, (p_to + 1)::timestamp AT TIME ZONE v_tz, '[)');
  RETURN jsonb_build_object(
    'venueId', p_venue_id, 'from', p_from, 'to', p_to, 'timezone', v_tz,
    'spaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'setting', s.setting,
        'capacity', public.issue_4490_space_capacity(s.id), 'canBeHired', s.can_be_hired, 'sortOrder', s.sort_order)
        ORDER BY s.sort_order, s.name)
      FROM public.venue_spaces s WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL), '[]'::jsonb),
    'combinations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'spaceIds', to_jsonb(c.space_ids)) ORDER BY c.name)
      FROM public.venue_space_combinations c WHERE c.venue_id = p_venue_id AND c.archived_at IS NULL), '[]'::jsonb),
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'claimId', c.id, 'spaceId', c.space_id, 'source', c.source, 'state', c.state,
        'kind', CASE WHEN c.source = 'event' THEN 'event' WHEN c.source = 'block' THEN 'block'
                     WHEN c.state = 'held' THEN 'hold' ELSE 'hire' END,
        'viaCombinationId', c.via_combination_id,
        'viaCombinationName', (SELECT vc.name FROM public.venue_space_combinations vc WHERE vc.id = c.via_combination_id),
        'bookedFrom', lower(c.booked_range), 'bookedTo', upper(c.booked_range),
        'claimFrom', lower(c.claim_range), 'claimTo', upper(c.claim_range),
        'holdUntil', c.held_until,
        'groupId', c.group_id, 'reference', g.public_reference, 'groupState', g.state,
        'guestName', g.guest_snapshot->>'name',
        'offerName', l.offering_snapshot->>'name', 'sessionLabel', l.offering_snapshot->>'sessionLabel',
        'guests', (l.price_snapshot->>'guests')::integer,
        'eventId', c.event_id, 'eventTitle', e.title, 'blockReason', c.block_reason))
        ORDER BY lower(c.claim_range), c.space_id)
      FROM public.venue_space_claims c
      JOIN public.venue_spaces s ON s.id = c.space_id AND s.venue_id = p_venue_id
      LEFT JOIN public.stay_reservation_groups g ON g.id = c.group_id
      LEFT JOIN public.stay_reservation_lines l ON l.id = c.reservation_line_id
      LEFT JOIN public.events e ON e.id = c.event_id
      WHERE c.claim_range && v_range
        AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))), '[]'::jsonb),
    -- A combination is blocked while any part is in use ("Blocked by The Lounge Side").
    'combinationBlocks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('combinationId', vc.id, 'claimId', c.id,
        'blockedBy', COALESCE((SELECT x.name FROM public.venue_space_combinations x WHERE x.id = c.via_combination_id), s.name),
        'from', lower(c.claim_range), 'to', upper(c.claim_range), 'state', c.state) ORDER BY vc.name, lower(c.claim_range))
      FROM public.venue_space_combinations vc
      JOIN public.venue_space_claims c ON c.space_id = ANY(vc.space_ids)
      JOIN public.venue_spaces s ON s.id = c.space_id
      WHERE vc.venue_id = p_venue_id AND vc.archived_at IS NULL
        AND c.claim_range && v_range AND c.via_combination_id IS DISTINCT FROM vc.id
        AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', g.id, 'reference', g.public_reference, 'guestName', g.guest_snapshot->>'name',
        'spaceIds', l.price_snapshot->'spaceIds', 'placeName', l.price_snapshot->>'placeName',
        'bookedFrom', q.inventory_snapshot->>'bookedFrom', 'bookedTo', q.inventory_snapshot->>'bookedTo',
        'replyBy', g.request_deadline,
        'collides', (SELECT s.status FROM public.issue_4490_spaces_status(
            ARRAY(SELECT jsonb_array_elements_text(l.price_snapshot->'spaceIds')::uuid),
            tstzrange((q.inventory_snapshot->>'claimFrom')::timestamptz, (q.inventory_snapshot->>'claimTo')::timestamptz, '[)'),
            g.id) s) <> 'free')
        ORDER BY q.inventory_snapshot->>'bookedFrom')
      FROM public.stay_reservation_groups g
      JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                    ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
      JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
      WHERE g.venue_id = p_venue_id AND g.state = 'request_pending' AND g.offer_kind = 'private_hire'
        AND tstzrange((q.inventory_snapshot->>'bookedFrom')::timestamptz, (q.inventory_snapshot->>'bookedTo')::timestamptz, '[)')
            && v_range), '[]'::jsonb),
    'days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'localDate', d.d,
        'closed', public.issue_4490_day_closed(p_venue_id, d.d),
        'specialHours', (SELECT jsonb_build_object('isClosed', sh.is_closed, 'label', sh.label, 'windows', sh.windows)
                         FROM public.venue_special_hours sh WHERE sh.venue_id = p_venue_id AND sh.local_date = d.d),
        'pools', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('poolId', p.id, 'name', p.name,
            'dailyLimit', COALESCE((SELECT ov.daily_limit FROM public.venue_capacity_overrides ov
                                    WHERE ov.pool_id = p.id AND ov.local_date = d.d), p.daily_limit),
            'limitEffective', u.limit_effective, 'hireCut', u.hire_cut, 'venueHired', u.venue_hired,
            'sold', u.used, 'closed', u.closed) ORDER BY p.created_at)
          FROM public.venue_capacity_pools p
          CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, d.d) u
          WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
        'groups', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('groupId', g.id, 'reference', g.public_reference, 'state', g.state,
            'offerName', l.offering_snapshot->>'name', 'guestName', g.guest_snapshot->>'name',
            'guests', public.issue_4490_line_guests(l.id), 'startsAt', w.starts_at, 'endsAt', w.ends_at)
            ORDER BY w.starts_at)
          FROM public.stay_reservation_groups g
          JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                        ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
          JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
          WHERE g.venue_id = p_venue_id AND g.offer_kind = 'group_package' AND w.local_date = d.d
            AND g.state IN ('confirmed', 'partially_cancelled', 'instant_payment_pending')), '[]'::jsonb)
      ) ORDER BY d.d)
      FROM (SELECT generate_series(p_from, p_to, interval '1 day')::date AS d) d), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('eventId', e.id, 'title', e.title, 'spaceId', e.space_id,
        'spaceUse', e.space_use, 'status', e.status, 'startsAt', ed.start_at, 'endsAt', ed.end_at) ORDER BY ed.start_at)
      FROM public.events e JOIN public.event_dates ed ON ed.event_id = e.id
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
        AND tstzrange(ed.start_at, ed.end_at, '[)') && v_range), '[]'::jsonb)
  );
END;
$function$;

-- Admin: the dispute view of one venue booking (timeline, money, policy
-- snapshot, space claims), and force-expire a hold with a reason (audited).
CREATE OR REPLACE FUNCTION public.issue_4490_admin_booking(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stay_reservation_groups g WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_4490_booking_projection(p_group_id, NULL) || jsonb_build_object(
    'policySnapshot', (SELECT g.payment_plan_snapshot FROM public.stay_reservation_groups g WHERE g.id = p_group_id),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('type', e.event_type, 'actorType', e.actor_type, 'at', e.created_at,
        'details', e.safe_metadata - ARRAY['email', 'phone', 'token']) ORDER BY e.created_at, e.id)
      FROM public.stay_reservation_events e WHERE e.group_id = p_group_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('attemptId', a.id, 'stage', a.stage, 'state', a.state,
        'amountMinor', a.amount_minor, 'provider', a.provider, 'at', a.created_at) ORDER BY a.attempt_ordinal)
      FROM public.stay_payment_attempts a WHERE a.group_id = p_group_id), '[]'::jsonb),
    'refunds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('refundId', r.id, 'state', r.state, 'amountMinor', r.amount_minor,
        'at', r.created_at) ORDER BY r.created_at)
      FROM public.stay_refunds r WHERE r.group_id = p_group_id), '[]'::jsonb),
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('claimId', c.id, 'spaceName', s.name, 'state', c.state,
        'from', lower(c.claim_range), 'to', upper(c.claim_range), 'heldUntil', c.held_until,
        'releaseReason', c.release_reason) ORDER BY c.created_at)
      FROM public.venue_space_claims c JOIN public.venue_spaces s ON s.id = c.space_id
      WHERE c.group_id = p_group_id), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_admin_force_expire_hold(p_group_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.state NOT IN ('request_pending', 'approved_payment_required') THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a
             WHERE a.group_id = v_group.id AND a.state IN ('pending', 'ambiguous', 'succeeded')) THEN
    RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_reservation_groups SET state = 'request_expired', version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_reservation_lines SET state = 'expired', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id AND state IN ('request_pending', 'approved_payment_required');
  UPDATE public.stay_inventory_holds SET state = 'expired', reason = 'admin_force_expire', version = version + 1,
    updated_at = now()
  WHERE group_id = v_group.id AND state = 'active';
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_offer_hold_force_expired', 'admin', auth.uid(), 'admin-force-expire:' || v_group.id,
    jsonb_build_object('reason', btrim(p_reason), 'priorState', v_group.state));
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata, actor_uid, reason)
  SELECT u.email, 'venue_hold_force_expire', 'stay_reservation_group', v_group.id::text,
         jsonb_build_object('priorState', v_group.state), auth.uid(), btrim(p_reason)
  FROM auth.users u WHERE u.id = auth.uid();
  RETURN public.issue_4490_admin_booking(v_group.id);
END;
$function$;

-- The two change entry points say plainly that a hire's day or party size
-- is changed with the venue (before any capacity maths).
CREATE OR REPLACE FUNCTION public.issue_4490_change_booking(
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_expected_version bigint DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
  v_kind text;
BEGIN
  SELECT g.venue_id, g.offer_kind INTO v_venue, v_kind FROM public.stay_reservation_groups g
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
  IF auth.uid() IS NULL OR v_venue IS NULL
     OR NOT public.issue_4490_can_manage_venue(v_venue, 'venue.manage_bookings') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'private_hire' AND p_action IN ('change_guests', 'move_date') THEN
    RAISE EXCEPTION 'offer_change_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.issue_4490_change_booking_internal(p_group_id, p_action, p_payload, COALESCE(p_preview, true),
    'staff', auth.uid(), NULL, p_expected_version, p_idempotency_key);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_change_booking(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.offer_kind = 'private_hire' AND p_action IN ('change_guests', 'move_date') THEN
    RAISE EXCEPTION 'offer_change_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.issue_4490_change_booking_internal(p_group_id, p_action, p_payload, COALESCE(p_preview, true),
    'guest', p_user_id, p_token_hash, p_expected_version, p_idempotency_key);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 16. Notifications: request sent (guest) and to answer (host), approved
--     (pay the deposit), hold expiring, declined, expired / released, next in
--     line (host). Guest links are built at send time from the booking id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_enqueue_offer_event(
  p_event public.stay_reservation_events,
  p_group public.stay_reservation_groups
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_category text;
  v_host_category text;
  v_email text;
  v_payload jsonb;
  v_recipient record;
BEGIN
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RETURN;
  END IF;
  v_category := CASE p_event.event_type
    WHEN 'stay_reservation_confirmed' THEN 'venue_booking_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'venue_booking_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'venue_refund_state'
    WHEN 'stay_offer_balance_due' THEN 'venue_balance_due'
    WHEN 'stay_offer_balance_overdue' THEN 'venue_balance_overdue'
    WHEN 'stay_offer_changed' THEN 'venue_booking_changed'
    WHEN 'stay_offer_balance_paid' THEN 'venue_balance_paid'
    WHEN 'stay_offer_paid_at_venue' THEN 'venue_balance_paid'
    -- #4490 P4: requests and holds.
    WHEN 'stay_offer_request_sent' THEN 'venue_request_received'
    WHEN 'stay_offer_request_approved' THEN 'venue_payment_required'
    WHEN 'stay_offer_hold_expiring' THEN 'venue_hold_expiring'
    WHEN 'stay_offer_request_declined' THEN 'venue_request_declined'
    WHEN 'stay_request_expired' THEN 'venue_request_expired'
    WHEN 'stay_offer_hold_released' THEN 'venue_request_expired'
    WHEN 'stay_offer_hold_force_expired' THEN 'venue_request_expired'
    ELSE NULL END;
  v_host_category := CASE p_event.event_type
    WHEN 'stay_offer_request_sent' THEN 'venue_request_action_needed'
    WHEN 'stay_offer_queue_released' THEN 'venue_request_action_needed'
    ELSE NULL END;
  IF (v_category IS NULL AND v_host_category IS NULL) OR p_group.payment_collection <> 'mingla' THEN
    RETURN;
  END IF;
  v_payload := jsonb_build_object(
      'venue_group_id', p_group.id,
      'public_reference', p_group.public_reference,
      'venue_id', p_group.venue_id,
      'offer_kind', p_group.offer_kind,
      'amount_cents', COALESCE((p_event.safe_metadata->>'amountMinor')::bigint, p_group.total_minor),
      'currency', p_group.currency_code
    ) || jsonb_strip_nulls(jsonb_build_object(
      'balance_due_at', p_group.balance_due_at,
      'change_action', p_event.safe_metadata->>'action',
      'reminder_reason', COALESCE(p_event.safe_metadata->>'reason',
        CASE p_event.event_type
          WHEN 'stay_offer_hold_released' THEN 'released'
          WHEN 'stay_offer_queue_released' THEN 'next_in_line'
          WHEN 'stay_request_expired' THEN
            CASE WHEN p_event.safe_metadata->>'priorState' = 'approved_payment_required' THEN 'not_paid' ELSE 'no_reply' END
        END),
      'hold_until', COALESCE(p_event.safe_metadata->>'holdUntil', p_event.safe_metadata->>'holdExpiresAt')));
  IF v_category IS NOT NULL THEN
    v_email := NULLIF(lower(btrim(COALESCE(p_group.guest_snapshot->>'email', ''))), '');
    IF v_email IS NOT NULL OR p_group.user_id IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
      ) VALUES (
        v_category, p_group.user_id, v_email, p_group.brand_id, v_payload,
        'venue-offer:' || p_event.id || ':' || v_category || ':guest', NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  IF v_host_category IS NOT NULL THEN
    -- The venue's people who answer requests (no guest link in their copy).
    FOR v_recipient IN
      SELECT DISTINCT r.user_id, lower(u.email) AS email
      FROM (
        SELECT b.account_id AS user_id FROM public.brands b WHERE b.id = p_group.brand_id
        UNION
        SELECT m.user_id FROM public.brand_team_members m
        WHERE m.brand_id = p_group.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
          AND m.role IN ('brand_owner', 'brand_admin', 'event_manager')
        UNION
        SELECT m.user_id FROM public.brand_team_members m
        JOIN public.brand_team_member_venue_grants gr ON gr.member_id = m.id
        WHERE m.brand_id = p_group.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
          AND gr.venue_id = p_group.venue_id AND 'venue.manage_bookings' = ANY(gr.capabilities)
      ) r
      JOIN auth.users u ON u.id = r.user_id
      ORDER BY r.user_id
    LOOP
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
      ) VALUES (
        v_host_category, v_recipient.user_id, v_recipient.email, p_group.brand_id, v_payload,
        'venue-offer:' || p_event.id || ':' || v_host_category || ':user:' || v_recipient.user_id, NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;
  END IF;
END;
$function$;

INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels)
VALUES
  ('venue_request_received', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_request_action_needed', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_payment_required', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_hold_expiring', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_request_declined', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_request_expired', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email'])
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 17. The offer sweep: + "your hold ends soon" 12 hours before an approved
--     hire's pay deadline (once per deadline), + lapsed held claims released
--     (belt and braces: the hold triggers already release them).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_offer_sweep(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_expired jsonb;
  v_row record;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_expiring integer := 0;
  v_lapsed integer := 0;
  v_day integer;
  v_inserted integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Lapsed holds: the generic Stays expiry (offer groups included).
  v_expired := to_jsonb(public.issue_1388_expire_groups(v_limit, gen_random_uuid()));
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'hold_lapsed', updated_at = now()
  WHERE state = 'held' AND held_until <= now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  FOR v_row IN
    SELECT g.id, g.payment_deadline, g.currency_code
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'approved_payment_required'
      AND g.payment_deadline > now()
      AND g.payment_deadline <= now() + interval '12 hours'
    ORDER BY g.payment_deadline
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_hold_expiring', 'service',
      'hold-expiring:' || v_row.id || ':' || floor(extract(epoch FROM v_row.payment_deadline))::bigint,
      jsonb_build_object('holdUntil', v_row.payment_deadline, 'reason', 'hold_expiring')
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_expiring := v_expiring + v_inserted;
  END LOOP;

  FOR v_row IN
    SELECT g.id, g.balance_due_at, g.created_at, g.currency_code, g.venue_id,
           COALESCE(s.balance_reminder_days, '{7,1}'::smallint[]) AS days, m.balance
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'confirmed'
      AND g.balance_due_at IS NOT NULL
      AND g.balance_due_at <= now() + interval '60 days'
      AND g.balance_due_at >= now() - interval '4 days'
      AND m.balance > 0
    ORDER BY g.balance_due_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF now() < v_row.balance_due_at THEN
      SELECT min(d) INTO v_day FROM unnest(v_row.days) d
      WHERE d > 0
        AND now() >= v_row.balance_due_at - make_interval(days => d)
        AND v_row.created_at <= v_row.balance_due_at - make_interval(days => d);
      IF v_day IS NOT NULL THEN
        INSERT INTO public.stay_reservation_events (
          group_id, event_type, actor_type, idempotency_key, safe_metadata
        ) VALUES (
          v_row.id, 'stay_offer_balance_due', 'service', 'balance-reminder:' || v_row.id || ':' || v_day,
          jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
            'balanceDueAt', v_row.balance_due_at, 'reason', 'reminder', 'daysBefore', v_day)
        ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_reminders := v_reminders + v_inserted;
      END IF;
    ELSE
      v_day := CASE WHEN now() >= v_row.balance_due_at + interval '3 days' THEN 3 ELSE 0 END;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, idempotency_key, safe_metadata
      ) VALUES (
        v_row.id, 'stay_offer_balance_overdue', 'service', 'balance-overdue:' || v_row.id || ':' || v_day,
        jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
          'balanceDueAt', v_row.balance_due_at, 'reason', 'overdue', 'daysAfter', v_day)
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_overdue := v_overdue + v_inserted;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('expired', v_expired, 'reminders', v_reminders, 'overdue', v_overdue,
    'holdExpiring', v_expiring, 'lapsedClaims', v_lapsed);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 18. Grants. New functions: nobody by default; Host reads and hire
--     authoring to authenticated (each checks its own authority); the guest's
--     hire options are public like availability; staff actions, guest
--     withdraw and the quote / hold / pay paths to the service role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_hire_default_mode(),
  public.issue_4490_can_view_space(uuid),
  public.issue_4490_space_capacity(uuid),
  public.issue_4490_option_spaces(uuid),
  public.issue_4490_option_capacity(uuid),
  public.issue_4490_option_place_name(uuid),
  public.issue_4490_hire_ranges(uuid, uuid, integer),
  public.issue_4490_release_lapsed_claims(uuid[]),
  public.issue_4490_spaces_status(uuid[], tstzrange, uuid),
  public.issue_4490_claim_spaces(uuid, uuid, uuid, uuid[], uuid, tstzrange, tstzrange, timestamptz),
  public.issue_4490_sync_claims_from_hold(),
  public.issue_4490_sync_claims_from_commitment(),
  public.issue_4490_release_request_queue(),
  public.issue_4490_sync_event_space_claims(uuid),
  public.issue_4490_on_event_space_change(),
  public.issue_4490_pool_day_usage(uuid, date),
  public.issue_4490_assert_hire_capacity(uuid, uuid[], tstzrange),
  public.issue_4490_hire_projection(uuid),
  public.issue_4490_sync_offer_damage(uuid),
  public.issue_4490_manage_hire(text, uuid, jsonb, bigint, text),
  public.issue_4490_on_hire_published(),
  public.pg_venue_hire_options(uuid, uuid, integer),
  public.issue_4490_next_free_dates(uuid, uuid, date, integer),
  public.issue_4490_quote_hire_internal(uuid, uuid, jsonb, text, uuid, text, jsonb, jsonb),
  public.issue_4490_hold_hire_internal(uuid, uuid, jsonb, text, uuid, bytea, text),
  public.issue_4490_user_can_manage_bookings(uuid, uuid),
  public.issue_4490_staff_receipt(text, uuid, text, text),
  public.issue_4490_manage_request_for(uuid, uuid, text, jsonb, bigint, text),
  public.issue_4490_manage_block_for(uuid, uuid, text, jsonb, text),
  public.issue_4490_withdraw_request(uuid, bytea, uuid),
  public.issue_4490_closed_reason(uuid),
  public.issue_4490_hire_booking_facts(uuid),
  public.issue_4490_requests_list(uuid, text),
  public.issue_4490_venue_calendar(uuid, date, date),
  public.issue_4490_admin_booking(uuid),
  public.issue_4490_admin_force_expire_hold(uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pg_venue_hire_options(uuid, uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_can_view_space(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_manage_hire(text, uuid, jsonb, bigint, text),
  public.issue_4490_next_free_dates(uuid, uuid, date, integer),
  public.issue_4490_requests_list(uuid, text),
  public.issue_4490_venue_calendar(uuid, date, date),
  public.issue_4490_admin_booking(uuid),
  public.issue_4490_admin_force_expire_hold(uuid, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_space_capacity(uuid),
  public.issue_4490_option_spaces(uuid),
  public.issue_4490_option_capacity(uuid),
  public.issue_4490_option_place_name(uuid),
  public.issue_4490_hire_ranges(uuid, uuid, integer),
  public.issue_4490_spaces_status(uuid[], tstzrange, uuid),
  public.issue_4490_pool_day_usage(uuid, date),
  public.issue_4490_hire_projection(uuid),
  public.issue_4490_manage_request_for(uuid, uuid, text, jsonb, bigint, text),
  public.issue_4490_manage_block_for(uuid, uuid, text, jsonb, text),
  public.issue_4490_withdraw_request(uuid, bytea, uuid),
  public.issue_4490_closed_reason(uuid),
  public.issue_4490_hire_booking_facts(uuid)
TO service_role;

COMMIT;
