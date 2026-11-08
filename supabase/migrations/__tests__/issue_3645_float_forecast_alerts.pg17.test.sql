-- Issue #3645 bundle 2c — the Nigerian payout float forecast counts paid sales
-- that are not attached yet, its shortfall alert fires with no release, and a
-- stay payout held by a long-open dispute alerts ops.
--
-- The candidate text of every arm is proven equal to the dark sweeps' text by
-- issue_3645_unattached_sources_match_sweeps.structural.test.ts. This suite
-- proves the behaviour on orders and Paystack stays, with the real sweeps as
-- the oracle: what the forecast predicts is exactly what they then attach.
--
-- MINGLA-INVARIANT: I-3645-FLOAT-FORECAST-COUNTS-UNATTACHED | issue #3645 | The Nigerian float obligation includes every paid Paystack sale that matures inside the horizon, attached or not, from the same candidate text the dark sweeps attach from.
-- MINGLA-INVARIANT: I-3645-FLOAT-ALERT-NEEDS-NO-RELEASE | issue #3645 | A float shortfall made only of unattached sales raises one Mingla-wide outbox row; only that kind may have no release, and release and brand are both set or both NULL.
-- MINGLA-INVARIANT: I-3645-STALE-STAY-DISPUTE-ALERTS | issue #3645 | A stay dispute hold open for over 90 days is delivered to ops, and a changed set of stale disputes on a release is delivered again.
--
-- T1  unattached Paystack sales are counted at the net their release stores
-- T2  exclusions: Stripe brand, before cutover, cancelled event, no fee
--     snapshot, fully refunded
-- T3  maturity boundary is finalized_at + 1 day <= the horizon end
-- T4  a release-less shortfall raises the one Mingla-wide row
-- T5  bounds unchanged; a covered tick re-arms the Mingla-wide row
-- T6  the outbox CHECK, the Mingla-wide index and the kept unique key
-- T7  the drain returns the Mingla-wide row and delivery records it
-- T8  attaching moves a sale from unattached to releases without double count,
--     and the sweeps attach exactly the predicted sales at the predicted net
-- T9  a release in the horizon keeps the anchored row exactly as before, and
--     the Mingla-wide row is marked covered
-- T10 long-open stay dispute holds
-- T11 grants

BEGIN;

ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER stay_reservation_groups_scope_guard;
ALTER TABLE public.stay_reservation_lines DISABLE TRIGGER stay_reservation_lines_scope_guard;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER stay_reservation_events_scope_guard;
ALTER TABLE public.stay_reservation_groups DROP CONSTRAINT stay_reservation_groups_quote_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_quote_line_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_offering_id_fkey;

CREATE TEMP TABLE fx(k text PRIMARY KEY, v uuid NOT NULL);
GRANT ALL ON fx TO PUBLIC;

