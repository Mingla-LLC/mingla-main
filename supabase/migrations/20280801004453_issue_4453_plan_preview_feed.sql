-- #4453 milestone 10 (spec v2.1 §2.2-§2.3) — the pre-build plan preview
-- ("See your site in three styles"), behind SITES_PLAN_PREVIEW (seeded OFF).
--
--   1. SITES_PLAN_PREVIEW flag (off) and its per-brand allowlist (seeded
--      EMPTY: nobody gets the preview until Seth turns it on or lists a brand).
--   2. brand_site_offerings_feed_for_brand(p_brand_id): the offerings feed BY
--      BRAND (a plan preview runs before any site exists). Its body is the
--      latest brand_site_offerings_feed body (20280726014453) with only the
--      brand lookup changed (brands.id instead of the site join).
--   3. brand_site_offerings_feed(p_site_id) re-issued to resolve the site's
--      brand and call (2): one body, so the two can never drift (the pg17
--      suite pins that both return equal rows).
--   3b. Brand twins of the composer-fact reads (compose facts, venue slots,
--      offering dates, ticket tiers) holding the one body; the site reads are
--      re-issued to resolve the site's brand and call them, so a preview
--      before any site sees the facts Build sees (SC-PP4).
--   4. brand_site_plan_preview_inputs(p_brand_id): what Core needs for a
--      preview (the plan's ticks, story and the owner's own answers, the
--      brand's name and logo, the site id when one exists). User-callable;
--      the plan gate re-derives the caller's rank (content rank 20). Read only.
--   5. brand_site_plan_preview_take(p_brand_id): the per-brand rate limit
--      (3 a minute, 20 a day), a counter table closed to clients.
--
-- Nothing here writes a site, page, setting, menu, media or work-log row.
-- Every function is static SQL (no EXECUTE), SECURITY DEFINER with an explicit
-- search_path. Forward-only. Applied by Seth's chat before the Core deploy.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 1. Flag (off) and its allowlist (empty) ────────────────────────────────
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_PLAN_PREVIEW', false,
  '#4453 milestone 10 — the pre-build "See your site in three styles" preview in the Website setup (real renders of the brand''s plan in Ari''s three picks; nothing is built until the owner taps Start the build). Brands in brand_site_plan_preview_brands get it while this is off.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_PLAN_PREVIEW');

CREATE TABLE IF NOT EXISTS public.brand_site_plan_preview_brands (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_site_plan_preview_brands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_plan_preview_brands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.brand_site_plan_preview_brands TO service_role;
COMMENT ON TABLE public.brand_site_plan_preview_brands IS
  '#4453 milestone 10 — brands that get SITES_PLAN_PREVIEW while the flag itself is off. Seeded empty. Service role only.';

CREATE OR REPLACE FUNCTION public.brand_site_plan_preview_on(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT f.is_enabled FROM public.feature_flags f WHERE f.flag_key = 'SITES_PLAN_PREVIEW' LIMIT 1), false)
    OR EXISTS (SELECT 1 FROM public.brand_site_plan_preview_brands l WHERE l.brand_id = p_brand_id);
$function$;

