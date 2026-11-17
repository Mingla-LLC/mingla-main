\set ON_ERROR_STOP on

-- #4459 (20280730004459) tester adversarial suite. Angles the implementor
-- suites do not cover: exclusions surviving every later writer (a new RSVP,
-- an email claim, a team join and leave, a backfill re-run), history
-- restarting at a rejoin or restore, cross-brand isolation for every guest
-- and team RPC, the rate limit counting unsent sends, and the backfill run
-- against an adversarial pre-state (refunded per-listing members, team mutes,
-- pins at the 3-pin limit, a deleted brand). Everything rolls back.
--
-- MINGLA-INVARIANT: I-4459-EXCLUSION-OUTLIVES-WRITERS | issue #4459 | a sticky leave or host removal survives every later writer of Guest chat membership (booking triggers, claims, the team mirror, the backfill); only rejoin (after a leave) or restore (after a removal) lifts it, and history then restarts at that moment
--
-- FAILS-ON-REVERT: drop the brand_guest_chat_exclusions check from
-- issue_4459_backfill_brand_guest_chats (T-STICKY-BACKFILL), drop the
-- tg_4459_guest_history_from trigger (T-REJOIN-HISTORY, T-RESTORE-HISTORY),
-- or drop the NOT issue_4459_is_brand_team filter from the backfill mute
-- carry (T-BF-TEAM-MUTE).

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
CREATE FUNCTION pg_temp.read_as(p_tag text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM pg_temp.as_user(p_tag);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_sql INTO r;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.as_server();
  RETURN COALESCE(r, '');
END $f$;
CREATE FUNCTION pg_temp.post(p_tag text, p_brand text, p_text text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  v := pg_temp.rpc_as(p_tag, format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat(p_brand), p_text));
  IF jsonb_typeof(v) <> 'object' THEN RAISE EXCEPTION 'post by % failed: %', p_tag, v; END IF;
  RETURN (v->>'id')::uuid;
END $f$;
-- Messages p_tag can read in p_brand's Guest chat, under RLS.
CREATE FUNCTION pg_temp.visible(p_tag text, p_brand text) RETURNS integer LANGUAGE sql AS $f$
  SELECT pg_temp.count_as(p_tag, format('SELECT count(*)::integer FROM public.messages WHERE conversation_id = %L', pg_temp.chat(p_brand)))
$f$;

SELECT pg_temp.as_server();
SELECT pg_temp.brand('a');
SELECT pg_temp.brand('b');
SELECT pg_temp.listing('ea', 'a', 'event');
SELECT pg_temp.listing('ra', 'a', 'rsvp');
SELECT pg_temp.listing('eb', 'b', 'event');
SELECT pg_temp.person(t) FROM unnest(ARRAY['mgr', 'ana', 'ben', 'cy', 'lea', 'rem', 'gb', 'out']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('a'), pg_temp.u('mgr'), 'event_manager', now(), now());
SELECT pg_temp.paid_order('ea', t) FROM unnest(ARRAY['ana', 'ben', 'cy', 'lea', 'rem']) AS t;
SELECT pg_temp.paid_order('eb', 'gb');

-- ── T-CROSS: a guest or team member of brand A has no reach into brand B ────
DO $cross$
DECLARE v_b uuid := pg_temp.chat('b'); v_post uuid;
BEGIN
  v_post := pg_temp.post('b_owner', 'b', 'B only');
  PERFORM pg_temp.ok('T-CROSS-SETUP the guest is in A and not in B', pg_temp.member('a', 'ana') AND NOT pg_temp.member('b', 'ana'));
  PERFORM pg_temp.ok('T-CROSS-READ a brand A guest reads no brand B message', pg_temp.visible('ana', 'b') = 0);
  PERFORM pg_temp.ok('T-CROSS-ROSTER a brand A guest reads no brand B participant row',
    pg_temp.count_as('ana', format('SELECT count(*)::integer FROM public.conversation_participants WHERE conversation_id = %L', v_b)) = 0);
  PERFORM pg_temp.ok('T-CROSS-SEND a brand A guest cannot post in B',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', v_b, 'hi'))::text LIKE '%42501%');
  PERFORM pg_temp.ok('T-CROSS-MEMBERS a brand A guest cannot open B''s member sheet',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_list_brand_guest_members(%L)', v_b))::text LIKE '%42501%');
  PERFORM pg_temp.ok('T-CROSS-LEAVE a brand A guest cannot write a leave for B',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_leave_brand_guest_chat(%L)', v_b))::text LIKE '%42501%'
    AND NOT EXISTS (SELECT 1 FROM public.brand_guest_chat_exclusions WHERE brand_id = pg_temp.u('b') AND user_id = pg_temp.u('ana')));
  PERFORM pg_temp.ok('T-CROSS-REJOIN a brand A guest cannot rejoin into B',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_rejoin_brand_guest_chat(%L)', pg_temp.u('b')))::text LIKE '%not_eligible%'
    AND NOT pg_temp.member('b', 'ana'));
  PERFORM pg_temp.ok('T-CROSS-TEAM-REMOVE brand A''s team cannot remove a brand B guest',
    pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', v_b, pg_temp.u('gb')))::text LIKE '%42501%'
    AND pg_temp.member('b', 'gb'));
  PERFORM pg_temp.ok('T-CROSS-TEAM-BROADCAST brand A''s team cannot switch B to announcements only',
    pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_set_brand_guest_announcements_only(%L, true)', v_b))::text LIKE '%42501%'
    AND (SELECT is_broadcast_only IS NOT TRUE FROM public.conversations WHERE id = v_b));
  PERFORM pg_temp.ok('T-CROSS-TEAM-UNSEND brand A''s team cannot remove a brand B post',
    pg_temp.rpc_as('mgr', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v_post))::text LIKE '%42501%'
    AND (SELECT deleted_at IS NULL FROM public.messages WHERE id = v_post));
  PERFORM pg_temp.ok('T-CROSS-STATUS a status read is only ever about the caller',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_my_brand_guest_status(%L)', pg_temp.u('b')))->>'status' = 'not_eligible');
END $cross$;

-- ── T-STICKY: a leave outlives every later writer until the guest rejoins ───
DO $sticky$
DECLARE v_rsvp uuid; v_order uuid; v_claim uuid;
BEGIN
  PERFORM pg_temp.rpc_as('lea', format('SELECT public.issue_4459_leave_brand_guest_chat(%L)', pg_temp.chat('a')));
  PERFORM pg_temp.ok('T-STICKY-LEFT the leave lands', NOT pg_temp.member('a', 'lea'));
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('ra'), pg_temp.u('lea'), 'Lea', 'going', 'pending') RETURNING id INTO v_rsvp;
  UPDATE public.event_rsvps SET approval_status = 'approved' WHERE id = v_rsvp;
  PERFORM pg_temp.ok('T-STICKY-RSVP a new approved RSVP does not re-add a guest who left', NOT pg_temp.member('a', 'lea'));
  v_order := pg_temp.paid_order('ea', 'out');
  UPDATE public.orders SET buyer_user_id = NULL WHERE id = v_order;
  INSERT INTO public.pending_trip_chat_claims(order_id, event_id, buyer_email, claim_token)
    VALUES (v_order, pg_temp.u('ea'), 'lea@example.test', 'i4459-tester-claim') RETURNING id INTO v_claim;
  UPDATE public.pending_trip_chat_claims SET claimed_at = now(), claimed_by_user_id = pg_temp.u('lea') WHERE id = v_claim;
  PERFORM pg_temp.ok('T-STICKY-CLAIM an email claim does not re-add a guest who left', NOT pg_temp.member('a', 'lea'));
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
    VALUES (pg_temp.u('a'), pg_temp.u('lea'), 'event_manager', now(), now());
  PERFORM pg_temp.ok('T-STICKY-TEAM-IN joining the team puts them in (team mirror)', pg_temp.member('a', 'lea'));
  UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id = pg_temp.u('a') AND user_id = pg_temp.u('lea');
  PERFORM pg_temp.ok('T-STICKY-TEAM-OUT leaving the team does not undo their earlier leave', NOT pg_temp.member('a', 'lea'));
  PERFORM public.issue_4459_backfill_brand_guest_chats();
  PERFORM pg_temp.ok('T-STICKY-BACKFILL a backfill re-run does not re-add a guest who left', NOT pg_temp.member('a', 'lea'));
  PERFORM pg_temp.ok('T-STICKY-STATUS they can still rejoin from a booking',
    (pg_temp.rpc_as('lea', format('SELECT public.issue_4459_my_brand_guest_status(%L)', pg_temp.u('a'))) @> '{"status":"left","canRejoin":true}'));

  -- A host removal outlives the same writers, and rejoin never lifts it.
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', pg_temp.chat('a'), pg_temp.u('rem')));
  PERFORM pg_temp.paid_order('ea', 'rem');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('ra'), pg_temp.u('rem'), 'Rem', 'going', 'approved');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
    VALUES (pg_temp.u('a'), pg_temp.u('rem'), 'event_manager', now(), now());
  UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id = pg_temp.u('a') AND user_id = pg_temp.u('rem');
  PERFORM public.issue_4459_backfill_brand_guest_chats();
  PERFORM pg_temp.ok('T-REMOVED-WRITERS a removed guest stays out after an order, an RSVP, a team stint and a backfill',
    NOT pg_temp.member('a', 'rem') AND pg_temp.visible('rem', 'a') = 0);
  PERFORM pg_temp.ok('T-REMOVED-REJOIN rejoin is refused after a removal',
    pg_temp.rpc_as('rem', format('SELECT public.issue_4459_rejoin_brand_guest_chat(%L)', pg_temp.u('a')))::text LIKE '%removed%'
    AND NOT pg_temp.member('a', 'rem'));
END $sticky$;

-- ── T-HISTORY: history restarts at a rejoin and at a restore ────────────────
DO $history$
DECLARE v_old uuid;
BEGIN
  v_old := pg_temp.post('mgr', 'a', 'said while Lea and Rem were out');
  -- Back-date it: inside one transaction now() is constant.
  UPDATE public.messages SET created_at = now() - interval '1 hour' WHERE id = v_old;
  -- A control member with full history (as a backfilled guest has).
  PERFORM pg_temp.person('ctl');
  PERFORM set_config('issue_4459.backfill', 'on', true);
  PERFORM pg_temp.paid_order('ea', 'ctl');
  PERFORM set_config('issue_4459.backfill', '', true);
  PERFORM pg_temp.ok('T-HISTORY-SETUP a member with full history reads it',
    pg_temp.count_as('ctl', format('SELECT count(*)::integer FROM public.messages WHERE id = %L', v_old)) = 1);
  PERFORM pg_temp.rpc_as('lea', format('SELECT public.issue_4459_rejoin_brand_guest_chat(%L)', pg_temp.u('a')));
  PERFORM pg_temp.ok('T-REJOIN-MEMBER the rejoin lands', pg_temp.member('a', 'lea'));
  PERFORM pg_temp.ok('T-REJOIN-HISTORY a rejoined guest does not read what was said before the rejoin',
    pg_temp.count_as('lea', format('SELECT count(*)::integer FROM public.messages WHERE id = %L', v_old)) = 0);
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_restore_brand_guest(%L, %L)', pg_temp.chat('a'), pg_temp.u('rem')));
  PERFORM pg_temp.ok('T-RESTORE-MEMBER the restore lands', pg_temp.member('a', 'rem'));
  PERFORM pg_temp.ok('T-RESTORE-HISTORY a restored guest does not read what was said while removed',
    pg_temp.count_as('rem', format('SELECT count(*)::integer FROM public.messages WHERE id = %L', v_old)) = 0);
  PERFORM pg_temp.post('mgr', 'a', 'after');
  PERFORM pg_temp.ok('T-HISTORY-AFTER both read what is said after they are back',
    pg_temp.visible('lea', 'a') = 1 AND pg_temp.visible('rem', 'a') = 1);
END $history$;

-- ── T-RATE: unsending does not refund the guest rate limit ──────────────────
DO $rate$
DECLARE v jsonb; v_ids uuid[] := ARRAY[]::uuid[]; v_ok integer := 0;
BEGIN
  FOR i IN 1..20 LOOP
    v := pg_temp.rpc_as('ben', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('a'), 'm' || i));
    IF jsonb_typeof(v) = 'object' THEN v_ok := v_ok + 1; v_ids := v_ids || (v->>'id')::uuid; END IF;
  END LOOP;
  PERFORM pg_temp.ok('T-RATE-20 twenty sends inside ten minutes go through', v_ok = 20);
  PERFORM pg_temp.rpc_as('ben', format('SELECT public.unsend_messages(%L::uuid[])', v_ids[1:10]));
  PERFORM pg_temp.ok('T-RATE-UNSEND unsending ten does not buy ten more sends',
    pg_temp.rpc_as('ben', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('a'), 'again'))::text LIKE '%PT409%');
  PERFORM pg_temp.ok('T-RATE-RETRY a retry of a stored send with its client id is not a new send',
    pg_temp.rpc_as('cy', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, NULL, %L)', pg_temp.chat('a'), 'once', '00000000-0000-4000-8000-000000004459'))->>'id'
    = pg_temp.rpc_as('cy', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, NULL, %L)', pg_temp.chat('a'), 'once', '00000000-0000-4000-8000-000000004459'))->>'id');
  PERFORM pg_temp.ok('T-RATE-OTHER-CHAT the limit is per chat: the same guest still posts in another brand',
    jsonb_typeof(pg_temp.rpc_as('gb', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b'), 'hello B'))) = 'object');
END $rate$;

-- ── T-BF: the backfill against an adversarial pre-state ─────────────────────
-- Brand C as it stood before the migration: a per-listing chat (enabled) with
-- a muted guest, a pinned guest already at the 3-pin limit, a refunded member,
-- a muted team member; and a soft-deleted brand D with a paying guest.
SELECT pg_temp.brand('c');
SELECT pg_temp.listing('ec', 'c', 'event');
SELECT pg_temp.person(t) FROM unnest(ARRAY['mute', 'pin', 'refund', 'cmgr', 'dguest']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('c'), pg_temp.u('cmgr'), 'event_manager', now(), now());
SELECT pg_temp.paid_order('ec', t) FROM unnest(ARRAY['mute', 'pin', 'refund']) AS t;
SELECT pg_temp.brand('d');
SELECT pg_temp.listing('ed', 'd', 'event');
SELECT pg_temp.paid_order('ed', 'dguest');
DO $bf$
DECLARE v_listing uuid; v_other uuid; v_first jsonb; v_second jsonb; v_before text; v_after text;
BEGIN
  UPDATE public.orders SET payment_status = 'refunded' WHERE buyer_user_id = pg_temp.u('refund');
  -- Undo what the triggers already did, so brand C looks pre-migration.
  DELETE FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('c')
     AND user_id IN (pg_temp.u('mute'), pg_temp.u('pin'), pg_temp.u('refund'));
  INSERT INTO public.conversations(type, linked_entity_type, event_id, name, created_by, is_enabled)
    VALUES ('group', 'event', pg_temp.u('ec'), 'Listing ec', pg_temp.u('c_owner'), true) RETURNING id INTO v_listing;
  INSERT INTO public.conversation_participants(conversation_id, user_id, notifications_muted)
    SELECT v_listing, u, u IN (pg_temp.u('mute'), pg_temp.u('cmgr'))
      FROM unnest(ARRAY[pg_temp.u('mute'), pg_temp.u('pin'), pg_temp.u('refund'), pg_temp.u('cmgr'), pg_temp.u('c_owner')]) AS u;
  INSERT INTO public.conversation_participant_lifecycle(conversation_id, user_id, pinned_at)
    VALUES (v_listing, pg_temp.u('pin'), now() - interval '3 days');
  -- Two more pins elsewhere: the pinned guest is at the 3-pin limit.
  FOR i IN 1..2 LOOP
    INSERT INTO public.conversations(type, linked_entity_type, name, created_by, is_enabled)
      VALUES ('group', 'direct', 'Friends ' || i, pg_temp.u('pin'), true) RETURNING id INTO v_other;
    INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_other, pg_temp.u('pin'));
    INSERT INTO public.conversation_participant_lifecycle(conversation_id, user_id, pinned_at) VALUES (v_other, pg_temp.u('pin'), now());
  END LOOP;
  UPDATE public.brands SET deleted_at = now() WHERE id = pg_temp.u('d');

  v_first := public.issue_4459_backfill_brand_guest_chats();
  PERFORM pg_temp.ok('T-BF-GUESTS eligible guests move in, a refunded per-listing member does not',
    pg_temp.member('c', 'mute') AND pg_temp.member('c', 'pin') AND NOT pg_temp.member('c', 'refund'));
  PERFORM pg_temp.ok('T-BF-FULL-HISTORY backfilled guests see the whole history',
    (SELECT bool_and(history_visible_from IS NULL) FROM public.conversation_participants
      WHERE conversation_id = pg_temp.chat('c') AND user_id IN (pg_temp.u('mute'), pg_temp.u('pin'))));
  PERFORM pg_temp.ok('T-BF-MUTE a guest muted on a per-listing chat starts muted',
    (SELECT notifications_muted FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('c') AND user_id = pg_temp.u('mute'))
    AND NOT (SELECT notifications_muted FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('c') AND user_id = pg_temp.u('pin')));
  PERFORM pg_temp.ok('T-BF-TEAM-MUTE a team member''s per-listing mute is not carried (team pushes follow tags and replies)',
    NOT (SELECT notifications_muted FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('c') AND user_id = pg_temp.u('cmgr')));
  PERFORM pg_temp.ok('T-BF-PIN the pin moves to the Guest chat and leaves the per-listing chat (still 3 pins)',
    EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id = pg_temp.chat('c') AND user_id = pg_temp.u('pin') AND pinned_at IS NOT NULL)
    AND (SELECT pinned_at IS NULL FROM public.conversation_participant_lifecycle WHERE conversation_id = v_listing AND user_id = pg_temp.u('pin'))
    AND (SELECT count(*) FROM public.conversation_participant_lifecycle WHERE user_id = pg_temp.u('pin') AND pinned_at IS NOT NULL) = 3);
  PERFORM pg_temp.ok('T-BF-RETIRE the per-listing chat is disabled, its rows kept',
    (SELECT is_enabled IS FALSE FROM public.conversations WHERE id = v_listing)
    AND (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = v_listing) = 5);
  PERFORM pg_temp.ok('T-BF-DELETED-BRAND a deleted brand gets no new members',
    pg_temp.chat('d') IS NULL OR NOT pg_temp.member('d', 'dguest')
    OR (SELECT is_enabled IS FALSE FROM public.conversations WHERE id = pg_temp.chat('d')));

  SELECT string_agg(format('%s|%s|%s|%s', cp.conversation_id, cp.user_id, cp.notifications_muted, cp.history_visible_from), ',' ORDER BY cp.conversation_id, cp.user_id)
       || '#' || COALESCE((SELECT string_agg(format('%s|%s|%s', l.conversation_id, l.user_id, l.pinned_at), ',' ORDER BY l.conversation_id, l.user_id)
                    FROM public.conversation_participant_lifecycle l), '')
    INTO v_before FROM public.conversation_participants cp;
  v_second := public.issue_4459_backfill_brand_guest_chats();
  SELECT string_agg(format('%s|%s|%s|%s', cp.conversation_id, cp.user_id, cp.notifications_muted, cp.history_visible_from), ',' ORDER BY cp.conversation_id, cp.user_id)
       || '#' || COALESCE((SELECT string_agg(format('%s|%s|%s', l.conversation_id, l.user_id, l.pinned_at), ',' ORDER BY l.conversation_id, l.user_id)
                    FROM public.conversation_participant_lifecycle l), '')
    INTO v_after FROM public.conversation_participants cp;
  PERFORM pg_temp.ok('T-BF-TWICE a second run adds nothing, retires nothing and changes no row',
    (v_second->>'guestsAdded')::integer = 0 AND (v_second->>'perListingRetired')::integer = 0 AND v_before = v_after);
END $bf$;

ROLLBACK;
