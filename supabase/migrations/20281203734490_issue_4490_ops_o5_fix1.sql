-- Issue #4490, spec 08 O5 fix round 1 (file number 616490): the four defects
-- the independent O5 test found (PASS WITH FIXES). Nothing else changes.
--
-- O5-T3 (P1, money). A paid guest order with two or more lines that sold
-- out after payment could only ever give one of them back: the line refund
-- was one row per order (the source_refunds key), and the whole-order staff
-- refund then answered "already_requested". Now EVERY sold-out line can be
-- resolved, each exactly once (the line row is locked and marked; a replay
-- with the same key answers the first result): refunded (what the guest paid
-- for it, incl. its share of service charge and the order's discount) or
-- swapped (the difference refunded). Several lines in one call or one after
-- another, any order, swap and refund mixed. Each money resolution is its
-- own source_refunds row on the existing rail: source_id is still the ORDER
-- (so payouts, disputes and the provider write-back see it exactly as they
-- see any refund of that order) and the kind is numbered per order
-- (venue_order_line_refund, then venue_order_line_refund_2, _3, ...), which
-- keeps the shared (source_type, source_id, refund_kind) unique key and
-- every ON CONFLICT that relies on it untouched. Amounts telescope: the n-th
-- resolution returns R(basis so far + this basis) - R(basis so far), so the
-- sum of every resolution equals what the guest paid for all those lines,
-- rounding included, and can never pass it; Mingla's fee comes back the same
-- way (pro rata on the running total). The whole-order staff refund
-- (pg_venue_order_mint_refund, via biz_venue_order_refund_decision or a guest
-- cancel) still works for what is left: line refunds no longer count as "the
-- live refund" there, but their money still counts as given back (in flight
-- or processed) and their fee reversals are netted, so the same money is
-- never refunded twice and nothing is stranded. An order with no line refund
-- takes exactly the code path it took before this file.
--
-- O5-T1 (P2, money reporting). Changing opening hours after a close moved
-- payments between days (the close recomputed every payment's day from
-- TODAY's hours). Now a moment's business day is decided by the hours that
-- were in force AT that moment: venue_hours_history keeps every version of a
-- venue's weekly and special hours (captured by triggers on brand_hours and
-- venue_special_hours; the first version is the hours as they were just
-- before the first change, i.e. the hours as they are now when this file
-- runs), and issue_4490_venue_service_date reads the version in force at the
-- moment it is asked about. For the present moment it reads the live tables
-- exactly as before. On top of that the daily close reads the day the Till
-- STORED on the row when the money was recorded (venue_till_payments,
-- venue_till_refunds, venue_till_sales.business_date and opened_business_date)
-- and never recomputes it. A closed day stays readable, closable and
-- reopenable when an hours change moves "today" back a day. Payments whose
-- stored day is missing are backfilled from the hours as they are now.
--
-- O5-T4 (P2, stock). At a station with no kitchen screen the Till marks a
-- sent line served on the spot, so a void with "restock" never gave the unit
-- back. Now the void's switch ("Put it back in stock", default on, sent by the
-- Till) is trusted at a no-screen station: the line's units come back (never
-- more than it took, exactly once). At a station with a screen the rule is
-- unchanged (only a line the screen never started). Off: nothing comes back.
-- Every choice on a counted line is audited (stock.set, via void).
--
-- O5-T2 (formula injection in the day-close CSV) is a client fix
-- (mingla-business/src/utils/dayCloseCsv.ts); nothing here.
--
-- pg_venue_order_finalize_payment is NOT touched. The new table has a
-- venue_id column, so the #2099 pending-venue seal moves (20281203744490).
-- Static SQL; conflicts raise PT409. Every new function is SECURITY DEFINER
-- with search_path '' and internal (service role only) unless noted.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o5f1_patch(p_sig regprocedure, p_old text, p_new text, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O5 fix 1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- T3.1 Line refund kinds: the n-th line refund of an order.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_is_line_refund_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(p_kind = 'venue_order_line_refund' OR p_kind ~ '^venue_order_line_refund_[1-9][0-9]{0,3}$', false);
$function$;

COMMENT ON FUNCTION public.issue_4490_is_line_refund_kind(text) IS
  '#4490 08-O5 fix 1 (O5-T3): a sold-out line refund of a venue order. The first on an order is '
  'venue_order_line_refund, the n-th venue_order_line_refund_<n> (the source_refunds unique key stays '
  '(source_type, source_id, refund_kind) with source_id = the order).';

ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_refund_kind_check CHECK (refund_kind = ANY (ARRAY[
  'venue_eligible_cancel'::text, 'rsvp_discretionary'::text, 'event_cancel'::text, 'stay_cancellation'::text,
  'venue_order_guest_cancel'::text, 'venue_order_venue_approved'::text, 'late_payment_no_value'::text,
  'checkout_provider_reference_unresolved'::text, 'venue_staff_cancel'::text, 'venue_till_refund'::text,
  'venue_deposit_excess'::text, 'venue_order_line_refund'::text])
  OR refund_kind ~ '^venue_order_line_refund_[1-9][0-9]{0,3}$');

-- What a sold-out resolution gives back for a basis (list-price money of the
-- lines being returned: a refunded line's total, or a swapped line's total
-- minus its swap's): the discount shrinks it as the order priced it, then the
-- service charge share is added (half up). R(0) = 0 and R is monotonic, so
-- R(after) - R(before) telescopes to exactly R(all) over any sequence.
CREATE FUNCTION public.issue_4490_sold_out_refund_for_basis(
  p_list_subtotal bigint,
  p_subtotal bigint,
  p_service_charge bigint,
  p_basis bigint
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH paid AS (
    SELECT CASE WHEN COALESCE(p_list_subtotal, 0) > 0 AND p_list_subtotal <> p_subtotal
                THEN floor(GREATEST(p_basis, 0)::numeric * p_subtotal / p_list_subtotal + 0.5)::bigint
                ELSE GREATEST(p_basis, 0) END AS v
  )
  SELECT paid.v + CASE WHEN COALESCE(p_subtotal, 0) > 0
                       THEN floor(COALESCE(p_service_charge, 0)::numeric * paid.v / p_subtotal + 0.5)::bigint
                       ELSE 0 END
  FROM paid;
$function$;

-- The basis already returned on an order: every resolved sold-out line.
CREATE FUNCTION public.issue_4490_sold_out_basis_done(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(sum(CASE i.sold_out_resolution
      WHEN 'refund' THEN i.line_total_cents::bigint
      WHEN 'swap' THEN GREATEST(i.line_total_cents::bigint
        - COALESCE((SELECT s.line_total_cents::bigint FROM public.venue_order_items s WHERE s.id = i.swapped_to_item_id), 0), 0)
      ELSE 0 END), 0)::bigint
  FROM public.venue_order_items i
  WHERE i.venue_order_id = p_order_id AND i.sold_out_resolution IS NOT NULL;
$function$;

-- ===========================================================================
-- T3.2 The amount-aware twin of pg_venue_order_mint_refund (re-emitted whole
--      from 20281203724490): any number of line refunds per order, each its
--      own row, never more than is left on the order.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_venue_order_mint_partial_refund(
  p_order_id uuid,
  p_amount_minor bigint,
  p_actor uuid,
  p_reason text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_amount bigint := COALESCE(p_amount_minor, 0);
  v_in_flight bigint;
  v_fee bigint;
  v_reason text := left(btrim(COALESCE(p_reason, '')), 480);
  v_n integer;
  v_prev bigint;
  v_kind text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_amount <= 0 OR p_key IS NULL THEN
    RAISE EXCEPTION 'sold_out_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.money_path <> 'mingla' OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR v_order.total_cents <= 0 THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  -- A whole-order refund still in flight takes everything that is left, so no
  -- line refund may start beside it. Other line refunds in flight are fine:
  -- their money is netted just below.
  IF EXISTS (SELECT 1 FROM public.source_refunds sr
             WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
               AND NOT public.issue_4490_is_line_refund_kind(sr.refund_kind)
               AND sr.buyer_state NOT IN ('failed_terminal', 'processed')) THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(sum(sr.buyer_refund_requested_cents - sr.buyer_refund_processed_cents), 0) INTO v_in_flight
  FROM public.source_refunds sr
  WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
    AND sr.buyer_state NOT IN ('failed_terminal', 'processed');
  IF v_amount > v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0) - v_in_flight THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  -- The n-th line refund of this order, and what earlier ones asked for (a
  -- failed one moved no money).
  SELECT count(*)::integer,
         COALESCE(sum(sr.buyer_refund_requested_cents) FILTER (
           WHERE sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')), 0)
    INTO v_n, v_prev
  FROM public.source_refunds sr
  WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
    AND public.issue_4490_is_line_refund_kind(sr.refund_kind);
  v_n := v_n + 1;
  v_kind := CASE WHEN v_n = 1 THEN 'venue_order_line_refund' ELSE 'venue_order_line_refund_' || v_n::text END;
  -- Mingla's fee comes back pro rata on the running total of line refunds
  -- (half up), so the line refunds together never reverse more fee than
  -- their share; the first is exactly the earlier one-refund formula.
  v_fee := floor((COALESCE(v_order.mingla_fee_cents, 0)::numeric * (v_prev + v_amount)) / v_order.total_cents + 0.5)::bigint
         - floor((COALESCE(v_order.mingla_fee_cents, 0)::numeric * v_prev) / v_order.total_cents + 0.5)::bigint;
  v_fee := LEAST(GREATEST(v_fee, 0), v_amount);
  IF length(v_reason) < 3 THEN
    v_reason := 'Sold out after payment';
  END IF;

  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, requested_by_user_id, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents,
    original_application_fee_cents, fee_reversal_required_cents,
    fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, provider_account_reference, idempotency_key
  ) VALUES (
    'venue_menu_order', v_order.id, v_order.id, v_order.brand_id, v_order.venue_id,
    v_kind, 'brand_staff', p_actor, v_reason,
    COALESCE(v_order.provider, 'stripe'), upper(v_order.currency),
    v_order.total_cents, v_amount,
    v_order.mingla_fee_cents, v_fee,
    CASE WHEN v_fee = 0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee = 0 THEN 'not_required'
         WHEN COALESCE(v_order.provider, 'stripe') = 'stripe' THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    'pending',
    v_amount - v_fee, v_fee,
    COALESCE(v_order.stripe_charge_id, v_order.stripe_payment_intent_id,
             v_order.paystack_reference, 'venue_order:' || v_order.id::text),
    v_order.stripe_account_id,
    'venue_order_line_refund:' || v_order.id::text || CASE WHEN v_n = 1 THEN '' ELSE ':' || v_n::text END
  ) RETURNING * INTO v_refund;

  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'buyer_refund', v_refund.buyer_refund_requested_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_refund.id);
  IF v_refund.organizer_refund_liability_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'organizer_refund_liability', v_refund.organizer_refund_liability_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:organizer:' || v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'platform_application_fee_reversal', v_refund.platform_fee_absorption_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:platform:' || v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id, event_key, event_type, to_state, actor_type, safe_reason_code
  ) VALUES (
    v_refund.id, 'requested:' || v_refund.id, 'requested', 'queued', 'operator', 'venue_order_line_refund');

  RETURN jsonb_build_object('refundId', v_refund.id, 'amountMinor', v_amount, 'feeReversalMinor', v_fee,
                            'refundKind', v_kind);
END;
$function$;

-- ===========================================================================
-- T3.3 Resolve (re-emitted whole from 20281203724490). Only the money changed:
--      no "one refund per order" any more, and the amount telescopes over the
--      order's resolutions (issue_4490_sold_out_refund_for_basis).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_order_sold_out_resolve(
  p_order_id uuid,
  p_item_ids uuid[],
  p_resolution text,
  p_swap_item_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_line public.venue_order_items%ROWTYPE;
  v_swap public.menu_items%ROWTYPE;
  v_swap_menu public.menus%ROWTYPE;
  v_ids uuid[];
  v_new_id uuid;
  v_next_line integer;
  v_basis_done bigint;
  v_basis_line bigint;
  v_cum bigint := 0;
  v_line_back bigint;
  v_refund_total bigint := 0;
  v_refund jsonb := NULL;
  v_names text[] := '{}'::text[];
  v_swap_station text;
  v_key text := btrim(COALESCE(p_key, ''));
  v_n integer;
  v_venue_name text;
  v_payload jsonb;
BEGIN
  IF p_order_id IS NULL OR p_resolution NOT IN ('swap', 'refund')
     OR COALESCE(cardinality(p_item_ids), 0) NOT BETWEEN 1 AND 50
     OR (p_resolution = 'swap') <> (p_swap_item_id IS NOT NULL)
     OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$' THEN
    RAISE EXCEPTION 'sold_out_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_resolution = 'swap' THEN
    IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
            OR public.issue_4490_can_sell(v_order.venue_id, p_actor)) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF public.biz_brand_effective_rank(v_order.brand_id, p_actor) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4490_pin_actor_assert(v_order.venue_id, p_actor, p_device_user);

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x;
  -- A replay of the same request answers what it did.
  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) x
                 WHERE NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                                   WHERE i.id = x AND i.venue_order_id = v_order.id
                                     AND i.sold_out_resolution IS NOT NULL))
     AND v_order.metadata->'sold_out_resolutions' ? v_key THEN
    RETURN (v_order.metadata->'sold_out_resolutions'->v_key) || jsonb_build_object('replayed', true);
  END IF;
  IF v_order.money_path <> 'mingla' OR v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x
             WHERE NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                               WHERE i.id = x AND i.venue_order_id = v_order.id AND i.sold_out_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'sold_out_line_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_order_items i
             WHERE i.id = ANY (v_ids) AND i.sold_out_resolution IS NOT NULL) THEN
    RAISE EXCEPTION 'sold_out_already_resolved' USING ERRCODE = 'PT409';
  END IF;

  IF p_resolution = 'swap' THEN
    SELECT * INTO v_swap FROM public.menu_items WHERE id = p_swap_item_id;
    SELECT * INTO v_swap_menu FROM public.menus WHERE id = v_swap.menu_id;
    IF v_swap.id IS NULL OR v_swap_menu.id IS NULL OR v_swap_menu.venue_id IS DISTINCT FROM v_order.venue_id
       OR v_swap_menu.is_active IS NOT TRUE OR v_swap.brand_id <> v_order.brand_id
       OR NOT public.issue_4490_menu_item_orderable(v_swap.is_available, v_swap.stock_count)
       OR v_swap.price_cents IS NULL OR upper(v_swap.currency) <> v_order.currency
       OR v_swap.id = ANY (SELECT i.menu_item_id FROM public.venue_order_items i WHERE i.id = ANY (v_ids)) THEN
      RAISE EXCEPTION 'sold_out_swap_not_orderable' USING ERRCODE = 'PT409';
    END IF;
    v_swap_station := public.issue_4490_item_station(v_swap.id, v_order.venue_id);
  END IF;

  -- #4490 08-O5 fix 1 (O5-T3): what earlier resolutions of this order already
  -- gave back, so this one adds exactly its own share on top (telescoping).
  v_basis_done := public.issue_4490_sold_out_basis_done(v_order.id);

  SELECT COALESCE(max(i.line_no), 0) INTO v_next_line FROM public.venue_order_items i WHERE i.venue_order_id = v_order.id;
  FOR v_line IN SELECT * FROM public.venue_order_items i WHERE i.id = ANY (v_ids) ORDER BY i.line_no FOR UPDATE LOOP
    v_names := v_names || v_line.item_name_at_order;
    IF p_resolution = 'swap' THEN
      IF v_swap_station IS DISTINCT FROM v_line.station THEN
        RAISE EXCEPTION 'sold_out_swap_other_station' USING ERRCODE = 'PT409';
      END IF;
      IF v_swap.price_cents::bigint * v_line.quantity > v_line.line_total_cents THEN
        RAISE EXCEPTION 'sold_out_swap_dearer' USING ERRCODE = 'PT409';
      END IF;
      v_basis_line := v_line.line_total_cents::bigint - v_swap.price_cents::bigint * v_line.quantity;
    ELSE
      v_basis_line := v_line.line_total_cents::bigint;
    END IF;
    -- This line's money back: its basis on top of everything before it.
    v_line_back := public.issue_4490_sold_out_refund_for_basis(v_order.list_subtotal_cents, v_order.subtotal_cents,
                     v_order.service_charge_cents, v_basis_done + v_cum + v_basis_line)
                 - public.issue_4490_sold_out_refund_for_basis(v_order.list_subtotal_cents, v_order.subtotal_cents,
                     v_order.service_charge_cents, v_basis_done + v_cum);
    v_cum := v_cum + v_basis_line;
    v_refund_total := v_refund_total + v_line_back;
    IF p_resolution = 'swap' THEN
      v_next_line := v_next_line + 1;
      INSERT INTO public.venue_order_items (
        venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents, currency,
        quantity, modifiers_total_cents, line_total_cents, notes, station, swapped_from_item_id)
      VALUES (v_order.id, v_swap.id, v_next_line, v_swap.name, v_swap.price_cents, v_order.currency,
        v_line.quantity, 0, v_swap.price_cents * v_line.quantity, v_line.notes, v_line.station, v_line.id)
      RETURNING id INTO v_new_id;
      -- The swap item's stock, for the new line only (too little: PT409
      -- item_sold_out naming the swap item; nothing of this call happens).
      PERFORM public.issue_4490_stock_take(ARRAY[v_order.id], 'send', v_new_id);
      PERFORM public.issue_4490_stock_give_back(v_line.id);
      UPDATE public.venue_order_items SET
        prep_state = 'voided', voided_at = now(), voided_by_user_id = p_actor,
        void_reason = 'sold_out_after_payment',
        sold_out_resolution = 'swap', sold_out_resolved_at = now(), sold_out_resolved_by_user_id = p_actor,
        swapped_to_item_id = v_new_id,
        sold_out_refund_minor = v_line_back
      WHERE id = v_line.id;
    ELSE
      PERFORM public.issue_4490_stock_give_back(v_line.id);
      UPDATE public.venue_order_items SET
        prep_state = 'voided', voided_at = now(), voided_by_user_id = p_actor,
        void_reason = 'sold_out_after_payment',
        sold_out_resolution = 'refund', sold_out_resolved_at = now(), sold_out_resolved_by_user_id = p_actor,
        sold_out_refund_minor = v_line_back
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  -- The money back, on the existing rail (its own row; never more than is
  -- left on the order: the mint refuses that).
  IF v_refund_total > 0 THEN
    v_refund := public.issue_4490_venue_order_mint_partial_refund(
      v_order.id, v_refund_total, p_actor,
      'Sold out after payment: ' || array_to_string(v_names, ', '), v_key);
  END IF;

  -- The guest is told: text and email, once per resolution.
  SELECT count(*) INTO v_n FROM jsonb_object_keys(COALESCE(v_order.metadata->'sold_out_resolutions', '{}'::jsonb));
  v_n := v_n + 1;
  SELECT v.name INTO v_venue_name FROM public.venue_listings v WHERE v.id = v_order.venue_id;
  v_payload := jsonb_build_object(
    'venue_order_id', v_order.id,
    'venue_id', v_order.venue_id,
    'venue_name', COALESCE(NULLIF(btrim(v_venue_name), ''), 'the venue'),
    'item_name', array_to_string(v_names, ', '),
    'outcome', p_resolution,
    'swap_name', CASE WHEN p_resolution = 'swap' THEN v_swap.name END,
    'refund_minor', v_refund_total,
    'currency', v_order.currency);
  IF v_order.buyer_phone_e164 IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
    ) VALUES (
      'buyer_venue_order_sold_out', NULL, v_order.buyer_phone_e164, v_order.brand_id,
      v_payload || jsonb_build_object('channel_hint', 'sms'),
      'buyer_venue_order_sold_out:' || v_order.id::text || ':' || v_n::text || ':sms',
      public.mingla_e164_country(v_order.buyer_phone_e164), 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  IF v_order.buyer_email IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
    ) VALUES (
      'buyer_venue_order_sold_out', NULL, v_order.buyer_email, v_order.brand_id,
      v_payload || jsonb_build_object('channel_hint', 'email'),
      'buyer_venue_order_sold_out:' || v_order.id::text || ':' || v_n::text || ':email',
      NULL, 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  v_payload := jsonb_build_object(
    'orderId', v_order.id, 'resolution', p_resolution, 'orderItemIds', to_jsonb(v_ids),
    'swapName', CASE WHEN p_resolution = 'swap' THEN v_swap.name END,
    'refundMinor', v_refund_total,
    'refundId', v_refund->>'refundId',
    'unresolved', (SELECT count(*) FROM public.venue_order_items i
                   WHERE i.venue_order_id = v_order.id AND i.sold_out_at IS NOT NULL
                     AND i.sold_out_resolution IS NULL));
  UPDATE public.venue_orders SET
    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{sold_out_resolutions}',
                         COALESCE(metadata->'sold_out_resolutions', '{}'::jsonb)
                           || jsonb_build_object(v_key, v_payload), true),
    station_rev = station_rev + 1,
    updated_at = now()
  WHERE id = v_order.id;
  PERFORM public.issue_4490_floor_audit(v_order.brand_id, p_actor, p_device_user, 'order.sold_out_resolve',
    'venue_order', v_order.id::text,
    jsonb_build_object('venue_id', v_order.venue_id, 'resolution', p_resolution, 'order_item_ids', to_jsonb(v_ids),
                       'swap_menu_item_id', p_swap_item_id, 'refund_minor', v_refund_total));
  RETURN v_payload || jsonb_build_object('replayed', false);
