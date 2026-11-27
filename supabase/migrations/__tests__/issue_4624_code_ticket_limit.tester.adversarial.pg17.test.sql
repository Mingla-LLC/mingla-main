-- MINGLA-INVARIANT: I-4624-18 | issue #4624 | A discount's places come back only for tickets it discounted that are refunded, voided or on a cancelled event, exactly once (no double count across refund, void and event cancel; replays change nothing); a chargeback alone returns nothing; a returned place reopens a run-out code only inside its dates, undeleted, with no live code of the same text.
-- MINGLA-INVARIANT: I-4624-24 | issue #4624 | A checkout session holds one line per ticket type (a repeat, in any letter case, is refused and holds nothing), an order already holding two lines of one ticket type never gets back more places than tickets refunded or than it consumed, and only a live hold is ever extended.
-- MINGLA-INVARIANT: I-4624-19 | issue #4624 | A late payment on a lapsed capped hold is honoured and recorded over the limit where the host list reads it, remaining never drops below 0, and a refund never waits on (or deadlocks with) a checkout holding the discount lock.
-- MINGLA-INVARIANT: I-4624-11 | issue #4624 | A ticket-capped code counts only discounted tickets (one unit per ticket issued, never free or discounts-off lines), releases expired holds, stays capped across multi-line baskets and both limits, and leaves automatic and sale-price pricing unchanged.
-- Issue #4624 tester adversarial suite: ticket-capped discount codes
-- (brand_discounts.ends_after_count on kind 'code'), on the fully replayed
-- PostgreSQL 17 schema with 20281206014624_issue_4624_code_ticket_limit.sql
-- applied. Angles the implementor's T1-T9 do not take:
--   A1  multi-line baskets: 6+1 on cap 5 (first line skipped, second
--       discounted), 3+3 reserved end to end, then the buyer lowers the second
--       line as the notice says and both lines are discounted (5 units), then
--       the code is used_up.
--   A2  countScale > 1 (all-days pass / block booking): after the #4624 rework
--       (D-3a) one pass or booking is one unit, so a single line never reads
--       remaining 0 (the old P2-2).
--   A3  reservation expiry: a live hold of all 5 makes the code used_up for
--       another buyer; once the hold's expires_at passes its units are free.
--   A4  max_total_uses 2 + ends_after_count 5: two 1-ticket checkouts end it;
--       one 5-ticket checkout ends it too.
--   A5  max_uses_per_buyer 1 + ends_after_count 5: per-buyer and ticket caps
--       both bite; a basket over the cap writes no use row, so it does not burn
--       the buyer's one use.
--   A6  code with a cap + a brand automatic (combines automatic_only): the
--       automatic keeps applying to a line the code skips.
--   A7  editing ends_after_count below the units already used: the update
--       saves, the candidate reads remainingUnits 0, the code is used_up and
--       the maintenance sweep ends it with reason 'count'.
--   A8  free tickets and discounts-off tickets in the basket use no units.
--   A9  automatic and sale_price notices carry no discountKind (unchanged),
--       and the writer still refuses ends_after_count 0 / negatives.
--   A10 catalog: SECURITY DEFINER, search_path and grants of the two replaced
--       functions are unchanged; bd_count_end now allows codes.
-- #4624 rework: A1 follows best-saving-first (P3-3: VIP before General) and A2
-- follows one unit per ticket issued (D-3a); both expectations were updated by
-- the implementor and re-checked by the tester against spec 7206302208. In A1
-- the buyer now follows the notice as worded ("Lower General to 2").
-- Retest A11-A24 (after A10) cover refunds, cancels, chargebacks, reopening,
-- late payments, stacked discounts, ties, the 80% warning and a refund racing a
-- checkout. Runs as supabase_admin (A24's dblink needs a password login).
-- FAILS-ON-REVERT: with origin/main's functions and constraint (the migration
-- reverted) the first code create with endsAfterCount fails on bd_count_end;
-- with only the constraint lifted, A1 fails (the 6-ticket line is discounted).
\set ON_ERROR_STOP on
\getenv i4624t_pw PGPASSWORD
BEGIN;

