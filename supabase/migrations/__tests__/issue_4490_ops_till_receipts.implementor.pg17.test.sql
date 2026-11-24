-- #4490 spec 08 O1 receipts: executable PostgreSQL 17 proof for migration
-- 20281203514490 (receipt numbers and snapshots, sending through the outbox,
-- the anonymous receipt page by token, the venue_till_sale claim subject).
-- The suite owns its fixture and rolls back.
--
-- MINGLA-INVARIANT: I-4490-TILL-RECEIPT-SNAPSHOT-IMMUTABLE | issue #4490 | a Till receipt (venue_till_receipts) is written once when its payment is paid and never updated or deleted; later menu, price or footer edits never change it.
-- MINGLA-INVARIANT: I-4490-TILL-RECEIPT-TOKEN-ONLY | issue #4490 | a Till receipt is readable without signing in only through issue_4490_till_receipt_view with the sha256 of its own token; contact and token hash are never granted to a client read.
--
-- 1529: issue_4490_till_receipt_send is a POPULATING producer: the text row
-- carries mingla_e164_country(phone) (asserted RC-S2), the email row NULL.
--
-- FAILS-ON-REVERT: without 20281203514490 the first assertion fails (no
-- venue_till_receipts row is written when a payment is paid).
--
-- TEST-MOD-APPROVED #4490 (08-O1 fix 1, O1-N5): the two payments of RC-3 are
-- taken in one statement block, so they share one paid_at; "paid before" now
-- breaks that tie on the payment sequence (20281203554490), and RC-3b pins it.
-- Before, the tie fell to random uuid order and RC-3 failed about half the runs.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490r_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490R FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490r_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490R FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490R FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490r_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
    ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;
CREATE FUNCTION public.t4490r_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490r_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490r_ok(boolean,text), public.t4490r_expect(text,text,text,text),
  public.t4490r_as(uuid), public.t4490r_service(), public.t4490r_reset() TO PUBLIC;

CREATE TEMP TABLE t4490r_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490r_ids TO PUBLIC;
CREATE FUNCTION public.t4490r_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490r_ids WHERE k = p_k
$f$;
GRANT EXECUTE ON FUNCTION public.t4490r_id(text) TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES','VENUE_TILL']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- Users: 01 owner, 02 seller (venue.sell at A), 03 Till device at A,
-- 04 kitchen/bar at A, 05 check-in only at A, 06 finance manager,
-- 07 another brand's owner.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44900200-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'till-rc-' || n || '@example.test', now(), now()
FROM generate_series(1, 7) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('44900200-0000-4000-8000-000000000001', now()), ('44900200-0000-4000-8000-000000000007', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44900200-0000-4000-9000-000000000010', '44900200-0000-4000-8000-000000000001',
   'Till Receipts 4490', 'till-rc-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44900200-0000-4000-9000-000000000020', '44900200-0000-4000-8000-000000000007',
   'Till Receipts Other 4490', 'till-rc-other-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, address, city, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44900200-0000-4000-9000-0000000000a1', '44900200-0000-4000-9000-000000000010', 'tillrca', 'Receipt Bar A',
   '1 Admiralty Way', 'Lagos', 6.45, 3.40, 'bar_lounge', 'verified', 'NG'),
  ('44900200-0000-4000-9000-0000000000c1', '44900200-0000-4000-9000-000000000020', 'tillrcc', 'Receipt Other Bar',
   NULL, NULL, 6.46, 3.42, 'bar_lounge', 'verified', 'NG');
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44900200-0000-4000-a000-000000000002', '44900200-0000-4000-9000-000000000010', '44900200-0000-4000-8000-000000000002', 'venue_staff', now()),
  ('44900200-0000-4000-a000-000000000003', '44900200-0000-4000-9000-000000000010', '44900200-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44900200-0000-4000-a000-000000000004', '44900200-0000-4000-9000-000000000010', '44900200-0000-4000-8000-000000000004', 'venue_staff', now()),
  ('44900200-0000-4000-a000-000000000005', '44900200-0000-4000-9000-000000000010', '44900200-0000-4000-8000-000000000005', 'venue_staff', now()),
  ('44900200-0000-4000-a000-000000000006', '44900200-0000-4000-9000-000000000010', '44900200-0000-4000-8000-000000000006', 'finance_manager', now());
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44900200-0000-4000-a000-000000000002', '44900200-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.sell']),
  ('44900200-0000-4000-a000-000000000003', '44900200-0000-4000-9000-0000000000a1', 'till_device',
   ARRAY['venue.till_device', 'venue.sell', 'venue.kitchen', 'venue.check_in']),
  ('44900200-0000-4000-a000-000000000004', '44900200-0000-4000-9000-0000000000a1', 'kitchen_bar', ARRAY['venue.kitchen']),
  ('44900200-0000-4000-a000-000000000005', '44900200-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']);