END;
$function$;

-- ===========================================================================
-- T3.4 The staff view (re-emitted whole from 20281203724490): each line's
--      refund preview is what a refund of it NOW returns (on top of what was
--      already given back); refundUsed only says a line refund was made.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_order_sold_out(p_order_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_done bigint;
BEGIN
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
          OR public.issue_4490_can_sell(v_order.venue_id, p_actor)
          OR public.biz_brand_effective_rank(v_order.brand_id, p_actor) >= public.biz_role_rank('event_manager')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_done := public.issue_4490_sold_out_basis_done(v_order.id);
  RETURN jsonb_build_object(
    'orderId', v_order.id,
    'currency', v_order.currency,
    'canRefund', public.biz_brand_effective_rank(v_order.brand_id, p_actor) >= public.biz_role_rank('event_manager'),
    'canSwap', public.issue_4490_can_kitchen(v_order.venue_id, p_actor) OR public.issue_4490_can_sell(v_order.venue_id, p_actor),
    'refundUsed', EXISTS (SELECT 1 FROM public.source_refunds sr
                          WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
                            AND public.issue_4490_is_line_refund_kind(sr.refund_kind)),
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'orderItemId', i.id, 'menuItemId', i.menu_item_id, 'name', i.item_name_at_order,
        'quantity', i.quantity, 'lineTotalMinor', i.line_total_cents, 'station', i.station,
        -- What a refund of this line returns now: what was paid for it (the
        -- order's discount and service charge share), on top of what earlier
        -- resolutions gave back: the formula issue_4490_order_sold_out_resolve uses.
        'refundPreviewMinor',
          public.issue_4490_sold_out_refund_for_basis(v_order.list_subtotal_cents, v_order.subtotal_cents,
            v_order.service_charge_cents, v_done + i.line_total_cents)
          - public.issue_4490_sold_out_refund_for_basis(v_order.list_subtotal_cents, v_order.subtotal_cents,
            v_order.service_charge_cents, v_done),
        'soldOutAt', i.sold_out_at, 'resolution', i.sold_out_resolution,
        'swappedToName', (SELECT s.item_name_at_order FROM public.venue_order_items s WHERE s.id = i.swapped_to_item_id),
        'refundedMinor', i.sold_out_refund_minor) ORDER BY i.line_no)
      FROM public.venue_order_items i
      WHERE i.venue_order_id = v_order.id AND i.sold_out_at IS NOT NULL), '[]'::jsonb),
    -- What a swap may offer per line: orderable, same station, same or lower price.
    'swapOptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'menuItemId', mi.id, 'name', mi.name, 'priceMinor', mi.price_cents,
        'station', public.issue_4490_item_station(mi.id, v_order.venue_id),
        'stockLeft', mi.stock_count) ORDER BY mi.price_cents DESC, mi.name)
      FROM public.menu_items mi
      JOIN public.menus m ON m.id = mi.menu_id AND m.is_active = true AND m.venue_id = v_order.venue_id
      WHERE mi.brand_id = v_order.brand_id AND mi.price_cents IS NOT NULL
        AND upper(mi.currency) = v_order.currency
        AND public.issue_4490_menu_item_orderable(mi.is_available, mi.stock_count)), '[]'::jsonb));
