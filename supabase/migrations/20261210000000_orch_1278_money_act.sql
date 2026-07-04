-- ORCH-1278 [Admin Money console — WAVE-2 EDIT / ACT] — audited money-act RPCs.
-- Parent META-ORCH-1237; children-of ORCH-1271 (authz+audit FOUNDATION) + ORCH-1274 (money READ).
--
-- Four audited money actions. Stripe-touching acts (W2-A refund, W2-B connect) run
-- as service_role EDGE FNS (admin_users re-check) that call the RPCs below; DB-only
-- acts (W2-C dispute annotate, W2-D subscription override wrappers) are user-JWT admin
-- RPCs (golden template — guard-first, reason-gated, audited).
--
-- W2-A twin RPCs (admin_refund_order / admin_refund_order_commit): exact copies of the
-- brand-gated biz_refund_order / biz_refund_order_commit with the brand gate STRIPPED and
-- replaced by the service_role-safe twin guard, GRANTed to service_role ONLY (revoked from
-- PUBLIC/anon/authenticated). admin_refund_order additionally adds a NEW total-amount ceiling
-- (Σ ≤ total − already_refunded) the biz fn lacks. The biz_* originals are DO-NOT-TOUCH.
--
-- Enforces I-PROPOSED-1278-MONEY-ACT-AUDITED + I-PROPOSED-1278-ADMIN-GATE-FIRST +
-- I-PROPOSED-1278-ADMIN-REFUND-BOUNDED (see .github/scripts/strict-grep + INVARIANT_REGISTRY).

--------------------------------------------------------------------------------
-- W2-A.1 — admin_refund_order (service_role twin of biz_refund_order,
--          20260520000000 §2.6). Brand gate stripped; twin guard first;
--          NEW total-amount ceiling; service_role-only EXECUTE.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refund_order(
  p_order_id uuid,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_pending uuid;
  v_remaining_cents int;
BEGIN
  -- TWIN GUARD (first executable statement). Blocks a direct JWT non-admin; passes for
  -- service_role (auth.uid() IS NULL) — the real gate is the edge fn's admin_users check
  -- + the service_role-only EXECUTE grant below. is_admin_user() returns FALSE for
  -- service_role, so the plain `IF NOT is_admin_user()` form would wrongly block the
  -- edge path; the auth.uid()-null-safe form is required for service_role twins.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- 0. Idempotency precheck: if a pending row with this idempotency key already exists, return it
  SELECT id INTO v_existing_pending
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
    AND status = 'pending'
  LIMIT 1;

  IF v_existing_pending IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'refund_id', v_existing_pending,
      'order_id', p_order_id,
      'amount_cents', (SELECT amount_cents FROM public.refunds WHERE id = v_existing_pending),
      'currency', v_order.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status', 'partial_refund',
      'is_full_refund', false,
      'idempotent_replay', true
    );
  END IF;

  -- 1. Load order (brand permission gate REMOVED — admin twin; gate is the edge fn + grant)
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Validate order state
  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- 4. Validate lines: per-line cumulative refund must not exceed line quantity
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded, v_line_item.quantity
        USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents := v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- 4b. NEW total-amount ceiling (ORCH-1278, the guard biz_refund_order lacks): the free-form
  -- per-line amount_cents sum cannot exceed what remains refundable on the order, even if
  -- quantities technically fit. This is the reason W2-A is CRITICAL.
  v_remaining_cents := v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);
  IF v_refund_amount_cents > v_remaining_cents THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents, v_remaining_cents USING ERRCODE = 'P0009';
  END IF;

  -- 5. Insert public.refunds row (status='pending' — edge function flips to 'succeeded' via commit RPC)
  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_refund_id;

  -- 6. Insert refund_line_items
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid;
  END LOOP;

  -- 7. Compute proposed new payment_status (based on pending+succeeded refunds; final status set in commit)
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
  ) INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;

  -- 8. Return manifest. orders.payment_status is NOT advanced here.
  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'idempotent_replay', false
  );
END;
$$;

-- LEAST-PRIVILEGE (service_role-only twin — NEVER authenticated). The edge fn's
-- admin_users active-check is the real gate; this RPC is unreachable by a JWT caller.
REVOKE ALL ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) IS
  'ORCH-1278: admin (service_role) twin of biz_refund_order — brand gate stripped, total-amount ceiling added. Called ONLY by the admin-refund-order edge fn (admin_users-gated). service_role EXECUTE only.';

