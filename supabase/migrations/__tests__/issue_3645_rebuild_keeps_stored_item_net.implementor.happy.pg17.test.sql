-- Issue #3645 (Seth, 2026-10-21) — the partner-leg planner rebuilds a pending
-- payout's net from the STORED item nets.
--
-- Payouts attached before the flat-4.5% change keep their old maths (the stored
-- net still carries the provider fee); items attached under the new rule store
-- gross − mingla_fee. The planner runs on every pending payout each sweep, so
-- re-deriving the net from gross and fee silently re-netted older payouts.
--
-- Fails on revert of 20271208003645_issue_3645_rebuild_keeps_stored_item_net.sql:
-- the 20271206003645 rebuild turns case L's 890000 into 900000 and case M's
-- 1845000 into 1855000.
--
-- Cases:
--   L. A pre-change pending Paystack payout (gross 1,000,000, fee 100,000,
--      provider fee 10,000, stored net 890,000) keeps 890,000 through the planner.
--   M. One pending payout holding a pre-change item and a new-rule item keeps
--      the sum of the stored nets (890,000 + 955,000).
--   N. A new-rule Stripe order attached by the dark sweep nets gross − Mingla fee,
--      and the planner leaves it there.

BEGIN;

CREATE FUNCTION pg_temp.issue_3645_brand(
  p_tag text, p_owner uuid, p_brand uuid, p_event uuid, p_provider text, p_currency text
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO auth.users(id) VALUES (p_owner);
  INSERT INTO public.creator_accounts(id, email)
  VALUES (p_owner, 'owner-3645-' || p_tag || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at
  ) VALUES (
    p_brand, p_owner, 'Issue 3645 ' || p_tag, 'issue-3645-' || p_tag,
    upper(p_currency), p_provider, timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.events(id, brand_id, title, slug, currency, status, visibility)
  VALUES (p_event, p_brand, 'Issue 3645 ' || p_tag, 'issue-3645-ev-' || p_tag,
          upper(p_currency), 'scheduled', 'private');
END $fx$;

-- One paid order + its no-partner provider outcome (so the planner does not
-- skip the payout as "attribution missing").
CREATE FUNCTION pg_temp.issue_3645_order(
  p_order uuid, p_event uuid, p_brand uuid, p_provider text, p_currency text,
  p_gross integer, p_fee integer, p_key text
) RETURNS void LANGUAGE plpgsql AS $fx$
BEGIN
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status,
    stripe_application_fee_amount_cents, buyer_phone_e164, created_at
  ) VALUES (
    p_order, p_event, p_gross, upper(p_currency), 'paid', p_fee, '+15555553645',
    timestamptz '2026-10-10 00:00:00+00'
  );
  INSERT INTO public.payout_partner_attributions(
    order_id, brand_id, provider, provider_key, provider_sale_at, partner_account_id,
    outcome, mingla_fee_cents, partner_share_cents, currency
  ) VALUES (
    p_order, p_brand, p_provider, p_key, timestamptz '2026-10-10 00:00:00+00', NULL,
    'no_partner', p_fee, 0, lower(p_currency)
  );
END $fx$;

-- L. A pre-change pending payout keeps its stored old maths.
DO $case_l$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-00000000c001';
  v_brand   constant uuid := '36450000-0000-4000-8000-00000000c002';
  v_event   constant uuid := '36450000-0000-4000-8000-00000000c003';
  v_order   constant uuid := '36450000-0000-4000-8000-00000000c004';
  v_release constant uuid := '36450000-0000-4000-8000-00000000c005';
  v_net     integer;
  v_item    integer;
BEGIN
  PERFORM pg_temp.issue_3645_brand('l', v_owner, v_brand, v_event, 'paystack', 'ngn');
  PERFORM pg_temp.issue_3645_order(v_order, v_event, v_brand, 'paystack', 'ngn',
    1000000, 100000, 'paystack:issue-3645-legacy');
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    v_release, v_brand, v_event, 'issue-3645-legacy', 'order', 'paystack', 'ngn',
    timestamptz '2026-10-11 00:00:00+00', timestamptz '2026-10-12 00:00:00+00',
    1000000, 100000, 0, 10000, 890000, 'pending'
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    v_release, 'order', v_order, 1000000, 100000, 0, 10000, 890000,
    timestamptz '2026-10-10 00:00:00+00'
  );

  PERFORM public.plan_pending_payout_partner_legs(500);
  PERFORM public.plan_pending_payout_partner_legs(500);

  SELECT net_release_cents INTO v_net FROM public.brand_payout_releases WHERE id = v_release;
  SELECT net_cents INTO v_item FROM public.payout_release_items
   WHERE source_type = 'order' AND source_id = v_order;
  IF v_item <> 890000 THEN
    RAISE EXCEPTION 'case_l: the stored item net was rewritten: expected 890000, got %', v_item;
  END IF;
  IF v_net <> 890000 THEN
    RAISE EXCEPTION 'case_l: a pre-change payout must keep its stored net 890000 through the planner, got %', v_net;
  END IF;
  RAISE NOTICE 'issue_3645 case_l pass';
END $case_l$;