END;
$function$;

-- ===========================================================================
-- T3.5 The whole-order refund still works for what is left (checked patches
--      of the live bodies, 20270319001846). For an order with no line refund
--      both are byte-for-byte the code path they were: the extra predicate
--      matches no row and the netted fee is the full fee.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.pg_venue_order_mint_refund(uuid,text,text,uuid,text)'::regprocedure,
  $old$     AND buyer_state NOT IN ('failed_terminal', 'processed')
   -- `requested_at`, not `created_at`$old$,
  $new$     AND buyer_state NOT IN ('failed_terminal', 'processed')
     -- #4490 08-O5 fix 1 (O5-T3): a sold-out LINE refund is not "the" live
     -- refund of the order; its money is netted below (v_in_flight, or
     -- refunded_amount_cents once processed) and its fee reversal too.
     AND NOT public.issue_4490_is_line_refund_kind(refund_kind)
   -- `requested_at`, not `created_at`$new$
);
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.pg_venue_order_mint_refund(uuid,text,text,uuid,text)'::regprocedure,
  $old$  v_fee := least(v_amount, coalesce(v_order.mingla_fee_cents, 0));$old$,
  $new$  -- #4490 08-O5 fix 1 (O5-T3): Mingla's fee already given back by sold-out
  -- line refunds is not given back again (0 for every other order).
  v_fee := least(v_amount, greatest(0, coalesce(v_order.mingla_fee_cents, 0) - coalesce((
    SELECT sum(sr.fee_reversal_required_cents)::int FROM public.source_refunds sr
     WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = p_order_id
       AND public.issue_4490_is_line_refund_kind(sr.refund_kind)
       AND sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')), 0)));$new$
);
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.biz_venue_order_refund_decision(uuid,text,text)'::regprocedure,
  $old$          AND sr.buyer_state NOT IN ('failed_terminal', 'processed')) THEN$old$,
  $new$          AND sr.buyer_state NOT IN ('failed_terminal', 'processed')
          -- #4490 08-O5 fix 1 (O5-T3): a sold-out line refund leaves the rest
          -- of the order refundable; the mint nets it.
          AND NOT public.issue_4490_is_line_refund_kind(sr.refund_kind)) THEN$new$
);

