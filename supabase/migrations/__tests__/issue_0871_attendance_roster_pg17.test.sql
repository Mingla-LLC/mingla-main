-- Issue #871 executable PostgreSQL 17 authorization, pagination, claim and rate proof.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.issue871_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-4'||substr(md5(seed),14,3)||'-8'||substr(md5(seed),18,3)||'-'||substr(md5(seed),21,12))::uuid
$$;

-- #3524 — WHY THIS FILE NOW TOUCHES auth.identities.
--
-- `public.claim_attendance_internal` gained an identity gate:
-- `public.account_owns_order_contact` must agree that the claimant can prove the
-- ORDER CONTACT before the proof is consumed, because a claim link is mailed and
-- a mailed link can be forwarded. The gate runs AFTER the digest match, the
-- expiry and the eligibility check, so every earlier assertion in this file is
-- untouched by it — but the RACE at the end needs BOTH racers to get past it,
-- or the race never reaches the atomic UPDATE it exists to measure and the
-- "exactly one winner, proof consumed once" proof becomes unfalsifiable.
--
-- The predicate's cheapest positive proof is a PROVIDER-ASSERTED address
-- (`identity_data.email_verified` true), which needs only `auth.identities` —
-- no session or amr rows. That table is absent from the supabase/postgres image
-- and this lane provisions no GoTrue stub, so the file stands one up itself (it
-- runs as `supabase_admin`) and REMOVES IT AGAIN at the end, so the sibling
-- #3524 suites in this lane still find the database in the state they expect and
-- build their own. The stub is created ONLY when the table is genuinely absent,
-- and the teardown drops ONLY a table this session created — on any database
-- with real GoTrue the flag is never set and nothing is dropped.
DO $stub$
BEGIN
  IF to_regclass('auth.identities') IS NULL THEN
    CREATE TEMP TABLE issue871_auth_identities_stub(created boolean NOT NULL);
    INSERT INTO issue871_auth_identities_stub VALUES (true);
    EXECUTE $ddl$
      CREATE TABLE auth.identities(
        id text NOT NULL, user_id uuid NOT NULL, provider text NOT NULL,
        identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now())
    $ddl$;
  END IF;
END
$stub$;

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

-- #3682 — Who's going defaults private. The #871 pagination/avatar proofs below
-- still need named roster rows with stable profileIds; opt the bulk event in so
-- those structural assertions remain falsifiable under the new naming predicate.
UPDATE public.orders
   SET show_me_as_going = true
 WHERE event_id = pg_temp.issue871_uuid('event');

-- Dedicated unowned race source with one current exact 32-byte proof.
INSERT INTO public.orders(id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_created_at,attendance_claim_token_generation)
VALUES(pg_temp.issue871_uuid('race-order'),pg_temp.issue871_uuid('race-event'),'race@example.test','Race',1000,'USD','paid','legacy',decode(repeat('ab',32),'hex'),now(),'legacy_v1');
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
VALUES(pg_temp.issue871_uuid('race-ticket'),pg_temp.issue871_uuid('race-order'),pg_temp.issue871_uuid('race-tier'),pg_temp.issue871_uuid('race-event'),'race-qr','valid','auto');

-- #3524 — BOTH racers can prove the race order's address, and they must be able
-- to. This file measures the ATOMIC WRITE: two eligible claimants holding the
-- same valid proof, exactly one owner afterwards, the digest consumed once. If
-- only one of them could clear the identity gate the loser would be refused
-- before the UPDATE and the concurrency would never be exercised — the check
-- would pass while proving nothing (#2136's lesson, and the reason this file
-- executes SQL at all).
--
-- The shape is the PROVIDER-ASSERTED one: `identity_data.email_verified` true,
-- which `account_owns_order_contact` accepts on its own and which every Google
-- and Apple identity on production carries (measured 2026-09-22: 75/75 and
-- 44/44). Two accounts asserting one address is a fixture convenience, not a
-- claim about GoTrue; what is asserted below is what happens when two eligible
-- claimants collide, not how they came to be eligible.
-- The two `id` values are written as BARE literals on purpose: GoTrue's own
-- `auth.identities.id` is a uuid, the stub the sibling #3524 suites build uses
-- text, and an untyped literal in uuid spelling is accepted by both. A cast
-- either way would pin this file to one of the two shapes.
INSERT INTO auth.identities(id,user_id,provider,identity_data) VALUES
  ('a0871a00-0000-4000-8000-000000000001',pg_temp.issue871_uuid('attacker'),'google',
   '{"email":"race@example.test","email_verified":true}'::jsonb),
  ('a0871a00-0000-4000-8000-000000000002',pg_temp.issue871_uuid('contender'),'apple',
   '{"email":"race@example.test","email_verified":true}'::jsonb);

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
  IF replay->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'canonical owner replay after proof consumption was not rejected: %',replay;
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

