-- INVARIANT issue-4630-brand-chat-activity-own-rows-only: issue_4630_my_brand_chat_activity and issue_4630_my_brand_chat_summary answer only about auth.uid()'s own bookings in brand Guest chats it is a non-team member of (plus the brand's public upcoming offerings); a team member, a non-member and anon get nothing; they write nothing.
\set ON_ERROR_STOP on

-- #4630 (20281206024630). Runs on the fully replayed PG17 schema; everything
-- rolls back.
--
-- Cases
--   A-*  activity: each of the four booking sources sets my_last_booking_at,
--        the latest one wins, another guest's booking never shows, a message
--        before my history_visible_from is ignored, the next booking is named,
--        a team member / outsider gets no rows, anon cannot run it
--   S-*  summary: member shape, ended bookings stay out of myBookings and set
--        hasPastBookings, brandUpcoming comes from pg_public_brand_upcoming,
--        a non-member and a team member get exactly {"member": false}
--   H-*  Host regression (A3): the Host RPCs return the same rows with and
--        without the #4630 functions; the migration redefines nothing
--   P-*  posture: pinned, stable definers; the private helper is server-only
--
-- Fails on revert: drop the auth.uid() filter in a source of
-- my_last_booking_at and A-OTHER fails; drop the history_visible_from bound and
-- A-HISTORY fails; drop the team exclusion and A-TEAM / S-TEAM fail; drop the
-- ended filter and S-ENDED fails.

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
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, is_recurring)
    VALUES (v, pg_temp.u('b1'), 'Listing ' || p_tag, 'i4630-' || p_tag || '-' || v,
            p_type, 'draft', 'draft', 'UTC', false, false);
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

-- ═══ Fixtures ═══════════════════════════════════════════════════════════════
DO $fx$
DECLARE v_owner uuid; v_brand uuid := gen_random_uuid();
BEGIN
  v_owner := pg_temp.person('owner');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency)
    VALUES (v_brand, v_owner, 'Brand 4630', 'i4630-' || v_brand, 'stripe', 'USD');
  INSERT INTO k VALUES ('b1', v_brand);
  INSERT INTO k VALUES ('chat', public.issue_4459_ensure_brand_guest_chat(v_brand));
END $fx$;

SELECT pg_temp.person(t) FROM unnest(ARRAY['ana', 'bo', 'cy', 'di', 'eve', 'mgr', 'outsider']) AS t;
INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (pg_temp.u('b1'), pg_temp.u('mgr'), 'event_manager', now(), now());
SELECT pg_temp.listing('ev', 'event', interval '3 days', interval '3 days 3 hours');
SELECT pg_temp.listing('later', 'event', interval '9 days', interval '9 days 3 hours');
SELECT pg_temp.listing('ended', 'event', interval '-2 hours', interval '-1 minute');
SELECT pg_temp.listing('rsvp', 'rsvp', interval '5 days', interval '5 days 2 hours');
SELECT pg_temp.listing('rsvp2', 'rsvp', interval '6 days', interval '6 days 2 hours');
-- A public, published, scheduled listing (the brand's own upcoming offering).
DO $pub$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
                            published_at, currency, timezone, rsvp_approval_mode)
    VALUES (v, pg_temp.u('b1'), pg_temp.u('owner'), 'Public night', 'i4630-pub-' || v, 'rsvp', 'scheduled',
            'public', now(), 'USD', 'UTC', 'auto');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v, now() + interval '12 days', now() + interval '12 days 4 hours', 'UTC', true);
  INSERT INTO k VALUES ('pub', v);
END $pub$;

