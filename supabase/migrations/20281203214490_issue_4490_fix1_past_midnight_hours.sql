-- #4490 fix round 1 (N52) — opening hours and table service periods that run
-- past midnight.
--
-- Root cause: pg_venue_available_slots turned a period's "HH:MM" bounds into
-- minutes since midnight and generated slots from start to end - turn. A
-- period that closes at 00:00 (end 0) or on the next day (02:00 -> 120) has an
-- end below its start, so the series was empty: a Friday 17:00-00:00 dinner
-- had no slots and a Saturday showed only its 11:00-15:00 brunch. The writer
-- (pg_create_guest_reservation) and the waitlist trigger also bucketed a time
-- by its calendar date, so even a correct 00:30 slot would have been checked
-- against the wrong day; the door ("today" on Check-in and Today, a gate sale,
-- a member check-in) used the calendar date too.
--
-- This file:
--   1. issue_4490_table_service_date(venue, at): the service day of a table
--      time (the evening before when the time sits in the previous day's
--      past-midnight period, from its special-day windows or its weekly
--      service periods), else the local date.
--   2. issue_4490_venue_service_date(venue, at): the same from the opening
--      hours (brand_hours, special days); issue_4490_venue_local_date now
--      returns it, so every door function that reads "today" follows.
--   3. pg_venue_available_slots: a period's end at or before its start runs
--      past midnight (the shared issue_4490_window_bounds rule the hours
--      guard already uses). Slots stay on the day the period starts; the next
--      day never repeats them.
--   4. pg_create_guest_reservation checks the slot on its service day.
--   5. issue_4490_on_table_opened offers a freed table to that service day's
--      waitlist.
--   6. issue_4490_hold_offer_internal: a gate sale sells the service day.
--   7. issue_4490_check_in_list / issue_4490_venue_day default to the service
--      day.
-- Entry, group package, by-the-hour and private hire windows already wrap
-- past midnight in issue_4490_materialize_offer_windows (end <= start -> +1
-- day), so they are unchanged.
--
-- Additive (CREATE OR REPLACE only, same signatures). Static SQL.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Service day of a table time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_table_service_date(p_venue_id uuid, p_at timestamptz)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cfg public.venue_availability_config%ROWTYPE;
  v_tz text;
  v_local timestamp;
  v_yday date;
  v_t time;
  v_special public.venue_special_hours%ROWTYPE;
BEGIN
  IF p_venue_id IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_cfg FROM public.venue_availability_config WHERE venue_id = p_venue_id;
  v_tz := NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;
  v_local := p_at AT TIME ZONE v_tz;
  v_yday := v_local::date - 1;
  v_t := v_local::time;
  SELECT * INTO v_special FROM public.venue_special_hours
  WHERE venue_id = p_venue_id AND local_date = v_yday;
  IF FOUND THEN
    IF NOT v_special.is_closed AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_special.windows) w
      WHERE COALESCE(w->>'open', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND COALESCE(w->>'close', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND (w->>'close')::time <= (w->>'open')::time
        AND v_t < (w->>'close')::time
    ) THEN
      RETURN v_yday;
    END IF;
    RETURN v_local::date;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_cfg.service_periods, '[]'::jsonb)) pr
    WHERE jsonb_typeof(pr) = 'object'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(pr->'days', '[]'::jsonb)) d
                  WHERE d ~ '^[0-6]$' AND d::integer = extract(dow FROM v_yday)::integer)
      AND COALESCE(pr->>'start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND COALESCE(pr->>'end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND (pr->>'end')::time <= (pr->>'start')::time
      AND v_t < (pr->>'end')::time
  ) THEN
    RETURN v_yday;
  END IF;
  RETURN v_local::date;
END;
$function$;
COMMENT ON FUNCTION public.issue_4490_table_service_date(uuid, timestamptz) IS
  '#4490: the service day a table time belongs to: the day before when the time sits in that day''s past-midnight service period (special-day windows replace the weekly periods), else the local date.';

