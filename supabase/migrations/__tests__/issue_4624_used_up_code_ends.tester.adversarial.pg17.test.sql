-- MINGLA-INVARIANT: I-4624-28 | issue #4624 | A capped discount never gives more than its limit: the checkout that takes the last ticket or use ends it at once, a basket over what is left gets no discount, two checkouts finishing together never deadlock and leave it ended, a refund's freed place is used without reopening early or over-issuing, and an automatic or sale-price discount that ran out stays off (no discount, no notice) after it ends.
-- Issue #4624 tester adversarial suite for 20281207014624_issue_4624_used_up_code_ends.sql
-- (used-up capped discounts end at consume), on the fully replayed PostgreSQL 17
-- schema. Angles the implementor's U1-U10 do not take:
--   B1  exact fit across two checkouts (3 + 2 on cap 5): ended/count inside the
--       same transaction as the last consume; a later 1-ticket basket pays full
--       price (no use row, no order discount); used units never pass 5.
--   B2  overshoot: 2 used on cap 3, a 2-ticket basket gets no discount and does
--       not end the code; the 1 that fits ends it.
--   B3  max_total_uses 2 with 3-ticket baskets ends 'uses'; a third checkout
--       gets nothing.
--   B4  refund then buy BEFORE the sweep: the freed place is sold once, the code
--       ends again at that consume, the sweep changes nothing; a refund that
--       frees 2 and a buy of 1 leaves the code open (settled at consume).
--   B5  automatic discount with Total uses 2: after it ends 'uses' at consume, a
--       third checkout must get no automatic discount (the engine has no
--       remainingTotalUses check for automatics; only status stops it).
--   B6  sold-out automatic (ends_after_count 2): after it ends 'count', a quote
--       shows no discount and no sale notice, as it did once the sweep ended it.
--   B7  per-buyer-only code and uncapped automatic are never touched at consume
--       (status and version unchanged).
--   B8  deposits: one unit per deposit (qty 1); a deposit that uses the last
--       unit is ended by the sweep with reason 'count'.
--   B9  grants: the new settle function is service_role only; the replaced
--       functions keep SECURITY DEFINER and search_path.
--   B10 (committed fixtures, dblink) two free checkouts of the last 2 tickets
--       finalizing at the same moment: both finish, no deadlock, the code ends
--       'count' without the sweep, 2 units used.
--   B11 (committed fixtures, dblink) the last-ticket consume beside a host edit
--       holding the discount row: it never waits, leaves the code for the
--       sweep, and a checkout in between still gets no discount.
-- FAILS-ON-REVERT: without 20281207014624, B1 (still active after the last
-- consume), B3 and B10 fail. B5 and B6 fail on 20281207014624 as written
-- (issue_3872_discount_candidates reads every run-out discount as active).
-- Runs as supabase_admin (dblink needs a password login over loopback).
\set ON_ERROR_STOP on
\getenv i4624t_pw PGPASSWORD

CREATE FUNCTION pg_temp.t_fix(p_n integer) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_owner uuid := ('46241000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid;
  v_brand uuid := ('46241000-0000-4000-8100-'||lpad(p_n::text,12,'0'))::uuid;
  v_event uuid := ('46241000-0000-4000-8200-'||lpad(p_n::text,12,'0'))::uuid;
  v_tt uuid := ('46241000-0000-4000-8300-'||lpad(p_n::text,12,'0'))::uuid;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'t4624-'||p_n||'@example.test');
  INSERT INTO public.creator_accounts(id,email) VALUES(v_owner,'t4624-'||p_n||'@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency)
  VALUES(v_brand,v_owner,'T4624 brand '||p_n,'t4624-brand-'||p_n,'USD','stripe','US','US','USD');
  INSERT INTO public.stripe_connect_accounts(brand_id,stripe_account_id,charges_enabled,payouts_enabled,
    country,default_currency)
  VALUES(v_brand,'acct_t4624_'||p_n,true,true,'US','usd');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency)
  VALUES (v_event,v_brand,v_owner,'T4624 night '||p_n,'t4624-e-'||p_n,'event','scheduled','public','UTC','USD');
  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES (v_event,now()+interval '3 days',now()+interval '3 days 2 hours','UTC',true);
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
    min_purchase_qty,max_purchase_qty,available_online,available_in_person,discounts_allowed)
  VALUES (v_tt,v_event,'General',2500,'USD',false,200,false,1,10,true,false,true);
  RETURN jsonb_build_object('owner',v_owner,'brand',v_brand,'event',v_event,'tt',v_tt);