-- ── 2. The offerings feed by brand ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_offerings_feed_for_brand(p_brand_id uuid)
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
  FROM public.brands b
  WHERE b.id = p_brand_id
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
      'https://host.usemingla.com/t/' || t.brand_slug || '/' || t.trip_slug AS public_url,
      NULL::text AS cover_path
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
      'https://host.usemingla.com/e/' || er.brand_slug || '/' || er.slug AS public_url,
      NULL::text AS cover_path
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
      'https://host.usemingla.com/exp/' || x.brand_slug || '/' || x.experience_slug AS public_url,
      NULL::text AS cover_path
    FROM public.pg_public_experiences_by_brand(v_brand.slug) x
    JOIN public.events e ON e.id = x.experience_id
    WHERE e.status IN ('scheduled','live','ended','cancelled')
  ),
  -- #4453 M5 (§6.5) — live rooms and places of the brand's verified stay
  -- venues, only while the stay flags are on. "From" is the lowest sellable
  -- night in the next 60 days (never a stay total). Links to the venue page's
  -- stay tab with the room picked.
  stays AS (
    SELECT
      o.id, 'stay'::text AS kind, o.id::text AS slug, o.name AS title,
      NULLIF(o.summary, '') AS description, v.name AS destination_text,
      NULL::text AS cover_media_url, NULL::text AS cover_media_type,
      NULL::timestamptz AS start_at, NULL::timestamptz AS end_at, NULL::text AS timezone,
      'scheduled'::text AS status, false AS bookings_closed,
      NULL::integer AS capacity, NULL::integer AS spots_left,
      night.price_minor AS min_price_minor, night.currency,
      false AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/b/' || v_brand.slug || '/v/' || v.slug || '?tab=stay&room=' || o.id::text AS public_url,
      (SELECT 'brand_covers/' || m.storage_object_name FROM public.stay_offering_media m
        WHERE m.offering_id = o.id AND m.status = 'ready' AND m.storage_bucket_id = 'brand_covers'
        ORDER BY m.is_cover DESC, m.sort_order ASC LIMIT 1) AS cover_path
    FROM public.stay_offerings o
    JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
    LEFT JOIN public.stay_settings ss ON ss.venue_id = v.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(n.price_override_minor, pv.amount_minor)::bigint AS price_minor,
             COALESCE(n.currency_code, pv.currency_code)::text AS currency
      FROM public.stay_room_nights n
      LEFT JOIN LATERAL (
        SELECT p.amount_minor, p.currency_code FROM public.stay_price_versions p
        WHERE p.offering_id = n.offering_id AND p.pricing_unit = 'room_night'
          AND p.effective_from <= now() AND (p.effective_to IS NULL OR p.effective_to > now())
        ORDER BY p.version_number DESC LIMIT 1
      ) pv ON true
      -- A night with a room LEFT (sellable less holds and bookings; 20280726004453).
      WHERE n.offering_id = o.id AND public.stay_room_night_available(n.offering_id, n.local_date) > 0
        AND n.local_date BETWEEN (now() AT TIME ZONE public.brand_site_zone_or_utc(ss.timezone))::date
                             AND (now() AT TIME ZONE public.brand_site_zone_or_utc(ss.timezone))::date + 60
        AND COALESCE(n.price_override_minor, pv.amount_minor) IS NOT NULL
      ORDER BY COALESCE(n.price_override_minor, pv.amount_minor) ASC
      LIMIT 1
    ) night ON true
    WHERE public.brand_site_stay_flags_on()
      AND o.brand_id = v_brand.id AND o.status = 'live' AND o.archived_at IS NULL
      AND v.claim_status = 'verified'
  ),
  all_rows AS (
    SELECT * FROM trips
    UNION ALL SELECT * FROM events
    UNION ALL SELECT * FROM experiences
    UNION ALL SELECT * FROM stays
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
      'cover', CASE
                WHEN l.cover_path IS NOT NULL AND l.cover_path ~ '^brand_covers/[A-Za-z0-9._/-]+$' AND char_length(l.cover_path) <= 913 AND position('..' in l.cover_path) = 0
                  THEN jsonb_build_object('path', l.cover_path, 'type', 'image')
                WHEN public.brand_site_offering_cover_path(l.cover_media_url, l.cover_media_type) IS NULL THEN NULL
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

-- ── 3. The site feed calls the brand feed (one body) ───────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_offerings_feed(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT b.id INTO v_brand_id
  FROM public.brand_sites s
  JOIN public.brands b ON b.id = s.brand_id
  WHERE s.id = p_site_id
    AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  RETURN public.brand_site_offerings_feed_for_brand(v_brand_id);
END;
$fn$;

-- ── 3b. Brand-scoped compose facts (a plan preview runs before any site) ───
-- Build composes with the site's facts (verified venues, menu, Mingla reviews,
-- open venue slots, bookable dates, on-sale ticket tiers). A plan preview has
-- no site yet, so each of those reads gets a brand twin. The twin holds the
-- ONE body (verbatim from 20280726004453 / 20280728004453, only the brand
-- lookup changed: brands.id instead of the site join), and the site read is
-- re-issued to resolve the site's brand and call the twin, so the preview and
-- Build always see the same facts (SC-PP4). Core reduces the answers to
-- counts, booleans and ids before anything reaches Studio. Service role only.
CREATE OR REPLACE FUNCTION public.brand_site_brand_by_id(p_brand_id uuid)
RETURNS TABLE (brand_id uuid, brand_slug text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT b.id, b.slug
  FROM public.brands b
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_compose_facts_for_brand(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_venues jsonb;
  v_menu boolean;
  v_stays integer := 0;
  v_reviews bigint;
BEGIN
  IF p_brand_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_brand_by_id(p_brand_id);
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Verified venues per category: the count, and the one venue's id and
  -- reservation switch only when there is exactly one (v2 §4.1 rule 3).
  SELECT COALESCE(jsonb_object_agg(c.category, jsonb_build_object(
      'count', c.n,
      'venue_id', CASE WHEN c.n = 1 THEN c.only_id END,
      'reservations_on', CASE WHEN c.n = 1 THEN c.only_reservations END)), '{}'::jsonb)
  INTO v_venues
  FROM (
    SELECT v.venue_category AS category, count(*) AS n,
      (array_agg(v.id ORDER BY v.id))[1] AS only_id,
      bool_or(COALESCE(r.reservations_enabled, false)) AS only_reservations
    FROM public.venue_listings v
    LEFT JOIN public.venue_reservation_settings r ON r.venue_id = v.id
    WHERE v.brand_id = v_brand.brand_id AND v.claim_status = 'verified'
      AND v.venue_category IN ('restaurant', 'play', 'creative_and_arts', 'stay')
    GROUP BY v.venue_category
  ) c;

  SELECT EXISTS (
    SELECT 1 FROM public.menus m JOIN public.menu_items i ON i.menu_id = m.id
    WHERE m.brand_id = v_brand.brand_id AND m.is_active)
  INTO v_menu;

  IF public.brand_site_stay_flags_on() THEN
    SELECT count(*) INTO v_stays
    FROM public.stay_offerings o
    WHERE o.brand_id = v_brand.brand_id AND o.status = 'live' AND o.archived_at IS NULL;
  END IF;

  SELECT count(*) INTO v_reviews
  FROM public.place_reviews pr
  WHERE pr.moderation_status = 'approved'
    AND pr.place_pool_id IN (
      SELECT v.place_pool_id FROM public.venue_listings v
      WHERE v.brand_id = v_brand.brand_id AND v.claim_status = 'verified' AND v.place_pool_id IS NOT NULL);

  RETURN jsonb_build_object(
    'venues', v_venues,
    'published_menu', COALESCE(v_menu, false),
    'live_stay_offerings', COALESCE(v_stays, 0),
    'mingla_reviews', COALESCE(v_reviews, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_venue_slots_for_brand(
  p_brand_id uuid, p_venue_id uuid, p_party_size integer, p_days integer
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_venue record;
  v_tz text;
  v_today date;
  v_days jsonb;
BEGIN
  IF p_brand_id IS NULL OR p_venue_id IS NULL OR p_party_size IS NULL OR p_days IS NULL
     OR p_party_size NOT BETWEEN 1 AND 20 OR p_days NOT BETWEEN 3 AND 14 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brand_site_brand_by_id(p_brand_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT v.id, v.slug, v.name INTO v_venue
  FROM public.venue_listings v
  JOIN public.venue_reservation_settings r ON r.venue_id = v.id AND r.reservations_enabled
  WHERE v.id = p_venue_id AND v.brand_id = v_brand.brand_id AND v.claim_status = 'verified'
    AND v.venue_category IN ('restaurant', 'play', 'creative_and_arts');
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT public.brand_site_zone_or_utc(c.iana_timezone) INTO v_tz
  FROM public.venue_availability_config c WHERE c.venue_id = v_venue.id;
  v_tz := COALESCE(v_tz, 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT COALESCE(jsonb_agg(d.day ORDER BY d.local_date), '[]'::jsonb) INTO v_days
  FROM (
    SELECT (v_today + g.i) AS local_date,
      jsonb_build_object(
        'local_date', to_char(v_today + g.i, 'YYYY-MM-DD'),
        'slots', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
              'label', left(btrim(s.slot_local_label), 24),
              'start_local', to_char(s.slot_start_utc AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI'),
              'state', CASE WHEN s.is_full OR COALESCE(s.remaining, 1) <= 0 THEN 'full'
                            WHEN s.remaining <= 3 THEN 'few' ELSE 'open' END,
              'left', CASE WHEN s.remaining IS NULL THEN NULL ELSE GREATEST(s.remaining, 0) END,
              'price_minor', NULL,
              'currency', NULL,
              'href', CASE WHEN s.is_full OR COALESCE(s.remaining, 1) <= 0 THEN NULL
                ELSE 'https://host.usemingla.com/b/' || v_brand.brand_slug || '/v/' || v_venue.slug
                  || '?tab=book&date=' || to_char(v_today + g.i, 'YYYY-MM-DD')
                  || '&time=' || to_char(s.slot_start_utc AT TIME ZONE v_tz, 'HH24:MI')
                  || '&party=' || p_party_size END
            ) ORDER BY s.slot_start_utc)
          FROM (
            SELECT x.slot_start_utc, x.slot_local_label, x.remaining, x.is_full
            FROM public.pg_venue_available_slots(
              p_date => v_today + g.i, p_party_size => p_party_size, p_venue_id => v_venue.id) x
            WHERE NULLIF(btrim(COALESCE(x.slot_local_label, '')), '') IS NOT NULL
              AND (x.slot_start_utc AT TIME ZONE v_tz)::date = v_today + g.i
            ORDER BY x.slot_start_utc
            LIMIT 24
          ) s
        ), '[]'::jsonb)
      ) AS day
    FROM generate_series(0, p_days - 1) AS g(i)
  ) d;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', v_tz,
    'source', 'venue_slots',
    'title', left(v_venue.name, 200),
    'days', v_days
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_offering_dates_for_brand(
  p_brand_id uuid, p_offering_id uuid, p_source text, p_days integer
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_event record;
  v_tz text;
  v_today date;
  v_left integer;
  v_days jsonb;
BEGIN
  IF p_brand_id IS NULL OR p_offering_id IS NULL OR p_days IS NULL OR p_days NOT BETWEEN 3 AND 14
     OR p_source NOT IN ('event_dates', 'experience_slots', 'trip_departures') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brand_site_brand_by_id(p_brand_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT e.id, e.slug, e.title, e.timezone, e.event_type INTO v_event
  FROM public.events e
  WHERE e.id = p_offering_id AND e.brand_id = v_brand.brand_id
    AND e.visibility = 'public' AND e.status IN ('scheduled', 'live') AND e.deleted_at IS NULL
    AND e.slug IS NOT NULL
    AND CASE p_source
      WHEN 'event_dates' THEN e.event_type IN ('event', 'rsvp')
      WHEN 'experience_slots' THEN e.event_type = 'experience'
      ELSE e.event_type = 'trip' END
    AND public.pg_offering_passes_visibility_gate(e.id, 'direct');
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_tz := public.brand_site_zone_or_utc(v_event.timezone);
  v_today := (now() AT TIME ZONE v_tz)::date;
  IF p_source = 'trip_departures' THEN
    SELECT t.spots_left INTO v_left FROM public.pg_public_trips_by_brand(v_brand.brand_slug) t
    WHERE t.trip_id = v_event.id AND NOT COALESCE(t.bookings_closed, false);
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  WITH dates AS (
    SELECT ed.id, ed.start_at,
      (ed.start_at AT TIME ZONE v_tz) AS local_start
    FROM public.event_dates ed
    WHERE ed.event_id = v_event.id
      AND ed.cancelled_at IS NULL
      AND ed.start_at >= now()
      -- A multi-date offering lists its occurrences; a single-date one its master.
      AND (ed.is_master = false OR NOT EXISTS (
        SELECT 1 FROM public.event_dates o WHERE o.event_id = v_event.id AND o.is_master = false))
  ),
  windowed AS (
    SELECT d.*, d.local_start::date AS local_date,
      row_number() OVER (PARTITION BY d.local_start::date ORDER BY d.start_at, d.id) AS n,
      -- A trip's spots left; else Mingla's per-date count (NULL = not counted, nothing shown).
      COALESCE(v_left, CASE WHEN p_source = 'trip_departures' THEN NULL
        ELSE public.brand_site_date_places_left(v_event.id, d.id) END) AS left_n
    FROM dates d
    WHERE d.local_start::date BETWEEN v_today AND v_today + (p_days - 1)
  ),
  days AS (
    SELECT w.local_date, jsonb_agg(jsonb_build_object(
        'label', CASE WHEN p_source = 'experience_slots' THEN to_char(w.local_start, 'HH24:MI')
                      ELSE to_char(w.local_start, 'Dy DD Mon · HH24:MI') END,
        'start_local', to_char(w.local_start, 'YYYY-MM-DD"T"HH24:MI'),
        'state', CASE WHEN w.left_n IS NOT NULL AND w.left_n <= 0 THEN 'full'
                      WHEN w.left_n IS NOT NULL AND w.left_n <= 3 THEN 'few' ELSE 'open' END,
        'left', w.left_n,
        'price_minor', NULL,
        'currency', NULL,
        'href', CASE
          WHEN w.left_n IS NOT NULL AND w.left_n <= 0 THEN NULL
          WHEN p_source = 'experience_slots' THEN 'https://host.usemingla.com/exp/' || v_brand.brand_slug || '/' || v_event.slug
            || '?date=' || to_char(w.local_start, 'YYYY-MM-DD') || '&slot=' || to_char(w.local_start, 'HH24:MI')
          WHEN p_source = 'trip_departures' THEN 'https://host.usemingla.com/t/' || v_brand.brand_slug || '/' || v_event.slug
          ELSE 'https://host.usemingla.com/e/' || v_brand.brand_slug || '/' || v_event.slug || '?eventDateId=' || w.id::text END
      ) ORDER BY w.start_at, w.id) AS slots
    FROM windowed w
    WHERE w.n <= 24
    GROUP BY w.local_date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('local_date', to_char(d.local_date, 'YYYY-MM-DD'), 'slots', d.slots)
    ORDER BY d.local_date), '[]'::jsonb) INTO v_days
  FROM days d;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', v_tz,
    'source', p_source,
    'title', left(v_event.title, 200),
    'days', v_days
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_ticket_tiers_for_brand(p_brand_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_event record;
  v_tiers jsonb;
BEGIN
  IF p_brand_id IS NULL OR p_event_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_brand_by_id(p_brand_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT e.id, e.slug, e.title, e.timezone, e.status, md.start_at, md.end_at INTO v_event
  FROM public.events e
  LEFT JOIN LATERAL (
    SELECT ed.start_at, ed.end_at FROM public.event_dates ed
    WHERE ed.event_id = e.id ORDER BY ed.is_master DESC, ed.start_at DESC LIMIT 1
  ) md ON true
  WHERE e.id = p_event_id AND e.brand_id = v_brand.brand_id AND e.event_type = 'event'
    AND e.visibility = 'public' AND e.deleted_at IS NULL AND e.slug IS NOT NULL
    AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')
    AND public.pg_offering_passes_visibility_gate(e.id, 'direct');
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(t.tier ORDER BY t.display_order, t.price_cents, t.id), '[]'::jsonb) INTO v_tiers
  FROM (
    SELECT tt.id, tt.display_order, tt.price_cents,
      jsonb_build_object(
        'id', tt.id,
        'name', left(btrim(tt.name), 120),
        'price_minor', CASE WHEN tt.is_free OR tt.price_cents = 0 THEN NULL ELSE tt.price_cents::bigint END,
        'currency', CASE WHEN tt.currency::text ~ '^[A-Z]{3}$' THEN tt.currency::text END,
        'is_free', tt.is_free OR tt.price_cents = 0,
        'state', CASE
          WHEN tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now() THEN 'ended'
          WHEN tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now() THEN 'not_yet'
          WHEN r.remaining IS NOT NULL AND r.remaining <= 0 THEN 'sold_out'
          ELSE 'on_sale' END,
        'sale_starts_at', CASE WHEN tt.sale_start_at > now()
          THEN to_char(tt.sale_start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
        'href', CASE
          WHEN (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
            OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
            OR (r.remaining IS NOT NULL AND r.remaining <= 0) THEN NULL
          ELSE 'https://host.usemingla.com/checkout/' || v_event.id::text || '?seed=' || tt.id::text || ':1' END
      ) AS tier
    FROM public.ticket_types tt
    LEFT JOIN public.pg_public_ticket_types_remaining(v_event.id) r ON r.ticket_type_id = tt.id
    WHERE tt.event_id = v_event.id
      AND tt.deleted_at IS NULL
      AND NOT COALESCE(tt.is_hidden, false)
      AND NOT COALESCE(tt.is_disabled, false)
      AND NOT COALESCE(tt.password_protected, false)
      AND COALESCE(tt.available_online, true)
      AND NOT EXISTS (SELECT 1 FROM public.trip_pricing_tiers tp WHERE tp.ticket_type_id = tt.id)
      AND NOT EXISTS (SELECT 1 FROM public.ticket_type_links l WHERE l.ticket_type_id = tt.id)
    ORDER BY tt.display_order, tt.price_cents, tt.id
    LIMIT 6
  ) t;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', left(v_event.title, 200),
      'start_at', CASE WHEN v_event.start_at IS NOT NULL THEN to_char(v_event.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
      'end_at', CASE WHEN v_event.end_at IS NOT NULL THEN to_char(v_event.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
      'timezone', CASE WHEN v_event.timezone IS NOT NULL AND public.brand_site_zone_or_utc(v_event.timezone) = btrim(v_event.timezone)
        THEN btrim(v_event.timezone) END,
      'status', v_event.status,
      'public_url', 'https://host.usemingla.com/e/' || v_brand.brand_slug || '/' || v_event.slug
    ),
    'tiers', v_tiers
  );
END;
$function$;

-- The site reads: resolve the site's brand, then the one body above.
CREATE OR REPLACE FUNCTION public.brand_site_compose_facts(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
BEGIN
  IF p_site_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.brand_site_compose_facts_for_brand(v_brand.brand_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_venue_slots(
  p_site_id uuid, p_venue_id uuid, p_party_size integer, p_days integer
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
BEGIN
  IF p_site_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.brand_site_venue_slots_for_brand(v_brand.brand_id, p_venue_id, p_party_size, p_days);
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_offering_dates(
  p_site_id uuid, p_offering_id uuid, p_source text, p_days integer
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
BEGIN
  IF p_site_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.brand_site_offering_dates_for_brand(v_brand.brand_id, p_offering_id, p_source, p_days);
END;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_ticket_tiers(p_site_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
BEGIN
  IF p_site_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.brand_site_ticket_tiers_for_brand(v_brand.brand_id, p_event_id);
END;
$function$;

-- ── 4. What a plan preview reads (read only, content rank 20) ───────────────
CREATE OR REPLACE FUNCTION public.brand_site_plan_preview_inputs(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan public.brand_site_plans%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_site_id uuid;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 20);
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  IF v_plan.brand_id IS NULL OR v_plan.offerings_selected IS NULL
    OR cardinality(v_plan.offerings_selected) = 0 THEN
    RAISE EXCEPTION 'sites_plan_not_ready';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF v_brand.id IS NULL THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  SELECT s.id INTO v_site_id FROM public.brand_sites s WHERE s.brand_id = p_brand_id;
  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'site_id', v_site_id,
    'revision', v_plan.revision,
    'offerings_selected', to_jsonb(v_plan.offerings_selected),
    'venue_descriptor', v_plan.venue_descriptor,
    'story', v_plan.story,
    'value_points', v_plan.value_points,
    'faq', v_plan.faq,
    'process_steps', v_plan.process_steps,
    'quick_facts', v_plan.quick_facts,
    'brand', jsonb_build_object(
      'name', v_brand.name,
      'description', v_brand.description,
      'city', v_brand.city,
      'address', v_brand.address,
      'contact_email', v_brand.contact_email,
      'profile_photo_url', v_brand.profile_photo_url
    )
  );
END;
$function$;

-- ── 5. Rate limit: 3 a minute, 20 a day, per brand ─────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_site_plan_preview_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_site_plan_preview_requests_brand_time
  ON public.brand_site_plan_preview_requests (brand_id, created_at DESC);
ALTER TABLE public.brand_site_plan_preview_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_plan_preview_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.brand_site_plan_preview_requests TO service_role;
COMMENT ON TABLE public.brand_site_plan_preview_requests IS
  '#4453 milestone 10 — one row per plan-preview request (the per-brand rate limit). Rows older than a day are pruned by brand_site_plan_preview_take. Service role only.';

CREATE OR REPLACE FUNCTION public.brand_site_plan_preview_take(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_minute integer;
  v_day integer;
BEGIN
  IF p_brand_id IS NULL THEN RETURN jsonb_build_object('allowed', false, 'reason', 'invalid'); END IF;
  -- One brand's requests are counted one at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('brand_site_plan_preview:' || p_brand_id::text, 0));
  DELETE FROM public.brand_site_plan_preview_requests
  WHERE brand_id = p_brand_id AND created_at < now() - interval '1 day';
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '1 minute'), count(*)
    INTO v_minute, v_day
  FROM public.brand_site_plan_preview_requests
  WHERE brand_id = p_brand_id;
  IF v_minute >= 3 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'minute'); END IF;
  IF v_day >= 20 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'day'); END IF;
  INSERT INTO public.brand_site_plan_preview_requests (brand_id) VALUES (p_brand_id);
  RETURN jsonb_build_object('allowed', true, 'reason', null);
END;
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.brand_site_plan_preview_on(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_preview_on(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offerings_feed_for_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offerings_feed_for_brand(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offerings_feed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offerings_feed(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_brand_by_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_brand_by_id(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_compose_facts_for_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_compose_facts_for_brand(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_compose_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_compose_facts(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_venue_slots_for_brand(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_venue_slots_for_brand(uuid,uuid,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_venue_slots(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_venue_slots(uuid,uuid,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offering_dates_for_brand(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offering_dates_for_brand(uuid,uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offering_dates(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offering_dates(uuid,uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_ticket_tiers_for_brand(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_ticket_tiers_for_brand(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_ticket_tiers(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_ticket_tiers(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_plan_preview_inputs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_preview_inputs(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_site_plan_preview_take(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_preview_take(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_offerings_feed_for_brand(uuid) IS
  '#4453 milestone 10 — the offerings feed of one brand (the body brand_site_offerings_feed had, by brand id): public, non-deleted trips/events/experiences plus live rooms while the stay flags are on; cards link to the existing Mingla public page. Used by the plan preview before a site exists. Service role only.';
COMMENT ON FUNCTION public.brand_site_offerings_feed(uuid) IS
  '#2829 W4/W7c, #4453 M5/M10 — the live offerings a brand''s website shows: resolves the site''s brand and returns brand_site_offerings_feed_for_brand (one body). Service role only.';
COMMENT ON FUNCTION public.brand_site_compose_facts_for_brand(uuid) IS
  '#4453 M10 — the ONE body of the composer facts, by brand (a plan preview runs before a site exists). Counts and booleans only. Service role only.';
COMMENT ON FUNCTION public.brand_site_compose_facts(uuid) IS
  '#4453 M7/M10 — composer facts for a site: resolves the site''s brand and returns brand_site_compose_facts_for_brand. Service role only.';
COMMENT ON FUNCTION public.brand_site_brand_by_id(uuid) IS
  '#4453 M10 — a live brand''s id and slug (the brand twin of brand_site_booking_brand). Service role only.';
COMMENT ON FUNCTION public.brand_site_plan_preview_inputs(uuid) IS
  '#4453 milestone 10 — the plan and brand fields a plan preview composes from (the owner''s own words, verbatim). Read only; content rank 20 via brand_site_plan_gate.';
COMMENT ON FUNCTION public.brand_site_plan_preview_take(uuid) IS
  '#4453 milestone 10 — takes one plan-preview request for a brand: refused after 3 in a minute or 20 in a day (PLAN_PREVIEW_RATE_LIMITED). Service role only.';
COMMENT ON FUNCTION public.brand_site_plan_preview_on(uuid) IS
  '#4453 milestone 10 — SITES_PLAN_PREVIEW for a brand: the flag, or the brand is in brand_site_plan_preview_brands. Service role only.';

COMMIT;
