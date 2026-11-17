-- #4453 milestone 5 (spec v2 §6.5) — the Sites offerings feed gains the `stay`
-- kind: live rooms and places of the brand's verified stay venues, only while
-- the stay flags (STAY_PUBLIC_PAGES and STAY_RESERVE_WRITES) are on.
--
-- Re-issued from its latest body (20280119072829) changing only:
--   * a `stays` row set (name, summary, ready cover from stay_offering_media,
--     the venue as the place line, "from" = the lowest sellable night in the
--     next 60 days, public_url = /b/{brand}/v/{venue}?tab=stay&room={id});
--   * a direct cover path column for those rows (NULL for every other kind,
--     which keep brand_site_offering_cover_path exactly as before).
-- Trips, events and experiences are unchanged. Service role only (unchanged).
-- Needs 20280726004453 (brand_site_stay_flags_on, brand_site_zone_or_utc).
--
-- Forward-only.

BEGIN;

SET LOCAL lock_timeout = '10s';

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
      WHERE n.offering_id = o.id AND NOT n.stop_sell AND n.sellable_quantity > 0
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
                WHEN l.cover_path IS NOT NULL AND l.cover_path ~ '^brand_covers/[A-Za-z0-9._/-]{1,900}$' AND position('..' in l.cover_path) = 0
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

REVOKE ALL ON FUNCTION public.brand_site_offerings_feed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offerings_feed(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_offerings_feed(uuid) IS
  '#2829 W4/W7c, #4453 M5 — the live offerings a brand''s website shows: only public, non-deleted trips/events/experiences of the site''s own brand, plus its live rooms while the stay flags are on (/b/ venue page, stay tab), composed from Mingla''s public readers; ended and cancelled included with their status; ended trips are shown even while the brand cannot take payments (A13.5), upcoming paid ones still need readiness; upcoming soonest first, then past newest first; max 200. Cards link to the existing Mingla public page (public_url). Service role only.';

COMMIT;
