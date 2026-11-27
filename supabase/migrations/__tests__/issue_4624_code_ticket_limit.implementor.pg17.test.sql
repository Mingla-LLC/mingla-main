-- MINGLA-INVARIANT: I-4624-6 | issue #4624 | A discount code with ends_after_count never discounts more tickets than the cap: a basket line with more tickets than remain keeps full price and gets a sale_limited notice (discountKind code), and no tickets left rejects the code as used_up.
-- MINGLA-INVARIANT: I-4624-7 | issue #4624 | Parallel reservations of a ticket-capped code serialise on the discount row lock, so reserved plus consumed units never exceed ends_after_count.
-- MINGLA-INVARIANT: I-4624-12 | issue #4624 | A discount spends cap units only on lines it actually makes cheaper; a line an earlier discount already made free spends none (codes, automatic and sale alike).
-- MINGLA-INVARIANT: I-4624-13 | issue #4624 | One cap unit is one ticket issued (the line qty): a multi-day pass, a block booking and a group ticket each count once.
-- MINGLA-INVARIANT: I-4624-14 | issue #4624 | Void, refunded or event-cancelled tickets give their discount units back through one idempotent recompute; a use and the per-buyer limit come back only when every discounted ticket on the order is dead.
-- MINGLA-INVARIANT: I-4624-22 | issue #4624 | A checkout session holds one line per ticket type (two lines for one type are refused as checkout_lines_duplicate), and place returns count each dead ticket once, never more than the units a use consumed.
-- MINGLA-INVARIANT: I-4624-15 | issue #4624 | A consume after its hold lapsed re-checks capacity under the discount lock and records any overrun (over_limit_units / over_limit_uses); it never exceeds a cap silently.
-- Issue #4624: a discount code can stop after N tickets ("Total tickets" =
-- brand_discounts.ends_after_count) as well as after N checkouts ("Total uses" =
-- max_total_uses), on the fully replayed PostgreSQL 17 schema with
-- 20281206014624_issue_4624_code_ticket_limit.sql applied.
--   T1 writer: a code saves with endsAfterCount 5; 0 is refused by the column CHECK.
--   T2 cap 5: five 1-ticket checkouts are discounted, the sixth is used_up.
--   T3 basket of 6 with 5 left: the line keeps full price, notice remaining 5.
--   T4 basket 3 (reserved hold) then basket 3: the second gets notice remaining 2;
--      releasing the hold frees the tickets again.
--   T5 two lines in one basket (3 + 3, cap 5): the bigger saving (VIP) is
--      discounted, General gets notice remaining 2 (P3-3).
--   T6 ends_after_count NULL: a code behaves exactly as before (10 tickets all
--      discounted, no notice, candidate remainingUnits null, limited false).
--   T7 both limits, whichever runs out first: uses first, then tickets first.
--   T8 automatic discounts are unchanged (notice has no discountKind).
--   T9 (committed fixtures, two dblink sessions) parallel reservations of a
--      cap-5 code with 3 tickets each: the second waits for the first's lock and
--      gets no discount; reserved units stay at 3.
-- Rework (spec 7206302208), one rolled-back block: T2-1/T2-2 only discounted
-- tickets count; T3-1..T3-6 one unit per ticket issued; T4-1..T4-7 refunds,
-- free-order cancel, refund_pending, event cancel of a free order (the events
-- trigger), comp void, and the sweep reopening a run-out code; T5-1..T5-4 and
-- T5-6 late payments and holds; TP3-3 best saving first; TP3-4 80% warning on
-- the closer limit. T5-5 (committed, dblink) a late consume and a reservation
-- serialise in both start orders.
-- FAILS-ON-REVERT (rework): with the pre-rework 014624 bodies, T2-1 (VIP gets a
-- notice), T3-1 (6 units), T4-1 (nothing returned) and T5-1 (no overrun) fail.
-- FAILS-ON-REVERT: without the migration T1 fails (bd_count_end refuses codes),
-- and with only the constraint lifted T2-T5, T7 and T9 fail (the code pass has
-- no unit check and the candidate's remainingUnits is NULL).
-- Like issue_3040_concurrent_replace, T9 COMMITs its fixtures so the loopback
-- sessions can see them, and the cleanup at the bottom removes every row by id.
-- Runs as supabase_admin (dblink needs a password login over loopback).
\set ON_ERROR_STOP on
\getenv i4624_pw PGPASSWORD
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000101';
  v_brand uuid := '46240000-0000-4000-8100-000000000101';
  v_event uuid := '46240000-0000-4000-8200-000000000101';
  v_tt_a uuid := '46240000-0000-4000-8300-000000000101';
  v_tt_b uuid := '46240000-0000-4000-8300-000000000102';
  v_d jsonb;
  v_q jsonb;
  v_r jsonb;
  v_c jsonb;
  v_err text;
  v_hold uuid;
  i integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-cap-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-cap-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 cap brand','issue-4624-cap-brand','USD','stripe','US','US','USD');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'Talent Night','issue-4624-cap-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES
    (v_tt_a,v_event,'General',2500,'USD',false,100,false,1,10,true,false,true),
    (v_tt_b,v_event,'VIP',5000,'USD',false,100,false,1,10,true,false,true);

  CREATE TEMP TABLE i4624_lines(ref text PRIMARY KEY, line jsonb) ON COMMIT DROP;
  INSERT INTO i4624_lines VALUES
    ('a',jsonb_build_object('lineRef',v_tt_a,'itemKind','ticket_type','itemId',v_tt_a,
      'listingId',v_event,'listingKind','event','listUnitMinor',2500,'qty',1,
      'valueScale',1,'countScale',1,'allowed',true,'tz','UTC')),
    ('b',jsonb_build_object('lineRef',v_tt_b,'itemKind','ticket_type','itemId',v_tt_b,
      'listingId',v_event,'listingKind','event','listUnitMinor',5000,'qty',1,
      'valueScale',1,'countScale',1,'allowed',true,'tz','UTC'));

  -- T1 writer -------------------------------------------------------------------
  v_d := public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','TOPZY','name','Talent code',
    'valueType','percent','valueBps',10000,'scopeKind','brand','endsAfterCount',5));
  IF (SELECT ends_after_count FROM public.brand_discounts WHERE brand_id=v_brand AND code='TOPZY') IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'T1 code with endsAfterCount 5 did not save the cap';
  END IF;
  v_err := 'saved';
  BEGIN
    PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code','ZEROCAP','name','Zero cap',
      'valueType','percent','valueBps',1000,'scopeKind','brand','endsAfterCount',0));
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_err = CONSTRAINT_NAME;
  END;
  IF v_err <> 'brand_discounts_ends_after_count_check' THEN
    RAISE EXCEPTION 'T1 endsAfterCount 0: want brand_discounts_ends_after_count_check, got %',v_err;
  END IF;

  -- T2 cap 5: five single-ticket checkouts, then used_up ----------------------
  FOR i IN 1..5 LOOP
    v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',
      jsonb_build_array((SELECT line FROM i4624_lines WHERE ref='a')),'TOPZY',
      jsonb_build_object('email',format('buyer%s@example.test',i)),NULL,now()+interval '1 day',true,'online');
    IF (v_r->'quote'->>'discountMinor')::integer <> 2500 OR v_r->'quote'->'codeOutcome'->>'status' <> 'applied' THEN
      RAISE EXCEPTION 'T2 checkout % not discounted: %',i,v_r->'quote';
    END IF;
  END LOOP;
  IF (SELECT sum(units) FROM public.discount_uses u JOIN public.brand_discounts d ON d.id=u.discount_id
      WHERE d.code='TOPZY' AND d.brand_id=v_brand AND u.status='consumed') <> 5 THEN
    RAISE EXCEPTION 'T2 consumed units are not 5';
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',
    jsonb_build_array((SELECT line FROM i4624_lines WHERE ref='a')),'TOPZY',
    jsonb_build_object('email','buyer6@example.test'),NULL,now()+interval '1 day',true,'online');
  IF v_r->'quote'->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up'
     OR (v_r->'quote'->>'discountMinor')::integer <> 0 THEN
    RAISE EXCEPTION 'T2 sixth checkout: want used_up and no discount, got %',v_r->'quote';
  END IF;
  IF (SELECT count(*) FROM public.discount_uses u JOIN public.brand_discounts d ON d.id=u.discount_id
      WHERE d.code='TOPZY' AND d.brand_id=v_brand) <> 5 THEN
    RAISE EXCEPTION 'T2 sixth checkout wrote a use row';
  END IF;

  -- T3 basket of 6 with 5 left ---------------------------------------------------
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','SIXCAP','name','Six cap',
    'valueType','percent','valueBps',10000,'scopeKind','brand','endsAfterCount',5));
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":6}' FROM i4624_lines WHERE ref='a')),'SIXCAP',
    jsonb_build_object('email','t3@example.test'));
  IF (v_q->>'discountMinor')::integer <> 0 OR v_q->'codeOutcome'->>'status' <> 'applied'
     OR jsonb_array_length(v_q->'notices') <> 1
     OR v_q#>>'{notices,0,type}' <> 'sale_limited'
     OR v_q#>>'{notices,0,discountKind}' IS DISTINCT FROM 'code'
     OR v_q#>>'{notices,0,remaining}' <> '5'
     OR v_q#>>'{notices,0,lineRef}' <> v_tt_a::text
     OR v_q#>>'{notices,0,discountId}' <> (SELECT id::text FROM public.brand_discounts WHERE brand_id=v_brand AND code='SIXCAP') THEN
    RAISE EXCEPTION 'T3 basket 6 of 5: want full price and one code notice remaining 5, got %',v_q;
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":5}' FROM i4624_lines WHERE ref='a')),'SIXCAP',
    jsonb_build_object('email','t3@example.test'));
  IF (v_q->>'discountMinor')::integer <> 12500 OR jsonb_array_length(v_q->'notices') <> 0 THEN
    RAISE EXCEPTION 'T3 basket 5 of 5: want 5 free tickets, got %',v_q;
  END IF;

  -- T4 basket 3 held, then basket 3 ---------------------------------------------
  v_hold := gen_random_uuid();
  v_r := public.issue_3872_reserve_discount_uses('ticket',v_hold,v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":3}' FROM i4624_lines WHERE ref='a')),'SIXCAP',
    jsonb_build_object('email','t4a@example.test'),NULL,now()+interval '15 minutes',false,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 7500 THEN
    RAISE EXCEPTION 'T4 first basket of 3 not discounted: %',v_r->'quote';
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":3}' FROM i4624_lines WHERE ref='a')),'SIXCAP',
    jsonb_build_object('email','t4b@example.test'));
  IF (v_q->>'discountMinor')::integer <> 0 OR v_q#>>'{notices,0,remaining}' <> '2'
     OR v_q#>>'{notices,0,discountKind}' IS DISTINCT FROM 'code' THEN
    RAISE EXCEPTION 'T4 second basket of 3 with a live hold: want notice remaining 2, got %',v_q;
  END IF;
  PERFORM public.issue_3872_release_discount_uses('ticket',v_hold);
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":3}' FROM i4624_lines WHERE ref='a')),'SIXCAP',
    jsonb_build_object('email','t4b@example.test'));
  IF (v_q->>'discountMinor')::integer <> 7500 OR jsonb_array_length(v_q->'notices') <> 0 THEN
    RAISE EXCEPTION 'T4 after release: want 3 free tickets, got %',v_q;
  END IF;

  -- T5 two lines, cap 5 ------------------------------------------------------------
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array(
      (SELECT line||'{"qty":3}' FROM i4624_lines WHERE ref='a'),
      (SELECT line||'{"qty":3}' FROM i4624_lines WHERE ref='b')),'SIXCAP',
    jsonb_build_object('email','t5@example.test'));
  -- #4624 P3-3: the bigger per-ticket saving (VIP, line b) is visited first.
  IF (v_q->>'discountMinor')::integer <> 15000
     OR jsonb_array_length(v_q->'notices') <> 1
     OR v_q#>>'{notices,0,lineRef}' <> v_tt_a::text
     OR v_q#>>'{notices,0,remaining}' <> '2'
     OR (v_q#>>'{applied,0,units}')::integer <> 3 THEN
    RAISE EXCEPTION 'T5 two lines 3+3 on cap 5: want VIP free, notice remaining 2 on General, got %',v_q;
  END IF;

  -- T6 no ticket cap: unchanged ------------------------------------------------------
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','NOCAP','name','No cap',
    'valueType','percent','valueBps',5000,'scopeKind','brand'));
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":10}' FROM i4624_lines WHERE ref='a')),'NOCAP',
    jsonb_build_object('email','t6@example.test'));
  IF (v_q->>'discountMinor')::integer <> 12500 OR jsonb_array_length(v_q->'notices') <> 0
     OR v_q->'codeOutcome'->>'status' <> 'applied' THEN
    RAISE EXCEPTION 'T6 uncapped code: want 10 tickets at half price and no notice, got %',v_q;
  END IF;
  v_c := public.issue_3872_discount_candidates(v_brand,'[]'::jsonb,'NOCAP',
    jsonb_build_object('email','t6@example.test'),now());
  IF v_c->'code'->>'remainingUnits' IS NOT NULL OR (v_c->'code'->>'limited')::boolean THEN
    RAISE EXCEPTION 'T6 uncapped candidate: want remainingUnits null and limited false, got %',v_c->'code';
  END IF;
  v_c := public.issue_3872_discount_candidates(v_brand,'[]'::jsonb,'SIXCAP',
    jsonb_build_object('email','t6@example.test'),now());
  IF v_c->'code'->>'remainingUnits' <> '5' OR NOT (v_c->'code'->>'limited')::boolean THEN
    RAISE EXCEPTION 'T6 capped candidate: want remainingUnits 5 and limited true, got %',v_c->'code';
  END IF;

  -- T7 both limits: whichever runs out first -------------------------------------
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','USESFIRST','name','Uses first',
    'valueType','percent','valueBps',10000,'scopeKind','brand',
    'maxTotalUses',2,'endsAfterCount',10));
  FOR i IN 1..2 LOOP
    v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',
      jsonb_build_array((SELECT line FROM i4624_lines WHERE ref='a')),'USESFIRST',
      jsonb_build_object('email',format('t7u%s@example.test',i)),NULL,now()+interval '1 day',true,'online');
  END LOOP;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line FROM i4624_lines WHERE ref='a')),'USESFIRST',
    jsonb_build_object('email','t7u3@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'T7 uses ran out first: want used_up, got %',v_q->'codeOutcome';
  END IF;
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','TIXFIRST','name','Tickets first',
    'valueType','percent','valueBps',10000,'scopeKind','brand',
    'maxTotalUses',10,'endsAfterCount',3));
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":2}' FROM i4624_lines WHERE ref='a')),'TIXFIRST',
    jsonb_build_object('email','t7t1@example.test'),NULL,now()+interval '1 day',true,'online');
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":2}' FROM i4624_lines WHERE ref='a')),'TIXFIRST',
    jsonb_build_object('email','t7t2@example.test'));
  IF (v_q->>'discountMinor')::integer <> 0 OR v_q#>>'{notices,0,remaining}' <> '1' THEN
    RAISE EXCEPTION 'T7 tickets: basket 2 with 1 left, want notice remaining 1, got %',v_q;
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',
    jsonb_build_array((SELECT line FROM i4624_lines WHERE ref='a')),'TIXFIRST',
    jsonb_build_object('email','t7t3@example.test'),NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 2500 THEN
    RAISE EXCEPTION 'T7 tickets: last ticket not discounted, got %',v_r->'quote';
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line FROM i4624_lines WHERE ref='a')),'TIXFIRST',
    jsonb_build_object('email','t7t4@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'T7 tickets ran out first (2 of 10 uses): want used_up, got %',v_q->'codeOutcome';
  END IF;

  -- T8 automatic discounts unchanged ---------------------------------------------
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Early bird','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',3));
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":4}' FROM i4624_lines WHERE ref='a')),NULL,'{}'::jsonb);
  IF (v_q->>'discountMinor')::integer <> 0 OR v_q#>>'{notices,0,type}' <> 'sale_limited'
     OR v_q#>>'{notices,0,remaining}' <> '3' OR (v_q->'notices'->0) ? 'discountKind' THEN
    RAISE EXCEPTION 'T8 automatic over its cap: want the unchanged sale_limited notice, got %',v_q;
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',
    jsonb_build_array((SELECT line||'{"qty":3}' FROM i4624_lines WHERE ref='a')),NULL,'{}'::jsonb);
  IF (v_q->>'discountMinor')::integer <> 750 OR jsonb_array_length(v_q->'notices') <> 0 THEN
    RAISE EXCEPTION 'T8 automatic within its cap: want 10%% off 3 tickets, got %',v_q;
  END IF;

  RAISE NOTICE 'issue_4624_code_ticket_limit: PASS (T1-T8)';
