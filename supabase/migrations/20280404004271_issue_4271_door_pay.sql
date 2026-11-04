-- Issue #4271 — hosts take card money at the door.
--
--   * Pay code: the host shows a one-time code; the guest pays on their own
--     phone through the normal online checkout. The order stays on the normal
--     checkout source (provider rail, fee, payouts, provider refunds) and is
--     marked door_payment_method = 'pay_code'. Tickets are born used.
--   * Tap to Pay: a Stripe Terminal card_present direct charge on the brand's
--     connected account, recorded as an online_checkout order with
--     door_payment_method = 'tap_to_pay'. Tickets are born used.
--   * Who may take door money (cash and manual included): brand rank
--     event_manager or higher, or an accepted scanner whose invitation turned
--     on canAcceptPayments (fixes the unenforced switch, finding F6).
--   * The brand team screen gets readable names and emails.
--
-- MINGLA-INVARIANT: I-4271-DOOR-CODE-PAYS-ONCE | issue #4271 | a door pay code links at most one paid order; the finalize trigger locks the code row and never re-points a paid code.
-- MINGLA-INVARIANT: I-4271-DOOR-PAYMENT-PERMISSION | issue #4271 | every door money write (cash, manual, pay code, tap) passes issue_4271_can_take_door_payment.
-- MINGLA-INVARIANT: I-4271-DOOR-CARD-ON-RAIL | issue #4271 | pay_code and tap_to_pay orders are never source='door_sale'; cash/manual/card_reader are only ever door_sale.
--
-- Static SQL only (no dynamic EXECUTE). Conflicts raise PT409, never 40001.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- =============================================================================
-- §0. Pre-assert: nobody ever recorded the removed 'nfc' door method.
-- =============================================================================
DO $assert$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE door_payment_method = 'nfc') THEN
    RAISE EXCEPTION 'issue_4271_nfc_rows_exist: orders.door_payment_method';
  END IF;
  IF EXISTS (SELECT 1 FROM public.door_sales_ledger WHERE payment_method = 'nfc') THEN
    RAISE EXCEPTION 'issue_4271_nfc_rows_exist: door_sales_ledger.payment_method';
  END IF;
END
$assert$;

