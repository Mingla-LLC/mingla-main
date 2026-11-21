-- issue #4522 M3 — flexible ("pay any amount") payments, rebalancing,
-- claim guards and balance links. Inert while issue_4522_plan_v2_enabled() is
-- false: no v2 order can exist (M1/M2), and begin_flex refuses with
-- payment_plan_v2_unavailable. Lock order everywhere: event → order → the
-- order's open rows ORDER BY id (as issue_3645_lock_installment_graph).
--
-- Re-emitted (md5 drift-guarded), one hunk each:
--   claim_order_installment_for_charge (20270725003645) — refuses a flex row
--     and any planned row while a flex row is open (flex_payment_in_flight).
--   issue_3645_begin_installment_attempt (20280202003645) — the same guard
--     for planned Paystack rows; a flex row may start its own attempt.
-- Conflicts raise PT409 (balance_payment_in_flight, balance_changed), never 40001.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.claim_order_installment_for_charge(uuid)','fc915f58ff0c2c665fd701da9f792a23'),
    ('public.issue_3645_begin_installment_attempt(uuid,text,bigint,boolean,timestamptz)','18253e8ae6725e5533c83fab15390014')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M3 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 0. The flexible payment's client key (idempotent replay of "Pay").
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_installments ADD COLUMN flex_client_key text NULL;
ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_flex_client_key_check
    CHECK ((kind = 'flex') = (flex_client_key IS NOT NULL)
           AND (flex_client_key IS NULL OR char_length(flex_client_key) BETWEEN 8 AND 120));
CREATE UNIQUE INDEX uq_order_flex_client_key
  ON public.order_installments (order_id, flex_client_key) WHERE flex_client_key IS NOT NULL;
COMMENT ON COLUMN public.order_installments.flex_client_key IS
  'Issue #4522: the client key of a flexible payment; the same key replays the same row.';

