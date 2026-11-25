-- #4490 07-E (20281203274490): tester adversarial proof for issue_4490_venue_money_day. BEGIN ... ROLLBACK.
--
-- Attacks angles the implementor suite does not cover:
--   T-1 a table deposit paid yesterday and refunded in full today, with the rows shaped the way production
--       writes them (source_refunds.source_id = the reservation checkout session, subject_id = the reservation,
--       reservations.payment_status flips to 'refunded' when the refund settles). Yesterday's "Paid in" must
--       keep the deposit it received; today's "Paid in" carries the refund once; the booking nets to zero.
--   T-2 a partial refund of a deposit for a booking dated today (production-shaped source_id) must come off
--       "For today's bookings".
--   T-3 venue midnight: 23:59:30 local counts today, 00:00:30 local counts tomorrow at a venue with no late
--       hours; at a venue whose today closes at 02:00, 01:30 counts today and 02:30 counts tomorrow.
--   T-5 a source refund that ended 'cancelled_no_refund_due' moved no money and is not subtracted
--       (it is inside T-1b / T-2's expected totals).
--   T-6 (N127) cash after midnight with the default paid_on lands on the service night; a chosen paid_on is kept.
--   T-7 (N128) a payment in another currency is not added in and sets otherCurrency.
--   T-4 a stranger cannot read another brand's day money through issue_4490_venue_day.
--
-- Fixture rows are written with session_replication_role = replica (money rows only), like the implementor suite.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '44902800-0000-4000-8000-0000000000f1';
  v_stranger uuid := '44902800-0000-4000-8000-0000000000f2';
  v_brand uuid := '44902800-0000-4000-9000-0000000000f0';
  v_venue uuid := '44902800-0000-4000-9000-0000000000b1';
  v_plain uuid := '44902800-0000-4000-9000-0000000000b2';
  v_late uuid := '44902800-0000-4000-9000-0000000000b3';
  v_tz text;
  v_today date;
  v_noon timestamptz;
  r_yday uuid := gen_random_uuid();
  r_today uuid := gen_random_uuid();
  g_plain uuid := gen_random_uuid();
  g_late uuid := gen_random_uuid();
  m jsonb;
  y jsonb;
  t jsonb;
  v_failed text := '';
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'tm-adv-4490@example.test'), (v_stranger, 'tm-adv-stranger-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'tm-adv-4490@example.test'), (v_stranger, 'tm-adv-stranger-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Today money adv 4490', 'today-money-adv-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
    (v_venue, v_brand, 'tmadv4490a', 'Adv Tables', 6.45, 3.41, 'play', 'verified', 'NG'),
    (v_plain, v_brand, 'tmadv4490b', 'Adv Plain', 6.45, 3.42, 'play', 'verified', 'NG'),
    (v_late, v_brand, 'tmadv4490c', 'Adv Late', 6.45, 3.43, 'club', 'verified', 'NG');
  v_tz := public.issue_4490_venue_timezone(v_venue);
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_noon := (v_today + time '12:00') AT TIME ZONE v_tz;

  SET LOCAL session_replication_role = replica;

  -- T-1 / T-2 table deposits, production-shaped refunds.
  INSERT INTO public.reservations (id, brand_id, venue_id, reserved_for, party_size, fee_cents, payment_status, created_at) VALUES
    (r_yday,  v_brand, v_venue, v_noon + interval '9 hours', 4, 15000, 'refunded', v_noon - interval '1 day'),
    (r_today, v_brand, v_venue, v_noon + interval '8 hours', 2, 10000, 'paid',     v_noon - interval '2 hours');
  INSERT INTO public.source_refunds (source_type, source_id, subject_id, brand_id, venue_id, refund_kind, requested_by_type, reason, provider,
      currency, original_charge_cents, buyer_refund_requested_cents, organizer_refund_liability_cents, platform_fee_absorption_cents,
      idempotency_key, buyer_state, requested_at, provider_payment_reference, buyer_refund_processed_cents, financial_state) VALUES
    ('venue_reservation', gen_random_uuid(), r_yday, v_brand, v_venue, 'venue_eligible_cancel', 'guest', 'cancelled', 'paystack',
      'NGN', 15000, 15000, 15000, 0, 'adv-srefund-1', 'processed', v_noon, 'adv-ref-1', 15000, 'pending'),
    ('venue_reservation', gen_random_uuid(), r_today, v_brand, v_venue, 'venue_eligible_cancel', 'guest', 'one less', 'paystack',
      'NGN', 10000, 3000, 3000, 0, 'adv-srefund-2', 'queued', v_noon, 'adv-ref-2', 0, 'pending'),
    -- T-5 a refund row that ended with no refund due moved no money: it must not be subtracted.
    ('venue_reservation', gen_random_uuid(), r_today, v_brand, v_venue, 'venue_eligible_cancel', 'guest', 'late cancel', 'paystack',
      'NGN', 10000, 4000, 4000, 0, 'adv-srefund-3', 'cancelled_no_refund_due', v_noon, 'adv-ref-3', 0, 'reconciled');

  -- T-3 midnight boundaries: one booking group per venue, online payments at the edges.
  INSERT INTO public.stay_reservation_groups (id, public_reference, quote_id, actor_key_hash, venue_id, brand_id, currency_code, mode, state,
      guest_snapshot, source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash, offer_kind, payment_collection, payment_plan_snapshot)
  SELECT g, 'VB-' || upper(left(replace(g::text, '-', ''), 20)), gen_random_uuid(), repeat('a', 64), ven, v_brand, 'NGN', 'instant', 'confirmed',
      '{}'::jsonb, 0, 0, 0, 0, 'adv-' || g, repeat('a', 64), 'entry', 'mingla', '{"mode":"full"}'::jsonb
  FROM (VALUES (g_plain, v_plain), (g_late, v_late)) AS x(g, ven);
  INSERT INTO public.stay_payment_attempts (id, group_id, provider, attempt_ordinal, amount_minor, currency_code, idempotency_key, request_hash, state, succeeded_at) VALUES
    (gen_random_uuid(), g_plain, 'paystack', 1, 100, 'NGN', 'adv-attempt-1', repeat('a', 64), 'succeeded', ((v_today + time '23:59:30') AT TIME ZONE v_tz)),
    (gen_random_uuid(), g_plain, 'paystack', 2, 200, 'NGN', 'adv-attempt-2', repeat('a', 64), 'succeeded', (((v_today + 1) + time '00:00:30') AT TIME ZONE v_tz)),
    (gen_random_uuid(), g_late,  'paystack', 1, 400, 'NGN', 'adv-attempt-3', repeat('a', 64), 'succeeded', (((v_today + 1) + time '01:30') AT TIME ZONE v_tz)),
    (gen_random_uuid(), g_late,  'paystack', 2, 800, 'NGN', 'adv-attempt-4', repeat('a', 64), 'succeeded', (((v_today + 1) + time '02:30') AT TIME ZONE v_tz));
  -- The late venue: today opens 20:00 and closes 02:00 (weekday = isodow - 1, as issue_4490_venue_service_date reads it).
  INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
    VALUES (v_brand, v_late, extract(isodow FROM v_today)::integer - 1, time '20:00', time '02:00', false);
  SET LOCAL session_replication_role = origin;

  -- T-1 yesterday received the deposit; today carries the full refund once.
  y := public.issue_4490_venue_money_day(v_venue, v_today - 1);
  m := public.issue_4490_venue_money_day(v_venue, v_today);
  IF (y->'paidIn'->>'tableDeposits')::bigint <> 15000 THEN
    v_failed := v_failed || format(E'\nT-1 FAIL: yesterday''s Paid in lost the 15,000 deposit it received once the refund settled (yesterday tableDeposits=%s)', y->'paidIn'->>'tableDeposits');
  ELSE
    RAISE NOTICE 'PASS  T-1a yesterday keeps the deposit it received';
  END IF;
  IF (m->'paidIn'->>'refunded')::bigint <> 18000 OR (m->'paidIn'->>'tableDeposits')::bigint <> 10000 THEN
    v_failed := v_failed || format(E'\nT-1 FAIL: today paidIn %s (want tableDeposits 10000, refunded 18000)', m->'paidIn');
  ELSE
    RAISE NOTICE 'PASS  T-1b today counts today''s deposit and both refunds raised today';
  END IF;
  IF (y->>'paidInMinor')::bigint + (m->>'paidInMinor')::bigint <> 15000 + 10000 - 18000 THEN
    v_failed := v_failed || format(E'\nT-1 FAIL: across the two days Paid in sums to %s, want 7000 (25,000 received - 18,000 refunded)',
      (y->>'paidInMinor')::bigint + (m->>'paidInMinor')::bigint);
  ELSE
    RAISE NOTICE 'PASS  T-1c the two days add up to money received minus money refunded';
  END IF;

  -- T-2 For today's bookings: 15,000 refunded in full nets 0; 10,000 less 3,000 refunded nets 7,000.
  IF (m->>'forTodayPaidMinor')::bigint <> 7000 THEN
    v_failed := v_failed || format(E'\nT-2 FAIL: For today''s bookings = %s, want 7000 (forToday %s)', m->>'forTodayPaidMinor', m->'forToday');
  ELSE
    RAISE NOTICE 'PASS  T-2 For today''s bookings is net of table-deposit refunds';
  END IF;

  -- T-3 midnight.
  t := public.issue_4490_venue_money_day(v_plain, v_today);
  IF (t->'paidIn'->>'online')::bigint <> 100 THEN
    v_failed := v_failed || format(E'\nT-3 FAIL: plain venue today online=%s, want 100 (23:59:30 in, 00:00:30 out)', t->'paidIn'->>'online');
  END IF;
  t := public.issue_4490_venue_money_day(v_plain, v_today + 1);
  IF (t->'paidIn'->>'online')::bigint <> 200 THEN
    v_failed := v_failed || format(E'\nT-3 FAIL: plain venue tomorrow online=%s, want 200', t->'paidIn'->>'online');
  END IF;
  t := public.issue_4490_venue_money_day(v_late, v_today);
  IF (t->'paidIn'->>'online')::bigint <> 400 THEN
    v_failed := v_failed || format(E'\nT-3 FAIL: late venue today online=%s, want 400 (01:30 before the 02:00 close is still today)', t->'paidIn'->>'online');
  END IF;
  t := public.issue_4490_venue_money_day(v_late, v_today + 1);
  IF (t->'paidIn'->>'online')::bigint <> 800 THEN
    v_failed := v_failed || format(E'\nT-3 FAIL: late venue tomorrow online=%s, want 800', t->'paidIn'->>'online');
  END IF;
  IF v_failed !~ 'T-3' THEN RAISE NOTICE 'PASS  T-3 venue midnight and late-close service days'; END IF;

  -- T-6 (N127) cash at the late venue: recorded 01:30 after today's 02:00 close with the default paid_on
  -- (the calendar day) counts on tonight; cash recorded tomorrow morning with paid_on chosen as today counts today;
  -- a day staff chose explicitly is kept (recorded tonight 22:00, paid_on chosen as tomorrow, counts tomorrow).
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.venue_offline_payments (group_id, amount_minor, currency_code, method, paid_on, idempotency_key, request_hash, created_at) VALUES
    (g_late, 1600, 'NGN', 'cash', v_today + 1, 'adv-offline-1', repeat('a', 64), ((v_today + 1) + time '01:30') AT TIME ZONE v_tz),
    (g_late, 3200, 'NGN', 'cash', v_today,     'adv-offline-2', repeat('a', 64), ((v_today + 1) + time '10:00') AT TIME ZONE v_tz),
    (g_late, 6400, 'NGN', 'transfer', v_today + 1, 'adv-offline-3', repeat('a', 64), (v_today + time '22:00') AT TIME ZONE v_tz);
  -- T-7 (N128) a GBP payment at the plain venue today is not added into NGN.
  INSERT INTO public.stay_payment_attempts (id, group_id, provider, attempt_ordinal, amount_minor, currency_code, idempotency_key, request_hash, state, succeeded_at) VALUES
    (gen_random_uuid(), g_plain, 'stripe', 3, 999, 'GBP', 'adv-attempt-gbp', repeat('a', 64), 'succeeded', v_noon);
  SET LOCAL session_replication_role = origin;
  t := public.issue_4490_venue_money_day(v_late, v_today);
  IF (t->'paidIn'->>'atVenue')::bigint <> 1600 + 3200 THEN
    v_failed := v_failed || format(E'\nT-6 FAIL: late venue tonight atVenue=%s, want 4800 (01:30 default-day cash + morning cash dated tonight)', t->'paidIn'->>'atVenue');
  END IF;
  t := public.issue_4490_venue_money_day(v_late, v_today + 1);
  IF (t->'paidIn'->>'atVenue')::bigint <> 6400 THEN
    v_failed := v_failed || format(E'\nT-6 FAIL: late venue tomorrow atVenue=%s, want 6400 (staff-chosen day kept)', t->'paidIn'->>'atVenue');
  END IF;
  IF v_failed !~ 'T-6' THEN RAISE NOTICE 'PASS  T-6 cash lands on the service night; a chosen day is kept'; END IF;
  t := public.issue_4490_venue_money_day(v_plain, v_today);
  IF (t->'paidIn'->>'online')::bigint <> 100 OR COALESCE((t->>'otherCurrency')::boolean, false) IS NOT TRUE THEN
    v_failed := v_failed || format(E'\nT-7 FAIL: plain venue today %s (want NGN online 100 and otherCurrency true)', t);
  ELSE
    RAISE NOTICE 'PASS  T-7 a GBP payment is kept out of the NGN total and flagged';
  END IF;

  -- T-4 a stranger (no role on the brand) cannot read the day.
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.issue_4490_venue_day(v_venue, v_today);
    v_failed := v_failed || E'\nT-4 FAIL: a stranger read another brand''s day money';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  T-4 a stranger is refused (not_authorized)';
  END;
  IF has_function_privilege('anon', 'public.issue_4490_venue_day(uuid,date)', 'EXECUTE') THEN
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      PERFORM public.issue_4490_venue_day(v_venue, v_today);
      v_failed := v_failed || E'\nT-4 FAIL: anon read the day money';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS  T-4b anon is refused (not_authorized)';
    END;
  ELSE
    RAISE NOTICE 'PASS  T-4b anon has no EXECUTE on issue_4490_venue_day';
  END IF;

  IF v_failed <> '' THEN
    RAISE EXCEPTION 'issue #4490 07-E tester adversarial FAILED:%', v_failed;
  END IF;
END
$test$;

ROLLBACK;
\echo 'issue #4490 07-E tester adversarial: all cases passed'
