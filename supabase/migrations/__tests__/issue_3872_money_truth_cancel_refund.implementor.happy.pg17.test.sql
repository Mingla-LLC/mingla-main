-- Issue #3872 PR 1 (money truth) — a cancelled event refunds what each buyer was
-- charged, fees included, on every rail (Seth's decision, 19 Oct 2026) (PG17).
--
-- MINGLA-INVARIANT: I-3872-CANCEL-REFUNDS-CHARGED-TOTAL | issue #3872 | When an event is cancelled each order's refund equals what the buyer was charged and has not had back (buyer_total_cents minus earlier refunds), fees and added tax included, on every payment rail.
--
-- Proves, through cancel_event_refund_prepare and the refund RPC the fan-out
-- calls (issue_3872_cancel_refund_order) and its unchanged commit twin:
--   A. hosted Stripe order passing fees: base 3000, charged 3135 -> refund 3135
--      (before: progress 3000 and a ticket-line refund of 3000; the buyer lost
--      the 135 in fees). The order may record 3135 refunded.
--   B. native Stripe absorbed-fee order: charged 1000 -> refund 1000.
--   C. Paystack order passing fees: charged 6270000 over 6000000 of lines ->
--      refund 6270000 (before: the ledger recorded 6000000 while Paystack
--      refunded the whole transaction).
--   D. instalment-plan deposit: lines worth 10000, deposit charged 2500 ->
--      refund 2500 (before: the ticket-line refund exceeded what was paid and
--      was refused).
--   E. an order already partly refunded by the host gets the rest: 3135 - 1000.
--   F. a re-drive replays the same refund.
-- Fails on the branch before this change: prepare enumerated total_cents and
-- issue_3872_cancel_refund_order did not exist.

BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '38720000-0000-4000-8000-0000000c0001';
  v_brand constant uuid := '38720000-0000-4000-8000-0000000c0002';
  v_ngb   constant uuid := '38720000-0000-4000-8000-0000000c0003';
  v_event constant uuid := '38720000-0000-4000-8000-0000000c0010';
  v_nge   constant uuid := '38720000-0000-4000-8000-0000000c0011';
  v_tt    constant uuid := '38720000-0000-4000-8000-0000000c0020';
  v_ngtt  constant uuid := '38720000-0000-4000-8000-0000000c0021';
  v_a constant uuid := '38720000-0000-4000-8000-0000000c00a1';
  v_b constant uuid := '38720000-0000-4000-8000-0000000c00b1';
  v_c constant uuid := '38720000-0000-4000-8000-0000000c00c1';
  v_d constant uuid := '38720000-0000-4000-8000-0000000c00d1';
  v_e constant uuid := '38720000-0000-4000-8000-0000000c00e1';
  v_r jsonb;
  v_replay jsonb;
  v_amount bigint;
  v_refunded integer;
  v_lines jsonb;
  v_status text;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3872-cancel@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES
    (v_brand, v_owner, 'Issue 3872 cancel us', 'issue-3872-cancel-us', 'stripe', 'US', 'USD', 'USD'),
    (v_ngb, v_owner, 'Issue 3872 cancel ng', 'issue-3872-cancel-ng', 'paystack', 'NG', 'NGN', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency) VALUES
    (v_event, v_brand, 'Issue 3872 cancel us', 'issue-3872-cancel-us-ev', 'live', 'USD'),
    (v_nge, v_ngb, 'Issue 3872 cancel ng', 'issue-3872-cancel-ng-ev', 'live', 'NGN');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents) VALUES
    (v_tt, v_event, 'GA', 1000), (v_ngtt, v_nge, 'GA', 1000000);

  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status, stripe_payment_intent_id,
    stripe_charge_id, source, stripe_application_fee_amount_cents, installment_plan_root,
    list_subtotal_cents, net_subtotal_cents, buyer_fees_cents, tax_cents, buyer_total_cents, pricing_source)
  VALUES
    (v_a, v_event, 3000, 'USD', 'paid', 'pi_3872_cx_a', 'ch_3872_cx_a', 'legacy', 45, false, 3000, 3000, 135, 0, 3135, 'provider_reconciled'),
    (v_b, v_event, 1000, 'USD', 'paid', 'pi_3872_cx_b', 'ch_3872_cx_b', 'legacy', 15, false, 1000, 1000, 0, 0, 1000, 'provider_reconciled'),
    (v_c, v_nge, 6270000, 'NGN', 'paid', 'mingla_3872_cx_c', '3872777', 'legacy', 90000, false, 6000000, 6000000, 270000, 0, 6270000, 'provider_reconciled'),
    (v_d, v_event, 2500, 'USD', 'paid', 'pi_3872_cx_d', 'ch_3872_cx_d', 'legacy', 38, true, 2500, 2500, 0, 0, 2500, 'provider_reconciled'),
    (v_e, v_event, 3000, 'USD', 'paid', 'pi_3872_cx_e', 'ch_3872_cx_e', 'legacy', 45, false, 3000, 3000, 135, 0, 3135, 'provider_reconciled');
  INSERT INTO public.order_line_items(order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES (v_a, v_tt, 3, 1000, 3000), (v_b, v_tt, 1, 1000, 1000), (v_c, v_ngtt, 6, 1000000, 6000000),
         (v_d, v_tt, 1, 10000, 10000), (v_e, v_tt, 3, 1000, 3000);

  -- E: the host already refunded one ticket (1000) before the cancellation.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_r := public.biz_refund_order(v_e, jsonb_build_array(jsonb_build_object(
    'order_line_item_id', (SELECT id FROM public.order_line_items WHERE order_id = v_e), 'quantity', 1)),
    'Issue 3872 host refund before cancel', 'issue-3872-cx-host');
  -- Fee evidence is not under test here (#2097 owns it): mark it not applicable.
  UPDATE public.refunds SET application_fee_refund_status = 'not_applicable', application_fee_refunded_cents = 0
   WHERE id = (v_r->>'refund_id')::uuid;
  PERFORM public.biz_refund_order_commit((v_r->>'refund_id')::uuid, 're_3872_cx_host', 0, 'succeeded', NULL);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE public.events SET status = 'cancelled' WHERE id IN (v_event, v_nge);
  PERFORM public.cancel_event_refund_prepare(v_event, now());
  PERFORM public.cancel_event_refund_prepare(v_nge, now());

  -- The prepared amounts are the charged remainders.
  IF (SELECT amount_cents FROM public.event_cancel_refund_progress WHERE source_id = v_a) <> 3135 THEN
    RAISE EXCEPTION 'A: prepared refund must be the charged 3135, got %',
      (SELECT amount_cents FROM public.event_cancel_refund_progress WHERE source_id = v_a);
  END IF;
  IF (SELECT amount_cents FROM public.event_cancel_refund_progress WHERE source_id = v_e) <> 2135 THEN
    RAISE EXCEPTION 'E: prepared refund must be the remaining 2135, got %',
      (SELECT amount_cents FROM public.event_cancel_refund_progress WHERE source_id = v_e);
  END IF;

  -- What the fan-out does per order: every remaining line, then the commit twin.
  FOR v_r IN
    SELECT jsonb_build_object('order', o.id, 'expect', x.expect) FROM public.orders o
    JOIN (VALUES (v_a, 3135), (v_b, 1000), (v_c, 6270000), (v_d, 2500), (v_e, 2135)) AS x(id, expect)
      ON x.id = o.id
  LOOP
    SELECT jsonb_agg(jsonb_build_object('order_line_item_id', li.id,
             'quantity', li.quantity - COALESCE((SELECT sum(rli.quantity) FROM public.refund_line_items rli
               JOIN public.refunds rf ON rf.id = rli.refund_id
               WHERE rli.order_line_item_id = li.id AND rf.status IN ('pending','succeeded')), 0)))
      INTO v_lines
    FROM public.order_line_items li WHERE li.order_id = (v_r->>'order')::uuid;
    v_replay := public.issue_3872_cancel_refund_order((v_r->>'order')::uuid, v_lines,
      'Event cancelled by the organiser', 'cancel_refund:3872:' || (v_r->>'order'));
    v_amount := (v_replay->>'amount_cents')::bigint;
    IF v_amount <> (v_r->>'expect')::bigint OR (v_replay->>'is_full_refund')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'cancel refund for % must be the charged remainder %, got % (full %)',
        v_r->>'order', v_r->>'expect', v_amount, v_replay->>'is_full_refund';
    END IF;
    IF (SELECT sum(amount_cents) FROM public.refund_line_items
          WHERE refund_id = (v_replay->>'refund_id')::uuid) <> v_amount THEN
      RAISE EXCEPTION 'cancel refund lines for % must add up to the refund', v_r->>'order';
    END IF;
    -- F: a re-drive replays the same row.
    IF (public.issue_3872_cancel_refund_order((v_r->>'order')::uuid, v_lines,
          'Event cancelled by the organiser', 'cancel_refund:3872:' || (v_r->>'order'))->>'refund_id')
       <> v_replay->>'refund_id' THEN
      RAISE EXCEPTION 'F: re-drive for % did not replay', v_r->>'order';
    END IF;
    UPDATE public.refunds SET application_fee_refund_status = 'not_applicable', application_fee_refunded_cents = 0
     WHERE id = (v_replay->>'refund_id')::uuid;
    PERFORM public.admin_refund_order_commit((v_replay->>'refund_id')::uuid,
      're_3872_cx_' || right(v_r->>'order', 8), 0, 'succeeded', NULL);
  END LOOP;

  SELECT refunded_amount_cents, payment_status INTO v_refunded, v_status FROM public.orders WHERE id = v_a;
  IF v_refunded <> 3135 OR v_status <> 'refunded' THEN
    RAISE EXCEPTION 'A: order must record 3135 refunded and be refunded, got % %', v_refunded, v_status;
  END IF;
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_e) <> 3135 THEN
    RAISE EXCEPTION 'E: host refund plus cancellation must total the charged 3135';
  END IF;
  IF (SELECT refunded_amount_cents FROM public.orders WHERE id = v_c) <> 6270000 THEN
    RAISE EXCEPTION 'C: Paystack order must record the whole charge refunded';
  END IF;

  -- Nobody can refund more than was charged.
  BEGIN
    UPDATE public.orders SET refunded_amount_cents = 3136 WHERE id = v_a;
    RAISE EXCEPTION 'constraint: a refund above the charged total was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF has_function_privilege('authenticated', 'public.issue_3872_cancel_refund_order(uuid,jsonb,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3872_cancel_refund_order(uuid,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: cancellation refund RPC is service_role only';
  END IF;
  RAISE NOTICE 'issue_3872 cancel refund pass';
END
$test$;

ROLLBACK;
