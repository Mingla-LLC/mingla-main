-- #3872 R1 real PostgreSQL concurrency and buyer-identity limits.
-- MINGLA-INVARIANT: I-3872-USE-LIMITS | issue #3872 | Concurrent checkouts cannot exceed a total-use limit, and per-buyer limits match checkout email, phone, or authenticated user identity.
\set ON_ERROR_STOP on
\getenv issue3872_dblink_password PGPASSWORD
SET issue_3872.dblink_password TO :'issue3872_dblink_password';
CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO auth.users(id,email) VALUES
  ('38725000-0000-4000-8400-000000000001','r1-race-owner@example.test'),
  ('38725000-0000-4000-8400-000000000002','r1-race-buyer@example.test');
INSERT INTO public.creator_accounts(id,email)
  VALUES('38725000-0000-4000-8400-000000000001','r1-race-owner@example.test');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payment_provider,payment_country,
  pricing_region,pricing_currency
) VALUES(
  '38725000-0000-4000-8400-000000000003',
  '38725000-0000-4000-8400-000000000001',
  'R1 race brand','r1-race-brand','USD','stripe','US','US','USD'
);
INSERT INTO public.stripe_connect_accounts(
  brand_id,stripe_account_id,charges_enabled,payouts_enabled,country,default_currency
) VALUES('38725000-0000-4000-8400-000000000003','acct_r1_race',true,true,'US','usd');
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
  VALUES('38725000-0000-4000-8400-000000000003','discounts','pilot');
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
) VALUES(
  '38725000-0000-4000-8400-000000000004',
  '38725000-0000-4000-8400-000000000003',
  '38725000-0000-4000-8400-000000000001',
  'R1 race event','r1-race-event','event','scheduled','public','UTC','USD'
);
INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES('38725000-0000-4000-8400-000000000004',now()+interval '1 day',
    now()+interval '1 day 2 hours','UTC',true);
INSERT INTO public.ticket_types(
  id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,
  min_purchase_qty,max_purchase_qty,available_online,available_in_person
) VALUES(
  '38725000-0000-4000-8400-000000000005',
  '38725000-0000-4000-8400-000000000004',
  'General',3000,'USD',false,100,false,1,10,true,false
);
INSERT INTO public.brand_discounts(
  id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
  max_total_uses,max_uses_per_buyer,status,created_by
) VALUES
  ('38725000-0000-4000-8400-000000000006','38725000-0000-4000-8400-000000000003',
   'code','RACE10','Race ten','percent',1000,'brand','automatic_only',1,NULL,'active',
   '38725000-0000-4000-8400-000000000001'),
  ('38725000-0000-4000-8400-000000000007','38725000-0000-4000-8400-000000000003',
   'code','EMAIL1','Email one','percent',1000,'brand','automatic_only',NULL,1,'active',
   '38725000-0000-4000-8400-000000000001'),
  ('38725000-0000-4000-8400-000000000008','38725000-0000-4000-8400-000000000003',
   'code','PHONE1','Phone one','percent',1000,'brand','automatic_only',NULL,1,'active',
   '38725000-0000-4000-8400-000000000001'),
  ('38725000-0000-4000-8400-000000000009','38725000-0000-4000-8400-000000000003',
   'code','USER01','User one','percent',1000,'brand','automatic_only',NULL,1,'active',
   '38725000-0000-4000-8400-000000000001');

DO $concurrency$
DECLARE
  v_conn text := format('dbname=%L user=%L password=%L host=%L port=%L',
    current_database(),current_user,current_setting('issue_3872.dblink_password'),
    host(inet_server_addr()),current_setting('port'));
  v_a jsonb;
  v_b jsonb;
  v_held boolean;