END;
$test$;

ROLLBACK;

-- ===========================================================================
-- #4624 rework (spec 7206302208): T2 only discounted tickets count, T3 one unit
-- per ticket issued, T4 places come back on refund or cancel, T5 late payments,
-- TP3 best saving first and the 80% warning. One transaction, rolled back.
-- ===========================================================================
BEGIN;

CREATE FUNCTION pg_temp.i4624r_line(p_tt uuid,p_event uuid,p_price integer,p_qty integer,
  p_value_scale integer DEFAULT 1,p_count_scale integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('lineRef',p_tt,'itemKind','ticket_type','itemId',p_tt,
    'listingId',p_event,'listingKind','event','listUnitMinor',p_price,'qty',p_qty,
    'valueScale',p_value_scale,'countScale',p_count_scale,'allowed',true,'tz','UTC');
$f$;

-- A real checkout: create the session (reserving the discount use), then
-- finalize it, which mints one ticket per quantity and consumes the use.
CREATE FUNCTION pg_temp.i4624r_buy(p_event uuid,p_tt uuid,p_qty integer,p_code text,p_email text,
  p_free boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_created jsonb; v_session uuid; v_final jsonb;
BEGIN
  v_created := public.biz_ticket_checkout_create_session(
    p_event,NULL,'Buyer',p_email,'+1555'||lpad((abs(hashtext(p_email))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',p_tt,'quantity',p_qty)),
    'i4624r-'||gen_random_uuid()::text,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,
    p_code,NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF p_free THEN
    v_final := public.biz_ticket_checkout_finalize(v_session,NULL,NULL,'free',
      'i4624r-test-pepper-0123456789abcdef0123456789abcd');
  ELSE
    -- The paid admission gate needs a claimed provider attempt; drive the same
    -- two steps biz_ticket_checkout_finalize runs behind it.
    PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_'||replace(v_session::text,'-',''),
      'ch_'||replace(v_session::text,'-',''),'card','i4624r-test-pepper-0123456789abcdef0123456789abcd');
    PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
    v_final := jsonb_build_object('outcome','finalized','orderId',
      (SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  END IF;
  RETURN jsonb_build_object('session',v_session,'order',v_final->>'orderId',
    'outcome',v_final->>'outcome','created',v_created);
END;
$f$;

CREATE FUNCTION pg_temp.i4624r_use(p_discount uuid,p_order uuid)
RETURNS public.discount_uses LANGUAGE sql STABLE AS $f$
  SELECT * FROM public.discount_uses WHERE discount_id=p_discount AND order_id=p_order;
$f$;

CREATE FUNCTION pg_temp.i4624r_remaining(p_brand uuid,p_code text)
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT public.issue_3872_discount_candidates(p_brand,'[]'::jsonb,p_code,
    jsonb_build_object('email','probe@example.test'),now())->'code';
$f$;

CREATE FUNCTION pg_temp.i4624r_list(p_brand uuid,p_id uuid,p_filter text DEFAULT 'live')
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT r FROM public.brand_discounts_list(p_brand,p_filter) r WHERE r->>'id'=p_id::text;
$f$;

DO $rework$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000301';
  v_brand uuid := '46240000-0000-4000-8100-000000000301';
  v_event uuid := '46240000-0000-4000-8200-000000000301';
  v_event2 uuid := '46240000-0000-4000-8200-000000000302';
  v_ga uuid := '46240000-0000-4000-8300-000000000301';
  v_vip uuid := '46240000-0000-4000-8300-000000000302';
  v_ga2 uuid := '46240000-0000-4000-8300-000000000303';
  v_id uuid; v_id2 uuid; v_auto uuid;
  v_q jsonb; v_r jsonb; v_b jsonb; v_b2 jsonb; v_c jsonb; v_l jsonb; v_m jsonb;
  v_u public.discount_uses;
  v_order uuid; v_session uuid; v_n integer; v_err text; v_line1 uuid; v_line2 uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-rework-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-rework-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 rework brand','issue-4624-rework-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624_rework',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES
    (v_event,v_brand,v_owner,'Rework Night','issue-4624-rework-e1','event','scheduled','public','UTC','USD'),
    (v_event2,v_brand,v_owner,'Rework Free Night','issue-4624-rework-e2','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true),
    (v_event2,now()+interval '4 days',now()+interval '4 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES
    (v_ga,v_event,'General',2500,'USD',false,100,false,1,10,true,false,true),
    (v_vip,v_event,'VIP',5000,'USD',false,100,false,1,10,true,false,true),
    (v_ga2,v_event2,'General',2500,'USD',false,100,false,1,10,true,false,true);
  -- The Host list reads auth.uid(); act as the brand owner.
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);

  -- T2-1 tester P2-1: a line an automatic already made free spends no code units.
  v_auto := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','GA free','valueType','percent','valueBps',10000,
    'scopeKind','items','combinesWith','any',
    'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_ga))))->>'id')::uuid;
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','PHANTOM','name','Phantom','valueType','percent',
    'valueBps',10000,'scopeKind','brand','combinesWith','any','endsAfterCount',5));
  v_id := (SELECT id FROM public.brand_discounts WHERE brand_id=v_brand AND code='PHANTOM');
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624r_line(v_ga,v_event,2500,3),pg_temp.i4624r_line(v_vip,v_event,5000,3)),
    'PHANTOM',jsonb_build_object('email','t21@example.test'),NULL,now()+interval '15 minutes',false,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 22500
     OR jsonb_array_length(v_r->'quote'->'notices') <> 0
     OR (SELECT sum(units) FROM public.discount_uses WHERE discount_id=v_id) <> 3 THEN
    RAISE EXCEPTION 'T2-1 GA x3 (automatic free) + VIP x3 on PHANTOM cap 5: want VIP free, no notice, 3 code units; got % units %',
      v_r->'quote',(SELECT sum(units) FROM public.discount_uses WHERE discount_id=v_id);
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id IN (v_auto,v_id);
  DELETE FROM public.discount_uses WHERE discount_id=v_id;

  -- T2-2 an automatic cap behind an automatic that already zeroed the line.
  v_auto := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','GA free again','valueType','percent','valueBps',10000,
    'scopeKind','items','combinesWith','any',
    'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_ga))))->>'id')::uuid;
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','One off','valueType','amount','valueMinor',100,
    'scopeKind','brand','combinesWith','any','endsAfterCount',3))->>'id')::uuid;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624r_line(v_ga,v_event,2500,2),pg_temp.i4624r_line(v_vip,v_event,5000,2)),NULL,'{}'::jsonb);
  IF (v_q->>'discountMinor')::integer <> 5200 OR jsonb_array_length(v_q->'notices') <> 0
     OR (SELECT (a->>'units')::integer FROM jsonb_array_elements(v_q->'applied') a WHERE a->>'discountId'=v_id::text) <> 2 THEN
    RAISE EXCEPTION 'T2-2 capped automatic (3) after GA was zeroed: want 200 off VIP x2 as 2 units, no notice; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id IN (v_auto,v_id);

  -- T3 one unit per ticket issued (engine lines as issue_3872_ticket_line_price emits them).
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','UNITS','name','Units','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  -- T3-1 all-days 3-day pass x2: countScale 3, 2 units; never remaining 0 on one line.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,7500,2,1,3)),'UNITS',jsonb_build_object('email','t31@example.test'));
  IF (v_q#>>'{applied,0,units}')::integer <> 2 OR (v_q#>>'{lines,0,unitsCounted}')::integer <> 2 THEN
    RAISE EXCEPTION 'T3-1 two 3-day passes: want 2 units; got %',v_q;
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,7500,6,1,3)),'UNITS',jsonb_build_object('email','t31@example.test'));
  IF v_q#>>'{notices,0,remaining}' <> '5' THEN
    RAISE EXCEPTION 'T3-1 six 3-day passes on cap 5: want notice remaining 5 (never 0); got %',v_q;
  END IF;
  -- T3-2 block booking of 3 blocks x1: valueScale and countScale 3, 1 unit.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,3000,1,3,3)),'UNITS',jsonb_build_object('email','t32@example.test'));
  IF (v_q#>>'{applied,0,units}')::integer <> 1 THEN
    RAISE EXCEPTION 'T3-2 block booking of 3 blocks: want 1 unit; got %',v_q;
  END IF;
  -- T3-3 group x1: 1 unit.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,20000,1)),'UNITS',jsonb_build_object('email','t33@example.test'));
  IF (v_q#>>'{applied,0,units}')::integer <> 1 THEN
    RAISE EXCEPTION 'T3-3 group ticket: want 1 unit; got %',v_q;
  END IF;
  -- T3-4 per-day uniform, 2 people x 3 days: qty 6 tickets, 6 units (fits a cap of 6).
  UPDATE public.brand_discounts SET ends_after_count=6 WHERE id=v_id;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,2500,6)),'UNITS',jsonb_build_object('email','t34@example.test'));
  IF (v_q#>>'{applied,0,units}')::integer <> 6 THEN
    RAISE EXCEPTION 'T3-4 per-day 2 people x 3 days: want 6 units; got %',v_q;
  END IF;
  -- T3-5 by-date quantities 2 + 3: 5 units.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,2500,2),pg_temp.i4624r_line(v_vip,v_event,2500,3)),
    'UNITS',jsonb_build_object('email','t35@example.test'));
  IF (v_q#>>'{applied,0,units}')::integer <> 5 THEN
    RAISE EXCEPTION 'T3-5 by-date 2+3: want 5 units; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  -- T3-6 an automatic "End after N sold" counts the same way (D-3b).
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Pass promo','valueType','percent','valueBps',1000,
    'scopeKind','brand','combinesWith','any','endsAfterCount',2))->>'id')::uuid;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,7500,2,1,3)),NULL,'{}'::jsonb);
  IF (v_q#>>'{applied,0,units}')::integer <> 2 OR jsonb_array_length(v_q->'notices') <> 0 THEN
    RAISE EXCEPTION 'T3-6 automatic cap 2, two 3-day passes: want 2 units and no notice; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- T4 places come back -----------------------------------------------------------
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','REFUND10','name','Refund ten','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5,'maxTotalUses',1,'maxUsesPerBuyer',1))->>'id')::uuid;
  v_b := pg_temp.i4624r_buy(v_event,v_ga,5,'REFUND10','t41@example.test');
  v_order := (v_b->>'order')::uuid;
  IF v_b->>'outcome' <> 'finalized' OR (SELECT count(*) FROM public.tickets WHERE order_id=v_order) <> 5
     OR (pg_temp.i4624r_use(v_id,v_order)).status <> 'consumed' OR (pg_temp.i4624r_use(v_id,v_order)).units <> 5 THEN
    RAISE EXCEPTION 'T4 setup: 5 tickets on REFUND10 not finalized/consumed: %',v_b;
  END IF;
  -- T4-1 refund 2 tickets (2 x 2250) through the webhook commit.
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624r_1',4500,'USD',NULL,NULL);
  v_u := pg_temp.i4624r_use(v_id,v_order);
  v_c := pg_temp.i4624r_remaining(v_brand,'REFUND10');
  v_l := pg_temp.i4624r_list(v_brand,v_id);
  IF (SELECT count(*) FROM public.tickets WHERE order_id=v_order AND status='refunded') <> 2
     OR v_u.returned_units <> 2 OR v_u.returned_at IS NOT NULL
     OR v_c->>'remainingUnits' <> '2' OR (v_l->>'consumedUnits')::integer <> 3
     OR (v_l->>'returnedUnits')::integer <> 2 THEN
    RAISE EXCEPTION 'T4-1 refund 2 of 5: want returned 2, remainingUnits 2, list 3 used; got use % cand % list %',
      to_jsonb(v_u),v_c,v_l;
  END IF;
  -- T4-3 (partial) the checkout still counts: Total uses and per buyer stay used.
  IF v_c->>'remainingTotalUses' <> '0' THEN
    RAISE EXCEPTION 'T4-3 partial refund must keep the use counted: %',v_c;
  END IF;
  -- T4-2 the same refund replayed changes nothing.
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624r_1',4500,'USD',NULL,NULL);
  IF public.issue_4624_sync_discount_returns(v_order) <> 0
     OR (pg_temp.i4624r_use(v_id,v_order)).returned_units <> 2 THEN
    RAISE EXCEPTION 'T4-2 replayed refund changed the returned units';
  END IF;
  -- T4-3 a full refund stamps returned_at and frees the use and the buyer.
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624r_2',6750,'USD',NULL,NULL);
  v_u := pg_temp.i4624r_use(v_id,v_order);
  v_c := public.issue_3872_discount_candidates(v_brand,'[]'::jsonb,'REFUND10',
    jsonb_build_object('email','t41@example.test'),now())->'code';
  IF v_u.returned_units <> 5 OR v_u.returned_at IS NULL
     OR v_c->>'remainingUnits' <> '5' OR v_c->>'remainingTotalUses' <> '1' OR v_c->>'remainingBuyerUses' <> '1' THEN
    RAISE EXCEPTION 'T4-3 full refund: want 5 returned, returned_at set, uses and buyer free; got use % cand %',
      to_jsonb(v_u),v_c;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- T4-5 refund_pending returns nothing until it settles as refunded.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','PENDING10','name','Pending ten','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_b := pg_temp.i4624r_buy(v_event,v_ga,2,'PENDING10','t45@example.test');
  v_order := (v_b->>'order')::uuid;
  UPDATE public.tickets SET status='refund_pending'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY id LIMIT 1);
  IF (pg_temp.i4624r_use(v_id,v_order)).returned_units <> 0 THEN
    RAISE EXCEPTION 'T4-5 refund_pending must not return a unit';
  END IF;
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order AND status='refund_pending';
  IF (pg_temp.i4624r_use(v_id,v_order)).returned_units <> 1 THEN
    RAISE EXCEPTION 'T4-5 settled refund must return 1 unit; got %',to_jsonb(pg_temp.i4624r_use(v_id,v_order));
  END IF;
  -- Undoing a void (a ticket back to valid) takes the unit back again (recompute).
  UPDATE public.tickets SET status='valid' WHERE order_id=v_order AND status='refunded';
  IF (pg_temp.i4624r_use(v_id,v_order)).returned_units <> 0 THEN
    RAISE EXCEPTION 'T4-5 a ticket back to valid must take its unit back';
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- T4-4 biz_cancel_order on a free code order returns every unit.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','FREEBIE','name','Freebie','valueType','percent',
    'valueBps',10000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_b := pg_temp.i4624r_buy(v_event,v_ga,3,'FREEBIE','t44@example.test',true);
  v_order := (v_b->>'order')::uuid;
  IF v_b->>'outcome' <> 'finalized' OR (pg_temp.i4624r_use(v_id,v_order)).units <> 3 THEN
    RAISE EXCEPTION 'T4-4 setup: free order on FREEBIE: %',v_b;
  END IF;
  PERFORM public.biz_cancel_order(v_order,'changed plans');
  v_u := pg_temp.i4624r_use(v_id,v_order);
  IF (SELECT count(*) FROM public.tickets WHERE order_id=v_order AND status='void') <> 3
     OR v_u.returned_units <> 3 OR v_u.returned_at IS NULL
     OR pg_temp.i4624r_remaining(v_brand,'FREEBIE')->>'remainingUnits' <> '5' THEN
    RAISE EXCEPTION 'T4-4 free-order cancel: want 3 void and 3 returned; got %',to_jsonb(v_u);
  END IF;

  -- T4-6 the two suspected routes.
  -- (a) Event cancel with a free code order: cancel_event_refund_prepare skips
  --     orders with nothing to refund and changes no ticket, so the events
  --     trigger gives the places back.
  v_b2 := pg_temp.i4624r_buy(v_event2,v_ga2,2,'FREEBIE','t46@example.test',true);
  v_order := (v_b2->>'order')::uuid;
  IF (pg_temp.i4624r_use(v_id,v_order)).units <> 2 THEN
    RAISE EXCEPTION 'T4-6 setup: free order on event 2: %',v_b2;
  END IF;
  PERFORM public.business_cancel_event(v_event2);
  PERFORM public.cancel_event_refund_prepare(v_event2);
  IF (SELECT count(*) FROM public.tickets WHERE order_id=v_order AND status IN ('void','refunded')) <> 0 THEN
    RAISE EXCEPTION 'T4-6a assumption changed: event cancel now voids or refunds free tickets';
  END IF;
  v_u := pg_temp.i4624r_use(v_id,v_order);
  IF (SELECT status FROM public.events WHERE id=v_event2) <> 'cancelled'
     OR v_u.returned_units <> 2 OR v_u.returned_at IS NULL THEN
    RAISE EXCEPTION 'T4-6a event cancel of a free order: want 2 returned; got % event %',
      to_jsonb(v_u),(SELECT status FROM public.events WHERE id=v_event2);
  END IF;
  -- (b) Host void from the guest list (biz_comp_cancel) voids comp tickets; the
  --     trigger fires and finds no discount use (comps never carry one).
  v_c := public.biz_comp_issue(v_owner,v_event,v_ga,NULL,
    jsonb_build_array(jsonb_build_object('index',0,'name','Comp Guest','email','comp@example.test','phoneE164',NULL)),
    'Press',gen_random_uuid(),'i4624r-test-pepper-0123456789abcdef0123456789abcd');
  v_order := (SELECT o.id FROM public.orders o WHERE o.event_id=v_event AND o.source='comp' ORDER BY o.created_at DESC LIMIT 1);
  PERFORM public.biz_comp_cancel(v_owner,v_order,'no show',gen_random_uuid());
  IF (SELECT count(*) FROM public.tickets WHERE order_id=v_order AND status='void') < 1
     OR EXISTS (SELECT 1 FROM public.discount_uses WHERE order_id=v_order) THEN
    RAISE EXCEPTION 'T4-6b comp cancel: want the ticket void and no discount use; got %',v_c;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- T4-7 the sweep reopens a code it ended on count once a refund frees a place.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','REOPEN','name','Reopen','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',2))->>'id')::uuid;
  v_b := pg_temp.i4624r_buy(v_event,v_ga,2,'REOPEN','t47@example.test');
  v_order := (v_b->>'order')::uuid;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status||'/'||ended_reason FROM public.brand_discounts WHERE id=v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'T4-7 setup: want ended/count';
  END IF;
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624r_7',2250,'USD',NULL,NULL);
  v_m := public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'active'
     OR (SELECT ended_reason FROM public.brand_discounts WHERE id=v_id) IS NOT NULL
     OR (pg_temp.i4624r_list(v_brand,v_id)->>'consumedUnits')::integer <> 1 THEN
    RAISE EXCEPTION 'T4-7 refund freed a place: want active again; got %',
      (SELECT to_jsonb(d) FROM public.brand_discounts d WHERE id=v_id);
  END IF;
  -- Host-ended and window-ended codes never reopen.
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'ended' THEN
    RAISE EXCEPTION 'T4-7 a host-ended code reopened';
  END IF;
  UPDATE public.brand_discounts SET ended_reason='window' WHERE id=v_id;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'ended' THEN
    RAISE EXCEPTION 'T4-7 a window-ended code reopened';
  END IF;
  -- A run-out code whose text a live code now uses stays ended.
  UPDATE public.brand_discounts SET ended_reason='count' WHERE id=v_id;
  v_id2 := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','REOPEN','name','Reopen two','valueType','percent',
    'valueBps',500,'scopeKind','brand'))->>'id')::uuid;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'ended' THEN
    RAISE EXCEPTION 'T4-7 reopened over a live code with the same text';
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id2;

  -- T5 late payments ------------------------------------------------------------------
  -- T5-3 extend_discount_hold moves expires_at only for limited discounts, only forward.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','LATECAP','name','Late cap','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_id2 := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','OPENTEN','name','Open ten','valueType','percent',
    'valueBps',1000,'scopeKind','brand'))->>'id')::uuid;
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Late','late@example.test','+1555'||lpad((abs(hashtext('late@example.test'))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',3)),'i4624r-late-a',
    now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'LATECAP',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  v_b := public.biz_ticket_checkout_create_session(v_event,NULL,'Open','open@example.test','+1555'||lpad((abs(hashtext('open@example.test'))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',1)),'i4624r-open-a',
    now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'OPENTEN',NULL);
  -- Separate statements: an UPDATE inside a function is not visible to the
  -- same expression's other subqueries.
  v_n := public.issue_4624_extend_discount_hold(v_session,now()+interval '32 minutes');
  IF v_n <> 1 OR public.issue_4624_extend_discount_hold((v_b->>'checkoutSessionId')::uuid,now()+interval '32 minutes') <> 0 THEN
    RAISE EXCEPTION 'T5-3 extend: want 1 capped row and 0 uncapped rows';
  END IF;
  IF (SELECT expires_at FROM public.discount_uses WHERE checkout_ref_id=v_session) < now()+interval '31 minutes'
     OR (SELECT expires_at FROM public.discount_uses WHERE checkout_ref_id=(v_b->>'checkoutSessionId')::uuid) > now()+interval '16 minutes' THEN
    RAISE EXCEPTION 'T5-3 extend: want the capped hold at +32 min and the uncapped one untouched';
  END IF;
  PERFORM public.issue_4624_extend_discount_hold(v_session,now()+interval '5 minutes');
  IF (SELECT expires_at FROM public.discount_uses WHERE checkout_ref_id=v_session) < now()+interval '31 minutes' THEN
    RAISE EXCEPTION 'T5-3 extend moved a hold backwards';
  END IF;
  -- T5-4 a session expired before its extended hold keeps counting; failed releases.
  UPDATE public.ticket_checkout_sessions SET status='expired' WHERE id=v_session;
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session) <> 'reserved'
     OR pg_temp.i4624r_remaining(v_brand,'LATECAP')->>'remainingUnits' <> '2' THEN
    RAISE EXCEPTION 'T5-4 expired session with a live extended hold must keep counting';
  END IF;
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Fail','fail@example.test','+1555'||lpad((abs(hashtext('fail@example.test'))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',1)),'i4624r-fail-a',
    now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'LATECAP',NULL);
  PERFORM public.issue_4624_extend_discount_hold((v_r->>'checkoutSessionId')::uuid,now()+interval '32 minutes');
  UPDATE public.ticket_checkout_sessions SET status='failed' WHERE id=(v_r->>'checkoutSessionId')::uuid;
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=(v_r->>'checkoutSessionId')::uuid) <> 'released' THEN
    RAISE EXCEPTION 'T5-4 failed session must release at once';
  END IF;
  -- The sweep releases a dead session's hold once its own expiry has passed.
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session) <> 'released' THEN
    RAISE EXCEPTION 'T5-4 sweep did not release a lapsed hold of an expired session';
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id IN (v_id,v_id2);

  -- T5-1 tester probe: A holds 3, the hold lapses, B takes 5, A pays late.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','OVERCAP','name','Over cap','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Slow','slow@example.test','+1555'||lpad((abs(hashtext('slow@example.test'))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',3)),'i4624r-slow',
    now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'OVERCAP',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  v_b := pg_temp.i4624r_buy(v_event,v_ga,5,'OVERCAP','fast@example.test');
  IF (pg_temp.i4624r_use(v_id,(v_b->>'order')::uuid)).units <> 5 THEN
    RAISE EXCEPTION 'T5-1 setup: the fast buyer should take all 5: %',v_b;
  END IF;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_i4624r_slow','ch_i4624r_slow','card','i4624r-test-pepper-0123456789abcdef0123456789abcd');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  v_c := jsonb_build_object('outcome','finalized','orderId',(SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  v_u := pg_temp.i4624r_use(v_id,(v_c->>'orderId')::uuid);
  v_l := pg_temp.i4624r_list(v_brand,v_id,'live');
  IF v_c->>'outcome' <> 'finalized' OR v_u.status <> 'consumed' OR v_u.over_limit_units <> 3
     OR v_u.over_limit_uses OR (v_l->>'consumedUnits')::integer <> 8 OR (v_l->>'overLimitUnits')::integer <> 3 THEN
    RAISE EXCEPTION 'T5-1 late consume past the cap: want consumed, 3 over the limit, list 8 used / 3 over; got % use % list %',
      v_c,to_jsonb(v_u),v_l;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  -- T5-2 a late consume with room left records no overrun.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','ROOMCAP','name','Room cap','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Slow','slow2@example.test','+1555'||lpad((abs(hashtext('slow2@example.test'))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',3)),'i4624r-slow2',
    now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'ROOMCAP',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_i4624r_slow2','ch_i4624r_slow2','card','i4624r-test-pepper-0123456789abcdef0123456789abcd');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  v_c := jsonb_build_object('outcome','finalized','orderId',(SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  v_u := pg_temp.i4624r_use(v_id,(v_c->>'orderId')::uuid);
  IF v_u.status <> 'consumed' OR v_u.over_limit_units <> 0 OR v_u.over_limit_uses THEN
    RAISE EXCEPTION 'T5-2 late consume with room: want no overrun; got %',to_jsonb(v_u);
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  -- T5-6 a late consume past max_total_uses sets over_limit_uses.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','USECAP','name','Use cap','valueType','percent',
    'valueBps',1000,'scopeKind','brand','maxTotalUses',1))->>'id')::uuid;
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Slow','slow3@example.test','+1555'||lpad((abs(hashtext('slow3@example.test'))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',1)),'i4624r-slow3',
    now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'USECAP',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  PERFORM pg_temp.i4624r_buy(v_event,v_ga,1,'USECAP','fast3@example.test');
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_i4624r_slow3','ch_i4624r_slow3','card','i4624r-test-pepper-0123456789abcdef0123456789abcd');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  v_c := jsonb_build_object('outcome','finalized','orderId',(SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  v_u := pg_temp.i4624r_use(v_id,(v_c->>'orderId')::uuid);
  IF v_u.status <> 'consumed' OR NOT v_u.over_limit_uses OR v_u.over_limit_units <> 0 THEN
    RAISE EXCEPTION 'T5-6 late consume past Total uses: want over_limit_uses; got %',to_jsonb(v_u);
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- TP3-3 GA 25 x3 + VIP 50 x3 on cap 3: VIP (bigger saving) free, notice on GA.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','BESTFIRST','name','Best first','valueType','percent',
    'valueBps',10000,'scopeKind','brand','endsAfterCount',3))->>'id')::uuid;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624r_line(v_ga,v_event,2500,3),pg_temp.i4624r_line(v_vip,v_event,5000,3)),
    'BESTFIRST',jsonb_build_object('email','tp33@example.test'));
  IF (v_q->>'discountMinor')::integer <> 15000 OR v_q#>>'{notices,0,lineRef}' <> v_ga::text
     OR jsonb_array_length(v_q->'notices') <> 1 OR v_q#>>'{lines,0,lineRef}' <> least(v_ga::text,v_vip::text) THEN
    RAISE EXCEPTION 'TP3-3 best saving first: want VIP free and a notice on GA, lines in lineRef order; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- TP3-4 both limits: uses at 80%, tickets at 20% -> limit_80 with left in uses.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','WARNUSES','name','Warn uses','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',20,'maxTotalUses',5))->>'id')::uuid;
  FOR v_n IN 1..4 LOOP
    PERFORM public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
        pg_temp.i4624r_line(v_ga,v_event,2500,1)),'WARNUSES',jsonb_build_object('email',format('tp34-%s@example.test',v_n)),
      NULL,now()+interval '1 day',true,'online');
  END LOOP;
  v_m := public.issue_3872_discount_maintenance(now());
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_m->'notify') x
      WHERE x->>'discountId'=v_id::text AND x->>'type'='business.discount_limit_80' AND x->>'left'='1') THEN
    RAISE EXCEPTION 'TP3-4 uses at 4/5, tickets at 4/20: want limit_80 with left 1; got %',v_m;
  END IF;

  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- T6 normalised basket lines -----------------------------------------------------
  -- T6-1 a session with the same ticket type twice is refused and holds nothing.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','DUPCAP','name','Dup cap','valueType','percent',
    'valueBps',10000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_err := 'created';
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(v_event,NULL,'Dup','dup@example.test',
      '+15555557001',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',3),
                        jsonb_build_object('ticketTypeId',v_ga,'quantity',3)),
      'i4624r-dup',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'DUPCAP',NULL);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
  END;
  IF v_err <> 'checkout_lines_duplicate'
     OR EXISTS (SELECT 1 FROM public.discount_uses WHERE discount_id=v_id)
     OR EXISTS (SELECT 1 FROM public.ticket_checkout_sessions WHERE idempotency_key='i4624r-dup') THEN
    RAISE EXCEPTION 'T6-1 duplicate basket lines: want checkout_lines_duplicate and nothing held; got %',v_err;
  END IF;
  -- The same basket as one line is held and capped as usual.
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Dup','dup@example.test',
    '+15555557001',false,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',6)),
    'i4624r-dup-one',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'DUPCAP',NULL);
  IF (v_r->>'discountCents')::integer <> 0
     OR EXISTS (SELECT 1 FROM public.discount_uses WHERE discount_id=v_id) THEN
    RAISE EXCEPTION 'T6-1 one line of 6 on cap 5: want no discount and no hold; got %',v_r;
  END IF;
  -- T6-4 the applied discount says whether it is limited (the edge extends
  -- holds only for those).
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,2500,1)),'DUPCAP',jsonb_build_object('email','t64@example.test'));
  IF (v_q#>>'{applied,0,limited}')::boolean IS DISTINCT FROM true
     OR (v_q#>>'{lines,0,applied,0,limited}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T6-4 capped code: want limited true on applied; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  v_id2 := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','OPENDUP','name','Open dup','valueType','percent',
    'valueBps',1000,'scopeKind','brand'))->>'id')::uuid;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
    pg_temp.i4624r_line(v_ga,v_event,2500,1)),'OPENDUP',jsonb_build_object('email','t64@example.test'));
  IF (v_q#>>'{applied,0,limited}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T6-4 uncapped code: want limited false; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id2;
  -- T6-2 an order already written with the same ticket type on two lines (the
  -- pre-normalisation shape): returns count each dead ticket once and never
  -- exceed the use's units.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','LEGACYDUP','name','Legacy dup','valueType','percent',
    'valueBps',10000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_order := gen_random_uuid(); v_line1 := gen_random_uuid(); v_line2 := gen_random_uuid();
  INSERT INTO public.orders(id,event_id,buyer_email,buyer_name,buyer_phone,buyer_phone_e164,total_cents,
    currency,payment_method,payment_status,source,notification_status)
  VALUES(v_order,v_event,'legacy@example.test','Legacy','+15555557002','+15555557002',0,'USD','free','paid',
    'online_checkout','pending');
  INSERT INTO public.order_line_items(id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents) VALUES
    (v_line1,v_order,v_ga,3,0,0),(v_line2,v_order,v_ga,3,0,0);
  INSERT INTO public.order_discount_lines(order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,
    name_snapshot,value_type,value_bps,units,amount_minor,applied_seq,currency) VALUES
    ('ticket',v_order,v_line1::text,v_id,v_brand,'code','LEGACYDUP','Legacy dup','percent',10000,3,7500,1,'USD'),
    ('ticket',v_order,v_line2::text,v_id,v_brand,'code','LEGACYDUP','Legacy dup','percent',10000,3,7500,1,'USD');
  INSERT INTO public.discount_uses(discount_id,brand_id,checkout_kind,checkout_ref_id,order_id,buyer_email_norm,
    status,units,amount_minor,expires_at,consumed_at)
  VALUES(v_id,v_brand,'ticket',gen_random_uuid(),v_order,'legacy@example.test','consumed',3,7500,now(),now());
  INSERT INTO public.tickets(order_id,ticket_type_id,event_id,status,qr_code)
    SELECT v_order,v_ga,v_event,'valid','i4624r-legacy-'||g FROM generate_series(1,6) g;
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY qr_code LIMIT 1);
  IF (pg_temp.i4624r_use(v_id,v_order)).returned_units <> 1 THEN
    RAISE EXCEPTION 'T6-2 one refunded ticket on a two-line order: want 1 back; got %',
      to_jsonb(pg_temp.i4624r_use(v_id,v_order));
  END IF;
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order;
  v_u := pg_temp.i4624r_use(v_id,v_order);
  IF v_u.returned_units <> 3 OR v_u.returned_at IS NULL THEN
    RAISE EXCEPTION 'T6-2 every ticket refunded: want exactly the 3 consumed units back; got %',to_jsonb(v_u);
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- T6-3 (P3-1) extending a hold that already lapsed changes nothing.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','LAPSED','name','Lapsed','valueType','percent',
    'valueBps',1000,'scopeKind','brand','endsAfterCount',5))->>'id')::uuid;
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Lapsed','lapsed@example.test',
    '+15555557003',false,jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',1)),
    'i4624r-lapsed',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'LAPSED',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  v_n := public.issue_4624_extend_discount_hold(v_session,now()+interval '32 minutes');
  IF v_n <> 0 OR (SELECT expires_at FROM public.discount_uses WHERE checkout_ref_id=v_session) >= now() THEN
    RAISE EXCEPTION 'T6-3 a lapsed hold was extended (% rows)',v_n;
  END IF;

  RAISE NOTICE 'issue_4624_code_ticket_limit rework: PASS (T2-1..TP3-4, T6-1..T6-4)';
