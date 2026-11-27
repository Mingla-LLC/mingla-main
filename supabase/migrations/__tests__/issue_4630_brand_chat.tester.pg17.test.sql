-- INVARIANT issue-4630-brand-chat-activity-own-rows-only: issue_4630_my_brand_chat_activity and issue_4630_my_brand_chat_summary answer only about auth.uid()'s own bookings in brand Guest chats it is a non-team member of (plus the brand's public upcoming offerings); a team member, a non-member and anon get nothing; they write nothing.
\set ON_ERROR_STOP on

-- #4630 tester adversarial suite (20281206024630). A different angle from the
-- implementor suite: bookings that must NOT count (refunded, pending, deleted
-- event, another brand), chats that must NOT answer (disabled, not a brand
-- chat, a removed guest, a NULL id), messages that must NOT move the row
-- (deleted, system) next to one that must (another guest's, Q2), an order on a
-- past occurrence of a multi-date event, and a cancelled RSVP event.
-- Everything rolls back.
--
-- Reviewed and kept by the implementor in the #4630 rework 1 (fixtures are now
-- live listings; T-CANCELLED is a gate).
--
-- Fails on revert: drop `o.payment_status IN ('paid','partial_refund')` from
-- the activity orders source and T-REFUND fails; drop `e.brand_id = c.brand_id`
-- and T-OTHER-BRAND fails; drop `c.is_enabled IS TRUE` and T-DISABLED fails;
-- drop `m.deleted_at IS NULL` and T-DELETED-MSG fails; use the event's next date
-- before the order's own date and T-OCCURRENCE fails.

BEGIN;
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
-- A jsonb result as p_tag (or the SQLSTATE and message as a json string).
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
    PERFORM set_config('role', 'postgres', true);
    RETURN to_jsonb(v_state || ' ' || v_msg);
  END;
END $f$;
-- My activity rows as p_tag, keyed by nothing (one brand in this suite).
CREATE FUNCTION pg_temp.activity(p_tag text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.rpc_as(p_tag,
    'SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.conversation_id), ''[]''::jsonb) FROM public.issue_4630_my_brand_chat_activity() a')
$f$;
CREATE FUNCTION pg_temp.summary(p_tag text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.rpc_as(p_tag, format('SELECT public.issue_4630_my_brand_chat_summary(%L)', pg_temp.u('chat')))
$f$;
CREATE FUNCTION pg_temp.ts(p jsonb) RETURNS timestamptz LANGUAGE sql AS $f$ SELECT (p #>> '{}')::timestamptz $f$;

CREATE TEMP SEQUENCE i4630_phone START 4630000;
CREATE FUNCTION pg_temp.person(p_tag text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v, 'i4630-' || p_tag || '-' || v || '@example.test');
  INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (v, '+1555' || nextval('i4630_phone'));
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
-- A listing of b1 with one date (start/end relative to now()).
CREATE FUNCTION pg_temp.listing(p_tag text, p_type text, p_start interval, p_end interval) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  -- #4630 rework 1: a live (scheduled, published) private listing; drafts
  -- and cancelled listings are never bookings in the summary.
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
                            published_at, currency, timezone, is_multi_date, is_recurring)
    VALUES (v, pg_temp.u('b1'), pg_temp.u('owner'), 'Listing ' || p_tag, 'i4630-' || p_tag || '-' || v,
            p_type, 'scheduled', 'private', now(), 'USD', 'UTC', false, false);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v, now() + p_start, now() + p_end, 'UTC', true);
  INSERT INTO k VALUES (p_tag, v);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.paid_order(p_listing text, p_buyer text, p_created timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status,
                            payment_method, total_cents, source, created_at)
    VALUES (v, pg_temp.u(p_listing), pg_temp.u(p_buyer), NULL,
            (SELECT phone_e164 FROM public.verified_phone_identities WHERE user_id = pg_temp.u(p_buyer)),
            'paid', 'free', 0, 'online_checkout', p_created);
  PERFORM public.add_buyer_to_event_chat(pg_temp.u(p_listing), pg_temp.u(p_buyer), v, NULL);
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.member(p_person text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.conversation_participants cp
                  WHERE cp.conversation_id = pg_temp.u('chat') AND cp.user_id = pg_temp.u(p_person))
$f$;

SELECT pg_temp.as_server();

-- ═══ Fixtures: brand b1 (chat), brand b2 (chat2), guests ana / zed / rex ════
DO $fx$
DECLARE v_owner uuid; v_b1 uuid := gen_random_uuid(); v_b2 uuid := gen_random_uuid();
BEGIN
  v_owner := pg_temp.person('owner');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency)
    VALUES (v_b1, v_owner, 'Tester B1', 't4630-' || v_b1, 'stripe', 'USD'),
           (v_b2, v_owner, 'Tester B2', 't4630-' || v_b2, 'stripe', 'USD');
  INSERT INTO k VALUES ('b1', v_b1), ('b2', v_b2);
  INSERT INTO k VALUES ('chat', public.issue_4459_ensure_brand_guest_chat(v_b1));
  INSERT INTO k VALUES ('chat2', public.issue_4459_ensure_brand_guest_chat(v_b2));
