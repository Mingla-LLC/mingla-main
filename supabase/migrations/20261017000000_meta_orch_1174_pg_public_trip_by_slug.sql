-- META-ORCH-1174 Leg A [trip-page-standardize] — Migration: canonical trip read RPC.
--
-- Trip leg of META-ORCH-1166 (public offering-page single source of truth). Mirrors
-- ORCH-1167's pg_public_event_by_slug + ORCH-1163's pg_public_rsvp_by_slug.
--
-- WHAT: `pg_public_trip_by_slug(p_brand_slug, p_event_slug) RETURNS json` — the ONE
-- anon read path that fills the shared `TripOfferingBody` prop contract on ALL THREE
-- surfaces (buyer-web, business native, consumer app) from a single source. Returns
-- the full 10-section trip payload: identity/slugs/description, master start/end
-- (from event_dates), departure/destination text, derived inputs, cover, brand card
-- (cover-media-aware + theme), per-tier rows WITH remaining capacity + tier_metadata
-- installments, booking_deadline + bookings_closed, refund_policy, trip_days
-- (itinerary), trip_inclusions (included/excluded), AND — the gap the consumer
-- payload lacks today — the destination lat/lng so the §11 "Where you'll be" map can
-- render on EVERY surface. Restricted to event_type='trip' + published.
--
-- READING NOTES (parity with usePublicTripBySlug):
--   • Trip dates: event_dates master row (canonical, ORCH-0950) first, theme
--     business_trip JSON mirror fallback.
--   • departure/destination: canonical events.departure_text / destination_text
--     first, theme business_trip mirror fallback (ORCH-1138 native-parity fix #1).
--   • lat/lng: theme.business_trip.destinationLat/Lng + departureLat/Lng (these live
--     ONLY in the theme mirror today; emitted as {lat,lng} or null — rule 9).
--   • capacity: canonical ticket_types.quantity_total first, theme mirror fallback.
--   • per-tier remaining: GREATEST(quantity_total - sold, 0); sold = COUNT of
--     tickets rows status IN ('valid','used','transferred') — IDENTICAL to
--     pg_public_ticket_types_remaining (ORCH-0946) so the sold-out gate is unchanged.
--   • brand THEME: read from the brands row here (the RPC is SECURITY DEFINER, so the
--     anon column-level grant gap that forced usePublicTripBySlug to source theme
--     from business_public_events_view (COMMS-0009/#507) does NOT apply — the definer
--     owner reads theme_color/font/animation directly). Per-trip overrides come off
--     the events row.
--
-- SAFE-MIGRATION PROTOCOL (cross-host rules / migration baseline):
--   • SECURITY DEFINER, STABLE, SET search_path = public; reads anon-safe columns.
--   • $function$ terminator BEFORE the GRANT.
--   • DROP IF EXISTS before CREATE (idempotent; RETURNS json so no RETURNS-TABLE
--     widening hazard).
--   • GRANT EXECUTE TO anon, authenticated.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API post-merge.

DROP FUNCTION IF EXISTS public.pg_public_trip_by_slug(text, text);

CREATE FUNCTION public.pg_public_trip_by_slug(
  p_brand_slug text,
  p_event_slug text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH tr AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.status,
      e.timezone,
      e.currency,
      e.cover_media_url,
      e.cover_media_type,
      e.departure_text,
      e.destination_text,
      e.refund_policy,
      e.booking_deadline,
      e.bookings_closed,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      e.theme               AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
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
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND e.slug = p_event_slug
      AND e.event_type = 'trip'             -- trip ONLY (Leg A scope)
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text])
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
    LIMIT 1
  ),
  tiers AS (
    SELECT
      tpt.id,
      tpt.ticket_type_id,
      tpt.tier_name,
      tpt.tier_metadata,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      -- remaining capacity (NULL for unlimited / no cap); sold formula IDENTICAL
      -- to pg_public_ticket_types_remaining (ORCH-0946).
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
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
    FROM public.trip_pricing_tiers tpt
    JOIN tr ON tr.id = tpt.event_id
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tt.deleted_at IS NULL
      AND COALESCE(tt.is_hidden, false) = false
  )
  SELECT
    CASE WHEN tr.id IS NULL THEN NULL ELSE json_build_object(
      'id', tr.id,
      'brandId', tr.brand_id,
      'brandSlug', tr.brand_slug,
      'tripSlug', tr.event_slug,
      'title', tr.title,
      'description', tr.description,
      'status', tr.status,
      'timezone', tr.timezone,
      -- master dates (event_dates) first, theme business_trip mirror fallback.
      'startAt', COALESCE(
        tr.master_start_at::text,
        NULLIF((tr.public_theme #>> '{business_trip,startAt}'), '')
      ),
      'endAt', COALESCE(
        tr.master_end_at::text,
        NULLIF((tr.public_theme #>> '{business_trip,endAt}'), '')
      ),
      -- route legs: canonical column first, theme mirror fallback (rule 9 — null
      -- when neither present → that leg/pill is omitted by the body).
      'departureText', COALESCE(
        NULLIF(tr.departure_text, ''),
        NULLIF((tr.public_theme #>> '{business_trip,departureLocationText}'), '')
      ),
      'destinationText', COALESCE(
        NULLIF(tr.destination_text, ''),
        NULLIF((tr.public_theme #>> '{business_trip,destinationLocationText}'), '')
      ),
      -- destination lat/lng (theme mirror only today). The consumer payload lacks
      -- these → its §11 map silently omitted; the RPC closes that parity gap.
      'destinationLat', (tr.public_theme #>> '{business_trip,destinationLat}')::float8,
      'destinationLng', (tr.public_theme #>> '{business_trip,destinationLng}')::float8,
      'departureLat', (tr.public_theme #>> '{business_trip,departureLat}')::float8,
      'departureLng', (tr.public_theme #>> '{business_trip,departureLng}')::float8,
      'currency', COALESCE(tr.currency, 'usd'),
      'coverMediaUrl', tr.cover_media_url,
      'coverMediaType', tr.cover_media_type,
      'refundPolicy', tr.refund_policy,
      'bookingDeadline', tr.booking_deadline,
      'bookingsClosed', COALESCE(tr.bookings_closed, false),
      'themeColorOverride', tr.theme_color_override,
      'themeFontOverride', tr.theme_font_override,
      'themeAnimationOverride', tr.theme_animation_override,
      'brand', json_build_object(
        'id', tr.brand_id_b,
        'slug', tr.brand_slug,
        'name', tr.brand_name,
        'bio', tr.brand_description,
        'coverMediaUrl', tr.brand_cover_media_url,
        'coverMediaType', tr.brand_cover_media_type,
        'coverHue', tr.brand_cover_hue,
        'verified', COALESCE(tr.brand_is_verified, false),
        'themeColor', tr.brand_theme_color,
        'themeFont', tr.brand_theme_font,
        'themeAnimation', tr.brand_theme_animation
      ),
      'days', COALESCE((
        SELECT json_agg(json_build_object(
          'id', d.id,
          'ordinal', d.ordinal,
          'title', d.title,
          'narrative', d.narrative,
          'date', d.date,
          'stops', COALESCE(d.stops, '[]'::jsonb),
          'media', COALESCE(d.media, '[]'::jsonb)
        ) ORDER BY d.ordinal ASC)
        FROM public.trip_days d
        WHERE d.event_id = tr.id
      ), '[]'::json),
      'inclusions', COALESCE((
        SELECT json_agg(json_build_object(
          'id', i.id,
          'kind', i.kind,
          'item', i.item,
          'ordinal', i.ordinal
        ) ORDER BY i.kind ASC, i.ordinal ASC)
        FROM public.trip_inclusions i
        WHERE i.event_id = tr.id
      ), '[]'::json),
      'tiers', COALESCE((
        SELECT json_agg(json_build_object(
          'id', tiers.id,
          'ticketTypeId', tiers.ticket_type_id,
          'tierName', tiers.tier_name,
          'tierMetadata', COALESCE(tiers.tier_metadata, '{}'::jsonb),
          'priceCents', COALESCE(tiers.price_cents, 0),
          'currency', COALESCE(tiers.currency, ''),
          'quantityTotal', tiers.quantity_total,
          'ticketsRemaining', tiers.remaining,
          'isUnlimited', COALESCE(tiers.is_unlimited, false),
          'isFree', COALESCE(tiers.is_free, false),
          'installments', tiers.tier_metadata -> 'installments'
        ))
        FROM tiers
      ), '[]'::json)
    ) END
  FROM tr;
$function$;

COMMENT ON FUNCTION public.pg_public_trip_by_slug(text, text) IS
  'META-ORCH-1174 Leg A — the ONE canonical anon read path for the public trip page '
  '(event_type=trip). Returns the full TripOfferingBody payload as json incl. master '
  'dates, route legs + destination/departure lat/lng (closing the consumer map gap), '
  'per-tier rows with remaining + installments, trip_days itinerary, trip_inclusions, '
  'refund_policy, booking_deadline, and the brand card (cover/theme/verified).';

GRANT EXECUTE ON FUNCTION public.pg_public_trip_by_slug(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