-- ===========================================================================
-- T1.1 Opening hours as they were: every version of a venue's hours.
-- ===========================================================================
CREATE TABLE public.venue_hours_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  -- In force from this moment until the next version (-infinity: the hours
  -- as they were before the first change this table saw).
  valid_from timestamptz NOT NULL,
  -- brand_hours rows of the venue: [{weekday, open_time, close_time, is_closed}]
  weekly jsonb NOT NULL CHECK (jsonb_typeof(weekly) = 'array'),
  -- venue_special_hours of the venue: {"YYYY-MM-DD": {is_closed, windows}}
  specials jsonb NOT NULL CHECK (jsonb_typeof(specials) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, valid_from)
);
COMMENT ON TABLE public.venue_hours_history IS
  '#4490 08-O5 fix 1 (O5-T1): every version of a venue''s opening hours (weekly + special days), written '
  'only by triggers on brand_hours and venue_special_hours. issue_4490_venue_service_date reads the version in '
  'force at a past moment, so an hours change never moves money already recorded. Service role only.';
ALTER TABLE public.venue_hours_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_hours_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_hours_history TO service_role;

-- The venue's hours right now, in the shape the history keeps.
CREATE FUNCTION public.issue_4490_venue_hours_state(p_venue_id uuid, OUT weekly jsonb, OUT specials jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open_time', h.open_time,
                'close_time', h.close_time, 'is_closed', h.is_closed) ORDER BY h.weekday, h.window_ordinal, h.id)
              FROM public.brand_hours h WHERE h.venue_id = p_venue_id), '[]'::jsonb),
    COALESCE((SELECT jsonb_object_agg(s.local_date::text, jsonb_build_object('is_closed', s.is_closed, 'windows', s.windows))
              FROM public.venue_special_hours s WHERE s.venue_id = p_venue_id), '{}'::jsonb);
