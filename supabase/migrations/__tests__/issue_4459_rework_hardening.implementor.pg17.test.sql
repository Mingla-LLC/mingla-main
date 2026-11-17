\set ON_ERROR_STOP on

-- #4459 (20280730004459) rework: RSVP approval hardening, a hidden Guest chat
-- coming back with the next post, and RLS helpers that answer only about the
-- signed-in caller. Everything rolls back.
--
-- MINGLA-INVARIANT: I-4459-RSVP-SERVER-APPROVAL | issue #4459 | a signed-in client can never write approval_status, promote itself off a waitlist or insert an approved RSVP; Guest chat eligibility counts an RSVP only with a server-written approval stamp
--
-- FAILS-ON-REVERT: drop the issue_4459_rsvp_client_guard trigger (H-1/H-2
-- fail), drop its waitlist-promotion step (H-2d/H-2f fail), drop the stamp join from issue_4459_brand_guest_eligible (H-4
-- fails), drop the reopen trigger (H-6 fails), or grant EXECUTE on the
-- server-only helpers again (H-8 fails).

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

SELECT pg_temp.as_server();
SELECT pg_temp.brand('b1');
SELECT pg_temp.brand('b2');
SELECT pg_temp.listing('rsvp', 'b1', 'rsvp');
SELECT pg_temp.listing('ev', 'b1', 'event');
SELECT pg_temp.person(t) FROM unnest(ARRAY['ana', 'ben', 'cy', 'mgr']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('b1'), pg_temp.u('mgr'), 'event_manager', now(), now());
-- The RSVP listing is open, so the guest-insert policy applies.
INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (pg_temp.u('rsvp'), now() + interval '2 days', now() + interval '2 days 4 hours', 'UTC', true);
ALTER TABLE public.events DISABLE TRIGGER USER;
UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = pg_temp.u('rsvp');
ALTER TABLE public.events ENABLE TRIGGER USER;

