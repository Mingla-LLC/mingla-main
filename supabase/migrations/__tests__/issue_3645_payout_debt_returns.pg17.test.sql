-- Issue #3645 bundle 2d — debt that holds leave unrecovered is owed again, and
-- a postponement debt maturing on an unpaid release never pays twice.
--
-- MINGLA-INVARIANT: I-3645-HELD-RELEASE-DEBT-RETURNED | issue #3645 | When holds leave an unpaid payout release unable to cover the debt withheld from it, exactly the uncovered part is handed back (payout_debt_application_returns) and the debt is open again, so it is recovered from the next release; nothing is recovered twice and nothing is lost.
-- MINGLA-INVARIANT: I-3645-MATURED-DEBT-NEVER-PAID-TWICE | issue #3645 | A postponement debt that matures while its release is unpaid goes back through net, never as a recredit on top, so holds that shrank the release cannot turn it into an overpay; the writeoff stays principal − recovered.
-- MINGLA-INVARIANT: I-3645-CONVERSION-SKIPS-RETURNED-DEBT | issue #3645 | A conversion of postponement debt never takes a part of an application that was handed back: converted + returned ≤ amount for every application.

BEGIN;

-- The fixture stays have no quote or offering rows, so the #1388 cross-table
-- scope guards (unrelated to payouts) are off for this rolled-back
-- transaction. Every payout, refund and dispute trigger stays on.
ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER stay_reservation_groups_scope_guard;
ALTER TABLE public.stay_reservation_lines DISABLE TRIGGER stay_reservation_lines_scope_guard;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER stay_reservation_events_scope_guard;
ALTER TABLE public.stay_reservation_groups DROP CONSTRAINT stay_reservation_groups_quote_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_quote_line_id_fkey;
ALTER TABLE public.stay_reservation_lines DROP CONSTRAINT stay_reservation_lines_offering_id_fkey;
ALTER TABLE public.stay_refunds DROP CONSTRAINT stay_refunds_cancel_preview_id_fkey;

