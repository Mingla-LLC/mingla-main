-- #2829 W5 (amendment A1.3) — historical trips imported as ended Mingla trips
-- (pg17, BEGIN ... ROLLBACK). Apply every migration through
-- 20271229002829_issue_2829_historical_trip_import.sql first, then run with
-- ON_ERROR_STOP=1. Every fixture rolls back. Neutral fixtures only.
--
-- Proves: only the service role can import; an import creates a PUBLIC,
-- ENDED trip with its real past dates (local calendar days in the trip's own
-- timezone), no ticket types and no price, that Mingla's public readers and
-- the site feed list for that brand only; re-importing a record returns the
-- same trip; a trip ending today or later in its own timezone is refused (the
-- date line included); bad input is refused with a reason; normal trip
-- publishing keeps refusing past dates (the publish RPC is untouched).

\set ON_ERROR_STOP on
BEGIN;

DO $w5$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand_a uuid := gen_random_uuid();
  v_brand_b uuid := gen_random_uuid();
  v_brand_gone uuid := gen_random_uuid();
  v_site_a uuid := gen_random_uuid();
  v_site_b uuid := gen_random_uuid();
  v_result jsonb;
  v_again jsonb;
  v_trip uuid;
  v_row record;
  v_failed boolean;
  v_message text;
  v_feed jsonb;
  v_count integer;
  v_kiritimati_today date := (now() AT TIME ZONE 'Pacific/Kiritimati')::date;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'w5-owner@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, deleted_at) VALUES
    (v_brand_a, v_owner, 'W5 Brand A', 'w5-brand-a', 'USD', NULL),
    (v_brand_b, v_owner, 'W5 Brand B', 'w5-brand-b', NULL, NULL),
    (v_brand_gone, v_owner, 'W5 Gone', 'w5-gone', 'USD', now());
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    (v_site_a, v_brand_a, 'provisioning', v_owner),
    (v_site_b, v_brand_b, 'provisioning', v_owner);

  -- 1. Nobody but the service role can call it or read the provenance.
  IF has_function_privilege('anon', 'public.brand_site_import_historical_trip(uuid,text,text,date,date,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.brand_site_import_historical_trip(uuid,text,text,date,date,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon or authenticated may import historical trips';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.brand_site_import_historical_trip(uuid,text,text,date,date,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role cannot import historical trips';
  END IF;
  IF has_table_privilege('authenticated', 'public.brand_site_historical_trip_imports', 'SELECT')
     OR has_table_privilege('anon', 'public.brand_site_historical_trip_imports', 'SELECT') THEN
    RAISE EXCEPTION 'import provenance is readable by the public';
  END IF;

  -- 2. A trip from 2023, departure day only, in its own timezone.
  v_result := public.brand_site_import_historical_trip(
    v_brand_a, 'fixture:ski-1', 'Mountain Ski Weekend', DATE '2023-01-14', NULL,
    'America/New_York', 'Mountain Town, NC', NULL, 'Neutral test fixture');
  IF v_result->>'status' <> 'created' THEN RAISE EXCEPTION 'import did not create: %', v_result; END IF;
  v_trip := (v_result->>'event_id')::uuid;
  SELECT e.status, e.visibility, e.event_type, e.slug, e.destination_text, e.currency, e.deleted_at,
         d.start_at, d.end_at, d.timezone, d.is_master
    INTO v_row
    FROM public.events e JOIN public.event_dates d ON d.event_id = e.id
   WHERE e.id = v_trip;
  IF v_row.status <> 'ended' OR v_row.visibility <> 'public' OR v_row.event_type <> 'trip' OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'imported trip is not a public ended trip: %', row_to_json(v_row);
  END IF;
  IF v_row.start_at <> TIMESTAMPTZ '2023-01-14 00:00:00 America/New_York'
     OR v_row.end_at <> TIMESTAMPTZ '2023-01-14 23:59:00 America/New_York'
     OR v_row.timezone <> 'America/New_York' OR NOT v_row.is_master THEN
    RAISE EXCEPTION 'imported trip dates are not its local calendar day: %', row_to_json(v_row);
  END IF;
  IF v_row.slug <> 'mountain-ski-weekend-2023' OR v_row.destination_text <> 'Mountain Town, NC' THEN
    RAISE EXCEPTION 'imported trip slug/place wrong: %', row_to_json(v_row);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_trip)
     OR EXISTS (SELECT 1 FROM public.trip_pricing_tiers WHERE event_id = v_trip) THEN
    RAISE EXCEPTION 'imported trip can be sold';
  END IF;
  IF current_setting('mingla.publish_free_only', true) IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION 'the free-only publish flag leaked out of the import';
  END IF;

  -- A multi-day trip.
  v_result := public.brand_site_import_historical_trip(
    v_brand_a, 'fixture:coast-1', 'Coast Week', DATE '2024-06-20', DATE '2024-06-27',
    'Europe/Tirane', 'Coastal town', 'A week by the sea.', 'Neutral test fixture');
  SELECT d.start_at, d.end_at INTO v_row FROM public.event_dates d WHERE d.event_id = (v_result->>'event_id')::uuid;
  IF v_row.start_at <> TIMESTAMPTZ '2024-06-20 00:00:00 Europe/Tirane' OR v_row.end_at <> TIMESTAMPTZ '2024-06-27 23:59:00 Europe/Tirane' THEN
    RAISE EXCEPTION 'multi-day import dates wrong: %', row_to_json(v_row);
  END IF;

  -- 3. The same record again: the same trip, no duplicate.
  v_again := public.brand_site_import_historical_trip(
    v_brand_a, 'fixture:ski-1', 'Mountain Ski Weekend', DATE '2023-01-14', NULL,
    'America/New_York', 'Mountain Town, NC', NULL, 'Neutral test fixture');
  IF v_again->>'status' <> 'existing' OR (v_again->>'event_id')::uuid <> v_trip THEN
    RAISE EXCEPTION 'reimport was not idempotent: %', v_again;
  END IF;
  SELECT count(*) INTO v_count FROM public.events WHERE brand_id = v_brand_a AND title = 'Mountain Ski Weekend';
  IF v_count <> 1 THEN RAISE EXCEPTION 'reimport duplicated the trip (%)', v_count; END IF;

  -- The same title another week gets its own address.
  v_result := public.brand_site_import_historical_trip(
    v_brand_a, 'fixture:ski-2', 'Mountain Ski Weekend', DATE '2023-01-21', NULL,
    'America/New_York', 'Mountain Town, NC', NULL, 'Neutral test fixture');
  IF v_result->>'slug' <> 'mountain-ski-weekend-2023-2' THEN RAISE EXCEPTION 'second departure slug wrong: %', v_result; END IF;

  -- A brand with no currency yet can still hold its history (no money moves).
  v_result := public.brand_site_import_historical_trip(
    v_brand_b, 'fixture:b-1', 'Brand B Trip', DATE '2022-09-01', DATE '2022-09-05',
    'Europe/London', 'Somewhere', NULL, 'Neutral test fixture');
  IF v_result->>'status' <> 'created' THEN RAISE EXCEPTION 'currency-less brand import failed: %', v_result; END IF;

  -- 4. Mingla's public readers and the site feed list it, for its own brand only.
  IF NOT EXISTS (SELECT 1 FROM public.pg_public_trips_by_brand('w5-brand-a') t WHERE t.trip_id = v_trip AND t.status = 'ended') THEN
    RAISE EXCEPTION 'imported trip missing from the brand''s public trips';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pg_public_trip_by_slug('w5-brand-a', 'mountain-ski-weekend-2023')) THEN
    RAISE EXCEPTION 'imported trip has no public trip page';
  END IF;
  v_feed := public.brand_site_offerings_feed(v_site_a);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_feed->'offerings') o
    WHERE o->>'id' = v_trip::text AND o->>'status' = 'ended' AND o->>'kind' = 'trip'
      AND o->'min_price_minor' = 'null'::jsonb AND o->>'destination_text' = 'Mountain Town, NC'
  ) THEN
    RAISE EXCEPTION 'imported trip missing from the site feed: %', v_feed;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site_b)->'offerings') o WHERE o->>'id' = v_trip::text) THEN
    RAISE EXCEPTION 'another brand''s site lists the imported trip';
  END IF;

  -- 5. Only finished trips, in the trip's own timezone.
  BEGIN
    PERFORM public.brand_site_import_historical_trip(v_brand_a, 'fixture:future', 'Future Trip', (now() + interval '30 days')::date, NULL,
      'Europe/London', NULL, NULL, 'Neutral test fixture');
    v_failed := false;
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'historical_trip_not_ended';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a future trip was imported as history'; END IF;
  -- Ends today across the date line: yesterday in UTC can still be today in Kiritimati.
  BEGIN
    PERFORM public.brand_site_import_historical_trip(v_brand_a, 'fixture:dateline', 'Date Line Trip', v_kiritimati_today - 2, v_kiritimati_today,
      'Pacific/Kiritimati', NULL, NULL, 'Neutral test fixture');
    v_failed := false;
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'historical_trip_not_ended';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a trip ending today in its own timezone was imported as history'; END IF;
  -- Ended yesterday in its own timezone: history.
  v_result := public.brand_site_import_historical_trip(v_brand_a, 'fixture:yesterday', 'Yesterday Trip', v_kiritimati_today - 3, v_kiritimati_today - 1,
    'Pacific/Kiritimati', NULL, NULL, 'Neutral test fixture');
  IF v_result->>'status' <> 'created' THEN RAISE EXCEPTION 'a trip that ended yesterday was refused'; END IF;

  -- 6. Bad input is refused with a reason.
  FOR v_message IN SELECT unnest(ARRAY['import_key','title','dates','timezone','source_note']) LOOP
    BEGIN
      PERFORM public.brand_site_import_historical_trip(
        v_brand_a,
        CASE WHEN v_message = 'import_key' THEN 'Bad Key!' ELSE 'fixture:bad-' || v_message END,
        CASE WHEN v_message = 'title' THEN '   ' ELSE 'Bad' END,
        DATE '2023-05-10',
        CASE WHEN v_message = 'dates' THEN DATE '2023-05-01' ELSE NULL END,
        CASE WHEN v_message = 'timezone' THEN 'Mars/Olympus' ELSE 'Europe/London' END,
        NULL, NULL,
        CASE WHEN v_message = 'source_note' THEN '' ELSE 'Neutral test fixture' END);
      v_failed := false;
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'historical_trip_invalid';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'bad % was accepted', v_message; END IF;
  END LOOP;
  BEGIN
    PERFORM public.brand_site_import_historical_trip(v_brand_gone, 'fixture:gone', 'Gone', DATE '2023-05-10', NULL,
      'Europe/London', NULL, NULL, 'Neutral test fixture');
    v_failed := false;
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'brand_not_found';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a deleted brand received an imported trip'; END IF;

  -- 7. Normal trip publishing still refuses a date that has passed.
  IF position('offering_date_past' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.business_publish_trip_draft(uuid,jsonb,integer)'::regprocedure)) = 0
     OR position('IF v_end <= v_now THEN' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.business_publish_trip_draft(uuid,jsonb,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the trip publish RPC no longer refuses past dates';
  END IF;
  IF position('brand_site_historical_trip' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.business_publish_trip_draft(uuid,jsonb,integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'the trip publish RPC learned about historical imports';
  END IF;

  SELECT count(*) INTO v_count FROM public.brand_site_historical_trip_imports WHERE brand_id = v_brand_a;
  IF v_count <> 4 THEN RAISE EXCEPTION 'provenance rows wrong: %', v_count; END IF;

  RAISE NOTICE 'ISSUE_2829_W5_HISTORICAL_TRIPS_OK';
END
$w5$;

ROLLBACK;