-- "now" for the forecast is N = 2026-10-21 12:00 UTC; horizon 7 days.
DO $seed$
DECLARE
  v_owner constant uuid := '3645c000-0000-4000-8000-000000000001';
  v_ng constant uuid := '3645c000-0000-4000-8000-000000000002';      -- Paystack brand
  v_us constant uuid := '3645c000-0000-4000-8000-000000000003';      -- Stripe brand
  v_late constant uuid := '3645c000-0000-4000-8000-000000000004';    -- cut over 1h ago
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-float@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES
    (v_ng, v_owner, 'Issue 3645 Float NG', 'issue-3645-float-ng', 'paystack',
     'NG', 'NGN', 'NGN', timestamptz '2020-01-01 00:00:00+00'),
    (v_us, v_owner, 'Issue 3645 Float US', 'issue-3645-float-us', 'stripe',
     'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'),
    (v_late, v_owner, 'Issue 3645 Float Late', 'issue-3645-float-late', 'paystack',
     'NG', 'NGN', 'NGN', v_now - interval '1 hour');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency) VALUES
    ('3645c000-0000-4000-8000-0000000000e1', v_ng, 'NG live', 'issue-3645-float-e1', 'live', 'NGN'),
    ('3645c000-0000-4000-8000-0000000000e2', v_us, 'US live', 'issue-3645-float-e2', 'live', 'USD'),
    ('3645c000-0000-4000-8000-0000000000e3', v_late, 'Late', 'issue-3645-float-e3', 'live', 'NGN'),
    ('3645c000-0000-4000-8000-0000000000e4', v_ng, 'NG cancelled', 'issue-3645-float-e4', 'live', 'NGN');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master) VALUES
    ('3645c000-0000-4000-8000-0000000000d1', '3645c000-0000-4000-8000-0000000000e1',
     v_now + interval '30 days', v_now + interval '30 days 3 hours', 'UTC', true),
    ('3645c000-0000-4000-8000-0000000000d2', '3645c000-0000-4000-8000-0000000000e2',
     v_now + interval '30 days', v_now + interval '30 days 3 hours', 'UTC', true),
    ('3645c000-0000-4000-8000-0000000000d3', '3645c000-0000-4000-8000-0000000000e3',
     v_now + interval '30 days', v_now + interval '30 days 3 hours', 'UTC', true),
    ('3645c000-0000-4000-8000-0000000000d4', '3645c000-0000-4000-8000-0000000000e4',
     v_now + interval '30 days', v_now + interval '30 days 3 hours', 'UTC', true);
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES
    ('3645c000-0000-4000-8000-0000000000f1', v_ng, 'issue3645floatstay',
     'Issue 3645 Float Stay', 6.5, 3.4, 'stay', 'verified'),
    ('3645c000-0000-4000-8000-0000000000f2', v_us, 'issue3645floatusstay',
     'Issue 3645 Float US Stay', 40.8, -74.1, 'stay', 'verified');
  INSERT INTO public.stay_settings(
    venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state
  ) VALUES
    ('3645c000-0000-4000-8000-0000000000f1', v_ng, 'hotel', 'UTC', 'instant', 'active'),
    ('3645c000-0000-4000-8000-0000000000f2', v_us, 'hotel', 'UTC', 'instant', 'active');
  INSERT INTO fx VALUES ('ng', v_ng), ('us', v_us), ('late', v_late);
END
$seed$;

