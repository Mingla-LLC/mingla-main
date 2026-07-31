-- Issue #1424: feature-gated Stay venue creation, property setup, and safe
-- publish readiness. Restaurant/Play/Creative creation remains unchanged.

BEGIN;

ALTER TABLE public.stay_settings
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS amenities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS accessibility_features text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS arrival_instructions text;

ALTER TABLE public.stay_settings
  DROP CONSTRAINT IF EXISTS stay_settings_summary_length,
  ADD CONSTRAINT stay_settings_summary_length CHECK (
    summary IS NULL OR char_length(summary) <= 1000
  ),
  DROP CONSTRAINT IF EXISTS stay_settings_amenities_count,
  ADD CONSTRAINT stay_settings_amenities_count CHECK (
    cardinality(amenities) <= 50
  ),
  DROP CONSTRAINT IF EXISTS stay_settings_accessibility_count,
  ADD CONSTRAINT stay_settings_accessibility_count CHECK (
    cardinality(accessibility_features) <= 50
  ),
  DROP CONSTRAINT IF EXISTS stay_settings_arrival_length,
  ADD CONSTRAINT stay_settings_arrival_length CHECK (
    arrival_instructions IS NULL
    OR char_length(arrival_instructions) <= 2000
  );

CREATE OR REPLACE FUNCTION public.issue_1424_guard_stay_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.booking_state = 'active'
     AND (TG_OP = 'INSERT' OR OLD.booking_state <> 'active')
     AND EXISTS (
       SELECT 1
       FROM public.feature_flags flag
       WHERE flag.flag_key = 'STAY_VENUE_AUTHORING'
         AND flag.is_enabled
     )
     AND COALESCE(
       current_setting('mingla.stay_publish_authorized', true),
       ''
     ) <> 'true' THEN
    RAISE EXCEPTION 'stay_publish_action_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_1424_guard_stay_activation
  ON public.stay_settings;
CREATE TRIGGER issue_1424_guard_stay_activation
BEFORE INSERT OR UPDATE OF booking_state ON public.stay_settings
FOR EACH ROW
EXECUTE FUNCTION public.issue_1424_guard_stay_activation();