CREATE FUNCTION pg_temp.i4624t_line(p_tt uuid, p_event uuid, p_price integer, p_qty integer,
  p_count_scale integer DEFAULT 1, p_allowed boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('lineRef',p_tt,'itemKind','ticket_type','itemId',p_tt,
    'listingId',p_event,'listingKind','event','listUnitMinor',p_price,'qty',p_qty,
    'valueScale',1,'countScale',p_count_scale,'allowed',p_allowed,'tz','UTC');
$f$;

CREATE FUNCTION pg_temp.i4624t_code(p_owner uuid, p_brand uuid, p_code text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_3872_upsert_discount(p_owner,'create',jsonb_build_object(
    'brandId',p_brand,'kind','code','code',p_code,'name','Cap '||p_code,
    'valueType','percent','valueBps',10000,'scopeKind','brand') || p_extra);
  RETURN (SELECT id FROM public.brand_discounts WHERE brand_id=p_brand AND code=p_code);
END;
$f$;

CREATE FUNCTION pg_temp.i4624t_units(p_discount uuid)
RETURNS integer LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(sum(units),0)::integer FROM public.discount_uses
  WHERE discount_id=p_discount AND status IN ('reserved','consumed');
$f$;

DO $test$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-0000000000a1';
  v_brand uuid := '46240000-0000-4000-8100-0000000000a1';
  v_event uuid := '46240000-0000-4000-8200-0000000000a1';
  v_ga uuid := '46240000-0000-4000-8300-0000000000a1';   -- General 25.00
  v_vip uuid := '46240000-0000-4000-8300-0000000000a2';  -- VIP 50.00
  v_free uuid := '46240000-0000-4000-8300-0000000000a3'; -- free
  v_off uuid := '46240000-0000-4000-8300-0000000000a4';  -- discounts off
  v_id uuid;
  v_q jsonb;
  v_r jsonb;
  v_c jsonb;
  v_hold uuid;
  v_n integer;
  v_err text;
  v_row public.brand_discounts%ROWTYPE;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-tester-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-tester-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 tester brand','issue-4624-tester-brand','USD','stripe','US','US','USD');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'Tester Night','issue-4624-tester-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES
    (v_ga,v_event,'General',2500,'USD',false,100,false,1,10,true,false,true),
    (v_vip,v_event,'VIP',5000,'USD',false,100,false,1,10,true,false,true),
    (v_free,v_event,'Free',0,'USD',true,100,false,1,10,true,false,true),
    (v_off,v_event,'No discounts',4000,'USD',false,100,false,1,10,true,false,false);

  -- A1 multi-line baskets ------------------------------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'MULTIA',jsonb_build_object('endsAfterCount',5));
  -- 6 + 1: VIP (the bigger saving) is visited first and fits; General (6)
  -- then does not fit the 4 left.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,6), pg_temp.i4624t_line(v_vip,v_event,5000,1)),
    'MULTIA',jsonb_build_object('email','a1x@example.test'));
  IF (v_q->>'discountMinor')::integer <> 5000
     OR jsonb_array_length(v_q->'notices') <> 1
     OR v_q#>>'{notices,0,lineRef}' <> v_ga::text
     OR v_q#>>'{notices,0,remaining}' <> '4'
     OR v_q#>>'{notices,0,discountKind}' IS DISTINCT FROM 'code'
     OR (v_q#>>'{applied,0,units}')::integer <> 1
     OR v_q->'codeOutcome'->>'status' <> 'applied' THEN
    RAISE EXCEPTION 'A1 6+1 on cap 5: want only the 1-ticket VIP line free, notice remaining 4 on General; got %',v_q;
  END IF;
  -- 3 + 3 reserved: VIP (bigger saving) discounted, General notice remaining 2, 3 units held.
  v_hold := gen_random_uuid();
  v_r := public.issue_3872_reserve_discount_uses('ticket',v_hold,v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,3), pg_temp.i4624t_line(v_vip,v_event,5000,3)),
    'MULTIA',jsonb_build_object('email','a1y@example.test'),NULL,now()+interval '15 minutes',false,'online');
  v_q := v_r->'quote';
  IF NOT (v_r->>'ok')::boolean OR (v_q->>'discountMinor')::integer <> 15000
     OR jsonb_array_length(v_q->'notices') <> 1
     OR v_q#>>'{notices,0,lineRef}' <> v_ga::text OR v_q#>>'{notices,0,remaining}' <> '2'
     OR jsonb_array_length(v_q->'applied') <> 1 OR pg_temp.i4624t_units(v_id) <> 3
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id) <> 1 THEN
    RAISE EXCEPTION 'A1 3+3 reserve on cap 5: want VIP free, General notice remaining 2, one use row of 3 units; got % units %',v_q,pg_temp.i4624t_units(v_id);
  END IF;
  -- The buyer follows the notice ("Lower General to 2"): 2 + 3, both lines fit.
  PERFORM public.issue_3872_release_discount_uses('ticket',v_hold);
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,2), pg_temp.i4624t_line(v_vip,v_event,5000,3)),
    'MULTIA',jsonb_build_object('email','a1y@example.test'),NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 20000 OR jsonb_array_length(v_r->'quote'->'notices') <> 0
     OR pg_temp.i4624t_units(v_id) <> 5 THEN
    RAISE EXCEPTION 'A1 2+3 after lowering General: want both lines free and 5 units used; got % units %',v_r->'quote',pg_temp.i4624t_units(v_id);
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'MULTIA',jsonb_build_object('email','a1z@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' OR (v_q->>'discountMinor')::integer <> 0 THEN
    RAISE EXCEPTION 'A1 after 5 tickets: want used_up; got %',v_q;
  END IF;

  -- A2 countScale > 1 ---------------------------------------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'PASSCAP',jsonb_build_object('endsAfterCount',5));
  -- 2 passes x 3 days = 2 tickets issued: fits the cap of 5.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,7500,2,3)),'PASSCAP',jsonb_build_object('email','a2a@example.test'));
  IF (v_q->>'discountMinor')::integer <> 15000 OR jsonb_array_length(v_q->'notices') <> 0
     OR (v_q#>>'{applied,0,units}')::integer <> 2 OR (v_q#>>'{lines,0,unitsCounted}')::integer <> 2 THEN
    RAISE EXCEPTION 'A2 2 passes x 3 days on cap 5: want both free as 2 units; got %',v_q;
  END IF;
  -- 1 pass x 3 days records 1 unit.
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,7500,1,3)),'PASSCAP',jsonb_build_object('email','a2b@example.test'),
    NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 7500 OR (v_r->'quote'#>>'{applied,0,units}')::integer <> 1
     OR pg_temp.i4624t_units(v_id) <> 1 THEN
    RAISE EXCEPTION 'A2 1 pass x 3 days: want discounted and 1 unit; got % units %',v_r->'quote',pg_temp.i4624t_units(v_id);
  END IF;
  -- 4 left: 5 passes do not fit; a single line never reads remaining 0.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,7500,5,3)),'PASSCAP',jsonb_build_object('email','a2c@example.test'));
  IF (v_q->>'discountMinor')::integer <> 0 OR v_q->'codeOutcome'->>'status' <> 'applied'
     OR v_q#>>'{notices,0,remaining}' <> '4' THEN
    RAISE EXCEPTION 'A2 5 passes with 4 left: want full price, code applied, notice remaining 4; got %',v_q;
  END IF;
  -- Block booking: 4 blocks (countScale 4) on qty 1 is one booking and fits.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,10000,1,4)),'PASSCAP',jsonb_build_object('email','a2e@example.test'));
  IF (v_q->>'discountMinor')::integer <> 10000 OR jsonb_array_length(v_q->'notices') <> 0
     OR (v_q#>>'{applied,0,units}')::integer <> 1 THEN
    RAISE EXCEPTION 'A2 4-block booking with 4 left: want free as 1 unit; got %',v_q;
  END IF;

  -- A3 reservation expiry -----------------------------------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'HOLDCAP',jsonb_build_object('endsAfterCount',5));
  v_hold := gen_random_uuid();
  v_r := public.issue_3872_reserve_discount_uses('ticket',v_hold,v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,5)),'HOLDCAP',jsonb_build_object('email','a3a@example.test'),
    NULL,now()+interval '15 minutes',false,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 12500 OR pg_temp.i4624t_units(v_id) <> 5 THEN
    RAISE EXCEPTION 'A3 hold of 5: want 5 free and 5 reserved; got %',v_r->'quote';
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'HOLDCAP',jsonb_build_object('email','a3b@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'A3 live hold of all 5: want used_up for another buyer; got %',v_q;
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'HOLDCAP',jsonb_build_object('email','a3b@example.test'),
    NULL,now()+interval '15 minutes',false,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 0
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id) <> 1 THEN
    RAISE EXCEPTION 'A3 reserve while held: want no discount and no second use row; got %',v_r->'quote';
  END IF;
  -- The hold expires (expires_at passes; status is still 'reserved').
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second'
   WHERE checkout_ref_id=v_hold AND discount_id=v_id;
  v_c := public.issue_3872_discount_candidates(v_brand,'[]'::jsonb,'HOLDCAP',
    jsonb_build_object('email','a3b@example.test'),now());
  IF v_c->'code'->>'remainingUnits' <> '5' THEN
    RAISE EXCEPTION 'A3 expired hold: want remainingUnits 5; got %',v_c->'code';
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,5)),'HOLDCAP',jsonb_build_object('email','a3b@example.test'),
    NULL,now()+interval '15 minutes',false,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 12500 THEN
    RAISE EXCEPTION 'A3 after expiry: want 5 free again; got %',v_r->'quote';
  END IF;

  -- A4 max_total_uses 2 + ends_after_count 5 ------------------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'BOTHA',jsonb_build_object('endsAfterCount',5,'maxTotalUses',2));
  FOR v_n IN 1..2 LOOP
    v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
        pg_temp.i4624t_line(v_ga,v_event,2500,1)),'BOTHA',jsonb_build_object('email',format('a4u%s@example.test',v_n)),
      NULL,now()+interval '1 day',true,'online');
    IF (v_r->'quote'->>'discountMinor')::integer <> 2500 THEN
      RAISE EXCEPTION 'A4 uses: checkout % not discounted; got %',v_n,v_r->'quote';
    END IF;
  END LOOP;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'BOTHA',jsonb_build_object('email','a4u3@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' OR pg_temp.i4624t_units(v_id) <> 2 THEN
    RAISE EXCEPTION 'A4 2 checkouts of 1 ticket (3 tickets still left): want used_up; got %',v_q;
  END IF;
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'BOTHB',jsonb_build_object('endsAfterCount',5,'maxTotalUses',2));
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,5)),'BOTHB',jsonb_build_object('email','a4t1@example.test'),
    NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 12500 THEN
    RAISE EXCEPTION 'A4 tickets: checkout of 5 not discounted; got %',v_r->'quote';
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'BOTHB',jsonb_build_object('email','a4t2@example.test'),
    NULL,now()+interval '1 day',true,'online');
  IF v_r->'quote'->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up'
     OR (v_r->'quote'->>'discountMinor')::integer <> 0
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id) <> 1 THEN
    RAISE EXCEPTION 'A4 tickets: second checkout after 5 tickets (1 use left): want used_up, no row; got %',v_r->'quote';
  END IF;

  -- A5 max_uses_per_buyer 1 + ends_after_count 5 --------------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'BUYERCAP',jsonb_build_object('endsAfterCount',5,'maxUsesPerBuyer',1));
  -- Over the cap: no discount, no use row, so the buyer's one use is not burnt.
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,6)),'BUYERCAP',jsonb_build_object('email','a5x@example.test'),
    NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 0
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id) <> 0 THEN
    RAISE EXCEPTION 'A5 basket of 6 on cap 5: want no discount and no use row; got %',v_r->'quote';
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,2)),'BUYERCAP',jsonb_build_object('email','a5x@example.test'),
    NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 5000 THEN
    RAISE EXCEPTION 'A5 same buyer after the refused basket: want 2 free; got %',v_r->'quote';
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'BUYERCAP',jsonb_build_object('email','A5X@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'buyer_limit' THEN
    RAISE EXCEPTION 'A5 same buyer (case-folded email) again: want buyer_limit; got %',v_q;
  END IF;
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,3)),'BUYERCAP',jsonb_build_object('email','a5y@example.test'),
    NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 7500 OR pg_temp.i4624t_units(v_id) <> 5 THEN
    RAISE EXCEPTION 'A5 second buyer takes the last 3: got %',v_r->'quote';
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'BUYERCAP',jsonb_build_object('email','a5x@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'A5 tickets gone and buyer used: want used_up first (EN-9 order); got %',v_q;
  END IF;

  -- A6 capped code + brand automatic ---------------------------------------------------
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Ten off everything','valueType','percent',
    'valueBps',1000,'scopeKind','brand','combinesWith','any'));
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'AUTOCAP',jsonb_build_object('endsAfterCount',5,'combinesWith','automatic_only'));
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,3)),'AUTOCAP',jsonb_build_object('email','a6a@example.test'));
  -- 10% off then the code's 100% of the rest: 7500 off, both applied.
  IF (v_q->>'discountMinor')::integer <> 7500 OR jsonb_array_length(v_q->'applied') <> 2
     OR v_q->'codeOutcome'->>'status' <> 'applied'
     OR (SELECT (a->>'units')::integer FROM jsonb_array_elements(v_q->'applied') a WHERE a->>'discountId'=v_id::text) <> 3 THEN
    RAISE EXCEPTION 'A6 code + automatic within cap: got %',v_q;
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,6)),'AUTOCAP',jsonb_build_object('email','a6b@example.test'));
  -- Over the cap: the automatic's 10% still applies, the code adds nothing.
  IF (v_q->>'discountMinor')::integer <> 1500 OR jsonb_array_length(v_q->'applied') <> 1
     OR v_q->'applied'->0->>'kind' <> 'automatic'
     OR v_q#>>'{notices,0,discountKind}' IS DISTINCT FROM 'code' OR v_q#>>'{notices,0,remaining}' <> '5' THEN
    RAISE EXCEPTION 'A6 code over cap + automatic: want only the automatic 1500 and a code notice; got %',v_q;
  END IF;
  -- Clear the automatic so later blocks price on the code alone.
  UPDATE public.brand_discounts SET status='ended',ended_reason='host'
   WHERE brand_id=v_brand AND kind='automatic';

  -- A7 edit ends_after_count below the units already used -------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'EDITCAP',jsonb_build_object('endsAfterCount',5));
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,3)),'EDITCAP',jsonb_build_object('email','a7a@example.test'),
    NULL,now()+interval '1 day',true,'online');
  SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id;
  PERFORM public.issue_3872_upsert_discount(v_owner,'update',jsonb_build_object(
    'id',v_id,'version',v_row.version,'endsAfterCount',2));
  IF (SELECT ends_after_count FROM public.brand_discounts WHERE id=v_id) <> 2 THEN
    RAISE EXCEPTION 'A7 edit down to 2 did not save';
  END IF;
  v_c := public.issue_3872_discount_candidates(v_brand,'[]'::jsonb,'EDITCAP',
    jsonb_build_object('email','a7b@example.test'),now());
  IF v_c->'code'->>'remainingUnits' <> '0' THEN
    RAISE EXCEPTION 'A7 cap 2 with 3 used: want remainingUnits 0 (never negative); got %',v_c->'code';
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,1)),'EDITCAP',jsonb_build_object('email','a7b@example.test'));
  IF v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'A7 cap below used: want used_up; got %',v_q;
  END IF;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status||'/'||COALESCE(ended_reason,'-') FROM public.brand_discounts WHERE id=v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'A7 maintenance: want ended/count; got %',
      (SELECT status||'/'||COALESCE(ended_reason,'-') FROM public.brand_discounts WHERE id=v_id);
  END IF;

  -- A8 free and discounts-off tickets use no units --------------------------------------
  v_id := pg_temp.i4624t_code(v_owner,v_brand,'FREECAP',jsonb_build_object('endsAfterCount',5));
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,5),
      pg_temp.i4624t_line(v_free,v_event,0,4),
      pg_temp.i4624t_line(v_off,v_event,4000,4,1,false)),
    'FREECAP',jsonb_build_object('email','a8a@example.test'),NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 12500 OR jsonb_array_length(v_r->'quote'->'notices') <> 0
     OR pg_temp.i4624t_units(v_id) <> 5 THEN
    RAISE EXCEPTION 'A8 5 paid + 4 free + 4 discounts-off on cap 5: want 5 paid free, no notice, 5 units; got % units %',
      v_r->'quote',pg_temp.i4624t_units(v_id);
  END IF;

  -- A9 non-code kinds unchanged; writer still refuses 0 / negatives ---------------------
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','sale_price','name','VIP sale','valueType','set_price',
    'valueMinor',4000,'scopeKind','items','endsAfterCount',2,
    'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_vip))));
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_vip,v_event,5000,3)),NULL,'{}'::jsonb);
  IF jsonb_array_length(v_q->'notices') <> 1 OR v_q#>>'{notices,0,remaining}' <> '2'
     OR (v_q->'notices'->0) ? 'discountKind' THEN
    RAISE EXCEPTION 'A9 sale price over its count: want the unchanged notice (no discountKind); got %',v_q;
  END IF;
  FOREACH v_n IN ARRAY ARRAY[0,-1] LOOP
    v_err := 'saved';
    BEGIN
      PERFORM pg_temp.i4624t_code(v_owner,v_brand,'BAD'||abs(v_n)||'CAP',jsonb_build_object('endsAfterCount',v_n));
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_err = CONSTRAINT_NAME;
    END;
    IF v_err <> 'brand_discounts_ends_after_count_check' THEN
      RAISE EXCEPTION 'A9 endsAfterCount %: want brand_discounts_ends_after_count_check, got %',v_n,v_err;
    END IF;
  END LOOP;

  -- A10 catalog ---------------------------------------------------------------------
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.issue_3872_discount_apply(jsonb)'::regprocedure)
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)'::regprocedure) THEN
    RAISE EXCEPTION 'A10 SECURITY DEFINER changed (apply must be INVOKER, candidates DEFINER)';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE oid IN (
        'public.issue_3872_discount_apply(jsonb)'::regprocedure,
        'public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)'::regprocedure)
      AND proconfig = ARRAY['search_path=public, pg_temp']) <> 2 THEN
    RAISE EXCEPTION 'A10 search_path changed';
  END IF;
  IF has_function_privilege('anon','public.issue_3872_discount_apply(jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3872_discount_apply(jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.issue_3872_discount_apply(jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'A10 grants changed on the replaced functions';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='bd_count_end'
       AND conrelid='public.brand_discounts'::regclass)) NOT LIKE '%code%' THEN
    RAISE EXCEPTION 'A10 bd_count_end does not allow codes';
  END IF;

  RAISE NOTICE 'issue_4624_code_ticket_limit tester adversarial: PASS (A1-A10)';
