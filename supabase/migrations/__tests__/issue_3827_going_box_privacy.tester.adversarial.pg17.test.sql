\set ON_ERROR_STOP on

-- Issue #3827 going-box — TESTER adversarial proof (mingla-tester), a different angle
-- from the implementor's happy path. Attacks the edges of
-- 20271128003827_issue_3827_going_box_privacy_extra_guests.sql:
--
--   TA-1  role escalation: a non-member cannot write extras through the live-edit
--         owner, the leaf or a raw UPDATE as authenticated; anon cannot run the leaf
--   TA-2  Ari's positional 3-argument dispatcher call keeps stored extras
--   TA-3  private ON hides stored extras on every read; private OFF brings them back
--         (the stored value is kept, never wiped)
--   TA-4  ticket statuses: used + transferred count as going and toward full;
--         void + refunded never do
--   TA-5  an unlimited tier makes capacity NULL, so capacityFull stays false however
--         many tickets and extras there are
--   TA-6  RSVP pending / maybe never count; plus-ones do (capacity full = real seats)
--   TA-7  a non-RSVP row with a stray rsvp_capacity is never rsvp_capacity_full
--   TA-8  huge and exotic JSON values for extraGuestCount are refused by the CHECK on
--         every path; JSON null is accepted and reads as 0
--   TA-9  an ended event still withholds a private count
--
-- FAILS-ON-REVERT (chain without 20271128003827): TA-3 fails on the withheld count,
-- TA-4/TA-5/TA-6 on the missing capacityFull key, TA-8 because no constraint exists.

CREATE OR REPLACE FUNCTION pg_temp.ta_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3827 going-box TESTER FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$assert$;

CREATE OR REPLACE FUNCTION pg_temp.ta_brand(p_tag text, OUT o_user uuid, OUT o_brand uuid, OUT o_slug text)
LANGUAGE plpgsql AS $brand$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_slug := 'ta-' || p_tag || '-' || o_brand;
  INSERT INTO auth.users(id, email) VALUES (o_user, 'ta-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (o_brand, o_user, 'Tester ' || p_tag, o_slug, 'stripe', 'US', 'USD', 'USD');
END
$brand$;

CREATE OR REPLACE FUNCTION pg_temp.ta_event(
  p_brand uuid, p_tag text, p_type text, p_private boolean, p_extra integer,
  p_status text DEFAULT 'scheduled', p_rsvp_capacity integer DEFAULT NULL,
  OUT o_event uuid, OUT o_slug text
) LANGUAGE plpgsql AS $event$
BEGIN
  o_event := gen_random_uuid();
  o_slug := 'ta-' || p_tag || '-' || o_event;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone,
                            currency, published_at, theme, location_text, rsvp_capacity, rsvp_approval_mode)
    VALUES (o_event, p_brand, 'Tester ' || p_tag, o_slug, p_type, p_status, 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object('format', 'in_person',
              'settings', jsonb_strip_nulls(jsonb_build_object('privateGuestList', p_private,
                                                                'hideRemainingCount', false,
                                                                'extraGuestCount', p_extra)))),
            'Room', p_rsvp_capacity, 'auto');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '10 days', now() + interval '10 days 3 hours', 'UTC', true);
END
$event$;

CREATE OR REPLACE FUNCTION pg_temp.ta_tier(p_event uuid, p_quantity integer, p_unlimited boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $tier$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, quantity_total, is_unlimited, currency)
    VALUES (v, p_event, 'GA', 0, p_quantity, p_unlimited, 'USD');
  RETURN v;
END
$tier$;

CREATE OR REPLACE FUNCTION pg_temp.ta_ticket(p_event uuid, p_tier uuid, p_status text)
RETURNS void LANGUAGE plpgsql AS $ticket$
DECLARE v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, total_cents, currency, payment_status, source)
    VALUES (v_order, p_event, 'ta-' || v_order || '@example.test', 'Buyer', 0, 'USD', 'paid', 'legacy');
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
    VALUES (gen_random_uuid(), v_order, p_tier, p_event, 'ta-' || v_order, p_status, 'auto');
