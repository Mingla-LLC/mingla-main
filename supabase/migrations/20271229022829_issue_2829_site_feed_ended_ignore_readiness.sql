-- #2829 W7c (amendment A13.5) — ended offerings on a brand's website ignore
-- payments readiness.
--
-- Mingla's public trip reader (pg_public_trips_by_brand) hides an all-paid
-- trip of a brand that cannot take payments (ORCH-1076: never show a Book
-- button checkout would refuse). That is right for an upcoming trip, but an
-- ENDED trip cannot be booked by anyone, so hiding it only removes the brand's
-- own history from its website ("Past trips", the trips-we've-run ledger).
--
-- This migration changes the Sites feed composition ONLY:
--   * `brand_site_ended_trips_held_for_readiness(brand)` — private (service
--     role only): the public, non-deleted, ended trips of one brand that the
--     public reader's readiness gate held back (all tiers paid, brand cannot
--     collect). Same visibility rules and columns as the public reader.
--     "Ended" = status `ended`, or a scheduled/live trip whose local end date
--     (its own timezone, Constitution 12) is before local today. Cancelled
--     trips are not included.
--   * `brand_site_offerings_feed(site)` — re-created with its trips drawn
--     from the public reader PLUS those held-back ended trips. Nothing else in
--     the feed changes.
-- The shared public readers are NOT touched: the Mingla brand page, trip
-- page, discovery and checkout keep the readiness gate exactly as before.
-- Upcoming paid trips of a brand that cannot take payments stay hidden on its
-- website too.
--
-- Forward-only.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.brand_site_ended_trips_held_for_readiness(p_brand_id uuid)
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
  spots_left       integer,
  min_price_cents  integer,
  currency         text,
  has_free_tier    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH brand AS (
    SELECT b.id, b.slug
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.deleted_at IS NULL
      -- Only while the brand cannot take payments: otherwise the public
      -- reader already returns every one of its trips.
      AND NOT public.pg_brand_can_collect(b.id)
  ),
  trip_rows AS (
    SELECT e.id, e.slug, e.title, e.description, e.destination_text,
           e.cover_media_url, e.cover_media_type, e.status, e.timezone, e.bookings_closed
    FROM public.events e
    JOIN brand ON brand.id = e.brand_id
    WHERE e.event_type = 'trip'
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live', 'ended')
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
  ),
  zoned AS (
    SELECT tr.*, d.start_at, d.end_at,
      CASE WHEN tr.timezone IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = tr.timezone)
           THEN tr.timezone ELSE 'UTC' END AS zone
    FROM trip_rows tr
    LEFT JOIN dates d ON d.event_id = tr.id
  )
  SELECT
    z.id, z.slug, (SELECT slug FROM brand), z.title, z.description, z.destination_text,
    z.cover_media_url, z.cover_media_type, z.status, z.start_at, z.end_at, z.timezone, z.bookings_closed,
    CASE WHEN c.any_unlimited THEN NULL ELSE c.total_capacity END,
    CASE
      WHEN c.any_unlimited THEN NULL
      WHEN c.total_capacity IS NULL THEN NULL
      ELSE GREATEST(c.total_capacity - COALESCE(s.tickets_sold, 0), 0)
    END,
    p.min_price_cents, p.currency, COALESCE(p.has_free_tier, false)
  FROM zoned z
  LEFT JOIN capacity c ON c.event_id = z.id
  LEFT JOIN sold     s ON s.event_id = z.id
  LEFT JOIN pricing  p ON p.event_id = z.id
  -- Exactly the rows the public reader's readiness gate held back ...
  WHERE NOT (COALESCE(p.has_free_tier, false) OR p.min_price_cents IS NULL)
  -- ... and only those that have ended.
    AND (
      z.status = 'ended'
      OR (COALESCE(z.end_at, z.start_at) IS NOT NULL
          AND (COALESCE(z.end_at, z.start_at) AT TIME ZONE z.zone)::date < (now() AT TIME ZONE z.zone)::date)
    )
$fn$;

