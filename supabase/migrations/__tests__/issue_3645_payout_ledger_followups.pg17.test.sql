-- Issue #3645 bundle 4 — payout ledger follow-ups from bundle 2d.
--
-- MINGLA-INVARIANT: I-3645-MATURED-VALUE-CARRIED | issue #3645 | A postponement debt that matures after its release already paid carries the part of the withheld value its transfers did not send to the brand's next payable release (same provider and currency, never claimed), placed inside that provider's claim before it reads recredits, as a maturity_recredit the claim pays; a carrier closed before any claim moves it on again; a release that has not paid never carries; nothing is paid twice.
-- MINGLA-INVARIANT: I-3645-PAYSTACK-PLAN-NEVER-OVER-DUE | issue #3645 | authorize_paystack_payout_execution never lets a Paystack organiser plan be sent when it is larger than the release's current net plus recredits; the release goes back to pending with a paystack_plan_exceeds_due alert and its legs are kept.
-- MINGLA-INVARIANT: I-3645-CLOSED-RELEASE-DEBT-RETURNED | issue #3645 | Debt withheld by a release closed with its event before it was ever claimed (no organiser leg other than failed or reversed, no provider id) is handed back as a release_closed return and owed again; a release that was ever claimed hands back nothing.

BEGIN;

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
  SELECT ('3645e000-' || lpad(p_kind::text, 4, '0') || '-4000-8000-'
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
  VALUES (v_owner, 'issue-3645-b4-' || p_b || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 b4 ' || p_b, 'issue-3645-b4-' || p_b,
    'stripe', 'US', 'USD', 'USD', timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.venue_listings(
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    pg_temp.uid(3, p_b, 0), v_brand, 'issue3645b4' || p_b, 'Issue 3645 b4 stay ' || p_b,
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
    v_group, 'ST-36454' || lpad((p_b * 1000 + p_n)::text, 15, '0'), gen_random_uuid(),
    repeat('a', 64), pg_temp.uid(3, p_b, 0), pg_temp.uid(2, p_b, 0), 'USD',
    'instant', 'confirmed', '{}'::jsonb, 10000, 450, 0, 10450,
    'issue-3645-b4-group-' || p_b || '-' || p_n, repeat('b', 64)
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
    'pi_3645e_' || p_b || '_' || p_n, 'issue-3645-b4-attempt-' || p_b || '-' || p_n,
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
    v_id, pg_temp.uid(2, p_b, 0), 'issue-3645-b4-origin-' || p_b || '-' || p_n,
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
    'post_release_refund', p_principal, 'issue-3645-b4-debt-' || p_b || '-' || p_n,
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
    'pi_3645e_' || p_b || '_' || p_n, p_ref, p_amount, 'USD', p_status
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
  WHERE d.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-b4-%')
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
    WHERE r.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-b4-%')
      AND r.permanent_debt_withheld_cents + r.temporary_debt_withheld_cents
        <> coalesce((SELECT sum(a.amount_cents - a.converted_cents)
                     FROM public.payout_debt_applications a WHERE a.release_id = r.id), 0)
  ) THEN
    RAISE EXCEPTION '% I2 broken: stored withheld columns disagree with the applications', p_label;
  END IF;
  -- I3: every settled unpaid release stores the projected net, and none
  -- withholds more than its items cover.
  IF EXISTS (
    SELECT 1 FROM public.brand_payout_releases r
    CROSS JOIN LATERAL public.issue_3645_release_projected_totals(r.id) t
    WHERE r.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-b4-%')
      AND public.issue_3645_release_settleable(r.id)
      AND EXISTS (SELECT 1 FROM public.payout_release_items i WHERE i.release_id = r.id)
      AND (r.net_release_cents <> t.net_release_cents
           OR t.withheld_cents > t.items_net_cents)
  ) THEN
    RAISE EXCEPTION '% I3 broken: a settled release stores a stale net', p_label;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.carry(p_debt uuid, p_release uuid)
RETURNS public.payout_maturity_carryovers
LANGUAGE sql STABLE AS $$
  SELECT c.* FROM public.payout_maturity_carryovers c
  JOIN public.payout_debt_applications a ON a.id = c.application_id
  WHERE a.debt_id = p_debt AND a.release_id = p_release
    AND c.parent_carryover_id IS NULL
$$;

-- Claim once and put back, as a refused claim does.
CREATE FUNCTION pg_temp.claimed_once(p_release uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', stripe_execution_claim_id = gen_random_uuid(),
      stripe_execution_claimed_at = now()
  WHERE id = p_release;
  UPDATE public.brand_payout_releases
  SET status = 'pending', stripe_execution_claim_id = NULL,
      stripe_execution_claimed_at = NULL
  WHERE id = p_release;
$$;

-- I4: every matured postponement debt of this suite is fully accounted for:
-- recredits + carried value (root carryovers) + matured returns + writeoff
-- = principal. Carried value is counted once however often it moved on.
CREATE FUNCTION pg_temp.assert_i4(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organiser_payout_debts d
    WHERE d.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-b4-%')
      AND d.kind = 'post_release_postponement' AND d.status = 'closed'
      AND d.principal_cents <> (
        SELECT coalesce(sum(adj.amount_cents), 0) FROM public.payout_ledger_adjustments adj
        WHERE adj.kind = 'maturity_recredit'
          AND adj.idempotency_key IN (
            SELECT 'postpone-recredit:' || a.id FROM public.payout_debt_applications a
            WHERE a.debt_id = d.id)
      ) + (
        SELECT coalesce(sum(c.amount_cents), 0) FROM public.payout_maturity_carryovers c
        WHERE c.debt_id = d.id AND c.parent_carryover_id IS NULL
      ) + (
        SELECT coalesce(sum(ret.amount_cents), 0) FROM public.payout_debt_application_returns ret
        WHERE ret.debt_id = d.id AND ret.reason = 'matured'
      ) + (
        SELECT coalesce(sum(adj.amount_cents), 0) FROM public.payout_ledger_adjustments adj
        WHERE adj.kind = 'debt_writeoff' AND adj.release_id = d.origin_release_id
      )
  ) THEN
    RAISE EXCEPTION '% I4 broken: a matured debt is not fully accounted for', p_label;
  END IF;
END
$$;

-- I5: a placed carryover is exactly one recredit of its amount on its
-- carrier; an unplaced one has none; carried value moves on at most once per
-- carryover and keeps its amount.
CREATE FUNCTION pg_temp.assert_i5(p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payout_maturity_carryovers c
    WHERE c.brand_id IN (SELECT id FROM public.brands WHERE slug LIKE 'issue-3645-b4-%')
      AND (
        (SELECT count(*) FROM public.payout_ledger_adjustments a
         WHERE a.idempotency_key = 'carryover-recredit:' || c.id
           AND a.kind = 'maturity_recredit'
           AND a.release_id IS NOT DISTINCT FROM c.carried_release_id
           AND a.amount_cents = c.amount_cents)
        <> CASE WHEN c.carried_at IS NULL THEN 0 ELSE 1 END
        OR (SELECT count(*) FROM public.payout_ledger_adjustments a
            WHERE a.idempotency_key = 'carryover-recredit:' || c.id)
           <> CASE WHEN c.carried_at IS NULL THEN 0 ELSE 1 END
        OR (c.rehomed_at IS NOT NULL AND (
          SELECT count(*) FROM public.payout_maturity_carryovers k
          WHERE k.parent_carryover_id = c.id AND k.amount_cents = c.amount_cents
        ) <> 1)
      )
  ) THEN
    RAISE EXCEPTION '% I5 broken: carried value is not exactly one recredit on its carrier', p_label;
  END IF;
END
$$;

-- B1: matured value on a paid release waits as a carryover, and the next
-- Stripe claim places it on the brand's next payable release (earliest
-- first) before it reads recredits, so that claim pays net + the value.
DO $b1$
DECLARE
  v_mature constant timestamptz := timestamptz '2026-10-29 00:00:00+00';
  v_s uuid;
  v_paid uuid;
  v_next uuid;
  v_later uuid;
  v_c public.payout_maturity_carryovers;
  v_paid_total bigint;
BEGIN
  PERFORM pg_temp.brand(1);
  v_s := pg_temp.temp_debt(1, 1, 1500, timestamptz '2026-10-25 00:00:00+00');
  v_paid := pg_temp.stay(1, 1);
  UPDATE public.brand_payout_releases
  SET status = 'released', released_at = v_mature - interval '1 day'
  WHERE id = v_paid;
  v_next := pg_temp.stay(1, 2);
  v_later := pg_temp.stay(1, 3);
  -- Same due time (one sweep attached both): the earlier-created goes first.
  UPDATE public.brand_payout_releases
  SET created_at = created_at + interval '1 hour'
  WHERE id = v_later;

  PERFORM public.mature_postponement_debts(v_mature);
  v_c := pg_temp.carry(v_s, v_paid);
  IF v_c.id IS NULL OR v_c.amount_cents <> 1500 OR v_c.provider <> 'stripe'
     OR v_c.currency <> 'usd' OR v_c.carried_at IS NOT NULL
     OR pg_temp.adj(v_paid, 'maturity_recredit') <> 0
     OR (pg_temp.d(v_s)).status <> 'closed'
     OR pg_temp.adj(pg_temp.uid(7, 1, 1), 'debt_writeoff') <> 0 THEN
    RAISE EXCEPTION 'B1 maturity: carryover % recredit on paid %',
      v_c.amount_cents, pg_temp.adj(v_paid, 'maturity_recredit');
  END IF;

  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, payouts_enabled, country, default_currency
  ) VALUES (pg_temp.uid(2, 1, 0), 'acct_3645e_1', true, 'US', 'usd');
  SELECT c.net_release_cents::bigint + c.maturity_recredit_cents INTO v_paid_total
  FROM public.claim_stripe_payout_releases(100, v_mature + interval '1 day') c
  WHERE c.release_id = v_next;
  v_c := pg_temp.carry(v_s, v_paid);
  IF v_paid_total IS DISTINCT FROM 11500::bigint
     OR v_c.carried_release_id IS DISTINCT FROM v_next
     OR pg_temp.adj(v_next, 'maturity_recredit') <> 1500
     OR pg_temp.adj(v_later, 'maturity_recredit') <> 0
     OR (pg_temp.rel(v_next)).never_claimed IS NOT FALSE
     OR (pg_temp.rel(v_next)).net_release_cents <> 10000 THEN
    RAISE EXCEPTION 'B1 the Stripe claim pays % instead of 11500 (carried to %, next %)',
      v_paid_total, v_c.carried_release_id, v_next;
  END IF;

  -- Re-running maturity and placement adds nothing.
  PERFORM public.mature_postponement_debts(v_mature + interval '1 hour');
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '2 hours', 'stripe');
  IF (SELECT count(*) FROM public.payout_maturity_carryovers WHERE debt_id = v_s) <> 1
     OR pg_temp.adj(v_next, 'maturity_recredit') <> 1500 THEN
    RAISE EXCEPTION 'B1 re-run placed twice';
  END IF;
  PERFORM pg_temp.assert_i4('B1');
  PERFORM pg_temp.assert_i5('B1');