$function$;

-- Only verified venues (the ones that can take money) keep a history.
-- BEFORE a change: the first time a venue's hours change, keep the hours as
-- they were (-infinity). For a multi-row statement the first row sees the
-- table as it was before the statement.
CREATE FUNCTION public.issue_4490_venue_hours_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  FOREACH v_venue IN ARRAY ARRAY[
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.venue_id END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.venue_id END] LOOP
    CONTINUE WHEN v_venue IS NULL;
    IF NOT EXISTS (SELECT 1 FROM public.venue_hours_history x WHERE x.venue_id = v_venue)
       AND EXISTS (SELECT 1 FROM public.venue_listings v WHERE v.id = v_venue AND v.claim_status = 'verified') THEN
      INSERT INTO public.venue_hours_history (venue_id, valid_from, weekly, specials)
      SELECT v_venue, '-infinity'::timestamptz, st.weekly, st.specials FROM public.issue_4490_venue_hours_state(v_venue) st
      ON CONFLICT (venue_id, valid_from) DO NOTHING;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- AFTER a change: the hours from now on (one version per statement).
CREATE FUNCTION public.issue_4490_venue_hours_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  FOREACH v_venue IN ARRAY ARRAY[
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.venue_id END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.venue_id END] LOOP
    CONTINUE WHEN v_venue IS NULL;
    -- A venue being deleted keeps no history (its rows cascade away). A
    -- pending (unverified) venue takes no money, so it keeps none either: its
    -- history starts with its first hours change once verified, and a pending
    -- venue's identity correction (#2099) sees no rows here.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.venue_listings v WHERE v.id = v_venue AND v.claim_status = 'verified');
    INSERT INTO public.venue_hours_history (venue_id, valid_from, weekly, specials)
    SELECT v_venue, statement_timestamp(), st.weekly, st.specials FROM public.issue_4490_venue_hours_state(v_venue) st
    ON CONFLICT (venue_id, valid_from) DO UPDATE SET weekly = EXCLUDED.weekly, specials = EXCLUDED.specials;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER issue_4490_venue_hours_baseline
  BEFORE INSERT OR UPDATE OR DELETE ON public.brand_hours
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_venue_hours_baseline();
CREATE TRIGGER issue_4490_venue_hours_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.brand_hours
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_venue_hours_capture();
CREATE TRIGGER issue_4490_venue_hours_baseline
  BEFORE INSERT OR UPDATE OR DELETE ON public.venue_special_hours
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_venue_hours_baseline();
CREATE TRIGGER issue_4490_venue_hours_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.venue_special_hours
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_venue_hours_capture();

