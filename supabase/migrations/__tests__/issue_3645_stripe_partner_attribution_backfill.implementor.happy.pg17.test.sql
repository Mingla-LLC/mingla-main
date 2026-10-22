-- Issue #3645 (2026-10-21) — the Stripe payout partner outcome backfill.
--
-- No Stripe order ever received a payout_partner_attributions row (the
-- charge.succeeded event carries application_fee: null and lands before the
-- order exists), so plan_pending_payout_partner_legs skipped every Stripe
-- release holding a positive-fee item and the sweep stopped with 409
-- partner_attribution_pending.
--
-- 20271212003645_issue_3645_stripe_partner_attribution_backfill.sql records
-- the outcome from stored provider evidence through the same writer the
-- webhook uses. Fails on revert of that migration: the backfill function does
-- not exist.
--
-- Cases:
--   A/B. Two post-cutover Stripe orders in one pending release, each with a
--        stored fee (mingla_revenue_log) and a stored charge.succeeded →
--        no_partner rows carrying the real fee ids, charge.created as the
--        sale time, the fee amount and currency; the release is no longer
--        blocked; a re-run writes nothing.
--   C.   A pre-cutover Stripe order with full evidence is left untouched.
--   D.   A post-cutover Stripe order with no stored fee is skipped, not
--        invented, and its release stays blocked.

BEGIN;

