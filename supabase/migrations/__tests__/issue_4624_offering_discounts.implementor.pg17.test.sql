-- MINGLA-INVARIANT: INV-4624-1 | issue #4624 | An offering-scoped discount is resolved at quote time from the line's listingId; saving one never writes ticket_type or menu_item targets.
-- MINGLA-INVARIANT: INV-4624-2 | issue #4624 | A listings discount only ever holds event, venue_menu or venue_deposit targets (guard raises listings_target_invalid).
-- MINGLA-INVARIANT: INV-4624-3 | issue #4624 | A ticket with Allow discounts off, or a free ticket, is never discounted by an offering scope.
-- Issue #4624: "Specific offerings" discounts, on the fully replayed PostgreSQL 17
-- schema with 20281206004624_issue_4624_offering_discounts.sql applied.
--   T1 guard: a ticket_type target under scope 'listings' is refused, through the
--      Host writer and directly; whole-offering targets save.
--   T2 end to end: issue_3872_ticket_quote with an automatic and a code discount
--      on event E1. A ticket type inserted after the discount is covered; Allow
--      discounts off and free tickets are skipped; event E2 is left alone.
--   T3 the same for an experience and a trip.
--   T4 brand_discount_offerings: rank 20 sees events, experiences and trips only
--      (no RSVP, no deleted); an outsider sees nothing.
--   T5 brand_discount_preview with scope 'listings' prices only the chosen
--      offerings' tickets and names the offering on every row.
--   T6 D3: soft-deleting E1 marks target_deleted and pauses the discount;
--      re-saving without E1 clears it and the discount applies to X again.
--   T7 D2: brand_prices_overview lists tickets of a scheduled event and lists
--      each menu item once when the brand has two venues.
-- FAILS-ON-REVERT: without the migration T1 (no guard), T4 (no RPC), T5 (other
-- offerings' tickets, no listingName) and T7 (no tickets, duplicate menu rows) fail.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000001';
  v_member uuid := '46240000-0000-4000-8000-000000000002';
  v_outsider uuid := '46240000-0000-4000-8000-000000000003';
  v_brand uuid := '46240000-0000-4000-8100-000000000001';
  v_e1 uuid := '46240000-0000-4000-8200-000000000001';
  v_e2 uuid := '46240000-0000-4000-8200-000000000002';
  v_x uuid := '46240000-0000-4000-8200-000000000003';
  v_t uuid := '46240000-0000-4000-8200-000000000004';
  v_rsvp uuid := '46240000-0000-4000-8200-000000000005';
  v_gone uuid := '46240000-0000-4000-8200-000000000006';
  v_e1_paid uuid := '46240000-0000-4000-8300-000000000001';
  v_e1_off uuid := '46240000-0000-4000-8300-000000000002';
  v_e1_free uuid := '46240000-0000-4000-8300-000000000003';
  v_e1_late uuid := '46240000-0000-4000-8300-000000000004';
  v_e2_paid uuid := '46240000-0000-4000-8300-000000000005';
  v_x_paid uuid := '46240000-0000-4000-8300-000000000006';
  v_t_paid uuid := '46240000-0000-4000-8300-000000000007';
  v_v1 uuid := '46240000-0000-4000-8400-000000000001';
  v_v2 uuid := '46240000-0000-4000-8400-000000000002';
  v_m1 uuid := '46240000-0000-4000-8400-000000000011';
  v_m2 uuid := '46240000-0000-4000-8400-000000000012';
  v_auto jsonb;
  v_code jsonb;
  v_q jsonb;
  v_rows jsonb;
  v_err text;
  v_n integer;
BEGIN
  -- Fixtures -------------------------------------------------------------------
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'issue4624-owner@example.test'),
    (v_member,'issue4624-member@example.test'),
    (v_outsider,'issue4624-outsider@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 brand','issue-4624-brand','USD','stripe','US','US','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,invited_at)
    VALUES(v_brand,v_member,'marketing_manager',now(),now());
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES
    (v_e1,v_brand,v_owner,'Rooftop Night','issue-4624-e1','event','scheduled','public','UTC','USD'),
    (v_e2,v_brand,v_owner,'Pier Disco','issue-4624-e2','event','scheduled','public','UTC','USD'),
    (v_x,v_brand,v_owner,'Pottery Workshop','issue-4624-x','experience','scheduled','public','UTC','USD'),
    (v_t,v_brand,v_owner,'Coastal Weekend','issue-4624-t','trip','scheduled','public','UTC','USD'),
    (v_rsvp,v_brand,v_owner,'Free Meetup','issue-4624-rsvp','rsvp','scheduled','public','UTC','USD'),
    (v_gone,v_brand,v_owner,'Old Party','issue-4624-gone','event','draft','draft','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_e1,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true),
    (v_e2,now()+interval '4 days',now()+interval '4 days 2 hours','UTC',true),
    (v_x,now()+interval '5 days',now()+interval '5 days 2 hours','UTC',true),
    (v_t,now()+interval '6 days',now()+interval '8 days','UTC',true),
    (v_rsvp,now()+interval '6 days',now()+interval '6 days 2 hours','UTC',true);
  UPDATE public.events SET deleted_at=now() WHERE id=v_gone;
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES
    (v_e1_paid,v_e1,'General',1000,'USD',false,100,false,1,10,true,false,true),
    (v_e1_off,v_e1,'Members',1000,'USD',false,100,false,1,10,true,false,false),
    (v_e1_free,v_e1,'Guest list',0,'USD',true,100,false,1,10,true,false,true),
    (v_e2_paid,v_e2,'Standard',1000,'USD',false,100,false,1,10,true,false,true),
    (v_x_paid,v_x,'Seat',4000,'USD',false,100,false,1,10,true,false,true),
    (v_t_paid,v_t,'Shared room',30000,'USD',false,100,false,1,10,true,false,true);

  -- T1 guard -------------------------------------------------------------------
  v_err := 'saved';
  BEGIN
    PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code','BADSCOPE','name','Bad scope',
      'valueType','percent','valueBps',1000,'scopeKind','listings',
      'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_e1_paid))));
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'listings_target_invalid' THEN
    RAISE EXCEPTION 'T1 writer under scope listings with a ticket_type target: want listings_target_invalid, got %',v_err;
  END IF;
  IF EXISTS(SELECT 1 FROM public.brand_discounts WHERE brand_id=v_brand AND code='BADSCOPE') THEN
    RAISE EXCEPTION 'T1 refused write left a discount row';
  END IF;

  -- T2 automatic + code on E1 (and X, T for T3) --------------------------------
  v_auto := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Offerings ten','valueType','percent',
    'valueBps',1000,'scopeKind','listings','combinesWith','none',
    'targets',jsonb_build_array(
      jsonb_build_object('targetKind','event','targetId',v_e1),
      jsonb_build_object('targetKind','event','targetId',v_x),
      jsonb_build_object('targetKind','event','targetId',v_t))));
  v_code := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','ROOF20','name','Roof twenty','valueType','percent',
    'valueBps',2000,'scopeKind','listings','combinesWith','none',
    'targets',jsonb_build_array(jsonb_build_object('targetKind','event','targetId',v_e1))));

  -- INV-4624-1: only whole-offering targets were written.
  IF EXISTS(SELECT 1 FROM public.brand_discount_targets
            WHERE discount_id IN ((v_auto->>'id')::uuid,(v_code->>'id')::uuid)
              AND target_kind<>'event') THEN
    RAISE EXCEPTION 'T2 an offering-scoped save wrote item targets';
  END IF;
  SELECT count(*) INTO v_n FROM public.brand_discount_targets WHERE discount_id=(v_auto->>'id')::uuid;
  IF v_n<>3 THEN RAISE EXCEPTION 'T2 automatic saved % targets, expected 3',v_n; END IF;

  -- A ticket type the discount has never seen.
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person
  ) VALUES(v_e1_late,v_e1,'Late VIP',2000,'USD',false,100,false,1,10,true,false);

  v_q := public.issue_3872_ticket_quote(v_e1,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_e1_paid,'quantity',1),
      jsonb_build_object('ticketTypeId',v_e1_late,'quantity',1),
      jsonb_build_object('ticketTypeId',v_e1_off,'quantity',1),
      jsonb_build_object('ticketTypeId',v_e1_free,'quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'t2-auto@example.test','+15555554601',NULL,NULL,false);
  SELECT jsonb_object_agg(l->>'ticketTypeId',(l->>'netUnitCents')::integer) INTO v_rows
  FROM jsonb_array_elements(v_q->'lines') l;
  IF (v_rows->>v_e1_paid::text)::integer<>900
     OR (v_rows->>v_e1_late::text)::integer<>1800
     OR (v_rows->>v_e1_off::text)::integer<>1000
     OR (v_rows->>v_e1_free::text)::integer<>0 THEN
    RAISE EXCEPTION 'T2 automatic quote on E1 wrong (want 900/1800/1000/0): %',v_q;
  END IF;

  v_q := public.issue_3872_ticket_quote(v_e1,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_e1_late,'quantity',1),
      jsonb_build_object('ticketTypeId',v_e1_off,'quantity',1)),
    NULL,NULL,NULL,NULL,'full','ROOF20','t2-code@example.test','+15555554602',NULL,NULL,false);
  SELECT jsonb_object_agg(l->>'ticketTypeId',(l->>'netUnitCents')::integer) INTO v_rows
  FROM jsonb_array_elements(v_q->'lines') l;
  IF v_q#>>'{codeOutcome,status}'<>'applied'
     OR (v_rows->>v_e1_late::text)::integer<>1600
     OR (v_rows->>v_e1_off::text)::integer<>1000 THEN
    RAISE EXCEPTION 'T2 code quote on E1 wrong (want applied, 1600/1000): %',v_q;
  END IF;

  v_q := public.issue_3872_ticket_quote(v_e2,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_e2_paid,'quantity',1)),
    NULL,NULL,NULL,NULL,'full','ROOF20','t2-e2@example.test','+15555554603',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer<>1000
     OR v_q#>>'{codeOutcome,status}'<>'rejected'
     OR v_q#>>'{codeOutcome,reason}'<>'not_applicable' THEN
    RAISE EXCEPTION 'T2 E2 was discounted or the code was not refused: %',v_q;
  END IF;

  -- T3 experience and trip ------------------------------------------------------
  v_q := public.issue_3872_ticket_quote(v_x,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_x_paid,'quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'t3-x@example.test','+15555554604',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer<>3600 THEN
    RAISE EXCEPTION 'T3 experience not discounted (want 3600): %',v_q;
  END IF;
  v_q := public.issue_3872_ticket_quote(v_t,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_t_paid,'quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'t3-t@example.test','+15555554605',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer<>27000 THEN
    RAISE EXCEPTION 'T3 trip not discounted (want 27000): %',v_q;
  END IF;

  -- T4 offerings list -----------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_member,'role','authenticated')::text,true);
  SELECT jsonb_agg(o) INTO v_rows FROM public.brand_discount_offerings(v_brand) o;
  IF jsonb_array_length(COALESCE(v_rows,'[]'::jsonb))<>4 THEN
    RAISE EXCEPTION 'T4 expected 4 offerings (no RSVP, no deleted), got %',v_rows;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) o
            WHERE (o->>'id')::uuid IN (v_rsvp,v_gone)
               OR o->>'offeringKind' NOT IN ('event','experience','trip')) THEN
    RAISE EXCEPTION 'T4 RSVP or deleted offering listed: %',v_rows;
  END IF;
  SELECT o INTO v_q FROM jsonb_array_elements(v_rows) o WHERE (o->>'id')::uuid=v_e1;
  IF (v_q->>'paidTicketCount')::integer<>3 OR v_q->>'title'<>'Rooftop Night'
     OR v_q->>'status'<>'scheduled' OR (v_q->>'discountsAllowed')::boolean IS NOT TRUE
     OR v_q->>'nextStartAt' IS NULL OR v_q->>'lastEndAt' IS NULL THEN
    RAISE EXCEPTION 'T4 E1 row wrong (want 3 paid tickets, dates): %',v_q;
  END IF;
  IF v_rows->0->>'offeringKind'<>'event' OR v_rows->3->>'offeringKind'<>'trip' THEN
    RAISE EXCEPTION 'T4 not ordered by kind: %',v_rows;
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_outsider,'role','authenticated')::text,true);
  SELECT count(*) INTO v_n FROM public.brand_discount_offerings(v_brand);
  IF v_n<>0 THEN RAISE EXCEPTION 'T4 outsider saw % offerings',v_n; END IF;

  -- T5 preview ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_member::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_member,'role','authenticated')::text,true);
  v_rows := public.brand_discount_preview(v_brand,jsonb_build_object(
    'brandId',v_brand,'kind','code','code','PREVIEW1','name','Preview','valueType','percent',
    'valueBps',1000,'scopeKind','listings','combinesWith','automatic_only',
    'targets',jsonb_build_array(jsonb_build_object('targetKind','event','targetId',v_x))));
  IF jsonb_array_length(v_rows)<>1 OR v_rows->0->>'itemName'<>'Seat'
     OR v_rows->0->>'listingName'<>'Pottery Workshop'
     OR (v_rows->0->>'netUnitMinor')::integer<>3600 THEN
    RAISE EXCEPTION 'T5 listings preview must price only X tickets with listingName: %',v_rows;
  END IF;
  v_rows := public.brand_discount_preview(v_brand,jsonb_build_object(
    'brandId',v_brand,'kind','code','code','PREVIEW2','name','Preview','valueType','percent',
    'valueBps',1000,'scopeKind','brand','combinesWith','automatic_only','targets','[]'::jsonb));
  IF jsonb_array_length(v_rows)<>5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'listingName' IS NULL) THEN
    RAISE EXCEPTION 'T5 brand preview changed (want first 5 paid tickets, each named): %',v_rows;
  END IF;

  -- T6 deleted offering pauses the discount (D3), re-save clears it -------------
  UPDATE public.events SET deleted_at=now() WHERE id=v_e1;
  IF (SELECT needs_attention FROM public.brand_discounts WHERE id=(v_auto->>'id')::uuid)
       IS DISTINCT FROM 'target_deleted' THEN
    RAISE EXCEPTION 'T6 deleting E1 did not mark target_deleted';
  END IF;
  v_q := public.issue_3872_ticket_quote(v_x,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_x_paid,'quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'t6-x@example.test','+15555554606',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer<>4000 THEN
    RAISE EXCEPTION 'T6 a discount needing attention still applied to X: %',v_q;
  END IF;
  v_auto := public.issue_3872_upsert_discount(v_owner,'update',jsonb_build_object(
    'id',v_auto->>'id','version',(SELECT version FROM public.brand_discounts WHERE id=(v_auto->>'id')::uuid),
    'scopeKind','listings',
    'targets',jsonb_build_array(
      jsonb_build_object('targetKind','event','targetId',v_x),
      jsonb_build_object('targetKind','event','targetId',v_t))));
  IF v_auto->>'needs_attention' IS NOT NULL THEN
    RAISE EXCEPTION 'T6 re-save did not clear needs_attention: %',v_auto;
  END IF;
  v_q := public.issue_3872_ticket_quote(v_x,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_x_paid,'quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'t6-x2@example.test','+15555554607',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer<>3600 THEN
    RAISE EXCEPTION 'T6 re-saved discount does not apply to X again: %',v_q;
  END IF;

  -- T7 D2 prices overview -------------------------------------------------------
  SELECT jsonb_agg(p) INTO v_rows FROM public.brand_prices_overview(v_brand) p;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) p
                WHERE p->>'kind'='ticket_type' AND (p->>'id')::uuid=v_e2_paid) THEN
    RAISE EXCEPTION 'T7 scheduled event ticket missing from the prices overview: %',v_rows;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) p
            WHERE p->>'kind'='ticket_type' AND (p->>'id')::uuid IN (v_e1_paid,v_e1_free)) THEN
    RAISE EXCEPTION 'T7 deleted event or free ticket listed: %',v_rows;
  END IF;

  INSERT INTO public.venue_listings(id,brand_id,slug,name,lat,lng,venue_category,claim_status) VALUES
    (v_v1,v_brand,'issue4624v1','Venue One',51.5,-0.1,'restaurant','pending_review'),
    (v_v2,v_brand,'issue4624v2','Venue Two',51.6,-0.2,'restaurant','pending_review');
  INSERT INTO public.menus(id,brand_id,venue_id,name) VALUES
    (v_m1,v_brand,v_v1,'Menu One'),(v_m2,v_brand,v_v2,'Menu Two');
  INSERT INTO public.menu_items(brand_id,menu_id,name,price_cents,currency) VALUES
    (v_brand,v_m1,'Jollof',1500,'USD'),(v_brand,v_m2,'Suya',1200,'USD');
  SELECT jsonb_agg(p) INTO v_rows FROM public.brand_prices_overview(v_brand) p WHERE p->>'kind'='menu_item';
  IF jsonb_array_length(COALESCE(v_rows,'[]'::jsonb))<>2 THEN
    RAISE EXCEPTION 'T7 two venues must list each menu item once, got %',v_rows;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) p
                WHERE p->>'itemName'='Jollof' AND p->>'ownerRoute'='/venue/'||v_v1::text||'?module=menu')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) p
                WHERE p->>'itemName'='Suya' AND p->>'ownerRoute'='/venue/'||v_v2::text||'?module=menu') THEN
    RAISE EXCEPTION 'T7 menu item not routed to its own venue: %',v_rows;
  END IF;

  RAISE NOTICE 'issue_4624_offering_discounts: PASS (T1-T7)';
END
$test$;

ROLLBACK;
