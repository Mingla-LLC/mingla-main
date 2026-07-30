-- Issue #1387: secure Stay inventory management contracts.
--
-- Authenticated clients never write Stay tables directly. This migration
-- exposes one versioned action RPC, an internal create helper used by single
-- and bulk creation, and a deterministic local-civil-time materializer.

BEGIN;

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
    v_venue.brand_id, v_uid, 'read'
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
      SELECT to_jsonb(s) FROM public.stay_settings s
      WHERE s.venue_id = p_venue_id
    ),
    'offerings', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(o) || jsonb_build_object(
          'units', COALESCE((
            SELECT jsonb_agg(to_jsonb(u) ORDER BY u.created_at, u.id)
            FROM public.stay_units u WHERE u.offering_id = o.id
          ), '[]'::jsonb),
          'media', COALESCE((
            SELECT jsonb_agg(to_jsonb(m) ORDER BY m.sort_order, m.id)
            FROM public.stay_offering_media m WHERE m.offering_id = o.id
          ), '[]'::jsonb),
          'currentPrice', (
            SELECT to_jsonb(p) FROM public.stay_price_versions p
            WHERE p.offering_id = o.id AND p.effective_to IS NULL
          ),
          'currentFees', COALESCE((
            SELECT jsonb_agg(to_jsonb(f) ORDER BY f.fee_key)
            FROM public.stay_fee_versions f
            WHERE f.offering_id = o.id AND f.effective_to IS NULL
          ), '[]'::jsonb),
          'currentPolicy', (
            SELECT to_jsonb(p) FROM public.stay_policy_versions p
            WHERE p.offering_id = o.id AND p.effective_to IS NULL
          )
        )
        ORDER BY o.created_at, o.id
      )
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1387_assert_authoring_currency(
  p_brand_id uuid,
  p_currency_code character(3)
)
RETURNS character(3)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_currency character(3);
BEGIN
  SELECT COALESCE(b.default_currency, b.provisional_currency_code)
  INTO v_currency
  FROM public.brands b
  WHERE b.id = p_brand_id;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'stay_currency_required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.brand_currency_reconciliations r
    WHERE r.brand_id = p_brand_id AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'currency_reconciliation_required' USING ERRCODE = 'P0001';
  END IF;
  IF upper(p_currency_code::text)::character(3) <> v_currency THEN
    RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN v_currency;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1387_attach_media_internal(
  p_offering_id uuid,
  p_brand_id uuid,
  p_venue_id uuid,
  p_payload jsonb,
  p_sort_order integer,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_object storage.objects%ROWTYPE;
  v_media_id uuid;
  v_mime_type text;
  v_byte_size bigint;
BEGIN
  SELECT * INTO v_object
  FROM storage.objects so
  WHERE so.id = (p_payload->>'storageObjectId')::uuid
    AND so.bucket_id = 'brand_covers'
    AND pg_catalog.split_part(so.name, '/', 1) = p_brand_id::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_media_object_invalid' USING ERRCODE = '22023';
  END IF;

  v_mime_type := lower(COALESCE(v_object.metadata->>'mimetype', ''));
  v_byte_size := COALESCE((v_object.metadata->>'size')::bigint, 0);
  IF v_mime_type NOT IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  ) OR v_byte_size NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'stay_media_object_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stay_offering_media (
    offering_id, brand_id, venue_id, storage_object_id,
    storage_bucket_id, storage_object_name, mime_type, byte_size,
    width, height, alt_text, checksum_sha256, sort_order, is_cover, created_by
  ) VALUES (
    p_offering_id, p_brand_id, p_venue_id, v_object.id,
    v_object.bucket_id, v_object.name, v_mime_type, v_byte_size,
    NULLIF(v_object.metadata->>'width', '')::integer,
    NULLIF(v_object.metadata->>'height', '')::integer,
    NULLIF(pg_catalog.btrim(p_payload->>'altText'), ''),
    NULLIF(lower(pg_catalog.btrim(p_payload->>'checksumSha256')), ''),
    p_sort_order,
    COALESCE((p_payload->>'isCover')::boolean, false),
    p_actor_id
  ) RETURNING id INTO v_media_id;

  RETURN v_media_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1387_create_offering_internal(
  p_brand_id uuid,
  p_venue_id uuid,
  p_payload jsonb,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offering_id uuid := gen_random_uuid();
  v_kind text := lower(pg_catalog.btrim(COALESCE(p_payload->>'kind', '')));
  v_inventory_basis text :=
    lower(pg_catalog.btrim(COALESCE(p_payload->>'inventoryBasis', '')));
  v_unit_naming_mode text := lower(pg_catalog.btrim(
    COALESCE(p_payload->>'unitNamingMode', 'interchangeable')
  ));
  v_quantity integer := NULLIF(p_payload->>'quantity', '')::integer;
  v_capacity integer := NULLIF(p_payload->>'capacity', '')::integer;
  v_currency character(3);
  v_item jsonb;
  v_index integer := 0;
BEGIN
  IF v_kind NOT IN ('room', 'place') THEN
    RAISE EXCEPTION 'stay_invalid_offering_kind' USING ERRCODE = '22023';
  END IF;
  IF v_inventory_basis = '' THEN
    v_inventory_basis := CASE v_kind
      WHEN 'room' THEN 'pooled_units'
      ELSE 'exclusive_units'
    END;
  END IF;
  IF v_inventory_basis NOT IN (
    'pooled_units', 'exclusive_units', 'shared_capacity'
  ) OR v_unit_naming_mode NOT IN ('interchangeable', 'named') THEN
    RAISE EXCEPTION 'stay_invalid_inventory_basis' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(pg_catalog.btrim(p_payload->>'name'), '') = '' THEN
    RAISE EXCEPTION 'stay_name_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stay_offerings (
    id, venue_id, brand_id, kind, name, summary, description,
    confirmation_mode, inventory_basis, unit_naming_mode, quantity, capacity,
    min_guests, max_guests, max_adults, max_children, place_pricing_basis,
    min_notice_minutes, max_advance_days, buffer_before_minutes,
    buffer_after_minutes, amenities, safety_rules,
    accessibility_features, access_scope, created_by, updated_by
  ) VALUES (
    v_offering_id,
    p_venue_id,
    p_brand_id,
    v_kind,
    pg_catalog.btrim(p_payload->>'name'),
    COALESCE(p_payload->>'summary', ''),
    COALESCE(p_payload->>'description', ''),
    NULLIF(lower(pg_catalog.btrim(p_payload->>'confirmationMode')), ''),
    v_inventory_basis,
    v_unit_naming_mode,
    v_quantity,
    v_capacity,
    COALESCE((p_payload->>'minGuests')::integer, 1),
    COALESCE((p_payload->>'maxGuests')::integer, 1),
    NULLIF(p_payload->>'maxAdults', '')::integer,
    NULLIF(p_payload->>'maxChildren', '')::integer,
    NULLIF(lower(pg_catalog.btrim(p_payload->>'placePricingBasis')), ''),
    COALESCE((p_payload->>'minNoticeMinutes')::integer, 0),
    NULLIF(p_payload->>'maxAdvanceDays', '')::integer,
    COALESCE((p_payload->>'bufferBeforeMinutes')::integer, 0),
    COALESCE((p_payload->>'bufferAfterMinutes')::integer, 0),
    ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(p_payload->'amenities', '[]'::jsonb))
    ),
    ARRAY(
      SELECT jsonb_array_elements_text(
        COALESCE(p_payload->'safetyRules', '[]'::jsonb)
      )
    ),
    ARRAY(
      SELECT jsonb_array_elements_text(
        COALESCE(p_payload->'accessibilityFeatures', '[]'::jsonb)
      )
    ),
    COALESCE(
      NULLIF(lower(pg_catalog.btrim(p_payload->>'accessScope')), ''),
      'public'
    ),
    p_actor_id,
    p_actor_id
  );

  IF v_unit_naming_mode = 'named' THEN
    IF jsonb_typeof(COALESCE(p_payload->'units', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'stay_invalid_units' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'units', '[]'::jsonb)
      )
    LOOP
      INSERT INTO public.stay_units (
        offering_id, brand_id, venue_id, name, external_reference,
        created_by, updated_by
      ) VALUES (
        v_offering_id,
        p_brand_id,
        p_venue_id,
        pg_catalog.btrim(v_item->>'name'),
        NULLIF(pg_catalog.btrim(v_item->>'externalReference'), ''),
        p_actor_id,
        p_actor_id
      );
    END LOOP;
  END IF;

  IF jsonb_typeof(COALESCE(p_payload->'media', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_payload->'media', '[]'::jsonb)) > 20 THEN
    RAISE EXCEPTION 'stay_media_limit_exceeded' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(
      COALESCE(p_payload->'media', '[]'::jsonb)
    )
  LOOP
    PERFORM public.issue_1387_attach_media_internal(
      v_offering_id,
      p_brand_id,
      p_venue_id,
      v_item || jsonb_build_object(
        'isCover',
        COALESCE((v_item->>'isCover')::boolean, v_index = 0)
      ),
      v_index,
      p_actor_id
    );
    v_index := v_index + 1;
  END LOOP;

  IF p_payload ? 'policy' THEN
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number,
      cancellation_policy, free_cancel_cutoff_minutes,
      late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, request_terms, house_rules,
      terms, created_by
    ) VALUES (
      v_offering_id,
      p_brand_id,
      p_venue_id,
      1,
      pg_catalog.btrim(p_payload->'policy'->>'cancellationPolicy'),
      COALESCE(
        (p_payload->'policy'->>'freeCancelCutoffMinutes')::integer, 0
      ),
      COALESCE(
        (p_payload->'policy'->>'lateRefundBasisPoints')::integer, 0
      ),
      COALESCE(
        (p_payload->'policy'->>'noShowRefundBasisPoints')::integer, 0
      ),
      COALESCE(
        (p_payload->'policy'->>'operatorCancelRefundBasisPoints')::integer,
        10000
      ),
      NULLIF(p_payload->'policy'->>'requestTerms', ''),
      NULLIF(p_payload->'policy'->>'houseRules', ''),
      COALESCE(p_payload->'policy'->'terms', '{}'::jsonb),
      p_actor_id
    );
  END IF;

  IF p_payload ? 'price' THEN
    v_currency := public.issue_1387_assert_authoring_currency(
      p_brand_id,
      upper(p_payload->'price'->>'currencyCode')::character(3)
    );
    INSERT INTO public.stay_price_versions (
      offering_id, brand_id, venue_id, version_number, amount_minor,
      currency_code, pricing_unit, created_by
    ) VALUES (
      v_offering_id,
      p_brand_id,
      p_venue_id,
      1,
      (p_payload->'price'->>'amountMinor')::bigint,
      v_currency,
      CASE
        WHEN v_kind = 'room' THEN 'room_night'
        WHEN p_payload->>'placePricingBasis' = 'per_booking'
          THEN 'place_booking'
        WHEN p_payload->>'placePricingBasis' = 'per_unit'
          THEN 'place_unit'
        ELSE 'place_guest'
      END,
      p_actor_id
    );
  END IF;

  v_index := 0;
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(
      COALESCE(p_payload->'fees', '[]'::jsonb)
    )
  LOOP
    IF lower(v_item->>'calculation') LIKE 'fixed_%' THEN
      v_currency := public.issue_1387_assert_authoring_currency(
        p_brand_id,
        upper(v_item->>'currencyCode')::character(3)
      );
    ELSE
      v_currency := NULL;
    END IF;
    INSERT INTO public.stay_fee_versions (
      offering_id, brand_id, venue_id, fee_key, label, version_number,
      fee_kind, calculation, amount_minor, basis_points, currency_code,
      display_mode, refund_treatment, created_by
    ) VALUES (
      v_offering_id,
      p_brand_id,
      p_venue_id,
      lower(pg_catalog.btrim(v_item->>'feeKey')),
      pg_catalog.btrim(v_item->>'label'),
      1,
      COALESCE(NULLIF(lower(v_item->>'feeKind'), ''), 'mandatory_fee'),
      lower(v_item->>'calculation'),
      NULLIF(v_item->>'amountMinor', '')::bigint,
      NULLIF(v_item->>'basisPoints', '')::integer,
      v_currency,
      COALESCE(NULLIF(lower(v_item->>'displayMode'), ''), 'separate'),
      COALESCE(NULLIF(lower(v_item->>'refundTreatment'), ''), 'same_as_line'),
      p_actor_id
    );
    v_index := v_index + 1;
  END LOOP;

  RETURN v_offering_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1387_resolve_local_timestamp(
  p_local_date date,
  p_local_time time,
  p_timezone text,
  p_fold_policy text
)
RETURNS TABLE(instant timestamptz, resolution text)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_local timestamp := p_local_date + p_local_time;
  v_primary timestamptz := v_local AT TIME ZONE p_timezone;
  v_candidates timestamptz[];
