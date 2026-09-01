-- Issue #871 executable PostgreSQL 17 authorization, pagination, claim and rate proof.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.issue871_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-4'||substr(md5(seed),14,3)||'-8'||substr(md5(seed),18,3)||'-'||substr(md5(seed),21,12))::uuid
$$;

SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES
  (pg_temp.issue871_uuid('owner')),
  (pg_temp.issue871_uuid('attacker')),
  (pg_temp.issue871_uuid('contender')),
  (pg_temp.issue871_uuid('rate-racer')),
  (pg_temp.issue871_uuid('creator'));
INSERT INTO public.creator_accounts(id,email)
VALUES(pg_temp.issue871_uuid('creator'),'issue871-creator@example.test');
INSERT INTO public.brands(id,account_id,name,slug)
VALUES(pg_temp.issue871_uuid('brand'),pg_temp.issue871_uuid('creator'),'Issue 871','issue-871');
INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme)
VALUES
  (pg_temp.issue871_uuid('event'),pg_temp.issue871_uuid('brand'),pg_temp.issue871_uuid('creator'),'Issue 871 Event','issue-871-event','event','scheduled','public','UTC','{}'::jsonb),
  (pg_temp.issue871_uuid('race-event'),pg_temp.issue871_uuid('brand'),pg_temp.issue871_uuid('creator'),'Issue 871 Race','issue-871-race','event','scheduled','public','UTC','{"business_event":{"settings":{"privateGuestList":true}}}'::jsonb),
  (pg_temp.issue871_uuid('rsvp-event'),pg_temp.issue871_uuid('brand'),pg_temp.issue871_uuid('creator'),'Issue 871 RSVP','issue-871-rsvp','rsvp','scheduled','public','UTC','{}'::jsonb);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
VALUES(pg_temp.issue871_uuid('tier'),pg_temp.issue871_uuid('event'),'General',1000,'USD',1000);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
VALUES(pg_temp.issue871_uuid('race-tier'),pg_temp.issue871_uuid('race-event'),'General',1000,'USD',2);

CREATE TEMP TABLE issue871_orders(n integer PRIMARY KEY,id uuid,user_id uuid);
INSERT INTO issue871_orders
SELECT n,pg_temp.issue871_uuid('order-'||n),pg_temp.issue871_uuid('user-'||n)
FROM generate_series(1,205) n;
INSERT INTO auth.users(id) SELECT user_id FROM issue871_orders;
INSERT INTO public.profiles(id,display_name,username,visibility_mode,avatar_url,location,created_at)
SELECT user_id,'Guest '||n,'guest'||n,'public',
  CASE WHEN n BETWEEN 1 AND 5 THEN 'https://images.example/'||n||'.jpg'
       WHEN n=6 THEN '' ELSE NULL END,
  'Atlanta, GA',now()
FROM issue871_orders;
INSERT INTO public.orders(
  id,event_id,buyer_user_id,buyer_email,buyer_name,total_cents,currency,
  payment_status,source,created_at
)
SELECT id,pg_temp.issue871_uuid('event'),user_id,'guest'||n||'@example.test','Guest '||n,
  1000,'USD','paid','legacy',
  CASE WHEN n=6 THEN now()-interval '10 days' ELSE now()+n*interval '1 second' END
FROM issue871_orders;
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
SELECT pg_temp.issue871_uuid('ticket-'||n),id,pg_temp.issue871_uuid('tier'),
  pg_temp.issue871_uuid('event'),'qr-'||n,'valid','auto'
FROM issue871_orders;

-- Dedicated unowned race source with one current exact 32-byte proof.
INSERT INTO public.orders(id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_created_at,attendance_claim_token_generation)
VALUES(pg_temp.issue871_uuid('race-order'),pg_temp.issue871_uuid('race-event'),'race@example.test','Race',1000,'USD','paid','legacy',decode(repeat('ab',32),'hex'),now(),'legacy_v1');
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
VALUES(pg_temp.issue871_uuid('race-ticket'),pg_temp.issue871_uuid('race-order'),pg_temp.issue871_uuid('race-tier'),pg_temp.issue871_uuid('race-event'),'race-qr','valid','auto');

INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status,
  pass_recovery_token_hash,pass_recovery_token_created_at)
