-- MINGLA-INVARIANT: I-4624-27 | issue #4624 | The checkout that consumes a discount's last ticket (ends_after_count) or last use (max_total_uses) ends it in the same transaction with the sweep's ended_reason, while reopening after a return stays in the sweep (D-4c) so the return path never locks the discount; both go through issue_4624_settle_discount_limits, which on the consume skips (never waits on) a discount row another transaction holds, so two checkouts of one code cannot deadlock.
-- Issue #4624 follow-up 2: a used-up ticket-capped code read ACTIVE in the Host
-- list until the nightly clean-up. On the fully replayed PostgreSQL 17 schema
-- with 20281207014624_issue_4624_used_up_code_ends.sql applied:
--   U1 cap 3: two tickets leave it active; the third ends it 'count' in the
--      consume itself (no sweep), the Host list moves it from live to ended.
--   U2 max_total_uses 2: the second checkout ends it 'uses'.
--   U3 a free (100%) code order ends its code the same way.
--   U4 an uncapped code and a capped code with room are untouched (no version
--      bump on the uncapped one).
--   U5 the sweep still announces the code ended at consume (business.discount_ended,
--      reason count) and changes nothing else.
--   U1b a buyer typing a code ended at consume still gets used_up ("has been
--      fully used"), not "has ended".
--   U6 a refund that frees a place leaves the row ended (the return path takes
--      no discount lock) but the place is usable at once; the next sweep
--      reopens the row (D-4c): active,
--      ended_reason and notified_* cleared, list live again, and the freed
--      place ends it again at once when it is used.
--   U7 host-ended and window-ended codes never reopen.
--   U8 a run-out code whose text a live code now uses stays ended; a reopen the
--      code-text guard refuses keeps that code ended and the sweep completes.
--   U9 (item 3 engine facts) a venue menu line with more items than the code
--      has left gets a code notice on lineRef 001; a deposit line (qty 1) on a
--      code with none left is rejected used_up with no notice, so the deposit
--      screen's reason line already covers it.
--   U10 (committed fixtures, dblink) the consume never waits on another
--      checkout of the same code: while that one holds the discount row FOR KEY
--      SHARE (its order_discount_lines insert), the checkout that takes the last
--      ticket completes at once and leaves the code for the sweep, which ends it.
-- FAILS-ON-REVERT: without 20281207014624, U1 (still active after the third
-- ticket), U2 and U3 fail; with the old sweep body, U8 (a refused reopen
-- aborts the whole sweep) fails.
-- Runs as supabase_admin (dblink needs a password login over loopback).
\set ON_ERROR_STOP on
\getenv i4624e_pw PGPASSWORD
BEGIN;

CREATE FUNCTION pg_temp.i4624e_buy(p_event uuid,p_tt uuid,p_qty integer,p_code text,p_email text,
  p_free boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_created jsonb; v_session uuid; v_final jsonb;
BEGIN
  v_created := public.biz_ticket_checkout_create_session(
    p_event,NULL,'Buyer',p_email,'+1555'||lpad((abs(hashtext(p_email))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',p_tt,'quantity',p_qty)),
    'i4624e-'||gen_random_uuid()::text,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,
    p_code,NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  IF p_free THEN
    v_final := public.biz_ticket_checkout_finalize(v_session,NULL,NULL,'free',
      'i4624e-test-pepper-0123456789abcdef0123456789abcd');
  ELSE
    PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_'||replace(v_session::text,'-',''),
      'ch_'||replace(v_session::text,'-',''),'card','i4624e-test-pepper-0123456789abcdef0123456789abcd');
    PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
    v_final := jsonb_build_object('outcome','finalized','orderId',
      (SELECT order_id FROM public.ticket_checkout_sessions WHERE id=v_session));
  END IF;
  RETURN jsonb_build_object('session',v_session,'order',v_final->>'orderId','outcome',v_final->>'outcome');
END;
$f$;

CREATE FUNCTION pg_temp.i4624e_state(p_id uuid)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT status||'/'||COALESCE(ended_reason,'-') FROM public.brand_discounts WHERE id=p_id;
$f$;

CREATE FUNCTION pg_temp.i4624e_list(p_brand uuid,p_id uuid,p_filter text)
RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT r FROM public.brand_discounts_list(p_brand,p_filter) r WHERE r->>'id'=p_id::text;
$f$;

CREATE FUNCTION pg_temp.i4624e_code(p_owner uuid,p_brand uuid,p_code text,p_bps integer,p_extra jsonb)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT (public.issue_3872_upsert_discount(p_owner,'create',jsonb_build_object(
    'brandId',p_brand,'kind','code','code',p_code,'name','Code '||p_code,'valueType','percent',
    'valueBps',p_bps,'scopeKind','brand')||p_extra)->>'id')::uuid;
$f$;

-- U8: a stand-in for the code-text guard refusing a reopen (rolled back).
CREATE FUNCTION public.i4624e_refuse_reopen() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.code='REFUSED' AND OLD.status='ended' AND NEW.status<>'ended' THEN
    RAISE EXCEPTION 'code_taken';
  END IF;
  RETURN NEW;
END;
$f$;
CREATE TRIGGER i4624e_refuse_reopen BEFORE UPDATE ON public.brand_discounts
FOR EACH ROW EXECUTE FUNCTION public.i4624e_refuse_reopen();

DO $used_up$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000701';
  v_brand uuid := '46240000-0000-4000-8100-000000000701';
  v_event uuid := '46240000-0000-4000-8200-000000000701';
  v_ga uuid := '46240000-0000-4000-8300-000000000701';
  v_venue uuid := '46240000-0000-4000-8400-000000000701';
  v_item uuid := '46240000-0000-4000-8500-000000000701';
  v_id uuid; v_open uuid; v_capped uuid; v_dup uuid;
  v_b jsonb; v_b2 jsonb; v_m jsonb; v_q jsonb; v_l jsonb;
  v_order uuid; v_version integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-ends-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-ends-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 ends brand','issue-4624-ends-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624_ends',true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'Ends Night','issue-4624-ends-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master) VALUES
    (v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES (v_ga,v_event,'General',2500,'USD',false,200,false,1,10,true,false,true);
  -- The Host list reads auth.uid(); act as the brand owner.
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);

  -- U1 cap 3 ----------------------------------------------------------------------
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'ENDS3',1000,'{"endsAfterCount":3}');
  v_b := pg_temp.i4624e_buy(v_event,v_ga,2,'ENDS3','u1a@example.test');
  IF v_b->>'outcome' <> 'finalized' OR pg_temp.i4624e_state(v_id) <> 'active/-'
     OR (pg_temp.i4624e_list(v_brand,v_id,'live')->>'consumedUnits')::integer <> 2 THEN
    RAISE EXCEPTION 'U1 two of three tickets: want active and 2 used in the live list; got % %',
      pg_temp.i4624e_state(v_id),v_b;
  END IF;
  v_b := pg_temp.i4624e_buy(v_event,v_ga,1,'ENDS3','u1b@example.test');
  v_l := pg_temp.i4624e_list(v_brand,v_id,'ended');
  IF pg_temp.i4624e_state(v_id) <> 'ended/count'
     OR pg_temp.i4624e_list(v_brand,v_id,'live') IS NOT NULL
     OR v_l IS NULL OR (v_l->>'consumedUnits')::integer <> 3
     OR (SELECT notified_ended_at FROM public.brand_discounts WHERE id=v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'U1 the third ticket: want ended/count at once and the code in the ended list; got % live % ended %',
      pg_temp.i4624e_state(v_id),pg_temp.i4624e_list(v_brand,v_id,'live'),v_l;
  END IF;
  v_order := (v_b->>'order')::uuid;
  -- U1b a buyer typing the ended code still hears "fully used", never "has ended".
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(jsonb_build_object(
      'lineRef',v_ga,'itemKind','ticket_type','itemId',v_ga,'listingId',v_event,'listingKind','event',
      'listUnitMinor',2500,'qty',1,'valueScale',1,'countScale',1,'allowed',true,'tz','UTC')),
    'ENDS3',jsonb_build_object('email','u1c@example.test'));
  IF v_q#>>'{codeOutcome,reason}' IS DISTINCT FROM 'used_up' THEN
    RAISE EXCEPTION 'U1b ended at consume: want the buyer reason used_up; got %',v_q->'codeOutcome';
  END IF;

  -- U5 the sweep still announces it, once, and changes nothing else.
  v_m := public.issue_3872_discount_maintenance(now());
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_m->'notify') x
      WHERE x->>'discountId'=v_id::text AND x->>'type'='business.discount_ended' AND x->>'reason'='count')
     OR pg_temp.i4624e_state(v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'U5 the sweep after a consume-time end: want business.discount_ended/count; got % state %',
      v_m,pg_temp.i4624e_state(v_id);
  END IF;

  -- U6 a refund frees a place: still ended (no lock on the return path), and
  -- the next sweep reopens it.
  UPDATE public.brand_discounts SET notified_ended_at=now() WHERE id=v_id;
  PERFORM public.biz_refund_order_commit_from_webhook(v_order,'re_i4624e_6',2250,'USD',NULL,NULL);
  IF pg_temp.i4624e_state(v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'U6 the refund itself must not touch the discount row; got %',pg_temp.i4624e_state(v_id);
  END IF;
  -- The freed place is usable at once, before the sweep reopens the row.
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(jsonb_build_object(
      'lineRef',v_ga,'itemKind','ticket_type','itemId',v_ga,'listingId',v_event,'listingKind','event',
      'listUnitMinor',2500,'qty',1,'valueScale',1,'countScale',1,'allowed',true,'tz','UTC')),
    'ENDS3',jsonb_build_object('email','u6q@example.test'));
  IF v_q#>>'{codeOutcome,status}' <> 'applied' OR (v_q->>'discountMinor')::integer <> 250 THEN
    RAISE EXCEPTION 'U6 the freed place before the sweep: want the code applied (250 off); got %',v_q;
  END IF;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.i4624e_state(v_id) <> 'active/-'
     OR (SELECT notified_ended_at FROM public.brand_discounts WHERE id=v_id) IS NOT NULL
     OR (pg_temp.i4624e_list(v_brand,v_id,'live')->>'consumedUnits')::integer <> 2 THEN
    RAISE EXCEPTION 'U6 the sweep after a refund freed a place: want active again with 2 used; got % %',
      pg_temp.i4624e_state(v_id),(SELECT to_jsonb(d) FROM public.brand_discounts d WHERE id=v_id);
  END IF;
  -- The freed place is usable: the next ticket ends it again.
  PERFORM pg_temp.i4624e_buy(v_event,v_ga,1,'ENDS3','u6@example.test');
  IF pg_temp.i4624e_state(v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'U6 the freed place used again: want ended/count; got %',pg_temp.i4624e_state(v_id);
  END IF;

  -- U2 max_total_uses 2 ------------------------------------------------------------
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'USES2',1000,'{"maxTotalUses":2}');
  PERFORM pg_temp.i4624e_buy(v_event,v_ga,3,'USES2','u2a@example.test');
  IF pg_temp.i4624e_state(v_id) <> 'active/-' THEN
    RAISE EXCEPTION 'U2 one of two uses: want active; got %',pg_temp.i4624e_state(v_id);
  END IF;
  PERFORM pg_temp.i4624e_buy(v_event,v_ga,1,'USES2','u2b@example.test');
  IF pg_temp.i4624e_state(v_id) <> 'ended/uses' THEN
    RAISE EXCEPTION 'U2 the second use: want ended/uses at once; got %',pg_temp.i4624e_state(v_id);
  END IF;

  -- U3 a free (100%) code order ends its code too --------------------------------
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'FREE2',10000,'{"endsAfterCount":2}');
  v_b := pg_temp.i4624e_buy(v_event,v_ga,2,'FREE2','u3@example.test',true);
  IF v_b->>'outcome' <> 'finalized' OR pg_temp.i4624e_state(v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'U3 free order took the last 2 tickets: want ended/count; got % %',
      pg_temp.i4624e_state(v_id),v_b;
  END IF;

  -- U4 an uncapped code and a capped code with room are untouched ----------------
  v_open := pg_temp.i4624e_code(v_owner,v_brand,'OPEN10',1000,'{}');
  v_capped := pg_temp.i4624e_code(v_owner,v_brand,'ROOM10',1000,'{"endsAfterCount":10}');
  v_version := (SELECT version FROM public.brand_discounts WHERE id=v_open);
  PERFORM pg_temp.i4624e_buy(v_event,v_ga,4,'OPEN10','u4a@example.test');
  PERFORM pg_temp.i4624e_buy(v_event,v_ga,4,'ROOM10','u4b@example.test');
  IF pg_temp.i4624e_state(v_open) <> 'active/-' OR pg_temp.i4624e_state(v_capped) <> 'active/-'
     OR (SELECT version FROM public.brand_discounts WHERE id=v_open) <> v_version THEN
    RAISE EXCEPTION 'U4 uncapped / room left: want both active and the uncapped row untouched; got % %',
      pg_temp.i4624e_state(v_open),pg_temp.i4624e_state(v_capped);
  END IF;

  -- U7 host-ended and window-ended codes never reopen on a refund -----------------
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'HOSTEND',1000,'{"endsAfterCount":2}');
  v_b := pg_temp.i4624e_buy(v_event,v_ga,2,'HOSTEND','u7a@example.test');
  UPDATE public.brand_discounts SET ended_reason='host' WHERE id=v_id;
  PERFORM public.biz_refund_order_commit_from_webhook((v_b->>'order')::uuid,'re_i4624e_7a',2250,'USD',NULL,NULL);
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.i4624e_state(v_id) <> 'ended/host' THEN
    RAISE EXCEPTION 'U7 a host-ended code reopened on a refund: %',pg_temp.i4624e_state(v_id);
  END IF;
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'PASTEND',1000,'{"endsAfterCount":2}');
  v_b := pg_temp.i4624e_buy(v_event,v_ga,2,'PASTEND','u7b@example.test');
  UPDATE public.brand_discounts SET ends_at=now()-interval '1 second',starts_at=now()-interval '1 day'
   WHERE id=v_id;
  PERFORM public.biz_refund_order_commit_from_webhook((v_b->>'order')::uuid,'re_i4624e_7b',2250,'USD',NULL,NULL);
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.i4624e_state(v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'U7 a code past its end date reopened on a refund: %',pg_temp.i4624e_state(v_id);
  END IF;

  -- U8 a run-out code whose text a live code now uses stays ended; the refund commits.
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'SAMETEXT',1000,'{"endsAfterCount":1}');
  v_b := pg_temp.i4624e_buy(v_event,v_ga,1,'SAMETEXT','u8@example.test');
  IF pg_temp.i4624e_state(v_id) <> 'ended/count' THEN
    RAISE EXCEPTION 'U8 setup: want ended/count; got %',pg_temp.i4624e_state(v_id);
  END IF;
  v_dup := pg_temp.i4624e_code(v_owner,v_brand,'SAMETEXT',500,'{}');
  PERFORM public.biz_refund_order_commit_from_webhook((v_b->>'order')::uuid,'re_i4624e_8',2250,'USD',NULL,NULL);
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.i4624e_state(v_id) <> 'ended/count' OR pg_temp.i4624e_state(v_dup) <> 'active/-'
     OR (SELECT returned_units FROM public.discount_uses WHERE discount_id=v_id) <> 1 THEN
    RAISE EXCEPTION 'U8 same text live elsewhere: want the old code ended, the new one active, the place returned; got % % %',
      pg_temp.i4624e_state(v_id),pg_temp.i4624e_state(v_dup),
      (SELECT returned_units FROM public.discount_uses WHERE discount_id=v_id);
  END IF;
  -- A reopen the code-text guard refuses (code_taken, as a referral link with
  -- the same text raises) keeps that code ended and never fails the sweep.
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'REFUSED',1000,'{"endsAfterCount":1}');
  v_b := pg_temp.i4624e_buy(v_event,v_ga,1,'REFUSED','u8b@example.test');
  PERFORM public.biz_refund_order_commit_from_webhook((v_b->>'order')::uuid,'re_i4624e_8b',2250,'USD',NULL,NULL);
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.i4624e_state(v_id) <> 'ended/count'
     OR (SELECT returned_units FROM public.discount_uses WHERE discount_id=v_id) <> 1
     OR (SELECT count(*) FROM public.tickets WHERE order_id=(v_b->>'order')::uuid AND status='refunded') <> 1 THEN
    RAISE EXCEPTION 'U8 a refused reopen: want the code ended, the sweep done, the place returned; got % %',
      pg_temp.i4624e_state(v_id),(SELECT to_jsonb(u) FROM public.discount_uses u WHERE discount_id=v_id);
  END IF;

  -- U9 item 3 engine facts: venue menu line and deposit line -------------------------
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'MENU2',1000,'{"endsAfterCount":2}');
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(jsonb_build_object(
      'lineRef','001','itemKind','menu_item','itemId',v_item,'listingKind','venue_order',
      'listingId',v_venue,'listUnitMinor',1200,'qty',3,'valueScale',1,'countScale',1,
      'allowed',true,'tz','UTC')),'MENU2',jsonb_build_object('email','u9@example.test'));
  IF (v_q->>'discountMinor')::integer <> 0 OR jsonb_array_length(v_q->'notices') <> 1
     OR v_q#>>'{notices,0,lineRef}' <> '001' OR v_q#>>'{notices,0,discountKind}' <> 'code'
     OR v_q#>>'{notices,0,remaining}' <> '2' THEN
    RAISE EXCEPTION 'U9 venue line of 3 on a code with 2 left: want full price and a code notice on 001; got %',v_q;
  END IF;
  v_id := pg_temp.i4624e_code(v_owner,v_brand,'DEPOSIT1',1000,'{"endsAfterCount":1}');
  PERFORM public.issue_3872_reserve_discount_uses('reservation_deposit',gen_random_uuid(),v_brand,'USD',
    jsonb_build_array(jsonb_build_object('lineRef','deposit','itemKind','venue_deposit','itemId',v_venue,
      'listingId',v_venue,'listingKind','reservation_deposit','listUnitMinor',5000,'qty',1,'valueScale',1,
      'countScale',1,'allowed',true,'tz','UTC')),
    'DEPOSIT1',jsonb_build_object('email','u9a@example.test'),NULL,now()+interval '1 day',true,'online');
  v_q := public.issue_3872_discount_quote_lines(v_brand,'USD',jsonb_build_array(jsonb_build_object(
      'lineRef','deposit','itemKind','venue_deposit','itemId',v_venue,'listingId',v_venue,
      'listingKind','reservation_deposit','listUnitMinor',5000,'qty',1,'valueScale',1,'countScale',1,
      'allowed',true,'tz','UTC')),'DEPOSIT1',jsonb_build_object('email','u9b@example.test'));
  IF v_q#>>'{codeOutcome,reason}' IS DISTINCT FROM 'used_up' OR jsonb_array_length(v_q->'notices') <> 0 THEN
    RAISE EXCEPTION 'U9 deposit on a code with none left: want used_up and no notice; got %',v_q;
  END IF;

  RAISE NOTICE 'issue_4624_used_up_code_ends: PASS (U1-U9)';
