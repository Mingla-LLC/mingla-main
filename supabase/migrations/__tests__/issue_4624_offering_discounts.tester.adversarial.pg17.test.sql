-- MINGLA-INVARIANT: INV-4624-4 | issue #4624 | An offering-scoped ('listings') discount prices exactly like the same discount written as per-ticket ('items') targets, never reaches another offering or another brand, and is readable only by brand members of rank 20 or above.
-- Issue #4624 tester adversarial suite (independent of the implementor's T1-T7).
-- Angles the implementor's suite does not take:
--   A1 guard matrix: every non-whole-offering kind (ticket_type, menu_item,
--      listing_kind) and a MIXED payload (event + ticket_type) is refused under
--      'listings'; a refused update leaves the old targets intact; a raw INSERT
--      and a raw UPDATE of a target row are refused by the trigger itself;
--      RSVP and other-brand events are refused by the writer.
--   A2 money: offering-level Allow discounts off, per-ticket off, free, a ticket
--      added later, a sibling offering, another brand's event (automatic and code).
--   A3 differential: the same automatic + code pair written as 'listings' and as
--      'items' gives byte-identical quote lines and codeOutcome, including
--      combines_with and max-uses (total and per buyer) exhaustion.
--   A4 a deleted offering pauses the whole discount for its other offerings
--      (automatic and code) and drops out of brand_discount_offerings.
--   A5 currency: an amount-off offering discount applies in the brand's charge
--      currency, and after a brand currency change maintenance flags it
--      currency_mismatch and checkout stops applying it (percent is not flagged).
--   A6 access: rank 10 (scanner) and outsiders get no offerings, no prices and
--      a refused preview; anon has no EXECUTE on the new or changed RPCs.
--   A7 brand_prices_overview lists draft, scheduled and live tickets, never
--      ended or cancelled ones, and every row exactly once with two venues.
-- FAILS-ON-REVERT: without 20281206004624 A1 (no guard), A6 (no offerings RPC)
-- and A7 (status filter, duplicate menu rows) fail.
\set ON_ERROR_STOP on
BEGIN;