END;
$rework$;

ROLLBACK;

-- T9 parallel reservations (needs committed fixtures and two real sessions) ---
CREATE SCHEMA i4624_race;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA i4624_race;
SELECT n.nspname AS i4624_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"i4624_dblink_schema";
CREATE TABLE i4624_race.conn AS
  SELECT format('host=127.0.0.1 port=%s dbname=%s user=supabase_admin password=%s',
    current_setting('port'), current_database(), :'i4624_pw') AS conn;

DO $setup$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000201';
  v_brand uuid := '46240000-0000-4000-8100-000000000201';
  v_event uuid := '46240000-0000-4000-8200-000000000201';
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-race-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-race-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 race brand','issue-4624-race-brand','USD','stripe','US','US','USD');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'Race Night','issue-4624-race-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES ('46240000-0000-4000-8300-000000000201',v_event,'General',2500,'USD',false,100,false,1,10,true,false,true);
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','RACECAP','name','Race cap',
    'valueType','percent','valueBps',10000,'scopeKind','brand','endsAfterCount',5));
END;
$setup$;

CREATE TABLE i4624_race.flag AS
  SELECT is_enabled FROM public.feature_flags WHERE flag_key='discounts_enabled';
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';

DO $race$
DECLARE
  v_conn text := (SELECT conn FROM i4624_race.conn);
  v_call text := $call$
    public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),
      '46240000-0000-4000-8100-000000000201','USD',
      jsonb_build_array(jsonb_build_object('lineRef','46240000-0000-4000-8300-000000000201',
        'itemKind','ticket_type','itemId','46240000-0000-4000-8300-000000000201',
        'listingId','46240000-0000-4000-8200-000000000201','listingKind','event',
        'listUnitMinor',2500,'qty',3,'valueScale',1,'countScale',1,'allowed',true,'tz','UTC')),
      'RACECAP',jsonb_build_object('email',%L),NULL,now()+interval '15 minutes',false,'online')
  $call$;
  v_a integer;
  v_b integer;
  v_b_notice text;
  v_units integer;