CREATE FUNCTION pg_temp.fx(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM fx WHERE k = p_key $$;

CREATE FUNCTION pg_temp.oid(p_n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('3645c000-0000-4000-8001-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- A paid order on event p_event, created p_age before N, with a fee snapshot
-- unless p_snapshot is false.
CREATE FUNCTION pg_temp.ord(
  p_n integer, p_event text, p_date text, p_total integer, p_fee integer,
  p_age interval, p_status text DEFAULT 'paid', p_refunded integer DEFAULT 0,
  p_snapshot boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := pg_temp.oid(p_n);
BEGIN
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, source, buyer_phone_e164,
    event_date_id, stripe_application_fee_amount_cents, refunded_amount_cents, created_at
  ) VALUES (
    v_id, ('3645c000-0000-4000-8000-0000000000' || p_event)::uuid, p_total, 'NGN',
    p_status, 'online_checkout', '+2348000000' || lpad(p_n::text, 3, '0'),
    ('3645c000-0000-4000-8000-0000000000' || p_date)::uuid, p_fee, p_refunded,
    timestamptz '2026-10-21 12:00:00+00' - p_age
  );
  IF p_snapshot THEN
    INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
    VALUES ('order', v_id, 150);
  END IF;
  RETURN v_id;
END
$$;

-- A confirmed stay line paid p_age before N on the given brand's stay venue.
CREATE FUNCTION pg_temp.stay(
  p_n integer, p_brand text, p_provider text, p_currency text, p_age interval
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_group uuid := ('3645c000-0000-4000-8002-' || lpad(p_n::text, 12, '0'))::uuid;
  v_line uuid := ('3645c000-0000-4000-8003-' || lpad(p_n::text, 12, '0'))::uuid;
  v_attempt uuid := ('3645c000-0000-4000-8004-' || lpad(p_n::text, 12, '0'))::uuid;
  v_venue uuid := CASE p_brand WHEN 'ng' THEN '3645c000-0000-4000-8000-0000000000f1'::uuid
                               ELSE '3645c000-0000-4000-8000-0000000000f2'::uuid END;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group, 'ST-3645C' || lpad(p_n::text, 15, '0'), gen_random_uuid(),
    repeat('a', 64), v_venue, pg_temp.fx(p_brand), p_currency,
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450,
    'issue-3645-float-group-' || p_n, repeat('b', 64)
  );
  INSERT INTO public.stay_reservation_lines(
    id, group_id, quote_line_id, offering_id, kind, state, room_check_in,
    room_check_out, room_quantity, adults, children, base_minor, fee_minor,
    tax_minor, total_minor, offering_snapshot, price_snapshot, policy_snapshot
  ) VALUES (
    v_line, v_group, gen_random_uuid(), gen_random_uuid(), 'room', 'confirmed',
    (v_now + interval '8 days')::date, (v_now + interval '10 days')::date,
    1, 2, 0, 10000, 450, 0, 10450, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt, v_group, p_provider, 1, 10450, p_currency, 450, 300, 'succeeded',
    'ref_3645_float_' || p_n, 'issue-3645-float-attempt-' || p_n,
    repeat('c', 64), v_now - p_age
  );
  INSERT INTO public.stay_payout_line_snapshots(
    reservation_line_id, payment_attempt_id, platform_fee_minor, provider_fee_minor
  ) VALUES (v_line, v_attempt, 450, 300);
  SET LOCAL session_replication_role = origin;
  RETURN v_line;
END
$$;

CREATE FUNCTION pg_temp.obl(p_now timestamptz DEFAULT timestamptz '2026-10-21 12:00:00+00')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.paystack_payout_float_obligation(7, p_now)
$$;

CREATE FUNCTION pg_temp.global_row() RETURNS public.payout_release_alert_outbox
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.payout_release_alert_outbox
  WHERE release_id IS NULL AND alert_kind = 'paystack_float_shortfall'
$$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- Sales. Net = gross - refunded - disputed - Mingla fee (the attach formula).
SELECT pg_temp.ord(1, 'e1', 'd1', 100000, 4500, interval '2 hours');                     -- 95,500
SELECT pg_temp.ord(2, 'e1', 'd1', 50000, 2250, interval '1 hour', 'partial_refund', 10000); -- 37,750
SELECT pg_temp.ord(3, 'e1', 'd1', 20000, 900, interval '25 hours');                       -- 19,100, overdue
-- Excluded.
SELECT pg_temp.ord(4, 'e2', 'd2', 30000, 1350, interval '2 hours');                       -- Stripe brand
SELECT pg_temp.ord(5, 'e3', 'd3', 30000, 1350, interval '2 hours');                       -- before cutover
SELECT pg_temp.ord(6, 'e4', 'd4', 30000, 1350, interval '2 hours');                       -- cancelled event
SELECT pg_temp.ord(7, 'e1', 'd1', 30000, 1350, interval '2 hours', 'paid', 0, false);     -- no fee snapshot
SELECT pg_temp.ord(8, 'e1', 'd1', 30000, 1350, interval '2 hours', 'refunded', 30000);    -- fully refunded
UPDATE public.events SET status = 'cancelled' WHERE id = '3645c000-0000-4000-8000-0000000000e4';
-- Stays: a Paystack stay (10450 - 450 = 10,000) and a Stripe stay (excluded).
SELECT pg_temp.stay(1, 'ng', 'paystack', 'NGN', interval '3 hours');
SELECT pg_temp.stay(2, 'us', 'stripe', 'USD', interval '3 hours');

-- T1 + T2: what is counted, at which net.
DO $t1$
DECLARE
  v jsonb := pg_temp.obl();
  v_set text;
BEGIN
  SELECT string_agg(u.source_type || ':' || right(u.source_id::text, 2) || '=' || u.net_cents, ',' ORDER BY u.source_type, u.source_id)
  INTO v_set
  FROM public.issue_3645_unattached_payout_sources(timestamptz '2026-10-28 12:00:00+00') u
  WHERE u.provider = 'paystack';
  IF v_set IS DISTINCT FROM 'order:01=95500,order:02=37750,order:03=19100,stay_reservation:01=10000' THEN
    RAISE EXCEPTION 'T1 unattached Paystack set wrong: %', v_set;
  END IF;
  -- The Stripe sales are sources too (the function is provider-neutral), but
  -- the forecast counts Paystack only.
  IF NOT EXISTS (
    SELECT 1 FROM public.issue_3645_unattached_payout_sources(timestamptz '2026-10-28 12:00:00+00') u
    WHERE u.provider = 'stripe' AND u.source_id = pg_temp.oid(4)
  ) THEN
    RAISE EXCEPTION 'T2 the Stripe order should be a (Stripe) source';
  END IF;
  IF (v->>'unattached_count')::int <> 4
     OR (v->>'unattached_kobo')::bigint <> 162350
     OR (v->>'obligation_kobo')::bigint <> 162350
     OR (v->>'release_count')::int <> 0
     OR v->'anchor_release_id' <> 'null'::jsonb
     OR (v->>'earliest_maturity_at')::timestamptz <> timestamptz '2026-10-21 11:00:00+00' THEN
    RAISE EXCEPTION 'T1 obligation wrong: %', v;
  END IF;
  -- Every old key is still there.
  IF NOT (v ?& ARRAY['horizon_days','horizon_end','release_count','obligation_kobo',
                     'earliest_maturity_at','anchor_release_id','anchor_brand_id']) THEN
    RAISE EXCEPTION 'T1 obligation lost a key: %', v;
  END IF;
END
$t1$;

-- T3: maturity boundary (order 1 matures at N + 22h).
DO $t3$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.issue_3645_unattached_payout_sources(timestamptz '2026-10-22 10:00:00+00')
    WHERE source_id = pg_temp.oid(1)
  ) THEN
    RAISE EXCEPTION 'T3 a sale maturing exactly at the horizon end was not counted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.issue_3645_unattached_payout_sources(
      timestamptz '2026-10-22 10:00:00+00' - interval '1 microsecond')
    WHERE source_id = pg_temp.oid(1)
  ) THEN
    RAISE EXCEPTION 'T3 a sale maturing after the horizon end was counted';
  END IF;
