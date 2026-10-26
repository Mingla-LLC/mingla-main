-- Issue #4063 Wave 5 / M7 — durable, atomic door-sale orders.
--
-- MINGLA-INVARIANT: I-4063-DOOR-ATOMIC | issue #4063 | one idempotent RPC writes the order, priced lines, already-used tickets, door ledger and optional receipt outbox row
-- MINGLA-INVARIANT: I-4063-DOOR-MONEY-ISOLATION | issue #4063 | host-collected door money never enters provider fee, payout margin, online refund fan-out or provider refund paths
-- MINGLA-INVARIANT: I-4063-DOOR-CLAIMABLE | issue #4063 | a used door receipt with a proved contact remains claimable after the event ends
-- MINGLA-INVARIANT: I-4063-DOOR-ACCESS | issue #4063 | only the exact host team that owns the event can search, read, refund, or render its durable door orders

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i4063_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4063 door sale FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS %', p_label;
END $$;

DO $test$
DECLARE
  v_owner uuid := '40630000-0000-4000-8000-000000005001';
  v_scanner uuid := '40630000-0000-4000-8000-000000005002';
  v_outsider uuid := '40630000-0000-4000-8000-000000005003';
  v_claimant uuid := '40630000-0000-4000-8000-000000005004';
  v_brand uuid := '40630000-0000-4000-8000-000000005010';
  v_event uuid := '40630000-0000-4000-8000-000000005020';
  v_date uuid := '40630000-0000-4000-8000-000000005021';
  v_tier uuid := '40630000-0000-4000-8000-000000005022';
  v_request uuid := '40630000-0000-4000-8000-000000005030';
  v_second_request uuid := '40630000-0000-4000-8000-000000005031';
  v_result jsonb;
  v_replay jsonb;
  v_order uuid;
  v_second_order uuid;
  v_line uuid;
  v_err text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'owner-door-4063@example.test'),
    (v_scanner, 'scanner-door-4063@example.test'),
    (v_outsider, 'outsider-door-4063@example.test'),
    (v_claimant, 'claimant-door-4063@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at
  ) VALUES (
    v_brand, v_owner, 'Issue 4063 Door', 'issue-4063-door',
    'USD', 'USD', 'stripe', now() - interval '1 day'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency
  ) VALUES (
    v_event, v_brand, 'Door sale event', 'issue-4063-door-event',
    'event', 'scheduled', 'public', 'America/New_York', 'USD'
  );
  INSERT INTO public.event_dates(
    id, event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    v_date, v_event, now() - interval '1 hour', now() + interval '2 hours',
    'America/New_York', true
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden
  ) VALUES (
    v_tier, v_event, 'At the door', 1500, 'USD', 4, false,
    true, true, false, false
  );
  INSERT INTO public.event_scanners(event_id, user_id)
  VALUES (v_event, v_scanner);

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.biz_door_sale_record(
    v_event, v_date,
    jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_tier, 'quantity', 2
    )),
    'cash', 'Door Buyer', '+12025554063', 'door-buyer@example.test',
    'Paid in cash at the north entrance', v_request
  );
  v_order := (v_result->>'orderId')::uuid;

  PERFORM pg_temp.i4063_assert(
    coalesce((v_result->>'replayed')::boolean, true) IS FALSE
      AND coalesce((v_result->>'receiptQueued')::boolean, false) IS TRUE
      AND jsonb_array_length(v_result->'ticketIds') = 2,
    'T5-1 the first call returns two tickets and a queued receipt'
  );
  PERFORM pg_temp.i4063_assert(
    EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.id = v_order AND o.source = 'door_sale'
         AND o.is_door_sale IS TRUE AND o.door_payment_method = 'cash'
         AND o.payment_method = 'cash' AND o.payment_status = 'paid'
         AND o.total_cents = 3000 AND o.list_subtotal_cents = 3000
         AND o.net_subtotal_cents = 3000 AND o.buyer_fees_cents = 0
         AND o.tax_cents = 0 AND o.buyer_total_cents = 3000
         AND o.stripe_application_fee_amount_cents = 0
         AND o.door_client_request_id = v_request
         AND o.attendance_identity_claim_armed_at IS NOT NULL
    )
    AND (SELECT count(*) FROM public.order_line_items WHERE order_id = v_order) = 1
    AND (SELECT count(*) FROM public.tickets
          WHERE order_id = v_order AND status = 'used'
            AND used_by_scanner_id = v_owner AND used_at IS NOT NULL) = 2
    AND EXISTS (
      SELECT 1 FROM public.door_sales_ledger d
       WHERE d.order_id = v_order AND d.amount_cents = 3000
         AND d.refunded_amount_cents = 0 AND d.payment_method = 'cash'
    ),
    'T5-1 order, line, used tickets and door ledger commit together'
  );
  PERFORM pg_temp.i4063_assert(
    (SELECT count(*) FROM public.notification_outbox n
      WHERE n.idempotency_key = 'buyer_door_receipt:' || v_order::text || ':sms'
        AND n.category_key = 'buyer_door_receipt'
        AND n.contact = '+12025554063'
        AND n.country_code = 'US') = 1,
    'T5-1 the SMS receipt outbox row is durable, contact-targeted and country-aware'
  );

  v_replay := public.biz_door_sale_record(
    v_event, v_date,
    jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_tier, 'quantity', 2
    )),
    'cash', 'Door Buyer', '+12025554063', 'door-buyer@example.test',
    'Paid in cash at the north entrance', v_request
  );
  PERFORM pg_temp.i4063_assert(
    (v_replay->>'orderId')::uuid = v_order
      AND (v_replay->>'replayed')::boolean IS TRUE
      AND (SELECT count(*) FROM public.orders
            WHERE event_id = v_event AND door_client_request_id = v_request) = 1
      AND (SELECT count(*) FROM public.tickets WHERE order_id = v_order) = 2,
    'T5-2 replay returns the original transaction without duplicating tickets'
  );

  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  v_result := public.biz_door_sale_record(
    v_event, v_date,
    jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_tier, 'quantity', 1
    )),
    'card_reader', 'Walk-up Guest', NULL, NULL, NULL, v_second_request
  );
  v_second_order := (v_result->>'orderId')::uuid;
  PERFORM pg_temp.i4063_assert(
    v_second_order IS NOT NULL
      AND coalesce((v_result->>'receiptQueued')::boolean, true) IS FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_outbox
         WHERE idempotency_key = 'buyer_door_receipt:' || v_second_order::text || ':sms'
      ),
    'T5-3 an assigned scanner can sell without collecting optional contact data'
  );

  BEGIN
    PERFORM public.biz_door_sale_record(
      v_event, v_date,
      jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'quantity', 2
      )),
      'cash', NULL, NULL, NULL, NULL, gen_random_uuid()
    );
    RAISE EXCEPTION 'capacity call unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i4063_assert(
    v_err = 'door_ticket_capacity_exceeded',
    'T5-4 capacity is checked under the ticket-tier lock'
  );

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.biz_door_sale_record(
      v_event, v_date,
      jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'quantity', 1
      )),
      'cash', NULL, NULL, NULL, NULL, gen_random_uuid()
    );
    RAISE EXCEPTION 'outsider call unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i4063_assert(
    v_err = 'door_access_denied',
    'T5-5 an unrelated account cannot create a door order'
  );

  -- Even a future/local terminal reference cannot make a door order eligible
  -- for provider-fee capture or Mingla provider margin reporting.
  UPDATE public.orders SET stripe_payment_intent_id = 'local_terminal_4063'
   WHERE id = v_order;
  PERFORM pg_temp.i4063_assert(
    NOT EXISTS (
      SELECT 1 FROM public.list_missing_payout_source_fees(500) f
       WHERE f.source_type = 'order' AND f.source_id = v_order
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.issue_3872_order_margin m WHERE m.order_id = v_order
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_source_fee_snapshots s
       WHERE s.source_type = 'order' AND s.source_id = v_order
    ),
    'W5-H1 door money stays out of provider fee, margin and payout snapshots'
  );

  INSERT INTO public.event_cancel_refund_progress(
    event_id, source_type, source_id, provider, amount_cents, status
  ) VALUES (v_event, 'order', v_order, 'stripe', 3000, 'pending');
  PERFORM pg_temp.i4063_assert(
    NOT EXISTS (
      SELECT 1 FROM public.event_cancel_refund_progress
       WHERE source_type = 'order' AND source_id = v_order
    ),
    'W5-H1 cancellation fan-out cannot enqueue a provider refund for door money'
  );

  SELECT id INTO v_line FROM public.order_line_items WHERE order_id = v_order;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    PERFORM public.biz_refund_order(
      v_order,
      jsonb_build_array(jsonb_build_object(
        'order_line_item_id', v_line, 'quantity', 1, 'amount_cents', 1500
      )),
      'Wrong provider refund path', 'issue-4063-wrong-refund-path'
    );
    RAISE EXCEPTION 'provider refund path unexpectedly accepted a door order';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.i4063_assert(
    v_err = 'door_sale_refund_path_required',
    'W5-H1 online refund RPC cannot create provider work for a door order'
  );

  v_result := public.biz_door_sale_refund(
    v_order, 1000, 'Guest requested a partial cash refund'
  );
  PERFORM pg_temp.i4063_assert(
    v_result->>'status' = 'partial_refund'
      AND (v_result->>'refundedAmountCents')::integer = 1000
      AND EXISTS (
        SELECT 1 FROM public.orders o WHERE o.id = v_order
          AND o.payment_status = 'partial_refund'
          AND o.refunded_amount_cents = 1000
      )
      AND EXISTS (
        SELECT 1 FROM public.door_sales_ledger d WHERE d.order_id = v_order
          AND d.refunded_amount_cents = 1000
      )
      AND (SELECT count(*) FROM public.tickets
            WHERE order_id = v_order AND status = 'used') = 2,
    'T5-5 dedicated door refund updates money while preserving attendance fact'
  );

  INSERT INTO public.verified_phone_identities(user_id, phone_e164)
  VALUES (v_claimant, '+12025554063');
  UPDATE public.events SET status = 'ended' WHERE id = v_event;
  v_result := public.claim_attendance_by_verified_identity(v_claimant);
  PERFORM pg_temp.i4063_assert(
    (v_result->>'count')::integer >= 1
      AND EXISTS (
        SELECT 1 FROM public.orders o
         WHERE o.id = v_order AND o.buyer_user_id = v_claimant
      )
      AND (SELECT count(*) FROM public.tickets
            WHERE order_id = v_order AND status = 'used') = 2,
    'W5-H3 the ended-event door receipt is claimable without rewriting used tickets'
  );
END
$test$;

ROLLBACK;