END;
$f$;

CREATE FUNCTION pg_temp.t_disc(p_fx jsonb,p_payload jsonb) RETURNS uuid LANGUAGE sql AS $f$
  SELECT (public.issue_3872_upsert_discount((p_fx->>'owner')::uuid,'create',
    jsonb_build_object('brandId',p_fx->>'brand','valueType','percent','scopeKind','brand')||p_payload)->>'id')::uuid;
$f$;

-- A paid checkout: create (reserve), then the payment step and the consume.
CREATE FUNCTION pg_temp.t_buy(p_fx jsonb,p_qty integer,p_code text,p_email text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_created jsonb; v_session uuid; v_order uuid;
BEGIN
  v_created := public.biz_ticket_checkout_create_session(
    (p_fx->>'event')::uuid,NULL,'Buyer',p_email,'+1555'||lpad((abs(hashtext(p_email))%10000000)::text,7,'0'),false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',p_fx->>'tt','quantity',p_qty)),
    't4624-'||gen_random_uuid()::text,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,p_code,NULL);
  v_session := (v_created->>'checkoutSessionId')::uuid;
  PERFORM public.issue_1930_ticket_checkout_finalize_base(v_session,'pi_'||replace(v_session::text,'-',''),
    'ch_'||replace(v_session::text,'-',''),'card','t4624-test-pepper-0123456789abcdef0123456789abcdef');
  PERFORM public.issue_3872_copy_session_totals_to_order(v_session);
  SELECT order_id INTO v_order FROM public.ticket_checkout_sessions WHERE id=v_session;
  RETURN jsonb_build_object('session',v_session,'order',v_order,
    'uses',(SELECT count(*) FROM public.discount_uses WHERE checkout_ref_id=v_session),
    'units',(SELECT COALESCE(sum(units),0) FROM public.discount_uses WHERE checkout_ref_id=v_session),
    'discount',(SELECT COALESCE(sum(amount_minor),0) FROM public.order_discount_lines WHERE order_id=v_order));
END;
$f$;

CREATE FUNCTION pg_temp.t_state(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT status||'/'||COALESCE(ended_reason,'-') FROM public.brand_discounts WHERE id=p_id;
$f$;

-- Net consumed units (tickets) of a discount.
CREATE FUNCTION pg_temp.t_units(p_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(sum(units-returned_units),0) FROM public.discount_uses WHERE discount_id=p_id AND status='consumed';
$f$;

CREATE FUNCTION pg_temp.t_quote(p_fx jsonb,p_qty integer,p_code text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.issue_3872_discount_quote_lines((p_fx->>'brand')::uuid,'USD',jsonb_build_array(jsonb_build_object(
      'lineRef',p_fx->>'tt','itemKind','ticket_type','itemId',p_fx->>'tt','listingId',p_fx->>'event',
      'listingKind','event','listUnitMinor',2500,'qty',p_qty,'valueScale',1,'countScale',1,'allowed',true,'tz','UTC')),
    p_code,jsonb_build_object('email','quote-'||gen_random_uuid()||'@example.test'));
$f$;

-- B1 exact fit ------------------------------------------------------------------
BEGIN;
DO $b1$
DECLARE v_fx jsonb := pg_temp.t_fix(1); v_id uuid; v_b jsonb;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"FIT5","name":"Fit five","valueBps":1000,"endsAfterCount":5}');
  v_b := pg_temp.t_buy(v_fx,3,'FIT5','b1a@example.test');
  IF pg_temp.t_state(v_id)<>'active/-' OR (v_b->>'units')::int<>3 THEN
    RAISE EXCEPTION 'B1 3 of 5: want active, 3 units; got % %',pg_temp.t_state(v_id),v_b;
  END IF;
  v_b := pg_temp.t_buy(v_fx,2,'FIT5','b1b@example.test');
  -- Same transaction as the consume, no sweep.
  IF pg_temp.t_state(v_id)<>'ended/count' OR pg_temp.t_units(v_id)<>5 OR (v_b->>'units')::int<>2 THEN
    RAISE EXCEPTION 'B1 exact fit 3+2 on cap 5: want ended/count at the last consume with 5 units; got % units % %',
      pg_temp.t_state(v_id),pg_temp.t_units(v_id),v_b;
  END IF;
  v_b := pg_temp.t_buy(v_fx,1,'FIT5','b1c@example.test');
  IF (v_b->>'uses')::int<>0 OR (v_b->>'discount')::int<>0 OR pg_temp.t_units(v_id)<>5
     OR pg_temp.t_state(v_id)<>'ended/count' THEN
    RAISE EXCEPTION 'B1 after the cap: a 1-ticket basket must pay full price; got % units % state %',
      v_b,pg_temp.t_units(v_id),pg_temp.t_state(v_id);
  END IF;
  RAISE NOTICE 'B1 PASS';
END;
$b1$;
ROLLBACK;

-- B2 overshoot ------------------------------------------------------------------
BEGIN;
DO $b2$
DECLARE v_fx jsonb := pg_temp.t_fix(2); v_id uuid; v_b jsonb;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"OVER3","name":"Over three","valueBps":1000,"endsAfterCount":3}');
  PERFORM pg_temp.t_buy(v_fx,2,'OVER3','b2a@example.test');
  v_b := pg_temp.t_buy(v_fx,2,'OVER3','b2b@example.test');
  IF (v_b->>'uses')::int<>0 OR (v_b->>'discount')::int<>0 OR pg_temp.t_state(v_id)<>'active/-'
     OR pg_temp.t_units(v_id)<>2 THEN
    RAISE EXCEPTION 'B2 2 tickets on 1 left: want no discount, code still active with 2 units; got % state % units %',
      v_b,pg_temp.t_state(v_id),pg_temp.t_units(v_id);
  END IF;
  v_b := pg_temp.t_buy(v_fx,1,'OVER3','b2c@example.test');
  IF (v_b->>'units')::int<>1 OR pg_temp.t_state(v_id)<>'ended/count' OR pg_temp.t_units(v_id)<>3 THEN
    RAISE EXCEPTION 'B2 the 1 that fits: want ended/count with 3 units; got % state % units %',
      v_b,pg_temp.t_state(v_id),pg_temp.t_units(v_id);
  END IF;
  RAISE NOTICE 'B2 PASS';
END;
$b2$;
ROLLBACK;

-- B3 max_total_uses -------------------------------------------------------------
BEGIN;
DO $b3$
DECLARE v_fx jsonb := pg_temp.t_fix(3); v_id uuid; v_b jsonb;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"TWOUSE","name":"Two uses","valueBps":1000,"maxTotalUses":2}');
  PERFORM pg_temp.t_buy(v_fx,3,'TWOUSE','b3a@example.test');
  IF pg_temp.t_state(v_id)<>'active/-' THEN RAISE EXCEPTION 'B3 1 of 2 uses: %',pg_temp.t_state(v_id); END IF;
  PERFORM pg_temp.t_buy(v_fx,3,'TWOUSE','b3b@example.test');
  IF pg_temp.t_state(v_id)<>'ended/uses' THEN
    RAISE EXCEPTION 'B3 2 of 2 uses: want ended/uses at once; got %',pg_temp.t_state(v_id);
  END IF;
  v_b := pg_temp.t_buy(v_fx,1,'TWOUSE','b3c@example.test');
  IF (v_b->>'uses')::int<>0 OR (v_b->>'discount')::int<>0
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id AND status='consumed')<>2 THEN
    RAISE EXCEPTION 'B3 a third checkout: want no discount and 2 uses; got %',v_b;
  END IF;
  RAISE NOTICE 'B3 PASS';