-- ---------------------------------------------------------------------------
-- 2. Service day of the venue (opening hours).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_service_date(p_venue_id uuid, p_at timestamptz)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_local timestamp;
  v_yday date;
  v_t time;
  v_special public.venue_special_hours%ROWTYPE;
BEGIN
  IF p_venue_id IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;
  v_local := p_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id);
  v_yday := v_local::date - 1;
  v_t := v_local::time;
  SELECT * INTO v_special FROM public.venue_special_hours
  WHERE venue_id = p_venue_id AND local_date = v_yday;
  IF FOUND THEN
    IF NOT v_special.is_closed AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_special.windows) w
      WHERE COALESCE(w->>'open', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND COALESCE(w->>'close', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND (w->>'close')::time <= (w->>'open')::time
        AND v_t < (w->>'close')::time
    ) THEN
      RETURN v_yday;
    END IF;
    RETURN v_local::date;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.brand_hours h
    WHERE h.venue_id = p_venue_id
      AND h.weekday = extract(isodow FROM v_yday)::integer - 1
      AND NOT h.is_closed AND h.open_time IS NOT NULL AND h.close_time IS NOT NULL
      AND h.close_time <= h.open_time
      AND v_t < h.close_time
  ) THEN
    RETURN v_yday;
  END IF;
  RETURN v_local::date;
END;
$function$;
COMMENT ON FUNCTION public.issue_4490_venue_service_date(uuid, timestamptz) IS
  '#4490: the venue''s service day at a moment: the day before while that day''s opening window runs past midnight (special days replace weekly hours), else the local date.';

