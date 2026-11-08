-- Issue #4271 follow-up: the buyer name a host types for a Tap to Pay door
-- sale is saved on the sale, the same way the buyer phone already is.
--
-- Live case: the host typed a name in the door sale sheet, the paid screen
-- showed it, but the order (door sales list, sale detail, guest list) had no
-- name: door-tap-intent never stored it and biz_door_tap_record wrote
-- buyer_name NULL.
--
-- 1. door_tap_intents.buyer_name (nullable). door-tap-intent create stores the
--    trimmed name next to buyer_phone_e164. Same rule as the cash door sale
--    (biz_door_sale_record): trimmed, empty means NULL, at most 120 characters.
-- 2. biz_door_tap_record copies it to orders.buyer_name and every ticket's
--    attendee_name, exactly where biz_door_sale_record puts a cash buyer's
--    name. Signature, SECURITY DEFINER, search_path and grants unchanged
--    (service_role only); the body is otherwise the 20280404004271 one.
--
-- Old app builds send no name: the column stays NULL and the sale records as
-- before. Static SQL, no data change; safe to run twice.

BEGIN;

ALTER TABLE public.door_tap_intents
  ADD COLUMN IF NOT EXISTS buyer_name text NULL;
ALTER TABLE public.door_tap_intents
  DROP CONSTRAINT IF EXISTS door_tap_intents_buyer_name_check;
ALTER TABLE public.door_tap_intents
  ADD CONSTRAINT door_tap_intents_buyer_name_check CHECK (
    buyer_name IS NULL
    OR (buyer_name = btrim(buyer_name) AND char_length(buyer_name) BETWEEN 1 AND 120)
  );
COMMENT ON COLUMN public.door_tap_intents.buyer_name IS
  '#4271: the buyer name the host typed for this tap (trimmed, 1-120 chars, NULL when none); biz_door_tap_record copies it to orders.buyer_name and tickets.attendee_name.';

