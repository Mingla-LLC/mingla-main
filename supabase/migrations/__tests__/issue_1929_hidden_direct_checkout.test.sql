-- #1929 transactional behavioral fixture. PostgreSQL 17 replay target.
-- Every row is created inside one transaction and ROLLBACKed. The final probe
-- proves that the deterministic fixture prefix left no persistent residue.
\set ON_ERROR_STOP on

BEGIN;
DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_ids uuid[] := ARRAY[]::uuid[];
  v_event uuid;
  v_ticket uuid;
  v_payload json;
  v_session jsonb;
  v_status text;
  v_visibility text;
  v_slug text;
  v_expected boolean;
  v_count integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency, pricing_currency, payment_provider
  ) VALUES (
    v_brand, v_user, 'i1929 fixture brand', 'i1929-fixture-brand', 'NGN', 'NGN', 'paystack'
  );

  -- Bundle matrix: exact UUID and exact slug must agree for every admitted
  -- lifecycle/visibility pair. Private/draft/deleted rows must return SQL NULL.
  FOREACH v_status IN ARRAY ARRAY['scheduled','live','ended','cancelled'] LOOP
    FOREACH v_visibility IN ARRAY ARRAY['public','hidden'] LOOP
      v_event := gen_random_uuid();
      v_slug := 'i1929-fixture-' || v_visibility || '-' || v_status;
      v_ids := array_append(v_ids, v_event);
      INSERT INTO public.events (
        id, brand_id, title, slug, event_type, status, visibility, timezone,
        currency, published_at
      ) VALUES (
        v_event, v_brand, v_slug, v_slug, 'event', v_status, v_visibility,
        'Africa/Lagos', 'NGN', now()
      );
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_event, now() + interval '1 day', now() + interval '1 day 4 hours',
              'Africa/Lagos', true);

      SELECT public.pg_direct_event_checkout_bundle(v_event, NULL, NULL) INTO v_payload;
      IF v_payload IS NULL OR v_payload->>'id' <> v_event::text OR v_payload->>'status' <> v_status THEN
        RAISE EXCEPTION 'bundle UUID matrix failed for %/%', v_visibility, v_status;
      END IF;
      IF v_payload::jsonb IS DISTINCT FROM public.pg_direct_event_checkout_bundle(
        NULL, 'i1929-fixture-brand', v_slug
      )::jsonb THEN
        RAISE EXCEPTION 'bundle slug/UUID parity failed for %/%', v_visibility, v_status;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_status IN ARRAY ARRAY['scheduled','draft'] LOOP
    FOREACH v_visibility IN ARRAY ARRAY['private','draft'] LOOP
      v_event := gen_random_uuid();
      v_slug := 'i1929-fixture-denied-' || v_visibility || '-' || v_status;
      v_ids := array_append(v_ids, v_event);
      INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
      VALUES (v_event, v_brand, v_slug, v_slug, 'event', v_status, v_visibility, 'UTC');
      IF public.pg_direct_event_checkout_bundle(v_event, NULL, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'bundle admitted denied %/% row', v_visibility, v_status;
      END IF;
    END LOOP;
  END LOOP;

  v_event := gen_random_uuid();
  v_ids := array_append(v_ids, v_event);
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone, deleted_at
  ) VALUES (
    v_event, v_brand, 'i1929 deleted', 'i1929-fixture-deleted', 'event',
    'scheduled', 'public', 'UTC', now()
  );
  IF public.pg_direct_event_checkout_bundle(v_event, NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'bundle admitted deleted event';
  END IF;

  IF public.pg_direct_event_checkout_bundle(NULL, NULL, NULL) IS NOT NULL
     OR public.pg_direct_event_checkout_bundle(NULL, '', 'x') IS NOT NULL
     OR public.pg_direct_event_checkout_bundle(NULL, 'i1929-fixture-brand', '') IS NOT NULL
     OR public.pg_direct_event_checkout_bundle(gen_random_uuid(), 'i1929-fixture-brand', 'x') IS NOT NULL
     OR public.pg_direct_event_checkout_bundle(NULL, 'i1929-fixture-brand', 'unknown') IS NOT NULL THEN
    RAISE EXCEPTION 'bundle invalid/ambiguous/unknown identity did not fail closed';
  END IF;

  -- Tier projection: online hidden + disabled remain visible to the direct-link
  -- bundle; deleted and offline tiers do not.
  v_event := v_ids[1];
  UPDATE public.events
     SET location_geo = point(3.3792, 6.5244),
         city_geo = public.ST_SetSRID(public.ST_MakePoint(3.35, 6.45), 4326)::public.geometry,
         theme = jsonb_build_object('business_event', jsonb_build_object(
           'hideAddressUntilTicket', false,
           'location', jsonb_build_object('address', 'Lagos fixture street')
         ))
   WHERE id = v_event;
  INSERT INTO public.ticket_types (
    event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person, display_order,
    is_hidden, is_disabled
  ) VALUES
    (v_event, 'i1929 visible', 0, NULL, true, 20, 1, true, false, 0, false, false),
    (v_event, 'i1929 hidden tier', 0, NULL, true, 20, 1, true, false, 1, true, false),
    (v_event, 'i1929 disabled tier', 0, NULL, true, 20, 1, true, false, 2, false, true),
    (v_event, 'i1929 offline tier', 0, NULL, true, 20, 1, false, true, 3, false, false),
    (v_event, 'i1929 deleted tier', 0, NULL, true, 20, 1, true, false, 4, false, false);
  UPDATE public.ticket_types SET deleted_at = now()
   WHERE event_id = v_event AND name = 'i1929 deleted tier';
  SELECT public.pg_direct_event_checkout_bundle(v_event, NULL, NULL) INTO v_payload;
  SELECT count(*) INTO v_count FROM json_array_elements(v_payload->'tickets');
  IF v_count <> 3
     OR NOT EXISTS (SELECT 1 FROM json_array_elements(v_payload->'tickets') t WHERE t->>'name' = 'i1929 hidden tier' AND (t->>'isHidden')::boolean)
     OR NOT EXISTS (SELECT 1 FROM json_array_elements(v_payload->'tickets') t WHERE t->>'name' = 'i1929 disabled tier' AND (t->>'isDisabled')::boolean)
     OR EXISTS (SELECT 1 FROM json_array_elements(v_payload->'tickets') t WHERE t->>'name' IN ('i1929 offline tier','i1929 deleted tier')) THEN
    RAISE EXCEPTION 'bundle tier projection failed';
  END IF;
  -- The function itself has SET search_path=''. A non-null point forces its
  -- schema-qualified PostGIS calls to execute (this fixture's CI image is PG17).
  IF (v_payload#>>'{locationGeo,lat}')::double precision <> 6.5244
     OR (v_payload#>>'{locationGeo,lng}')::double precision <> 3.3792
     OR (v_payload#>>'{cityGeo,lat}')::double precision <> 6.45 THEN
    RAISE EXCEPTION 'exact-empty-search-path PostGIS projection failed: %', v_payload;
  END IF;

  -- Checkout matrix. A free public/scheduled session and paid NGN hidden/live
  -- session both persist successfully inside this rollback-only fixture.
  FOREACH v_visibility IN ARRAY ARRAY['public','hidden'] LOOP
    FOREACH v_status IN ARRAY ARRAY['scheduled','live'] LOOP
      v_event := gen_random_uuid();
      v_ids := array_append(v_ids, v_event);
      v_slug := 'i1929-fixture-buy-' || v_visibility || '-' || v_status;
      INSERT INTO public.events (
        id, brand_id, title, slug, event_type, status, visibility, timezone,
        currency, published_at
      ) VALUES (v_event, v_brand, v_slug, v_slug, 'event', v_status, v_visibility,
                'Africa/Lagos', 'NGN', now());
      INSERT INTO public.ticket_types (
        event_id, name, price_cents, currency, is_free, quantity_total,
        min_purchase_qty, available_online, available_in_person, display_order
      ) VALUES (
        v_event, 'i1929 buy tier',
        CASE WHEN v_visibility = 'public' AND v_status = 'scheduled' THEN 0 ELSE 250000 END,
        CASE WHEN v_visibility = 'public' AND v_status = 'scheduled' THEN NULL ELSE 'NGN' END,
        v_visibility = 'public' AND v_status = 'scheduled', 20, 1, true, false, 0
      ) RETURNING id INTO v_ticket;
      v_session := public.biz_ticket_checkout_create_session(
        v_event, NULL, 'Issue 1929', 'i1929@example.com', '+2348012345678', false,
        jsonb_build_array(jsonb_build_object('ticketTypeId', v_ticket, 'quantity', 1)),
        'i1929-fixture-idem-' || v_event, now() + interval '15 minutes', 0, 'auto'
      );
      v_expected := v_visibility = 'public' AND v_status = 'scheduled';
      IF (v_expected AND v_session->>'status' <> 'pending_free')
         OR (NOT v_expected AND (v_session->>'status' <> 'requires_payment'
             OR v_session->>'currency' <> 'NGN' OR (v_session->>'totalCents')::integer <> 250000)) THEN
        RAISE EXCEPTION 'checkout success matrix failed for %/%: %', v_visibility, v_status, v_session;
      END IF;
    END LOOP;
  END LOOP;

  -- Fresh checkout refuses every non-selling state. Deleted differs only in
  -- its canonical error token (event_not_found); all others are not_selling.
  FOREACH v_status IN ARRAY ARRAY['ended','cancelled','draft'] LOOP
    v_event := gen_random_uuid();
    INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1929 denied checkout', 'i1929-fixture-checkout-' || v_status,
            'event', v_status, CASE WHEN v_status = 'draft' THEN 'draft' ELSE 'public' END, 'UTC');
    BEGIN
      PERFORM public.biz_ticket_checkout_create_session(
        v_event, NULL, 'Issue 1929', 'i1929@example.com', '+2348012345678', false,
        jsonb_build_array(jsonb_build_object('ticketTypeId', gen_random_uuid(), 'quantity', 1)),
        'i1929-fixture-denied-' || v_event, now() + interval '15 minutes', 0, 'auto');
      RAISE EXCEPTION 'checkout admitted %', v_status;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'event_not_selling' THEN RAISE EXCEPTION 'checkout % returned %', v_status, SQLERRM; END IF;
    END;
  END LOOP;

  FOREACH v_visibility IN ARRAY ARRAY['private','draft'] LOOP
    v_event := gen_random_uuid();
    INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1929 denied visibility', 'i1929-fixture-vis-' || v_visibility,
            'event', 'scheduled', v_visibility, 'UTC');
    BEGIN
      PERFORM public.biz_ticket_checkout_create_session(
        v_event, NULL, 'Issue 1929', 'i1929@example.com', '+2348012345678', false,
        jsonb_build_array(jsonb_build_object('ticketTypeId', gen_random_uuid(), 'quantity', 1)),
        'i1929-fixture-denied-' || v_event, now() + interval '15 minutes', 0, 'auto');
      RAISE EXCEPTION 'checkout admitted visibility %', v_visibility;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'event_not_selling' THEN RAISE EXCEPTION 'checkout visibility % returned %', v_visibility, SQLERRM; END IF;
    END;
  END LOOP;

  v_event := gen_random_uuid();
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, deleted_at)
  VALUES (v_event, v_brand, 'i1929 checkout deleted', 'i1929-fixture-checkout-deleted',
          'event', 'scheduled', 'public', 'UTC', now());
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      v_event, NULL, 'Issue 1929', 'i1929@example.com', '+2348012345678', false,
      jsonb_build_array(jsonb_build_object('ticketTypeId', gen_random_uuid(), 'quantity', 1)),
      'i1929-fixture-denied-' || v_event, now() + interval '15 minutes', 0, 'auto');
    RAISE EXCEPTION 'checkout admitted deleted event';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_not_found' THEN RAISE EXCEPTION 'deleted checkout returned %', SQLERRM; END IF;
  END;

  RAISE NOTICE '#1929 PASS: bundle parity/denial/tiers + checkout success/denial + free/paid NGN';
END;
$test$;
ROLLBACK;

DO $residue$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE slug LIKE 'i1929-fixture-%')
     OR EXISTS (SELECT 1 FROM public.brands WHERE slug = 'i1929-fixture-brand')
     OR EXISTS (SELECT 1 FROM public.ticket_checkout_sessions WHERE idempotency_key LIKE 'i1929-fixture-%') THEN
    RAISE EXCEPTION '#1929 fixture residue survived rollback';
  END IF;
  RAISE NOTICE '#1929 PASS: zero persistent fixture residue';
END;
$residue$;
