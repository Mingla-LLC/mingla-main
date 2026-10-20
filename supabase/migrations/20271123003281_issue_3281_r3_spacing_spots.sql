-- issue #3281 Round 3 — spacing, min notice, stop offsets, capacity_scope (3c+3a).
-- Guest remaining (3b) reads public fields + pg_experience_slot_availability.
--
-- BEFORE MERGE: apply on production (Seth migration chat). Money-adjacent.
-- Defaults: spacing 30, notice 120, scope total (legacy unchanged).
-- Preserves #4000 service_role-only grants on checkout session RPCs.

BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS capacity_scope text NOT NULL DEFAULT 'total',
  ADD COLUMN IF NOT EXISTS booking_spacing_minutes smallint NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS min_notice_minutes integer NOT NULL DEFAULT 120;

ALTER TABLE public.experience_stops
  ADD COLUMN IF NOT EXISTS start_offset_minutes smallint NULL;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_capacity_scope_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_capacity_scope_check
      CHECK (capacity_scope IN ('total', 'per_day', 'per_start'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_booking_spacing_minutes_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_booking_spacing_minutes_check
      CHECK (booking_spacing_minutes IN (15, 30, 60, 120));
  END IF;
END
$chk$;

COMMENT ON COLUMN public.events.capacity_scope IS
  'issue #3281 R3: total | per_day | per_start (experiences).';
COMMENT ON COLUMN public.events.booking_spacing_minutes IS
  'issue #3281 R3: guest start grid (15/30/60/120).';
COMMENT ON COLUMN public.events.min_notice_minutes IS
  'issue #3281 R3: earliest bookable = now + notice (default 120).';
COMMENT ON COLUMN public.experience_stops.start_offset_minutes IS
  'issue #3281 R3: minutes after booked start for open-hours stop display.';

-- issue #3281 R3 — slot occupancy: sold quantities (not line rows) + the same
-- unexpired hold statuses create-session uses for lifetime / per-day caps.
CREATE OR REPLACE FUNCTION public.issue_3281_ticket_type_slot_taken(
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_session_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT COALESCE(SUM(oli.quantity), 0)::integer
      FROM public.orders o
      JOIN public.order_line_items oli ON oli.order_id = o.id
     WHERE oli.ticket_type_id = p_ticket_type_id
       AND o.payment_status IN ('paid', 'partially_paid', 'partial_refund')
       AND o.booked_start_at IS NOT NULL
       AND (p_event_date_id IS NULL OR o.event_date_id IS NULL OR o.event_date_id = p_event_date_id)
       AND o.booked_start_at < p_end_at
       AND COALESCE(o.booked_end_at, o.booked_start_at + interval '30 minutes') > p_start_at
  ), 0)
  + COALESCE((
    SELECT COALESCE(SUM(i.quantity), 0)::integer
      FROM public.ticket_checkout_sessions s
      JOIN public.ticket_checkout_session_items i ON i.checkout_session_id = s.id
     WHERE i.ticket_type_id = p_ticket_type_id
       AND s.expires_at > now()
       AND s.status IN (
         'pending_free',
         'requires_payment',
         'processing_payment',
         'awaiting_web_redirect'
       )
       AND s.order_id IS NULL
       AND s.revoked_at IS NULL
       AND (p_exclude_session_id IS NULL OR s.id <> p_exclude_session_id)
       AND s.booked_start_at IS NOT NULL
       AND s.booked_start_at < p_end_at
       AND COALESCE(s.booked_end_at, s.booked_start_at + interval '30 minutes') > p_start_at
  ), 0);
$function$;

REVOKE ALL ON FUNCTION public.issue_3281_ticket_type_slot_taken(uuid, uuid, timestamptz, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_ticket_type_slot_taken(uuid, uuid, timestamptz, timestamptz, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3281_apply_experience_r3_settings(
  p_event_id uuid,
  p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text;
  v_spacing integer;
  v_notice integer;
  v_prev_scope text;
  v_prev_spacing integer;
  v_prev_notice integer;
  v_stop jsonb;
  v_order integer;
  v_offset integer;
  v_spacing_iv interval;
  v_has_wide boolean;
BEGIN
  IF p_payload IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(capacity_scope, 'total'),
         COALESCE(booking_spacing_minutes, 30),
         COALESCE(min_notice_minutes, 120)
    INTO v_prev_scope, v_prev_spacing, v_prev_notice
    FROM public.events
   WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Absent keys keep the persisted value so older Host clients cannot reset R3.
  IF (p_payload ? 'capacity_scope') OR (p_payload ? 'capacityScope') THEN
    v_scope := COALESCE(
      NULLIF(p_payload->>'capacity_scope', ''),
      NULLIF(p_payload->>'capacityScope', ''),
      v_prev_scope,
      'total'
    );
  ELSE
    v_scope := COALESCE(v_prev_scope, 'total');
  END IF;
  IF v_scope NOT IN ('total', 'per_day', 'per_start') THEN
    RAISE EXCEPTION 'capacity_scope_invalid';
  END IF;

  IF (p_payload ? 'booking_spacing_minutes')
     OR (p_payload ? 'bookingSpacingMinutes')
     OR (p_payload ? 'spacingMinutes') THEN
    v_spacing := COALESCE(
      NULLIF(p_payload->>'booking_spacing_minutes', '')::integer,
      NULLIF(p_payload->>'bookingSpacingMinutes', '')::integer,
      NULLIF(p_payload->>'spacingMinutes', '')::integer,
      v_prev_spacing,
      30
    );
  ELSE
    v_spacing := COALESCE(v_prev_spacing, 30);
  END IF;
  IF v_spacing NOT IN (15, 30, 60, 120) THEN
    RAISE EXCEPTION 'booking_spacing_invalid';
  END IF;

  IF (p_payload ? 'min_notice_minutes') OR (p_payload ? 'minNoticeMinutes') THEN
    v_notice := COALESCE(
      NULLIF(p_payload->>'min_notice_minutes', '')::integer,
      NULLIF(p_payload->>'minNoticeMinutes', '')::integer,
      v_prev_notice,
      120
    );
  ELSE
    v_notice := COALESCE(v_prev_notice, 120);
  END IF;
  IF v_notice < 0 OR v_notice > 10080 THEN
    RAISE EXCEPTION 'min_notice_invalid';
  END IF;

  -- Rule A: refuse per_day when ANY single local day fits more than one start.
  IF v_scope = 'per_day' THEN
    v_spacing_iv := make_interval(mins => v_spacing);
    SELECT EXISTS (
      SELECT 1
        FROM public.event_dates d
       WHERE d.event_id = p_event_id
         AND (d.end_at - d.start_at) > v_spacing_iv
    ) INTO v_has_wide;
    IF COALESCE(v_has_wide, false) THEN
      RAISE EXCEPTION 'spots_scope_requires_start_time';
    END IF;
  END IF;

  UPDATE public.events SET
    capacity_scope = v_scope,
    booking_spacing_minutes = v_spacing::smallint,
    min_notice_minutes = v_notice,
    updated_at = now()
  WHERE id = p_event_id;

  IF p_payload ? 'stops' AND jsonb_typeof(p_payload->'stops') = 'array' THEN
    FOR v_stop IN SELECT * FROM jsonb_array_elements(p_payload->'stops')
    LOOP
      v_order := COALESCE((v_stop->>'stop_order')::integer, (v_stop->>'stopOrder')::integer);
      IF v_order IS NULL THEN
        CONTINUE;
      END IF;
      -- Only rewrite offsets when the stop object carries the key (title-only
      -- updates that include a stop snapshot without offsets must not NULL them).
      IF (v_stop ? 'start_offset_minutes') OR (v_stop ? 'startOffsetMinutes') THEN
        v_offset := COALESCE(
          NULLIF(v_stop->>'start_offset_minutes', '')::integer,
          NULLIF(v_stop->>'startOffsetMinutes', '')::integer
        );
        UPDATE public.experience_stops
           SET start_offset_minutes = v_offset
         WHERE event_id = p_event_id AND stop_order = v_order;
      END IF;
    END LOOP;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3281_apply_experience_r3_settings(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_apply_experience_r3_settings(uuid, jsonb)
  TO service_role;


DROP FUNCTION IF EXISTS public.issue_3281_validate_booked_start(uuid, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.issue_3281_validate_booked_start(
  p_event_id uuid,
  p_event_date_id uuid,
  p_booked_start_at timestamptz,
  p_booked_end_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event record;
  v_date record;
  v_flag_on boolean := false;
  v_open_daily boolean := false;
  v_required boolean := false;
  v_offset_secs bigint;
  v_spacing_secs bigint;
  v_min_notice integer;
BEGIN
  SELECT e.id, e.event_type, e.is_recurring, e.recurrence_rules,
         COALESCE(e.booking_spacing_minutes, 30) AS booking_spacing_minutes,
         COALESCE(e.min_notice_minutes, 120) AS min_notice_minutes
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- Nothing to do for non-experiences when no start is sent.
  IF v_event.event_type IS DISTINCT FROM 'experience' THEN
    IF p_booked_start_at IS NOT NULL THEN
      RAISE EXCEPTION 'booked_start_invalid';
    END IF;
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT f.is_enabled FROM public.feature_flags f
      WHERE f.flag_key = 'experience_require_booked_start'),
    false
  ) INTO v_flag_on;

  v_open_daily := (
    COALESCE(v_event.is_recurring, false)
    AND jsonb_typeof(v_event.recurrence_rules) = 'object'
    AND v_event.recurrence_rules->>'preset' = 'daily'
    AND v_event.recurrence_rules->'termination'->>'kind' = 'never'
  );

  -- Flag-on open-daily requires a start even when the entitlement day set is
  -- empty. Picker requests that omit bookedStartAt skip day-set promotion so
  -- pre-deploy reservation identity is preserved; validation must still see
  -- the requirement without needing that day id here. Window checks below
  -- still need a named date when a start IS supplied.
  v_required := v_flag_on AND v_open_daily;

  v_min_notice := COALESCE(v_event.min_notice_minutes, 120);

  IF p_booked_start_at IS NULL THEN
    IF v_required THEN
      RAISE EXCEPTION 'booked_start_required';
    END IF;
    -- Fixed-slot bookings omit bookedStartAt; still enforce min notice against
    -- the selected occurrence's start (rule H). Open-daily windows use the
    -- buyer's chosen start when present; without one, do not refuse a day
    -- whose open is already past (afternoon walk-ups remain valid).
    IF p_event_date_id IS NOT NULL AND NOT v_open_daily THEN
      SELECT ed.id, ed.event_id, ed.start_at, ed.end_at
        INTO v_date
        FROM public.event_dates ed
       WHERE ed.id = p_event_date_id;
      IF FOUND AND v_date.event_id IS NOT DISTINCT FROM p_event_id THEN
        IF v_date.start_at < now() + make_interval(mins => v_min_notice) THEN
          RAISE EXCEPTION 'booked_start_in_past';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- A start without a named date cannot be validated against a window.
  IF p_event_date_id IS NULL THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;

  SELECT ed.id, ed.event_id, ed.start_at, ed.end_at
    INTO v_date
    FROM public.event_dates ed
   WHERE ed.id = p_event_date_id;
  IF NOT FOUND OR v_date.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;

  IF p_booked_start_at < now() + make_interval(mins => v_min_notice) THEN
    -- Past starts and starts inside the notice window both refuse as in_past
    -- (guest copy already maps this; rule H).
    RAISE EXCEPTION 'booked_start_in_past';
  END IF;

  IF p_booked_start_at < v_date.start_at OR p_booked_start_at >= v_date.end_at THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;

  -- Spacing grid relative to the occurrence open (R3; default 30).
  v_spacing_secs := GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))::bigint * 60;
  v_offset_secs := EXTRACT(EPOCH FROM (p_booked_start_at - v_date.start_at))::bigint;
  IF v_offset_secs < 0 OR (v_offset_secs % v_spacing_secs) <> 0 THEN
    RAISE EXCEPTION 'booked_start_off_grid';
  END IF;

  -- issue #3281 R2 — optional hire end must land inside the occurrence window.
  IF p_booked_end_at IS NOT NULL THEN
    IF p_booked_end_at <= p_booked_start_at OR p_booked_end_at > v_date.end_at THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3281_validate_booked_start(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_validate_booked_start(uuid, uuid, timestamptz, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3313_event_day_choice(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_type      text;
  v_multi     boolean;
  v_recurring boolean;
  v_upcoming  integer;
  v_sole      uuid;
  v_scope     text;
BEGIN
  SELECT e.event_type, COALESCE(e.is_multi_date, false), COALESCE(e.is_recurring, false),
         COALESCE(e.capacity_scope, 'total')
    INTO v_type, v_multi, v_recurring, v_scope
    FROM public.events e
   WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'requiresChoice', false, 'soleOccurrenceId', NULL,
      'perOccurrenceCapacity', false, 'upcomingCount', 0);
  END IF;

  SELECT count(*)::integer, (array_agg(d.id ORDER BY d.start_at, d.id))[1]
    INTO v_upcoming, v_sole
    FROM public.event_dates d
   WHERE d.event_id = p_event_id AND d.end_at > now();

  RETURN jsonb_build_object(
    'requiresChoice',
      v_type = 'event' AND (v_multi OR (v_recurring AND v_upcoming > 1)),
    'soleOccurrenceId',
      CASE WHEN v_type = 'event' AND v_recurring AND NOT v_multi AND v_upcoming = 1
        THEN v_sole END,
    'perOccurrenceCapacity',
      (v_type = 'event' AND v_recurring AND NOT v_multi)
      OR (v_type = 'experience' AND v_scope = 'per_day'),
    'perStartCapacity',
      (v_type = 'experience' AND v_scope = 'per_start'),
    'capacityScope',
      CASE WHEN v_type = 'experience' THEN v_scope ELSE 'total' END,
    'upcomingCount', v_upcoming
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3313_event_day_choice(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3313_event_day_choice(uuid)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.pg_experience_slot_availability(
  p_event_id uuid,
  p_event_date_id uuid,
  p_ticket_type_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_date public.event_dates%ROWTYPE;
  v_tt public.ticket_types%ROWTYPE;
  v_scope text;
  v_spacing integer;
  v_notice integer;
  v_cap integer;
  v_slots jsonb := '[]'::jsonb;
  v_cursor timestamptz;
  v_end timestamptz;
  v_taken integer;
  v_remaining integer;
BEGIN
  SELECT e.* INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL
     AND e.event_type = 'experience'
     AND e.visibility = 'public'
     AND e.status IN ('live', 'scheduled');
  IF NOT FOUND THEN
    -- Same closed answer for missing / private / draft (no inventory leak).
    RETURN jsonb_build_object('slots', '[]'::jsonb, 'capacityScope', 'total');
  END IF;
  SELECT * INTO v_date FROM public.event_dates
   WHERE id = p_event_date_id AND event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb, 'capacityScope', COALESCE(v_event.capacity_scope, 'total'));
  END IF;
  v_scope := COALESCE(v_event.capacity_scope, 'total');
  v_spacing := COALESCE(v_event.booking_spacing_minutes, 30);
  v_notice := COALESCE(v_event.min_notice_minutes, 120);

  IF p_ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_tt FROM public.ticket_types
     WHERE id = p_ticket_type_id AND event_id = p_event_id AND deleted_at IS NULL;
  ELSE
    SELECT * INTO v_tt FROM public.ticket_types
     WHERE event_id = p_event_id AND deleted_at IS NULL
     ORDER BY display_order, created_at LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('slots', '[]'::jsonb, 'capacityScope', v_scope);
  END IF;
  v_cap := v_tt.quantity_total;

  v_cursor := v_date.start_at;
  v_end := v_date.end_at;
  WHILE v_cursor < v_end LOOP
    IF v_cursor >= now() + make_interval(mins => v_notice) THEN
      IF v_scope = 'per_start' AND v_cap IS NOT NULL THEN
        v_taken := public.issue_3281_ticket_type_slot_taken(
          v_tt.id, p_event_date_id, v_cursor,
          v_cursor + make_interval(mins => v_spacing), NULL);
        v_remaining := GREATEST(0, v_cap - v_taken);
      ELSIF v_scope = 'per_day' AND v_cap IS NOT NULL THEN
        v_taken := public.issue_3313_ticket_type_occurrence_taken(v_tt.id, p_event_date_id);
        v_remaining := GREATEST(0, v_cap - v_taken);
      ELSE
        -- total scope: sold_count + unexpired checkout holds (same family as create-session).
        v_remaining := CASE
          WHEN v_cap IS NULL OR COALESCE(v_tt.is_unlimited, false) THEN NULL
          ELSE GREATEST(
            0,
            v_cap
              - COALESCE(v_tt.sold_count, 0)
              - COALESCE((
                  SELECT SUM(i.quantity)::integer
                    FROM public.ticket_checkout_session_items i
                    JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
                   WHERE i.ticket_type_id = v_tt.id
                     AND s.status = 'pending'
                     AND s.expires_at > now()
                ), 0)
          )
        END;
      END IF;
      v_slots := v_slots || jsonb_build_array(jsonb_build_object(
        'startAt', v_cursor,
        'remaining', v_remaining,
        'full', CASE WHEN v_remaining IS NULL THEN false ELSE v_remaining <= 0 END
      ));
    END IF;
    v_cursor := v_cursor + make_interval(mins => v_spacing);
  END LOOP;

  RETURN jsonb_build_object(
    'capacityScope', v_scope,
    'spacingMinutes', v_spacing,
    'minNoticeMinutes', v_notice,
    'slots', v_slots
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_experience_slot_availability(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_experience_slot_availability(uuid, uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.biz_create_experience(
  p_brand_id uuid,
  p_payload  jsonb,
  p_publish  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id          uuid;
  v_brand            record;
  v_now              timestamptz := now();
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;        -- back-compat mirror = v_intents[1]
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_base_slug        text;
  v_final_slug       text;
  v_suffix           integer := 2;
  v_event_id         uuid;
  v_event            public.events%ROWTYPE;
  v_ticket_id        uuid;
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_shared_precision    text;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_precision      text;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_term_kind        text;        -- recurrence termination kind ('count'|'until'|'never')
  v_when_draft       jsonb;       -- raw When inputs persisted for draft round-trip
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across inserted dates
  v_cover            jsonb;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
BEGIN
  -- 1. Auth + permission --------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  IF public.biz_brand_effective_rank(p_brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- 2. Validate header ----------------------------------------------------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;

  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF p_publish THEN
    IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
      RAISE EXCEPTION 'experience_description_invalid';
    END IF;
  END IF;

  -- multi-intent (unchanged): array, validate each id, >=1 at publish.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(elem ORDER BY ord)
    INTO v_intents
    FROM (
      SELECT DISTINCT ON (btrim(e.value))
             btrim(e.value) AS elem, e.ordinality AS ord
      FROM jsonb_array_elements_text(p_payload->'experience_intents')
        WITH ORDINALITY AS e(value, ordinality)
      WHERE btrim(e.value) <> ''
      ORDER BY btrim(e.value), e.ordinality
    ) d;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF p_publish AND (v_intents IS NULL OR array_length(v_intents, 1) IS NULL) THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  -- I-7 CURRENCY DE-GBP
  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  -- 3. Validate modes -----------------------------------------------------
  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- 4. Validate stops -----------------------------------------------------
  IF p_publish THEN
    IF v_stop_count < 1 OR v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  ELSE
    IF v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF p_publish AND NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF p_publish AND NULLIF(btrim(COALESCE(v_stop->>'ai_description', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_description_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
    IF NULLIF(v_stop->>'coordinate_precision', '') IS NOT NULL
       AND NULLIF(v_stop->>'coordinate_precision', '') NOT IN ('exact', 'approximate') THEN
      RAISE EXCEPTION 'experience_coordinate_precision_invalid';
    END IF;
  END LOOP;

  IF p_publish THEN
    IF v_location_mode = 'single' THEN
      IF NULLIF(v_stops->0->>'place_id', '') IS NULL
         OR (v_stops->0->>'lat') IS NULL
         OR (v_stops->0->>'lng') IS NULL THEN
        RAISE EXCEPTION 'stop_address_unvalidated';
      END IF;
    ELSE
      FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
      LOOP
        IF NULLIF(v_stop->>'place_id', '') IS NULL
           OR (v_stop->>'lat') IS NULL
           OR (v_stop->>'lng') IS NULL THEN
          RAISE EXCEPTION 'stop_address_unvalidated';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- 5. Resolve the ONE price (I-1 spine) ----------------------------------
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;

  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
    v_shared_precision  := NULLIF(v_stops->0->>'coordinate_precision', '');
  END IF;

  -- 6. Resolve the date model --------------------------------------------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := NULLIF(p_payload->>'timezone', '');
  IF p_publish AND v_timezone IS NULL THEN
    RAISE EXCEPTION 'experience_timezone_required';
  END IF;
  IF v_timezone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = v_timezone
  ) THEN
    RAISE EXCEPTION 'experience_timezone_invalid';
  END IF;
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');
  v_term_kind := NULLIF(v_recurrence_rules->'termination'->>'kind', '');

  IF p_publish AND v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- BUG 1 FIX — capture the RAW When inputs so a DRAFT round-trips its
  -- date/time/recurrence/multi selection (event_dates stays publish-only).
  v_when_draft := jsonb_strip_nulls(jsonb_build_object(
    'whenMode',  v_when_mode,
    'when',      v_when,
    'multiDates', v_multi_dates,
    'recurrence_rules', v_recurrence_rules,
    'timezone',  v_timezone
  ));


  -- ORCH-1075 paid-publish integrity guards (experience publish path) -----
  -- Mirror the checkout-session readiness predicate + reject past-dated paid
  -- publishes BEFORE the events row goes live. Guards fire on PAID publish only
  -- (resolved total > 0); drafts (p_publish=false) and FREE offerings are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN
    -- issue #3645: Organiser Terms 1.0 before a paid experience is created
    -- already published (draft saves and free publishes skip), the same
    -- requirement biz_publish_experience carries.
    PERFORM public.biz_require_current_organiser_terms(v_brand.id);
    -- Guard A: Stripe readiness (identical to ticket-checkout-create).
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    -- Guard B: latest occurrence must still be in the future. v_max_end = MAX
    -- end_at across the date(s) about to be materialised (Q4: a paid offering
    -- with ANY future occurrence is NOT past).
    v_max_end := NULL;
    IF v_when_mode IN ('single','recurring') THEN
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NOT NULL THEN
        v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        v_max_end := v_end;
      END IF;
    ELSIF v_when_mode = 'multi_date'
          AND v_multi_dates IS NOT NULL
          AND jsonb_typeof(v_multi_dates) = 'array' THEN
      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
      LOOP
        v_date_iso := NULLIF(v_date_entry->>'date', '');
        IF v_date_iso IS NULL THEN CONTINUE; END IF;
        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        v_max_end := GREATEST(v_max_end, v_end);
      END LOOP;
    END IF;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- 7. Build the slug -----------------------------------------------------
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' THEN
    v_base_slug := 'experience';
  END IF;
  v_final_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = p_brand_id
      AND e.deleted_at IS NULL
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  -- issue #3645: declare a moneyless publish to tg_require_event_brand_currency
  -- (transaction-scoped flag), the way business_publish_event_draft does for a
  -- free event, so a free experience publishes on a brand with no currency yet.
  -- Moneyless = the one ticket resolves to 0 AND no stop that is stored with its
  -- own price carries a positive one. A paid experience never sets it.
  IF p_publish
     AND v_resolved_total <= 0
     AND NOT (
       v_pricing_mode = 'per_stop'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_stops) AS s
         WHERE COALESCE((s->>'price_cents')::integer, 0) > 0
       )
     ) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- BUG 3 FIX — cover patch (absent key = NULL on create).
  v_cover := COALESCE(p_payload->'cover', '{}'::jsonb);

  -- 8. INSERT the events row ----------------------------------------------
  INSERT INTO public.events (
    brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone,
    pass_tax, pass_mingla_fee, pass_service_fee,
    location_mode, pricing_mode, experience_intent, experience_intents, whole_price_cents,
    is_recurring, is_multi_date, recurrence_rules,
    cover_media_url, cover_media_type, cover_media_provider,
    cover_media_source_url, cover_media_credit, cover_media_credit_url, cover_media_alt,
    theme, created_at, updated_at
  ) VALUES (
    p_brand_id, v_user_id, 'experience', v_title, v_final_slug, v_description,
    CASE WHEN p_publish THEN 'scheduled' ELSE 'draft' END,
    CASE WHEN p_publish THEN 'public' ELSE 'draft' END,
    CASE WHEN p_publish THEN v_now ELSE NULL END,
    v_currency, v_timezone,
    CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE NULL END,
    CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE NULL END,
    CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE NULL END,
    v_location_mode, v_pricing_mode, v_intent, v_intents,
    CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    v_is_recurring, v_is_multi_date, v_recurrence_rules,
    NULLIF(v_cover->>'coverMediaUrl', ''),
    NULLIF(v_cover->>'coverMediaType', ''),
    NULLIF(v_cover->>'coverMediaProvider', ''),
    NULLIF(v_cover->>'coverMediaSourceUrl', ''),
    NULLIF(v_cover->>'coverMediaCredit', ''),
    NULLIF(v_cover->>'coverMediaCreditUrl', ''),
    NULLIF(v_cover->>'coverMediaAlt', ''),
    jsonb_build_object(
      'experience_meta', jsonb_build_object(
        'venue_text', COALESCE(NULLIF(v_stops->0->>'address', ''), ''),
        'tier_name', 'Standard',
        'when_draft', v_when_draft
      )
    ),
    v_now, v_now
  )
  RETURNING id INTO v_event_id;

  -- 9. INSERT experience_stops --------------------------------------------
  v_idx := 0;
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
      v_s_precision := v_shared_precision;
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
      v_s_precision := NULLIF(v_stop->>'coordinate_precision', '');
    END IF;

    IF v_s_precision IS NOT NULL
       AND v_s_precision NOT IN ('exact', 'approximate') THEN
      RAISE EXCEPTION 'experience_coordinate_precision_invalid';
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;

    INSERT INTO public.experience_stops (
      event_id, stop_order, place_id, place_name, address,
      city, region, country_code, lat, lng,
      image_urls, start_time, price_cents, ai_description,
      coordinate_precision
    ) VALUES (
      v_event_id,
      COALESCE((v_stop->>'stop_order')::integer, v_idx),
      v_s_place_id,
      btrim(v_stop->>'place_name'),
      COALESCE(v_s_address, ''),
      v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
      v_s_images, v_s_start, v_s_price,
      COALESCE(NULLIF(btrim(v_stop->>'ai_description'), ''), ''),
      v_s_precision
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- 10. Ticket types — legacy Standard OR price_options (#3281 R2) --------
  v_ticket_id := public.issue_3281_apply_experience_price_options(
    v_event_id,
    v_currency,
    v_pricing_mode,
    v_resolved_total,
    v_capacity,
    p_payload->'price_options',
    false
  );

  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------
  IF p_publish THEN
    IF v_when_mode IN ('single','recurring') THEN
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      -- FEATURE never-ends: a 'never' rule materialises EXACTLY the master
      -- (first) occurrence — the rule carries the repeat, the engine needs >=1
      -- future date. Same single-master shape as the prior recurring path.
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_event_id, v_start, v_end, v_timezone, true);
      v_next_occurrence := v_start;

    ELSIF v_when_mode = 'multi_date' THEN
      IF v_multi_dates IS NULL
         OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_multi_dates) = 0 THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;

      SELECT min(
        (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp
          AT TIME ZONE v_timezone
      )
      INTO v_min_start
      FROM jsonb_array_elements(v_multi_dates) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      IF v_min_start IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;

      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
      LOOP
        v_date_iso := NULLIF(v_date_entry->>'date', '');
        IF v_date_iso IS NULL THEN
          RAISE EXCEPTION 'event_date_required';
        END IF;
        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (v_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
      END LOOP;
      v_next_occurrence := v_min_start;
    END IF;

    IF v_next_occurrence IS NOT NULL THEN
      UPDATE public.events
      SET theme = jsonb_set(
            COALESCE(theme, '{}'::jsonb),
            '{experience_meta,next_occurrence_at}',
            to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
            true
          ),
          updated_at = v_now
      WHERE id = v_event_id;
    END IF;
  END IF;

  -- 12. Build the return payload ------------------------------------------
  SELECT * INTO v_event FROM public.events WHERE id = v_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = v_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = v_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = v_event_id;

    -- issue #3281 R3 — spacing / notice / capacity_scope / stop offsets
  PERFORM public.issue_3281_apply_experience_r3_settings(v_event_id, p_payload);

RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken';
END;
$$;



CREATE OR REPLACE FUNCTION public.biz_publish_experience(p_event_id uuid, p_payload jsonb, p_publish boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id          uuid;
  v_brand            record;
  v_existing         public.events%ROWTYPE;
  v_now              timestamptz := now();
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;        -- back-compat mirror = v_intents[1]
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_event            public.events%ROWTYPE;
  v_ticket_id        uuid;
  v_had_published    boolean;
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_shared_precision    text;          -- issue #1363 G1
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_precision      text;          -- issue #1363 G1
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_term_kind        text;
  v_when_draft       jsonb;
  v_cover            jsonb;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_has_cover        boolean;
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across materialised dates
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
BEGIN
  -- 1. Auth ---------------------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2. Load the existing row + assert it's an editable experience --------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience';
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_had_published := v_existing.published_at IS NOT NULL;

  -- 3. Validate header ----------------------------------------------------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;

  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF p_publish THEN
    IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
      RAISE EXCEPTION 'experience_description_invalid';
    END IF;
  END IF;

  -- multi-intent (unchanged): payload array, else default to stored array.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(elem ORDER BY ord)
    INTO v_intents
    FROM (
      SELECT DISTINCT ON (btrim(e.value))
             btrim(e.value) AS elem, e.ordinality AS ord
      FROM jsonb_array_elements_text(p_payload->'experience_intents')
        WITH ORDINALITY AS e(value, ordinality)
      WHERE btrim(e.value) <> ''
      ORDER BY btrim(e.value), e.ordinality
    ) d;
  ELSIF NOT (p_payload ? 'experience_intents') THEN
    v_intents := v_existing.experience_intents;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF p_publish AND (v_intents IS NULL OR array_length(v_intents, 1) IS NULL) THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  -- I-7 CURRENCY DE-GBP
  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  -- 4. Validate modes -----------------------------------------------------
  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- 5. Validate stops -----------------------------------------------------
  IF p_publish THEN
    IF v_stop_count < 1 OR v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  ELSE
    IF v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF p_publish AND NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF p_publish AND NULLIF(btrim(COALESCE(v_stop->>'ai_description', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_description_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
  END LOOP;

  IF p_publish THEN
    IF v_location_mode = 'single' THEN
      -- issue #1363 G1: require a REAL COORDINATE (lat + lng) ONLY. The Mapbox
      -- place_id non-null requirement is dropped — free text yields a real
      -- approximate coordinate with a null place_id. Location coverage is still
      -- guaranteed by lat/lng.
      IF (v_stops->0->>'lat') IS NULL
         OR (v_stops->0->>'lng') IS NULL THEN
        RAISE EXCEPTION 'stop_address_unvalidated';
      END IF;
    ELSE
      FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
      LOOP
        -- issue #1363 G1: lat + lng only (drop the place_id requirement).
        IF (v_stop->>'lat') IS NULL
           OR (v_stop->>'lng') IS NULL THEN
          RAISE EXCEPTION 'stop_address_unvalidated';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- 6. Resolve the ONE price (I-1 spine) ----------------------------------
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;

  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
    v_shared_precision  := NULLIF(v_stops->0->>'coordinate_precision', '');  -- issue #1363 G1
  END IF;

  -- 7. Resolve the date model --------------------------------------------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');
  v_term_kind := NULLIF(v_recurrence_rules->'termination'->>'kind', '');

  IF p_publish AND v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- BUG 1 FIX — capture the RAW When inputs so a DRAFT round-trips its
  -- date/time/recurrence/multi selection.
  v_when_draft := jsonb_strip_nulls(jsonb_build_object(
    'whenMode',  v_when_mode,
    'when',      v_when,
    'multiDates', v_multi_dates,
    'recurrence_rules', v_recurrence_rules,
    'timezone',  v_timezone
  ));


  -- ORCH-1075 paid-publish integrity guards (experience publish path) -----
  -- See pg_brand_can_collect() + migration header. PAID publish only; FREE and
  -- draft (p_publish=false) saves are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN
    -- #3645 PR11d — Organiser Terms 1.0 before paid experience publish
    -- (draft saves / free publishes skip).
    PERFORM public.biz_require_current_organiser_terms(v_brand.id);
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    v_max_end := NULL;
    IF v_when_mode IN ('single','recurring') THEN
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NOT NULL THEN
        v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        v_max_end := v_end;
      END IF;
    ELSIF v_when_mode = 'multi_date'
          AND v_multi_dates IS NOT NULL
          AND jsonb_typeof(v_multi_dates) = 'array' THEN
      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
      LOOP
        v_date_iso := NULLIF(v_date_entry->>'date', '');
        IF v_date_iso IS NULL THEN CONTINUE; END IF;
        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        v_max_end := GREATEST(v_max_end, v_end);
      END LOOP;
    END IF;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- issue #3645: declare a moneyless publish to tg_require_event_brand_currency
  -- (transaction-scoped flag), the way business_publish_event_draft does for a
  -- free event, so a free experience publishes on a brand with no currency yet.
  -- Moneyless = the one ticket resolves to 0 AND no stop that is stored with its
  -- own price carries a positive one. A paid experience never sets it.
  IF p_publish
     AND v_resolved_total <= 0
     AND NOT (
       v_pricing_mode = 'per_stop'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_stops) AS s
         WHERE COALESCE((s->>'price_cents')::integer, 0) > 0
       )
     ) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- BUG 3 FIX — cover patch. A cover is applied ONLY when the payload carries a
  -- non-empty coverMediaUrl. This preserves a video cover that the CoverPicker
  -- already wrote directly to the row via the draft_auto webhook (the wizard's
  -- cover state may not yet hold the processed URL when Save/Publish fires).
  v_cover := COALESCE(p_payload->'cover', '{}'::jsonb);
  -- issue #868 — ADDITIVE + INDEPENDENT extra-photos gallery (camelCase key on
  -- the cover object, mirroring coverMediaUrl/etc). Default [] = single cover.
  v_cover_media_gallery := COALESCE(v_cover->'coverGallery', '[]'::jsonb);
  v_has_cover := NULLIF(v_cover->>'coverMediaUrl', '') IS NOT NULL;

  -- 8. UPDATE the events row ----------------------------------------------
  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    experience_intent = v_intent,
    experience_intents = v_intents,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    cover_media_url        = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaUrl', '')        ELSE cover_media_url END,
    cover_media_type       = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaType', '')       ELSE cover_media_type END,
    cover_media_provider   = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaProvider', '')   ELSE cover_media_provider END,
    cover_media_source_url = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaSourceUrl', '')  ELSE cover_media_source_url END,
    cover_media_credit     = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaCredit', '')     ELSE cover_media_credit END,
    cover_media_credit_url = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaCreditUrl', '')  ELSE cover_media_credit_url END,
    cover_media_alt        = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaAlt', '')        ELSE cover_media_alt END,
    cover_media_gallery    = v_cover_media_gallery,  -- issue #868 (independent; not gated on v_has_cover)
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    -- BUG 5 ROOT CAUSE — the status flip to scheduled/public is DEFERRED to a
    -- second UPDATE in step 11.5, AFTER event_dates is materialised. The
    -- biz_enforce_event_has_master_date trigger (ORCH-0792) fires on the
    -- status transition into scheduled/live and requires a master event_date to
    -- ALREADY exist; flipping status here (before materialisation) raised
    -- event_must_have_master_date on EVERY experience publish — the silent
    -- failure the operator hit. Keep status/visibility/published_at UNCHANGED
    -- in this UPDATE.
    theme             = jsonb_set(
                          jsonb_set(
                            COALESCE(theme, '{}'::jsonb),
                            '{experience_meta,venue_text}',
                            to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                            true
                          ),
                          '{experience_meta,when_draft}',
                          v_when_draft,
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- 9. REPLACE experience_stops ------------------------------------------
  DELETE FROM public.experience_stops WHERE event_id = p_event_id;

  v_idx := 0;
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
      v_s_precision := v_shared_precision;                                 -- issue #1363 G1
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
      v_s_precision := NULLIF(v_stop->>'coordinate_precision', '');        -- issue #1363 G1
    END IF;

    -- issue #1363 G1: normalize precision — empty/blank/unrecognised → NULL so
    -- the coordinate_precision CHECK only ever sees 'exact' | 'approximate' | NULL
    -- (a stale client sending a bad value can never break publish).
    IF v_s_precision IS NOT NULL
       AND v_s_precision NOT IN ('exact', 'approximate') THEN
      v_s_precision := NULL;
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;

    INSERT INTO public.experience_stops (
      event_id, stop_order, place_id, place_name, address,
      city, region, country_code, lat, lng,
      image_urls, start_time, price_cents, ai_description,
      coordinate_precision                                    -- issue #1363 G1
    ) VALUES (
      p_event_id,
      COALESCE((v_stop->>'stop_order')::integer, v_idx),
      v_s_place_id,
      btrim(v_stop->>'place_name'),
      COALESCE(v_s_address, ''),
      v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
      v_s_images, v_s_start, v_s_price,
      COALESCE(NULLIF(btrim(v_stop->>'ai_description'), ''), ''),
      v_s_precision                                           -- issue #1363 G1
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- 10. Ticket types — legacy Standard OR price_options (#3281 R2) --------
  v_ticket_id := public.issue_3281_apply_experience_price_options(
    p_event_id,
    v_currency,
    v_pricing_mode,
    v_resolved_total,
    v_capacity,
    p_payload->'price_options',
    false
  );

  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------
  IF p_publish THEN
    DELETE FROM public.event_dates WHERE event_id = p_event_id;

    IF v_when_mode IN ('single','recurring') THEN
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      -- FEATURE never-ends: 'never' rule materialises EXACTLY the master
      -- (first) occurrence — rule carries the repeat, engine needs >=1 date.
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_timezone, true);

      -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION. The master row is
      -- inserted above; for a `recurring` rule, expand the 2nd..Nth bookable
      -- occurrences into real event_dates rows (bounded 52-cap, OQ-1; NO cron) so
      -- the buyer can reserve every occurrence (not just the first). single-mode
      -- and never-without-a-daily-preset stay master-only. I-4 preserved (publish-
      -- time materialisation). Self-contained expander; no checkout change.
      IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
        PERFORM public.pg_expand_experience_recurrence(
          p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
        );

        -- ORCH-1153 WS1 publish-time DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN).
        -- A recurring publish must never land in a zero-future-occurrence state
        -- (the casualty class). If, after materialisation, the experience has no
        -- future event_dates AND the rule is NOT count-exhausted / until-expired,
        -- the master was anchored in the past with a non-productive rule → block
        -- the publish (mirrors the ORCH-1075 paid-publish guard). count/until
        -- rules whose window has legitimately closed are EXEMPT (a finite series
        -- that has ended is allowed to publish read-only).
        IF NOT EXISTS (
              SELECT 1 FROM public.event_dates ed
              WHERE ed.event_id = p_event_id AND ed.start_at > v_now
            )
           AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
        THEN
          RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
        END IF;
      END IF;
      v_next_occurrence := v_start;

    ELSIF v_when_mode = 'multi_date' THEN
      IF v_multi_dates IS NULL
         OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_multi_dates) = 0 THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;

      SELECT min(
        (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp
          AT TIME ZONE v_timezone
      )
      INTO v_min_start
      FROM jsonb_array_elements(v_multi_dates) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      IF v_min_start IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;

      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
      LOOP
        v_date_iso := NULLIF(v_date_entry->>'date', '');
        IF v_date_iso IS NULL THEN
          RAISE EXCEPTION 'event_date_required';
        END IF;
        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
      END LOOP;
      v_next_occurrence := v_min_start;
    END IF;

    IF v_next_occurrence IS NOT NULL THEN
      UPDATE public.events
      SET theme = jsonb_set(
            COALESCE(theme, '{}'::jsonb),
            '{experience_meta,next_occurrence_at}',
            to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
            true
          ),
          updated_at = v_now
      WHERE id = p_event_id;
    END IF;

    -- 11.5 DEFERRED status flip (BUG 5 ROOT CAUSE). Now that the master
    -- event_date exists, promote the row to scheduled/public — the
    -- biz_enforce_event_has_master_date trigger (ORCH-0792) now passes. Doing
    -- this AFTER materialisation is what makes experience publish succeed.
    UPDATE public.events
    SET status       = 'scheduled',
        visibility   = 'public',
        published_at = COALESCE(published_at, v_now),
        updated_at   = v_now
    WHERE id = p_event_id;
  END IF;

  -- 12. Build the return payload -------------------------------------------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

    -- issue #3281 R3 — spacing / notice / capacity_scope / stop offsets
  PERFORM public.issue_3281_apply_experience_r3_settings(p_event_id, p_payload);

RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows
  );
END;
$function$
;


CREATE OR REPLACE FUNCTION public.biz_update_live_experience(p_event_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- issue #3827 buyer email [H0 notice-declare]
  v_notice jsonb;
  v_user_id          uuid;
  v_existing         public.events%ROWTYPE;
  v_brand            record;
  v_now              timestamptz := now();
  v_trimmed_reason   text;
  v_total_sold       int;
  -- header / modes
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_old_resolved     integer;
  -- stops
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_existing_stop_keys text[];
  v_new_stop_keys    text[];
  v_dropped_stops    text[];
  -- single-mode shared place
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  -- dates
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_new_date_starts  timestamptz[];
  v_old_date_starts  timestamptz[];
  v_old_date_ends    timestamptz[];
  v_new_date_ends    timestamptz[];
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across edited dates
  v_dates_changed    boolean := false;
  -- audit
  v_severity         text;
  v_changed_keys     text[];
  v_log_id           uuid;
  v_affected_order_ids uuid[];
  -- return
  v_event            public.events%ROWTYPE;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
  -- issue #3281 1c — reconcile-in-place scratch
  v_stop_id          uuid;
  v_keep_stop_orders integer[] := '{}'::integer[];
  v_stop_order       integer;
  v_date_id          uuid;
  v_keep_date_ids    uuid[] := '{}'::uuid[];
  v_hold             text;
  v_master_id        uuid;
  v_existing_master_start timestamptz;
  v_existing_master_end   timestamptz;
  v_seed_unchanged   boolean := false;
BEGIN
  -- ---------- 1. Auth + reason ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Load + permission + status gate ----------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience'
      USING HINT = 'biz_update_live_experience only handles event_type=experience rows.';
  END IF;

  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    -- Draft edits NEVER route here; non-live statuses are rejected so the live
    -- guards can never trip a draft.
    RETURN jsonb_build_object('ok', false, 'reason', 'experience_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 3. Sold-count context ----------
  v_total_sold := public.biz_experience_sold_count(p_event_id);

  -- ---------- 4. Parse payload (mirror biz_publish_experience) ----------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;
  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'experience_description_invalid';
  END IF;

  -- META-ORCH-1059 Sub-E FIX (live-edit dropped the vibe): persist curated
  -- experience_intents on edit, mirroring biz_publish_experience. The wizard
  -- sends p_payload->'experience_intents' (1-4 of the 4 brand ids); validate +
  -- require >=1 so a live/published experience stays deck-eligible. Key absent
  -- => leave existing intents unchanged.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(DISTINCT btrim(elem))
      INTO v_intents
      FROM jsonb_array_elements_text(p_payload->'experience_intents') AS elem
     WHERE btrim(elem) <> '';
  ELSIF p_payload ? 'experience_intent'
        AND NULLIF(btrim(p_payload->>'experience_intent'), '') IS NOT NULL THEN
    v_intents := ARRAY[btrim(p_payload->>'experience_intent')];
  ELSE
    v_intents := v_existing.experience_intents;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF v_intents IS NULL OR array_length(v_intents, 1) IS NULL THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- Live experiences are published: enforce the same 2–5 stop gate.
  IF v_stop_count < 1 OR v_stop_count > 5 THEN
    RAISE EXCEPTION 'experience_stop_count_invalid';
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
  END LOOP;

  -- Resolve the new ONE-ticket total (I-1).
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  -- ---------- 5. REFUND-GATE (only when sold > 0, except capacity) ----------

  -- 5a. Capacity floor: lifetime for total; busiest day for per_day;
  -- busiest slot (incl. holds) for per_start.
  IF (p_payload ? 'capacity') AND v_capacity IS NOT NULL THEN
    IF COALESCE(
         NULLIF(p_payload->>'capacity_scope', ''),
         NULLIF(p_payload->>'capacityScope', ''),
         (SELECT capacity_scope FROM public.events WHERE id = p_event_id),
         'total'
       ) = 'total' THEN
      IF v_capacity < v_total_sold THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    ELSIF COALESCE(
         NULLIF(p_payload->>'capacity_scope', ''),
         NULLIF(p_payload->>'capacityScope', ''),
         (SELECT capacity_scope FROM public.events WHERE id = p_event_id),
         'total'
       ) = 'per_start' THEN
      IF v_capacity < COALESCE((
        SELECT MAX(public.issue_3281_ticket_type_slot_taken(
                 tt.id, d.id, gs,
                 gs + make_interval(mins => COALESCE(e.booking_spacing_minutes, 30)),
                 NULL
               ))
          FROM public.events e
          CROSS JOIN public.ticket_types tt
          CROSS JOIN public.event_dates d
          CROSS JOIN LATERAL generate_series(
            d.start_at,
            d.end_at - interval '1 microsecond',
            make_interval(mins => COALESCE(e.booking_spacing_minutes, 30))
          ) AS gs
         WHERE e.id = p_event_id
           AND tt.event_id = p_event_id
           AND tt.deleted_at IS NULL
           AND d.event_id = p_event_id
      ), 0) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    ELSE
      IF v_capacity < COALESCE((
        SELECT MAX(public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id))
          FROM public.ticket_types tt
          CROSS JOIN public.event_dates d
         WHERE tt.event_id = p_event_id
           AND tt.deleted_at IS NULL
           AND d.event_id = p_event_id
      ), 0) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    END IF;
  END IF;

  IF v_total_sold > 0 THEN
    -- 5b. Price lock — the ONE ticket's resolved price can't change once sold.
    SELECT price_cents INTO v_old_resolved
    FROM public.ticket_types
    WHERE event_id = p_event_id AND deleted_at IS NULL
    ORDER BY display_order ASC
    LIMIT 1;
    v_old_resolved := COALESCE(v_old_resolved, 0);

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'price_change_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- 5c. Stop removal — removing an existing (by name) stop is destructive.
    SELECT array_agg(lower(btrim(place_name)))
      INTO v_existing_stop_keys
      FROM public.experience_stops
      WHERE event_id = p_event_id;
    v_existing_stop_keys := COALESCE(v_existing_stop_keys, '{}'::text[]);

    SELECT array_agg(lower(btrim(s->>'place_name')))
      INTO v_new_stop_keys
      FROM jsonb_array_elements(v_stops) s;
    v_new_stop_keys := COALESCE(v_new_stop_keys, '{}'::text[]);

    v_dropped_stops := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_stop_keys) k
      WHERE NOT (k = ANY (v_new_stop_keys))
    );

    IF array_length(v_dropped_stops, 1) > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'stop_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_stops', to_jsonb(v_dropped_stops)
      );
    END IF;
  END IF;

  -- ---------- 6. Resolve the date model + date-shift gate ----------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');

  -- ORCH-1153 WS1 SEED-HARDENING (F-4). A stale client seed can send a recurring
  -- whenMode but a NULL recurrence_rules (e.g. firstRecurrenceRule returned null
  -- on an unexpected jsonb shape). Below, date reconcile + expand only run when
  -- recurrence_rules IS NOT NULL — so a dropped rule would leave the series
  -- without fresh children. Re-derive the rule from the PERSISTED
  -- events.recurrence_rules rather than draining the series. Net: a live-edit
  -- that omits the rule can never silently drain a recurring series.
  IF v_is_recurring
     AND v_recurrence_rules IS NULL
     AND v_existing.is_recurring = true
     AND v_existing.recurrence_rules IS NOT NULL THEN
    v_recurrence_rules := v_existing.recurrence_rules;
  END IF;

  IF v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- Build the proposed occurrence start/end arrays (sorted by start).
  IF v_when_mode IN ('single','recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    v_new_date_starts := ARRAY[v_start];
    v_new_date_ends   := ARRAY[v_end];
  ELSE
    IF v_multi_dates IS NULL
       OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_multi_dates) = 0 THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_new_date_starts := '{}'::timestamptz[];
    v_new_date_ends := '{}'::timestamptz[];
    FOR v_date_entry IN
      SELECT value FROM jsonb_array_elements(v_multi_dates)
      ORDER BY (value->>'date'), (value->>'startTime')
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      v_new_date_starts := v_new_date_starts || v_start;
      v_new_date_ends := v_new_date_ends || v_end;
    END LOOP;
  END IF;


  -- ORCH-1075 paid-publish integrity guards (experience live-edit) --------
  -- Q3: block ANY resulting PAID state while not Stripe-ready (free->paid AND
  -- paid->paid), and block shifting onto an already-past date. Structured
  -- return shape matches this RPC. FREE edits are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF NOT v_is_free AND v_resolved_total > 0 THEN
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    SELECT max(d) INTO v_max_end FROM unnest(v_new_date_ends) AS d;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- Date-shift gate (only with sales). Compare against current event_dates.
  -- issue #3281 1c: for recurring, only the master seed is in the payload; expanded
  -- children must not count as a shift on a title/price-neutral live edit.
  IF v_total_sold > 0 THEN
    IF v_when_mode = 'recurring' THEN
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id AND is_master = true;
    ELSE
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id;
    END IF;
    v_old_date_starts := COALESCE(v_old_date_starts, '{}'::timestamptz[]);
    v_old_date_ends   := COALESCE(v_old_date_ends, '{}'::timestamptz[]);

    IF COALESCE(array_length(v_old_date_starts, 1), 0)
         IS DISTINCT FROM COALESCE(array_length(v_new_date_starts, 1), 0) THEN
      v_dates_changed := true;
    ELSE
      FOR v_idx IN 1 .. COALESCE(array_length(v_old_date_starts, 1), 0)
      LOOP
        IF v_old_date_starts[v_idx] IS DISTINCT FROM v_new_date_starts[v_idx]
           OR v_old_date_ends[v_idx] IS DISTINCT FROM v_new_date_ends[v_idx] THEN
          v_dates_changed := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_dates_changed THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', (
          SELECT COALESCE(jsonb_agg(to_char(d AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::jsonb)
          FROM unnest(v_old_date_starts) d
        )
      );
    END IF;
  END IF;

  -- ---------- 7. APPLY (all gates passed) ----------
  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
  END IF;

  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    experience_intents = v_intents,
    experience_intent  = v_intent,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    theme             = jsonb_set(
                          COALESCE(theme, '{}'::jsonb),
                          '{experience_meta,venue_text}',
                          to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- issue #3281 1c — reconcile experience_stops in place (match by stop_order).
  -- Kept ids matter for R2/R3 per-stop address choice; never DELETE+reinsert.
  v_idx := 0;
  v_keep_stop_orders := '{}'::integer[];
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;
    v_stop_order := COALESCE((v_stop->>'stop_order')::integer, v_idx);

    UPDATE public.experience_stops SET
      place_id     = v_s_place_id,
      place_name   = btrim(v_stop->>'place_name'),
      address      = COALESCE(v_s_address, ''),
      city         = v_s_city,
      region       = v_s_region,
      country_code = v_s_country,
      lat          = v_s_lat,
      lng          = v_s_lng,
      image_urls   = v_s_images,
      start_time   = v_s_start,
      price_cents  = v_s_price,
      ai_description = COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
    WHERE event_id = p_event_id AND stop_order = v_stop_order
    RETURNING id INTO v_stop_id;

    IF v_stop_id IS NULL THEN
      INSERT INTO public.experience_stops (
        event_id, stop_order, place_id, place_name, address,
        city, region, country_code, lat, lng,
        image_urls, start_time, price_cents, ai_description
      ) VALUES (
        p_event_id,
        v_stop_order,
        v_s_place_id,
        btrim(v_stop->>'place_name'),
        COALESCE(v_s_address, ''),
        v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
        v_s_images, v_s_start, v_s_price,
        COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
      );
    END IF;

    v_keep_stop_orders := v_keep_stop_orders || v_stop_order;
    v_stop_id := NULL;
    v_idx := v_idx + 1;
  END LOOP;

  DELETE FROM public.experience_stops
   WHERE event_id = p_event_id
     AND NOT (stop_order = ANY (v_keep_stop_orders));

  -- Rewrite the ONE ticket (I-1). Preserve identity by UPDATEing the live ticket
  -- in place (so existing order_line_items.ticket_type_id stays valid) rather
  -- than soft-delete + insert.
  -- Ticket types — legacy Standard OR price_options (#3281 R2)
  -- Refuse option rewrite when sales exist and payload names price_options
  -- with a unit/price change; additive-only live edits omit price_options and
  -- keep the existing Standard row update below via the helper's sales guard.
  IF p_payload ? 'price_options' THEN
    PERFORM public.issue_3281_apply_experience_price_options(
      p_event_id,
      v_currency,
      v_pricing_mode,
      v_resolved_total,
      v_capacity,
      p_payload->'price_options',
      (v_total_sold > 0)
    );
  ELSE
    -- Omission: never flatten multi-option experiences. Legacy single-ticket
    -- experiences still get the Standard in-place update.
    IF (SELECT count(*) FROM public.ticket_types
         WHERE event_id = p_event_id AND deleted_at IS NULL) <= 1 THEN
      UPDATE public.ticket_types SET
        name           = 'Standard',
        price_cents    = v_resolved_total,
        currency       = v_currency,
        quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
        is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
        is_free        = (v_resolved_total = 0),
        updated_at     = v_now
      WHERE event_id = p_event_id
        AND deleted_at IS NULL;
    ELSE
      UPDATE public.ticket_types SET
        currency       = v_currency,
        quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
        is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
        updated_at     = v_now
      WHERE event_id = p_event_id
        AND deleted_at IS NULL;
    END IF;
  END IF;

  -- issue #3281 1c — reconcile event_dates in place (match by start_at; P3 for
  -- single/recurring one-occurrence moves). Held rows never deleted
  -- (issue_3285_event_date_hold_reason). Recurring children survive when the
  -- master seed is unchanged; the expander skips existing starts.
  v_min_start := NULL;
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    IF v_min_start IS NULL OR v_new_date_starts[v_idx] < v_min_start THEN
      v_min_start := v_new_date_starts[v_idx];
    END IF;
  END LOOP;

  SELECT ed.start_at, ed.end_at INTO v_existing_master_start, v_existing_master_end
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id AND ed.is_master = true
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  v_seed_unchanged := (
    v_when_mode = 'recurring'
    AND v_existing_master_start IS NOT DISTINCT FROM v_start
    AND v_existing_master_end IS NOT DISTINCT FROM v_end
  );

  v_keep_date_ids := '{}'::uuid[];
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    v_date_id := NULL;
    SELECT ed.id INTO v_date_id
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.start_at = v_new_date_starts[v_idx]
       AND NOT (ed.id = ANY (v_keep_date_ids))
     ORDER BY ed.id
     LIMIT 1;

    -- P3: a single/recurring experience's one seed occurrence keeps its id when
    -- its start moves (unsold path only; sold shifts are gated above).
    IF v_date_id IS NULL
       AND v_when_mode IN ('single', 'recurring')
       AND COALESCE(array_length(v_new_date_starts, 1), 0) = 1 THEN
      SELECT ed.id INTO v_date_id
        FROM public.event_dates ed
       WHERE ed.event_id = p_event_id
         AND ed.is_master = true
         AND NOT (ed.id = ANY (v_keep_date_ids))
       ORDER BY ed.start_at, ed.id
       LIMIT 1;
      IF v_date_id IS NULL THEN
        SELECT ed.id INTO v_date_id
          FROM public.event_dates ed
         WHERE ed.event_id = p_event_id
           AND NOT (ed.id = ANY (v_keep_date_ids))
         ORDER BY ed.start_at, ed.id
         LIMIT 1;
      END IF;
    END IF;

    IF v_date_id IS NOT NULL THEN
      UPDATE public.event_dates
         SET start_at = v_new_date_starts[v_idx],
             end_at = v_new_date_ends[v_idx],
             timezone = v_timezone
       WHERE id = v_date_id
         AND (start_at, end_at, timezone) IS DISTINCT FROM
             (v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone);
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    ELSE
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id, v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone,
        v_new_date_starts[v_idx] = v_min_start
      )
      RETURNING id INTO v_date_id;
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    END IF;
  END LOOP;

  -- Recurring children: keep when the master seed is unchanged.
  IF v_seed_unchanged THEN
    SELECT COALESCE(v_keep_date_ids, '{}'::uuid[])
           || COALESCE(array_agg(ed.id), '{}'::uuid[])
      INTO v_keep_date_ids
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.is_master = false
       AND NOT (ed.id = ANY (COALESCE(v_keep_date_ids, '{}'::uuid[])));
  END IF;

  -- Remove only unheld rows that are not in the keep set.
  FOR v_date_id IN
    SELECT ed.id FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND NOT (ed.id = ANY (v_keep_date_ids))
  LOOP
    v_hold := public.issue_3285_event_date_hold_reason(v_date_id);
    IF v_hold IS NOT NULL THEN
      RAISE EXCEPTION 'multi_date_remove_with_sales'
        USING DETAIL = format('issue #3281: occurrence %s is held (%s)', v_date_id, v_hold);
    END IF;
    DELETE FROM public.ticket_event_dates ted
     USING public.tickets t
     WHERE t.id = ted.ticket_id
       AND ted.event_date_id = v_date_id
       AND t.status NOT IN ('valid', 'used', 'transferred', 'refund_pending');
    DELETE FROM public.event_dates WHERE id = v_date_id;
  END LOOP;

  -- Exactly one master = the earliest occurrence.
  SELECT ed.id INTO v_master_id
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  UPDATE public.event_dates
     SET is_master = false
   WHERE event_id = p_event_id
     AND is_master
     AND id IS DISTINCT FROM v_master_id;
  IF v_master_id IS NOT NULL THEN
    UPDATE public.event_dates SET is_master = true WHERE id = v_master_id AND NOT is_master;
  END IF;

  v_next_occurrence := v_min_start;

  -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION on live-edit. Seed
  -- row(s) are reconciled above; for a `recurring` rule, expand the 2nd..Nth
  -- bookable occurrences (bounded 52-cap). The expander skips starts that
  -- already exist so surviving date ids stay put. I-4 preserved.
  IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
    PERFORM public.pg_expand_experience_recurrence(
      p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
    );

    -- ORCH-1153 WS1 live-edit DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN). After
    -- re-materialisation a recurring experience must never have zero future
    -- occurrences (unless the rule is count-exhausted / until-expired). Blocks a
    -- live-edit that would shift the master into the past with a non-productive
    -- rule. count/until series whose window legitimately closed are EXEMPT.
    IF NOT EXISTS (
          SELECT 1 FROM public.event_dates ed
          WHERE ed.event_id = p_event_id AND ed.start_at > v_now
        )
       AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
    THEN
      RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
    END IF;
  END IF;

  IF v_next_occurrence IS NOT NULL THEN
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{experience_meta,next_occurrence_at}',
          to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          true
        ),
        updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- ---------- 8. Audit log ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_payload));

  IF (p_payload ? 'capacity' OR p_payload ? 'stops' OR p_payload ? 'whenMode'
      OR p_payload ? 'whole_price_cents' OR p_payload ? 'pricing_mode') THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.experience_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_existing.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    jsonb_build_object('changed_keys', to_jsonb(v_changed_keys)),
    v_affected_order_ids,
    v_now
  ) RETURNING id INTO v_log_id;

  -- issue #3827 buyer email [H1 notice-flush]
  v_notice := public.event_edit_notice_flush(p_event_id, v_trimmed_reason, 'experience', false);

  -- ---------- 9. Return payload (mirror biz_publish_experience shape) ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

    -- issue #3281 R3 — spacing / notice / capacity_scope / stop offsets
  PERFORM public.issue_3281_apply_experience_r3_settings(p_event_id, p_payload);

RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    -- issue #3827 buyer email [H2 notice-result]
    'buyer_notice', v_notice
  );
END;
$function$
;


CREATE OR REPLACE FUNCTION public.issue_1973_agent_experience_payload(
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw_tags jsonb := CASE
    WHEN jsonb_typeof(p_args->'experience_intents')='array'
      THEN p_args->'experience_intents'
    ELSE COALESCE(p_args->'intent_tags','[]'::jsonb)
  END;
  v_tag jsonb;
  v_norm text;
  v_mapped text;
  v_matched text[] := '{}'::text[];
  v_intents jsonb;
  v_stop jsonb;
  v_stops jsonb := '[]'::jsonb;
  v_stop_count integer := 0;
  v_stop_total integer := 0;
  v_price integer;
  v_suggested_mid integer;
BEGIN
  IF jsonb_typeof(v_raw_tags)='array' THEN
    FOR v_tag IN SELECT value FROM jsonb_array_elements(v_raw_tags) LOOP
      IF jsonb_typeof(v_tag)<>'string' THEN CONTINUE; END IF;
      v_norm := regexp_replace(lower(btrim(v_tag#>>'{}')), '\s+', '_', 'g');
      v_mapped := CASE
        WHEN replace(v_norm,'_','-') IN(
          'adventurous','first-date','romantic','group-fun'
        ) THEN replace(v_norm,'_','-')
        WHEN v_norm IN('group_activity','friends_chill','family_friendly')
          THEN 'group-fun'
        WHEN v_norm='date_night_active' THEN 'romantic'
        WHEN v_norm='solo_exploration' THEN 'adventurous'
        WHEN v_norm ~ '(romantic|date_night|date-night|couple|intimate|candlelit|tasting_menu|wine_pairing|anniversary)'
          THEN 'romantic'
        WHEN v_norm ~ '(first_date|first-date|casual_date|meet|icebreaker)'
          THEN 'first-date'
        WHEN v_norm ~ '(adventur|explore|thrill|outdoor|active|solo|discover)'
          THEN 'adventurous'
        WHEN v_norm ~ '(group|friends|family|party|social|shareable|bottomless|brunch|happy_hour|crew|team)'
          THEN 'group-fun'
        ELSE NULL
      END;
      IF v_mapped IS NOT NULL AND NOT (v_mapped=ANY(v_matched)) THEN
        v_matched := array_append(v_matched,v_mapped);
      END IF;
    END LOOP;
  END IF;
  SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO v_intents
  FROM unnest(ARRAY['adventurous','first-date','romantic','group-fun']) value
  WHERE value=ANY(v_matched);

  IF jsonb_typeof(p_args->'stops')='array' THEN
    FOR v_stop IN SELECT value FROM jsonb_array_elements(p_args->'stops') LOOP
      IF v_stop_count>=5 THEN RAISE EXCEPTION 'experience_stop_limit_exceeded'; END IF;
      v_price := CASE WHEN jsonb_typeof(v_stop->'price_cents')='number'
        THEN greatest(0,round((v_stop->>'price_cents')::numeric)::integer)
        ELSE 0 END;
      v_stops := v_stops || jsonb_build_array(jsonb_build_object(
        'stop_order',v_stop_count,
        'place_name',COALESCE(NULLIF(v_stop->>'place_name',''),v_stop->>'name'),
        'ai_description',COALESCE(v_stop->>'ai_description',v_stop->>'description'),
        'address',COALESCE(v_stop->>'address',''),
        'city',v_stop->'city',
        'region',v_stop->'region',
        'country_code',v_stop->'country_code',
        'place_id',v_stop->'place_id',
        'lat',v_stop->'lat',
        'lng',v_stop->'lng',
        'coordinate_precision',v_stop->'coordinate_precision',
        'start_time',v_stop->'start_time',
        'start_offset_minutes',CASE
          WHEN jsonb_typeof(v_stop->'start_offset_minutes')='number'
            THEN (v_stop->>'start_offset_minutes')::integer
          WHEN jsonb_typeof(v_stop->'startOffsetMinutes')='number'
            THEN (v_stop->>'startOffsetMinutes')::integer
          ELSE NULL
        END,
        'price_cents',v_price,
        'image_urls',CASE WHEN jsonb_typeof(v_stop->'image_urls')='array'
          THEN v_stop->'image_urls' ELSE '[]'::jsonb END
      ));
      v_stop_count := v_stop_count+1;
      v_stop_total := v_stop_total+v_price;
    END LOOP;
  END IF;

  IF jsonb_typeof(p_args->'suggested_price_min_cents')='number'
     AND jsonb_typeof(p_args->'suggested_price_max_cents')='number' THEN
    v_suggested_mid := round(
      ((p_args->>'suggested_price_min_cents')::numeric+
       (p_args->>'suggested_price_max_cents')::numeric)/2
    )::integer;
  END IF;

  RETURN jsonb_build_object(
    'capacity_scope', COALESCE(NULLIF(p_args->>'capacity_scope',''), 'total'),
    'booking_spacing_minutes', COALESCE(
      NULLIF(p_args->>'booking_spacing_minutes','')::integer, 30),
    'min_notice_minutes', COALESCE(
      NULLIF(p_args->>'min_notice_minutes','')::integer, 120),
    'title',btrim(p_args->>'title'),
    'description',btrim(p_args->>'narrative'),
    'experience_intents',v_intents,
    'stops',v_stops,
    'location_mode',COALESCE(
      NULLIF(p_args->>'location_mode',''),
      CASE WHEN v_stop_count>0 THEN 'per_stop' ELSE 'single' END
    ),
    'pricing_mode',COALESCE(
      NULLIF(p_args->>'pricing_mode',''),
      CASE WHEN v_stop_count>0 THEN 'per_stop' ELSE 'whole' END
    ),
    'whole_price_cents',CASE
      WHEN jsonb_typeof(p_args->'whole_price_cents')='number'
        THEN (p_args->>'whole_price_cents')::integer
      ELSE v_suggested_mid
    END,
    'is_free',CASE
      WHEN jsonb_typeof(p_args->'is_free')='boolean'
        THEN (p_args->>'is_free')::boolean
      WHEN v_stop_count>0 THEN v_stop_total=0
      ELSE COALESCE(v_suggested_mid,0)=0
    END,
    'capacity',COALESCE(p_args->'capacity',p_args->'capacity_max','null'::jsonb),
    'price_options',CASE
      WHEN jsonb_typeof(p_args->'price_options')='array' THEN p_args->'price_options'
      ELSE NULL
    END,
    'currency',COALESCE(p_args->'currency','null'::jsonb),
    'timezone',COALESCE(p_args->'timezone','null'::jsonb),
    'whenMode',COALESCE(NULLIF(p_args->>'whenMode',''),'single'),
    'when',COALESCE(p_args->'when','null'::jsonb),
    'multiDates',COALESCE(p_args->'multiDates','null'::jsonb),
    'recurrence_rules',COALESCE(p_args->'recurrence_rules','null'::jsonb),
    'cover',COALESCE(p_args->'cover','{}'::jsonb)
  );
END;
$$;



CREATE OR REPLACE FUNCTION public.issue_1973_current_experience_payload(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_stops jsonb;
  v_ticket public.ticket_types%ROWTYPE;
  v_options jsonb;
  v_when jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.event_type <> 'experience' THEN RAISE EXCEPTION 'experience_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,auth.uid()) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'stop_order',s.stop_order,'place_id',s.place_id,'place_name',s.place_name,
      'address',s.address,'city',s.city,'region',s.region,'country_code',s.country_code,
      'lat',s.lat,'lng',s.lng,'coordinate_precision',s.coordinate_precision,
      'image_urls',s.image_urls,'start_time',s.start_time,
      'start_offset_minutes',s.start_offset_minutes,
      'price_cents',s.price_cents,
      'ai_description',s.ai_description
    ) ORDER BY s.stop_order),'[]'::jsonb)
    INTO v_stops FROM public.experience_stops s WHERE s.event_id=p_event_id;
  SELECT * INTO v_ticket FROM public.ticket_types
   WHERE event_id=p_event_id AND deleted_at IS NULL ORDER BY display_order,created_at LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', tt.id,
      'name', tt.name,
      'price_cents', tt.price_cents,
      'price_basis', tt.price_basis,
      'block_minutes', tt.block_minutes,
      'min_blocks', tt.min_blocks,
      'max_blocks', tt.max_blocks,
      'group_max', tt.group_max,
      'capacity', CASE WHEN tt.is_unlimited THEN NULL ELSE tt.quantity_total END,
      'is_hidden', tt.is_hidden
    ) ORDER BY tt.display_order, tt.created_at), '[]'::jsonb)
    INTO v_options
    FROM public.ticket_types tt
   WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL;
  v_when := COALESCE(v_event.theme->'experience_meta'->'when_draft','{}'::jsonb);
  RETURN jsonb_build_object(
    'capacity_scope', COALESCE(v_event.capacity_scope, 'total'),
    'booking_spacing_minutes', COALESCE(v_event.booking_spacing_minutes, 30),
    'min_notice_minutes', COALESCE(v_event.min_notice_minutes, 120),
    'title',v_event.title,'description',v_event.description,
    'experience_intents',COALESCE(to_jsonb(v_event.experience_intents),'[]'::jsonb),
    'currency',v_event.currency,'location_mode',v_event.location_mode,
    'pricing_mode',v_event.pricing_mode,'whole_price_cents',v_event.whole_price_cents,
    'is_free',COALESCE(v_ticket.is_free,v_event.whole_price_cents=0),
    'capacity',CASE WHEN v_ticket.is_unlimited THEN NULL ELSE v_ticket.quantity_total END,
    'pass_tax',v_event.pass_tax,'pass_mingla_fee',v_event.pass_mingla_fee,
    'pass_service_fee',v_event.pass_service_fee,'stops',v_stops,
    'price_options', v_options,
    'whenMode',COALESCE(v_when->>'whenMode',CASE WHEN v_event.is_recurring THEN 'recurring' WHEN v_event.is_multi_date THEN 'multi_date' ELSE 'single' END),
    'when',v_when->'when','multiDates',v_when->'multiDates',
    'recurrence_rules',COALESCE(v_when->'recurrence_rules',v_event.recurrence_rules),
    'timezone',COALESCE(v_when->>'timezone',v_event.timezone),
    'cover',jsonb_build_object(
      'coverMediaUrl',v_event.cover_media_url,'coverMediaPosterUrl',v_event.cover_media_poster_url,
      'coverMediaType',v_event.cover_media_type,'coverMediaProvider',v_event.cover_media_provider,
      'coverMediaSourceUrl',v_event.cover_media_source_url,'coverMediaCredit',v_event.cover_media_credit,
      'coverMediaCreditUrl',v_event.cover_media_credit_url,'coverMediaAlt',v_event.cover_media_alt,
      'coverGallery',COALESCE(v_event.cover_media_gallery,'[]'::jsonb)
    )
  );
END;
$$;



CREATE OR REPLACE FUNCTION public.business_apply_experience_action(
  p_event_id uuid,p_patch jsonb,p_action text,
  p_expected_revision timestamptz DEFAULT NULL,p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_payload jsonb;
  v_result jsonb;
  v_stop jsonb;
  v_url text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_action NOT IN ('update','manage_stops','publish') THEN RAISE EXCEPTION 'experience_action_invalid'; END IF;
  IF COALESCE(jsonb_typeof(p_patch),'object') <> 'object' THEN RAISE EXCEPTION 'experience_patch_invalid'; END IF;
  IF COALESCE(p_patch,'{}'::jsonb) ?| ARRAY['status','visibility','published_at','deleted_at','event_type','brand_id','id','slug'] THEN
    RAISE EXCEPTION 'experience_lifecycle_fields_forbidden';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'experience' THEN RAISE EXCEPTION 'experience_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,auth.uid()) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF p_expected_revision IS NOT NULL AND v_event.updated_at IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale_experience_revision';
  END IF;
  IF v_event.status IN ('ended','cancelled') THEN RAISE EXCEPTION 'experience_not_editable'; END IF;
  IF p_action='publish' AND v_event.status <> 'draft' THEN RAISE EXCEPTION 'experience_not_publishable'; END IF;
  IF v_event.status IN ('scheduled','live') AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 200) THEN
    RAISE EXCEPTION 'experience_edit_reason_required';
  END IF;

  -- Ari can retain an already-persisted stop image but cannot author a URL.
  IF p_patch ? 'stops' THEN
    IF jsonb_typeof(p_patch->'stops') <> 'array' OR jsonb_array_length(p_patch->'stops') > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
    FOR v_stop IN SELECT value FROM jsonb_array_elements(p_patch->'stops') LOOP
      IF jsonb_typeof(COALESCE(v_stop->'image_urls','[]'::jsonb)) <> 'array'
         OR jsonb_array_length(COALESCE(v_stop->'image_urls','[]'::jsonb)) > 5 THEN
        RAISE EXCEPTION 'stop_too_many_images';
      END IF;
      FOR v_url IN SELECT value #>> '{}' FROM jsonb_array_elements(COALESCE(v_stop->'image_urls','[]'::jsonb)) LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.experience_stops prior
          WHERE prior.event_id=p_event_id AND v_url=ANY(COALESCE(prior.image_urls,'{}'::text[]))
        ) THEN RAISE EXCEPTION 'experience_media_reference_required'; END IF;
      END LOOP;
    END LOOP;
  END IF;
  IF p_patch ? 'cover' AND p_patch->'cover' IS DISTINCT FROM public.issue_1973_current_experience_payload(p_event_id)->'cover' THEN
    RAISE EXCEPTION 'experience_media_reference_required';
  END IF;

  v_payload := public.issue_1973_current_experience_payload(p_event_id) || COALESCE(p_patch,'{}'::jsonb);
  IF NULLIF(btrim(v_payload->>'timezone'), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = NULLIF(btrim(v_payload->>'timezone'), '')
  ) THEN
    RAISE EXCEPTION 'experience_timezone_invalid';
  END IF;
  IF p_action = 'publish' AND NULLIF(btrim(v_payload->>'timezone'), '') IS NULL THEN
    RAISE EXCEPTION 'experience_timezone_required';
  END IF;
  IF v_event.status='draft' THEN
    v_result := public.issue_1719_publish_experience_with_poster(p_event_id,v_payload,p_action='publish');
    IF NULLIF(btrim(v_payload->>'timezone'), '') IS NULL THEN
      UPDATE public.events
      SET timezone = NULL,
          theme = theme #- '{experience_meta,when_draft,timezone}',
          updated_at = now()
      WHERE id = p_event_id AND status = 'draft' AND event_type = 'experience';
    END IF;
  ELSE
    v_result := public.biz_update_live_experience(p_event_id,v_payload,p_reason);
    IF NOT COALESCE((v_result->>'ok')::boolean,false) THEN RETURN v_result; END IF;
    -- Repair the two lossless round-trip omissions in the current live owner.
    UPDATE public.experience_stops s SET coordinate_precision=x.precision
      FROM (
        SELECT (value->>'stop_order')::integer AS stop_order,
               NULLIF(value->>'coordinate_precision','') AS precision
        FROM jsonb_array_elements(COALESCE(v_payload->'stops','[]'::jsonb))
      ) x WHERE s.event_id=p_event_id AND s.stop_order=x.stop_order;
    UPDATE public.events SET theme=jsonb_set(
      COALESCE(theme,'{}'::jsonb),'{experience_meta,when_draft}',
      jsonb_build_object('whenMode',v_payload->>'whenMode','when',v_payload->'when',
        'multiDates',v_payload->'multiDates','recurrence_rules',v_payload->'recurrence_rules',
        'timezone',v_payload->>'timezone'),true)
      WHERE id=p_event_id;
  END IF;
  RETURN public.issue_1973_read_experience_graph(p_event_id);
END;
$$;



DROP FUNCTION IF EXISTS public.issue_1930_ticket_checkout_create_session_base(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer
);

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  v_unit_price bigint;
  v_admits integer;
  v_basis text;
  v_blocks integer;
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
  -- issue #3313: whether a day must be chosen, and capacity per night.
  v_day_choice jsonb;
  v_per_occurrence boolean := false;
  v_night_taken integer;
  -- issue #3281 R3 — effective booked window (may bind fixed-slot opening).
  v_booked_start timestamptz := p_booked_start_at;
  v_booked_end timestamptz := p_booked_end_at;
  v_open_daily boolean := false;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         e.capacity_scope, e.booking_spacing_minutes, e.is_recurring, e.recurrence_rules,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- ══ issue #2562 — AN EVENT THAT HAS ALREADY HAPPENED CANNOT BE SOLD ═══
  --
  -- Before this, NOTHING on the reservation path asked whether the event was
  -- over. `event_not_selling` above checks `events.status`, and a finished
  -- event is still `scheduled` — status describes the LISTING, not the clock.
  -- The only thing standing between a guest and paying for a past event was an
  -- OPTIONAL per-tier `sale_end_at`, and six live tiers do not have one.
  --
  -- Proven against production before this guard existed: a checkout session for
  -- FIFA Grill Night — last occurrence ended 2026-07-26 — came back
  -- `status=requires_payment total=2000 currency=USD`, a month after the event.
  -- The buyer web blocked it; the Explorer app offered "Buy ticket"; the server
  -- accepted. A guarantee cannot rest on an optional field being filled in.
  --
  -- SCOPE, and both halves are deliberate:
  --   * Only fires when the event HAS occurrences. No rows means we do not know
  --     when it is, and refusing on unknown would be a different bug — one live
  --     event legitimately carries none.
  --   * `end_at > now()` allows an event that is CURRENTLY RUNNING, so walk-up
  --     sales during the event still work. It refuses only once every occurrence
  --     has finished.
  --
  -- This is the EVENT-level backstop. #2160's `occurrence_not_available` already
  -- refuses an individual chosen day that has passed; that guard only runs when
  -- the guest sent a day set, which is exactly why this one is needed too.
  --
  -- DELETE THIS BLOCK and a past event becomes payable again.
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.end_at > now()
     ) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- ══ issue #2160 DELTA 3 of 6 — VALIDATE THE DAY SET, READ THE MODE ════
  -- Distinct, ordered by start_at, and every id must be an occurrence OF
  -- THIS EVENT that has not already ended. A day the guest cannot attend is
  -- never allowed to become an entitlement.
  --
  -- DELETE THIS BLOCK and a guest can mint a pass for another event's
  -- occurrence, or for a day that is already over.
  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids, 1) > 0 THEN
    SELECT ARRAY(
             SELECT d.id FROM public.event_dates d
              WHERE d.event_id = p_event_id
                AND d.id = ANY (p_event_date_ids)
              ORDER BY d.start_at, d.id
           )
      INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids, 1), 0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) AS x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_dates d
                WHERE d.id = ANY (v_day_ids) AND d.end_at <= now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count := COALESCE(array_length(v_day_ids, 1), 0);
  END IF;

  -- ══ issue #3313 — NO ORDER WITHOUT A NIGHT ═════════════════════════════
  -- A checkout on an event with more than one bookable date used to finish
  -- with NO day set: orders.event_date_id NULL, no ticket_event_dates, and a
  -- pass that admits on ANY night (I-PROPOSED-2160-A). One predicate decides,
  -- the same one the public reader turns into `isMultiDate`, so the chooser a
  -- guest sees and the refusal here cannot disagree:
  --   * a recurring event with exactly one upcoming date binds to it;
  --   * an event that requires a choice and received none is refused.
  -- Trips, experiences and single-date events: requiresChoice is false and
  -- there is no sole date, so this block is a no-op for them.
  -- DELETE THIS BLOCK and a no-night order is issued again.
  v_day_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_day_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF v_day_count = 0 AND (v_day_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_day_ids := ARRAY[(v_day_choice ->> 'soleOccurrenceId')::uuid];
    v_day_count := 1;
  END IF;
  IF v_day_count = 0 AND COALESCE((v_day_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;
  -- issue #3281 R3 — scoped experiences always need a named occurrence.
  IF v_event.event_type = 'experience'
     AND COALESCE(v_event.capacity_scope, 'total') IN ('per_day', 'per_start')
     AND v_day_count = 0 THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- The organiser's choice. Read ONCE, here, so the whole function agrees.
  SELECT COALESCE(e.multi_date_pricing_mode, 'per_day')
    INTO v_pricing_mode
    FROM public.events e WHERE e.id = p_event_id;

  -- THE ONE MULTIPLIER, APPLIED IN ONE PLACE.
  --   per_day , D days -> D  (D admissions, D passes, D units of capacity)
  --   all_days, D days -> 1  (one pass sold once)
  --   no days chosen    -> 1  (byte-identical to pre-#2160)
  -- Because it multiplies the stored line QUANTITY, pricing, capacity and
  -- the mint loop all see the same number with no special-casing anywhere
  -- downstream (amendment §1 and §8).
  IF v_day_count > 0 AND v_pricing_mode = 'per_day' THEN
    v_day_multiplier := v_day_count;
  END IF;

  -- issue #3281 Round 1 — optional booked start (open-daily experiences).
  -- Required when experience_require_booked_start is on AND the experience is
  -- open-daily (date optional for the required check so no-start identity can
  -- keep an empty day set). Window validation still needs exactly one day when
  -- a start is supplied. Multi-date + start is refused so finalize/scan cannot
  -- apply the first day's instant to every pass.
  IF v_booked_start IS NOT NULL AND v_day_count <> 1 THEN
    RAISE EXCEPTION 'booked_start_invalid';
  END IF;
  v_open_daily := (
    COALESCE(v_event.is_recurring, false)
    AND jsonb_typeof(v_event.recurrence_rules) = 'object'
    AND v_event.recurrence_rules->>'preset' = 'daily'
    AND v_event.recurrence_rules->'termination'->>'kind' = 'never'
  );
  -- Fixed-slot per_start: bind the occurrence opening when the client omitted
  -- bookedStartAt (both pickers send only eventDateId in that mode).
  IF v_booked_start IS NULL
     AND v_event.event_type = 'experience'
     AND COALESCE(v_event.capacity_scope, 'total') = 'per_start'
     AND v_day_count = 1
     AND NOT v_open_daily THEN
    SELECT ed.start_at,
           ed.start_at + make_interval(
             mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
           )
      INTO v_booked_start, v_booked_end
      FROM public.event_dates ed
     WHERE ed.id = v_day_ids[1];
  END IF;
  PERFORM public.issue_3281_validate_booked_start(
    p_event_id,
    CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
    v_booked_start,
    v_booked_end
  );

  -- ══ issue #2462 — CANONICAL LOCK ORDER, TAKEN BEFORE PASS 1 ═══════════
  -- Pass 1 below takes `SELECT … FROM ticket_types … FOR UPDATE` once per
  -- line, in the order the CLIENT sent them, because
  -- `jsonb_array_elements(p_lines)` has no ORDER BY. The cart appends lines in
  -- the order the buyer TAPPED them (CartContext.tsx:290-292), so two guests
  -- who add the same two ticket types in opposite orders take the same two row
  -- locks in opposite orders and DEADLOCK. Postgres kills one; the RPC raises;
  -- the guest is told "Nothing was reserved — please try again". It can only
  -- happen under concurrency, on a multi-ticket-type cart, which is why it
  -- never reproduces in testing.
  --
  -- Proven on production: lines sent as [Day 2, Day 1] were processed
  -- [Day 2, Day 1] — lock order follows the client array verbatim.
  --
  -- Taking every lock ONCE here, ordered by primary key, makes the order
  -- total and identical for every caller. Pass 1's per-line FOR UPDATE then
  -- re-acquires a lock this transaction already holds, which is a no-op, so
  -- NOTHING below changes — including the order line items are inserted in,
  -- which the response's `items` array and its tests depend on.
  --
  -- DELETE THIS BLOCK and the deadlock returns under load.
  PERFORM 1
     FROM public.ticket_types tt
    WHERE tt.id IN (
            SELECT DISTINCT (l ->> 'ticketTypeId')::uuid
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId') IS NOT NULL
          )
      AND tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    ORDER BY tt.id
      FOR UPDATE;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
    v_qty := v_qty_raw;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    -- #2879 / #2947 slice 7 — pre-sale queue: an armed tier may mint an
    -- infinity hold before sale_start_at so rule 6's join can form. Ordinary
    -- (finite-expiry) creates still refuse until the sale opens.
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      IF NOT (
        p_expires_at = 'infinity'::timestamptz
        AND EXISTS (
          SELECT 1 FROM public.ticket_queue_arming a
           WHERE a.ticket_type_id = v_ticket_type.id
             AND a.disarmed_at IS NULL
        )
      ) THEN
        RAISE EXCEPTION 'ticket_sales_not_started';
      END IF;
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    -- ══ issue #2160 DELTA 4 of 6 — THE PER-DAY MULTIPLIER ═══════════════
    -- Applied AFTER min_purchase_qty / max_purchase_qty, which stay per LINE
    -- and therefore mean "per day" — an organiser capping a guest at 4
    -- tickets means 4 per day, not 4 across a three-day festival. Applied
    -- BEFORE capacity and pricing, which must both see the real number of
    -- admissions. v_day_multiplier is 1 on every pre-#2160 path.
    v_qty := v_qty_raw * v_day_multiplier;

    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      -- issue #2491 C2 step 3 — THE COUNTER, not the count.
      -- Was: COUNT(*) over public.tickets, measured at 18.71 ms per call once a
      -- ticket type holds 100k rows, executed INSIDE the serialized critical
      -- section so every other buyer waits behind it. Now a column read.
      -- sold_count is maintained by issue_2491_tickets_counters, which fires on
      -- INSERT, DELETE and UPDATE OF (status, ticket_type_id) — precisely the
      -- columns this formula reads — and RECOMPUTES from
      -- issue_2491_derived_sold rather than incrementing. Its only failure mode
      -- is structural (the trigger removed), never gradual, and 288 consecutive
      -- shadow observations over 77.7 h reported zero drift across 699 sales.
      -- ══ issue #3313 — CAPACITY PER NIGHT ON A RECURRING EVENT (Seth) ═══
      -- quantity_total is the capacity of EACH night, not of the whole run.
      -- For every chosen night: places already taken that night (sold + held,
      -- issue_3313_ticket_type_occurrence_taken — the ONE per-night counter,
      -- also used by the public reader's `remaining`) plus this cart's raw
      -- quantity of the type must fit. per_day stores quantity x D and mints q
      -- passes per night; all_days mints q passes valid on every chosen night;
      -- both consume q places per night. Every other event keeps the shared
      -- check below, verbatim.
      -- DELETE THIS BRANCH and a recurring event's 60 places are shared by
      -- every night of the run.
      IF v_per_occurrence AND v_day_count > 0 THEN
        SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
          INTO v_cart_qty_for_type
          FROM jsonb_array_elements(p_lines) AS l
         WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY v_day_ids LOOP
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded';
            END IF;
          END LOOP;
        END IF;
      ELSIF v_event.event_type = 'experience'
            AND COALESCE(v_event.capacity_scope, 'total') IN ('per_day', 'per_start') THEN
        -- Scoped counters are enforced in the R3 block below; skip lifetime.
        NULL;
      ELSE
      -- (the shared check, verbatim from 20270609002879)
      SELECT tt2.sold_count
        INTO v_sold
        FROM public.ticket_types tt2
       WHERE tt2.id = v_ticket_type.id;

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    -- #3281 R2 units: person = price×qty; group = price×groups (party does not
    -- multiply); block = (price×blocks)×qty with blocks from booked range.
    v_unit_price := v_ticket_type.price_cents;
    v_admits := 1;
    v_basis := COALESCE(v_ticket_type.price_basis, 'person');
    IF v_event.event_type = 'experience' AND v_basis = 'group' THEN
      IF p_booked_party_size IS NULL OR p_booked_party_size < 1
         OR v_ticket_type.group_max IS NULL
         OR p_booked_party_size > v_ticket_type.group_max THEN
        RAISE EXCEPTION 'booked_party_invalid';
      END IF;
      v_admits := v_ticket_type.group_max;
      -- unit stays option price; quantity is number of groups
    ELSIF v_event.event_type = 'experience' AND v_basis = 'block' THEN
      IF v_booked_start IS NULL OR v_booked_end IS NULL
         OR v_ticket_type.block_minutes IS NULL THEN
        RAISE EXCEPTION 'booked_length_invalid';
      END IF;
      IF v_booked_end <= v_booked_start THEN
        RAISE EXCEPTION 'booked_length_invalid';
      END IF;
      v_blocks := (EXTRACT(EPOCH FROM (v_booked_end - v_booked_start))
                   / (v_ticket_type.block_minutes::numeric * 60.0))::integer;
      IF v_blocks < COALESCE(v_ticket_type.min_blocks, 1)
         OR v_blocks > COALESCE(v_ticket_type.max_blocks, v_blocks) THEN
        RAISE EXCEPTION 'booked_length_invalid';
      END IF;
      v_unit_price := v_ticket_type.price_cents * v_blocks;
      v_admits := 1;
    END IF;

    -- issue #3281 R3 — capacity_scope counters (cart-aggregated like lifetime).
    IF v_event.event_type = 'experience'
       AND v_ticket_type.quantity_total IS NOT NULL THEN
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
      IF COALESCE(v_event.capacity_scope, 'total') = 'per_start'
         AND v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      ELSIF COALESCE(v_event.capacity_scope, 'total') = 'per_day'
         AND v_day_count = 1 THEN
        IF public.issue_3313_ticket_type_occurrence_taken(
             v_ticket_type.id, v_day_ids[1]
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'ticket_capacity_exceeded';
        END IF;
      ELSIF v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      END IF;
    END IF;

    v_total := v_total + (v_unit_price * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_unit_price,
      'totalCents', v_unit_price * v_qty,
      'admitsCount', v_admits
    ));
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- ---------------- Pass 2: per-line installment math (META-ORCH-1174 B1). ----------------
  -- For trips only, walk the BUILT line items (v_items carries the per-line
  -- totals). For each line, look up its package's tier_metadata.installments.
  -- A line with a plan (and not opted to pay-full) contributes its OWN deposit
  -- to "due today" + its OWN installment entries to the union; a line without a
  -- plan contributes its full total to "due today". The union is then re-
  -- numbered ordinal 1..M sorted by dueAt.
  --
  -- ORCH-0915 opt-out: p_payment_plan_choice='full' ⇒ NO line installments at
  -- all (every line pays full now). This is the session-wide pay-in-full path.
  IF v_is_trip AND p_payment_plan_choice <> 'full' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_total := (v_line ->> 'totalCents')::bigint;
      v_tier_metadata := NULL;

      SELECT tpt.tier_metadata
        INTO v_tier_metadata
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = p_event_id
         AND tpt.ticket_type_id = (v_line ->> 'ticketTypeId')::uuid;

      v_installments_input := CASE
        WHEN v_tier_metadata IS NOT NULL THEN v_tier_metadata -> 'installments'
        ELSE NULL
      END;

      IF v_installments_input IS NOT NULL
         AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- This package carries a payment plan → compute its per-line schedule.
        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        -- First pass over THIS line's installments: validate + accumulate pct.
        v_pct_sum := v_deposit_pct;
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
        END LOOP;

        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Second pass: amounts scaled by THIS LINE's total, last-absorbs-rounding.
        v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint;
        v_line_running := 0;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint;
            v_line_running := v_line_running + v_inst_amount;
          ELSE
            v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          -- Append to the UNION with a sortable dueAt (ordinal re-numbered below).
          v_unioned := v_unioned || jsonb_build_array(jsonb_build_object(
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sourceTicketTypeId', (v_line ->> 'ticketTypeId'),
            'sourceOrdinal', v_inst_ord
          ));
        END LOOP;

        v_due_today_cents := v_due_today_cents + v_line_deposit_cents;
        v_any_installments := true;
      ELSE
        -- No plan on this package → its full total is due today.
        v_due_today_cents := v_due_today_cents + v_line_total;
      END IF;
    END LOOP;
  END IF;

  -- ---------------- Finalize the schedule + the deposit override. ----------------
  -- When at least one line produced installments, override v_total to the summed
  -- "due today" (Σ deposits + Σ non-plan fulls) and build the unioned schedule
  -- with sequential ordinals 1..M sorted by dueAt (then stable source order). The
  -- persisted shape is byte-identical to the single-line ORCH-0869 schedule.
  IF v_any_installments THEN
    v_total := v_due_today_cents::integer;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'ordinal', rn,
               'pct', (elem ->> 'pct')::numeric,
               'amountCents', (elem ->> 'amountCents')::bigint,
               'dueAt', elem ->> 'dueAt'
             )
             ORDER BY rn
           ), '[]'::jsonb)
      INTO v_unioned
      FROM (
        SELECT elem,
               row_number() OVER (
                 ORDER BY (elem ->> 'dueAt') ASC, (elem ->> 'sourceOrdinal')::int ASC
               ) AS rn
        FROM jsonb_array_elements(v_unioned) AS elem
      ) ranked;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot,
    -- issue #3281 — guest-chosen start (open-daily); NULL = legacy / slots / flag-off.
    booked_start_at,
    booked_end_at,
    booked_party_size
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END,
    v_pricing_mode,
    v_booked_start,
    v_booked_end,
    p_booked_party_size
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );
END;
$function$;


DROP FUNCTION IF EXISTS public.biz_ticket_checkout_create_session(
  uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer
);

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_decision text;
  v_replay_decision text;
  v_snapshot jsonb;
  v_mode text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- #2101 — fresh decision BEFORE the idempotency replay owner.
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, p_buyer_user_id);
  IF v_decision='sign_in_required' THEN
    RAISE EXCEPTION 'checkout_sign_in_required';
  END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN
    RAISE EXCEPTION 'checkout_restricted';
  END IF;
  v_snapshot := public.issue_2101_current_access_snapshot(p_event_id,p_buyer_user_id);
  v_mode := v_snapshot->>'mode';

  -- issue #2696 — SCOPED TO THE EVENT BEING BOUGHT.
  --
  -- This lookup resolved a session by idempotency key ALONE. The key is globally
  -- UNIQUE with no event or brand column, and its event-scoping was only ever an
  -- implicit property of how the edge composed it. That made it defeatable the
  -- moment a caller could supply their own key, which the edge accepted verbatim
  -- until #2696 removed it.
  --
  -- The conjunct here is the durable half of that fix: even a caller-supplied or
  -- colliding key can no longer return a session belonging to a different event.
  -- Without it, a request naming event B could be answered with event A's
  -- session, and every decision after this point — the #2101 access mode, the
  -- named-buyer cross-check, the status-token write — was then made against B's
  -- rules on A's row.
  --
  -- NOT A BEHAVIOUR CHANGE: all 179 live sessions already satisfy
  -- `idempotency_key LIKE 'ticket_checkout:' || event_id || ':%'`, and 0 do not.
  -- A legitimate resubmit derives the same key for the same event and still
  -- finds its row.
  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key
     AND event_id=p_event_id;

  IF FOUND THEN
    -- ═══════════════════════════════════════════════════════════════════════
    -- issue #2150 — A COMPLETED **FREE** RESERVATION IS RETURNED, NOT REMINTED.
    --
    -- This block is evaluated BEFORE the ORCH-0791 terminal tombstone and
    -- before the ORCH-0829-B D-1 expiry tombstone, and it is the ONLY thing
    -- that changed in this function. Every conjunct is load-bearing:
    --
    --   status='free_completed'  the only status `biz_ticket_checkout_finalize`
    --                            assigns when `total_cents = 0`.
    --   total_cents = 0          independent proof this carried NO money, so
    --                            the paid arm cannot enter here even if a
    --                            status were corrupted. THIS is the conjunct
    --                            that scopes the change to the zero-total case.
    --   order_id IS NOT NULL     there is something to hand back.
    --   revoked_at IS NULL       the sale was not revoked (#2079 / #1930).
    --   buyer identity matches   an anonymous guest is (NULL,NULL) and matches
    --                            itself; a DIFFERENT signed-in user presenting
    --                            the same derived key falls through to today's
    --                            behaviour rather than being handed someone
    --                            else's passes.
    --   a live ticket exists     a cancelled / refunded / voided reservation is
    --                            NOT a reservation the guest still holds, so it
    --                            falls through and they can re-reserve.
    --
    -- On a match the guest's ORIGINAL session is returned untouched: the key is
    -- NOT renamed, no row is inserted, and `ticket-checkout-create` answers
    -- with that same order's already-issued tickets — one order, one ticket,
    -- one confirmation email and one SMS, however many times they submit.
    -- ═══════════════════════════════════════════════════════════════════════
    IF v_existing.status='free_completed'
       AND COALESCE(v_existing.total_cents,0)=0
       AND v_existing.order_id IS NOT NULL
       AND v_existing.revoked_at IS NULL
       AND v_existing.buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
       AND EXISTS(SELECT 1 FROM public.tickets t
                   WHERE t.order_id=v_existing.order_id
                     AND t.status IN ('valid','used','transferred')) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;

    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key=idempotency_key || ':tombstone:' || id::text,
             status=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at=now()
       WHERE id=v_existing.id;
    ELSE
      v_replay_decision := public.issue_2101_ticket_checkout_access_decision(
        p_event_id, v_existing.buyer_user_id,
        v_existing.checkout_access_mode_snapshot,
        v_existing.checkout_access_restrictive_epoch_snapshot,
        v_existing.checkout_access_membership_id_snapshot,
        v_existing.checkout_access_membership_epoch_snapshot);
      IF v_replay_decision NOT IN ('allowed_unrestricted','allowed_named')
         OR (v_mode='named_buyers'
             AND v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
        RAISE EXCEPTION 'checkout_restricted';
      END IF;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'totalCents',i.total_cents
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule
      );
    END IF;
  END IF;

  -- issue #2160 DELTA 2 of 2 — forward the day set. NOTHING ELSE IN THIS
  -- FUNCTION CHANGED: the #2150 free-completed exemption above, the ORCH-0791
  -- terminal tombstone, the ORCH-0829-B expiry tombstone, the #2101 fresh
  -- decision, the event -> brand lock order and the access snapshot write-back
  -- are byte-preserved from 20270419002150:158-358.
  -- issue #3281 / R2 — forward optional start, end, and party size.
  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice,p_event_date_ids,
    p_booked_start_at,p_booked_end_at,p_booked_party_size);

  v_session_id := (v_result->>'checkoutSessionId')::uuid;
  IF v_session_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_sessions SET
      checkout_access_mode_snapshot=v_mode,
      checkout_access_restrictive_epoch_snapshot=
        COALESCE((v_snapshot->>'restrictiveEpoch')::bigint,0),
      checkout_access_membership_id_snapshot=
        NULLIF(v_snapshot->>'membershipId','')::uuid,
      checkout_access_membership_epoch_snapshot=
        NULLIF(v_snapshot->>'membershipEpoch','')::bigint
    WHERE id=v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId',v_result->'checkoutSessionId',
    'eventId',v_result->'eventId',
    'brandId',v_result->'brandId',
    'status',v_result->'status',
    'totalCents',v_result->'totalCents',
    'subtotalCents',v_result->'subtotalCents',
    'currency',v_result->'currency',
    'stripeAccountId',v_result->'stripeAccountId',
    'orderId',v_result->'orderId',
    'items',v_result->'items',
    'lineItems',v_result->'lineItems',
    'installmentSchedule',v_result->'installmentSchedule'
  );