INSERT INTO public.menus (id, brand_id, venue_id, name, is_active) VALUES
  ('44900200-0000-4000-b000-000000000001', '44900200-0000-4000-9000-000000000010', '44900200-0000-4000-9000-0000000000a1', 'Bar', true);
INSERT INTO public.menu_items (id, menu_id, brand_id, name, price_cents, currency, is_available) VALUES
  ('44900200-0000-4000-b000-000000000011', '44900200-0000-4000-b000-000000000001', '44900200-0000-4000-9000-000000000010', 'Chapman', 250000, 'NGN', true);
INSERT INTO public.venue_ordering_settings (venue_id, brand_id, service_charge_bps)
VALUES ('44900200-0000-4000-9000-0000000000a1', '44900200-0000-4000-9000-000000000010', 1000)
ON CONFLICT (venue_id) DO UPDATE SET service_charge_bps = 1000;
INSERT INTO public.venue_till_settings (venue_id, brand_id, receipt_footer)
VALUES ('44900200-0000-4000-9000-0000000000a1', '44900200-0000-4000-9000-000000000010', 'Thank you. See you soon.');

SELECT public.t4490r_as('44900200-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44900200-0000-4000-9000-0000000000a1', 'till', true, NULL, NULL, NULL, 'rc-till-on');
SELECT public.t4490r_reset();

-- A menu round exactly as the edge inserts it (held), then attached.
CREATE FUNCTION public.t4490r_sale(p_key text, p_label text, p_qty integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v jsonb;
  v_sale public.venue_till_sales%ROWTYPE;
  v_order uuid := gen_random_uuid();
  v_sub integer := 250000 * p_qty;
  v_sc integer := round(v_sub * 1000 / 10000.0);
BEGIN
  v := public.issue_4490_till_open('44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000002', NULL, p_label, NULL, p_key);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = (v->>'id')::uuid;
  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, source, taken_by_user_id, pickup_code, buyer_name,
    money_path, currency, subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents,
    tip_cents, effective_take_rate_bps, service_fee_bps, pass_mingla_fee, pass_service_fee, pass_tax,
    buyer_subtotal_cents, total_cents, payment_status, fulfillment_status, idempotency_key, metadata
  ) VALUES (
    v_order, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, 'staff', '44900200-0000-4000-8000-000000000002',
    lpad((100 + floor(random() * 800))::int::text, 3, '0'), p_label,
    'venue_collected', 'NGN', v_sub, v_sub, 0, 1000, v_sc, 0, 0, 0, false, false, false,
    v_sub + v_sc, v_sub + v_sc, 'pending', 'held', 'till-rc-round:' || v_order,
    jsonb_build_object('unsettled_staff_order', true, 'till_sale_id', v_sale.id));
  INSERT INTO public.venue_order_items (venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents,
    currency, quantity, modifiers_total_cents, line_total_cents)
  VALUES (v_order, '44900200-0000-4000-b000-000000000011', 1, 'Chapman', 250000, 'NGN', p_qty, 0, 250000 * p_qty);
  PERFORM public.issue_4490_till_attach_round(v_sale.id, v_order, '44900200-0000-4000-8000-000000000002', NULL);
  RETURN v_sale.id;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490r_sale(text, text, integer) TO PUBLIC;