END $fx$;
SELECT pg_temp.person(t) FROM unnest(ARRAY['ana', 'zed', 'rex', 'mgr']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('b1'), pg_temp.u('mgr'), 'event_manager', now(), now());

-- listing(tag, type, start, end) creates a b1 listing; b2 one built by hand.
SELECT pg_temp.listing('ev', 'event', interval '3 days', interval '3 days 3 hours');
SELECT pg_temp.listing('gone', 'event', interval '4 days', interval '4 days 3 hours');
SELECT pg_temp.listing('multi', 'event', interval '-5 days', interval '-5 days' + interval '3 hours');
SELECT pg_temp.listing('cxl', 'rsvp', interval '2 days', interval '2 days 2 hours');
DO $b2$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, published_at, currency, timezone, is_multi_date, is_recurring)
    VALUES (v, pg_temp.u('b2'), pg_temp.u('owner'), 'B2 night', 't4630-b2-' || v, 'event', 'scheduled', 'private', now(), 'USD', 'UTC', false, false);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v, now() + interval '1 day', now() + interval '1 day 3 hours', 'UTC', true);
  INSERT INTO k VALUES ('b2ev', v);
  -- multi: a second, future occurrence (the order below is for the PAST one).
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (pg_temp.u('multi'), now() + interval '6 days', now() + interval '6 days 3 hours', 'UTC', false);
END $b2$;

DO $book$
DECLARE v_order uuid; v_rsvp uuid;
BEGIN
  -- ana: one real paid order on b1 (10 days ago) - the baseline.
  PERFORM pg_temp.paid_order('ev', 'ana', now() - interval '10 days');
  -- ana: a newer b1 order that was REFUNDED (must not count anywhere).
  v_order := pg_temp.paid_order('ev', 'ana', now() - interval '1 day');
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_order;
  INSERT INTO k VALUES ('refunded', v_order);
  -- ana: a newer b1 order still PENDING (never paid).
  v_order := pg_temp.paid_order('ev', 'ana', now() - interval '2 days');
  UPDATE public.orders SET payment_status = 'pending' WHERE id = v_order;
  -- ana: an even newer b2 order (another brand: must not move b1).
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status,
                            payment_method, total_cents, source, created_at)
    VALUES (gen_random_uuid(), pg_temp.u('b2ev'), pg_temp.u('ana'), NULL,
            (SELECT phone_e164 FROM public.verified_phone_identities WHERE user_id = pg_temp.u('ana')),
            'paid', 'free', 0, 'online_checkout', now() - interval '6 hours') RETURNING id INTO v_order;
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('b2ev'), pg_temp.u('ana'), v_order, NULL);
  -- ana: a paid order on a listing that is later soft-deleted.
  v_order := pg_temp.paid_order('gone', 'ana', now() - interval '3 hours');
  UPDATE public.events SET deleted_at = now() WHERE id = pg_temp.u('gone');
  -- zed: a paid order for the PAST occurrence of a multi-date event.
  v_order := pg_temp.paid_order('multi', 'zed', now() - interval '8 days');
  UPDATE public.orders SET event_date_id = (SELECT id FROM public.event_dates
     WHERE event_id = pg_temp.u('multi') AND is_master) WHERE id = v_order;
  INSERT INTO k VALUES ('zed_order', v_order);
  -- rex: an approved going RSVP on an RSVP event the brand then CANCELLED.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('cxl'), pg_temp.u('rex'), 'Rex', 'going', 'approved') RETURNING id INTO v_rsvp;
  UPDATE public.issue_4459_rsvp_server_approvals SET approved_at = now() - interval '7 days' WHERE rsvp_id = v_rsvp;
  UPDATE public.events SET status = 'cancelled' WHERE id = pg_temp.u('cxl');