BEGIN
  PERFORM dblink_connect('issue4624_a',v_conn);
  PERFORM dblink_connect('issue4624_b',v_conn);
  -- Session A reserves 3 and keeps its statement (and the row lock) open 1.5 s.
  PERFORM dblink_send_query('issue4624_a',format(
    'SELECT (%s->''quote''->>''discountMinor'')::integer, pg_sleep(1.5) IS NULL',
    format(v_call,'race-a@example.test')));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('issue4624_b',format(
    'SELECT (r->''quote''->>''discountMinor'')::integer, r->''quote''#>>''{notices,0,remaining}'' FROM (SELECT %s r) q',
    format(v_call,'race-b@example.test')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('issue4624_b') <> 1 THEN
    RAISE EXCEPTION 'T9 the second reservation did not wait for the first one''s lock';
  END IF;
  SELECT a INTO v_a FROM dblink_get_result('issue4624_a') AS t(a integer, slept boolean);
  SELECT b,n INTO v_b,v_b_notice FROM dblink_get_result('issue4624_b') AS t(b integer, n text);
  PERFORM dblink_disconnect('issue4624_a');
  PERFORM dblink_disconnect('issue4624_b');
  SELECT COALESCE(sum(u.units),0) INTO v_units FROM public.discount_uses u
    JOIN public.brand_discounts d ON d.id=u.discount_id
    WHERE d.brand_id='46240000-0000-4000-8100-000000000201' AND u.status IN ('reserved','consumed');
  IF v_a <> 7500 OR v_b <> 0 OR v_b_notice IS DISTINCT FROM '2' OR v_units <> 3 THEN
    RAISE EXCEPTION 'T9 parallel 3+3 on cap 5: want A 7500, B 0 with notice remaining 2 and 3 units held; got A %, B %, notice %, units %',
      v_a,v_b,v_b_notice,v_units;
  END IF;
  RAISE NOTICE 'issue_4624_code_ticket_limit: PASS (T9 parallel reservations serialise)';
END;
$race$;


-- T5-5 a late consume and a parallel reservation of the same capped code
-- serialise on the discount lock, in either start order, with no deadlock.
-- Both sides go through the real functions: the late side through
-- issue_3872_copy_session_totals_to_order (the finalize hook), the other through
-- biz_ticket_checkout_create_session (ticket types, then discounts, the same
-- lock order the finalize path takes).
DO $t55setup$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000501';
  v_brand uuid := '46240000-0000-4000-8100-000000000501';
  v_event uuid := '46240000-0000-4000-8200-000000000501';
  v_tt uuid := '46240000-0000-4000-8300-000000000501';
  v_created jsonb; v_session uuid; v_order uuid; v_code text; v_i integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-t55-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-t55-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 t55 brand','issue-4624-t55-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624_t55',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'T55 Night','issue-4624-t55-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES(v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES (v_tt,v_event,'General',2500,'USD',false,100,false,1,10,true,false,true);
  -- One code and one late session per start order.
  FOREACH v_code IN ARRAY ARRAY['RACEL1','RACEL2'] LOOP
    PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
      'brandId',v_brand,'kind','code','code',v_code,'name','Race '||v_code,
      'valueType','percent','valueBps',1000,'scopeKind','brand','endsAfterCount',5));
    v_created := public.biz_ticket_checkout_create_session(
      v_event,NULL,'Late',lower(v_code)||'-late@example.test','+15555554'||right(v_code,1)||'01',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_tt,'quantity',3)),
      'i4624-t55-late-'||v_code,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,v_code,NULL);
    v_session := (v_created->>'checkoutSessionId')::uuid;
    -- The hold lapses before the payment lands.
    UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
    v_order := gen_random_uuid();
    INSERT INTO public.orders(
      id,event_id,buyer_email,buyer_name,buyer_phone,buyer_phone_e164,total_cents,
      currency,payment_method,payment_status,checkout_session_id,source,notification_status
    ) VALUES(v_order,v_event,lower(v_code)||'-late@example.test','Late','+15555554'||right(v_code,1)||'01',
      '+15555554'||right(v_code,1)||'01',6750,'USD','online_card','paid',v_session,'online_checkout','pending');
    INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
      VALUES(v_order,v_tt,3,2250,6750);
    UPDATE public.ticket_checkout_sessions SET order_id=v_order,
      list_subtotal_cents=7500,discount_cents=750,net_subtotal_cents=6750,
      buyer_fees_cents=0,tax_cents=0,buyer_total_cents=6750,pricing_source='computed_at_checkout'
      WHERE id=v_session;
  END LOOP;