END
$ticket$;

-- ─── TA-1: role escalation ──────────────────────────────────────────────────────────
BEGIN;
DO $ta1$
DECLARE b record; ev record; v_stranger uuid := gen_random_uuid(); v_before jsonb; v_refused boolean;
BEGIN
  SELECT * INTO b FROM pg_temp.ta_brand('ta1');
  SELECT * INTO ev FROM pg_temp.ta_event(b.o_brand, 'ta1', 'event', false, 5);
  SELECT theme INTO v_before FROM public.events WHERE id = ev.o_event;
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'ta-stranger-' || v_stranger || '@example.test');
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_refused := false;
  BEGIN
    PERFORM public.business_update_live_event_atomic(ev.o_event,
      jsonb_build_object('core', jsonb_build_object('extraGuestCount', 4999)), 'Inflating someone else''s list', 1);
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  PERFORM pg_temp.ta_assert(v_refused, 'TA-1a a non-member cannot write extras through the live-edit owner');

  v_refused := false;
  BEGIN
    PERFORM public.biz_set_event_guest_privacy(ev.o_event, NULL, NULL, 4999);
  EXCEPTION WHEN raise_exception THEN v_refused := SQLERRM = 'not_authorized';
  END;
  PERFORM pg_temp.ta_assert(v_refused, 'TA-1b a non-member cannot write extras through the leaf');

  SET LOCAL ROLE authenticated;
  UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', '4999')
   WHERE id = ev.o_event;
  RESET ROLE;
  PERFORM pg_temp.ta_assert((SELECT theme FROM public.events WHERE id = ev.o_event) = v_before,
    'TA-1c a raw authenticated UPDATE by a non-member changes nothing (RLS)');

  v_refused := false;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.biz_set_event_guest_privacy(ev.o_event, NULL, NULL, 10);
  EXCEPTION WHEN insufficient_privilege THEN v_refused := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.ta_assert(v_refused, 'TA-1d anon has no EXECUTE on the leaf');
END
$ta1$;
ROLLBACK;