END
$t3$;

-- T4: a shortfall made only of unattached sales raises the Mingla-wide row.
DO $t4$
DECLARE
  v jsonb;
  r public.payout_release_alert_outbox;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(62350, 7, timestamptz '2026-10-21 12:00:00+00');
  IF v->>'alert' <> 'raised' OR (v->>'shortfall_kobo')::bigint <> 100000 THEN
    RAISE EXCEPTION 'T4 not raised: %', v;
  END IF;
  r := pg_temp.global_row();
  IF r.id IS NULL OR r.release_id IS NOT NULL OR r.brand_id IS NOT NULL
     OR r.idempotency_key <> 'paystack_float_shortfall:mingla:r1'
     OR r.alert_magnitude_kobo <> 100000 OR r.status <> 'pending'
     OR r.error_message <> 'NGN 1,623.50 of Nigerian payouts mature by 2026-10-28; Paystack balance is NGN 623.50; top up NGN 1,000.00 before then.' THEN
    RAISE EXCEPTION 'T4 Mingla-wide row wrong: %', row_to_json(r);
  END IF;
END
$t4$;

-- T5: the bounds are unchanged on the Mingla-wide row, and a covered tick
-- re-arms it so a new release-less shortfall is not suppressed.
DO $t5$
DECLARE
  v jsonb;
  r public.payout_release_alert_outbox;
  c_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