CREATE FUNCTION public.t4490r_pay(p_sale uuid, p_amount bigint, p_given bigint, p_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_till_take_payment(p_sale, 'cash', p_amount, 0, p_given,
    '44900200-0000-4000-8000-000000000002', '44900200-0000-4000-8000-000000000002', p_key,
    (SELECT version FROM public.venue_till_sales WHERE id = p_sale));
  RETURN (v->>'paymentId')::uuid;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490r_pay(uuid, bigint, bigint, uuid) TO PUBLIC;

-- -------------------------------------------------------------------------
-- Snapshots and numbers.
-- -------------------------------------------------------------------------
SELECT public.t4490r_service();
DO $snap$
DECLARE
  v_sale uuid;
  v_sale2 uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
  r jsonb;
BEGIN
  -- 2 x Chapman 2,500.00 = 5,000.00 + 10% = 5,500.00. Paid in two: 2,000 then 3,500 (cash 5,000 given).
  v_sale := public.t4490r_sale('rc-open-1', 'Tolu', 2);
  v_p1 := public.t4490r_pay(v_sale, 200000, 200000, '44900200-0000-4000-c000-000000000001');
  v_p2 := public.t4490r_pay(v_sale, 350000, 500000, '44900200-0000-4000-c000-000000000002');
  INSERT INTO t4490r_ids VALUES ('sale1', v_sale), ('p1', v_p1), ('p2', v_p2);
  PERFORM public.t4490r_ok((SELECT count(*) FROM public.venue_till_receipts WHERE payment_id IN (v_p1, v_p2)) = 2,
    'RC-1 every paid Till payment gets a receipt when the money lands');
  PERFORM public.t4490r_ok(
    (SELECT receipt_no FROM public.venue_till_receipts WHERE payment_id = v_p1) = 1
    AND (SELECT receipt_no FROM public.venue_till_receipts WHERE payment_id = v_p2) = 2
    AND (SELECT last_receipt_no FROM public.venue_till_settings
         WHERE venue_id = '44900200-0000-4000-9000-0000000000a1') = 2,
    'RC-2 receipts are numbered per venue, in order');
  r := public.issue_4490_till_receipt_projection(v_p2);
  PERFORM public.t4490r_ok(
    r->>'venueName' = 'Receipt Bar A' AND r->>'venueAddress' = '1 Admiralty Way, Lagos'
    AND r->>'brandName' = 'Till Receipts 4490' AND r->>'currency' = 'NGN' AND r->>'checkLabel' = 'Tolu'
    AND jsonb_array_length(r->'lines') = 1 AND r#>>'{lines,0,label}' = 'Chapman'
    AND (r#>>'{lines,0,quantity}')::int = 2 AND (r#>>'{lines,0,amountMinor}')::bigint = 500000
    AND (r->>'subtotalMinor')::bigint = 500000 AND (r->>'serviceChargeMinor')::bigint = 50000
    AND (r->>'totalMinor')::bigint = 550000 AND (r->>'paidBeforeMinor')::bigint = 200000
    AND r#>>'{payment,method}' = 'cash' AND (r#>>'{payment,amountMinor}')::bigint = 350000
    AND (r#>>'{payment,changeMinor}')::bigint = 150000
    AND r#>>'{payment,reference}' = upper(right(replace(v_p2::text, '-', ''), 8))
    AND r->>'footer' = 'Thank you. See you soon.' AND (r->>'receiptNo')::int = 2
    AND (r->>'refundedMinor')::bigint = 0,
    'RC-3 the snapshot carries lines, service charge, total, what was paid before, tender, change, reference, venue, brand, footer');
  PERFORM public.t4490r_ok(
    (SELECT paid_at FROM public.venue_till_payments WHERE id = v_p1) = (SELECT paid_at FROM public.venue_till_payments WHERE id = v_p2)
    AND (SELECT seq FROM public.venue_till_payments WHERE id = v_p1) < (SELECT seq FROM public.venue_till_payments WHERE id = v_p2)
    AND (public.issue_4490_till_receipt_projection(v_p1)->>'paidBeforeMinor')::bigint = 0,
    'RC-3b two payments in one moment: paid-before follows the payment sequence (deterministic)');

  -- Later edits never change a receipt.
  UPDATE public.menu_items SET name = 'Chapman XL', price_cents = 999900 WHERE id = '44900200-0000-4000-b000-000000000011';
  UPDATE public.venue_till_settings SET receipt_footer = 'New footer' WHERE venue_id = '44900200-0000-4000-9000-0000000000a1';
  UPDATE public.venue_listings SET name = 'Renamed Bar' WHERE id = '44900200-0000-4000-9000-0000000000a1';
  r := public.issue_4490_till_receipt_projection(v_p2);
  PERFORM public.t4490r_ok(r#>>'{lines,0,label}' = 'Chapman' AND r->>'footer' = 'Thank you. See you soon.'
      AND r->>'venueName' = 'Receipt Bar A' AND (r->>'totalMinor')::bigint = 550000,
    'RC-4 menu, price, footer and venue-name edits after payment never change the receipt');
  UPDATE public.venue_listings SET name = 'Receipt Bar A' WHERE id = '44900200-0000-4000-9000-0000000000a1';

  -- A second check gets the next number.
  v_sale2 := public.t4490r_sale('rc-open-2', 'Kemi', 1);
  v_p3 := public.t4490r_pay(v_sale2, 275000, 275000, '44900200-0000-4000-c000-000000000003');
  INSERT INTO t4490r_ids VALUES ('sale2', v_sale2), ('p3', v_p3);
  PERFORM public.t4490r_ok((SELECT receipt_no FROM public.venue_till_receipts WHERE payment_id = v_p3) = 3
      AND public.issue_4490_till_receipt_capture(v_p3) = 3,
    'RC-5 the next check takes the next number; capturing again is idempotent');
END
$snap$;
SELECT public.t4490r_expect(
  format($q$UPDATE public.venue_till_receipts SET receipt_no = 99 WHERE payment_id = %L$q$, public.t4490r_id('p1')),
  '42501', 'till_receipt_immutable', 'RC-6 a receipt cannot be changed, even by the service role');
SELECT public.t4490r_expect(
  format($q$DELETE FROM public.venue_till_receipts WHERE payment_id = %L$q$, public.t4490r_id('p1')),
  '42501', 'till_receipt_immutable', 'RC-7 a receipt cannot be deleted');
SELECT public.t4490r_reset();

-- -------------------------------------------------------------------------
-- Sending: rights, contact checks, three sends, outbox rows.
-- -------------------------------------------------------------------------
SELECT public.t4490r_service();
DO $send$
DECLARE
  v jsonb;
  v_p2 uuid := public.t4490r_id('p2');
  v_hash bytea := extensions.digest('k1.' || repeat('A', 43), 'sha256');
BEGIN
  v := public.issue_4490_till_receipt_send(v_p2, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000002', '+2348031234567', 'Ada@Example.com', v_hash);
  PERFORM public.t4490r_ok((v#>>'{queued,sms}')::boolean AND (v#>>'{queued,email}')::boolean
      AND (v->>'sendsLeft')::int = 2,
    'RC-S1 a seller sends a receipt by text and email');
  PERFORM public.t4490r_ok(
    (SELECT count(*) FROM public.notification_outbox WHERE idempotency_key IN (
       'buyer_till_receipt:' || v_p2 || ':sms:1', 'buyer_till_receipt:' || v_p2 || ':email:1')) = 2
    AND (SELECT country_code FROM public.notification_outbox
         WHERE idempotency_key = 'buyer_till_receipt:' || v_p2 || ':sms:1') = 'NG'
    AND (SELECT country_code FROM public.notification_outbox
         WHERE idempotency_key = 'buyer_till_receipt:' || v_p2 || ':email:1') IS NULL
    AND (SELECT contact FROM public.notification_outbox
         WHERE idempotency_key = 'buyer_till_receipt:' || v_p2 || ':email:1') = 'ada@example.com',
    'RC-S2 one outbox row per channel; the text row carries the phone''s country (1529), the email row NULL');
  PERFORM public.t4490r_ok(NOT EXISTS (
      SELECT 1 FROM public.notification_outbox n
      WHERE n.idempotency_key LIKE 'buyer_till_receipt:' || v_p2 || ':%'
        AND (n.payload::text ~ '(\+234|ada@|receipt_token|#t=|http)'
             OR NOT (n.payload ?& ARRAY['till_payment_id', 'till_sale_id', 'venue_id', 'venue_name']))),
    'RC-S3 the payload carries opaque ids and the venue name only: no contact, token or link');
  PERFORM public.t4490r_ok((SELECT receipt_sends = 1 AND receipt_token_hash = v_hash
        AND receipt_phone_e164 = '+2348031234567' AND receipt_email = 'ada@example.com'
      FROM public.venue_till_payments WHERE id = v_p2),
    'RC-S4 the payment keeps the contact, the token hash and the send count');
  -- A Till device login may send; the second send keeps the first token hash.
  v := public.issue_4490_till_receipt_send(v_p2, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000003', NULL, 'ada@example.com', extensions.digest('other', 'sha256'));
  PERFORM public.t4490r_ok((v->>'sendsLeft')::int = 1
      AND (SELECT receipt_token_hash FROM public.venue_till_payments WHERE id = v_p2) = v_hash
      AND EXISTS (SELECT 1 FROM public.notification_outbox WHERE idempotency_key = 'buyer_till_receipt:' || v_p2 || ':email:2')
      AND NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE idempotency_key = 'buyer_till_receipt:' || v_p2 || ':sms:2'),
    'RC-S5 a Till device login re-sends by email only; the link token stays the first one');
  v := public.issue_4490_till_receipt_send(v_p2, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000001', '+2348031234567', NULL, v_hash);
  PERFORM public.t4490r_ok((v->>'sendsLeft')::int = 0, 'RC-S6 the owner sends the third and last time');
END
$send$;
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000002', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p2')),
  'PT409', 'till_receipt_limit', 'RC-S7 a fourth send is refused');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000005', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  '42501', 'not_authorized', 'RC-S8 a check-in-only login cannot send receipts');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000004', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  '42501', 'not_authorized', 'RC-S9 a kitchen-only login cannot send receipts');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000006', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  '42501', 'not_authorized', 'RC-S10 a finance manager without sell rights cannot send receipts (selling is not a money action)');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000007', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  '42501', 'not_authorized', 'RC-S11 another brand''s owner cannot send this venue''s receipts');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000c1',
    '44900200-0000-4000-8000-000000000007', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  'P0002', 'till_payment_not_found', 'RC-S12 naming another venue does not reach the payment');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000002', '08031234567', NULL, extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  '22023', 'till_invalid_payload', 'RC-S13 a number that is not E.164 is refused');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000002', NULL, NULL, extensions.digest('x', 'sha256'))$q$, public.t4490r_id('p3')),
  '22023', 'till_invalid_payload', 'RC-S14 a send with no phone and no email is refused');