BEGIN
  PERFORM dblink_connect('issue3872_a',v_conn);
  PERFORM dblink_connect('issue3872_b',v_conn);
  PERFORM dblink_send_query('issue3872_a',$q$
    SELECT public.biz_ticket_checkout_create_session(
      '38725000-0000-4000-8400-000000000004',NULL,'Race A','race-a@example.test',
      '+15555555001',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
      'r1-race-a',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'RACE10',NULL
    ),(pg_sleep(1) IS NULL)
  $q$);
  PERFORM pg_sleep(0.15);
  PERFORM dblink_send_query('issue3872_b',$q$
    SELECT public.biz_ticket_checkout_create_session(
      '38725000-0000-4000-8400-000000000004',NULL,'Race B','race-b@example.test',
      '+15555555002',false,
      jsonb_build_array(jsonb_build_object('ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
      'r1-race-b',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'RACE10',NULL
    )
  $q$);
  PERFORM pg_sleep(0.15);
  IF dblink_is_busy('issue3872_b')<>1 THEN
    RAISE EXCEPTION 'T5 second checkout did not wait on the limited-discount row lock';
  END IF;
  SELECT result,held INTO v_a,v_held
    FROM dblink_get_result('issue3872_a') AS t(result jsonb,held boolean);
  SELECT result INTO v_b
    FROM dblink_get_result('issue3872_b') AS t(result jsonb);
  PERFORM dblink_disconnect('issue3872_a');
  PERFORM dblink_disconnect('issue3872_b');

  IF (CASE WHEN (v_a->>'discountCents')::integer>0 THEN 1 ELSE 0 END
      + CASE WHEN (v_b->>'discountCents')::integer>0 THEN 1 ELSE 0 END)<>1
     OR (SELECT count(*) FROM public.discount_uses
         WHERE discount_id='38725000-0000-4000-8400-000000000006'
           AND status='reserved')<>1
     OR (CASE WHEN (v_a->>'totalCents')::integer=3000 THEN 1 ELSE 0 END
      + CASE WHEN (v_b->>'totalCents')::integer=3000 THEN 1 ELSE 0 END)<>1 THEN
    RAISE EXCEPTION 'T5 total-use race overspent or mispriced: A %, B %',v_a,v_b;
  END IF;
END
$concurrency$;

DO $identity$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.biz_ticket_checkout_create_session(
    '38725000-0000-4000-8400-000000000004',NULL,'Email A','same@example.test',
    '+15555555101',false,jsonb_build_array(jsonb_build_object(
      'ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
    'r1-email-a',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'EMAIL1',NULL);
  v_second := public.biz_ticket_checkout_create_session(
    '38725000-0000-4000-8400-000000000004',NULL,'Email B','SAME@example.test',
    '+15555555102',false,jsonb_build_array(jsonb_build_object(
      'ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
    'r1-email-b',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'EMAIL1',NULL);
  IF (v_first->>'discountCents')::integer=0 OR (v_second->>'discountCents')::integer<>0 THEN
    RAISE EXCEPTION 'T5 email buyer limit mismatch: first %, second %',v_first,v_second;
  END IF;

  v_first := public.biz_ticket_checkout_create_session(
    '38725000-0000-4000-8400-000000000004',NULL,'Phone A','phone-a@example.test',
    '+15555555201',false,jsonb_build_array(jsonb_build_object(
      'ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
    'r1-phone-a',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'PHONE1',NULL);
  v_second := public.biz_ticket_checkout_create_session(
    '38725000-0000-4000-8400-000000000004',NULL,'Phone B','phone-b@example.test',
    '+15555555201',false,jsonb_build_array(jsonb_build_object(
      'ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
    'r1-phone-b',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'PHONE1',NULL);
  IF (v_first->>'discountCents')::integer=0 OR (v_second->>'discountCents')::integer<>0 THEN
    RAISE EXCEPTION 'T5 phone buyer limit mismatch: first %, second %',v_first,v_second;
  END IF;

  v_first := public.biz_ticket_checkout_create_session(
    '38725000-0000-4000-8400-000000000004','38725000-0000-4000-8400-000000000002',
    'User A','user-a@example.test','+15555555301',false,
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
    'r1-user-a',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'USER01',NULL);
  v_second := public.biz_ticket_checkout_create_session(
    '38725000-0000-4000-8400-000000000004','38725000-0000-4000-8400-000000000002',
    'User B','user-b@example.test','+15555555302',false,
    jsonb_build_array(jsonb_build_object(
      'ticketTypeId','38725000-0000-4000-8400-000000000005','quantity',1)),
    'r1-user-b',now()+interval '15 minutes',0,'full',NULL,NULL,NULL,NULL,'USER01',NULL);
  IF (v_first->>'discountCents')::integer=0 OR (v_second->>'discountCents')::integer<>0 THEN
    RAISE EXCEPTION 'T5 authenticated-user buyer limit mismatch: first %, second %',v_first,v_second;
  END IF;

  RAISE NOTICE 'issue_3872_r1_use_limits_race: PASS';
END
$identity$;

DELETE FROM public.discount_uses WHERE brand_id='38725000-0000-4000-8400-000000000003';
DELETE FROM public.ticket_checkout_sessions WHERE brand_id='38725000-0000-4000-8400-000000000003';
DELETE FROM public.brand_discounts WHERE brand_id='38725000-0000-4000-8400-000000000003';
DELETE FROM public.ticket_types WHERE event_id='38725000-0000-4000-8400-000000000004';
DELETE FROM public.event_dates WHERE event_id='38725000-0000-4000-8400-000000000004';
DELETE FROM public.event_checkout_admission_state WHERE event_id='38725000-0000-4000-8400-000000000004';
DELETE FROM public.events WHERE id='38725000-0000-4000-8400-000000000004';
DELETE FROM public.stripe_connect_accounts WHERE brand_id='38725000-0000-4000-8400-000000000003';
DELETE FROM public.program_brand_rollouts WHERE brand_id='38725000-0000-4000-8400-000000000003';
DELETE FROM public.brands WHERE id='38725000-0000-4000-8400-000000000003';
DELETE FROM public.creator_accounts WHERE id='38725000-0000-4000-8400-000000000001';
DELETE FROM auth.users WHERE id IN(
  '38725000-0000-4000-8400-000000000001','38725000-0000-4000-8400-000000000002'
);

\echo 'issue #3872 real discount-use race and buyer identity limits passed'