-- #3682 — explicit friend / opt-in / private naming on a fresh public event.
DO $privacy$
DECLARE
  page jsonb;
  named_ids text[];
  private_count integer;
BEGIN
  -- Same fixture path as the file header: disable triggers so a brand without
  -- default_currency can still seed a scheduled event (tg_require_event_brand_currency).
  PERFORM set_config('session_replication_role','replica',true);
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme,currency)
  VALUES(
    pg_temp.issue871_uuid('privacy-event'),pg_temp.issue871_uuid('brand'),pg_temp.issue871_uuid('creator'),
    'Issue 871 Privacy','issue-871-privacy','event','scheduled','public','UTC','{}'::jsonb,'USD'
  );
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
  VALUES(pg_temp.issue871_uuid('privacy-tier'),pg_temp.issue871_uuid('privacy-event'),'General',1000,'USD',10);

  INSERT INTO auth.users(id) VALUES
    (pg_temp.issue871_uuid('privacy-viewer')),
    (pg_temp.issue871_uuid('privacy-friend')),
    (pg_temp.issue871_uuid('privacy-optin')),
    (pg_temp.issue871_uuid('privacy-private'));
  INSERT INTO public.profiles(id,display_name,username,visibility_mode,avatar_url,created_at)
  VALUES
    (pg_temp.issue871_uuid('privacy-viewer'),'Viewer','pviewer','public','https://images.example/v.jpg',now()),
    (pg_temp.issue871_uuid('privacy-friend'),'Friend','pfriend','public','https://images.example/f.jpg',now()),
    (pg_temp.issue871_uuid('privacy-optin'),'Opt In','poptin','public','https://images.example/o.jpg',now()),
    (pg_temp.issue871_uuid('privacy-private'),'Private','pprivate','public','https://images.example/p.jpg',now());

  INSERT INTO public.friends(user_id,friend_user_id,status,deleted_at)
  VALUES(
    pg_temp.issue871_uuid('privacy-viewer'),
    pg_temp.issue871_uuid('privacy-friend'),
    'accepted',
    NULL
  );

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_email,buyer_name,total_cents,currency,
    payment_status,source,created_at,show_me_as_going
  ) VALUES
    (pg_temp.issue871_uuid('privacy-order-viewer'),pg_temp.issue871_uuid('privacy-event'),
     pg_temp.issue871_uuid('privacy-viewer'),'viewer@example.test','Viewer',1000,'USD','paid','legacy',now(),false),
    (pg_temp.issue871_uuid('privacy-order-friend'),pg_temp.issue871_uuid('privacy-event'),
     pg_temp.issue871_uuid('privacy-friend'),'friend@example.test','Friend',1000,'USD','paid','legacy',now()+interval '1 second',false),
    (pg_temp.issue871_uuid('privacy-order-optin'),pg_temp.issue871_uuid('privacy-event'),
     pg_temp.issue871_uuid('privacy-optin'),'optin@example.test','Opt In',1000,'USD','paid','legacy',now()+interval '2 seconds',true),
    (pg_temp.issue871_uuid('privacy-order-private'),pg_temp.issue871_uuid('privacy-event'),
     pg_temp.issue871_uuid('privacy-private'),'private@example.test','Private',1000,'USD','paid','legacy',now()+interval '3 seconds',false);

  INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
  SELECT pg_temp.issue871_uuid('privacy-ticket-'||seed),pg_temp.issue871_uuid('privacy-order-'||seed),
         pg_temp.issue871_uuid('privacy-tier'),pg_temp.issue871_uuid('privacy-event'),
         'privacy-qr-'||seed,'valid','auto'
    FROM (VALUES ('viewer'),('friend'),('optin'),('private')) AS s(seed);
  PERFORM set_config('session_replication_role','origin',true);

  PERFORM set_config('request.jwt.claim.sub',pg_temp.issue871_uuid('privacy-viewer')::text,false);
  page := public.peer_list_event_guests(pg_temp.issue871_uuid('privacy-event'),10,0)::jsonb;
  SELECT array_agg(g->>'profileId' ORDER BY g->>'profileId')
    INTO named_ids
    FROM jsonb_array_elements(page->'guests') g
   WHERE COALESCE((g->>'isAnonymous')::boolean,false) = false
     AND NULLIF(g->>'profileId','') IS NOT NULL;
  private_count := COALESCE((page->>'privateOthersCount')::integer, -1);

  IF NOT (
    pg_temp.issue871_uuid('privacy-viewer')::text = ANY(named_ids)
    AND pg_temp.issue871_uuid('privacy-friend')::text = ANY(named_ids)
    AND pg_temp.issue871_uuid('privacy-optin')::text = ANY(named_ids)
  ) THEN
    RAISE EXCEPTION '#3682 privacy: expected self/friend/opt-in named, got %',named_ids;
  END IF;
  IF pg_temp.issue871_uuid('privacy-private')::text = ANY(named_ids) THEN
    RAISE EXCEPTION '#3682 privacy: default-off guest was named: %',named_ids;
  END IF;
  IF private_count <> 1 THEN
    RAISE EXCEPTION '#3682 privacy: privateOthersCount expected 1, got % in %',private_count,page;
  END IF;

  -- Non-owner JWT cannot flip consent via direct table UPDATE (host/staff path).
  PERFORM set_config('request.jwt.claim.sub',pg_temp.issue871_uuid('privacy-friend')::text,false);
  BEGIN
    UPDATE public.orders
       SET show_me_as_going = true
     WHERE id = pg_temp.issue871_uuid('privacy-order-private');
    RAISE EXCEPTION '#3682 privacy: non-owner UPDATE of show_me_as_going succeeded';
  EXCEPTION WHEN insufficient_privilege OR others THEN
    IF SQLERRM NOT LIKE '%show_me_as_going_owner_only%' THEN RAISE; END IF;
  END;

  -- Multi-order: user-level opt-in names every attendance row for that buyer.
  PERFORM set_config('session_replication_role','replica',true);
  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_email,buyer_name,total_cents,currency,
    payment_status,source,created_at,show_me_as_going
  ) VALUES (
    pg_temp.issue871_uuid('privacy-order-optin-2'),pg_temp.issue871_uuid('privacy-event'),
    pg_temp.issue871_uuid('privacy-optin'),'optin2@example.test','Opt In',1000,'USD','paid','legacy',
    now()+interval '4 seconds',false
  );
  INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
  VALUES (
    pg_temp.issue871_uuid('privacy-ticket-optin-2'),pg_temp.issue871_uuid('privacy-order-optin-2'),
    pg_temp.issue871_uuid('privacy-tier'),pg_temp.issue871_uuid('privacy-event'),
    'privacy-qr-optin-2','valid','auto'
  );
  -- Claim-like path: unowned order later linked to an opted-in buyer inherits true.
  INSERT INTO public.orders(
    id,event_id,buyer_email,buyer_name,total_cents,currency,
    payment_status,source,created_at,show_me_as_going
  ) VALUES (
    pg_temp.issue871_uuid('privacy-order-claim'),pg_temp.issue871_uuid('privacy-event'),
    'claim@example.test','Claim',1000,'USD','paid','legacy',now()+interval '5 seconds',false
  );
  INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status)
  VALUES (
    pg_temp.issue871_uuid('privacy-ticket-claim'),pg_temp.issue871_uuid('privacy-order-claim'),
    pg_temp.issue871_uuid('privacy-tier'),pg_temp.issue871_uuid('privacy-event'),
    'privacy-qr-claim','valid','auto'
  );
  PERFORM set_config('session_replication_role','origin',true);
  -- JWT as the opted-in buyer (claimant), so inherit runs under a real uid.
  PERFORM set_config('request.jwt.claim.sub',pg_temp.issue871_uuid('privacy-optin')::text,false);
  UPDATE public.orders
     SET buyer_user_id = pg_temp.issue871_uuid('privacy-optin')
   WHERE id = pg_temp.issue871_uuid('privacy-order-claim');
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.issue871_uuid('privacy-order-claim')
       AND show_me_as_going = true
  ) THEN
    RAISE EXCEPTION '#3682 privacy: claim/link did not inherit show_me_as_going';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',pg_temp.issue871_uuid('privacy-viewer')::text,false);
  page := public.peer_list_event_guests(pg_temp.issue871_uuid('privacy-event'),10,0)::jsonb;
  IF (SELECT count(*) FROM jsonb_array_elements(page->'guests') g
       WHERE g->>'profileId' = pg_temp.issue871_uuid('privacy-optin')::text) < 2 THEN
    RAISE EXCEPTION '#3682 privacy: multi-order opt-in should name both rows: %',page;
  END IF;
  IF COALESCE((page->>'viewerShowMeAsGoing')::boolean,true) <> false THEN
    RAISE EXCEPTION '#3682 privacy: viewerShowMeAsGoing should be false for viewer: %',page;
  END IF;
END;
$privacy$;

-- #3524 — remove the stub this file stood up, so the sibling #3524 suites in
-- this lane find `auth.identities` absent and build the shape they need. Drops
-- ONLY a table this session created; on a database with real GoTrue the flag
-- above is never set and this is a no-op.
DO $unstub$
BEGIN
  IF to_regclass('pg_temp.issue871_auth_identities_stub') IS NOT NULL THEN
    EXECUTE 'DROP TABLE auth.identities';
    DROP TABLE issue871_auth_identities_stub;
  END IF;
END
$unstub$;
