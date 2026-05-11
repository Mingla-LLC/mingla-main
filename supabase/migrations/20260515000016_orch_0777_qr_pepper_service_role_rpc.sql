-- ORCH-0777 QR pepper rework: remove database-level GUC dependency.
-- QR helper execution now requires service-role callers to pass the Edge
-- Function secret into the bounded SQL operation that generates or validates
-- ticket QR payloads.

DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.biz_ticket_scan(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.biz_ticket_checkout_qr_payload(uuid, text);
DROP FUNCTION IF EXISTS public.biz_ticket_checkout_token_hash(text);

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_qr_token_pepper IS NULL
     OR btrim(p_qr_token_pepper) = ''
     OR length(btrim(p_qr_token_pepper)) < 32
     OR btrim(p_qr_token_pepper) = 'local-ticket-pepper' THEN
    RAISE EXCEPTION 'qr_token_pepper_missing';
  END IF;

  RETURN btrim(p_qr_token_pepper);
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_token_hash(
  p_token text,
  p_qr_token_pepper text
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT encode(extensions.digest(
    p_token || ':' || public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper),
    'sha256'
  ), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_qr_payload(
  p_ticket_id uuid,
  p_token_hash text,
  p_qr_token_pepper text
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'mingla:v1:ticket:' || p_ticket_id::text || ':sig:' || encode(extensions.digest(
    p_ticket_id::text || ':' || p_token_hash || ':' || public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper),
    'sha256'
  ), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session record;
  v_item record;
  v_order_id uuid;
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  v_qr_token_pepper text;
  i integer;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  SELECT *
    INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status
    ) ORDER BY t.created_at), '[]'::jsonb)
      INTO v_tickets
      FROM public.tickets t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = v_session.order_id;

    RETURN jsonb_build_object(
      'orderId', v_session.order_id,
      'checkoutSessionId', v_session.id,
      'eventId', v_session.event_id,
      'paymentStatus', 'paid',
      'totalCents', v_session.total_cents,
      'currency', trim(v_session.currency),
      'tickets', v_tickets,
      'notificationStatus', 'queued'
    );
  END IF;

  IF v_session.total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id) IS NULL THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  v_order_id := gen_random_uuid();
  v_method := CASE
    WHEN v_session.total_cents = 0 THEN 'free'
    WHEN p_stripe_payment_method_type = 'apple_pay' THEN 'apple_pay'
    WHEN p_stripe_payment_method_type = 'google_pay' THEN 'google_pay'
    ELSE 'online_card'
  END;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at
  ) VALUES (
    v_order_id, v_session.event_id, v_session.buyer_user_id, v_session.buyer_email,
    v_session.buyer_name, v_session.buyer_phone_e164, v_session.buyer_phone_e164,
    v_session.total_cents, v_session.currency, v_method, 'paid',
    COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id),
    p_stripe_charge_id, false,
    jsonb_build_object(
      'checkout_session_id', v_session.id,
      'marketing_opt_in', v_session.marketing_opt_in
    ),
    v_session.id, 'online_checkout', v_now, 'pending',
    COALESCE(v_session.stripe_application_fee_amount_cents, 0), v_session.stripe_account_id,
    p_stripe_payment_method_type,
    CASE WHEN v_session.total_cents = 0 THEN NULL ELSE 'succeeded' END,
    v_now, v_now
  );

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    FOR i IN 1..v_item.quantity LOOP
      v_ticket_id := gen_random_uuid();
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      v_token_hash := public.biz_ticket_checkout_token_hash(v_token, v_qr_token_pepper);
      v_qr := public.biz_ticket_checkout_qr_payload(
        v_ticket_id,
        v_token_hash,
        v_qr_token_pepper
      );

      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, qr_token_hash, status, approval_status, created_at,
        issued_at
      ) VALUES (
        v_ticket_id, v_order_id, v_item.ticket_type_id, v_session.event_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr, v_token_hash, 'valid', 'auto', v_now, v_now
      );

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid'
      ));
    END LOOP;
  END LOOP;

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES
    (
      v_order_id,
      v_session.event_id,
      'email',
      v_session.buyer_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('checkoutSessionId', v_session.id)
    ),
    (
      v_order_id,
      v_session.event_id,
      'sms',
      v_session.buyer_phone_e164,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('checkoutSessionId', v_session.id)
    )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.ticket_checkout_sessions
     SET order_id = v_order_id,
         status = CASE WHEN total_cents = 0 THEN 'free_completed' ELSE 'paid_completed' END,
         stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
         completed_at = v_now,
         updated_at = v_now
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_scan(
  p_event_id uuid,
  p_qr_payload text,
  p_scanner_user_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_match text[];
  v_ticket_id uuid;
  v_token text;
  v_ticket record;
  v_scan_result text;
  v_scan_id uuid;
  v_qr_token_pepper text;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF NOT EXISTS (
    SELECT 1
      FROM public.event_scanners es
     WHERE es.event_id = p_event_id
       AND es.user_id = p_scanner_user_id
       AND es.removed_at IS NULL
       AND COALESCE((es.permissions ->> 'scan')::boolean, true)
  ) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  v_match := regexp_match(
    p_qr_payload,
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$'
  );

  IF v_match IS NULL THEN
    v_scan_result := 'not_found';
  ELSE
    v_ticket_id := v_match[1]::uuid;
    v_token := v_match[2];

    SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name
      INTO v_ticket
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.id = v_ticket_id
     FOR UPDATE OF t;

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash, v_qr_token_pepper) THEN
      v_scan_result := 'not_found';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_scan_result := 'wrong_event';
    ELSIF v_ticket.payment_status <> 'paid' THEN
      v_scan_result := 'void';
    ELSIF v_ticket.status = 'used' THEN
      v_scan_result := 'duplicate';
    ELSIF v_ticket.status <> 'valid' THEN
      v_scan_result := 'void';
    ELSE
      v_scan_result := 'success';
      UPDATE public.tickets
         SET status = 'used',
             used_at = now(),
             used_by_scanner_id = p_scanner_user_id
       WHERE id = v_ticket.id;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    INSERT INTO public.scan_events (
      ticket_id, event_id, scanner_user_id, scan_result, client_offline,
      synced_at, metadata
    ) VALUES (
      v_ticket_id, p_event_id, p_scanner_user_id, v_scan_result, false, now(),
      jsonb_build_object('source', 'scan-ticket', 'buyerName', COALESCE(v_ticket.buyer_name, ''), 'ticketName', COALESCE(v_ticket.ticket_name, ''))
    )
    RETURNING id INTO v_scan_id;
  END IF;

  RETURN jsonb_build_object(
    'result', v_scan_result,
    'scanId', v_scan_id,
    'ticketId', v_ticket_id,
    'orderId', v_ticket.order_id,
    'buyerName', v_ticket.buyer_name,
    'ticketName', v_ticket.ticket_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_assert_qr_pepper(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_token_hash(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_assert_qr_pepper(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_token_hash(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;
