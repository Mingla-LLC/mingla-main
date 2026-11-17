\set ON_ERROR_STOP on

-- #4459 (20280805004459): one brand-wide Guest chat per brand. Runs on the
-- fully replayed PG17 schema; everything rolls back.
--
-- INVARIANT issue-4459-brand-guests: one brand_guests conversation per brand; membership = brand team ∪ eligible guests − exclusions; written only by issue_4459_* definer functions; never merged with linked_entity_type='brand'; Explorer renders it as the only brand_channel row (no client fold).
-- INVARIANT issue-4459-no-cap: any future cap on conversation_participants must exempt linked_entity_type='brand_guests'.
--
-- Cases
--   H-*  happy path, one per rail (each asserts exactly one Guest chat for the
--        brand and that the person is a member)
--   R-*  removal rules (refunds, RSVP changes, ended events, account deletion)
--   L-*  sticky leave / rejoin, host removal / restore, the 4 status values
--   A-*  adversarial (RLS, RPC-only writes, roster privacy, caps, blocks,
--        group RPCs, Brand group untouched, a failing sync never fails a booking)
--   B-*  backfill: second run is a zero diff, mute and pin carried over,
--        per-listing chats retired
--
-- Fails on revert: deleting the helper call in add_buyer_to_event_chat fails
-- H-EXPERIENCE / H-TRIP / H-EVENT; dropping the event_rsvps trigger fails
-- H-RSVP-*; dropping messages_brand_guests_rpc_only fails A-DIRECT-MESSAGE.

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

-- ═══ Fixtures ═══════════════════════════════════════════════════════════════
SELECT pg_temp.brand('b1');
SELECT pg_temp.brand('b2');
SELECT pg_temp.listing('ev', 'b1', 'event');
SELECT pg_temp.listing('ev2', 'b1', 'event');
SELECT pg_temp.listing('trip', 'b1', 'trip');
SELECT pg_temp.listing('exp', 'b1', 'experience');
SELECT pg_temp.listing('rsvp', 'b1', 'rsvp');
SELECT pg_temp.listing('rsvp2', 'b1', 'rsvp');
SELECT pg_temp.listing('b2ev', 'b2', 'event');
SELECT pg_temp.person(t) FROM unnest(ARRAY[
  'ana','ben','cy','dee','eli','fay','gus','hal','ivy','jo','kim','lou','max','ned','ola','pam','rex','sue',
  'mgr','outsider']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('b1'), pg_temp.u('mgr'), 'event_manager', now(), now());

DO $fx$
BEGIN
  PERFORM pg_temp.ok('F-CHAT-PER-BRAND every new brand has exactly one Guest chat',
    pg_temp.chats('b1') = 1 AND pg_temp.chats('b2') = 1);
  PERFORM pg_temp.ok('F-TEAM-MIRROR the owner and an accepted team member are in the chat',
    pg_temp.member('b1', 'b1_owner') AND pg_temp.member('b1', 'mgr'));
  PERFORM pg_temp.ok('F-NAME the chat is named after the brand, created by nobody',
    (SELECT c.name = 'Brand b1' AND c.created_by IS NULL AND c.type = 'group' AND c.is_enabled
       FROM public.conversations c WHERE c.id = pg_temp.chat('b1')));
  PERFORM pg_temp.ok('F-NO-PER-LISTING a new listing no longer creates its own chat',
    NOT EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.event_id IN (pg_temp.u('ev'), pg_temp.u('trip'))));
  PERFORM pg_temp.ok('F-SEPARATE the Guest chat is not the team Brand group',
    (SELECT count(*) FROM public.conversations c WHERE c.brand_id = pg_temp.u('b1')
       AND c.linked_entity_type = 'brand') = 1
    AND (SELECT c.id FROM public.conversations c WHERE c.brand_id = pg_temp.u('b1')
       AND c.linked_entity_type = 'brand') <> pg_temp.chat('b1'));
END $fx$;