-- Fixtures ---------------------------------------------------------------------
DO $fx$
DECLARE
  v_owner uuid := '46240000-0000-4000-9000-000000000001';
  v_owner_b uuid := '46240000-0000-4000-9000-000000000002';
  v_scanner uuid := '46240000-0000-4000-9000-000000000003';
  v_outsider uuid := '46240000-0000-4000-9000-000000000004';
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_brand_b uuid := '46240000-0000-4000-9100-000000000002';
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'t4624-owner@example.test'),(v_owner_b,'t4624-ownerb@example.test'),
    (v_scanner,'t4624-scanner@example.test'),(v_outsider,'t4624-out@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES
    (v_owner,'t4624-owner@example.test'),(v_owner_b,'t4624-ownerb@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,
    payment_country,pricing_region,pricing_currency) VALUES
    (v_brand,v_owner,'T4624 A','t4624-a','USD','stripe','US','US','USD'),
    (v_brand_b,v_owner_b,'T4624 B','t4624-b','USD','stripe','US','US','USD');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,invited_at)
    VALUES(v_brand,v_scanner,'scanner',now(),now());
  INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,
    payouts_enabled,country,default_currency) VALUES
    (v_brand,'acct_t4624_a',true,true,'US','usd'),(v_brand_b,'acct_t4624_b',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES
    (v_brand,'discounts','pilot'),(v_brand_b,'discounts','pilot');

  -- a1 targeted event, a2 sibling event, aoff offering with Allow discounts off,
  -- agbp event priced in GBP, adraft/aend/acanc for the overview, ars RSVP,
  -- b1 brand B's event.
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,
    timezone,currency,discounts_allowed) VALUES
    ('46240000-0000-4000-9200-0000000000a1',v_brand,v_owner,'A One','t4624-a1','event','scheduled','public','UTC','USD',true),
    ('46240000-0000-4000-9200-0000000000a2',v_brand,v_owner,'A Two','t4624-a2','event','scheduled','public','UTC','USD',true),
    ('46240000-0000-4000-9200-0000000000a3',v_brand,v_owner,'A Off','t4624-a3','experience','scheduled','public','UTC','USD',false),
    ('46240000-0000-4000-9200-0000000000a4',v_brand,v_owner,'A Pounds','t4624-a4','trip','scheduled','public','UTC','GBP',true),
    ('46240000-0000-4000-9200-0000000000a5',v_brand,v_owner,'A Draft','t4624-a5','event','draft','draft','UTC','USD',true),
    ('46240000-0000-4000-9200-0000000000a6',v_brand,v_owner,'A Ended','t4624-a6','event','ended','public','UTC','USD',true),
    ('46240000-0000-4000-9200-0000000000a7',v_brand,v_owner,'A Cancelled','t4624-a7','event','cancelled','public','UTC','USD',true),
    ('46240000-0000-4000-9200-0000000000a8',v_brand,v_owner,'A Rsvp','t4624-a8','rsvp','scheduled','public','UTC','USD',true),
    ('46240000-0000-4000-9200-0000000000b1',v_brand_b,v_owner_b,'B One','t4624-b1','event','scheduled','public','UTC','USD',true);
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  SELECT id,now()+interval '10 days',now()+interval '12 days','UTC',true
    FROM public.events WHERE id::text LIKE '46240000-0000-4000-9200-%';

  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,
    is_unlimited,min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed) VALUES
    ('46240000-0000-4000-9300-0000000000a1','46240000-0000-4000-9200-0000000000a1','A1 paid',1000,'USD',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a2','46240000-0000-4000-9200-0000000000a1','A1 off',1000,'USD',false,100,false,1,10,true,false,false),
    ('46240000-0000-4000-9300-0000000000a3','46240000-0000-4000-9200-0000000000a1','A1 free',0,'USD',true,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a4','46240000-0000-4000-9200-0000000000a2','A2 paid',1000,'USD',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a5','46240000-0000-4000-9200-0000000000a3','A3 paid',1000,'USD',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a6','46240000-0000-4000-9200-0000000000a4','A4 paid GBP',1000,'GBP',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a7','46240000-0000-4000-9200-0000000000a5','A5 draft paid',1000,'USD',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a8','46240000-0000-4000-9200-0000000000a6','A6 ended paid',1000,'USD',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000a9','46240000-0000-4000-9200-0000000000a7','A7 cancelled paid',1000,'USD',false,100,false,1,10,true,false,true),
    ('46240000-0000-4000-9300-0000000000b1','46240000-0000-4000-9200-0000000000b1','B1 paid',1000,'USD',false,100,false,1,10,true,false,true);
END
$fx$;

-- A1 guard matrix ----------------------------------------------------------------
DO $a1$
DECLARE
  v_owner uuid := '46240000-0000-4000-9000-000000000001';
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_a1 uuid := '46240000-0000-4000-9200-0000000000a1';
  v_bad jsonb;
  v_err text;
  v_saved jsonb;
  v_n integer;
BEGIN
  INSERT INTO public.venue_listings(id,brand_id,slug,name,lat,lng,venue_category,claim_status)
    VALUES('46240000-0000-4000-9400-000000000001',v_brand,'t4624v1','T Venue One',51.5,-0.1,'restaurant','pending_review');
  INSERT INTO public.menus(id,brand_id,venue_id,name)
    VALUES('46240000-0000-4000-9400-000000000011',v_brand,'46240000-0000-4000-9400-000000000001','T Menu');
  INSERT INTO public.menu_items(id,brand_id,menu_id,name,price_cents,currency)
    VALUES('46240000-0000-4000-9400-000000000021',v_brand,'46240000-0000-4000-9400-000000000011','T Item',1500,'USD');

  FOREACH v_bad IN ARRAY ARRAY[
    jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId','46240000-0000-4000-9300-0000000000a1')),
    jsonb_build_array(jsonb_build_object('targetKind','menu_item','targetId','46240000-0000-4000-9400-000000000021')),
    jsonb_build_array(jsonb_build_object('targetKind','listing_kind','listingKind','event')),
    jsonb_build_array(jsonb_build_object('targetKind','event','targetId',v_a1),
                      jsonb_build_object('targetKind','ticket_type','targetId','46240000-0000-4000-9300-0000000000a4'))
  ] LOOP
    v_err := 'saved';
    BEGIN
      PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
        'brandId',v_brand,'kind','code','code','A1GUARD','name','Guard','valueType','percent',
        'valueBps',1000,'scopeKind','listings','targets',v_bad));
    EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    END;
    IF v_err <> 'listings_target_invalid' THEN
      RAISE EXCEPTION 'A1 listings + % : want listings_target_invalid, got %',v_bad,v_err;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.brand_discounts WHERE brand_id=v_brand AND code='A1GUARD') THEN
    RAISE EXCEPTION 'A1 a refused create left a discount row behind';
  END IF;

  -- Whole-offering targets save; venue_menu and venue_deposit are still allowed.
  v_saved := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','A1GOOD','name','Good','valueType','percent',
    'valueBps',1000,'scopeKind','listings','targets',jsonb_build_array(
      jsonb_build_object('targetKind','event','targetId',v_a1),
      jsonb_build_object('targetKind','venue_menu','targetId','46240000-0000-4000-9400-000000000001'))));

  -- A refused update must leave the saved targets untouched (statement rollback).
  v_err := 'saved';
  BEGIN
    PERFORM public.issue_3872_upsert_discount(v_owner,'update',jsonb_build_object(
      'id',v_saved->>'id','version',(v_saved->>'version')::integer,'scopeKind','listings',
      'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId','46240000-0000-4000-9300-0000000000a1'))));
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_n FROM public.brand_discount_targets WHERE discount_id=(v_saved->>'id')::uuid;
  IF v_err <> 'listings_target_invalid' OR v_n <> 2 THEN
    RAISE EXCEPTION 'A1 refused update: want listings_target_invalid and 2 kept targets, got % / %',v_err,v_n;
  END IF;

  -- Switching an items discount to listings while re-sending a ticket target is refused.
  v_saved := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','A1ITEMS','name','Items','valueType','percent',
    'valueBps',1000,'scopeKind','items','targets',jsonb_build_array(
      jsonb_build_object('targetKind','ticket_type','targetId','46240000-0000-4000-9300-0000000000a1'))));
  v_err := 'saved';
  BEGIN
    PERFORM public.issue_3872_upsert_discount(v_owner,'update',jsonb_build_object(
      'id',v_saved->>'id','version',(v_saved->>'version')::integer,'scopeKind','listings',
      'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type',
        'targetId','46240000-0000-4000-9300-0000000000a1'))));
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'listings_target_invalid'
     OR (SELECT scope_kind FROM public.brand_discounts WHERE id=(v_saved->>'id')::uuid) <> 'items' THEN
    RAISE EXCEPTION 'A1 items->listings with a ticket target: want refusal and scope kept, got %',v_err;
  END IF;

  -- The trigger itself refuses a raw INSERT and a raw UPDATE (not only the writer).
  v_saved := (SELECT to_jsonb(d) FROM public.brand_discounts d WHERE code='A1GOOD' AND brand_id=v_brand);
  v_err := 'saved';
  BEGIN
    INSERT INTO public.brand_discount_targets(discount_id,target_kind,target_id)
      VALUES((v_saved->>'id')::uuid,'ticket_type','46240000-0000-4000-9300-0000000000a1');
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'listings_target_invalid' THEN RAISE EXCEPTION 'A1 raw insert: got %',v_err; END IF;
  v_err := 'saved';
  BEGIN
    UPDATE public.brand_discount_targets SET target_kind='ticket_type',
      target_id='46240000-0000-4000-9300-0000000000a1'
     WHERE discount_id=(v_saved->>'id')::uuid AND target_kind='event';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'listings_target_invalid' THEN RAISE EXCEPTION 'A1 raw update: got %',v_err; END IF;

  -- RSVP and other-brand offerings are refused by the writer.
  v_err := 'saved';
  BEGIN
    PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code','A1RSVP','name','Rsvp','valueType','percent',
      'valueBps',1000,'scopeKind','listings','targets',jsonb_build_array(
        jsonb_build_object('targetKind','event','targetId','46240000-0000-4000-9200-0000000000a8'))));
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'target_not_discountable' THEN RAISE EXCEPTION 'A1 RSVP target: got %',v_err; END IF;
  v_err := 'saved';
  BEGIN
    PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code','A1OTHER','name','Other','valueType','percent',
      'valueBps',1000,'scopeKind','listings','targets',jsonb_build_array(
        jsonb_build_object('targetKind','event','targetId','46240000-0000-4000-9200-0000000000b1'))));
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'target_not_in_brand' THEN RAISE EXCEPTION 'A1 other-brand target: got %',v_err; END IF;

  -- Clean the A1 discounts so they cannot touch the money checks below.
  UPDATE public.brand_discounts SET deleted_at=now() WHERE brand_id=v_brand;
  RAISE NOTICE 'A1 guard matrix: PASS';
