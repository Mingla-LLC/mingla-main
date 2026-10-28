-- Issue #3645 — cancelling an event refunds every collected instalment (PG17).
-- MINGLA-INVARIANT: I-3645-BOTH-1 | issue #3645 | event cancellation refunds the deposit AND every collected instalment, on both rails
--
-- Proves, through cancel_event_refund_prepare and the RPCs the fan-out calls:
--   1. prepare enumerates each collected instalment as its own refund object
--      (provider from the row, amount = charged − already refunded) next to the
--      deposit order, cancels the scheduled ones, and counts them in the run.
--   2. A re-run creates nothing new.
--   3. issue_3645_cancel_refund_installment issues one refund for the
--      instalment's remaining charged amount; the same key replays.
--   4. Committing an instalment refund through admin_refund_order_commit never
--      touches the deposit's orders.refunded_amount_cents (no CHECK violation
--      against the deposit total), and issue_3645_mark_installment_refunded
--      moves the per-instalment counter once (status refunded when full).
--   5. The deposit's own cancellation refund is still the full deposit after the
--      instalment refunds exist (instalment refunds are not deposit refunds).

BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_us uuid := gen_random_uuid();
  v_ng uuid := gen_random_uuid();
  v_eus uuid := gen_random_uuid();
  v_eng uuid := gen_random_uuid();
  v_tt uuid := gen_random_uuid();
  v_ngtt uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid();
  v_d2 uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  r jsonb;
  r2 jsonb;
  v_count integer;
  v_amount bigint;
  v_lines jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3645-ecancel@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region, pricing_currency, default_currency)
  VALUES (v_us, v_owner, 'EC us', 'issue-3645-ec-us', 'stripe', 'US', 'USD', 'USD'),
         (v_ng, v_owner, 'EC ng', 'issue-3645-ec-ng', 'paystack', 'NG', 'NGN', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, currency) VALUES
    (v_eus, v_us, 'EC trip us', 'issue-3645-ec-us-trip', 'trip', 'live', 'USD'),
    (v_eng, v_ng, 'EC trip ng', 'issue-3645-ec-ng-trip', 'trip', 'live', 'NGN');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents) VALUES
    (v_tt, v_eus, 'Package', 10000), (v_ngtt, v_eng, 'Package', 1000000);
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, stripe_application_fee_amount_cents, installment_plan_root,
    list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source)
  VALUES
    (v_d, v_eus, 2500, 'USD', 'paid', 'pi_3645_ec_dep', 'ch_3645_ec_dep', 'legacy', 113, true,
      2500, 2500, 0, 0, 2500, 'provider_reconciled'),
    (v_p, v_eng, 250000, 'NGN', 'paid', 'mingla_3645_ec_dep', '3645001', 'legacy', 11250, true,
      250000, 250000, 18750, 1875, 270625, 'provider_reconciled');
  INSERT INTO public.order_line_items(order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES (v_d, v_tt, 1, 10000, 10000), (v_p, v_ngtt, 1, 1000000, 1000000);
  INSERT INTO public.order_installments(id, order_id, ordinal, amount_cents, currency, due_at, status,
    stripe_payment_intent_id, stripe_charge_id, collected_at, provider, collection_method,
    buyer_total_cents, plan_bound_at, application_fee_amount_cents, provider_transaction_id)
  VALUES
    (v_d1, v_d, 1, 5000, 'USD', now() - interval '2 days', 'collected', 'pi_3645_ec_i1', 'ch_3645_ec_i1',
      now() - interval '2 days', 'stripe', 'auto_card', NULL, now(), 225, NULL),
    (v_d2, v_d, 2, 2500, 'USD', now() + interval '20 days', 'scheduled', NULL, NULL, NULL,
      'stripe', 'auto_card', NULL, now(), NULL, NULL),
    (v_p1, v_p, 1, 500000, 'NGN', now() - interval '2 days', 'collected', 'mingla-inst-' || v_p1 || '-a1', NULL,
      now() - interval '2 days', 'paystack', 'auto_card', 541250, now(), 22500, '3645101'),
    (v_p2, v_p, 2, 250000, 'NGN', now() + interval '20 days', 'scheduled', NULL, NULL, NULL,
      'paystack', 'pay_link', 270625, now(), NULL, NULL);
  -- The scheduled Paystack payment has a live link that must stop working.
  PERFORM public.issue_3645_issue_pay_link(v_p2, 'pay', decode(repeat('ec', 32), 'hex'));

  UPDATE public.events SET status = 'cancelled' WHERE id IN (v_eus, v_eng);

  -- 1. prepare (both rails).
  r := public.cancel_event_refund_prepare(v_eus, now());
  r2 := public.cancel_event_refund_prepare(v_eng, now());
  IF (r->>'total_objects')::int <> 2 OR (r2->>'total_objects')::int <> 2 THEN
    RAISE EXCEPTION 'ec_1_total_objects_% %', r, r2;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_cancel_refund_progress
   WHERE (source_type, source_id, provider, amount_cents) IN (
     ('order', v_d, 'stripe', 2500), ('order_installment', v_d1, 'stripe', 5000),
     ('order', v_p, 'paystack', 270625), ('order_installment', v_p1, 'paystack', 541250));
  IF v_count <> 4 THEN RAISE EXCEPTION 'ec_1_progress_rows_%', v_count; END IF;
  IF (SELECT count(*) FROM public.order_installments WHERE id IN (v_d2, v_p2) AND status = 'cancelled') <> 2 THEN
    RAISE EXCEPTION 'ec_1_scheduled_not_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_installment_pay_links WHERE installment_id = v_p2 AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'ec_1_link_not_revoked';
  END IF;

  -- 2. Re-run: nothing new.
  PERFORM public.cancel_event_refund_prepare(v_eus, now());
  IF (SELECT count(*) FROM public.event_cancel_refund_progress WHERE event_id IN (v_eus, v_eng)) <> 4 THEN
    RAISE EXCEPTION 'ec_2_rerun_duplicated';
  END IF;

  -- 3. Stripe instalment refund.
  r := public.issue_3645_cancel_refund_installment(v_d1, 'Event cancelled by the organiser',
    'cancel_refund:' || v_eus || ':inst:' || v_d1);
  IF (r->>'amount_cents')::bigint <> 5000 OR r->>'source_reference' <> 'pi_3645_ec_i1'
     OR r->>'stripe_charge_id' <> 'ch_3645_ec_i1' OR (r->>'is_full_refund')::boolean IS NOT TRUE
     OR r->>'provider' <> 'stripe' THEN
    RAISE EXCEPTION 'ec_3_refund_%', r;
  END IF;
  r2 := public.issue_3645_cancel_refund_installment(v_d1, 'Event cancelled by the organiser',
    'cancel_refund:' || v_eus || ':inst:' || v_d1);
  IF (r2->>'idempotent_replay')::boolean IS NOT TRUE OR r2->>'refund_id' <> r->>'refund_id' THEN
    RAISE EXCEPTION 'ec_3_replay_%', r2;
  END IF;

  -- 4. Commit (fee evidence not under test: #2097 owns it) + mark.
  UPDATE public.refunds SET application_fee_refund_status = 'not_applicable', application_fee_refunded_cents = 0
   WHERE id = (r->>'refund_id')::uuid;
  PERFORM public.admin_refund_order_commit((r->>'refund_id')::uuid, 're_3645_ec_i1', 0, 'succeeded', NULL);
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_d) <> 0 THEN
    RAISE EXCEPTION 'ec_4_instalment_refund_counted_on_deposit';
  END IF;
  r2 := public.issue_3645_mark_installment_refunded(v_d1, (r->>'refund_id')::uuid, 5000);
  IF r2->>'status' <> 'refunded' OR (r2->>'refunded_amount_cents')::bigint <> 5000 THEN
    RAISE EXCEPTION 'ec_4_mark_%', r2;
  END IF;
  r2 := public.issue_3645_mark_installment_refunded(v_d1, (r->>'refund_id')::uuid, 5000);
  IF (r2->>'replayed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'ec_4_mark_replay_%', r2; END IF;

  -- 5. The deposit refund is still the whole deposit.
  SELECT jsonb_agg(jsonb_build_object('order_line_item_id', id, 'quantity', quantity)) INTO v_lines
    FROM public.order_line_items WHERE order_id = v_d;
  r2 := public.issue_3872_cancel_refund_order(v_d, v_lines, 'Event cancelled by the organiser',
    'cancel_refund:' || v_eus || ':' || v_d);
  IF (r2->>'amount_cents')::bigint <> 2500 THEN RAISE EXCEPTION 'ec_5_deposit_refund_%', r2; END IF;
  UPDATE public.refunds SET application_fee_refund_status = 'not_applicable', application_fee_refunded_cents = 0
   WHERE id = (r2->>'refund_id')::uuid;
  PERFORM public.admin_refund_order_commit((r2->>'refund_id')::uuid, 're_3645_ec_dep', 0, 'succeeded', NULL);
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_d) <> 2500 THEN
    RAISE EXCEPTION 'ec_5_deposit_refunded_total';
  END IF;

  -- Paystack instalment: all-in charged amount; a second key after a full
  -- refund finds nothing left.
  r := public.issue_3645_cancel_refund_installment(v_p1, 'Event cancelled by the organiser',
    'cancel_refund:' || v_eng || ':inst:' || v_p1);
  IF (r->>'amount_cents')::bigint <> 541250 OR r->>'provider_transaction_id' <> '3645101'
     OR r->>'source_reference' <> 'mingla-inst-' || v_p1 || '-a1' OR r->>'connected_account_id' IS NOT NULL THEN
    RAISE EXCEPTION 'ec_paystack_refund_%', r;
  END IF;
  BEGIN
    PERFORM public.issue_3645_cancel_refund_installment(v_p1, 'Event cancelled by the organiser', 'other-key');
    RAISE EXCEPTION 'ec_paystack_double_refund_allowed';
  EXCEPTION WHEN SQLSTATE 'P0008' THEN
    IF SQLERRM <> 'refund_amount_zero' THEN RAISE; END IF;
  END;
END
$test$;

ROLLBACK;