DO $book$
DECLARE v_rsvp uuid; v_order uuid;
BEGIN
  -- ana: a paid order 10 days ago, and one on an event that ended a minute ago.
  PERFORM pg_temp.paid_order('ev', 'ana', now() - interval '10 days');
  PERFORM pg_temp.paid_order('ended', 'ana', now() - interval '20 days');
  -- eve: another guest's paid order, newer than ana's.
  PERFORM pg_temp.paid_order('ev', 'eve', now() - interval '2 days');
  -- bo: an approved going RSVP, approved 5 days ago.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp'), pg_temp.u('bo'), 'Bo', 'going', 'approved') RETURNING id INTO v_rsvp;
  UPDATE public.issue_4459_rsvp_server_approvals SET approved_at = now() - interval '5 days' WHERE rsvp_id = v_rsvp;
  INSERT INTO k VALUES ('bo_rsvp', v_rsvp);
  -- cy: bo's claimed plus-one, added 4 days ago.
  INSERT INTO public.event_rsvp_guests(rsvp_id, name, email, phone, matched_user_id, claimed_at, created_at)
    VALUES (v_rsvp, 'Cy', 'cy@example.test', '+15550004630', pg_temp.u('cy'), now(), now() - interval '4 days');
  -- di: an anonymous paid order claimed by email 3 days ago.
  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, payment_status,
                            payment_method, total_cents, source, created_at)
    VALUES (gen_random_uuid(), pg_temp.u('later'), NULL, 'di@example.test', '+15559994630', 'paid', 'free', 0,
            'online_checkout', now() - interval '30 days')
    RETURNING id INTO v_order;
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('later'), NULL, v_order, 'di@example.test');
  UPDATE public.pending_trip_chat_claims SET claimed_at = now() - interval '3 days', claimed_by_user_id = pg_temp.u('di')
   WHERE order_id = v_order;
  PERFORM public.add_buyer_to_event_chat(pg_temp.u('later'), pg_temp.u('di'), NULL, NULL);
  -- A brand post from before anyone here joined (their history starts at now()).
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at)
    VALUES (pg_temp.u('chat'), NULL, 'Old news', 'text', 'brand', now() - interval '1 day');
END $book$;

DO $fx_check$
BEGIN
  PERFORM pg_temp.ok('F-MEMBERS ana, bo, cy, di and the team member are in the Guest chat',
    pg_temp.member('ana') AND pg_temp.member('bo') AND pg_temp.member('cy') AND pg_temp.member('di')
    AND pg_temp.member('mgr') AND NOT pg_temp.member('outsider'));
END $fx_check$;

-- ═══ H: Host RPCs before (with the #4630 functions present) ═════════════════
CREATE TEMP TABLE host_before AS
  SELECT pg_temp.rpc_as('mgr', 'SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.conversation_id), ''[]''::jsonb) FROM public.issue_4459_list_my_brand_guest_chats() x') AS chats,
         pg_temp.rpc_as('mgr', 'SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.conversation_id), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() x') AS activity;

-- ═══ A: activity ════════════════════════════════════════════════════════════
DO $a$
DECLARE v jsonb;
BEGIN
  v := pg_temp.activity('ana');
  PERFORM pg_temp.ok('A-ROW ana sees exactly her brand Guest chat',
    jsonb_array_length(v) = 1 AND v->0->>'conversation_id' = pg_temp.u('chat')::text
    AND v->0->>'brand_id' = pg_temp.u('b1')::text);
  PERFORM pg_temp.ok('A-ORDER a paid order sets my_last_booking_at',
    pg_temp.ts(v->0->'my_last_booking_at') = now() - interval '10 days');
  PERFORM pg_temp.ok('A-OTHER another guest''s later bookings never show in mine',
    pg_temp.ts(v->0->'my_last_booking_at') = now() - interval '10 days');
  PERFORM pg_temp.ok('A-NEXT the next booking is the soonest not-ended one',
    v->0->>'next_booking_title' = 'Listing ev'
    AND pg_temp.ts(v->0->'next_booking_starts_at') = now() + interval '3 days');
  PERFORM pg_temp.ok('A-HISTORY a brand post before my history_visible_from is ignored',
    v->0->'last_visible_message_at' = 'null'::jsonb);

  v := pg_temp.activity('bo');
  PERFORM pg_temp.ok('A-RSVP a server-approved RSVP sets my_last_booking_at',
    pg_temp.ts(v->0->'my_last_booking_at') = now() - interval '5 days'
    AND v->0->>'next_booking_title' = 'Listing rsvp');
  v := pg_temp.activity('cy');
  PERFORM pg_temp.ok('A-PLUS-ONE a claimed plus-one sets my_last_booking_at',
    pg_temp.ts(v->0->'my_last_booking_at') = now() - interval '4 days');
  v := pg_temp.activity('di');
  PERFORM pg_temp.ok('A-CLAIM an email claim sets my_last_booking_at (not the order time)',
    pg_temp.ts(v->0->'my_last_booking_at') = now() - interval '3 days'
    AND v->0->>'next_booking_title' = 'Listing later');

  -- The latest source wins: ana RSVPs too, approved a day ago.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
    VALUES (pg_temp.u('rsvp2'), pg_temp.u('ana'), 'Ana', 'going', 'approved');
  UPDATE public.issue_4459_rsvp_server_approvals sa SET approved_at = now() - interval '1 day'
    FROM public.event_rsvps r WHERE r.id = sa.rsvp_id AND r.user_id = pg_temp.u('ana');
  v := pg_temp.activity('ana');
  PERFORM pg_temp.ok('A-LATEST the latest of the sources wins',
    pg_temp.ts(v->0->'my_last_booking_at') = now() - interval '1 day');

  -- Any visible message counts (Q2), whoever sent it.
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, sender_kind, created_at)
    VALUES (pg_temp.u('chat'), pg_temp.u('bo'), 'See you there', 'text', 'guest', now() + interval '1 minute');
  INSERT INTO public.messages(conversation_id, sender_id, content, message_type, created_at)
    VALUES (pg_temp.u('chat'), NULL, 'system line', 'system', now() + interval '2 minutes');
  v := pg_temp.activity('ana');
  PERFORM pg_temp.ok('A-VISIBLE another guest''s visible message sets last_visible_message_at; system lines do not',
    pg_temp.ts(v->0->'last_visible_message_at') = now() + interval '1 minute');

  v := pg_temp.activity('mgr');
  PERFORM pg_temp.ok('A-TEAM a brand team member gets no rows', v = '[]'::jsonb);
  v := pg_temp.activity('outsider');
  PERFORM pg_temp.ok('A-OUTSIDER a non-member gets no rows', v = '[]'::jsonb);