END;
$test$;

ROLLBACK;

-- ===========================================================================
-- Retest (rework spec 7206302208, D-0..D-6): A11-A24, one transaction, rolled
-- back. Real checkouts (create session -> finalize -> consume) wherever a
-- refund, cancel or late payment is involved.
--   A11 the FAIL verdict's reproducers re-run: P2-1 (PHANTOM), P2-2 (a 3-day
--       pass with 2 left never reads 0), P3-3 (3+3 picks VIP).
--   A12 count only discounted tickets across stacked discounts: a 50% automatic
--       leaves GA cheaper but still discountable; a 100% automatic leaves it
--       spending nothing.
--   A13 1 ticket = 1 for passes, blocks and per-day lines (notice never 0 on a
--       single line, never divided by days).
--   A14 best saving first with ties (lineRef breaks a tie; amount-off saving is
--       capped by the line price).
--   A15 full refund: every unit back, Total uses and per buyer back; replaying
--       the refund and re-running the recompute change nothing.
--   A16 partial refund on a mixed order: refunding a ticket the code did not
--       discount gives nothing back; refunding a discounted one gives 1 back
--       and keeps the checkout counted (D-4a).
--   A17 stacked automatic + code on one line: one refunded ticket gives one unit
--       back to each discount.
--   A18 free-order cancel twice and void twice are idempotent.
--   A19 event cancel then un-cancel: places come back once (no double count
--       with a refunded ticket on the same order) and are taken again on
--       un-cancel, leaving only the refunded ticket returned.
--   A20 a chargeback (dispute lost) gives nothing back (D-4b).
--   A21 reopen (D-4c): a 'uses' code reopens only after the whole checkout is
--       refunded; a 'count' code past its end date or deleted never reopens; a
--       reopened code applies again.
--   A22 late payment: an expired session's lapsed hold is released, another
--       buyer takes the places, the late payment is honoured and stamped over
--       the limit, the host list reads it, and later refunds never drive the
--       remaining count below 0. A hold extended past the session's expiry
--       consumes normally (no overrun).
--   A23 the 80% warning fires on whichever limit is closer, with left in that
--       limit's units.
-- ===========================================================================
BEGIN;