SELECT public.t4490r_reset();

-- An unpaid payment has no receipt to send.
SELECT public.t4490r_service();
DO $pending$
DECLARE
  v_sale uuid := public.t4490r_sale('rc-open-3', 'Pending', 1);
  v_pay uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.venue_till_payments (id, sale_id, method, amount_minor, state, taken_by_user_id, device_user_id,
    server_user_id, client_request_id)
  VALUES (v_pay, v_sale, 'own_machine', 100000, 'pending', '44900200-0000-4000-8000-000000000002',
    '44900200-0000-4000-8000-000000000002', '44900200-0000-4000-8000-000000000002', gen_random_uuid());
  INSERT INTO t4490r_ids VALUES ('pending', v_pay);
  PERFORM public.t4490r_ok(NOT EXISTS (SELECT 1 FROM public.venue_till_receipts WHERE payment_id = v_pay),
    'RC-S15 a pending payment has no receipt');
END
$pending$;
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_send(%L, '44900200-0000-4000-9000-0000000000a1',
    '44900200-0000-4000-8000-000000000002', NULL, 'ada@example.com', extensions.digest('x', 'sha256'))$q$, public.t4490r_id('pending')),
  'PT409', 'till_receipt_not_paid', 'RC-S16 a receipt goes out only once the payment is taken');
