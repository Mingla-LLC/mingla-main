-- Issue #3645 — instalment pay / approve links (PG17, BEGIN…ROLLBACK).
--
-- Proves issue → replace → revoke → resolve; the uniform 'invalid' answer for
-- unknown, expired and replaced tokens (no oracle); paid / no_longer_due for a
-- collected or cancelled instalment; expiry; display-safe fields only.

BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_i1 uuid := gen_random_uuid();
  v_i2 uuid := gen_random_uuid();
  v_h1 bytea := decode(repeat('a1', 32), 'hex');
  v_h2 bytea := decode(repeat('a2', 32), 'hex');
  v_h3 bytea := decode(repeat('a3', 32), 'hex');
  r jsonb;
  v_invalid jsonb := jsonb_build_object('state', 'invalid');
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'links-3645@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency, pricing_currency)
  VALUES (v_brand, v_owner, 'Lagos Trips', 'issue-3645-links', 'paystack', 'NGN', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, 'Five Slow Days', 'issue-3645-links-trip', 'trip', 'scheduled', 'public', 'UTC', 'NGN');
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, buyer_email,
    stripe_payment_intent_id, stripe_charge_id, source, installment_plan_root)
  VALUES (v_order, v_event, 250000, 'NGN', 'paid', 'buyer@example.test', 'mingla_links', '6001', 'legacy', true);
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, provider,
    collection_method, buyer_total_cents, planned_application_fee_cents, plan_bound_at)
  VALUES
    (v_i1, v_order, 1, 250000, 'NGN', timestamptz '2027-03-01 12:00:00+00', 'paystack', 'pay_link', 270625, 11250, now()),
    (v_i2, v_order, 2, 250000, 'NGN', timestamptz '2027-04-01 12:00:00+00', 'paystack', 'pay_link', 270625, 11250, now());

  -- Issue: expiry = least(due + 30d, now + 45d).
  r := public.issue_3645_issue_pay_link(v_i1, 'pay', v_h1, timestamptz '2027-02-26 12:00:00+00');
  IF NOT (r->>'ok')::boolean OR (r->>'expires_at')::timestamptz <> timestamptz '2027-03-31 12:00:00+00' THEN
    RAISE EXCEPTION 'links_issue_%', r;
  END IF;
  IF (SELECT buyer_action FROM public.order_installments WHERE id = v_i1) <> 'pay_link_sent' THEN
    RAISE EXCEPTION 'links_buyer_action_not_set';
  END IF;
  -- Resolve: display-safe fields only.
  r := public.issue_3645_resolve_pay_link(v_h1, timestamptz '2027-02-27 12:00:00+00');
  IF r->>'state' <> 'payable' OR r->>'trip_title' <> 'Five Slow Days' OR r->>'brand_name' <> 'Lagos Trips'
     OR (r->>'amount_cents')::bigint <> 270625 OR r->>'currency' <> 'NGN'
     OR (r->>'ordinal')::int <> 2 OR (r->>'total_payments')::int <> 3 OR r->>'purpose' <> 'pay' THEN
    RAISE EXCEPTION 'links_resolve_%', r;
  END IF;
  IF r::text LIKE '%buyer@example%' OR r::text LIKE '%mingla_links%' OR r ? 'reference' THEN
    RAISE EXCEPTION 'links_resolve_leaks_%', r;
  END IF;
  IF (SELECT open_count FROM public.order_installment_pay_links WHERE token_hash = v_h1) <> 1 THEN
    RAISE EXCEPTION 'links_open_count';
  END IF;

  -- Replace: the old token answers exactly like an unknown one.
  PERFORM public.issue_3645_issue_pay_link(v_i1, 'pay', v_h2, timestamptz '2027-03-01 13:00:00+00');
  IF public.issue_3645_resolve_pay_link(v_h1) <> v_invalid THEN RAISE EXCEPTION 'links_replaced_not_invalid'; END IF;
  IF public.issue_3645_resolve_pay_link(decode(repeat('ff', 32), 'hex')) <> v_invalid THEN
    RAISE EXCEPTION 'links_unknown_not_invalid';
  END IF;
  IF public.issue_3645_resolve_pay_link(decode('00', 'hex')) <> v_invalid THEN
    RAISE EXCEPTION 'links_malformed_not_invalid';
  END IF;
  -- Expired → invalid.
  IF public.issue_3645_resolve_pay_link(v_h2, timestamptz '2027-04-15 12:00:00+00') <> v_invalid THEN
    RAISE EXCEPTION 'links_expired_not_invalid';
  END IF;
  -- Only one live link per instalment.
  IF (SELECT count(*) FROM public.order_installment_pay_links WHERE installment_id = v_i1 AND revoked_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'links_one_live';
  END IF;

  -- Collected → the link answers paid (revoked by the trigger, still known).
  UPDATE public.order_installments SET status = 'collected', collected_at = now(),
    stripe_payment_intent_id = 'mingla-inst-' || v_i1 || '-l1' WHERE id = v_i1;
  r := public.issue_3645_resolve_pay_link(v_h2, timestamptz '2027-03-02 12:00:00+00');
  IF r->>'state' <> 'paid' THEN RAISE EXCEPTION 'links_paid_%', r; END IF;
  -- A collected instalment cannot get a new link.
  r := public.issue_3645_issue_pay_link(v_i1, 'pay', v_h3);
  IF r->>'reason' <> 'installment_not_open' THEN RAISE EXCEPTION 'links_collected_issue_%', r; END IF;

  -- Cancelled → no_longer_due.
  PERFORM public.issue_3645_issue_pay_link(v_i2, 'approve', v_h3, timestamptz '2027-03-20 12:00:00+00');
  IF (SELECT buyer_action FROM public.order_installments WHERE id = v_i2) <> 'approval_required' THEN
    RAISE EXCEPTION 'links_approve_action';
  END IF;
  UPDATE public.order_installments SET status = 'cancelled', cancelled_at = now() WHERE id = v_i2;
  r := public.issue_3645_resolve_pay_link(v_h3, timestamptz '2027-03-21 12:00:00+00');
  IF r->>'state' <> 'no_longer_due' THEN RAISE EXCEPTION 'links_cancelled_%', r; END IF;

  -- A very late send still gets a usable window (never born expired).
  UPDATE public.order_installments SET status = 'failed', cancelled_at = NULL, failed_at = now(),
    failure_reason = 'pay_link_unpaid' WHERE id = v_i2;
  r := public.issue_3645_issue_pay_link(v_i2, 'pay', decode(repeat('a4', 32), 'hex'), timestamptz '2027-06-01 12:00:00+00');
  IF (r->>'expires_at')::timestamptz <> timestamptz '2027-06-08 12:00:00+00' THEN
    RAISE EXCEPTION 'links_late_window_%', r;
  END IF;
END
$test$;

ROLLBACK;
