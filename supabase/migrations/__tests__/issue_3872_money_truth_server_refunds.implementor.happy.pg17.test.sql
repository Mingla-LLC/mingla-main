-- Issue #3872 PR 1 (money truth) — refunds are computed on the server (F4) (PG17).
--
-- MINGLA-INVARIANT: I-3872-SERVER-REFUND-AMOUNT | issue #3872 | A refund's amount
-- is quantity x order_line_items.unit_price_cents per refunded line, computed
-- by the server; a client-sent amount is ignored and logged when it differs.
--
-- Policy parity: the Host app's RefundSheet has always sent
-- round(qty x unit_price_cents/100 x 100) = qty x unit_price_cents per line, with
-- no fee or tax share, for partial and full refunds alike, on Stripe and
-- Paystack. A current app therefore sees the same amount as before.
--
-- Cases (each FAILS before 20271106003872_issue_3872_money_truth.sql):
--   1. an inflated client amount is ignored and logged;
--   2. a client that sends no amount gets the server amount;
--   3. the same line listed twice cannot exceed its quantity;
--   4. a retry carrying a manifest minted before #3872 (client-shaped lines)
--      is still an idempotent replay, not idempotency_request_mismatch;
--   5. full refund of a Paystack order that passed fees refunds the ticket lines
--      (policy unchanged: fees are not refunded), partial refunds per line;
--   6. refund_preview returns the same amount and writes nothing; it refuses a
--      caller without payment rights;
--   7. admin_refund_order ignores the client amount too.

BEGIN;

