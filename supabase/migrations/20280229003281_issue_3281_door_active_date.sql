-- issue #3281 — a door sale cannot take a cancelled or ended date.
--
-- The door sheet now sends a date, and a stale sheet could still name one that
-- was cancelled or has ended. This check sits on the sale itself, not on pass
-- writes: a paid online checkout must still reach its existing reversal path
-- when its date is cancelled mid-payment.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_door_sale_record(
  p_event_id uuid,
  p_event_date_id uuid,
  p_lines jsonb,
  p_payment_method text,
  p_buyer_name text,
  p_buyer_phone_e164 text,
  p_buyer_email text,
  p_notes text,
  p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
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
  v_sold integer;
  v_list_subtotal bigint := 0;
  v_currency text;
  v_name text := NULLIF(btrim(coalesce(p_buyer_name, '')), '');
  v_phone text := NULLIF(btrim(coalesce(p_buyer_phone_e164, '')), '');
  v_email text := NULLIF(lower(btrim(coalesce(p_buyer_email, ''))), '');
  v_notes text := NULLIF(btrim(coalesce(p_notes, '')), '');
  v_seen uuid[] := ARRAY[]::uuid[];
  v_receipt_queued boolean := false;
  i integer;
BEGIN
  IF NOT public.issue_4063_can_manage_door_sale(p_event_id, v_actor) THEN
    RAISE EXCEPTION 'door_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'door_client_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
    FROM public.orders
   WHERE event_id = p_event_id
     AND door_client_request_id = p_client_request_id
     AND source = 'door_sale';
  IF FOUND THEN
    SELECT COALESCE(array_agg(t.id ORDER BY t.created_at, t.id), ARRAY[]::uuid[])
      INTO v_ticket_ids
      FROM public.tickets t
     WHERE t.order_id = v_existing.id;
    RETURN jsonb_build_object(
      'orderId', v_existing.id,
      'ticketIds', to_jsonb(v_ticket_ids),
      'receiptQueued', EXISTS (
        SELECT 1 FROM public.notification_outbox n
         WHERE n.idempotency_key = 'buyer_door_receipt:' || v_existing.id::text || ':sms'
      ),
      'replayed', true
    );
  END IF;

  SELECT e.id, e.brand_id, e.title, e.status
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'door_event_unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_event_date_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = p_event_date_id AND d.event_id = p_event_id
       AND d.cancelled_at IS NULL AND d.end_at > now()
  ) THEN
    RAISE EXCEPTION 'door_event_date_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('cash','card_reader','nfc','manual') THEN
    RAISE EXCEPTION 'door_payment_method_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'door_buyer_name_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'door_buyer_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND (
    char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) THEN
    RAISE EXCEPTION 'door_buyer_email_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 500 THEN
    RAISE EXCEPTION 'door_notes_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'door_lines_invalid' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_ticket_type_id := (v_line ->> 'ticket_type_id')::uuid;
      v_quantity := (v_line ->> 'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'door_lines_invalid' USING ERRCODE = '22023';
    END;
    IF v_ticket_type_id = ANY(v_seen) OR v_quantity NOT BETWEEN 1 AND 99 THEN
      RAISE EXCEPTION 'door_lines_invalid' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_ticket_type_id);

    SELECT * INTO v_tier
      FROM public.ticket_types tt
     WHERE tt.id = v_ticket_type_id
       AND tt.event_id = p_event_id
       AND tt.deleted_at IS NULL
       AND tt.is_disabled = false
       AND tt.is_hidden = false
       AND tt.available_in_person = true
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'door_ticket_type_unavailable' USING ERRCODE = '22023';
    END IF;
    IF (v_tier.sale_start_at IS NOT NULL AND v_tier.sale_start_at > v_now)
       OR (v_tier.sale_end_at IS NOT NULL AND v_tier.sale_end_at <= v_now) THEN
      RAISE EXCEPTION 'door_ticket_type_unavailable' USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer INTO v_sold
      FROM public.tickets t
     WHERE t.ticket_type_id = v_ticket_type_id
       AND t.status IN ('valid','used','transferred');
    IF NOT v_tier.is_unlimited
       AND v_tier.quantity_total IS NOT NULL
       AND v_sold + v_quantity > v_tier.quantity_total THEN
      RAISE EXCEPTION 'door_ticket_capacity_exceeded' USING ERRCODE = 'P0001';
    END IF;

    IF v_currency IS NULL THEN
      v_currency := btrim(v_tier.currency::text);
    ELSIF v_currency IS DISTINCT FROM btrim(v_tier.currency::text) THEN
      RAISE EXCEPTION 'door_currency_mismatch' USING ERRCODE = '22023';
    END IF;
    v_list_subtotal := v_list_subtotal + v_tier.price_cents::bigint * v_quantity;
    IF v_list_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'door_total_too_large' USING ERRCODE = '22003';
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    id, event_id, event_date_id, buyer_user_id, buyer_name, buyer_email,
    buyer_phone, buyer_phone_e164, total_cents, currency, payment_method,
    payment_status, is_door_sale, created_by_scanner_id, metadata, source,
    confirmed_at, notification_status, stripe_application_fee_amount_cents,
    list_subtotal_cents, discount_cents, net_subtotal_cents, buyer_fees_cents,
    tax_cents, buyer_total_cents, pricing_source, door_payment_method,
    door_client_request_id, created_at, updated_at
  ) VALUES (
    v_order_id, p_event_id, p_event_date_id, NULL, v_name, v_email,
    v_phone, v_phone, v_list_subtotal::integer, v_currency, p_payment_method,
    'paid', true, v_actor,
    jsonb_strip_nulls(jsonb_build_object('door_notes', v_notes)), 'door_sale',
    v_now, CASE WHEN v_phone IS NULL THEN 'not_required' ELSE 'pending' END,
    0, v_list_subtotal, 0, v_list_subtotal, 0,
    0, v_list_subtotal, 'computed_at_checkout', p_payment_method,
    p_client_request_id, v_now, v_now
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_ticket_type_id := (v_line ->> 'ticket_type_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::integer;
    SELECT * INTO v_tier FROM public.ticket_types WHERE id = v_ticket_type_id;

    INSERT INTO public.order_line_items (
      order_id, ticket_type_id, quantity, unit_price_cents, total_cents,
      list_unit_price_cents, discount_cents
    ) VALUES (
      v_order_id, v_ticket_type_id, v_quantity, v_tier.price_cents,
      v_tier.price_cents * v_quantity, v_tier.price_cents, 0
    );

    FOR i IN 1..v_quantity LOOP
      v_ticket_id := gen_random_uuid();
      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, status, approval_status, created_at, issued_at,
        used_at, used_by_scanner_id, admits_count
      ) VALUES (
        v_ticket_id, v_order_id, v_ticket_type_id, p_event_id, v_name, v_email,
        v_phone, 'door:' || v_ticket_id::text, 'used', 'auto', v_now, v_now,
        v_now, v_actor,
        CASE WHEN coalesce(v_tier.price_basis, 'person') = 'group'
          THEN greatest(1, coalesce(v_tier.group_max, 1)) ELSE 1 END
      );
      IF p_event_date_id IS NOT NULL THEN
        INSERT INTO public.ticket_event_dates(ticket_id, event_date_id)
        VALUES (v_ticket_id, p_event_date_id);
      END IF;
      v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
    END LOOP;
  END LOOP;

  INSERT INTO public.door_sales_ledger (
    event_id, order_id, scanner_user_id, payment_method, amount_cents,
    currency, notes, created_at
  ) VALUES (
    p_event_id, v_order_id, v_actor, p_payment_method, v_list_subtotal::integer,
    v_currency, v_notes, v_now
  );

  IF v_phone IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key,
        country_code, status
      ) VALUES (
        'buyer_door_receipt', NULL, v_phone, v_event.brand_id,
        jsonb_build_object(
          'order_id', v_order_id,
          'event_id', p_event_id,
          'event_title', coalesce(nullif(btrim(v_event.title), ''), 'your event'),
          'claimed', false,
          'channel_hint', 'sms'
        ),
        'buyer_door_receipt:' || v_order_id::text || ':sms',
        public.mingla_e164_country(v_phone), 'pending'
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      v_receipt_queued := true;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4063_receipt_enqueue_failed %', SQLSTATE;
      v_receipt_queued := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'ticketIds', to_jsonb(v_ticket_ids),
    'receiptQueued', v_receipt_queued,
    'replayed', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing
    FROM public.orders
   WHERE event_id = p_event_id
     AND door_client_request_id = p_client_request_id
     AND source = 'door_sale';
  IF FOUND THEN
    SELECT COALESCE(array_agg(t.id ORDER BY t.created_at, t.id), ARRAY[]::uuid[])
      INTO v_ticket_ids FROM public.tickets t WHERE t.order_id = v_existing.id;
    RETURN jsonb_build_object(
      'orderId', v_existing.id,
      'ticketIds', to_jsonb(v_ticket_ids),
      'receiptQueued', EXISTS (
        SELECT 1 FROM public.notification_outbox n
         WHERE n.idempotency_key = 'buyer_door_receipt:' || v_existing.id::text || ':sms'
      ),
      'replayed', true
    );
  END IF;
  RAISE;
END;
$function$;

COMMIT;