DO $h$
DECLARE v_r text; v_rsvp uuid; v jsonb;
BEGIN
  -- H-1: a client cannot insert itself approved or straight off a waitlist.
  v_r := pg_temp.try_as('ana', format(
    'INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.u('rsvp'), pg_temp.u('ana'), 'Ana', 'going', 'approved'));
  PERFORM pg_temp.ok('H-1 a client insert with approval_status approved is refused', v_r LIKE '42501%' AND NOT pg_temp.member('b1', 'ana'));

  -- A pending RSVP from the client is still allowed, and joins nothing.
  v_r := pg_temp.try_as('ana', format(
    'INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.u('rsvp'), pg_temp.u('ana'), 'Ana', 'going', 'pending'));
  PERFORM pg_temp.ok('H-1b a pending client RSVP is accepted and is not chat access', v_r = 'ok' AND NOT pg_temp.member('b1', 'ana'));

  -- H-2: a client cannot approve or promote itself.
  SELECT id INTO v_rsvp FROM public.event_rsvps WHERE user_id = pg_temp.u('ana');
  v_r := pg_temp.try_as('ana', format('UPDATE public.event_rsvps SET approval_status = %L WHERE id = %L', 'approved', v_rsvp));
  PERFORM pg_temp.ok('H-2 a client cannot set its own approval', v_r LIKE '42501%'
    AND (SELECT approval_status FROM public.event_rsvps WHERE id = v_rsvp) = 'pending' AND NOT pg_temp.member('b1', 'ana'));
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, waitlisted_at)
    VALUES (pg_temp.u('rsvp'), pg_temp.u('ben'), 'Ben', 'waitlisted', 'approved', now());
  v_r := pg_temp.try_as('ben', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'going', pg_temp.u('ben')));
  PERFORM pg_temp.ok('H-2b a client cannot promote itself off the waitlist', v_r LIKE '42501%' AND NOT pg_temp.member('b1', 'ben'));
  v_r := pg_temp.try_as('ben', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'not_going', pg_temp.u('ben')));
  PERFORM pg_temp.ok('H-2c a client can still drop off the waitlist', v_r = 'ok');
  -- H-2d (QA retest): the two-step (waitlisted -> not_going -> going/maybe)
  -- is refused; only the server's promotion moves a waitlisted row on.
  v_r := pg_temp.try_as('ben', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'going', pg_temp.u('ben')));
  PERFORM pg_temp.ok('H-2d a guest who left the waitlist cannot then go', v_r LIKE '42501%'
    AND (SELECT rsvp_status FROM public.event_rsvps WHERE user_id = pg_temp.u('ben')) = 'not_going' AND NOT pg_temp.member('b1', 'ben'));
  v_r := pg_temp.try_as('ben', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'maybe', pg_temp.u('ben')));
  PERFORM pg_temp.ok('H-2e nor move to maybe', v_r LIKE '42501%');
  -- A legacy waitlisted row with no waitlisted_at keeps its mark on leaving.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp'), pg_temp.u('cy'), 'Cy', 'waitlisted', 'approved');
  v_r := pg_temp.try_as('cy', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'not_going', pg_temp.u('cy')));
  v_r := v_r || '|' || pg_temp.try_as('cy', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'going', pg_temp.u('cy')));
  PERFORM pg_temp.ok('H-2f a legacy waitlisted row (no waitlisted_at) cannot two-step either', v_r LIKE 'ok|42501%'
    AND (SELECT rsvp_status FROM public.event_rsvps WHERE user_id = pg_temp.u('cy')) = 'not_going');
  DELETE FROM public.event_rsvps WHERE user_id = pg_temp.u('cy');
  -- Once the server promotes it, the guest owns the row again.
  UPDATE public.event_rsvps SET rsvp_status = 'going', promoted_at = now() WHERE user_id = pg_temp.u('ben');
  v_r := pg_temp.try_as('ben', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'not_going', pg_temp.u('ben')));
  v_r := v_r || '|' || pg_temp.try_as('ben', format('UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'going', pg_temp.u('ben')));
  PERFORM pg_temp.ok('H-2g a server-promoted guest can leave and come back', v_r = 'ok|ok');

  -- H-3: the server approving (host RPC, trigger, service role) stamps and joins.
  UPDATE public.event_rsvps SET approval_status = 'approved' WHERE id = v_rsvp;
  PERFORM pg_temp.ok('H-3 a server approval is stamped and joins the Guest chat',
    EXISTS (SELECT 1 FROM public.issue_4459_rsvp_server_approvals WHERE rsvp_id = v_rsvp) AND pg_temp.member('b1', 'ana'));

  -- H-4: an approved RSVP with no server stamp is not chat access.
  DELETE FROM public.issue_4459_rsvp_server_approvals WHERE rsvp_id = v_rsvp;
  PERFORM public.issue_4459_sync_brand_guest(pg_temp.u('b1'), pg_temp.u('ana'));
  PERFORM pg_temp.ok('H-4 eligibility needs a server-written approval', NOT pg_temp.member('b1', 'ana'));
  PERFORM pg_temp.ok('H-5 the stamp table is not readable by clients',
    pg_temp.try_as('ana', 'SELECT count(*) FROM public.issue_4459_rsvp_server_approvals') LIKE '42501%');
END $h$;

-- H-6: a hidden Guest chat comes back with the next brand post (and guest post).
DO $h6$
DECLARE v_r text;
BEGIN
  PERFORM pg_temp.paid_order('ev', 'cy');
  v_r := pg_temp.try_as('cy', format('SELECT public.set_conversation_lifecycle(%L, %L)', pg_temp.chat('b1'), 'hide'));
  PERFORM pg_temp.ok('H-6a a guest hides the Guest chat',
    v_r = 'ok' AND (SELECT hidden_at IS NOT NULL FROM public.conversation_participant_lifecycle
                     WHERE conversation_id = pg_temp.chat('b1') AND user_id = pg_temp.u('cy')));
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'Doors at 8'));
  PERFORM pg_temp.ok('H-6b the next brand post (no sender) brings it back',
    (SELECT hidden_at IS NULL FROM public.conversation_participant_lifecycle
      WHERE conversation_id = pg_temp.chat('b1') AND user_id = pg_temp.u('cy')));
  PERFORM pg_temp.ok('H-6c it is listed again',
    pg_temp.count_as('cy', format('SELECT count(*) FROM public.list_connection_conversation_access() WHERE conversation_id = %L', pg_temp.chat('b1'))) = 1);
END $h6$;

-- H-8: server-only helpers are not callable by clients; the RLS helpers answer
-- only about the caller.
DO $h8$
BEGIN
  PERFORM pg_temp.ok('H-8a issue_4459_is_brand_guest_team is server-only',
    NOT has_function_privilege('authenticated', 'public.issue_4459_is_brand_guest_team(uuid,uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('H-8b issue_4459_is_brand_guests_conversation is server-only',
    NOT has_function_privilege('authenticated', 'public.issue_4459_is_brand_guests_conversation(uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('H-8c a guest cannot ask about another brand''s team',
    pg_temp.count_as('cy', format('SELECT count(*) FROM (SELECT public.issue_4459_rls_roster_row(%L, %L) AS v) s WHERE s.v', pg_temp.chat('b2'), pg_temp.u('b2_owner'))) = 0
    AND pg_temp.count_as('cy', format('SELECT count(*) FROM (SELECT public.issue_4459_rls_i_run_guest_chat(%L) AS v) s WHERE s.v', pg_temp.chat('b1'))) = 0
    AND pg_temp.count_as('cy', format('SELECT count(*) FROM (SELECT public.issue_4459_rls_my_guest_chat(%L) AS v) s WHERE s.v', pg_temp.chat('b2'))) = 0);
  PERFORM pg_temp.ok('H-8d a member still sees the team rows and their own',
    pg_temp.count_as('cy', format('SELECT count(*) FROM public.conversation_participants WHERE conversation_id = %L', pg_temp.chat('b1')))
      = 1 + (SELECT count(*) FROM public.brand_team_members m WHERE m.brand_id = pg_temp.u('b1') AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL));
END $h8$;

ROLLBACK;
