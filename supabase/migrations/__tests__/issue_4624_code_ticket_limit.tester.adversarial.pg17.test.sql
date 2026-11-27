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
-- follows one unit per ticket issued (D-3a); both expectations were updated.
-- FAILS-ON-REVERT: with origin/main's functions and constraint (the migration
-- reverted) the first code create with endsAfterCount fails on bd_count_end;
-- with only the constraint lifted, A1 fails (the 6-ticket line is discounted).
\set ON_ERROR_STOP on
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
  -- The buyer follows the notice (3 + 2) in the same checkout: both lines fit.
  PERFORM public.issue_3872_release_discount_uses('ticket',v_hold);
  v_r := public.issue_3872_reserve_discount_uses('ticket',gen_random_uuid(),v_brand,'USD',jsonb_build_array(
      pg_temp.i4624t_line(v_ga,v_event,2500,3), pg_temp.i4624t_line(v_vip,v_event,5000,2)),
    'MULTIA',jsonb_build_object('email','a1y@example.test'),NULL,now()+interval '1 day',true,'online');
  IF (v_r->'quote'->>'discountMinor')::integer <> 17500 OR jsonb_array_length(v_r->'quote'->'notices') <> 0
     OR pg_temp.i4624t_units(v_id) <> 5 THEN
    RAISE EXCEPTION 'A1 3+2 after lowering: want both lines free and 5 units used; got % units %',v_r->'quote',pg_temp.i4624t_units(v_id);
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
\echo 'issue #4624 code ticket limit tester adversarial suite passed (A1-A10)'