-- ═══ H: one case per rail ═══════════════════════════════════════════════════
DO $h$
DECLARE v_order uuid; v_rsvp uuid; v_brand_group_before integer;
BEGIN
  SELECT count(*) INTO v_brand_group_before FROM public.conversation_participants cp
    JOIN public.conversations c ON c.id = cp.conversation_id
   WHERE c.brand_id = pg_temp.u('b1') AND c.linked_entity_type = 'brand';

  -- Paid checkout / Paystack + Stripe re-emits / door pay / comps / claims all
  -- call add_buyer_to_event_chat: an event order.
  v_order := pg_temp.paid_order('ev', 'ana');
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('ev'), pg_temp.u('ana'), v_order, NULL);
  PERFORM pg_temp.ok('H-EVENT a paid event order joins the brand Guest chat', pg_temp.in_one('b1', 'ana'));

  -- Trip order.
  v_order := pg_temp.paid_order('trip', 'ben');
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('trip'), pg_temp.u('ben'), v_order, NULL);
  PERFORM pg_temp.ok('H-TRIP a paid trip order joins the same Guest chat', pg_temp.in_one('b1', 'ben'));

  -- Experience order (the original bug: no chat at all).
  v_order := pg_temp.paid_order('exp', 'cy');
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('exp'), pg_temp.u('cy'), v_order, NULL);
  PERFORM pg_temp.ok('H-EXPERIENCE a paid experience order joins the Guest chat', pg_temp.in_one('b1', 'cy'));

  -- Door sale (cash at the door).
  v_order := pg_temp.paid_order('ev', 'dee', 'paid', 'door_sale');
  PERFORM pg_temp.ok('H-DOOR a door sale joins the Guest chat (orders trigger)', pg_temp.in_one('b1', 'dee'));

  -- RSVP submit, auto-approved (the original bug).
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp'), pg_temp.u('eli'), 'Eli', 'going', 'approved');
  PERFORM pg_temp.ok('H-RSVP-SUBMIT an approved going RSVP joins the Guest chat', pg_temp.in_one('b1', 'eli'));

  -- RSVP pending, then approved.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp'), pg_temp.u('fay'), 'Fay', 'going', 'pending') RETURNING id INTO v_rsvp;
  PERFORM pg_temp.ok('H-RSVP-PENDING a pending RSVP is not in the chat yet', NOT pg_temp.member('b1', 'fay'));
  UPDATE public.event_rsvps SET approval_status = 'approved' WHERE id = v_rsvp;
  PERFORM pg_temp.ok('H-RSVP-APPROVED approval adds them', pg_temp.in_one('b1', 'fay'));

  -- Waitlist promotion.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status, waitlisted_at)
    VALUES (pg_temp.u('rsvp2'), pg_temp.u('gus'), 'Gus', 'waitlisted', 'approved', now()) RETURNING id INTO v_rsvp;
  PERFORM pg_temp.ok('H-WAITLIST a waitlisted guest is not in the chat', NOT pg_temp.member('b1', 'gus'));
  UPDATE public.event_rsvps SET rsvp_status = 'going', promoted_at = now() WHERE id = v_rsvp;
  PERFORM pg_temp.ok('H-WAITLIST-PROMOTED promotion adds them', pg_temp.in_one('b1', 'gus'));

  -- Anonymous RSVP, then the claim binds the account.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp'), NULL, 'Hal', 'hal@example.test', '+15550001111', 'going', 'approved') RETURNING id INTO v_rsvp;
  UPDATE public.event_rsvps SET user_id = pg_temp.u('hal') WHERE id = v_rsvp;
  PERFORM pg_temp.ok('H-RSVP-CLAIM an anonymous RSVP joins on claim', pg_temp.in_one('b1', 'hal'));

  -- Matched plus-one.
  INSERT INTO public.event_rsvp_guests(rsvp_id, name, email, phone, matched_user_id)
    VALUES (v_rsvp, 'Ivy', 'ivy@example.test', '+15550000001', pg_temp.u('ivy'));
  PERFORM pg_temp.ok('H-PLUS-ONE a matched plus-one joins', pg_temp.in_one('b1', 'ivy'));

  -- Anonymous order, then claim_attendance_internal_v2 binds buyer_user_id.
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status, payment_method, total_cents, source)
    VALUES (gen_random_uuid(), pg_temp.u('ev'), NULL, 'jo@example.test', (SELECT phone_e164 FROM public.verified_phone_identities WHERE user_id = pg_temp.u('jo')), 'paid', 'free', 0, 'online_checkout')
    RETURNING id INTO v_order;
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('ev'), NULL, v_order, 'jo@example.test');
  PERFORM pg_temp.ok('H-ANON-ORDER a buyer without an account gets a pending claim, no chat row',
    EXISTS (SELECT 1 FROM public.pending_trip_chat_claims WHERE order_id = v_order AND claimed_at IS NULL));
  UPDATE public.orders SET buyer_user_id = pg_temp.u('jo') WHERE id = v_order;
  PERFORM pg_temp.ok('H-ORDER-CLAIM binding the order to the account joins the chat', pg_temp.in_one('b1', 'jo'));

  -- pending_trip_chat_claims rail (email claim, order stays unbound).
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status, payment_method, total_cents, source)
    VALUES (gen_random_uuid(), pg_temp.u('exp'), NULL, 'kim@example.test', '+15559999999', 'paid', 'free', 0, 'online_checkout')
    RETURNING id INTO v_order;
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('exp'), NULL, v_order, 'kim@example.test');
  UPDATE public.pending_trip_chat_claims SET claimed_at = now(), claimed_by_user_id = pg_temp.u('kim')
   WHERE order_id = v_order;
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('exp'), pg_temp.u('kim'), NULL, NULL);
  PERFORM pg_temp.ok('H-CHAT-CLAIM an email-claimed experience booking joins', pg_temp.in_one('b1', 'kim'));

  -- Retained-order reconnect / verified identity / comp rails reach the same helper.
  PERFORM pg_temp.ok('H-RAILS every booking rail still calls add_buyer_to_event_chat',
    (SELECT bool_and(p.prosrc LIKE '%add_buyer_to_event_chat%') FROM pg_proc p
      WHERE p.oid IN ('public.issue_1930_ticket_checkout_finalize_base(uuid,text,text,text,text,text,text,boolean)'::regprocedure,
                      'public.issue_3827_comp_issue_one(uuid,uuid,uuid,uuid,text,text,text,integer,text,text,uuid,uuid,text,uuid,text,text,jsonb)'::regprocedure,
                      'public.claim_attendance_by_verified_identity(uuid)'::regprocedure,
                      'public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure,
                      'public.issue_4202_reconnect_retained_orders(uuid)'::regprocedure)));
  PERFORM pg_temp.ok('H-CLAIM-SHAPE the claim rails report the brand Guest chat id',
    (SELECT bool_and(p.prosrc LIKE '%linked_entity_type = ''brand_guests''%'
                     AND p.prosrc NOT LIKE '%linked_entity_type IN (''trip'', ''event'')%') FROM pg_proc p
      WHERE p.oid IN ('public.claim_attendance_by_verified_identity(uuid)'::regprocedure,
                      'public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure)));

  PERFORM pg_temp.ok('A-BRAND-GROUP no guest rail touched the team Brand group roster',
    (SELECT count(*) FROM public.conversation_participants cp
       JOIN public.conversations c ON c.id = cp.conversation_id
      WHERE c.brand_id = pg_temp.u('b1') AND c.linked_entity_type = 'brand') = v_brand_group_before);
  PERFORM pg_temp.ok('H-OTHER-BRAND a guest of b1 is not in b2''s Guest chat', NOT pg_temp.member('b2', 'ana'));
  PERFORM pg_temp.ok('H-HISTORY a new joiner sees history from their join time',
    (SELECT cp.history_visible_from IS NOT NULL FROM public.conversation_participants cp
      WHERE cp.conversation_id = pg_temp.chat('b1') AND cp.user_id = pg_temp.u('ana')));
END $h$;

-- ═══ R: removal rules ═══════════════════════════════════════════════════════
DO $r$
DECLARE v_o1 uuid; v_o2 uuid; v_rsvp uuid;
BEGIN
  -- Full refund, no other booking: removed.
  v_o1 := pg_temp.paid_order('ev', 'lou');
  PERFORM pg_temp.ok('R-SETUP lou joined', pg_temp.member('b1', 'lou'));
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_o1;
  PERFORM pg_temp.ok('R-REFUND a full refund with no other booking removes the guest', NOT pg_temp.member('b1', 'lou'));

  -- Full refund while holding another booking: stays.
  v_o1 := pg_temp.paid_order('ev', 'max');
  v_o2 := pg_temp.paid_order('ev2', 'max');
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_o1;
  PERFORM pg_temp.ok('R-REFUND-OTHER a refund with another booking keeps the guest', pg_temp.member('b1', 'max'));

  -- Partial refund: stays.
  v_o1 := pg_temp.paid_order('ev', 'ned');
  UPDATE public.orders SET payment_status = 'partial_refund' WHERE id = v_o1;
  PERFORM pg_temp.ok('R-PARTIAL a partial refund keeps the guest', pg_temp.member('b1', 'ned'));

  -- Cancelled order: removed.
  v_o1 := pg_temp.paid_order('trip', 'ola');
  UPDATE public.orders SET payment_status = 'cancelled' WHERE id = v_o1;
  PERFORM pg_temp.ok('R-CANCEL a cancelled order removes the guest', NOT pg_temp.member('b1', 'ola'));

  -- RSVP "not going": removed.
  SELECT r.id INTO v_rsvp FROM public.event_rsvps r WHERE r.user_id = pg_temp.u('eli');
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_rsvp;
  PERFORM pg_temp.ok('R-NOT-GOING an RSVP set to not going removes the guest', NOT pg_temp.member('b1', 'eli'));
  UPDATE public.event_rsvps SET rsvp_status = 'going' WHERE id = v_rsvp;
  PERFORM pg_temp.ok('R-GOING-AGAIN going again adds them back', pg_temp.member('b1', 'eli'));
  DELETE FROM public.event_rsvps WHERE id = v_rsvp;
  PERFORM pg_temp.ok('R-RSVP-DELETED a deleted RSVP removes the guest', NOT pg_temp.member('b1', 'eli'));

  -- Ended event: stays.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (pg_temp.u('ev2'), now() - interval '3 days', now() - interval '2 days', 'UTC', true);
  PERFORM public.issue_4459_sync_brand_guest(pg_temp.u('b1'), pg_temp.u('max'));
  PERFORM pg_temp.ok('R-ENDED past attendance keeps the guest', pg_temp.member('b1', 'max'));

  -- Team member removed from the team: leaves unless they hold a booking.
  UPDATE public.brand_team_members SET removed_at = now()
   WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('mgr');
  PERFORM pg_temp.ok('R-TEAM-REMOVED a removed team member without a booking leaves', NOT pg_temp.member('b1', 'mgr'));
  UPDATE public.brand_team_members SET removed_at = NULL
   WHERE brand_id = pg_temp.u('b1') AND user_id = pg_temp.u('mgr');
  PERFORM pg_temp.ok('R-TEAM-BACK rejoining the team adds them back', pg_temp.member('b1', 'mgr'));

  -- Brand rename / soft delete.
  UPDATE public.brands SET name = 'Brand b1 renamed' WHERE id = pg_temp.u('b1');
  PERFORM pg_temp.ok('R-RENAME renaming the brand renames the chat',
    (SELECT name FROM public.conversations WHERE id = pg_temp.chat('b1')) = 'Brand b1 renamed');
END $r$;

-- ═══ L: leave, rejoin, removal, restore, status ═════════════════════════════
DO $l$
DECLARE v jsonb; v_order uuid;
BEGIN
  v := pg_temp.rpc_as('pam', format('SELECT public.issue_4459_my_brand_guest_status(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-STATUS-NOT-ELIGIBLE no booking reads not_eligible', v->>'status' = 'not_eligible');

  v_order := pg_temp.paid_order('ev', 'pam');
  v := pg_temp.rpc_as('pam', format('SELECT public.issue_4459_my_brand_guest_status(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-STATUS-MEMBER a guest reads member and the chat id',
    v->>'status' = 'member' AND (v->>'conversationId')::uuid = pg_temp.chat('b1'));

  v := pg_temp.rpc_as('pam', format('SELECT public.issue_4459_leave_brand_guest_chat(%L)', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('L-LEAVE leave removes the guest', v->>'status' = 'left' AND NOT pg_temp.member('b1', 'pam'));
  v := pg_temp.rpc_as('pam', format('SELECT public.issue_4459_my_brand_guest_status(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-STATUS-LEFT status reads left and offers rejoin', v->>'status' = 'left' AND (v->>'canRejoin')::boolean);

  PERFORM pg_temp.paid_order('ev2', 'pam');
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('ev2'), pg_temp.u('pam'), NULL, NULL);
  PERFORM pg_temp.ok('L-STICKY a new booking does not re-add a guest who left', NOT pg_temp.member('b1', 'pam'));

  v := pg_temp.rpc_as('pam', format('SELECT public.issue_4459_rejoin_brand_guest_chat(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-REJOIN rejoin from a booking works while eligible',
    v->>'status' = 'member' AND pg_temp.member('b1', 'pam'));

  v := pg_temp.rpc_as('b1_owner', format('SELECT public.issue_4459_leave_brand_guest_chat(%L)', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('L-TEAM-CANNOT-LEAVE the team cannot leave', v::text LIKE '%team_member%');
  PERFORM pg_temp.ok('L-LEAVE-GROUP leave_group_conversation keeps refusing a Guest chat',
    pg_temp.try_as('ana', format('SELECT public.leave_group_conversation(%L)', pg_temp.chat('b1'))) LIKE '42501%');

  -- Host removal.
  v := pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('ben')));
  PERFORM pg_temp.ok('L-REMOVE the team removes a guest', v->>'status' = 'removed' AND NOT pg_temp.member('b1', 'ben'));
  PERFORM pg_temp.ok('L-REMOVE-NO-NOTICE removal posts no chat message',
    NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = pg_temp.chat('b1')));
  v := pg_temp.rpc_as('ben', format('SELECT public.issue_4459_my_brand_guest_status(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-STATUS-REMOVED status reads removed, no rejoin', v->>'status' = 'removed' AND NOT (v->>'canRejoin')::boolean);
  PERFORM pg_temp.ok('L-REMOVED-LISTED the removed chat is listed for its guest',
    pg_temp.count_as('ben', 'SELECT count(*) FROM public.issue_4459_my_removed_brand_guest_chats()') = 1);
  PERFORM pg_temp.paid_order('ev2', 'ben');
  PERFORM pg_temp.ok('L-REMOVE-STICKY a new booking does not re-add a removed guest', NOT pg_temp.member('b1', 'ben'));
  v := pg_temp.rpc_as('ben', format('SELECT public.issue_4459_rejoin_brand_guest_chat(%L)', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-REJOIN-REFUSED a removed guest cannot rejoin', v::text LIKE '%removed%' AND NOT pg_temp.member('b1', 'ben'));
  PERFORM pg_temp.rpc_as('ben', format('SELECT to_jsonb(public.issue_4459_dismiss_removed_brand_guest_chat(%L))', pg_temp.u('b1')));
  PERFORM pg_temp.ok('L-DISMISS Remove from chat list hides the removed row',
    pg_temp.count_as('ben', 'SELECT count(*) FROM public.issue_4459_my_removed_brand_guest_chats()') = 0);
  v := pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_restore_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('ben')));
  PERFORM pg_temp.ok('L-RESTORE restore lifts the removal', v->>'status' = 'member' AND pg_temp.member('b1', 'ben'));
  v := pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('b1_owner')));
  PERFORM pg_temp.ok('L-REMOVE-TEAM the team cannot remove a team member', v::text LIKE '%22023%');
END $l$;

-- ═══ A: adversarial ═════════════════════════════════════════════════════════
DO $a$
DECLARE v jsonb; v_r text; v_msg uuid; v_i integer; v_err text;
BEGIN
  -- Client writes on membership and messages.
  v_r := pg_temp.try_as('outsider', format(
    'INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (%L, %L)',
    pg_temp.chat('b1'), pg_temp.u('outsider')));
  PERFORM pg_temp.ok('A-SELF-ADD a client cannot add itself to a Guest chat', v_r LIKE '42501%' AND NOT pg_temp.member('b1', 'outsider'));
  PERFORM pg_temp.try_as('ana', format(
    'DELETE FROM public.conversation_participants WHERE conversation_id = %L AND user_id = %L',
    pg_temp.chat('b1'), pg_temp.u('ana')));
  PERFORM pg_temp.ok('A-SELF-DELETE a client cannot delete its own Guest chat row', pg_temp.member('b1', 'ana'));
  PERFORM pg_temp.try_as('mgr', format(
    'DELETE FROM public.conversation_participants WHERE conversation_id = %L AND user_id = %L',
    pg_temp.chat('b1'), pg_temp.u('ana')));
  PERFORM pg_temp.ok('A-TEAM-DIRECT-DELETE even the team cannot delete rows directly', pg_temp.member('b1', 'ana'));
  v_r := pg_temp.try_as('ana', format(
    'INSERT INTO public.messages(conversation_id, sender_id, content) VALUES (%L, %L, %L)',
    pg_temp.chat('b1'), pg_temp.u('ana'), 'direct'));
  PERFORM pg_temp.ok('A-DIRECT-MESSAGE a direct message insert is refused (RPC-only)', v_r LIKE '42501%');
  v_r := pg_temp.try_as('b1_owner', format(
    'UPDATE public.conversations SET is_broadcast_only = true, name = %L WHERE id = %L', 'Hacked', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('A-DIRECT-CONV-UPDATE a client cannot update the chat row directly',
    (SELECT NOT is_broadcast_only AND name <> 'Hacked' FROM public.conversations WHERE id = pg_temp.chat('b1')));
  -- Moving one of my other memberships into the Guest chat.
  INSERT INTO public.conversations(id, type, linked_entity_type) VALUES (gen_random_uuid(), 'direct', 'direct')
    RETURNING id INTO v_msg;
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_msg, pg_temp.u('outsider'));
  v_r := pg_temp.try_as('outsider', format(
    'UPDATE public.conversation_participants SET conversation_id = %L WHERE conversation_id = %L AND user_id = %L',
    pg_temp.chat('b1'), v_msg, pg_temp.u('outsider')));
  PERFORM pg_temp.ok('A-ROW-MOVE a membership row cannot be moved into a Guest chat',
    v_r LIKE '42501%' AND NOT pg_temp.member('b1', 'outsider'));
  v_r := pg_temp.try_as('outsider', format(
    'INSERT INTO public.conversations(type, linked_entity_type, brand_id, name, created_by) VALUES (%L, %L, %L, %L, %L)',
    'group', 'brand_guests', pg_temp.u('b2'), 'Fake', pg_temp.u('outsider')));
  PERFORM pg_temp.ok('A-CLIENT-CREATE a client cannot create a Guest chat', v_r NOT LIKE 'ok%');

  -- Reading: a guest sees only their own row and the team's; never another brand's chat.
  PERFORM pg_temp.ok('A-ROSTER a guest reads only their own row and the team rows',
    pg_temp.count_as('ana', format('SELECT count(*) FROM public.conversation_participants WHERE conversation_id = %L', pg_temp.chat('b1')))
    = 1 + (SELECT count(*) FROM public.brand_team_members m WHERE m.brand_id = pg_temp.u('b1')
            AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL));
  PERFORM pg_temp.ok('A-ROSTER-TEAM the team reads every row',
    pg_temp.count_as('mgr', format('SELECT count(*) FROM public.conversation_participants WHERE conversation_id = %L', pg_temp.chat('b1')))
    = (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('b1')));
  PERFORM pg_temp.ok('A-OTHER-BRAND a guest cannot read another brand''s Guest chat',
    pg_temp.count_as('ana', format('SELECT count(*) FROM public.conversations WHERE id = %L', pg_temp.chat('b2'))) = 0);
  v := pg_temp.rpc_as('ana', format('SELECT public.issue_4459_list_brand_guest_members(%L)', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('A-MEMBER-SHEET a guest''s member sheet shows team + self, total counts everyone',
    (v->>'total')::int = (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('b1'))
    AND jsonb_array_length(v->'members') < (v->>'total')::int
    AND NOT (v->>'isTeam')::boolean);
  UPDATE public.orders SET show_me_as_going = true WHERE buyer_user_id = pg_temp.u('ben');
  v := pg_temp.rpc_as('ana', format('SELECT public.issue_4459_list_brand_guest_members(%L)', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('A-MEMBER-SHEET-GOING a guest who chose show me as going is listed',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v->'members') m WHERE (m->>'userId')::uuid = pg_temp.u('ben')));
  v := pg_temp.rpc_as('outsider', format('SELECT public.issue_4459_list_brand_guest_members(%L)', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('A-MEMBER-SHEET-OUTSIDER a non-member cannot read the member sheet', v::text LIKE '%42501%');

  -- Moderation is team only.
  PERFORM pg_temp.ok('A-GUEST-REMOVE a guest cannot remove another guest',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('cy')))::text LIKE '%42501%'
    AND pg_temp.member('b1', 'cy'));
  PERFORM pg_temp.ok('A-GUEST-RESTORE a guest cannot restore',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_restore_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('cy')))::text LIKE '%42501%');
  PERFORM pg_temp.ok('A-GUEST-BROADCAST a guest cannot switch on announcements only',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_set_brand_guest_announcements_only(%L, true)', pg_temp.chat('b1')))::text LIKE '%42501%');

  -- Sends.
  v := pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'Hello all'));
  PERFORM pg_temp.ok('A-SEND-GUEST a guest posts as themselves',
    v->>'sender_kind' = 'guest' AND (v->>'sender_id')::uuid = pg_temp.u('ana'));
  v_msg := (v->>'id')::uuid;
  v := pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, %L)', pg_temp.chat('b1'), 'Welcome', v_msg));
  PERFORM pg_temp.ok('A-SEND-BRAND a team member posts as the brand',
    v->>'sender_kind' = 'brand' AND v->>'sender_display_name_snapshot' = 'Brand b1 renamed' AND (v->>'reply_to_id')::uuid = v_msg);
  PERFORM pg_temp.ok('A-GUEST-UNSEND a guest cannot remove another''s message',
    pg_temp.rpc_as('cy', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v_msg))::text LIKE '%42501%');
  v := pg_temp.rpc_as('mgr', format('SELECT public.unsend_messages(ARRAY[%L]::uuid[])', v_msg));
  PERFORM pg_temp.ok('A-HOST-UNSEND the team removes a guest message (kind host)',
    v->>'kind' = 'host' AND (SELECT unsent_kind = 'host' FROM public.messages WHERE id = v_msg));
  PERFORM pg_temp.ok('A-EMPTY an empty message is refused',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), '   '))::text LIKE '%22023%');
  PERFORM pg_temp.ok('A-TOO-LONG a message over 4000 characters is refused',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), repeat('x', 4001)))::text LIKE '%22023%');
  PERFORM pg_temp.ok('A-OUTSIDER-SEND a non-member cannot post',
    pg_temp.rpc_as('outsider', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'hi'))::text LIKE '%42501%');
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('pam')));
  PERFORM pg_temp.ok('A-REMOVED-SEND-REFUSED a guest removed by the host cannot post',
    pg_temp.rpc_as('pam', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'hi'))::text LIKE '%42501%');

  -- Mentions keep members only.
  v := pg_temp.rpc_as('cy', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, NULL, NULL, %L::jsonb)',
    pg_temp.chat('b1'), '@ana @outsider', jsonb_build_array(
      jsonb_build_object('userId', pg_temp.u('ana'), 'displayName', 'Ana', 'startOffset', 0, 'endOffset', 4),
      jsonb_build_object('userId', pg_temp.u('outsider'), 'displayName', 'O', 'startOffset', 5, 'endOffset', 14),
      jsonb_build_object('userId', 'not-a-uuid'))));
  PERFORM pg_temp.ok('A-MENTIONS only current members are kept as mentions',
    jsonb_array_length(v->'mentions') = 1 AND (v->'mentions'->0->>'userId')::uuid = pg_temp.u('ana'));

  -- Announcements only.
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_set_brand_guest_announcements_only(%L, true)', pg_temp.chat('b1')));
  PERFORM pg_temp.ok('A-ANNOUNCEMENTS a guest cannot post while announcements only',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'hi'))::text LIKE '%announcements_only%');
  PERFORM pg_temp.ok('A-ANNOUNCEMENTS-TEAM the team still posts',
    pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'News'))->>'sender_kind' = 'brand');
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_set_brand_guest_announcements_only(%L, false)', pg_temp.chat('b1')));

  -- A block between two guests never silences either.
  INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.u('ana'), pg_temp.u('cy'));
  PERFORM pg_temp.ok('A-BLOCK-BLOCKER the blocker still posts',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'still here'))->>'sender_kind' = 'guest');
  PERFORM pg_temp.ok('A-BLOCK-BLOCKED the blocked guest still posts',
    pg_temp.rpc_as('cy', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'me too'))->>'sender_kind' = 'guest');
  v := pg_temp.rpc_as('cy', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L, NULL, NULL, %L::jsonb)',
    pg_temp.chat('b1'), '@ana', jsonb_build_array(jsonb_build_object('userId', pg_temp.u('ana'), 'displayName', 'Ana', 'startOffset', 0, 'endOffset', 4))));
  PERFORM pg_temp.ok('A-BLOCK-MENTION a mention across a block is dropped', jsonb_array_length(v->'mentions') = 0);

  -- Rate limit: 20 per 10 minutes for a guest.
  FOR v_i IN 1..20 LOOP
    v := pg_temp.rpc_as('dee', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'm' || v_i));
  END LOOP;
  PERFORM pg_temp.ok('A-RATE-LIMIT the 21st guest message in 10 minutes is refused (PT409)',
    pg_temp.rpc_as('dee', format('SELECT public.issue_4459_send_brand_guest_message(%L, %L)', pg_temp.chat('b1'), 'm21'))::text LIKE '%PT409%rate_limited%');

  -- Group RPCs refuse a Guest chat.
  PERFORM pg_temp.ok('A-ADD-MEMBERS add_group_members refuses a Guest chat',
    pg_temp.try_as('ana', format('SELECT public.add_group_members(%L, ARRAY[%L]::uuid[])', pg_temp.chat('b1'), pg_temp.u('outsider'))) LIKE '42501%');
  INSERT INTO public.group_invite_links(conversation_id, token, created_by)
    VALUES (pg_temp.chat('b1'), md5('i4459-link'), pg_temp.u('b1_owner'));
  PERFORM pg_temp.ok('A-JOIN-LINK join_group_by_link refuses a Guest chat',
    pg_temp.try_as('outsider', format('SELECT public.join_group_by_link(%L)', md5('i4459-link'))) LIKE '42501%'
    AND NOT pg_temp.member('b1', 'outsider'));

  -- One per brand.
  BEGIN
    INSERT INTO public.conversations(type, linked_entity_type, brand_id, name)
      VALUES ('group', 'brand_guests', pg_temp.u('b1'), 'Second');
    v_err := 'inserted';
  EXCEPTION WHEN unique_violation THEN v_err := 'unique';
  END;
  PERFORM pg_temp.ok('A-ONE-PER-BRAND a second Guest chat for a brand conflicts', v_err = 'unique');
