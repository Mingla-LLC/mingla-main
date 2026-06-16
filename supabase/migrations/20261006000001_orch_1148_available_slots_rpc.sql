-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — pg_venue_available_slots (THE ENGINE)  ⭐
-- ---------------------------------------------------------------------------
-- The net-new server logic: the availability / turn-time compute engine. A
-- single Postgres SECURITY DEFINER function that, given (brand, date, party),
-- returns the bookable time slots computed from tables + hours + turn-times +
-- buffers + max-per-slot + blackouts + the already-booked `reservations`.
--
-- ARCHITECTURE (SPEC §5.0): Postgres RPC, NOT an edge fn — pure relational
-- compute over data that all lives in PG, computed in-place with the §4.2
-- indexes. Mirrors the deck-supply (pg_eligible_experiences_for_deck) +
-- tier-all-in (pg_public_event_tier_allin) precedent.
--
-- FROZEN CONTRACT (the reuse boundary 2.2 calls VERBATIM):
--   pg_venue_available_slots(p_brand_id uuid, p_date date, p_party_size int)
--   RETURNS TABLE (
--     slot_start_utc   timestamptz,  -- bookable slot start, UTC
--     slot_local_label text,         -- 'HH:MM' venue-local convenience label
--     remaining        int,          -- max_per_slot − already-booked (full→0)
--     is_full          boolean       -- full rows ARE returned (show "full")
--   )
--
-- 2.1a GRANT BOUNDARY: EXECUTE granted to `authenticated` ONLY (the operator
-- manual-create picker is the sole caller this ship). The 2.2 consumer surface
-- adds `GRANT EXECUTE … TO anon` — that is the ONLY future widening, called out
-- as a named seam below. NO anon grant here.
--
-- Additive-only. CREATE OR REPLACE FUNCTION. $function$ dollar-tag closed BEFORE
-- the REVOKE/GRANT block. STABLE (reads only; depends on now() for the window
-- cutoff — documented). MONOTONIC VERSION 20261006000001. Apply via the Supabase
-- Management API; never `supabase db push`.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_venue_available_slots(
  p_brand_id   uuid,
  p_date       date,
  p_party_size int
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
  v_enabled       boolean;
  v_cfg           public.venue_availability_config%ROWTYPE;
  v_offset_min    int;          -- venue UTC offset in minutes (e.g. EST = -300)
  v_dow           int;          -- 0..6 (Sun..Sat) for p_date
  v_period        jsonb;
  v_turn_min      int;          -- turn time for p_party_size (minutes)
  v_buffer_min    int;
  v_gran_min      int;
  v_eligible_cnt  int;          -- count of party-fitting active reservable tables
  v_eligible_ids  uuid[];       -- the eligible table ids (NULL-table reservations also overlap)
  v_cap_per_slot  int;          -- LEAST(max_per_slot ?? eligible_cnt, eligible_cnt)
  v_now           timestamptz := now();
BEGIN
  IF p_brand_id IS NULL OR p_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN;  -- no rows
  END IF;

  -- (1) GATE: the venue must be reservable, and have an availability config.
  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE brand_id = p_brand_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT * INTO v_cfg
  FROM public.venue_availability_config
  WHERE brand_id = p_brand_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_buffer_min := COALESCE(v_cfg.buffer_minutes, 0);
  v_gran_min   := COALESCE(v_cfg.slot_granularity_minutes, 15);
  IF v_gran_min < 1 THEN
    v_gran_min := 15;  -- defensive: never a zero step (infinite loop guard)
  END IF;

  -- Venue UTC offset (minutes). Resolve via the brand's place_pool row; fall
  -- back to 0 (UTC) when unknown so the engine never crashes on a NULL offset.
  SELECT pp.utc_offset_minutes INTO v_offset_min
  FROM public.place_pool pp
  WHERE pp.id = COALESCE(
    v_cfg.place_pool_id,
    (SELECT brs.place_pool_id FROM public.venue_reservation_settings brs WHERE brs.brand_id = p_brand_id)
  );
  v_offset_min := COALESCE(v_offset_min, 0);

  -- (3) TURN TIME: pick the bucket whose numeric party key is the largest key
  -- <= p_party_size; if none, fall back to the max bucket present; if the JSON
  -- is empty, default to 90 minutes.
  SELECT (kv.value)::int INTO v_turn_min
  FROM jsonb_each_text(COALESCE(v_cfg.turn_times, '{}'::jsonb)) AS kv
  WHERE kv.key ~ '^p[0-9]+$'
    AND (substring(kv.key from 2))::int <= p_party_size
  ORDER BY (substring(kv.key from 2))::int DESC
  LIMIT 1;
  IF v_turn_min IS NULL THEN
    SELECT (kv.value)::int INTO v_turn_min
    FROM jsonb_each_text(COALESCE(v_cfg.turn_times, '{}'::jsonb)) AS kv
    WHERE kv.key ~ '^p[0-9]+$'
    ORDER BY (substring(kv.key from 2))::int DESC
    LIMIT 1;
  END IF;
  v_turn_min := COALESCE(v_turn_min, 90);

  -- (5) WHOLE-DAY BLACKOUT (applies_to='all') → zero slots for the date. Zone/
  -- table-scoped blackouts reduce eligible tables in step (6), not the day.
  IF EXISTS (
    SELECT 1 FROM public.venue_blackouts b
    WHERE b.brand_id = p_brand_id
      AND b.applies_to = 'all'
      AND p_date BETWEEN b.date_start AND b.date_end
  ) THEN
    RETURN;
  END IF;

  -- (6) ELIGIBLE TABLES for the party: active, reservable (NOT walk_in_only /
  -- approval_required), and the party_fit rule
  -- (p_party_size BETWEEN min_party..COALESCE(max_party, capacity)). Subtract
  -- tables under a zone/table-scoped blackout that overlaps p_date.
  SELECT array_agg(t.id), count(*)::int
  INTO v_eligible_ids, v_eligible_cnt
  FROM public.venue_tables t
  WHERE t.brand_id = p_brand_id
    AND t.is_active
    AND t.reservation_policy = 'reservable'
    AND p_party_size BETWEEN COALESCE(t.min_party, 1) AND COALESCE(t.max_party, t.capacity)
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_blackouts b
      WHERE b.brand_id = p_brand_id
        AND p_date BETWEEN b.date_start AND b.date_end
        AND (
          (b.applies_to = 'table' AND b.table_id = t.id)
          OR (b.applies_to = 'zone' AND b.zone IS NOT DISTINCT FROM t.zone)
        )
    );

  v_eligible_cnt := COALESCE(v_eligible_cnt, 0);
  IF v_eligible_cnt = 0 THEN
    RETURN;  -- no table can seat this party today
  END IF;

  -- (7) per-slot capacity ceiling.
  v_cap_per_slot := LEAST(COALESCE(v_cfg.max_reservations_per_slot, v_eligible_cnt), v_eligible_cnt);

  v_dow := EXTRACT(dow FROM p_date)::int;

  -- (2) Resolve the venue day from service_periods whose days[] includes the
  -- date's day-of-week; (2)+(4) generate candidate slot starts and apply the
  -- windows; (7) compute remaining by subtracting overlapping live reservations.
  RETURN QUERY
  WITH periods AS (
    SELECT
      pr.value->>'start' AS p_start,
      pr.value->>'end'   AS p_end
    FROM jsonb_array_elements(COALESCE(v_cfg.service_periods, '[]'::jsonb)) AS pr(value)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(pr.value->'days', '[]'::jsonb)) AS d(dow)
      WHERE d.dow::int = v_dow
    )
      AND (pr.value->>'start') ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND (pr.value->>'end')   ~ '^[0-2][0-9]:[0-5][0-9]$'
  ),
  bounds AS (
    -- venue-local period bounds as timestamptz (anchor at the venue's local
    -- midnight, materialised in UTC via the offset). slot_local + turn + buffer
    -- must not run past the period end (no half-seatings).
    SELECT
      -- venue-local midnight of p_date expressed in UTC (cast to timestamptz so
      -- the slot column matches the frozen-contract timestamptz return type;
      -- the value is an absolute instant, NOT session-tz-dependent).
      (((p_date::timestamp) - make_interval(mins => v_offset_min)) AT TIME ZONE 'UTC') AS local_midnight_utc,
      ((split_part(p.p_start, ':', 1))::int * 60 + (split_part(p.p_start, ':', 2))::int) AS start_min,
      ((split_part(p.p_end,   ':', 1))::int * 60 + (split_part(p.p_end,   ':', 2))::int) AS end_min
    FROM periods p
  ),
  candidates AS (
    SELECT
      (b.local_midnight_utc + make_interval(mins => g.minute_of_day)) AS slot_utc,
      g.minute_of_day
    FROM bounds b
    CROSS JOIN LATERAL generate_series(
      b.start_min,
      -- last start that still fits a full seating before the period end.
      b.end_min - (v_turn_min + v_buffer_min),
      v_gran_min
    ) AS g(minute_of_day)
    WHERE b.end_min - (v_turn_min + v_buffer_min) >= b.start_min
  ),
  windowed AS (
    SELECT DISTINCT c.slot_utc, c.minute_of_day
    FROM candidates c
    WHERE c.slot_utc >= v_now + make_interval(mins => COALESCE(v_cfg.min_notice_minutes, 0))
      AND p_date <= (((v_now AT TIME ZONE 'UTC') + make_interval(mins => v_offset_min))::date
                      + COALESCE(v_cfg.advance_window_days, 30))
  ),
  scored AS (
    SELECT
      w.slot_utc,
      w.minute_of_day,
      v_cap_per_slot - (
        -- overlapping LIVE reservations: a reservation seating
        -- [reserved_for, reserved_for + v_turn_min) intersects the candidate
        -- seating [slot_utc, slot_utc + v_turn_min + v_buffer_min), whose table
        -- is eligible OR is unassigned (NULL table still consumes capacity).
        SELECT count(*)::int
        FROM public.reservations r
        WHERE r.brand_id = p_brand_id
          AND r.status IN ('requested', 'confirmed', 'seated')
          AND (r.table_id IS NULL OR r.table_id = ANY (v_eligible_ids))
          AND r.reserved_for < (w.slot_utc + make_interval(mins => v_turn_min + v_buffer_min))
          AND (r.reserved_for + make_interval(mins => v_turn_min)) > w.slot_utc
      ) AS remaining_calc
    FROM windowed w
  )
  SELECT
    s.slot_utc AS slot_start_utc,
    -- venue-local wall-clock label, computed tz-independently: take the UTC
    -- wall clock of the instant, shift by the venue offset, render HH:MM.
    to_char((s.slot_utc AT TIME ZONE 'UTC') + make_interval(mins => v_offset_min), 'HH24:MI') AS slot_local_label,
    GREATEST(s.remaining_calc, 0) AS remaining,
    (s.remaining_calc <= 0) AS is_full
  FROM scored s
  ORDER BY s.slot_utc;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_venue_available_slots(uuid, date, int) FROM PUBLIC;
-- Supabase's `public` schema ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to
-- anon/authenticated/service_role on every new function. The 2.1a boundary is
-- operator-only, so explicitly REVOKE the auto anon grant; the 2.2 consumer
-- surface re-adds it as the named seam below.
REVOKE EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) FROM anon;
-- 2.2 SEAM — the consumer reserve surface adds:
--   GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) TO anon;
-- (availability is public-facing demand data, exposes NO reservation PII — only
-- slot times + remaining counts). NO anon grant in 2.1a.
GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) TO authenticated;

COMMIT;