END
$b1$;

-- B2: the carrier must be one its provider's claim pays and that was never
-- claimed. Each candidate below fails exactly one rule and is skipped; with
-- none left the value waits, then lands on the first release that can.
DO $b2$
DECLARE
  v_mature constant timestamptz := timestamptz '2026-10-29 00:00:00+00';
  v_s uuid;
  v_paid uuid;
  v_r uuid;
  v_bad uuid[] := '{}';
  v_ok uuid;
  v_n integer;
BEGIN
  PERFORM pg_temp.brand(2);
  v_s := pg_temp.temp_debt(2, 1, 700, timestamptz '2026-10-25 00:00:00+00');
  v_paid := pg_temp.stay(2, 1);
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_mature
  WHERE id = v_paid;
  FOR v_n IN 2..9 LOOP
    v_r := pg_temp.stay(2, v_n);
    v_bad := v_bad || v_r;
  END LOOP;
  -- 2: in flight; 3: blocked_kyc; 4: Paystack; 5: attempt cap; 6: NGN;
  -- 7: a planned organiser leg; 8: claimed once; 9: a Stripe payout id.
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', stripe_execution_claim_id = gen_random_uuid(),
      stripe_execution_claimed_at = v_mature
  WHERE id = v_bad[1];
  UPDATE public.brand_payout_releases SET status = 'blocked_kyc' WHERE id = v_bad[2];
  UPDATE public.brand_payout_releases SET provider = 'paystack' WHERE id = v_bad[3];
  UPDATE public.brand_payout_releases SET attempt_count = 10 WHERE id = v_bad[4];
  UPDATE public.brand_payout_releases SET currency = 'ngn' WHERE id = v_bad[5];
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_bad[6], 'organiser', 0, 9000, 'test', 'planned');
  PERFORM pg_temp.claimed_once(v_bad[7]);
  UPDATE public.brand_payout_releases SET stripe_payout_id = 'po_3645e_b2' WHERE id = v_bad[8];

  PERFORM public.mature_postponement_debts(v_mature);
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature, 'stripe');
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature, 'paystack');
  IF (pg_temp.carry(v_s, v_paid)).id IS NULL
     OR (pg_temp.carry(v_s, v_paid)).carried_at IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.payout_ledger_adjustments
       WHERE kind = 'maturity_recredit' AND release_id = ANY (v_bad || v_paid)
     ) THEN
    RAISE EXCEPTION 'B2 carried onto an ineligible release: %',
      (pg_temp.carry(v_s, v_paid)).carried_release_id;
  END IF;

  -- A payable release appears (a later sale): the next tick places it there.
  -- Placement is per provider: a Paystack claim never places Stripe value.
  v_ok := pg_temp.stay(2, 11);
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '1 hour', 'paystack');
  IF (pg_temp.carry(v_s, v_paid)).carried_at IS NOT NULL THEN
    RAISE EXCEPTION 'B2 a Paystack placement moved Stripe value';
  END IF;
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '1 hour', 'stripe');
  IF (pg_temp.carry(v_s, v_paid)).carried_release_id IS DISTINCT FROM v_ok
     OR pg_temp.adj(v_ok, 'maturity_recredit') <> 700 THEN
    RAISE EXCEPTION 'B2 waiting value not placed on the new payable release';
  END IF;
  PERFORM pg_temp.assert_i4('B2');
  PERFORM pg_temp.assert_i5('B2');
