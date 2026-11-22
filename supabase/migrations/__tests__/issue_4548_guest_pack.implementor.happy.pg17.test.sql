\set ON_ERROR_STOP on
-- #4548 Guest pack: PostgreSQL 17 executable proof after the full migration replay.
--
-- T-SET      the host saves a note plus five labelled links; they come back trimmed, in order.
-- T-HOST     the host reads it through biz_get_event_guest_pack.
-- T-APP      (a) an app purchaser (paid order owned from the start) reads it.
-- T-WEB      (b) a web purchaser reads null until claim_attendance_by_verified_identity attaches
--            the order, then reads it at once.
-- T-SHARED   (c) a live shared holder reads it; once the proof lapses, null.
-- T-FRIEND   a ticket received from a friend (tickets.holder_user_id, valid) reads it.
-- T-RSVP     (d) a going + approved RSVP owner and a claimed plus-one read it; a pending RSVP and
--            a matched but unclaimed plus-one read null.
-- T-DENY     a refunded buyer, a signed-in non-holder and another brand's owner read null; the
--            other brand cannot read or write through the biz functions.
-- T-WRITE    server rejections: a sixth link, an empty or 41-character label, http and
--            javascript: urls, extra keys, a 1,001-character note; a trip is refused.
-- T-DELETE   an empty note with no links deletes the pack; readers get null.
--
-- FAILS-ON-REVERT: replacing issue_4548_caller_holds_event's body with `RETURN true` fails
-- T-WEB, T-SHARED, T-RSVP and T-DENY; dropping the server-approval join or the claimed_at arm
-- fails T-RSVP; dropping biz_set_event_guest_pack's rank check fails T-DENY.

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4548 guest pack FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