CREATE OR REPLACE FUNCTION public.issue_4490_venue_local_date(p_venue_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_venue_service_date(p_venue_id, now());
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_table_service_date(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4490_venue_service_date(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_table_service_date(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_service_date(uuid, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Table slots: periods that run past midnight (from 20281203164490).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_available_slots(
  p_date       date,
  p_party_size int,
  p_venue_id   uuid DEFAULT NULL,
  p_brand_id   uuid DEFAULT NULL,
  p_space_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  slot_start_utc   timestamptz,
  slot_local_label text,
  remaining        int,
  is_full          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_id      uuid := p_venue_id;
  v_legacy_ids    uuid[];
  v_enabled       boolean;
  v_cfg           public.venue_availability_config%ROWTYPE;
  v_tz            text;
  v_dow           int;
  v_turn_min      int;
  v_buffer_min    int;
  v_gran_min      int;
  v_now           timestamptz := now();
  v_special       public.venue_special_hours%ROWTYPE;
  v_periods       jsonb;
BEGIN
  IF p_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN;
  END IF;

  -- [TRANSITIONAL-1] legacy consumer-binary shim (brand with exactly one venue).
  IF v_venue_id IS NULL THEN
    IF p_brand_id IS NULL THEN
      RETURN;
    END IF;
    SELECT array_agg(v.id) INTO v_legacy_ids
    FROM public.venue_listings v
    WHERE v.brand_id = p_brand_id;
    IF v_legacy_ids IS NULL OR array_length(v_legacy_ids, 1) <> 1 THEN
      RETURN;
    END IF;
    v_venue_id := v_legacy_ids[1];
  END IF;

  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE venue_id = v_venue_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT * INTO v_cfg
  FROM public.venue_availability_config
  WHERE venue_id = v_venue_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_special
  FROM public.venue_special_hours
  WHERE venue_id = v_venue_id AND local_date = p_date;
  IF FOUND AND v_special.is_closed THEN
    RETURN;
  END IF;

  v_buffer_min := COALESCE(v_cfg.buffer_minutes, 0);
  v_gran_min   := COALESCE(v_cfg.slot_granularity_minutes, 15);
  IF v_gran_min < 1 THEN
    v_gran_min := 15;
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  v_turn_min := public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, p_party_size);

  IF EXISTS (
    SELECT 1 FROM public.venue_blackouts b
    WHERE b.venue_id = v_venue_id
      AND b.applies_to = 'all'
      AND p_date BETWEEN b.date_start AND b.date_end
  ) THEN
    RETURN;
  END IF;

  -- No table (or joined pair) can ever seat this party here: no slots.
  IF NOT public.issue_4490_tables_could_seat(v_venue_id, p_party_size, p_space_id) THEN
    RETURN;
  END IF;

  v_dow := EXTRACT(dow FROM p_date)::int;

  IF v_special.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'start', w->>'open', 'end', w->>'close', 'days', jsonb_build_array(v_dow))), '[]'::jsonb)
    INTO v_periods
    FROM jsonb_array_elements(v_special.windows) AS w;
  ELSE
    v_periods := COALESCE(v_cfg.service_periods, '[]'::jsonb);
  END IF;

  RETURN QUERY
  WITH periods AS (
    SELECT
      pr.value->>'start' AS p_start,
      pr.value->>'end'   AS p_end
    FROM jsonb_array_elements(v_periods) AS pr(value)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(pr.value->'days', '[]'::jsonb)) AS d(dow)
      WHERE d.dow::int = v_dow
    )
      AND (pr.value->>'start') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND (pr.value->>'end')   ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
  ),
  bounds AS (
    SELECT
      ((p_date::timestamp) AT TIME ZONE v_tz) AS local_midnight_utc,
      -- #4490 fix round 1 (N52): a period that closes at or before it opens
      -- (17:00-00:00, 22:00-05:00) runs past midnight; its slots belong to
      -- the day it starts (last seating = close - turn - buffer).
      (public.issue_4490_window_bounds(p.p_start::time, p.p_end::time))[1] AS start_min,
      (public.issue_4490_window_bounds(p.p_start::time, p.p_end::time))[2] AS end_min
    FROM periods p
  ),
  candidates AS (
    SELECT
      (b.local_midnight_utc + make_interval(mins => g.minute_of_day)) AS slot_utc,
      g.minute_of_day
    FROM bounds b
    CROSS JOIN LATERAL generate_series(
      b.start_min,
      b.end_min - (v_turn_min + v_buffer_min),
      v_gran_min
    ) AS g(minute_of_day)
    WHERE b.end_min - (v_turn_min + v_buffer_min) >= b.start_min
  ),
  windowed AS (
    SELECT DISTINCT c.slot_utc, c.minute_of_day
    FROM candidates c
    WHERE c.slot_utc >= v_now + make_interval(mins => COALESCE(v_cfg.min_notice_minutes, 0))
      AND p_date <= ((v_now AT TIME ZONE v_tz)::date + COALESCE(v_cfg.advance_window_days, 30))
  ),
  scored AS (
    SELECT
      w.slot_utc,
      w.minute_of_day,
      COALESCE((SELECT max(o.slot_remaining)
                FROM public.issue_4490_table_slot_occupancy(v_venue_id, w.slot_utc, p_party_size, p_space_id) o), 0)
        AS remaining_calc
    FROM windowed w
  )
  SELECT
    s.slot_utc AS slot_start_utc,
    to_char(s.slot_utc AT TIME ZONE v_tz, 'HH24:MI') AS slot_local_label,
    GREATEST(s.remaining_calc, 0) AS remaining,
    (s.remaining_calc <= 0) AS is_full
  FROM scored s
  ORDER BY s.slot_utc;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. The guest writer checks the slot on its service day (from 20281203164490).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_create_guest_reservation(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text,
  p_created_via text,
  p_consumer_user_id uuid,
  p_guest_name text,
  p_guest_phone_e164 text,
  p_guest_email text,
  p_fee_cents int,
  p_fee_currency char(3),
  p_payment_intent_id text,
  p_payment_status text,
  p_guest_cancel_token text,
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_status text DEFAULT 'confirmed',
  p_guest_phone_country_iso text DEFAULT NULL,
  p_table_ids uuid[] DEFAULT NULL,
  p_space_id uuid DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand_id uuid;
  v_place_pool_id uuid;
  v_enabled boolean;
  v_tz text;
  v_slot_date date;
  v_slot_ok boolean;
  v_deposit_required boolean := false;
  v_lock_key bigint;
  v_pick record;
  v_table uuid;
  v_joined uuid[] := '{}'::uuid[];
  v_min_spend bigint := 0;
  v_big_party boolean := false;
BEGIN
  IF p_venue_id IS NULL OR p_reserved_for IS NULL OR p_party_size IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '') IS NOT NULL
     AND btrim(p_guest_phone_e164) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'reservation_phone_must_be_e164' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'reservation_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservation_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;
  IF p_party_size < 1 OR p_party_size > 100 THEN
    RAISE EXCEPTION 'invalid_party_size' USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla', 'website') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;
  IF p_created_via NOT IN ('consumer', 'guest') THEN
    RAISE EXCEPTION 'invalid_created_via_%', p_created_via USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('requested', 'confirmed') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_payment_status NOT IN ('none', 'paid') THEN
    RAISE EXCEPTION 'invalid_payment_status_%', p_payment_status USING ERRCODE = '23514';
  END IF;

  SELECT v.brand_id, v.place_pool_id INTO v_brand_id, v_place_pool_id
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE venue_id = p_venue_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  SELECT iana_timezone INTO v_tz
  FROM public.venue_availability_config
  WHERE venue_id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  v_tz := NULLIF(btrim(COALESCE(v_tz, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- #4490 P5: the venue's table lock first (every writer takes it in this
  -- order), then the original (venue, start) lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_tables:' || p_venue_id::text, 4490));
  v_lock_key := hashtextextended(p_venue_id::text || '|' || p_reserved_for::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- #4490 fix round 1 (N52): the service day a time belongs to (00:30 after
  -- a Friday 17:00-02:00 period is Friday's slot), never the calendar date.
  v_slot_date := public.issue_4490_table_service_date(p_venue_id, p_reserved_for);
  -- A big party (above every table and joined pair) may only ask.
  v_big_party := p_status = 'requested'
    AND p_party_size > COALESCE(public.issue_4490_table_party_max(p_venue_id), 0)
    AND COALESCE(cardinality(p_table_ids), 0) = 0;
  IF v_big_party THEN
    IF NOT public.issue_4490_feature_setting_on(p_venue_id, 'table_reservations', 'largePartyRequest') THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.pg_venue_available_slots(
        p_date => v_slot_date,
        p_party_size => p_party_size,
        p_venue_id => p_venue_id,
        p_space_id => p_space_id
      ) s
      WHERE s.slot_start_utc = p_reserved_for
        AND s.is_full = false
        AND s.remaining > 0
    ) INTO v_slot_ok;
    IF NOT v_slot_ok THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END IF;
    -- A picked table (or a seating area): checked under the table lock.
    IF COALESCE(cardinality(p_table_ids), 0) > 0 OR p_space_id IS NOT NULL THEN
      SELECT * INTO v_pick FROM public.issue_4490_resolve_table_pick(
        p_venue_id, p_reserved_for, p_party_size, p_table_ids, p_space_id, NULL, false);
      IF FOUND THEN
        v_table := v_pick.table_id;
        v_joined := COALESCE(v_pick.joined_table_ids, '{}'::uuid[]);
        v_min_spend := COALESCE(v_pick.min_spend_minor, 0);
        IF COALESCE(cardinality(p_table_ids), 0) > 0 AND COALESCE(v_pick.hold_minor_per_guest, 0) > 0
           AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
          -- (the edge charges the hold; a discount code may lower what was paid)
          RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.venue_capacity_rules cr
    WHERE cr.venue_id = p_venue_id
      AND cr.is_active
      AND cr.kind = 'deposit_threshold'
      AND COALESCE((cr.params->>'min_party_for_fee')::int, 1) <= p_party_size
  ) INTO v_deposit_required;
  IF v_deposit_required AND NOT v_big_party
     AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
    RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.reservations (
    brand_id, venue_id, place_pool_id, reserved_for, party_size, status, source,
    created_via, guest_name, guest_phone_e164, guest_phone_country_iso, guest_email, consumer_user_id,
    occasion, guest_notes, fee_cents, fee_currency, payment_intent_id,
    payment_status, guest_cancel_token, table_id, joined_table_ids, min_spend_minor
  ) VALUES (
    v_brand_id, p_venue_id, v_place_pool_id, p_reserved_for, p_party_size, p_status, p_source,
    p_created_via, p_guest_name, NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), ''), p_guest_phone_country_iso, p_guest_email,
    p_consumer_user_id, p_occasion, p_guest_notes,
    NULLIF(COALESCE(p_fee_cents, 0), 0), p_fee_currency, p_payment_intent_id,
    p_payment_status, p_guest_cancel_token, v_table, v_joined, v_min_spend
  ) RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    p_consumer_user_id, v_brand_id,
    'venue_reservation.guest_create',
    'reservation', v_row.id,
    jsonb_build_object(
      'source', p_source, 'created_via', p_created_via,
      'party_size', p_party_size, 'reserved_for', p_reserved_for,
      'fee_cents', NULLIF(COALESCE(p_fee_cents, 0), 0),
      'payment_status', p_payment_status, 'status', p_status,
      'venue_id', p_venue_id, 'table_id', v_table, 'joined_table_ids', to_jsonb(v_joined),
      'min_spend_minor', v_min_spend
    )
  );

  RETURN v_row;