END;
$b3$;
ROLLBACK;

-- B4 refund, then buy before the sweep -----------------------------------------
BEGIN;
DO $b4$
DECLARE v_fx jsonb := pg_temp.t_fix(4); v_id uuid; v_b jsonb; v_a jsonb;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"BACK2","name":"Back two","valueBps":1000,"endsAfterCount":2}');
  v_a := pg_temp.t_buy(v_fx,1,'BACK2','b4a@example.test');
  PERFORM pg_temp.t_buy(v_fx,1,'BACK2','b4b@example.test');
  IF pg_temp.t_state(v_id)<>'ended/count' THEN RAISE EXCEPTION 'B4 setup: %',pg_temp.t_state(v_id); END IF;
  PERFORM public.biz_refund_order_commit_from_webhook((v_a->>'order')::uuid,'re_t4624_b4',2250,'USD',NULL,NULL);
  IF pg_temp.t_state(v_id)<>'ended/count' OR pg_temp.t_units(v_id)<>1 THEN
    RAISE EXCEPTION 'B4 refund: want still ended/count (no discount lock), 1 unit; got % %',
      pg_temp.t_state(v_id),pg_temp.t_units(v_id);
  END IF;
  -- The freed place, bought before the sweep: sold once, the code ends again.
  v_b := pg_temp.t_buy(v_fx,1,'BACK2','b4c@example.test');
  IF (v_b->>'units')::int<>1 OR pg_temp.t_units(v_id)<>2 OR pg_temp.t_state(v_id)<>'ended/count' THEN
    RAISE EXCEPTION 'B4 freed place bought before the sweep: want 1 unit, 2 in all, ended/count; got % % %',
      v_b,pg_temp.t_units(v_id),pg_temp.t_state(v_id);
  END IF;
  v_b := pg_temp.t_buy(v_fx,1,'BACK2','b4d@example.test');
  IF (v_b->>'uses')::int<>0 OR pg_temp.t_units(v_id)<>2 THEN
    RAISE EXCEPTION 'B4 over-issue after the freed place: want no discount, 2 units; got % %',v_b,pg_temp.t_units(v_id);
  END IF;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.t_state(v_id)<>'ended/count' THEN
    RAISE EXCEPTION 'B4 sweep after the place was resold: want ended/count; got %',pg_temp.t_state(v_id);
  END IF;
  RAISE NOTICE 'B4 PASS';