BEGIN
  SELECT array_agg(candidate ORDER BY candidate)
  INTO v_candidates
  FROM (
    SELECT DISTINCT v_primary + pg_catalog.make_interval(mins => delta) AS candidate
    FROM pg_catalog.generate_series(-120, 120, 15) delta
    WHERE (
      v_primary + pg_catalog.make_interval(mins => delta)
    ) AT TIME ZONE p_timezone = v_local
  ) candidates;

  IF COALESCE(cardinality(v_candidates), 0) = 0 THEN
    RAISE EXCEPTION 'stay_dst_gap' USING ERRCODE = '22008';
  END IF;
  IF cardinality(v_candidates) > 1 AND p_fold_policy = 'reject' THEN
    RAISE EXCEPTION 'stay_dst_fold' USING ERRCODE = '22008';
  END IF;
  IF cardinality(v_candidates) = 1 THEN
    instant := v_candidates[1];
    resolution := 'unambiguous';
  ELSIF p_fold_policy = 'earlier' THEN
    instant := v_candidates[1];
    resolution := 'earlier';
  ELSE
    instant := v_candidates[cardinality(v_candidates)];
    resolution := 'later';
  END IF;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_manage_stay_inventory(
  p_action text,
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
  v_settings public.stay_settings%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_offering_id uuid;
  v_currency character(3);
  v_item jsonb;
  v_job public.stay_bulk_jobs%ROWTYPE;
  v_success integer := 0;
  v_failed integer := 0;
  v_index integer := 0;
  v_error text;
  v_rule public.stay_place_schedule_rules%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_date date;
  v_end_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_start_resolution text;
  v_end_resolution text;
  v_local_window_start timestamp;
  v_local_window_end timestamp;
  v_local_slot_start timestamp;
  v_local_slot_end timestamp;
  v_next_version integer;
  v_current_price public.stay_price_versions%ROWTYPE;
  v_current_policy public.stay_policy_versions%ROWTYPE;
  v_current_fee public.stay_fee_versions%ROWTYPE;
  v_media_id uuid;
  v_request_hash text;
  v_requires_finance boolean;
  v_requires_inventory boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND OR v_venue.venue_category <> 'stay' THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_requires_finance := v_action IN (
    'set_price',
    'set_policy',
    'replace_fees',
    'resolve_currency_reconciliation'
  )
     OR (
       v_action = 'create_offering'
       AND (
         p_payload ? 'price'
         OR jsonb_array_length(COALESCE(p_payload->'fees', '[]'::jsonb)) > 0
       )
     )
     OR (
       v_action = 'bulk_create'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) item
         WHERE item ? 'price'
            OR jsonb_array_length(COALESCE(item->'fees', '[]'::jsonb)) > 0
       )
     )
     OR (
       v_action = 'upsert_room_nights'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'nights', '[]'::jsonb)) night
         WHERE night ? 'priceOverrideMinor'
       )
     )
     OR (
       v_action = 'upsert_place_windows'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           COALESCE(p_payload->'windows', '[]'::jsonb)
         ) window_item
         WHERE window_item ? 'priceOverrideMinor'
       )
     );
  v_requires_inventory := v_action NOT IN (
    'get',
    'set_price',
    'set_policy',
    'replace_fees',
    'resolve_currency_reconciliation'
  );

  IF v_action = 'get' THEN
    IF NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'read'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_requires_inventory AND NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'inventory'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_requires_finance AND NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'finance'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF v_action = 'resolve_currency_reconciliation' THEN
    RETURN public.issue_1387_resolve_currency_reconciliation(
      v_venue.brand_id,
      (p_payload->>'reconciliationId')::uuid,
      p_payload->>'decision',
      NULLIF(p_payload->>'fxSnapshotId', '')::uuid,
      COALESCE(p_payload->'ranges', '[]'::jsonb),
      COALESCE(p_payload->'stayItems', '[]'::jsonb),
      p_request_id
    );
  ELSIF v_action = 'get' THEN
    RETURN public.issue_1387_stay_inventory_snapshot(p_venue_id);
  ELSIF v_action = 'save_settings' THEN
    INSERT INTO public.stay_settings (
      venue_id, brand_id, property_kind, timezone, default_booking_mode,
      check_in_time, check_out_time, instant_payment_hold_minutes,
      request_response_hours, approved_payment_minutes, booking_horizon_days,
      booking_state, house_rules, created_by, updated_by
    ) VALUES (
      p_venue_id,
      v_venue.brand_id,
      NULLIF(lower(pg_catalog.btrim(p_payload->>'propertyKind')), ''),
      COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'timezone'), ''), 'UTC'),
      COALESCE(
        NULLIF(lower(pg_catalog.btrim(p_payload->>'defaultBookingMode')), ''),
        'request'
      ),
      COALESCE(NULLIF(p_payload->>'checkInTime', '')::time, '15:00'::time),
      COALESCE(NULLIF(p_payload->>'checkOutTime', '')::time, '11:00'::time),
      COALESCE((p_payload->>'instantPaymentHoldMinutes')::smallint, 15),
      COALESCE((p_payload->>'requestResponseHours')::smallint, 24),
      COALESCE((p_payload->>'approvedPaymentMinutes')::smallint, 30),
      COALESCE((p_payload->>'bookingHorizonDays')::smallint, 365),
      COALESCE(NULLIF(lower(p_payload->>'bookingState'), ''), 'draft'),
      NULLIF(p_payload->>'houseRules', ''),
      v_uid,
      v_uid
    )
    ON CONFLICT (venue_id) DO UPDATE
      SET property_kind = EXCLUDED.property_kind,
          timezone = EXCLUDED.timezone,
          default_booking_mode = EXCLUDED.default_booking_mode,
          check_in_time = EXCLUDED.check_in_time,
          check_out_time = EXCLUDED.check_out_time,
          instant_payment_hold_minutes = EXCLUDED.instant_payment_hold_minutes,
          request_response_hours = EXCLUDED.request_response_hours,
          approved_payment_minutes = EXCLUDED.approved_payment_minutes,
          booking_horizon_days = EXCLUDED.booking_horizon_days,
          booking_state = EXCLUDED.booking_state,
          house_rules = EXCLUDED.house_rules,
          version = public.stay_settings.version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE p_expected_version IS NOT NULL
        AND public.stay_settings.version = p_expected_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
  ELSIF v_action = 'create_offering' THEN
    v_offering_id := public.issue_1387_create_offering_internal(
      v_venue.brand_id, p_venue_id, p_payload, v_uid
    );
  ELSIF v_action = 'update_offering' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    UPDATE public.stay_offerings
      SET name = COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'name'), ''), name),
          summary = COALESCE(p_payload->>'summary', summary),
          description = COALESCE(p_payload->>'description', description),
          confirmation_mode = CASE WHEN p_payload ? 'confirmationMode'
            THEN NULLIF(
              lower(pg_catalog.btrim(p_payload->>'confirmationMode')), ''
            )
            ELSE confirmation_mode END,
          inventory_basis = COALESCE(
            NULLIF(lower(p_payload->>'inventoryBasis'), ''),
            inventory_basis
          ),
          unit_naming_mode = COALESCE(
            NULLIF(lower(p_payload->>'unitNamingMode'), ''),
            unit_naming_mode
          ),
          quantity = CASE WHEN p_payload ? 'quantity'
            THEN NULLIF(p_payload->>'quantity', '')::integer ELSE quantity END,
          capacity = CASE WHEN p_payload ? 'capacity'
            THEN NULLIF(p_payload->>'capacity', '')::integer ELSE capacity END,
          min_guests = COALESCE(
            (p_payload->>'minGuests')::integer, min_guests
          ),
          max_guests = COALESCE((p_payload->>'maxGuests')::integer, max_guests),
          max_adults = CASE WHEN p_payload ? 'maxAdults'
            THEN NULLIF(p_payload->>'maxAdults', '')::integer ELSE max_adults END,
          max_children = CASE WHEN p_payload ? 'maxChildren'
            THEN NULLIF(p_payload->>'maxChildren', '')::integer
            ELSE max_children END,
          place_pricing_basis = CASE WHEN p_payload ? 'placePricingBasis'
            THEN NULLIF(lower(p_payload->>'placePricingBasis'), '')
            ELSE place_pricing_basis END,
          min_notice_minutes = COALESCE(
            (p_payload->>'minNoticeMinutes')::integer, min_notice_minutes
          ),
          max_advance_days = CASE WHEN p_payload ? 'maxAdvanceDays'
            THEN NULLIF(p_payload->>'maxAdvanceDays', '')::integer
            ELSE max_advance_days END,
          buffer_before_minutes = COALESCE(
            (p_payload->>'bufferBeforeMinutes')::integer,
            buffer_before_minutes
          ),
          buffer_after_minutes = COALESCE(
            (p_payload->>'bufferAfterMinutes')::integer,
            buffer_after_minutes
          ),
          amenities = CASE WHEN p_payload ? 'amenities' THEN ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'amenities')
          ) ELSE amenities END,
          safety_rules = CASE WHEN p_payload ? 'safetyRules' THEN ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'safetyRules')
          ) ELSE safety_rules END,
          accessibility_features = CASE
            WHEN p_payload ? 'accessibilityFeatures' THEN ARRAY(
              SELECT jsonb_array_elements_text(p_payload->'accessibilityFeatures')
            ) ELSE accessibility_features END,
          access_scope = COALESCE(
            NULLIF(lower(pg_catalog.btrim(p_payload->>'accessScope')), ''),
            access_scope
          ),
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE id = v_offering_id
        AND venue_id = p_venue_id
        AND version = p_expected_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
  ELSIF v_action = 'replace_units' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_offering_id
      AND venue_id = p_venue_id
      AND inventory_basis = 'exclusive_units'
      AND unit_naming_mode = 'named'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_named_unit_not_allowed' USING ERRCODE = '22023';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF jsonb_typeof(COALESCE(p_payload->'units', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(p_payload->'units', '[]'::jsonb))
          > v_offering.quantity THEN
      RAISE EXCEPTION 'stay_unit_quantity_exceeded' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_units
      SET status = 'archived', updated_by = v_uid, updated_at = now(),
          version = version + 1
      WHERE offering_id = v_offering_id AND status <> 'archived';
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_payload->'units', '[]'::jsonb))
    LOOP
      INSERT INTO public.stay_units (
        offering_id, brand_id, venue_id, name, external_reference,
        created_by, updated_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        pg_catalog.btrim(v_item->>'name'),
        NULLIF(pg_catalog.btrim(v_item->>'externalReference'), ''),
        v_uid, v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'change_status' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND OR v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF lower(p_payload->>'status') = 'live' THEN
      SELECT * INTO v_settings
      FROM public.stay_settings s
      WHERE s.venue_id = p_venue_id AND s.booking_state = 'active';
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.stay_price_versions p
        WHERE p.offering_id = v_offering_id AND p.effective_to IS NULL
      ) OR NOT EXISTS (
        SELECT 1 FROM public.stay_policy_versions p
        WHERE p.offering_id = v_offering_id AND p.effective_to IS NULL
      ) OR (
        SELECT count(*) FROM public.stay_offering_media m
        WHERE m.offering_id = v_offering_id
          AND m.status = 'ready' AND m.is_cover
      ) <> 1 THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF pg_catalog.btrim(v_offering.description) = ''
         OR v_venue.claim_status <> 'verified' THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.kind = 'room' AND NOT EXISTS (
        SELECT 1 FROM public.stay_room_nights n
        WHERE n.offering_id = v_offering_id
          AND NOT n.stop_sell
          AND n.sellable_quantity > 0
          AND n.local_date >=
            (now() AT TIME ZONE v_settings.timezone)::date
      ) THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.kind = 'place' AND NOT EXISTS (
        SELECT 1 FROM public.stay_place_windows w
        WHERE w.offering_id = v_offering_id
          AND NOT w.stop_sell
          AND COALESCE(w.sellable_units, w.sellable_capacity, 0) > 0
          AND w.ends_at > now()
      ) THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.unit_naming_mode = 'named' AND (
        SELECT count(*) FROM public.stay_units u
        WHERE u.offering_id = v_offering_id AND u.status = 'active'
      ) <> v_offering.quantity THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF NOT public.pg_brand_can_collect(v_venue.brand_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.brands b
           WHERE b.id = v_venue.brand_id AND b.default_currency IS NOT NULL
         ) THEN
        RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.stay_offerings
      SET status = lower(p_payload->>'status'),
          archived_at = CASE WHEN lower(p_payload->>'status') = 'archived'
            THEN now() ELSE NULL END,
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'set_policy' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO v_current_policy
    FROM public.stay_policy_versions
    WHERE offering_id = v_offering_id AND effective_to IS NULL
    FOR UPDATE;
    v_next_version := COALESCE(v_current_policy.version_number, 0) + 1;
    IF v_current_policy.id IS NOT NULL THEN
      UPDATE public.stay_policy_versions SET effective_to = now()
      WHERE id = v_current_policy.id;
    END IF;
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number,
      cancellation_policy, free_cancel_cutoff_minutes,
      late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, request_terms, house_rules,
      terms, created_by
    ) VALUES (
      v_offering_id, v_venue.brand_id, p_venue_id, v_next_version,
      pg_catalog.btrim(p_payload->>'cancellationPolicy'),
      COALESCE((p_payload->>'freeCancelCutoffMinutes')::integer, 0),
      COALESCE((p_payload->>'lateRefundBasisPoints')::integer, 0),
      COALESCE((p_payload->>'noShowRefundBasisPoints')::integer, 0),
      COALESCE(
        (p_payload->>'operatorCancelRefundBasisPoints')::integer, 10000
      ),
      NULLIF(p_payload->>'requestTerms', ''),
      NULLIF(p_payload->>'houseRules', ''),
      COALESCE(p_payload->'terms', '{}'::jsonb), v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'set_price' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    v_currency := public.issue_1387_assert_authoring_currency(
      v_venue.brand_id,
      upper(p_payload->>'currencyCode')::character(3)
    );
    SELECT * INTO v_current_price
    FROM public.stay_price_versions
    WHERE offering_id = v_offering_id AND effective_to IS NULL
    FOR UPDATE;
    v_next_version := COALESCE(v_current_price.version_number, 0) + 1;
    IF v_current_price.id IS NOT NULL THEN
      UPDATE public.stay_price_versions SET effective_to = now()
      WHERE id = v_current_price.id;
    END IF;
    INSERT INTO public.stay_price_versions (
      offering_id, brand_id, venue_id, version_number, amount_minor,
      currency_code, pricing_unit, supersedes_version_id, created_by
    ) VALUES (
      v_offering_id, v_venue.brand_id, p_venue_id, v_next_version,
      (p_payload->>'amountMinor')::bigint, v_currency,
      CASE
        WHEN v_offering.kind = 'room' THEN 'room_night'
        WHEN v_offering.place_pricing_basis = 'per_booking'
          THEN 'place_booking'
        WHEN v_offering.place_pricing_basis = 'per_unit'
          THEN 'place_unit'
        ELSE 'place_guest'
      END,
      v_current_price.id, v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'replace_fees' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    FOR v_current_fee IN
      SELECT * FROM public.stay_fee_versions
      WHERE offering_id = v_offering_id AND effective_to IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.stay_fee_versions SET effective_to = now()
      WHERE id = v_current_fee.id;
    END LOOP;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'fees', '[]'::jsonb)
      )
    LOOP
      SELECT COALESCE(max(f.version_number), 0) + 1
      INTO v_next_version
      FROM public.stay_fee_versions f
      WHERE f.offering_id = v_offering_id
        AND f.fee_key = lower(pg_catalog.btrim(v_item->>'feeKey'));
      IF lower(v_item->>'calculation') LIKE 'fixed_%' THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      INSERT INTO public.stay_fee_versions (
        offering_id, brand_id, venue_id, fee_key, label, version_number,
        fee_kind, calculation, amount_minor, basis_points, currency_code,
        display_mode, refund_treatment, created_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        lower(pg_catalog.btrim(v_item->>'feeKey')),
        pg_catalog.btrim(v_item->>'label'), v_next_version,
        COALESCE(NULLIF(lower(v_item->>'feeKind'), ''), 'mandatory_fee'),
        lower(v_item->>'calculation'),
        NULLIF(v_item->>'amountMinor', '')::bigint,
        NULLIF(v_item->>'basisPoints', '')::integer,
        v_currency,
        COALESCE(NULLIF(lower(v_item->>'displayMode'), ''), 'separate'),
        COALESCE(
          NULLIF(lower(v_item->>'refundTreatment'), ''), 'same_as_line'
        ),
        v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'attach_media' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF COALESCE((p_payload->>'isCover')::boolean, false) THEN
      UPDATE public.stay_offering_media SET is_cover = false, updated_at = now()
      WHERE offering_id = v_offering_id AND is_cover;
    END IF;
    v_media_id := public.issue_1387_attach_media_internal(
      v_offering_id,
      v_venue.brand_id,
      p_venue_id,
      p_payload,
      COALESCE(
        (p_payload->>'sortOrder')::integer,
        (SELECT COALESCE(max(m.sort_order), -1) + 1
         FROM public.stay_offering_media m
         WHERE m.offering_id = v_offering_id)
      ),
      v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'reorder_media' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'mediaIds', '[]'::jsonb)) <> (
      SELECT count(*) FROM public.stay_offering_media m
      WHERE m.offering_id = v_offering_id
    ) OR (
      SELECT count(DISTINCT (value #>> '{}')::uuid)
      FROM jsonb_array_elements(COALESCE(p_payload->'mediaIds', '[]'::jsonb))
    ) <> jsonb_array_length(COALESCE(p_payload->'mediaIds', '[]'::jsonb)) THEN
      RAISE EXCEPTION 'stay_media_set_changed' USING ERRCODE = '40001';
    END IF;
    SET CONSTRAINTS public.stay_offering_media_sort_unique DEFERRED;
    v_index := 0;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_payload->'mediaIds')
    LOOP
      UPDATE public.stay_offering_media
        SET sort_order = v_index, updated_at = now()
        WHERE id = (v_item #>> '{}')::uuid
          AND offering_id = v_offering_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_media_set_changed' USING ERRCODE = '40001';
      END IF;
      v_index := v_index + 1;
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'remove_media' THEN
    v_media_id := (p_payload->>'mediaId')::uuid;
    SELECT o.* INTO v_offering
    FROM public.stay_offerings o
    JOIN public.stay_offering_media m ON m.offering_id = o.id
    WHERE m.id = v_media_id AND o.venue_id = p_venue_id
    FOR UPDATE OF o;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_media_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.stay_offering_media m
      JOIN public.stay_offerings o ON o.id = m.offering_id
      WHERE m.id = v_media_id AND o.venue_id = p_venue_id
        AND o.status = 'live' AND m.is_cover
    ) THEN
      RAISE EXCEPTION 'stay_live_cover_required' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.stay_offering_media m
    USING public.stay_offerings o
    WHERE m.id = v_media_id
      AND o.id = m.offering_id
      AND o.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_media_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering.id;
  ELSIF v_action = 'bulk_create' THEN
    IF jsonb_typeof(p_payload->'items') <> 'array'
       OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'stay_invalid_bulk_request' USING ERRCODE = '22023';
    END IF;
    v_request_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to((p_payload->'items')::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    INSERT INTO public.stay_bulk_jobs (
      venue_id, brand_id, idempotency_key, requested_count,
      request_payload, request_hash, request_id, created_by
    ) VALUES (
      p_venue_id, v_venue.brand_id,
      pg_catalog.btrim(p_payload->>'idempotencyKey'),
      jsonb_array_length(p_payload->'items'),
      p_payload->'items', v_request_hash, p_request_id, v_uid
    )
    ON CONFLICT (venue_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_job;
    IF v_job.id IS NULL THEN
      SELECT * INTO v_job FROM public.stay_bulk_jobs
      WHERE venue_id = p_venue_id
        AND idempotency_key = pg_catalog.btrim(p_payload->>'idempotencyKey');
      IF v_job.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '40001';
      END IF;
      RETURN jsonb_build_object(
        'job', to_jsonb(v_job),
        'items', COALESCE((
          SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_index)
          FROM public.stay_bulk_job_items i WHERE i.job_id = v_job.id
        ), '[]'::jsonb),
        'replayed', true
      );
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_payload->'items')
    LOOP
      BEGIN
        v_offering_id := public.issue_1387_create_offering_internal(
          v_venue.brand_id, p_venue_id, v_item, v_uid
        );
        INSERT INTO public.stay_bulk_job_items (
          job_id, item_index, status, offering_id, result
        ) VALUES (
          v_job.id, v_index, 'succeeded', v_offering_id,
          jsonb_build_object('offeringId', v_offering_id)
        );
        v_success := v_success + 1;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        INSERT INTO public.stay_bulk_job_items (
          job_id, item_index, status, error_code, safe_error_message
        ) VALUES (
          v_job.id, v_index, 'failed',
          CASE WHEN v_error LIKE 'stay_%' THEN split_part(v_error, ' ', 1)
            ELSE 'stay_item_invalid' END,
          CASE WHEN v_error LIKE 'stay_%'
            THEN 'This item needs review.'
            ELSE 'This item could not be created.' END
        );
        v_failed := v_failed + 1;
      END;
      v_index := v_index + 1;
    END LOOP;
    UPDATE public.stay_bulk_jobs
      SET status = CASE WHEN v_failed = 0 THEN 'completed'
        WHEN v_success = 0 THEN 'failed' ELSE 'completed_with_errors' END,
          succeeded_count = v_success,
          failed_count = v_failed,
          completed_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
    RETURN jsonb_build_object(
      'job', to_jsonb(v_job),
      'items', (
        SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_index)
        FROM public.stay_bulk_job_items i WHERE i.job_id = v_job.id
      ),
      'replayed', false
    );
  ELSIF v_action = 'upsert_room_nights' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id AND kind = 'room';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_room_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'nights', '[]'::jsonb)) > 366 THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'nights', '[]'::jsonb)
      )
    LOOP
      IF (v_item->>'localDate')::date
           < (now() AT TIME ZONE v_settings.timezone)::date
         OR (v_item->>'localDate')::date
           > (now() AT TIME ZONE v_settings.timezone)::date
             + LEAST(
               v_settings.booking_horizon_days,
               COALESCE(
                 v_offering.max_advance_days,
                 v_settings.booking_horizon_days
               )
             ) THEN
        RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
      END IF;
      IF v_item ? 'priceOverrideMinor'
         AND NULLIF(v_item->>'priceOverrideMinor', '') IS NOT NULL THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      INSERT INTO public.stay_room_nights (
        offering_id, local_date, brand_id, venue_id, sellable_quantity,
        price_override_minor, currency_code, stop_sell, minimum_nights,
        maximum_nights, updated_by
      ) VALUES (
        v_offering_id, (v_item->>'localDate')::date,
        v_venue.brand_id, p_venue_id,
        COALESCE((v_item->>'sellableQuantity')::integer, v_offering.quantity),
        NULLIF(v_item->>'priceOverrideMinor', '')::bigint,
        v_currency,
        COALESCE((v_item->>'stopSell')::boolean, false),
        COALESCE((v_item->>'minimumNights')::integer, 1),
        NULLIF(v_item->>'maximumNights', '')::integer,
        v_uid
      )
      ON CONFLICT (offering_id, local_date) DO UPDATE
        SET sellable_quantity = EXCLUDED.sellable_quantity,
            price_override_minor = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN EXCLUDED.price_override_minor
              ELSE public.stay_room_nights.price_override_minor
            END,
            currency_code = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN EXCLUDED.currency_code
              ELSE public.stay_room_nights.currency_code
            END,
            stop_sell = EXCLUDED.stop_sell,
            minimum_nights = EXCLUDED.minimum_nights,
            maximum_nights = EXCLUDED.maximum_nights,
            version = public.stay_room_nights.version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE v_item ? 'expectedVersion'
          AND public.stay_room_nights.version =
            (v_item->>'expectedVersion')::bigint;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  ELSIF v_action = 'upsert_place_schedule' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id AND kind = 'place';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_place_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    IF (p_payload->>'localStartDate')::date
         < (now() AT TIME ZONE v_settings.timezone)::date
       OR COALESCE(
         NULLIF(p_payload->>'localEndDate', '')::date,
         (p_payload->>'localStartDate')::date
       ) > (now() AT TIME ZONE v_settings.timezone)::date
           + LEAST(
             v_settings.booking_horizon_days,
             COALESCE(
               v_offering.max_advance_days,
               v_settings.booking_horizon_days
             )
           ) THEN
      RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'scheduleRuleId' THEN
      DELETE FROM public.stay_place_windows w
      WHERE w.schedule_rule_id = (p_payload->>'scheduleRuleId')::uuid
        AND w.offering_id = v_offering_id;
      UPDATE public.stay_place_schedule_rules
        SET mode = lower(p_payload->>'mode'),
            timezone = p_payload->>'timezone',
            local_start_date = (p_payload->>'localStartDate')::date,
            local_end_date = NULLIF(p_payload->>'localEndDate', '')::date,
            weekdays = ARRAY(
              SELECT value::text::smallint
              FROM jsonb_array_elements(
                COALESCE(p_payload->'weekdays', '[]'::jsonb)
              )
            ),
            local_start_time = NULLIF(p_payload->>'localStartTime', '')::time,
            local_end_time = NULLIF(p_payload->>'localEndTime', '')::time,
            slot_duration_minutes =
              NULLIF(p_payload->>'slotDurationMinutes', '')::integer,
            slot_interval_minutes =
              NULLIF(p_payload->>'slotIntervalMinutes', '')::integer,
            full_day_start_time =
              NULLIF(p_payload->>'fullDayStartTime', '')::time,
            full_day_end_time =
              NULLIF(p_payload->>'fullDayEndTime', '')::time,
            dst_fold_policy = COALESCE(
              NULLIF(lower(p_payload->>'dstFoldPolicy'), ''),
              dst_fold_policy
            ),
            active = COALESCE((p_payload->>'active')::boolean, active),
            version = version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE id = (p_payload->>'scheduleRuleId')::uuid
          AND offering_id = v_offering_id
          AND version = p_expected_version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
      END IF;
    ELSE
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone,
        local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, slot_duration_minutes,
        slot_interval_minutes, full_day_start_time, full_day_end_time,
        dst_fold_policy, created_by, updated_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        lower(p_payload->>'mode'),
        p_payload->>'timezone',
        (p_payload->>'localStartDate')::date,
        NULLIF(p_payload->>'localEndDate', '')::date,
        ARRAY(
          SELECT value::text::smallint
          FROM jsonb_array_elements(
            COALESCE(p_payload->'weekdays', '[]'::jsonb)
          )
        ),
        NULLIF(p_payload->>'localStartTime', '')::time,
        NULLIF(p_payload->>'localEndTime', '')::time,
        NULLIF(p_payload->>'slotDurationMinutes', '')::integer,
        NULLIF(p_payload->>'slotIntervalMinutes', '')::integer,
        NULLIF(p_payload->>'fullDayStartTime', '')::time,
        NULLIF(p_payload->>'fullDayEndTime', '')::time,
        COALESCE(NULLIF(lower(p_payload->>'dstFoldPolicy'), ''), 'reject'),
        v_uid, v_uid
      );
    END IF;
  ELSIF v_action = 'materialize_place_windows' THEN
    SELECT * INTO v_rule
    FROM public.stay_place_schedule_rules
    WHERE id = (p_payload->>'scheduleRuleId')::uuid
      AND venue_id = p_venue_id
      AND active
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_schedule_rule_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_offering
    FROM public.stay_offerings o
    WHERE o.id = v_rule.offering_id AND o.venue_id = p_venue_id
    FOR UPDATE;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    v_date := GREATEST(
      v_rule.local_start_date,
      (p_payload->>'fromDate')::date
    );
    v_end_date := LEAST(
      COALESCE(v_rule.local_end_date, (p_payload->>'toDate')::date),
      (p_payload->>'toDate')::date
    );
    IF v_end_date < v_date
       OR v_end_date - v_date > LEAST(
         v_settings.booking_horizon_days,
         COALESCE(
           v_offering.max_advance_days,
           v_settings.booking_horizon_days
         )
       )
       OR v_end_date > (now() AT TIME ZONE v_settings.timezone)::date
         + LEAST(
           v_settings.booking_horizon_days,
           COALESCE(
             v_offering.max_advance_days,
             v_settings.booking_horizon_days
           )
         ) THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.stay_place_windows w
    WHERE w.schedule_rule_id = v_rule.id
      AND w.local_date BETWEEN v_date AND v_end_date;
    WHILE v_date <= v_end_date LOOP
      IF (
        v_rule.mode = 'fixed_slots' AND v_date = v_rule.local_start_date
      ) OR (
        v_rule.mode <> 'fixed_slots'
        AND extract(dow FROM v_date)::smallint = ANY(v_rule.weekdays)
      ) THEN
        IF v_rule.mode = 'full_day' THEN
          v_local_window_start := v_date + v_rule.full_day_start_time;
          v_local_window_end := v_date + v_rule.full_day_end_time;
          IF v_local_window_end <= v_local_window_start THEN
            v_local_window_end := v_local_window_end + interval '1 day';
          END IF;
        ELSE
          v_local_window_start := v_date + v_rule.local_start_time;
          v_local_window_end := v_date + v_rule.local_end_time;
          IF v_local_window_end <= v_local_window_start THEN
            v_local_window_end := v_local_window_end + interval '1 day';
          END IF;
        END IF;
        v_local_slot_start := v_local_window_start;
        v_local_slot_end := CASE
          WHEN v_rule.mode = 'repeating_windows' THEN
            v_local_slot_start
              + pg_catalog.make_interval(mins => v_rule.slot_duration_minutes)
          ELSE v_local_window_end
        END;
        WHILE v_local_slot_end <= v_local_window_end LOOP
        SELECT r.instant, r.resolution
          INTO v_start, v_start_resolution
        FROM public.issue_1387_resolve_local_timestamp(
          v_local_slot_start::date, v_local_slot_start::time,
          v_rule.timezone,
          v_rule.dst_fold_policy
        ) r;
        SELECT r.instant, r.resolution
          INTO v_end, v_end_resolution
        FROM public.issue_1387_resolve_local_timestamp(
          v_local_slot_end::date, v_local_slot_end::time,
          v_rule.timezone, v_rule.dst_fold_policy
        ) r;
        INSERT INTO public.stay_place_windows (
          offering_id, schedule_rule_id, brand_id, venue_id, local_date,
          starts_at, ends_at, sellable_units, sellable_capacity,
          dst_resolution, updated_by
        ) VALUES (
          v_rule.offering_id, v_rule.id, v_rule.brand_id, v_rule.venue_id,
          v_date, v_start, v_end,
          CASE WHEN v_offering.inventory_basis = 'exclusive_units'
            THEN v_offering.quantity ELSE NULL END,
          CASE WHEN v_offering.inventory_basis = 'shared_capacity'
            THEN v_offering.capacity ELSE NULL END,
          CASE WHEN v_start_resolution = 'unambiguous'
                    AND v_end_resolution = 'unambiguous'
            THEN 'unambiguous' ELSE v_rule.dst_fold_policy END,
          v_uid
        )
        ON CONFLICT (offering_id, starts_at, ends_at) DO UPDATE
          SET schedule_rule_id = EXCLUDED.schedule_rule_id,
              sellable_units = EXCLUDED.sellable_units,
              sellable_capacity = EXCLUDED.sellable_capacity,
              dst_resolution = EXCLUDED.dst_resolution,
              version = public.stay_place_windows.version + 1,
              updated_by = v_uid,
              updated_at = now();
          EXIT WHEN v_rule.mode <> 'repeating_windows';
          v_local_slot_start := v_local_slot_start
            + pg_catalog.make_interval(mins => v_rule.slot_interval_minutes);
          v_local_slot_end := v_local_slot_start
            + pg_catalog.make_interval(mins => v_rule.slot_duration_minutes);
        END LOOP;
      END IF;
      v_date := v_date + 1;
    END LOOP;
  ELSIF v_action = 'upsert_place_windows' THEN
    IF jsonb_array_length(
      COALESCE(p_payload->'windows', '[]'::jsonb)
    ) > 500 THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_payload->'windows', '[]'::jsonb))
    LOOP
      SELECT w.* INTO v_window
      FROM public.stay_place_windows w
      JOIN public.stay_offerings o ON o.id = w.offering_id
      WHERE w.id = (v_item->>'windowId')::uuid
        AND w.venue_id = p_venue_id
        AND o.kind = 'place'
      FOR UPDATE OF w;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_place_window_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF v_window.version <> (v_item->>'expectedVersion')::bigint THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
      END IF;
      SELECT * INTO v_offering
      FROM public.stay_offerings o
      WHERE o.id = v_window.offering_id;
      IF v_item ? 'priceOverrideMinor'
         AND NULLIF(v_item->>'priceOverrideMinor', '') IS NOT NULL THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      UPDATE public.stay_place_windows
        SET sellable_units = CASE
              WHEN v_offering.inventory_basis = 'exclusive_units'
              THEN COALESCE(
                (v_item->>'sellableUnits')::integer,
                sellable_units
              )
              ELSE NULL
            END,
            sellable_capacity = CASE
              WHEN v_offering.inventory_basis = 'shared_capacity'
              THEN COALESCE(
                (v_item->>'sellableCapacity')::integer,
                sellable_capacity
              )
              ELSE NULL
            END,
            stop_sell = COALESCE(
              (v_item->>'stopSell')::boolean, stop_sell
            ),
            price_override_minor = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN NULLIF(v_item->>'priceOverrideMinor', '')::bigint
              ELSE price_override_minor
            END,
            currency_code = CASE
              WHEN v_item ? 'priceOverrideMinor' THEN v_currency
              ELSE currency_code
            END,
            version = version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE id = v_window.id;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'stay_invalid_action' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'inventory', public.issue_1387_stay_inventory_snapshot(p_venue_id),
    'offeringId', v_offering_id,
    'requestId', p_request_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1387_stay_inventory_snapshot(uuid)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1387_assert_authoring_currency(uuid, character)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1387_create_offering_internal(
  uuid, uuid, jsonb, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1387_attach_media_internal(
  uuid, uuid, uuid, jsonb, integer, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1387_resolve_local_timestamp(
  date, time, text, text
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_manage_stay_inventory(
  text, uuid, jsonb, bigint, uuid
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.issue_1387_stay_inventory_snapshot(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_manage_stay_inventory(
  text, uuid, jsonb, bigint, uuid
) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