CREATE FUNCTION pg_temp.i3645b_brand(
  p_tag text, p_owner uuid, p_brand uuid, p_event uuid, p_cutover timestamptz
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO auth.users(id) VALUES (p_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (p_owner, 'owner-3645b-' || p_tag || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    p_brand, p_owner, 'Issue 3645b ' || p_tag, 'issue-3645b-' || p_tag,
    'stripe', 'US', 'USD', 'USD', p_cutover
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, visibility)
  VALUES (p_event, p_brand, 'Issue 3645b ' || p_tag, 'issue-3645b-ev-' || p_tag,
          'scheduled', 'USD', 'private');
END $fx$;

-- A paid Stripe order; optional stored fee + stored charge.succeeded.
CREATE FUNCTION pg_temp.i3645b_order(
  p_order uuid, p_event uuid, p_charge text, p_fee_id text, p_fee integer,
  p_charge_created bigint, p_with_fee boolean
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, buyer_phone_e164, stripe_application_fee_amount_cents, created_at
  ) VALUES (
    p_order, p_event, 1000, 'USD', 'paid', 'pi_' || p_charge, p_charge,
    '+15555553645', p_fee, to_timestamp(p_charge_created + 1)
  );
  INSERT INTO public.payment_webhook_events(
    stripe_event_id, type, payload, provider, provider_event_type,
    provider_event_id, match_status, processed
  ) VALUES (
    'evt_' || p_charge, 'charge.succeeded',
    jsonb_build_object(
      'id', 'evt_' || p_charge,
      'type', 'charge.succeeded',
      'account', 'acct_3645b',
      'data', jsonb_build_object('object', jsonb_build_object(
        'id', p_charge,
        'object', 'charge',
        'application_fee', NULL,
        'application_fee_amount', p_fee,
        'currency', 'usd',
        'created', p_charge_created,
        'payment_intent', 'pi_' || p_charge
      ))
    ),
    'stripe', 'charge.succeeded', 'evt_' || p_charge, 'not_applicable', true
  );
  IF p_with_fee THEN
    INSERT INTO public.mingla_revenue_log(
      stripe_application_fee_id, stripe_account_id, amount_cents, currency, raw_payload
    ) VALUES (
      p_fee_id, 'acct_3645b', p_fee, 'USD',
      jsonb_build_object('id', p_fee_id, 'object', 'application_fee',
        'amount', p_fee, 'currency', 'usd', 'charge', p_charge,
        'account', 'acct_3645b', 'created', p_charge_created + 4)
    );
  END IF;
END $fx$;

CREATE FUNCTION pg_temp.i3645b_release(
  p_release uuid, p_brand uuid, p_event uuid, p_key text, p_orders uuid[], p_fee integer
) RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE
  v_n integer := coalesce(array_length(p_orders, 1), 0);
  v_order uuid;
BEGIN
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    p_release, p_brand, p_event, p_key, 'order', 'stripe', 'usd',
    timestamptz '2026-10-17 00:00:00+00', timestamptz '2026-10-18 00:00:00+00',
    1000 * v_n, p_fee * v_n, 0, 0, (1000 - p_fee) * v_n, 'pending'
  );
  FOREACH v_order IN ARRAY p_orders LOOP
    INSERT INTO public.payout_release_items(
      release_id, source_type, source_id, gross_cents, mingla_fee_cents,
      partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
    ) VALUES (
      p_release, 'order', v_order, 1000, p_fee, 0, 0, 1000 - p_fee,
      timestamptz '2026-10-16 00:00:00+00'
    );
  END LOOP;
END $fx$;

DO $cases$
DECLARE
  v_owner_1 constant uuid := '36450000-0000-4000-8000-0000000b0001';
  v_brand_1 constant uuid := '36450000-0000-4000-8000-0000000b0002';
  v_event_1 constant uuid := '36450000-0000-4000-8000-0000000b0003';
  v_owner_2 constant uuid := '36450000-0000-4000-8000-0000000b0011';
  v_brand_2 constant uuid := '36450000-0000-4000-8000-0000000b0012';
  v_event_2 constant uuid := '36450000-0000-4000-8000-0000000b0013';
  v_order_a constant uuid := '36450000-0000-4000-8000-0000000b00a1';
  v_order_b constant uuid := '36450000-0000-4000-8000-0000000b00b1';
  v_order_c constant uuid := '36450000-0000-4000-8000-0000000b00c1';
  v_order_d constant uuid := '36450000-0000-4000-8000-0000000b00d1';
  v_rel_ab  constant uuid := '36450000-0000-4000-8000-0000000b0ab0';
  v_rel_c   constant uuid := '36450000-0000-4000-8000-0000000b0c00';
  v_rel_d   constant uuid := '36450000-0000-4000-8000-0000000b0d00';
  -- Charge times: 2026-09-21 15:14:34Z and 2026-10-16 17:23:51Z.
  v_ts_a    constant bigint := 1790003674;
  v_ts_b    constant bigint := 1792171431;
  v_blocked_before integer;
  v_blocked_after integer;
  v_first jsonb;
  v_second jsonb;
  v_row public.payout_partner_attributions%ROWTYPE;
  v_count integer;
BEGIN
  -- Brand 1: cutover before A and B. Brand 2: cutover after C's charge.
  PERFORM pg_temp.i3645b_brand('one', v_owner_1, v_brand_1, v_event_1,
    timestamptz '2026-09-12 13:37:50+00');
  PERFORM pg_temp.i3645b_brand('two', v_owner_2, v_brand_2, v_event_2,
    timestamptz '2026-12-01 00:00:00+00');

  PERFORM pg_temp.i3645b_order(v_order_a, v_event_1, 'ch_3645b_a', 'fee_3645b_a', 5, v_ts_a, true);
  PERFORM pg_temp.i3645b_order(v_order_b, v_event_1, 'ch_3645b_b', 'fee_3645b_b', 45, v_ts_b, true);
  PERFORM pg_temp.i3645b_order(v_order_c, v_event_2, 'ch_3645b_c', 'fee_3645b_c', 45, v_ts_b, true);
  PERFORM pg_temp.i3645b_order(v_order_d, v_event_1, 'ch_3645b_d', 'fee_3645b_d', 45, v_ts_b + 60, false);

  -- A and B share one release (fees 5 and 45 stored per item below).
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    v_rel_ab, v_brand_1, v_event_1, 'issue-3645b-ab', 'order', 'stripe', 'usd',
    timestamptz '2026-10-17 00:00:00+00', timestamptz '2026-10-18 00:00:00+00',
    2000, 50, 0, 0, 1950, 'pending'
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES
    (v_rel_ab, 'order', v_order_a, 1000, 5, 0, 0, 995, timestamptz '2026-10-16 00:00:00+00'),
    (v_rel_ab, 'order', v_order_b, 1000, 45, 0, 0, 955, timestamptz '2026-10-16 00:00:00+00');
  PERFORM pg_temp.i3645b_release(v_rel_c, v_brand_2, v_event_2, 'issue-3645b-c', ARRAY[v_order_c], 45);
  PERFORM pg_temp.i3645b_release(v_rel_d, v_brand_1, v_event_1, 'issue-3645b-d', ARRAY[v_order_d], 45);

  v_blocked_before := (public.plan_pending_payout_partner_legs(500)
    ->> 'blocked_partner_attributions')::integer;

  v_first := public.backfill_stripe_payout_partner_attributions();

  -- A
  SELECT * INTO v_row FROM public.payout_partner_attributions WHERE order_id = v_order_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_a: no attribution row written'; END IF;
  IF v_row.provider_key <> 'fee_3645b_a' OR v_row.outcome <> 'no_partner'
     OR v_row.provider <> 'stripe' OR v_row.brand_id <> v_brand_1
     OR v_row.mingla_fee_cents <> 5 OR v_row.partner_share_cents <> 0
     OR v_row.currency <> 'usd' OR v_row.partner_account_id IS NOT NULL
     OR v_row.provider_sale_at <> to_timestamp(v_ts_a) THEN
    RAISE EXCEPTION 'case_a: wrong attribution %', row_to_json(v_row);
  END IF;
  -- B
  SELECT * INTO v_row FROM public.payout_partner_attributions WHERE order_id = v_order_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_b: no attribution row written'; END IF;
  IF v_row.provider_key <> 'fee_3645b_b' OR v_row.outcome <> 'no_partner'
     OR v_row.mingla_fee_cents <> 45 OR v_row.currency <> 'usd'
     OR v_row.provider_sale_at <> timestamptz '2026-10-16 17:23:51+00' THEN
    RAISE EXCEPTION 'case_b: wrong attribution %', row_to_json(v_row);
  END IF;
  -- C: pre-cutover, untouched.
  IF EXISTS (SELECT 1 FROM public.payout_partner_attributions WHERE order_id = v_order_c) THEN
    RAISE EXCEPTION 'case_c: a pre-cutover order must be left untouched';
  END IF;
  -- D: no stored fee, skipped.
  IF EXISTS (SELECT 1 FROM public.payout_partner_attributions WHERE order_id = v_order_d) THEN
    RAISE EXCEPTION 'case_d: an order without provider evidence must not be invented';
  END IF;
  IF (v_first->>'pre_cutover')::integer < 1 OR (v_first->>'no_evidence')::integer < 1 THEN
    RAISE EXCEPTION 'case_c_d: skips must be counted, got %', v_first;
  END IF;
  IF (v_first->>'written')::integer < 2 THEN
    RAISE EXCEPTION 'case_ab: expected two writes, got %', v_first;
  END IF;

  -- Re-run is a no-op.
  v_second := public.backfill_stripe_payout_partner_attributions();
  IF (v_second->>'written')::integer <> 0 THEN
    RAISE EXCEPTION 'rerun: must write nothing, got %', v_second;
  END IF;
  SELECT count(*) INTO v_count FROM public.payout_partner_attributions
   WHERE order_id IN (v_order_a, v_order_b, v_order_c, v_order_d);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'rerun: expected exactly 2 rows, got %', v_count;
  END IF;

  -- The planner no longer skips the A/B release (its two items were the
  -- blocked ones); C and D stay blocked.
  v_blocked_after := (public.plan_pending_payout_partner_legs(500)
    ->> 'blocked_partner_attributions')::integer;
  IF v_blocked_before - v_blocked_after <> 2 THEN
    RAISE EXCEPTION 'planner: expected 2 fewer blocked items, before % after %',
      v_blocked_before, v_blocked_after;
  END IF;
  IF v_blocked_after < 2 THEN
    RAISE EXCEPTION 'planner: C and D must stay blocked, after %', v_blocked_after;
  END IF;

  RAISE NOTICE 'issue_3645 stripe attribution backfill pass';
END $cases$;

ROLLBACK;