END;
$function$;

-- 5. A freed table goes to its service day's waitlist (from 20281203164490).
CREATE OR REPLACE FUNCTION public.issue_4490_on_table_opened()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_day date;
  v_entry record;
  v_slot timestamptz;
BEGIN
  IF NOT (OLD.status IN ('requested', 'confirmed', 'seated')
          AND NEW.status IN ('cancelled_by_guest', 'cancelled_by_venue', 'no_show')) THEN
    RETURN NULL;
  END IF;
  v_tz := COALESCE(NULLIF(btrim(COALESCE((SELECT c.iana_timezone FROM public.venue_availability_config c
                                          WHERE c.venue_id = NEW.venue_id), '')), ''), 'UTC');
  -- #4490 fix round 1: the table's service day (a past-midnight slot is the evening before).
  v_day := public.issue_4490_table_service_date(NEW.venue_id, NEW.reserved_for);
  FOR v_entry IN
    SELECT w.* FROM public.venue_waitlist w
    WHERE w.venue_id = NEW.venue_id AND w.source = 'guest' AND w.status = 'waiting' AND w.desired_date = v_day
    ORDER BY w.created_at, w.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT s.slot_start_utc INTO v_slot
    FROM public.pg_venue_available_slots(v_day, v_entry.party_size, NEW.venue_id) s
    WHERE NOT s.is_full
      AND (v_entry.desired_from IS NULL
           OR ((s.slot_start_utc AT TIME ZONE v_tz)::time >= v_entry.desired_from
               AND (s.slot_start_utc AT TIME ZONE v_tz)::time <= v_entry.desired_to))
    ORDER BY abs(extract(epoch FROM (s.slot_start_utc - NEW.reserved_for))), s.slot_start_utc
    LIMIT 1;
    IF v_slot IS NOT NULL THEN
      UPDATE public.venue_waitlist
      SET status = 'notified', notified_at = now(), offered_slot_at = v_slot,
          expires_at = now() + interval '30 minutes', updated_at = now()
      WHERE id = v_entry.id;
      EXIT;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- 6. A gate sale sells the service day (from 20281203144490).