END $book$;

DO $fx_check$
BEGIN
  PERFORM pg_temp.ok('TF-MEMBERS ana, zed, rex and the team member are in the b1 chat',
    pg_temp.member('ana') AND pg_temp.member('zed') AND pg_temp.member('rex') AND pg_temp.member('mgr'));
END $fx_check$;

-- activity row for one conversation tag
CREATE FUNCTION pg_temp.act_for(p_tag text, p_chat text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT (SELECT e FROM jsonb_array_elements(pg_temp.activity(p_tag)) e
           WHERE e->>'conversation_id' = pg_temp.u(p_chat)::text)
$f$;

-- ═══ T: bookings that must not count ══════════════════════════════════════
DO $t$
DECLARE v jsonb; s jsonb;
BEGIN
  v := pg_temp.act_for('ana', 'chat');
  PERFORM pg_temp.ok('T-REFUND a refunded or pending newer order does not move my_last_booking_at',
    abs(extract(epoch FROM pg_temp.ts(v->'my_last_booking_at') - (now() - interval '10 days'))) < 2);
  PERFORM pg_temp.ok('T-OTHER-BRAND a newer order with another brand never moves this brand''s row',
    pg_temp.act_for('ana', 'chat2') IS NOT NULL
    AND abs(extract(epoch FROM pg_temp.ts(pg_temp.act_for('ana', 'chat2')->'my_last_booking_at') - (now() - interval '6 hours'))) < 2
    AND pg_temp.ts(v->'my_last_booking_at') < now() - interval '9 days');
  s := pg_temp.summary('ana');
  PERFORM pg_temp.ok('T-SUMMARY-CLEAN myBookings holds only the paid, live, own b1 order',
    jsonb_array_length(s->'myBookings') = 1
    AND (s->'myBookings'->0->>'eventId') = pg_temp.u('ev')::text
    AND (s->'myBookings'->0->>'id') <> pg_temp.u('refunded')::text);
  PERFORM pg_temp.ok('T-DELETED-EVENT a soft-deleted listing is neither next booking nor in myBookings',
    v->>'next_booking_title' = 'Listing ev'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s->'myBookings') b WHERE b->>'eventId' = pg_temp.u('gone')::text));
END $t$;

-- ═══ T-OCCURRENCE: an order for a past occurrence stays past ═══════════════
DO $o$
DECLARE s jsonb;
BEGIN
  s := pg_temp.summary('zed');
  PERFORM pg_temp.ok('T-OCCURRENCE an order on a past date of a multi-date event is past, not the next date',
    jsonb_array_length(s->'myBookings') = 0 AND (s->>'hasPastBookings')::boolean
    AND pg_temp.act_for('zed', 'chat')->>'next_booking_title' IS NULL);
END $o$;

