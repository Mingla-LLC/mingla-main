-- #4453 milestone 5 (spec v2 §5.1, §5.4, §5.5, §5.6) — the live booking reads a
-- brand's website draws from: open table slots, nights, offering dates, public
-- ticket tiers, the hero booking bar's target, and the Mingla rating.
--
-- Every function here:
--   * is static SQL (no EXECUTE, no dynamic identifiers), STABLE, SECURITY
--     DEFINER with an explicit search_path, and SERVICE ROLE ONLY (the
--     brand-site-runtime-resolve edge function is the one caller; the site id
--     comes from the signed envelope the runtime resolved for the request host);
--   * reads only the site's OWN brand: a venue, room, event or experience of
--     another brand answers NULL, exactly like one that does not exist;
--   * returns only what a public website shows (names, times, counts, prices,
--     Mingla page links). No guest, buyer, reviewer or staff data, no ids
--     beyond the offering's own, and no Google rating data, ever;
--   * builds every link itself, to this brand's own Mingla page on
--     host.usemingla.com, pre-filled; a full slot has no link.
-- pg_venue_available_slots is CALLED, never changed (spec §10.5): it already
-- honours the venue's advance window and minimum notice and works in the
-- venue's own zone.
--
-- SITES_BOOKING_BLOCKS (feature_flags, off) gates OFFERING the new blocks
-- (Studio, and Ari from milestone 7). These reads are not flagged: rendering a
-- stored block is never flagged (spec §9). The stay reads answer only while
-- the stay flags (STAY_PUBLIC_PAGES and STAY_RESERVE_WRITES) are on.
--
-- Forward-only. Applied by Seth's chat before the matching Core deploy.

BEGIN;

SET LOCAL lock_timeout = '10s';

INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_BOOKING_BLOCKS', false,
  '#4453 milestone 5 — offer the live booking blocks (availability, ticket tiers, how it works), the hero booking bar, the Mingla rating and the sticky phone bar on Mingla websites. Rendering stored blocks is never flagged.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_BOOKING_BLOCKS');

CREATE OR REPLACE FUNCTION public.brand_site_booking_blocks_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT is_enabled FROM public.feature_flags
    WHERE flag_key = 'SITES_BOOKING_BLOCKS' LIMIT 1), false);
$function$;

-- Both stay flags: a site shows nights and rooms only while guests can see
-- and reserve them on Mingla.
CREATE OR REPLACE FUNCTION public.brand_site_stay_flags_on()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT bool_and(f.is_enabled) AND count(*) = 2
    FROM public.feature_flags f
    WHERE f.flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES')), false);
$function$;

-- A zone name that exists, else UTC (the same fallback the slot engine uses).
CREATE OR REPLACE FUNCTION public.brand_site_zone_or_utc(p_zone text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_zone, '')), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = btrim(p_zone))
    THEN btrim(p_zone) ELSE 'UTC' END;
$function$;