CREATE OR REPLACE FUNCTION public.issue_4490_hold_offer_internal(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text,
  p_gate boolean,
  p_staff_user_id uuid,
  p_payment_collection text
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
  v_usage record;
  v_request_hash text;
  v_hold_id uuid := gen_random_uuid();
  v_needed integer;
  v_left integer;
  v_hold_expires timestamptz;
  v_policy jsonb;
  v_reservation_line uuid;
  v_plan jsonb;
BEGIN
  IF p_group_id IS NULL OR p_quote_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (NOT p_gate AND (p_buyer_token_hash IS NULL OR octet_length(p_buyer_token_hash) <> 32)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM public.issue_4490_assert_offer_guest(p_guest, NOT p_gate);
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
  IF NOT FOUND OR v_quote.actor_key_hash <> p_actor_key OR v_quote.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' THEN
      UPDATE public.stay_quotes SET status = 'expired', version = version + 1 WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'offer_quote_expired' USING ERRCODE = 'PT409';
  END IF;

  -- Lock order: brand, offering, window, pool (+ override), then slices.
  PERFORM 1 FROM public.brands WHERE id = v_quote.brand_id FOR UPDATE;
  SELECT * INTO v_line FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY id LIMIT 1;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id FOR UPDATE;
  IF v_offer.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stay_quote_lines l
    WHERE l.quote_id = v_quote.id
      AND (l.offering_version <> v_offer.version
           OR NOT EXISTS (SELECT 1 FROM public.stay_price_versions p
                          WHERE p.id = l.price_version_id AND p.effective_to IS NULL)
           OR NOT EXISTS (SELECT 1 FROM public.stay_policy_versions p
                          WHERE p.id = l.policy_version_id AND p.effective_to IS NULL))
  ) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id FOR UPDATE;
  IF v_window.stop_sell OR now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id)
     OR (p_gate AND v_window.local_date <> public.issue_4490_venue_local_date(v_offer.venue_id)) THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' AND NOT p_gate THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.capacity_pool_id IS NOT NULL THEN
    PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id FOR UPDATE;
    PERFORM 1 FROM public.venue_capacity_overrides
    WHERE pool_id = v_offer.capacity_pool_id AND local_date = v_window.local_date FOR UPDATE;
  END IF;
  -- Lapsed holds stop counting (the sweep still owns their state change).
  SELECT sum(place_guests) INTO v_needed FROM public.stay_quote_lines WHERE quote_id = v_quote.id;
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
  IF COALESCE(v_usage.closed, true) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_left := CASE WHEN p_gate THEN v_usage.gate_left ELSE v_usage.online_left END;
  IF v_offer.entry_style = 'timed_session' THEN
    v_left := LEAST(v_left, GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
  END IF;
  IF v_needed > v_left THEN
    RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('remaining', v_left)::text;
  END IF;
  IF p_payment_collection = 'mingla' AND (
       NOT public.pg_brand_can_collect(v_quote.brand_id)
       OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = v_quote.brand_id
                      AND upper(b.default_currency) = v_quote.currency_code)) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  v_policy := v_line.policy_snapshot;
  -- #4490 P3: the deposit plan is fixed when the booking is made.
  v_plan := public.issue_4490_deposit_plan(v_offer.id, v_window.id, v_quote.total_minor);
  IF p_gate THEN
    v_plan := jsonb_build_object('payModes', jsonb_build_array('full'), 'depositMinor', NULL, 'balanceDueAt', NULL,
      'depositKind', 'none', 'depositValue', NULL, 'collapsed', NULL);
  END IF;
  IF p_gate THEN
    PERFORM set_config('mingla.issue_4490_gate_sale', p_group_id::text, true);
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
    'instant', 'instant_payment_pending', NULL, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(p_guest->>'name'),
      'email', NULLIF(lower(btrim(COALESCE(p_guest->>'email', ''))), ''),
      'phone', NULLIF(btrim(COALESCE(p_guest->>'phone', '')), ''),
      'phoneCountryIso', NULLIF(p_guest->>'phoneCountryIso', ''))),
    v_quote.source_subtotal_minor, v_quote.fee_total_minor, v_quote.tax_total_minor, v_quote.total_minor,
    btrim(p_idempotency_key), v_request_hash, v_quote.offer_kind, p_buyer_token_hash,
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
      'damageDepositMinor', 0,
      'minSpendMinor', 0,
      'localDate', v_window.local_date),
    CASE WHEN p_gate THEN 'walk_in' ELSE 'guest' END,
    p_payment_collection,
    p_staff_user_id,
    (v_plan->>'depositMinor')::bigint,
    (v_plan->>'balanceDueAt')::timestamptz,
    COALESCE(v_line.price_snapshot->'answers', '{}'::jsonb)
  );
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_units, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
  )
  SELECT gen_random_uuid(), p_group_id, l.id, l.offering_id, l.kind, 'payment_pending', l.place_window_id,
         l.place_units, l.place_guests, 0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id, l.booked_minutes
  FROM public.stay_quote_lines l WHERE l.quote_id = v_quote.id ORDER BY l.price_option_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, p_group_id, 'active', v_hold_expires,
          CASE WHEN p_gate THEN 'gate_sale' ELSE 'instant_payment' END);
  INSERT INTO public.stay_inventory_hold_slices (
    hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
  )
  SELECT v_hold_id, r.id, 'place_window', r.offering_id, r.place_window_id, r.place_guests
  FROM public.stay_reservation_lines r WHERE r.group_id = p_group_id ORDER BY r.id;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, CASE WHEN p_gate THEN 'stay_offer_gate_sale' ELSE 'stay_offer_hold_created' END,
    CASE WHEN p_gate THEN 'staff' ELSE 'guest' END,
    COALESCE(p_staff_user_id, p_user_id),
    'offer-hold:' || btrim(p_idempotency_key),
    jsonb_build_object('holdExpiresAt', v_hold_expires, 'guests', v_needed, 'localDate', v_window.local_date)
  );
  RETURN p_group_id;