VALUES
  (pg_temp.issue871_uuid('owned-rsvp'),pg_temp.issue871_uuid('rsvp-event'),pg_temp.issue871_uuid('owner'),'Owner','owner@example.test','+15550000001','going','approved',repeat('cd',32),now()),
  (pg_temp.issue871_uuid('unowned-rsvp'),pg_temp.issue871_uuid('rsvp-event'),NULL,'Duplicate','duplicate@example.test','+15550000002','going','approved',repeat('ef',32),now());
SET session_replication_role = origin;

DO $test$
DECLARE
  p1 jsonb;
  p2 jsonb;
  p3 jsonb;
  result jsonb;
  admission jsonb;
  i integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',false);
  BEGIN
    PERFORM public.peer_list_event_guests(pg_temp.issue871_uuid('event'),100,0);
    RAISE EXCEPTION 'anonymous roster unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%authentication_required%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub',pg_temp.issue871_uuid('attacker')::text,false);
  BEGIN
    PERFORM public.peer_list_event_guests(pg_temp.issue871_uuid('event'),100,0);
    RAISE EXCEPTION 'non-attendee roster unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%attendance_required%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub',pg_temp.issue871_uuid('user-1')::text,false);
  p1 := public.peer_list_event_guests(pg_temp.issue871_uuid('event'),100,0)::jsonb;
  p2 := public.peer_list_event_guests(pg_temp.issue871_uuid('event'),100,100)::jsonb;
  p3 := public.peer_list_event_guests(pg_temp.issue871_uuid('event'),100,200)::jsonb;
  IF p1->>'returned' <> '100' OR p1->>'nextOffset' <> '100'
     OR p2->>'returned' <> '100' OR p2->>'nextOffset' <> '200'
     OR p3->>'returned' <> '5' OR p3->>'nextOffset' IS NOT NULL THEN
    RAISE EXCEPTION '205-row pagination is not 100/100/5: % % %',p1,p2,p3;
  END IF;
  IF jsonb_array_length(p1->'guests') <> 100
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p1->'guests') WITH ORDINALITY AS g(row,n)
        WHERE n <= 5 AND NULLIF(btrim(row->>'avatarUrl'),'') IS NULL
     ) THEN
    RAISE EXCEPTION 'real-avatar-first order failed or empty avatar was promoted';
  END IF;
  IF (SELECT count(DISTINCT row->>'profileId') FROM (
        SELECT jsonb_array_elements(p1->'guests') row
        UNION ALL SELECT jsonb_array_elements(p2->'guests')
        UNION ALL SELECT jsonb_array_elements(p3->'guests')
      ) pages) <> 205 THEN
    RAISE EXCEPTION 'pagination has gaps or duplicates';
  END IF;

  UPDATE public.events SET theme='{"business_event":{"settings":{"privateGuestList":true}}}'::jsonb
   WHERE id=pg_temp.issue871_uuid('event');
  BEGIN
    PERFORM public.peer_list_event_guests(pg_temp.issue871_uuid('event'),1,0);
    RAISE EXCEPTION 'private roster unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%guest_list_private%' THEN RAISE; END IF;
  END;
  UPDATE public.events SET theme='{}'::jsonb WHERE id=pg_temp.issue871_uuid('event');

  result := public.claim_attendance_internal(
    pg_temp.issue871_uuid('owner'),'rsvp',pg_temp.issue871_uuid('rsvp-event'),
    pg_temp.issue871_uuid('unowned-rsvp'),decode(repeat('ef',32),'hex')
  );
  IF result->>'result' <> 'conflict' OR EXISTS (
    SELECT 1 FROM public.event_rsvps WHERE id=pg_temp.issue871_uuid('unowned-rsvp') AND user_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'duplicate RSVP owner did not fail closed: %',result; END IF;

  result := public.claim_attendance_internal(
    pg_temp.issue871_uuid('contender'),'order',pg_temp.issue871_uuid('race-event'),
    pg_temp.issue871_uuid('race-order'),decode(repeat('aa',32),'hex')
  );
  IF result->>'result' <> 'invalid' OR EXISTS (
    SELECT 1 FROM public.orders WHERE id=pg_temp.issue871_uuid('race-order') AND buyer_user_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'wrong proof mutated or disclosed the source: %',result; END IF;

  result := public.claim_attendance_internal(
    pg_temp.issue871_uuid('contender'),'rsvp',pg_temp.issue871_uuid('race-event'),
    pg_temp.issue871_uuid('race-order'),decode(repeat('ab',32),'hex')
  );
  IF result->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'wrong kind/entity mapping did not fail closed: %',result;
  END IF;

  PERFORM set_config('session_replication_role','replica',true);
  UPDATE public.tickets SET status='void' WHERE id=pg_temp.issue871_uuid('race-ticket');
  PERFORM set_config('session_replication_role','origin',true);
  result := public.claim_attendance_internal(
    pg_temp.issue871_uuid('contender'),'order',pg_temp.issue871_uuid('race-event'),
    pg_temp.issue871_uuid('race-order'),decode(repeat('ab',32),'hex')
  );
  IF result->>'result' <> 'ineligible' THEN
    RAISE EXCEPTION 'revoked ticket remained claim-eligible: %',result;
  END IF;
  PERFORM set_config('session_replication_role','replica',true);
  UPDATE public.tickets SET status='valid' WHERE id=pg_temp.issue871_uuid('race-ticket');
  PERFORM set_config('session_replication_role','origin',true);

  IF has_function_privilege('authenticated','public.claim_attendance_internal(uuid,text,uuid,uuid,bytea)','EXECUTE')
     OR has_function_privilege('anon','public.begin_attendance_claim_attempt(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'internal claim/admission RPC leaked outside service role';
  END IF;

  FOR i IN 1..11 LOOP
    admission := public.begin_attendance_claim_attempt(pg_temp.issue871_uuid('attacker'),'order');
    IF (i <= 10 AND admission->>'allowed' <> 'true')
       OR (i = 11 AND admission->>'allowed' <> 'false') THEN
      RAISE EXCEPTION 'atomic admission boundary failed at %: %',i,admission;
    END IF;
  END LOOP;
END;
$test$;

DO $delivery$
DECLARE
  first_count integer;
  second_count integer;
  row public.attendance_claim_deliveries%ROWTYPE;
  exhausted_completed boolean;
  exhausted_state text;
BEGIN
  PERFORM public.enqueue_attendance_claim_deliveries(1000);
  SELECT count(*) INTO first_count FROM public.attendance_claim_deliveries;
  PERFORM public.enqueue_attendance_claim_deliveries(1000);
  SELECT count(*) INTO second_count FROM public.attendance_claim_deliveries;
  IF first_count = 0 OR second_count <> first_count THEN
    RAISE EXCEPTION 'delivery enqueue is not idempotent: % then %',first_count,second_count;
  END IF;
  FOR row IN SELECT * FROM public.claim_attendance_delivery_batch(50) LOOP
    IF NOT public.complete_attendance_claim_delivery(row.id,row.lease_id,'sent',NULL) THEN
      RAISE EXCEPTION 'leased delivery completion failed';
    END IF;
  END LOOP;
  PERFORM public.enqueue_attendance_claim_deliveries(1000);
  IF (SELECT count(*) FROM public.attendance_claim_deliveries) <> first_count
     OR EXISTS (
       SELECT 1 FROM public.attendance_claim_deliveries
       GROUP BY kind,source_id HAVING count(*) > 1
     ) THEN
    RAISE EXCEPTION 'completed delivery was re-enqueued or duplicated';
  END IF;

  -- Isolate the bounded retry proof from the remaining first enqueue page.
  UPDATE public.attendance_claim_deliveries
     SET status='sent', next_attempt_at=NULL, delivered_at=now()
   WHERE status='pending';

  INSERT INTO public.attendance_claim_deliveries(
    id,kind,source_id,event_id,status,attempt_count,next_attempt_at,created_at
  ) VALUES
    (pg_temp.issue871_uuid('retry-first'),'order',pg_temp.issue871_uuid('retry-source-1'),
      pg_temp.issue871_uuid('event'),'failed_retryable',1,now()-interval '1 minute',now()-interval '2 minutes'),
    (pg_temp.issue871_uuid('retry-later'),'order',pg_temp.issue871_uuid('retry-source-2'),
      pg_temp.issue871_uuid('event'),'pending',0,now(),now());

  SELECT * INTO row FROM public.claim_attendance_delivery_batch(1);
  IF row.id <> pg_temp.issue871_uuid('retry-first') OR
     NOT public.complete_attendance_claim_delivery(row.id,row.lease_id,'failed_retryable','provider_retryable') THEN
    RAISE EXCEPTION 'first retry lease/backoff completion failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_deliveries
     WHERE id=pg_temp.issue871_uuid('retry-first')
       AND status='failed_retryable' AND next_attempt_at > now()
  ) THEN RAISE EXCEPTION 'retry backoff was not scheduled'; END IF;

  SELECT * INTO row FROM public.claim_attendance_delivery_batch(1);
  IF row.id <> pg_temp.issue871_uuid('retry-later') THEN
    RAISE EXCEPTION 'backed-off failure starved later delivery: %',row.id;
  END IF;
  PERFORM public.complete_attendance_claim_delivery(row.id,row.lease_id,'sent',NULL);

  INSERT INTO public.attendance_claim_deliveries(
    id,kind,source_id,event_id,status,attempt_count,next_attempt_at,lease_id,lease_expires_at
  ) VALUES (
    pg_temp.issue871_uuid('retry-exhausted'),'order',pg_temp.issue871_uuid('retry-source-3'),
    pg_temp.issue871_uuid('event'),'processing',5,NULL,pg_temp.issue871_uuid('retry-lease'),now()+interval '1 minute'
  );
  exhausted_completed := public.complete_attendance_claim_delivery(
    pg_temp.issue871_uuid('retry-exhausted'),pg_temp.issue871_uuid('retry-lease'),
    'failed_retryable','provider_retryable'
  );
  SELECT status INTO exhausted_state FROM public.attendance_claim_deliveries
   WHERE id=pg_temp.issue871_uuid('retry-exhausted');
  IF NOT exhausted_completed OR NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_deliveries
     WHERE id=pg_temp.issue871_uuid('retry-exhausted')
       AND status='failed_terminal' AND next_attempt_at IS NULL
  ) THEN RAISE EXCEPTION 'retry exhaustion did not become terminal: completed=%, state=%',
    exhausted_completed, exhausted_state; END IF;

  INSERT INTO public.attendance_claim_deliveries(
    id,kind,source_id,event_id,status,attempt_count,next_attempt_at,lease_id,lease_expires_at
  ) VALUES (
    pg_temp.issue871_uuid('ambiguous-expired'),'order',pg_temp.issue871_uuid('retry-source-4'),
    pg_temp.issue871_uuid('event'),'processing',2,NULL,pg_temp.issue871_uuid('ambiguous-lease'),now()-interval '1 minute'
  );
  PERFORM public.claim_attendance_delivery_batch(1);
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_claim_deliveries
     WHERE id=pg_temp.issue871_uuid('ambiguous-expired')
       AND status='failed_terminal' AND last_error_code='provider_ambiguous'
  ) THEN RAISE EXCEPTION 'expired ambiguous delivery was reclaimed and could rotate proof'; END IF;