END
$b2$;

-- B3: a carrier closed with its event before any claim moves the value on
-- (once); a carrier that was claimed, or sent money, keeps it.
DO $b3$
DECLARE
  v_mature constant timestamptz := timestamptz '2026-10-29 00:00:00+00';
  v_s uuid;
  v_paid uuid;
  v_carrier uuid;
  v_next uuid;
  v_root public.payout_maturity_carryovers;
  v_child public.payout_maturity_carryovers;
  v_s2 uuid;
  v_paid2 uuid;
  v_carrier2 uuid;
BEGIN
  PERFORM pg_temp.brand(3);
  v_s := pg_temp.temp_debt(3, 1, 900, timestamptz '2026-10-25 00:00:00+00');
  v_paid := pg_temp.stay(3, 1);
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_mature
  WHERE id = v_paid;
  v_carrier := pg_temp.stay(3, 2);
  PERFORM public.mature_postponement_debts(v_mature);
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature, 'stripe');
  IF (pg_temp.carry(v_s, v_paid)).carried_release_id IS DISTINCT FROM v_carrier THEN
    RAISE EXCEPTION 'B3 fixture: not carried to the carrier';
  END IF;

  -- Closed before a claim, with no other carrier yet: the value moves on to
  -- a new carryover that waits.
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = v_carrier;
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '1 hour', 'stripe');
  v_root := pg_temp.carry(v_s, v_paid);
  SELECT * INTO v_child FROM public.payout_maturity_carryovers WHERE parent_carryover_id = v_root.id;
  IF v_root.rehomed_at IS NULL OR v_child.id IS NULL OR v_child.amount_cents <> 900
     OR v_child.carried_at IS NOT NULL THEN
    RAISE EXCEPTION 'B3 not moved on to a waiting carryover';
  END IF;
  PERFORM pg_temp.assert_i5('B3 waiting');

  -- A payable release appears: the child lands there, once; the old
  -- recredit stays as history on the closed carrier, which no claim pays.
  v_next := pg_temp.stay(3, 3);
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '2 hours', 'stripe');
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '3 hours', 'stripe');
  SELECT * INTO v_child FROM public.payout_maturity_carryovers WHERE parent_carryover_id = v_root.id;
  IF v_child.carried_release_id IS DISTINCT FROM v_next
     OR pg_temp.adj(v_next, 'maturity_recredit') <> 900
     OR pg_temp.adj(v_carrier, 'maturity_recredit') <> 900
     OR (SELECT count(*) FROM public.payout_maturity_carryovers WHERE debt_id = v_s) <> 2 THEN
    RAISE EXCEPTION 'B3 child not placed once: carried to %', v_child.carried_release_id;
  END IF;

  -- Two hops: the second carrier is closed too.
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = v_next;
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '4 hours', 'stripe');
  IF (SELECT count(*) FROM public.payout_maturity_carryovers
      WHERE parent_carryover_id = v_child.id AND amount_cents = 900) <> 1 THEN
    RAISE EXCEPTION 'B3 second hop missing';
  END IF;
  PERFORM pg_temp.assert_i4('B3');
  PERFORM pg_temp.assert_i5('B3');

  -- A carrier that was claimed before it closed keeps the value (a payout
  -- may exist whose id was never recorded).
  PERFORM pg_temp.brand(13);
  v_s2 := pg_temp.temp_debt(13, 1, 400, timestamptz '2026-10-25 00:00:00+00');
  v_paid2 := pg_temp.stay(13, 1);
  UPDATE public.brand_payout_releases SET status = 'released', released_at = v_mature
  WHERE id = v_paid2;
  v_carrier2 := pg_temp.stay(13, 2);
  PERFORM public.mature_postponement_debts(v_mature);
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature, 'stripe');
  IF (pg_temp.carry(v_s2, v_paid2)).carried_release_id IS DISTINCT FROM v_carrier2 THEN
    RAISE EXCEPTION 'B3 fixture 2: not carried';
  END IF;
  PERFORM pg_temp.claimed_once(v_carrier2);
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = v_carrier2;
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature + interval '3 days', 'stripe');
  IF (pg_temp.carry(v_s2, v_paid2)).rehomed_at IS NOT NULL
     OR (SELECT count(*) FROM public.payout_maturity_carryovers WHERE debt_id = v_s2) <> 1 THEN
    RAISE EXCEPTION 'B3 a once-claimed carrier gave its value away again';
  END IF;