END;
$function$;

-- 7. Check-in list and Today default to the service day (from 20281203194490).
CREATE OR REPLACE FUNCTION public.issue_4490_check_in_list(
  p_venue_id uuid,
  p_local_date date,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_tz text;
  v_date date;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  -- #4490 fix round 1: "today" is the venue's service day (01:30 after a
  -- Friday that closes at 02:00 is still Friday).
  v_date := COALESCE(p_local_date, public.issue_4490_venue_local_date(p_venue_id));
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'passes', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pass_view(p.id) || jsonb_build_object(
          'kind', 'pass', 'time', w.starts_at, 'endsAt', w.ends_at)
        ORDER BY w.starts_at, p.holder_name, p.id)
      FROM public.venue_passes p
      JOIN public.stay_reservation_lines l ON l.id = p.reservation_line_id
      JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
      WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'event_ticket',
          'ticketId', t.id,
          'eventId', e.id,
          'eventTitle', e.title,
          'holderName', COALESCE(t.holder_name, t.attendee_name, o.buyer_name),
          'ticketName', tt.name,
          'admits', COALESCE(t.admits_count, 1),
          'admittedCount', CASE WHEN t.status = 'used' OR t.used_at IS NOT NULL THEN COALESCE(t.admits_count, 1) ELSE 0 END,
          'status', t.status,
          'time', d.start_at)
        ORDER BY d.start_at, t.id)
      FROM public.events e
      JOIN public.event_dates d ON d.event_id = e.id
        AND (d.start_at AT TIME ZONE v_tz)::date = v_date
        AND COALESCE(d.status, 'scheduled') <> 'cancelled'
      JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('valid', 'used')
      JOIN public.orders o ON o.id = t.order_id
      LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL), '[]'::jsonb),
    -- #4490 P6: members who can come in today, and who is in.
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'member',
          'subscriptionId', s.id,
          'holderName', s.member_name,
          'planName', p.name,
          'status', s.status,
          'paymentDue', s.status IN ('payment_due', 'grace'),
          'guestPassesLeft', public.issue_4490_member_credit_left(s.id, 'guest_passes', now()),
          'inToday', x.id IS NOT NULL,
          'guests', COALESCE(x.guests, 0),
          'logId', x.log_id,
          'checkedInAt', x.created_at)
        ORDER BY x.created_at NULLS LAST, s.member_name, s.id)
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      JOIN public.stay_offerings o ON o.id = p.offering_id AND o.venue_id = p_venue_id
      LEFT JOIN public.venue_member_visits x ON x.subscription_id = s.id AND x.local_date = v_date AND x.undone_at IS NULL
      WHERE (s.status IN ('active', 'payment_due', 'grace') AND s.start_on <= v_date) OR x.id IS NOT NULL), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'admits', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_date date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  -- #4490 fix round 1: "today" is the venue's service day (01:30 after a
  -- Friday that closes at 02:00 is still Friday).
  v_date := COALESCE(p_local_date, public.issue_4490_venue_local_date(p_venue_id));
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'closed', public.issue_4490_day_closed(p_venue_id, v_date),
    'pools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'poolId', p.id, 'name', p.name,
          'dailyLimit', u.limit_effective, 'keptForWalkIns', u.kept,
          'used', u.used, 'soldOnline', u.used_online, 'soldAtGate', u.used_gate,
          'onlineLeft', u.online_left, 'walkInLeft', u.kept_left, 'gateLeft', u.gate_left,
          'closed', u.closed,
          'override', (SELECT jsonb_build_object('dailyLimit', ov.daily_limit, 'keptForWalkIns', ov.kept_for_walk_ins,
                         'closed', ov.closed, 'version', ov.version)
                       FROM public.venue_capacity_overrides ov WHERE ov.pool_id = p.id AND ov.local_date = v_date))
        ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, v_date) u
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'offerId', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style, 'status', o.status,
          'poolId', o.capacity_pool_id,
          'sold', COALESCE((
            SELECT sum(c.quantity) FROM public.stay_inventory_commitments c
            JOIN public.stay_place_windows w ON w.id = c.place_window_id
            WHERE c.offering_id = o.id AND c.state = 'active' AND w.local_date = v_date), 0),
          'held', COALESCE((
            SELECT sum(s.quantity) FROM public.stay_inventory_hold_slices s
            JOIN public.stay_inventory_holds h ON h.id = s.hold_id
            JOIN public.stay_place_windows w ON w.id = s.place_window_id
            WHERE s.offering_id = o.id AND w.local_date = v_date
              AND h.state = 'active' AND h.expires_at > now()), 0))
        ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status IN ('live', 'paused')), '[]'::jsonb),
    -- #4490 P6: members checked in that day.
    'membersIn', (SELECT count(*) FROM public.venue_member_visits x
                  JOIN public.venue_membership_subscriptions s ON s.id = x.subscription_id
                  JOIN public.venue_membership_plans p ON p.id = s.plan_id
                  JOIN public.stay_offerings o ON o.id = p.offering_id
                  WHERE o.venue_id = p_venue_id AND x.local_date = v_date AND x.undone_at IS NULL),
    'checkIn', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'expected', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date),
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'groupId', g.id, 'reference', g.public_reference, 'state', g.state,
          'guestName', g.guest_snapshot->>'name', 'guests', (SELECT sum(public.issue_4490_line_guests(l.id))
            FROM public.stay_reservation_lines l WHERE l.group_id = g.id),
          'offerKind', g.offer_kind,
          'startsAt', (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
          'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(g.id) m),
          'balanceDueAt', g.balance_due_at,
          'totalMinor', g.total_minor, 'currencyCode', g.currency_code,
          'source', g.booking_source, 'paymentCollection', g.payment_collection,
          'admittedCount', (SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id),
          'createdAt', g.created_at)
        ORDER BY g.created_at DESC)
      FROM public.stay_reservation_groups g
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
        AND g.state IN ('confirmed', 'partially_cancelled', 'cancelled', 'reconciliation_required', 'instant_payment_pending')
        AND (SELECT w.local_date FROM public.stay_place_windows w
             WHERE w.id = public.issue_4490_group_window_id(g.id)) = v_date), '[]'::jsonb)
  );
END;
$function$;

COMMIT;