END $function$;


REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pg_public_experience_by_slug(p_brand_slug text, p_experience_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ex AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug                AS event_slug,
      e.status,
      e.visibility,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.is_recurring,
      e.is_multi_date,
      e.recurrence_rules,
      COALESCE(e.capacity_scope, 'total') AS capacity_scope,
      COALESCE(e.booking_spacing_minutes, 30) AS booking_spacing_minutes,
      COALESCE(e.min_notice_minutes, 120) AS min_notice_minutes,
      e.experience_intents,
      e.pass_mingla_fee,
      e.pass_service_fee,
      e.theme               AS public_theme,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.refund_policy,
      -- hideAddressUntilTicket lives in theme.business_event (jsonb); default TRUE
      -- for safety (mirror the service + venue mapper fail-closed semantics).
      public.issue_2489_address_withheld(e.theme) AS hide_address,
      b.id                  AS brand_id_b,
      b.slug                AS brand_slug,
      b.name                AS brand_name,
      b.description         AS brand_description,
      b.cover_media_url     AS brand_cover_media_url,
      b.cover_media_type    AS brand_cover_media_type,
      b.cover_hue           AS brand_cover_hue,
      b.theme_color         AS brand_theme_color,
      b.theme_font          AS brand_theme_font,
      b.theme_animation     AS brand_theme_animation,
      (b.claim_status = 'verified') AS brand_is_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE b.slug = p_brand_slug
      AND e.slug = p_experience_slug
      AND e.event_type = 'experience'           -- experience ONLY
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      -- issue #2117 -- the offering visibility rule is expressed ONLY through
      -- the Offering Visibility Gate. Do NOT write it locally here or anywhere
      -- else. The e.status predicate ABOVE deliberately stays local and
      -- verbatim (A-4.2): this reader admits four statuses where its family
      -- sibling admits two.
      -- NOTE: this reader EMITS the offering's own visibility value into its
      -- response. Before #2117 it did so while filtering on nothing. The gate
      -- below is what makes that emission safe.
      AND public.pg_offering_visibility_gate(e.visibility, e.deleted_at, 'listing')
    LIMIT 1
  ),
  -- the ONE sellable ticket (lowest display_order, non-hidden, not deleted).
  tk AS (
    SELECT
      tt.id,
      tt.name,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.available_online,
      tt.price_basis,
      tt.block_minutes,
      tt.min_blocks,
      tt.max_blocks,
      tt.group_max,

      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ex.pass_mingla_fee,
               ex.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining (GREATEST(total - sold, 0)); NULL for unlimited. Sold formula
      -- IDENTICAL to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        -- Scoped inventory lives on day/slot chips; never lifetime-disable Reserve.
        WHEN ex.capacity_scope IN ('per_day', 'per_start') THEN NULL
        ELSE GREATEST(
          0,
          tt.quantity_total - COALESCE((
            SELECT COUNT(*)::integer
            FROM public.tickets t
            WHERE t.ticket_type_id = tt.id
              AND t.status IN ('valid', 'used', 'transferred')
          ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ex ON ex.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
    ORDER BY tt.display_order ASC NULLS LAST, tt.created_at ASC
    LIMIT 1
  )
  SELECT
    CASE WHEN ex.id IS NULL THEN NULL ELSE json_build_object(
      'id', ex.id,
      'brandId', ex.brand_id,
      'brandSlug', ex.brand_slug,
      'experienceSlug', ex.event_slug,
      'title', ex.title,
      'description', ex.description,
      'status', ex.status,
      'visibility', ex.visibility,
      'timezone', COALESCE(ex.timezone, 'UTC'),
      'currency', COALESCE(ex.currency, 'usd'),
      'coverMediaUrl', ex.cover_media_url,
      'coverMediaType', ex.cover_media_type,
      'coverMediaAlt', ex.cover_media_alt,
      'coverGallery', COALESCE(ex.cover_media_gallery, '[]'::jsonb),
      'venueText', COALESCE(
        NULLIF((ex.public_theme #>> '{experience_meta,venue_text}'), ''),
        (SELECT s.address FROM public.experience_stops s
          WHERE s.event_id = ex.id ORDER BY s.stop_order ASC LIMIT 1)
      ),
      'isRecurring', COALESCE(ex.is_recurring, false),
      'isMultiDate', COALESCE(ex.is_multi_date, false),
      'recurrenceRules', ex.recurrence_rules,
      'intents', COALESCE(to_json(ex.experience_intents), '[]'::json),
      'hideAddressUntilTicket', ex.hide_address,
      'themeColorOverride', ex.theme_color_override,
      'themeFontOverride', ex.theme_font_override,
      'themeAnimationOverride', ex.theme_animation_override,
      'brand', json_build_object(
        'id', ex.brand_id_b,
        'slug', ex.brand_slug,
        'name', ex.brand_name,
        'bio', ex.brand_description,
        'coverMediaUrl', ex.brand_cover_media_url,
        'coverMediaType', ex.brand_cover_media_type,
        'coverHue', ex.brand_cover_hue,
        'verified', COALESCE(ex.brand_is_verified, false),
        'themeColor', ex.brand_theme_color,
        'themeFont', ex.brand_theme_font,
        'themeAnimation', ex.brand_theme_animation
      ),
      -- itinerary stops — ADDRESS-PRIVACY-AWARE (NULL street/lat/lng when hidden).
      'stops', COALESCE((
        SELECT json_agg(json_build_object(
          'id', s.id,
          'stopOrder', s.stop_order,
          'placeName', s.place_name,
          'address', CASE WHEN ex.hide_address THEN NULL ELSE NULLIF(s.address, '') END,
          'description', NULLIF(s.ai_description, ''),
          'startTime', s.start_time,
          -- issue #3281 R3 — minutes from guest start (open-hours); null → clock startTime
          'startOffsetMinutes', s.start_offset_minutes,
          'lat', CASE WHEN ex.hide_address THEN NULL ELSE s.lat END,
          'lng', CASE WHEN ex.hide_address THEN NULL ELSE s.lng END,
          'imageUrls', COALESCE(to_json(s.image_urls), '[]'::json)
        ) ORDER BY s.stop_order ASC)
        FROM public.experience_stops s
        WHERE s.event_id = ex.id
      ), '[]'::json),
      -- the ONE sellable ticket (per-stop summed all-in, ORCH-1151).
      'ticket', (
        SELECT CASE WHEN tk.id IS NULL THEN NULL ELSE json_build_object(
          'ticketTypeId', tk.id,
          'name', tk.name,
          'priceCents', COALESCE(tk.price_cents, 0),
          'allInCents', tk.all_in_cents,
          'currency', COALESCE(tk.currency, ex.currency, 'usd'),
          'quantityTotal', tk.quantity_total,
          'isUnlimited', COALESCE(tk.is_unlimited, false),
          'isFree', COALESCE(tk.is_free, false) OR COALESCE(tk.price_cents, 0) = 0,
          'ticketsRemaining', tk.remaining,
          'availableOnline', COALESCE(tk.available_online, false),
          'priceBasis', COALESCE(tk.price_basis, 'person'),
          'blockMinutes', tk.block_minutes,
          'minBlocks', tk.min_blocks,
          'maxBlocks', tk.max_blocks,
          'groupMax', tk.group_max
        ) END
        FROM tk
      ),
      -- #3281 R2: all sellable options (ticket = default / first by display_order)
      'options', COALESCE((
        SELECT json_agg(json_build_object(
          'ticketTypeId', o.id,
          'name', o.name,
          'priceCents', COALESCE(o.price_cents, 0),
          'allInCents', CASE
            WHEN COALESCE(o.is_free, false) OR COALESCE(o.price_cents, 0) = 0 THEN 0
            ELSE public.compute_all_in_cents(
                   o.price_cents,
                   ex.pass_mingla_fee,
                   ex.pass_service_fee,
                   (SELECT r.effective_take_rate_bps
                      FROM public.resolve_effective_take_rate_bps(ex.brand_id) AS r)
                 )
          END,
          'currency', COALESCE(o.currency, ex.currency, 'usd'),
          'quantityTotal', o.quantity_total,
          'isUnlimited', COALESCE(o.is_unlimited, false),
          'isFree', COALESCE(o.is_free, false) OR COALESCE(o.price_cents, 0) = 0,
          'ticketsRemaining', CASE
            WHEN COALESCE(o.is_unlimited, false) THEN NULL
            WHEN o.quantity_total IS NULL THEN NULL
            WHEN ex.capacity_scope IN ('per_day', 'per_start') THEN NULL
            ELSE GREATEST(
              0,
              o.quantity_total - (
                SELECT COUNT(*)::integer FROM public.tickets t
                 WHERE t.ticket_type_id = o.id
                   AND t.status IN ('valid','used','transferred')
              )
            )
          END,
          'availableOnline', COALESCE(o.available_online, false),
          'priceBasis', COALESCE(o.price_basis, 'person'),
          'blockMinutes', o.block_minutes,
          'minBlocks', o.min_blocks,
          'maxBlocks', o.max_blocks,
          'groupMax', o.group_max
        ) ORDER BY o.display_order, o.created_at)
        FROM public.ticket_types o
        WHERE o.event_id = ex.id
          AND o.deleted_at IS NULL
          AND COALESCE(o.is_hidden, false) IS NOT TRUE
          AND COALESCE(o.is_disabled, false) IS NOT TRUE
      ), '[]'::json),
      -- bookable occurrences (event_dates) with per-occurrence remaining stamped
      -- from the ONE ticket's event-level remaining (Q2: no per-occurrence cap).
      'dates', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'startAt', d.start_at,
          'endAt', d.end_at,
          'timezone', d.timezone,
          'isMaster', COALESCE(d.is_master, false),
          -- issue #3281 R3 — per_day/per_start day chips use occurrence taken;
          -- total keeps the event-level remaining (legacy).
          'ticketsRemaining', CASE
            WHEN (SELECT tk.is_unlimited FROM tk) THEN NULL
            WHEN (SELECT tk.quantity_total FROM tk) IS NULL THEN NULL
            WHEN ex.capacity_scope = 'per_day' THEN GREATEST(
              0,
              (SELECT tk.quantity_total FROM tk)
                - public.issue_3313_ticket_type_occurrence_taken(
                    (SELECT tk.id FROM tk), d.id)
            )
            WHEN ex.capacity_scope = 'per_start' THEN GREATEST(
              0,
              (SELECT tk.quantity_total FROM tk)
                - COALESCE((
                    SELECT MIN(public.issue_3281_ticket_type_slot_taken(
                      (SELECT tk.id FROM tk),
                      d.id,
                      gs,
                      gs + make_interval(mins => COALESCE(ex.booking_spacing_minutes, 30)),
                      NULL
                    ))
                    FROM generate_series(
                      d.start_at,
                      d.end_at - interval '1 microsecond',
                      make_interval(mins => COALESCE(ex.booking_spacing_minutes, 30))
                    ) AS gs
                    WHERE gs >= now() + make_interval(mins => COALESCE(ex.min_notice_minutes, 120))
                  ), 0)
            )
            ELSE (SELECT tk.remaining FROM tk)
          END
        ) ORDER BY d.start_at ASC)
        FROM public.event_dates d
        WHERE d.event_id = ex.id
      ), '[]'::json),
      -- bookable: free → always true; paid → pg_brand_can_collect.
      'bookable', CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM tk
          WHERE tk.available_online = true
            AND COALESCE(tk.price_cents, 0) > 0
        ) THEN true
        ELSE public.pg_brand_can_collect(ex.brand_id)
      END,
      'capacityScope', ex.capacity_scope,
      'spacingMinutes', ex.booking_spacing_minutes,
      'minNoticeMinutes', ex.min_notice_minutes,
      'refundPolicy', ex.refund_policy
    ) END
  FROM ex;
$function$
;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='events'
       AND column_name='booking_spacing_minutes'
  ) THEN
    RAISE EXCEPTION 'issue_3281_r3_verify: booking_spacing_minutes missing';
  END IF;
  IF position('spots_scope_requires_start_time' IN
       pg_get_functiondef('public.issue_3281_apply_experience_r3_settings(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_r3_verify: rule A missing';
  END IF;
  IF position('spacingMinutes' IN
       pg_get_functiondef('public.pg_public_experience_by_slug(text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_r3_verify: public missing spacingMinutes';
  END IF;
  IF position('issue_3281_apply_experience_r3_settings' IN
       pg_get_functiondef('public.biz_create_experience(uuid,jsonb,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_r3_verify: create missing R3 apply';
  END IF;
END
$verify$;

COMMIT;