-- ─── TA-2 / TA-3: Ari's call shape; private toggling keeps stored extras ────────────
BEGIN;
DO $ta2$
DECLARE b record; ev record; rs record; v jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.ta_brand('ta2');
  SELECT * INTO ev FROM pg_temp.ta_event(b.o_brand, 'ta2', 'event', false, 40);
  PERFORM pg_temp.ta_tier(ev.o_event, 100);
  PERFORM set_config('request.jwt.claim.sub', b.o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Exactly the dispatcher's positional shape (20270429002353 set_event_guest_privacy).
  v := public.biz_set_event_guest_privacy(ev.o_event, ('true')::boolean, (NULL::text)::boolean);
  PERFORM pg_temp.ta_assert((v ->> 'extraGuestCount')::int = 40 AND (v ->> 'privateGuestList')::boolean,
    'TA-2 Ari''s positional call turns private on and keeps the stored 40 extras');

  v := public.pg_public_social_proof(ev.o_event)::jsonb;
  PERFORM pg_temp.ta_assert(jsonb_typeof(v -> 'goingCount') = 'null' AND (v ->> 'extraGuestCount')::int = 0,
    'TA-3a private: count withheld AND stored extras hidden (0)');
  PERFORM pg_temp.ta_assert(
    (SELECT extra_guest_count FROM public.business_public_events_view WHERE id = ev.o_event) = 0,
    'TA-3b private: the view shows 0 extras');

  v := public.biz_set_event_guest_privacy(ev.o_event, false);
  v := public.pg_public_social_proof(ev.o_event)::jsonb;
  PERFORM pg_temp.ta_assert((v ->> 'goingCount')::int = 0 AND (v ->> 'extraGuestCount')::int = 40,
    'TA-3c private off again: the stored 40 come back, count real (0)');

  SELECT * INTO rs FROM pg_temp.ta_event(b.o_brand, 'ta3r', 'rsvp', true, 25, 'scheduled', 30);
  v := public.pg_public_rsvp_by_slug(b.o_slug, rs.o_slug)::jsonb;
  PERFORM pg_temp.ta_assert((v #>> '{publicEventRow,extra_guest_count}')::int = 0
      AND jsonb_typeof(v #> '{publicEventRow,rsvp_going_count}') = 'null',
    'TA-3d private RSVP with stored extras: the row shows 0 extras and a null count');
END
$ta2$;
ROLLBACK;

-- ─── TA-4 / TA-5: ticket statuses and unlimited tiers ───────────────────────────────
BEGIN;
DO $ta4$
DECLARE b record; ev record; un record; v_tier uuid; v jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.ta_brand('ta4');
  SELECT * INTO ev FROM pg_temp.ta_event(b.o_brand, 'ta4', 'event', false, 900);
  v_tier := pg_temp.ta_tier(ev.o_event, 3);
  PERFORM pg_temp.ta_ticket(ev.o_event, v_tier, 'used');
  PERFORM pg_temp.ta_ticket(ev.o_event, v_tier, 'transferred');
  PERFORM pg_temp.ta_ticket(ev.o_event, v_tier, 'void');
  PERFORM pg_temp.ta_ticket(ev.o_event, v_tier, 'refunded');
  v := public.pg_public_social_proof(ev.o_event)::jsonb;
  PERFORM pg_temp.ta_assert((v ->> 'goingCount')::int = 2 AND (v ->> 'capacityFull')::boolean = false,
    'TA-4a used + transferred count (2 of 3); void + refunded do not; 900 extras do not fill it');
  PERFORM pg_temp.ta_ticket(ev.o_event, v_tier, 'valid');
  v := public.pg_public_social_proof(ev.o_event)::jsonb;
  PERFORM pg_temp.ta_assert((v ->> 'capacityFull')::boolean = true AND (v ->> 'goingCount')::int = 3,
    'TA-4b the third real ticket fills it (3 of 3)');

  SELECT * INTO un FROM pg_temp.ta_event(b.o_brand, 'ta5', 'event', false, 5000);
  PERFORM pg_temp.ta_tier(un.o_event, 2);
  v_tier := pg_temp.ta_tier(un.o_event, NULL, true);
  PERFORM pg_temp.ta_ticket(un.o_event, v_tier, 'valid');
  PERFORM pg_temp.ta_ticket(un.o_event, v_tier, 'valid');
  PERFORM pg_temp.ta_ticket(un.o_event, v_tier, 'valid');
  v := public.pg_public_social_proof(un.o_event)::jsonb;
  PERFORM pg_temp.ta_assert(jsonb_typeof(v -> 'capacity') = 'null' AND (v ->> 'capacityFull')::boolean = false,
    'TA-5 an unlimited tier: capacity NULL and never full (3 tickets, 5000 extras)');
END
$ta4$;
ROLLBACK;

-- ─── TA-6 / TA-7: RSVP seats and stray capacity ─────────────────────────────────────
BEGIN;
DO $ta6$
DECLARE b record; rs record; tk record; v_full boolean;
BEGIN
  SELECT * INTO b FROM pg_temp.ta_brand('ta6');
  SELECT * INTO rs FROM pg_temp.ta_event(b.o_brand, 'ta6', 'rsvp', false, 3000, 'scheduled', 4);
  INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status, plus_count)
  VALUES
    (rs.o_event, 'Pending', 'ta6-p-' || gen_random_uuid() || '@example.test', '+15550003827', 'going', 'pending', 0),
    (rs.o_event, 'Maybe', 'ta6-m-' || gen_random_uuid() || '@example.test', '+15550003827', 'maybe', 'approved', 0),
    (rs.o_event, 'Going +2', 'ta6-g-' || gen_random_uuid() || '@example.test', '+15550003827', 'going', 'approved', 2);
  SELECT rsvp_capacity_full INTO v_full FROM public.business_public_events_view WHERE id = rs.o_event;
  PERFORM pg_temp.ta_assert(v_full = false,
    'TA-6a 3 real seats of 4 (pending and maybe excluded, 3000 extras ignored) is not full');
  INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
    VALUES (rs.o_event, 'Last seat', 'ta6-l-' || gen_random_uuid() || '@example.test', '+15550003827', 'going', 'approved');
  SELECT rsvp_capacity_full INTO v_full FROM public.business_public_events_view WHERE id = rs.o_event;
  PERFORM pg_temp.ta_assert(v_full = true, 'TA-6b the fourth real seat fills it');
  PERFORM pg_temp.ta_assert((public.pg_public_social_proof(rs.o_event)::jsonb ->> 'capacityFull')::boolean,
    'TA-6c social proof agrees');

  SELECT * INTO tk FROM pg_temp.ta_event(b.o_brand, 'ta7', 'event', false, 0, 'scheduled', 0);
  PERFORM pg_temp.ta_assert(
    (SELECT rsvp_capacity_full FROM public.business_public_events_view WHERE id = tk.o_event) = false,
    'TA-7 a ticketed row with a stray rsvp_capacity of 0 is never rsvp_capacity_full');
END
$ta6$;
ROLLBACK;

-- ─── TA-8: exotic values on every write path ────────────────────────────────────────
BEGIN;
DO $ta8$
DECLARE b record; ev record; v_bad jsonb; v_refused boolean;
BEGIN
  SELECT * INTO b FROM pg_temp.ta_brand('ta8');
  SELECT * INTO ev FROM pg_temp.ta_event(b.o_brand, 'ta8', 'event', false, 0);
  FOREACH v_bad IN ARRAY ARRAY['1e10'::jsonb, '5000.0000001'::jsonb, '-0.5'::jsonb, '{"n": 3}'::jsonb, '"5"'::jsonb] LOOP
    v_refused := false;
    BEGIN
      UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', v_bad)
       WHERE id = ev.o_event;
    EXCEPTION WHEN check_violation THEN v_refused := true;
    END;
    PERFORM pg_temp.ta_assert(v_refused, 'TA-8a ' || v_bad::text || ' is refused by the CHECK');
  END LOOP;
  -- 5000.0 is a whole number in JSON terms and inside the cap.
  UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', '5000.0')
   WHERE id = ev.o_event;
  PERFORM pg_temp.ta_assert((public.pg_public_social_proof(ev.o_event)::jsonb ->> 'extraGuestCount')::int = 5000,
    'TA-8b 5000.0 is accepted and reads as 5000');
  UPDATE public.events SET theme = jsonb_set(theme, '{business_event,settings,extraGuestCount}', 'null')
   WHERE id = ev.o_event;
  PERFORM pg_temp.ta_assert((public.pg_public_social_proof(ev.o_event)::jsonb ->> 'extraGuestCount')::int = 0,
    'TA-8c JSON null is accepted and reads as 0');

  PERFORM set_config('request.jwt.claim.sub', b.o_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_refused := false;
  BEGIN
    PERFORM public.business_update_live_event(ev.o_event, jsonb_build_object('extraGuestCount', '12.5'), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_refused := true;
  END;
  PERFORM pg_temp.ta_assert(v_refused, 'TA-8d a fractional patch value is refused by the live-edit owner');
END
$ta8$;
ROLLBACK;

-- ─── TA-9: an ended event keeps withholding ─────────────────────────────────────────
BEGIN;
DO $ta9$
DECLARE b record; ev record; v jsonb;
BEGIN
  SELECT * INTO b FROM pg_temp.ta_brand('ta9');
  SELECT * INTO ev FROM pg_temp.ta_event(b.o_brand, 'ta9', 'event', true, 10, 'ended');
  PERFORM pg_temp.ta_tier(ev.o_event, 20);
  v := public.pg_public_social_proof(ev.o_event)::jsonb;
  PERFORM pg_temp.ta_assert(v IS NOT NULL AND jsonb_typeof(v -> 'goingCount') = 'null',
    'TA-9 an ended private event still withholds the count');
END
$ta9$;
ROLLBACK;

SELECT 'issue_3827_going_box_privacy.tester.adversarial.pg17: PASS' AS result;