SELECT public.t4490r_reset();

-- -------------------------------------------------------------------------
-- The receipt page: only with the payment's own token.
-- -------------------------------------------------------------------------
SELECT public.t4490r_service();
DO $view$
DECLARE
  v jsonb;
  v_hash bytea := extensions.digest('k1.' || repeat('A', 43), 'sha256');
BEGIN
  v := public.issue_4490_till_receipt_view(public.t4490r_id('p2'), v_hash);
  PERFORM public.t4490r_ok((v->>'receiptNo')::int = 2 AND v->>'paymentState' = 'paid'
      AND NOT (v ? 'receiptEmail') AND NOT (v::text ~ '(ada@|\+234)'),
    'RC-V1 the right token opens the receipt, which carries no contact');
  -- A refund since payment shows on top of the snapshot.
  PERFORM public.issue_4490_till_refund(public.t4490r_id('p2'), 50000, 0, 'Guest asked', false,
    '44900200-0000-4000-8000-000000000001', '44900200-0000-4000-8000-000000000001', gen_random_uuid());
  v := public.issue_4490_till_receipt_view(public.t4490r_id('p2'), v_hash);
  PERFORM public.t4490r_ok((v->>'refundedMinor')::bigint = 50000 AND jsonb_array_length(v->'refunds') = 1
      AND v->>'paymentState' = 'partially_refunded' AND (v->>'totalMinor')::bigint = 550000,
    'RC-V2 a refund made later shows on the receipt; the receipt itself is unchanged');