END;
$b4$;
ROLLBACK;

-- B5 automatic with Total uses 2 (money) ---------------------------------------
BEGIN;
DO $b5$
DECLARE v_fx jsonb := pg_temp.t_fix(5); v_id uuid; v_b jsonb;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"automatic","name":"Two-use sale","valueBps":1000,"maxTotalUses":2}');
  v_b := pg_temp.t_buy(v_fx,1,NULL,'b5a@example.test');
  IF (v_b->>'uses')::int<>1 THEN RAISE EXCEPTION 'B5 setup: the automatic must apply once; got %',v_b; END IF;
  PERFORM pg_temp.t_buy(v_fx,1,NULL,'b5b@example.test');
  IF pg_temp.t_state(v_id)<>'ended/uses' THEN
    RAISE EXCEPTION 'B5 2 of 2 uses: want ended/uses; got %',pg_temp.t_state(v_id);
  END IF;
  v_b := pg_temp.t_buy(v_fx,1,NULL,'b5c@example.test');
  IF (v_b->>'uses')::int<>0 OR (v_b->>'discount')::int<>0
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id AND status='consumed')<>2 THEN
    RAISE EXCEPTION 'B5 an automatic with Total uses 2 that ended: a third checkout must get no discount; got % (uses now %)',
      v_b,(SELECT count(*) FROM public.discount_uses WHERE discount_id=v_id AND status='consumed');
  END IF;
  RAISE NOTICE 'B5 PASS';