-- One brand per scenario, so a debt reopened in one cannot be withheld in another.
CREATE FUNCTION pg_temp.uid(p_kind integer, p_brand integer, p_n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('3645d000-' || lpad(p_kind::text, 4, '0') || '-4000-8000-'
    || lpad((p_brand * 1000 + p_n)::text, 12, '0'))::uuid
$$;

CREATE FUNCTION pg_temp.brand(p_b integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_owner uuid := pg_temp.uid(1, p_b, 0);
  v_brand uuid := pg_temp.uid(2, p_b, 0);
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3645-2d-' || p_b || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 2d ' || p_b, 'issue-3645-2d-' || p_b,
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    pg_temp.uid(3, p_b, 0), v_brand, 'issue36452d' || p_b, 'Issue 3645 2d stay ' || p_b,
    40.8, -74.1, 'stay', 'verified'
  );
  INSERT INTO public.stay_settings(
    venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state
  ) VALUES (pg_temp.uid(3, p_b, 0), v_brand, 'hotel', 'UTC', 'instant', 'active');
  RETURN v_brand;
END
$$;

-- A paid stay line of brand p_b (10450 charged, 450 fee), attached by the
-- real dark sweep, which withholds the brand's open debt: net 10000 − debt.
CREATE FUNCTION pg_temp.stay(p_b integer, p_n integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-21 12:00:00+00';
  v_group uuid := pg_temp.uid(4, p_b, p_n);
  v_line uuid := pg_temp.uid(5, p_b, p_n);
  v_attempt uuid := pg_temp.uid(6, p_b, p_n);
  v_release uuid;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.stay_reservation_groups(
    id, public_reference, quote_id, actor_key_hash, venue_id, brand_id,
    currency_code, mode, state, guest_snapshot, source_subtotal_minor,
    fee_total_minor, tax_total_minor, total_minor, idempotency_key, request_hash
  ) VALUES (
    v_group, 'ST-36452' || lpad((p_b * 1000 + p_n)::text, 15, '0'), gen_random_uuid(),
    repeat('a', 64), pg_temp.uid(3, p_b, 0), pg_temp.uid(2, p_b, 0), 'USD',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450,
    'issue-3645-2d-group-' || p_b || '-' || p_n, repeat('b', 64)
  );
  INSERT INTO public.stay_reservation_lines(
    id, group_id, quote_line_id, offering_id, kind, state, room_check_in,
    room_check_out, room_quantity, adults, children, base_minor, fee_minor,
    tax_minor, total_minor, offering_snapshot, price_snapshot, policy_snapshot
  ) VALUES (
    v_line, v_group, gen_random_uuid(), gen_random_uuid(), 'room', 'confirmed',
    (v_now + interval '8 days')::date + p_n, (v_now + interval '10 days')::date + p_n,
    1, 2, 0, 10000, 450, 0, 10450, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );
  INSERT INTO public.stay_payment_attempts(
    id, group_id, provider, attempt_ordinal, amount_minor, currency_code,
    application_fee_minor, provider_fee_minor, state, provider_payment_ref,
    idempotency_key, request_hash, succeeded_at
  ) VALUES (
    v_attempt, v_group, 'stripe', 1, 10450, 'USD', 450, 300, 'succeeded',
    'pi_3645d_' || p_b || '_' || p_n, 'issue-3645-2d-attempt-' || p_b || '-' || p_n,
    repeat('c', 64), v_now - interval '25 hours'
  );
  INSERT INTO public.stay_payout_line_snapshots(
    reservation_line_id, payment_attempt_id, platform_fee_minor, provider_fee_minor
  ) VALUES (v_line, v_attempt, 450, 300);
  SET LOCAL session_replication_role = origin;

  PERFORM public.run_stay_payout_release_dark_sweep(v_now);
  SELECT item.release_id INTO v_release
  FROM public.payout_release_items item
  WHERE item.source_type = 'stay_reservation' AND item.source_id = v_line;
  IF v_release IS NULL THEN
    RAISE EXCEPTION 'fixture: stay %/% did not attach', p_b, p_n;
  END IF;
  RETURN v_release;
END
$$;

-- A paid-out origin release for brand p_b that debts hang off.
CREATE FUNCTION pg_temp.origin(p_b integer, p_n integer, p_cash integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := pg_temp.uid(7, p_b, p_n);
BEGIN
  INSERT INTO public.brand_payout_releases(
    id, brand_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, net_release_cents,
    organiser_cash_delivered_cents, status, released_at
  ) VALUES (
    v_id, pg_temp.uid(2, p_b, 0), 'issue-3645-2d-origin-' || p_b || '-' || p_n,
    'order', 'stripe', 'usd', timestamptz '2026-09-01 00:00:00+00',
    timestamptz '2026-09-02 00:00:00+00', p_cash, p_cash, p_cash, 'released',
    timestamptz '2026-09-02 00:00:00+00'
  );
  RETURN v_id;
END
$$;

-- An open permanent debt (kind post_release_refund) of p_principal.
CREATE FUNCTION pg_temp.debt(p_b integer, p_n integer, p_principal integer, p_opened timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.organiser_payout_debts(
    brand_id, currency, origin_release_id, kind, principal_cents,
    idempotency_key, opened_at
  ) VALUES (
    pg_temp.uid(2, p_b, 0), 'usd', pg_temp.origin(p_b, p_n, p_principal),
    'post_release_refund', p_principal, 'issue-3645-2d-debt-' || p_b || '-' || p_n,
    p_opened
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- An open postponement debt of p_cash maturing at p_anchor + 3 days.
CREATE FUNCTION pg_temp.temp_debt(p_b integer, p_n integer, p_cash integer, p_anchor timestamptz)
RETURNS uuid LANGUAGE sql AS $$
  SELECT public.open_post_release_postponement_debt(
    pg_temp.origin(p_b, p_n, p_cash), p_anchor
  )
$$;

CREATE FUNCTION pg_temp.dispute(
  p_b integer, p_n integer, p_ref text, p_amount integer, p_status text
) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.issue_1389_record_stay_dispute(
    'evt_' || p_ref || '_' || p_status, 'charge.dispute.updated',
    'pi_3645d_' || p_b || '_' || p_n, p_ref, p_amount, 'USD', p_status
  )
$$;

CREATE FUNCTION pg_temp.rel(p_release uuid)
RETURNS public.brand_payout_releases
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.brand_payout_releases WHERE id = p_release
$$;

CREATE FUNCTION pg_temp.d(p_debt uuid)
RETURNS public.organiser_payout_debts
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.organiser_payout_debts WHERE id = p_debt
$$;

CREATE FUNCTION pg_temp.app(p_debt uuid, p_release uuid)
RETURNS public.payout_debt_applications
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.payout_debt_applications
  WHERE debt_id = p_debt AND release_id = p_release
$$;

CREATE FUNCTION pg_temp.returned(p_debt uuid, p_release uuid, p_reason text)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(amount_cents), 0)::integer
  FROM public.payout_debt_application_returns
  WHERE debt_id = p_debt AND release_id = p_release AND reason = p_reason
$$;

-- Σ ledger adjustments of a kind on a release (0 when there are none).
CREATE FUNCTION pg_temp.adj(p_release uuid, p_kind text) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(amount_cents), 0)::integer
  FROM public.payout_ledger_adjustments
  WHERE release_id = p_release AND kind = p_kind
$$;

-- I1: every open debt's recovered equals what its unreleased applications
-- still withhold (amount − converted − returned).
CREATE FUNCTION pg_temp.assert_i1(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_bad record;
BEGIN
  SELECT d.id, d.recovered_cents, coalesce((
    SELECT sum(a.amount_cents - a.converted_cents
      - public.issue_3645_application_returned_cents(a.id))
    FROM public.payout_debt_applications a
    WHERE a.debt_id = d.id AND a.released_at IS NULL
  ), 0) AS effective
  INTO v_bad
  FROM public.organiser_payout_debts d
  WHERE d.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-2d-%')
    AND d.status = 'open'
    AND d.recovered_cents <> coalesce((
      SELECT sum(a.amount_cents - a.converted_cents
        - public.issue_3645_application_returned_cents(a.id))
      FROM public.payout_debt_applications a
      WHERE a.debt_id = d.id AND a.released_at IS NULL
    ), 0)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% I1 broken: debt % recovered % but applications withhold %',
      p_label, v_bad.id, v_bad.recovered_cents, v_bad.effective;
  END IF;
  -- I2: the attach-time columns still equal Σ(amount − converted), so moving
  -- the projection from the columns to the applications changed nothing.
  IF EXISTS (
    SELECT 1 FROM public.brand_payout_releases r
    WHERE r.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-2d-%')
      AND r.permanent_debt_withheld_cents + r.temporary_debt_withheld_cents
        <> coalesce((SELECT sum(a.amount_cents - a.converted_cents)
                     FROM public.payout_debt_applications a WHERE a.release_id = r.id), 0)
  ) THEN
    RAISE EXCEPTION '% I2 broken: stored withheld columns disagree with the applications', p_label;
  END IF;
  -- I3: no unpaid release withholds more than its items cover after settling.
  IF EXISTS (
    SELECT 1 FROM public.brand_payout_releases r
    CROSS JOIN LATERAL public.issue_3645_release_projected_totals(r.id) t
    WHERE r.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-2d-%')
      AND public.issue_3645_release_settleable(r.id)
      AND EXISTS (SELECT 1 FROM public.payout_release_items i WHERE i.release_id = r.id)
      AND t.withheld_cents > t.items_net_cents
      AND r.net_release_cents <> t.net_release_cents
  ) THEN
    RAISE EXCEPTION '% I3 broken: a settled release stores a stale net', p_label;
  END IF;
END
$$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- T1-T3: a permanent debt withheld, then a dispute leaves the release short.
DO $t1$
DECLARE
  v_debt uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_r public.brand_payout_releases;
  v_d public.organiser_payout_debts;
  v_n integer;
BEGIN
  PERFORM pg_temp.brand(1);
  v_debt := pg_temp.debt(1, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_r1 := pg_temp.stay(1, 1);
  v_d := pg_temp.d(v_debt);
  IF (pg_temp.rel(v_r1)).net_release_cents <> 7000 OR v_d.recovered_cents <> 3000
     OR v_d.status <> 'closed' THEN
    RAISE EXCEPTION 'T1 fixture: net % debt %', (pg_temp.rel(v_r1)).net_release_cents, row_to_json(v_d);
  END IF;

  -- T1: a 9000 dispute leaves 1000 of items to cover 3000 of debt. Exactly
  -- 2000 goes back, the debt reopens with 1000 recovered, net is 0.
  PERFORM pg_temp.dispute(1, 1, 'dp_3645d_1', 9000, 'needs_response');
  v_r := pg_temp.rel(v_r1);
  v_d := pg_temp.d(v_debt);
  IF v_r.net_release_cents <> 0 OR v_r.disputed_cents <> 9000 THEN
    RAISE EXCEPTION 'T1 release: %', row_to_json(v_r);
  END IF;
  IF pg_temp.returned(v_debt, v_r1, 'hold') <> 2000 THEN
    RAISE EXCEPTION 'T1 returned %, expected 2000', pg_temp.returned(v_debt, v_r1, 'hold');
  END IF;
  IF v_d.recovered_cents <> 1000 OR v_d.status <> 'open' OR v_d.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'T1 debt not reopened at 1000: %', row_to_json(v_d);
  END IF;
  IF (SELECT count(*) FROM public.payout_debt_events
      WHERE debt_id = v_debt AND event_kind = 'recovery_returned'
        AND amount_cents = 2000 AND release_id = v_r1) <> 1 THEN
    RAISE EXCEPTION 'T1 expected one recovery_returned event of 2000';
  END IF;
  IF (SELECT withheld_cents FROM public.issue_3645_release_projected_totals(v_r1)) <> 1000 THEN
    RAISE EXCEPTION 'T1 effective withheld not 1000';
  END IF;
  -- The application itself is immutable.
  IF (pg_temp.app(v_debt, v_r1)).amount_cents <> 3000
     OR (pg_temp.app(v_debt, v_r1)).converted_cents <> 0 THEN
    RAISE EXCEPTION 'T1 application row changed';
  END IF;
  PERFORM pg_temp.assert_i1('T1');

  -- T2: settling again, the planner and a later dispute event add nothing.
  IF public.issue_3645_return_unrecovered_release_debt(v_r1) <> 0 THEN
    RAISE EXCEPTION 'T2 second return was not a no-op';
  END IF;
  PERFORM public.plan_pending_payout_partner_legs(500);
  PERFORM pg_temp.dispute(1, 1, 'dp_3645d_1', 9000, 'under_review');
  SELECT count(*) INTO v_n FROM public.payout_debt_application_returns WHERE debt_id = v_debt;
  IF v_n <> 1 OR (pg_temp.rel(v_r1)).net_release_cents <> 0
     OR (pg_temp.d(v_debt)).recovered_cents <> 1000 THEN
    RAISE EXCEPTION 'T2 replay changed state: % returns', v_n;
  END IF;

  -- T3: the next release withholds the reopened 2000 and the debt clears
  -- again, with a second 'cleared' event (the old key allowed only one).
  v_r2 := pg_temp.stay(1, 2);
  v_d := pg_temp.d(v_debt);
  IF (pg_temp.rel(v_r2)).net_release_cents <> 8000
     OR (pg_temp.app(v_debt, v_r2)).amount_cents <> 2000
     OR v_d.recovered_cents <> 3000 OR v_d.status <> 'closed' THEN
    RAISE EXCEPTION 'T3 re-recovery: net % debt %', (pg_temp.rel(v_r2)).net_release_cents, row_to_json(v_d);
  END IF;
  IF (SELECT count(*) FROM public.payout_debt_events
      WHERE debt_id = v_debt AND event_kind = 'cleared') <> 2 THEN
    RAISE EXCEPTION 'T3 expected two cleared events, got %',
      (SELECT count(*) FROM public.payout_debt_events WHERE debt_id = v_debt AND event_kind = 'cleared');
  END IF;
  PERFORM pg_temp.assert_i1('T3');

  -- T3b: the dispute is won. The first release now covers its remaining 1000
  -- and pays 9000; nothing is returned or re-withheld, so nothing is
  -- recovered twice (1000 on r1 + 2000 on r2 = the 3000 owed).
  PERFORM pg_temp.dispute(1, 1, 'dp_3645d_1', 9000, 'won');
  IF (pg_temp.rel(v_r1)).net_release_cents <> 9000
     OR pg_temp.returned(v_debt, v_r1, 'hold') <> 2000
     OR (pg_temp.d(v_debt)).recovered_cents <> 3000 THEN
    RAISE EXCEPTION 'T3b after won: net % debt %', (pg_temp.rel(v_r1)).net_release_cents, row_to_json(pg_temp.d(v_debt));
  END IF;
  PERFORM pg_temp.assert_i1('T3b');
END
$t1$;

-- T4: boundaries. S = 0 hands back nothing; S = 1 cent hands back 1 cent.
DO $t4$
DECLARE
  v_debt uuid;
  v_r uuid;
BEGIN
  PERFORM pg_temp.brand(2);
  v_debt := pg_temp.debt(2, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_r := pg_temp.stay(2, 1);
  PERFORM pg_temp.dispute(2, 1, 'dp_3645d_2a', 7000, 'needs_response');
  IF (SELECT count(*) FROM public.payout_debt_application_returns WHERE release_id = v_r) <> 0
     OR (pg_temp.rel(v_r)).net_release_cents <> 0
     OR (pg_temp.d(v_debt)).status <> 'closed' THEN
    RAISE EXCEPTION 'T4 S=0 handed something back';
  END IF;
  PERFORM pg_temp.dispute(2, 1, 'dp_3645d_2b', 1, 'needs_response');
  IF pg_temp.returned(v_debt, v_r, 'hold') <> 1
     OR (pg_temp.d(v_debt)).recovered_cents <> 2999
     OR (pg_temp.d(v_debt)).status <> 'open' THEN
    RAISE EXCEPTION 'T4 S=1: returned % debt %', pg_temp.returned(v_debt, v_r, 'hold'), row_to_json(pg_temp.d(v_debt));
  END IF;
  -- N = 0: a second big dispute takes the rest; all of it goes back.
  PERFORM pg_temp.dispute(2, 1, 'dp_3645d_2c', 2999, 'needs_response');
  IF pg_temp.returned(v_debt, v_r, 'hold') <> 3000
     OR (pg_temp.d(v_debt)).recovered_cents <> 0 THEN
    RAISE EXCEPTION 'T4 N=0: returned %', pg_temp.returned(v_debt, v_r, 'hold');
  END IF;
  -- Return keys grow with the cumulative amount and are unique.
  IF (SELECT array_agg(idempotency_key ORDER BY amount_cents)
      FROM public.payout_debt_application_returns WHERE release_id = v_r)
     <> ARRAY[
       'debt-return:' || (pg_temp.app(v_debt, v_r)).id || ':1',
       'debt-return:' || (pg_temp.app(v_debt, v_r)).id || ':3000'
     ] THEN
    RAISE EXCEPTION 'T4 return keys: %', (SELECT array_agg(idempotency_key) FROM public.payout_debt_application_returns WHERE release_id = v_r);
  END IF;
  PERFORM pg_temp.assert_i1('T4');
END
$t4$;

-- T5-T6: order (postponement first, then newest permanent) and a conversion
-- after a return never takes the handed-back part.
DO $t5$
DECLARE
  v_old uuid;
  v_new uuid;
  v_temp uuid;
  v_r3 uuid;
  v_r4 uuid;
  v_conv public.payout_debt_applications;
BEGIN
  PERFORM pg_temp.brand(3);
  v_old := pg_temp.debt(3, 1, 1000, timestamptz '2026-10-01 00:00:00+00');
  v_new := pg_temp.debt(3, 2, 2000, timestamptz '2026-10-02 00:00:00+00');
  v_temp := pg_temp.temp_debt(3, 3, 4000, timestamptz '2026-12-01 00:00:00+00');
  v_r3 := pg_temp.stay(3, 1);
  IF (pg_temp.rel(v_r3)).net_release_cents <> 3000 THEN
    RAISE EXCEPTION 'T5 fixture net %', (pg_temp.rel(v_r3)).net_release_cents;
  END IF;

  -- T5: N = 500 against 7000 withheld: 6500 goes back, postponement 4000
  -- first, then the newer permanent 2000, then 500 of the older one.
  PERFORM pg_temp.dispute(3, 1, 'dp_3645d_3', 9500, 'needs_response');
  IF pg_temp.returned(v_temp, v_r3, 'hold') <> 4000
     OR pg_temp.returned(v_new, v_r3, 'hold') <> 2000
     OR pg_temp.returned(v_old, v_r3, 'hold') <> 500 THEN
    RAISE EXCEPTION 'T5 order: temp % new % old %', pg_temp.returned(v_temp, v_r3, 'hold'),
      pg_temp.returned(v_new, v_r3, 'hold'), pg_temp.returned(v_old, v_r3, 'hold');
  END IF;
  IF (pg_temp.d(v_old)).recovered_cents <> 500 OR (pg_temp.d(v_new)).recovered_cents <> 0
     OR (pg_temp.d(v_temp)).recovered_cents <> 0 OR (pg_temp.d(v_temp)).status <> 'open'
     OR (pg_temp.rel(v_r3)).net_release_cents <> 0 THEN
    RAISE EXCEPTION 'T5 debts: old % new % temp %', row_to_json(pg_temp.d(v_old)),
      row_to_json(pg_temp.d(v_new)), row_to_json(pg_temp.d(v_temp));
  END IF;
  PERFORM pg_temp.assert_i1('T5');

  -- T6: the next release withholds all three again (500 + 2000 + 4000).
  v_r4 := pg_temp.stay(3, 2);
  IF (pg_temp.rel(v_r4)).net_release_cents <> 3500
     OR (pg_temp.app(v_temp, v_r4)).amount_cents <> 4000 THEN
    RAISE EXCEPTION 'T6 fixture net %', (pg_temp.rel(v_r4)).net_release_cents;
  END IF;
  -- A refund on the postponement's origin converts 2500 of it. The r3
  -- application (older) was fully handed back, so all 2500 must come from r4.
  PERFORM public.convert_postponement_debt_to_permanent(
    pg_temp.uid(7, 3, 3), 'post_release_refund', 2500, timestamptz '2026-10-22 00:00:00+00'
  );
  IF (pg_temp.app(v_temp, v_r3)).converted_cents <> 0
     OR (pg_temp.app(v_temp, v_r4)).converted_cents <> 2500 THEN
    RAISE EXCEPTION 'T6 conversion took a handed-back part: r3 % r4 %',
      (pg_temp.app(v_temp, v_r3)).converted_cents, (pg_temp.app(v_temp, v_r4)).converted_cents;
  END IF;
  SELECT a.* INTO v_conv FROM public.payout_debt_applications a
  JOIN public.organiser_payout_debts d ON d.id = a.debt_id
  WHERE d.origin_release_id = pg_temp.uid(7, 3, 3) AND d.kind = 'post_release_refund';
  IF v_conv.release_id <> v_r4 OR v_conv.amount_cents <> 2500 THEN
    RAISE EXCEPTION 'T6 converted-apply row: %', row_to_json(v_conv);
  END IF;
  IF (SELECT withheld_cents FROM public.issue_3645_release_projected_totals(v_r4)) <> 6500 THEN
    RAISE EXCEPTION 'T6 conversion changed the withheld total';
  END IF;
  PERFORM pg_temp.assert_i1('T6');
END
$t5$;

-- T7-T10: maturity.
DO $t7$
DECLARE
  v_q uuid;
  v_t uuid;
  v_s uuid;
  v_f uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_r3 uuid;
  v_r4 uuid;
  v_mature constant timestamptz := timestamptz '2026-10-29 00:00:00+00';
BEGIN
  PERFORM pg_temp.brand(4);
  -- T7: a postponement debt matures on an unpaid release. The withheld 2000
  -- goes back through net (a 'matured' return), with no recredit on top and
  -- no writeoff (it was fully withheld).
  v_q := pg_temp.temp_debt(4, 1, 2000, timestamptz '2026-10-25 00:00:00+00');
  v_r1 := pg_temp.stay(4, 1);
  IF (pg_temp.rel(v_r1)).net_release_cents <> 8000 THEN
    RAISE EXCEPTION 'T7 fixture net %', (pg_temp.rel(v_r1)).net_release_cents;
  END IF;
  -- T8 fixture: a second postponement debt, then a hold before maturity.
  v_t := pg_temp.temp_debt(4, 2, 3000, timestamptz '2026-10-25 00:00:00+00');
  v_r2 := pg_temp.stay(4, 2);
  PERFORM pg_temp.dispute(4, 2, 'dp_3645d_4', 9000, 'needs_response');
  IF pg_temp.returned(v_t, v_r2, 'hold') <> 2000 OR (pg_temp.d(v_t)).recovered_cents <> 1000 THEN
    RAISE EXCEPTION 'T8 hold return before maturity: %', pg_temp.returned(v_t, v_r2, 'hold');
  END IF;
  -- T9 fixture: a paid release; T10 fixture: an in-flight release.
  -- (Their own brand: brand 4's reopened debt would be withheld from them.)
  PERFORM pg_temp.brand(7);
  v_s := pg_temp.temp_debt(7, 3, 1500, timestamptz '2026-10-25 00:00:00+00');
  v_r3 := pg_temp.stay(7, 3);
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_mature - interval '1 day'
  WHERE id = v_r3;
  v_f := pg_temp.temp_debt(7, 4, 1200, timestamptz '2026-10-25 00:00:00+00');
  v_r4 := pg_temp.stay(7, 4);
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', stripe_execution_claim_id = gen_random_uuid(),
      stripe_execution_claimed_at = v_mature
  WHERE id = v_r4;

  PERFORM public.mature_postponement_debts(v_mature);

  -- T7
  IF pg_temp.returned(v_q, v_r1, 'matured') <> 2000
     OR (pg_temp.rel(v_r1)).net_release_cents <> 10000
     OR pg_temp.adj(v_r1, 'maturity_recredit') <> 0
     OR pg_temp.adj(pg_temp.uid(7, 4, 1), 'debt_writeoff') <> 0
     OR (pg_temp.d(v_q)).status <> 'closed'
     OR (pg_temp.app(v_q, v_r1)).released_at IS NULL THEN
    RAISE EXCEPTION 'T7 matured on unpaid: returned % net %', pg_temp.returned(v_q, v_r1, 'matured'),
      (pg_temp.rel(v_r1)).net_release_cents;
  END IF;
  IF (SELECT coalesce(sum(amount_cents), 0) FROM public.payout_debt_events
      WHERE debt_id = v_q AND event_kind = 'future_value_released') <> 2000 THEN
    RAISE EXCEPTION 'T7 future_value_released event missing';
  END IF;

  -- T8: held 1000 still withheld at maturity goes back through net; the
  -- 2000 handed back earlier is written off (principal − recovered); nothing
  -- is recredited: matured 1000 + writeoff 2000 = principal 3000.
  IF pg_temp.returned(v_t, v_r2, 'matured') <> 1000
     OR (pg_temp.rel(v_r2)).net_release_cents <> 1000
     OR pg_temp.adj(v_r2, 'maturity_recredit') <> 0
     OR pg_temp.adj(pg_temp.uid(7, 4, 2), 'debt_writeoff') <> 2000 THEN
    RAISE EXCEPTION 'T8 matured after hold: returned % net %', pg_temp.returned(v_t, v_r2, 'matured'),
      (pg_temp.rel(v_r2)).net_release_cents;
  END IF;

  -- T9: a paid release keeps today's recredit.
  IF pg_temp.adj(v_r3, 'maturity_recredit') <> 1500
     OR pg_temp.returned(v_s, v_r3, 'matured') <> 0 THEN
    RAISE EXCEPTION 'T9 paid release recredit wrong';
  END IF;

  -- T10: a payout in flight holds the whole debt back a tick, untouched.
  IF (pg_temp.d(v_f)).status <> 'open' OR (pg_temp.app(v_f, v_r4)).released_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.payout_ledger_adjustments WHERE release_id = v_r4)
     OR EXISTS (SELECT 1 FROM public.payout_debt_application_returns WHERE debt_id = v_f) THEN
    RAISE EXCEPTION 'T10 in-flight debt was touched';
  END IF;
  -- Once the claim lets go, the next tick returns it through net.
  UPDATE public.brand_payout_releases
  SET status = 'pending', stripe_execution_claim_id = NULL, stripe_execution_claimed_at = NULL
  WHERE id = v_r4;
  PERFORM public.mature_postponement_debts(v_mature + interval '1 hour');
  IF pg_temp.returned(v_f, v_r4, 'matured') <> 1200
     OR (pg_temp.rel(v_r4)).net_release_cents <> 10000 THEN
    RAISE EXCEPTION 'T10 next tick: returned %', pg_temp.returned(v_f, v_r4, 'matured');
  END IF;
  PERFORM pg_temp.assert_i1('T10');

  -- I4: every matured postponement debt is fully accounted for: recredits +
  -- 'matured' returns + writeoff = principal (nothing paid twice, nothing lost).
  IF EXISTS (
    SELECT 1 FROM public.organiser_payout_debts d
    WHERE d.id IN (v_q, v_t, v_s, v_f)
      AND d.principal_cents <> (
        SELECT coalesce(sum(adj.amount_cents), 0) FROM public.payout_ledger_adjustments adj
        WHERE adj.kind = 'maturity_recredit'
          AND adj.idempotency_key IN (
            SELECT 'postpone-recredit:' || a.id FROM public.payout_debt_applications a
            WHERE a.debt_id = d.id)
      ) + (
        SELECT coalesce(sum(ret.amount_cents), 0) FROM public.payout_debt_application_returns ret
        WHERE ret.debt_id = d.id AND ret.reason = 'matured'
      ) + (
        SELECT coalesce(sum(adj.amount_cents), 0) FROM public.payout_ledger_adjustments adj
        WHERE adj.kind = 'debt_writeoff' AND adj.release_id = d.origin_release_id
      )
  ) THEN
    RAISE EXCEPTION 'I4 broken: a matured debt is not fully accounted for';
  END IF;
END
$t7$;

-- T10b: a hold and maturity end in the same state whichever lands first.
-- Brand 10 settles the hold, then matures; brand 11 matures first (the hold
-- was recorded but its refresh had not run).
DO $t10b$
DECLARE
  v_b integer;
  v_perm uuid[];
  v_temp uuid[];
  v_rel uuid[];
  v_state text[];
BEGIN
  FOREACH v_b IN ARRAY ARRAY[10, 11] LOOP
    PERFORM pg_temp.brand(v_b);
    v_perm := v_perm || pg_temp.debt(v_b, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
    v_temp := v_temp || pg_temp.temp_debt(v_b, 2, 4000, timestamptz '2026-10-25 00:00:00+00');
    v_rel := v_rel || pg_temp.stay(v_b, 1);
  END LOOP;

  -- Brand 10: the hold is settled by its refresh before maturity.
  PERFORM pg_temp.dispute(10, 1, 'dp_3645d_10', 9000, 'needs_response');
  -- Brand 11: the hold is recorded, but its refresh has not run yet.
  INSERT INTO public.stay_payout_release_holds(
    release_id, line_id, kind, refunded_cents, disputed_cents, net_hold_cents,
    provider_ref, idempotency_key
  ) VALUES (
    v_rel[2], pg_temp.uid(5, 11, 1), 'dispute_opened', 0, 9000, 9000,
    'dp_3645d_11', 'issue-3645-2d-hold-11'
  );
  -- Maturity reaches both; then the planner's pass settles whatever is left.
  PERFORM public.mature_postponement_debts(timestamptz '2026-10-29 00:00:00+00');
  PERFORM public.plan_pending_payout_partner_legs(500);

  FOR i IN 1..2 LOOP
    v_state := v_state || concat_ws('|',
      'temp hold ' || pg_temp.returned(v_temp[i], v_rel[i], 'hold'),
      'temp matured ' || pg_temp.returned(v_temp[i], v_rel[i], 'matured'),
      'perm hold ' || pg_temp.returned(v_perm[i], v_rel[i], 'hold'),
      'writeoff ' || pg_temp.adj(pg_temp.uid(7, 9 + i, 2), 'debt_writeoff'),
      'recredit ' || pg_temp.adj(v_rel[i], 'maturity_recredit'),
      'net ' || (pg_temp.rel(v_rel[i])).net_release_cents,
      'perm ' || (pg_temp.d(v_perm[i])).status || ' ' || (pg_temp.d(v_perm[i])).recovered_cents,
      'temp ' || (pg_temp.d(v_temp[i])).status
    );
  END LOOP;
  IF v_state[1] <> v_state[2]
     OR v_state[1] <> 'temp hold 4000|temp matured 0|perm hold 2000|writeoff 4000|recredit 0|net 0|perm open 1000|temp closed' THEN
    RAISE EXCEPTION 'T10b order changed the ledger: settle-first % / mature-first %', v_state[1], v_state[2];
  END IF;
END
$t10b$;

-- T11-T13: guards, partner legs, the Paystack refresh and the planner fallback.
DO $t11$
DECLARE
  v_debt uuid;
  v_r uuid;
  v_leg uuid;
  v_status text;
BEGIN
  PERFORM pg_temp.brand(5);
  v_debt := pg_temp.debt(5, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_r := pg_temp.stay(5, 1);
  -- A hold recorded with no refresh: the release is short and not settled yet.
  INSERT INTO public.stay_payout_release_holds(
    release_id, line_id, kind, refunded_cents, disputed_cents, net_hold_cents,
    provider_ref, idempotency_key
  ) VALUES (
    v_r, pg_temp.uid(5, 5, 1), 'dispute_opened', 0, 9000, 9000, 'dp_3645d_5',
    'issue-3645-2d-hold-5'
  );

  -- T11: statuses that are paid, being paid or finished hand back nothing.
  FOREACH v_status IN ARRAY ARRAY['released', 'in_flight', 'cancelled_event', 'reanchored', 'failed'] LOOP
    UPDATE public.brand_payout_releases SET status = v_status WHERE id = v_r;
    IF public.issue_3645_return_unrecovered_release_debt(v_r) <> 0 THEN
      RAISE EXCEPTION 'T11 % handed debt back', v_status;
    END IF;
  END LOOP;
  -- An organiser leg under way blocks it too.
  UPDATE public.brand_payout_releases SET status = 'blocked_kyc' WHERE id = v_r;
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_r, 'organiser', 0, 7000, 'test', 'planned')
  RETURNING id INTO v_leg;
  IF public.issue_3645_return_unrecovered_release_debt(v_r) <> 0 THEN
    RAISE EXCEPTION 'T11 organiser leg did not block';
  END IF;
  UPDATE public.payout_transfer_legs SET status = 'failed' WHERE id = v_leg;

  -- T12: a partner leg never blocks, and a blocked_kyc release is settled
  -- (the Stripe claim pays blocked releases too).
  BEGIN
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.payout_transfer_legs(
      release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
    ) VALUES (v_r, 'partner', 0, 100, 'test', 'planned');
    SET LOCAL session_replication_role = origin;
  END;
  -- Through the Paystack refresh with a claim in flight: it resets the claim
  -- first, so settle sees the release unpaid and hands the 2000 back.
  UPDATE public.brand_payout_releases
  SET provider = 'paystack', status = 'in_flight',
      paystack_execution_claim_id = gen_random_uuid(), paystack_execution_claimed_at = now()
  WHERE id = v_r;
  PERFORM public.refresh_paystack_dispute_release_projection(v_r);
  IF (pg_temp.rel(v_r)).status <> 'pending'
     OR pg_temp.returned(v_debt, v_r, 'hold') <> 2000
     OR (pg_temp.rel(v_r)).net_release_cents <> 0
     OR (pg_temp.d(v_debt)).status <> 'open' THEN
    RAISE EXCEPTION 'T12 paystack in-flight refresh: status % returned %',
      (pg_temp.rel(v_r)).status, pg_temp.returned(v_debt, v_r, 'hold');
  END IF;
  PERFORM pg_temp.assert_i1('T12');
END
$t11$;

-- T12c (known gap, pinned): a Paystack claim plans organiser legs before it
-- authorizes. While a never-sent organiser leg stays 'planned', the release
-- is not settleable: a hold leaves its debt counted as recovered, and
-- maturity books today's recredit. Voiding unsent legs when the release goes
-- back to pending is tracked on #3645 (a re-claim reuses those legs at their
-- old principal, so returning debt here would not change what is paid).
DO $t12c$
DECLARE
  v_debt uuid;
  v_temp uuid;
  v_r uuid;
BEGIN
  PERFORM pg_temp.brand(12);
  v_debt := pg_temp.debt(12, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_temp := pg_temp.temp_debt(12, 2, 1000, timestamptz '2026-10-25 00:00:00+00');
  v_r := pg_temp.stay(12, 1);
  INSERT INTO public.stay_payout_release_holds(
    release_id, line_id, kind, refunded_cents, disputed_cents, net_hold_cents,
    provider_ref, idempotency_key
  ) VALUES (
    v_r, pg_temp.uid(5, 12, 1), 'dispute_opened', 0, 9000, 9000, 'dp_3645d_12',
    'issue-3645-2d-hold-12'
  );
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_r, 'organiser', 0, 6000, 'test', 'planned');
  UPDATE public.brand_payout_releases
  SET provider = 'paystack', status = 'in_flight',
      paystack_execution_claim_id = gen_random_uuid(), paystack_execution_claimed_at = now()
  WHERE id = v_r;
  PERFORM public.refresh_paystack_dispute_release_projection(v_r);
  IF (pg_temp.rel(v_r)).status <> 'pending'
     OR (pg_temp.rel(v_r)).net_release_cents <> 0
     OR EXISTS (SELECT 1 FROM public.payout_debt_application_returns WHERE release_id = v_r)
     OR (pg_temp.d(v_debt)).status <> 'closed' THEN
    RAISE EXCEPTION 'T12c pinned behaviour changed: status % returns %', (pg_temp.rel(v_r)).status,
      (SELECT count(*) FROM public.payout_debt_application_returns WHERE release_id = v_r);
  END IF;
  PERFORM public.mature_postponement_debts(timestamptz '2026-10-29 00:00:00+00');
  IF pg_temp.adj(v_r, 'maturity_recredit') <> 1000
     OR pg_temp.returned(v_temp, v_r, 'matured') <> 0 THEN
    RAISE EXCEPTION 'T12c maturity on a planned-leg release changed';
  END IF;
END
$t12c$;

-- T12b: a blocked release is still unpaid (the Stripe claim pays blocked_kyc
-- and blocked_balance), so a hold on it hands the debt back.
DO $t12b$
DECLARE
  v_debt uuid;
  v_r uuid;
BEGIN
  PERFORM pg_temp.brand(8);
  v_debt := pg_temp.debt(8, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_r := pg_temp.stay(8, 1);
  UPDATE public.brand_payout_releases SET status = 'blocked_kyc' WHERE id = v_r;
  -- A planned partner leg (the planner adds them before every claim) must
  -- not make the stay refresh refuse the hold and retry forever.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_r, 'partner', 0, 100, 'test', 'planned');
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.dispute(8, 1, 'dp_3645d_8', 9000, 'needs_response');
  IF pg_temp.returned(v_debt, v_r, 'hold') <> 2000
     OR (pg_temp.d(v_debt)).status <> 'open'
     OR (pg_temp.rel(v_r)).status <> 'blocked_kyc' THEN
    RAISE EXCEPTION 'T12b blocked_kyc: returned %', pg_temp.returned(v_debt, v_r, 'hold');
  END IF;
END
$t12b$;

-- T13: a settle that fails on one release never stops the planner: it warns
-- with the SQLSTATE and uses the plain projection.
CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'issue_3645_2d_forced' USING ERRCODE = 'XX001'; END $$;
DO $t13$
DECLARE
  v_debt uuid;
  v_r uuid;
  v_result jsonb;
BEGIN
  PERFORM pg_temp.brand(6);
  v_debt := pg_temp.debt(6, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_r := pg_temp.stay(6, 1);
  INSERT INTO public.stay_payout_release_holds(
    release_id, line_id, kind, refunded_cents, disputed_cents, net_hold_cents,
    provider_ref, idempotency_key
  ) VALUES (
    v_r, pg_temp.uid(5, 6, 1), 'dispute_opened', 0, 9000, 9000, 'dp_3645d_6',
    'issue-3645-2d-hold-6'
  );
  EXECUTE 'CREATE TRIGGER t13_boom BEFORE INSERT ON public.payout_debt_application_returns
           FOR EACH ROW EXECUTE FUNCTION pg_temp.boom()';
  v_result := public.plan_pending_payout_partner_legs(500);
  IF v_result IS NULL OR (pg_temp.rel(v_r)).net_release_cents <> 0
     OR pg_temp.returned(v_debt, v_r, 'hold') <> 0 THEN
    RAISE EXCEPTION 'T13 planner fallback: %', v_result;
  END IF;
  EXECUTE 'DROP TRIGGER t13_boom ON public.payout_debt_application_returns';
  -- The next pass settles it.
  PERFORM public.plan_pending_payout_partner_legs(500);
  IF pg_temp.returned(v_debt, v_r, 'hold') <> 2000 THEN
    RAISE EXCEPTION 'T13 next pass did not settle';
  END IF;
END
$t13$;

-- T14: the table is append-only, bounded and private.
DO $t14$
DECLARE
  v_ret public.payout_debt_application_returns;
  v_ok boolean;
BEGIN
  SELECT * INTO v_ret FROM public.payout_debt_application_returns LIMIT 1;
  BEGIN
    UPDATE public.payout_debt_application_returns SET amount_cents = 1 WHERE id = v_ret.id;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM = 'payout_ledger_append_only';
  END;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T14 update allowed'; END IF;
  BEGIN
    DELETE FROM public.payout_debt_application_returns WHERE id = v_ret.id;
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM = 'payout_ledger_append_only';
  END;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T14 delete allowed'; END IF;
  -- Never more than the application still withholds.
  BEGIN
    INSERT INTO public.payout_debt_application_returns(
      application_id, debt_id, release_id, reason, amount_cents, idempotency_key
    ) SELECT a.id, a.debt_id, a.release_id, 'hold',
        a.amount_cents - a.converted_cents
          - public.issue_3645_application_returned_cents(a.id) + 1,
        'issue-3645-2d-over'
      FROM public.payout_debt_applications a WHERE a.id = v_ret.application_id;
    v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := SQLERRM = 'debt_return_exceeds_application';
  END;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T14 over-return allowed'; END IF;
  -- A return names its application's own release.
  BEGIN
    INSERT INTO public.payout_debt_application_returns(
      application_id, debt_id, release_id, reason, amount_cents, idempotency_key
    ) VALUES (
      v_ret.application_id, v_ret.debt_id, pg_temp.uid(7, 1, 1), 'hold', 1,
      'issue-3645-2d-mismatch'
    );
    v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := SQLERRM = 'debt_return_application_mismatch';
  END;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T14 mismatched release allowed'; END IF;
  -- The new event kind is accepted; an unknown one still is not.
  BEGIN
    INSERT INTO public.payout_debt_events(debt_id, event_kind, idempotency_key)
    VALUES (v_ret.debt_id, 'bogus', 'issue-3645-2d-bogus');
    v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'T14 unknown event kind allowed'; END IF;

  IF has_table_privilege('anon', 'public.payout_debt_application_returns', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payout_debt_application_returns', 'SELECT')
     OR has_table_privilege('service_role', 'public.payout_debt_application_returns', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.payout_debt_application_returns', 'SELECT') THEN
    RAISE EXCEPTION 'T14 table grants wrong';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_3645_return_unrecovered_release_debt(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3645_settle_release_projection(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3645_release_projected_totals(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_3645_settle_release_projection(uuid, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_3645_release_projected_totals(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T14 function grants wrong';
  END IF;
END
$t14$;

ROLLBACK;