-- ===========================================================================
-- T1.2 The service day of a moment uses the hours in force AT that moment
--      (re-emitted whole from 20281203214490; the history branch is new).
--      With no later version (every call about "now", and every venue whose
--      hours never changed since this file) it reads the live tables exactly
--      as before.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_venue_service_date(p_venue_id uuid, p_at timestamptz)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_local timestamp;
  v_yday date;
  v_t time;
  v_special public.venue_special_hours%ROWTYPE;
  v_hist public.venue_hours_history%ROWTYPE;
  v_sp jsonb;
BEGIN
  IF p_venue_id IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;
  v_local := p_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id);
  v_yday := v_local::date - 1;
  v_t := v_local::time;
  -- #4490 08-O5 fix 1 (O5-T1): a moment before the venue's latest hours
  -- change is read with the hours that were in force then.
  IF EXISTS (SELECT 1 FROM public.venue_hours_history x WHERE x.venue_id = p_venue_id AND x.valid_from > p_at) THEN
    SELECT * INTO v_hist FROM public.venue_hours_history x
    WHERE x.venue_id = p_venue_id AND x.valid_from <= p_at
    ORDER BY x.valid_from DESC LIMIT 1;
    IF FOUND THEN
      v_sp := v_hist.specials -> v_yday::text;
      IF v_sp IS NOT NULL THEN
        IF NOT COALESCE((v_sp->>'is_closed')::boolean, false) AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_sp->'windows', '[]'::jsonb)) w
          WHERE COALESCE(w->>'open', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            AND COALESCE(w->>'close', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            AND (w->>'close')::time <= (w->>'open')::time
            AND v_t < (w->>'close')::time
        ) THEN
          RETURN v_yday;
        END IF;
        RETURN v_local::date;
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_hist.weekly) h
        WHERE (h->>'weekday')::integer = extract(isodow FROM v_yday)::integer - 1
          AND NOT COALESCE((h->>'is_closed')::boolean, false)
          AND h->>'open_time' IS NOT NULL AND h->>'close_time' IS NOT NULL
          AND (h->>'close_time')::time <= (h->>'open_time')::time
          AND v_t < (h->>'close_time')::time
      ) THEN
        RETURN v_yday;
      END IF;
      RETURN v_local::date;
    END IF;
  END IF;
  SELECT * INTO v_special FROM public.venue_special_hours
  WHERE venue_id = p_venue_id AND local_date = v_yday;
  IF FOUND THEN
    IF NOT v_special.is_closed AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_special.windows) w
      WHERE COALESCE(w->>'open', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND COALESCE(w->>'close', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND (w->>'close')::time <= (w->>'open')::time
        AND v_t < (w->>'close')::time
    ) THEN
      RETURN v_yday;
    END IF;
    RETURN v_local::date;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.brand_hours h
    WHERE h.venue_id = p_venue_id
      AND h.weekday = extract(isodow FROM v_yday)::integer - 1
      AND NOT h.is_closed AND h.open_time IS NOT NULL AND h.close_time IS NOT NULL
      AND h.close_time <= h.open_time
      AND v_t < h.close_time
  ) THEN
    RETURN v_yday;
  END IF;
  RETURN v_local::date;