--------------------------------------------------------------------------------
-- W2-A.2 — admin_refund_order_commit (service_role twin of biz_refund_order_commit,
--          20260727000000 native-tax version). Brand gate stripped; twin guard first;
--          service_role-only EXECUTE.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refund_order_commit(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_application_fee_refunded_cents integer,
  p_status text,
  p_stripe_tax_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_line_item record;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  -- TWIN GUARD (first executable statement) — see admin_refund_order.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_refund.status <> 'pending' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'status', v_refund.status,
      'new_payment_status', v_order.payment_status,
      'total_refunded_cents', v_order.refunded_amount_cents,
      'idempotent_replay', true
    );
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_commit_status' USING ERRCODE = 'P0012';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
  -- Brand permission gate REMOVED (admin twin; gate is the edge fn + service_role grant).

  IF p_status = 'failed' THEN
    UPDATE public.refunds
    SET status = 'failed',
        stripe_tax_transaction_id = COALESCE(p_stripe_tax_transaction_id, stripe_tax_transaction_id),
        processed_at = now()
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed', 'idempotent_replay', false);
  END IF;

  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      stripe_tax_transaction_id = p_stripe_tax_transaction_id,
      application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
      processed_at = now()
  WHERE id = p_refund_id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded';

  IF NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = v_order.id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status = 'succeeded'
      )
  ) THEN
    v_new_payment_status := 'refunded';
  ELSE
    v_new_payment_status := 'partial_refund';
  END IF;

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = v_order.id;

  FOR v_line_item IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = p_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = v_order.id
        AND t2.ticket_type_id = v_line_item.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line_item.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', p_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'stripe_tax_transaction_id', p_stripe_tax_transaction_id,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) IS
  'ORCH-1278: admin (service_role) twin of biz_refund_order_commit — brand gate stripped. Called ONLY by the admin-refund-order edge fn. service_role EXECUTE only.';

--------------------------------------------------------------------------------
-- W2-C — dispute internal note / mark-reviewed. Additive nullable columns +
--        DB-only audited RPC (golden template). NO Stripe, NO money. Does NOT
--        touch status/amount/raw_event/evidence_due_by — only admin annotations.
--        (admin_get_dispute returns to_jsonb(row), so these columns surface in the
--        1274 read bundle automatically — no read-RPC change needed.)
--------------------------------------------------------------------------------
ALTER TABLE public.stripe_disputes
  ADD COLUMN IF NOT EXISTS admin_internal_note text,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by   uuid;

