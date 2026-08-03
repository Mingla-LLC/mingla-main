-- Issue #1423: anonymous-safe Stay discovery for the existing consumer
-- Discover capsule. The reservation quote remains the final authority; this
-- projection removes current holds/commitments so date-filtered cards never
-- advertise already-consumed inventory.

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_public_stays_discover(
  p_destination_query text DEFAULT NULL,
  p_check_in date DEFAULT NULL,
  p_check_out date DEFAULT NULL,
  p_adults integer DEFAULT 2,
  p_children integer DEFAULT 0,
  p_rooms integer DEFAULT 1,
  p_property_kinds text[] DEFAULT NULL,
  p_amenities text[] DEFAULT NULL,
  p_confirmation_mode text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_public_enabled boolean := false;
  v_destination text := NULLIF(pg_catalog.btrim(p_destination_query), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  SELECT flag.is_enabled
  INTO v_public_enabled
  FROM public.feature_flags flag
  WHERE flag.flag_key = 'STAY_PUBLIC_PAGES';

  IF NOT COALESCE(v_public_enabled, false) THEN
    RETURN jsonb_build_object(
      'enabled', false,
      'rows', '[]'::jsonb,
      'totalCount', 0
    );
  END IF;

  IF (p_check_in IS NULL) <> (p_check_out IS NULL)
     OR (p_check_in IS NOT NULL AND p_check_out <= p_check_in)
     OR (
       p_check_in IS NOT NULL
       AND p_check_out - p_check_in NOT BETWEEN 1 AND 365
     )
     OR COALESCE(p_adults, 0) NOT BETWEEN 1 AND 1000
     OR COALESCE(p_children, -1) NOT BETWEEN 0 AND 1000
     OR COALESCE(p_rooms, 0) NOT BETWEEN 1 AND 100
     OR p_offset IS NULL OR p_offset < 0
     OR (v_destination IS NOT NULL AND char_length(v_destination) > 120)
     OR (
       p_confirmation_mode IS NOT NULL
       AND p_confirmation_mode NOT IN ('request', 'instant')
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(COALESCE(p_property_kinds, '{}'::text[])) value
       WHERE value IS NULL OR value NOT IN (
         'hotel', 'resort', 'guest_house', 'lodge',
         'serviced_apartment', 'short_stay_apartment', 'other'
       )
     )
     OR EXISTS (
       SELECT 1
       FROM unnest(COALESCE(p_amenities, '{}'::text[])) value
       WHERE value IS NULL OR char_length(value) NOT BETWEEN 1 AND 80
     )
  THEN
    RAISE EXCEPTION 'stay_invalid_discovery_filters' USING ERRCODE = '22023';
  END IF;

  WITH candidate_rooms AS MATERIALIZED (
    SELECT
      venue.id AS venue_id,
      venue.brand_id,
      venue.brand_slug,
      venue.brand_name,
      venue.slug AS venue_slug,
      venue.name AS venue_name,
      venue.address,
      venue.city,
      venue.country_code,
      venue.cover_media_url,
      venue.cover_media_type,
      venue.default_currency,
      venue.created_at,
      settings.property_kind,
      settings.timezone,
      settings.default_booking_mode,
      settings.check_in_time,
      settings.booking_horizon_days,
      offering.id AS offering_id,
      offering.confirmation_mode,
      offering.max_advance_days,
      offering.min_notice_minutes,
      offering.quantity,
      offering.min_guests,
      offering.max_guests,
      offering.max_adults,
      offering.max_children,
      offering.amenities,
      price.amount_minor,
      price.currency_code::text AS currency_code,
      media.storage_object_name AS cover_path,
      media.alt_text AS cover_alt
    FROM public.venue_public_view venue
    JOIN public.stay_settings settings
      ON settings.venue_id = venue.id
     AND settings.brand_id = venue.brand_id
     AND settings.booking_state = 'active'
    JOIN public.stay_offerings offering
      ON offering.venue_id = venue.id
     AND offering.brand_id = venue.brand_id
     AND offering.kind = 'room'
     AND offering.status = 'live'
    JOIN public.stay_price_versions price
      ON price.offering_id = offering.id
     AND price.brand_id = venue.brand_id
     AND price.venue_id = venue.id
     AND price.effective_to IS NULL
     AND price.pricing_unit = 'room_night'
     AND price.currency_code::text = venue.default_currency
    JOIN public.stay_policy_versions policy
      ON policy.offering_id = offering.id
     AND policy.brand_id = venue.brand_id
     AND policy.venue_id = venue.id
     AND policy.effective_to IS NULL
    JOIN public.stay_offering_media media
      ON media.offering_id = offering.id
     AND media.brand_id = venue.brand_id
     AND media.venue_id = venue.id
     AND media.is_cover
     AND media.status = 'ready'
    WHERE venue.venue_category = 'stay'
      AND settings.property_kind IS NOT NULL
      AND (
        v_destination IS NULL
        OR venue.name ILIKE '%' || replace(replace(replace(v_destination, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'
        OR venue.brand_name ILIKE '%' || replace(replace(replace(v_destination, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'
        OR venue.city ILIKE '%' || replace(replace(replace(v_destination, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'
        OR venue.address ILIKE '%' || replace(replace(replace(v_destination, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'
        OR venue.country_code ILIKE '%' || replace(replace(replace(v_destination, '!', '!!'), '%', '!%'), '_', '!_') || '%' ESCAPE '!'
      )
      AND (
        COALESCE(pg_catalog.cardinality(p_property_kinds), 0) = 0
        OR settings.property_kind = ANY(p_property_kinds)
      )
      AND (
        COALESCE(pg_catalog.cardinality(p_amenities), 0) = 0
        OR offering.amenities @> p_amenities
      )
      AND (
        p_confirmation_mode IS NULL
        OR COALESCE(
          offering.confirmation_mode,
          settings.default_booking_mode
        ) = p_confirmation_mode
      )
      AND offering.quantity >= p_rooms
      AND offering.max_adults * p_rooms >= p_adults
      AND offering.max_children * p_rooms >= p_children
      AND offering.min_guests * p_rooms <= p_adults + p_children
      AND offering.max_guests * p_rooms >= p_adults + p_children
      AND (
        p_check_in IS NULL
        OR (
          p_check_in >= (now() AT TIME ZONE settings.timezone)::date
          AND p_check_in <=
            (now() AT TIME ZONE settings.timezone)::date
              + LEAST(
                settings.booking_horizon_days,
                COALESCE(offering.max_advance_days, settings.booking_horizon_days)
              )
          AND (
            (p_check_in::timestamp + settings.check_in_time)
              AT TIME ZONE settings.timezone
          ) >= now() + pg_catalog.make_interval(mins => offering.min_notice_minutes)
          AND NOT EXISTS (
            SELECT 1
            FROM generate_series(
              p_check_in::timestamp,
              (p_check_out - 1)::timestamp,
              interval '1 day'
            ) requested(day)
            LEFT JOIN public.stay_room_nights night
              ON night.offering_id = offering.id
             AND night.local_date = requested.day::date
            WHERE night.offering_id IS NULL
               OR night.stop_sell
               OR p_check_out - p_check_in < night.minimum_nights
               OR (
                 night.maximum_nights IS NOT NULL
                 AND p_check_out - p_check_in > night.maximum_nights
               )
               OR (
                 night.price_override_minor IS NOT NULL
                 AND night.currency_code::text <> venue.default_currency
               )
               OR night.sellable_quantity
                    - COALESCE((
                        SELECT sum(slice.quantity)
                        FROM public.stay_inventory_hold_slices slice
                        JOIN public.stay_inventory_holds hold
                          ON hold.id = slice.hold_id
                        WHERE slice.offering_id = offering.id
                          AND slice.resource_type = 'room_night'
                          AND slice.room_date = requested.day::date
                          AND (
                            (hold.state = 'active' AND hold.expires_at > now())
                            OR hold.state = 'reconciliation_required'
                          )
                      ), 0)
                    - COALESCE((
                        SELECT sum(commitment.quantity)
                        FROM public.stay_inventory_commitments commitment
                        WHERE commitment.offering_id = offering.id
                          AND commitment.resource_type = 'room_night'
                          AND commitment.room_date = requested.day::date
                          AND commitment.state = 'active'
                      ), 0) < p_rooms
          )
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.stay_room_nights future_night
        WHERE future_night.offering_id = offering.id
          AND future_night.local_date >= (now() AT TIME ZONE settings.timezone)::date
          AND NOT future_night.stop_sell
          AND future_night.sellable_quantity > 0
      )
  ),
  property_rows AS MATERIALIZED (
    SELECT
      room.venue_id,
      room.brand_id,
      room.brand_slug,
      room.brand_name,
      room.venue_slug,
      room.venue_name,
      room.address,
      room.city,
      room.country_code,
      room.cover_media_url,
      room.cover_media_type,
      room.default_currency,
      room.created_at,
      room.property_kind,
      min(room.amount_minor) AS amount_minor,
      (array_agg(room.cover_path ORDER BY room.amount_minor, room.offering_id))[1] AS cover_path,
      (array_agg(room.cover_alt ORDER BY room.amount_minor, room.offering_id))[1] AS cover_alt,
      array_agg(DISTINCT COALESCE(room.confirmation_mode, room.default_booking_mode)) AS confirmation_modes,
      array_agg(DISTINCT amenity.value ORDER BY amenity.value)
        FILTER (WHERE amenity.value IS NOT NULL) AS amenities
    FROM candidate_rooms room
    LEFT JOIN LATERAL unnest(room.amenities) AS amenity(value) ON true
    GROUP BY
      room.venue_id, room.brand_id, room.brand_slug, room.brand_name,
      room.venue_slug, room.venue_name, room.address, room.city,
      room.country_code, room.cover_media_url, room.cover_media_type,
      room.default_currency, room.created_at, room.property_kind
  ),
  counted AS (
    SELECT property.*, count(*) OVER () AS total_count
    FROM property_rows property
  ),
  paged AS (
    SELECT *
    FROM counted
    ORDER BY created_at DESC, venue_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'enabled', true,
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'venueId', page.venue_id,
      'brandId', page.brand_id,
      'brandSlug', page.brand_slug,
      'brandName', page.brand_name,
      'venueSlug', page.venue_slug,
      'venueName', page.venue_name,
      'propertyKind', page.property_kind,
      'address', page.address,
      'city', page.city,
      'countryCode', page.country_code,
      'coverPath', page.cover_path,
      'coverAlt', page.cover_alt,
      'venueCoverUrl', page.cover_media_url,
      'venueCoverType', page.cover_media_type,
      'amountMinor', page.amount_minor::text,
      'currencyCode', page.default_currency,
      'confirmationModes', to_jsonb(page.confirmation_modes),
      'amenities', to_jsonb(COALESCE(page.amenities, '{}'::text[])),
      'availabilityState', CASE
        WHEN p_check_in IS NULL THEN 'choose_dates'
        ELSE 'available'
      END
    ) ORDER BY page.created_at DESC, page.venue_id), '[]'::jsonb),
    'totalCount', COALESCE(max(page.total_count), 0)
  )
  INTO v_result
  FROM paged page;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_public_stays_discover(
  text, date, date, integer, integer, integer,
  text[], text[], text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_stays_discover(
  text, date, date, integer, integer, integer,
  text[], text[], text, integer, integer
) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_stays_discover(
  text, date, date, integer, integer, integer,
  text[], text[], text, integer, integer
) IS
  'Issue #1423: feature-gated verified Stay discovery with source-currency price truth and hold/commitment-aware multi-room date availability. Quote remains authoritative.';

COMMIT;