CREATE FUNCTION pg_temp.i4624u_line(p_tt uuid, p_event uuid, p_price integer, p_qty integer,
  p_value_scale integer DEFAULT 1, p_count_scale integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object('lineRef',p_tt,'itemKind','ticket_type','itemId',p_tt,
    'listingId',p_event,'listingKind','event','listUnitMinor',p_price,'qty',p_qty,
    'valueScale',p_value_scale,'countScale',p_count_scale,'allowed',true,'tz','UTC');
$f$;

-- A real checkout. p_lines is the cart; p_free finalizes through the free rail.
CREATE FUNCTION pg_temp.i4624u_buy(p_event uuid, p_lines jsonb, p_code text, p_email text,
  p_free boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_created jsonb; v_session uuid; v_final jsonb;
BEGIN
  v_created := public.biz_ticket_checkout_create_session(
    p_event,NULL,'Buyer',p_email,'+1555'||lpad((abs(hashtext(p_email))%10000000)::text,7,'0'),false,
    p_lines,'i4624u-'||gen_random_uuid()::text,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,
    p_code,NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF p_free THEN
    v_final := public.biz_ticket_checkout_finalize(v_session,NULL,NULL,'free',
      'i4624u-test-pepper-0123456789abcdef0123456789abcd');
  ELSE
    PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_'||replace(v_session::text,'-',''),
      'ch_'||replace(v_session::text,'-',''),'card','i4624u-test-pepper-0123456789abcdef0123456789abcd');
    PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
    v_final := jsonb_build_object('outcome','finalized','orderId',
      (SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  END IF;
  RETURN jsonb_build_object('session',v_session,'order',v_final->>'orderId','outcome',v_final->>'outcome',
    'created',v_created);
END;
$f$;

CREATE FUNCTION pg_temp.i4624u_cart(p_tt uuid, p_qty integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(jsonb_build_object('ticketTypeId',p_tt,'quantity',p_qty));
$f$;

CREATE FUNCTION pg_temp.i4624u_use(p_discount uuid, p_order uuid)
RETURNS public.discount_uses LANGUAGE sql STABLE AS $f$
  SELECT * FROM public.discount_uses WHERE discount_id=p_discount AND order_id=p_order;
$f$;

CREATE FUNCTION pg_temp.i4624u_cand(p_brand uuid, p_code text, p_email text DEFAULT 'probe@example.test')
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT public.issue_3872_discount_candidates(p_brand,'[]'::jsonb,p_code,
    jsonb_build_object('email',p_email),now())->'code';
$f$;

CREATE FUNCTION pg_temp.i4624u_list(p_brand uuid, p_id uuid, p_filter text DEFAULT 'live')
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT r FROM public.brand_discounts_list(p_brand,p_filter) r WHERE r->>'id'=p_id::text;
$f$;

CREATE FUNCTION pg_temp.i4624u_code(p_owner uuid, p_brand uuid, p_code text, p_bps integer, p_extra jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (public.issue_3872_upsert_discount(p_owner,'create',jsonb_build_object(
    'brandId',p_brand,'kind','code','code',p_code,'name','Retest '||p_code,
    'valueType','percent','valueBps',p_bps,'scopeKind','brand','combinesWith','any') || p_extra)->>'id')::uuid;
END;
$f$;

DO $retest$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-0000000000b1';
  v_brand uuid := '46240000-0000-4000-8100-0000000000b1';
  v_event uuid := '46240000-0000-4000-8200-0000000000b1';
  v_event2 uuid := '46240000-0000-4000-8200-0000000000b2';
  v_ga uuid := '46240000-0000-4000-8300-0000000000b1';   -- General 25.00
  v_vip uuid := '46240000-0000-4000-8300-0000000000b2';  -- VIP 50.00
  v_twin uuid := '46240000-0000-4000-8300-0000000000b3'; -- 25.00, sorts after General
  v_ga2 uuid := '46240000-0000-4000-8300-0000000000b4';  -- General on event 2
  v_id uuid; v_id2 uuid; v_auto uuid;
  v_q jsonb; v_r jsonb; v_b jsonb; v_c jsonb; v_l jsonb; v_m jsonb;
  v_u public.discount_uses; v_u2 public.discount_uses;
  v_order uuid; v_session uuid; v_n integer; v_err text; v_t uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-retest-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-retest-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 retest brand','issue-4624-retest-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624_retest',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES
    (v_event,v_brand,v_owner,'Retest Night','issue-4624-retest-e1','event','scheduled','public','UTC','USD'),
    (v_event2,v_brand,v_owner,'Retest Night 2','issue-4624-retest-e2','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true),
    (v_event2,now()+interval '4 days',now()+interval '4 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES
    (v_ga,v_event,'General',2500,'USD',false,200,false,1,10,true,false,true),
    (v_vip,v_event,'VIP',5000,'USD',false,200,false,1,10,true,false,true),
    (v_twin,v_event,'Twin',2500,'USD',false,200,false,1,10,true,false,true),
    (v_ga2,v_event2,'General',2500,'USD',false,200,false,1,10,true,false,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);

  -- A11 the FAIL verdict's reproducers --------------------------------------------
  v_auto := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','GA on the house','valueType','percent','valueBps',10000,
    'scopeKind','items','combinesWith','any',
    'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_ga))))->>'id')::uuid;
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'PHANTOMX',10000,jsonb_build_object('endsAfterCount',5));
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,3),pg_temp.i4624u_line(v_vip,v_event,5000,3)),
    'PHANTOMX',jsonb_build_object('email','a11@example.test'));
  IF (v_q->>'discountMinor')::integer <> 22500 OR jsonb_array_length(v_q->'notices') <> 0
     OR (SELECT (a->>'units')::integer FROM jsonb_array_elements(v_q->'applied') a WHERE a->>'discountId'=v_id::text) <> 3 THEN
    RAISE EXCEPTION 'A11 P2-1 reproducer: want GA free (automatic) + VIP free (code, 3 units), no notice; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id IN (v_auto,v_id);
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'PASSTWO',1000,jsonb_build_object('endsAfterCount',2));
  -- P2-2: 3-day all-days pass x3 (countScale 3) with 2 left: remaining is 2, never 0.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,7500,3,1,3)),'PASSTWO',jsonb_build_object('email','a11b@example.test'));
  IF v_q#>>'{notices,0,remaining}' IS DISTINCT FROM '2' OR (v_q->>'discountMinor')::integer <> 0 THEN
    RAISE EXCEPTION 'A11 P2-2 reproducer: 3 passes on 2 left want notice remaining 2; got %',v_q;
  END IF;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,7500,2,1,3)),'PASSTWO',jsonb_build_object('email','a11b@example.test'));
  IF (v_q->>'discountMinor')::integer <> 1500 OR jsonb_array_length(v_q->'notices') <> 0 THEN
    RAISE EXCEPTION 'A11 P2-2: 2 passes on 2 left must both be discounted; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A12 only discounted tickets count, stacked ---------------------------------------
  v_auto := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','GA half','valueType','percent','valueBps',5000,
    'scopeKind','items','combinesWith','any',
    'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_ga))))->>'id')::uuid;
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'STACKFOUR',10000,jsonb_build_object('endsAfterCount',4));
  -- GA 25 -> 12.50 by the automatic, still discountable by the code (saving 12.50);
  -- VIP saves 50 so it goes first: VIP x3 = 3 units, GA x3 does not fit 1 left.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,3),pg_temp.i4624u_line(v_vip,v_event,5000,3)),
    'STACKFOUR',jsonb_build_object('email','a12@example.test'));
  IF (v_q->>'discountMinor')::integer <> 3750+15000
     OR jsonb_array_length(v_q->'notices') <> 1 OR v_q#>>'{notices,0,lineRef}' <> v_ga::text
     OR v_q#>>'{notices,0,remaining}' <> '1'
     OR (SELECT (a->>'units')::integer FROM jsonb_array_elements(v_q->'applied') a WHERE a->>'discountId'=v_id::text) <> 3 THEN
    RAISE EXCEPTION 'A12 50%% automatic on GA + code cap 4: want VIP free (3 units) and GA notice remaining 1; got %',v_q;
  END IF;
  -- GA x1 + VIP x3: 4 units exactly; the automatic-cheapened GA still counts once.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,1),pg_temp.i4624u_line(v_vip,v_event,5000,3)),
    'STACKFOUR',jsonb_build_object('email','a12@example.test'));
  IF (v_q->>'discountMinor')::integer <> 2500+15000 OR jsonb_array_length(v_q->'notices') <> 0
     OR (SELECT (a->>'units')::integer FROM jsonb_array_elements(v_q->'applied') a WHERE a->>'discountId'=v_id::text) <> 4 THEN
    RAISE EXCEPTION 'A12 GA x1 + VIP x3 on cap 4: want both free, 4 code units; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id IN (v_auto,v_id);

  -- A13 1 ticket = 1 ---------------------------------------------------------------------
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'ONEISONE',1000,jsonb_build_object('endsAfterCount',5));
  -- Per-day: 2 people x 3 days arrive as qty 6 (countScale 1): 6 tickets > 5,
  -- notice remaining 5 in tickets (the client converts to people).
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,6)),'ONEISONE',jsonb_build_object('email','a13@example.test'));
  IF v_q#>>'{notices,0,remaining}' IS DISTINCT FROM '5' OR (v_q->>'discountMinor')::integer <> 0 THEN
    RAISE EXCEPTION 'A13 per-day 6 tickets on cap 5: want notice remaining 5; got %',v_q;
  END IF;
  -- Block booking: 2 bookings of 4 blocks = 2 units; 5 passes of 3 days = 5 units.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,1000,2,4,4),pg_temp.i4624u_line(v_vip,v_event,7500,3,1,3)),
    'ONEISONE',jsonb_build_object('email','a13@example.test'));
  IF jsonb_array_length(v_q->'notices') <> 0
     OR (SELECT sum((a->>'units')::integer) FROM jsonb_array_elements(v_q->'applied') a) <> 5
     OR (v_q->>'discountMinor')::integer <> 2*100+3*750 THEN
    RAISE EXCEPTION 'A13 2 bookings x 4 blocks + 3 passes x 3 days on cap 5: want 5 units, all discounted; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A14 best saving first, ties -------------------------------------------------------
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'TIEBREAK',10000,jsonb_build_object('endsAfterCount',3));
  -- Same price: the lower lineRef (General ...b1 < Twin ...b3) gets the places.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_twin,v_event,2500,3),pg_temp.i4624u_line(v_ga,v_event,2500,3)),
    'TIEBREAK',jsonb_build_object('email','a14@example.test'));
  IF (v_q->>'discountMinor')::integer <> 7500 OR v_q#>>'{notices,0,lineRef}' <> v_twin::text
     OR v_q#>>'{lines,0,lineRef}' <> v_ga::text THEN
    RAISE EXCEPTION 'A14 tie at 25.00: want General (lower lineRef) free, Twin noticed, lines in lineRef order; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  -- Amount off 30.00: General saves 25 (capped by its price), VIP saves 30 -> VIP first.
  v_id := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','THIRTYOFF','name','Thirty off','valueType','amount',
    'valueMinor',3000,'scopeKind','brand','combinesWith','any','endsAfterCount',2))->>'id')::uuid;
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,2),pg_temp.i4624u_line(v_vip,v_event,5000,2)),
    'THIRTYOFF',jsonb_build_object('email','a14b@example.test'));
  IF (v_q->>'discountMinor')::integer <> 6000 OR v_q#>>'{notices,0,lineRef}' <> v_ga::text THEN
    RAISE EXCEPTION 'A14 amount 30 off, cap 2: want VIP x2 (60 off) and a notice on General; got %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A15 full refund: every unit, the use and the buyer come back; replays are no-ops.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'FULLBACK',5000,
    jsonb_build_object('endsAfterCount',4,'maxTotalUses',1,'maxUsesPerBuyer',1));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,4),'FULLBACK','a15@example.test');
  v_order := (v_b->>'order')::uuid;
  v_u := pg_temp.i4624u_use(v_id,v_order);
  IF v_u.status <> 'consumed' OR v_u.units <> 4 OR (SELECT count(*) FROM public.tickets WHERE order_id=v_order) <> 4 THEN
    RAISE EXCEPTION 'A15 setup: want 4 tickets and a consumed use of 4; got % %',v_b,to_jsonb(v_u);
  END IF;
  IF pg_temp.i4624u_cand(v_brand,'FULLBACK','a15@example.test')->>'remainingBuyerUses' <> '0' THEN
    RAISE EXCEPTION 'A15 setup: the buyer should be used';
  END IF;
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624u_15',5000,'USD',NULL,NULL);
  v_u := pg_temp.i4624u_use(v_id,v_order);
  v_c := pg_temp.i4624u_cand(v_brand,'FULLBACK','a15@example.test');
  IF (SELECT count(*) FROM public.tickets WHERE order_id=v_order AND status='refunded') <> 4
     OR v_u.returned_units <> 4 OR v_u.returned_at IS NULL
     OR v_c->>'remainingUnits' <> '4' OR v_c->>'remainingTotalUses' <> '1' OR v_c->>'remainingBuyerUses' <> '1' THEN
    RAISE EXCEPTION 'A15 full refund: want 4 back, returned_at set, the use and the buyer free; got use % cand %',to_jsonb(v_u),v_c;
  END IF;
  -- The same webhook twice, then the recompute by hand: nothing moves.
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624u_15',5000,'USD',NULL,NULL);
  IF public.issue_4624_sync_discount_returns(v_order) <> 0
     OR (pg_temp.i4624u_use(v_id,v_order)).returned_at IS DISTINCT FROM v_u.returned_at
     OR (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 4 THEN
    RAISE EXCEPTION 'A15 replayed refund moved the use: %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  -- The same buyer can use the code again, and the host list says 0 of 4 tickets.
  v_l := pg_temp.i4624u_list(v_brand,v_id);
  IF (v_l->>'consumedUnits')::integer <> 0 OR (v_l->>'returnedUnits')::integer <> 4 OR (v_l->>'liveUses')::integer <> 0 THEN
    RAISE EXCEPTION 'A15 list after a full refund: want 0 used, 4 returned, 0 live uses; got %',v_l;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A16 partial refund on a mixed order -------------------------------------------
  -- Cap 3, VIP x3 + GA x2: VIP takes the 3 places, GA stays full price.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'MIXBACK',5000,
    jsonb_build_object('endsAfterCount',3,'maxTotalUses',1));
  v_b := pg_temp.i4624u_buy(v_event,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_vip,'quantity',3),jsonb_build_object('ticketTypeId',v_ga,'quantity',2)),
    'MIXBACK','a16@example.test');
  v_order := (v_b->>'order')::uuid;
  v_u := pg_temp.i4624u_use(v_id,v_order);
  IF v_u.units <> 3 OR (SELECT count(*) FROM public.tickets WHERE order_id=v_order) <> 5 THEN
    RAISE EXCEPTION 'A16 setup: want 5 tickets and 3 code units (VIP); got % %',v_b,to_jsonb(v_u);
  END IF;
  -- A full-price General ticket is refunded: the code gets nothing back.
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order AND ticket_type_id=v_ga ORDER BY id LIMIT 1);
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 0 THEN
    RAISE EXCEPTION 'A16 refunding an undiscounted General ticket returned code units: %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  -- A discounted VIP ticket is refunded: 1 back, the checkout still counts (D-4a).
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order AND ticket_type_id=v_vip ORDER BY id LIMIT 1);
  v_u := pg_temp.i4624u_use(v_id,v_order);
  v_c := pg_temp.i4624u_cand(v_brand,'MIXBACK');
  IF v_u.returned_units <> 1 OR v_u.returned_at IS NOT NULL
     OR v_c->>'remainingUnits' <> '1' OR v_c->>'remainingTotalUses' <> '0' THEN
    RAISE EXCEPTION 'A16 one VIP refunded: want 1 back, use still counted; got use % cand %',to_jsonb(v_u),v_c;
  END IF;
  -- The rest of the discounted VIP tickets refunded (General still valid): the use comes back.
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order AND ticket_type_id=v_vip;
  v_u := pg_temp.i4624u_use(v_id,v_order);
  IF v_u.returned_units <> 3 OR v_u.returned_at IS NULL
     OR pg_temp.i4624u_cand(v_brand,'MIXBACK')->>'remainingTotalUses' <> '1' THEN
    RAISE EXCEPTION 'A16 every discounted ticket refunded: want the use back though a General ticket is valid; got %',to_jsonb(v_u);
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A17 automatic + code on the same line, both capped --------------------------------
  v_auto := (public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','automatic','name','Ten off GA','valueType','percent','valueBps',1000,
    'scopeKind','items','combinesWith','any','endsAfterCount',10,
    'targets',jsonb_build_array(jsonb_build_object('targetKind','ticket_type','targetId',v_ga2))))->>'id')::uuid;
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'STACKBACK',1000,jsonb_build_object('endsAfterCount',10));
  v_b := pg_temp.i4624u_buy(v_event2,pg_temp.i4624u_cart(v_ga2,3),'STACKBACK','a17@example.test');
  v_order := (v_b->>'order')::uuid;
  IF (pg_temp.i4624u_use(v_auto,v_order)).units <> 3 OR (pg_temp.i4624u_use(v_id,v_order)).units <> 3 THEN
    RAISE EXCEPTION 'A17 setup: want 3 units on the automatic and 3 on the code; got % / %',
      to_jsonb(pg_temp.i4624u_use(v_auto,v_order)),to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY id LIMIT 1);
  IF (pg_temp.i4624u_use(v_auto,v_order)).returned_units <> 1 OR (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 1 THEN
    RAISE EXCEPTION 'A17 one refunded ticket: want 1 back on each discount; got % / %',
      to_jsonb(pg_temp.i4624u_use(v_auto,v_order)),to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  -- A refunded ticket voided afterwards (refunded -> void) still counts once.
  UPDATE public.tickets SET status='void' WHERE order_id=v_order AND status='refunded';
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 1 THEN
    RAISE EXCEPTION 'A17 refunded then void double-counted: %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id IN (v_auto,v_id);

  -- A18 cancel twice, void twice ------------------------------------------------------
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'TWICEFREE',10000,jsonb_build_object('endsAfterCount',6));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,2),'TWICEFREE','a18@example.test',true);
  v_order := (v_b->>'order')::uuid;
  IF v_b->>'outcome' <> 'finalized' OR (pg_temp.i4624u_use(v_id,v_order)).units <> 2 THEN
    RAISE EXCEPTION 'A18 setup: free order on TWICEFREE: %',v_b;
  END IF;
  PERFORM public.biz_cancel_order(v_order,'changed plans');
  v_u := pg_temp.i4624u_use(v_id,v_order);
  BEGIN
    PERFORM public.biz_cancel_order(v_order,'changed plans again');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a refusal of the second cancel is fine; it must not move the use either way
  END;
  v_u2 := pg_temp.i4624u_use(v_id,v_order);
  IF v_u.returned_units <> 2 OR v_u.returned_at IS NULL
     OR v_u2.returned_units <> 2 OR v_u2.returned_at IS DISTINCT FROM v_u.returned_at THEN
    RAISE EXCEPTION 'A18 cancel twice: want 2 back once, returned_at unchanged; got % then %',to_jsonb(v_u),to_jsonb(v_u2);
  END IF;
  -- Void twice on another order: the second UPDATE is a no-op for the trigger.
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,3),'TWICEFREE','a18b@example.test',true);
  v_order := (v_b->>'order')::uuid;
  v_t := (SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY id LIMIT 1);
  UPDATE public.tickets SET status='void' WHERE id=v_t;
  UPDATE public.tickets SET status='void' WHERE id=v_t;
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 1
     OR pg_temp.i4624u_cand(v_brand,'TWICEFREE')->>'remainingUnits' <> '4' THEN
    RAISE EXCEPTION 'A18 void twice: want 1 back and 4 left (6 - 3 + 1); got % cand %',
      to_jsonb(pg_temp.i4624u_use(v_id,v_order)),pg_temp.i4624u_cand(v_brand,'TWICEFREE');
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A19 event cancel, a refund on top, then un-cancel ---------------------------------
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'EVENTBACK',5000,jsonb_build_object('endsAfterCount',5));
  v_b := pg_temp.i4624u_buy(v_event2,pg_temp.i4624u_cart(v_ga2,3),'EVENTBACK','a19@example.test');
  v_order := (v_b->>'order')::uuid;
  UPDATE public.events SET status='cancelled' WHERE id=v_event2;
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 3 THEN
    RAISE EXCEPTION 'A19 event cancelled: want 3 back; got %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  -- The cancel's refund fan-out then refunds one ticket: still 3, never 4.
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY id LIMIT 1);
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 3 THEN
    RAISE EXCEPTION 'A19 cancel + refund double-counted: %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  -- Un-cancel: the two still-valid tickets take their places again; the refunded one stays back.
  UPDATE public.events SET status='scheduled' WHERE id=v_event2;
  v_u := pg_temp.i4624u_use(v_id,v_order);
  IF v_u.returned_units <> 1 OR v_u.returned_at IS NOT NULL
     OR pg_temp.i4624u_cand(v_brand,'EVENTBACK')->>'remainingUnits' <> '3' THEN
    RAISE EXCEPTION 'A19 un-cancel: want only the refunded ticket returned (1) and 3 left; got % cand %',
      to_jsonb(v_u),pg_temp.i4624u_cand(v_brand,'EVENTBACK');
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A20 a lost chargeback gives nothing back (D-4b) -----------------------------------
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'DISPUTED',5000,jsonb_build_object('endsAfterCount',5));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,2),'DISPUTED','a20@example.test');
  v_order := (v_b->>'order')::uuid;
  INSERT INTO public.stripe_disputes(stripe_dispute_id,stripe_charge_id,stripe_account_id,brand_id,order_id,
    amount,currency,status,reason,raw_event)
  VALUES('dp_i4624u_20','ch_i4624u_20','acct_issue_4624_retest',v_brand,v_order,2500,'usd','needs_response','fraudulent','{}'::jsonb);
  UPDATE public.stripe_disputes SET status='lost' WHERE stripe_dispute_id='dp_i4624u_20';
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 0
     OR (SELECT count(*) FROM public.tickets WHERE order_id=v_order AND status='valid') <> 2 THEN
    RAISE EXCEPTION 'A20 a lost dispute returned places or changed tickets: %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A21 reopen rules (D-4c) ----------------------------------------------------------------
  -- (a) ended on 'uses' reopens only after the whole checkout comes back.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'ONEUSE',5000,jsonb_build_object('maxTotalUses',1));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,2),'ONEUSE','a21@example.test');
  v_order := (v_b->>'order')::uuid;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status||'/'||ended_reason FROM public.brand_discounts WHERE id=v_id) <> 'ended/uses' THEN
    RAISE EXCEPTION 'A21a setup: want ended/uses; got %',(SELECT status||'/'||COALESCE(ended_reason,'-') FROM public.brand_discounts WHERE id=v_id);
  END IF;
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY id LIMIT 1);
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'ended' THEN
    RAISE EXCEPTION 'A21a a partial refund reopened a uses-ended code (D-4a)';
  END IF;
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'active' THEN
    RAISE EXCEPTION 'A21a the whole checkout refunded: want active again';
  END IF;
  -- The reopened code really applies again.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,1)),'ONEUSE',jsonb_build_object('email','a21z@example.test'));
  IF v_q->'codeOutcome'->>'status' <> 'applied' OR (v_q->>'discountMinor')::integer <> 1250 THEN
    RAISE EXCEPTION 'A21a reopened code does not apply: %',v_q;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  -- (b) ended on 'count' whose end date has since passed: never reopens.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'PASTDATE',5000,jsonb_build_object('endsAfterCount',2));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,2),'PASTDATE','a21b@example.test');
  v_order := (v_b->>'order')::uuid;
  PERFORM public.issue_3872_discount_maintenance(now());
  UPDATE public.brand_discounts SET ends_at=now()+interval '1 day' WHERE id=v_id;
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order;
  PERFORM public.issue_3872_discount_maintenance(now()+interval '2 days');
  IF (SELECT status||'/'||ended_reason FROM public.brand_discounts WHERE id=v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'A21b a code past its end date reopened: %',(SELECT to_jsonb(d) FROM public.brand_discounts d WHERE id=v_id);
  END IF;
  -- (c) a deleted run-out code never reopens.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'GONECODE',5000,jsonb_build_object('endsAfterCount',2));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,2),'GONECODE','a21c@example.test');
  v_order := (v_b->>'order')::uuid;
  PERFORM public.issue_3872_discount_maintenance(now());
  UPDATE public.brand_discounts SET deleted_at=now() WHERE id=v_id;
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF (SELECT status FROM public.brand_discounts WHERE id=v_id) <> 'ended' THEN
    RAISE EXCEPTION 'A21c a deleted code reopened';
  END IF;

  -- A22 late payment ----------------------------------------------------------------------
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'LATEFIVE',1000,jsonb_build_object('endsAfterCount',5));
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Slow','a22slow@example.test',
    '+1555'||lpad((abs(hashtext('a22slow@example.test'))%10000000)::text,7,'0'),false,
    pg_temp.i4624u_cart(v_ga,3),'i4624u-a22-slow',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'LATEFIVE',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  -- The hold lapses and the session is marked expired: the trigger releases it.
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  UPDATE public.ticket_checkout_sessions SET status='expired' WHERE id=v_session;
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session) <> 'released' THEN
    RAISE EXCEPTION 'A22 a lapsed hold of an expired session must be released';
  END IF;
  -- Another buyer takes 4 of the 5 places.
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,4),'LATEFIVE','a22fast@example.test');
  IF (pg_temp.i4624u_use(v_id,(v_b->>'order')::uuid)).units <> 4 THEN
    RAISE EXCEPTION 'A22 setup: fast buyer should take 4; got %',v_b;
  END IF;
  -- The slow payment lands anyway (Stripe succeeded): honoured, 2 over the limit.
  UPDATE public.ticket_checkout_sessions SET status='requires_payment' WHERE id=v_session;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_i4624u_22','ch_i4624u_22','card',
    'i4624u-test-pepper-0123456789abcdef0123456789abcd');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  v_order := (SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session);
  v_u := pg_temp.i4624u_use(v_id,v_order);
  v_l := pg_temp.i4624u_list(v_brand,v_id);
  IF v_order IS NULL OR v_u.status <> 'consumed' OR v_u.over_limit_units <> 2 OR v_u.over_limit_uses
     OR (SELECT count(*) FROM public.tickets WHERE order_id=v_order) <> 3
     OR (v_l->>'consumedUnits')::integer <> 7 OR (v_l->>'overLimitUnits')::integer <> 2 THEN
    RAISE EXCEPTION 'A22 late payment past the cap: want 3 tickets honoured, 2 over the limit, list 7 used / 2 over; got use % list %',
      to_jsonb(v_u),v_l;
  END IF;
  -- Finalizing again (a webhook replay) stamps nothing new.
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  IF (pg_temp.i4624u_use(v_id,v_order)).over_limit_units <> 2 THEN
    RAISE EXCEPTION 'A22 replayed consume changed the overrun';
  END IF;
  -- Refunds of the fast order: remaining never goes below 0 while the code is over.
  UPDATE public.tickets SET status='refunded'
   WHERE id IN (SELECT id FROM public.tickets WHERE order_id=(v_b->>'order')::uuid ORDER BY id LIMIT 1);
  IF pg_temp.i4624u_cand(v_brand,'LATEFIVE')->>'remainingUnits' <> '0' THEN
    RAISE EXCEPTION 'A22 6 net used on cap 5: want remainingUnits 0; got %',pg_temp.i4624u_cand(v_brand,'LATEFIVE');
  END IF;
  UPDATE public.tickets SET status='refunded'
   WHERE id IN (SELECT id FROM public.tickets WHERE order_id=(v_b->>'order')::uuid AND status='valid' ORDER BY id LIMIT 2);
  IF pg_temp.i4624u_cand(v_brand,'LATEFIVE')->>'remainingUnits' <> '1' THEN
    RAISE EXCEPTION 'A22 4 net used on cap 5: want remainingUnits 1; got %',pg_temp.i4624u_cand(v_brand,'LATEFIVE');
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;
  -- An extended hold outlives its session: the session expires, the hold still
  -- counts, and the payment consumes it with no overrun.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'HOLDOVER',1000,jsonb_build_object('endsAfterCount',3));
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Held','a22held@example.test',
    '+1555'||lpad((abs(hashtext('a22held@example.test'))%10000000)::text,7,'0'),false,
    pg_temp.i4624u_cart(v_ga,3),'i4624u-a22-held',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'HOLDOVER',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  IF public.issue_4624_extend_discount_hold(v_session,now()+interval '33 minutes') <> 1 THEN
    RAISE EXCEPTION 'A22 extend: want 1 row';
  END IF;
  UPDATE public.ticket_checkout_sessions SET status='expired' WHERE id=v_session;
  PERFORM public.issue_3872_discount_maintenance(now());
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(
      pg_temp.i4624u_line(v_ga,v_event,2500,1)),'HOLDOVER',jsonb_build_object('email','a22other@example.test'));
  IF (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session) <> 'reserved'
     OR v_q->'codeOutcome'->>'reason' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'A22 an extended hold must keep counting after its session expires; got % %',
      (SELECT status FROM public.discount_uses WHERE checkout_ref_id=v_session),v_q;
  END IF;
  UPDATE public.ticket_checkout_sessions SET status='requires_payment' WHERE id=v_session;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_i4624u_22b','ch_i4624u_22b','card',
    'i4624u-test-pepper-0123456789abcdef0123456789abcd');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  v_u := pg_temp.i4624u_use(v_id,(SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  IF v_u.status <> 'consumed' OR v_u.over_limit_units <> 0 OR v_u.over_limit_uses THEN
    RAISE EXCEPTION 'A22 an in-time payment on an extended hold: want consumed, no overrun; got %',to_jsonb(v_u);
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A23 the 80% warning on whichever limit is closer (P3-4) ------------------------------
  -- Tickets at 4 of 5 (80%), uses at 1 of 10: warn, left 1 (tickets).
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'WARNTIX',1000,jsonb_build_object('endsAfterCount',5,'maxTotalUses',10));
  PERFORM pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,4),'WARNTIX','a23@example.test');
  v_m := public.issue_3872_discount_maintenance(now());
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_m->'notify') x
      WHERE x->>'discountId'=v_id::text AND x->>'type'='business.discount_limit_80' AND x->>'left'='1') THEN
    RAISE EXCEPTION 'A23 tickets 4/5, uses 1/10: want limit_80 with left 1; got %',v_m;
  END IF;
  -- Below 80% on both after a refund: no warning for a fresh code at 3/5 tickets, 1/10 uses.
  v_id2 := pg_temp.i4624u_code(v_owner,v_brand,'NOWARNYET',1000,jsonb_build_object('endsAfterCount',5,'maxTotalUses',10));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,4),'NOWARNYET','a23b@example.test');
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=(v_b->>'order')::uuid ORDER BY id LIMIT 1);
  v_m := public.issue_3872_discount_maintenance(now());
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_m->'notify') x
      WHERE x->>'discountId'=v_id2::text AND x->>'type'='business.discount_limit_80') THEN
    RAISE EXCEPTION 'A23 3/5 net tickets after a refund must not warn: %',v_m;
  END IF;

  -- A25 one session line per ticket type: a repeated ticket type (same id, or
  -- the same id in another letter case) is refused and holds nothing.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'REPEATCAP',10000,jsonb_build_object('endsAfterCount',5));
  FOREACH v_err IN ARRAY ARRAY[v_ga::text, upper(v_ga::text)] LOOP
    BEGIN
      PERFORM public.biz_ticket_checkout_create_session(v_event,NULL,'Repeat','a25@example.test',
        '+1555'||lpad((abs(hashtext('a25@example.test'))%10000000)::text,7,'0'),false,
        jsonb_build_array(jsonb_build_object('ticketTypeId',v_ga,'quantity',3),
                          jsonb_build_object('ticketTypeId',v_err,'quantity',3)),
        'i4624u-a25-'||v_err,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'REPEATCAP',NULL);
      RAISE EXCEPTION 'A25 a repeated ticket type (%) was accepted',v_err;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%checkout_lines_duplicate%' THEN
        RAISE EXCEPTION 'A25 a repeated ticket type (%): want checkout_lines_duplicate; got %',v_err,SQLERRM;
      END IF;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.discount_uses WHERE discount_id=v_id) THEN
    RAISE EXCEPTION 'A25 a refused basket left a hold';
  END IF;
  -- Two different ticket types are still one line each and fit the cap.
  v_b := pg_temp.i4624u_buy(v_event,jsonb_build_array(
      jsonb_build_object('ticketTypeId',v_ga,'quantity',2),jsonb_build_object('ticketTypeId',v_vip,'quantity',3)),
    'REPEATCAP','a25ok@example.test');
  v_order := (v_b->>'order')::uuid;
  IF (pg_temp.i4624u_use(v_id,v_order)).units <> 5 OR (SELECT count(*) FROM public.tickets WHERE order_id=v_order) <> 5
     OR (SELECT count(*) FROM public.order_line_items WHERE order_id=v_order) <> 2 THEN
    RAISE EXCEPTION 'A25 GA 2 + VIP 3 on cap 5: want 5 tickets on 2 lines and 5 units; got %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A26 an order that already holds two lines of one ticket type (the shape the
  -- old session builder could write) never gets back more than was refunded.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'LEGACYTWO',5000,jsonb_build_object('endsAfterCount',10));
  v_b := pg_temp.i4624u_buy(v_event,pg_temp.i4624u_cart(v_ga,3),'LEGACYTWO','a26@example.test');
  v_order := (v_b->>'order')::uuid;
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES(v_order,v_ga,3,1250,3750) RETURNING id INTO v_t;
  INSERT INTO public.order_discount_lines(order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,
      name_snapshot,value_type,value_bps,units,amount_minor,applied_seq,currency)
    VALUES('ticket',v_order,v_t::text,v_id,v_brand,'code','LEGACYTWO','Retest LEGACYTWO','percent',5000,3,3750,1,'USD');
  UPDATE public.tickets SET status='refunded'
   WHERE id=(SELECT id FROM public.tickets WHERE order_id=v_order ORDER BY id LIMIT 1);
  IF (pg_temp.i4624u_use(v_id,v_order)).returned_units <> 1 THEN
    RAISE EXCEPTION 'A26 one refunded ticket on a two-line order: want 1 back; got %',to_jsonb(pg_temp.i4624u_use(v_id,v_order));
  END IF;
  UPDATE public.tickets SET status='refunded' WHERE order_id=v_order;
  v_u := pg_temp.i4624u_use(v_id,v_order);
  IF v_u.returned_units <> 3 OR v_u.returned_at IS NULL
     OR pg_temp.i4624u_cand(v_brand,'LEGACYTWO')->>'remainingUnits' <> '10' THEN
    RAISE EXCEPTION 'A26 all refunded: want 3 back (never more than consumed), 10 left; got % cand %',
      to_jsonb(v_u),pg_temp.i4624u_cand(v_brand,'LEGACYTWO');
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  -- A27 only a live hold is extended.
  v_id := pg_temp.i4624u_code(v_owner,v_brand,'LAPSEDHOLD',1000,jsonb_build_object('endsAfterCount',5));
  v_r := public.biz_ticket_checkout_create_session(v_event,NULL,'Lapsed','a27@example.test',
    '+1555'||lpad((abs(hashtext('a27@example.test'))%10000000)::text,7,'0'),false,
    pg_temp.i4624u_cart(v_ga,2),'i4624u-a27',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'LAPSEDHOLD',NULL);
  v_session := (v_r->>'checkoutSessionId')::uuid;
  UPDATE public.discount_uses SET expires_at=now()-interval '1 second' WHERE checkout_ref_id=v_session;
  IF public.issue_4624_extend_discount_hold(v_session,now()+interval '33 minutes') <> 0
     OR (SELECT expires_at FROM public.discount_uses WHERE checkout_ref_id=v_session) > now() THEN
    RAISE EXCEPTION 'A27 a lapsed hold was extended';
  END IF;
  -- The applied discount carries limited, which is what the edge reads.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'items') i, jsonb_array_elements(i->'applied') a
      WHERE (a->>'limited')::boolean) THEN
    RAISE EXCEPTION 'A27 the capped code''s applied entry does not carry limited: %',v_r;
  END IF;
  UPDATE public.brand_discounts SET status='ended',ended_reason='host' WHERE id=v_id;

  RAISE NOTICE 'issue_4624_code_ticket_limit tester retest: PASS (A11-A27)';