END
$b3$;

-- B4: debt withheld by a release closed before any claim is handed back,
-- owed again, and withheld by the next release; once only.
DO $b4$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-30 00:00:00+00';
  v_debt uuid;
  v_r uuid;
  v_next uuid;
BEGIN
  PERFORM pg_temp.brand(4);
  v_debt := pg_temp.debt(4, 1, 3000, timestamptz '2026-10-01 00:00:00+00');
  v_r := pg_temp.stay(4, 1);
  IF (pg_temp.d(v_debt)).status <> 'closed' OR (pg_temp.rel(v_r)).net_release_cents <> 7000 THEN
    RAISE EXCEPTION 'B4 fixture: debt % net %', (pg_temp.d(v_debt)).status, (pg_temp.rel(v_r)).net_release_cents;
  END IF;
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = v_r;

  -- Through the sweep's maturity step, as production runs it.
  PERFORM public.mature_postponement_debts(v_now);
  IF pg_temp.returned(v_debt, v_r, 'release_closed') <> 3000
     OR (pg_temp.d(v_debt)).status <> 'open'
     OR (pg_temp.d(v_debt)).recovered_cents <> 0
     OR (pg_temp.d(v_debt)).closed_at IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.payout_debt_events
       WHERE debt_id = v_debt AND event_kind = 'recovery_returned'
         AND amount_cents = 3000 AND release_id = v_r
     ) THEN
    RAISE EXCEPTION 'B4 not handed back: returned % status %',
      pg_temp.returned(v_debt, v_r, 'release_closed'), (pg_temp.d(v_debt)).status;
  END IF;
  PERFORM pg_temp.assert_i1('B4');

  IF public.issue_3645_return_closed_release_debt(v_now + interval '1 day') <> 0
     OR pg_temp.returned(v_debt, v_r, 'release_closed') <> 3000 THEN
    RAISE EXCEPTION 'B4 handed back twice';
  END IF;

  -- The next release withholds it again.
  v_next := pg_temp.stay(4, 2);
  IF (pg_temp.rel(v_next)).net_release_cents <> 7000
     OR (pg_temp.d(v_debt)).status <> 'closed' THEN
    RAISE EXCEPTION 'B4 next release did not withhold: net %', (pg_temp.rel(v_next)).net_release_cents;
  END IF;
  PERFORM pg_temp.assert_i1('B4 next');