END;
$function$;

-- ===========================================================================
-- T1.3 The close reads the day the Till stored when the money was recorded.
-- ===========================================================================
-- The Till payments of day D (paid, part refunded or refunded; the venue's
-- currency): the business_date written when each was paid.
CREATE OR REPLACE FUNCTION public.issue_4490_day_payment_ids(p_venue_id uuid, p_date date)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(array_agg(p.id ORDER BY p.paid_at, p.id), '{}'::uuid[])
  FROM public.venue_till_payments p
  JOIN public.venue_till_sales s ON s.id = p.sale_id
  WHERE s.venue_id = p_venue_id
    AND s.currency = (SELECT upper(b.default_currency) FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id
                      WHERE v.id = p_venue_id)
    AND p.state IN ('paid', 'partially_refunded', 'refunded')
    AND p.business_date = p_date;
$function$;

-- The Till refunds of day D: the business_date written when each was made.
CREATE OR REPLACE FUNCTION public.issue_4490_day_refund_ids(p_venue_id uuid, p_date date)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(array_agg(r.id ORDER BY r.created_at, r.id), '{}'::uuid[])
  FROM public.venue_till_refunds r
  JOIN public.venue_till_payments p ON p.id = r.payment_id
  JOIN public.venue_till_sales s ON s.id = p.sale_id
  WHERE s.venue_id = p_venue_id
    AND s.currency = (SELECT upper(b.default_currency) FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id
                      WHERE v.id = p_venue_id)
    AND r.business_date = p_date;
$function$;

-- Deposits used: the check's stored paid day (checked patch of the live body).
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.issue_4490_day_totals(uuid,date)'::regprocedure,
  $old$    AND s.paid_at >= v_from AND s.paid_at < v_to
    AND public.issue_4490_venue_service_date(p_venue_id, s.paid_at) = p_date;$old$,
  $new$    -- #4490 08-O5 fix 1 (O5-T1): the day stored when the check was paid.
    AND s.business_date = p_date;$new$
);

-- Open checks: the day each check was opened on (stored), never recomputed.
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.issue_4490_day_open_checks(uuid,date)'::regprocedure,
  $old$    AND public.issue_4490_venue_service_date(p_venue_id, s.created_at) <= p_date$old$,
  $new$    -- #4490 08-O5 fix 1 (O5-T1): the day stored when the check was opened.
    AND s.opened_business_date <= p_date$new$
);

-- The days a close action may name: today's service day and the 7 before it,
-- and a day after "today" that already holds a close or Till money (after an
-- hours change moved "today" back, that day must stay readable and closable).
CREATE OR REPLACE FUNCTION public.issue_4490_day_check_date(p_venue_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_today date := public.issue_4490_venue_service_date(p_venue_id, now());
BEGIN
  IF p_date IS NULL OR p_date < v_today - 7 THEN
    RAISE EXCEPTION 'day_out_of_range' USING ERRCODE = '22023';
  END IF;
  IF p_date > v_today AND NOT (
    p_date = v_today + 1 AND (
      EXISTS (SELECT 1 FROM public.venue_day_closes c WHERE c.venue_id = p_venue_id AND c.business_date = p_date)
      OR EXISTS (SELECT 1 FROM public.venue_till_sales s
                 WHERE s.venue_id = p_venue_id AND (s.opened_business_date = p_date OR s.business_date = p_date))
      OR EXISTS (SELECT 1 FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
                 WHERE s.venue_id = p_venue_id AND p.business_date = p_date)
      OR EXISTS (SELECT 1 FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
                 JOIN public.venue_till_sales s ON s.id = p.sale_id
                 WHERE s.venue_id = p_venue_id AND r.business_date = p_date))) THEN
    RAISE EXCEPTION 'day_out_of_range' USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- Reopen: the same rule for a day after "today" (it needs a close anyway).
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.issue_4490_day_reopen(uuid,date,text,uuid,uuid)'::regprocedure,
  $old$  IF p_date IS NULL OR p_date > public.issue_4490_venue_service_date(v_venue.id, now()) THEN$old$,
  $new$  -- #4490 08-O5 fix 1 (O5-T1): an hours change can move "today" back a day;
  -- a closed day after it can still be reopened (it has a close row).
  IF p_date IS NULL OR p_date > public.issue_4490_venue_service_date(v_venue.id, now()) + 1 THEN$new$
);

-- Backfill: a paid Till payment or check without a stored day gets the day
-- from the hours as they are now (production has no Till rows; this is for
-- any older local or test data).
UPDATE public.venue_till_payments p
SET business_date = public.issue_4490_venue_service_date(s.venue_id, p.paid_at)
FROM public.venue_till_sales s
WHERE s.id = p.sale_id AND p.business_date IS NULL AND p.paid_at IS NOT NULL
  AND p.state IN ('paid', 'partially_refunded', 'refunded');
UPDATE public.venue_till_sales s
SET business_date = public.issue_4490_venue_service_date(s.venue_id, s.paid_at)
WHERE s.business_date IS NULL AND s.paid_at IS NOT NULL
  AND s.state IN ('paid', 'partially_refunded', 'refunded');