BEGIN
  -- Delivered.
  UPDATE public.payout_release_alert_outbox
  SET status = 'provider_accepted', provider_accepted_at = c_now
  WHERE id = (pg_temp.global_row()).id;
  -- Slightly worse, within 25% / NGN 1,000 and 24h: suppressed.
  v := public.raise_paystack_float_shortfall_alert(62350 - 50000, 7, c_now + interval '1 hour');
  IF v->>'alert' <> 'suppressed' THEN RAISE EXCEPTION 'T5 bounds changed: %', v; END IF;
  -- Covered: alert none, and the row is marked covered (magnitude 0).
  v := public.raise_paystack_float_shortfall_alert(500000, 7, c_now + interval '2 hours');
  IF v->>'alert' <> 'none' OR (pg_temp.global_row()).alert_magnitude_kobo <> 0
     OR (pg_temp.global_row()).status <> 'provider_accepted' THEN
    RAISE EXCEPTION 'T5 covered tick did not mark the row: % %', v, row_to_json(pg_temp.global_row());
  END IF;
  -- A new shortfall of 1 kobo, 3h after the last alert: raised again at once.
  v := public.raise_paystack_float_shortfall_alert(162349, 7, c_now + interval '3 hours');
  r := pg_temp.global_row();
  IF v->>'alert' <> 'refreshed' OR r.idempotency_key <> 'paystack_float_shortfall:mingla:r2'
     OR r.status <> 'pending' OR r.provider_accepted_at IS NOT NULL
     OR r.alert_magnitude_kobo <> 1 THEN
    RAISE EXCEPTION 'T5 new shortfall after cover was suppressed: % %', v, row_to_json(r);
  END IF;
  IF (SELECT count(*) FROM public.payout_release_alert_outbox
      WHERE alert_kind = 'paystack_float_shortfall') <> 1 THEN
    RAISE EXCEPTION 'T5 expected exactly one float row';
  END IF;
  -- A dispatching row is never touched, covered or not.
  UPDATE public.payout_release_alert_outbox
  SET status = 'dispatching', dispatch_claim_id = gen_random_uuid(), dispatch_claimed_at = c_now
  WHERE id = r.id;
  v := public.raise_paystack_float_shortfall_alert(500000, 7, c_now + interval '4 hours');
  IF (pg_temp.global_row()).alert_magnitude_kobo <> 1 THEN
    RAISE EXCEPTION 'T5 a dispatching row was rewritten';
  END IF;
  UPDATE public.payout_release_alert_outbox
  SET status = 'pending', dispatch_claim_id = NULL, dispatch_claimed_at = NULL
  WHERE id = r.id;
END
$t5$;

-- T6: CHECK, Mingla-wide index, kept unique key.
DO $t6$
DECLARE
  v_rel uuid := gen_random_uuid();
BEGIN
  BEGIN
    INSERT INTO public.payout_release_alert_outbox(release_id, alert_kind, idempotency_key, brand_id, error_message)
    VALUES (NULL, 'paystack_balance_blocked', 't6-a', NULL, 'x');
    RAISE EXCEPTION 'T6 a non-float kind with no release was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.payout_release_alert_outbox(release_id, alert_kind, idempotency_key, brand_id, error_message)
    VALUES (NULL, 'paystack_float_shortfall', 't6-b', pg_temp.fx('ng'), 'x');
    RAISE EXCEPTION 'T6 a float row with a brand and no release was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.payout_release_alert_outbox(release_id, alert_kind, idempotency_key, brand_id, error_message)
    VALUES (v_rel, 'paystack_float_shortfall', 't6-c', NULL, 'x');
    RAISE EXCEPTION 'T6 a float row with a release and no brand was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET LOCAL session_replication_role = origin;
  BEGIN
    INSERT INTO public.payout_release_alert_outbox(release_id, alert_kind, idempotency_key, brand_id, error_message)
    VALUES (NULL, 'paystack_float_shortfall', 't6-d', NULL, 'x');
    RAISE EXCEPTION 'T6 a second Mingla-wide float row was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'payout_release_alert_outbox_release_id_alert_kind_key') THEN
    RAISE EXCEPTION 'T6 the (release_id, alert_kind) key lost its name';
  END IF;
END
$t6$;

-- T7: the drain returns the Mingla-wide row; delivery records it.
DO $t7$
DECLARE
  a record;
  v_status text;