DO $test$
DECLARE
  v_owner    constant uuid := '38720000-0000-4000-8000-0000000f0001';
  v_stranger constant uuid := '38720000-0000-4000-8000-0000000f0002';
  v_brand    constant uuid := '38720000-0000-4000-8000-0000000f0010';
  v_event    constant uuid := '38720000-0000-4000-8000-0000000f0020';
  v_tt_a     constant uuid := '38720000-0000-4000-8000-0000000f0030';
  v_tt_b     constant uuid := '38720000-0000-4000-8000-0000000f0031';
  v_order    constant uuid := '38720000-0000-4000-8000-0000000f0040';
  v_order2   constant uuid := '38720000-0000-4000-8000-0000000f0041';
  v_order3   constant uuid := '38720000-0000-4000-8000-0000000f0042';
  v_order4   constant uuid := '38720000-0000-4000-8000-0000000f0043';
  v_line_a   constant uuid := '38720000-0000-4000-8000-0000000f0050';
  v_line_b   constant uuid := '38720000-0000-4000-8000-0000000f0051';
  v_line2    constant uuid := '38720000-0000-4000-8000-0000000f0052';
  v_line3    constant uuid := '38720000-0000-4000-8000-0000000f0053';
  v_line4    constant uuid := '38720000-0000-4000-8000-0000000f0054';
  v_r        jsonb;
  v_meta     jsonb;
  v_count    integer;
  v_raised   boolean;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_owner), (v_stranger);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'owner-3872-refund@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency)
  VALUES (v_brand, v_owner, 'Issue 3872 refunds', 'issue-3872-refunds', 'paystack', 'NG', 'NGN', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency)
  VALUES (v_event, v_brand, 'Issue 3872 refunds', 'issue-3872-refunds-ev', 'ended', 'NGN');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents)
  VALUES (v_tt_a, v_event, 'A', 1000000), (v_tt_b, v_event, 'B', 2500000);
  -- Paystack order passing the 1.5% Mingla fee and 3% service fee:
  -- lines 2 x 1000000 + 1 x 2500000 = 4500000, charged 4702500.
  INSERT INTO public.orders(id, event_id, total_cents, currency, payment_status,
    stripe_payment_intent_id, stripe_charge_id, source, stripe_application_fee_amount_cents)
  VALUES
    (v_order,  v_event, 4702500, 'NGN', 'paid', 'mingla_3872_rf_1', '3872001', 'legacy', 67500),
    (v_order2, v_event, 1045000, 'NGN', 'paid', 'mingla_3872_rf_2', '3872002', 'legacy', 15000),
    (v_order3, v_event, 1045000, 'NGN', 'paid', 'mingla_3872_rf_3', '3872003', 'legacy', 15000),
    (v_order4, v_event, 2090000, 'NGN', 'paid', 'mingla_3872_rf_4', '3872004', 'legacy', 30000);
  INSERT INTO public.order_line_items(id, order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES
    (v_line_a, v_order, v_tt_a, 2, 1000000, 2000000),
    (v_line_b, v_order, v_tt_b, 1, 2500000, 2500000),
    (v_line2, v_order2, v_tt_a, 1, 1000000, 1000000),
    (v_line3, v_order3, v_tt_a, 1, 1000000, 1000000),
    (v_line4, v_order4, v_tt_a, 2, 1000000, 2000000);

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- 6. Preview first: same rule, nothing written.
  v_r := public.refund_preview(v_order, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line_a, 'quantity', 1, 'amount_cents', 999999999)));
  IF (v_r->>'amount_cents')::bigint <> 1000000 OR (v_r->>'within_remaining')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'case 6: preview must be 1 x 1000000, got %', v_r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.refunds WHERE order_id = v_order) THEN
    RAISE EXCEPTION 'case 6: preview wrote a refund row';
  END IF;

  -- 1. Inflated client amount: ignored, logged.
  v_r := public.biz_refund_order(v_order, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line_a, 'quantity', 1, 'amount_cents', 999999999)),
    'Issue 3872 inflated client amount', 'issue-3872-rf-inflated');
  IF (v_r->>'amount_cents')::bigint <> 1000000 THEN
    RAISE EXCEPTION 'case 1 F4: refund must be the server amount 1000000, got %', v_r->>'amount_cents';
  END IF;
  SELECT metadata INTO v_meta FROM public.refunds WHERE id = (v_r->>'refund_id')::uuid;
  IF (v_meta #>> '{issue_3872_client_reported,amount_cents}')::bigint <> 999999999
     OR (SELECT amount_cents FROM public.refund_line_items WHERE refund_id = (v_r->>'refund_id')::uuid) <> 1000000 THEN
    RAISE EXCEPTION 'case 1: client amount must be logged and the line stored at the server amount: %', v_meta;
  END IF;

  -- 2. No client amount at all.
  v_r := public.biz_refund_order(v_order, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line_b, 'quantity', 1)),
    'Issue 3872 no client amount sent', 'issue-3872-rf-noamount');
  IF (v_r->>'amount_cents')::bigint <> 2500000 THEN
    RAISE EXCEPTION 'case 2: expected 2500000, got %', v_r->>'amount_cents';
  END IF;
  IF (SELECT metadata ? 'issue_3872_client_reported' FROM public.refunds WHERE id = (v_r->>'refund_id')::uuid) THEN
    RAISE EXCEPTION 'case 2: nothing to log when the client sent no amount';
  END IF;

  -- 3. The same line twice cannot exceed its quantity (line_a has 1 left).
  v_raised := false;
  BEGIN
    PERFORM public.biz_refund_order(v_order, jsonb_build_array(
      jsonb_build_object('order_line_item_id', v_line_a, 'quantity', 1, 'amount_cents', 1000000),
      jsonb_build_object('order_line_item_id', v_line_a, 'quantity', 1, 'amount_cents', 1000000)),
      'Issue 3872 duplicate line entries', 'issue-3872-rf-dup');
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM LIKE 'line_overrefund%';
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'case 3: listing a line twice must not refund more than its quantity';
  END IF;

  -- 4. A retry of a key minted before #3872 (client-shaped manifest) replays.
  INSERT INTO public.refunds(order_id, amount_cents, currency, reason, initiated_by, status, metadata)
  VALUES (v_order2, 1000000, 'NGN', 'Issue 3872 legacy manifest', v_owner, 'pending',
    jsonb_build_object('idempotency_key', 'issue-3872-rf-legacy',
      'refund_request_manifest', jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'order_line_item_id', v_line2::text, 'quantity', 1, 'amount_cents', 1000000)),
        'reason', 'Issue 3872 legacy manifest',
        'amount_cents', 1000000, 'proposed_new_payment_status', 'refunded', 'is_full_refund', true)));
  v_r := public.biz_refund_order(v_order2, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line2, 'quantity', 1, 'amount_cents', 1000000)),
    'Issue 3872 legacy manifest', 'issue-3872-rf-legacy');
  IF (v_r->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'case 4: legacy manifest retry must replay, got %', v_r;
  END IF;
  -- A retry whose stored manifest is the NEW (server) shape also replays, from a
  -- client that sends no amount.
  v_r := public.biz_refund_order(v_order3, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line3, 'quantity', 1, 'amount_cents', 1000000)),
    'Issue 3872 new manifest', 'issue-3872-rf-new');
  v_r := public.biz_refund_order(v_order3, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line3, 'quantity', 1)),
    'Issue 3872 new manifest', 'issue-3872-rf-new');
  IF (v_r->>'idempotent_replay')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'case 4b: retry without amounts must replay the server manifest, got %', v_r;
  END IF;

  -- 5. Full refund of the Paystack passed-fee order: the remaining ticket line
  -- (fees are not refunded — unchanged policy). Order 1 is now fully refunded.
  v_r := public.biz_refund_order(v_order, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line_a, 'quantity', 1, 'amount_cents', 1000000)),
    'Issue 3872 rest of the order', 'issue-3872-rf-rest');
  IF (v_r->>'amount_cents')::bigint <> 1000000 OR (v_r->>'is_full_refund')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'case 5: expected the last 1000000 and a full refund, got %', v_r;
  END IF;
  SELECT sum(amount_cents) INTO v_count FROM public.refunds WHERE order_id = v_order;
  IF v_count <> 4500000 THEN
    RAISE EXCEPTION 'case 5: all lines refunded must total the ticket lines 4500000, got %', v_count;
  END IF;

  -- 6b. A caller without payment rights cannot preview.
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  v_raised := false;
  BEGIN
    PERFORM public.refund_preview(v_order4, jsonb_build_array(
      jsonb_build_object('order_line_item_id', v_line4, 'quantity', 1)));
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'case 6b: preview must refuse a caller without payment rights';
  END IF;

  -- 7. Admin twin (service role, no JWT subject) ignores the client amount too.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_r := public.admin_refund_order(v_order4, jsonb_build_array(
    jsonb_build_object('order_line_item_id', v_line4, 'quantity', 2, 'amount_cents', 1)),
    'Issue 3872 admin refund', 'issue-3872-rf-admin');
  IF (v_r->>'amount_cents')::bigint <> 2000000 THEN
    RAISE EXCEPTION 'case 7: admin refund must be the server amount 2000000, got %', v_r->>'amount_cents';
  END IF;

  IF has_function_privilege('anon', 'public.refund_preview(uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3872_refund_server_lines(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.refund_preview(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: refund_preview is for signed-in callers only; the helper is internal';
  END IF;
  RAISE NOTICE 'issue_3872 server refunds pass';
END
$test$;

ROLLBACK;