END;
$t55setup$;

DO $t55$
DECLARE
  v_conn text := (SELECT conn FROM i4624_race.conn);
  v_late1 uuid := (SELECT s.id FROM public.ticket_checkout_sessions s
    WHERE s.idempotency_key='i4624-t55-late-RACEL1');
  v_late2 uuid := (SELECT s.id FROM public.ticket_checkout_sessions s
    WHERE s.idempotency_key='i4624-t55-late-RACEL2');
  v_create text := $c$
    public.biz_ticket_checkout_create_session(
      '46240000-0000-4000-8200-000000000501',NULL,'Other',%L,'+15555555901',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId','46240000-0000-4000-8300-000000000501','quantity',3)),
      %L,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,%L,NULL)
  $c$;
  v_status text; v_disc integer; v_over integer; v_units integer;
BEGIN
  IF v_late1 IS NULL OR v_late2 IS NULL THEN
    RAISE EXCEPTION 'T5-5 setup: late sessions not found';
  END IF;
  -- Order 1: the late consume takes the lock first; the reservation waits and
  -- then sees 3 consumed, so it gets no discount (2 left < 3).
  PERFORM dblink_connect('i4624_l1',v_conn);
  PERFORM dblink_connect('i4624_r1',v_conn);
  PERFORM dblink_send_query('i4624_l1',format(
    'SELECT (public.issue_3872_copy_session_totals_to_order(%L) IS NULL), pg_sleep(1.5) IS NULL',v_late1));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4624_r1',format(
    'SELECT (r->>''discountCents'')::integer FROM (SELECT %s r) q',
    format(v_create,'race1-other@example.test','i4624-t55-other-1','RACEL1')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('i4624_r1') <> 1 THEN
    RAISE EXCEPTION 'T5-5 order 1: the reservation did not wait for the late consume';
  END IF;
  PERFORM * FROM dblink_get_result('i4624_l1') AS t(a boolean,b boolean);
  SELECT d INTO v_disc FROM dblink_get_result('i4624_r1') AS t(d integer);
  PERFORM dblink_disconnect('i4624_l1');
  PERFORM dblink_disconnect('i4624_r1');
  SELECT status,over_limit_units INTO v_status,v_over FROM public.discount_uses WHERE checkout_ref_id=v_late1;
  IF v_status <> 'consumed' OR v_over <> 0 OR v_disc <> 0 THEN
    RAISE EXCEPTION 'T5-5 order 1: want late consumed (no overrun) and the reservation undiscounted; got %, %, %',
      v_status,v_over,v_disc;
  END IF;

  -- Order 2: the reservation takes the lock first and holds 3; the late
  -- consume waits, then counts the live hold and records 1 over the limit.
  PERFORM dblink_connect('i4624_l2',v_conn);
  PERFORM dblink_connect('i4624_r2',v_conn);
  PERFORM dblink_send_query('i4624_r2',format(
    'SELECT (r->>''discountCents'')::integer, pg_sleep(1.5) IS NULL FROM (SELECT %s r) q',
    format(v_create,'race2-other@example.test','i4624-t55-other-2','RACEL2')));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4624_l2',format(
    'SELECT (public.issue_3872_copy_session_totals_to_order(%L) IS NULL)',v_late2));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('i4624_l2') <> 1 THEN
    RAISE EXCEPTION 'T5-5 order 2: the late consume did not wait for the reservation';
  END IF;
  SELECT d INTO v_disc FROM dblink_get_result('i4624_r2') AS t(d integer,s boolean);
  PERFORM * FROM dblink_get_result('i4624_l2') AS t(a boolean);
  PERFORM dblink_disconnect('i4624_l2');
  PERFORM dblink_disconnect('i4624_r2');
  SELECT status,over_limit_units INTO v_status,v_over FROM public.discount_uses WHERE checkout_ref_id=v_late2;
  SELECT COALESCE(sum(units),0) INTO v_units FROM public.discount_uses u
    JOIN public.brand_discounts d ON d.id=u.discount_id WHERE d.code='RACEL2'
      AND d.brand_id='46240000-0000-4000-8100-000000000501' AND u.status IN ('reserved','consumed');
  IF v_disc <> 750 OR v_status <> 'consumed' OR v_over <> 1 OR v_units <> 6 THEN
    RAISE EXCEPTION 'T5-5 order 2: want the reservation discounted, the late row consumed with 1 over the limit (6 units); got %, %, %, %',
      v_disc,v_status,v_over,v_units;
  END IF;
  RAISE NOTICE 'issue_4624_code_ticket_limit: PASS (T5-5 late consume and reservation serialise, both orders)';