CREATE OR REPLACE FUNCTION public.issue_1387_stay_inventory_snapshot(
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id;
  IF NOT FOUND OR v_venue.venue_category <> 'stay' THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'read'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id,
      'brandId', v_venue.brand_id,
      'name', v_venue.name,
      'category', v_venue.venue_category
    ),
    'settings', (
      SELECT to_jsonb(settings)
      FROM public.stay_settings settings
      WHERE settings.venue_id = p_venue_id
    ),
    'offerings', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(offering) || jsonb_build_object(
          'units', COALESCE((
            SELECT jsonb_agg(to_jsonb(unit_row) ORDER BY unit_row.created_at, unit_row.id)
            FROM public.stay_units unit_row
            WHERE unit_row.offering_id = offering.id
          ), '[]'::jsonb),
          'media', COALESCE((
            SELECT jsonb_agg(to_jsonb(media) ORDER BY media.sort_order, media.id)
            FROM public.stay_offering_media media
            WHERE media.offering_id = offering.id
          ), '[]'::jsonb),
          'currentPrice', (
            SELECT to_jsonb(price)
            FROM public.stay_price_versions price
            WHERE price.offering_id = offering.id
              AND price.effective_to IS NULL
          ),
          'currentFees', COALESCE((
            SELECT jsonb_agg(to_jsonb(fee) ORDER BY fee.fee_key)
            FROM public.stay_fee_versions fee
            WHERE fee.offering_id = offering.id
              AND fee.effective_to IS NULL
          ), '[]'::jsonb),
          'currentPolicy', (
            SELECT to_jsonb(policy)
            FROM public.stay_policy_versions policy
            WHERE policy.offering_id = offering.id
              AND policy.effective_to IS NULL
          ),
          'hasOpenAvailability', CASE
            WHEN offering.kind = 'room' THEN EXISTS (
              SELECT 1
              FROM public.stay_room_nights night
              WHERE night.offering_id = offering.id
                AND NOT night.stop_sell
                AND night.sellable_quantity > 0
                AND night.local_date >= (
                  now() AT TIME ZONE COALESCE((
                    SELECT settings.timezone
                    FROM public.stay_settings settings
                    WHERE settings.venue_id = p_venue_id
                  ), 'UTC')
                )::date
            )
            ELSE EXISTS (
              SELECT 1
              FROM public.stay_place_windows place_window
              WHERE place_window.offering_id = offering.id
                AND NOT place_window.stop_sell
                AND COALESCE(
                  place_window.sellable_units,
                  place_window.sellable_capacity,
                  0
                ) > 0
                AND place_window.ends_at > now()
            )
          END
        )
        ORDER BY offering.created_at, offering.id
      )
      FROM public.stay_offerings offering
      WHERE offering.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_save_stay_settings_v2(
  p_venue_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_expected_version bigint DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_existing public.stay_settings%ROWTYPE;
  v_timezone text;
  v_check_in time;
  v_check_out time;
  v_amenities text[];
  v_accessibility text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  SELECT * INTO v_existing
  FROM public.stay_settings
  WHERE venue_id = p_venue_id
  FOR UPDATE;
  IF FOUND AND (
    p_expected_version IS NULL OR v_existing.version <> p_expected_version
  ) THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF NOT FOUND AND p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;

  v_timezone := COALESCE(
    NULLIF(pg_catalog.btrim(p_payload->>'timezone'), ''),
    'UTC'
  );
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names timezone_row
    WHERE timezone_row.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'stay_invalid_timezone' USING ERRCODE = '22023';
  END IF;
  v_check_in := COALESCE(
    NULLIF(p_payload->>'checkInTime', '')::time,
    '15:00'::time
  );
  v_check_out := COALESCE(
    NULLIF(p_payload->>'checkOutTime', '')::time,
    '11:00'::time
  );
  IF v_check_in = v_check_out THEN
    RAISE EXCEPTION 'stay_invalid_arrival_times' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'amenities', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(
       COALESCE(p_payload->'accessibilityFeatures', '[]'::jsonb)
     ) <> 'array' THEN
    RAISE EXCEPTION 'stay_invalid_settings' USING ERRCODE = '22023';
  END IF;
  v_amenities := ARRAY(
    SELECT DISTINCT pg_catalog.btrim(value)
    FROM jsonb_array_elements_text(
      COALESCE(p_payload->'amenities', '[]'::jsonb)
    )
    WHERE pg_catalog.btrim(value) <> ''
    ORDER BY pg_catalog.btrim(value)
  );
  v_accessibility := ARRAY(
    SELECT DISTINCT pg_catalog.btrim(value)
    FROM jsonb_array_elements_text(
      COALESCE(p_payload->'accessibilityFeatures', '[]'::jsonb)
    )
    WHERE pg_catalog.btrim(value) <> ''
    ORDER BY pg_catalog.btrim(value)
  );
  IF cardinality(v_amenities) > 50
     OR cardinality(v_accessibility) > 50 THEN
    RAISE EXCEPTION 'stay_invalid_settings' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stay_settings (
    venue_id,
    brand_id,
    property_kind,
    summary,
    amenities,
    accessibility_features,
    arrival_instructions,
    timezone,
    default_booking_mode,
    check_in_time,
    check_out_time,
    instant_payment_hold_minutes,
    request_response_hours,
    approved_payment_minutes,
    booking_horizon_days,
    booking_state,
    house_rules,
    created_by,
    updated_by
  ) VALUES (
    p_venue_id,
    v_venue.brand_id,
    NULLIF(lower(pg_catalog.btrim(p_payload->>'propertyKind')), ''),
    NULLIF(pg_catalog.btrim(p_payload->>'summary'), ''),
    v_amenities,
    v_accessibility,
    NULLIF(pg_catalog.btrim(p_payload->>'arrivalInstructions'), ''),
    v_timezone,
    COALESCE(
      NULLIF(lower(pg_catalog.btrim(p_payload->>'defaultBookingMode')), ''),
      'request'
    ),
    v_check_in,
    v_check_out,
    COALESCE((p_payload->>'instantPaymentHoldMinutes')::smallint, 15),
    COALESCE((p_payload->>'requestResponseHours')::smallint, 24),
    COALESCE((p_payload->>'approvedPaymentMinutes')::smallint, 30),
    COALESCE((p_payload->>'bookingHorizonDays')::smallint, 365),
    'review',
    NULLIF(pg_catalog.btrim(p_payload->>'houseRules'), ''),
    v_uid,
    v_uid
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET property_kind = EXCLUDED.property_kind,
      summary = EXCLUDED.summary,
      amenities = EXCLUDED.amenities,
      accessibility_features = EXCLUDED.accessibility_features,
      arrival_instructions = EXCLUDED.arrival_instructions,
      timezone = EXCLUDED.timezone,
      default_booking_mode = EXCLUDED.default_booking_mode,
      check_in_time = EXCLUDED.check_in_time,
      check_out_time = EXCLUDED.check_out_time,
      instant_payment_hold_minutes = EXCLUDED.instant_payment_hold_minutes,
      request_response_hours = EXCLUDED.request_response_hours,
      approved_payment_minutes = EXCLUDED.approved_payment_minutes,
      booking_horizon_days = EXCLUDED.booking_horizon_days,
      booking_state = CASE
        WHEN public.stay_settings.booking_state = 'active'
          THEN 'active'
        ELSE 'review'
      END,
      house_rules = EXCLUDED.house_rules,
      version = public.stay_settings.version + 1,
      updated_by = v_uid,
      updated_at = now();

  RETURN jsonb_build_object(
    'inventory',
    public.issue_1387_stay_inventory_snapshot(p_venue_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_publish_stay(
  p_venue_id uuid,
  p_expected_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_default_currency character(3);
  v_authoring_enabled boolean := false;
  v_ready_offering_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(flag.is_enabled, false)
  INTO v_authoring_enabled
  FROM public.feature_flags flag
  WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
  IF NOT COALESCE(v_authoring_enabled, false) THEN
    RAISE EXCEPTION 'stay_authoring_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'stay_venue_not_approved' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND OR p_expected_version IS NULL
     OR v_settings.version <> p_expected_version
     OR char_length(pg_catalog.btrim(COALESCE(v_settings.summary, ''))) < 20
     OR v_settings.check_in_time = v_settings.check_out_time THEN
    RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
  END IF;
  SELECT brand.default_currency
  INTO v_default_currency
  FROM public.brands brand
  WHERE brand.id = v_venue.brand_id
  FOR UPDATE;
  IF v_default_currency IS NULL
     OR NOT public.pg_brand_can_collect(v_venue.brand_id)
     OR EXISTS (
       SELECT 1
       FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_venue.brand_id
         AND reconciliation.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.array_agg(offering.id ORDER BY offering.id)
  INTO v_ready_offering_ids
  FROM public.stay_offerings offering
  WHERE offering.venue_id = p_venue_id
    AND offering.status IN ('draft', 'live')
    AND pg_catalog.btrim(offering.description) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.stay_price_versions price
      WHERE price.offering_id = offering.id
        AND price.effective_to IS NULL
        AND price.currency_code = v_default_currency
    )
    AND EXISTS (
      SELECT 1
      FROM public.stay_policy_versions policy
      WHERE policy.offering_id = offering.id
        AND policy.effective_to IS NULL
    )
    AND (
      SELECT count(*)
      FROM public.stay_offering_media media
      WHERE media.offering_id = offering.id
        AND media.status = 'ready'
        AND media.is_cover
    ) = 1
    AND (
      offering.unit_naming_mode <> 'named'
      OR (
        SELECT count(*)
        FROM public.stay_units unit_row
        WHERE unit_row.offering_id = offering.id
          AND unit_row.status = 'active'
      ) = offering.quantity
    )
    AND (
      (
        offering.kind = 'room'
        AND EXISTS (
          SELECT 1
          FROM public.stay_room_nights night
          WHERE night.offering_id = offering.id
            AND NOT night.stop_sell
            AND night.sellable_quantity > 0
            AND night.local_date >=
              (now() AT TIME ZONE v_settings.timezone)::date
        )
      )
      OR (
        offering.kind = 'place'
        AND EXISTS (
          SELECT 1
          FROM public.stay_place_windows place_window
          WHERE place_window.offering_id = offering.id
            AND NOT place_window.stop_sell
            AND COALESCE(
              place_window.sellable_units,
              place_window.sellable_capacity,
              0
            ) > 0
            AND place_window.ends_at > now()
        )
      )
    );
  IF cardinality(COALESCE(v_ready_offering_ids, '{}'::uuid[])) = 0 THEN
    RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('mingla.stay_publish_authorized', 'true', true);
  UPDATE public.stay_settings
  SET booking_state = 'active',
      version = version + 1,
      updated_by = v_uid,
      updated_at = now()
  WHERE venue_id = p_venue_id
    AND version = p_expected_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  UPDATE public.stay_offerings
  SET status = 'live',
      version = version + 1,
      updated_by = v_uid,
      updated_at = now()
  WHERE id = ANY(v_ready_offering_ids)
    AND status = 'draft';
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  INSERT INTO public.audit_log (
    user_id,
    brand_id,
    action,
    target_type,
    target_id,
    before,
    after
  ) VALUES (
    v_uid,
    v_venue.brand_id,
    'stay.publish',
    'stay',
    p_venue_id,
    jsonb_build_object('bookingState', v_settings.booking_state),
    jsonb_build_object(
      'bookingState',
      'active',
      'offeringIds',
      v_ready_offering_ids
    )
  );
  RETURN jsonb_build_object(
    'inventory',
    public.issue_1387_stay_inventory_snapshot(p_venue_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_save_stay_settings_v2(
  uuid, jsonb, bigint, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_save_stay_settings_v2(
  uuid, jsonb, bigint, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_save_stay_settings_v2(
  uuid, jsonb, bigint, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.biz_publish_stay(
  uuid, bigint, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_publish_stay(
  uuid, bigint, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_publish_stay(
  uuid, bigint, uuid
) TO authenticated;

-- Current venue-create RPC with one additive category arm. Stay is accepted
-- only while the server-owned authoring flag is enabled.
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL,
  p_coordinate_precision text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;
  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) <> 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;
  IF p_venue_category IS NULL OR p_venue_category NOT IN (
    'restaurant',
    'play',
    'creative_and_arts',
    'stay'
  ) THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;
  IF p_venue_category = 'stay' THEN
    SELECT COALESCE(flag.is_enabled, false)
    INTO v_stay_authoring_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
    IF NOT COALESCE(v_stay_authoring_enabled, false) THEN
      RAISE EXCEPTION 'stay_authoring_disabled';
    END IF;
  END IF;
  v_coordinate_precision := nullif(
    trim(coalesce(p_coordinate_precision, '')),
    ''
  );
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
  END IF;
  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');
  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;
    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;
  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');
  IF v_cover_type IS NOT NULL
     AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;
  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;
  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;

  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_type,
    coordinate_precision,
    claim_status
  ) VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_type,
    v_coordinate_precision,
    'pending_review'
  )
  RETURNING id INTO v_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;
    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    ) VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL
          OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL
          OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  ) VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status =
        brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);
  RETURN v_venue_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
) TO authenticated;

COMMIT;
