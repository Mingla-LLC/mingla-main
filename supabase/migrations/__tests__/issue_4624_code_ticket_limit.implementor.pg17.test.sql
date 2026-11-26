-- MINGLA-INVARIANT: I-4624-6 | issue #4624 | A discount code with ends_after_count never discounts more tickets than the cap: a basket line with more tickets than remain keeps full price and gets a sale_limited notice (discountKind code), and no tickets left rejects the code as used_up.
-- MINGLA-INVARIANT: I-4624-7 | issue #4624 | Parallel reservations of a ticket-capped code serialise on the discount row lock, so reserved plus consumed units never exceed ends_after_count.
-- Issue #4624: a discount code can stop after N tickets ("Total tickets" =
-- brand_discounts.ends_after_count) as well as after N checkouts ("Total uses" =
-- max_total_uses), on the fully replayed PostgreSQL 17 schema with
-- 20281206014624_issue_4624_code_ticket_limit.sql applied.
--   T1 writer: a code saves with endsAfterCount 5; 0 is refused by the column CHECK.
--   T2 cap 5: five 1-ticket checkouts are discounted, the sixth is used_up.
--   T3 basket of 6 with 5 left: the line keeps full price, notice remaining 5.
--   T4 basket 3 (reserved hold) then basket 3: the second gets notice remaining 2;
--      releasing the hold frees the tickets again.
--   T5 two lines in one basket (3 + 3, cap 5): the first is discounted, the
--      second gets notice remaining 2.
--   T6 ends_after_count NULL: a code behaves exactly as before (10 tickets all
--      discounted, no notice, candidate remainingUnits null, limited false).
--   T7 both limits, whichever runs out first: uses first, then tickets first.
--   T8 automatic discounts are unchanged (notice has no discountKind).
--   T9 (committed fixtures, two dblink sessions) parallel reservations of a
--      cap-5 code with 3 tickets each: the second waits for the first's lock and
--      gets no discount; reserved units stay at 3.
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
  -- Lines are processed in lineRef order; v_tt_a sorts before v_tt_b.
  IF (v_q->>'discountMinor')::integer <> 7500
     OR jsonb_array_length(v_q->'notices') <> 1
     OR v_q#>>'{notices,0,lineRef}' <> v_tt_b::text
     OR v_q#>>'{notices,0,remaining}' <> '2'
     OR (v_q#>>'{applied,0,units}')::integer <> 3 THEN
    RAISE EXCEPTION 'T5 two lines 3+3 on cap 5: want first line free, notice remaining 2 on the second, got %',v_q;
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

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
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
\echo 'issue #4624 code ticket limit suite passed (T1-T9)'