END;
$t55$;

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.discount_uses WHERE brand_id='46240000-0000-4000-8100-000000000501';
DELETE FROM public.order_discount_lines WHERE brand_id='46240000-0000-4000-8100-000000000501';
DELETE FROM public.order_line_items li USING public.orders o
  WHERE li.order_id=o.id AND o.event_id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.orders WHERE event_id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.ticket_checkout_session_items i USING public.ticket_checkout_sessions x
  WHERE i.checkout_session_id=x.id AND x.event_id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.ticket_checkout_sessions WHERE event_id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.brand_discount_targets t USING public.brand_discounts d
  WHERE t.discount_id=d.id AND d.brand_id='46240000-0000-4000-8100-000000000501';
DELETE FROM public.brand_discounts WHERE brand_id='46240000-0000-4000-8100-000000000501';
DELETE FROM public.ticket_types WHERE event_id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.event_dates WHERE event_id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.events WHERE id='46240000-0000-4000-8200-000000000501';
DELETE FROM public.stripe_connect_accounts WHERE brand_id='46240000-0000-4000-8100-000000000501';
DELETE FROM public.brands WHERE id='46240000-0000-4000-8100-000000000501';
DELETE FROM public.creator_accounts WHERE id='46240000-0000-4000-8000-000000000501';
DELETE FROM auth.users WHERE id='46240000-0000-4000-8000-000000000501';
UPDATE public.feature_flags f SET is_enabled=x.is_enabled FROM i4624_race.flag x WHERE f.flag_key='discounts_enabled';
DELETE FROM public.discount_uses WHERE brand_id='46240000-0000-4000-8100-000000000201';
DELETE FROM public.brand_discount_targets t USING public.brand_discounts d
  WHERE t.discount_id=d.id AND d.brand_id='46240000-0000-4000-8100-000000000201';
DELETE FROM public.brand_discounts WHERE brand_id='46240000-0000-4000-8100-000000000201';
DELETE FROM public.ticket_types WHERE id='46240000-0000-4000-8300-000000000201';
DELETE FROM public.events WHERE id='46240000-0000-4000-8200-000000000201';
DELETE FROM public.brands WHERE id='46240000-0000-4000-8100-000000000201';
DELETE FROM public.creator_accounts WHERE id='46240000-0000-4000-8000-000000000201';
DELETE FROM auth.users WHERE id='46240000-0000-4000-8000-000000000201';
COMMIT;
RESET search_path;
DROP SCHEMA i4624_race CASCADE;
\echo 'issue #4624 code ticket limit suite passed (T1-T9, rework T2-1..TP3-4, T5-5)'