END;
$retest$;

ROLLBACK;

-- ===========================================================================
-- A24 a refund racing a new checkout (committed fixtures, two dblink
-- sessions, cleaned up by id below). The refund's return trigger takes no lock
-- on the discount, so:
--   (1) a reservation started while a refund is still open does not wait for
--       it and stays conservative (it cannot see the uncommitted places);
--   (2) once the refund commits, the next checkout gets the freed places;
--   (3) a refund started while a reservation holds the discount lock does not
--       wait either, and neither order deadlocks; units never pass the cap.
-- ===========================================================================
CREATE SCHEMA i4624t_race;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA i4624t_race;
SELECT n.nspname AS i4624t_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"i4624t_dblink_schema";
CREATE TABLE i4624t_race.conn AS
  SELECT format('host=127.0.0.1 port=%s dbname=%s user=supabase_admin password=%s',
    current_setting('port'), current_database(), :'i4624t_pw') AS conn;
CREATE TABLE i4624t_race.flag AS
  SELECT is_enabled FROM public.feature_flags WHERE flag_key='discounts_enabled';
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';

DO $a24setup$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-0000000000c1';
  v_brand uuid := '46240000-0000-4000-8100-0000000000c1';
  v_event uuid := '46240000-0000-4000-8200-0000000000c1';
  v_tt uuid := '46240000-0000-4000-8300-0000000000c1';
  v_created jsonb; v_session uuid; v_order uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-a24-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-a24-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 a24 brand','issue-4624-a24-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624_a24',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'A24 Night','issue-4624-a24-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES(v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES (v_tt,v_event,'General',2500,'USD',false,100,false,1,10,true,false,true);
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','RACEBACK','name','Race back',
    'valueType','percent','valueBps',5000,'scopeKind','brand','endsAfterCount',5));
  -- One paid checkout uses all 5 places.
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'First','a24-first@example.test','+15555556101',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_tt,'quantity',5)),
    'i4624t-a24-first',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'RACEBACK',NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_i4624t_a24','ch_i4624t_a24','card',
    'i4624t-test-pepper-0123456789abcdef0123456789abcd');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  v_order := (SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session);
  IF v_order IS NULL OR (SELECT sum(units) FROM public.discount_uses u JOIN public.brand_discounts d ON d.id=u.discount_id
      WHERE d.brand_id=v_brand AND u.status='consumed') <> 5 THEN
    RAISE EXCEPTION 'A24 setup: want one order consuming 5 units';
  END IF;
