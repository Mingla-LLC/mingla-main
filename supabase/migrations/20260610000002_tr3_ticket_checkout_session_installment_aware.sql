-- ORCH-0869 [Tr3 Installment Payments] — Stage 1b migration.
--
-- Amends the two checkout RPCs so installment-plan trips end-to-end through
-- the existing ticket-checkout pipeline:
--   * biz_ticket_checkout_create_session — for trip events whose pricing
--     tier carries tier_metadata.installments, validate the schedule, reject
--     past-due first installments, compute deposit + per-installment
--     amounts with last-installment-absorbs-rounding, override session
--     total_cents to the deposit amount (what Stripe will charge), and
--     persist the schedule on the session row so finalize can read it back.
--   * biz_ticket_checkout_finalize — 3 new optional params populate the 5
--     new orders columns shipped by Stage 1 (at_risk, installment_plan_root,
--     stripe_customer_id_on_connected_account, saved_payment_method_id) and
--     INSERT order_installments rows from the session's persisted schedule
--     when the deposit PI's metadata carried mingla_installment_plan_root=true.
--
-- Pre-state (verified live 2026-05-17 via mcp + DB query):
--   * 0829b's biz_ticket_checkout_create_session is the live definition.
--   * 0777's biz_ticket_checkout_finalize is the live definition.
--   * order_installments table + 5 new orders columns exist (Stage 1).
--   * trip_pricing_tiers.tier_metadata jsonb default '{}' exists (Tr2).
--
-- Per SPEC §3.1 + §3.2.2 (ORCH-0869).
--
-- Rounding rule: integer-cents math. Deposit = floor(total * deposit_pct / 100).
-- Installments 1..N-1 = floor(total * installments[i].pct / 100). Installment N
-- absorbs the rounding remainder so deposit + sum(installments) = total.
--
-- Cart constraint: when any line's ticket_type maps to a tier with installments,
-- the cart MUST contain exactly one line (one ticket_type, quantity >= 1) per
-- SPEC §1 currency-pinned + I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH.
-- Multi-ticket-type carts with installments → ticket_lines_mixed_with_installments.

BEGIN;

-- ---------------- ticket_checkout_sessions: installment_schedule ----------------
-- Stage 1 added 5 columns to orders but no session-side column. The schedule
-- has to live on the session row so biz_ticket_checkout_finalize (called from
-- the Stripe webhook well after create_session returned) can read it back
-- without re-running schedule computation against trip_pricing_tiers.
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS installment_schedule jsonb;

COMMENT ON COLUMN public.ticket_checkout_sessions.installment_schedule IS
  'ORCH-0869 (Tr3): when non-null, the session represents a trip booking with a payment plan. Shape: { fullPriceCents: bigint, depositCents: bigint, currency: char(3), installments: [{ ordinal: int, amountCents: bigint, dueAt: timestamptz-iso, pct: number }] }. Persisted at create_session, read back at finalize to INSERT order_installments rows.';