END;
$b5$;
ROLLBACK;

-- B6 sold-out automatic: no discount and no notice once ended -------------------
BEGIN;
DO $b6$
DECLARE v_fx jsonb := pg_temp.t_fix(6); v_id uuid; v_q jsonb;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"automatic","name":"Two-ticket sale","valueBps":1000,"endsAfterCount":2}');
  PERFORM pg_temp.t_buy(v_fx,2,NULL,'b6a@example.test');
  IF pg_temp.t_state(v_id)<>'ended/count' THEN
    RAISE EXCEPTION 'B6 setup: want ended/count; got %',pg_temp.t_state(v_id);
  END IF;
  v_q := pg_temp.t_quote(v_fx,1,NULL);
  IF (v_q->>'discountMinor')::int<>0 OR jsonb_array_length(v_q->'notices')<>0 THEN
    RAISE EXCEPTION 'B6 an ended sold-out automatic: want no discount and no notice; got %',v_q;
  END IF;
  RAISE NOTICE 'B6 PASS';
END;
$b6$;
ROLLBACK;

-- B7 per-buyer-only code and uncapped automatic untouched -----------------------
BEGIN;
DO $b7$
DECLARE v_fx jsonb := pg_temp.t_fix(7); v_pb uuid; v_auto uuid; v_vpb integer; v_vauto integer;
BEGIN
  v_pb := pg_temp.t_disc(v_fx,'{"kind":"code","code":"ONCEEACH","name":"Once each","valueBps":1000,"maxUsesPerBuyer":1}');
  v_auto := pg_temp.t_disc(v_fx,'{"kind":"automatic","name":"Open sale","valueBps":500}');
  SELECT version INTO v_vpb FROM public.brand_discounts WHERE id=v_pb;
  SELECT version INTO v_vauto FROM public.brand_discounts WHERE id=v_auto;
  PERFORM pg_temp.t_buy(v_fx,2,'ONCEEACH','b7@example.test');
  IF pg_temp.t_state(v_pb)<>'active/-' OR pg_temp.t_state(v_auto)<>'active/-'
     OR (SELECT version FROM public.brand_discounts WHERE id=v_pb)<>v_vpb
     OR (SELECT version FROM public.brand_discounts WHERE id=v_auto)<>v_vauto
     OR (SELECT count(*) FROM public.discount_uses WHERE discount_id IN (v_pb,v_auto))<>2 THEN
    RAISE EXCEPTION 'B7 per-buyer / uncapped: want both active, versions unchanged, both used; got % %',
      pg_temp.t_state(v_pb),pg_temp.t_state(v_auto);
  END IF;
  RAISE NOTICE 'B7 PASS';
END;
$b7$;
ROLLBACK;