-- The site's own brand (id, slug), or no row.
CREATE OR REPLACE FUNCTION public.brand_site_booking_brand(p_site_id uuid)
RETURNS TABLE (brand_id uuid, brand_slug text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT b.id, b.slug
  FROM public.brand_sites s
  JOIN public.brands b ON b.id = s.brand_id
  WHERE s.id = p_site_id AND b.deleted_at IS NULL
  LIMIT 1;
$function$;

-- ── 1. Table and visit slots (§5.1 venue_slots) ──────────────────────────
-- Only a VERIFIED venue of this brand with reservations on. Days run from the
-- venue's local today; at most 24 slots a day; "few" is 1-3 left.
CREATE OR REPLACE FUNCTION public.brand_site_venue_slots(
  p_site_id uuid, p_venue_id uuid, p_party_size integer, p_days integer
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
  IF p_site_id IS NULL OR p_venue_id IS NULL OR p_party_size IS NULL OR p_days IS NULL
     OR p_party_size NOT BETWEEN 1 AND 20 OR p_days NOT BETWEEN 3 AND 14 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
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

-- ── 2. Nights (§5.1 stay_nights) ─────────────────────────────────────────
-- A LIVE room or place of this brand's verified stay venue, only while the
-- stay flags are on. A night is shown when Mingla has a room-night row for
-- it; stop-sell or nothing sellable is "full" (no link). The price is the
-- night's own: its override, else the current price version. NO stay total is
-- ever computed here: the link carries the dates to Mingla's own quote.
CREATE OR REPLACE FUNCTION public.brand_site_stay_nights(
  p_site_id uuid, p_stay_offering_id uuid, p_days integer
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_room record;
  v_tz text;
  v_today date;
  v_last date;
  v_days jsonb;
BEGIN
  IF p_site_id IS NULL OR p_stay_offering_id IS NULL OR p_days IS NULL OR p_days NOT BETWEEN 3 AND 14 THEN
    RETURN NULL;
  END IF;
  IF NOT public.brand_site_stay_flags_on() THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT o.id, o.name, o.max_advance_days, v.slug AS venue_slug, ss.timezone INTO v_room
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
  LEFT JOIN public.stay_settings ss ON ss.venue_id = v.id
  WHERE o.id = p_stay_offering_id AND o.brand_id = v_brand.brand_id
    AND o.status = 'live' AND o.archived_at IS NULL AND v.claim_status = 'verified';
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_tz := public.brand_site_zone_or_utc(v_room.timezone);
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_last := v_today + (p_days - 1);
  IF v_room.max_advance_days IS NOT NULL THEN
    v_last := LEAST(v_last, v_today + v_room.max_advance_days);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'local_date', to_char(n.local_date, 'YYYY-MM-DD'),
      'slots', jsonb_build_array(jsonb_build_object(
        'label', to_char(n.local_date, 'Dy DD Mon'),
        'start_local', to_char(n.local_date, 'YYYY-MM-DD'),
        'state', CASE WHEN n.stop_sell OR n.sellable_quantity <= 0 THEN 'full'
                      WHEN n.sellable_quantity <= 3 THEN 'few' ELSE 'open' END,
        'left', CASE WHEN n.stop_sell THEN 0 ELSE GREATEST(n.sellable_quantity, 0) END,
        'price_minor', COALESCE(n.price_override_minor, pv.amount_minor),
        'currency', COALESCE(n.currency_code, pv.currency_code)::text,
        'href', CASE WHEN n.stop_sell OR n.sellable_quantity <= 0 THEN NULL
          ELSE 'https://host.usemingla.com/b/' || v_brand.brand_slug || '/v/' || v_room.venue_slug
            || '?tab=stay&checkin=' || to_char(n.local_date, 'YYYY-MM-DD')
            || '&checkout=' || to_char(n.local_date + n.minimum_nights, 'YYYY-MM-DD')
            || '&room=' || v_room.id::text END
      ))
    ) ORDER BY n.local_date), '[]'::jsonb) INTO v_days
  FROM public.stay_room_nights n
  LEFT JOIN LATERAL (
    SELECT p.amount_minor, p.currency_code
    FROM public.stay_price_versions p
    WHERE p.offering_id = n.offering_id AND p.pricing_unit = 'room_night'
      AND p.effective_from <= now() AND (p.effective_to IS NULL OR p.effective_to > now())
    ORDER BY p.version_number DESC
    LIMIT 1
  ) pv ON true
  WHERE n.offering_id = v_room.id AND n.local_date BETWEEN v_today AND v_last;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', v_tz,
    'source', 'stay_nights',
    'title', left(v_room.name, 200),
    'days', v_days
  );
END;
$function$;