END $a$;

-- ═══ S: summary ═════════════════════════════════════════════════════════════
DO $s$
DECLARE v jsonb;
BEGIN
  v := pg_temp.summary('ana');
  PERFORM pg_temp.ok('S-MEMBER the member shape',
    (v->>'member')::boolean AND v->>'brandName' = 'Brand 4630'
    AND v->>'brandSlug' = 'i4630-' || pg_temp.u('b1')::text);
  PERFORM pg_temp.ok('S-BOOKINGS my not-ended bookings, soonest first',
    jsonb_array_length(v->'myBookings') = 2
    AND v->'myBookings'->0->>'kind' = 'order' AND v->'myBookings'->0->>'title' = 'Listing ev'
    AND v->'myBookings'->0->>'eventId' = pg_temp.u('ev')::text
    AND v->'myBookings'->0->>'offeringType' = 'event'
    AND (v->'myBookings'->0->>'ticketCount')::integer = 0
    AND v->'myBookings'->1->>'kind' = 'rsvp' AND (v->'myBookings'->1->>'ticketCount')::integer = 1);
  PERFORM pg_temp.ok('S-ENDED a booking that ended a minute ago is past, not upcoming',
    (v->>'hasPastBookings')::boolean
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'myBookings') b WHERE b->>'eventId' = pg_temp.u('ended')::text));
  PERFORM pg_temp.ok('S-UPCOMING the brand''s public upcoming offering, from pg_public_brand_upcoming',
    jsonb_array_length(v->'brandUpcoming') = 1
    AND v->'brandUpcoming'->0->>'offeringId' = pg_temp.u('pub')::text
    AND v->'brandUpcoming'->0->>'title' = 'Public night');

  v := pg_temp.summary('bo');
  PERFORM pg_temp.ok('S-OWN bo sees only his own RSVP, never ana''s orders',
    jsonb_array_length(v->'myBookings') = 1 AND v->'myBookings'->0->>'kind' = 'rsvp'
    AND v->'myBookings'->0->>'id' = pg_temp.u('bo_rsvp')::text
    AND NOT (v->>'hasPastBookings')::boolean);

  v := pg_temp.summary('cy');
  PERFORM pg_temp.ok('S-PLUS-ONE a plus-one''s booking is their own guest row (the id Purchases opens)',
    jsonb_array_length(v->'myBookings') = 1 AND v->'myBookings'->0->>'kind' = 'rsvp'
    AND v->'myBookings'->0->>'id' = (SELECT g.id::text FROM public.event_rsvp_guests g
                                       WHERE g.matched_user_id = pg_temp.u('cy')));

  PERFORM pg_temp.ok('S-OUTSIDER a non-member gets {"member": false} and nothing else',
    pg_temp.summary('outsider') = '{"member": false}'::jsonb);
  PERFORM pg_temp.ok('S-TEAM a team member gets {"member": false}',
    pg_temp.summary('mgr') = '{"member": false}'::jsonb);
  PERFORM pg_temp.ok('S-UNKNOWN an unknown conversation gets {"member": false}',
    pg_temp.rpc_as('ana', format('SELECT public.issue_4630_my_brand_chat_summary(%L)', gen_random_uuid()))
      = '{"member": false}'::jsonb);
