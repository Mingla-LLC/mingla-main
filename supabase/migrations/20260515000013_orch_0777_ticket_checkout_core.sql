-- ORCH-0777: production ticket checkout, sales registration, notifications,
-- and server-backed ticket scanning.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    'online_card'::text,
    'apple_pay'::text,
    'google_pay'::text,
    'free'::text,
    'nfc'::text,
    'card_reader'::text,
    'cash'::text,
    'manual'::text
  ]));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_session_id uuid,
  ADD COLUMN IF NOT EXISTS buyer_phone_e164 text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'online_checkout',
  ADD COLUMN IF NOT EXISTS notification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_status text,
  ADD COLUMN IF NOT EXISTS stripe_application_fee_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_transfer_destination text,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_type text;

ALTER TABLE public.orders
  ALTER COLUMN source SET DEFAULT 'online_checkout',
  ALTER COLUMN notification_status SET DEFAULT 'pending',
  ALTER COLUMN stripe_application_fee_amount_cents SET DEFAULT 0,
  ALTER COLUMN stripe_application_fee_amount_cents SET NOT NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_source_check
  CHECK (source = ANY (ARRAY['online_checkout'::text, 'door_sale'::text, 'manual_import'::text, 'legacy'::text]));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_notification_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_notification_status_check
  CHECK (notification_status = ANY (ARRAY[
    'not_required'::text,
    'pending'::text,
    'sent'::text,
    'partial'::text,
    'failed'::text
  ]));

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_online_checkout_phone_e164_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_online_checkout_phone_e164_check
  CHECK (
    source <> 'online_checkout'
    OR (
      buyer_phone_e164 IS NOT NULL
      AND buyer_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_session_id
  ON public.orders(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_event_created_at
  ON public.orders(event_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent_id
  ON public.orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS qr_token_hash text,
  ADD COLUMN IF NOT EXISTS qr_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.ticket_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  buyer_phone_e164 text NOT NULL,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  application_fee_amount_cents integer NOT NULL DEFAULT 0 CHECK (application_fee_amount_cents >= 0),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency character(3) NOT NULL DEFAULT 'GBP',
  status text NOT NULL DEFAULT 'pending_free' CHECK (status = ANY (ARRAY[
    'pending_free'::text,
    'requires_payment'::text,
    'processing_payment'::text,
    'paid_completed'::text,
    'free_completed'::text,
    'failed'::text,
    'expired'::text
  ])),
  idempotency_key text NOT NULL,
  cart_fingerprint text NOT NULL DEFAULT '',
  buyer_status_token_hash text,
  stripe_payment_intent_id text,
  stripe_client_secret_last4 text,
  stripe_payment_intent_client_secret_hash text,
  stripe_account_id text,
  stripe_application_fee_amount_cents integer,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (idempotency_key),
  UNIQUE (stripe_payment_intent_id)
);

CREATE TABLE IF NOT EXISTS public.ticket_checkout_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id uuid NOT NULL REFERENCES public.ticket_checkout_sessions(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  ticket_name_at_purchase text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_checkout_sessions_event_status
  ON public.ticket_checkout_sessions(event_id, status, expires_at);

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  ADD COLUMN IF NOT EXISTS application_fee_amount_cents integer NOT NULL DEFAULT 0 CHECK (application_fee_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS cart_fingerprint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS buyer_status_token_hash text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_client_secret_hash text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE INDEX IF NOT EXISTS idx_ticket_checkout_session_items_ticket_type
  ON public.ticket_checkout_session_items(ticket_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_qr_token_hash
  ON public.tickets(qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ticket_order_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel = ANY (ARRAY['email'::text, 'sms'::text])),
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY[
    'pending'::text,
    'sending'::text,
    'sent'::text,
    'delivered'::text,
    'failed_retryable'::text,
    'failed_terminal'::text,
    'skipped'::text
  ])),
  provider text,
  provider_message_id text,
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ticket_order_notifications_order
  ON public.ticket_order_notifications(order_id, channel);

CREATE TABLE IF NOT EXISTS public.twilio_message_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES public.ticket_order_notifications(id) ON DELETE SET NULL,
  message_sid text NOT NULL,
  message_status text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ticket_checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_checkout_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_order_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.twilio_message_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages ticket_checkout_sessions" ON public.ticket_checkout_sessions;
CREATE POLICY "Service role manages ticket_checkout_sessions"
  ON public.ticket_checkout_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Brand team reads ticket_checkout_sessions" ON public.ticket_checkout_sessions;
CREATE POLICY "Brand team reads ticket_checkout_sessions"
  ON public.ticket_checkout_sessions
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read(brand_id, auth.uid()));

DROP POLICY IF EXISTS "Service role manages ticket_checkout_session_items" ON public.ticket_checkout_session_items;
CREATE POLICY "Service role manages ticket_checkout_session_items"
  ON public.ticket_checkout_session_items
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Brand team reads ticket_checkout_session_items" ON public.ticket_checkout_session_items;
CREATE POLICY "Brand team reads ticket_checkout_session_items"
  ON public.ticket_checkout_session_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.ticket_checkout_sessions s
    WHERE s.id = ticket_checkout_session_items.checkout_session_id
      AND public.biz_is_brand_member_for_read(s.brand_id, auth.uid())
  ));

DROP POLICY IF EXISTS "Service role manages ticket_order_notifications" ON public.ticket_order_notifications;
CREATE POLICY "Service role manages ticket_order_notifications"
  ON public.ticket_order_notifications
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Brand team reads ticket_order_notifications" ON public.ticket_order_notifications;
CREATE POLICY "Brand team reads ticket_order_notifications"
  ON public.ticket_order_notifications
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read(public.biz_event_brand_id(event_id), auth.uid()));