END;
$a24setup$;

DO $a24$
DECLARE
  v_conn text := (SELECT conn FROM i4624t_race.conn);
  v_brand text := '46240000-0000-4000-8100-0000000000c1';
  v_order uuid := (SELECT s.order_id FROM public.ticket_checkout_sessions s WHERE s.idempotency_key='i4624t-a24-first');
  v_reserve text := $c$
    public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),
      '46240000-0000-4000-8100-0000000000c1','USD',
      jsonb_build_array(jsonb_build_object('lineRef','46240000-0000-4000-8300-0000000000c1',
        'itemKind','ticket_type','itemId','46240000-0000-4000-8300-0000000000c1',
        'listingId','46240000-0000-4000-8200-0000000000c1','listingKind','event',
        'listUnitMinor',2500,'qty',%s,'valueScale',1,'countScale',1,'allowed',true,'tz','UTC')),
      'RACEBACK',jsonb_build_object('email',%L),NULL,now()+interval '15 minutes',false,'online')
  $c$;
  v_d1 integer; v_r1 text; v_d2 integer; v_units integer; v_returned integer;
BEGIN
  -- (1) The refund of 2 tickets (2 x 12.50) stays open 1.5 s.
  PERFORM dblink_connect('i4624t_ref',v_conn);
  PERFORM dblink_connect('i4624t_chk',v_conn);
  PERFORM dblink_send_query('i4624t_ref',format(
    'SELECT (public.biz_refund_order_commit_from_webhook(%L,''re_i4624t_a24'',2500,''USD'',NULL,NULL) IS NOT NULL), pg_sleep(1.5) IS NULL',
    v_order));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4624t_chk',format(
    'SELECT (r->''quote''->>''discountMinor'')::integer, r->''quote''->''codeOutcome''->>''reason'' FROM (SELECT %s r) q',
    format(v_reserve,1,'a24-during@example.test')));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('i4624t_chk') <> 0 THEN
    RAISE EXCEPTION 'A24 (1) a checkout waited on an open refund (the return path must not lock the discount)';
  END IF;
  SELECT d,r INTO v_d1,v_r1 FROM dblink_get_result('i4624t_chk') AS t(d integer, r text);
  PERFORM * FROM dblink_get_result('i4624t_ref') AS t(a boolean, b boolean);
  PERFORM dblink_disconnect('i4624t_ref');
  PERFORM dblink_disconnect('i4624t_chk');
  IF v_d1 <> 0 OR v_r1 IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'A24 (1) a checkout during an uncommitted refund: want used_up (conservative); got % %',v_d1,v_r1;
  END IF;
  -- (2) After the refund commits, the next checkout gets the 2 places.
  SELECT d INTO v_d2 FROM dblink(v_conn,format('SELECT (r->''quote''->>''discountMinor'')::integer FROM (SELECT %s r) q',
    format(v_reserve,2,'a24-after@example.test'))) AS t(d integer);
  SELECT returned_units INTO v_returned FROM public.discount_uses WHERE order_id=v_order;
  IF v_returned <> 2 OR v_d2 <> 2500 THEN
    RAISE EXCEPTION 'A24 (2) after the refund: want 2 returned and the next 2 tickets discounted; got % / %',v_returned,v_d2;
  END IF;
  -- (3) A reservation holds the discount lock 1.5 s; a refund of 1 more ticket
  --     starts meanwhile and must not wait.
  PERFORM dblink_connect('i4624t_ref',v_conn);
  PERFORM dblink_connect('i4624t_chk',v_conn);
  PERFORM dblink_send_query('i4624t_chk',format(
    'SELECT (r->''quote''->>''discountMinor'')::integer, pg_sleep(1.5) IS NULL FROM (SELECT %s r) q',
    format(v_reserve,1,'a24-holder@example.test')));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4624t_ref',format(
    'UPDATE public.tickets SET status=''refunded'' WHERE id=(SELECT id FROM public.tickets WHERE order_id=%L AND status=''valid'' ORDER BY id LIMIT 1)',
    v_order));
  PERFORM pg_sleep(0.3);
  IF dblink_is_busy('i4624t_ref') <> 0 THEN
    RAISE EXCEPTION 'A24 (3) a refund waited on a checkout holding the discount lock';
  END IF;
  PERFORM * FROM dblink_get_result('i4624t_ref') AS t(status text);
  SELECT d INTO v_d1 FROM dblink_get_result('i4624t_chk') AS t(d integer, s boolean);
  PERFORM dblink_disconnect('i4624t_ref');
  PERFORM dblink_disconnect('i4624t_chk');
  SELECT returned_units INTO v_returned FROM public.discount_uses WHERE order_id=v_order;
  SELECT COALESCE(sum(CASE WHEN u.status='consumed' THEN u.units-u.returned_units ELSE u.units END),0) INTO v_units
    FROM public.discount_uses u JOIN public.brand_discounts d ON d.id=u.discount_id
   WHERE d.brand_id=v_brand::uuid AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>now()));
  IF v_returned <> 3 OR v_d1 <> 0 OR v_units > 5 THEN
    RAISE EXCEPTION 'A24 (3) refund beside a held lock: want 3 returned, the 1-ticket hold undiscounted (0 left when it counted), net units <= 5; got returned %, hold discount %, units %',
      v_returned,v_d1,v_units;
  END IF;
  RAISE NOTICE 'issue_4624_code_ticket_limit tester retest: PASS (A24 refund vs checkout race)';