END $s$;

-- ═══ P: posture ═════════════════════════════════════════════════════════════
DO $p$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.ok('P-ANON anon cannot run either function',
    NOT has_function_privilege('anon', 'public.issue_4630_my_brand_chat_activity()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4630_my_brand_chat_summary(uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('P-AUTH authenticated can run both',
    has_function_privilege('authenticated', 'public.issue_4630_my_brand_chat_activity()', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.issue_4630_my_brand_chat_summary(uuid)', 'EXECUTE'));
  v := pg_temp.rpc_as('ana', format('SELECT to_jsonb(count(*)) FROM public.issue_4630_brand_bookings(%L, %L)',
    pg_temp.u('b1'), pg_temp.u('bo')));
  PERFORM pg_temp.ok('P-HELPER a client cannot call the private helper with someone else''s id',
    v::text LIKE '%42501%');
  PERFORM pg_temp.ok('P-SELF-CHECK both are pinned, stable definers (the migration self-check holds)',
    (SELECT bool_and(p.prosecdef AND p.provolatile = 's'
                     AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'])
       FROM pg_proc p
      WHERE p.oid IN ('public.issue_4630_my_brand_chat_activity()'::regprocedure,
                      'public.issue_4630_my_brand_chat_summary(uuid)'::regprocedure)));
END $p$;

-- ═══ H: Host RPCs after dropping the #4630 functions (A3) ═══════════════════
DO $h$
DECLARE v_chats jsonb; v_activity jsonb;
BEGIN
  PERFORM pg_temp.ok('H-NO-REDEFINE no Host function body mentions #4630',
    NOT EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname IN ('issue_4459_list_my_brand_guest_chats', 'issue_4420_brand_guest_activity',
                                     'list_connection_conversation_access', 'pg_public_brand_upcoming',
                                     'issue_4459_brand_guest_eligible')
                   AND p.prosrc LIKE '%4630%'));
  PERFORM pg_temp.ok('H-ROWS the team member has Host rows to compare',
    jsonb_array_length((SELECT chats FROM host_before)) = 1
    AND jsonb_array_length((SELECT activity FROM host_before)) = 1);
  DROP FUNCTION public.issue_4630_my_brand_chat_summary(uuid);
  DROP FUNCTION public.issue_4630_my_brand_chat_activity();
  DROP FUNCTION public.issue_4630_brand_bookings(uuid, uuid);
  -- The A-VISIBLE messages arrived after host_before was taken; compare the
  -- stable columns only (membership and identity), and the unread rule's input.
  v_chats := pg_temp.rpc_as('mgr', 'SELECT COALESCE(jsonb_agg(to_jsonb(x) - ''last_message_at'' ORDER BY x.conversation_id), ''[]''::jsonb) FROM public.issue_4459_list_my_brand_guest_chats() x');
  v_activity := pg_temp.rpc_as('mgr', 'SELECT COALESCE(jsonb_agg(jsonb_build_object(''conversation_id'', x.conversation_id) ORDER BY x.conversation_id), ''[]''::jsonb) FROM public.issue_4420_brand_guest_activity() x');
  PERFORM pg_temp.ok('H-SAME-CHATS issue_4459_list_my_brand_guest_chats is unchanged by #4630',
    v_chats = (SELECT jsonb_agg(e - 'last_message_at') FROM host_before, jsonb_array_elements(chats) e));
  PERFORM pg_temp.ok('H-SAME-ACTIVITY issue_4420_brand_guest_activity is unchanged by #4630',
    v_activity = (SELECT jsonb_agg(jsonb_build_object('conversation_id', e->'conversation_id')) FROM host_before, jsonb_array_elements(activity) e));
END $h$;

ROLLBACK;
