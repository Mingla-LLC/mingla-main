\set ON_ERROR_STOP on

-- #4459 (20280730004459) tester adversarial suite for the rework (D4/D8):
-- every real server approval path still stamps Guest chat eligibility (host
-- approve and deny RPCs, public submit on an auto-approve event, waitlist
-- promotion by a capacity raise, the migration's seed of existing approvals),
-- while clients cannot reach eligibility through the plus-one, email-claim or
-- host/admin RPC paths, and a non-member cannot write themselves into a Guest
-- chat now that the participant policies are caller-scoped. Rolls back.
--
-- MINGLA-INVARIANT: I-4459-RSVP-ELIGIBILITY-SERVER-ONLY | issue #4459 | Guest chat eligibility from an RSVP needs an approval written by a server path (definer RPC, trigger, service role); every legitimate server path still stamps it, and no client write or client-callable RPC can
--
-- FAILS-ON-REVERT: drop the issue_4459_a_rsvp_server_approval trigger and
-- T4-AUTO / T4-WAITLIST / T4-HOST-APPROVE fail (verified at 661c9e063d).
-- T4-SEED runs the migration's seed statement verbatim (lines 584-588) on a
-- pre-guard approval; T4-NONMEMBER guards the permissive participant policies.

BEGIN;

DO $realtime_stub$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    ALTER TABLE public.collaboration_sessions
      DISABLE TRIGGER tr_collaboration_sessions_broadcast_session_updated;
  END IF;
END $realtime_stub$;

CREATE TEMP TABLE k(tag text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON k TO authenticated;
CREATE FUNCTION pg_temp.u(p_tag text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM k WHERE tag = p_tag $f$;
CREATE FUNCTION pg_temp.ok(p_label text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_label; END IF;
  RAISE NOTICE 'PASS %', p_label;
END $f$;
CREATE FUNCTION pg_temp.as_user(p_tag text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid := pg_temp.u(p_tag);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
END $f$;
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
END $f$;
-- Runs p_sql as the signed-in p_tag; returns 'ok' or the SQLSTATE and message.
CREATE FUNCTION pg_temp.try_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_tag);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql;
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.as_server();
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN v_state || ' ' || v_msg;
  END;
END $f$;
-- A jsonb RPC result as p_tag (or the SQLSTATE and message as a json string).
CREATE FUNCTION pg_temp.rpc_as(p_tag text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(p_tag);
    PERFORM set_config('role', 'authenticated', true);
    EXECUTE p_sql INTO r;
    PERFORM set_config('role', 'postgres', true);
    PERFORM pg_temp.as_server();
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN to_jsonb(v_state || ' ' || v_msg);
  END;
END $f$;
-- Count of rows p_sql (a SELECT count(*)) returns as p_tag under RLS.
CREATE FUNCTION pg_temp.count_as(p_tag text, p_sql text) RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE r integer;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_server();
  RETURN r;
END $f$;

CREATE TEMP SEQUENCE i4459_phone START 1000000;
-- A person with a proved phone (an order's owner must own its contact, #4063).
CREATE FUNCTION pg_temp.person(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'i4459-' || p_tag || '-' || v || '@example.test');
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v, '+1555' || nextval('i4459_phone'));
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
-- A brand with its owner (the owner joins the team through the brand trigger).
CREATE FUNCTION pg_temp.brand(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_owner uuid := pg_temp.person(p_tag || '_owner'); v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
    VALUES (v, v_owner, 'Brand ' || p_tag, 'i4459-' || p_tag || '-' || v, 'stripe');
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.listing(p_tag text, p_brand text, p_type text, p_start interval DEFAULT interval '2 days')
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, is_recurring)
    VALUES (v, pg_temp.u(p_brand), 'Listing ' || p_tag, 'i4459-' || p_tag || '-' || v,
            p_type, 'draft', 'draft', 'UTC', false, false);
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.paid_order(p_listing text, p_buyer text, p_status text DEFAULT 'paid',
  p_source text DEFAULT 'online_checkout') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status, payment_method,
                            total_cents, source, door_payment_method)
    VALUES (v, pg_temp.u(p_listing), pg_temp.u(p_buyer), NULL,
            (SELECT phone_e164 FROM public.verified_phone_identities WHERE user_id = pg_temp.u(p_buyer)), p_status,
            CASE WHEN p_source = 'door_sale' THEN 'cash' ELSE 'free' END, 0, p_source,
            CASE WHEN p_source = 'door_sale' THEN 'cash' END);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.chat(p_brand text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT c.id FROM public.conversations c
   WHERE c.brand_id = pg_temp.u(p_brand) AND c.linked_entity_type = 'brand_guests'
$f$;
CREATE FUNCTION pg_temp.chats(p_brand text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.conversations c
   WHERE c.brand_id = pg_temp.u(p_brand) AND c.linked_entity_type = 'brand_guests'
$f$;
CREATE FUNCTION pg_temp.member(p_brand text, p_person text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.conversation_participants cp
                  WHERE cp.conversation_id = pg_temp.chat(p_brand) AND cp.user_id = pg_temp.u(p_person))
$f$;
CREATE FUNCTION pg_temp.in_one(p_brand text, p_person text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT pg_temp.chats(p_brand) = 1 AND pg_temp.member(p_brand, p_person)
$f$;
SELECT pg_temp.as_server();
SELECT pg_temp.brand('a');
UPDATE public.brands SET default_currency = 'USD' WHERE id = pg_temp.u('a');
SELECT pg_temp.listing('man', 'a', 'rsvp');
SELECT pg_temp.listing('auto', 'a', 'rsvp');
SELECT pg_temp.listing('ev', 'a', 'event');
INSERT INTO public.event_dates(event_id, start_at, end_at, is_master)
  SELECT pg_temp.u(t), now() + interval '3 days', now() + interval '3 days 3 hours', true FROM unnest(ARRAY['man', 'auto']) t;
UPDATE public.events SET status = 'scheduled', visibility = 'public', rsvp_approval_mode = 'manual' WHERE id = pg_temp.u('man');
UPDATE public.events SET status = 'scheduled', visibility = 'public', rsvp_approval_mode = 'auto', rsvp_capacity = 1 WHERE id = pg_temp.u('auto');
SELECT pg_temp.person(t) FROM unnest(ARRAY['host', 'pen', 'sub', 'held', 'old', 'plus', 'claim', 'stranger', 'guest']) t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('a'), pg_temp.u('host'), 'event_manager', now(), now());
SELECT pg_temp.paid_order('ev', 'guest');

CREATE FUNCTION pg_temp.stamped(p_person text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.issue_4459_rsvp_server_approvals sa
                   JOIN public.event_rsvps r ON r.id = sa.rsvp_id WHERE r.user_id = pg_temp.u(p_person))
$f$;
CREATE FUNCTION pg_temp.rsvp_key(p_person text) RETURNS text LANGUAGE sql AS $f$
  SELECT 'rsvp:' || r.id FROM public.event_rsvps r WHERE r.user_id = pg_temp.u(p_person)
$f$;

-- Server paths first, in a transaction no client has written in yet.
DO $server$
DECLARE v jsonb;
BEGIN
  -- Public submit on an auto-approve event (the edge function's RPC).
  PERFORM public.submit_event_rsvp_with_delivery(pg_temp.u('auto'), pg_temp.u('sub'), 'Sub', NULL, NULL,
    'going', 0, '[]'::jsonb, 'tester-pepper-4459-0123456789abcdefghij', NULL);
  PERFORM pg_temp.ok('T4-AUTO an auto-approved public RSVP is stamped and joins', pg_temp.stamped('sub') AND pg_temp.member('a', 'sub'));

  -- Waitlist (auto event, capacity 1 taken) then a capacity raise promotes it.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, waitlisted_at)
    VALUES (pg_temp.u('auto'), pg_temp.u('held'), 'Held', 'waitlisted', 'approved', now());
  PERFORM pg_temp.ok('T4-WAITLIST-HELD a waitlisted guest is not in the chat', NOT pg_temp.member('a', 'held'));
  UPDATE public.events SET rsvp_capacity = 10 WHERE id = pg_temp.u('auto');
  PERFORM pg_temp.ok('T4-WAITLIST a capacity-raise promotion joins the chat',
    (SELECT rsvp_status FROM public.event_rsvps WHERE user_id = pg_temp.u('held')) = 'going' AND pg_temp.member('a', 'held'));

  -- Manual event: a pending RSVP, then the host's approve and deny RPCs.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('man'), pg_temp.u('pen'), 'Pen', 'going', 'pending');
  PERFORM pg_temp.ok('T4-PENDING a pending RSVP is neither stamped nor in the chat', NOT pg_temp.stamped('pen') AND NOT pg_temp.member('a', 'pen'));
  v := pg_temp.rpc_as('host', format('SELECT public.business_set_rsvp_guest_status(%L, %L, %L, ARRAY[%L], NULL, NULL)',
    pg_temp.u('man'), 'approve', 'selected', pg_temp.rsvp_key('pen')));
  PERFORM pg_temp.ok('T4-HOST-APPROVE the host approve RPC stamps and joins', jsonb_typeof(v) = 'object' AND pg_temp.stamped('pen') AND pg_temp.member('a', 'pen'));
  v := pg_temp.rpc_as('host', format('SELECT public.business_set_rsvp_guest_status(%L, %L, %L, ARRAY[%L], NULL, NULL)',
    pg_temp.u('man'), 'deny', 'selected', pg_temp.rsvp_key('pen')));
  PERFORM pg_temp.ok('T4-HOST-DENY the host deny RPC unstamps and removes', jsonb_typeof(v) = 'object' AND NOT pg_temp.stamped('pen') AND NOT pg_temp.member('a', 'pen'));
END $server$;

-- The migration's seed: an approval written before the guard is stamped by it.
SET LOCAL session_replication_role = replica;
INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
  VALUES (pg_temp.u('man'), pg_temp.u('old'), 'Old', 'going', 'approved');
SET LOCAL session_replication_role = origin;
INSERT INTO public.issue_4459_rsvp_server_approvals(rsvp_id, approved_at)
SELECT r.id, COALESCE(r.updated_at, r.created_at) FROM public.event_rsvps r
 WHERE r.approval_status = 'approved'
 ORDER BY r.id
ON CONFLICT (rsvp_id) DO NOTHING;
SELECT public.issue_4459_backfill_brand_guest_chats();
DO $seed$ BEGIN
  PERFORM pg_temp.ok('T4-SEED an approval from before the guard is stamped and backfilled', pg_temp.stamped('old') AND pg_temp.member('a', 'old'));
END $seed$;

-- Client paths.
DO $client$
DECLARE v_rsvp uuid := (SELECT id FROM public.event_rsvps WHERE user_id = pg_temp.u('sub'));
BEGIN
  PERFORM pg_temp.try_as('plus', format('UPDATE public.event_rsvp_guests SET matched_user_id = %L', pg_temp.u('plus')));
  PERFORM pg_temp.ok('T4-PLUS-ONE a client cannot match itself as a plus-one',
    pg_temp.try_as('plus', format('INSERT INTO public.event_rsvp_guests(rsvp_id, name, email, phone, matched_user_id) VALUES (%L, %L, %L, %L, %L)',
      v_rsvp, 'P', 'p@example.test', '+15550004459', pg_temp.u('plus'))) LIKE '42501%'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvp_guests WHERE matched_user_id = pg_temp.u('plus'))
    AND NOT pg_temp.member('a', 'plus'));
  PERFORM pg_temp.try_as('claim', format('UPDATE public.pending_trip_chat_claims SET claimed_by_user_id = %L, claimed_at = now()', pg_temp.u('claim')));
  PERFORM pg_temp.ok('T4-CLAIM a client cannot claim an email checkout row itself',
    NOT EXISTS (SELECT 1 FROM public.pending_trip_chat_claims WHERE claimed_by_user_id = pg_temp.u('claim')));
  PERFORM pg_temp.try_as('stranger', format('INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.u('man'), pg_temp.u('stranger'), 'S', 'going', 'pending'));
  PERFORM pg_temp.ok('T4-RPC-HOST a guest cannot call the host approve RPC',
    pg_temp.rpc_as('stranger', format('SELECT public.business_set_rsvp_guest_status(%L, %L, %L, ARRAY[%L], NULL, NULL)',
      pg_temp.u('man'), 'approve', 'selected', pg_temp.rsvp_key('stranger')))::text LIKE '%42501%');
  PERFORM pg_temp.ok('T4-RPC-ROSTER a guest cannot call the roster approval RPC',
    pg_temp.rpc_as('stranger', format('SELECT public.biz_guest_roster_set_rsvp_approval(%L, %L, %L, NULL)',
      pg_temp.u('man'), pg_temp.rsvp_key('stranger'), 'approve'))::text LIKE '%42501%');
  PERFORM pg_temp.ok('T4-RPC-ADMIN a guest cannot call the admin approval RPC',
    pg_temp.rpc_as('stranger', format('SELECT to_jsonb(public.admin_set_rsvp_approval(%L, %L, NULL))',
      (SELECT id FROM public.event_rsvps WHERE user_id = pg_temp.u('stranger')), 'approved'))::text NOT LIKE '{%'
    AND NOT pg_temp.stamped('stranger') AND NOT pg_temp.member('a', 'stranger'));
  -- A non-member cannot write itself into the chat now that the policy is caller-scoped.
  PERFORM pg_temp.ok('T4-NONMEMBER a non-member cannot insert its own participant row',
    pg_temp.try_as('stranger', format('INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (%L, %L)',
      pg_temp.chat('a'), pg_temp.u('stranger'))) LIKE '42501%' AND NOT pg_temp.member('a', 'stranger'));
  PERFORM pg_temp.ok('T4-MEMBER-NO-SELF-DELETE a member cannot delete its own row directly',
    pg_temp.member('a', 'guest') AND pg_temp.count_as('guest', format(
      'WITH d AS (DELETE FROM public.conversation_participants WHERE conversation_id = %L AND user_id = %L RETURNING 1) SELECT count(*)::integer FROM d',
      pg_temp.chat('a'), pg_temp.u('guest'))) = 0 AND pg_temp.member('a', 'guest'));
END $client$;

ROLLBACK;
