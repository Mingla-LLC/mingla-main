-- Issue #3645 — trip payment plans on Paystack: finalize, bind, attempts, links (M2 of 4).
--
-- issue_1930_ticket_checkout_finalize_base is re-emitted from its latest
-- definition (20271128013827_issue_3827_guest_list_comps.sql) with two
-- provider-aware hunks (fresh insert guard + replay backfill guard, and the
-- provider / collection method / bound time on the rows they insert). The
-- structural test issue_3645_reemit_hunks.structural.test.ts proves nothing
-- else moved. Every other function here is new and service_role only.

BEGIN;

-- =============================================================================
-- §1. Finalize: a Paystack plan has no Stripe customer/card pair.
-- =============================================================================
-- Classified exactly like biz_ticket_checkout_finalize's observed provider:
-- a non-PaymentIntent reference with a numeric transaction id is Paystack.
CREATE OR REPLACE FUNCTION public.issue_3645_finalize_is_paystack(
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(p_stripe_payment_intent_id, '') !~ '^pi_[A-Za-z0-9]+$'
     AND COALESCE(p_stripe_payment_intent_id, '') <> ''
     AND COALESCE(p_stripe_charge_id, '') ~ '^[0-9]+$'
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_finalize_is_paystack(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_finalize_is_paystack(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_finalize_base(
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
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
  -- issue #2160 DELTA 1 of 4 — the pricing mode and the chosen day set.
  v_pricing_mode text := 'per_day';
  v_days uuid[];
  v_day_count integer := 0;
  v_day_id uuid;
  -- issue #3827 — the mint helper's result.
  v_mint jsonb;
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
    -- ORCH-0921: replace the silent early-return with compare-and-correct.
    -- When the second caller passes p_installment_plan_root=true AND the
    -- existing order row has installment_plan_root=false AND the session
    -- carries an installment_schedule AND zero order_installments rows exist,
    -- backfill the missing installment-plan state. Idempotent: re-running
    -- after the backfill is a no-op (the EXISTS checks prevent duplicate
    -- INSERTs and redundant UPDATEs).
    IF p_installment_plan_root
       AND v_session.installment_schedule IS NOT NULL
       -- issue #3645: a Paystack plan has no Stripe customer/card pair.
       AND ((p_stripe_customer_id_on_connected_account IS NOT NULL
             AND p_saved_payment_method_id IS NOT NULL)
            OR public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id))
       AND EXISTS (
         SELECT 1 FROM public.orders
         WHERE id = v_session.order_id
           AND installment_plan_root = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.order_installments
         WHERE order_id = v_session.order_id
       )
    THEN
      v_schedule := v_session.installment_schedule;
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
          order_id, ordinal, amount_cents, currency, due_at, status,
          provider, collection_method, plan_bound_at
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled',
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN 'paystack' ELSE 'stripe' END,
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN 'pay_link' ELSE 'auto_card' END,
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN NULL ELSE now() END
        );
      END LOOP;

      UPDATE public.orders
         SET installment_plan_root = true,
             stripe_customer_id_on_connected_account = p_stripe_customer_id_on_connected_account,
             saved_payment_method_id = p_saved_payment_method_id,
             updated_at = now()
       WHERE id = v_session.order_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status,
      -- issue #2160 DELTA 2 of 4 — the days THIS pass admits, so the client
      -- can label it without a second read. `[]` for every pre-#2160 pass,
      -- which is what "not day-scoped" looks like on the wire.
      'eventDateIds', COALESCE((
        SELECT jsonb_agg(ted.event_date_id ORDER BY ed.start_at, ed.id)
          FROM public.ticket_event_dates ted
          JOIN public.event_dates ed ON ed.id = ted.event_date_id
         WHERE ted.ticket_id = t.id), '[]'::jsonb)
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
      'notificationStatus', 'queued',
      'installmentPlanRoot', (
        SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id
      )
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

  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id,
    pricing_breakdown,
    -- ORCH-1188 FIX 3b: persist the buyer's selected occurrence (NULL-safe).
    event_date_id,
    -- issue #3281 — copy session booked start onto the paid order.
    booked_start_at,
    booked_end_at,
    booked_party_size
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
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END,
    v_session.pricing_breakdown,
    -- ORCH-1188 FIX 3b: the occurrence the buyer booked, read from the session
    -- metadata jsonb (NULL for single-date events / no selection). NULLIF guards
    -- an empty string, ::uuid is NULL-safe on NULL input.
    NULLIF(v_session.metadata->>'event_date_id', '')::uuid,
    v_session.booked_start_at,
    v_session.booked_end_at,
    v_session.booked_party_size
  );

  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    -- issue #3645: Stripe plans need the customer + saved card; a Paystack plan
    -- binds its price (and any reusable card) right after finalize.
    IF NOT public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
       AND (p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL) THEN
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
        order_id, ordinal, amount_cents, currency, due_at, status,
        provider, collection_method, plan_bound_at
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled',
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN 'paystack' ELSE 'stripe' END,
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN 'pay_link' ELSE 'auto_card' END,
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN NULL ELSE v_now END
      );
    END LOOP;
  END IF;

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  -- ══ issue #2160 DELTA 3 of 4 — MINT UNDER THE MODE THE GUEST WAS QUOTED ═
  --
  -- THE SNAPSHOT, NOT A FRESH READ OF `events`. The session was PRICED and
  -- SIZED under `multi_date_pricing_mode_snapshot` at create; minting under a
  -- different value issues a pass that does not match what the guest paid for,
  -- in both directions (§A.7 states the two reproductions). The lock cannot
  -- prevent the flip, because an in-flight session holds no ticket yet — which
  -- is precisely the window this line closes.
  --
  -- DELETE THE SNAPSHOT READ and an organiser flipping the mode mid-checkout
  -- either takes a two-day guest's money and admits them on one day, or sells
  -- two admissions and lets four people in.
  --
  -- COALESCE to the live event ONLY for a session created before the column
  -- existed, so anything already in flight at deploy still finalizes.
  SELECT COALESCE(
           v_session.multi_date_pricing_mode_snapshot,
           (SELECT e.multi_date_pricing_mode FROM public.events e
             WHERE e.id = v_session.event_id),
           'per_day')
    INTO v_pricing_mode;

  -- The day set, ordered by start_at so the per_day round-robin below is
  -- deterministic and testable, not incidental.

  SELECT ARRAY(
           SELECT d.event_date_id
             FROM public.ticket_checkout_session_event_dates d
             JOIN public.event_dates ed ON ed.id = d.event_date_id
            WHERE d.checkout_session_id = v_session.id
            ORDER BY ed.start_at, ed.id
         ) INTO v_days;
  v_day_count := COALESCE(array_length(v_days, 1), 0);

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    FOR i IN 1..v_item.quantity LOOP
      -- issue #3827 — THE ONE MINT. The token, its hash, the signed QR payload
      -- and the tickets row are now minted by issue_3827_mint_ticket, whose body
      -- is the block that stood here, verbatim. Host guest-list comps call the
      -- same helper, so a comp QR and a bought QR can never drift apart.
      v_mint := public.issue_3827_mint_ticket(
        v_order_id, v_session.event_id, v_item.ticket_type_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr_token_pepper, v_now
      );
      v_ticket_id := (v_mint ->> 'ticketId')::uuid;
      v_qr := v_mint ->> 'qrPayload';

      -- ══ issue #2160 DELTA 4 of 4 — MINT THE ADMISSION ENTITLEMENTS ═════
      -- A pass admits the days it has rows for. The mint loop itself is
      -- UNCHANGED — `v_item.quantity` already carries the per-day multiplier
      -- from the create-session base (amendment §1), so all that differs
      -- between the modes is how the days are DISTRIBUTED.
      --
      --   zero days   -> NO ROWS. Not day-scoped. Today's any-occurrence
      --                  admission window, byte-identical, which is what
      --                  every pass issued before #2160 has and must keep.
      --   all_days    -> one row per chosen day on the SINGLE pass.
      --   per_day     -> ONE row, dealt round-robin across the ordered day
      --                  set: with quantity = qty x D this yields exactly
      --                  `qty` passes per day, deterministically.
      --
      -- DELETE THIS BLOCK and every pass mints with zero days, so a guest is
      -- admitted on a day they did not pay for and the whole issue reverts.
      IF v_day_count > 0 THEN
        IF v_pricing_mode = 'all_days' THEN
          FOREACH v_day_id IN ARRAY v_days LOOP
            INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
            VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_days[((i - 1) % v_day_count) + 1])
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid',
        'eventDateIds', CASE
          WHEN v_day_count = 0 THEN '[]'::jsonb
          WHEN v_pricing_mode = 'all_days' THEN to_jsonb(v_days)
          ELSE jsonb_build_array(v_days[((i - 1) % v_day_count) + 1])
        END
      ));
    END LOOP;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(
    v_session.event_id,
    v_session.buyer_user_id,
    v_order_id,
    v_session.buyer_email
  );

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
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  uuid, text, text, text, text, text, text, boolean
) TO service_role;