-- Run p_sql as p_user (NULL = anon) and return its jsonb result, or a json
-- string 'ERR <sqlstate> <message>'.
CREATE OR REPLACE FUNCTION pg_temp.as_call(p_user uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  r jsonb;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
           ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
    PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
    EXECUTE p_sql INTO r;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM set_config('role', 'postgres', true);
    RETURN to_jsonb('ERR ' || v_state || ' ' || v_msg);
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.pack_as(p_user uuid, p_event uuid)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_call(p_user, format('SELECT public.pg_my_event_guest_pack(%L::uuid)', p_event));
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.set_as(p_user uuid, p_event uuid, p_note text, p_items jsonb)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_call(p_user, format(
    'SELECT public.biz_set_event_guest_pack(%L::uuid, %L::text, %L::jsonb)', p_event, p_note, p_items));
$fn$;

BEGIN;

CREATE TEMP TABLE i4548 (k text PRIMARY KEY, id uuid);

DO $fixture$
DECLARE
  v_host uuid := '45480000-0000-4000-8000-000000000001';
  v_brand uuid := '45480000-0000-4000-8000-000000000002';
  v_event uuid := '45480000-0000-4000-8000-000000000003';
  v_rsvp_event uuid := '45480000-0000-4000-8000-000000000004';
  v_trip uuid := '45480000-0000-4000-8000-000000000005';
  v_tt uuid := '45480000-0000-4000-8000-000000000006';
  v_app uuid := '45480000-0000-4000-8000-000000000011';
  v_web uuid := '45480000-0000-4000-8000-000000000012';
  v_share_owner uuid := '45480000-0000-4000-8000-000000000013';
  v_share_holder uuid := '45480000-0000-4000-8000-000000000014';
  v_friend uuid := '45480000-0000-4000-8000-000000000015';
  v_refunded uuid := '45480000-0000-4000-8000-000000000016';
  v_going uuid := '45480000-0000-4000-8000-000000000017';
  v_pending uuid := '45480000-0000-4000-8000-000000000018';
  v_plus uuid := '45480000-0000-4000-8000-000000000019';
  v_plus_unclaimed uuid := '45480000-0000-4000-8000-000000000020';
  v_stranger uuid := '45480000-0000-4000-8000-000000000021';
  v_other_owner uuid := '45480000-0000-4000-8000-000000000022';
  v_other_brand uuid := '45480000-0000-4000-8000-000000000023';
  v_app_order uuid := '45480000-0000-4000-8000-000000000031';
  v_web_order uuid := '45480000-0000-4000-8000-000000000032';
  v_share_order uuid := '45480000-0000-4000-8000-000000000033';
  v_friend_order uuid := '45480000-0000-4000-8000-000000000034';
  v_refund_order uuid := '45480000-0000-4000-8000-000000000035';
  v_going_rsvp uuid;
  v_pending_rsvp uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4548-host@example.test'), (v_app, 'i4548-app@example.test'),
    (v_web, 'i4548-web-account@example.test'), (v_share_owner, 'i4548-share-owner@example.test'),
    (v_share_holder, 'i4548-share-holder@example.test'), (v_friend, 'i4548-friend@example.test'),
    (v_refunded, 'i4548-refunded@example.test'), (v_going, 'i4548-going@example.test'),
    (v_pending, 'i4548-pending@example.test'), (v_plus, 'i4548-plus@example.test'),
    (v_plus_unclaimed, 'i4548-plus-unclaimed@example.test'),
    (v_stranger, 'i4548-stranger@example.test'), (v_other_owner, 'i4548-other@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_host, 'i4548-host@example.test'), (v_other_owner, 'i4548-other@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES
    (v_brand, v_host, 'Issue 4548 Brand', 'issue-4548-brand', 'stripe', 'US', 'USD', 'USD',
     'i4548-host@example.test'),
    (v_other_brand, v_other_owner, 'Issue 4548 Other', 'issue-4548-other', 'stripe', 'US', 'USD',
     'USD', 'i4548-other@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency)
  VALUES
    (v_event, v_brand, v_host, 'Issue 4548 Night', 'issue-4548-night', 'event', 'scheduled',
     'public', 'UTC', 'USD'),
    (v_trip, v_brand, v_host, 'Issue 4548 Trip', 'issue-4548-trip', 'trip', 'scheduled',
     'public', 'UTC', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, rsvp_guests_can_bring, published_at)
  VALUES (v_rsvp_event, v_brand, v_host, 'Issue 4548 RSVP', 'issue-4548-rsvp', 'rsvp',
    'scheduled', 'public', 'UTC', 'USD', NULL, false, 'auto', true, 4, true, now());
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_tt, v_event, 'General', 50, 'USD');

  -- Verified contacts (#4063 keeps an order's owner only when the account
  -- proves its contact): each app owner proves their order email; the web
  -- buyer proves the web order's email; the shared holder proves the shared
  -- order's email too.
  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via) VALUES
    (v_host, 'email', 'i4548-host@example.test', 'email_code'),
    (v_app, 'email', 'i4548-app@example.test', 'email_code'),
    (v_share_owner, 'email', 'i4548-shared@example.test', 'email_code'),
    (v_refunded, 'email', 'i4548-refunded@example.test', 'email_code'),
    (v_web, 'email', 'i4548-web-buyer@example.test', 'email_code'),
    (v_share_holder, 'email', 'i4548-shared@example.test', 'email_code');

  INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source)
  VALUES
    (v_app_order, v_event, v_app, 'i4548-app@example.test', '+12025554801', 50, 'USD',
     'online_card', 'paid', 'online_checkout'),
    (v_web_order, v_event, NULL, 'i4548-web-buyer@example.test', '+12025554802', 50, 'USD',
     'online_card', 'paid', 'online_checkout'),
    (v_share_order, v_event, v_share_owner, 'i4548-shared@example.test', '+12025554803', 50,
     'USD', 'online_card', 'paid', 'online_checkout'),
    (v_friend_order, v_event, v_host, 'i4548-host@example.test', '+12025554804', 50, 'USD',
     'online_card', 'paid', 'online_checkout'),
    (v_refund_order, v_event, v_refunded, 'i4548-refunded@example.test', '+12025554805', 50,
     'USD', 'online_card', 'refunded', 'online_checkout');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES
    (v_app_order, v_tt, v_event, 'i4548-qr-app', 'valid', 'auto'),
    (v_web_order, v_tt, v_event, 'i4548-qr-web', 'valid', 'auto'),
    (v_share_order, v_tt, v_event, 'i4548-qr-share', 'valid', 'auto');
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status,
    holder_user_id)
  VALUES (v_friend_order, v_tt, v_event, 'i4548-qr-friend', 'valid', 'auto', v_friend);

  INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
  VALUES ('order', v_share_order, v_share_holder);

  -- Written as the server, so the #4459 approval stamp is recorded.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
  VALUES (v_rsvp_event, v_going, 'Going Guest', 'going', 'approved')
  RETURNING id INTO v_going_rsvp;
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
  VALUES (v_rsvp_event, v_pending, 'Pending Guest', 'going', 'pending')
  RETURNING id INTO v_pending_rsvp;
  INSERT INTO public.event_rsvp_guests(rsvp_id, name, matched_user_id, claimed_at)
  VALUES (v_going_rsvp, 'Claimed Plus', v_plus, now()),
         (v_going_rsvp, 'Unclaimed Plus', v_plus_unclaimed, NULL);

  INSERT INTO i4548 VALUES
    ('host', v_host), ('brand', v_brand), ('event', v_event), ('rsvp_event', v_rsvp_event),
    ('trip', v_trip), ('app', v_app), ('web', v_web), ('web_order', v_web_order),
    ('share_holder', v_share_holder), ('friend', v_friend), ('refunded', v_refunded),
    ('going', v_going), ('pending', v_pending), ('plus', v_plus),
    ('plus_unclaimed', v_plus_unclaimed), ('stranger', v_stranger),
    ('other_owner', v_other_owner);
