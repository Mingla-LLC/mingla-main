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
  -- The door_sale arm of orders_door_payment_method_check now requires a
  -- method (production read 2026-11-04: zero door_sale rows without one).
  IF EXISTS (
    SELECT 1 FROM public.orders
     WHERE source = 'door_sale' AND door_payment_method IS NULL
  ) THEN
    RAISE EXCEPTION 'issue_4271_door_sale_without_method_exists';
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
  (source = 'door_sale' AND door_payment_method IS NOT NULL
     AND door_payment_method IN ('cash','card_reader','manual'))
  OR (source <> 'door_sale' AND (
    door_payment_method IS NULL
    OR door_payment_method IN ('pay_code','tap_to_pay')
  ))
);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_door_pay_code_shape_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_door_pay_code_shape_check CHECK (
  door_pay_code_id IS NULL OR door_payment_method IS NOT DISTINCT FROM 'pay_code'
);

-- A tapped card at the door does not carry a phone number unless the guest
-- gives one; every other online checkout still must. IS NOT DISTINCT FROM:
-- an ordinary order has door_payment_method NULL, and `NULL = 'tap_to_pay'`
-- would make this whole CHECK NULL, which Postgres treats as passing.
--
-- Every condition in this migration that compares door_payment_method is
-- NULL-safe: the door_sale arm requires IS NOT NULL, the pay code shape uses
-- IS NOT DISTINCT FROM, and the partial indexes only ever match a non-NULL.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_online_checkout_phone_e164_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_online_checkout_phone_e164_check CHECK (
  source <> 'online_checkout'
  OR (door_payment_method IS NOT DISTINCT FROM 'tap_to_pay'
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
--
--     A code that stops being payable (cancelled, expired, paid by another
--     session) closes every checkout session it opened, through the same
--     revocation rail an event closing uses (#1930): the session is revoked,
--     the checkout-sale-revocation worker expires the provider's page, and a
--     payment that still lands is refused at finalize and refunded in full by
--     the late-payment refund (issue_1930_mint_ticket_late_reversal ->
--     source_refunds 'late_payment_no_value' -> source-refund-sweep).
--
--     Lock order everywhere in this file: checkout sessions (by id), then the
--     code row. Finalize holds its session before this trigger takes the code.
-- =============================================================================

-- True for a door order of any kind: cash/manual/card_reader door sales and
-- the two card door methods. NULL-safe: an ordinary order is false, never NULL.
CREATE OR REPLACE FUNCTION public.issue_4271_is_door_order(
  p_source text,
  p_door_payment_method text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce(p_source = 'door_sale', false)
      OR coalesce(p_door_payment_method IN ('pay_code', 'tap_to_pay'), false);
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_is_door_order(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_is_door_order(text, text)
  TO service_role;

-- Revokes every still-open checkout session a code opened (except one), the
-- same shape as issue_1930_revoke_event_checkout_admissions. Returns the
-- Stripe Checkout pages to expire now (the worker expires them too, with the
-- same idempotency key, if this answer is lost).
CREATE OR REPLACE FUNCTION public.issue_4271_door_revoke_code_sessions(
  p_code_id uuid,
  p_reason text,
  p_except_session_id uuid,
  p_skip_locked boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row record;
  v_expire jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'door_code_closed'), 80);
BEGIN
  FOR v_row IN
    SELECT s.id, s.event_id, s.provider_attempt_id, s.admission_epoch,
           s.stripe_account_id
      FROM public.ticket_checkout_sessions s
     WHERE s.door_pay_code_id = p_code_id
       AND s.id IS DISTINCT FROM p_except_session_id
       AND s.order_id IS NULL
       AND s.revoked_at IS NULL
       AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
     ORDER BY s.id
  LOOP
    -- The caller already holds these rows (cancel / link lock sessions first);
    -- the finalize trigger skips a row another writer holds, because that
    -- writer is closing it anyway.
    IF p_skip_locked THEN
      PERFORM 1 FROM public.ticket_checkout_sessions
        WHERE id = v_row.id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;
    UPDATE public.ticket_checkout_sessions
       SET revoked_at = now(),
           revoked_reason = v_reason,
           reversal_state = CASE WHEN reversal_state = 'none'
             THEN 'neutralization_pending' ELSE reversal_state END,
           status = 'failed',
           failed_at = coalesce(failed_at, now()),
           updated_at = now(),
           idempotency_key = idempotency_key || ':revoked:' || id::text
     WHERE id = v_row.id
       AND order_id IS NULL
       AND revoked_at IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    INSERT INTO public.checkout_sale_revocation_outbox (
      subject_type, subject_id, event_id, provider_attempt_id, target_epoch, reason
    )
    SELECT 'ticket_checkout_session', v_row.id, v_row.event_id, v_row.provider_attempt_id,
           coalesce(a.claimed_epoch, v_row.admission_epoch, 1), v_reason
      FROM (SELECT 1) one
      LEFT JOIN public.ticket_checkout_provider_attempts a ON a.id = v_row.provider_attempt_id
    ON CONFLICT (subject_type, subject_id, target_epoch) DO NOTHING;
    UPDATE public.ticket_checkout_provider_attempts
       SET state = 'neutralization_pending', updated_at = now()
     WHERE id = v_row.provider_attempt_id
       AND state IN ('claimed', 'provider_unknown', 'ready');
    v_item := NULL;
    SELECT jsonb_build_object(
             'checkoutSessionId', a.provider_checkout_id,
             'stripeAccountId', v_row.stripe_account_id,
             'idempotencyKey', a.provider_idempotency_key || ':expire')
      INTO v_item
      FROM public.ticket_checkout_provider_attempts a
     WHERE a.id = v_row.provider_attempt_id
       AND a.provider = 'stripe'
       AND a.flow = 'stripe_checkout'
       AND a.provider_checkout_id IS NOT NULL
       AND v_row.stripe_account_id IS NOT NULL;
    IF v_item IS NOT NULL THEN
      v_expire := v_expire || jsonb_build_array(v_item);
    END IF;
  END LOOP;
  RETURN v_expire;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_revoke_code_sessions(uuid, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_revoke_code_sessions(uuid, text, uuid, boolean)
  TO service_role;

-- Cancel or expire a code and close every checkout it opened. A paid code is
-- never closed. Returns {status, stripeExpire}: status is the code's status
-- after the call ('cancelled', 'expired' or 'paid'; 'not_found').
CREATE OR REPLACE FUNCTION public.issue_4271_door_pay_code_revoke(
  p_code_id uuid,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code public.door_pay_codes%ROWTYPE;
  v_expire jsonb := '[]'::jsonb;
BEGIN
  IF p_status NOT IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  -- Sessions first, then the code (the finalize order).
  PERFORM 1 FROM public.ticket_checkout_sessions
    WHERE door_pay_code_id = p_code_id ORDER BY id FOR UPDATE;
  SELECT * INTO v_code FROM public.door_pay_codes WHERE id = p_code_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'stripeExpire', '[]'::jsonb);
  END IF;
  IF v_code.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'paid', 'stripeExpire', '[]'::jsonb);
  END IF;
  IF p_status = 'cancelled' AND v_code.status <> 'cancelled' THEN
    UPDATE public.door_pay_codes
       SET status = 'cancelled', updated_at = now()
     WHERE id = p_code_id;
    v_code.status := 'cancelled';
  ELSIF p_status = 'expired' AND v_code.status IN ('open', 'opened') THEN
    UPDATE public.door_pay_codes
       SET status = 'expired', updated_at = now()
     WHERE id = p_code_id;
    v_code.status := 'expired';
  END IF;
  -- Whatever the code's end state, nothing it opened stays payable.
  v_expire := public.issue_4271_door_revoke_code_sessions(
    p_code_id, 'door_code_' || v_code.status, NULL, false);
  RETURN jsonb_build_object('status', v_code.status, 'stripeExpire', v_expire);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_pay_code_revoke(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_pay_code_revoke(uuid, text)
  TO service_role;

-- A door checkout session may be paid only while its code is open/opened.
-- Time alone does not close a code mid-payment: the provider page lives at
-- least 30 minutes (Stripe's floor), so a code is closed only by a write that
-- also revokes its sessions (cancel, expire, a new code, another payment).
CREATE OR REPLACE FUNCTION public.issue_4271_door_session_payable(
  p_session_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.ticket_checkout_sessions s
      JOIN public.door_pay_codes c ON c.id = s.door_pay_code_id
     WHERE s.id = p_session_id
       AND c.event_id = s.event_id
       AND c.status IN ('open', 'opened')
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_session_payable(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_session_payable(uuid)
  TO service_role;

-- The door rule for a tier inside a code's checkout: the tier is one of the
-- code's own lines and is sold in person. Used only where the online rule
-- would refuse a tier that is not sold online; every other rule (hidden,
-- disabled, sale window, capacity) still applies to a door checkout.
CREATE OR REPLACE FUNCTION public.issue_4271_door_code_allows_tier(
  p_code_id uuid,
  p_ticket_type_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_code_id IS NOT NULL AND p_ticket_type_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.door_pay_codes c
      JOIN public.ticket_types tt ON tt.id = p_ticket_type_id AND tt.event_id = c.event_id
     WHERE c.id = p_code_id
       AND tt.available_in_person = true
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(c.lines) l
          WHERE l ->> 'ticketTypeId' = p_ticket_type_id::text
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_code_allows_tier(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_code_allows_tier(uuid, uuid)
  TO service_role;

-- The checkout quote and create-session read the door code through this
-- transaction-local setting, set only by the two door wrappers below (the
-- #3827 private-link pattern). A code that is not open/opened unlocks nothing.
CREATE OR REPLACE FUNCTION public.issue_4271_door_code_unlocks_tier(
  p_ticket_type_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_setting text := current_setting('mingla.door_pay_code_id', true);
  v_code_id uuid;
BEGIN
  IF v_setting IS NULL OR v_setting = '' THEN RETURN false; END IF;
  BEGIN
    v_code_id := v_setting::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  RETURN EXISTS (
    SELECT 1 FROM public.door_pay_codes c
     WHERE c.id = v_code_id AND c.status IN ('open', 'opened')
  ) AND public.issue_4271_door_code_allows_tier(v_code_id, p_ticket_type_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_code_unlocks_tier(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_code_unlocks_tier(uuid)
  TO service_role;

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

  IF v_code.status NOT IN ('open', 'opened') THEN
    -- A late payment: the code was cancelled, expired or already paid by
    -- another session. The checkout finalize refuses these sessions (they are
    -- revoked when the code closes, and issue_1930_ticket_session_authorized
    -- asks issue_4271_door_session_payable), so the guest's money goes to the
    -- automatic late-payment refund and no order is made. This branch is the
    -- backstop for any writer that stamps an order without that finalize: the
    -- order stands as an ordinary online order the host can refund, flagged,
    -- and is never pointed at the code, never burned and never a door sale.
    IF v_code.order_id IS DISTINCT FROM v_order.id THEN
      UPDATE public.orders
         SET metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'door_pay_code_late', true,
                    'door_pay_code_late_code_id', v_code.id,
                    'door_pay_code_late_status', v_code.status),
             updated_at = v_now
       WHERE id = v_order.id;
      RAISE WARNING 'issue_4271_door_code_late_payment code=% status=% order=%',
        v_code.id, v_code.status, v_order.id;
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

  -- Paid once: any other tab the guest opened stops being payable.
  PERFORM public.issue_4271_door_revoke_code_sessions(
    v_code.id, 'door_code_paid', NEW.id, true);

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
-- failed or expired code with its status so the edge function answers 409;
-- a code found past its time is expired (and its sessions closed) here.
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
  -- Sessions first, then the code (the finalize order).
  PERFORM 1 FROM public.ticket_checkout_sessions
    WHERE id = p_checkout_session_id OR door_pay_code_id = p_code_id
    ORDER BY id FOR UPDATE;
  SELECT * INTO v_code FROM public.door_pay_codes WHERE id = p_code_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'door_code_unavailable:not_found' USING ERRCODE = 'PT409';
  END IF;
  IF v_code.status IN ('open', 'opened') AND v_code.expires_at <= now() THEN
    PERFORM public.issue_4271_door_pay_code_revoke(p_code_id, 'expired');
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

-- What a host sees on a closed code: did a late payment come in, and was it
-- refunded? NULL when nothing was charged.
CREATE OR REPLACE FUNCTION public.biz_door_pay_code_late_payment(p_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event_id uuid;
  v_result jsonb;
BEGIN
  SELECT event_id INTO v_event_id FROM public.door_pay_codes WHERE id = p_code_id;
  IF v_event_id IS NULL OR NOT public.biz_can_take_door_payment(v_event_id) THEN
    RAISE EXCEPTION 'door_access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
           'state', CASE
             WHEN bool_and(r.buyer_state = 'processed') THEN 'refunded'
             ELSE 'refunding' END,
           'amountCents', sum(r.buyer_refund_requested_cents),
           'currency', max(r.currency))
    INTO v_result
    FROM public.ticket_checkout_sessions s
    JOIN public.source_refunds r
      ON r.source_type = 'ticket_checkout_session'
     AND r.source_id = s.id
     AND r.refund_kind = 'late_payment_no_value'
   WHERE s.door_pay_code_id = p_code_id
  HAVING count(*) > 0;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_door_pay_code_late_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_door_pay_code_late_payment(uuid)
  TO authenticated, service_role;

-- =============================================================================
-- §7b. The guest's checkout prices a door code's lines by the door rule.
--      A tier sold in person but not online can be paid through its own pay
--      code and nowhere else: the online rule is untouched for every other
--      checkout. The quote and create-session run inside these wrappers,
--      which set mingla.door_pay_code_id for the one transaction.
-- =============================================================================

-- issue_3872_ticket_line_price from 20280228003281_issue_3281_day_limited_tickets.sql
-- (its newest definition), with ONE change: `NOT v_tt.available_online` is
-- refused unless this transaction's door code unlocks the tier.
CREATE OR REPLACE FUNCTION public.issue_3872_ticket_line_price(
  p_event_id uuid,p_ticket_type_id uuid,p_qty_raw integer,p_ctx jsonb,
  p_expires_at timestamptz,p_booked_party_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE v_event record; v_tt record; v_qty integer; v_unit bigint; v_admits integer:=1;
  v_basis text; v_blocks integer; v_day_count integer; v_mode text; v_value_scale integer:=1; v_count_scale integer:=1;
  v_start timestamptz; v_end timestamptz;
BEGIN
  IF COALESCE(p_qty_raw,0)<=0 THEN RAISE EXCEPTION 'ticket_quantity_invalid'; END IF;
  SELECT e.event_type,e.discounts_allowed INTO v_event FROM public.events e
    WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  SELECT * INTO v_tt FROM public.ticket_types t
    WHERE t.id=p_ticket_type_id AND t.event_id=p_event_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_type_not_found'; END IF;
  IF (v_tt.is_hidden AND NOT public.issue_3827_link_unlocks_tier(v_tt.id))
     OR v_tt.is_disabled
     -- issue #4271 — a door-only tier is paid only through its own pay code.
     OR (NOT v_tt.available_online AND NOT public.issue_4271_door_code_unlocks_tier(v_tt.id)) THEN RAISE EXCEPTION 'ticket_type_unavailable'; END IF;
  IF v_tt.sale_start_at IS NOT NULL AND v_tt.sale_start_at>now() AND NOT (
    p_expires_at='infinity'::timestamptz AND EXISTS(SELECT 1 FROM public.ticket_queue_arming a
      WHERE a.ticket_type_id=v_tt.id AND a.disarmed_at IS NULL)) THEN
    RAISE EXCEPTION 'ticket_sales_not_started';
  END IF;
  IF v_tt.sale_end_at IS NOT NULL AND v_tt.sale_end_at<=now() THEN RAISE EXCEPTION 'ticket_sales_ended'; END IF;
  IF p_qty_raw<v_tt.min_purchase_qty THEN RAISE EXCEPTION 'ticket_quantity_below_min'; END IF;
  -- A by-date line over several dates arrives as its total with no day
  -- multiplier, a shape no uniform cart has. create-session checks each date.
  IF v_tt.max_purchase_qty IS NOT NULL AND p_qty_raw>v_tt.max_purchase_qty
     AND NOT (COALESCE(p_ctx->>'pricingMode','per_day')='per_day'
       AND COALESCE((p_ctx->>'dayCount')::integer,0)>1
       AND COALESCE((p_ctx->>'dayMultiplier')::integer,1)=1) THEN
    RAISE EXCEPTION 'ticket_quantity_above_max';
  END IF;

  v_day_count:=COALESCE((p_ctx->>'dayCount')::integer,0);
  -- issue #3281 — an all_days pass counts only the dates it admits.
  IF v_tt.valid_occurrence_keys IS NOT NULL THEN
    v_day_count:=COALESCE(cardinality(public.issue_3281_days_in_scope(v_tt.id,ARRAY(
      SELECT value::uuid FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_ctx->'dayIds')='array' THEN p_ctx->'dayIds' ELSE '[]'::jsonb END)
    ))),0);
  END IF;
  v_mode:=COALESCE(p_ctx->>'pricingMode','per_day');
  v_qty:=p_qty_raw*COALESCE((p_ctx->>'dayMultiplier')::integer,1);
  v_unit:=v_tt.price_cents; v_basis:=COALESCE(v_tt.price_basis,'person');
  v_start:=NULLIF(p_ctx->>'bookedStart','')::timestamptz; v_end:=NULLIF(p_ctx->>'bookedEnd','')::timestamptz;
  IF v_event.event_type='experience' AND v_basis='group' THEN
    IF p_booked_party_size IS NULL OR p_booked_party_size<1 OR v_tt.group_max IS NULL
       OR p_booked_party_size>v_tt.group_max THEN RAISE EXCEPTION 'booked_party_invalid'; END IF;
    v_admits:=v_tt.group_max;
  ELSIF v_event.event_type='experience' AND v_basis='block' THEN
    IF v_start IS NULL OR v_end IS NULL OR v_tt.block_minutes IS NULL OR v_end<=v_start THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_blocks:=(extract(epoch FROM (v_end-v_start))/(v_tt.block_minutes::numeric*60.0))::integer;
    IF v_blocks<COALESCE(v_tt.min_blocks,1) OR v_blocks>COALESCE(v_tt.max_blocks,v_blocks) THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_unit:=v_tt.price_cents*v_blocks; v_value_scale:=v_blocks; v_count_scale:=v_blocks;
  ELSIF v_mode='all_days' AND v_day_count>0 THEN v_count_scale:=v_day_count;
  END IF;
  RETURN jsonb_build_object('ticketTypeId',v_tt.id,'ticketName',v_tt.name,
    'rawQuantity',p_qty_raw,'quantity',v_qty,'unitPriceCents',v_unit,'totalCents',v_unit*v_qty,
    'admitsCount',v_admits,'priceBasis',v_basis,'blocks',v_blocks,'currency',v_tt.currency,
    'isFree',COALESCE(v_tt.is_free,false) OR COALESCE(v_tt.price_cents,0)=0,
    'discountsAllowed',COALESCE(v_event.discounts_allowed,true) AND COALESCE(v_tt.discounts_allowed,true),
    'valueScale',v_value_scale,'countScale',v_count_scale);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_ticket_line_price(uuid,uuid,integer,jsonb,timestamptz,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_ticket_line_price(uuid,uuid,integer,jsonb,timestamptz,integer)
  TO service_role;

-- issue_1930_ticket_session_authorized from 20280313003281_issue_3281_extras_checkout.sql
-- (its newest definition), with TWO changes: a door code's session is payable
-- only while its code is (issue_4271_door_session_payable), and a tier not
-- sold online passes only inside its own code's session.
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  v_per_occurrence := COALESCE(
    (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean, false);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  -- issue #4271 — a pay code's checkout is payable only while its code is.
  IF v_session.door_pay_code_id IS NOT NULL
     AND NOT public.issue_4271_door_session_payable(p_session_id) THEN
    RETURN false;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      -- issue #4271 — a door-only tier passes only inside its own code's session.
      OR (NOT tt.available_online
        AND NOT public.issue_4271_door_code_allows_tier(v_session.door_pay_code_id, tt.id))
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      -- issue #3313 — a recurring event's capacity is PER NIGHT, so the
      -- finalize-time re-check measures each of this session's nights (every
      -- upcoming night when it has none): everyone else's sold + held places
      -- that night, plus this session's own places that night. The shared
      -- whole-run check below stays for every other event. DELETE THIS and a
      -- second night's buyer is authorised at reserve and refused at finalize.
      -- issue #3281 — a day-limited ticket is measured per date, on its dates.
      OR ((v_per_occurrence OR tt.valid_occurrence_keys IS NOT NULL)
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.event_dates night
           WHERE night.event_id = p_event_id
             AND (tt.valid_occurrence_keys IS NULL
               OR night.occurrence_key = ANY (tt.valid_occurrence_keys))
             AND (
               EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                        WHERE sd.checkout_session_id = p_session_id AND sd.event_date_id = night.id)
               OR (NOT EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id)
                   AND night.end_at > now())
             )
             AND public.issue_3313_ticket_type_occurrence_taken(tt.id, night.id, p_session_id)
                 + CASE
                     WHEN jsonb_typeof(i.by_date) = 'object'
                       THEN COALESCE((i.by_date ->> night.id::text)::integer, 0)
                     WHEN COALESCE(v_session.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
                          AND (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id) > 0
                       THEN i.quantity / (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                           WHERE sd.checkout_session_id = p_session_id)
                     ELSE i.quantity
                   END
                 > tt.quantity_total
        ))
      OR (NOT v_per_occurrence AND tt.valid_occurrence_keys IS NULL
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  -- issue #3281 — every extra this session holds is still on sale and still
  -- fits, measured per date for a date-limited extra.
  IF EXISTS (
    SELECT 1 FROM public.ticket_checkout_session_add_on_items x
      LEFT JOIN public.ticket_add_ons a ON a.id = x.ticket_add_on_id
     WHERE x.checkout_session_id = p_session_id
       AND (a.id IS NULL OR NOT a.is_active
         OR (NOT a.is_unlimited AND (
           (a.valid_occurrence_keys IS NULL
             AND public.issue_3281_add_on_taken(a.id, NULL, p_session_id) + x.quantity > a.quantity_total)
           OR (a.valid_occurrence_keys IS NOT NULL AND EXISTS (
             SELECT 1 FROM unnest(x.day_scope) AS k
              WHERE public.issue_3281_add_on_taken(a.id, k, p_session_id) + x.quantity > a.quantity_total))
         )))
  ) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_session_authorized(uuid,uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4271_door_assert_code(
  p_door_pay_code_id uuid,
  p_event_id uuid,
  p_lines jsonb
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code public.door_pay_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_code FROM public.door_pay_codes WHERE id = p_door_pay_code_id;
  IF NOT FOUND OR v_code.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'door_code_unavailable:not_found' USING ERRCODE = 'PT409';
  END IF;
  IF v_code.status NOT IN ('open', 'opened') THEN
    RAISE EXCEPTION 'door_code_unavailable:%', v_code.status USING ERRCODE = 'PT409';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) l
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_code.lines) c
        WHERE c ->> 'ticketTypeId' = l ->> 'ticketTypeId'
          AND c ->> 'quantity' = l ->> 'quantity')
  ) THEN
    RAISE EXCEPTION 'door_code_unavailable:lines' USING ERRCODE = 'PT409';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_assert_code(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_assert_code(uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4271_door_ticket_quote(
  p_door_pay_code_id uuid,
  p_event_id uuid,
  p_lines jsonb,
  p_event_date_ids uuid[],
  p_booked_start_at timestamptz,
  p_booked_end_at timestamptz,
  p_booked_party_size integer,
  p_payment_plan_choice text,
  p_discount_code text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_buyer_user_id uuid,
  p_queued boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.issue_4271_door_assert_code(p_door_pay_code_id, p_event_id, p_lines);
  PERFORM set_config('mingla.door_pay_code_id', p_door_pay_code_id::text, true);
  v_result := public.issue_3872_ticket_quote(
    p_event_id, p_lines, p_event_date_ids, p_booked_start_at, p_booked_end_at,
    p_booked_party_size, p_payment_plan_choice, p_discount_code, p_buyer_email,
    p_buyer_phone_e164, p_buyer_user_id, NULL, p_queued);
  PERFORM set_config('mingla.door_pay_code_id', '', true);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_ticket_quote(
  uuid, uuid, jsonb, uuid[], timestamptz, timestamptz, integer, text, text, text, text, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_ticket_quote(
  uuid, uuid, jsonb, uuid[], timestamptz, timestamptz, integer, text, text, text, text, uuid, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4271_door_checkout_create_session(
  p_door_pay_code_id uuid,
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto',
  p_event_date_ids uuid[] DEFAULT NULL,
  p_booked_start_at timestamptz DEFAULT NULL,
  p_booked_end_at timestamptz DEFAULT NULL,
  p_booked_party_size integer DEFAULT NULL,
  p_discount_code text DEFAULT NULL,
  p_expected_quote_digest text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.issue_4271_door_assert_code(p_door_pay_code_id, p_event_id, p_lines);
  PERFORM set_config('mingla.door_pay_code_id', p_door_pay_code_id::text, true);
  v_result := public.biz_ticket_checkout_create_session(
    p_event_id, p_buyer_user_id, p_buyer_name, p_buyer_email,
    p_buyer_phone_e164, p_marketing_opt_in, p_lines, p_idempotency_key,
    p_expires_at, p_application_fee_amount_cents, p_payment_plan_choice,
    p_event_date_ids, p_booked_start_at, p_booked_end_at, p_booked_party_size,
    p_discount_code, p_expected_quote_digest
  );
  PERFORM set_config('mingla.door_pay_code_id', '', true);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4271_door_checkout_create_session(
  uuid,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_door_checkout_create_session(
  uuid,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text
) TO service_role;

-- =============================================================================
-- §7c. A paid card door order is claimable in Explorer exactly like a cash
--      door sale: its tickets are born used, so the "valid ticket on a
--      scheduled event" rule never matched it. Door orders (cash, manual,
--      card reader, pay code, Tap to Pay) are claimable on a scheduled, live
--      or ended event for 30 days. Every other order kind is unchanged.
-- =============================================================================

-- claim_attendance_by_verified_identity from 20271218014063_issue_4063_claim_core.sql
-- (its newest definition), with the door_sale test widened to
-- issue_4271_is_door_order(source, door_payment_method) in the window, the
-- noun and the source label.
CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_row record;
  v_claimed jsonb := '[]'::jsonb;
  v_conv uuid;
  v_more boolean := false;
  v_pass_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'claimed', v_claimed, 'count', 0, 'more', false
    );
  END IF;

  -- Orders, including used door receipts on recently ended events.
  v_pass_count := 0;
  FOR v_row IN
    SELECT o.id, o.event_id, o.source, o.door_payment_method, e.event_type, e.title,
           coalesce(o.booked_start_at, chosen.start_at, master.start_at) AS starts_at,
           coalesce(chosen.timezone, master.timezone, e.timezone) AS timezone,
           (SELECT count(*)::integer FROM public.tickets t
             WHERE t.order_id = o.id AND t.status IN ('valid', 'used')) AS quantity
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE o.buyer_user_id IS NULL
       AND o.attendance_identity_claim_armed_at IS NOT NULL
       AND (lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, o.buyer_email, o.buyer_phone_e164
       )
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (
         (public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live', 'ended')
           AND o.created_at >= now() - interval '30 days')
         OR
         (NOT public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live')
           AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((e.status = 'scheduled' AND t.status = 'valid')
                  OR (e.status = 'live' AND t.status IN ('valid', 'used')))
           ))
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders o
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_generation = NULL,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL,
           attendance_claim_token_consumed_at = CASE
             WHEN o.attendance_claim_token_created_at IS NOT NULL
               THEN coalesce(o.attendance_claim_token_consumed_at, now())
             ELSE o.attendance_claim_token_consumed_at END
     WHERE o.id = v_row.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;

    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', resolved_via = 'verified_identity',
           reconciled_at = now(), updated_at = now()
     WHERE order_id = v_row.id;
    UPDATE public.attendance_claim_deliveries
       SET status = 'failed_terminal', next_attempt_at = NULL,
           lease_id = NULL, lease_expires_at = NULL,
           provider_attempt_started_at = NULL,
           last_error_code = 'claim_resolved', updated_at = now()
     WHERE source_id = v_row.id
       AND kind IN ('order_recovery_email', 'order_recovery_sms')
       AND status IN ('pending', 'processing', 'failed_retryable');
    PERFORM public.add_buyer_to_event_chat(
      v_row.event_id, p_user_id, v_row.id, NULL
    );
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_row.id AND claimed_at IS NULL;

    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE c.event_id = v_row.event_id
       AND c.linked_entity_type IN ('trip', 'event')
     LIMIT 1;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'id', v_row.id,
      'orderId', v_row.id, 'eventId', v_row.event_id,
      'routeKind', 'order', 'routeId', v_row.id,
      'offeringType', v_row.event_type,
      'noun', CASE
        WHEN public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'receipt'
        WHEN v_row.event_type = 'event' THEN 'ticket'
        ELSE 'booking' END,
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.starts_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', CASE
        WHEN v_row.source = 'comp'
          OR public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'door'
        ELSE 'purchase' END,
      'sentByFirstName', NULL,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Anonymous RSVP primaries.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.event_id, e.title, 1 + coalesce(r.plus_count, 0) AS quantity,
           master.start_at, coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE r.user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone
       )
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going'
       AND r.approval_status <> 'denied'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps x
          WHERE x.event_id = r.event_id AND x.user_id = p_user_id
       )
     ORDER BY r.created_at, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.event_rsvps
       SET user_id = p_user_id
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- RSVP plus-ones that did not have an account at RSVP time.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.rsvp_id, r.event_id, e.title, master.start_at,
           coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE g.matched_user_id IS NULL
       AND (lower(btrim(g.email)) = ANY(v_emails) OR g.phone = ANY(v_phones))
       AND public.account_owns_contact(p_user_id, g.email, g.phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going' AND r.approval_status <> 'denied'
       AND r.user_id IS DISTINCT FROM p_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps owned
          WHERE owned.event_id = r.event_id AND owned.user_id = p_user_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_rsvp_guests other
           JOIN public.event_rsvps other_rsvp ON other_rsvp.id = other.rsvp_id
          WHERE other_rsvp.event_id = r.event_id
            AND other.matched_user_id = p_user_id
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.event_rsvp_guests
       SET matched_user_id = p_user_id
     WHERE id = v_row.id AND matched_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp_guest', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.rsvp_id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', 1,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Venue reservations.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.venue_id, r.reserved_for, r.party_size,
           vl.name AS title,
           CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
             ELSE vac.iana_timezone END AS timezone
      FROM public.reservations r
      LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
      LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
     WHERE r.consumer_user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone_e164
       )
       AND r.reserved_for >= now() - interval '30 days'
     ORDER BY r.reserved_for, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.reservations
       SET consumer_user_id = p_user_id
     WHERE id = v_row.id AND consumer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'reservation', 'id', v_row.id,
      'routeKind', 'reservation', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Reservation'), 'orderLabel', NULL,
      'startsAt', v_row.reserved_for, 'timezone', v_row.timezone,
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Stay groups. These tables are intentionally small; the contact prefilter
  -- is still present so a future volume increase cannot turn this into a scan.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.venue_id, vl.name AS title
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
     WHERE g.user_id IS NULL
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)
         OR g.guest_snapshot->>'phone' = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone'
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_reservation_groups
       SET user_id = p_user_id, updated_at = now()
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'stay_group', 'id', v_row.id,
      'routeKind', 'stay', 'routeId', v_row.id,
      'offeringType', 'stay', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Stay'), 'orderLabel', NULL,
      'startsAt', NULL, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', NULL,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Paid Mingla food and drink orders.
  v_pass_count := 0;
  FOR v_row IN
    SELECT vo.id, vo.venue_id, vo.created_at, vo.pickup_code,
           vl.name AS title,
           coalesce((SELECT sum(i.quantity)::integer
             FROM public.venue_order_items i
            WHERE i.venue_order_id = vo.id), 0) AS quantity
      FROM public.venue_orders vo
      JOIN public.venue_listings vl ON vl.id = vo.venue_id
     WHERE vo.buyer_user_id IS NULL
       AND vo.money_path = 'mingla'
       AND vo.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND vo.created_at >= now() - interval '90 days'
       AND (lower(btrim(vo.buyer_email)) = ANY(v_emails)
         OR vo.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, vo.buyer_email, vo.buyer_phone_e164
       )
     ORDER BY vo.created_at, vo.id
     LIMIT 25
     FOR UPDATE OF vo SKIP LOCKED
  LOOP
    UPDATE public.venue_orders
       SET buyer_user_id = p_user_id
     WHERE id = v_row.id AND buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_order', 'id', v_row.id,
      'routeKind', 'venue_order', 'routeId', v_row.id,
      'offeringType', 'food', 'noun', 'receipt',
      'title', v_row.title,
      'orderLabel', CASE WHEN btrim(coalesce(v_row.pickup_code, '')) <> ''
        THEN 'Order #' || v_row.pickup_code
        ELSE 'Order ' || upper(substr(replace(v_row.id::text, '-', ''), 1, 8))
        END,
      'startsAt', v_row.created_at, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', v_row.quantity,
      'source', 'food', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed),
    'more', v_more
  );
END;
$function$;

COMMENT ON FUNCTION public.claim_attendance_by_verified_identity(uuid) IS
  '#2217 + #3524 + #4063 + #4271: the identity rail for orders, RSVPs, plus-ones, reservations, stays and food orders. Takes NO identifier from the caller; every row is gated by account_owns_contact; any event visibility; safe to call repeatedly (SKIP LOCKED, unowned-guarded writes); returns only rows claimed by this call. Door orders of every method share the 30-day door window.';
REVOKE ALL ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
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
