-- #2879 / #2947 slice 5 — adversarial: the two release paths cannot diverge,
-- and drain is idempotent under the waitlist_invite idempotency key.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.a2947_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 waitlist drain ADV FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.a2947_tier(p_tag text, OUT o_event uuid, OUT o_tier uuid)
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  o_tier := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'a2947-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (v_brand, v_user, 'A2947 ' || p_tag, 'a2947-' || p_tag || '-' || v_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, v_brand, 'A2947 ' || p_tag, 'a2947-' || p_tag || '-' || o_event,
            'event', 'scheduled', 'public', 'UTC', 'USD', now(),
            jsonb_build_object('business_event', jsonb_build_object(
              'format', 'in_person', 'hideAddressUntilTicket', false,
              'settings', jsonb_build_object('privateGuestList', false))));
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '20 days', now() + interval '20 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, quantity_total, currency, waitlist_enabled)
    VALUES (o_tier, o_event, 'GA', 0, 100, 'USD', true);
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.a2947_hold(p_event uuid, p_tier uuid, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Adv Guest', 'adv@example.test', '+15550002948', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_tier, 'quantity', 1)),
    'a2947:' || gen_random_uuid()::text, p_expires, 0, 'auto', NULL);
  RETURN (v ->> 'checkoutSessionId')::uuid;
END
$f$;

-- ─── TA-1: refunded ticket + expired hold share one join-order drain ────────
BEGIN;
DO $ta1$
DECLARE
  f record;
  v_session uuid;
  v_order uuid;
  v_ticket uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_invited text[];
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('ta1');

  -- Three waiters in join order A → B → C.
  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES (f.o_event, f.o_tier, 'a@example.test', 'A', 'waiting', 1, now() - interval '30 minutes')
  RETURNING id INTO v_a;
  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES (f.o_event, f.o_tier, 'b@example.test', 'B', 'waiting', 1, now() - interval '20 minutes')
  RETURNING id INTO v_b;
  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES (f.o_event, f.o_tier, 'c@example.test', 'C', 'waiting', 1, now() - interval '10 minutes')
  RETURNING id INTO v_c;

  -- Path 1: refund a real ticket → frees 1 seat → invites A.
  INSERT INTO public.orders(id, event_id, payment_status, payment_method, source, total_cents, currency, buyer_email, buyer_phone_e164)
  VALUES (gen_random_uuid(), f.o_event, 'paid', 'free', 'online_checkout', 0, 'USD', 'buyer@example.test', '+15550002947')
  RETURNING id INTO v_order;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status)
  VALUES (gen_random_uuid(), v_order, f.o_tier, f.o_event, 'a2947-ta1-' || gen_random_uuid()::text, 'valid')
  RETURNING id INTO v_ticket;
  UPDATE public.tickets SET status = 'refunded' WHERE id = v_ticket;

  PERFORM pg_temp.a2947_assert(
    (SELECT status FROM public.waitlist_entries WHERE id = v_a) = 'invited'
    AND (SELECT status FROM public.waitlist_entries WHERE id = v_b) = 'waiting',
    'TA-1a ticket refund invites the oldest waiter (A)');

  -- Path 2: expire a hold → frees 1 seat → invites B (same function, same order).
  v_session := pg_temp.a2947_hold(f.o_event, f.o_tier, now() - interval '25 minutes');
  PERFORM public.issue_2947_expire_no_ref_holds(clock_timestamp(), 5000);
  PERFORM public.issue_2947_waitlist_drain_for_ticket_type(f.o_tier, 1);

  PERFORM pg_temp.a2947_assert(
    (SELECT status FROM public.waitlist_entries WHERE id = v_b) = 'invited'
    AND (SELECT status FROM public.waitlist_entries WHERE id = v_c) = 'waiting',
    'TA-1b hold expiry invites the next waiter (B); C still waiting');

  SELECT array_agg(email ORDER BY invited_at ASC, created_at ASC)
    INTO v_invited
    FROM public.waitlist_entries
   WHERE ticket_type_id = f.o_tier AND status = 'invited';
  PERFORM pg_temp.a2947_assert(v_invited = ARRAY['a@example.test','b@example.test'],
    'TA-1c interleaved paths preserve a single join order');
END
$ta1$;
ROLLBACK;

-- ─── TA-2: idempotent under waitlist_invite key ─────────────────────────────
BEGIN;
DO $ta2$
DECLARE
  f record;
  v_w uuid;
  v_n1 int;
  v_n2 int;
BEGIN
  SELECT * INTO f FROM pg_temp.a2947_tier('ta2');
  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested)
  VALUES (f.o_event, f.o_tier, 'idem@example.test', 'Idem', 'waiting', 1)
  RETURNING id INTO v_w;

  PERFORM public.issue_2947_waitlist_drain_for_ticket_type(f.o_tier, 1);
  SELECT count(*) INTO v_n1 FROM public.ticket_order_notifications
   WHERE idempotency_key = 'waitlist_invite:' || v_w::text;

  -- Re-run with another freed seat while the entry is already invited:
  -- must not mint a second notification for the same entry.
  PERFORM public.issue_2947_waitlist_drain_for_ticket_type(f.o_tier, 1);
  SELECT count(*) INTO v_n2 FROM public.ticket_order_notifications
   WHERE idempotency_key = 'waitlist_invite:' || v_w::text;

  PERFORM pg_temp.a2947_assert(v_n1 = 1 AND v_n2 = 1,
    'TA-2a re-drain does not double-invite under ON CONFLICT DO NOTHING');
  PERFORM pg_temp.a2947_assert(
    (SELECT status FROM public.waitlist_entries WHERE id = v_w) = 'invited',
    'TA-2b entry stays invited once');
END
$ta2$;
ROLLBACK;

SELECT 'issue_2947 waitlist drain tester adversarial PASS' AS result;