END $a$;

-- 50 guests, no cap.
DO $cap$
DECLARE v_i integer; v_u uuid;
BEGIN
  FOR v_i IN 1..50 LOOP
    v_u := pg_temp.person('cap' || v_i);
    PERFORM pg_temp.paid_order('b2ev', 'cap' || v_i);
  END LOOP;
  PERFORM pg_temp.ok('A-NO-CAP 50 guests join one Guest chat with no cap error',
    (SELECT count(*) FROM public.conversation_participants cp
      WHERE cp.conversation_id = pg_temp.chat('b2')
        AND cp.user_id IN (SELECT id FROM k WHERE tag LIKE 'cap%')) = 50);
END $cap$;

-- A failing sync never fails the booking.
DO $safe$
DECLARE v_def text; v_order uuid;
BEGIN
  v_def := pg_get_functiondef('public.issue_4459_sync_brand_guest(uuid,uuid)'::regprocedure);
  EXECUTE $x$CREATE OR REPLACE FUNCTION public.issue_4459_sync_brand_guest(p_brand_id uuid, p_user_id uuid)
    RETURNS text LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION 'boom' USING ERRCODE = 'XX000'; END $b$$x$;
  v_order := pg_temp.paid_order('ev', 'rex');
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('ev'), pg_temp.u('rex'), v_order, NULL);
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp'), pg_temp.u('rex'), 'Rex', 'going', 'approved');
  PERFORM pg_temp.ok('A-SAFE a sync error never rolls back the booking write',
    EXISTS (SELECT 1 FROM public.orders WHERE id = v_order)
    AND EXISTS (SELECT 1 FROM public.event_rsvps WHERE user_id = pg_temp.u('rex')));
  EXECUTE v_def;
  PERFORM public.issue_4459_sync_brand_guest(pg_temp.u('b1'), pg_temp.u('rex'));
  PERFORM pg_temp.ok('A-SAFE-RECOVER the next sync puts them in', pg_temp.member('b1', 'rex'));