-- ===========================================================================
-- T4. A void's "Put it back in stock" (checked patch of the live body,
--     20281203724490 §9).
-- ===========================================================================
-- Whether a station has a kitchen screen at the venue: the same rule the
-- Till's send uses (the kitchen_screens feature, then the screen stations,
-- default kitchen and bar).
CREATE FUNCTION public.issue_4490_station_has_screen(p_venue_id uuid, p_station text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_station IS NOT NULL
    AND public.issue_4490_venue_feature_on(p_venue_id, 'kitchen_screens')
    AND p_station = ANY (COALESCE((SELECT s.screen_stations FROM public.venue_till_settings s WHERE s.venue_id = p_venue_id),
                                  ARRAY['kitchen', 'bar']::text[]));
$function$;

SELECT pg_temp.issue_4490_o5f1_patch(
  'public.issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)'::regprocedure,
  $old$  v_sc bigint;
BEGIN$old$,
  $new$  v_sc bigint;
  v_back record;
  v_units integer;
BEGIN$new$
);
SELECT pg_temp.issue_4490_o5f1_patch(
  'public.issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)'::regprocedure,
  $old$  -- #4490 08-O5C: p_restock gives back what each line voided by THIS call
  -- took from the count, when it was never started at a station (fired_at
  -- NULL). A held round never took stock; a refund never restocks.
  IF p_restock IS TRUE THEN
    PERFORM public.issue_4490_stock_give_back(i.id)
    FROM public.venue_order_items i
    JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE o.session_id = v_sale.session_id AND i.prep_state = 'voided'
      AND i.voided_at = now() AND i.voided_by_user_id = p_actor
      AND i.fired_at IS NULL AND COALESCE(i.stock_taken, 0) > 0
      AND (p_order_item_id IS NULL OR i.id = p_order_item_id)
      AND (p_line_id IS NULL OR i.venue_order_id = v_line.venue_order_id);
  END IF;$old$,
  $new$  -- #4490 08-O5C, fixed by 08-O5 fix 1 (O5-T4): p_restock is the void's
  -- "Put it back in stock" switch (on by default in the Till). For each line
  -- voided by THIS call that took units from the count: at a station with a
  -- kitchen screen only a line the screen never started comes back (fired_at
  -- NULL); at a station with NO screen the Till marked it served at send and
  -- only the person voiding knows whether it was made, so their choice is
  -- trusted and the line's units come back. Never more than the line took and
  -- once only (give_back zeroes stock_taken; a replayed void returns early).
  -- Off: nothing comes back. A held round never took stock; a refund never
  -- restocks. Every choice on a counted line is audited (stock.set via void).
  FOR v_back IN
    SELECT i.id, i.menu_item_id, i.stock_taken, i.fired_at,
           public.issue_4490_station_has_screen(v_sale.venue_id, i.station) AS screened
    FROM public.venue_order_items i
    JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE o.session_id = v_sale.session_id AND i.prep_state = 'voided'
      AND i.voided_at = now() AND i.voided_by_user_id = p_actor
      AND COALESCE(i.stock_taken, 0) > 0
      AND (p_order_item_id IS NULL OR i.id = p_order_item_id)
      AND (p_line_id IS NULL OR i.venue_order_id = v_line.venue_order_id)
    ORDER BY i.menu_item_id, i.id
  LOOP
    v_units := 0;
    IF p_restock IS TRUE AND (v_back.fired_at IS NULL OR NOT v_back.screened) THEN
      v_units := public.issue_4490_stock_give_back(v_back.id);
    END IF;
    PERFORM public.issue_4490_floor_audit(v_sale.brand_id, p_actor, NULL, 'stock.set', 'menu_item',
      v_back.menu_item_id::text,
      jsonb_build_object('venue_id', v_sale.venue_id, 'via', 'void',
        'reason', CASE WHEN v_units > 0 THEN 'void_restock' ELSE 'void_no_restock' END,
        'restock', p_restock IS TRUE, 'station_screen', v_back.screened,
        'order_item_id', v_back.id, 'taken', v_back.stock_taken, 'units_back', v_units));
  END LOOP;$new$
);

-- ===========================================================================
-- Grants. The two pure rules are public (they read nothing); everything
-- else is internal. Trigger functions need no EXECUTE grant to fire.
-- ===========================================================================
REVOKE ALL ON FUNCTION public.issue_4490_is_line_refund_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4490_is_line_refund_kind(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4490_sold_out_refund_for_basis(bigint, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4490_sold_out_refund_for_basis(bigint, bigint, bigint, bigint)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.issue_4490_sold_out_basis_done(uuid),
  public.issue_4490_venue_order_mint_partial_refund(uuid, bigint, uuid, text, text),
  public.issue_4490_order_sold_out_resolve(uuid, uuid[], text, uuid, uuid, uuid, text),
  public.issue_4490_order_sold_out(uuid, uuid),
  public.issue_4490_venue_hours_state(uuid),
  public.issue_4490_venue_hours_baseline(),
  public.issue_4490_venue_hours_capture(),
  public.issue_4490_venue_service_date(uuid, timestamptz),
  public.issue_4490_day_payment_ids(uuid, date),
  public.issue_4490_day_refund_ids(uuid, date),
  public.issue_4490_day_check_date(uuid, date),
  public.issue_4490_station_has_screen(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_sold_out_basis_done(uuid),
  public.issue_4490_venue_order_mint_partial_refund(uuid, bigint, uuid, text, text),
  public.issue_4490_order_sold_out_resolve(uuid, uuid[], text, uuid, uuid, uuid, text),
  public.issue_4490_order_sold_out(uuid, uuid),
  public.issue_4490_venue_hours_state(uuid),
  public.issue_4490_venue_service_date(uuid, timestamptz),
  public.issue_4490_day_payment_ids(uuid, date),
  public.issue_4490_day_refund_ids(uuid, date),
  public.issue_4490_day_check_date(uuid, date),
  public.issue_4490_station_has_screen(uuid, text)
TO service_role;

COMMIT;
