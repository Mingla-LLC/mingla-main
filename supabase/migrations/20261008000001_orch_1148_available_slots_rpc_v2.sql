-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — pg_venue_available_slots ENGINE v2 (P3 fixes) ⭐
-- ---------------------------------------------------------------------------
-- Internal-correctness fixes to THE ENGINE found by the tester (TEST report
-- §Defects). The function SIGNATURE + return shape are FROZEN — these are NOT
-- contract changes, only correctness fixes inside the body. The 2.2 consumer
-- booking calls this RPC VERBATIM, so the defects must be correct now.
--
--   P3-1 HETEROGENEOUS TURN-TIME: an EXISTING reservation's seating/occupancy
--        window was computed with the QUERYING party's turn time (`v_turn_min`),
--        not the existing reservation's OWN party-size turn. A party-2 booking
--        (true turn 60, ends 19:00) wrongly blocked a party-4 19:00 slot because
--        the engine modelled it as [18:00,20:00) (querying turn 120). FIX: each
--        existing reservation now occupies its table from its start for ITS OWN
--        party-size turn time (looked up per-row from turn_times), independent
--        of the querying party. (The candidate's own window still uses the
--        querying party's turn + buffer — that is correct.)
--
--   P3-2 OVER-SEAT: party_fit used COALESCE(max_party, capacity), so a cap-2
--        table with max_party=8 offered slots to a party of 6. FIX: clamp the
--        effective max party to the table capacity —
--        LEAST(COALESCE(max_party, capacity), capacity). A table can never seat
--        more than its capacity. (The add/edit-table UI also clamps maxParty at
--        write time so bad data can't be entered.)
--
--   P3-3 DST: the engine converted venue-local times to UTC via a STATIC
--        place_pool.utc_offset_minutes, so a summer (DST) slot was 1h off. FIX:
--        convert via the venue's IANA timezone
--        (venue_availability_config.iana_timezone) using
--        `(local timestamp) AT TIME ZONE '<iana>'`, which Postgres resolves with
--        DST awareness for the ACTUAL date. The static offset is GONE.
--
-- All three preserve: STABLE, SECURITY DEFINER, locked search_path, the frozen
-- 4-column TABLE return, the whole-day/zone/table blackout logic, the
-- live-status overlap subtraction, the NULL-table pool consumption, the
-- max-per-slot ceiling, the min_notice / advance-window gates, and the
-- authenticated-only EXECUTE (anon REVOKE). $function$ closed BEFORE the
-- REVOKE/GRANT block.
--
-- Additive-only. CREATE OR REPLACE FUNCTION (same identity args → in-place
-- replace; no DROP needed since the RETURNS shape is unchanged). MONOTONIC
-- VERSION 20261008000001. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared per-party turn-time lookup (P3-1). Pure function of (turn_times jsonb,
-- party_size) → minutes, replicating the engine's original bucket rule:
--   pick the bucket whose numeric party key is the largest key <= party_size;
--   else the max bucket present; else default 90 minutes.
-- Used for BOTH the querying party AND each existing reservation's OWN turn,
-- so an existing reservation occupies its table for its own party's turn,
-- independent of the querying party. IMMUTABLE (depends only on its args).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_turn_minutes_for_party(
  p_turn_times jsonb,
  p_party_size int
)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $turn$
  SELECT COALESCE(
    -- largest key <= party_size
    (SELECT (kv.value)::int
       FROM jsonb_each_text(COALESCE(p_turn_times, '{}'::jsonb)) AS kv
      WHERE kv.key ~ '^p[0-9]+$'
        AND (substring(kv.key from 2))::int <= p_party_size
      ORDER BY (substring(kv.key from 2))::int DESC
      LIMIT 1),
    -- else the max bucket present
    (SELECT (kv.value)::int
       FROM jsonb_each_text(COALESCE(p_turn_times, '{}'::jsonb)) AS kv
      WHERE kv.key ~ '^p[0-9]+$'
      ORDER BY (substring(kv.key from 2))::int DESC
      LIMIT 1),
    -- else the default
    90
  );
$turn$;

REVOKE ALL ON FUNCTION public.pg_venue_turn_minutes_for_party(jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_venue_turn_minutes_for_party(jsonb, int) TO authenticated, service_role;

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
  v_tz            text;          -- venue IANA timezone (DST-aware), e.g. America/New_York
  v_dow           int;          -- 0..6 (Sun..Sat) for p_date
  v_turn_min      int;          -- turn time for the QUERYING party (p_party_size), minutes
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

  -- P3-3: venue IANA timezone (DST-aware). Default UTC if somehow NULL/blank or
  -- not a zone Postgres recognises, so the engine never errors on `AT TIME ZONE`.
  v_tz := NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- (3) TURN TIME for the QUERYING party: pick the bucket whose numeric party key
  -- is the largest key <= p_party_size; if none, fall back to the max bucket; if
  -- empty, default 90 minutes. (P3-1: existing reservations use their OWN turn,
  -- computed per-row in the overlap subquery below, NOT this value.)
  v_turn_min := public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, p_party_size);

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
  -- approval_required), and the party_fit rule. P3-2: the effective max party is
  -- CLAMPED to the table capacity — a table can never seat more than its
  -- capacity even if max_party was (mis)configured above capacity. Subtract
  -- tables under a zone/table-scoped blackout that overlaps p_date.
  SELECT array_agg(t.id), count(*)::int
  INTO v_eligible_ids, v_eligible_cnt
  FROM public.venue_tables t
  WHERE t.brand_id = p_brand_id
    AND t.is_active
    AND t.reservation_policy = 'reservable'
    AND p_party_size BETWEEN COALESCE(t.min_party, 1)
                         AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)
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
    -- P3-3: venue-local period bounds resolved via the IANA timezone. We build
    -- venue-local midnight of p_date as a naive timestamp and convert it to an
    -- absolute instant with `AT TIME ZONE v_tz`, which Postgres resolves with the
    -- correct DST offset for THAT date. (Adding the within-day minute offsets to
    -- the local-midnight INSTANT is correct for the vast majority of slots; the
    -- rare DST-transition-day spring-forward gap is out of scope for 2.1a service
    -- hours, which sit in the evening.) slot_local + turn + buffer must not run
    -- past the period end (no half-seatings).
    SELECT
      ((p_date::timestamp) AT TIME ZONE v_tz) AS local_midnight_utc,
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
      -- P3-3: the advance-window upper bound is computed in the venue's local
      -- calendar via the IANA tz (DST-aware), not a static offset.
      AND p_date <= ((v_now AT TIME ZONE v_tz)::date + COALESCE(v_cfg.advance_window_days, 30))
  ),
  scored AS (
    SELECT
      w.slot_utc,
      w.minute_of_day,
      v_cap_per_slot - (
        -- overlapping LIVE reservations. P3-1: each EXISTING reservation occupies
        -- its table from its start for ITS OWN party-size turn time (+ buffer),
        -- looked up per-row from the venue's turn_times — NOT the querying party's
        -- turn. The candidate seating window uses the querying party's turn:
        --   candidate seating  = [slot_utc, slot_utc + v_turn_min + v_buffer_min)
        --   existing occupancy  = [reserved_for, reserved_for + own_turn + buffer)
        -- whose table is eligible OR is unassigned (NULL table still consumes).
        SELECT count(*)::int
        FROM public.reservations r
        WHERE r.brand_id = p_brand_id
          AND r.status IN ('requested', 'confirmed', 'seated')
          AND (r.table_id IS NULL OR r.table_id = ANY (v_eligible_ids))
          AND r.reserved_for
                < (w.slot_utc + make_interval(mins => v_turn_min + v_buffer_min))
          AND (r.reserved_for
                + make_interval(mins =>
                    public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size)
                    + v_buffer_min)) > w.slot_utc
      ) AS remaining_calc
    FROM windowed w
  )
  SELECT
    s.slot_utc AS slot_start_utc,
    -- P3-3: venue-local wall-clock label, DST-aware: render the instant in the
    -- venue's IANA zone. `s.slot_utc AT TIME ZONE v_tz` yields the local naive
    -- timestamp for that instant; format HH:MM.
    to_char(s.slot_utc AT TIME ZONE v_tz, 'HH24:MI') AS slot_local_label,
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
