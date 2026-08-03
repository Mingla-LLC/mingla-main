-- Issue #1390: anonymous-safe Stay detail and guest-owned itinerary reads.
--
-- Public browsing receives only active, verified, live Stay data. Authoritative
-- availability, totals, holds, payment, and cancellation remain behind the
-- authenticated #1388/#1389 contracts.

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_public_stay_details(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_public_enabled boolean := false;
  v_venue record;
  v_settings public.stay_settings%ROWTYPE;
BEGIN
  SELECT flag.is_enabled
  INTO v_public_enabled
  FROM public.feature_flags flag
  WHERE flag.flag_key = 'STAY_PUBLIC_PAGES';

  IF NOT COALESCE(v_public_enabled, false) THEN
    RETURN NULL;
  END IF;

  SELECT
    venue.id,
    venue.brand_id,
    venue.brand_slug,
    venue.brand_name,
    venue.slug,
    venue.name
  INTO v_venue
  FROM public.venue_public_view venue
  WHERE venue.id = p_venue_id
    AND venue.venue_category = 'stay';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_settings
  FROM public.stay_settings settings
  WHERE settings.venue_id = p_venue_id
    AND settings.booking_state = 'active';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'brandId', v_venue.brand_id,
    'brandSlug', v_venue.brand_slug,
    'brandName', v_venue.brand_name,
    'venueSlug', v_venue.slug,
    'venueName', v_venue.name,
    'propertyKind', v_settings.property_kind,
    'timezone', v_settings.timezone,
    'defaultBookingMode', v_settings.default_booking_mode,
    'checkInTime', v_settings.check_in_time,
    'checkOutTime', v_settings.check_out_time,
    'bookingHorizonDays', v_settings.booking_horizon_days,
    'houseRules', v_settings.house_rules,
    'offerings', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', offering.id,
          'kind', offering.kind,
          'name', offering.name,
          'summary', offering.summary,
          'description', offering.description,
          'confirmationMode', COALESCE(
            offering.confirmation_mode,
            v_settings.default_booking_mode
          ),
          'inventoryBasis', offering.inventory_basis,
          'unitNamingMode', offering.unit_naming_mode,
          'quantity', offering.quantity,
          'capacity', offering.capacity,
          'minGuests', offering.min_guests,
          'maxGuests', offering.max_guests,
          'maxAdults', offering.max_adults,
          'maxChildren', offering.max_children,
          'placePricingBasis', offering.place_pricing_basis,
          'minNoticeMinutes', offering.min_notice_minutes,
          'maxAdvanceDays', offering.max_advance_days,
          'amenities', offering.amenities,
          'safetyRules', offering.safety_rules,
          'accessibilityFeatures', offering.accessibility_features,
          'accessScope', offering.access_scope,
          'price', jsonb_build_object(
            'amountMinor', price.amount_minor::text,
            'currencyCode', price.currency_code,
            'pricingUnit', price.pricing_unit
          ),
          'fees', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'label', fee.label,
              'kind', fee.fee_kind,
              'calculation', fee.calculation,
              'amountMinor', CASE
                WHEN fee.amount_minor IS NULL THEN NULL
                ELSE fee.amount_minor::text
              END,
              'basisPoints', fee.basis_points,
              'currencyCode', fee.currency_code,
              'displayMode', fee.display_mode
            ) ORDER BY fee.fee_key)
            FROM public.stay_fee_versions fee
            WHERE fee.offering_id = offering.id
              AND fee.effective_to IS NULL
          ), '[]'::jsonb),
          'policy', jsonb_build_object(
            'cancellationPolicy', policy.cancellation_policy,
            'freeCancelCutoffMinutes', policy.free_cancel_cutoff_minutes,
            'requestTerms', policy.request_terms,
            'houseRules', policy.house_rules
          ),
          'media', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'path', media.storage_object_name,
              'mimeType', media.mime_type,
              'altText', media.alt_text,
              'isCover', media.is_cover,
              'sortOrder', media.sort_order
            ) ORDER BY media.sort_order, media.id)
            FROM public.stay_offering_media media
            WHERE media.offering_id = offering.id
              AND media.status = 'ready'
          ), '[]'::jsonb),
          'placeWindows', CASE
            WHEN offering.kind = 'place' THEN COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', place_window.id,
                'localDate', place_window.local_date,
                'startsAt', place_window.starts_at,
                'endsAt', place_window.ends_at,
                'sellableUnits', place_window.sellable_units,
                'sellableCapacity', place_window.sellable_capacity,
                'priceOverrideMinor', CASE
                  WHEN place_window.price_override_minor IS NULL THEN NULL
                  ELSE place_window.price_override_minor::text
                END,
                'currencyCode', place_window.currency_code
              ) ORDER BY place_window.starts_at, place_window.id)
              FROM (
                SELECT bounded_window.*
                FROM public.stay_place_windows bounded_window
                WHERE bounded_window.offering_id = offering.id
                  AND NOT bounded_window.stop_sell
                  AND bounded_window.ends_at > now()
                  AND bounded_window.starts_at
                    < now() + pg_catalog.make_interval(
                      days => LEAST(
                        v_settings.booking_horizon_days,
                        COALESCE(offering.max_advance_days, 120)
                      )
                    )
                ORDER BY bounded_window.starts_at, bounded_window.id
                LIMIT 500
              ) place_window
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        )
        ORDER BY offering.kind, offering.created_at, offering.id
      )
      FROM public.stay_offerings offering
      JOIN public.stay_price_versions price
        ON price.offering_id = offering.id
       AND price.effective_to IS NULL
      JOIN public.stay_policy_versions policy
        ON policy.offering_id = offering.id
       AND policy.effective_to IS NULL
      WHERE offering.venue_id = p_venue_id
        AND offering.status = 'live'
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_my_stay_reservation_groups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'groupId', reservation_group.id,
      'publicReference', reservation_group.public_reference,
      'venueId', reservation_group.venue_id,
      'venueName', venue.name,
      'venueSlug', venue.slug,
      'brandId', reservation_group.brand_id,
      'brandName', brand.name,
      'brandSlug', brand.slug,
      'currencyCode', reservation_group.currency_code,
      'mode', reservation_group.mode,
      'state', reservation_group.state,
      'requestDeadline', reservation_group.request_deadline,
      'paymentDeadline', reservation_group.payment_deadline,
      'totalMinor', reservation_group.total_minor::text,
      'version', reservation_group.version,
      'createdAt', reservation_group.created_at,
      'updatedAt', reservation_group.updated_at,
      'lines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'lineId', reservation_line.id,
          'kind', reservation_line.kind,
          'state', reservation_line.state,
          'name', reservation_line.offering_snapshot->>'name',
          'roomCheckIn', reservation_line.room_check_in,
          'roomCheckOut', reservation_line.room_check_out,
          'roomQuantity', reservation_line.room_quantity,
          'placeStartsAt', place_window.starts_at,
          'placeEndsAt', place_window.ends_at,
          'placeGuests', reservation_line.place_guests,
          'totalMinor', reservation_line.total_minor::text
        ) ORDER BY reservation_line.kind, reservation_line.id)
        FROM public.stay_reservation_lines reservation_line
        LEFT JOIN public.stay_place_windows place_window
          ON place_window.id = reservation_line.place_window_id
        WHERE reservation_line.group_id = reservation_group.id
      ), '[]'::jsonb)
    ) ORDER BY reservation_group.created_at DESC, reservation_group.id DESC)
    FROM public.stay_reservation_groups reservation_group
    JOIN public.venue_listings venue ON venue.id = reservation_group.venue_id
    JOIN public.brands brand ON brand.id = reservation_group.brand_id
    WHERE reservation_group.user_id = v_uid
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_public_stay_details(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_my_stay_reservation_groups() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_my_stay_reservation_groups() FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_public_stay_details(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_my_stay_reservation_groups()
  TO authenticated;

COMMENT ON FUNCTION public.pg_public_stay_details(uuid) IS
  'Issue #1390: feature-gated anonymous-safe projection of active verified Stay Rooms and Places. Quote remains authoritative.';
COMMENT ON FUNCTION public.pg_my_stay_reservation_groups() IS
  'Issue #1390: authenticated guest-owned Stay itinerary list with scheduled Room/Place display dates; no staff or cross-user rows.';

COMMIT;