DROP POLICY IF EXISTS "Service role manages twilio_message_status_events" ON public.twilio_message_status_events;
CREATE POLICY "Service role manages twilio_message_status_events"
  ON public.twilio_message_status_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_token_hash(p_token text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT encode(extensions.digest(
    p_token || ':' || COALESCE(NULLIF(current_setting('app.qr_token_pepper', true), ''), 'local-ticket-pepper'),
    'sha256'
  ), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_qr_payload(
  p_ticket_id uuid,
  p_token_hash text
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'mingla:v1:ticket:' || p_ticket_id::text || ':sig:' || encode(extensions.digest(
    p_ticket_id::text || ':' || p_token_hash || ':' || COALESCE(NULLIF(current_setting('app.qr_token_pepper', true), ''), 'local-ticket-pepper'),
    'sha256'
  ), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
BEGIN
  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketTypeId', i.ticket_type_id,
      'ticketName', i.ticket_name_at_purchase,
      'quantity', i.quantity,
      'unitPriceCents', i.unit_price_cents,
      'totalCents', i.total_cents
    ) ORDER BY i.created_at), '[]'::jsonb)
      INTO v_items
      FROM public.ticket_checkout_session_items i
     WHERE i.checkout_session_id = v_existing.id;

    RETURN jsonb_build_object(
      'checkoutSessionId', v_existing.id,
      'eventId', v_existing.event_id,
      'brandId', v_existing.brand_id,
      'status', v_existing.status,
      'totalCents', v_existing.total_cents,
      'currency', trim(v_existing.currency),
      'stripeAccountId', v_existing.stripe_account_id,
      'orderId', v_existing.order_id,
      'items', v_items
    );
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, s.stripe_account_id, s.charges_enabled
    INTO v_event
    FROM public.events e
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility <> 'public' OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  v_session_id := gen_random_uuid();

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line ->> 'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    IF NOT v_ticket_type.is_unlimited THEN
      SELECT COUNT(*)
        INTO v_sold
        FROM public.tickets t
       WHERE t.ticket_type_id = v_ticket_type.id
         AND t.status IN ('valid', 'used', 'transferred');

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_qty > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_ticket_type.currency;
    ELSIF v_currency <> v_ticket_type.currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE WHEN v_total > 0 THEN v_event.stripe_account_id ELSE NULL END;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    COALESCE(v_currency, 'GBP'::character(3)), v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0)
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_charge_id text DEFAULT NULL,
  p_stripe_payment_method_type text DEFAULT NULL
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
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  i integer;
BEGIN
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
      v_qr := public.biz_ticket_checkout_qr_payload(
        v_ticket_id,
        public.biz_ticket_checkout_token_hash(v_token)
      );

      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, qr_token_hash, status, approval_status, created_at,
        issued_at
      ) VALUES (
        v_ticket_id, v_order_id, v_item.ticket_type_id, v_session.event_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr, public.biz_ticket_checkout_token_hash(v_token), 'valid', 'auto', v_now, v_now
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
  p_scanner_user_id uuid
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
BEGIN
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

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash) THEN
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

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid) TO service_role;
