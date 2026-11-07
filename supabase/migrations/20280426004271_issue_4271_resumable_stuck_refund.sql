-- Issue #4271 follow-up: a refund whose Stripe outcome is unknown no longer
-- blocks the order forever.
--
-- refund-order leaves a refunds row 'pending' when Stripe's answer is unknown
-- (a network error, a 5xx, an idempotency conflict). The host's retry comes with
-- a new client idempotency key, and refund_preview / biz_refund_order counted the
-- stuck row as already refunded ("line_overrefund: requested=2 existing=2"), so
-- the app said "Couldn't price this refund" for good.
--
-- A stuck row is RESUMABLE when it is still pending, Stripe has not recorded a
-- refund for it (stripe_refund_id IS NULL — issue_2097_record_buyer_refund sets
-- it the moment Stripe answers), and it asks for exactly the requested lines.
-- refund_preview stops counting that one row, and refund-order replays it under
-- its ORIGINAL idempotency key, lines and reason (issue_4271_resumable_refund),
-- so the Stripe call reuses `ticket_refund:<refund id>` and Stripe returns the
-- original result instead of making a second refund. biz_refund_order is not
-- changed: a new key still counts the row, which is what triggers the resume.
--
-- Static SQL, CREATE OR REPLACE only, no data change; safe to run twice.

CREATE OR REPLACE FUNCTION public.issue_4271_resumable_refund_id(
  p_order_id uuid,
  p_canonical_lines jsonb
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT r.id
  FROM public.refunds r
  WHERE r.order_id = p_order_id
    AND r.status = 'pending'
    AND r.stripe_refund_id IS NULL
    AND r.metadata ? 'idempotency_key'
    AND jsonb_typeof(r.metadata->'refund_request_manifest'->'lines') = 'array'
    AND r.metadata->'refund_request_manifest'->>'reason' IS NOT NULL
    AND r.metadata->'refund_request_manifest'->'lines' = p_canonical_lines
  ORDER BY r.created_at, r.id
  LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.issue_4271_resumable_refund_id(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_resumable_refund_id(uuid, jsonb)
  TO service_role;
COMMENT ON FUNCTION public.issue_4271_resumable_refund_id(uuid, jsonb) IS
  'Issue #4271: the pending refund on this order, with no Stripe refund recorded, that asks for exactly these server lines; NULL when none. Internal helper for refund_preview and issue_4271_resumable_refund.';

-- What refund-order needs to replay the stuck row exactly: its own key, reason
-- and the lines it was first sent with (biz_refund_order rejects a replay whose
-- lines or reason differ). Service role only; refund-order calls it after
-- biz_refund_order has already checked the caller's payment rights.
CREATE OR REPLACE FUNCTION public.issue_4271_resumable_refund(
  p_order_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_refund public.refunds%ROWTYPE;
  v_manifest jsonb;
BEGIN
  v_id := public.issue_4271_resumable_refund_id(
    p_order_id, public.issue_3872_refund_server_lines(p_order_id, p_lines));
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id = v_id;
  v_manifest := v_refund.metadata->'refund_request_manifest';
  RETURN jsonb_build_object(
    'refund_id', v_refund.id,
    'idempotency_key', v_refund.metadata->>'idempotency_key',
    'reason', v_manifest->>'reason',
    'lines', CASE
      WHEN jsonb_typeof(v_manifest->'client_lines') = 'array'
        THEN v_manifest->'client_lines'
      ELSE v_manifest->'lines'
    END
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_4271_resumable_refund(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4271_resumable_refund(uuid, jsonb)
  TO service_role;
COMMENT ON FUNCTION public.issue_4271_resumable_refund(uuid, jsonb) IS
  'Issue #4271: the key, reason and original lines refund-order uses to replay a pending refund whose Stripe outcome is unknown, so the retry reuses its Stripe idempotency key. Service role only.';

-- refund_preview: unchanged from 20280301003281 except that the one resumable
-- row asking for exactly these lines is not counted as already refunded.
CREATE OR REPLACE FUNCTION public.refund_preview(
  p_order_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing integer;
  v_amount bigint := 0;
  v_remaining bigint;
  v_resumable uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  -- Issue #4271: a stuck pending refund for exactly these lines is what the
  -- retry resumes, not a second refund, so it is not counted against them.
  v_resumable := public.issue_4271_resumable_refund_id(p_order_id, v_lines);
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded')
      AND r.id IS DISTINCT FROM v_resumable;
    IF v_existing + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_amount := v_amount + (v_line->>'amount_cents')::bigint;
  END LOOP;
  -- issue #3281 — the same rule the refund itself applies.
  v_amount := v_amount + public.issue_3281_extras_refund_cents(p_order_id, v_lines, NULL);

  v_remaining := COALESCE(v_order.buyer_total_cents, v_order.total_cents)
    - COALESCE(v_order.refunded_amount_cents, 0);
  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'currency', v_order.currency,
    'lines', v_lines,
    'amount_cents', v_amount,
    'remaining_cents', v_remaining,
    'within_remaining', v_amount <= v_remaining
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.refund_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_preview(uuid, jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.refund_preview(uuid, jsonb) IS
  'Issue #3872: the amount refunding these lines would return (quantity x unit price at purchase), computed by the same rule biz_refund_order applies. Read-only. Callers need payment rights on the order''s brand. Issue #4271: a pending refund for exactly these lines that Stripe has not answered is resumed by the retry, so it is not counted.';
