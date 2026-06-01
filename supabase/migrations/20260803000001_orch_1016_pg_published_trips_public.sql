-- ORCH-1016 [Consumer Discover Trips tab] — global anon-callable published-trips
-- feed RPC. Powers the consumer-app Discover > Trips tab. Mirrors
-- pg_public_trips_by_brand (ORCH-0963) shape + I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE
-- sold/spots formula, but GLOBAL (no brand scope), filterable, sorted, paginated,
-- and with hard guards that NEVER surface draft/cancelled/past/closed/zero-tier
-- trips. show_on_discover is INTENTIONALLY NOT filtered (operator decision #1).
--
-- Anon NEVER reads brands/tickets directly (COMMS-0009): this SECURITY DEFINER fn
-- is the ONLY anon path to planner name + verified badge + spots_left.
--
-- I-PROPOSED-PUBLISHED-TRIPS-PUBLIC-HARD-GUARDS (this migration establishes it):
-- the trip_rows WHERE MUST contain all six conjuncts below. Removing any one lets
-- a non-qualifying trip leak — guarded by the ORCH-1016 fails-on-revert tests.

CREATE OR REPLACE FUNCTION public.pg_published_trips_public(
  p_destination_query text        DEFAULT NULL,  -- ILIKE on destination_text (where it goes)
  p_departure_query   text        DEFAULT NULL,  -- ILIKE on departure_text (where travelers leave from) — SEPARATE from destination
  p_date_from         timestamptz DEFAULT NULL,  -- master start_at >= (inclusive)
  p_date_to           timestamptz DEFAULT NULL,  -- master start_at <= (inclusive)
  p_min_price_cents   integer     DEFAULT NULL,  -- min_price_cents >= (NULL = no floor)
  p_max_price_cents   integer     DEFAULT NULL,  -- min_price_cents <= (NULL = no ceiling)
  p_group_size_min    integer     DEFAULT NULL,  -- total_capacity >= (unlimited always passes)
  p_group_size_max    integer     DEFAULT NULL,  -- total_capacity <= (unlimited always passes)
  p_sort              text        DEFAULT 'relevance',  -- 'relevance'|'oldest'|'price_asc'|'price_desc'
  p_limit             integer     DEFAULT 20,    -- page size; clamp 1..50
  p_offset            integer     DEFAULT 0      -- pagination offset; clamp >= 0
)
RETURNS TABLE (
  trip_id          uuid,
  trip_slug        text,
  brand_slug       text,
  brand_name       text,
  brand_verified   boolean,
  title            text,
  description      text,
  destination_text text,
  departure_text   text,
  cover_media_url  text,
  cover_media_type text,
  status           text,
  start_at         timestamptz,
  end_at           timestamptz,
  timezone         text,
  bookings_closed  boolean,
  booking_deadline timestamptz,
  total_capacity   integer,
  tickets_sold     integer,
  spots_left       integer,
  min_price_cents  integer,
  currency         text,
  has_free_tier    boolean,
  published_at     timestamptz,
  total_count      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50) AS lim,
      GREATEST(COALESCE(p_offset, 0), 0)            AS off,
      CASE
        WHEN p_sort IN ('relevance','oldest','price_asc','price_desc') THEN p_sort
        ELSE 'relevance'
      END AS sort_mode
  ),
  trip_rows AS (
    SELECT e.id, e.slug, e.title, e.description, e.destination_text,
           e.departure_text, e.cover_media_url, e.cover_media_type, e.status,
           e.timezone, e.bookings_closed, e.booking_deadline, e.published_at,
           b.slug AS brand_slug, b.name AS brand_name,
           (b.verified_at IS NOT NULL) AS brand_verified
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE e.event_type = 'trip'
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live')              -- NOT ended/cancelled
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND COALESCE(e.bookings_closed, false) = false
      AND (e.booking_deadline IS NULL OR e.booking_deadline >= now())  -- NULL = open = surfaced
      AND EXISTS (                                         -- >= 1 published, non-hidden tier
        SELECT 1 FROM public.trip_pricing_tiers tpt2
        JOIN public.ticket_types tt2 ON tt2.id = tpt2.ticket_type_id
        WHERE tpt2.event_id = e.id
          AND tt2.deleted_at IS NULL
          AND COALESCE(tt2.is_hidden, false) = false
      )
    -- NOTE (operator decision #1): show_on_discover is INTENTIONALLY NOT filtered.
    -- Do not "fix" this by adding a show_on_discover predicate.
  ),
  dates AS (
    SELECT ed.event_id, ed.start_at, ed.end_at
    FROM public.event_dates ed
    WHERE ed.event_id IN (SELECT id FROM trip_rows)
      AND ed.is_master = true
  ),
  capacity AS (
    SELECT tpt.event_id,
           bool_or(tt.is_unlimited) AS any_unlimited,
           SUM(tt.quantity_total)::int AS total_capacity
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  ),
  sold AS (
    SELECT tt.event_id, COUNT(*)::int AS tickets_sold
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
    WHERE tt.event_id IN (SELECT id FROM trip_rows)
      AND t.status IN ('valid', 'used', 'transferred')
    GROUP BY tt.event_id
  ),
  pricing AS (
    SELECT tpt.event_id,
           MIN(NULLIF(tt.price_cents, 0)) FILTER (WHERE NOT tt.is_free) AS min_price_cents,
           (ARRAY_AGG(tt.currency ORDER BY tt.price_cents ASC, tt.id ASC)
              FILTER (WHERE NOT tt.is_free))[1] AS currency,
           bool_or(tt.is_free) AS has_free_tier
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  ),
  joined AS (
    SELECT
      tr.id          AS trip_id,
      tr.slug        AS trip_slug,
      tr.brand_slug,
      tr.brand_name,
      tr.brand_verified,
      tr.title,
      tr.description,
      tr.destination_text,
      tr.departure_text,
      tr.cover_media_url,
      tr.cover_media_type,
      tr.status,
      d.start_at,
      d.end_at,
      tr.timezone,
      tr.bookings_closed,
      tr.booking_deadline,
      CASE WHEN c.any_unlimited THEN NULL ELSE c.total_capacity END AS total_capacity,
      COALESCE(s.tickets_sold, 0) AS tickets_sold,
      CASE
        WHEN c.any_unlimited THEN NULL
        WHEN c.total_capacity IS NULL THEN NULL
        ELSE GREATEST(c.total_capacity - COALESCE(s.tickets_sold, 0), 0)
      END AS spots_left,
      p.min_price_cents,
      p.currency,
      COALESCE(p.has_free_tier, false) AS has_free_tier,
      tr.published_at
    FROM trip_rows tr
    LEFT JOIN dates    d ON d.event_id = tr.id
    LEFT JOIN capacity c ON c.event_id = tr.id
    LEFT JOIN sold     s ON s.event_id = tr.id
    LEFT JOIN pricing  p ON p.event_id = tr.id
  ),
  filtered AS (
    SELECT j.*
    FROM joined j, params pr
    WHERE
      -- Destination filter (where it goes).
      (p_destination_query IS NULL OR j.destination_text ILIKE '%' || p_destination_query || '%')
      -- Departure filter (where travelers leave from) — SEPARATE from destination.
      AND (p_departure_query IS NULL OR j.departure_text ILIKE '%' || p_departure_query || '%')
      -- Date window on the master start_at. Trips with no master date row are
      -- EXCLUDED when a date filter is set (j.start_at IS NULL fails the >=/<=),
      -- INCLUDED when both date params are NULL.
      AND (p_date_from IS NULL OR j.start_at >= p_date_from)
      AND (p_date_to   IS NULL OR j.start_at <= p_date_to)
      -- Price filter on computed min_price_cents. Free-only trips (NULL
      -- min_price_cents) are EXCLUDED when a price filter is set.
      AND (p_min_price_cents IS NULL OR j.min_price_cents >= p_min_price_cents)
      AND (p_max_price_cents IS NULL OR j.min_price_cents <= p_max_price_cents)
      -- Group-size filter on total_capacity. Unlimited-capacity trips
      -- (total_capacity IS NULL) ALWAYS pass (can host any group).
      AND (p_group_size_min IS NULL OR j.total_capacity IS NULL OR j.total_capacity >= p_group_size_min)
      AND (p_group_size_max IS NULL OR j.total_capacity IS NULL OR j.total_capacity <= p_group_size_max)
  ),
  counted AS (
    SELECT f.*, COUNT(*) OVER () AS total_count
    FROM filtered f
  )
  SELECT
    trip_id, trip_slug, brand_slug, brand_name, brand_verified, title, description,
    destination_text, departure_text, cover_media_url, cover_media_type, status,
    start_at, end_at, timezone, bookings_closed, booking_deadline, total_capacity,
    tickets_sold, spots_left, min_price_cents, currency, has_free_tier, published_at,
    total_count
  FROM counted, params pr
  ORDER BY
    CASE WHEN pr.sort_mode = 'relevance' THEN (CASE WHEN status = 'live' THEN 0 ELSE 1 END) END ASC,
    CASE WHEN pr.sort_mode = 'relevance' THEN published_at END DESC NULLS LAST,
    CASE WHEN pr.sort_mode = 'oldest'    THEN published_at END ASC  NULLS LAST,
    CASE WHEN pr.sort_mode = 'price_asc' THEN min_price_cents END ASC  NULLS LAST,
    CASE WHEN pr.sort_mode = 'price_desc' THEN min_price_cents END DESC NULLS LAST,
    trip_id
  LIMIT  (SELECT lim FROM params)
  OFFSET (SELECT off FROM params);
$$;

REVOKE ALL ON FUNCTION public.pg_published_trips_public(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_published_trips_public(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer, text, integer, integer
) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_published_trips_public(
  text, text, timestamptz, timestamptz, integer, integer, integer, integer, text, integer, integer
) IS
  'ORCH-1016: global anon-callable published-trips feed for consumer Discover > Trips. '
  'Hard guards (event_type=trip, visibility=public, status scheduled/live, not deleted, '
  'not bookings_closed, booking_deadline NULL-or-future, >=1 non-hidden tier) live in the '
  'trip_rows WHERE; show_on_discover is INTENTIONALLY not filtered (operator decision #1). '
  'spots_left/sold mirror pg_public_trips_by_brand per I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE. '
  'departure_text + departure filter are SEPARATE from destination. Only anon path to '
  'planner name + verified badge + spots_left (COMMS-0009).';

-- ───────────────────────────────────────────────────────────────────────────
-- Self-verification (mirrors the ORCH-0880 self-verify pattern). RAISE on any
-- failure so a broken deploy aborts the migration rather than shipping silently.
-- ───────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_is_definer boolean;
  v_anon_exec  boolean;
  v_smoke      bigint;
  v_sig        text := 'public.pg_published_trips_public(text,text,timestamptz,timestamptz,integer,integer,integer,integer,text,integer,integer)';
BEGIN
  -- (a) exists + SECURITY DEFINER
  SELECT p.prosecdef INTO v_is_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'pg_published_trips_public';
  IF v_is_definer IS NULL THEN
    RAISE EXCEPTION 'ORCH-1016 self-verify: function pg_published_trips_public not found';
  END IF;
  IF v_is_definer IS NOT TRUE THEN
    RAISE EXCEPTION 'ORCH-1016 self-verify: pg_published_trips_public is not SECURITY DEFINER';
  END IF;

  -- (b) anon has EXECUTE
  v_anon_exec := has_function_privilege('anon', v_sig, 'EXECUTE');
  IF v_anon_exec IS NOT TRUE THEN
    RAISE EXCEPTION 'ORCH-1016 self-verify: anon lacks EXECUTE on pg_published_trips_public';
  END IF;

  -- (c) smoke call returns >= 0 without error
  SELECT count(*) INTO v_smoke FROM public.pg_published_trips_public();
  IF v_smoke < 0 THEN
    RAISE EXCEPTION 'ORCH-1016 self-verify: smoke call returned negative count';
  END IF;

  RAISE NOTICE 'ORCH-1016 self-verify PASS: pg_published_trips_public is SECURITY DEFINER, anon-EXECUTE granted, smoke call returned % rows.', v_smoke;
END;
$verify$;