END $safe$;

-- Account deletion cascades the membership and the exclusion.
DO $del$
BEGIN
  PERFORM pg_temp.rpc_as('mgr', format('SELECT public.issue_4459_remove_brand_guest(%L, %L)', pg_temp.chat('b1'), pg_temp.u('ned')));
  DELETE FROM auth.users WHERE id = pg_temp.u('ned');
  PERFORM pg_temp.ok('R-ACCOUNT-DELETE deleting the account removes membership and exclusion',
    NOT pg_temp.member('b1', 'ned')
    AND NOT EXISTS (SELECT 1 FROM public.brand_guest_chat_exclusions WHERE user_id = pg_temp.u('ned')));
END $del$;

-- ═══ B: backfill ════════════════════════════════════════════════════════════
DO $b$
DECLARE v_legacy uuid; v_before text; v_after text; v jsonb;
BEGIN
  -- A legacy per-listing chat (as on production), with sue muted and pinned there.
  PERFORM pg_temp.paid_order('ev2', 'sue');
  INSERT INTO public.conversations(type, linked_entity_type, event_id, name, is_enabled)
    VALUES ('group', 'event', pg_temp.u('ev2'), 'Legacy listing chat', true) RETURNING id INTO v_legacy;
  INSERT INTO public.conversation_participants(conversation_id, user_id, notifications_muted)
    VALUES (v_legacy, pg_temp.u('sue'), true);
  INSERT INTO public.conversation_participant_lifecycle(conversation_id, user_id, pinned_at)
    VALUES (v_legacy, pg_temp.u('sue'), now() - interval '1 day');
  -- A guest whose chat row was lost (backfill must add them).
  DELETE FROM public.conversation_participants WHERE conversation_id = pg_temp.chat('b1') AND user_id = pg_temp.u('sue');
  -- A brand with no Guest chat yet.
  ALTER TABLE public.brands DISABLE TRIGGER issue_4459_brand_guest_chat_brand;
  ALTER TABLE public.brand_team_members DISABLE TRIGGER issue_4459_brand_guest_chat_team;
  PERFORM pg_temp.brand('b3');
  ALTER TABLE public.brands ENABLE TRIGGER issue_4459_brand_guest_chat_brand;
  ALTER TABLE public.brand_team_members ENABLE TRIGGER issue_4459_brand_guest_chat_team;
  PERFORM pg_temp.ok('B-SETUP b3 has no Guest chat yet', pg_temp.chats('b3') = 0);

  v := public.issue_4459_backfill_brand_guest_chats();
  PERFORM pg_temp.ok('B-CREATE the backfill creates a Guest chat for every brand', pg_temp.chats('b3') = 1
    AND pg_temp.member('b3', 'b3_owner'));
  PERFORM pg_temp.ok('B-GUESTS the backfill adds the eligible guest', pg_temp.member('b1', 'sue'));
  PERFORM pg_temp.ok('B-HISTORY backfilled guests see the whole history',
    (SELECT history_visible_from IS NULL FROM public.conversation_participants
      WHERE conversation_id = pg_temp.chat('b1') AND user_id = pg_temp.u('sue')));
  PERFORM pg_temp.ok('B-MUTE mute is carried over from the per-listing chat',
    (SELECT notifications_muted FROM public.conversation_participants
      WHERE conversation_id = pg_temp.chat('b1') AND user_id = pg_temp.u('sue')));
  PERFORM pg_temp.ok('B-PIN the pin moves to the Guest chat',
    (SELECT pinned_at IS NOT NULL FROM public.conversation_participant_lifecycle
      WHERE conversation_id = pg_temp.chat('b1') AND user_id = pg_temp.u('sue'))
    AND (SELECT pinned_at IS NULL FROM public.conversation_participant_lifecycle
      WHERE conversation_id = v_legacy AND user_id = pg_temp.u('sue')));
  PERFORM pg_temp.ok('B-RETIRE the per-listing chat is disabled, not deleted',
    (SELECT NOT is_enabled FROM public.conversations WHERE id = v_legacy));
  PERFORM pg_temp.ok('B-NO-PUSH the backfill writes no notification rows',
    NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = pg_temp.u('sue')));

  SELECT string_agg(cp.conversation_id || ':' || cp.user_id || ':' || cp.notifications_muted || ':' ||
                    COALESCE(cp.history_visible_from::text, '-') || ':' || COALESCE(l.pinned_at::text, '-'),
                    ',' ORDER BY cp.conversation_id, cp.user_id)
    INTO v_before
    FROM public.conversation_participants cp
    LEFT JOIN public.conversation_participant_lifecycle l USING (conversation_id, user_id);
  v := public.issue_4459_backfill_brand_guest_chats();
  SELECT string_agg(cp.conversation_id || ':' || cp.user_id || ':' || cp.notifications_muted || ':' ||
                    COALESCE(cp.history_visible_from::text, '-') || ':' || COALESCE(l.pinned_at::text, '-'),
                    ',' ORDER BY cp.conversation_id, cp.user_id)
    INTO v_after
    FROM public.conversation_participants cp
    LEFT JOIN public.conversation_participant_lifecycle l USING (conversation_id, user_id);
  PERFORM pg_temp.ok('B-IDEMPOTENT a second backfill run is a zero diff',
    v_before = v_after AND (v->>'guestsAdded')::int = 0 AND (v->>'perListingRetired')::int = 0);
END $b$;

-- The Chats list access lists a member's Guest chat (and not a removed one's).
DO $list$
BEGIN
  PERFORM pg_temp.ok('A-LIST-ACCESS a guest''s Chats list includes the Guest chat',
    pg_temp.count_as('ana', format('SELECT count(*) FROM public.list_connection_conversation_access() WHERE conversation_id = %L', pg_temp.chat('b1'))) = 1);
  PERFORM pg_temp.ok('A-LIST-ACCESS-REMOVED a removed guest''s Chats list does not',
    pg_temp.count_as('pam', format('SELECT count(*) FROM public.list_connection_conversation_access() WHERE conversation_id = %L', pg_temp.chat('b1'))) = 0);
  PERFORM pg_temp.ok('A-HOST-LIST the team lists the Guest chats it runs',
    pg_temp.count_as('mgr', 'SELECT count(*) FROM public.issue_4459_list_my_brand_guest_chats()') = 1
    AND pg_temp.count_as('ana', 'SELECT count(*) FROM public.issue_4459_list_my_brand_guest_chats()') = 0);
END $list$;

ROLLBACK;