END
$b4$;

-- B5: a closed release that may have sent money hands back nothing: a live
-- organiser leg, a Stripe payout id, a Paystack transfer code, or a claim
-- (a payout may exist whose id was never recorded). A failed organiser leg
-- and a partner leg do not count.
DO $b5$
DECLARE
  v_now constant timestamptz := timestamptz '2026-10-30 00:00:00+00';
  v_rels uuid[] := '{}';
  v_debts uuid[] := '{}';
  v_ok_r uuid;
  v_ok_debt uuid;
  v_b integer;
BEGIN
  FOR v_b IN 5..8 LOOP
    PERFORM pg_temp.brand(v_b);
    v_debts := v_debts || pg_temp.debt(v_b, 1, 6000, timestamptz '2026-10-01 00:00:00+00');
    v_rels := v_rels || pg_temp.stay(v_b, 1);
  END LOOP;
  -- Each withholds 6000, so a hand-back would be visible.
  IF EXISTS (
    SELECT 1 FROM unnest(v_debts, v_rels) AS x(d, r)
    WHERE (pg_temp.app(x.d, x.r)).amount_cents IS DISTINCT FROM 6000
  ) THEN
    RAISE EXCEPTION 'B5 fixture: not withheld';
  END IF;
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_rels[1], 'organiser', 0, 4000, 'test', 'planned');
  UPDATE public.brand_payout_releases SET stripe_payout_id = 'po_3645e_6' WHERE id = v_rels[2];
  UPDATE public.brand_payout_releases
  SET provider = 'paystack', paystack_transfer_code = 'TRF_3645e_7'
  WHERE id = v_rels[3];
  PERFORM pg_temp.claimed_once(v_rels[4]);
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = ANY (v_rels);

  PERFORM public.issue_3645_return_closed_release_debt(v_now);
  IF EXISTS (
    SELECT 1 FROM public.payout_debt_application_returns WHERE release_id = ANY (v_rels)
  ) THEN
    RAISE EXCEPTION 'B5 a release that may have sent money handed debt back';
  END IF;

  -- Positive control: same fixture, a failed organiser leg and a partner leg.
  PERFORM pg_temp.brand(9);
  v_ok_debt := pg_temp.debt(9, 1, 2500, timestamptz '2026-10-01 00:00:00+00');
  v_ok_r := pg_temp.stay(9, 1);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_ok_r, 'organiser', 0, 7500, 'test', 'failed'),
           (v_ok_r, 'partner', 0, 100, 'test', 'succeeded');
  SET LOCAL session_replication_role = origin;
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = v_ok_r;
  PERFORM public.issue_3645_return_closed_release_debt(v_now);
  IF pg_temp.returned(v_ok_debt, v_ok_r, 'release_closed') <> 2500 THEN
    RAISE EXCEPTION 'B5 failed/partner legs blocked the hand-back: %',
      pg_temp.returned(v_ok_debt, v_ok_r, 'release_closed');
  END IF;
  PERFORM pg_temp.assert_i1('B5');
END
$b5$;

-- B6: a postponement debt on releases that never paid. Closed before any
-- claim (an hour before maturity): handed back, nothing carried, the whole
-- principal written off. Closed after a claim: 2d's recredit stays on the
-- dead release, nothing carried or handed back (the items no longer fund it).
DO $b6$
DECLARE
  v_mature constant timestamptz := timestamptz '2026-10-29 00:00:00+00';
  v_t uuid;
  v_r uuid;
  v_t2 uuid;
  v_r2 uuid;
  v_later uuid;