BEGIN
  SELECT * INTO a FROM public.claim_payout_release_alerts(20, timestamptz '2026-10-21 16:00:00+00')
  WHERE alert_kind = 'paystack_float_shortfall';
  IF a.alert_id IS NULL OR a.release_id IS NOT NULL OR a.brand_id IS NOT NULL
     OR a.idempotency_key <> 'paystack_float_shortfall:mingla:r2' THEN
    RAISE EXCEPTION 'T7 drain did not return the Mingla-wide row: %', row_to_json(a);
  END IF;
  v_status := public.record_payout_release_alert_delivery(
    a.alert_id, a.claim_id, 'provider_accepted', NULL, timestamptz '2026-10-21 16:00:01+00');
  IF v_status <> 'provider_accepted' THEN
    RAISE EXCEPTION 'T7 delivery not recorded: %', v_status;
  END IF;
END
$t7$;

-- T8: attaching moves a sale from unattached to releases with no double count,
-- and the sweeps attach exactly the predicted sales at the predicted net.
CREATE TEMP TABLE predicted AS
  SELECT source_type, source_id, net_cents
  FROM public.issue_3645_unattached_payout_sources(timestamptz '2026-10-23 12:00:00+00');
GRANT ALL ON predicted TO PUBLIC;

DO $t8$
DECLARE
  v_before jsonb := pg_temp.obl();
  v_after jsonb;
  v_rel uuid;
  v_mismatch text;
BEGIN
  -- Order 3 is 25h old: the sweep attaches it now.
  PERFORM public.run_payout_release_dark_sweep(timestamptz '2026-10-21 12:00:00+00');
  SELECT release_id INTO v_rel FROM public.payout_release_items
  WHERE source_type = 'order' AND source_id = pg_temp.oid(3);
  IF v_rel IS NULL THEN RAISE EXCEPTION 'T8 order 3 did not attach'; END IF;
  v_after := pg_temp.obl();
  IF (v_after->>'obligation_kobo')::bigint <> (v_before->>'obligation_kobo')::bigint
     OR (v_after->>'unattached_count')::int <> 3
     OR (v_after->>'release_count')::int <> 1
     OR (v_after->>'unattached_kobo')::bigint <> 162350 - 19100
     OR (v_after->>'anchor_release_id')::uuid <> v_rel THEN
    RAISE EXCEPTION 'T8 double count or drop: before % after %', v_before, v_after;
  END IF;

  -- Two days on, both sweeps attach everything else.
  PERFORM public.run_payout_release_dark_sweep(timestamptz '2026-10-23 12:00:00+00');
  PERFORM public.run_stay_payout_release_dark_sweep(timestamptz '2026-10-23 12:00:00+00');
  SELECT string_agg(coalesce(p.source_type, i.source_type) || ':' || coalesce(p.source_id, i.source_id)::text
           || ' predicted ' || coalesce(p.net_cents::text, '-') || ' stored ' || coalesce(i.net_cents::text, '-'), '; ')
  INTO v_mismatch
  FROM predicted p
  FULL JOIN (
    SELECT source_type, source_id, net_cents FROM public.payout_release_items
    WHERE source_id IN (SELECT source_id FROM predicted)
       OR source_id IN (pg_temp.oid(4), pg_temp.oid(5), pg_temp.oid(6), pg_temp.oid(7), pg_temp.oid(8))
  ) i ON i.source_type = p.source_type AND i.source_id = p.source_id
  WHERE p.net_cents IS DISTINCT FROM i.net_cents::bigint;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'T8 the sweeps attached something other than predicted: %', v_mismatch;
  END IF;
  IF (SELECT count(*) FROM predicted) <> 6 THEN
    -- 4 Paystack (orders 1-3, stay 1) + 2 Stripe (order 4, stay 2).
    RAISE EXCEPTION 'T8 predicted set size %', (SELECT count(*) FROM predicted);
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_3645_unattached_payout_sources(timestamptz '2026-10-30 12:00:00+00')
             WHERE source_id IN (SELECT source_id FROM predicted)) THEN
    RAISE EXCEPTION 'T8 an attached sale is still projected';
  END IF;
END
$t8$;

-- T9: a release in the horizon keeps the anchored row exactly as before, and
-- the Mingla-wide row is marked covered.
DO $t9$
DECLARE
  v jsonb;
  v_anchor uuid;
  r public.payout_release_alert_outbox;