-- ═══ T-CANCELLED: a cancelled event is never "Next up · Your ticket" ═══════
-- (was an OBSERVE line at 22bb7be6cf; the #4630 rework 1 made it a gate.)
DO $c$
DECLARE s jsonb;
BEGIN
  s := pg_temp.summary('rex');
  PERFORM pg_temp.ok('T-CANCELLED an RSVP on a cancelled event is neither in myBookings nor the next booking',
    jsonb_array_length(s->'myBookings') = 0
    AND pg_temp.act_for('rex', 'chat')->>'next_booking_title' IS NULL);
END $c$;

-- ═══ T: messages (Q2) ═══════════════════════════════════════════════════════
DO $m$
DECLARE v_before timestamptz; v_after timestamptz;
BEGIN
  v_before := pg_temp.ts(pg_temp.act_for('ana', 'chat')->'last_visible_message_at');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at, deleted_at)
    VALUES (pg_temp.u('chat'), pg_temp.u('zed'), 'deleted later', 'text', 'guest', now() + interval '1 minute', now());
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at)
    VALUES (pg_temp.u('chat'), NULL, 'zed joined', 'system', NULL, now() + interval '2 minutes');
  PERFORM pg_temp.ok('T-DELETED-MSG a deleted or system message does not move the row',
    pg_temp.ts(pg_temp.act_for('ana', 'chat')->'last_visible_message_at') IS NOT DISTINCT FROM v_before);
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at)
    VALUES (pg_temp.u('chat'), pg_temp.u('zed'), 'hello all', 'text', 'guest', now() + interval '3 minutes');
  v_after := pg_temp.ts(pg_temp.act_for('ana', 'chat')->'last_visible_message_at');
  PERFORM pg_temp.ok('T-Q2 another guest''s message moves my row (Q2)',
    abs(extract(epoch FROM v_after - (now() + interval '3 minutes'))) < 2);
END $m$;

-- ═══ T: chats that must not answer ═══════════════════════════════════════
DO $n$
DECLARE v_dm uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.ok('T-NULL a NULL conversation id gets {"member": false}',
    pg_temp.rpc_as('ana', 'SELECT public.issue_4630_my_brand_chat_summary(NULL)') = '{"member": false}'::jsonb);
  INSERT INTO public.conversations(id, type, created_by) VALUES (v_dm, 'direct', pg_temp.u('ana'));
  INSERT INTO public.conversation_participants(conversation_id, user_id) VALUES (v_dm, pg_temp.u('ana')), (v_dm, pg_temp.u('zed'));
  PERFORM pg_temp.ok('T-NOT-BRAND a DM I am in gets {"member": false} and no activity row',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4630_my_brand_chat_summary(%L)', v_dm)) = '{"member": false}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.activity('ana')) e WHERE e->>'conversation_id' = v_dm::text));
  PERFORM pg_temp.ok('T-CROSS ana cannot read the b2 summary through zed (not a b2 member)',
    pg_temp.rpc_as('zed', format('SELECT public.issue_4630_my_brand_chat_summary(%L)', pg_temp.u('chat2'))) = '{"member": false}'::jsonb);
  UPDATE public.conversations SET is_enabled = false WHERE id = pg_temp.u('chat2');
  PERFORM pg_temp.ok('T-DISABLED a disabled brand chat answers nothing',
    pg_temp.act_for('ana', 'chat2') IS NULL
    AND pg_temp.rpc_as('ana', format('SELECT public.issue_4630_my_brand_chat_summary(%L)', pg_temp.u('chat2'))) = '{"member": false}'::jsonb);
  UPDATE public.conversations SET is_enabled = true WHERE id = pg_temp.u('chat2');
  PERFORM pg_temp.rpc_as('mgr', format('SELECT to_jsonb(public.issue_4459_remove_brand_guest(%L, %L))', pg_temp.u('chat'), pg_temp.u('zed')));
  PERFORM pg_temp.ok('T-REMOVED a guest the brand removed gets no row and {"member": false}',
    NOT pg_temp.member('zed') AND pg_temp.act_for('zed', 'chat') IS NULL
    AND pg_temp.summary('zed') = '{"member": false}'::jsonb);
END $n$;

-- ═══ T-READONLY: the functions write nothing ═══════════════════════════════
DO $r$
BEGIN
  PERFORM pg_temp.ok('T-READONLY both functions are STABLE (cannot write) and SECURITY DEFINER owned by postgres',
    (SELECT bool_and(p.provolatile = 's' AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres') FROM pg_proc p
      WHERE p.oid IN ('public.issue_4630_my_brand_chat_activity()'::regprocedure,
                      'public.issue_4630_my_brand_chat_summary(uuid)'::regprocedure)));
END $r$;

ROLLBACK;