BEGIN
  PERFORM pg_temp.brand(12);
  v_t := pg_temp.temp_debt(12, 1, 1100, timestamptz '2026-10-25 00:00:00+00');
  v_r := pg_temp.stay(12, 1);
  v_t2 := pg_temp.temp_debt(12, 2, 800, timestamptz '2026-10-25 00:00:00+00');
  v_r2 := pg_temp.stay(12, 2);
  PERFORM pg_temp.claimed_once(v_r2);
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id IN (v_r, v_r2);
  v_later := pg_temp.stay(12, 3);       -- a payable carrier exists all along
  PERFORM public.mature_postponement_debts(v_mature);
  PERFORM public.issue_3645_place_maturity_carryovers(v_mature, 'stripe');
  IF pg_temp.returned(v_t, v_r, 'release_closed') <> 1100
     OR (pg_temp.carry(v_t, v_r)).id IS NOT NULL
     OR pg_temp.adj(v_r, 'maturity_recredit') <> 0
     OR pg_temp.adj(pg_temp.uid(7, 12, 1), 'debt_writeoff') <> 1100
     OR (pg_temp.d(v_t)).status <> 'closed' THEN
    RAISE EXCEPTION 'B6 closed before claim: returned % writeoff %',
      pg_temp.returned(v_t, v_r, 'release_closed'), pg_temp.adj(pg_temp.uid(7, 12, 1), 'debt_writeoff');
  END IF;
  IF pg_temp.returned(v_t2, v_r2, 'release_closed') <> 0
     OR (pg_temp.carry(v_t2, v_r2)).id IS NOT NULL
     OR pg_temp.adj(v_r2, 'maturity_recredit') <> 800
     OR pg_temp.adj(v_later, 'maturity_recredit') <> 0 THEN
    RAISE EXCEPTION 'B6 closed after claim: carried or handed back';
  END IF;
  PERFORM pg_temp.assert_i4('B6');
END
$b6$;

-- B11: a Paystack release that paid from a plan made before the debt was
-- withheld already sent part of the withheld value: only the rest is
-- carried; the part already sent stays 2d's recredit (never paid again).
DO $b11$
DECLARE
  v_mature constant timestamptz := timestamptz '2026-10-29 00:00:00+00';
  v_t uuid;
  v_r uuid;
  v_t2 uuid;
  v_r2 uuid;
BEGIN
  PERFORM pg_temp.brand(15);
  v_t := pg_temp.temp_debt(15, 1, 1000, timestamptz '2026-10-25 00:00:00+00');
  v_r := pg_temp.stay(15, 1);
  v_t2 := pg_temp.temp_debt(15, 2, 1000, timestamptz '2026-10-25 00:00:00+00');
  v_r2 := pg_temp.stay(15, 2);
  IF (pg_temp.rel(v_r)).net_release_cents <> 9000 OR (pg_temp.rel(v_r2)).net_release_cents <> 9000 THEN
    RAISE EXCEPTION 'B11 fixture: nets % %', (pg_temp.rel(v_r)).net_release_cents, (pg_temp.rel(v_r2)).net_release_cents;
  END IF;
  -- r sent 10000 (the whole pool before withholding): all 1000 already went
  -- out. r2 sent 9500: 500 of it went out, 500 did not.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
    stamp_duty_cents, fee_schedule_version, status
  ) VALUES (v_r, 'organiser', 0, 9940, 10, 50, 'test', 'succeeded'),
           (v_r2, 'organiser', 0, 9440, 10, 50, 'test', 'succeeded');
  SET LOCAL session_replication_role = origin;
  UPDATE public.brand_payout_releases
  SET provider = 'paystack', status = 'released', released_at = v_mature
  WHERE id IN (v_r, v_r2);

  PERFORM public.mature_postponement_debts(v_mature);
  IF (pg_temp.carry(v_t, v_r)).id IS NOT NULL
     OR pg_temp.adj(v_r, 'maturity_recredit') <> 1000 THEN
    RAISE EXCEPTION 'B11 carried value a transfer already sent: carry %',
      (pg_temp.carry(v_t, v_r)).amount_cents;
  END IF;
  IF (pg_temp.carry(v_t2, v_r2)).amount_cents IS DISTINCT FROM 500
     OR (pg_temp.carry(v_t2, v_r2)).provider <> 'paystack'
     OR pg_temp.adj(v_r2, 'maturity_recredit') <> 500 THEN
    RAISE EXCEPTION 'B11 partial: carry % recredit %',
      (pg_temp.carry(v_t2, v_r2)).amount_cents, pg_temp.adj(v_r2, 'maturity_recredit');
  END IF;

  -- A confirmed transfer whose fee is not known yet (leg and release
  -- fee_unreconciled) has sent its money too: nothing of it is carried.
  DECLARE
    v_t3 uuid := pg_temp.temp_debt(15, 3, 1000, timestamptz '2026-10-25 00:00:00+00');
    v_r3 uuid := pg_temp.stay(15, 3);
  BEGIN
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.payout_transfer_legs(
      release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
      stamp_duty_cents, fee_schedule_version, status
    ) VALUES (v_r3, 'organiser', 0, 9940, 10, 50, 'test', 'fee_unreconciled');
    SET LOCAL session_replication_role = origin;
    UPDATE public.brand_payout_releases
    SET provider = 'paystack', status = 'fee_unreconciled'
    WHERE id = v_r3;
    PERFORM public.mature_postponement_debts(v_mature + interval '1 hour');
    IF (pg_temp.carry(v_t3, v_r3)).id IS NOT NULL
       OR pg_temp.adj(v_r3, 'maturity_recredit') <> 1000 THEN
      RAISE EXCEPTION 'B11 carried value a fee_unreconciled transfer already sent: carry %',
        (pg_temp.carry(v_t3, v_r3)).amount_cents;
    END IF;
  END;
  PERFORM pg_temp.assert_i4('B11');
  PERFORM pg_temp.assert_i5('B11');
END
$b11$;