-- ---------------- biz_ticket_checkout_create_session (replaces 0829b) ----------------
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
  -- ORCH-0869 Stage 1b installment computation locals
  v_is_trip boolean := false;
  v_line_count int := 0;
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_full_price_cents bigint;
  v_deposit_cents bigint;
  v_installments_out jsonb := '[]'::jsonb;
  v_running_installment_total bigint := 0;
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  v_last_ord int := 0;
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
    -- ORCH-0791 + ORCH-0829-B D-1: terminal OR past-expiry sessions tombstone.
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
      -- Fall through to create path.
    ELSE
      -- In-flight session within expiry: preserve I-CHECKOUT-IDEMPOTENT.
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
        'items', v_items,
        -- ORCH-0869 Stage 1b: replay installmentSchedule from the existing row.
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  -- ORCH-0869 Stage 1b: select event_type so we know whether to look at
  -- trip_pricing_tiers for an installment schedule.
  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled
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

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
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

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
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

  -- ORCH-0869 Stage 1b: installment-schedule path for trip events.
  -- For non-trip events OR trips without a populated tier_metadata.installments
  -- key, this whole block is a no-op and the legacy single-payment path runs.
  IF v_is_trip AND v_first_ticket_type_id IS NOT NULL THEN
    SELECT tpt.tier_metadata
      INTO v_tier_metadata
      FROM public.trip_pricing_tiers tpt
     WHERE tpt.event_id = p_event_id
       AND tpt.ticket_type_id = v_first_ticket_type_id;

    IF FOUND AND v_tier_metadata IS NOT NULL THEN
      v_installments_input := v_tier_metadata -> 'installments';
      IF v_installments_input IS NOT NULL AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- Cart constraint: installment plans require exactly one ticket_type.
        IF v_line_count > 1 THEN
          RAISE EXCEPTION 'ticket_lines_mixed_with_installments';
        END IF;

        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        -- SPEC §3.5.1 + investigation O-6: 1 deposit + 1..11 installments.
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        v_pct_sum := v_deposit_pct;
        v_full_price_cents := v_total;

        -- First pass: validate every installment + accumulate pct sum.
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            -- Ordinals must be 1..N monotonic with no gaps or duplicates.
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          -- Exactly one of days_after_booking | fixed_date.
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
          v_last_ord := v_inst_ord;
        END LOOP;

        -- Sum-check: deposit_pct + sum(installments[].pct) === 100 (within
        -- 0.01 tolerance for floating-point storage round-trip).
        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Compute deposit + per-installment amounts with last-absorbs-rounding.
        v_deposit_cents := floor(v_full_price_cents::numeric * v_deposit_pct / 100)::bigint;
        v_running_installment_total := 0;
        v_installments_out := '[]'::jsonb;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          -- due_at: days_after_booking → now + N days; fixed_date → date::tstz.
          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          -- Late-booking rejection (SPEC SC-17): if the FIRST installment's
          -- due_at is in the past at booking time, reject.
          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          -- amount: last installment absorbs floor() rounding remainder so
          -- deposit + sum(installments) = full_price_cents exactly.
          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_full_price_cents::numeric * v_inst_pct / 100)::bigint;
            v_running_installment_total := v_running_installment_total + v_inst_amount;
          ELSE
            v_inst_amount := v_full_price_cents - v_deposit_cents - v_running_installment_total;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          v_installments_out := v_installments_out || jsonb_build_array(jsonb_build_object(
            'ordinal', v_inst_ord,
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ));
        END LOOP;

        -- Override v_total to the deposit (what Stripe charges at booking).
        -- The session's items table still shows full-price line items (UI
        -- contract preserved); the schedule jsonb carries the breakdown.
        v_total := v_deposit_cents::integer;
      END IF;
    END IF;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE WHEN v_total > 0 THEN v_event.stripe_account_id ELSE NULL END;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    COALESCE(v_currency, 'GBP'::character(3)), v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    -- Build the installment_schedule JSONB only when the trip had a populated
    -- schedule. Stays NULL on every legacy event/non-installment-trip path.
    CASE
      WHEN v_installments_out <> '[]'::jsonb THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_deposit_cents,
          'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
          'installments', v_installments_out
        )
      ELSE NULL
    END
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
    'items', v_items,
    -- ORCH-0869 Stage 1b: surface schedule to the edge function so it can
    -- inject setup_future_usage:'off_session' + payment_method_types:['card']
    -- on the Stripe PI / Hosted Checkout. Null on legacy paths.
    'installmentSchedule', CASE
      WHEN v_installments_out <> '[]'::jsonb THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_deposit_cents,
          'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
          'installments', v_installments_out
        )
      ELSE NULL
    END
  );
END;
$$;