BEGIN
  v := public.raise_paystack_float_shortfall_alert(0, 7, timestamptz '2026-10-23 12:00:00+00');
  v_anchor := (v->>'anchor_release_id')::uuid;
  IF v->>'alert' <> 'raised' OR v_anchor IS NULL THEN
    RAISE EXCEPTION 'T9 anchored raise wrong: %', v;
  END IF;
  SELECT * INTO r FROM public.payout_release_alert_outbox
  WHERE release_id = v_anchor AND alert_kind = 'paystack_float_shortfall';
  IF r.idempotency_key <> 'paystack_float_shortfall:' || v_anchor::text || ':r1'
     OR r.brand_id IS NULL THEN
    RAISE EXCEPTION 'T9 anchored row changed shape: %', row_to_json(r);
  END IF;
  IF (pg_temp.global_row()).alert_magnitude_kobo <> 0 THEN
    RAISE EXCEPTION 'T9 the Mingla-wide row was not marked covered';
  END IF;
END
$t9$;

-- T10: long-open stay dispute holds (Stripe stays, as disputes are recorded
-- for Stripe stays). Holds are created at now(); the raise is asked at now()
-- plus an age.
SELECT pg_temp.stay(10, 'us', 'stripe', 'USD', interval '3 hours');
SELECT pg_temp.stay(11, 'us', 'stripe', 'USD', interval '3 hours');
SELECT pg_temp.stay(12, 'us', 'stripe', 'USD', interval '3 hours');
SELECT public.run_stay_payout_release_dark_sweep(timestamptz '2026-10-23 12:00:00+00');

