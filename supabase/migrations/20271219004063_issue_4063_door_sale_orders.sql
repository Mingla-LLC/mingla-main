-- Issue #4063 Wave 5: make door sales durable orders instead of device-only
-- records. Door money is collected by the host and never enters a provider or
-- payout rail; no payout_source_fee_snapshots row is created here.

BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS door_payment_method text,
  ADD COLUMN IF NOT EXISTS door_client_request_id uuid;

UPDATE public.orders
   SET door_payment_method = payment_method
 WHERE source = 'door_sale'
   AND door_payment_method IS NULL
   AND payment_method IN ('cash','card_reader','nfc','manual');

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_door_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_door_payment_method_check CHECK (
  (source = 'door_sale' AND door_payment_method IN ('cash','card_reader','nfc','manual'))
  OR (source <> 'door_sale' AND door_payment_method IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_door_client_request_uq
  ON public.orders(event_id, door_client_request_id)
  WHERE source = 'door_sale';

ALTER TABLE public.door_sales_ledger
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.door_sales_ledger
  DROP CONSTRAINT IF EXISTS door_sales_ledger_refunded_amount_check;
ALTER TABLE public.door_sales_ledger
  ADD CONSTRAINT door_sales_ledger_refunded_amount_check CHECK (
    refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents
  );

-- I-4063-DOOR-MONEY-ISOLATION: host-collected door money must never enter the
-- provider refund fan-out. The cancellation enumerator writes this table; a
-- BEFORE trigger is a narrow backstop that keeps door orders out without
-- changing the cancellation behavior for any online rail.
CREATE OR REPLACE FUNCTION public.issue_4063_skip_door_refund_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.source_type = 'order' AND EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = NEW.source_id AND o.source = 'door_sale'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_4063_skip_door_refund_progress
  ON public.event_cancel_refund_progress;
CREATE TRIGGER issue_4063_skip_door_refund_progress
BEFORE INSERT ON public.event_cancel_refund_progress
FOR EACH ROW EXECUTE FUNCTION public.issue_4063_skip_door_refund_progress();

-- Only the dedicated door refund RPC may write a refund for a door order.
-- Provider-backed refund RPCs use a different or absent metadata source and
-- are rejected before they can create a pending provider operation.
CREATE OR REPLACE FUNCTION public.issue_4063_guard_door_refund_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = NEW.order_id AND o.source = 'door_sale'
  ) AND coalesce(NEW.metadata ->> 'source', '') <> 'door_sale' THEN
    RAISE EXCEPTION 'door_sale_refund_path_required' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_4063_guard_door_refund_path ON public.refunds;
CREATE TRIGGER issue_4063_guard_door_refund_path
BEFORE INSERT ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.issue_4063_guard_door_refund_path();

INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES (
  'buyer_door_receipt', 'Purchases', true, 'high',
  ARRAY['sms'], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

-- I-4063-DOOR-ACCESS: use the exact door predicate shared by name search and
-- manual admit, plus the manager rank arm that keeps brand owners authorized.
CREATE OR REPLACE FUNCTION public.issue_4063_can_manage_door_sale(
  p_event_id uuid,
  p_actor_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_actor_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = p_event_id
       AND (
         public.issue_3827_can_door_scan(p_event_id, p_actor_id)
         OR public.biz_brand_effective_rank(e.brand_id, p_actor_id)
            >= public.biz_role_rank('event_manager')
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4063_can_manage_door_sale(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_can_manage_door_sale(uuid, uuid)
  TO service_role;

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

REVOKE ALL ON FUNCTION public.biz_door_sale_record(
  uuid, uuid, jsonb, text, text, text, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_door_sale_record(
  uuid, uuid, jsonb, text, text, text, text, text, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_door_sale_refund(
  p_order_id uuid,
  p_amount_cents integer,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_refund_id uuid := gen_random_uuid();
  v_new_refunded integer;
  v_status text;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_order FROM public.orders
   WHERE id = p_order_id AND source = 'door_sale'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'door_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4063_can_manage_door_sale(v_order.event_id, v_actor) THEN
    RAISE EXCEPTION 'door_access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_amount_cents > coalesce(v_order.buyer_total_cents, v_order.total_cents)
                           - v_order.refunded_amount_cents THEN
    RAISE EXCEPTION 'door_refund_amount_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 10 AND 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.refunds (
    id, order_id, amount_cents, currency, reason, initiated_by, status,
    processed_at, metadata, created_at
  ) VALUES (
    v_refund_id, p_order_id, p_amount_cents, v_order.currency, btrim(p_reason),
    v_actor, 'succeeded', v_now, jsonb_build_object('source', 'door_sale'), v_now
  );

  v_new_refunded := v_order.refunded_amount_cents + p_amount_cents;
  v_status := CASE
    WHEN v_new_refunded >= coalesce(v_order.buyer_total_cents, v_order.total_cents)
      THEN 'refunded'
    ELSE 'partial_refund'
  END;
  UPDATE public.orders
     SET refunded_amount_cents = v_new_refunded,
         payment_status = v_status,
         updated_at = v_now
   WHERE id = p_order_id;
  UPDATE public.door_sales_ledger
     SET refunded_amount_cents = v_new_refunded
   WHERE order_id = p_order_id;

  -- I-19: door attendance is historical fact. Do not void or rewrite tickets.
  RETURN jsonb_build_object(
    'orderId', p_order_id,
    'refundId', v_refund_id,
    'amountCents', p_amount_cents,
    'refundedAmountCents', v_new_refunded,
    'status', v_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_door_sale_refund(uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_door_sale_refund(uuid, integer, text)
  TO authenticated;

-- Re-emit the provider-fee candidate reader with an explicit non-door-source
-- predicate. Historical provider-backed rows use several source labels, so
-- only the new host-collected door rail is excluded even if a reader later
-- adds a local terminal reference to a door sale.
CREATE OR REPLACE FUNCTION public.list_missing_payout_source_fees(
  p_limit integer DEFAULT 100
) RETURNS TABLE(
  source_type text, source_id uuid, provider text, provider_reference text,
  stripe_account_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT * FROM (
    SELECT 'order'::text AS source_type, o.id AS source_id,
      b.payment_provider AS provider,
      CASE WHEN b.payment_provider = 'paystack' THEN o.stripe_payment_intent_id
           ELSE coalesce(o.stripe_charge_id, o.stripe_payment_intent_id) END
        AS provider_reference,
      CASE WHEN b.payment_provider = 'stripe' THEN b.stripe_connect_id ELSE NULL END
        AS stripe_account_id
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
    WHERE o.payment_status IN ('paid','partial_refund')
      AND o.total_cents > 0
      AND coalesce(o.source, 'online_checkout') <> 'door_sale'
      AND b.payout_hold_cutover_at IS NOT NULL
      AND o.created_at > b.payout_hold_cutover_at
    UNION ALL
    SELECT 'rsvp_contribution', c.id, c.provider,
      CASE WHEN c.provider = 'paystack' THEN c.stripe_payment_intent_id
           ELSE coalesce(c.stripe_charge_id, c.stripe_payment_intent_id) END,
      CASE WHEN c.provider = 'stripe' THEN b.stripe_connect_id ELSE NULL END
    FROM public.event_rsvp_contributions c
    JOIN public.brands b ON b.id = c.brand_id
    WHERE c.status IN ('paid','partially_refunded')
      AND b.payout_hold_cutover_at IS NOT NULL
      AND coalesce(c.paid_at, c.created_at) > b.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_reservation', s.id, b.payment_provider,
      CASE WHEN b.payment_provider = 'paystack' THEN s.paystack_reference
           ELSE s.stripe_payment_intent_id END,
      CASE WHEN b.payment_provider = 'stripe' THEN s.stripe_account_id ELSE NULL END
    FROM public.reservation_checkout_sessions s
    JOIN public.reservations r ON r.id = s.reservation_id
    JOIN public.brands b ON b.id = s.brand_id
    WHERE s.status = 'completed' AND s.amount_cents > 0
      AND b.payout_hold_cutover_at IS NOT NULL
      AND r.created_at > b.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_menu_order', vo.id, vo.provider,
      CASE WHEN vo.provider = 'paystack' THEN vo.paystack_reference
           ELSE coalesce(vo.stripe_charge_id, vo.stripe_payment_intent_id) END,
      CASE WHEN vo.provider = 'stripe' THEN vo.stripe_account_id ELSE NULL END
    FROM public.venue_orders vo
    JOIN public.brands b ON b.id = vo.brand_id
    WHERE vo.money_path = 'mingla'
      AND vo.payment_status IN ('paid','partial_refund')
      AND vo.total_cents > 0
      AND b.payout_hold_cutover_at IS NOT NULL
      AND vo.created_at > b.payout_hold_cutover_at
  ) q
  WHERE q.provider_reference IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_source_fee_snapshots f
       WHERE f.source_type = q.source_type AND f.source_id = q.source_id
    )
  ORDER BY q.source_type, q.source_id
  LIMIT greatest(1, least(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION public.list_missing_payout_source_fees(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_missing_payout_source_fees(integer)
  TO service_role;

-- Door receipts belong in the host's cash/card-reader reconciliation, not in
-- Mingla's provider margin view.
CREATE OR REPLACE VIEW public.issue_3872_order_margin AS
SELECT 'ticket'::text order_kind, o.id order_id, e.brand_id,
  lower(o.currency::text) currency, o.created_at,
  COALESCE(o.list_subtotal_cents,o.net_subtotal_cents,o.total_cents)::bigint list_subtotal_cents,
  COALESCE(o.discount_cents,0)::bigint discount_cents,
  COALESCE(o.buyer_total_cents,o.total_cents)::bigint buyer_total_cents,
  COALESCE(o.stripe_application_fee_amount_cents,0)::bigint application_fee_cents,
  fs.provider_fee_cents::bigint provider_fee_cents,
  (COALESCE(o.stripe_application_fee_amount_cents,0)-COALESCE(fs.provider_fee_cents,0))::bigint mingla_margin_cents,
  COALESCE(o.discount_cents,0)>0 discounted
FROM public.orders o
JOIN public.events e ON e.id=o.event_id
LEFT JOIN public.payout_source_fee_snapshots fs
  ON fs.source_type='order' AND fs.source_id=o.id
WHERE o.payment_status IN ('paid','partial_refund','refunded')
  AND coalesce(o.source,'online_checkout')<>'door_sale'
UNION ALL
SELECT 'venue_order',v.id,v.brand_id,lower(v.currency),v.created_at,
  COALESCE(v.list_subtotal_cents,v.subtotal_cents)::bigint,
  COALESCE(v.discount_cents,0)::bigint,v.total_cents::bigint,
  (COALESCE(v.mingla_fee_cents,0)+COALESCE(v.platform_service_fee_cents,0))::bigint,
  fs.provider_fee_cents::bigint,
  (COALESCE(v.mingla_fee_cents,0)+COALESCE(v.platform_service_fee_cents,0)-COALESCE(fs.provider_fee_cents,0))::bigint,
  COALESCE(v.discount_cents,0)>0
FROM public.venue_orders v
LEFT JOIN public.payout_source_fee_snapshots fs
  ON fs.source_type='venue_menu_order' AND fs.source_id=v.id
WHERE v.payment_status IN ('paid','refunded')
UNION ALL
SELECT 'reservation_deposit',s.id,s.brand_id,lower(s.currency::text),s.created_at,
  COALESCE(s.deposit_list_cents,s.amount_cents)::bigint,
  COALESCE(s.discount_cents,0)::bigint,s.amount_cents::bigint,
  COALESCE(s.application_fee_amount_cents,0)::bigint,NULL::bigint,
  COALESCE(s.application_fee_amount_cents,0)::bigint,
  COALESCE(s.discount_cents,0)>0
FROM public.reservation_checkout_sessions s
WHERE s.status='completed';

REVOKE ALL ON public.issue_3872_order_margin FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.issue_3872_order_margin TO service_role;

COMMENT ON FUNCTION public.biz_door_sale_record(
  uuid, uuid, jsonb, text, text, text, text, text, uuid
) IS '#4063: atomic, idempotent server order for a host-collected door sale; tickets are created already checked in.';
COMMENT ON FUNCTION public.biz_door_sale_refund(uuid, integer, text)
  IS '#4063: records a host-collected door refund without undoing attendance.';

COMMIT;