CREATE OR REPLACE FUNCTION public.biz_door_tap_record(
  p_payment_intent_id text,
  p_charge_id text,
  p_amount_received_cents integer,
  p_card_brand text,
  p_card_last4 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_intent public.door_tap_intents%ROWTYPE;
  v_event record;
  v_existing public.orders%ROWTYPE;
  v_order_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_line jsonb;
  v_tier public.ticket_types%ROWTYPE;
  v_ticket_id uuid;
  v_ticket_ids uuid[] := ARRAY[]::uuid[];
  v_ticket_type_id uuid;
  v_quantity integer;
  v_receipt_queued boolean := false;
  v_brand text := lower(nullif(btrim(coalesce(p_card_brand, '')), ''));
  v_last4 text := nullif(btrim(coalesce(p_card_last4, '')), '');
  v_name text;
  i integer;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'payment_not_succeeded' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_intent
    FROM public.door_tap_intents
   WHERE stripe_payment_intent_id = p_payment_intent_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'door_tap_intent_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_intent.order_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(t.id ORDER BY t.created_at, t.id), ARRAY[]::uuid[])
      INTO v_ticket_ids FROM public.tickets t WHERE t.order_id = v_intent.order_id;
    RETURN jsonb_build_object(
      'orderId', v_intent.order_id,
      'ticketIds', to_jsonb(v_ticket_ids),
      'receiptQueued', EXISTS (
        SELECT 1 FROM public.notification_outbox n
         WHERE n.idempotency_key = 'buyer_door_receipt:' || v_intent.order_id::text || ':sms'
      ),
      'replayed', true
    );
  END IF;
  IF p_amount_received_cents IS DISTINCT FROM v_intent.total_cents THEN
    RAISE EXCEPTION 'payment_not_succeeded' USING ERRCODE = '22023';
  END IF;
  -- The host-typed name, by the cash door sale's rule (trimmed, empty is NULL).
  v_name := NULLIF(btrim(coalesce(v_intent.buyer_name, '')), '');

  SELECT e.id, e.brand_id, e.title INTO v_event
    FROM public.events e WHERE e.id = v_intent.event_id;

  IF v_brand IS NOT NULL AND v_brand NOT IN (
    'visa','mastercard','amex','discover','diners','jcb','unionpay','verve','eftpos'
  ) THEN
    v_brand := 'other';
  END IF;
  IF v_last4 IS NOT NULL AND v_last4 !~ '^[0-9]{4}$' THEN
    v_last4 := NULL;
  END IF;

  -- Payment is taken: the sale stands even if the tier sold out meanwhile.
  INSERT INTO public.orders (
    id, event_id, event_date_id, buyer_user_id, buyer_name, buyer_email,
    buyer_phone, buyer_phone_e164, total_cents, currency, payment_method,
    payment_status, is_door_sale, created_by_scanner_id, metadata, source,
    confirmed_at, notification_status, stripe_payment_intent_id,
    stripe_charge_id, stripe_payment_intent_status, stripe_payment_method_type,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    list_subtotal_cents, discount_cents, net_subtotal_cents, buyer_fees_cents,
    tax_cents, buyer_total_cents, pricing_source, door_payment_method,
    door_client_request_id, payment_card_brand, payment_card_last4,
    created_at, updated_at
  ) VALUES (
    v_order_id, v_intent.event_id, v_intent.event_date_id, NULL, v_name, NULL,
    v_intent.buyer_phone_e164, v_intent.buyer_phone_e164, v_intent.total_cents,
    v_intent.currency, 'online_card', 'paid', true, v_intent.created_by,
    jsonb_build_object('door_tap_intent_id', v_intent.id), 'online_checkout',
    v_now,
    CASE WHEN v_intent.buyer_phone_e164 IS NULL THEN 'not_required' ELSE 'pending' END,
    p_payment_intent_id, nullif(btrim(coalesce(p_charge_id, '')), ''),
    'succeeded', 'card_present', v_intent.application_fee_cents,
    v_intent.stripe_account_id,
    v_intent.subtotal_cents, 0, v_intent.subtotal_cents, v_intent.fee_cents,
    v_intent.total_cents - v_intent.subtotal_cents - v_intent.fee_cents,
    v_intent.total_cents, 'computed_at_checkout', 'tap_to_pay',
    v_intent.client_request_id, v_brand, v_last4, v_now, v_now
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_intent.lines) LOOP
    v_ticket_type_id := (v_line ->> 'ticketTypeId')::uuid;
    v_quantity := (v_line ->> 'quantity')::integer;
    SELECT * INTO v_tier FROM public.ticket_types WHERE id = v_ticket_type_id;

    INSERT INTO public.order_line_items (
      order_id, ticket_type_id, quantity, unit_price_cents, total_cents,
      list_unit_price_cents, discount_cents
    ) VALUES (
      v_order_id, v_ticket_type_id, v_quantity, (v_line ->> 'unitCents')::integer,
      (v_line ->> 'unitCents')::integer * v_quantity, (v_line ->> 'unitCents')::integer, 0
    );

    FOR i IN 1..v_quantity LOOP
      v_ticket_id := gen_random_uuid();
      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, status, approval_status, created_at, issued_at,
        used_at, used_by_scanner_id, admits_count
      ) VALUES (
        v_ticket_id, v_order_id, v_ticket_type_id, v_intent.event_id, v_name, NULL,
        v_intent.buyer_phone_e164, 'door:' || v_ticket_id::text, 'used', 'auto',
        v_now, v_now, v_now, v_intent.created_by,
        CASE WHEN coalesce(v_tier.price_basis, 'person') = 'group'
          THEN greatest(1, coalesce(v_tier.group_max, 1)) ELSE 1 END
      );
      IF v_intent.event_date_id IS NOT NULL THEN
        INSERT INTO public.ticket_event_dates(ticket_id, event_date_id)
        VALUES (v_ticket_id, v_intent.event_date_id);
      END IF;
      INSERT INTO public.scan_events (
        ticket_id, event_id, scanner_user_id, scan_result, client_offline,
        synced_at, metadata, event_date_id
      ) VALUES (
        v_ticket_id, v_intent.event_id, v_intent.created_by, 'success', false,
        v_now, jsonb_build_object('source', 'door_tap'), v_intent.event_date_id
      );
      v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
    END LOOP;
  END LOOP;

  INSERT INTO public.door_sales_ledger (
    event_id, order_id, scanner_user_id, payment_method, amount_cents,
    currency, notes, created_at
  ) VALUES (
    v_intent.event_id, v_order_id, v_intent.created_by, 'tap_to_pay',
    v_intent.total_cents, v_intent.currency, NULL, v_now
  );

  UPDATE public.door_tap_intents
     SET status = 'recorded', order_id = v_order_id, updated_at = v_now
   WHERE id = v_intent.id;

  IF v_intent.buyer_phone_e164 IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code, status
      ) VALUES (
        'buyer_door_receipt', NULL, v_intent.buyer_phone_e164, v_event.brand_id,
        jsonb_build_object(
          'order_id', v_order_id,
          'event_id', v_intent.event_id,
          'event_title', coalesce(nullif(btrim(v_event.title), ''), 'your event'),
          'claimed', false,
          'channel_hint', 'sms'
        ),
        'buyer_door_receipt:' || v_order_id::text || ':sms',
        public.mingla_e164_country(v_intent.buyer_phone_e164), 'pending'
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      v_receipt_queued := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4271_tap_receipt_enqueue_failed %', SQLSTATE;
      v_receipt_queued := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'ticketIds', to_jsonb(v_ticket_ids),
    'receiptQueued', v_receipt_queued,
    'replayed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_door_tap_record(text, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_door_tap_record(text, text, integer, text, text)
  TO service_role;

COMMENT ON FUNCTION public.biz_door_tap_record(text, text, integer, text, text) IS
  '#4271: records a Stripe-verified Tap to Pay sale as an online_checkout order; tickets are born used; the host-typed buyer name and phone land on the order and its tickets.';

COMMIT;
