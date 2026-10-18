-- #2879 / #2947 slices 4+5 — implementor happy path for waitlist drain + free expire.
-- Run after the full migration chain on PostgreSQL 17 as the database owner.
-- Every case rolls back.
--
-- WHAT IS PROVED
--   C-01  expire a NO_REF hold → waiting waitlist entry flips to invited, notification
--         minted, join order respected (oldest waiting first).
--   C-02  set-based expire_no_ref_holds clears many free holds and never touches
--         a PAYSTACK (mingla_*) or Stripe PI row.
--   C-03  fn_waitlist_drain_on_capacity_freed delegates (refunded ticket path).
--
-- FAILS-ON-REVERT: drop issue_2947_waitlist_drain_for_ticket_type / expire_no_ref
-- → C-01/C-02 fail at first call.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.w2947_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2947 waitlist drain FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.w2947_tier(p_tag text, OUT o_event uuid, OUT o_tier uuid, OUT o_brand uuid)
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_tier := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (v_user, 'w2947-' || p_tag || '-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
                            pricing_currency, default_currency)
    VALUES (o_brand, v_user, 'W2947 ' || p_tag, 'w2947-' || p_tag || '-' || o_brand,
            'stripe', 'US', 'USD', 'USD');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, currency, published_at, theme)
    VALUES (o_event, o_brand, 'W2947 ' || p_tag, 'w2947-' || p_tag || '-' || o_event,
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

CREATE OR REPLACE FUNCTION pg_temp.w2947_hold(p_event uuid, p_tier uuid, p_qty integer, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Drain Guest', 'drain@example.test', '+15550002947', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_tier, 'quantity', p_qty)),
    'w2947:' || gen_random_uuid()::text, p_expires, 0, 'auto', NULL);
  RETURN (v ->> 'checkoutSessionId')::uuid;
END
$f$;

-- ─── C-01: expire hold → waitlist invited in join order ─────────────────────
BEGIN;
DO $c01$
DECLARE
  f record;
  v_session uuid;
  v_w1 uuid; v_w2 uuid; v_w3 uuid;
  v_result jsonb;
  v_invited uuid;
  v_notif uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.w2947_tier('c01');

  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES
    (f.o_event, f.o_tier, 'first@example.test', 'First', 'waiting', 1, now() - interval '3 minutes')
    RETURNING id INTO v_w1;
  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES
    (f.o_event, f.o_tier, 'second@example.test', 'Second', 'waiting', 1, now() - interval '2 minutes')
    RETURNING id INTO v_w2;
  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES
    (f.o_event, f.o_tier, 'third@example.test', 'Third', 'waiting', 1, now() - interval '1 minutes')
    RETURNING id INTO v_w3;

  v_session := pg_temp.w2947_hold(f.o_event, f.o_tier, 1, now() - interval '20 minutes');

  v_result := public.issue_2947_expire_no_ref_holds(clock_timestamp(), 5000);
  PERFORM pg_temp.w2947_assert((v_result ->> 'expired_count')::int = 1,
    'C-01a one NO_REF hold expired');
  PERFORM pg_temp.w2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_session) = 'expired'
    AND (SELECT failure_reason FROM public.ticket_checkout_sessions WHERE id = v_session)
        = 'abandoned_past_expiry',
    'C-01b session stamped abandoned_past_expiry');

  PERFORM public.issue_2947_waitlist_drain_for_ticket_type(
    f.o_tier,
    ((v_result -> 'freed' -> 0 ->> 'freed_qty')::int)
  );

  SELECT id, notification_id INTO v_invited, v_notif
    FROM public.waitlist_entries WHERE id = v_w1;
  PERFORM pg_temp.w2947_assert(
    (SELECT status FROM public.waitlist_entries WHERE id = v_w1) = 'invited'
    AND (SELECT status FROM public.waitlist_entries WHERE id = v_w2) = 'waiting'
    AND (SELECT status FROM public.waitlist_entries WHERE id = v_w3) = 'waiting',
    'C-01c oldest waiting entry invited; later ones stay waiting');
  PERFORM pg_temp.w2947_assert(v_notif IS NOT NULL, 'C-01d notification_id set');
  PERFORM pg_temp.w2947_assert(
    EXISTS (
      SELECT 1 FROM public.ticket_order_notifications n
       WHERE n.id = v_notif
         AND n.idempotency_key = 'waitlist_invite:' || v_w1::text
         AND n.payload ->> 'template_key' = 'waitlist_spot_open'
    ),
    'C-01e waitlist_spot_open notification minted with stable idempotency key');