-- =============================================================================
-- §1. door_pay_codes — one code per sale, 10 minutes, pays once.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.door_pay_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id uuid NULL REFERENCES public.event_dates(id) ON DELETE SET NULL,
  code text NOT NULL UNIQUE
    CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  lines jsonb NOT NULL CHECK (
    jsonb_typeof(lines) = 'array'
    AND jsonb_array_length(lines) BETWEEN 1 AND 50
  ),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  fee_cents integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents > 0),
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','opened','paid','expired','cancelled','failed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  checkout_session_id uuid NULL
    REFERENCES public.ticket_checkout_sessions(id) ON DELETE SET NULL,
  order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  failure_reason text NULL CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 200),
  text_link_count integer NOT NULL DEFAULT 0
    CHECK (text_link_count BETWEEN 0 AND 3),
  opened_at timestamptz NULL,
  paid_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT door_pay_codes_paid_shape CHECK (
    (status = 'paid') = (order_id IS NOT NULL AND paid_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS door_pay_codes_event_idx
  ON public.door_pay_codes(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS door_pay_codes_session_idx
  ON public.door_pay_codes(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

ALTER TABLE public.door_pay_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.door_pay_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.door_pay_codes TO authenticated;
GRANT ALL ON public.door_pay_codes TO service_role;

-- =============================================================================
-- §2. Tap to Pay storage: one Terminal Location per brand + country, and the
--     server-priced intent a tap pays (the webhook backstop reads it).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.brand_terminal_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  stripe_account_id text NOT NULL CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_location_id text NOT NULL CHECK (stripe_location_id ~ '^tml_[A-Za-z0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, country_code, stripe_account_id)
);
ALTER TABLE public.brand_terminal_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_terminal_locations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_terminal_locations TO service_role;

CREATE TABLE IF NOT EXISTS public.door_tap_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id uuid NULL REFERENCES public.event_dates(id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  lines jsonb NOT NULL CHECK (
    jsonb_typeof(lines) = 'array'
    AND jsonb_array_length(lines) BETWEEN 1 AND 50
  ),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  fee_cents integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents > 0),
  application_fee_cents integer NOT NULL DEFAULT 0 CHECK (application_fee_cents >= 0),
  stripe_account_id text NOT NULL,
  stripe_location_id text NULL,
  stripe_payment_intent_id text NULL UNIQUE,
  buyer_phone_e164 text NULL CHECK (
    buyer_phone_e164 IS NULL OR buyer_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'
  ),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','recorded','cancelled')),
  order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, client_request_id)
);
ALTER TABLE public.door_tap_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.door_tap_intents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.door_tap_intents TO service_role;

-- =============================================================================
-- §3. orders / sessions / ledger — the door method set without 'nfc', and the
--     card methods allowed on the normal checkout source.
-- =============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS door_pay_code_id uuid NULL
    REFERENCES public.door_pay_codes(id) ON DELETE SET NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_door_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_door_payment_method_check CHECK (
  (source = 'door_sale' AND door_payment_method IN ('cash','card_reader','manual'))
  OR (source <> 'door_sale' AND (
    door_payment_method IS NULL
    OR door_payment_method IN ('pay_code','tap_to_pay')
  ))
);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_door_pay_code_shape_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_door_pay_code_shape_check CHECK (
  door_pay_code_id IS NULL OR door_payment_method = 'pay_code'
);

-- A tapped card at the door does not carry a phone number unless the guest
-- gives one; every other online checkout still must.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_online_checkout_phone_e164_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_online_checkout_phone_e164_check CHECK (
  source <> 'online_checkout'
  OR (door_payment_method = 'tap_to_pay'
      AND (buyer_phone_e164 IS NULL OR buyer_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'))
  OR (buyer_phone_e164 IS NOT NULL AND buyer_phone_e164 ~ '^\+[1-9][0-9]{1,14}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_door_pay_code_uq
  ON public.orders(door_pay_code_id) WHERE door_pay_code_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orders_door_tap_request_uq
  ON public.orders(event_id, door_client_request_id)
  WHERE door_payment_method = 'tap_to_pay';

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS door_pay_code_id uuid NULL
    REFERENCES public.door_pay_codes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ticket_checkout_sessions_door_pay_code_idx
  ON public.ticket_checkout_sessions(door_pay_code_id)
  WHERE door_pay_code_id IS NOT NULL;

ALTER TABLE public.door_sales_ledger
  DROP CONSTRAINT IF EXISTS door_sales_ledger_payment_method_check;
ALTER TABLE public.door_sales_ledger
  ADD CONSTRAINT door_sales_ledger_payment_method_check CHECK (
    payment_method IN ('cash','card_reader','manual','pay_code','tap_to_pay')
  );
CREATE UNIQUE INDEX IF NOT EXISTS door_sales_ledger_card_order_uq
  ON public.door_sales_ledger(order_id)
  WHERE payment_method IN ('pay_code','tap_to_pay') AND order_id IS NOT NULL;

-- =============================================================================
-- §4. Who may take door money.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_4271_can_take_door_payment(
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
       AND e.deleted_at IS NULL
       AND (
         public.biz_brand_effective_rank(e.brand_id, p_actor_id)
           >= public.biz_role_rank('event_manager')
         OR EXISTS (
           SELECT 1
             FROM public.event_scanners es
            WHERE es.event_id = e.id
              AND es.user_id = p_actor_id
              AND es.removed_at IS NULL
              AND coalesce(es.permissions ->> 'canAcceptPayments', 'false') = 'true'
         )
         OR EXISTS (
           SELECT 1
             FROM public.brand_team_members m
            WHERE m.brand_id = e.brand_id
              AND m.user_id = p_actor_id
              AND m.role = 'scanner'
              AND m.removed_at IS NULL
              AND m.accepted_at IS NOT NULL
              AND (
                coalesce(m.permissions_override ->> 'canAcceptPayments', 'false') = 'true'
                OR EXISTS (
                  SELECT 1
                    FROM public.scanner_invitations si
                    JOIN auth.users u ON u.id = p_actor_id
                   WHERE si.brand_id = e.brand_id
                     AND si.scope = 'brand'
                     AND si.status = 'accepted'
                     AND lower(si.email) = lower(u.email)
                     AND coalesce(si.permissions ->> 'canAcceptPayments', 'false') = 'true'
                )
              )
         )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_can_take_door_payment(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_can_take_door_payment(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.biz_can_take_door_payment(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.issue_4271_can_take_door_payment(p_event_id, auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.biz_can_take_door_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_can_take_door_payment(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Door payment takers read door pay codes" ON public.door_pay_codes;
CREATE POLICY "Door payment takers read door pay codes"
  ON public.door_pay_codes FOR SELECT TO authenticated
  USING (public.biz_can_take_door_payment(event_id));

-- Realtime: the host screen turns green when the code is paid.
DO $pub$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = 'door_pay_codes'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.door_pay_codes;
  END IF;
END
$pub$;

-- =============================================================================
-- §5. Server-side quote of door lines (pay code + tap). Same tier, date,
--     sale-window and capacity rules as biz_door_sale_record.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_4271_door_quote_lines(
  p_event_id uuid,
  p_event_date_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_line jsonb;
  v_tier public.ticket_types%ROWTYPE;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_sold integer;
  v_subtotal bigint := 0;
  v_currency text;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_out jsonb := '[]'::jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT e.id, e.brand_id, e.status INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND OR v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'door_event_unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_event_date_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_dates d
     WHERE d.id = p_event_date_id AND d.event_id = p_event_id
       AND d.cancelled_at IS NULL AND d.end_at > v_now
  ) THEN
    RAISE EXCEPTION 'door_event_date_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_ticket_type_id := coalesce(v_line ->> 'ticketTypeId', v_line ->> 'ticket_type_id')::uuid;
      v_quantity := (v_line ->> 'quantity')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END;
    IF v_ticket_type_id IS NULL OR v_ticket_type_id = ANY(v_seen)
       OR v_quantity IS NULL OR v_quantity NOT BETWEEN 1 AND 99 THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_ticket_type_id);

    SELECT * INTO v_tier
      FROM public.ticket_types tt
     WHERE tt.id = v_ticket_type_id
       AND tt.event_id = p_event_id
       AND tt.deleted_at IS NULL
       AND tt.is_disabled = false
       AND tt.is_hidden = false
       AND tt.available_in_person = true;
    IF NOT FOUND
       OR (v_tier.sale_start_at IS NOT NULL AND v_tier.sale_start_at > v_now)
       OR (v_tier.sale_end_at IS NOT NULL AND v_tier.sale_end_at <= v_now) THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END IF;
    IF v_tier.price_cents <= 0 THEN
      -- A free ticket has nothing to pay by card; the host uses Manual.
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END IF;
    IF p_event_date_id IS NOT NULL THEN
      PERFORM public.issue_3281_assert_line_days(
        v_ticket_type_id, NULL, ARRAY[p_event_date_id], 'per_day');
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
      v_currency := upper(btrim(v_tier.currency::text));
    ELSIF v_currency IS DISTINCT FROM upper(btrim(v_tier.currency::text)) THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END IF;
    v_subtotal := v_subtotal + v_tier.price_cents::bigint * v_quantity;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22003';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type_id,
      'name', v_tier.name,
      'quantity', v_quantity,
      'unitCents', v_tier.price_cents
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'brandId', v_event.brand_id,
    'currency', v_currency,
    'subtotalCents', v_subtotal::integer,
    'lines', v_out
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_quote_lines(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_quote_lines(uuid, uuid, jsonb)
  TO service_role;

-- =============================================================================
-- §6. biz_door_sale_record — the #3281 definition, with the payment
--     permission gate (F6) and without the removed 'nfc' method.
-- =============================================================================
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
  -- issue #4271 (F6): taking door money needs the payment permission, not
  -- only door-scan access.
  IF NOT public.issue_4271_can_take_door_payment(p_event_id, v_actor) THEN
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
  IF p_payment_method NOT IN ('cash','card_reader','manual') THEN
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

-- =============================================================================
-- §7. Pay code finalize: when the normal checkout finalize stamps the order on
--     a session that carries a door pay code, the order becomes a door card
--     sale. Locks the code row so a code pays once.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_4271_door_pay_code_finalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code public.door_pay_codes%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
  v_amount bigint;
BEGIN
  SELECT * INTO v_code
    FROM public.door_pay_codes
   WHERE id = NEW.door_pay_code_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_code.status = 'paid' THEN
    -- A second payment for one code (two tabs). The money is taken, so the
    -- order stands as an ordinary online order the host can refund; it is
    -- never pointed at the code and its tickets are not born used.
    IF v_code.order_id IS DISTINCT FROM v_order.id THEN
      UPDATE public.orders
         SET metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object('door_pay_code_duplicate', v_code.id),
             updated_at = v_now
       WHERE id = v_order.id;
      RAISE WARNING 'issue_4271_door_code_paid_twice code=% order=%',
        v_code.id, v_order.id;
    END IF;
    RETURN NEW;
  END IF;

  v_amount := coalesce(NEW.buyer_total_cents, NEW.total_cents::bigint, v_order.total_cents::bigint);

  UPDATE public.orders
     SET door_payment_method = 'pay_code',
         door_pay_code_id = v_code.id,
         is_door_sale = true,
         created_by_scanner_id = coalesce(created_by_scanner_id, v_code.created_by),
         event_date_id = coalesce(event_date_id, v_code.event_date_id),
         updated_at = v_now
   WHERE id = v_order.id;

  -- Tickets are born used: the guest is standing at the door.
  WITH used AS (
    UPDATE public.tickets t
       SET status = 'used',
           used_at = v_now,
           used_by_scanner_id = v_code.created_by
     WHERE t.order_id = v_order.id
       AND t.status = 'valid'
    RETURNING t.id
  )
  INSERT INTO public.scan_events (
    ticket_id, event_id, scanner_user_id, scan_result, client_offline,
    synced_at, metadata, event_date_id
  )
  SELECT used.id, v_order.event_id, v_code.created_by, 'success', false, v_now,
         jsonb_build_object('source', 'door_pay_code', 'doorPayCodeId', v_code.id),
         v_code.event_date_id
    FROM used;

  UPDATE public.door_pay_codes
     SET status = 'paid',
         paid_at = v_now,
         order_id = v_order.id,
         checkout_session_id = NEW.id,
         failure_reason = NULL,
         updated_at = v_now
   WHERE id = v_code.id;

  INSERT INTO public.door_sales_ledger (
    event_id, order_id, scanner_user_id, payment_method, amount_cents,
    currency, notes, created_at
  ) VALUES (
    v_order.event_id, v_order.id, v_code.created_by, 'pay_code',
    least(v_amount, 2147483647)::integer, upper(btrim(coalesce(NEW.currency::text, v_code.currency))),
    NULL, v_now
  ) ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_pay_code_finalize()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tcs_4271_door_pay_code_finalize
  ON public.ticket_checkout_sessions;
CREATE TRIGGER trg_tcs_4271_door_pay_code_finalize
AFTER UPDATE OF order_id ON public.ticket_checkout_sessions
FOR EACH ROW
WHEN (
  NEW.order_id IS NOT NULL
  AND OLD.order_id IS DISTINCT FROM NEW.order_id
  AND NEW.door_pay_code_id IS NOT NULL
)
EXECUTE FUNCTION public.issue_4271_door_pay_code_finalize();

-- Link a fresh checkout session to its code. Refuses a paid, cancelled,
-- failed or expired code with PT409 so the edge function answers 409.
CREATE OR REPLACE FUNCTION public.issue_4271_door_pay_code_link_session(
  p_code_id uuid,
  p_checkout_session_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code public.door_pay_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_code FROM public.door_pay_codes WHERE id = p_code_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'door_code_unavailable:not_found' USING ERRCODE = 'PT409';
  END IF;
  IF v_code.status IN ('open', 'opened') AND v_code.expires_at <= now() THEN
    UPDATE public.door_pay_codes
       SET status = 'expired', updated_at = now()
     WHERE id = p_code_id;
    RETURN 'expired';
  END IF;
  IF v_code.status NOT IN ('open', 'opened') THEN
    RETURN v_code.status;
  END IF;
  UPDATE public.ticket_checkout_sessions
     SET door_pay_code_id = p_code_id, updated_at = now()
   WHERE id = p_checkout_session_id
     AND order_id IS NULL
     AND event_id = v_code.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'door_code_unavailable:session' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.door_pay_codes
     SET checkout_session_id = p_checkout_session_id,
         status = 'opened',
         opened_at = coalesce(opened_at, now()),
         updated_at = now()
   WHERE id = p_code_id;
  RETURN 'linked';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_pay_code_link_session(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_pay_code_link_session(uuid, uuid)
  TO service_role;

-- =============================================================================
-- §8. biz_door_tap_record — records a succeeded Tap to Pay PaymentIntent.
--     Service role only: door-tap-intent verifies the PI with Stripe first, and
--     the stripe-webhook backstop calls it from a verified event.
-- =============================================================================
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
    v_order_id, v_intent.event_id, v_intent.event_date_id, NULL, NULL, NULL,
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
        v_ticket_id, v_order_id, v_ticket_type_id, v_intent.event_id, NULL, NULL,
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

-- =============================================================================
-- §9. Pay link by text message.
-- =============================================================================
INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES (
  'buyer_door_pay_link', 'Purchases', true, 'high',
  ARRAY['sms'], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

-- One step that both counts and refuses: at most three texts per code.
CREATE OR REPLACE FUNCTION public.issue_4271_door_pay_code_text_link(
  p_code_id uuid,
  p_phone_e164 text,
  p_pay_url text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code public.door_pay_codes%ROWTYPE;
  v_title text;
BEGIN
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_code FROM public.door_pay_codes WHERE id = p_code_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_code.status NOT IN ('open', 'opened') OR v_code.expires_at <= now() THEN
    RAISE EXCEPTION 'door_code_unavailable' USING ERRCODE = 'PT409';
  END IF;
  IF v_code.text_link_count >= 3 THEN
    RAISE EXCEPTION 'text_link_limit_reached' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.door_pay_codes
     SET text_link_count = text_link_count + 1, updated_at = now()
   WHERE id = p_code_id;
  SELECT coalesce(nullif(btrim(e.title), ''), 'your event') INTO v_title
    FROM public.events e WHERE e.id = v_code.event_id;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key,
    country_code, status
  ) VALUES (
    'buyer_door_pay_link', NULL, p_phone_e164, v_code.brand_id,
    jsonb_build_object(
      'event_id', v_code.event_id,
      'door_pay_code_id', v_code.id,
      'event_title', v_title,
      'pay_url', p_pay_url,
      'channel_hint', 'sms'
    ),
    'buyer_door_pay_link:' || v_code.id::text || ':' || (v_code.text_link_count + 1)::text,
    public.mingla_e164_country(p_phone_e164), 'pending'
  );
  RETURN jsonb_build_object('sent', true, 'count', v_code.text_link_count + 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_pay_code_text_link(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_pay_code_text_link(uuid, text, text)
  TO service_role;

-- =============================================================================
-- §10. Brand team names for the team screen.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.biz_brand_team_members(p_brand_id uuid)
RETURNS TABLE (
  member_id uuid,
  user_id uuid,
  role text,
  display_name text,
  email text,
  avatar_url text,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, auth.uid()) <= 0 THEN
    RAISE EXCEPTION 'brand_access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id,
         m.user_id,
         m.role,
         coalesce(
           nullif(btrim(ca.display_name), ''),
           nullif(btrim(p.display_name), ''),
           nullif(btrim(concat_ws(' ', nullif(btrim(p.first_name), ''),
                                       nullif(btrim(p.last_name), ''))), '')
         )::text,
         coalesce(
           nullif(btrim(ca.email), ''),
           nullif(btrim(p.email), ''),
           nullif(btrim(u.email::text), '')
         )::text,
         coalesce(nullif(btrim(ca.avatar_url), ''), nullif(btrim(p.avatar_url), ''))::text,
         m.accepted_at
    FROM public.brand_team_members m
    LEFT JOIN public.creator_accounts ca ON ca.id = m.user_id AND ca.deleted_at IS NULL
    LEFT JOIN public.profiles p ON p.id = m.user_id
    LEFT JOIN auth.users u ON u.id = m.user_id
   WHERE m.brand_id = p_brand_id
     AND m.accepted_at IS NOT NULL
     AND m.removed_at IS NULL
   ORDER BY m.accepted_at, m.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_brand_team_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_brand_team_members(uuid)
  TO authenticated, service_role;

COMMENT ON TABLE public.door_pay_codes IS
  '#4271: a one-time pay link for one door sale; 10 minutes, pays once, never a ticket credential.';
COMMENT ON FUNCTION public.biz_door_tap_record(text, text, integer, text, text) IS
  '#4271: records a Stripe-verified Tap to Pay sale as an online_checkout order; tickets are born used.';
COMMENT ON FUNCTION public.biz_brand_team_members(uuid) IS
  '#4271: accepted brand members with readable names and emails, for any accepted member of the brand.';

COMMIT;