-- B7: authorize sends a plan up to what the release owes (net + recredits)
-- and refuses a larger one, once alerted, legs kept; the plan goes out again
-- unchanged once the release owes it again.
DO $b7$
DECLARE
  v_r uuid;
  v_claim uuid;
  v_ok boolean;
BEGIN
  PERFORM pg_temp.brand(10);
  v_r := pg_temp.stay(10, 1);
  UPDATE public.brand_payout_releases SET provider = 'paystack' WHERE id = v_r;
  -- Plan = 10000 = net: sent.
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, estimated_fee_cents,
    stamp_duty_cents, fee_schedule_version, status
  ) VALUES (v_r, 'organiser', 0, 9940, 10, 50, 'test', 'planned');
  v_claim := gen_random_uuid();
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', paystack_execution_claim_id = v_claim,
      paystack_execution_claimed_at = now()
  WHERE id = v_r;
  v_ok := public.authorize_paystack_payout_execution(v_r, v_claim);
  IF v_ok IS NOT TRUE OR (pg_temp.rel(v_r)).status <> 'in_flight' THEN
    RAISE EXCEPTION 'B7 a plan equal to the due was refused';
  END IF;

  -- The release now owes 9999: refused, back to pending, alerted.
  UPDATE public.brand_payout_releases SET net_release_cents = 9999 WHERE id = v_r;
  v_ok := public.authorize_paystack_payout_execution(v_r, v_claim);
  IF v_ok IS NOT FALSE
     OR (pg_temp.rel(v_r)).status <> 'pending'
     OR (pg_temp.rel(v_r)).error_message IS DISTINCT FROM 'paystack_plan_exceeds_due'
     OR (SELECT count(*) FROM public.payout_release_alert_outbox
         WHERE release_id = v_r AND alert_kind = 'paystack_plan_exceeds_due'
           AND error_message = 'plan 10000 > due 9999') <> 1
     OR (SELECT count(*) FROM public.payout_transfer_legs
         WHERE release_id = v_r AND status = 'planned' AND principal_cents = 9940) <> 1 THEN
    RAISE EXCEPTION 'B7 over-due plan: % status %', v_ok, (pg_temp.rel(v_r)).status;
  END IF;

  -- Refused again: still one alert.
  v_claim := gen_random_uuid();
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', paystack_execution_claim_id = v_claim
  WHERE id = v_r;
  v_ok := public.authorize_paystack_payout_execution(v_r, v_claim);
  IF v_ok IS NOT FALSE
     OR (SELECT count(*) FROM public.payout_release_alert_outbox
         WHERE release_id = v_r AND alert_kind = 'paystack_plan_exceeds_due') <> 1 THEN
    RAISE EXCEPTION 'B7 second refusal';
  END IF;

  -- A recredit counts toward what is owed: 9999 + 1 covers the plan again.
  INSERT INTO public.payout_ledger_adjustments(
    release_id, brand_id, currency, kind, amount_cents, idempotency_key
  ) VALUES (v_r, pg_temp.uid(2, 10, 0), 'usd', 'maturity_recredit', 1, 'issue-3645-b4-b7-recredit');
  v_claim := gen_random_uuid();
  UPDATE public.brand_payout_releases
  SET status = 'in_flight', paystack_execution_claim_id = v_claim
  WHERE id = v_r;
  v_ok := public.authorize_paystack_payout_execution(v_r, v_claim);
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'B7 recredit not counted toward the due';
  END IF;

  -- Failed and reversed legs are not part of the plan; partner legs never are.
  UPDATE public.brand_payout_releases SET net_release_cents = 0 WHERE id = v_r;
  SET LOCAL session_replication_role = replica;
  UPDATE public.payout_transfer_legs SET status = 'failed' WHERE release_id = v_r;
  INSERT INTO public.payout_transfer_legs(
    release_id, kind, chunk_index, principal_cents, fee_schedule_version, status
  ) VALUES (v_r, 'partner', 0, 500, 'test', 'planned');
  SET LOCAL session_replication_role = origin;
  v_ok := public.authorize_paystack_payout_execution(v_r, v_claim);
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'B7 failed or partner legs counted as plan';
  END IF;
END
$b7$;

-- B8 (2d follow-up 5, not a bug): a conversion row and a direct application
-- of the same permanent debt on the same release coexist; only a second
-- direct application is refused.
DO $b8$
DECLARE
  v_debt uuid;
  v_r uuid;
BEGIN
  PERFORM pg_temp.brand(11);
  v_debt := pg_temp.debt(11, 1, 500, timestamptz '2026-10-01 00:00:00+00');
  v_r := pg_temp.stay(11, 1);
  IF (pg_temp.app(v_debt, v_r)).idempotency_key NOT LIKE 'debt-apply:%' THEN
    RAISE EXCEPTION 'B8 fixture: no direct application';
  END IF;
  INSERT INTO public.payout_debt_applications(
    debt_id, release_id, amount_cents, idempotency_key
  ) VALUES (v_debt, v_r, 100, 'converted-apply:issue-3645-b4-b8');
  BEGIN
    INSERT INTO public.payout_debt_applications(
      debt_id, release_id, amount_cents, idempotency_key
    ) VALUES (v_debt, v_r, 100, 'debt-apply:issue-3645-b4-b8-again');
    RAISE EXCEPTION 'B8 a second direct application was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  IF (SELECT count(*) FROM public.payout_debt_applications
      WHERE debt_id = v_debt AND release_id = v_r) <> 2 THEN
    RAISE EXCEPTION 'B8 conversion and direct application do not coexist';
  END IF;