-- ---------------------------------------------------------------------------
-- 1. Lock graph and small internal readers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_lock_order_graph(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid;
  v_status text;
BEGIN
  SELECT event_id INTO v_event_id FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- event → order → open rows (ORDER BY id), as issue_3645_lock_installment_graph.
  SELECT status INTO v_status FROM public.events WHERE id = v_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  PERFORM 1 FROM public.order_installments
    WHERE order_id = p_order_id AND status IN ('scheduled', 'failed')
    ORDER BY id FOR UPDATE;
  RETURN v_status;
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_lock_order_graph(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_order_has_open_flex(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.order_installments
                  WHERE order_id = p_order_id AND kind = 'flex' AND status IN ('scheduled', 'failed'))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_has_open_flex(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_4522_order_has_open_attempt(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.order_installments oi
     WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled'
       AND oi.status IN ('scheduled', 'failed')
       AND (oi.in_flight_attempt_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.order_installment_charge_attempts a
                        WHERE a.installment_id = oi.id AND a.state IN ('created', 'unknown'))))
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_order_has_open_attempt(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Rebalance (spec §6.3). Caller holds the order graph lock. Moves money
--    only between open rows of kind 'scheduled'; the latest due date never
--    drops; every changed row bumps schedule_version and loses its notice
--    claim; one order_balance_events row records before and after.
--    p_paid: [{ticket_type_id, net_minor, addon_minor}] leaving the balance.
--    p_rolled_in_row: a superseded missed row whose amount joins later rows.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_rebalance_order(
  p_order_id uuid,
  p_reason text,
  p_trigger_installment_id uuid,
  p_actor uuid,
  p_paid jsonb DEFAULT '[]'::jsonb,
  p_rolled_in_row uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_unit constant bigint := 100;
  v_order public.orders;
  v_roll public.order_installments;
  v_min bigint;
  v_before jsonb;
  v_after jsonb;
  v_dates timestamptz[];
  v_n integer;
  v_r2 bigint;
  v_old_sum bigint;
  v_old_bt bigint;
  v_old_fee bigint;
  v_old_ref bigint;
  v_new_bt_total bigint;
  v_new_fee_total bigint;
  v_new_ref_total bigint;
  v_line record;
  v_rows uuid[];
  v_row_dates timestamptz[];
  v_k integer;
  v_trip bigint;
  v_addon bigint;
  v_tbase bigint;
  v_abase bigint;
  v_id uuid;
  v_amt bigint;
  v_add bigint;
  v_keep integer;
  v_bt_run bigint := 0;
  v_fee_run bigint := 0;
  v_ref_run bigint := 0;
  v_last_kept uuid;
  v_kept_count integer := 0;
  v_kept_seen integer := 0;
  v_has_bt boolean;
BEGIN
  IF p_reason NOT IN ('flex_payment', 'missed_rollover', 'addon_removed', 'host_adjust') THEN
    RAISE EXCEPTION 'rebalance_reason_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF p_rolled_in_row IS NOT NULL THEN
    SELECT * INTO v_roll FROM public.order_installments WHERE id = p_rolled_in_row AND order_id = p_order_id;
  END IF;
  v_min := CASE WHEN COALESCE((v_order.payment_plan_terms->>'flex_enabled')::boolean, false)
                THEN COALESCE((v_order.payment_plan_terms->>'min_payment_minor')::bigint, c_unit)
                ELSE c_unit END;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.i4522_open (
    id uuid, ticket_type_id uuid, due_at timestamptz, amount bigint, addon bigint,
    bt bigint, fee bigint, ref bigint) ON COMMIT DROP;
  DELETE FROM pg_temp.i4522_open;
  INSERT INTO pg_temp.i4522_open
  SELECT oi.id, oi.ticket_type_id, oi.due_at, oi.amount_cents, oi.addon_portion_minor,
         oi.buyer_total_cents, oi.planned_application_fee_cents, oi.referral_share_minor
    FROM public.order_installments oi
   WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed')
     AND (p_rolled_in_row IS NULL OR oi.due_at > v_roll.due_at);
  IF EXISTS (SELECT 1 FROM public.order_installments oi JOIN pg_temp.i4522_open o ON o.id = oi.id
              WHERE oi.in_flight_attempt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'balance_payment_in_flight' USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'ordinal', oi.ordinal, 'due_at', oi.due_at,
           'amount_cents', oi.amount_cents, 'addon_portion_minor', oi.addon_portion_minor,
           'status', oi.status, 'schedule_version', oi.schedule_version) ORDER BY oi.due_at, oi.id), '[]')
    INTO v_before FROM public.order_installments oi
   WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed');

  -- Per line: R2 = open + rolled in - paid (trip and add-on parts separately).
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.i4522_line (
    ticket_type_id uuid, trip bigint, addon bigint) ON COMMIT DROP;
  DELETE FROM pg_temp.i4522_line;
  INSERT INTO pg_temp.i4522_line
  SELECT t.ticket_type_id, sum(t.trip), sum(t.addon) FROM (
    SELECT ticket_type_id, amount - addon AS trip, addon FROM pg_temp.i4522_open
    UNION ALL
    SELECT v_roll.ticket_type_id, v_roll.amount_cents - v_roll.addon_portion_minor, v_roll.addon_portion_minor
     WHERE p_rolled_in_row IS NOT NULL
    UNION ALL
    SELECT (x->>'ticket_type_id')::uuid, -(x->>'net_minor')::bigint, -(x->>'addon_minor')::bigint
      FROM jsonb_array_elements(COALESCE(p_paid, '[]'::jsonb)) x
  ) t GROUP BY t.ticket_type_id;
  IF EXISTS (SELECT 1 FROM pg_temp.i4522_line WHERE trip < 0 OR addon < 0)
     OR (p_rolled_in_row IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_temp.i4522_open)) THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(sum(trip + addon), 0) INTO v_r2 FROM pg_temp.i4522_line;
  SELECT COALESCE(sum(amount), 0), sum(bt), sum(fee), COALESCE(sum(ref), 0), bool_and(bt IS NOT NULL)
    INTO v_old_sum, v_old_bt, v_old_fee, v_old_ref, v_has_bt FROM pg_temp.i4522_open;

  -- Dates: drop the earliest while a whole-unit split falls under the minimum.
  SELECT array_agg(DISTINCT due_at ORDER BY due_at) INTO v_dates FROM pg_temp.i4522_open;
  v_n := COALESCE(array_length(v_dates, 1), 0);
  WHILE v_n > 1 AND (v_r2 / v_n) / c_unit * c_unit < v_min LOOP
    v_dates := v_dates[2:v_n];
    v_n := v_n - 1;
  END LOOP;

  -- New totals for the provider-locked price, the planned fee and the referral share.
  IF v_old_sum > 0 THEN
    v_new_bt_total := CASE WHEN v_has_bt THEN floor(v_old_bt::numeric * v_r2 / v_old_sum)::bigint END;
    v_new_fee_total := CASE WHEN v_old_fee IS NOT NULL THEN floor(v_old_fee::numeric * v_r2 / v_old_sum)::bigint END;
    v_new_ref_total := least(floor(v_old_ref::numeric * v_r2 / v_old_sum)::bigint, v_r2);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.i4522_new (
    id uuid, amount bigint, addon bigint) ON COMMIT DROP;
  DELETE FROM pg_temp.i4522_new;
  IF v_r2 > 0 THEN
    FOR v_line IN SELECT * FROM pg_temp.i4522_line WHERE trip + addon > 0 ORDER BY ticket_type_id NULLS LAST LOOP
      SELECT array_agg(o.id ORDER BY o.due_at, o.id), array_agg(o.due_at ORDER BY o.due_at, o.id)
        INTO v_rows, v_row_dates
        FROM pg_temp.i4522_open o
       WHERE o.ticket_type_id IS NOT DISTINCT FROM v_line.ticket_type_id AND o.due_at = ANY (v_dates);
      IF v_rows IS NULL THEN
        -- The line's own dates all dropped: its latest row keeps the balance.
        SELECT array_agg(o.id), array_agg(o.due_at) INTO v_rows, v_row_dates FROM (
          SELECT o.id, o.due_at FROM pg_temp.i4522_open o
           WHERE o.ticket_type_id IS NOT DISTINCT FROM v_line.ticket_type_id
           ORDER BY o.due_at DESC, o.id DESC LIMIT 1) o;
      END IF;
      IF v_rows IS NULL THEN
        RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
      END IF;
      v_keep := array_length(v_rows, 1);
      v_tbase := (v_line.trip / v_keep) / c_unit * c_unit;
      v_abase := (v_line.addon / v_keep) / c_unit * c_unit;
      FOR v_k IN 1..v_keep LOOP
        v_trip := CASE WHEN v_k < v_keep THEN v_tbase ELSE v_line.trip - v_tbase * (v_keep - 1) END;
        v_addon := CASE WHEN v_k < v_keep THEN v_abase ELSE v_line.addon - v_abase * (v_keep - 1) END;
        IF v_trip + v_addon <= 0 THEN
          RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO pg_temp.i4522_new VALUES (v_rows[v_k], v_trip + v_addon, v_addon);
      END LOOP;
    END LOOP;
  END IF;

  -- Dropped (or emptied) rows: superseded. Their pay links stop working.
  UPDATE public.order_installments oi
     SET status = 'superseded', superseded_at = now(), next_retry_at = NULL, updated_at = now()
    FROM pg_temp.i4522_open o
   WHERE oi.id = o.id AND NOT EXISTS (SELECT 1 FROM pg_temp.i4522_new n WHERE n.id = o.id);
  UPDATE public.order_installment_pay_links l
     SET revoked_at = now(), revoked_reason = 'installment_superseded'
    FROM pg_temp.i4522_open o
   WHERE l.installment_id = o.id AND l.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_temp.i4522_new n WHERE n.id = o.id);

  -- Kept rows: new amounts; locked price, planned fee and referral share scale
  -- by the order's ratio, rounded down once, the last kept row absorbing.
  SELECT count(*) INTO v_kept_count FROM pg_temp.i4522_new;
  FOR v_id, v_amt, v_add IN
    SELECT n.id, n.amount, n.addon FROM pg_temp.i4522_new n
      JOIN pg_temp.i4522_open o ON o.id = n.id ORDER BY o.due_at, o.id
  LOOP
    v_kept_seen := v_kept_seen + 1;
    UPDATE public.order_installments
       SET amount_cents = v_amt,
           addon_portion_minor = v_add,
           buyer_total_cents = CASE WHEN v_new_bt_total IS NULL THEN buyer_total_cents
             WHEN v_kept_seen < v_kept_count THEN floor(v_amt::numeric * v_old_bt / v_old_sum)::bigint
             ELSE v_new_bt_total - v_bt_run END,
           planned_application_fee_cents = CASE WHEN v_new_fee_total IS NULL THEN planned_application_fee_cents
             WHEN v_kept_seen < v_kept_count THEN floor(v_amt::numeric * v_old_fee / v_old_sum)::bigint
             ELSE v_new_fee_total - v_fee_run END,
           referral_share_minor = CASE WHEN v_kept_seen < v_kept_count
             THEN least(floor(v_amt::numeric * v_old_ref / v_old_sum)::bigint, v_amt)
             ELSE least(greatest(COALESCE(v_new_ref_total, 0) - v_ref_run, 0), v_amt) END,
           schedule_version = schedule_version + 1,
           pre_charge_notice_sent_at = NULL,
           updated_at = now()
     WHERE id = v_id
     RETURNING buyer_total_cents, planned_application_fee_cents, referral_share_minor
       INTO v_amt, v_add, v_trip;
    v_bt_run := v_bt_run + COALESCE(v_amt, 0);
    v_fee_run := v_fee_run + COALESCE(v_add, 0);
    v_ref_run := v_ref_run + COALESCE(v_trip, 0);
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'ordinal', oi.ordinal, 'due_at', oi.due_at,
           'amount_cents', oi.amount_cents, 'addon_portion_minor', oi.addon_portion_minor,
           'status', oi.status, 'schedule_version', oi.schedule_version) ORDER BY oi.due_at, oi.id), '[]')
    INTO v_after FROM public.order_installments oi
   WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed');

  -- I-4522-2: money is conserved.
  IF (SELECT COALESCE(sum((x->>'amount_cents')::bigint), 0) FROM jsonb_array_elements(v_after) x)
     <> (SELECT COALESCE(sum((x->>'amount_cents')::bigint), 0) FROM jsonb_array_elements(v_before) x)
        + COALESCE(v_roll.amount_cents, 0)
        - (SELECT COALESCE(sum((x->>'net_minor')::bigint + (x->>'addon_minor')::bigint), 0)
             FROM jsonb_array_elements(COALESCE(p_paid, '[]'::jsonb)) x) THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.order_balance_events (order_id, reason, trigger_installment_id, before, after, actor)
  VALUES (p_order_id, p_reason, p_trigger_installment_id, v_before, v_after, p_actor);

  RETURN jsonb_build_object('remainingMinor', v_r2, 'rows', v_after);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_rebalance_order(uuid, text, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.issue_4522_rebalance_order(uuid, text, uuid, uuid, jsonb, uuid) IS
  'Issue #4522 §6.3: re-spreads an order''s open scheduled rows after a flexible payment (p_paid) or a missed payment rolled in (p_rolled_in_row). Internal; the caller holds the order graph lock.';

-- ---------------------------------------------------------------------------
-- 3. The balance of a v2 order (buyer, host and the balance page read this).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_balance(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders;
  v_event public.events;
  v_remaining bigint;
  v_collected bigint;
  v_flexible boolean;
  v_min bigint;
  v_next jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_remaining FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  SELECT COALESCE(sum(amount_cents), 0) INTO v_collected FROM public.order_installments
   WHERE order_id = p_order_id AND status IN ('collected', 'refunded');
  v_flexible := COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) = 2
    AND COALESCE((v_order.payment_plan_terms->>'flex_enabled')::boolean, false)
    AND v_order.cancelled_at IS NULL AND v_event.status <> 'cancelled' AND v_remaining > 0;
  v_min := least(COALESCE((v_order.payment_plan_terms->>'min_payment_minor')::bigint, v_remaining), v_remaining);
  SELECT jsonb_build_object('installmentId', id, 'dueAt', due_at, 'amountMinor', amount_cents, 'status', status)
    INTO v_next FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
   ORDER BY due_at, id LIMIT 1;
  RETURN jsonb_build_object(
    'orderId', v_order.id,
    'eventId', v_order.event_id,
    'currency', trim(v_order.currency),
    'depositMinor', v_order.total_cents,
    'paidMinor', v_order.total_cents + v_collected,
    'remainingMinor', v_remaining,
    'totalMinor', v_order.total_cents + v_collected + v_remaining,
    'terms', v_order.payment_plan_terms,
    'addonPaymentMode', v_order.addon_payment_mode,
    'canPayAnyAmount', v_flexible,
    'minPaymentMinor', CASE WHEN v_flexible THEN v_min END,
    'paymentInFlight', public.issue_4522_order_has_open_flex(p_order_id)
                       OR public.issue_4522_order_has_open_attempt(p_order_id),
    'nextPayment', v_next,
    'openRows', COALESCE((SELECT jsonb_agg(jsonb_build_object('installmentId', id, 'dueAt', due_at,
        'amountMinor', amount_cents, 'addonPortionMinor', addon_portion_minor, 'status', status)
        ORDER BY due_at, id) FROM public.order_installments
       WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')), '[]'),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('installmentId', id, 'kind', kind,
        'status', status, 'amountMinor', amount_cents, 'collectedAt', collected_at,
        'refundedMinor', refunded_amount_cents) ORDER BY collected_at, id)
        FROM public.order_installments
       WHERE order_id = p_order_id AND status IN ('collected', 'refunded')), '[]'),
    'balanceEvents', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason,
        'triggerInstallmentId', trigger_installment_id, 'createdAt', created_at,
        'before', before, 'after', after) ORDER BY created_at, id)
        FROM public.order_balance_events WHERE order_id = p_order_id), '[]'));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_balance(uuid) TO service_role;

