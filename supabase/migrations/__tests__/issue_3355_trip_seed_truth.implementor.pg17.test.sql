-- Issue #3355 P8 — Ari's trip drafts save only facts the owner gave
-- (implementor happy path + edges) for migration
-- 20280302003355_issue_3355_trip_seed_truth.sql.
--
--   * A Lagos trip, 8–10 Jan, Africa/Lagos, with a picked departure and
--     destination, is stored exactly as the Host app stores calendar days:
--     start YYYY-01-08T00:00:00Z, end YYYY-01-10T23:59:59Z (master event_dates
--     row and theme.business_trip), the zone on events.timezone, the places in
--     the wizard's theme keys and canonical columns. Read back with UTC parts
--     (the wizard's calendarDate.ts) it is 8–10 Jan, not 7–9 Jan.
--   * No package is created and there is no capacity default.
--   * No time zone → 'trip_timezone_required' (no UTC default).
--   * A start before today in the trip's zone → 'trip_date_past'.
--   * An end before the start → 'trip_dates_invalid'; no dates →
--     'trip_dates_required'. Nothing is saved on any refusal.
--   * A replayed confirm makes no second trip.
--   * Packages and the refund policy are saved only from the owner's args
--     (manage_trip_tiers, update_trip refund_policy).
--   * The Host create path (biz_create_trip_draft) is unchanged: it still makes
--     the wizard's placeholder package.
--   * ari_create_trip_draft is not callable by anon or authenticated.
--
-- FAILS-ON-REVERT: restore 20280217003355's ari_execute_trip_operation (create
-- through biz_create_trip_draft with local-midnight days, the UTC default and
-- the Standard package) and the happy-path, "no time zone" and "past date"
-- blocks below raise.
-- Every row is synthetic and rolled back.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355tst$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000008a1';
  v_brand uuid := '33550000-0000-4000-8000-0000000008b1';
  v_year int := extract(year FROM now())::int + 1;
  v_op uuid;
  v_args jsonb;
  v_result jsonb;
  v_trip uuid;
  v_event public.events%ROWTYPE;
  v_date public.event_dates%ROWTYPE;
  v_failed boolean;
  v_count integer;
  v_updated timestamptz;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'owner-3355tst@example.invalid');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,country_code,city)
  VALUES (v_brand,v_owner,'Coastline Collective','coastline-3355tst','NGN','NG','Lagos');

  IF has_function_privilege('authenticated','public.ari_create_trip_draft(uuid,jsonb,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.ari_create_trip_draft(uuid,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ari_create_trip_draft must not be callable by anon or authenticated';
  END IF;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  -- ── Happy path: the owner's days, zone and places, nothing else ──────────
  v_op := '33550000-0000-4000-8000-0000000008e1';
  v_args := jsonb_build_object(
    'brand_id',v_brand,'title','Lagos Weekend','timezone','Africa/Lagos',
    'start_date',format('%s-01-08',v_year),'end_date',format('%s-01-10',v_year),
    'departure',jsonb_build_object('label','Abuja, Federal Capital Territory, Nigeria',
      'city','Abuja','country_code','NG','lat',9.0765,'lng',7.3986),
    'destination',jsonb_build_object('label','Lagos, Nigeria',
      'city','Lagos','country_code','NG','lat',6.5244,'lng',3.3792));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_trip',v_args,'executing','hub_experience',v_brand,now(),now());
  v_result := public.ari_execute_trip_operation(v_op,'create_trip',v_args);
  v_trip := (v_result#>>'{event,id}')::uuid;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'happy: no trip id in the result (%)', v_result; END IF;
  SELECT * INTO STRICT v_event FROM public.events WHERE id=v_trip;
  SELECT * INTO STRICT v_date FROM public.event_dates WHERE event_id=v_trip AND is_master;
  IF v_event.event_type <> 'trip' OR v_event.status <> 'draft'
     OR v_event.title <> 'Lagos Weekend' OR v_event.timezone <> 'Africa/Lagos' THEN
    RAISE EXCEPTION 'happy: wrong trip % % % %', v_event.event_type, v_event.status,
      v_event.title, v_event.timezone;
  END IF;
  IF v_date.start_at IS DISTINCT FROM format('%s-01-08T00:00:00Z',v_year)::timestamptz
     OR v_date.end_at IS DISTINCT FROM format('%s-01-10T23:59:59Z',v_year)::timestamptz
     OR v_date.timezone <> 'Africa/Lagos' THEN
    RAISE EXCEPTION 'happy: days not stored like the Host (% – % %)',
      v_date.start_at, v_date.end_at, v_date.timezone;
  END IF;
  -- The wizard reads a stored calendar day with UTC parts (calendarDate.ts).
  IF to_char(v_date.start_at AT TIME ZONE 'UTC','YYYY-MM-DD') <> format('%s-01-08',v_year)
     OR to_char(v_date.end_at AT TIME ZONE 'UTC','YYYY-MM-DD') <> format('%s-01-10',v_year) THEN
    RAISE EXCEPTION 'happy: the wizard would open this trip on other days';
  END IF;
  IF v_event.theme#>>'{business_trip,startAt}' <> format('%s-01-08T00:00:00.000Z',v_year)
     OR v_event.theme#>>'{business_trip,endAt}' <> format('%s-01-10T23:59:59.000Z',v_year) THEN
    RAISE EXCEPTION 'happy: theme days differ from the Host encoding (%)', v_event.theme->'business_trip';
  END IF;
  IF v_event.destination_text <> 'Lagos, Nigeria'
     OR v_event.departure_text <> 'Abuja, Federal Capital Territory, Nigeria'
     OR (v_event.theme#>>'{business_trip,destinationLat}')::numeric <> 6.5244
     OR (v_event.theme#>>'{business_trip,departureLng}')::numeric <> 7.3986
     OR v_event.theme#>>'{business_trip,destinationCity}' <> 'Lagos'
     OR v_event.theme#>>'{business_trip,departureCountryCode}' <> 'NG' THEN
    RAISE EXCEPTION 'happy: the picked places were not saved exactly (% / % / %)',
      v_event.destination_text, v_event.departure_text, v_event.theme->'business_trip';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id=v_trip)
     OR EXISTS (SELECT 1 FROM public.trip_pricing_tiers WHERE event_id=v_trip) THEN
    RAISE EXCEPTION 'happy: a package was created that the owner never gave';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trip_days WHERE event_id=v_trip) THEN
    RAISE EXCEPTION 'happy: an itinerary was invented';
  END IF;
  -- A retried confirm replays; it never makes a second trip.
  v_result := public.ari_execute_trip_operation(v_op,'create_trip',v_args);
  SELECT count(*) INTO v_count FROM public.events
  WHERE brand_id=v_brand AND title='Lagos Weekend' AND deleted_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'happy: expected one trip, got %', v_count; END IF;

  -- ── A package and refund policy: only the owner's values ─────────────────
  SELECT updated_at INTO v_updated FROM public.events WHERE id=v_trip;
  v_op := '33550000-0000-4000-8000-0000000008e2';
  v_args := jsonb_build_object('event_id',v_trip,'expected_updated_at',v_updated,
    'items',jsonb_build_array(jsonb_build_object('tier_name','Shared room',
      'price_cents',25000000,'capacity',12,'display_order',0,'tier_metadata','{}'::jsonb)));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'manage_trip_tiers',v_args,'executing','hub_experience',v_brand,now(),now());
  PERFORM public.ari_execute_trip_operation(v_op,'manage_trip_tiers',v_args);
  IF (SELECT count(*) FROM public.ticket_types WHERE event_id=v_trip AND deleted_at IS NULL) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id=v_trip
       AND name='Shared room' AND price_cents=25000000 AND quantity_total=12
       AND currency='NGN' AND is_free=false) THEN
    RAISE EXCEPTION 'package: not saved exactly as given';
  END IF;

  SELECT updated_at INTO v_updated FROM public.events WHERE id=v_trip;
  v_op := '33550000-0000-4000-8000-0000000008e3';
  v_args := jsonb_build_object('event_id',v_trip,'expected_updated_at',v_updated,
    'refund_policy',jsonb_build_object('kind','standard','tiers',jsonb_build_array(
      jsonb_build_object('days_before_start',60,'refund_pct',100),
      jsonb_build_object('days_before_start',30,'refund_pct',50),
      jsonb_build_object('days_before_start',0,'refund_pct',0))));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'update_trip',v_args,'executing','hub_experience',v_brand,now(),now());
  PERFORM public.ari_execute_trip_operation(v_op,'update_trip',v_args);
  IF (SELECT refund_policy->>'kind' FROM public.events WHERE id=v_trip) IS DISTINCT FROM 'standard' THEN
    RAISE EXCEPTION 'refund policy: not saved';
  END IF;

  -- ── No time zone: refused (no UTC default), nothing saved ────────────────
  v_op := '33550000-0000-4000-8000-0000000008e4';
  v_args := jsonb_build_object('brand_id',v_brand,'title','No Zone Trip',
    'start_date',format('%s-01-08',v_year),'end_date',format('%s-01-10',v_year));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_trip',v_args,'executing','hub_experience',v_brand,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_trip_operation(v_op,'create_trip',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%trip_timezone_required%';
    IF NOT v_failed THEN RAISE EXCEPTION 'no zone: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'no zone: a trip was saved without a time zone'; END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE brand_id=v_brand AND title='No Zone Trip') THEN
    RAISE EXCEPTION 'no zone: a trip was saved';
  END IF;

  -- ── A past start: refused ────────────────────────────────────────────────
  v_op := '33550000-0000-4000-8000-0000000008e5';
  v_args := jsonb_build_object('brand_id',v_brand,'title','Past Trip','timezone','Africa/Lagos',
    'start_date',to_char((now() AT TIME ZONE 'Africa/Lagos')::date - 1,'YYYY-MM-DD'),
    'end_date',to_char((now() AT TIME ZONE 'Africa/Lagos')::date + 1,'YYYY-MM-DD'));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_trip',v_args,'executing','hub_experience',v_brand,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_trip_operation(v_op,'create_trip',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%trip_date_past%';
    IF NOT v_failed THEN RAISE EXCEPTION 'past: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'past: a trip starting yesterday was saved'; END IF;

  -- ── End before start, and no dates: refused ──────────────────────────────
  v_op := '33550000-0000-4000-8000-0000000008e6';
  v_args := jsonb_build_object('brand_id',v_brand,'title','Backwards Trip','timezone','Africa/Lagos',
    'start_date',format('%s-01-10',v_year),'end_date',format('%s-01-08',v_year));
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_trip',v_args,'executing','hub_experience',v_brand,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_trip_operation(v_op,'create_trip',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%trip_dates_invalid%';
    IF NOT v_failed THEN RAISE EXCEPTION 'backwards: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'backwards: an end before the start was saved'; END IF;

  v_op := '33550000-0000-4000-8000-0000000008e7';
  v_args := jsonb_build_object('brand_id',v_brand,'title','Dateless Trip','timezone','Africa/Lagos');
  INSERT INTO public.agent_pending_actions(id,user_id,tool_name,tool_args,status,source,
    related_brand_id,server_proposed_at,execution_attested_at)
  VALUES (v_op,v_owner,'create_trip',v_args,'executing','hub_experience',v_brand,now(),now());
  v_failed := false;
  BEGIN
    PERFORM public.ari_execute_trip_operation(v_op,'create_trip',v_args);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%trip_dates_required%';
    IF NOT v_failed THEN RAISE EXCEPTION 'dateless: refused for the wrong reason: %', SQLERRM; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'dateless: a trip without dates was saved'; END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE brand_id=v_brand
    AND title IN ('Past Trip','Backwards Trip','Dateless Trip')) THEN
    RAISE EXCEPTION 'refusals: a trip was saved';
  END IF;

  -- ── The Host create path is unchanged (placeholder package kept) ─────────
  v_result := public.biz_create_trip_draft(v_brand,jsonb_build_object('title','Host Trip'),
    '33550000-0000-4000-8000-0000000008f1');
  v_trip := (v_result#>>'{event,id}')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id=v_trip
       AND name='Standard' AND price_cents=0 AND quantity_total=1)
     OR NOT EXISTS (SELECT 1 FROM public.trip_pricing_tiers WHERE event_id=v_trip
       AND tier_name='Standard') THEN
    RAISE EXCEPTION 'host: the wizard placeholder package is gone';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.biz_create_trip_draft(v_brand,
      jsonb_build_object('title','Host Seed','start_date','2099-01-01'),
      '33550000-0000-4000-8000-0000000008f2');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%trip_seed_invalid%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'host: biz_create_trip_draft must keep its #1971 seed keys';
  END IF;
END
$i3355tst$;

ROLLBACK;