END;
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.u(p_k text) RETURNS uuid LANGUAGE sql AS $fn$
  SELECT id FROM i4548 WHERE k = p_k;
$fn$;

-- T-SET / T-HOST ---------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
  v_items jsonb := '[
    {"label":"  Building access PDF ","url":" https://example.test/access.pdf "},
    {"label":"Parking map","url":"https://maps.example.test/p?q=1"},
    {"label":"Menu","url":"https://drive.example.test/file/d/abc/view"},
    {"label":"Dress code","url":"https://example.test/dress"},
    {"label":"Itinerary","url":"https://example.test/plan"}]';
BEGIN
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'),
    E'  Ring 4B.\nUse the side door.  ', v_items);
  PERFORM pg_temp.ok(v->>'note' = E'Ring 4B.\nUse the side door.'
    AND jsonb_array_length(v->'items') = 5
    AND v->'items'->0 = '{"label":"Building access PDF","url":"https://example.test/access.pdf"}'::jsonb
    AND v->'items'->4->>'label' = 'Itinerary'
    AND v ? 'updatedAt',
    'T-SET five links saved trimmed and in order: ' || v::text);
  v := pg_temp.as_call(pg_temp.u('host'),
    format('SELECT public.biz_get_event_guest_pack(%L::uuid)', pg_temp.u('event')));
  PERFORM pg_temp.ok(v->>'note' = E'Ring 4B.\nUse the side door.'
    AND (SELECT array_agg(e->>'label' ORDER BY o) FROM jsonb_array_elements(v->'items') WITH ORDINALITY t(e, o))
        = ARRAY['Building access PDF', 'Parking map', 'Menu', 'Dress code', 'Itinerary'],
    'T-HOST the host reads the same pack back in order');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('rsvp_event'), 'Bring a jumper.', '[]');
  PERFORM pg_temp.ok(v->>'note' = 'Bring a jumper.' AND v->'items' = '[]'::jsonb,
    'T-SET a note-only pack on the RSVP event');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('host'), pg_temp.u('event'))->>'note' IS NOT NULL,
    'T-HOST the brand team also passes the guest read');
END;
$test$;

-- T-APP / T-WEB / T-SHARED / T-FRIEND ----------------------------------------
DO $test$
DECLARE
  v jsonb;
  v_claim jsonb;
BEGIN
  v := pg_temp.pack_as(pg_temp.u('app'), pg_temp.u('event'));
  PERFORM pg_temp.ok(jsonb_typeof(v) = 'object' AND jsonb_array_length(v->'items') = 5
    AND v->'items'->1->>'url' = 'https://maps.example.test/p?q=1',
    'T-APP the app purchaser reads the pack: ' || COALESCE(v::text, 'null'));

  v := pg_temp.pack_as(pg_temp.u('web'), pg_temp.u('event'));
  PERFORM pg_temp.ok(v IS NULL, 'T-WEB the web purchaser reads null before the sweep');
  v_claim := public.claim_attendance_by_verified_identity(pg_temp.u('web'));
  PERFORM pg_temp.ok((SELECT buyer_user_id FROM public.orders WHERE id = pg_temp.u('web_order'))
    = pg_temp.u('web'), 'T-WEB the sweep attached the web order: ' || COALESCE(v_claim::text, 'null'));
  v := pg_temp.pack_as(pg_temp.u('web'), pg_temp.u('event'));
  PERFORM pg_temp.ok(jsonb_typeof(v) = 'object' AND v->>'note' LIKE 'Ring 4B.%',
    'T-WEB the web purchaser reads the pack right after the sweep');

  v := pg_temp.pack_as(pg_temp.u('share_holder'), pg_temp.u('event'));
  PERFORM pg_temp.ok(jsonb_typeof(v) = 'object',
    'T-SHARED a live shared holder reads the pack');
  DELETE FROM public.account_claim_contacts WHERE user_id = pg_temp.u('share_holder');
  v := pg_temp.pack_as(pg_temp.u('share_holder'), pg_temp.u('event'));
  PERFORM pg_temp.ok(v IS NULL, 'T-SHARED after the proof lapses the shared holder reads null');

  v := pg_temp.pack_as(pg_temp.u('friend'), pg_temp.u('event'));
  PERFORM pg_temp.ok(jsonb_typeof(v) = 'object',
    'T-FRIEND a valid ticket received from a friend reads the pack');