-- ── 3. Offering dates (§5.1 event_dates, experience_slots, trip_departures)
-- A public, scheduled or live offering of this brand that passes Mingla's
-- visibility gate, with its dates in the window (its own zone). Places left
-- per date are counted by Mingla's page; a trip carries its spots left.
CREATE OR REPLACE FUNCTION public.brand_site_offering_dates(
  p_site_id uuid, p_offering_id uuid, p_source text, p_days integer
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
  IF p_site_id IS NULL OR p_offering_id IS NULL OR p_days IS NULL OR p_days NOT BETWEEN 3 AND 14
     OR p_source NOT IN ('event_dates', 'experience_slots', 'trip_departures') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
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
      AND ed.start_at >= now()
      -- A multi-date offering lists its occurrences; a single-date one its master.
      AND (ed.is_master = false OR NOT EXISTS (
        SELECT 1 FROM public.event_dates o WHERE o.event_id = v_event.id AND o.is_master = false))
  ),
  windowed AS (
    SELECT d.*, d.local_start::date AS local_date,
      row_number() OVER (PARTITION BY d.local_start::date ORDER BY d.start_at, d.id) AS n
    FROM dates d
    WHERE d.local_start::date BETWEEN v_today AND v_today + (p_days - 1)
  ),
  days AS (
    SELECT w.local_date, jsonb_agg(jsonb_build_object(
        'label', CASE WHEN p_source = 'experience_slots' THEN to_char(w.local_start, 'HH24:MI')
                      ELSE to_char(w.local_start, 'Dy DD Mon · HH24:MI') END,
        'start_local', to_char(w.local_start, 'YYYY-MM-DD"T"HH24:MI'),
        'state', CASE WHEN v_left IS NOT NULL AND v_left <= 0 THEN 'full'
                      WHEN v_left IS NOT NULL AND v_left <= 3 THEN 'few' ELSE 'open' END,
        'left', v_left,
        'price_minor', NULL,
        'currency', NULL,
        'href', CASE
          WHEN v_left IS NOT NULL AND v_left <= 0 THEN NULL
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

-- ── 4. Ticket tiers (§5.4) ───────────────────────────────────────────────
-- A public EVENT of this brand. Its tiers in Mingla's own order, at most 6.
-- NEVER shown: hidden, disabled, password-protected, door-only (not online),
-- trip places, and any tier sold through a private ticket link (link-only and
-- member-pass tiers: `ticket_type_links` are bearer links and stay off sites).
-- The event comes back with its status, so an ended event renders nothing.
CREATE OR REPLACE FUNCTION public.brand_site_ticket_tiers(p_site_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_event record;
  v_tiers jsonb;
BEGIN
  IF p_site_id IS NULL OR p_event_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
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

-- ── 5. The hero booking bar's target (§5.5) ─────────────────────────────
-- The page the bar hands off to, with no query (the runtime adds only the
-- pre-fill parameters). NULL unless the target is this brand's and bookable:
-- a verified venue with reservations on; a live room (stay flags on); an
-- upcoming public experience.
CREATE OR REPLACE FUNCTION public.brand_site_booking_target(p_site_id uuid, p_kind text, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_row record;
BEGIN
  IF p_site_id IS NULL OR p_target_id IS NULL OR p_kind NOT IN ('venue_table', 'stay', 'experience') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_kind = 'venue_table' THEN
    SELECT v.id, v.name AS title, v.slug, public.brand_site_zone_or_utc(c.iana_timezone) AS tz INTO v_row
    FROM public.venue_listings v
    JOIN public.venue_reservation_settings r ON r.venue_id = v.id AND r.reservations_enabled
    LEFT JOIN public.venue_availability_config c ON c.venue_id = v.id
    WHERE v.id = p_target_id AND v.brand_id = v_brand.brand_id AND v.claim_status = 'verified'
      AND v.venue_category IN ('restaurant', 'play', 'creative_and_arts');
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('kind', 'venue_table', 'id', v_row.id, 'title', left(v_row.title, 200),
      'base_url', 'https://host.usemingla.com/b/' || v_brand.brand_slug || '/v/' || v_row.slug,
      'timezone', v_row.tz, 'min_price_minor', NULL, 'currency', NULL);
  ELSIF p_kind = 'stay' THEN
    IF NOT public.brand_site_stay_flags_on() THEN RETURN NULL; END IF;
    SELECT o.id, o.name AS title, v.slug, public.brand_site_zone_or_utc(ss.timezone) AS tz,
      night.price_minor, night.currency INTO v_row
    FROM public.stay_offerings o
    JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
    LEFT JOIN public.stay_settings ss ON ss.venue_id = v.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(n.price_override_minor, pv.amount_minor) AS price_minor,
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
    WHERE o.id = p_target_id AND o.brand_id = v_brand.brand_id AND o.status = 'live'
      AND o.archived_at IS NULL AND v.claim_status = 'verified';
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('kind', 'stay', 'id', v_row.id, 'title', left(v_row.title, 200),
      'base_url', 'https://host.usemingla.com/b/' || v_brand.brand_slug || '/v/' || v_row.slug,
      'timezone', v_row.tz, 'min_price_minor', v_row.price_minor,
      'currency', CASE WHEN v_row.currency ~ '^[A-Z]{3}$' THEN v_row.currency END);
  END IF;
  SELECT e.id, e.title, e.slug, public.brand_site_zone_or_utc(e.timezone) AS tz INTO v_row
  FROM public.events e
  WHERE e.id = p_target_id AND e.brand_id = v_brand.brand_id AND e.event_type = 'experience'
    AND e.visibility = 'public' AND e.status IN ('scheduled', 'live') AND e.deleted_at IS NULL
    AND e.slug IS NOT NULL
    AND public.pg_offering_passes_visibility_gate(e.id, 'direct');
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('kind', 'experience', 'id', v_row.id, 'title', left(v_row.title, 200),
    'base_url', 'https://host.usemingla.com/exp/' || v_brand.brand_slug || '/' || v_row.slug,
    'timezone', v_row.tz, 'min_price_minor', NULL, 'currency', NULL);
END;
$function$;

-- ── 6. The Mingla rating (§5.6, D4) ─────────────────────────────────────
-- Mean and count of APPROVED Mingla place reviews for the places linked to
-- this brand's VERIFIED venues. Google data is never read (no place_pool
-- rating, no review_count, no external reviews); owner testimonials are
-- quotes, not ratings; local reviews are out until Seth includes them.
-- Under 20 approved reviews: NULL (19 shows nothing). No score filtering.
CREATE OR REPLACE FUNCTION public.brand_site_mingla_rating(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_count bigint;
  v_mean numeric;
BEGIN
  IF p_site_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), avg(pr.rating) INTO v_count, v_mean
  FROM public.place_reviews pr
  WHERE pr.moderation_status = 'approved'
    AND pr.place_pool_id IN (
      SELECT v.place_pool_id FROM public.venue_listings v
      WHERE v.brand_id = v_brand.brand_id AND v.claim_status = 'verified' AND v.place_pool_id IS NOT NULL);
  IF COALESCE(v_count, 0) < 20 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('source', 'mingla_place_reviews', 'score', round(v_mean, 1), 'count', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.brand_site_booking_blocks_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_booking_blocks_enabled() TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_stay_flags_on() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_stay_flags_on() TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_zone_or_utc(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_zone_or_utc(text) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_booking_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_booking_brand(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_venue_slots(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_venue_slots(uuid,uuid,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_stay_nights(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_stay_nights(uuid,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offering_dates(uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offering_dates(uuid,uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_ticket_tiers(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_ticket_tiers(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_booking_target(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_booking_target(uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_mingla_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_mingla_rating(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_venue_slots(uuid,uuid,integer,integer) IS
  '#4453 M5 — open table/visit slots of one verified venue of the site''s own brand (reservations on), from pg_venue_available_slots, in the venue''s zone; full slots carry no link. Service role only.';
COMMENT ON FUNCTION public.brand_site_stay_nights(uuid,uuid,integer) IS
  '#4453 M5 — sellable nights of one live room of the site''s own brand, only while the stay flags are on; the night''s own price, never a stay total. Service role only.';
COMMENT ON FUNCTION public.brand_site_offering_dates(uuid,uuid,text,integer) IS
  '#4453 M5 — upcoming dates of one public, bookable event, experience or trip of the site''s own brand, in its zone. Service role only.';
COMMENT ON FUNCTION public.brand_site_ticket_tiers(uuid,uuid) IS
  '#4453 M5 — up to 6 public ticket tiers of one event of the site''s own brand, in Mingla''s order; hidden, disabled, password, door-only, trip and link-only tiers never. Service role only.';
COMMENT ON FUNCTION public.brand_site_booking_target(uuid,text,uuid) IS
  '#4453 M5 — the Mingla page the hero booking bar hands off to (venue, room or experience of the site''s own brand). Service role only.';
COMMENT ON FUNCTION public.brand_site_mingla_rating(uuid) IS
  '#4453 M5 — mean and count of approved Mingla place reviews for the brand''s verified venues; NULL under 20; never Google data. Service role only.';

COMMIT;