END
$b8$;

-- B9: the carryover table is append-only (one placement, one re-home),
-- bounded and private.
DO $b9$
DECLARE
  v_c public.payout_maturity_carryovers;
  v_other uuid;
BEGIN
  SELECT c.* INTO v_c FROM public.payout_maturity_carryovers c
  JOIN public.brands b ON b.id = c.brand_id
  WHERE b.slug = 'issue-3645-b4-1';
  v_other := (SELECT id FROM public.brand_payout_releases
              WHERE brand_id = v_c.brand_id AND id <> v_c.carried_release_id LIMIT 1);
  BEGIN
    UPDATE public.payout_maturity_carryovers SET amount_cents = 1 WHERE id = v_c.id;
    RAISE EXCEPTION 'B9 amount changed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE public.payout_maturity_carryovers SET carried_release_id = v_other WHERE id = v_c.id;
    RAISE EXCEPTION 'B9 placed twice';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM public.payout_maturity_carryovers WHERE id = v_c.id;
    RAISE EXCEPTION 'B9 deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    INSERT INTO public.payout_maturity_carryovers(
      brand_id, provider, currency, amount_cents, debt_id, application_id, source_release_id
    ) VALUES (
      v_c.brand_id, 'stripe', 'usd', 0, v_c.debt_id, v_c.application_id, v_c.source_release_id
    );
    RAISE EXCEPTION 'B9 zero amount accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Only the SECURITY DEFINER functions write it; service_role only reads.
  IF has_table_privilege('service_role', 'public.payout_maturity_carryovers', 'INSERT')
     OR has_table_privilege('service_role', 'public.payout_maturity_carryovers', 'UPDATE')
     OR has_table_privilege('service_role', 'public.payout_maturity_carryovers', 'DELETE')
     OR has_table_privilege('service_role', 'public.payout_maturity_carryovers', 'TRUNCATE')
     OR NOT has_table_privilege('service_role', 'public.payout_maturity_carryovers', 'SELECT') THEN
    RAISE EXCEPTION 'B9 service_role can write the carryover table';
  END IF;
  BEGIN
    UPDATE public.payout_maturity_carryovers SET rehomed_at = now()
    WHERE id = (SELECT id FROM public.payout_maturity_carryovers WHERE carried_at IS NULL LIMIT 1);
    IF FOUND THEN
      RAISE EXCEPTION 'B9 re-homed before it was placed';
    END IF;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF has_table_privilege('anon', 'public.payout_maturity_carryovers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payout_maturity_carryovers', 'SELECT')
     OR has_function_privilege('authenticated', 'public.issue_3645_place_maturity_carryovers(timestamptz, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3645_return_closed_release_debt(timestamptz)', 'EXECUTE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payout_maturity_carryovers'::regclass) THEN
    RAISE EXCEPTION 'B9 the carryover table or its functions are not private';
  END IF;
END
$b9$;

-- B10: never_claimed starts TRUE on a new release, turns FALSE on the first
-- move to in_flight (insert or update), and never turns back.
DO $b10$
DECLARE
  v_r uuid;
BEGIN
  PERFORM pg_temp.brand(14);
  v_r := pg_temp.stay(14, 1);
  IF (pg_temp.rel(v_r)).never_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'B10 a new release does not start never-claimed';
  END IF;
  UPDATE public.brand_payout_releases SET status = 'blocked_kyc' WHERE id = v_r;
  IF (pg_temp.rel(v_r)).never_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'B10 a non-claim status change cleared it';
  END IF;
  PERFORM pg_temp.claimed_once(v_r);
  UPDATE public.brand_payout_releases SET never_claimed = true WHERE id = v_r;
  IF (pg_temp.rel(v_r)).never_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'B10 a claimed release became never-claimed again';
  END IF;
  INSERT INTO public.brand_payout_releases(
    brand_id, occurrence_key, surface, provider, currency, anchor_end_at,
    releasable_at, gross_cents, net_release_cents, status
  ) VALUES (
    pg_temp.uid(2, 14, 0), 'issue-3645-b4-b10', 'order', 'stripe', 'usd',
    timestamptz '2026-11-01 00:00:00+00', timestamptz '2026-11-02 00:00:00+00',
    100, 100, 'in_flight'
  ) RETURNING id INTO v_r;
  IF (pg_temp.rel(v_r)).never_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'B10 a release inserted in flight is never-claimed';
  END IF;
  -- Rows from before the migration have an unknown history: NULL, treated as
  -- claimed by every rule.
  UPDATE public.brand_payout_releases SET status = 'cancelled_event' WHERE id = v_r;
  IF public.issue_3645_release_closed_unpaid(v_r) THEN
    RAISE EXCEPTION 'B10 a claimed closed release counts as never paid';
  END IF;
END
$b10$;

SELECT 'issue_3645_payout_ledger_followups: all tests passed' AS result;

ROLLBACK;