END
$c01$;
ROLLBACK;

-- ─── C-02: set-based arm skips PAYSTACK and Stripe refs ─────────────────────
BEGIN;
DO $c02$
DECLARE
  f record;
  v_free uuid;
  v_paystack uuid;
  v_stripe uuid;
  v_result jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.w2947_tier('c02');
  v_free := pg_temp.w2947_hold(f.o_event, f.o_tier, 1, now() - interval '30 minutes');
  v_paystack := pg_temp.w2947_hold(f.o_event, f.o_tier, 1, now() - interval '30 minutes');
  v_stripe := pg_temp.w2947_hold(f.o_event, f.o_tier, 1, now() - interval '30 minutes');

  -- Paint the live shapes: mingla_* → PAYSTACK; pi_* → STRIPE_PI.
  UPDATE public.ticket_checkout_sessions
     SET stripe_payment_intent_id = 'mingla_' || replace(id::text, '-', ''),
         status = 'awaiting_web_redirect'
   WHERE id = v_paystack;
  UPDATE public.ticket_checkout_sessions
     SET stripe_payment_intent_id = 'pi_test_' || substr(replace(id::text, '-', ''), 1, 16),
         stripe_account_id = 'acct_test',
         status = 'processing_payment'
   WHERE id = v_stripe;

  v_result := public.issue_2947_expire_no_ref_holds(clock_timestamp(), 5000);
  PERFORM pg_temp.w2947_assert((v_result ->> 'expired_count')::int = 1,
    'C-02a only the free hold expired');
  PERFORM pg_temp.w2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_free) = 'expired',
    'C-02b free hold expired');
  PERFORM pg_temp.w2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_paystack) = 'awaiting_web_redirect',
    'C-02c PAYSTACK row untouched');
  PERFORM pg_temp.w2947_assert(
    (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_stripe) = 'processing_payment',
    'C-02d Stripe PI row untouched');
END
$c02$;
ROLLBACK;

-- ─── C-03: ticket refund path still drains via delegated trigger ────────────
BEGIN;
DO $c03$
DECLARE
  f record;
  v_order uuid;
  v_ticket uuid;
  v_w uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.w2947_tier('c03');

  INSERT INTO public.waitlist_entries(event_id, ticket_type_id, email, name, status, qty_requested, created_at)
  VALUES (f.o_event, f.o_tier, 'trig@example.test', 'Trig', 'waiting', 1, now() - interval '5 minutes')
  RETURNING id INTO v_w;

  INSERT INTO public.orders(id, event_id, payment_status, payment_method, source, total_cents, currency, buyer_email)
  VALUES (gen_random_uuid(), f.o_event, 'paid', 'free', 'online_checkout', 0, 'USD', 'buyer@example.test')
  RETURNING id INTO v_order;

  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status)
  VALUES (gen_random_uuid(), v_order, f.o_tier, f.o_event, 'w2947-c03-' || gen_random_uuid()::text, 'valid')
  RETURNING id INTO v_ticket;

  UPDATE public.tickets SET status = 'refunded' WHERE id = v_ticket;

  PERFORM pg_temp.w2947_assert(
    (SELECT status FROM public.waitlist_entries WHERE id = v_w) = 'invited',
    'C-03a refunded ticket drains waitlist via delegated trigger');
  PERFORM pg_temp.w2947_assert(
    EXISTS (
      SELECT 1 FROM public.ticket_order_notifications
       WHERE idempotency_key = 'waitlist_invite:' || v_w::text
    ),
    'C-03b notification minted on ticket path');
END
$c03$;
ROLLBACK;

SELECT 'issue_2947 waitlist drain implementor happy PASS' AS result;