END;
$a24$;

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.discount_uses WHERE brand_id='46240000-0000-4000-8100-0000000000c1';
DELETE FROM public.order_discount_lines WHERE brand_id='46240000-0000-4000-8100-0000000000c1';
DELETE FROM public.tickets WHERE event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.order_line_items li USING public.orders o
  WHERE li.order_id=o.id AND o.event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.orders WHERE event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.ticket_checkout_session_items i USING public.ticket_checkout_sessions x
  WHERE i.checkout_session_id=x.id AND x.event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.ticket_checkout_sessions WHERE event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.brand_discount_targets t USING public.brand_discounts d
  WHERE t.discount_id=d.id AND d.brand_id='46240000-0000-4000-8100-0000000000c1';
DELETE FROM public.brand_discounts WHERE brand_id='46240000-0000-4000-8100-0000000000c1';
DELETE FROM public.ticket_types WHERE event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.event_dates WHERE event_id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.events WHERE id='46240000-0000-4000-8200-0000000000c1';
DELETE FROM public.stripe_connect_accounts WHERE brand_id='46240000-0000-4000-8100-0000000000c1';
DELETE FROM public.brands WHERE id='46240000-0000-4000-8100-0000000000c1';
DELETE FROM public.creator_accounts WHERE id='46240000-0000-4000-8000-0000000000c1';
DELETE FROM auth.users WHERE id='46240000-0000-4000-8000-0000000000c1';
UPDATE public.feature_flags f SET is_enabled=x.is_enabled FROM i4624t_race.flag x WHERE f.flag_key='discounts_enabled';
COMMIT;
RESET search_path;
DROP SCHEMA i4624t_race CASCADE;
\echo 'issue #4624 code ticket limit tester adversarial suite passed (A1-A27)'