-- B8 deposits: qty 1, one unit each ---------------------------------------------
BEGIN;
DO $b8$
DECLARE v_fx jsonb := pg_temp.t_fix(8); v_id uuid; v_venue uuid := gen_random_uuid(); v_r jsonb; v_i integer;
BEGIN
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"DEPO2","name":"Deposit two","valueBps":1000,"endsAfterCount":2}');
  FOR v_i IN 1..2 LOOP
    v_r := public.issue_3872_reserve_discount_uses('reservation_deposit',gen_random_uuid(),(v_fx->>'brand')::uuid,'USD',
      jsonb_build_array(jsonb_build_object('lineRef','deposit','itemKind','venue_deposit','itemId',v_venue,
        'listingId',v_venue,'listingKind','reservation_deposit','listUnitMinor',5000,'qty',1,'valueScale',1,
        'countScale',1,'allowed',true,'tz','UTC')),
      'DEPO2',jsonb_build_object('email','b8-'||v_i||'@example.test'),NULL,now()+interval '1 day',true,'online');
    IF (v_r->>'ok')::boolean IS NOT TRUE OR (v_r#>>'{quote,applied,0,units}')::int<>1 THEN
      RAISE EXCEPTION 'B8 deposit %: want one unit; got %',v_i,v_r;
    END IF;
  END LOOP;
  IF pg_temp.t_units(v_id)<>2 THEN RAISE EXCEPTION 'B8 two deposits: want 2 units; got %',pg_temp.t_units(v_id); END IF;
  PERFORM public.issue_3872_discount_maintenance(now());
  IF pg_temp.t_state(v_id)<>'ended/count' THEN
    RAISE EXCEPTION 'B8 the sweep after the last deposit: want ended/count; got %',pg_temp.t_state(v_id);
  END IF;
  RAISE NOTICE 'B8 PASS';
END;
$b8$;
ROLLBACK;

-- B9 grants and function attributes --------------------------------------------
DO $b9$
DECLARE v_bad text;
BEGIN
  IF has_function_privilege('anon','public.issue_4624_settle_discount_limits(uuid[],timestamptz,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_4624_settle_discount_limits(uuid[],timestamptz,boolean)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.issue_4624_settle_discount_limits(uuid[],timestamptz,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'B9 settle must be service_role only';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text,', ') INTO v_bad FROM pg_proc p
   WHERE p.oid IN ('public.issue_4624_settle_discount_limits(uuid[],timestamptz,boolean)'::regprocedure,
                   'public.issue_3872_copy_session_totals_to_order(uuid)'::regprocedure,
                   'public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz)'::regprocedure,
                   'public.issue_3872_discount_maintenance(timestamptz)'::regprocedure)
     AND (NOT p.prosecdef OR NOT COALESCE(p.proconfig::text,'') LIKE '%search_path=public, pg_temp%'
          OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'B9 attributes or grants changed on: %',v_bad; END IF;
  RAISE NOTICE 'B9 PASS';
END;
$b9$;

-- B10 / B11: committed fixtures for two connections -----------------------------
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
CREATE TABLE i4624t_race.ids(k text PRIMARY KEY, v uuid);

DO $setup$
DECLARE v_fx jsonb; v_id uuid; v_created jsonb; v_i integer;
BEGIN
  -- B10: a FREE code capped at 2, two live 1-ticket holds.
  v_fx := pg_temp.t_fix(10);
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"RACEFREE","name":"Race free","valueBps":10000,"endsAfterCount":2}');
  INSERT INTO i4624t_race.ids VALUES ('b10_disc',v_id);
  FOR v_i IN 1..2 LOOP
    v_created := public.biz_ticket_checkout_create_session(
      (v_fx->>'event')::uuid,NULL,'Buyer','b10-'||v_i||'@example.test','+1555700010'||v_i,false,
      jsonb_build_array(jsonb_build_object('ticketTypeId',v_fx->>'tt','quantity',1)),
      't4624-b10-'||v_i,now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'RACEFREE',NULL);
    INSERT INTO i4624t_race.ids VALUES ('b10_s'||v_i,(v_created->>'checkoutSessionId')::uuid);
  END LOOP;
  -- B11: a paid code capped at 1, one live hold.
  v_fx := pg_temp.t_fix(11);
  v_id := pg_temp.t_disc(v_fx,'{"kind":"code","code":"RACEEDIT","name":"Race edit","valueBps":1000,"endsAfterCount":1}');
  INSERT INTO i4624t_race.ids VALUES ('b11_disc',v_id);
  v_created := public.biz_ticket_checkout_create_session(
    (v_fx->>'event')::uuid,NULL,'Buyer','b11@example.test','+15557000111',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId',v_fx->>'tt','quantity',1)),
    't4624-b11',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'RACEEDIT',NULL);
  INSERT INTO i4624t_race.ids VALUES ('b11_s',(v_created->>'checkoutSessionId')::uuid);
END;
$setup$;

DO $b10$
DECLARE
  v_conn text := (SELECT conn FROM i4624t_race.conn);
  v_id uuid := (SELECT v FROM i4624t_race.ids WHERE k='b10_disc');
  v_s1 uuid := (SELECT v FROM i4624t_race.ids WHERE k='b10_s1');
  v_s2 uuid := (SELECT v FROM i4624t_race.ids WHERE k='b10_s2');
  v_r1 text; v_r2 text; v_state text; v_units bigint;
  v_sql text := 'SELECT public.biz_ticket_checkout_finalize(%L,NULL,NULL,''free'',''t4624-test-pepper-0123456789abcdef0123456789abcdef'')->>''outcome''';
BEGIN
  PERFORM dblink_connect('t4624_a',v_conn);
  PERFORM dblink_connect('t4624_b',v_conn);
  PERFORM dblink_send_query('t4624_a',format(v_sql,v_s1));
  PERFORM dblink_send_query('t4624_b',format(v_sql,v_s2));
  SELECT o INTO v_r1 FROM dblink_get_result('t4624_a') AS t(o text);
  SELECT o INTO v_r2 FROM dblink_get_result('t4624_b') AS t(o text);
  PERFORM dblink_disconnect('t4624_a');
  PERFORM dblink_disconnect('t4624_b');
  SELECT status||'/'||COALESCE(ended_reason,'-') INTO v_state FROM public.brand_discounts WHERE id=v_id;
  SELECT COALESCE(sum(units-returned_units),0) INTO v_units FROM public.discount_uses WHERE discount_id=v_id AND status='consumed';
  IF v_r1 IS DISTINCT FROM 'finalized' OR v_r2 IS DISTINCT FROM 'finalized' OR v_units<>2 OR v_state<>'ended/count' THEN
    RAISE EXCEPTION 'B10 two finalizes of the last 2 tickets at once: want both finalized, 2 units, ended/count without the sweep; got % % units % state %',
      v_r1,v_r2,v_units,v_state;
  END IF;
  RAISE NOTICE 'B10 PASS';
END;
$b10$;

DO $b11$
DECLARE
  v_conn text := (SELECT conn FROM i4624t_race.conn);
  v_id uuid := (SELECT v FROM i4624t_race.ids WHERE k='b11_disc');
  v_s uuid := (SELECT v FROM i4624t_race.ids WHERE k='b11_s');
  v_busy integer; v_state text; v_created jsonb; v_extra uuid; v_units bigint;
BEGIN
  PERFORM dblink_connect('t4624_edit',v_conn);
  PERFORM dblink_connect('t4624_pay',v_conn);
  -- A host edit (or the sweep) holds the discount row for 2 s.
  PERFORM dblink_send_query('t4624_edit',format(
    'WITH x AS (UPDATE public.brand_discounts SET updated_at=updated_at WHERE id=%L RETURNING 1) SELECT count(*) FROM x, pg_sleep(2) s',v_id));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('t4624_pay',format(
    'SELECT (public.issue_1930_ticket_checkout_finalize_base(%1$L,''pi_t4624b11'',''ch_t4624b11'',''card'',''t4624-test-pepper-0123456789abcdef0123456789abcdef'') IS NOT NULL) AND (public.issue_3872_copy_session_totals_to_order(%1$L) IS NULL)',v_s));
  PERFORM pg_sleep(0.8);
  v_busy := dblink_is_busy('t4624_pay');
  PERFORM * FROM dblink_get_result('t4624_pay') AS t(a boolean);
  PERFORM * FROM dblink_get_result('t4624_edit') AS t(n bigint);
  PERFORM dblink_disconnect('t4624_edit');
  PERFORM dblink_disconnect('t4624_pay');
  SELECT status||'/'||COALESCE(ended_reason,'-') INTO v_state FROM public.brand_discounts WHERE id=v_id;
  IF v_busy<>0 OR v_state<>'active/-' THEN
    RAISE EXCEPTION 'B11 the last-ticket consume beside an edit: want it done at once, code left for the sweep; got busy % state %',
      v_busy,v_state;
  END IF;
  -- Between the consume and the sweep the code reads active, but gives nothing.
  v_created := public.biz_ticket_checkout_create_session(
    '46241000-0000-4000-8200-000000000011',NULL,'Buyer','b11-late@example.test','+15557000112',false,
    jsonb_build_array(jsonb_build_object('ticketTypeId','46241000-0000-4000-8300-000000000011','quantity',1)),
    't4624-b11-late',now()+interval '15 minutes',0,'auto',NULL,NULL,NULL,NULL,'RACEEDIT',NULL);
  v_extra := (v_created->>'checkoutSessionId')::uuid;
  SELECT COALESCE(sum(units),0) INTO v_units FROM public.discount_uses WHERE discount_id=v_id;
  IF EXISTS (SELECT 1 FROM public.discount_uses WHERE checkout_ref_id=v_extra) OR v_units<>1 THEN
    RAISE EXCEPTION 'B11 a checkout before the sweep must get no discount; units %',v_units;
  END IF;
  PERFORM public.issue_3872_discount_maintenance(now());
  SELECT status||'/'||COALESCE(ended_reason,'-') INTO v_state FROM public.brand_discounts WHERE id=v_id;
  IF v_state<>'ended/count' THEN RAISE EXCEPTION 'B11 the sweep: want ended/count; got %',v_state; END IF;
  RAISE NOTICE 'B11 PASS';
END;
$b11$;

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.discount_uses WHERE brand_id::text LIKE '46241000-0000-4000-8100-%';
DELETE FROM public.order_discount_lines WHERE brand_id::text LIKE '46241000-0000-4000-8100-%';
DELETE FROM public.tickets WHERE event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.order_line_items li USING public.orders o
  WHERE li.order_id=o.id AND o.event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.orders WHERE event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.ticket_checkout_session_items i USING public.ticket_checkout_sessions x
  WHERE i.checkout_session_id=x.id AND x.event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.ticket_checkout_sessions WHERE event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.brand_discount_targets t USING public.brand_discounts d
  WHERE t.discount_id=d.id AND d.brand_id::text LIKE '46241000-0000-4000-8100-%';
DELETE FROM public.brand_discounts WHERE brand_id::text LIKE '46241000-0000-4000-8100-%';
DELETE FROM public.ticket_types WHERE event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.event_dates WHERE event_id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.events WHERE id::text LIKE '46241000-0000-4000-8200-%';
DELETE FROM public.stripe_connect_accounts WHERE brand_id::text LIKE '46241000-0000-4000-8100-%';
DELETE FROM public.brands WHERE id::text LIKE '46241000-0000-4000-8100-%';
DELETE FROM public.creator_accounts WHERE id::text LIKE '46241000-0000-4000-8000-%';
DELETE FROM auth.users WHERE id::text LIKE '46241000-0000-4000-8000-%';
UPDATE public.feature_flags f SET is_enabled=x.is_enabled FROM i4624t_race.flag x WHERE f.flag_key='discounts_enabled';
COMMIT;
RESET search_path;
DROP SCHEMA i4624t_race CASCADE;
\echo 'issue #4624 used-up code ends tester suite passed (B1-B11)'