END;
$test$;

-- T-RSVP -----------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.pack_as(pg_temp.u('going'), pg_temp.u('rsvp_event'));
  PERFORM pg_temp.ok(v->>'note' = 'Bring a jumper.',
    'T-RSVP a going + approved RSVP owner reads the pack: ' || COALESCE(v::text, 'null'));
  v := pg_temp.pack_as(pg_temp.u('plus'), pg_temp.u('rsvp_event'));
  PERFORM pg_temp.ok(v->>'note' = 'Bring a jumper.',
    'T-RSVP a claimed plus-one reads the pack');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('pending'), pg_temp.u('rsvp_event')) IS NULL,
    'T-RSVP a pending RSVP reads null');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('plus_unclaimed'), pg_temp.u('rsvp_event')) IS NULL,
    'T-RSVP a matched but unclaimed plus-one reads null');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('going'), pg_temp.u('event')) IS NULL,
    'T-RSVP an RSVP on one event never opens another event''s pack');
  -- A client-written approval (no #4459 server stamp) does not count.
  DELETE FROM public.issue_4459_rsvp_server_approvals sa
   USING public.event_rsvps r
   WHERE sa.rsvp_id = r.id AND r.user_id = pg_temp.u('going');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('going'), pg_temp.u('rsvp_event')) IS NULL
    AND pg_temp.pack_as(pg_temp.u('plus'), pg_temp.u('rsvp_event')) IS NULL,
    'T-RSVP without the server approval stamp neither the owner nor the plus-one reads it');
  INSERT INTO public.issue_4459_rsvp_server_approvals(rsvp_id)
  SELECT r.id FROM public.event_rsvps r WHERE r.user_id = pg_temp.u('going');
END;
$test$;

-- T-DENY -------------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('refunded'), pg_temp.u('event')) IS NULL,
    'T-DENY a refunded buyer reads null');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('stranger'), pg_temp.u('event')) IS NULL,
    'T-DENY a signed-in non-holder reads null');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('other_owner'), pg_temp.u('event')) IS NULL,
    'T-DENY another brand''s owner reads null');
  v := pg_temp.pack_as(NULL, pg_temp.u('event'));
  PERFORM pg_temp.ok(v::text LIKE '"ERR 42501%',
    'T-DENY anon cannot execute the guest read: ' || v::text);
  v := pg_temp.as_call(pg_temp.u('other_owner'),
    format('SELECT public.biz_get_event_guest_pack(%L::uuid)', pg_temp.u('event')));
  PERFORM pg_temp.ok(v::text LIKE '"ERR 42501%', 'T-DENY another brand cannot use the team read: ' || v::text);
  v := pg_temp.set_as(pg_temp.u('other_owner'), pg_temp.u('event'), 'hijack', '[]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 42501%', 'T-DENY another brand cannot write: ' || v::text);
  v := pg_temp.set_as(pg_temp.u('app'), pg_temp.u('event'), 'hijack', '[]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 42501%', 'T-DENY a buyer cannot write: ' || v::text);
  v := pg_temp.as_call(pg_temp.u('app'),
    format('SELECT public.event_guest_pack_exists(%L::uuid)::text::jsonb', pg_temp.u('event')));
  PERFORM pg_temp.ok(v::text LIKE '"ERR 42501%', 'T-DENY a client cannot call the email existence check');
  PERFORM pg_temp.ok((SELECT note FROM public.event_guest_packs WHERE event_id = pg_temp.u('event'))
    LIKE 'Ring 4B.%', 'T-DENY the pack is unchanged after refused writes');
END;
$test$;

