-- Issue #1388: authoritative Stay quote, atomic hold, and Request lifecycle RPCs.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1388_actor_key()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    ELSE encode(
      extensions.digest(
        pg_catalog.convert_to('user:' || auth.uid()::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_quote_projection(p_quote_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'quoteId', q.id,
    'venueId', q.venue_id,
    'brandId', q.brand_id,
    'currencyCode', q.currency_code,
    'mode', q.mode,
    'status', q.status,
    'expiresAt', q.expires_at,
    'version', q.version,
    'sourceSubtotalMinor', q.source_subtotal_minor::text,
    'feeTotalMinor', q.fee_total_minor::text,
    'taxTotalMinor', q.tax_total_minor::text,
    'totalMinor', q.total_minor::text,
    'lines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'lineId', l.id,
          'offeringId', l.offering_id,
          'kind', l.kind,
          'confirmationMode', l.confirmation_mode,
          'roomCheckIn', l.room_check_in,
          'roomCheckOut', l.room_check_out,
          'roomQuantity', l.room_quantity,
          'placeWindowId', l.place_window_id,
          'placeUnits', l.place_units,
          'placeGuests', l.place_guests,
          'adults', l.adults,
          'children', l.children,
          'baseMinor', l.base_minor::text,
          'feeMinor', l.fee_minor::text,
          'taxMinor', l.tax_minor::text,
          'totalMinor', l.total_minor::text,
          'offering', l.offering_snapshot,
          'price', l.price_snapshot,
          'policy', l.policy_snapshot,
          'fees', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'name', f.name,
              'kind', f.fee_kind,
              'amountMinor', f.amount_minor::text,
              'includedInBase', f.included_in_base,
              'refundTreatment', f.refund_treatment
            ) ORDER BY f.name, f.id)
            FROM public.stay_quote_fee_lines f
            WHERE f.quote_line_id = l.id
          ), '[]'::jsonb),
          'allocations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'ordinal', a.allocation_ordinal,
              'adults', a.adults,
              'children', a.children,
              'namedUnitPreference', a.named_unit_preference
            ) ORDER BY a.allocation_ordinal)
            FROM public.stay_quote_allocations a
            WHERE a.quote_line_id = l.id
          ), '[]'::jsonb)
        )
        ORDER BY l.kind, l.offering_id, l.place_window_id NULLS FIRST
      )
      FROM public.stay_quote_lines l
      WHERE l.quote_id = q.id
    ), '[]'::jsonb)
  )
  FROM public.stay_quotes q
  WHERE q.id = p_quote_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_group_projection(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_actor_key text := public.issue_1388_actor_key();
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_group.actor_key_hash <> v_actor_key
     AND NOT public.issue_1387_has_brand_capability(
       v_group.brand_id, v_uid, 'read'
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'groupId', v_group.id,
    'publicReference', v_group.public_reference,
    'quoteId', v_group.quote_id,
    'venueId', v_group.venue_id,
    'brandId', v_group.brand_id,
    'currencyCode', v_group.currency_code,
    'mode', v_group.mode,
    'state', v_group.state,
    'requestDeadline', v_group.request_deadline,
    'paymentDeadline', v_group.payment_deadline,
    'guest', v_group.guest_snapshot,
    'sourceSubtotalMinor', v_group.source_subtotal_minor::text,
    'feeTotalMinor', v_group.fee_total_minor::text,
    'taxTotalMinor', v_group.tax_total_minor::text,
    'totalMinor', v_group.total_minor::text,
    'version', v_group.version,
    'createdAt', v_group.created_at,
    'updatedAt', v_group.updated_at,
    'hold', (
      SELECT jsonb_build_object(
        'state', h.state,
        'expiresAt', h.expires_at,
        'version', h.version
      )
      FROM public.stay_inventory_holds h
      WHERE h.group_id = v_group.id
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id,
        'offeringId', l.offering_id,
        'kind', l.kind,
        'state', l.state,
        'roomCheckIn', l.room_check_in,
        'roomCheckOut', l.room_check_out,
        'roomQuantity', l.room_quantity,
        'placeWindowId', l.place_window_id,
        'placeUnits', l.place_units,
        'placeGuests', l.place_guests,
        'adults', l.adults,
        'children', l.children,
        'baseMinor', l.base_minor::text,
        'feeMinor', l.fee_minor::text,
        'taxMinor', l.tax_minor::text,
        'totalMinor', l.total_minor::text,
        'dependencyRoomLineId', l.dependency_room_line_id,
        'offering', l.offering_snapshot,
        'price', l.price_snapshot,
        'policy', l.policy_snapshot
      ) ORDER BY l.kind, l.offering_id, l.place_window_id NULLS FIRST)
      FROM public.stay_reservation_lines l
      WHERE l.group_id = v_group.id
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'actorType', e.actor_type,
        'metadata', e.safe_metadata,
        'createdAt', e.created_at
      ) ORDER BY e.created_at, e.id)
      FROM public.stay_reservation_events e
      WHERE e.group_id = v_group.id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_quote_stay_cart(
  p_venue_id uuid,
  p_lines jsonb,
  p_idempotency_key text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_key text := public.issue_1388_actor_key();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_quote public.stay_quotes%ROWTYPE;
  v_quote_id uuid := gen_random_uuid();
  v_quote_line_id uuid;
  v_offering public.stay_offerings%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_night public.stay_room_nights%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_window_id uuid;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_item jsonb;
  v_allocation jsonb;
  v_normalized_lines jsonb;
  v_request_hash text;
  v_currency character(3);
  v_kind text;
  v_check_in date;
  v_check_out date;
  v_common_check_in date;
  v_common_check_out date;
  v_date date;
  v_quantity integer;
  v_units integer;
  v_guests integer;
  v_adults integer;
  v_children integer;
  v_nights integer;
  v_base bigint;
  v_available bigint;
  v_held bigint;
  v_committed bigint;
  v_named_preferences uuid[];
  v_named_preference uuid;
  v_inventory_snapshot jsonb;
  v_mode text := 'instant';
  v_total_base bigint;
  v_total bigint;
BEGIN
  IF v_uid IS NULL OR v_actor_key IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_venue_id IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF COALESCE(v_item->>'offeringId', '') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR lower(COALESCE(v_item->>'kind', '')) NOT IN ('room', 'place')
       OR (
         lower(v_item->>'kind') = 'place'
         AND COALESCE(v_item->>'placeWindowId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       ) THEN
      RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) item
    GROUP BY
      lower(item->>'kind'),
      (item->>'offeringId')::uuid,
      CASE WHEN lower(item->>'kind') = 'place'
        THEN (item->>'placeWindowId')::uuid ELSE NULL END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'stay_duplicate_cart_line' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(value ORDER BY
    (value->>'offeringId')::uuid,
    CASE WHEN lower(value->>'kind') = 'place'
      THEN (value->>'placeWindowId')::uuid ELSE NULL END
  ) INTO v_normalized_lines
  FROM jsonb_array_elements(p_lines);
  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'venueId', p_venue_id,
          'lines', v_normalized_lines
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_key || ':quote:' || pg_catalog.btrim(p_idempotency_key),
      1388
    )
  );
  SELECT * INTO v_quote
  FROM public.stay_quotes
  WHERE actor_key_hash = v_actor_key
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_quote.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_quote_projection(v_quote.id);
  END IF;

  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = p_venue_id AND booking_state = 'active';
  IF NOT FOUND OR v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'stay_reservations_unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT upper(b.default_currency)::character(3) INTO v_currency
  FROM public.brands b
  WHERE b.id = v_venue.brand_id
    AND b.default_currency IS NOT NULL;
  IF v_currency IS NULL OR NOT public.pg_brand_can_collect(v_venue.brand_id) THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, status, source_subtotal_minor, fee_total_minor, tax_total_minor,
    total_minor, request_hash, price_revision_set_hash,
    inventory_revision_set_hash, policy_snapshot_hash, idempotency_key,
    expires_at, request_id
  ) VALUES (
    v_quote_id, v_uid, v_actor_key, p_venue_id, v_venue.brand_id, v_currency,
    'instant', 'building', 0, 0, 0, 0, v_request_hash,
    repeat('0', 64), repeat('0', 64), repeat('0', 64),
    pg_catalog.btrim(p_idempotency_key),
    now() + make_interval(mins => v_settings.instant_payment_hold_minutes),
    p_request_id
  );

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_normalized_lines)
    ORDER BY
      (value->>'offeringId')::uuid,
      CASE WHEN lower(value->>'kind') = 'place'
        THEN (value->>'placeWindowId')::uuid ELSE NULL END
  LOOP
    v_kind := lower(v_item->>'kind');
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = (v_item->>'offeringId')::uuid
      AND venue_id = p_venue_id
      AND brand_id = v_venue.brand_id
      AND kind = v_kind
      AND status = 'live';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF COALESCE(v_offering.confirmation_mode, '') NOT IN ('instant', 'request')
    THEN
      RAISE EXCEPTION 'stay_reservations_unavailable' USING ERRCODE = 'P0001';
    END IF;
    IF v_offering.confirmation_mode = 'request' THEN
      v_mode := 'request';
    END IF;
    SELECT * INTO v_price
    FROM public.stay_price_versions
    WHERE offering_id = v_offering.id AND effective_to IS NULL;
    SELECT * INTO v_policy
    FROM public.stay_policy_versions
    WHERE offering_id = v_offering.id AND effective_to IS NULL;
    IF v_price.id IS NULL OR v_policy.id IS NULL
       OR v_price.currency_code <> v_currency THEN
      RAISE EXCEPTION 'stay_currency_mismatch' USING ERRCODE = '22023';
    END IF;

    v_quote_line_id := gen_random_uuid();
    v_base := 0;
    v_adults := 0;
    v_children := 0;
    v_named_preferences := '{}'::uuid[];
    v_inventory_snapshot := '[]'::jsonb;

    IF v_kind = 'room' THEN
      BEGIN
        v_check_in := (v_item->>'checkIn')::date;
        v_check_out := (v_item->>'checkOut')::date;
        v_quantity := (v_item->>'quantity')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
      END;
      IF v_check_out <= v_check_in
         OR v_quantity IS NULL
         OR v_quantity NOT BETWEEN 1 AND 100
         OR v_quantity > v_offering.quantity
         OR jsonb_typeof(v_item->'allocations') <> 'array'
         OR jsonb_array_length(v_item->'allocations') <> v_quantity THEN
        RAISE EXCEPTION 'stay_invalid_room_allocation' USING ERRCODE = '22023';
      END IF;
      IF v_common_check_in IS NULL THEN
        v_common_check_in := v_check_in;
        v_common_check_out := v_check_out;
      ELSIF v_common_check_in <> v_check_in
         OR v_common_check_out <> v_check_out THEN
        RAISE EXCEPTION 'stay_room_dates_must_match' USING ERRCODE = '22023';
      END IF;
      v_nights := v_check_out - v_check_in;
      IF v_check_in <
           (now() AT TIME ZONE v_settings.timezone)::date
         OR v_check_in >
           (now() AT TIME ZONE v_settings.timezone)::date
             + LEAST(
               v_settings.booking_horizon_days,
               COALESCE(
                 v_offering.max_advance_days,
                 v_settings.booking_horizon_days
               )
             )
         OR (
           (v_check_in::timestamp + v_settings.check_in_time)
             AT TIME ZONE v_settings.timezone
         ) < now() + make_interval(mins => v_offering.min_notice_minutes)
      THEN
        RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
      END IF;

      FOR v_allocation IN
        SELECT value
        FROM jsonb_array_elements(v_item->'allocations')
        WITH ORDINALITY allocation(value, ordinal)
        ORDER BY ordinal
      LOOP
        BEGIN
          v_adults := v_adults
            + COALESCE((v_allocation->>'adults')::integer, 0);
          v_children := v_children
            + COALESCE((v_allocation->>'children')::integer, 0);
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'stay_invalid_room_allocation'
            USING ERRCODE = '22023';
        END;
        IF COALESCE((v_allocation->>'adults')::integer, 0) < 0
           OR COALESCE((v_allocation->>'children')::integer, 0) < 0
           OR COALESCE((v_allocation->>'adults')::integer, 0)
             > v_offering.max_adults
           OR COALESCE((v_allocation->>'children')::integer, 0)
             > v_offering.max_children
           OR COALESCE((v_allocation->>'adults')::integer, 0)
              + COALESCE((v_allocation->>'children')::integer, 0)
             NOT BETWEEN v_offering.min_guests AND v_offering.max_guests THEN
          RAISE EXCEPTION 'stay_invalid_room_allocation'
            USING ERRCODE = '22023';
        END IF;
        IF NULLIF(v_allocation->>'namedUnitPreference', '') IS NOT NULL THEN
          IF (v_allocation->>'namedUnitPreference') !~
             '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN
            RAISE EXCEPTION 'stay_invalid_room_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preference :=
            (v_allocation->>'namedUnitPreference')::uuid;
          IF v_named_preference = ANY(v_named_preferences)
             OR NOT EXISTS (
               SELECT 1 FROM public.stay_units u
               WHERE u.id = v_named_preference
                 AND u.offering_id = v_offering.id
                 AND u.status = 'active'
             ) THEN
            RAISE EXCEPTION 'stay_invalid_room_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preferences :=
            pg_catalog.array_append(v_named_preferences, v_named_preference);
        END IF;
      END LOOP;

      FOR v_date IN
        SELECT d::date
        FROM generate_series(
          v_check_in::timestamp,
          (v_check_out - 1)::timestamp,
          interval '1 day'
        ) d
        ORDER BY d
      LOOP
        SELECT * INTO v_night
        FROM public.stay_room_nights
        WHERE offering_id = v_offering.id AND local_date = v_date;
        IF NOT FOUND OR v_night.stop_sell
           OR v_nights < v_night.minimum_nights
           OR (
             v_night.maximum_nights IS NOT NULL
             AND v_nights > v_night.maximum_nights
           )
           OR (
             v_night.price_override_minor IS NOT NULL
             AND v_night.currency_code <> v_currency
           ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
        SELECT COALESCE(sum(s.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.offering_id = v_offering.id
          AND s.resource_type = 'room_night'
          AND s.room_date = v_date
          AND (
            (h.state = 'active' AND h.expires_at > now())
            OR h.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(c.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments c
        WHERE c.offering_id = v_offering.id
          AND c.resource_type = 'room_night'
          AND c.room_date = v_date
          AND c.state = 'active';
        v_available := v_night.sellable_quantity - v_held - v_committed;
        IF v_available < v_quantity THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
        v_base := v_base
          + COALESCE(v_night.price_override_minor, v_price.amount_minor)
            * v_quantity;
        v_inventory_snapshot := v_inventory_snapshot || jsonb_build_array(
          jsonb_build_object(
            'resourceType', 'room_night',
            'localDate', v_date,
            'version', v_night.version,
            'sellableQuantity', v_night.sellable_quantity
          )
        );
      END LOOP;

      INSERT INTO public.stay_quote_lines (
        id, quote_id, offering_id, kind, confirmation_mode,
        room_check_in, room_check_out, room_quantity,
        adults, children, named_unit_preferences,
        base_minor, fee_minor, tax_minor, total_minor,
        price_version_id, policy_version_id, offering_version,
        inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot
      ) VALUES (
        v_quote_line_id, v_quote_id, v_offering.id, 'room',
        v_offering.confirmation_mode,
        v_check_in, v_check_out, v_quantity,
        v_adults, v_children, v_named_preferences,
        v_base, 0, 0, v_base,
        v_price.id, v_policy.id, v_offering.version,
        jsonb_build_object('resources', v_inventory_snapshot),
        jsonb_build_object(
          'name', v_offering.name,
          'kind', v_offering.kind,
          'inventoryBasis', v_offering.inventory_basis,
          'unitNamingMode', v_offering.unit_naming_mode,
          'quantity', v_offering.quantity,
          'maxGuests', v_offering.max_guests,
          'maxAdults', v_offering.max_adults,
          'maxChildren', v_offering.max_children
        ),
        to_jsonb(v_price),
        to_jsonb(v_policy)
      );
      INSERT INTO public.stay_quote_allocations (
        quote_line_id, allocation_ordinal, adults, children,
        named_unit_preference
      )
      SELECT
        v_quote_line_id,
        ordinal::integer - 1,
        COALESCE((value->>'adults')::integer, 0),
        COALESCE((value->>'children')::integer, 0),
        NULLIF(value->>'namedUnitPreference', '')::uuid
      FROM jsonb_array_elements(v_item->'allocations')
        WITH ORDINALITY allocation(value, ordinal)
      ORDER BY ordinal;
    ELSE
      BEGIN
        v_window_id := (v_item->>'placeWindowId')::uuid;
        v_units := NULLIF(v_item->>'units', '')::integer;
        v_guests := NULLIF(v_item->>'guests', '')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
      END;
      SELECT * INTO v_window
      FROM public.stay_place_windows
      WHERE id = v_window_id AND offering_id = v_offering.id;
      IF NOT FOUND OR v_window.stop_sell OR v_window.ends_at <= now()
         OR v_window.starts_at
              < now() + make_interval(mins => v_offering.min_notice_minutes)
         OR v_window.local_date >
              (now() AT TIME ZONE v_settings.timezone)::date
              + LEAST(
                v_settings.booking_horizon_days,
                COALESCE(
                  v_offering.max_advance_days,
                  v_settings.booking_horizon_days
                )
              )
         OR (
           v_window.price_override_minor IS NOT NULL
           AND v_window.currency_code <> v_currency
         ) THEN
        RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
      END IF;

      IF v_offering.inventory_basis = 'shared_capacity' THEN
        IF v_units IS NOT NULL
           OR v_guests IS NULL
           OR v_guests NOT BETWEEN
             v_offering.min_guests AND v_offering.max_guests THEN
          RAISE EXCEPTION 'stay_invalid_place_allocation'
            USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(sum(s.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.place_window_id = v_window.id
          AND (
            (h.state = 'active' AND h.expires_at > now())
            OR h.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(c.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments c
        WHERE c.place_window_id = v_window.id AND c.state = 'active';
        v_available :=
          v_window.sellable_capacity - v_held - v_committed;
        IF v_available < v_guests THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      ELSE
        IF v_units IS NULL
           OR v_units NOT BETWEEN 1 AND v_offering.quantity
           OR v_guests IS NULL
           OR v_guests NOT BETWEEN
             v_offering.min_guests AND v_offering.max_guests THEN
          RAISE EXCEPTION 'stay_invalid_place_allocation'
            USING ERRCODE = '22023';
        END IF;
        SELECT COALESCE(sum(s.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        JOIN public.stay_place_windows held_window
          ON held_window.id = s.place_window_id
        WHERE s.offering_id = v_offering.id
          AND (
            (h.state = 'active' AND h.expires_at > now())
            OR h.state = 'reconciliation_required'
          )
          AND held_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND held_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        SELECT COALESCE(sum(c.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments c
        JOIN public.stay_place_windows committed_window
          ON committed_window.id = c.place_window_id
        WHERE c.offering_id = v_offering.id
          AND c.state = 'active'
          AND committed_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND committed_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        v_available := v_window.sellable_units - v_held - v_committed;
        IF v_available < v_units THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      END IF;

      IF v_offering.unit_naming_mode = 'named' THEN
        IF jsonb_typeof(COALESCE(
          v_item->'namedUnitPreferences', '[]'::jsonb
        )) <> 'array' OR jsonb_array_length(COALESCE(
          v_item->'namedUnitPreferences', '[]'::jsonb
        )) > COALESCE(v_units, 0) THEN
          RAISE EXCEPTION 'stay_invalid_place_allocation'
            USING ERRCODE = '22023';
        END IF;
        FOR v_allocation IN
          SELECT value
          FROM jsonb_array_elements(COALESCE(
            v_item->'namedUnitPreferences', '[]'::jsonb
          ))
        LOOP
          IF jsonb_typeof(v_allocation) <> 'string'
             OR trim(both '"' from v_allocation::text) !~
               '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN
            RAISE EXCEPTION 'stay_invalid_place_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preference :=
            trim(both '"' from v_allocation::text)::uuid;
          IF v_named_preference = ANY(v_named_preferences)
             OR NOT EXISTS (
               SELECT 1 FROM public.stay_units u
               WHERE u.id = v_named_preference
                 AND u.offering_id = v_offering.id
                 AND u.status = 'active'
             ) THEN
            RAISE EXCEPTION 'stay_invalid_place_allocation'
              USING ERRCODE = '22023';
          END IF;
          v_named_preferences :=
            pg_catalog.array_append(v_named_preferences, v_named_preference);
        END LOOP;
      END IF;

      v_adults := COALESCE(NULLIF(v_item->>'adults', '')::integer, 0);
      v_children := COALESCE(NULLIF(v_item->>'children', '')::integer, 0);
      IF v_adults < 0
         OR v_children < 0
         OR (
           v_adults + v_children > 0
           AND v_adults + v_children <> v_guests
         ) THEN
        RAISE EXCEPTION 'stay_invalid_place_allocation'
          USING ERRCODE = '22023';
      END IF;
      v_base := COALESCE(v_window.price_override_minor, v_price.amount_minor)
        * CASE v_offering.place_pricing_basis
            WHEN 'per_unit' THEN v_units
            WHEN 'per_guest' THEN v_guests
            ELSE 1
          END;
      IF v_base IS NULL THEN
        RAISE EXCEPTION 'stay_invalid_place_allocation'
          USING ERRCODE = '22023';
      END IF;
      v_inventory_snapshot := jsonb_build_object(
        'resources', jsonb_build_array(jsonb_build_object(
          'resourceType', 'place_window',
          'windowId', v_window.id,
          'version', v_window.version,
          'startsAt', v_window.starts_at,
          'endsAt', v_window.ends_at,
          'sellableUnits', v_window.sellable_units,
          'sellableCapacity', v_window.sellable_capacity
        ))
      );

      INSERT INTO public.stay_quote_lines (
        id, quote_id, offering_id, kind, confirmation_mode,
        place_window_id, place_units, place_guests, adults, children,
        named_unit_preferences, base_minor, fee_minor, tax_minor, total_minor,
        price_version_id, policy_version_id, offering_version,
        inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot
      ) VALUES (
        v_quote_line_id, v_quote_id, v_offering.id, 'place',
        v_offering.confirmation_mode, v_window.id, v_units, v_guests,
        v_adults, v_children, v_named_preferences,
        v_base, 0, 0, v_base,
        v_price.id, v_policy.id, v_offering.version,
        v_inventory_snapshot,
        jsonb_build_object(
          'name', v_offering.name,
          'kind', v_offering.kind,
          'inventoryBasis', v_offering.inventory_basis,
          'unitNamingMode', v_offering.unit_naming_mode,
          'quantity', v_offering.quantity,
          'capacity', v_offering.capacity,
          'maxGuests', v_offering.max_guests,
          'accessScope', v_offering.access_scope,
          'pricingBasis', v_offering.place_pricing_basis,
          'bufferBeforeMinutes', v_offering.buffer_before_minutes,
          'bufferAfterMinutes', v_offering.buffer_after_minutes
        ),
        to_jsonb(v_price),
        to_jsonb(v_policy)
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.stay_quote_lines place_line
    JOIN public.stay_offerings place_offering
      ON place_offering.id = place_line.offering_id
    JOIN public.stay_place_windows place_window
      ON place_window.id = place_line.place_window_id
    WHERE place_line.quote_id = v_quote_id
      AND place_offering.access_scope = 'overnight_guests_only'
      AND NOT EXISTS (
        SELECT 1
        FROM public.stay_quote_lines room_line
        WHERE room_line.quote_id = v_quote_id
          AND room_line.kind = 'room'
          AND room_line.room_check_in <= place_window.local_date
          AND room_line.room_check_out > place_window.local_date
      )
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_quote_fee_lines (
    quote_id, quote_line_id, fee_version_id, name, fee_kind,
    amount_minor, included_in_base, refund_treatment, snapshot
  )
  SELECT
    v_quote_id,
    line.id,
    fee.id,
    fee.label,
    fee.fee_kind,
    CASE fee.calculation
      WHEN 'fixed_per_room_night' THEN
        fee.amount_minor
          * line.room_quantity
          * (line.room_check_out - line.room_check_in)
      WHEN 'fixed_per_place_booking' THEN fee.amount_minor
      WHEN 'fixed_per_place_unit' THEN fee.amount_minor * line.place_units
      WHEN 'fixed_per_place_guest' THEN fee.amount_minor * line.place_guests
      WHEN 'percentage_of_line_base' THEN
        ((line.base_minor::numeric * fee.basis_points + 5000) / 10000)::bigint
      ELSE 0
    END,
    fee.display_mode = 'included',
    fee.refund_treatment,
    to_jsonb(fee)
  FROM public.stay_quote_lines line
  JOIN public.stay_fee_versions fee
    ON fee.offering_id = line.offering_id
   AND fee.effective_to IS NULL
  WHERE line.quote_id = v_quote_id
    AND fee.calculation <> 'fixed_per_group'
    AND (
      fee.calculation = 'percentage_of_line_base'
      OR (line.kind = 'room' AND fee.calculation = 'fixed_per_room_night')
      OR (
        line.kind = 'place'
        AND (
          fee.calculation IN (
            'fixed_per_place_booking',
            'fixed_per_place_guest'
          )
          OR (
            fee.calculation = 'fixed_per_place_unit'
            AND line.place_units IS NOT NULL
          )
        )
      )
    )
    AND (
      fee.calculation = 'percentage_of_line_base'
      OR fee.currency_code = v_currency
    );

  FOR v_fee IN
    SELECT fee.*
    FROM public.stay_fee_versions fee
    WHERE fee.effective_to IS NULL
      AND fee.calculation = 'fixed_per_group'
      AND fee.currency_code = v_currency
      AND EXISTS (
        SELECT 1 FROM public.stay_quote_lines line
        WHERE line.quote_id = v_quote_id
          AND line.offering_id = fee.offering_id
      )
    ORDER BY fee.id
  LOOP
    SELECT sum(base_minor) INTO v_total_base
    FROM public.stay_quote_lines WHERE quote_id = v_quote_id;
    IF v_total_base = 0 THEN
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind,
        amount_minor, included_in_base, refund_treatment, snapshot
      )
      SELECT
        v_quote_id, line.id, v_fee.id, v_fee.label, v_fee.fee_kind,
        CASE WHEN row_number() OVER (ORDER BY line.id) = 1
          THEN v_fee.amount_minor ELSE 0 END,
        v_fee.display_mode = 'included',
        v_fee.refund_treatment,
        to_jsonb(v_fee)
      FROM public.stay_quote_lines line
      WHERE line.quote_id = v_quote_id;
    ELSE
      INSERT INTO public.stay_quote_fee_lines (
        quote_id, quote_line_id, fee_version_id, name, fee_kind,
        amount_minor, included_in_base, refund_treatment, snapshot
      )
      WITH base_allocations AS (
        SELECT
          line.id,
          floor(
            v_fee.amount_minor::numeric * line.base_minor / v_total_base
          )::bigint AS floor_minor,
          (
            v_fee.amount_minor::numeric * line.base_minor
            - floor(
              v_fee.amount_minor::numeric * line.base_minor / v_total_base
            ) * v_total_base
          ) AS remainder
        FROM public.stay_quote_lines line
        WHERE line.quote_id = v_quote_id
      ),
      ranked AS (
        SELECT
          b.*,
          row_number() OVER (ORDER BY b.remainder DESC, b.id) AS rank,
          sum(b.floor_minor) OVER () AS floor_total
        FROM base_allocations b
      )
      SELECT
        v_quote_id,
        ranked.id,
        v_fee.id,
        v_fee.label,
        v_fee.fee_kind,
        ranked.floor_minor + CASE
          WHEN ranked.rank <= v_fee.amount_minor - ranked.floor_total
            THEN 1 ELSE 0 END,
        v_fee.display_mode = 'included',
        v_fee.refund_treatment,
        to_jsonb(v_fee)
      FROM ranked;
    END IF;
  END LOOP;

  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor,
      tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT
      quote_line_id,
      COALESCE(sum(amount_minor) FILTER (
        WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base
      ), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (
        WHERE fee_kind = 'tax' AND NOT included_in_base
      ), 0) AS tax_minor
    FROM public.stay_quote_fee_lines
    WHERE quote_id = v_quote_id
    GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;

  SELECT sum(total_minor) INTO v_total
  FROM public.stay_quote_lines WHERE quote_id = v_quote_id;
  IF v_total IS NULL OR v_total > 9000000000000000 THEN
    RAISE EXCEPTION 'stay_money_out_of_range' USING ERRCODE = '22003';
  END IF;

  UPDATE public.stay_quotes q
  SET mode = v_mode,
      status = 'active',
      source_subtotal_minor = totals.source_subtotal_minor,
      fee_total_minor = totals.fee_total_minor,
      tax_total_minor = totals.tax_total_minor,
      total_minor = totals.total_minor,
      price_revision_set_hash = (
        SELECT encode(extensions.digest(
          pg_catalog.convert_to(string_agg(
            l.price_version_id::text || ':' || l.price_snapshot::text,
            '|' ORDER BY l.offering_id, l.place_window_id NULLS FIRST
          ), 'UTF8'), 'sha256'), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id
      ),
      inventory_revision_set_hash = (
        SELECT encode(extensions.digest(
          pg_catalog.convert_to(string_agg(
            l.offering_id::text || ':' || l.offering_version::text
              || ':' || l.inventory_snapshot::text,
            '|' ORDER BY l.offering_id, l.place_window_id NULLS FIRST
          ), 'UTF8'), 'sha256'), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id
      ),
      policy_snapshot_hash = (
        SELECT encode(extensions.digest(
          pg_catalog.convert_to(string_agg(
            l.policy_version_id::text || ':' || l.policy_snapshot::text,
            '|' ORDER BY l.offering_id, l.place_window_id NULLS FIRST
          ), 'UTF8'), 'sha256'), 'hex')
        FROM public.stay_quote_lines l WHERE l.quote_id = q.id
      )
  FROM (
    SELECT
      sum(base_minor) AS source_subtotal_minor,
      sum(fee_minor) AS fee_total_minor,
      sum(tax_minor) AS tax_total_minor,
      sum(total_minor) AS total_minor
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote_id
  ) totals
  WHERE q.id = v_quote_id;

  RETURN public.issue_1388_quote_projection(v_quote_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_create_stay_group(
  p_quote_id uuid,
  p_idempotency_key text,
  p_guest jsonb,
  p_expected_quote_version bigint DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_key text := public.issue_1388_actor_key();
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_group_id uuid := gen_random_uuid();
  v_hold_id uuid := gen_random_uuid();
  v_settings public.stay_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_reservation_line public.stay_reservation_lines%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_night public.stay_room_nights%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_resource jsonb;
  v_allocation public.stay_quote_allocations%ROWTYPE;
  v_date date;
  v_unit_id uuid;
  v_preference uuid;
  v_unit_index integer;
  v_held bigint;
  v_committed bigint;
  v_available bigint;
  v_request_hash text;
  v_group_state text;
  v_line_state text;
  v_hold_expires_at timestamptz;
  v_request_deadline timestamptz;
  v_dependency_room_line_id uuid;
BEGIN
  IF v_uid IS NULL OR v_actor_key IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_quote_id IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_guest) <> 'object'
     OR jsonb_typeof(p_guest->'name') <> 'string'
     OR (
       p_guest ? 'email'
       AND jsonb_typeof(p_guest->'email') <> 'string'
     )
     OR (
       p_guest ? 'phone'
       AND jsonb_typeof(p_guest->'phone') <> 'string'
     )
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'name', '')))
       NOT BETWEEN 1 AND 120
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'email', ''))) > 254
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) > 40
     OR (
       char_length(pg_catalog.btrim(COALESCE(p_guest->>'email', ''))) = 0
       AND char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) = 0
     )
     OR p_guest - ARRAY['name', 'email', 'phone'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'quoteId', p_quote_id,
        'guest', p_guest
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_key || ':group:' || pg_catalog.btrim(p_idempotency_key),
      1388
    )
  );
  SELECT * INTO v_existing
  FROM public.stay_reservation_groups
  WHERE actor_key_hash = v_actor_key
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_group_projection(v_existing.id);
  END IF;

  SELECT * INTO v_quote
  FROM public.stay_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> v_actor_key THEN
    RAISE EXCEPTION 'stay_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_quote_version IS NULL
     OR v_quote.version <> p_expected_quote_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' AND v_quote.expires_at <= now() THEN
      UPDATE public.stay_quotes
      SET status = 'expired', version = version + 1
      WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'stay_quote_expired' USING ERRCODE = '22023';
  END IF;

  -- Binding lock order: brand/settings/currency readiness, idempotency/quote,
  -- offerings, Room nights, Place windows, private units, then active slices.
  PERFORM 1 FROM public.brands
  WHERE id = v_quote.brand_id
  FOR UPDATE;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = v_quote.venue_id
  FOR UPDATE;
  IF NOT FOUND OR v_settings.booking_state <> 'active'
     OR NOT public.pg_brand_can_collect(v_quote.brand_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.brands b
       WHERE b.id = v_quote.brand_id
         AND upper(b.default_currency) = v_quote.currency_code
     )
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations r
       WHERE r.brand_id = v_quote.brand_id AND r.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.stay_offerings offering
  JOIN public.stay_quote_lines line ON line.offering_id = offering.id
  WHERE line.quote_id = v_quote.id
  ORDER BY offering.id
  FOR UPDATE OF offering;

  PERFORM 1
  FROM public.stay_room_nights night
  JOIN public.stay_quote_lines line
    ON line.offering_id = night.offering_id
   AND line.kind = 'room'
   AND night.local_date >= line.room_check_in
   AND night.local_date < line.room_check_out
  WHERE line.quote_id = v_quote.id
  ORDER BY night.offering_id, night.local_date
  FOR UPDATE OF night;

  PERFORM 1
  FROM public.stay_place_windows window_row
  JOIN public.stay_quote_lines line
    ON line.place_window_id = window_row.id
  WHERE line.quote_id = v_quote.id
  ORDER BY window_row.offering_id, window_row.starts_at, window_row.id
  FOR UPDATE OF window_row;

  PERFORM 1
  FROM public.stay_units unit_row
  JOIN public.stay_quote_lines line
    ON line.offering_id = unit_row.offering_id
  WHERE line.quote_id = v_quote.id
    AND unit_row.status = 'active'
  ORDER BY unit_row.offering_id, unit_row.id
  FOR UPDATE OF unit_row;

  PERFORM 1
  FROM public.stay_inventory_hold_slices slice_row
  JOIN public.stay_inventory_holds hold_row
    ON hold_row.id = slice_row.hold_id
  WHERE slice_row.offering_id IN (
    SELECT offering_id
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
  )
    AND hold_row.state IN ('active', 'reconciliation_required')
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  FOR UPDATE OF slice_row, hold_row;

  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.offering_id IN (
    SELECT offering_id
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
  )
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;

  UPDATE public.stay_inventory_holds hold_row
  SET state = 'expired', version = version + 1, updated_at = now()
  WHERE hold_row.state = 'active'
    AND hold_row.expires_at <= now()
    AND EXISTS (
      SELECT 1
      FROM public.stay_inventory_hold_slices slice_row
      WHERE slice_row.hold_id = hold_row.id
        AND slice_row.offering_id IN (
          SELECT offering_id
          FROM public.stay_quote_lines
          WHERE quote_id = v_quote.id
        )
    );

  FOR v_line IN
    SELECT * FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
    ORDER BY offering_id, place_window_id NULLS FIRST
  LOOP
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_line.offering_id;
    IF NOT FOUND OR v_offering.status <> 'live'
       OR v_offering.version <> v_line.offering_version
       OR v_offering.confirmation_mode <> v_line.confirmation_mode
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_price_versions p
         WHERE p.id = v_line.price_version_id
           AND p.offering_id = v_line.offering_id
           AND p.effective_to IS NULL
           AND p.currency_code = v_quote.currency_code
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_policy_versions p
         WHERE p.id = v_line.policy_version_id
           AND p.offering_id = v_line.offering_id
           AND p.effective_to IS NULL
       ) THEN
      RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
    END IF;
    FOR v_resource IN
      SELECT value
      FROM jsonb_array_elements(v_line.inventory_snapshot->'resources')
    LOOP
      IF v_resource->>'resourceType' = 'room_night' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.stay_room_nights n
          WHERE n.offering_id = v_line.offering_id
            AND n.local_date = (v_resource->>'localDate')::date
            AND n.version = (v_resource->>'version')::bigint
            AND NOT n.stop_sell
        ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM public.stay_place_windows w
          WHERE w.id = (v_resource->>'windowId')::uuid
            AND w.offering_id = v_line.offering_id
            AND w.version = (v_resource->>'version')::bigint
            AND NOT w.stop_sell
            AND w.ends_at > now()
        ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  v_group_state := CASE v_quote.mode
    WHEN 'request' THEN 'request_pending'
    ELSE 'instant_payment_pending'
  END;
  v_line_state := CASE v_quote.mode
    WHEN 'request' THEN 'request_pending'
    ELSE 'payment_pending'
  END;
  v_request_deadline := CASE v_quote.mode
    WHEN 'request' THEN
      now() + make_interval(hours => v_settings.request_response_hours)
    ELSE NULL
  END;
  v_hold_expires_at := COALESCE(
    v_request_deadline,
    now() + make_interval(mins => v_settings.instant_payment_hold_minutes)
  );

  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash,
    venue_id, brand_id, currency_code, mode, state,
    request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash
  ) VALUES (
    v_group_id,
    'ST-' || upper(substr(replace(v_group_id::text, '-', ''), 1, 20)),
    v_quote.id, v_uid, v_actor_key,
    v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    v_quote.mode, v_group_state, v_request_deadline, NULL, p_guest,
    v_quote.source_subtotal_minor, v_quote.fee_total_minor,
    v_quote.tax_total_minor, v_quote.total_minor,
    pg_catalog.btrim(p_idempotency_key), v_request_hash
  );

  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state,
    room_check_in, room_check_out, room_quantity,
    place_window_id, place_units, place_guests, adults, children,
    base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot
  )
  SELECT
    gen_random_uuid(), v_group_id, line.id, line.offering_id, line.kind,
    v_line_state, line.room_check_in, line.room_check_out, line.room_quantity,
    line.place_window_id, line.place_units, line.place_guests,
    line.adults, line.children,
    line.base_minor, line.fee_minor, line.tax_minor, line.total_minor,
    line.offering_snapshot, line.price_snapshot, line.policy_snapshot
  FROM public.stay_quote_lines line
  WHERE line.quote_id = v_quote.id AND line.kind = 'room'
  ORDER BY line.offering_id;

  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state,
    room_check_in, room_check_out, room_quantity,
    place_window_id, place_units, place_guests, adults, children,
    base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot,
    dependency_room_line_id
  )
  SELECT
    gen_random_uuid(), v_group_id, line.id, line.offering_id, line.kind,
    v_line_state, line.room_check_in, line.room_check_out, line.room_quantity,
    line.place_window_id, line.place_units, line.place_guests,
    line.adults, line.children,
    line.base_minor, line.fee_minor, line.tax_minor, line.total_minor,
    line.offering_snapshot, line.price_snapshot, line.policy_snapshot,
    CASE WHEN offering.access_scope = 'overnight_guests_only' THEN (
      SELECT room_reservation.id
      FROM public.stay_reservation_lines room_reservation
      JOIN public.stay_quote_lines room_quote
        ON room_quote.id = room_reservation.quote_line_id
      WHERE room_reservation.group_id = v_group_id
        AND room_reservation.kind = 'room'
        AND room_quote.room_check_in <= window_row.local_date
        AND room_quote.room_check_out > window_row.local_date
      ORDER BY room_reservation.offering_id, room_reservation.id
      LIMIT 1
    ) ELSE NULL END
  FROM public.stay_quote_lines line
  JOIN public.stay_offerings offering ON offering.id = line.offering_id
  JOIN public.stay_place_windows window_row ON window_row.id = line.place_window_id
  WHERE line.quote_id = v_quote.id AND line.kind = 'place'
  ORDER BY line.offering_id, line.place_window_id;

  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines line
    JOIN public.stay_offerings offering ON offering.id = line.offering_id
    WHERE line.group_id = v_group_id
      AND line.kind = 'place'
      AND offering.access_scope = 'overnight_guests_only'
      AND line.dependency_room_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_inventory_holds (
    id, group_id, state, expires_at, reason
  ) VALUES (
    v_hold_id, v_group_id, 'active', v_hold_expires_at,
    CASE v_quote.mode
      WHEN 'request' THEN 'request_response'
      ELSE 'instant_payment'
    END
  );

  FOR v_line IN
    SELECT quote_line.*
    FROM public.stay_quote_lines quote_line
    WHERE quote_line.quote_id = v_quote.id
    ORDER BY quote_line.offering_id, quote_line.place_window_id NULLS FIRST
  LOOP
    SELECT * INTO v_reservation_line
    FROM public.stay_reservation_lines
    WHERE group_id = v_group_id AND quote_line_id = v_line.id;
    SELECT * INTO v_offering
    FROM public.stay_offerings WHERE id = v_line.offering_id;

    IF v_line.kind = 'room' THEN
      FOR v_date IN
        SELECT d::date
        FROM generate_series(
          v_line.room_check_in::timestamp,
          (v_line.room_check_out - 1)::timestamp,
          interval '1 day'
        ) d
        ORDER BY d
      LOOP
        SELECT * INTO v_night
        FROM public.stay_room_nights
        WHERE offering_id = v_line.offering_id AND local_date = v_date;
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        WHERE slice_row.offering_id = v_line.offering_id
          AND slice_row.resource_type = 'room_night'
          AND slice_row.room_date = v_date
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments
        WHERE offering_id = v_line.offering_id
          AND resource_type = 'room_night'
          AND room_date = v_date
          AND state = 'active';
        v_available := v_night.sellable_quantity - v_held - v_committed;
        IF v_available < v_line.room_quantity THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      END LOOP;

      IF v_offering.unit_naming_mode = 'named' THEN
        FOR v_allocation IN
          SELECT * FROM public.stay_quote_allocations
          WHERE quote_line_id = v_line.id
          ORDER BY allocation_ordinal
        LOOP
          v_preference := v_allocation.named_unit_preference;
          IF v_preference IS NOT NULL THEN
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.id = v_preference
              AND u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND slice_row.resource_type = 'room_night'
                  AND slice_row.room_date >= v_line.room_check_in
                  AND slice_row.room_date < v_line.room_check_out
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.resource_type = 'room_night'
                  AND commitment.room_date >= v_line.room_check_in
                  AND commitment.room_date < v_line.room_check_out
                  AND commitment.state = 'active'
              );
          ELSE
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND slice_row.resource_type = 'room_night'
                  AND slice_row.room_date >= v_line.room_check_in
                  AND slice_row.room_date < v_line.room_check_out
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.resource_type = 'room_night'
                  AND commitment.room_date >= v_line.room_check_in
                  AND commitment.room_date < v_line.room_check_out
                  AND commitment.state = 'active'
              )
            ORDER BY u.id
            LIMIT 1;
          END IF;
          IF v_unit_id IS NULL THEN
            RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
          END IF;
          FOR v_date IN
            SELECT d::date
            FROM generate_series(
              v_line.room_check_in::timestamp,
              (v_line.room_check_out - 1)::timestamp,
              interval '1 day'
            ) d
            ORDER BY d
          LOOP
            INSERT INTO public.stay_inventory_hold_slices (
              hold_id, reservation_line_id, resource_type, offering_id,
              room_date, quantity, exclusive_unit_id
            ) VALUES (
              v_hold_id, v_reservation_line.id, 'room_night',
              v_line.offering_id, v_date, 1, v_unit_id
            );
          END LOOP;
          v_unit_id := NULL;
        END LOOP;
      ELSE
        FOR v_date IN
          SELECT d::date
          FROM generate_series(
            v_line.room_check_in::timestamp,
            (v_line.room_check_out - 1)::timestamp,
            interval '1 day'
          ) d
          ORDER BY d
        LOOP
          INSERT INTO public.stay_inventory_hold_slices (
            hold_id, reservation_line_id, resource_type, offering_id,
            room_date, quantity
          ) VALUES (
            v_hold_id, v_reservation_line.id, 'room_night',
            v_line.offering_id, v_date, v_line.room_quantity
          );
        END LOOP;
      END IF;
    ELSE
      SELECT * INTO v_window
      FROM public.stay_place_windows WHERE id = v_line.place_window_id;
      IF v_offering.inventory_basis = 'shared_capacity' THEN
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        WHERE slice_row.place_window_id = v_window.id
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments
        WHERE place_window_id = v_window.id AND state = 'active';
        v_available :=
          v_window.sellable_capacity - v_held - v_committed;
        IF v_available < v_line.place_guests THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
        INSERT INTO public.stay_inventory_hold_slices (
          hold_id, reservation_line_id, resource_type, offering_id,
          place_window_id, quantity
        ) VALUES (
          v_hold_id, v_reservation_line.id, 'place_window',
          v_line.offering_id, v_window.id, v_line.place_guests
        );
      ELSE
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        JOIN public.stay_place_windows held_window
          ON held_window.id = slice_row.place_window_id
        WHERE slice_row.offering_id = v_line.offering_id
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          )
          AND held_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND held_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        SELECT COALESCE(sum(commitment.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments commitment
        JOIN public.stay_place_windows committed_window
          ON committed_window.id = commitment.place_window_id
        WHERE commitment.offering_id = v_line.offering_id
          AND commitment.state = 'active'
          AND committed_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND committed_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        v_available := v_window.sellable_units - v_held - v_committed;
        IF v_available < v_line.place_units THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;

        IF v_offering.unit_naming_mode = 'named' THEN
          FOR v_unit_index IN 1..v_line.place_units
          LOOP
            v_preference := v_line.named_unit_preferences[v_unit_index];
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND (v_preference IS NULL OR u.id = v_preference)
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                JOIN public.stay_place_windows held_window
                  ON held_window.id = slice_row.place_window_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
                  AND held_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
                      < v_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                  AND held_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                      > v_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                JOIN public.stay_place_windows committed_window
                  ON committed_window.id = commitment.place_window_id
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.state = 'active'
                  AND committed_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
                      < v_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                  AND committed_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                      > v_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
              )
            ORDER BY u.id
            LIMIT 1;
            IF v_unit_id IS NULL THEN
              RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
            END IF;
            INSERT INTO public.stay_inventory_hold_slices (
              hold_id, reservation_line_id, resource_type, offering_id,
              place_window_id, quantity, exclusive_unit_id
            ) VALUES (
              v_hold_id, v_reservation_line.id, 'place_window',
              v_line.offering_id, v_window.id, 1, v_unit_id
            );
            v_unit_id := NULL;
          END LOOP;
        ELSE
          INSERT INTO public.stay_inventory_hold_slices (
            hold_id, reservation_line_id, resource_type, offering_id,
            place_window_id, quantity
          ) VALUES (
            v_hold_id, v_reservation_line.id, 'place_window',
            v_line.offering_id, v_window.id, v_line.place_units
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.stay_quotes
  SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    request_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group_id,
    CASE v_quote.mode
      WHEN 'request' THEN 'stay_request_submitted'
      ELSE 'stay_instant_payment_pending'
    END,
    'guest',
    v_uid,
    p_request_id,
    'create:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'mode', v_quote.mode,
      'holdExpiresAt', v_hold_expires_at,
      'lineCount', (
        SELECT count(*) FROM public.stay_reservation_lines
        WHERE group_id = v_group_id
      )
    )
  );

  RETURN public.issue_1388_group_projection(v_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_manage_request(
  p_action text,
  p_group_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_existing_event public.stay_reservation_events%ROWTYPE;
  v_event_type text;
  v_event_key text;
  v_payment_deadline timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_action NOT IN ('approve_request', 'decline_request')
     OR p_group_id IS NULL
     OR p_expected_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_group.brand_id, v_uid, 'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = v_group.venue_id
  FOR UPDATE;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id
  FOR UPDATE;
  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = p_group_id
  FOR UPDATE;

  v_event_type := CASE v_action
    WHEN 'approve_request' THEN 'stay_request_approved'
    ELSE 'stay_request_declined'
  END;
  v_event_key := v_action || ':' || pg_catalog.btrim(p_idempotency_key);
  SELECT * INTO v_existing_event
  FROM public.stay_reservation_events
  WHERE group_id = p_group_id AND idempotency_key = v_event_key;
  IF FOUND THEN
    IF v_existing_event.event_type NOT IN (
      v_event_type,
      'stay_request_expired'
    ) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_group_projection(p_group_id);
  END IF;
  IF v_hold.id IS NULL OR v_hold.state <> 'active' THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
  END IF;

  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_group.mode <> 'request' OR v_group.state <> 'request_pending' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
  END IF;

  IF v_group.request_deadline <= now() OR v_hold.expires_at <= now() THEN
    UPDATE public.stay_reservation_groups
    SET state = 'request_expired', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id,
      request_id, idempotency_key, safe_metadata
    ) VALUES (
      p_group_id, 'stay_request_expired', 'staff', v_uid,
      p_request_id, v_event_key,
      jsonb_build_object('expiredAt', now())
    );
    RETURN public.issue_1388_group_projection(p_group_id);
  END IF;

  IF v_action = 'approve_request' THEN
    IF v_settings.booking_state <> 'active'
       OR NOT public.pg_brand_can_collect(v_group.brand_id)
       OR EXISTS (
         SELECT 1 FROM public.brand_currency_reconciliations r
         WHERE r.brand_id = v_group.brand_id AND r.status = 'pending'
       ) THEN
      RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
    END IF;
    v_payment_deadline :=
      now() + make_interval(mins => v_settings.approved_payment_minutes);
    UPDATE public.stay_reservation_groups
    SET state = 'approved_payment_required',
        payment_deadline = v_payment_deadline,
        version = version + 1,
        updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'approved_payment_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET expires_at = v_payment_deadline,
        reason = 'approved_payment',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.stay_reservation_groups
    SET state = 'declined', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'declined', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET state = 'released',
        reason = 'request_declined',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    request_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, v_event_type, 'staff', v_uid,
    p_request_id, v_event_key,
    jsonb_build_object('paymentDeadline', v_payment_deadline)
  );
  RETURN public.issue_1388_group_projection(p_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1388_expire_groups(
  p_limit integer DEFAULT 100,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    CASE
      WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
        THEN NULL
      ELSE current_setting('request.jwt.claims', true)::jsonb->>'role'
    END,
    ''
  );
  v_group public.stay_reservation_groups%ROWTYPE;
  v_state text;
  v_count integer := 0;
BEGIN
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  FOR v_group IN
    SELECT g.*
    FROM public.stay_reservation_groups g
    JOIN public.stay_inventory_holds h ON h.group_id = g.id
    WHERE h.state = 'active'
      AND h.expires_at <= now()
      AND g.state IN (
        'instant_payment_pending',
        'request_pending',
        'approved_payment_required'
      )
    ORDER BY h.expires_at, g.id
    FOR UPDATE OF g, h SKIP LOCKED
    LIMIT p_limit
  LOOP
    v_state := CASE v_group.state
      WHEN 'instant_payment_pending' THEN 'cancelled'
      ELSE 'request_expired'
    END;
    UPDATE public.stay_reservation_groups
    SET state = v_state, version = version + 1, updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_reservation_lines
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id
      AND state IN (
        'payment_pending', 'request_pending', 'approved_payment_required'
      );
    UPDATE public.stay_inventory_holds
    SET state = 'expired',
        reason = 'deadline_expired',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id AND state = 'active';
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, request_id,
      idempotency_key, safe_metadata
    ) VALUES (
      v_group.id,
      CASE v_group.state
        WHEN 'instant_payment_pending' THEN 'stay_instant_hold_expired'
        ELSE 'stay_request_expired'
      END,
      'service',
      p_request_id,
      'sweep:' || v_group.state || ':' ||
        floor(extract(epoch FROM COALESCE(
          v_group.payment_deadline,
          v_group.request_deadline,
          v_group.updated_at
        )))::bigint::text,
      jsonb_build_object('priorState', v_group.state)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('expiredCount', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_manage_stay_reservation(
  p_action text,
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
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF v_action = 'quote' THEN
    RETURN public.issue_1388_quote_stay_cart(
      (p_payload->>'venueId')::uuid,
      p_payload->'lines',
      p_payload->>'idempotencyKey',
      p_request_id
    );
  ELSIF v_action = 'create_group' THEN
    RETURN public.issue_1388_create_stay_group(
      (p_payload->>'quoteId')::uuid,
      p_payload->>'idempotencyKey',
      p_payload->'guest',
      p_expected_version,
      p_request_id
    );
  ELSIF v_action IN ('approve_request', 'decline_request') THEN
    RETURN public.issue_1388_manage_request(
      v_action,
      (p_payload->>'groupId')::uuid,
      p_expected_version,
      p_payload->>'idempotencyKey',
      p_request_id
    );
  ELSIF v_action = 'get_group' THEN
    RETURN public.issue_1388_group_projection(
      (p_payload->>'groupId')::uuid
    );
  END IF;
  RAISE EXCEPTION 'stay_invalid_action' USING ERRCODE = '22023';
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1388_actor_key()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1388_quote_projection(uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1388_group_projection(uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1388_quote_stay_cart(
  uuid, jsonb, text, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1388_create_stay_group(
  uuid, text, jsonb, bigint, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1388_manage_request(
  text, uuid, bigint, text, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1388_expire_groups(integer, uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.biz_manage_stay_reservation(
  text, jsonb, bigint, uuid
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.biz_manage_stay_reservation(
  text, jsonb, bigint, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1388_expire_groups(integer, uuid)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
