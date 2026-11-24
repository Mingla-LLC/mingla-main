-- Issue #4490, spec 08 O3 fix 5 (the device test's O3-S3, money shown wrong).
--
-- A Till request id (client_request_id) names ONE money action on a check. A
-- retry of that action (same id, same money facts) answers the ORIGINAL
-- action's facts; the same id arriving with different money facts is refused
-- with PT409 'till_request_reused' and moves no money. Before this, every Till
-- money action answered "replayed" on the id alone, so a second, different
-- payment or refund sent with a reused id was shown as done and never made.
--
-- 1. issue_4490_till_take_payment (cash, own machine): the check is locked
--    BEFORE the id is looked up (two calls with one id run one after the
--    other: one payment, the second a replay); same id with another method,
--    amount, tip or cash given -> till_request_reused; the answer (new and
--    replayed) carries the payment's own method, amount, tip and state.
-- 2. issue_4490_till_card_start (tap, scan): locked before the lookup; same id
--    with another method or tip -> till_request_reused (was
--    till_idempotency_conflict for the method only; the tip was ignored).
-- 3. issue_4490_till_refund (cash / own machine refund of a payment) and
--    issue_4490_till_mint_carrier_refund (card refund): a request id is one
--    refund on the CHECK (was: per payment). Same id, same payment, same amount
--    and tip -> replay with the original refund's amount and tip; anything else
--    (another payment, another amount or tip, a line refund's id) ->
--    till_request_reused.
-- 4. issue_4490_till_refund_line: same id for this line -> replay with the
--    amount that line refund took; the id already used for anything else on
--    the check -> till_request_reused.
--
-- What "the same money facts" means, per action, is the list compared in each
-- body below. The check version (T10) is deliberately NOT one of them: a
-- genuine retry still carries the version from before its own first try.
--
-- Function bodies: all five are checked patches of their live (latest)
-- definitions (take_payment: 464490 + 594490 + 600490; card_start: 599490;
-- refund: 464490 + 594490; mint_carrier_refund: 584490 + 594490;
-- refund_line: 594490). Each keeps its signature, grants and class in the
-- privilege matrix (INTERNAL: service role only). pg_venue_order_finalize_payment
-- and issue_4490_till_apply_payment are not touched. No column, no venue_id
-- (the #2099 seal is unchanged). The event door scope and guest ordering are
-- not touched. Static SQL. Local stack only until Seth approves a production
-- migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o3f5_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O3F5 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. Cash and the venue's own card machine.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)'::regprocedure,
  $old$  -- Replay first: a retried tap returns the payment it made.
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    PERFORM public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
    RETURN jsonb_build_object('paymentId', v_existing.id, 'replayed', true,
      'changeMinor', CASE WHEN v_existing.cash_given_minor IS NOT NULL
        THEN v_existing.cash_given_minor - v_existing.amount_minor - v_existing.tip_minor END,
      'sale', public.issue_4490_till_sale_projection(p_sale_id));
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
$old$,
  $new$  -- #4490 08-O3 fix 5 (O3-S3): the check is locked first, then the request id
  -- is looked up, so two calls with one id run one after the other. The same
  -- id with the same money facts is a retry: it answers the ORIGINAL payment
  -- (its method, amount, tip, change). The same id with another method,
  -- amount, tip or cash given is refused and moves no money.
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.method IS DISTINCT FROM p_method
       OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
       OR v_existing.tip_minor IS DISTINCT FROM v_tip
       OR v_existing.cash_given_minor IS DISTINCT FROM p_cash_given_minor THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'replayed', true,
      'method', v_existing.method, 'amountMinor', v_existing.amount_minor,
      'tipMinor', v_existing.tip_minor, 'state', v_existing.state,
      'changeMinor', CASE WHEN v_existing.cash_given_minor IS NOT NULL
        THEN v_existing.cash_given_minor - v_existing.amount_minor - v_existing.tip_minor END,
      'sale', public.issue_4490_till_sale_projection(p_sale_id));
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
$new$);

SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)'::regprocedure,
  $old$  RETURN jsonb_build_object('paymentId', v_payment_id, 'replayed', false,
    'salePaid', COALESCE((v_result->>'salePaid')::boolean, false),$old$,
  $new$  RETURN jsonb_build_object('paymentId', v_payment_id, 'replayed', false,
    'method', p_method, 'amountMinor', p_amount_minor, 'tipMinor', v_tip,
    'state', (SELECT p.state FROM public.venue_till_payments p WHERE p.id = v_payment_id),
    'salePaid', COALESCE((v_result->>'salePaid')::boolean, false),$new$);

-- ---------------------------------------------------------------------------
-- 2. Tap to pay and Scan to pay (the amount is always what is left, so the
--    money facts a caller sends are the method and the tip).
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_card_start(uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)'::regprocedure,
  $old$  -- Replay: the same request returns the payment (and code) it made.
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    PERFORM public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
    IF v_existing.method <> p_method THEN
      RAISE EXCEPTION 'till_idempotency_conflict' USING ERRCODE = 'PT409';
    END IF;$old$,
  $new$  -- Replay: the same request returns the payment (and code) it made.
  -- #4490 08-O3 fix 5: locked before the lookup (one id, one payment, also
  -- when two calls race); the same id with another method or tip is refused.
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_existing.method IS DISTINCT FROM p_method OR v_existing.tip_minor IS DISTINCT FROM v_tip THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;$new$);

SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_card_start(uuid,text,bigint,uuid,uuid,uuid,integer,jsonb,text)'::regprocedure,
  $old$      'code', v_code.code, 'codeStatus', v_code.status, 'expiresAt', v_code.expires_at);
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
$old$,
  $new$      'code', v_code.code, 'codeStatus', v_code.status, 'expiresAt', v_code.expires_at);
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
$new$);

-- ---------------------------------------------------------------------------
-- 3. Refund of a cash / own-machine payment: a request id is one refund on
--    the check.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_refund(uuid,bigint,bigint,text,boolean,uuid,uuid,uuid)'::regprocedure,
  $old$  SELECT * INTO v_existing FROM public.venue_till_refunds
  WHERE payment_id = v_payment.id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('refundId', v_existing.id, 'replayed', true,
      'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;$old$,
  $new$  -- #4490 08-O3 fix 5: a request id is one refund on this check. Same payment,
  -- same amount and tip -> the original refund's answer; anything else (another
  -- payment, another amount or tip, a line refund's id) is refused, nothing moves.
  SELECT r.* INTO v_existing FROM public.venue_till_refunds r
  JOIN public.venue_till_payments p ON p.id = r.payment_id
  WHERE p.sale_id = v_sale.id AND r.client_request_id = p_client_request_id
  ORDER BY r.created_at, r.id
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.payment_id <> v_payment.id OR v_existing.line_id IS NOT NULL
       OR v_existing.amount_minor <> v_amount OR v_existing.tip_minor <> v_tip
       OR (SELECT count(*) FROM public.venue_till_refunds r
           JOIN public.venue_till_payments p ON p.id = r.payment_id
           WHERE p.sale_id = v_sale.id AND r.client_request_id = p_client_request_id) <> 1 THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('refundId', v_existing.id, 'replayed', true,
      'amountMinor', v_existing.amount_minor, 'tipMinor', v_existing.tip_minor,
      'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;$new$);

SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_refund(uuid,bigint,bigint,text,boolean,uuid,uuid,uuid)'::regprocedure,
  $old$  RETURN jsonb_build_object('refundId', v_refund_id, 'replayed', false,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));$old$,
  $new$  RETURN jsonb_build_object('refundId', v_refund_id, 'replayed', false,
    'amountMinor', v_amount, 'tipMinor', v_tip,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));$new$);

-- ---------------------------------------------------------------------------
-- 3b. Card refund (tap / scan payments): the same rule.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_mint_carrier_refund(uuid,bigint,bigint,uuid,uuid,text,uuid)'::regprocedure,
  $old$  SELECT * INTO v_existing FROM public.venue_till_refunds
  WHERE payment_id = v_payment.id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('refundId', v_existing.id, 'sourceRefundId', v_existing.source_refund_id,
      'replayed', true, 'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;$old$,
  $new$  -- #4490 08-O3 fix 5: a request id is one refund on this check (as the cash
  -- refund): same payment, amount and tip -> the original answer; else refused.
  SELECT r.* INTO v_existing FROM public.venue_till_refunds r
  JOIN public.venue_till_payments p ON p.id = r.payment_id
  WHERE p.sale_id = v_sale.id AND r.client_request_id = p_client_request_id
  ORDER BY r.created_at, r.id
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.payment_id <> v_payment.id OR v_existing.line_id IS NOT NULL
       OR v_existing.amount_minor <> v_amount OR v_existing.tip_minor <> v_tip
       OR (SELECT count(*) FROM public.venue_till_refunds r
           JOIN public.venue_till_payments p ON p.id = r.payment_id
           WHERE p.sale_id = v_sale.id AND r.client_request_id = p_client_request_id) <> 1 THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('refundId', v_existing.id, 'sourceRefundId', v_existing.source_refund_id,
      'amountMinor', v_existing.amount_minor + v_existing.tip_minor, 'tipMinor', v_existing.tip_minor,
      'replayed', true, 'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;$new$);

-- ---------------------------------------------------------------------------
-- 4. Refund of a paid entry / package line, in full.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3f5_patch(
  'public.issue_4490_till_refund_line(uuid,uuid,uuid,text,uuid)'::regprocedure,
  $old$  -- Replay: the same request returns what it did.
  IF EXISTS (SELECT 1 FROM public.venue_till_refunds r
             WHERE r.line_id = v_line.id AND r.client_request_id = p_client_request_id) THEN
    RETURN jsonb_build_object('replayed', true, 'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;$old$,
  $new$  -- Replay: the same request returns what it did.
  -- #4490 08-O3 fix 5: the id already used on this check for anything but
  -- this line's refund is refused; a replay answers what this line refund took.
  IF EXISTS (SELECT 1 FROM public.venue_till_refunds r
             JOIN public.venue_till_payments p ON p.id = r.payment_id
             WHERE p.sale_id = v_sale.id AND r.client_request_id = p_client_request_id) THEN
    IF EXISTS (SELECT 1 FROM public.venue_till_refunds r
               JOIN public.venue_till_payments p ON p.id = r.payment_id
               WHERE p.sale_id = v_sale.id AND r.client_request_id = p_client_request_id
                 AND r.line_id IS DISTINCT FROM v_line.id) THEN
      RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('replayed', true,
      'refundedMinor', (SELECT sum(r.amount_minor) FROM public.venue_till_refunds r
                        WHERE r.line_id = v_line.id AND r.client_request_id = p_client_request_id),
      'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;$new$);

COMMIT;