END
$view$;
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_view(%L, extensions.digest('wrong', 'sha256'))$q$, public.t4490r_id('p2')),
  'P0002', 'receipt_not_found', 'RC-V3 a wrong token is not found');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_view(%L, extensions.digest('k1.' || repeat('A', 43), 'sha256'))$q$, public.t4490r_id('p3')),
  'P0002', 'receipt_not_found', 'RC-V4 another payment''s token does not open this one (p3 never had a receipt sent)');
SELECT public.t4490r_expect(
  format($q$SELECT public.issue_4490_till_receipt_view(%L, NULL)$q$, public.t4490r_id('p2')),
  'P0002', 'receipt_not_found', 'RC-V5 no token, no receipt');
SELECT public.t4490r_reset();

-- -------------------------------------------------------------------------
-- Who can read what (RLS and grants).
-- -------------------------------------------------------------------------
SELECT public.t4490r_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_till_receipt_view(uuid,bytea)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_receipt_view(uuid,bytea)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_receipt_send(uuid,uuid,uuid,text,text,bytea)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_till_receipt_projection(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_receipt_link_facts(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_till_receipt_capture(uuid)', 'EXECUTE'),
  'RC-G1 every receipt function is service-role only (the page goes through the edge)');
SELECT public.t4490r_ok(
  NOT has_column_privilege('authenticated', 'public.venue_till_payments', 'receipt_token_hash', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.venue_till_payments', 'receipt_email', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.venue_till_payments', 'receipt_phone_e164', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.venue_till_receipts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.venue_till_receipts', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.venue_till_receipts', 'UPDATE'),
  'RC-G2 contact and the token hash never reach a client; nobody writes receipts directly');

SELECT public.t4490r_as('44900200-0000-4000-8000-000000000001');
SELECT public.t4490r_ok((SELECT count(*) FROM public.venue_till_receipts) >= 3,
  'RC-R1 the venue''s owner reads its receipts');
SELECT public.t4490r_as('44900200-0000-4000-8000-000000000003');
SELECT public.t4490r_ok((SELECT count(*) FROM public.venue_till_receipts r
    WHERE r.payment_id = public.t4490r_id('p2')) = 1,
  'RC-R2 a Till device login at the venue reads them');
SELECT public.t4490r_as('44900200-0000-4000-8000-000000000007');
SELECT public.t4490r_ok((SELECT count(*) FROM public.venue_till_receipts r
    WHERE r.payment_id IN (public.t4490r_id('p1'), public.t4490r_id('p2'), public.t4490r_id('p3'))) = 0,
  'RC-R3 another brand''s owner reads none');
SELECT public.t4490r_reset();

-- -------------------------------------------------------------------------
-- The claim subject (spec 06 W1 addendum): a paid Till check resolves.
-- -------------------------------------------------------------------------
SELECT public.t4490r_ok(
  (SELECT r->>'noun' = 'receipt' AND r->>'title' = 'Receipt Bar A' AND r->>'preferredProof' = 'email'
     AND r->>'email' = 'ada@example.com' AND (r->>'claimed')::boolean = false
   FROM (SELECT public.issue_4063_claim_subject('venue_till_sale', public.t4490r_id('sale1')) AS r) x)
  AND public.issue_4063_claim_subject('venue_till_sale', public.t4490r_id('sale2')) IS NOT NULL
  AND public.issue_4063_claim_subject('venue_till_sale', gen_random_uuid()) IS NULL,
  'RC-C1 claim kind venue_till_sale resolves a paid check with noun receipt; an unknown id resolves nothing');

ROLLBACK;