END;
$used_up$;

ROLLBACK;

-- U10 the consume never waits on another checkout of the same code -----------------
CREATE SCHEMA i4624e_race;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA i4624e_race;
SELECT n.nspname AS i4624e_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"i4624e_dblink_schema";
CREATE TABLE i4624e_race.conn AS
  SELECT format('host=127.0.0.1 port=%s dbname=%s user=supabase_admin password=%s',
    current_setting('port'), current_database(), :'i4624e_pw') AS conn;
CREATE TABLE i4624e_race.flag AS
  SELECT is_enabled FROM public.feature_flags WHERE flag_key='discounts_enabled';
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';

DO $u10setup$
DECLARE
  v_owner uuid := '46240000-0000-4000-8000-000000000702';
  v_brand uuid := '46240000-0000-4000-8100-000000000702';
  v_event uuid := '46240000-0000-4000-8200-000000000702';
  v_tt uuid := '46240000-0000-4000-8300-000000000702';
  v_created jsonb; v_session uuid; v_order uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'issue4624-u10-owner@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'issue4624-u10-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES(v_brand,v_owner,'Issue 4624 u10 brand','issue-4624-u10-brand','USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(
    brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
  ) VALUES(v_brand,'acct_issue_4624_u10',true,true,'US','usd');
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
  ) VALUES (v_event,v_brand,v_owner,'U10 Night','issue-4624-u10-e1','event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
    VALUES(v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(
    id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed
  ) VALUES (v_tt,v_event,'General',2500,'USD',false,100,false,1,10,true,false,true);
  PERFORM public.issue_3872_upsert_discount(v_owner,'create',jsonb_build_object(
    'brandId',v_brand,'kind','code','code','LOCKED3','name','Locked three',
    'valueType','percent','valueBps',1000,'scopeKind','brand','endsAfterCount',3));
  -- A live hold of all 3 tickets (no late path, so the consume takes no
  -- blocking discount lock of its own).
  v_created := public.biz_ticket_checkout_create_session(
    v_event,NULL,'Buyer','u10@example.test','+15555557101',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_tt,'quantity',3)),
    'i4624e-u10',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'LOCKED3',NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  v_order := gen_random_uuid();
  INSERT INTO public.orders(
    id,event_id,buyer_email,buyer_name,buyer_phone,buyer_phone_e164,total_cents,
    currency,payment_method,payment_status,checkout_session_id,source,notification_status
  ) VALUES(v_order,v_event,'u10@example.test','Buyer','+15555557101','+15555557101',6750,'USD',
    'online_card','paid',v_session,'online_checkout','pending');
  INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents,total_cents)
    VALUES(v_order,v_tt,3,2250,6750);
  UPDATE public.ticket_checkout_sessions SET order_id=v_order,
    list_subtotal_cents=7500,discount_cents=750,net_subtotal_cents=6750,
    buyer_fees_cents=0,tax_cents=0,buyer_total_cents=6750,pricing_source='computed_at_checkout'
    WHERE id=v_session;