-- M. A payout holding a pre-change item and a new-rule item sums the stored nets.
DO $case_m$
DECLARE
  v_owner   constant uuid := '36450000-0000-4000-8000-00000000d001';
  v_brand   constant uuid := '36450000-0000-4000-8000-00000000d002';
  v_event   constant uuid := '36450000-0000-4000-8000-00000000d003';
  v_old     constant uuid := '36450000-0000-4000-8000-00000000d004';
  v_new     constant uuid := '36450000-0000-4000-8000-00000000d005';
  v_release constant uuid := '36450000-0000-4000-8000-00000000d006';
  v_net     integer;
BEGIN
  PERFORM pg_temp.issue_3645_brand('m', v_owner, v_brand, v_event, 'paystack', 'ngn');
  PERFORM pg_temp.issue_3645_order(v_old, v_event, v_brand, 'paystack', 'ngn',
    1000000, 100000, 'paystack:issue-3645-mixed-old');
  -- New rule: flat 4.5% Mingla fee (45,000) and the provider fee is not deducted.
  PERFORM pg_temp.issue_3645_order(v_new, v_event, v_brand, 'paystack', 'ngn',
    1000000, 45000, 'paystack:issue-3645-mixed-new');
  INSERT INTO public.brand_payout_releases(
    id, brand_id, event_id, occurrence_key, surface, provider, currency,
    anchor_end_at, releasable_at, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents, status
  ) VALUES (
    v_release, v_brand, v_event, 'issue-3645-mixed', 'order', 'paystack', 'ngn',
    timestamptz '2026-10-11 00:00:00+00', timestamptz '2026-10-12 00:00:00+00',
    2000000, 145000, 0, 20000, 1845000, 'pending'
  );
  INSERT INTO public.payout_release_items(
    release_id, source_type, source_id, gross_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_cents, source_finalized_at
  ) VALUES
    (v_release, 'order', v_old, 1000000, 100000, 0, 10000, 890000,
     timestamptz '2026-10-10 00:00:00+00'),
    (v_release, 'order', v_new, 1000000, 45000, 0, 10000, 955000,
     timestamptz '2026-10-10 00:00:00+00');

  PERFORM public.plan_pending_payout_partner_legs(500);

  SELECT net_release_cents INTO v_net FROM public.brand_payout_releases WHERE id = v_release;
  IF v_net <> 890000 + 955000 THEN
    RAISE EXCEPTION 'case_m: a mixed payout must keep the sum of stored nets (1845000), got %', v_net;
  END IF;
  RAISE NOTICE 'issue_3645 case_m pass';
END $case_m$;

-- N. A new-rule order attached by the dark sweep nets gross − Mingla fee.
DO $case_n$
DECLARE
  v_owner constant uuid := '36450000-0000-4000-8000-00000000e001';
  v_brand constant uuid := '36450000-0000-4000-8000-00000000e002';
  v_event constant uuid := '36450000-0000-4000-8000-00000000e003';
  v_date  constant uuid := '36450000-0000-4000-8000-00000000e004';
  v_order constant uuid := '36450000-0000-4000-8000-00000000e005';
  v_now   constant timestamptz := timestamptz '2026-10-01 12:00:00+00';
  v_item  record;
  v_net   integer;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-n@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 3645 n', 'issue-3645-n', 'stripe', 'US', 'USD', 'USD',
    timestamptz '2020-01-01 00:00:00+00'
  );
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 3645 n', 'issue-3645-ev-n', 'live', 'USD');
  INSERT INTO public.event_dates(id, event_id, start_at, end_at, timezone, is_master)
  VALUES (v_date, v_event, v_now - interval '5 days', v_now - interval '4 days', 'UTC', true);
  -- Flat 4.5% on a 10,000 sale: application fee 450; Stripe fee 320 is Mingla's cost.
  INSERT INTO public.orders(
    id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, buyer_phone_e164, event_date_id,
    stripe_application_fee_amount_cents, created_at
  ) VALUES (
    v_order, v_event, 10000, 'USD', 'paid', 'pi_3645_n', 'ch_3645_n', 'online_checkout',
    '+12125550100', v_date, 450, v_now - interval '6 days'
  );
  INSERT INTO public.payout_source_fee_snapshots(source_type, source_id, provider_fee_cents)
  VALUES ('order', v_order, 320);
  INSERT INTO public.payout_partner_attributions(
    order_id, brand_id, provider, provider_key, provider_sale_at, partner_account_id,
    outcome, mingla_fee_cents, partner_share_cents, currency
  ) VALUES (
    v_order, v_brand, 'stripe', 'fee_3645_n', v_now - interval '6 days', NULL,
    'no_partner', 450, 0, 'usd'
  );

  PERFORM public.run_payout_release_dark_sweep(v_now);
  SELECT * INTO v_item FROM public.payout_release_items
   WHERE source_type = 'order' AND source_id = v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_n: order did not attach'; END IF;
  IF v_item.net_cents <> 10000 - 450 THEN
    RAISE EXCEPTION 'case_n: new-rule item net must be gross - Mingla fee (9550), got %', v_item.net_cents;
  END IF;

  PERFORM public.plan_pending_payout_partner_legs(500);
  SELECT net_release_cents INTO v_net FROM public.brand_payout_releases WHERE id = v_item.release_id;
  IF v_net <> 10000 - 450 THEN
    RAISE EXCEPTION 'case_n: the planner must leave the new-rule net at 9550, got %', v_net;
  END IF;
  RAISE NOTICE 'issue_3645 case_n pass';
END $case_n$;

ROLLBACK;