-- =============================================================================
-- §2. Shared helpers: retry dates anchored to the due date (I-3645-BOTH-2) and
--     failure bookkeeping (one writer for every Paystack failure path).
-- =============================================================================
-- 1 → due_at + 3 days; 2 → due_at + 7 days; >= 3 → NULL (at risk).
-- A computed time already in the past (late first attempt) → now + 6 hours,
-- so the next cron run retries. Mirrored by installmentRetrySchedule.ts.
CREATE OR REPLACE FUNCTION public.issue_3645_next_retry_at(
  p_due_at timestamptz,
  p_retry_count_after_failure integer,
  p_now timestamptz DEFAULT now()
) RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_retry_count_after_failure IS NULL OR p_retry_count_after_failure < 1 THEN NULL
    WHEN p_retry_count_after_failure >= 3 THEN NULL
    ELSE greatest(
      p_due_at + CASE p_retry_count_after_failure
                   WHEN 1 THEN interval '3 days'
                   ELSE interval '7 days' END,
      CASE WHEN p_due_at + CASE p_retry_count_after_failure
                             WHEN 1 THEN interval '3 days'
                             ELSE interval '7 days' END <= p_now
           THEN p_now + interval '6 hours'
           ELSE '-infinity'::timestamptz END)
  END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_next_retry_at(timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_next_retry_at(timestamptz, integer, timestamptz) TO service_role;

-- Internal: counts one failure on a locked instalment row. Callers hold the
-- event → order → instalment locks and decide whether a failure counts.
CREATE OR REPLACE FUNCTION public.issue_3645_count_installment_failure(
  p_installment_id uuid,
  p_failure_reason text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inst public.order_installments;
  v_retry integer;
  v_next timestamptz;
  v_at_risk boolean := false;
BEGIN
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_retry := v_inst.retry_count + 1;
  v_next := public.issue_3645_next_retry_at(v_inst.due_at, v_retry, p_now);

  UPDATE public.order_installments
     SET status = 'failed',
         failed_at = p_now,
         failure_reason = left(coalesce(p_failure_reason, 'unknown_failure'), 240),
         retry_count = v_retry,
         next_retry_at = v_next,
         in_flight_attempt_id = NULL
   WHERE id = p_installment_id;

  IF v_retry >= 3 THEN
    UPDATE public.orders
       SET at_risk = true, at_risk_since = p_now, updated_at = p_now
     WHERE id = v_inst.order_id AND at_risk IS NOT TRUE;
    v_at_risk := true;
  END IF;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_at_risk THEN 'at_risk' ELSE 'failed' END,
    'retry_count', v_retry,
    'next_retry_at', v_next
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_count_installment_failure(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Internal: one audit row per Paystack instalment transition. Never carries a
-- link, a reference or any card detail.
CREATE OR REPLACE FUNCTION public.issue_3645_audit_installment(
  p_installment_id uuid,
  p_action text,
  p_after jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  INSERT INTO public.audit_log (brand_id, event_id, action, target_type, target_id, after)
  SELECT e.brand_id, e.id, p_action, 'order_installment', oi.id::text, p_after
    FROM public.order_installments oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.events e ON e.id = o.event_id
   WHERE oi.id = p_installment_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_audit_installment(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Internal: lock graph shared by every instalment writer, in the order
-- cancel_event_refund_prepare and claim_order_installment_for_charge use
-- (event → order → instalment). Returns the event status, or NULL when a row
-- in the graph is missing.
CREATE OR REPLACE FUNCTION public.issue_3645_lock_installment_graph(
  p_installment_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_event_id uuid;
  v_event_status text;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT event_id INTO v_event_id FROM public.orders WHERE id = v_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT status INTO v_event_status FROM public.events WHERE id = v_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.orders WHERE id = v_order_id FOR UPDATE;
  PERFORM 1 FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  RETURN v_event_status;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_lock_installment_graph(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- §3. Bind a Paystack plan: lock each later payment's price; store a reusable
--     card if the paying transaction produced one.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_plan_bind(
  p_order_id uuid,
  p_authorization jsonb,
  p_upgrade boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders;
  v_plan jsonb;
  v_entry jsonb;
  v_row record;
  v_bound integer := 0;
  v_upgraded integer := 0;
  v_auth_ok boolean;
  v_stored boolean := false;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.installment_plan_root IS NOT TRUE THEN
    RAISE EXCEPTION 'not_installment_plan' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.order_installments WHERE order_id = p_order_id ORDER BY ordinal FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'installments_missing' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_installments
              WHERE order_id = p_order_id AND provider <> 'paystack') THEN
    RAISE EXCEPTION 'not_paystack_plan' USING ERRCODE = 'P0001';
  END IF;

  v_auth_ok := p_authorization IS NOT NULL
    AND jsonb_typeof(p_authorization) = 'object'
    AND p_authorization ->> 'reusable' = 'true'
    AND lower(coalesce(p_authorization ->> 'channel', '')) = 'card'
    AND coalesce(p_authorization ->> 'authorization_code', '') ~ '^AUTH_[A-Za-z0-9]+$'
    AND length(btrim(coalesce(p_authorization ->> 'authorization_email', ''))) > 0
    AND length(btrim(coalesce(p_authorization ->> 'source_reference', ''))) > 0;

  IF v_auth_ok THEN
    INSERT INTO private.order_payment_authorizations (
      order_id, provider, authorization_code, authorization_email, reusable, channel,
      card_type, last4, exp_month, exp_year, bank, signature, customer_code, source_reference
    ) VALUES (
      p_order_id, 'paystack',
      p_authorization ->> 'authorization_code',
      btrim(p_authorization ->> 'authorization_email'),
      true, 'card',
      nullif(p_authorization ->> 'card_type', ''),
      CASE WHEN coalesce(p_authorization ->> 'last4', '') ~ '^[0-9]{4}$'
           THEN p_authorization ->> 'last4' END,
      nullif(p_authorization ->> 'exp_month', ''),
      nullif(p_authorization ->> 'exp_year', ''),
      nullif(p_authorization ->> 'bank', ''),
      nullif(p_authorization ->> 'signature', ''),
      nullif(p_authorization ->> 'customer_code', ''),
      p_authorization ->> 'source_reference'
    )
    ON CONFLICT (order_id) DO NOTHING;  -- the first authorization wins
    v_stored := FOUND;
  END IF;

  IF p_upgrade THEN
    -- A buyer who paid a later payment by a reusable card moves to automatic
    -- charging for the payments still scheduled (never for failed ones).
    IF NOT v_stored THEN
      RETURN jsonb_build_object('ok', true, 'upgraded_count', 0,
        'reason', CASE WHEN v_auth_ok THEN 'authorization_exists' ELSE 'authorization_not_reusable' END);
    END IF;
    UPDATE public.order_installment_pay_links l
       SET revoked_at = now(), revoked_reason = 'upgraded_to_auto_card'
      FROM public.order_installments oi
     WHERE l.installment_id = oi.id
       AND oi.order_id = p_order_id
       AND oi.status = 'scheduled'
       AND oi.collection_method = 'pay_link'
       AND oi.plan_bound_at IS NOT NULL
       AND l.revoked_at IS NULL;
    UPDATE public.order_installments
       SET collection_method = 'auto_card',
           buyer_action = 'none',
           pre_charge_notice_sent_at = NULL
     WHERE order_id = p_order_id
       AND status = 'scheduled'
       AND collection_method = 'pay_link'
       AND plan_bound_at IS NOT NULL;
    GET DIAGNOSTICS v_upgraded = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'upgraded_count', v_upgraded);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.order_installments
                  WHERE order_id = p_order_id AND plan_bound_at IS NULL) THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'bound_count', 0,
      'collection_method', (SELECT collection_method FROM public.order_installments
                             WHERE order_id = p_order_id ORDER BY ordinal LIMIT 1));
  END IF;

  SELECT s.installment_charge_plan INTO v_plan
    FROM public.ticket_checkout_sessions s
   WHERE s.order_id = p_order_id
   ORDER BY s.created_at DESC
   LIMIT 1;
  IF v_plan IS NULL OR jsonb_typeof(v_plan -> 'payments') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'installment_charge_plan_missing' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT id, ordinal, amount_cents FROM public.order_installments
     WHERE order_id = p_order_id AND plan_bound_at IS NULL
     ORDER BY ordinal
  LOOP
    SELECT e INTO v_entry
      FROM jsonb_array_elements(v_plan -> 'payments') e
     WHERE (e ->> 'ordinal')::integer = v_row.ordinal
     LIMIT 1;
    IF v_entry IS NULL THEN
      RAISE EXCEPTION 'installment_charge_plan_missing' USING ERRCODE = 'P0001';
    END IF;
    IF (v_entry ->> 'netCents')::bigint IS DISTINCT FROM v_row.amount_cents THEN
      RAISE EXCEPTION 'installment_charge_plan_mismatch' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.order_installments
       SET buyer_total_cents = (v_entry ->> 'buyerTotalCents')::bigint,
           planned_application_fee_cents = (v_entry ->> 'applicationFeeCents')::bigint,
           pricing_breakdown = v_entry -> 'breakdown',
           collection_method = CASE
             WHEN EXISTS (SELECT 1 FROM private.order_payment_authorizations a
                           WHERE a.order_id = p_order_id AND a.reusable AND a.deactivated_at IS NULL)
             THEN 'auto_card' ELSE 'pay_link' END,
           plan_bound_at = now()
     WHERE id = v_row.id;
    v_bound := v_bound + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'bound_count', v_bound,
    'collection_method', (SELECT collection_method FROM public.order_installments
                           WHERE order_id = p_order_id ORDER BY ordinal LIMIT 1));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_paystack_plan_bind(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_paystack_plan_bind(uuid, jsonb, boolean) TO service_role;

-- =============================================================================
-- §4. The saved card for one automatic charge (service_role; never logged).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_installment_authorization_for_charge(
  p_installment_id uuid
) RETURNS TABLE (authorization_code text, authorization_email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT a.authorization_code, a.authorization_email
    FROM public.order_installments oi
    JOIN private.order_payment_authorizations a ON a.order_id = oi.order_id
   WHERE oi.id = p_installment_id
     AND oi.provider = 'paystack'
     AND oi.collection_method = 'auto_card'
     AND a.reusable
     AND a.deactivated_at IS NULL
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_installment_authorization_for_charge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_installment_authorization_for_charge(uuid) TO service_role;

-- =============================================================================
-- §5. Begin one attempt: claim + mint the deterministic reference atomically.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_begin_installment_attempt(
  p_installment_id uuid,
  p_method text,
  p_application_fee_cents bigint,
  p_atrisk_override boolean DEFAULT false,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_inst public.order_installments;
  v_order public.orders;
  v_attempt_no integer;
  v_reference text;
  v_attempt_id uuid;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_card', 'pay_link', 'approve') THEN
    RAISE EXCEPTION 'invalid_attempt_method' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_3645_lock_installment_graph(p_installment_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;

  IF v_inst.status NOT IN ('scheduled', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_chargeable', 'status', v_inst.status);
  END IF;
  IF v_inst.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_cancelled');
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;
  IF v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  END IF;
  IF v_inst.provider <> 'paystack' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paystack');
  END IF;
  IF v_inst.plan_bound_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_bound');
  END IF;
  IF v_inst.buyer_total_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_missing');
  END IF;
  IF v_inst.in_flight_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_in_flight');
  END IF;
  IF p_method = 'auto_card' AND v_inst.collection_method <> 'auto_card' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_auto_card');
  END IF;
  IF p_method = 'auto_card' AND v_order.at_risk IS TRUE AND NOT coalesce(p_atrisk_override, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_at_risk');
  END IF;
  IF p_application_fee_cents IS NULL OR p_application_fee_cents < 0
     OR p_application_fee_cents > v_inst.buyer_total_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'application_fee_invalid');
  END IF;

  UPDATE public.order_installment_charge_attempts
     SET state = 'superseded', resolved_at = p_now
   WHERE installment_id = p_installment_id AND state = 'paused';

  SELECT coalesce(max(attempt_no), 0) + 1 INTO v_attempt_no
    FROM public.order_installment_charge_attempts
   WHERE installment_id = p_installment_id;
  v_reference := 'mingla-inst-' || p_installment_id::text || '-'
    || CASE p_method WHEN 'auto_card' THEN 'a' WHEN 'pay_link' THEN 'l' ELSE 'p' END
    || v_attempt_no::text;

  INSERT INTO public.order_installment_charge_attempts (
    installment_id, provider, attempt_no, method, reference, state,
    amount_cents, application_fee_cents, created_at
  ) VALUES (
    p_installment_id, 'paystack', v_attempt_no, p_method, v_reference, 'created',
    v_inst.buyer_total_cents, p_application_fee_cents, p_now
  ) RETURNING id INTO v_attempt_id;

  UPDATE public.order_installments
     SET in_flight_attempt_id = v_attempt_id
   WHERE id = p_installment_id;

  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_paystack_attempt_created',
    jsonb_build_object('attempt_id', v_attempt_id, 'attempt_no', v_attempt_no, 'method', p_method,
      'amount_cents', v_inst.buyer_total_cents));

  RETURN jsonb_build_object(
    'ok', true,
    'attempt_id', v_attempt_id,
    'reference', v_reference,
    'amount_cents', v_inst.buyer_total_cents,
    'application_fee_cents', p_application_fee_cents,
    'attempt_no', v_attempt_no
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_begin_installment_attempt(uuid, text, bigint, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_begin_installment_attempt(uuid, text, bigint, boolean, timestamptz) TO service_role;

-- =============================================================================
-- §6. Resolve an attempt — the single writer of Paystack instalment state.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_resolve_installment_attempt(
  p_attempt_id uuid,
  p_outcome text,
  p_provider_transaction_id text,
  p_gateway_response text,
  p_approval_url text,
  p_provider_fee_cents bigint,
  p_verified_amount_cents bigint,
  p_count_failure boolean DEFAULT true,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_installment_id uuid;
  v_event_status text;
  v_attempt public.order_installment_charge_attempts;
  v_inst public.order_installments;
  v_order public.orders;
  v_gateway text := left(nullif(btrim(coalesce(p_gateway_response, '')), ''), 500);
  v_fail jsonb;
  v_remaining integer;
  v_reason text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'failed', 'paused', 'unknown') THEN
    RAISE EXCEPTION 'invalid_attempt_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT installment_id INTO v_installment_id
    FROM public.order_installment_charge_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;
  v_event_status := public.issue_3645_lock_installment_graph(v_installment_id);
  SELECT * INTO v_attempt FROM public.order_installment_charge_attempts WHERE id = p_attempt_id FOR UPDATE;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;

  IF p_outcome = 'succeeded' THEN
    IF v_attempt.state = 'succeeded' THEN
      IF v_inst.status = 'collected' AND v_inst.payout_accounting_state = 'pending' THEN
        PERFORM public.record_order_installment_provider_sale(
          v_inst.id, v_attempt.application_fee_cents::integer,
          coalesce(v_attempt.provider_fee_cents, 0)::integer, p_now);
      END IF;
      RETURN jsonb_build_object('ok', true, 'outcome', 'replayed', 'installment_id', v_inst.id);
    END IF;
    IF v_attempt.state IN ('refund_due', 'refunded') THEN
      RETURN jsonb_build_object('ok', true, 'outcome', v_attempt.state,
        'reason', 'replayed', 'installment_id', v_inst.id);
    END IF;
    IF p_verified_amount_cents IS DISTINCT FROM v_attempt.amount_cents THEN
      UPDATE public.order_installment_charge_attempts
         SET state = 'failed', gateway_response = 'amount_mismatch', resolved_at = p_now,
             provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id)
       WHERE id = p_attempt_id;
      UPDATE public.order_installments SET in_flight_attempt_id = NULL
       WHERE id = v_inst.id AND in_flight_attempt_id = p_attempt_id;
      PERFORM public.issue_3645_audit_installment(v_inst.id, 'tr3.installment_paystack_amount_mismatch',
        jsonb_build_object('attempt_id', p_attempt_id, 'expected_cents', v_attempt.amount_cents,
          'verified_cents', p_verified_amount_cents));
      RETURN jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'installment_id', v_inst.id);
    END IF;

    v_reason := CASE
      WHEN v_inst.status = 'collected' THEN 'installment_collected'
      WHEN v_inst.status NOT IN ('scheduled', 'failed') THEN 'installment_' || v_inst.status
      WHEN v_inst.cancelled_at IS NOT NULL THEN 'installment_cancelled'
      WHEN v_order.cancelled_at IS NOT NULL THEN 'order_cancelled'
      WHEN v_event_status = 'cancelled' THEN 'event_cancelled'
      ELSE NULL END;

    IF v_reason IS NOT NULL THEN
      -- I-3645-PS-5: a later success on a non-open instalment is refunded.
      UPDATE public.order_installment_charge_attempts
         SET state = 'refund_due', resolved_at = p_now,
             provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
             provider_fee_cents = coalesce(p_provider_fee_cents, provider_fee_cents),
             gateway_response = coalesce(v_gateway, gateway_response)
       WHERE id = p_attempt_id;
      UPDATE public.order_installments SET in_flight_attempt_id = NULL
       WHERE id = v_inst.id AND in_flight_attempt_id = p_attempt_id;
      PERFORM public.issue_3645_audit_installment(v_inst.id, 'tr3.installment_paystack_refund_due',
        jsonb_build_object('attempt_id', p_attempt_id, 'reason', v_reason, 'amount_cents', v_attempt.amount_cents));
      RETURN jsonb_build_object('ok', true, 'outcome', 'refund_due', 'reason', v_reason,
        'installment_id', v_inst.id, 'order_id', v_inst.order_id);
    END IF;

    UPDATE public.order_installment_charge_attempts
       SET state = 'succeeded', resolved_at = p_now,
           provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id),
           provider_fee_cents = coalesce(p_provider_fee_cents, provider_fee_cents),
           gateway_response = coalesce(v_gateway, gateway_response)
     WHERE id = p_attempt_id;
    UPDATE public.order_installments
       SET status = 'collected',
           collected_at = p_now,
           stripe_payment_intent_id = v_attempt.reference,
           provider_transaction_id = p_provider_transaction_id,
           failed_at = NULL,
           failure_reason = NULL,
           next_retry_at = NULL,
           in_flight_attempt_id = NULL,
           buyer_action = 'none'
     WHERE id = v_inst.id;
    PERFORM public.record_order_installment_provider_sale(
      v_inst.id, v_attempt.application_fee_cents::integer,
      coalesce(p_provider_fee_cents, 0)::integer, p_now);
    PERFORM public.issue_3645_clear_at_risk_if_settled(v_inst.order_id);
    SELECT count(*)::integer INTO v_remaining FROM public.order_installments
     WHERE order_id = v_inst.order_id AND status IN ('scheduled', 'failed');
    PERFORM public.issue_3645_audit_installment(v_inst.id, 'tr3.installment_paystack_collected',
      jsonb_build_object('attempt_id', p_attempt_id, 'method', v_attempt.method,
        'amount_cents', v_attempt.amount_cents, 'remaining', v_remaining));
    RETURN jsonb_build_object('ok', true, 'outcome', 'collected', 'remaining', v_remaining,
      'installment_id', v_inst.id, 'order_id', v_inst.order_id);
  END IF;

  -- failed / paused / unknown only move an unresolved attempt.
  IF v_attempt.state NOT IN ('created', 'unknown') THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'ignored',
      'reason', 'attempt_already_' || v_attempt.state, 'installment_id', v_inst.id);
  END IF;

  IF p_outcome = 'unknown' THEN
    UPDATE public.order_installment_charge_attempts
       SET state = 'unknown', gateway_response = coalesce(v_gateway, gateway_response)
     WHERE id = p_attempt_id;
    PERFORM public.issue_3645_audit_installment(v_inst.id, 'tr3.installment_paystack_unknown',
      jsonb_build_object('attempt_id', p_attempt_id));
    RETURN jsonb_build_object('ok', true, 'outcome', 'unknown', 'installment_id', v_inst.id);
  END IF;

  IF p_outcome = 'failed' THEN
    UPDATE public.order_installment_charge_attempts
       SET state = 'failed', gateway_response = v_gateway, resolved_at = p_now,
           provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id)
     WHERE id = p_attempt_id;
    UPDATE public.order_installments SET in_flight_attempt_id = NULL
     WHERE id = v_inst.id AND in_flight_attempt_id = p_attempt_id;
    IF coalesce(p_count_failure, true) AND v_inst.status = 'scheduled' THEN
      v_fail := public.issue_3645_count_installment_failure(
        v_inst.id, 'card_declined:' || left(coalesce(v_gateway, 'declined'), 200), p_now);
    ELSE
      v_fail := jsonb_build_object('outcome', 'failed', 'retry_count', v_inst.retry_count,
        'next_retry_at', v_inst.next_retry_at, 'counted', false);
    END IF;
    PERFORM public.issue_3645_audit_installment(v_inst.id, 'tr3.installment_paystack_' || (v_fail ->> 'outcome'),
      jsonb_build_object('attempt_id', p_attempt_id, 'retry_count', v_fail -> 'retry_count',
        'counted', coalesce(p_count_failure, true) AND v_inst.status = 'scheduled'));
    RETURN v_fail || jsonb_build_object('ok', true, 'installment_id', v_inst.id, 'order_id', v_inst.order_id);
  END IF;

  -- paused: the bank asked the buyer to approve this charge.
  UPDATE public.order_installment_charge_attempts
     SET state = 'paused', resolved_at = p_now,
         approval_url = nullif(btrim(coalesce(p_approval_url, '')), ''),
         approval_url_expires_at = CASE WHEN nullif(btrim(coalesce(p_approval_url, '')), '') IS NULL
                                        THEN NULL ELSE p_now + interval '24 hours' END,
         gateway_response = coalesce(v_gateway, gateway_response),
         provider_transaction_id = coalesce(p_provider_transaction_id, provider_transaction_id)
   WHERE id = p_attempt_id;
  UPDATE public.order_installments SET in_flight_attempt_id = NULL
   WHERE id = v_inst.id AND in_flight_attempt_id = p_attempt_id;
  IF v_inst.status = 'scheduled' THEN
    v_fail := public.issue_3645_count_installment_failure(v_inst.id, 'approval_required', p_now);
  ELSE
    v_fail := jsonb_build_object('outcome', 'failed', 'retry_count', v_inst.retry_count,
      'next_retry_at', v_inst.next_retry_at, 'counted', false);
  END IF;
  UPDATE public.order_installments
     SET buyer_action = 'approval_required', buyer_action_at = p_now
   WHERE id = v_inst.id;
  PERFORM public.issue_3645_audit_installment(v_inst.id, 'tr3.installment_paystack_paused',
    jsonb_build_object('attempt_id', p_attempt_id, 'retry_count', v_fail -> 'retry_count'));
  RETURN jsonb_build_object(
    'ok', true,
    'outcome', CASE WHEN v_fail ->> 'outcome' = 'at_risk' THEN 'at_risk' ELSE 'approval_required' END,
    'retry_count', v_fail -> 'retry_count',
    'next_retry_at', v_fail -> 'next_retry_at',
    'installment_id', v_inst.id,
    'order_id', v_inst.order_id
  );
END
$fn$;

-- =============================================================================
-- §7. At-risk clears once nothing of the order is failed (both rails; Q-2).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_clear_at_risk_if_settled(
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cleared integer := 0;
BEGIN
  UPDATE public.orders o
     SET at_risk = false, at_risk_since = NULL, updated_at = now()
   WHERE o.id = p_order_id
     AND o.at_risk IS TRUE
     AND NOT EXISTS (
       SELECT 1 FROM public.order_installments oi
        WHERE oi.order_id = o.id AND oi.status = 'failed'
     );
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'cleared', v_cleared > 0);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_clear_at_risk_if_settled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_clear_at_risk_if_settled(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.issue_3645_resolve_installment_attempt(
  uuid, text, text, text, text, bigint, bigint, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_resolve_installment_attempt(
  uuid, text, text, text, text, bigint, bigint, boolean, timestamptz
) TO service_role;

-- =============================================================================
-- §8. Pay-link checkpoint: a pay_link instalment unpaid at due / retry date.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_checkpoint_pay_link_installment(
  p_installment_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_inst public.order_installments;
  v_order public.orders;
  v_fail jsonb;
BEGIN
  v_event_status := public.issue_3645_lock_installment_graph(p_installment_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;
  IF v_inst.provider <> 'paystack' OR v_inst.collection_method <> 'pay_link' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pay_link');
  END IF;
  IF v_inst.status NOT IN ('scheduled', 'failed') OR v_inst.cancelled_at IS NOT NULL
     OR v_order.cancelled_at IS NOT NULL OR v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_open');
  END IF;
  IF v_inst.in_flight_attempt_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_in_flight');
  END IF;
  IF v_inst.retry_count >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_at_risk');
  END IF;
  IF (v_inst.status = 'scheduled' AND v_inst.due_at > p_now)
     OR (v_inst.status = 'failed' AND (v_inst.next_retry_at IS NULL OR v_inst.next_retry_at > p_now)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'checkpoint_not_reached');
  END IF;
  v_fail := public.issue_3645_count_installment_failure(p_installment_id, 'pay_link_unpaid', p_now);
  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_paystack_' || (v_fail ->> 'outcome'),
    jsonb_build_object('reason', 'pay_link_unpaid', 'retry_count', v_fail -> 'retry_count'));
  RETURN v_fail || jsonb_build_object('ok', true, 'installment_id', p_installment_id, 'order_id', v_inst.order_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_checkpoint_pay_link_installment(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_checkpoint_pay_link_installment(uuid, timestamptz) TO service_role;

-- =============================================================================
-- §9. Downgrade to pay links when the saved card can no longer be charged.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_downgrade_to_pay_link(
  p_installment_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inst public.order_installments;
  v_count integer := 0;
BEGIN
  IF public.issue_3645_lock_installment_graph(p_installment_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  IF v_inst.provider <> 'paystack' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paystack');
  END IF;
  UPDATE public.order_installments
     SET collection_method = 'pay_link'
   WHERE collection_method = 'auto_card'
     AND (id = p_installment_id
          OR (order_id = v_inst.order_id AND ordinal > v_inst.ordinal AND status = 'scheduled'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE private.order_payment_authorizations
     SET deactivated_at = now(),
         deactivated_reason = left(coalesce(nullif(btrim(p_reason), ''), 'unusable'), 200)
   WHERE order_id = v_inst.order_id AND deactivated_at IS NULL;
  PERFORM public.issue_3645_audit_installment(p_installment_id, 'tr3.installment_paystack_downgraded',
    jsonb_build_object('downgraded_count', v_count));
  RETURN jsonb_build_object('ok', true, 'downgraded_count', v_count);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_downgrade_to_pay_link(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_downgrade_to_pay_link(uuid, text) TO service_role;

-- =============================================================================
-- §10. Abandon an attempt the buyer never finished (no failure counted).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_abandon_attempt(
  p_attempt_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_installment_id uuid;
  v_state text;
BEGIN
  SELECT installment_id INTO v_installment_id
    FROM public.order_installment_charge_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;
  PERFORM public.issue_3645_lock_installment_graph(v_installment_id);
  SELECT state INTO v_state FROM public.order_installment_charge_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF v_state NOT IN ('created', 'paused') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_abandonable', 'state', v_state);
  END IF;
  UPDATE public.order_installment_charge_attempts
     SET state = 'superseded', resolved_at = now()
   WHERE id = p_attempt_id;
  UPDATE public.order_installments SET in_flight_attempt_id = NULL
   WHERE id = v_installment_id AND in_flight_attempt_id = p_attempt_id;
  RETURN jsonb_build_object('ok', true, 'installment_id', v_installment_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_abandon_attempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_abandon_attempt(uuid) TO service_role;

-- =============================================================================
-- §11. Pay / approve links.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_issue_pay_link(
  p_installment_id uuid,
  p_purpose text,
  p_token_hash bytea,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_inst public.order_installments;
  v_order public.orders;
  v_link_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_purpose IS NULL OR p_purpose NOT IN ('pay', 'approve') THEN
    RAISE EXCEPTION 'invalid_link_purpose' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid_token_hash' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_3645_lock_installment_graph(p_installment_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_inst FROM public.order_installments WHERE id = p_installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;
  IF v_inst.provider <> 'paystack' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_paystack');
  END IF;
  IF v_inst.status NOT IN ('scheduled', 'failed') OR v_inst.cancelled_at IS NOT NULL
     OR v_order.cancelled_at IS NOT NULL OR v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_open');
  END IF;
  IF v_inst.plan_bound_at IS NULL OR v_inst.buyer_total_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_bound');
  END IF;

  UPDATE public.order_installment_pay_links
     SET revoked_at = p_now, revoked_reason = 'replaced'
   WHERE installment_id = p_installment_id AND revoked_at IS NULL;

  -- At most 30 days past the due date and 45 days from now, but never a link
  -- that is already expired when it is sent.
  v_expires := greatest(p_now + interval '7 days',
                        least(v_inst.due_at + interval '30 days', p_now + interval '45 days'));
  INSERT INTO public.order_installment_pay_links (installment_id, purpose, token_hash, expires_at, created_at)
  VALUES (p_installment_id, p_purpose, p_token_hash, v_expires, p_now)
  RETURNING id INTO v_link_id;

  UPDATE public.order_installments
     SET buyer_action = CASE WHEN p_purpose = 'approve' THEN 'approval_required' ELSE 'pay_link_sent' END,
         buyer_action_at = p_now
   WHERE id = p_installment_id;

  RETURN jsonb_build_object('ok', true, 'link_id', v_link_id, 'expires_at', v_expires);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_issue_pay_link(uuid, text, bytea, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_issue_pay_link(uuid, text, bytea, timestamptz) TO service_role;

-- Store the provider-hosted checkout URL without resolving or counting the
-- attempt. The anonymous pay page can start a transaction, then status polling
-- (or the webhook) remains the only path that settles it.
CREATE OR REPLACE FUNCTION public.issue_3645_store_attempt_approval_url(
  p_attempt_id uuid,
  p_approval_url text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_installment_id uuid;
  v_attempt public.order_installment_charge_attempts;
BEGIN
  IF p_approval_url IS NULL OR btrim(p_approval_url) !~ '^https://checkout\.paystack\.com/' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'approval_url_invalid');
  END IF;
  SELECT installment_id INTO v_installment_id
    FROM public.order_installment_charge_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); END IF;
  PERFORM public.issue_3645_lock_installment_graph(v_installment_id);
  SELECT * INTO v_attempt FROM public.order_installment_charge_attempts
   WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.state NOT IN ('created', 'unknown') OR v_attempt.method NOT IN ('pay_link', 'approve') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_open');
  END IF;
  UPDATE public.order_installment_charge_attempts
     SET approval_url = btrim(p_approval_url),
         approval_url_expires_at = p_now + interval '24 hours'
   WHERE id = p_attempt_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_store_attempt_approval_url(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_store_attempt_approval_url(uuid, text, timestamptz)
  TO service_role;

-- Display-safe view of one link. Unknown, expired and replaced links all answer
-- the identical {state:'invalid'} (no oracle on which part failed). A link
-- revoked because its instalment was paid, cancelled or refunded still answers
-- paid / no_longer_due.
CREATE OR REPLACE FUNCTION public.issue_3645_resolve_pay_link(
  p_token_hash bytea,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_link public.order_installment_pay_links;
  v_inst public.order_installments;
  v_order public.orders;
  v_event public.events;
  v_brand_name text;
  v_state text;
  v_total integer;
  v_last4 text;
  v_fresh boolean;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  SELECT * INTO v_link FROM public.order_installment_pay_links WHERE token_hash = p_token_hash;
  IF NOT FOUND
     OR v_link.expires_at <= p_now
     OR (v_link.revoked_at IS NOT NULL
         AND coalesce(v_link.revoked_reason, '') NOT IN
             ('installment_collected', 'installment_cancelled', 'installment_refunded')) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  SELECT * INTO v_inst FROM public.order_installments WHERE id = v_link.installment_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_inst.order_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  SELECT b.name INTO v_brand_name FROM public.brands b WHERE b.id = v_event.brand_id;

  v_state := CASE
    WHEN v_inst.status = 'collected' THEN 'paid'
    WHEN v_inst.status IN ('cancelled', 'refunded') OR v_inst.cancelled_at IS NOT NULL
      OR v_order.cancelled_at IS NOT NULL OR v_event.status = 'cancelled' THEN 'no_longer_due'
    WHEN v_inst.status IN ('scheduled', 'failed') THEN 'payable'
    ELSE 'no_longer_due' END;

  UPDATE public.order_installment_pay_links
     SET open_count = open_count + 1, last_opened_at = p_now
   WHERE id = v_link.id;

  SELECT count(*)::integer + 1 INTO v_total
    FROM public.order_installments WHERE order_id = v_inst.order_id;
  IF v_link.purpose = 'approve' THEN
    SELECT a.last4 INTO v_last4 FROM private.order_payment_authorizations a WHERE a.order_id = v_inst.order_id;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.order_installment_charge_attempts at
     WHERE at.installment_id = v_inst.id AND at.state = 'paused'
       AND at.approval_url IS NOT NULL AND at.approval_url_expires_at > p_now
  ) INTO v_fresh;

  RETURN jsonb_build_object(
    'state', v_state,
    'installment_id', v_inst.id,
    'purpose', v_link.purpose,
    'trip_title', v_event.title,
    'brand_name', v_brand_name,
    'amount_cents', coalesce(v_inst.buyer_total_cents, v_inst.amount_cents),
    'currency', trim(v_inst.currency),
    'due_at', v_inst.due_at,
    -- The deposit is payment 1, so instalment ordinal n is payment n + 1.
    'ordinal', v_inst.ordinal + 1,
    'total_payments', v_total,
    'card_last4', v_last4,
    'approval_url_fresh', v_fresh
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_3645_resolve_pay_link(bytea, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_resolve_pay_link(bytea, timestamptz) TO service_role;

COMMIT;