END;
$delivery$;

DO $attempt_schema$
DECLARE
  v_id uuid := pg_temp.issue871_uuid('attempt-terminal');
BEGIN
  BEGIN
    INSERT INTO public.attendance_claim_attempts(id,user_id,kind,outcome)
    VALUES(v_id,pg_temp.issue871_uuid('attacker'),'order','not_an_outcome');
    RAISE EXCEPTION 'unknown attempt outcome was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.attendance_claim_attempts(id,user_id,kind,outcome)
    VALUES(v_id,pg_temp.issue871_uuid('attacker'),'order','success');
    RAISE EXCEPTION 'terminal outcome without completed_at was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.attendance_claim_attempts(id,user_id,kind)
  VALUES(v_id,pg_temp.issue871_uuid('attacker'),'order');
  UPDATE public.attendance_claim_attempts
     SET completed_at=now(),outcome='success' WHERE id=v_id;
  BEGIN
    UPDATE public.attendance_claim_attempts SET outcome='invalid' WHERE id=v_id;
    RAISE EXCEPTION 'terminal attempt was finalized twice';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%attendance_claim_attempt_already_terminal%' THEN RAISE; END IF;
  END;
END;
$attempt_schema$;

-- Prime nine attempts so two independent sessions contend for the one
-- remaining slot at the exact ten-per-ten-minutes boundary.
DO $prime$
DECLARE i integer;
BEGIN
  FOR i IN 1..9 LOOP
    PERFORM public.begin_attendance_claim_attempt(pg_temp.issue871_uuid('rate-racer'),'rsvp');
  END LOOP;