-- The buyer (orders.buyer_user_id) or a member of the brand. Anyone else gets
-- the same answer as an order that does not exist.
CREATE FUNCTION public.biz_trip_order_balance(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_buyer uuid;
  v_brand uuid;
  v_uid uuid := auth.uid();
BEGIN
  SELECT o.buyer_user_id, e.brand_id INTO v_buyer, v_brand
    FROM public.orders o JOIN public.events e ON e.id = o.event_id
   WHERE o.id = p_order_id AND e.event_type = 'trip';
  IF NOT FOUND OR v_uid IS NULL
     OR NOT (v_buyer = v_uid OR public.biz_is_brand_member_for_read_for_caller(v_brand)) THEN
    RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.issue_4522_balance(p_order_id)
    || jsonb_build_object('viewer', CASE WHEN v_buyer = v_uid THEN 'buyer' ELSE 'host' END);
END
$fn$;
REVOKE ALL ON FUNCTION public.biz_trip_order_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_trip_order_balance(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_trip_order_balance(uuid) IS
  'Issue #4522: a v2 trip order''s balance for its buyer or a member of its brand; balance_not_found for anyone else.';

-- ---------------------------------------------------------------------------
-- 4. Begin a flexible payment ("pay any amount"). Service role only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_begin_flex_payment(
  p_order_id uuid,
  p_amount_minor bigint,
  p_expected_remaining_minor bigint,
  p_client_key text,
  p_method text,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_order public.orders;
  v_existing public.order_installments;
  v_remaining bigint;
  v_provider text;
  v_currency character(3);
  v_bt bigint;
  v_fee bigint;
  v_ref bigint;
  v_alloc jsonb := '[]'::jsonb;
  v_addon_total bigint := 0;
  v_line record;
  v_lines integer;
  v_seen integer := 0;
  v_run bigint := 0;
  v_part bigint;
  v_part_addon bigint;
  v_ordinal integer;
  v_id uuid;
  v_min bigint;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('auto_card', 'pay_link') THEN
    RAISE EXCEPTION 'invalid_attempt_method' USING ERRCODE = '22023';
  END IF;
  IF p_client_key IS NULL OR char_length(p_client_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'flex_client_key_invalid' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_4522_lock_order_graph(p_order_id);
  IF v_event_status IS NULL THEN
    RAISE EXCEPTION 'balance_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'order_cancelled' USING ERRCODE = 'P0001'; END IF;
  IF v_event_status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) <> 2
     OR NOT COALESCE((v_order.payment_plan_terms->>'flex_enabled')::boolean, false) THEN
    RAISE EXCEPTION 'plan_not_flexible' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'deposit_not_paid' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4522_plan_v2_enabled() THEN
    RAISE EXCEPTION 'payment_plan_v2_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- The same key replays the same row.
  SELECT * INTO v_existing FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'flex' AND flex_client_key = p_client_key;
  IF FOUND THEN
    RETURN jsonb_build_object('installmentId', v_existing.id, 'amountMinor', v_existing.amount_cents,
      'buyerTotalMinor', COALESCE(v_existing.buyer_total_cents, v_existing.amount_cents),
      'currency', trim(v_existing.currency), 'provider', v_existing.provider,
      'status', v_existing.status, 'replayed', true);
  END IF;
  IF public.issue_4522_order_has_open_flex(p_order_id) OR public.issue_4522_order_has_open_attempt(p_order_id) THEN
    RAISE EXCEPTION 'balance_payment_in_flight' USING ERRCODE = 'PT409';
  END IF;

  SELECT COALESCE(sum(amount_cents), 0), sum(buyer_total_cents), sum(planned_application_fee_cents),
         COALESCE(sum(referral_share_minor), 0), min(provider), min(currency)
    INTO v_remaining, v_bt, v_fee, v_ref, v_provider, v_currency
    FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  IF v_remaining IS DISTINCT FROM p_expected_remaining_minor THEN
    RAISE EXCEPTION 'balance_changed' USING ERRCODE = 'PT409', DETAIL = v_remaining::text;
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > v_remaining THEN
    RAISE EXCEPTION 'flex_amount_invalid' USING ERRCODE = '22023';
  END IF;
  v_min := least(COALESCE((v_order.payment_plan_terms->>'min_payment_minor')::bigint, 0), v_remaining);
  IF p_amount_minor < v_min THEN
    RAISE EXCEPTION 'flex_amount_below_minimum' USING ERRCODE = '22023', DETAIL = v_min::text;
  END IF;
  IF v_provider = 'stripe' AND p_method <> 'auto_card' THEN
    RAISE EXCEPTION 'invalid_attempt_method' USING ERRCODE = '22023';
  END IF;

  -- Allocate across packages pro rata to each one's open remaining (floor per
  -- line, the last line absorbs); the add-on share pro rata within each line.
  SELECT count(DISTINCT ticket_type_id) INTO v_lines FROM public.order_installments
   WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
  FOR v_line IN
    SELECT ticket_type_id, sum(amount_cents) AS amt, sum(addon_portion_minor) AS addon
      FROM public.order_installments
     WHERE order_id = p_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed')
     GROUP BY ticket_type_id ORDER BY ticket_type_id NULLS LAST
  LOOP
    v_seen := v_seen + 1;
    v_part := CASE WHEN v_seen < v_lines
      THEN floor(p_amount_minor::numeric * v_line.amt / v_remaining)::bigint
      ELSE p_amount_minor - v_run END;
    v_part := least(v_part, v_line.amt);
    v_run := v_run + v_part;
    v_part_addon := floor(v_part::numeric * v_line.addon / v_line.amt)::bigint;
    v_addon_total := v_addon_total + v_part_addon;
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_line.ticket_type_id, 'net_minor', v_part - v_part_addon, 'addon_minor', v_part_addon));
  END LOOP;
  IF v_run <> p_amount_minor THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(max(ordinal), 0) + 1 INTO v_ordinal FROM public.order_installments WHERE order_id = p_order_id;
  -- orch-strict-grep-allow tr3-schedule-currency-pinned — a flexible row takes the currency of the order's own open rows (v_currency), which checkout pinned from the session.
  INSERT INTO public.order_installments (
    order_id, ordinal, amount_cents, currency, due_at, status, provider, collection_method,
    kind, flex_client_key, line_allocation, addon_portion_minor, ticket_type_id,
    referral_share_minor, buyer_total_cents, planned_application_fee_cents, plan_bound_at
  ) VALUES (
    p_order_id, v_ordinal, p_amount_minor, v_currency, p_now, 'scheduled', v_provider, p_method,
    'flex', p_client_key, v_alloc, v_addon_total, NULL,
    least(floor(v_ref::numeric * p_amount_minor / v_remaining)::bigint, p_amount_minor),
    CASE WHEN v_provider = 'paystack' AND v_bt IS NOT NULL
      THEN floor(p_amount_minor::numeric * v_bt / v_remaining)::bigint END,
    CASE WHEN v_fee IS NOT NULL THEN floor(p_amount_minor::numeric * v_fee / v_remaining)::bigint END,
    CASE WHEN v_provider = 'paystack' THEN p_now END
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('installmentId', v_id, 'amountMinor', p_amount_minor,
    'buyerTotalMinor', CASE WHEN v_provider = 'paystack' AND v_bt IS NOT NULL
      THEN floor(p_amount_minor::numeric * v_bt / v_remaining)::bigint ELSE p_amount_minor END,
    'currency', trim(v_currency), 'provider', v_provider, 'status', 'scheduled',
    'remainingBeforeMinor', v_remaining, 'replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_begin_flex_payment(uuid, bigint, bigint, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_begin_flex_payment(uuid, bigint, bigint, text, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Settle a collected flexible payment: rebalance once (idempotent).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_settle_flex_payment(p_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_row public.order_installments;
  v_result jsonb;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  SELECT * INTO v_row FROM public.order_installments WHERE id = p_installment_id FOR UPDATE;
  IF v_row.kind <> 'flex' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_flex');
  END IF;
  IF v_row.status <> 'collected' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_collected', 'status', v_row.status);
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_balance_events
              WHERE trigger_installment_id = p_installment_id AND reason = 'flex_payment') THEN
    SELECT jsonb_build_object('ok', true, 'replayed', true,
             'remainingMinor', COALESCE(sum(amount_cents), 0),
             'paidInFull', COALESCE(sum(amount_cents), 0) = 0)
      INTO v_result FROM public.order_installments
     WHERE order_id = v_order_id AND kind = 'scheduled' AND status IN ('scheduled', 'failed');
    RETURN v_result;
  END IF;
  v_result := public.issue_4522_rebalance_order(v_order_id, 'flex_payment', p_installment_id, NULL,
    v_row.line_allocation, NULL);
  IF (v_result->>'remainingMinor')::bigint = 0 THEN
    UPDATE public.order_balance_links SET revoked_at = now(), revoked_reason = 'paid_in_full'
     WHERE order_id = v_order_id AND revoked_at IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', false,
    'remainingMinor', (v_result->>'remainingMinor')::bigint,
    'paidInFull', (v_result->>'remainingMinor')::bigint = 0);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_settle_flex_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_settle_flex_payment(uuid) TO service_role;