CREATE FUNCTION pg_temp.srel(p_n integer) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT release_id FROM public.payout_release_items
  WHERE source_type = 'stay_reservation'
    AND source_id = ('3645c000-0000-4000-8003-' || lpad(p_n::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.dispute(p_n integer, p_event text, p_ref text, p_status text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.issue_1389_record_stay_dispute(
    p_event, 'charge.dispute.updated', 'ref_3645_float_' || p_n, p_ref, 1000, 'USD', p_status)
$$;

CREATE FUNCTION pg_temp.stale(p_release uuid) RETURNS public.payout_release_alert_outbox
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.payout_release_alert_outbox
  WHERE release_id = p_release AND alert_kind = 'stay_dispute_hold_open'
$$;

DO $t10$
DECLARE
  v jsonb;
  r public.payout_release_alert_outbox;
  a record;
  v_line12 uuid := '3645c000-0000-4000-8003-000000000012';
BEGIN
  IF pg_temp.srel(10) IS NULL OR pg_temp.srel(11) IS NULL OR pg_temp.srel(12) IS NULL THEN
    RAISE EXCEPTION 'T10 fixture stays did not attach';
  END IF;
  PERFORM pg_temp.dispute(10, 'evt_3645c_10a', 'du_10a', 'needs_response');

  -- 89 days: nothing. 91 days: one row naming the dispute.
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '89 days');
  IF (v->>'raised')::int <> 0 OR pg_temp.stale(pg_temp.srel(10)) IS NOT NULL AND (pg_temp.stale(pg_temp.srel(10))).id IS NOT NULL THEN
    RAISE EXCEPTION 'T10 alerted before 90 days: %', v;
  END IF;
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '91 days');
  r := pg_temp.stale(pg_temp.srel(10));
  IF (v->>'raised')::int <> 1 OR r.id IS NULL
     OR r.idempotency_key <> 'stay_dispute_hold_open:' || pg_temp.srel(10)::text || ':r1'
     OR r.brand_id IS DISTINCT FROM pg_temp.fx('us')
     OR position('du_10a' in r.error_message) = 0 THEN
    RAISE EXCEPTION 'T10 stale hold not raised: % %', v, row_to_json(r);
  END IF;
  -- Repeat: still one row, nothing refreshed.
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '92 days');
  IF (v->>'raised')::int <> 0 OR (v->>'refreshed')::int <> 0 THEN
    RAISE EXCEPTION 'T10 repeat call wrote again: %', v;
  END IF;

  -- The drain delivers the kind.
  SELECT * INTO a FROM public.claim_payout_release_alerts(20, now())
  WHERE alert_kind = 'stay_dispute_hold_open';
  IF a.alert_id IS NULL OR a.release_id <> pg_temp.srel(10) THEN
    RAISE EXCEPTION 'T10 the drain did not return the stale-dispute row';
  END IF;
  PERFORM public.record_payout_release_alert_delivery(a.alert_id, a.claim_id, 'provider_accepted', NULL, now());

  -- Won closes it: no new row, no refresh, even long after.
  PERFORM pg_temp.dispute(10, 'evt_3645c_10b', 'du_10a', 'won');
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '200 days');
  IF (v->>'raised')::int <> 0 OR (v->>'refreshed')::int <> 0 THEN
    RAISE EXCEPTION 'T10 a won dispute still alerts: %', v;
  END IF;

  -- A second dispute on the same release, after the first was alerted and
  -- closed, goes stale: re-armed with a new key.
  PERFORM pg_temp.dispute(10, 'evt_3645c_10c', 'du_10b', 'needs_response');
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '91 days');
  r := pg_temp.stale(pg_temp.srel(10));
  IF (v->>'refreshed')::int <> 1 OR r.status <> 'pending'
     OR r.idempotency_key <> 'stay_dispute_hold_open:' || pg_temp.srel(10)::text || ':r2'
     OR position('du_10b' in r.error_message) = 0 OR position('du_10a' in r.error_message) > 0 THEN
    RAISE EXCEPTION 'T10 second stale dispute not re-armed: % %', v, row_to_json(r);
  END IF;

  -- Lost also closes it.
  PERFORM pg_temp.dispute(11, 'evt_3645c_11a', 'du_11a', 'needs_response');
  PERFORM pg_temp.dispute(11, 'evt_3645c_11b', 'du_11a', 'lost');
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '91 days');
  IF (pg_temp.stale(pg_temp.srel(11))).id IS NOT NULL THEN
    RAISE EXCEPTION 'T10 a lost dispute alerted';
  END IF;

  -- An old CLOSED dispute plus a young OPEN one on the same release is not
  -- stale (age is per dispute, not per release).
  INSERT INTO public.stay_payout_release_holds(
    release_id, line_id, kind, refunded_cents, disputed_cents, net_hold_cents,
    provider_ref, idempotency_key, created_at
  ) VALUES
    (pg_temp.srel(12), v_line12, 'dispute_opened', 0, 100, 100, 'du_12old',
     't10-12old-open', now() - interval '120 days'),
    (pg_temp.srel(12), v_line12, 'dispute_won', 0, -100, -100, 'du_12old',
     't10-12old-won', now() - interval '100 days'),
    (pg_temp.srel(12), v_line12, 'dispute_opened', 0, 100, 100, 'du_12new',
     't10-12new-open', now() - interval '2 days');
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now());
  IF (pg_temp.stale(pg_temp.srel(12))).id IS NOT NULL THEN
    RAISE EXCEPTION 'T10 an old closed dispute made a young open one look stale';
  END IF;

  -- A released release never alerts.
  UPDATE public.brand_payout_releases SET status = 'released', released_at = now()
  WHERE id = pg_temp.srel(12);
  v := public.issue_3645_raise_stale_stay_dispute_alerts(now() + interval '200 days');
  IF (pg_temp.stale(pg_temp.srel(12))).id IS NOT NULL THEN
    RAISE EXCEPTION 'T10 a released release alerted';
  END IF;
END
$t10$;

-- T11: grants.
DO $t11$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_3645_unattached_payout_sources(timestamptz)',
    'public.issue_3645_raise_stale_stay_dispute_alerts(timestamptz)',
    'public.paystack_payout_float_obligation(integer,timestamptz)',
    'public.raise_paystack_float_shortfall_alert(bigint,integer,timestamptz)',
    'public.claim_payout_release_alerts(integer,timestamptz)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'T11 grants wrong on %', v_fn;
    END IF;
  END LOOP;
END
$t11$;

SELECT 'issue_3645_float_forecast_alerts: all tests passed' AS result;

ROLLBACK;