-- ---------------- biz_ticket_checkout_finalize (replaces 0777_qr_pepper 5-arg) ----------------
-- Adds 3 new optional params; legacy callers (free finalize from
-- ticket-checkout-create + non-installment paid finalize from
-- stripeWebhookRouter) keep working unchanged because the new params default
-- to NULL / false. Installment-aware caller (stripeWebhookRouter when PI
-- metadata carries mingla_installment_plan_root='true') passes all three.
--
-- The LIVE current signature is 5 args (added in
-- 20260515000016_orch_0777_qr_pepper_service_role_rpc.sql:
--   biz_ticket_checkout_finalize(uuid, text, text, text, text)
-- where the trailing text is p_qr_token_pepper). DROP that overload first
-- because CREATE OR REPLACE only matches on identical signature: adding 3
-- DEFAULT params creates a NEW function and leaves the old one in place,
-- and supabase.rpc() with 5 named params would then resolve ambiguously
-- (PostgreSQL picks based on default-arg analysis, non-deterministic across
-- server versions). Drop forces every caller through the new 8-arg form.
DROP FUNCTION IF EXISTS public.biz_ticket_checkout_finalize(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,
  p_installment_plan_root boolean DEFAULT false
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
  -- ORCH-0869 Stage 1b installment locals
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
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

  -- ORCH-0869 Stage 1b: read back schedule for installment-plan-root finalizes.
  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    -- ORCH-0869 Stage 1b installment columns (Stage 1 added them).
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id
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
    v_now, v_now,
    -- New columns: populate only when this finalize is installment-plan-root.
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END
  );

  -- ORCH-0869 Stage 1b: INSERT order_installments rows from the persisted
  -- schedule. Only fires when the caller explicitly flagged the finalize as
  -- installment-plan-root AND the session actually carries a schedule.
  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN
      -- Without a saved Customer + PM, the cron has nothing to charge later.
      -- Reject loudly rather than silently creating ledger rows that can never
      -- be charged. The webhook router should always pass both when the PI
      -- metadata carries mingla_installment_plan_root='true' and the PI had
      -- setup_future_usage:'off_session'.
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;

    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;

      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled'
      );
    END LOOP;
  END IF;

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
    'notificationStatus', 'queued',
    -- Surface installment-plan-root state so callers can react if needed.
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(
  uuid, text, text, text, text, text, text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(
  uuid, text, text, text, text, text, text, boolean
) TO service_role;

-- ---------------- Self-verification probe ----------------
DO $$
DECLARE
  v_session_col_count int;
  v_session_fn_count int;
  v_finalize_fn_count int;
  v_finalize_param_count int;
BEGIN
  SELECT count(*) INTO v_session_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ticket_checkout_sessions'
    AND column_name = 'installment_schedule';
  IF v_session_col_count <> 1 THEN
    RAISE EXCEPTION 'ORCH-0869 Stage 1b: ticket_checkout_sessions.installment_schedule column missing (got %)', v_session_col_count;
  END IF;

  SELECT count(*) INTO v_session_fn_count
  FROM pg_proc WHERE proname = 'biz_ticket_checkout_create_session';
  IF v_session_fn_count < 1 THEN
    RAISE EXCEPTION 'ORCH-0869 Stage 1b: biz_ticket_checkout_create_session missing after CREATE OR REPLACE';
  END IF;

  SELECT count(*) INTO v_finalize_fn_count
  FROM pg_proc p WHERE p.proname = 'biz_ticket_checkout_finalize';
  IF v_finalize_fn_count < 1 THEN
    RAISE EXCEPTION 'ORCH-0869 Stage 1b: biz_ticket_checkout_finalize missing';
  END IF;

  -- The new finalize signature has 8 params. If any overload with <8 params
  -- survived, the next caller could resolve to the old 5-arg overload and
  -- silently bypass the installment branch. The DROP FUNCTION IF EXISTS
  -- earlier removed the 5-arg overload added by
  -- 20260515000016_orch_0777_qr_pepper_service_role_rpc.sql.
  SELECT pronargs INTO v_finalize_param_count
  FROM pg_proc WHERE proname = 'biz_ticket_checkout_finalize'
  ORDER BY pronargs DESC LIMIT 1;
  IF v_finalize_param_count <> 8 THEN
    RAISE EXCEPTION 'ORCH-0869 Stage 1b: biz_ticket_checkout_finalize expected 8 params, got %', v_finalize_param_count;
  END IF;

  -- Belt-and-suspenders: assert there's only ONE finalize overload now (the
  -- 5-arg one should have been dropped). Two overloads would let supabase.rpc
  -- ambiguous resolution silently route to the wrong one.
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'biz_ticket_checkout_finalize') <> 1 THEN
    RAISE EXCEPTION 'ORCH-0869 Stage 1b: expected exactly 1 biz_ticket_checkout_finalize overload after migration, got %',
      (SELECT count(*) FROM pg_proc WHERE proname = 'biz_ticket_checkout_finalize');
  END IF;

  RAISE NOTICE 'ORCH-0869 Stage 1b migration complete: session.installment_schedule + create_session installment-aware + finalize installment-aware (8 params, single overload).';
END $$;

COMMIT;