-- A failed flexible payment is closed (superseded, failure kept) so the
-- one-open-flex index frees; it is never retried.
CREATE FUNCTION public.issue_4522_close_failed_flex(p_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order_id uuid;
  v_n integer;
BEGIN
  SELECT order_id INTO v_order_id FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND OR public.issue_4522_lock_order_graph(v_order_id) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;
  UPDATE public.order_installments
     SET status = 'superseded', superseded_at = now(), next_retry_at = NULL,
         in_flight_attempt_id = NULL, updated_at = now()
   WHERE id = p_installment_id AND kind = 'flex' AND status IN ('failed', 'scheduled');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n = 1, 'closed', v_n = 1);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_close_failed_flex(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_close_failed_flex(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. "Pay toward your balance" links (raw token never stored; 30 days; one
--    live link per order; revoked when paid in full or cancelled).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_issue_balance_link(
  p_order_id uuid,
  p_token_hash bytea,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_status text;
  v_order public.orders;
  v_id uuid;
  v_expires timestamptz := p_now + interval '30 days';
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid_token_hash' USING ERRCODE = '22023';
  END IF;
  v_event_status := public.issue_4522_lock_order_graph(p_order_id);
  IF v_event_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'balance_not_found');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.cancelled_at IS NOT NULL OR v_event_status = 'cancelled'
     OR COALESCE((v_order.payment_plan_terms->>'v')::integer, 0) <> 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'balance_not_open');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_installments WHERE order_id = p_order_id
                  AND kind = 'scheduled' AND status IN ('scheduled', 'failed')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_in_full');
  END IF;
  UPDATE public.order_balance_links SET revoked_at = p_now, revoked_reason = 'replaced'
   WHERE order_id = p_order_id AND revoked_at IS NULL;
  INSERT INTO public.order_balance_links (order_id, token_hash, expires_at, created_at)
  VALUES (p_order_id, p_token_hash, v_expires, p_now) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'link_id', v_id, 'expires_at', v_expires);
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_issue_balance_link(uuid, bytea, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_issue_balance_link(uuid, bytea, timestamptz) TO service_role;

CREATE FUNCTION public.issue_4522_resolve_balance_link(
  p_token_hash bytea,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_link public.order_balance_links;
  v_order public.orders;
  v_event public.events;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  SELECT * INTO v_link FROM public.order_balance_links WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'invalid'); END IF;
  IF v_link.expires_at <= p_now
     OR (v_link.revoked_at IS NOT NULL AND v_link.revoked_reason IS DISTINCT FROM 'paid_in_full') THEN
    RETURN jsonb_build_object('state', 'expired');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_link.order_id;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  UPDATE public.order_balance_links SET open_count = open_count + 1, last_opened_at = p_now
   WHERE id = v_link.id;
  RETURN jsonb_build_object(
    'state', CASE
      WHEN v_order.cancelled_at IS NOT NULL OR v_event.status = 'cancelled' THEN 'no_longer_due'
      WHEN v_link.revoked_reason = 'paid_in_full' THEN 'paid'
      ELSE 'payable' END,
    'order_id', v_order.id,
    'trip_title', v_event.title,
    'brand_name', (SELECT b.name FROM public.brands b WHERE b.id = v_event.brand_id));
END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_resolve_balance_link(bytea, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_resolve_balance_link(bytea, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Claim guards (I-4522-4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_order_installment_for_charge(p_installment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inst public.order_installments;
  v_order public.orders;
  v_event_status text;
  v_order_id uuid;
  v_event_id uuid;
BEGIN
  IF p_installment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_id_required');
  END IF;

  -- Lightweight reads discover the lock graph without holding row locks yet.
  -- Lock order MUST match cancel_event_refund_prepare: event → order → installment
  -- (otherwise concurrent claim/cancel deadlocks).
  SELECT order_id INTO v_order_id
  FROM public.order_installments
  WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  SELECT event_id INTO v_event_id
  FROM public.orders
  WHERE id = v_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  SELECT e.status INTO v_event_status
  FROM public.events e
  WHERE e.id = v_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_missing');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  SELECT * INTO v_inst
  FROM public.order_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  -- Re-validate chargeability on the locked rows.
  IF v_inst.status NOT IN ('scheduled', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'installment_not_chargeable',
      'status', v_inst.status
    );
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

  -- issue #4522 — a flexible payment is never charged here (it has its own
  -- payment), and no planned row is charged while one is open (I-4522-4).
  IF v_inst.kind = 'flex' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'flex_not_cron_chargeable');
  END IF;
  IF public.issue_4522_order_has_open_flex(v_order.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'flex_payment_in_flight');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', v_inst.id,
    'order_id', v_order.id,
    'event_id', v_order.event_id,
    'status', v_inst.status,
    'retry_count', v_inst.retry_count,
    'amount_cents', v_inst.amount_cents,
    'currency', v_inst.currency
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3645_begin_installment_attempt(p_installment_id uuid, p_method text, p_application_fee_cents bigint, p_atrisk_override boolean DEFAULT false, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- issue #4522 — no planned row is charged while a flexible payment is open.
  IF v_inst.kind = 'scheduled' AND public.issue_4522_order_has_open_flex(v_inst.order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'flex_payment_in_flight');
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
$function$;

COMMIT;