CREATE OR REPLACE FUNCTION public.admin_annotate_dispute(
  p_dispute_id uuid,
  p_note text,
  p_mark_reviewed boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_after jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.stripe_disputes
    SET admin_internal_note = COALESCE(p_note, admin_internal_note),
        admin_reviewed_at   = CASE WHEN p_mark_reviewed THEN now()       ELSE admin_reviewed_at END,
        admin_reviewed_by   = CASE WHEN p_mark_reviewed THEN auth.uid()  ELSE admin_reviewed_by END,
        updated_at          = now()
    WHERE id = p_dispute_id
    RETURNING to_jsonb(stripe_disputes) INTO v_after;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute_not_found'; END IF;
  PERFORM public.admin_write_audit('dispute.annotate', 'stripe_dispute', p_dispute_id::text, p_reason,
    jsonb_build_object('note_set', p_note IS NOT NULL, 'marked_reviewed', p_mark_reviewed));
  RETURN v_after;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_annotate_dispute(uuid, text, boolean, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_annotate_dispute(uuid, text, boolean, text) TO authenticated;

--------------------------------------------------------------------------------
-- W2-D — subscription comp / extend / revoke override. Thin AUDITED WRAPPERS over
--        the existing admin-gated admin_grant_override / admin_revoke_override (both
--        DO-NOT-TOUCH — called, never modified). The wrapper writes the server-side
--        admin_write_audit row so every money-console act shares one audit trail.
--        Real cancel/refund of a paid subscription is OUT OF SCOPE (RevenueCat-owned).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_override_audited(
  p_user_id uuid,
  p_tier text,
  p_reason text,
  p_duration_days int DEFAULT 30,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  -- p_expires_at NULL → the base RPC derives expires from now() + p_duration_days.
  v_id := public.admin_grant_override(p_user_id, p_tier, p_reason, auth.uid(), now(), p_expires_at, p_duration_days);
  PERFORM public.admin_write_audit('subscription.override_grant', 'subscription', p_user_id::text, p_reason,
    jsonb_build_object('tier', p_tier, 'duration_days', p_duration_days, 'override_id', v_id));
  RETURN v_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_grant_override_audited(uuid, text, text, int, timestamptz) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_grant_override_audited(uuid, text, text, int, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_override_audited(
  p_override_id uuid,
  p_user_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ok boolean;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  v_ok := public.admin_revoke_override(p_override_id, auth.uid());
  PERFORM public.admin_write_audit('subscription.override_revoke', 'subscription', p_user_id::text, p_reason,
    jsonb_build_object('override_id', p_override_id));
  RETURN v_ok;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_override_audited(uuid, uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_override_audited(uuid, uuid, text) TO authenticated;

--------------------------------------------------------------------------------
-- 1274 read-RPC extend (allowlisted, additive): admin_get_order line_items must
-- expose order_line_item_id + already-refunded quantity so the W2-A refund line-
-- picker can build the refund payload. All other keys unchanged (guard-first kept;
-- CREATE OR REPLACE preserves the existing anon-revoked/authenticated grant).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_order jsonb; v_event_id uuid; v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT to_jsonb(o) INTO v_order FROM public.orders o WHERE o.id = p_order_id;
  IF v_order IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_event_id := NULLIF(v_order->>'event_id','')::uuid;
  v_out := jsonb_build_object(
    'order', v_order,
    'event', (SELECT jsonb_build_object('id', e.id, 'title', e.title, 'event_type', e.event_type,
                'city', e.city, 'status', e.status, 'visibility', e.visibility)
              FROM public.events e WHERE e.id = v_event_id),
    'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug)
              FROM public.events e JOIN public.brands b ON b.id = e.brand_id
              WHERE e.id = v_event_id),
    'line_items', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'order_line_item_id', li.id,
                'ticket_type_name', tt.name, 'quantity', li.quantity,
                'unit_price_cents', li.unit_price_cents, 'total_cents', li.total_cents,
                'refunded_quantity', (
                  SELECT COALESCE(SUM(rli.quantity), 0)
                  FROM public.refund_line_items rli
                  JOIN public.refunds r ON r.id = rli.refund_id
                  WHERE rli.order_line_item_id = li.id
                    AND r.status IN ('pending', 'succeeded')))
              ORDER BY li.id)
       FROM public.order_line_items li
       LEFT JOIN public.ticket_types tt ON tt.id = li.ticket_type_id
       WHERE li.order_id = p_order_id), '[]'::jsonb),
    'installments', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'ordinal', oi.ordinal, 'amount_cents', oi.amount_cents, 'currency', oi.currency,
                'due_at', oi.due_at, 'status', oi.status, 'collected_at', oi.collected_at,
                'failed_at', oi.failed_at, 'failure_reason', oi.failure_reason)
              ORDER BY oi.ordinal)
       FROM public.order_installments oi WHERE oi.order_id = p_order_id), '[]'::jsonb),
    'refunds', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'id', r.id, 'amount_cents', r.amount_cents, 'currency', r.currency,
                'status', r.status, 'reason', r.reason, 'stripe_refund_id', r.stripe_refund_id,
                'created_at', r.created_at, 'processed_at', r.processed_at)
              ORDER BY r.created_at DESC)
       FROM public.refunds r WHERE r.order_id = p_order_id), '[]'::jsonb),
    'partner_split', (SELECT jsonb_build_object(
                'mingla_fee_cents', ps.mingla_fee_cents, 'partner_share_cents', ps.partner_share_cents,
                'transfer_currency', ps.transfer_currency, 'status', ps.status)
              FROM public.partner_splits ps WHERE ps.order_id = p_order_id
              ORDER BY ps.created_at DESC LIMIT 1));
  RETURN v_out;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_get_order(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_order(uuid) TO authenticated;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS unless the privilege lockdown holds. Runtime-proves
-- least-privilege at apply time (I-PROPOSED-1278-ADMIN-GATE-FIRST grant clause).
--   twin refund RPCs → service_role ONLY (anon/authenticated CANNOT execute).
--   DB-only audited RPCs → authenticated (admin UI) but NOT anon.
--------------------------------------------------------------------------------
DO $$
BEGIN
  -- W2-A twins: service_role only.
  IF has_function_privilege('anon',          'public.admin_refund_order(uuid,jsonb,text,text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.admin_refund_order(uuid,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: admin_refund_order is EXECUTE-able by anon/authenticated (must be service_role only)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_refund_order(uuid,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: service_role lost EXECUTE on admin_refund_order (edge fn would break)';
  END IF;
  IF has_function_privilege('anon',          'public.admin_refund_order_commit(uuid,text,integer,text,text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.admin_refund_order_commit(uuid,text,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: admin_refund_order_commit is EXECUTE-able by anon/authenticated (must be service_role only)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_refund_order_commit(uuid,text,integer,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: service_role lost EXECUTE on admin_refund_order_commit (edge fn would break)';
  END IF;
  -- W2-C / W2-D DB-only RPCs: authenticated yes, anon no.
  IF has_function_privilege('anon', 'public.admin_annotate_dispute(uuid,text,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: admin_annotate_dispute still EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_annotate_dispute(uuid,text,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: authenticated lost EXECUTE on admin_annotate_dispute (admin UI would break)';
  END IF;
  IF has_function_privilege('anon', 'public.admin_grant_override_audited(uuid,text,text,integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: admin_grant_override_audited still EXECUTE-able by anon';
  END IF;
  IF has_function_privilege('anon', 'public.admin_revoke_override_audited(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1278: admin_revoke_override_audited still EXECUTE-able by anon';
  END IF;
END $$;
