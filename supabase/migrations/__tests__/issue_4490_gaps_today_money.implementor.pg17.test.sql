-- #4490 gap list 07-E (20281203274490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-TODAY-MONEY-IS-MONEY | issue #4490 | Today's money is computed only in SQL (issue_4490_venue_money_day): "Paid in today" is money received that service day for any date (online + at the venue + members paid at the venue + table deposits - refunds raised that day) and never counts an unpaid pay-at-venue booking or a deposit again on a later day; "For today's bookings" is the money paid so far for entry, package, hire and by-the-hour bookings and table reservations dated that day, net of their refunds.
--
-- The fixture is money rows only, written with triggers and FKs off (session_replication_role = replica) so
-- every amount is exact; the function reads the same columns production writes.
-- E-1 every part of "Paid in today".  E-2 every part of "For today's bookings".  E-3 venue_day carries it and
-- collected_on is gone.  E-4 a stranger and anon cannot call it.  E-5 another venue's money is not counted.
--
-- FAILS-ON-REVERT (seen 20 Nov): without 20281203274490 issue_4490_venue_money_day does not exist (E-1 fails)
-- and venue_day still returns collectedToday (E-3 fails). N127 E-6 (seen 20 Nov): with paid_on as a calendar day,
-- 01:00 cash after a 02:00 close lands on tomorrow and E-6 fails.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner uuid := '44902800-0000-4000-8000-000000000001';
  v_brand uuid := '44902800-0000-4000-9000-000000000010';
  v_venue uuid := '44902800-0000-4000-9000-0000000000a1';
  v_other uuid := '44902800-0000-4000-9000-0000000000a2';
  v_today date;
  v_noon timestamptz;
  v_yday timestamptz;
  v_offer uuid := gen_random_uuid();
  v_moffer uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_sub uuid := gen_random_uuid();
  v_w_today uuid := gen_random_uuid();
  v_w_later uuid := gen_random_uuid();
  g_future uuid := gen_random_uuid();
  g_today uuid := gen_random_uuid();
  g_property uuid := gen_random_uuid();
  g_member uuid := gen_random_uuid();
  g_other uuid := gen_random_uuid();
  r_today uuid := gen_random_uuid();
  a_today uuid := gen_random_uuid();
  m jsonb;
  d jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'today-money-4490@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'today-money-4490@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, payment_country, pricing_region, pricing_currency)
    VALUES (v_brand, v_owner, 'Today money 4490', 'today-money-4490', 'NGN', 'paystack', 'NG', 'NG', 'NGN');
  INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
    (v_venue, v_brand, 'todaymoney4490', 'Club Money', 6.45, 3.41, 'play', 'verified', 'NG'),
    (v_other, v_brand, 'othermoney4490', 'Other Money', 6.45, 3.42, 'play', 'verified', 'NG');
  v_today := (now() AT TIME ZONE public.issue_4490_venue_timezone(v_venue))::date;
  v_noon := (v_today + time '12:00') AT TIME ZONE public.issue_4490_venue_timezone(v_venue);
  v_yday := v_noon - interval '1 day';

  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_offerings (id, venue_id, brand_id, kind, name, inventory_basis, capacity, max_adults, max_children,
      place_pricing_basis, entry_style) VALUES
    (v_offer, v_venue, v_brand, 'entry', 'Club entry', 'shared_capacity', 100, NULL, NULL, 'per_guest', 'walk_in'),
    (v_moffer, v_venue, v_brand, 'membership', 'Members', 'shared_capacity', 100, NULL, NULL, 'per_guest', NULL);
  INSERT INTO public.venue_membership_plans (id, offering_id, price_option_id, brand_id, name, price_minor, currency_code)
    VALUES (v_plan, v_moffer, gen_random_uuid(), v_brand, 'Monthly', 40000, 'NGN');
  INSERT INTO public.venue_membership_subscriptions (id, plan_id, brand_id, member_name, member_email, member_token_hash,
      qr_token_hash, start_on, terms, actor_key_hash, idempotency_key, request_hash)
    VALUES (v_sub, v_plan, v_brand, 'Ada', 'ada@example.test', decode(repeat('00', 32), 'hex'), repeat('a', 64), v_today, '{}'::jsonb, repeat('a', 64), 'idem-sub-1', repeat('a', 64));
  INSERT INTO public.stay_place_windows (id, offering_id, schedule_rule_id, brand_id, venue_id, local_date, starts_at, ends_at, dst_resolution, sellable_capacity) VALUES
    (v_w_today, v_offer, gen_random_uuid(), v_brand, v_venue, v_today, v_noon + interval '8 hours', v_noon + interval '12 hours', 'unambiguous', 100),
    (v_w_later, v_offer, gen_random_uuid(), v_brand, v_venue, v_today + 10, v_noon + interval '10 days 8 hours', v_noon + interval '10 days 12 hours', 'unambiguous', 100);

  INSERT INTO public.stay_reservation_groups (id, public_reference, quote_id, actor_key_hash, venue_id, brand_id, currency_code, mode, state,
      guest_snapshot, source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash, offer_kind, payment_collection, payment_plan_snapshot)
  SELECT g, 'VB-' || upper(left(replace(g::text, '-', ''), 20)), gen_random_uuid(), repeat('a', 64), ven, v_brand, 'NGN', 'instant', st, '{}'::jsonb, tot, 0, 0, tot, 'idem-' || g, repeat('a', 64), kind, coll, '{"mode":"full"}'::jsonb
  FROM (VALUES
    (g_future, v_venue, 'confirmed', 50000, 'entry', 'mingla'),
    (g_today, v_venue, 'partially_cancelled', 55000, 'entry', 'mingla'),
    (g_property, v_venue, 'confirmed', 99999, 'entry', 'property'),
    (g_member, v_venue, 'confirmed', 25000, 'membership', 'mingla'),
    (g_other, v_other, 'confirmed', 70000, 'entry', 'mingla')
  ) AS x(g, ven, st, tot, kind, coll);
  INSERT INTO public.stay_reservation_lines (group_id, quote_line_id, offering_id, kind, state, base_minor, fee_minor, tax_minor, total_minor,
      offering_snapshot, price_snapshot, policy_snapshot, place_window_id)
  SELECT g, gen_random_uuid(), v_offer, 'entry', 'confirmed', 0, 0, 0, 0, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, w
  FROM (VALUES (g_future, v_w_later), (g_today, v_w_today), (g_property, v_w_today), (g_other, v_w_today)) AS x(g, w);

  -- (a) online: a deposit today for a booking 10 days out; yesterday's payment for tonight; a member month paid online today
  INSERT INTO public.stay_payment_attempts (id, group_id, provider, attempt_ordinal, amount_minor, currency_code, idempotency_key, request_hash, state, succeeded_at) VALUES
    (gen_random_uuid(), g_future, 'paystack', 1, 50000, 'NGN', 'idem-att-1', repeat('a', 64), 'succeeded', v_noon),
    (a_today, g_today, 'paystack', 1, 30000, 'NGN', 'idem-att-2', repeat('a', 64), 'succeeded', v_yday),
    (gen_random_uuid(), g_member, 'paystack', 1, 25000, 'NGN', 'idem-att-3', repeat('a', 64), 'succeeded', v_noon),
    (gen_random_uuid(), g_other, 'paystack', 1, 70000, 'NGN', 'idem-att-4', repeat('a', 64), 'succeeded', v_noon),
    (gen_random_uuid(), g_property, 'paystack', 1, 1, 'NGN', 'idem-att-5', repeat('a', 64), 'failed', NULL);
  -- (b) gate cash for tonight's booking
  INSERT INTO public.venue_offline_payments (group_id, amount_minor, currency_code, method, paid_on, idempotency_key, request_hash, created_at)
    VALUES (g_today, 20000, 'NGN', 'cash', v_today, 'idem-off-1', repeat('a', 64), v_noon);
  -- (c) a member paid at the venue today
  INSERT INTO public.venue_membership_periods (subscription_id, sequence, period_start, period_end, amount_minor, currency_code, due_at, status, paid_via, paid_at, paid_method)
    VALUES (v_sub, 1, v_noon, v_noon + interval '1 month', 40000, 'NGN', v_noon, 'paid', 'venue', v_noon, 'cash');
  -- (d) table deposits: tonight's paid yesterday (and refunded 3,000 today); tomorrow's paid today
  INSERT INTO public.reservations (id, brand_id, venue_id, reserved_for, party_size, fee_cents, payment_status, created_at) VALUES
    (r_today, v_brand, v_venue, v_noon + interval '9 hours', 4, 15000, 'paid', v_yday),
    (gen_random_uuid(), v_brand, v_venue, v_noon + interval '1 day 9 hours', 2, 10000, 'paid', v_noon);
  INSERT INTO public.source_refunds (source_type, source_id, subject_id, brand_id, venue_id, refund_kind, requested_by_type, reason, provider,
      currency, original_charge_cents, buyer_refund_requested_cents, organizer_refund_liability_cents, platform_fee_absorption_cents,
      idempotency_key, buyer_state, requested_at, provider_payment_reference)
    -- N124 (TEST-MOD-APPROVED #4490): production-shaped: source_id = the checkout session, subject_id = the reservation.
    VALUES ('venue_reservation', gen_random_uuid(), r_today, v_brand, v_venue, 'venue_eligible_cancel', 'guest', 'changed plans', 'paystack',
      'NGN', 15000, 3000, 3000, 0, 'idem-sr-1', 'queued', v_noon, 'ref-table-deposit-1');
  -- (e) a stay refund raised today on tonight's booking
  INSERT INTO public.stay_refunds (group_id, payment_attempt_id, cancel_preview_id, requested_by_type, reason, state, amount_minor, currency_code, provider, idempotency_key, created_at)
    VALUES (g_today, a_today, gen_random_uuid(), 'guest', 'one guest dropped', 'succeeded', 5000, 'NGN', 'paystack', 'idem-ref-1', v_noon);
  SET LOCAL session_replication_role = origin;

  m := public.issue_4490_venue_money_day(v_venue, v_today);
  -- E-1 Paid in today = 75,000 online + 20,000 at the venue + 40,000 members + 10,000 table deposits - 8,000 refunded
  IF (m->>'paidInMinor')::bigint <> 137000
     OR (m->'paidIn'->>'online')::bigint <> 75000 OR (m->'paidIn'->>'atVenue')::bigint <> 20000
     OR (m->'paidIn'->>'members')::bigint <> 40000 OR (m->'paidIn'->>'tableDeposits')::bigint <> 10000
     OR (m->'paidIn'->>'refunded')::bigint <> 8000 THEN
    RAISE EXCEPTION 'E-1 FAIL: paid in today %', m;
  END IF;
  RAISE NOTICE 'PASS  E-1 Paid in today 137,000 (future deposit in, unpaid pay-at-venue out, yesterday''s table deposit not again)';
  -- E-2 For today's bookings = 30,000 online + 20,000 gate + 15,000 table deposit - 8,000 refunded
  IF (m->>'forTodayPaidMinor')::bigint <> 57000
     OR (m->'forToday'->>'online')::bigint <> 30000 OR (m->'forToday'->>'atVenue')::bigint <> 20000
     OR (m->'forToday'->>'tableDeposits')::bigint <> 15000 OR (m->'forToday'->>'refunded')::bigint <> 8000
     OR (m->'forToday'->>'members')::bigint <> 0 THEN
    RAISE EXCEPTION 'E-2 FAIL: for today''s bookings %', m;
  END IF;
  RAISE NOTICE 'PASS  E-2 For today''s bookings 57,000 (memberships and the future booking excluded)';
  -- E-5 tomorrow: nothing paid in yet; the future deposit is not "for" tomorrow
  m := public.issue_4490_venue_money_day(v_venue, v_today + 1);
  IF (m->>'paidInMinor')::bigint <> 0 OR (m->'forToday'->>'tableDeposits')::bigint <> 10000 THEN
    RAISE EXCEPTION 'E-5 FAIL: tomorrow %', m;
  END IF;
  m := public.issue_4490_venue_money_day(v_other, v_today);
  IF (m->>'paidInMinor')::bigint <> 70000 THEN RAISE EXCEPTION 'E-5 FAIL: other venue %', m; END IF;
  RAISE NOTICE 'PASS  E-5 another day and another venue keep their own money';

  -- E-6 (N127) one day rule: the other venue closes at 02:00. Cash recorded at
  -- 01:00 after tonight (calendar paid_on = tomorrow, the writer's default)
  -- counts on tonight's service day; cash staff dated for yesterday stays there.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time)
    SELECT v_brand, v_other, wd, time '18:00', time '02:00' FROM generate_series(0, 6) wd;
  INSERT INTO public.venue_offline_payments (group_id, amount_minor, currency_code, method, paid_on, idempotency_key, request_hash, created_at) VALUES
    (g_other, 3000, 'NGN', 'cash', v_today + 1, 'idem-off-late', repeat('a', 64), v_noon + interval '13 hours'),
    (g_other, 500, 'NGN', 'cash', v_today - 1, 'idem-off-back', repeat('a', 64), v_noon);
  SET LOCAL session_replication_role = origin;
  m := public.issue_4490_venue_money_day(v_other, v_today);
  IF (m->'paidIn'->>'atVenue')::bigint <> 3000 THEN RAISE EXCEPTION 'E-6 FAIL: 01:00 cash not on tonight %', m; END IF;
  m := public.issue_4490_venue_money_day(v_other, v_today + 1);
  IF (m->'paidIn'->>'atVenue')::bigint <> 0 THEN RAISE EXCEPTION 'E-6 FAIL: 01:00 cash counted tomorrow %', m; END IF;
  m := public.issue_4490_venue_money_day(v_other, v_today - 1);
  IF (m->'paidIn'->>'atVenue')::bigint <> 500 THEN RAISE EXCEPTION 'E-6 FAIL: a back-dated cash day moved %', m; END IF;
  RAISE NOTICE 'PASS  E-6 cash after midnight counts on the night (service day); a chosen day stays';

  -- E-7 (N128) money in another currency is never added in; the day says so.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_payment_attempts (id, group_id, provider, attempt_ordinal, amount_minor, currency_code, idempotency_key, request_hash, state, succeeded_at)
    VALUES (gen_random_uuid(), g_future, 'stripe', 2, 999, 'GBP', 'idem-att-gbp', repeat('a', 64), 'succeeded', v_noon);
  SET LOCAL session_replication_role = origin;
  m := public.issue_4490_venue_money_day(v_venue, v_today);
  IF (m->'paidIn'->>'online')::bigint <> 75000 OR (m->>'otherCurrency')::boolean IS NOT TRUE OR m->>'currencyCode' <> 'NGN' THEN
    RAISE EXCEPTION 'E-7 FAIL: a GBP payment leaked into the NGN day %', m;
  END IF;
  RAISE NOTICE 'PASS  E-7 another currency is not summed in (otherCurrency flagged)';

  -- E-3 venue_day carries the money; collected_on is gone
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  d := public.issue_4490_venue_day(v_venue, v_today);
  IF (d->'money'->>'paidInMinor')::bigint <> 137000 OR d ? 'collectedToday' OR d ? 'collectedTodayMinor' THEN
    RAISE EXCEPTION 'E-3 FAIL: venue_day money %', d->'money';
  END IF;
  IF to_regprocedure('public.issue_4490_collected_on(uuid,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'E-3 FAIL: issue_4490_collected_on still exists';
  END IF;
  RAISE NOTICE 'PASS  E-3 venue_day returns money; collected_on dropped';
  -- E-4 only service_role may call the helper
  IF has_function_privilege('authenticated', 'public.issue_4490_venue_money_day(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4490_venue_money_day(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'E-4 FAIL: the helper is callable by a signed-in user or anon';
  END IF;
  RAISE NOTICE 'PASS  E-4 the money helper is service_role only';
END
$test$;

ROLLBACK;
\echo 'issue #4490 07-E: all cases passed'
