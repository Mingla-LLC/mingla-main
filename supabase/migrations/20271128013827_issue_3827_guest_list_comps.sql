-- issue #3827 — guest-list comps: a host puts people on the guest list without
-- checkout, and each person gets a REAL free ticket (the standard free-ticket
-- email, QR code, PDF and calendar file). Door staff scan the QR or find the
-- guest by name and admit through the existing scan ladder.
--
-- Guest-list tickets take a place (ticket_types.sold_count, per-night taken)
-- and count as going, because they are ordinary live `tickets` rows. They are
-- never sold, revenue, Mingla fee or payout: every money path already requires
-- money (total_cents > 0, a fee snapshot, a charged remainder) or
-- source = 'online_checkout', and `orders_comp_shape_check` below makes a comp
-- with money unconstructible (I-3827-COMP-NO-MONEY).
--
-- BEFORE MERGE: apply this migration on production (Seth's migration chat),
-- because merging auto-deploys `supabase/functions/guest-list`, which calls
-- these functions. Before applying, compare pg_get_functiondef on production
-- for issue_1930_ticket_checkout_finalize_base and biz_guest_roster_project
-- with the repo bodies (20271121003281 and 20270319000873). If either differs,
-- STOP. Same practice as 20271107003872.
--
-- Contents:
--   §1  orders: source 'comp', comp columns, shape checks, indexes
--   §2  issue_3827_mint_ticket — THE ONE MINT (extracted verbatim from finalize)
--   §3  issue_1930_ticket_checkout_finalize_base — one hunk: call the mint
--   §4  issue_3827_can_door_scan — the scan permission predicate, named
--   §5  issue_3827_comp_issue_one — one person's comp order (reused by links)
--   §6  biz_comp_issue / biz_comp_cancel / biz_comp_resend_prepare
--   §7  biz_door_guest_search / biz_ticket_admit_by_id
--   §8  biz_guest_roster_project — two additive hunks (guestList)
--   §9  postchecks

BEGIN;
SET LOCAL lock_timeout = '10s';

-- =============================================================================
-- §1. orders — a dedicated source value and the comp columns
-- =============================================================================
-- `comp`, not `manual_import`: manual_import means "a sale that happened
-- elsewhere" and may one day carry money. Every comp exclusion keys on the one
-- exact predicate source = 'comp'.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_source_check
  CHECK (source = ANY (ARRAY['online_checkout'::text, 'door_sale'::text, 'manual_import'::text, 'legacy'::text, 'comp'::text]));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS comp_issued_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comp_reason text NULL,
  ADD COLUMN IF NOT EXISTS comp_request_key text NULL,
  ADD COLUMN IF NOT EXISTS comp_party_lead_order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  -- The private-links piece of #3827 attributes comps to a link. The column
  -- lands here so issue_3827_comp_issue_one can write it today; that piece adds
  -- the foreign key to its links table when the table exists.
  ADD COLUMN IF NOT EXISTS ticket_link_id uuid NULL;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_comp_reason_length;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_comp_reason_length
  CHECK (comp_reason IS NULL OR char_length(btrim(comp_reason)) BETWEEN 1 AND 200);

-- I-3827-COMP-NO-MONEY (schema half). A comp carries no money and no provider
-- reference, ever. DELETE THIS and a comp with a price or a payment intent can
-- be written, and every "a comp is never money" argument becomes a hope.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_comp_shape_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_comp_shape_check
  CHECK (
    source <> 'comp'
    OR (
      total_cents = 0
      AND payment_method = 'free'
      AND stripe_payment_intent_id IS NULL
      AND stripe_charge_id IS NULL
      AND stripe_application_fee_amount_cents = 0
      AND COALESCE(buyer_total_cents, 0) = 0
      AND COALESCE(buyer_fees_cents, 0) = 0
      AND COALESCE(tax_cents, 0) = 0
      AND is_door_sale = false
      AND comp_request_key IS NOT NULL
    )
  ) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_comp_shape_check;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_comp_fields_only_on_comp;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_comp_fields_only_on_comp
  CHECK (
    source = 'comp'
    OR (comp_issued_by IS NULL AND comp_reason IS NULL AND comp_request_key IS NULL
        AND comp_party_lead_order_id IS NULL)
  ) NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_comp_fields_only_on_comp;

-- A plus-one points at its guest's order; never at itself.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_comp_party_shape;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_comp_party_shape
  CHECK (comp_party_lead_order_id IS NULL OR (source = 'comp' AND comp_party_lead_order_id <> id))
  NOT VALID;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_comp_party_shape;

-- A guest-list cancel takes an OPTIONAL short reason ("No-show list"); a sale
-- cancel keeps its 10-character minimum from ORCH-0787.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cancellation_reason_length;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_length
  CHECK (
    cancellation_reason IS NULL
    OR length(trim(cancellation_reason)) BETWEEN 10 AND 200
    OR (source = 'comp' AND length(trim(cancellation_reason)) BETWEEN 1 AND 200)
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_comp_request_key_uidx
  ON public.orders (comp_request_key) WHERE comp_request_key IS NOT NULL;
-- One live guest-list ticket per email per event; race-safe.
CREATE UNIQUE INDEX IF NOT EXISTS orders_comp_live_email_uidx
  ON public.orders (event_id, lower(buyer_email))
  WHERE source = 'comp' AND payment_status = 'paid' AND buyer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_event_comp_idx
  ON public.orders (event_id, created_at DESC) WHERE source = 'comp';
CREATE INDEX IF NOT EXISTS orders_comp_issued_by_idx
  ON public.orders (comp_issued_by, created_at DESC) WHERE source = 'comp';
CREATE INDEX IF NOT EXISTS orders_comp_party_lead_idx
  ON public.orders (comp_party_lead_order_id) WHERE comp_party_lead_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_ticket_link_idx
  ON public.orders (ticket_link_id) WHERE ticket_link_id IS NOT NULL;

COMMENT ON COLUMN public.orders.comp_issued_by IS
  'issue #3827: the team member who put this guest on the guest list (source = comp).';
COMMENT ON COLUMN public.orders.comp_reason IS
  'issue #3827: optional host-internal note for a guest-list ticket. Never returned by a buyer or public reader.';
COMMENT ON COLUMN public.orders.comp_request_key IS
  'issue #3827: idempotency key of a guest-list issue, comp:<eventId>:<clientRequestId>:<guestIndex>[:p<plusOneIndex>].';
COMMENT ON COLUMN public.orders.comp_party_lead_order_id IS
  'issue #3827: on a named plus-one''s comp order, the order of the guest they came with. One level only.';
COMMENT ON COLUMN public.orders.ticket_link_id IS
  'issue #3827: the private link this order came through (private-links piece). NULL for host-added comps.';

-- =============================================================================
-- §2. issue_3827_mint_ticket — THE ONE MINT (I-3827-ONE-MINT)
-- =============================================================================
-- The body is the per-ticket block of issue_1930_ticket_checkout_finalize_base
-- (20271121003281), moved here verbatim: token, its hash, the signed QR
-- payload, the tickets row. The caller has already asserted the pepper with
-- biz_ticket_checkout_assert_qr_pepper. Bought tickets and guest-list tickets
-- are minted by this one function, so their QR codes can never drift apart.
CREATE OR REPLACE FUNCTION public.issue_3827_mint_ticket(
  p_order_id uuid,
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_attendee_name text,
  p_attendee_email text,
  p_attendee_phone text,
  p_qr_token_pepper text,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
BEGIN
  v_ticket_id := gen_random_uuid();
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := public.biz_ticket_checkout_token_hash(v_token, p_qr_token_pepper);
  v_qr := public.biz_ticket_checkout_qr_payload(
    v_ticket_id,
    v_token_hash,
    p_qr_token_pepper
  );

  INSERT INTO public.tickets (
    id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
    attendee_phone, qr_code, qr_token_hash, status, approval_status, created_at,
    issued_at,
    -- issue #3281 R2: group passes admit up to group_max; else 1.
    admits_count
  ) VALUES (
    v_ticket_id, p_order_id, p_ticket_type_id, p_event_id,
    p_attendee_name, p_attendee_email, p_attendee_phone,
    v_qr, v_token_hash, 'valid', 'auto', p_now, p_now,
    COALESCE((
      SELECT GREATEST(1, tt.group_max)
        FROM public.ticket_types tt
       WHERE tt.id = p_ticket_type_id
         AND COALESCE(tt.price_basis, 'person') = 'group'
    ), 1)
  );

  RETURN jsonb_build_object('ticketId', v_ticket_id, 'qrPayload', v_qr);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_mint_ticket(uuid, uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3827_mint_ticket(uuid, uuid, uuid, text, text, text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_mint_ticket(uuid, uuid, uuid, text, text, text, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.issue_3827_mint_ticket(uuid, uuid, uuid, text, text, text, text, timestamptz) IS
  'issue #3827 I-3827-ONE-MINT: the one place a ticket QR is minted (checkout finalize and guest-list comps). Caller asserts the pepper.';

-- =============================================================================
-- §3. issue_1930_ticket_checkout_finalize_base — ONE hunk
-- =============================================================================
-- Re-emitted from 20271121003281_issue_3281_r2_checkout_units.sql. The only
-- change: the per-ticket mint block is a call to issue_3827_mint_ticket (plus
-- the one local that holds its result). The structural test
-- issue_3827_comps_finalize_one_hunk.structural.test.ts proves nothing else
-- moved.
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
       AND p_stripe_customer_id_on_connected_account IS NOT NULL
       AND p_saved_payment_method_id IS NOT NULL
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
          order_id, ordinal, amount_cents, currency, due_at, status
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled'
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
    IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN
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
-- §4. issue_3827_can_door_scan — the scan permission predicate, named
-- =============================================================================
-- EXACTLY the gate of biz_ticket_scan (20271109003281): an event_scanners row
-- with scan permission, or an accepted, not-removed brand `scanner`. Used by
-- door name search and the manual admit pre-check. The admit itself still runs
-- biz_ticket_scan, whose own copy of this gate stays authoritative.
CREATE OR REPLACE FUNCTION public.issue_3827_can_door_scan(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
        FROM public.event_scanners es
       WHERE es.event_id = p_event_id
         AND es.user_id = p_user_id
         AND es.removed_at IS NULL
         AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
        INNER JOIN public.brand_team_members m ON m.brand_id = e.brand_id
       WHERE e.id = p_event_id
         AND m.user_id = p_user_id
         AND m.role = 'scanner'
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_can_door_scan(uuid, uuid) TO service_role;

-- =============================================================================
-- §5. issue_3827_comp_issue_one — one person's guest-list order
-- =============================================================================
-- Shared per-person helper (spec-links §2.8, amendment 1 §2.1). Writes the comp
-- order, its line item, p_party_size tickets through THE ONE MINT, the day
-- rows, the chat add and the notification rows. Replays by p_request_key.
--
-- It RAISES on every error and catches nothing: biz_comp_issue wraps each
-- person in its own sub-block; the private-links callers do not catch at all,
-- so one failure rolls a whole sign-up group back. Capacity, permission and
-- event gates belong to the CALLER, under the caller's locks.
CREATE OR REPLACE FUNCTION public.issue_3827_comp_issue_one(
  p_event_id uuid,
  p_brand_id uuid,
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_name text,
  p_email text,
  p_phone_e164 text,
  p_party_size integer,
  p_request_key text,
  p_qr_token_pepper text,
  p_issued_by uuid DEFAULT NULL,
  p_ticket_link_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_party_lead_order_id uuid DEFAULT NULL,
  p_party_lead_name text DEFAULT NULL,
  p_party_origin text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pepper text;
  v_existing record;
  v_lead record;
  v_order_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_currency char(3);
  v_name text := btrim(COALESCE(p_name, ''));
  v_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_phone text := NULLIF(btrim(COALESCE(p_phone_e164, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_metadata jsonb;
  v_mint jsonb;
  v_ticket_id uuid;
  i integer;
BEGIN
  v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF p_request_key IS NULL OR btrim(p_request_key) = '' THEN
    RAISE EXCEPTION 'comp_request_key_required';
  END IF;

  -- Replay: the same request key is the same person, already issued.
  SELECT o.id, o.buyer_email, o.payment_status,
         (SELECT count(*)::integer FROM public.tickets t WHERE t.order_id = o.id) AS ticket_count
    INTO v_existing
    FROM public.orders o
   WHERE o.comp_request_key = p_request_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'replayed',
      'orderId', v_existing.id,
      'ticketCount', v_existing.ticket_count,
      'emailQueued', false,
      'smsQueued', false
    );
  END IF;

  -- Programming-error guards (callers validate first; these keep the
  -- invariants true for every caller, including future ones).
  IF p_party_size IS NULL OR p_party_size < 1 OR p_party_size > 10 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'party_size';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
  END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'note';
  END IF;
  -- I-3827-COMP-HAS-ORIGIN: a team member or a link is responsible for it.
  IF p_issued_by IS NULL AND p_ticket_link_id IS NULL THEN
    RAISE EXCEPTION 'comp_origin_required';
  END IF;
  IF p_party_origin IS NOT NULL AND p_party_origin NOT IN ('host', 'link') THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'party_origin';
  END IF;

  -- I-3827-PARTY-ONE-LEVEL: a plus-one's lead is itself a lead.
  IF p_party_lead_order_id IS NOT NULL THEN
    SELECT o.id, o.event_id, o.source, o.comp_party_lead_order_id
      INTO v_lead
      FROM public.orders o
     WHERE o.id = p_party_lead_order_id;
    IF NOT FOUND OR v_lead.source <> 'comp' OR v_lead.event_id <> p_event_id
       OR v_lead.comp_party_lead_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'party_nesting_not_allowed';
    END IF;
  END IF;

  SELECT COALESCE(tt.currency, b.default_currency, b.provisional_currency_code, 'GBP')
    INTO v_currency
    FROM public.ticket_types tt
    JOIN public.events e ON e.id = tt.event_id
    JOIN public.brands b ON b.id = e.brand_id
   WHERE tt.id = p_ticket_type_id
     AND tt.event_id = p_event_id
     AND b.id = p_brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_type_not_found';
  END IF;

  v_metadata := jsonb_build_object('comp', true, 'marketing_opt_in', false, 'issue', '3827')
    || CASE WHEN p_party_lead_order_id IS NOT NULL THEN jsonb_build_object(
         'party_lead_name', NULLIF(btrim(COALESCE(p_party_lead_name, '')), ''),
         'party_origin', COALESCE(p_party_origin, 'host'))
       ELSE '{}'::jsonb END
    || COALESCE(p_metadata, '{}'::jsonb);

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    source, confirmed_at, notification_status, stripe_application_fee_amount_cents,
    created_at, updated_at, event_date_id,
    list_subtotal_cents, discount_cents, net_subtotal_cents, buyer_fees_cents,
    tax_cents, buyer_total_cents, pricing_source,
    comp_issued_by, comp_reason, comp_request_key, comp_party_lead_order_id, ticket_link_id
  ) VALUES (
    v_order_id, p_event_id, NULL, v_email, v_name, v_phone, v_phone,
    0, v_currency, 'free', 'paid',
    NULL, NULL, false, v_metadata,
    'comp', v_now,
    CASE WHEN v_email IS NULL AND v_phone IS NULL THEN 'not_required' ELSE 'pending' END,
    0,
    v_now, v_now, p_event_date_id,
    0, 0, 0, 0,
    0, 0, 'computed_at_checkout',
    p_issued_by, v_note, p_request_key, p_party_lead_order_id, p_ticket_link_id
  );

  INSERT INTO public.order_line_items (order_id, ticket_type_id, quantity, unit_price_cents, total_cents)
  VALUES (v_order_id, p_ticket_type_id, p_party_size, 0, 0);

  FOR i IN 1..p_party_size LOOP
    v_mint := public.issue_3827_mint_ticket(
      v_order_id, p_event_id, p_ticket_type_id,
      v_name, v_email, v_phone,
      v_pepper, v_now
    );
    v_ticket_id := (v_mint ->> 'ticketId')::uuid;
    IF p_event_date_id IS NOT NULL THEN
      INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
      VALUES (v_ticket_id, p_event_date_id) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(p_event_id, NULL, v_order_id, v_email);

  IF v_email IS NOT NULL THEN
    INSERT INTO public.ticket_order_notifications (
      order_id, event_id, channel, recipient, idempotency_key, payload
    ) VALUES (
      v_order_id, p_event_id, 'email', v_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('source', 'comp')
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.ticket_order_notifications (
      order_id, event_id, channel, recipient, idempotency_key, payload
    ) VALUES (
      v_order_id, p_event_id, 'sms', v_phone,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('source', 'comp')
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'status', 'added',
    'orderId', v_order_id,
    'ticketCount', p_party_size,
    'emailQueued', v_email IS NOT NULL,
    'smsQueued', v_phone IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_comp_issue_one(uuid, uuid, uuid, uuid, text, text, text, integer, text, text, uuid, uuid, text, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3827_comp_issue_one(uuid, uuid, uuid, uuid, text, text, text, integer, text, text, uuid, uuid, text, uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_comp_issue_one(uuid, uuid, uuid, uuid, text, text, text, integer, text, text, uuid, uuid, text, uuid, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.issue_3827_comp_issue_one(uuid, uuid, uuid, uuid, text, text, text, integer, text, text, uuid, uuid, text, uuid, text, text, jsonb) IS
  'issue #3827: one person''s guest-list (comp) order with p_party_size tickets. Replays by request key; raises on any error; callers own locks, gates and capacity. Reused by the private-links piece.';

-- =============================================================================
-- §6a. biz_comp_issue — host adds guests to the guest list
-- =============================================================================
-- p_guests: 1..50 items
--   {index 0..49 unique, name 1..120, email|null, phoneE164|null,
--    plusOnes: [{name|null, email|null, phoneE164|null}] 0..9}
-- A plus-one with a name is its own order (their own email and QR). A blank
-- plus-one is one extra ticket on the guest's own order. Email or phone
-- without a name is invalid.
CREATE OR REPLACE FUNCTION public.biz_comp_issue(
  p_actor_id uuid,
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_guests jsonb,
  p_note text,
  p_client_request_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_actor_hourly_cap constant integer := 300;
  c_brand_daily_cap constant integer := 1000;
  v_pepper text;
  v_event record;
  v_tt record;
  v_choice jsonb;
  v_date_id uuid;
  v_per_occurrence boolean := false;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_guest jsonb;
  v_po jsonb;
  v_gi integer;
  v_pi integer;
  v_index integer;
  v_name text;
  v_email text;
  v_phone text;
  v_emails text[] := ARRAY[]::text[];
  v_indexes integer[] := ARRAY[]::integer[];
  v_unnamed integer;
  -- one row per person, in submission order
  v_people jsonb := '[]'::jsonb;
  v_person jsonb;
  v_key text;
  v_existing_id uuid;
  v_dup_id uuid;
  v_dup_lead uuid;
  v_requested integer := 0;
  v_new_orders integer := 0;
  v_sold integer;
  v_held integer;
  v_remaining integer;
  v_recent integer;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_lead_id uuid;
  v_lead_name text;
  v_added integer := 0;
  v_failed integer := 0;
  v_k integer;
BEGIN
  v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF p_actor_id IS NULL OR p_event_id IS NULL OR p_ticket_type_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'note';
  END IF;

  -- ---- 1. Validate and normalise every person (nothing is written yet) ----
  IF p_guests IS NULL OR jsonb_typeof(p_guests) <> 'array'
     OR jsonb_array_length(p_guests) < 1 OR jsonb_array_length(p_guests) > 50 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'count';
  END IF;

  FOR v_gi IN 0 .. jsonb_array_length(p_guests) - 1 LOOP
    v_guest := p_guests -> v_gi;
    IF jsonb_typeof(v_guest) <> 'object'
       OR jsonb_typeof(v_guest -> 'index') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_guest -> 'name') IS DISTINCT FROM 'string'
       OR COALESCE(jsonb_typeof(v_guest -> 'email'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'phoneE164'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'plusOnes'), 'array') <> 'array' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'shape';
    END IF;
    IF (v_guest ->> 'index') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'index';
    END IF;
    v_index := (v_guest ->> 'index')::integer;
    IF v_index < 0 OR v_index > 49 OR v_index = ANY (v_indexes) THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'index';
    END IF;
    v_indexes := v_indexes || v_index;

    v_name := btrim(v_guest ->> 'name');
    v_email := NULLIF(lower(btrim(COALESCE(v_guest ->> 'email', ''))), '');
    v_phone := NULLIF(btrim(COALESCE(v_guest ->> 'phoneE164', '')), '');
    IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
    END IF;
    IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
    END IF;
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
    END IF;
    IF v_email IS NOT NULL THEN
      IF v_email = ANY (v_emails) THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'listed_twice';
      END IF;
      v_emails := v_emails || v_email;
    END IF;

    v_unnamed := 0;
    IF jsonb_array_length(COALESCE(v_guest -> 'plusOnes', '[]'::jsonb)) > 9 THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'plus_ones';
    END IF;
    -- The guest goes first; their named plus-ones follow, pointing back.
    v_people := v_people || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'plusOneIndex', NULL, 'name', v_name,
      'email', v_email, 'phone', v_phone, 'partySize', 1));

    FOR v_pi IN 0 .. jsonb_array_length(COALESCE(v_guest -> 'plusOnes', '[]'::jsonb)) - 1 LOOP
      v_po := v_guest -> 'plusOnes' -> v_pi;
      IF jsonb_typeof(v_po) <> 'object'
         OR COALESCE(jsonb_typeof(v_po -> 'name'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'email'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'phoneE164'), 'null') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'shape';
      END IF;
      v_name := NULLIF(btrim(COALESCE(v_po ->> 'name', '')), '');
      v_email := NULLIF(lower(btrim(COALESCE(v_po ->> 'email', ''))), '');
      v_phone := NULLIF(btrim(COALESCE(v_po ->> 'phoneE164', '')), '');
      IF v_name IS NULL THEN
        IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
          -- "Add their name, or leave all three empty."
          RAISE EXCEPTION 'invalid_guests' USING HINT = 'plus_one_needs_name';
        END IF;
        v_unnamed := v_unnamed + 1;
        CONTINUE;
      END IF;
      IF char_length(v_name) > 120 THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
      END IF;
      IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
      END IF;
      IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
      END IF;
      IF v_email IS NOT NULL THEN
        IF v_email = ANY (v_emails) THEN
          RAISE EXCEPTION 'invalid_guests' USING HINT = 'listed_twice';
        END IF;
        v_emails := v_emails || v_email;
      END IF;
      v_people := v_people || jsonb_build_array(jsonb_build_object(
        'index', v_index, 'plusOneIndex', v_pi, 'name', v_name,
        'email', v_email, 'phone', v_phone, 'partySize', 1));
    END LOOP;

    -- Blank plus-ones ride on the guest's own order.
    IF v_unnamed > 0 THEN
      FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
        IF (v_people -> v_k ->> 'index')::integer = v_index
           AND (v_people -> v_k -> 'plusOneIndex') = 'null'::jsonb THEN
          v_people := jsonb_set(v_people, ARRAY[v_k::text, 'partySize'], to_jsonb(1 + v_unnamed));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- ---- 2. Locks, in create-session order: event, brand, ticket type ----
  SELECT e.id, e.brand_id, e.status, e.deleted_at, e.event_type
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE OF e;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_open';
  END IF;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;

  IF public.biz_brand_effective_rank(v_event.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Visibility is NOT checked: public, hidden, unlisted and private events
  -- all take guest-list tickets.
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_open';
  END IF;
  IF v_event.event_type IN ('trip', 'experience', 'rsvp') THEN
    RAISE EXCEPTION 'event_type_unsupported';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id AND d.end_at > now()) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  -- The day: the same predicate checkout uses (issue_3313_event_day_choice).
  v_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF p_event_date_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_date_id := p_event_date_id;
  ELSIF (v_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_date_id := (v_choice ->> 'soleOccurrenceId')::uuid;
  ELSIF COALESCE((v_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- Hidden, disabled, offline and out-of-window tiers ARE allowed: a comp is a
  -- host grant, not a sale.
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited, tt.sold_count
    INTO v_tt
    FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id
     AND tt.event_id = p_event_id
     AND tt.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_type_not_found';
  END IF;

  -- ---- 3. Replays and duplicates do not count against capacity ----
  FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
    v_person := v_people -> v_k;
    v_key := 'comp:' || p_event_id::text || ':' || p_client_request_id::text || ':' || (v_person ->> 'index')
      || CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN '' ELSE ':p' || (v_person ->> 'plusOneIndex') END;
    v_person := v_person || jsonb_build_object('key', v_key);

    SELECT o.id INTO v_existing_id FROM public.orders o WHERE o.comp_request_key = v_key;
    IF FOUND THEN
      v_person := v_person || jsonb_build_object('plan', 'replay', 'orderId', v_existing_id);
    ELSE
      v_dup_id := NULL;
      IF (v_person ->> 'email') IS NOT NULL THEN
        SELECT o.id, o.comp_party_lead_order_id INTO v_dup_id, v_dup_lead
          FROM public.orders o
         WHERE o.event_id = p_event_id AND o.source = 'comp' AND o.payment_status = 'paid'
           AND lower(o.buyer_email) = (v_person ->> 'email');
      END IF;
      IF v_dup_id IS NOT NULL THEN
        v_person := v_person || jsonb_build_object('plan', 'duplicate', 'orderId', v_dup_id,
          'dupIsLead', v_dup_lead IS NULL);
      ELSE
        v_person := v_person || jsonb_build_object('plan', 'new');
        v_requested := v_requested + (v_person ->> 'partySize')::integer;
        v_new_orders := v_new_orders + 1;
      END IF;
    END IF;
    v_people := jsonb_set(v_people, ARRAY[v_k::text], v_person);
  END LOOP;

  -- ---- 4. Capacity: the whole batch or nothing (I-3827-COMP-COUNTS-CAPACITY) ----
  -- The counter rule of the checkout create-session base (20271121003281).
  -- DELETE THIS BLOCK and a guest list can push a tier past its capacity.
  IF NOT v_tt.is_unlimited AND v_tt.quantity_total IS NOT NULL THEN
    IF v_per_occurrence AND v_date_id IS NOT NULL THEN
      v_remaining := v_tt.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tt.id, v_date_id);
    ELSE
      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tt.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tt.quantity_total - COALESCE(v_tt.sold_count, 0) - v_held;
    END IF;
    IF v_requested > v_remaining THEN
      RAISE EXCEPTION 'ticket_capacity_exceeded'
        USING HINT = jsonb_build_object('remaining', GREATEST(v_remaining, 0), 'ticketName', v_tt.name)::text;
    END IF;
  END IF;

  -- ---- 5. Rate limits (fail CLOSED: issuing sends email) ----
  IF v_new_orders > 0 THEN
    SELECT count(*)::integer INTO v_recent
      FROM public.orders o
     WHERE o.source = 'comp' AND o.comp_issued_by = p_actor_id
       AND o.created_at > now() - interval '1 hour';
    IF v_recent + v_new_orders > c_actor_hourly_cap THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
    SELECT count(*)::integer INTO v_recent
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
     WHERE e.brand_id = v_event.brand_id AND o.source = 'comp'
       AND o.created_at > now() - interval '1 day';
    IF v_recent + v_new_orders > c_brand_daily_cap THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
  END IF;

  -- ---- 6. Issue, one person per sub-block ----
  FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
    v_person := v_people -> v_k;

    IF (v_person -> 'plusOneIndex') = 'null'::jsonb THEN
      -- A guest. Their named plus-ones (next rows) attach to this order.
      v_lead_id := NULL;
      v_lead_name := v_person ->> 'name';
    END IF;

    IF (v_person -> 'plusOneIndex') <> 'null'::jsonb AND v_lead_id IS NULL
       AND (v_person ->> 'plan') = 'new' THEN
      v_one := jsonb_build_object('status', 'failed', 'code', 'lead_not_added');
    ELSIF (v_person ->> 'plan') = 'duplicate' THEN
      v_one := jsonb_build_object('status', 'failed', 'code', 'already_on_guest_list');
      -- A guest already on the list: their new plus-ones join that order.
      IF (v_person -> 'plusOneIndex') = 'null'::jsonb AND (v_person ->> 'dupIsLead')::boolean THEN
        v_lead_id := (v_person ->> 'orderId')::uuid;
      END IF;
    ELSE
      BEGIN
        v_one := public.issue_3827_comp_issue_one(
          p_event_id => p_event_id,
          p_brand_id => v_event.brand_id,
          p_ticket_type_id => p_ticket_type_id,
          p_event_date_id => v_date_id,
          p_name => v_person ->> 'name',
          p_email => v_person ->> 'email',
          p_phone_e164 => v_person ->> 'phone',
          p_party_size => (v_person ->> 'partySize')::integer,
          p_request_key => v_person ->> 'key',
          p_qr_token_pepper => v_pepper,
          p_issued_by => p_actor_id,
          p_note => v_note,
          p_party_lead_order_id => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE v_lead_id END,
          p_party_lead_name => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE v_lead_name END,
          p_party_origin => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE 'host' END
        );
        IF (v_person -> 'plusOneIndex') = 'null'::jsonb THEN
          v_lead_id := (v_one ->> 'orderId')::uuid;
        END IF;
      EXCEPTION
        WHEN unique_violation THEN
          v_one := jsonb_build_object('status', 'failed', 'code', 'already_on_guest_list');
        WHEN OTHERS THEN
          -- No PII in the log line.
          RAISE WARNING 'biz_comp_issue: person % of event % failed: %', v_k, p_event_id, SQLSTATE;
          v_one := jsonb_build_object('status', 'failed', 'code', 'internal');
      END;
    END IF;

    IF (v_one ->> 'status') = 'failed' THEN
      v_failed := v_failed + 1;
    ELSE
      v_added := v_added + 1;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'index', (v_person ->> 'index')::integer,
      'plusOneIndex', v_person -> 'plusOneIndex',
      'status', v_one ->> 'status',
      'orderId', v_one ->> 'orderId',
      'ticketCount', (v_one ->> 'ticketCount')::integer,
      'emailQueued', COALESCE((v_one ->> 'emailQueued')::boolean, false),
      'code', v_one ->> 'code'
    ));
  END LOOP;

  -- Places left after this call, for the host's sheet.
  v_remaining := NULL;
  IF NOT v_tt.is_unlimited AND v_tt.quantity_total IS NOT NULL THEN
    IF v_per_occurrence AND v_date_id IS NOT NULL THEN
      v_remaining := v_tt.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tt.id, v_date_id);
    ELSE
      SELECT tt.sold_count INTO v_sold FROM public.ticket_types tt WHERE tt.id = v_tt.id;
      v_remaining := v_tt.quantity_total - COALESCE(v_sold, 0) - COALESCE(v_held, 0);
    END IF;
    v_remaining := GREATEST(v_remaining, 0);
  END IF;

  RETURN jsonb_build_object(
    'eventId', p_event_id,
    'eventDateId', v_date_id,
    'results', v_results,
    'addedCount', v_added,
    'failedCount', v_failed,
    'remaining', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_comp_issue(uuid, uuid, uuid, uuid, jsonb, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_comp_issue(uuid, uuid, uuid, uuid, jsonb, text, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_comp_issue(uuid, uuid, uuid, uuid, jsonb, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.biz_comp_issue(uuid, uuid, uuid, uuid, jsonb, text, uuid, text) IS
  'issue #3827: event managers add guest-list guests (named plus-ones become their own orders). All-or-nothing on capacity, per-person on everything else. Called by the guest-list edge function with the verified actor.';

-- =============================================================================
-- §6b. biz_comp_cancel — void a guest-list ticket; no money moves
-- =============================================================================
-- I-3827-COMP-CANCEL-NO-REFUND: no refund, provider or payout code is reached.
-- The sold_count trigger frees the places (I-3827-COMP-COUNTS-CAPACITY).
CREATE OR REPLACE FUNCTION public.biz_comp_cancel(
  p_actor_id uuid,
  p_order_id uuid,
  p_reason text,
  p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_now timestamptz := now();
  v_email_queued boolean := false;
BEGIN
  IF p_actor_id IS NULL OR p_order_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT o.id, o.event_id, o.source, o.payment_status, o.cancelled_at, o.buyer_email, e.brand_id
    INTO v_order
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
   WHERE o.id = p_order_id
   FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_a_guest_list_ticket';
  END IF;
  IF public.biz_brand_effective_rank(v_order.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_order.source <> 'comp' THEN
    RAISE EXCEPTION 'not_a_guest_list_ticket';
  END IF;
  IF v_order.payment_status = 'cancelled' THEN
    RETURN jsonb_build_object('orderId', p_order_id, 'status', 'cancelled',
      'idempotentReplay', true, 'emailQueued', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tickets t WHERE t.order_id = p_order_id AND t.used_at IS NOT NULL) THEN
    RAISE EXCEPTION 'comp_already_checked_in';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length';
  END IF;

  UPDATE public.orders
     SET payment_status = 'cancelled',
         cancelled_at = v_now,
         cancelled_by = p_actor_id,
         cancellation_reason = v_reason,
         updated_at = v_now
   WHERE id = p_order_id;

  UPDATE public.tickets
     SET status = 'void'
   WHERE order_id = p_order_id
     AND status = 'valid';

  -- Q7 (Seth, 2026-10-20): the guest is told, with the existing cancellation
  -- email (template buyer_order_cancelled, routed by the dispatcher).
  IF v_order.buyer_email IS NOT NULL THEN
    INSERT INTO public.ticket_order_notifications (
      order_id, event_id, channel, recipient, status, idempotency_key, payload
    ) VALUES (
      p_order_id, v_order.event_id, 'email', v_order.buyer_email, 'pending',
      'cancel:' || p_order_id::text || ':' || p_client_request_id::text,
      jsonb_build_object('template_key', 'buyer_order_cancelled', 'reason', COALESCE(v_reason, ''), 'source', 'comp')
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    v_email_queued := true;
  END IF;

  RETURN jsonb_build_object('orderId', p_order_id, 'status', 'cancelled',
    'idempotentReplay', false, 'emailQueued', v_email_queued);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_comp_cancel(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_comp_cancel(uuid, uuid, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_comp_cancel(uuid, uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.biz_comp_cancel(uuid, uuid, text, uuid) IS
  'issue #3827: cancel a guest-list ticket. Voids its valid tickets, frees the places, emails the guest. Never touches refunds or providers. Refused once anyone in it is checked in.';

-- =============================================================================
-- §6c. biz_comp_resend_prepare — queue a fresh ticket email
-- =============================================================================
-- Q10 (Seth, 2026-10-20, discovery D-1): widened from guest-list orders to ANY
-- paid order of the event, so the order screen's "Resend ticket" (dead since
-- it called the dispatcher with a user JWT) works through guest-list `resend`.
CREATE OR REPLACE FUNCTION public.biz_comp_resend_prepare(
  p_actor_id uuid,
  p_order_id uuid,
  p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_hourly_cap constant integer := 3;
  v_order record;
  v_recent integer;
  v_key text;
BEGIN
  IF p_actor_id IS NULL OR p_order_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT o.id, o.event_id, o.source, o.payment_status, o.buyer_email, e.brand_id
    INTO v_order
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
   WHERE o.id = p_order_id
   FOR UPDATE OF o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_resendable';
  END IF;
  IF public.biz_brand_effective_rank(v_order.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'not_resendable';
  END IF;
  IF v_order.buyer_email IS NULL OR btrim(v_order.buyer_email) = '' THEN
    RAISE EXCEPTION 'no_email';
  END IF;

  v_key := 'ticket_resend:' || p_order_id::text || ':' || p_client_request_id::text;
  IF EXISTS (SELECT 1 FROM public.ticket_order_notifications n WHERE n.idempotency_key = v_key) THEN
    RETURN jsonb_build_object('orderId', p_order_id, 'queued', true, 'idempotentReplay', true);
  END IF;

  SELECT count(*)::integer INTO v_recent
    FROM public.ticket_order_notifications n
   WHERE n.order_id = p_order_id
     AND n.idempotency_key LIKE 'ticket_resend:%'
     AND n.created_at > now() - interval '1 hour';
  IF v_recent >= c_hourly_cap THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES (
    p_order_id, v_order.event_id, 'email', v_order.buyer_email, v_key,
    jsonb_build_object('source', v_order.source, 'resend', true)
  );

  RETURN jsonb_build_object('orderId', p_order_id, 'queued', true, 'idempotentReplay', false);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_comp_resend_prepare(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_comp_resend_prepare(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_comp_resend_prepare(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.biz_comp_resend_prepare(uuid, uuid, uuid) IS
  'issue #3827: queue a ticket re-send for any paid order of the event (event manager and above), at most 3 an hour per order. The guest-list edge function dispatches it with the service key.';

-- =============================================================================
-- §7a. biz_door_guest_search — find a ticket holder by name at the door
-- =============================================================================
-- Q8 (Seth): every ticket holder, not only guest-list guests. Minimal fields:
-- no phone, no full email, no price, no note.
CREATE OR REPLACE FUNCTION public.biz_door_guest_search(
  p_actor_id uuid,
  p_event_id uuid,
  p_query text,
  p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand uuid;
  v_q text := btrim(COALESCE(p_query, ''));
  v_like text;
  v_prefix text;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 20);
  v_rows jsonb;
  v_total integer;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT (public.issue_3827_can_door_scan(p_event_id, p_actor_id)
          OR public.biz_brand_effective_rank(v_brand, p_actor_id) >= public.biz_role_rank('event_manager')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF char_length(v_q) < 2 THEN
    RAISE EXCEPTION 'query_too_short';
  END IF;
  IF char_length(v_q) > 80 THEN
    RAISE EXCEPTION 'query_too_long';
  END IF;

  -- Literal match only: % _ and \ are escaped.
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_like := '%' || v_q || '%';
  v_prefix := lower(v_q) || '%';

  WITH matches AS (
    SELECT o.id, o.buyer_name, o.buyer_email, o.source, o.metadata, o.created_at,
           CASE WHEN lower(COALESCE(o.buyer_name, '')) LIKE v_prefix ESCAPE '\' THEN 0 ELSE 1 END AS rank
      FROM public.orders o
     WHERE o.event_id = p_event_id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND (
         o.buyer_name ILIKE v_like ESCAPE '\'
         OR lower(COALESCE(o.buyer_email, '')) LIKE v_prefix ESCAPE '\'
         OR EXISTS (SELECT 1 FROM public.tickets t
                     WHERE t.order_id = o.id AND t.attendee_name ILIKE v_like ESCAPE '\')
       )
  ), counted AS (
    SELECT count(*)::integer AS n FROM matches
  ), picked AS (
    SELECT * FROM matches ORDER BY rank, lower(COALESCE(buyer_name, '')), created_at, id LIMIT v_limit
  )
  SELECT (SELECT n FROM counted),
         COALESCE(jsonb_agg(jsonb_build_object(
           'orderId', p.id,
           'displayName', COALESCE(NULLIF(btrim(p.buyer_name), ''), 'Guest'),
           'maskedEmail', CASE
             WHEN p.buyer_email IS NULL OR position('@' in p.buyer_email) < 2 THEN NULL
             ELSE left(split_part(p.buyer_email, '@', 1),
                       CASE WHEN char_length(split_part(p.buyer_email, '@', 1)) <= 2 THEN 1 ELSE 2 END)
                  || '***@' || split_part(p.buyer_email, '@', 2)
           END,
           'isGuestList', p.source = 'comp',
           'cameWithName', CASE WHEN p.source = 'comp'
             THEN NULLIF(btrim(COALESCE(p.metadata ->> 'party_lead_name', '')), '') END,
           'tickets', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'ticketId', t.id,
                      'ticketName', tt.name,
                      'status', t.status,
                      'usedAt', t.used_at,
                      'eventDateIds', COALESCE((
                        SELECT jsonb_agg(ted.event_date_id ORDER BY ted.event_date_id)
                          FROM public.ticket_event_dates ted WHERE ted.ticket_id = t.id), '[]'::jsonb)
                    ) ORDER BY t.created_at, t.id)
               FROM public.tickets t
               JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
              WHERE t.order_id = p.id), '[]'::jsonb)
         ) ORDER BY p.rank, lower(COALESCE(p.buyer_name, '')), p.created_at, p.id), '[]'::jsonb)
    INTO v_total, v_rows
    FROM picked p;

  RETURN jsonb_build_object('orders', v_rows, 'truncated', COALESCE(v_total, 0) > v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_door_guest_search(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_door_guest_search(uuid, uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_door_guest_search(uuid, uuid, text, integer) TO service_role;

COMMENT ON FUNCTION public.biz_door_guest_search(uuid, uuid, text, integer) IS
  'issue #3827: door name search over every ticket holder of the event. Scanner or event manager. Returns masked email only; no phone, price or note.';

-- =============================================================================
-- §7b. biz_ticket_admit_by_id — admit a ticket found by name
-- =============================================================================
-- I-3827-MANUAL-ADMIT-ONE-LADDER: the admit IS biz_ticket_scan, given the
-- ticket's own QR. Permission, the day ladder, duplicate detection, the time
-- window and the scan_events row all come from that one function. This
-- function never writes scan_events itself; it only tags the row it produced.
CREATE OR REPLACE FUNCTION public.biz_ticket_admit_by_id(
  p_actor_id uuid,
  p_event_id uuid,
  p_ticket_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ticket record;
  v jsonb;
BEGIN
  IF NOT public.issue_3827_can_door_scan(p_event_id, p_actor_id) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  SELECT t.qr_code, t.event_id INTO v_ticket FROM public.tickets t WHERE t.id = p_ticket_id;
  -- A ticket of another event is "not found" here, with no scan row, so this
  -- door cannot probe other events' tickets.
  IF NOT FOUND OR v_ticket.event_id <> p_event_id THEN
    RETURN jsonb_build_object('result', 'not_found', 'ticketId', NULL);
  END IF;

  v := public.biz_ticket_scan(p_event_id, v_ticket.qr_code, p_actor_id, p_qr_token_pepper);

  IF (v ->> 'scanId') IS NOT NULL THEN
    UPDATE public.scan_events
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('source', 'manual-admit', 'via', 'name_search')
     WHERE id = (v ->> 'scanId')::uuid;
  END IF;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_admit_by_id(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_ticket_admit_by_id(uuid, uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_admit_by_id(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_admit_by_id(uuid, uuid, uuid, text) IS
  'issue #3827: admit a ticket found by name. Delegates to biz_ticket_scan with the ticket''s own QR (one ladder) and tags the scan row manual-admit.';

-- =============================================================================
-- §8. biz_guest_roster_project — two additive hunks
-- =============================================================================
-- Re-emitted from 20270319000873_issue_0873_guest_status_roster.sql. Added:
--   (a) commerce lateral: comp_active_tickets
--   (b) canonical_json / unlinked_orders: 'guestList'
-- Everything else is byte-identical (issue_3827_comps_roster_hunks.structural.test.ts).
CREATE OR REPLACE FUNCTION public.biz_guest_roster_project(p_event_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
WITH event_row AS (
  SELECT e.id,e.brand_id FROM public.events e
  WHERE e.id=p_event_id AND e.deleted_at IS NULL
), canonical_people AS (
  SELECT DISTINCT p.id,p.display_name,p.avatar_url,p.updated_at
  FROM event_row e
  JOIN public.brand_people p ON p.brand_id=e.brand_id AND p.record_status='active'
  WHERE EXISTS (SELECT 1 FROM public.brand_offering_invites i WHERE i.event_id=e.id AND i.brand_person_id=p.id)
     OR EXISTS (
       SELECT 1 FROM public.brand_person_source_links l
       LEFT JOIN public.event_rsvps r ON l.source_kind='event_rsvp' AND r.id=l.source_id
       LEFT JOIN public.orders o ON l.source_kind='order' AND o.id=l.source_id
       LEFT JOIN public.tickets t ON l.source_kind='ticket_holder' AND t.id=l.source_id
       WHERE l.brand_person_id=p.id AND l.detached_at IS NULL
         AND COALESCE(r.event_id,o.event_id,t.event_id)=e.id
     )
), projected AS (
  SELECT
    'person:'||p.id::text AS roster_key,
    p.id AS person_id,
    p.display_name,
    p.avatar_url,
    invite.id AS invite_id,
    invite.status AS invite_record_status,
    invite.invited_at,
    rsvp.id AS rsvp_id,
    rsvp.rsvp_status,
    rsvp.approval_status,
    rsvp.updated_at AS rsvp_at,
    COALESCE(1+rsvp.plus_count,0) AS rsvp_party_size,
    COALESCE(commerce.order_ids,'{}'::uuid[]) AS order_ids,
    COALESCE(commerce.active_tickets,0) AS active_tickets,
    COALESCE(commerce.comp_active_tickets,0) AS comp_active_tickets,
    COALESCE(commerce.refunded_tickets,0) AS refunded_tickets,
    COALESCE(commerce.transferred_tickets,0) AS transferred_tickets,
    GREATEST(COALESCE(commerce.checked_in,0),
      CASE WHEN rsvp.checked_in_at IS NOT NULL THEN 1 ELSE 0 END
        + COALESCE(rsvp_party.checked_in,0)) AS checked_in,
    COALESCE(commerce.has_buyer,false) AS has_buyer,
    COALESCE(commerce.has_refund,false) AS has_refund,
    COALESCE(commerce.has_cancel,false) AS has_cancel,
    COALESCE(commerce.has_transfer,false) AS has_transfer,
    COALESCE(delivery.accepted,false) AS accepted,
    COALESCE(delivery.has_inflight,false) AS has_inflight,
    COALESCE(delivery.has_failure,false) AS has_failure,
    COALESCE(delivery.all_policy_blocked,false) AS all_policy_blocked,
    COALESCE(delivery.retryable,false) AS retryable,
    COALESCE(delivery.attempts,'[]'::jsonb) AS attempts,
    delivery.last_contact_at,
    delivery.last_reminder_at,
    contact.contact_label,
    GREATEST(p.updated_at,invite.updated_at,rsvp.updated_at,commerce.activity_at,delivery.activity_at) AS activity_at
  FROM canonical_people p
  LEFT JOIN LATERAL (
    SELECT i.* FROM public.brand_offering_invites i
    WHERE i.event_id=p_event_id AND i.brand_person_id=p.id
    ORDER BY i.updated_at DESC,i.id DESC LIMIT 1
  ) invite ON true
  LEFT JOIN LATERAL (
    SELECT r.* FROM public.brand_person_source_links l
    JOIN public.event_rsvps r ON l.source_kind='event_rsvp' AND r.id=l.source_id
    WHERE l.brand_person_id=p.id AND l.detached_at IS NULL AND r.event_id=p_event_id
    ORDER BY r.updated_at DESC,r.id DESC LIMIT 1
  ) rsvp ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE g.checked_in_at IS NOT NULL)::integer AS checked_in
    FROM public.event_rsvp_guests g WHERE g.rsvp_id=rsvp.id
  ) rsvp_party ON true
  LEFT JOIN LATERAL (
    WITH person_tickets AS (
      SELECT DISTINCT t.*,o.id AS linked_order_id,o.payment_status,o.updated_at AS order_updated_at
      FROM public.tickets t JOIN public.orders o ON o.id=t.order_id
      WHERE t.event_id=p_event_id AND (
        EXISTS (SELECT 1 FROM public.brand_person_source_links holder
          WHERE holder.brand_person_id=p.id AND holder.source_kind='ticket_holder'
            AND holder.source_id=t.id AND holder.detached_at IS NULL)
        OR (EXISTS (SELECT 1 FROM public.brand_person_source_links buyer
              WHERE buyer.brand_person_id=p.id AND buyer.source_kind='order'
                AND buyer.source_id=o.id AND buyer.detached_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM public.brand_person_source_links holder
              WHERE holder.source_kind='ticket_holder' AND holder.source_id=t.id
                AND holder.detached_at IS NULL))
      )
    )
    SELECT array_agg(DISTINCT t.linked_order_id ORDER BY t.linked_order_id) AS order_ids,
      count(t.id) FILTER (WHERE o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS active_tickets,
      count(t.id) FILTER (WHERE o.source='comp' AND o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS comp_active_tickets,
      count(t.id) FILTER (WHERE t.status='refunded')::integer AS refunded_tickets,
      count(t.id) FILTER (WHERE t.status='transferred')::integer AS transferred_tickets,
      count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)::integer AS checked_in,
      count(DISTINCT t.linked_order_id)>0 AS has_buyer,
      bool_or(o.payment_status IN ('refunded','partial_refund') OR t.status='refunded') AS has_refund,
      bool_or(o.payment_status='cancelled' OR t.status='void') AS has_cancel,
      bool_or(t.status='transferred') AS has_transfer,
      max(GREATEST(t.order_updated_at,t.created_at,COALESCE(t.used_at,t.created_at))) AS activity_at
    FROM person_tickets t JOIN public.orders o ON o.id=t.linked_order_id
  ) commerce ON true
  LEFT JOIN LATERAL (
    WITH latest_retryable_failure AS (
      SELECT a.*,row_number() OVER (
        PARTITION BY a.channel ORDER BY a.attempt_ordinal DESC,a.created_at DESC,a.id DESC
      ) AS channel_rank
      FROM public.brand_offering_invite_delivery_attempts a WHERE a.invite_id=invite.id
    ) SELECT
      bool_or(a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered')) AS accepted,
      bool_or(a.status IN ('queued','sending') AND a.provider_accepted_at IS NULL) AS has_inflight,
      bool_or(a.status='failed') AS has_failure,
      bool_and(a.status='suppressed') AS all_policy_blocked,
      bool_or(a.channel_rank=1 AND a.status='failed' AND a.is_retryable) AS retryable,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at,a.failed_at,a.queued_at,a.created_at)) AS activity_at,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at)) AS last_contact_at,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at)) FILTER (
        WHERE a.attempt_kind='reminder'
          AND (a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered'))
      ) AS last_reminder_at,
      jsonb_agg(jsonb_build_object(
        'channel',a.channel,'status',a.status,
        'providerAccepted',(a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered')),
        'retryable',a.is_retryable,'reason',a.safe_reason_code,
        'occurredAt',COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at,a.failed_at,a.queued_at,a.created_at)
      ) ORDER BY a.created_at DESC,a.id DESC) AS attempts
    FROM latest_retryable_failure a
  ) delivery ON true
  LEFT JOIN LATERAL (
    SELECT c.normalized_value AS contact_label
    FROM public.brand_person_contact_methods c
    WHERE c.brand_person_id=p.id AND c.record_state='active'
      AND c.provenance_scope='brand_owned' AND c.is_exportable
    ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1
  ) contact ON true
), classified AS (
  SELECT x.*,
    CASE
      WHEN x.active_tickets>0 THEN 'bought_ticket'
      WHEN x.rsvp_status='going' AND x.approval_status='approved' THEN 'going'
      WHEN x.rsvp_status='going' AND x.approval_status='pending' THEN 'awaiting_approval'
      WHEN x.approval_status='denied' THEN 'denied'
      WHEN x.rsvp_status='waitlisted' THEN 'waitlisted'
      WHEN x.rsvp_status='maybe' THEN 'maybe'
      WHEN x.rsvp_status='not_going' THEN 'declined'
      WHEN x.has_refund THEN 'refunded'
      WHEN x.has_cancel THEN 'cancelled'
      WHEN x.has_transfer THEN 'transferred'
      WHEN x.invite_record_status='removed' THEN 'removed'
      WHEN x.accepted THEN 'not_responded'
      WHEN x.invite_id IS NOT NULL AND x.has_inflight THEN 'sending'
      WHEN x.invite_id IS NOT NULL AND x.has_failure THEN 'invite_failed'
      WHEN x.invite_id IS NOT NULL AND x.all_policy_blocked THEN 'suppressed_or_skipped'
      WHEN x.invite_id IS NOT NULL THEN 'not_sent'
      WHEN x.rsvp_id IS NOT NULL THEN 'existing_rsvp'
      WHEN x.has_buyer THEN 'existing_buyer'
      ELSE 'unlinked_guest'
    END AS primary_status,
    CASE
      WHEN x.invite_record_status='removed' THEN 'removed'
      WHEN x.accepted THEN 'invited'
      WHEN x.has_inflight THEN 'sending'
      WHEN x.has_failure THEN 'failed'
      WHEN x.all_policy_blocked THEN 'suppressed_or_skipped'
      WHEN x.invite_id IS NOT NULL THEN 'not_sent'
      ELSE 'none'
    END AS invitation_status
  FROM projected x
), canonical_json AS (
  SELECT jsonb_build_object(
    'rosterKey',c.roster_key,'personId',c.person_id,'displayName',c.display_name,
    'avatarUrl',c.avatar_url,'contactLabel',c.contact_label,
    'primaryStatus',c.primary_status,'invitationStatus',c.invitation_status,
    'invitationLabel',NULL,'attempts',c.attempts,
    'party',jsonb_build_object('size',GREATEST(1,c.rsvp_party_size,c.active_tickets+c.refunded_tickets+c.transferred_tickets),
      'activeTickets',c.active_tickets,'refundedTickets',c.refunded_tickets,
      'transferredTickets',c.transferred_tickets,'checkedIn',c.checked_in),
    'rsvpId',c.rsvp_id,'rsvpStatus',c.rsvp_status,'rsvpApprovalStatus',c.approval_status,
    'orderIds',to_jsonb(c.order_ids),
    'latestActivityAt',COALESCE(c.activity_at,now()),'checkedIn',c.checked_in>0,
    'canRemind',c.primary_status IN ('not_responded','maybe')
      AND (c.last_reminder_at IS NULL OR c.last_reminder_at<=now()-interval '24 hours'),
    'canRetry',COALESCE(c.retryable,false),
    'canApprove',c.primary_status='awaiting_approval','canDeny',c.primary_status='awaiting_approval',
    'isExportable',c.person_id IS NOT NULL,
    'guestList',(c.active_tickets>0 AND c.comp_active_tickets=c.active_tickets)
  ) AS row_data FROM classified c
), unlinked_rsvps AS (
  SELECT jsonb_build_object(
    'rosterKey','rsvp:'||r.id::text,'personId',NULL,'displayName',COALESCE(NULLIF(btrim(r.guest_name),''),'Unlinked guest'),
    'avatarUrl',NULL,'contactLabel',NULL,
    'primaryStatus','unlinked_guest','invitationStatus','none','invitationLabel',NULL,'attempts','[]'::jsonb,
    'party',jsonb_build_object('size',1+r.plus_count,'activeTickets',0,'refundedTickets',0,'transferredTickets',0,
      'checkedIn',(CASE WHEN r.checked_in_at IS NOT NULL THEN 1 ELSE 0 END)+(SELECT count(*) FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)),
    'rsvpId',r.id,'rsvpStatus',r.rsvp_status,'rsvpApprovalStatus',r.approval_status,
    'orderIds','[]'::jsonb,'latestActivityAt',r.updated_at,
    'checkedIn',(r.checked_in_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)),
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false
  ) AS row_data
  FROM public.event_rsvps r WHERE r.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.source_kind='event_rsvp' AND l.source_id=r.id AND l.detached_at IS NULL
  )
), unlinked_orders AS (
  SELECT jsonb_build_object(
    'rosterKey','order:'||o.id::text,'personId',NULL,'displayName',COALESCE(NULLIF(btrim(o.buyer_name),''),'Unlinked guest'),
    'avatarUrl',NULL,'contactLabel',NULL,'primaryStatus','unlinked_guest','invitationStatus','none',
    'invitationLabel',NULL,'attempts','[]'::jsonb,
    'party',jsonb_build_object('size',GREATEST(1,count(t.id)),'activeTickets',count(t.id) FILTER (WHERE o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used')),
      'refundedTickets',count(t.id) FILTER (WHERE t.status='refunded'),'transferredTickets',count(t.id) FILTER (WHERE t.status='transferred'),
      'checkedIn',count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)),
    'rsvpId',NULL,'rsvpStatus',NULL,'rsvpApprovalStatus',NULL,
    'orderIds',jsonb_build_array(o.id),'latestActivityAt',o.updated_at,
    'checkedIn',bool_or(t.status='used' OR t.used_at IS NOT NULL),
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false,
    'guestList',o.source='comp'
  ) AS row_data
  FROM public.orders o LEFT JOIN public.tickets t ON t.order_id=o.id
  WHERE o.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.detached_at IS NULL AND l.source_kind='order' AND l.source_id=o.id
  ) GROUP BY o.id
)
SELECT row_data FROM canonical_json
UNION ALL SELECT row_data FROM unlinked_rsvps
UNION ALL SELECT row_data FROM unlinked_orders
$function$;


-- =============================================================================
-- §9. Postchecks — fail the apply rather than ship a half-state
-- =============================================================================
DO $verify$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.issue_1930_ticket_checkout_finalize_base'::regproc);
  IF position('public.issue_3827_mint_ticket(' in v_def) = 0
     OR position('INSERT INTO public.tickets' in v_def) > 0 THEN
    RAISE EXCEPTION 'issue #3827 postcheck: finalize does not mint through issue_3827_mint_ticket';
  END IF;
  IF position('INSERT INTO public.ticket_event_dates' in v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3827 postcheck: finalize lost the #2160 day rows';
  END IF;

  v_def := pg_get_functiondef('public.biz_ticket_admit_by_id(uuid,uuid,uuid,text)'::regprocedure);
  IF position('public.biz_ticket_scan(' in v_def) = 0
     OR position('INSERT INTO public.scan_events' in v_def) > 0 THEN
    RAISE EXCEPTION 'issue #3827 postcheck: manual admit must go through biz_ticket_scan only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_comp_shape_check'
                    AND convalidated) THEN
    RAISE EXCEPTION 'issue #3827 postcheck: orders_comp_shape_check missing or not validated';
  END IF;

  IF has_function_privilege('anon', 'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3827_mint_ticket(uuid,uuid,uuid,text,text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3827_comp_issue_one(uuid,uuid,uuid,uuid,text,text,text,integer,text,text,uuid,uuid,text,uuid,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_ticket_admit_by_id(uuid,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_door_guest_search(uuid,uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3827 postcheck: a guest-list function is executable by anon or authenticated';
  END IF;
END
$verify$;

COMMIT;