END;
$prime$;

-- Two independent PG17 sessions race the exact same unowned order/proof.
-- Run this test file as the Supabase image's `supabase_admin` role so dblink
-- can open two genuinely independent local sessions without weakening auth.
SELECT dblink_connect('issue871_a','dbname='||current_database());
SELECT dblink_connect('issue871_b','dbname='||current_database());
SELECT dblink_send_query('issue871_a',format(
  $$SELECT public.claim_attendance_internal(%L::uuid,'order',%L::uuid,%L::uuid,decode(repeat('ab',32),'hex'))::text$$,
  pg_temp.issue871_uuid('attacker'),pg_temp.issue871_uuid('race-event'),pg_temp.issue871_uuid('race-order')
));
SELECT dblink_send_query('issue871_b',format(
  $$SELECT public.claim_attendance_internal(%L::uuid,'order',%L::uuid,%L::uuid,decode(repeat('ab',32),'hex'))::text$$,
  pg_temp.issue871_uuid('contender'),pg_temp.issue871_uuid('race-event'),pg_temp.issue871_uuid('race-order')
));
SELECT * FROM dblink_get_result('issue871_a') AS t(result text);
SELECT * FROM dblink_get_result('issue871_b') AS t(result text);

SELECT dblink_disconnect('issue871_a');
SELECT dblink_disconnect('issue871_b');
SELECT dblink_connect('issue871_a','dbname='||current_database());
SELECT dblink_connect('issue871_b','dbname='||current_database());