REVOKE ALL ON FUNCTION public.brand_site_ended_trips_held_for_readiness(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_ended_trips_held_for_readiness(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_ended_trips_held_for_readiness(uuid) IS
  '#2829 W7c (A13.5) — the public, non-deleted, ENDED all-paid trips of one brand that cannot take payments: the rows pg_public_trips_by_brand holds back for readiness. Used only by brand_site_offerings_feed so a website keeps its past trips; nobody can book an ended trip. Service role only.';

CREATE OR REPLACE FUNCTION public.brand_site_offerings_feed(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand record;
  v_offerings jsonb;
BEGIN
  SELECT b.id, b.slug, b.default_currency, b.payment_provider::text AS payment_provider
    INTO v_brand
  FROM public.brand_sites s
  JOIN public.brands b ON b.id = s.brand_id
  WHERE s.id = p_site_id
    AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;

  WITH trips AS (
    SELECT
      t.trip_id AS id, 'trip'::text AS kind, t.trip_slug AS slug, t.title,
      t.description, t.destination_text, t.cover_media_url, t.cover_media_type,
      t.start_at, t.end_at, t.timezone, t.status, COALESCE(t.bookings_closed, false) AS bookings_closed,
      t.total_capacity AS capacity, t.spots_left,
      t.min_price_cents::bigint AS min_price_minor, t.currency, COALESCE(t.has_free_tier, false) AS has_free_tier,
      false AS waitlist_enabled,
      public.pg_trip_installments_supported(t.trip_id) AS installments_available,
      'https://host.usemingla.com/t/' || t.brand_slug || '/' || t.trip_slug AS public_url
    FROM (
      SELECT r.trip_id, r.trip_slug, r.brand_slug, r.title, r.description, r.destination_text,
        r.cover_media_url, r.cover_media_type, r.start_at, r.end_at, r.timezone, r.status,
        r.bookings_closed, r.total_capacity, r.spots_left, r.min_price_cents, r.currency, r.has_free_tier
      FROM public.pg_public_trips_by_brand(v_brand.slug) r
      UNION ALL
      -- #2829 W7c (A13.5): an ENDED trip is shown even while the brand cannot
      -- take payments (nobody can book an ended trip). Exactly the rows the
      -- public reader's readiness gate held back; upcoming paid trips still
      -- need payments readiness.
      SELECT u.trip_id, u.trip_slug, u.brand_slug, u.title, u.description, u.destination_text,
        u.cover_media_url, u.cover_media_type, u.start_at, u.end_at, u.timezone, u.status,
        u.bookings_closed, u.total_capacity, u.spots_left, u.min_price_cents, u.currency, u.has_free_tier
      FROM public.brand_site_ended_trips_held_for_readiness(v_brand.id) u
    ) t
  ),
  event_rows AS (
    SELECT v.*
    FROM public.business_public_events_view v
    WHERE v.brand_id = v_brand.id
      AND v.event_type IN ('event','rsvp')
  ),
  event_remaining AS (
    SELECT er.id,
      bool_or(r.remaining IS NULL) AS any_unlimited,
      SUM(r.remaining)::int AS remaining,
      SUM(r.remaining + r.sold)::int AS capacity,
      count(r.ticket_type_id) AS tiers
    FROM event_rows er
    LEFT JOIN LATERAL public.pg_public_ticket_types_remaining(er.id) r ON true
    GROUP BY er.id
  ),
  event_free AS (
    SELECT er.id, EXISTS (
      SELECT 1 FROM public.ticket_types tt
      WHERE tt.event_id = er.id AND tt.deleted_at IS NULL
        AND COALESCE(tt.is_hidden, false) = false AND (tt.is_free OR tt.price_cents = 0)
    ) AS has_free
    FROM event_rows er
  ),
  events AS (
    SELECT
      er.id, 'event'::text AS kind, er.slug, er.title, er.description,
      er.location_text AS destination_text, er.cover_media_url, er.cover_media_type,
      er.master_start_at AS start_at, er.master_end_at AS end_at,
      COALESCE(er.master_timezone, er.timezone) AS timezone, er.status, false AS bookings_closed,
      CASE
        WHEN er.event_type = 'rsvp' THEN er.rsvp_capacity
        WHEN rem.tiers = 0 OR rem.any_unlimited THEN NULL
        ELSE rem.capacity
      END AS capacity,
      CASE
        WHEN er.event_type = 'rsvp' THEN
          CASE WHEN er.rsvp_capacity IS NULL OR er.rsvp_going_count IS NULL THEN NULL
               ELSE GREATEST(er.rsvp_capacity - er.rsvp_going_count, 0) END
        WHEN rem.tiers = 0 OR rem.any_unlimited THEN NULL
        ELSE rem.remaining
      END AS spots_left,
      NULLIF(er.display_price_cents, 0)::bigint AS min_price_minor, er.currency,
      COALESCE(fr.has_free, false) OR er.event_type = 'rsvp' AS has_free_tier,
      COALESCE(er.rsvp_waitlist_enabled, false) AND er.event_type = 'rsvp' AS waitlist_enabled,
      false AS installments_available,
      'https://host.usemingla.com/e/' || er.brand_slug || '/' || er.slug AS public_url
    FROM event_rows er
    LEFT JOIN event_remaining rem ON rem.id = er.id
    LEFT JOIN event_free fr ON fr.id = er.id
  ),
  experiences AS (
    SELECT
      x.experience_id AS id, 'experience'::text AS kind, x.experience_slug AS slug, x.title,
      x.description, x.venue_text AS destination_text, x.cover_media_url, x.cover_media_type,
      x.next_occurrence_at AS start_at, NULL::timestamptz AS end_at, e.timezone, e.status,
      false AS bookings_closed, NULL::integer AS capacity, NULL::integer AS spots_left,
      NULLIF(x.price_from_cents, 0)::bigint AS min_price_minor, x.currency,
      COALESCE(x.is_free, false) AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/exp/' || x.brand_slug || '/' || x.experience_slug AS public_url
    FROM public.pg_public_experiences_by_brand(v_brand.slug) x
    JOIN public.events e ON e.id = x.experience_id
    WHERE e.status IN ('scheduled','live','ended','cancelled')
  ),
  all_rows AS (
    SELECT * FROM trips
    UNION ALL SELECT * FROM events
    UNION ALL SELECT * FROM experiences
  ),
  ranked AS (
    SELECT a.*,
      (a.status IN ('ended','cancelled') OR COALESCE(a.end_at, a.start_at) < now()) AS is_past
    FROM all_rows a
    WHERE a.slug IS NOT NULL AND a.title IS NOT NULL
  ),
  limited AS (
    SELECT r.* FROM ranked r
    ORDER BY r.is_past,
      CASE WHEN NOT r.is_past THEN r.start_at END ASC NULLS LAST,
      CASE WHEN r.is_past THEN r.start_at END DESC NULLS LAST,
      r.id
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'kind', l.kind,
      'slug', l.slug,
      'title', left(l.title, 200),
      'summary', NULLIF(left(btrim(regexp_replace(COALESCE(l.description, ''), '\s+', ' ', 'g')), 500), ''),
      'cover', CASE WHEN public.brand_site_offering_cover_path(l.cover_media_url, l.cover_media_type) IS NULL THEN NULL
                ELSE jsonb_build_object('path', public.brand_site_offering_cover_path(l.cover_media_url, l.cover_media_type), 'type', 'image') END,
      'destination_text', NULLIF(left(btrim(COALESCE(l.destination_text, '')), 200), ''),
      'start_at', l.start_at,
      'end_at', l.end_at,
      'timezone', l.timezone,
      'status', l.status,
      'bookings_closed', l.bookings_closed,
      'capacity', l.capacity,
      'spots_left', l.spots_left,
      'group_minimum', CASE WHEN l.kind = 'trip' THEN (SELECT g.group_minimum FROM public.trip_guides g WHERE g.event_id = l.id) END,
      'min_price_minor', l.min_price_minor,
      'currency', CASE WHEN l.currency ~ '^[A-Z]{3}$' THEN l.currency END,
      'has_free_tier', l.has_free_tier,
      'public_url', l.public_url,
      'waitlist_enabled', l.waitlist_enabled,
      'installments_available', l.installments_available
    ) ORDER BY l.is_past,
      CASE WHEN NOT l.is_past THEN l.start_at END ASC NULLS LAST,
      CASE WHEN l.is_past THEN l.start_at END DESC NULLS LAST,
      l.id), '[]'::jsonb)
    INTO v_offerings
  FROM limited l;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'brand', jsonb_build_object(
      'slug', v_brand.slug,
      'currency', v_brand.default_currency,
      'payment_rails', CASE WHEN v_brand.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
    ),
    'offerings', v_offerings
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.brand_site_offerings_feed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offerings_feed(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_offerings_feed(uuid) IS
  '#2829 W4/W7c — the live offerings a brand''s website shows: only public, non-deleted trips/events/experiences of the site''s own brand, composed from Mingla''s public readers; ended and cancelled included with their status; ended trips are shown even while the brand cannot take payments (A13.5), upcoming paid ones still need readiness; upcoming soonest first, then past newest first; max 200. Cards link to the existing Mingla public page (public_url). Service role only.';

COMMIT;