END;
$u10setup$;

DO $u10$
DECLARE
  v_conn text := (SELECT conn FROM i4624e_race.conn);
  v_session uuid := (SELECT id FROM public.ticket_checkout_sessions WHERE idempotency_key='i4624e-u10');
  v_id uuid := (SELECT id FROM public.brand_discounts
    WHERE brand_id='46240000-0000-4000-8100-000000000702' AND code='LOCKED3');
  v_busy integer; v_state text; v_use text;
BEGIN
  IF v_session IS NULL OR v_id IS NULL THEN RAISE EXCEPTION 'U10 setup missing'; END IF;
  PERFORM dblink_connect('i4624e_hold',v_conn);
  PERFORM dblink_connect('i4624e_pay',v_conn);
  -- Another checkout of the same code is mid-finalize: its order_discount_lines
  -- insert holds the discount row FOR KEY SHARE (the foreign key) for 2 s. A
  -- blocking FOR UPDATE here would wait on it (and two such finalizes would
  -- deadlock upgrading their key-share locks); the settle skips instead.
  PERFORM dblink_send_query('i4624e_hold',format(
    'SELECT count(*) FROM (SELECT 1 FROM public.brand_discounts WHERE id=%L FOR KEY SHARE) x, pg_sleep(2) s',v_id));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4624e_pay',format(
    'SELECT (public.issue_3872_copy_session_totals_to_order(%L) IS NULL)',v_session));
  PERFORM pg_sleep(0.6);
  v_busy := dblink_is_busy('i4624e_pay');
  PERFORM * FROM dblink_get_result('i4624e_pay') AS t(a boolean);
  PERFORM * FROM dblink_get_result('i4624e_hold') AS t(n bigint);
  PERFORM dblink_disconnect('i4624e_hold');
  PERFORM dblink_disconnect('i4624e_pay');
  SELECT status||'/'||COALESCE(ended_reason,'-') INTO v_state FROM public.brand_discounts WHERE id=v_id;
  SELECT status INTO v_use FROM public.discount_uses WHERE checkout_ref_id=v_session;
  IF v_busy <> 0 OR v_use <> 'consumed' OR v_state <> 'active/-' THEN
    RAISE EXCEPTION 'U10 consume beside a held discount row: want it done at once, consumed, the code left active; got busy %, use %, state %',
      v_busy,v_use,v_state;
  END IF;
  PERFORM public.issue_3872_discount_maintenance(now());
  SELECT status||'/'||COALESCE(ended_reason,'-') INTO v_state FROM public.brand_discounts WHERE id=v_id;
  IF v_state <> 'ended/count' THEN
    RAISE EXCEPTION 'U10 the sweep: want ended/count; got %',v_state;
  END IF;
  RAISE NOTICE 'issue_4624_used_up_code_ends: PASS (U10 the consume never waits)';