END
$a1$;

-- A2 + A3 money and the listings/items differential ------------------------------
CREATE TEMP TABLE t4624_quotes(label text, scope text, quote jsonb) ON COMMIT DROP;

DO $a2$
DECLARE
  v_owner uuid := '46240000-0000-4000-9000-000000000001';
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_a1 uuid := '46240000-0000-4000-9200-0000000000a1';
  v_a2 uuid := '46240000-0000-4000-9200-0000000000a2';
  v_a3 uuid := '46240000-0000-4000-9200-0000000000a3';
  v_b1 uuid := '46240000-0000-4000-9200-0000000000b1';
  v_late uuid := '46240000-0000-4000-9300-0000000000aa';
  v_scope text;
  v_auto jsonb;
  v_code jsonb;
  v_cap jsonb;
  v_q jsonb;
  v_targets jsonb;
  v_cap_targets jsonb;
  v_cart jsonb;
BEGIN
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,
    is_unlimited,min_purchase_qty,max_purchase_qty,available_online,available_in_person)
    VALUES(v_late,v_a1,'A1 late',2500,'USD',false,100,false,1,10,true,false);
  v_cart := jsonb_build_array(
    jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a1','quantity',2),
    jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a2','quantity',1),
    jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a3','quantity',1),
    jsonb_build_object('ticketTypeId',v_late,'quantity',1));

  FOREACH v_scope IN ARRAY ARRAY['listings','items'] LOOP
    IF v_scope='listings' THEN
      v_targets := jsonb_build_array(jsonb_build_object('targetKind','event','targetId',v_a1),
                                     jsonb_build_object('targetKind','event','targetId',v_a3));
      v_cap_targets := jsonb_build_array(jsonb_build_object('targetKind','event','targetId',v_a1));
    ELSE
      -- The per-ticket equivalent of "every ticket of A1 and A3" (late ticket included).
      SELECT jsonb_agg(jsonb_build_object('targetKind','ticket_type','targetId',tt.id) ORDER BY tt.id)
        INTO v_targets FROM public.ticket_types tt WHERE tt.event_id IN (v_a1,v_a3) AND tt.deleted_at IS NULL;
      SELECT jsonb_agg(jsonb_build_object('targetKind','ticket_type','targetId',tt.id) ORDER BY tt.id)
        INTO v_cap_targets FROM public.ticket_types tt WHERE tt.event_id=v_a1 AND tt.deleted_at IS NULL;
    END IF;

    v_auto := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','automatic','name','Auto '||v_scope,'valueType','percent',
      'valueBps',1000,'scopeKind',v_scope,'combinesWith','automatic_only','targets',v_targets));
    v_code := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code','DIFF'||upper(left(v_scope,4)),'name','Code '||v_scope,
      'valueType','amount','valueMinor',300,'scopeKind',v_scope,'combinesWith','automatic_only',
      'maxUsesPerBuyer',1,'targets',v_targets));
    v_cap := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code','CAP'||upper(left(v_scope,4)),'name','Cap '||v_scope,
      'valueType','percent','valueBps',5000,'scopeKind',v_scope,'combinesWith','none',
      'maxTotalUses',1,'targets',v_cap_targets));

    -- Automatic only; automatic + stacking code; non-combining code; buyer cap hit; total cap hit.
    INSERT INTO t4624_quotes VALUES
      ('auto_a1',v_scope,public.issue_3872_ticket_quote(v_a1,v_cart,NULL,NULL,NULL,NULL,'full',NULL,'buyer1@example.test','+15555550101',NULL,NULL,false)),
      ('code_a1',v_scope,public.issue_3872_ticket_quote(v_a1,v_cart,NULL,NULL,NULL,NULL,'full','DIFF'||upper(left(v_scope,4)),'buyer1@example.test','+15555550101',NULL,NULL,false)),
      ('cap_a1',v_scope,public.issue_3872_ticket_quote(v_a1,v_cart,NULL,NULL,NULL,NULL,'full','CAP'||upper(left(v_scope,4)),'buyer1@example.test','+15555550101',NULL,NULL,false)),
      ('auto_a3',v_scope,public.issue_3872_ticket_quote(v_a3,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a5','quantity',1)),NULL,NULL,NULL,NULL,'full',NULL,'buyer1@example.test','+15555550101',NULL,NULL,false)),
      ('code_a2',v_scope,public.issue_3872_ticket_quote(v_a2,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a4','quantity',1)),NULL,NULL,NULL,NULL,'full','DIFF'||upper(left(v_scope,4)),'buyer1@example.test','+15555550101',NULL,NULL,false)),
      ('code_b1',v_scope,public.issue_3872_ticket_quote(v_b1,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000b1','quantity',1)),NULL,NULL,NULL,NULL,'full','DIFF'||upper(left(v_scope,4)),'buyer1@example.test','+15555550101',NULL,NULL,false));

    INSERT INTO public.discount_uses(discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_email_norm,
      status,units,amount_minor,expires_at,consumed_at) VALUES
      ((v_code->>'id')::uuid,v_brand,'ticket',gen_random_uuid(),'buyer1@example.test','consumed',1,300,now()+interval '1 hour',now()),
      ((v_cap->>'id')::uuid,v_brand,'ticket',gen_random_uuid(),'someone-else@example.test','consumed',1,500,now()+interval '1 hour',now());
    INSERT INTO t4624_quotes VALUES
      ('code_a1_buyer_cap',v_scope,public.issue_3872_ticket_quote(v_a1,v_cart,NULL,NULL,NULL,NULL,'full','DIFF'||upper(left(v_scope,4)),'buyer1@example.test','+15555550101',NULL,NULL,false)),
      ('code_a1_other_buyer',v_scope,public.issue_3872_ticket_quote(v_a1,v_cart,NULL,NULL,NULL,NULL,'full','DIFF'||upper(left(v_scope,4)),'buyer2@example.test','+15555550102',NULL,NULL,false)),
      ('cap_a1_total_cap',v_scope,public.issue_3872_ticket_quote(v_a1,v_cart,NULL,NULL,NULL,NULL,'full','CAP'||upper(left(v_scope,4)),'buyer2@example.test','+15555550102',NULL,NULL,false));

    -- Retire this scope's discounts before the other scope runs.
    UPDATE public.brand_discounts SET deleted_at=now() WHERE id IN
      ((v_auto->>'id')::uuid,(v_code->>'id')::uuid,(v_cap->>'id')::uuid);
  END LOOP;

  -- A2 absolute money on the listings run.
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='auto_a1' AND scope='listings';
  IF (SELECT jsonb_object_agg(l->>'ticketTypeId',(l->>'netUnitCents')::integer) FROM jsonb_array_elements(v_q->'lines') l)
     <> jsonb_build_object('46240000-0000-4000-9300-0000000000a1',900,'46240000-0000-4000-9300-0000000000a2',1000,
                           '46240000-0000-4000-9300-0000000000a3',0,v_late::text,2250) THEN
    RAISE EXCEPTION 'A2 listings automatic on A1 wrong (want paid 900, off 1000, free 0, late 2250): %',v_q->'lines';
  END IF;
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='auto_a3' AND scope='listings';
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 1000 THEN
    RAISE EXCEPTION 'A2 offering-level Allow discounts off was discounted: %',v_q->'lines';
  END IF;
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='code_a2' AND scope='listings';
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 1000 OR v_q#>>'{codeOutcome,status}' <> 'rejected' THEN
    RAISE EXCEPTION 'A2 sibling offering A2 discounted by the A1 code: %',v_q;
  END IF;
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='code_b1' AND scope='listings';
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 1000 OR v_q#>>'{codeOutcome,status}' = 'applied' THEN
    RAISE EXCEPTION 'A2 brand A code discounted brand B event: %',v_q;
  END IF;
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='code_a1' AND scope='listings';
  IF v_q#>>'{codeOutcome,status}' <> 'applied' THEN
    RAISE EXCEPTION 'A2 listings code not applied on A1: %',v_q;
  END IF;
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='code_a1_buyer_cap' AND scope='listings';
  IF v_q#>>'{codeOutcome,status}' = 'applied' THEN
    RAISE EXCEPTION 'A2 per-buyer cap ignored under listings: %',v_q->'codeOutcome';
  END IF;
  SELECT quote INTO v_q FROM t4624_quotes WHERE label='cap_a1_total_cap' AND scope='listings';
  IF v_q#>>'{codeOutcome,status}' = 'applied' THEN
    RAISE EXCEPTION 'A2 total cap ignored under listings: %',v_q->'codeOutcome';
  END IF;

  -- A3 differential: listings must price exactly like the per-ticket equivalent.
  IF EXISTS(
    SELECT 1 FROM t4624_quotes l JOIN t4624_quotes i ON i.label=l.label AND i.scope='items'
     WHERE l.scope='listings'
       AND ((SELECT jsonb_agg(jsonb_build_object('t',x->>'ticketTypeId','q',x->>'quantity','n',x->>'netUnitCents','lt',x->>'lineTotalCents') ORDER BY x->>'ticketTypeId') FROM jsonb_array_elements(l.quote->'lines') x)
            IS DISTINCT FROM
            (SELECT jsonb_agg(jsonb_build_object('t',x->>'ticketTypeId','q',x->>'quantity','n',x->>'netUnitCents','lt',x->>'lineTotalCents') ORDER BY x->>'ticketTypeId') FROM jsonb_array_elements(i.quote->'lines') x)
         OR (l.quote->'codeOutcome'->>'status') IS DISTINCT FROM (i.quote->'codeOutcome'->>'status')
         OR (l.quote->'codeOutcome'->>'reason') IS DISTINCT FROM (i.quote->'codeOutcome'->>'reason'))
  ) THEN
    RAISE EXCEPTION 'A3 listings and items quotes differ: %',(
      SELECT jsonb_agg(jsonb_build_object('label',l.label,'listings',l.quote->'lines','items',i.quote->'lines',
        'lcode',l.quote->'codeOutcome','icode',i.quote->'codeOutcome'))
        FROM t4624_quotes l JOIN t4624_quotes i ON i.label=l.label AND i.scope='items' WHERE l.scope='listings');
  END IF;
  IF (SELECT count(*) FROM t4624_quotes) <> 18 THEN
    RAISE EXCEPTION 'A3 expected 18 quotes, got %',(SELECT count(*) FROM t4624_quotes);
  END IF;
  RAISE NOTICE 'A2 money + A3 listings/items differential: PASS (% quote pairs)',(SELECT count(*)/2 FROM t4624_quotes);
END
$a2$;

-- A4 deleted offering pauses the discount everywhere -----------------------------
DO $a4$
DECLARE
  v_owner uuid := '46240000-0000-4000-9000-000000000001';
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_a1 uuid := '46240000-0000-4000-9200-0000000000a1';
  v_a2 uuid := '46240000-0000-4000-9200-0000000000a2';
  v_auto jsonb; v_code jsonb; v_q jsonb;
BEGIN
  v_auto := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Del auto','valueType','percent','valueBps',1000,
    'scopeKind','listings','combinesWith','any','targets',jsonb_build_array(
      jsonb_build_object('targetKind','event','targetId',v_a1),jsonb_build_object('targetKind','event','targetId',v_a2))));
  v_code := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','DELCODE','name','Del code','valueType','percent','valueBps',2000,
    'scopeKind','listings','combinesWith','any','targets',jsonb_build_array(
      jsonb_build_object('targetKind','event','targetId',v_a1),jsonb_build_object('targetKind','event','targetId',v_a2))));
  v_q := public.issue_3872_ticket_quote(v_a2,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a4','quantity',1)),
    NULL,NULL,NULL,NULL,'full','DELCODE','del@example.test','+15555550201',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 720 THEN
    RAISE EXCEPTION 'A4 before delete want 1000*0.9*0.8=720: %',v_q->'lines';
  END IF;

  UPDATE public.events SET deleted_at=now() WHERE id=v_a1;
  IF (SELECT count(*) FROM public.brand_discounts WHERE id IN ((v_auto->>'id')::uuid,(v_code->>'id')::uuid)
       AND needs_attention='target_deleted') <> 2 THEN
    RAISE EXCEPTION 'A4 deleting A1 did not flag both discounts target_deleted';
  END IF;
  v_q := public.issue_3872_ticket_quote(v_a2,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a4','quantity',1)),
    NULL,NULL,NULL,NULL,'full','DELCODE','del@example.test','+15555550201',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 1000 OR v_q#>>'{codeOutcome,status}' = 'applied' THEN
    RAISE EXCEPTION 'A4 a discount needing attention still applied on the surviving offering A2: %',v_q;
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  IF EXISTS(SELECT 1 FROM public.brand_discount_offerings(v_brand) o WHERE (o->>'id')::uuid=v_a1) THEN
    RAISE EXCEPTION 'A4 a deleted offering is still offered to the picker';
  END IF;
  UPDATE public.brand_discounts SET deleted_at=now() WHERE id IN ((v_auto->>'id')::uuid,(v_code->>'id')::uuid);
  RAISE NOTICE 'A4 deleted offering: PASS (%)',v_q->'codeOutcome';
END
$a4$;

-- A5 currency --------------------------------------------------------------------
DO $a5$
DECLARE
  v_owner uuid := '46240000-0000-4000-9000-000000000001';
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_a2 uuid := '46240000-0000-4000-9200-0000000000a2';
  v_a4 uuid := '46240000-0000-4000-9200-0000000000a4';
  v_amt jsonb; v_pct jsonb; v_q jsonb;
BEGIN
  v_amt := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Usd off','valueType','amount','valueMinor',300,
    'scopeKind','listings','combinesWith','none','targets',jsonb_build_array(
      jsonb_build_object('targetKind','event','targetId',v_a4),jsonb_build_object('targetKind','event','targetId',v_a2))));
  IF v_amt->>'currency' <> 'USD' THEN RAISE EXCEPTION 'A5 amount discount currency %',v_amt->>'currency'; END IF;
  v_q := public.issue_3872_ticket_quote(v_a4,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a6','quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'cur@example.test','+15555550301',NULL,NULL,false);
  -- Checkout charges in the brand's pricing currency (USD here, whatever the
  -- ticket row says), so the USD amount applies, the same as under any scope.
  IF v_q->>'currency' <> 'USD' OR (v_q#>>'{lines,0,netUnitCents}')::integer <> 700 THEN
    RAISE EXCEPTION 'A5 USD amount-off on the trip charged in USD: want USD 700, got % %',v_q->>'currency',v_q->'lines';
  END IF;
  v_q := public.issue_3872_ticket_quote(v_a2,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a4','quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'cur@example.test','+15555550301',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 700 THEN
    RAISE EXCEPTION 'A5 USD amount-off did not apply to the USD offering: %',v_q->'lines';
  END IF;
  v_pct := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','PCTCUR','name','Pct','valueType','percent','valueBps',1000,
    'scopeKind','listings','targets',jsonb_build_array(jsonb_build_object('targetKind','event','targetId',v_a2))));
  UPDATE public.brands SET pricing_currency='GBP' WHERE id=v_brand;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT needs_attention FROM public.brand_discounts WHERE id=(v_amt->>'id')::uuid) IS DISTINCT FROM 'currency_mismatch'
     OR (SELECT needs_attention FROM public.brand_discounts WHERE id=(v_pct->>'id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'A5 maintenance: want amount=currency_mismatch, percent=null';
  END IF;
  v_q := public.issue_3872_ticket_quote(v_a2,jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-9300-0000000000a4','quantity',1)),
    NULL,NULL,NULL,NULL,'full',NULL,'cur@example.test','+15555550301',NULL,NULL,false);
  IF (v_q#>>'{lines,0,netUnitCents}')::integer <> 1000 THEN
    RAISE EXCEPTION 'A5 currency_mismatch discount still applied: %',v_q->'lines';
  END IF;
  UPDATE public.brands SET pricing_currency='USD' WHERE id=v_brand;
  UPDATE public.brand_discounts SET deleted_at=now() WHERE id IN ((v_amt->>'id')::uuid,(v_pct->>'id')::uuid);
  RAISE NOTICE 'A5 currency: PASS';
END
$a5$;

-- A6 access: rank below 20 and outsiders ----------------------------------------
DO $a6$
DECLARE
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_who uuid;
  v_err text;
BEGIN
  FOREACH v_who IN ARRAY ARRAY['46240000-0000-4000-9000-000000000003'::uuid,
                               '46240000-0000-4000-9000-000000000004'::uuid,
                               '46240000-0000-4000-9000-000000000002'::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_who,'role','authenticated')::text,true);
    PERFORM set_config('request.jwt.claim.sub',v_who::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    IF EXISTS(SELECT 1 FROM public.brand_discount_offerings(v_brand)) THEN
      RAISE EXCEPTION 'A6 % (rank %) sees offerings',v_who,public.biz_brand_effective_rank(v_brand,v_who);
    END IF;
    IF EXISTS(SELECT 1 FROM public.brand_prices_overview(v_brand)) THEN
      RAISE EXCEPTION 'A6 % sees prices',v_who;
    END IF;
    v_err := 'returned';
    BEGIN
      PERFORM public.brand_discount_preview(v_brand,jsonb_build_object('kind','code','code','PEEK','name','Peek',
        'valueType','percent','valueBps',1000,'scopeKind','listings','combinesWith','none','targets',
        jsonb_build_array(jsonb_build_object('targetKind','event','targetId','46240000-0000-4000-9200-0000000000a2'))));
    EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    END;
    IF v_err <> 'insufficient_permission' THEN RAISE EXCEPTION 'A6 % preview: got %',v_who,v_err; END IF;
  END LOOP;
  IF public.biz_brand_effective_rank(v_brand,'46240000-0000-4000-9000-000000000003') <> 10 THEN
    RAISE EXCEPTION 'A6 fixture: scanner rank is not 10';
  END IF;
  IF has_function_privilege('anon','public.brand_discount_offerings(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.brand_discount_preview(uuid,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.brand_prices_overview(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.brand_discount_offerings(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'A6 EXECUTE grants wrong (anon must not, authenticated must)';
  END IF;
  -- brand_discount_offerings must be the only overload and be SECURITY DEFINER with a pinned path.
  IF (SELECT count(*) FROM pg_proc WHERE proname='brand_discount_offerings') <> 1
     OR NOT (SELECT prosecdef AND proconfig::text LIKE '%search_path=public%' FROM pg_proc WHERE proname='brand_discount_offerings') THEN
    RAISE EXCEPTION 'A6 brand_discount_offerings definition not locked down';
  END IF;
  RAISE NOTICE 'A6 access: PASS';
END
$a6$;

-- anon: the catalog check above is the suite's proof (a DO block run under
-- SET ROLE anon segfaults this local supabase/postgres image, so the live
-- anon refusal is proven through PostgREST in the verdict instead).

-- A7 prices overview statuses and duplicates -------------------------------------
DO $a7$
DECLARE
  v_owner uuid := '46240000-0000-4000-9000-000000000001';
  v_brand uuid := '46240000-0000-4000-9100-000000000001';
  v_rows jsonb;
  v_offer jsonb;
BEGIN
  INSERT INTO public.venue_listings(id,brand_id,slug,name,lat,lng,venue_category,claim_status)
    VALUES('46240000-0000-4000-9400-000000000002',v_brand,'t4624v2','T Venue Two',51.6,-0.2,'restaurant','pending_review');
  INSERT INTO public.menus(id,brand_id,venue_id,name)
    VALUES('46240000-0000-4000-9400-000000000012',v_brand,'46240000-0000-4000-9400-000000000002','T Menu Two');
  INSERT INTO public.menu_items(id,brand_id,menu_id,name,price_cents,currency)
    VALUES('46240000-0000-4000-9400-000000000022',v_brand,'46240000-0000-4000-9400-000000000012','T Two',900,'USD');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  SELECT jsonb_agg(p) INTO v_rows FROM public.brand_prices_overview(v_brand) p;

  IF EXISTS(SELECT p->>'kind',p->>'id' FROM jsonb_array_elements(v_rows) p GROUP BY 1,2 HAVING count(*)>1) THEN
    RAISE EXCEPTION 'A7 duplicate rows in the prices overview: %',v_rows;
  END IF;
  -- draft (a5) and scheduled (a2) listed; ended (a6) and cancelled (a7) not; free (a1 free) not;
  -- deleted offering (a1, soft-deleted in A4) not.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) p WHERE p->>'id'='46240000-0000-4000-9300-0000000000a7')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) p WHERE p->>'id'='46240000-0000-4000-9300-0000000000a4')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) p WHERE p->>'id' IN (
          '46240000-0000-4000-9300-0000000000a8','46240000-0000-4000-9300-0000000000a9',
          '46240000-0000-4000-9300-0000000000a3','46240000-0000-4000-9300-0000000000a1',
          '46240000-0000-4000-9300-0000000000b1')) THEN
    RAISE EXCEPTION 'A7 status filter wrong: %',v_rows;
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_rows) p WHERE p->>'kind'='menu_item') <> 2 THEN
    RAISE EXCEPTION 'A7 want 2 menu rows (one item per venue, two venues), got %',v_rows;
  END IF;

  -- The picker list: ended and cancelled are returned (the UI decides), RSVP and
  -- other brands never are; Allow-discounts-off and paid counts are honest.
  SELECT jsonb_object_agg(o->>'id',o) INTO v_offer FROM public.brand_discount_offerings(v_brand) o;
  IF v_offer ? '46240000-0000-4000-9200-0000000000a8' OR v_offer ? '46240000-0000-4000-9200-0000000000b1'
     OR NOT (v_offer ? '46240000-0000-4000-9200-0000000000a6') OR NOT (v_offer ? '46240000-0000-4000-9200-0000000000a7')
     OR (v_offer#>>'{46240000-0000-4000-9200-0000000000a3,discountsAllowed}')::boolean IS NOT FALSE
     OR v_offer#>>'{46240000-0000-4000-9200-0000000000a4,offeringKind}' <> 'trip'
     OR (v_offer#>>'{46240000-0000-4000-9200-0000000000a2,paidTicketCount}')::integer <> 1 THEN
    RAISE EXCEPTION 'A7 offerings list wrong: %',v_offer;
  END IF;
  RAISE NOTICE 'A7 prices overview + offerings list: PASS';
END
$a7$;

DO $done$ BEGIN RAISE NOTICE 'issue_4624_offering_discounts tester adversarial: PASS (A1-A7)'; END $done$;
ROLLBACK;
