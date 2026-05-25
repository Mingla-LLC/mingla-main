-- ORCH-0963 [Public brand page business-case optimization (events vs. trip brands)]
-- Anon-callable bulk-by-brand public-trips read path. Powers /b/{slug} for
-- kind='trip_planner' brands. Mirrors pg_public_ticket_types_remaining
-- (ORCH-0946) anon-RPC pattern + biz_trip_tickets_sold (ORCH-0947) canonical
-- sold formula. Preserves I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE.
--
-- Brand-kind guard (b.kind = 'trip_planner') is the security boundary —
-- function returns ZERO rows for non-trip-planner brands so accidental
-- misuse against event brands cannot leak data.

CREATE OR REPLACE FUNCTION public.pg_public_trips_by_brand(
  p_brand_slug text
)
RETURNS TABLE (
  trip_id          uuid,
  trip_slug        text,
  brand_slug       text,
  title            text,
  description      text,
  destination_text text,
  cover_media_url  text,
  cover_media_type text,
  status           text,
  start_at         timestamptz,
  end_at           timestamptz,
  timezone         text,
  bookings_closed  boolean,
  total_capacity   integer,
  tickets_sold     integer,
  spots_left       integer,
  min_price_cents  integer,
  currency         text,
  has_free_tier    boolean,
  published_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH brand AS (
    SELECT b.id, b.slug
    FROM public.brands b
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND b.kind = 'trip_planner'
  ),
  trip_rows AS (
    SELECT e.id, e.slug, e.title, e.description, e.destination_text,
           e.cover_media_url, e.cover_media_type, e.status,
           e.timezone, e.bookings_closed, e.published_at
    FROM public.events e
    JOIN brand ON brand.id = e.brand_id
    WHERE e.event_type = 'trip'
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')
      AND e.deleted_at IS NULL
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
  )
  SELECT
    tr.id                    AS trip_id,
    tr.slug                  AS trip_slug,
    (SELECT slug FROM brand) AS brand_slug,
    tr.title,
    tr.description,
    tr.destination_text,
    tr.cover_media_url,
    tr.cover_media_type,
    tr.status,
    d.start_at,
    d.end_at,
    tr.timezone,
    tr.bookings_closed,
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
  ORDER BY
    (CASE WHEN tr.status IN ('scheduled','live') THEN 0 ELSE 1 END),
    d.start_at NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.pg_public_trips_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_trips_by_brand(text) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_trips_by_brand(text) IS
  'ORCH-0963: anon-callable bulk public-trips read for /b/{trip-planner-brand-slug}. '
  'Returns one row per published trip with pre-aggregated spots_left + min_price_cents. '
  'Sold formula mirrors biz_ticket_checkout_create_session capacity gate exactly '
  'per I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE. Brand-kind guard prevents accidental '
  'use against event brands (returns empty set for non-trip_planner brands).';