END;
$u10$;

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.discount_uses WHERE brand_id='46240000-0000-4000-8100-000000000702';
DELETE FROM public.order_discount_lines WHERE brand_id='46240000-0000-4000-8100-000000000702';
DELETE FROM public.tickets WHERE event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.order_line_items li USING public.orders o
  WHERE li.order_id=o.id AND o.event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.orders WHERE event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.ticket_checkout_session_items i USING public.ticket_checkout_sessions x
  WHERE i.checkout_session_id=x.id AND x.event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.ticket_checkout_sessions WHERE event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.brand_discount_targets t USING public.brand_discounts d
  WHERE t.discount_id=d.id AND d.brand_id='46240000-0000-4000-8100-000000000702';
DELETE FROM public.brand_discounts WHERE brand_id='46240000-0000-4000-8100-000000000702';
DELETE FROM public.ticket_types WHERE event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.event_dates WHERE event_id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.events WHERE id='46240000-0000-4000-8200-000000000702';
DELETE FROM public.stripe_connect_accounts WHERE brand_id='46240000-0000-4000-8100-000000000702';
DELETE FROM public.brands WHERE id='46240000-0000-4000-8100-000000000702';
DELETE FROM public.creator_accounts WHERE id='46240000-0000-4000-8000-000000000702';
DELETE FROM auth.users WHERE id='46240000-0000-4000-8000-000000000702';
UPDATE public.feature_flags f SET is_enabled=x.is_enabled FROM i4624e_race.flag x WHERE f.flag_key='discounts_enabled';
COMMIT;
RESET search_path;
DROP SCHEMA i4624e_race CASCADE;
\echo 'issue #4624 used-up code ends suite passed (U1-U10)'