-- T-WRITE ---------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
  v_link jsonb := '{"label":"Map","url":"https://example.test/m"}';
BEGIN
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL,
    jsonb_build_array(v_link, v_link, v_link, v_link, v_link, v_link));
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-WRITE a sixth link is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL, '[{"label":"   ","url":"https://example.test/m"}]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-WRITE an empty label is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL,
    jsonb_build_array(jsonb_build_object('label', repeat('x', 41), 'url', 'https://example.test/m')));
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-WRITE a 41-character label is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL, '[{"label":"Map","url":"http://example.test/m"}]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-WRITE an http url is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL, '[{"label":"Map","url":"javascript:alert(1)"}]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-WRITE a javascript: url is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL,
    '[{"label":"Map","url":"https://example.test/m","icon":"x"}]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-WRITE an extra key is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), repeat('n', 1001), '[]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_note_too_long%', 'T-WRITE a 1,001-character note is refused');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), repeat('n', 1000), '[]');
  PERFORM pg_temp.ok(char_length(v->>'note') = 1000, 'T-WRITE a 1,000-character note is accepted');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('trip'), 'Trip note', '[]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_unsupported_event_type%', 'T-WRITE a trip is refused');
  -- Direct table writes that dodge the function still hit the CHECKs.
  PERFORM pg_temp.ok(NOT public.event_guest_pack_items_valid(
      '[{"label":"Map","url":"https://example.test/m"},{"label":"Map","url":"https://example.test/m"},{"label":"Map","url":"https://example.test/m"},{"label":"Map","url":"https://example.test/m"},{"label":"Map","url":"https://example.test/m"},{"label":"Map","url":"https://example.test/m"}]')
    AND NOT public.event_guest_pack_items_valid('[{"label":"Map","url":"https://example.test/m","x":1}]')
    AND NOT public.event_guest_pack_items_valid('[{"label":"Map","url":"http://example.test/m"}]')
    AND NOT public.event_guest_pack_items_valid(jsonb_build_array(jsonb_build_object('label', repeat('y', 41), 'url', 'https://example.test/m')))
    AND NOT public.event_guest_pack_items_valid('{"label":"Map"}')
    AND public.event_guest_pack_items_valid('[]')
    AND public.event_guest_pack_items_valid(jsonb_build_array(jsonb_build_object('label', repeat('y', 40), 'url', 'https://example.test/m'))),
    'T-WRITE the validator rejects 6 items, extra keys, http and a 41-character label');
END;
$test$;

-- T-TRIM (retest F3): every leading/trailing whitespace character is trimmed --
DO $test$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'),
    U&'\00A0\0009 Ring 4B.' || E'\nSide door.\r\n\t ',
    jsonb_build_array(jsonb_build_object('label', U&'\3000Map\00A0', 'url', E'\thttps://example.test/m\n')));
  PERFORM pg_temp.ok(v->>'note' = E'Ring 4B.\nSide door.'
    AND v->'items'->0 = '{"label":"Map","url":"https://example.test/m"}'::jsonb,
    'T-TRIM tabs, line breaks and Unicode spaces are trimmed; interior line breaks stay: ' || v::text);
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), E' \n\t\r ', '[{"label":"Map","url":"https://example.test/m"}]');
  PERFORM pg_temp.ok(v->'note' = 'null'::jsonb, 'T-TRIM a whitespace-only note is no note');
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), NULL, E'[{"label":"Map\\tTwo","url":"https://example.test/m"}]');
  PERFORM pg_temp.ok(v::text LIKE '"ERR 22023 guest_pack_items_invalid%', 'T-TRIM a tab inside a label is refused');
END;
$test$;

-- T-DELETE ----------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.set_as(pg_temp.u('host'), pg_temp.u('event'), '   ', '[]');
  PERFORM pg_temp.ok(v = 'null'::jsonb OR v IS NULL, 'T-DELETE an empty save returns null');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_guest_packs WHERE event_id = pg_temp.u('event')),
    'T-DELETE the row is gone');
  PERFORM pg_temp.ok(pg_temp.pack_as(pg_temp.u('app'), pg_temp.u('event')) IS NULL,
    'T-DELETE a buyer reads null after delete');
  PERFORM pg_temp.ok(pg_temp.as_call(pg_temp.u('host'),
      format('SELECT public.biz_get_event_guest_pack(%L::uuid)', pg_temp.u('event'))) IS NULL,
    'T-DELETE the host reads null after delete');
END;
$test$;

ROLLBACK;