SELECT dblink_send_query('issue871_a',format(
  $$SELECT public.begin_attendance_claim_attempt(%L::uuid,'rsvp')::text$$,
  pg_temp.issue871_uuid('rate-racer')
));
SELECT dblink_send_query('issue871_b',format(
  $$SELECT public.begin_attendance_claim_attempt(%L::uuid,'rsvp')::text$$,
  pg_temp.issue871_uuid('rate-racer')
));
SELECT * FROM dblink_get_result('issue871_a') AS t(result text);
SELECT * FROM dblink_get_result('issue871_b') AS t(result text);

DO $race$
DECLARE
  v_owner uuid;
  replay jsonb;
BEGIN
  SELECT buyer_user_id INTO v_owner FROM public.orders WHERE id=pg_temp.issue871_uuid('race-order');
  IF v_owner NOT IN (pg_temp.issue871_uuid('attacker'),pg_temp.issue871_uuid('contender')) THEN
    RAISE EXCEPTION 'race produced no canonical winner: %',v_owner;
  END IF;
  IF (SELECT count(*) FROM public.orders WHERE id=pg_temp.issue871_uuid('race-order') AND buyer_user_id=v_owner) <> 1
     OR EXISTS (SELECT 1 FROM public.orders WHERE id=pg_temp.issue871_uuid('race-order') AND attendance_claim_token_digest IS NOT NULL) THEN
    RAISE EXCEPTION 'race mutated more than one owner or failed proof consumption';
  END IF;
  replay := public.claim_attendance_internal(
    v_owner,'order',pg_temp.issue871_uuid('race-event'),pg_temp.issue871_uuid('race-order'),
    decode(repeat('00',32),'hex')
  );
  IF replay->>'result' <> 'already_claimed' THEN
    RAISE EXCEPTION 'canonical owner replay after proof consumption failed: %',replay;
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,false);
  BEGIN
    PERFORM public.peer_list_event_guests(pg_temp.issue871_uuid('race-event'),1,0);
    RAISE EXCEPTION 'private roster opened after otherwise valid claim';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%guest_list_private%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.attendance_claim_attempts
       WHERE user_id=pg_temp.issue871_uuid('rate-racer')) <> 11
     OR (SELECT count(*) FROM public.attendance_claim_attempts
       WHERE user_id=pg_temp.issue871_uuid('rate-racer') AND outcome='rate_limited') <> 1 THEN
    RAISE EXCEPTION 'concurrent rate admission did not serialize at 10/10m';
  END IF;
END;
$race$;
