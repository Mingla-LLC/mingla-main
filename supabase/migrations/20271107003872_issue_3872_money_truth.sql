-- Issue #3872 PR 1 — money truth (toward #3872 and #3645).
--
-- Additive only: new nullable columns, new service-role helpers, and function
-- bodies redefined FROM THEIR LIVE PRODUCTION DEFINITIONS (read with
-- pg_get_functiondef on 19 Oct 2026 and confirmed identical to the latest repo
-- bodies named in each section; the comparison is posted on #3872).
--
-- §1  Explicit order totals on ticket_checkout_sessions and orders (F3).
-- §2  issue_3872_copy_session_totals_to_order + biz_ticket_checkout_finalize:
--     finalize copies the totals and pricing_breakdown to the order (F2).
-- §3  issue_3872_record_ticket_provider_total: what the provider charged.
-- §4  Operator backfill of existing orders from stored provider records.
-- §5  Payout release equation (F1, F10, refunded fees, reservation fee).
-- §6  Server-computed refunds and refund_preview (F4).
-- §7  Proportional partner reversal on refunds (F5).
-- §8  Event cancellation refunds return the charged total, fees included.
-- §9  Stripe provider-fee snapshots exclude Mingla's application fee.
--
-- APPLY ORDER: this migration is applied to production BEFORE the pull request
-- merges. Merged edge functions call §3 (non-fatal), §7's
-- issue_3872_partner_split_refund_plan (stripe-webhook; a refund event would
-- error and retry until it exists) and §8's issue_3872_cancel_refund_order
-- (event-cancel-refund-fanout; cancellation refunds would fail and be retried
-- until it exists).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- =============================================================================
-- §1. Explicit order totals
-- =============================================================================
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS list_subtotal_cents bigint,
  ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_subtotal_cents bigint,
  ADD COLUMN IF NOT EXISTS buyer_fees_cents bigint,
  ADD COLUMN IF NOT EXISTS tax_cents bigint,
  ADD COLUMN IF NOT EXISTS buyer_total_cents bigint,
  ADD COLUMN IF NOT EXISTS pricing_source text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS list_subtotal_cents bigint,
  ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_subtotal_cents bigint,
  ADD COLUMN IF NOT EXISTS buyer_fees_cents bigint,
  ADD COLUMN IF NOT EXISTS tax_cents bigint,
  ADD COLUMN IF NOT EXISTS buyer_total_cents bigint,
  ADD COLUMN IF NOT EXISTS pricing_source text;

DO $cols$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['ticket_checkout_sessions', 'orders'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_table, v_table || '_issue_3872_totals_nonnegative');
    EXECUTE format($sql$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        discount_cents >= 0
        AND (list_subtotal_cents IS NULL OR list_subtotal_cents >= 0)
        AND (net_subtotal_cents IS NULL OR net_subtotal_cents >= 0)
        AND (buyer_fees_cents IS NULL OR buyer_fees_cents >= 0)
        AND (tax_cents IS NULL OR tax_cents >= 0)
        AND (buyer_total_cents IS NULL OR buyer_total_cents >= 0)
      )$sql$, v_table, v_table || '_issue_3872_totals_nonnegative');

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_table, v_table || '_issue_3872_totals_identity');
    -- When the charged total is recorded, its parts are recorded and add up.
    EXECUTE format($sql$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        buyer_total_cents IS NULL OR (
          list_subtotal_cents IS NOT NULL
          AND net_subtotal_cents IS NOT NULL
          AND buyer_fees_cents IS NOT NULL
          AND tax_cents IS NOT NULL
          AND pricing_source IS NOT NULL
          AND net_subtotal_cents = list_subtotal_cents - discount_cents
          AND buyer_total_cents = net_subtotal_cents + buyer_fees_cents + tax_cents
        )
      )$sql$, v_table, v_table || '_issue_3872_totals_identity');

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_table, v_table || '_issue_3872_pricing_source_check');
    EXECUTE format($sql$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        pricing_source IS NULL OR pricing_source IN (
          'computed_at_checkout', 'provider_reconciled', 'legacy_reconstructed'
        )
      )$sql$, v_table, v_table || '_issue_3872_pricing_source_check');
  END LOOP;
END
$cols$;

COMMENT ON COLUMN public.orders.total_cents IS
  'Legacy, path-dependent amount kept for compatibility: the ticket base on Stripe paths, the all-in total on Paystack. Issue #3872: new code reads buyer_total_cents (what the provider charged) and the explicit totals, never this column, for money.';
COMMENT ON COLUMN public.orders.list_subtotal_cents IS
  'Issue #3872: ticket lines at list price.';
COMMENT ON COLUMN public.orders.discount_cents IS
  'Issue #3872: discounts applied to the lines (0 until discounts ship).';
COMMENT ON COLUMN public.orders.net_subtotal_cents IS
  'Issue #3872: what the tickets cost after discounts, before fees and added tax.';
COMMENT ON COLUMN public.orders.buyer_fees_cents IS
  'Issue #3872: Mingla and service fees passed to the buyer.';
COMMENT ON COLUMN public.orders.tax_cents IS
  'Issue #3872: tax added on top for the buyer (exclusive regimes). Inclusive VAT is inside the prices and is reported in pricing_breakdown.components.tax_cents.';
COMMENT ON COLUMN public.orders.buyer_total_cents IS
  'Issue #3872: what the payment provider charged = net_subtotal_cents + buyer_fees_cents + tax_cents. Gross for the payout release.';
COMMENT ON COLUMN public.orders.pricing_source IS
  'Issue #3872: computed_at_checkout (written at create from the provider amount), provider_reconciled (confirmed against the provider''s own record) or legacy_reconstructed (rebuilt by the backfill without a provider record).';
COMMENT ON COLUMN public.ticket_checkout_sessions.buyer_total_cents IS
  'Issue #3872: the amount sent to the payment provider for this session, written from the same pricing breakdown; finalize copies it to orders.buyer_total_cents.';

-- =============================================================================
-- §2. Finalize copies the explicit totals and the breakdown to the order
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3872_copy_session_totals_to_order(
  p_checkout_session_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.orders o
  SET list_subtotal_cents = s.list_subtotal_cents,
      discount_cents = s.discount_cents,
      net_subtotal_cents = s.net_subtotal_cents,
      buyer_fees_cents = s.buyer_fees_cents,
      tax_cents = s.tax_cents,
      buyer_total_cents = s.buyer_total_cents,
      pricing_source = s.pricing_source,
      pricing_breakdown = COALESCE(o.pricing_breakdown, s.pricing_breakdown),
      updated_at = now()
  FROM public.ticket_checkout_sessions s
  WHERE s.id = p_checkout_session_id
    AND o.id = s.order_id
    AND s.buyer_total_cents IS NOT NULL
    AND o.buyer_total_cents IS NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid)
  TO service_role;
COMMENT ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid) IS
  'Issue #3872: copies the session''s explicit totals (and its pricing_breakdown when the order has none) onto the finalized order. Never overwrites totals already on the order. service_role only.';

-- Live body: 20270531002694_issue_2694_finalize_reports_replayed.sql (identical
-- in production). Only change: the two finalized arms call §2's copy.
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid, p_stripe_payment_intent_id text, p_stripe_charge_id text,
  p_stripe_payment_method_type text, p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL::text,
  p_saved_payment_method_id text DEFAULT NULL::text,
  p_installment_plan_root boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE v_session public.ticket_checkout_sessions%ROWTYPE; v_event public.events%ROWTYPE;
  v_admission public.event_checkout_admission_state%ROWTYPE;
  v_attempt public.ticket_checkout_provider_attempts%ROWTYPE; v_result jsonb; v_reversal jsonb;
  v_observed_provider text;
BEGIN
  SELECT e.* INTO v_event FROM public.ticket_checkout_sessions s
    JOIN public.events e ON e.id=s.event_id WHERE s.id=p_checkout_session_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id=p_checkout_session_id FOR UPDATE;
  IF v_session.order_id IS NOT NULL THEN RETURN jsonb_build_object('outcome','finalized','replayed',true,'orderId',v_session.order_id); END IF;
  SELECT * INTO v_attempt FROM public.ticket_checkout_provider_attempts
    WHERE id=v_session.provider_attempt_id FOR UPDATE;
  SELECT * INTO v_admission FROM public.event_checkout_admission_state WHERE event_id=v_event.id FOR UPDATE;
  -- #2136 — the NO-VALUE arm. Zero total AND no provider reference of any kind.
  -- Structurally disjoint from every paid caller (all four supply a reference).
  IF COALESCE(v_session.total_cents,0)=0
     AND COALESCE(p_stripe_payment_intent_id,'')=''
     AND COALESCE(p_stripe_charge_id,'')='' THEN
    -- Live current truth under the locks already held. No epoch CAS: a free
    -- reservation has no provider window for an epoch to protect, and
    -- admission_epoch is never stamped on a session that never claimed an
    -- attempt. Failure here is 'unavailable' — there is no payment to reverse.
    IF public.issue_1930_event_sale_reason(v_event)<>'sellable'
       OR v_session.revoked_at IS NOT NULL
       OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
      RETURN jsonb_build_object('outcome','unavailable');
    END IF;
    v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
      p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
      p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
      p_saved_payment_method_id,p_installment_plan_root);
    PERFORM public.issue_3872_copy_session_totals_to_order(p_checkout_session_id);
    RETURN jsonb_build_object('outcome','finalized','replayed',false)||COALESCE(v_result,'{}'::jsonb);
  END IF;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' OR v_session.revoked_at IS NOT NULL
     OR v_session.admission_epoch IS NULL OR v_admission.epoch<>v_session.admission_epoch
     OR NOT public.issue_1930_ticket_session_authorized(v_session.id,v_event.id) THEN
    v_observed_provider:=CASE
      WHEN v_attempt.id IS NOT NULL THEN v_attempt.provider
      WHEN COALESCE(p_stripe_payment_intent_id,'') ~ '^pi_[A-Za-z0-9]+$'
        AND COALESCE(p_stripe_charge_id,'') ~ '^ch_[A-Za-z0-9]+$' THEN 'stripe'
      WHEN COALESCE(p_stripe_payment_intent_id,'') !~ '^pi_[A-Za-z0-9]+$'
        AND COALESCE(p_stripe_payment_intent_id,'')<>''
        AND COALESCE(p_stripe_charge_id,'') ~ '^[0-9]+$' THEN 'paystack'
      ELSE NULL END;
    IF v_observed_provider IS NULL THEN
      UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',status='failed',
        failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=v_session.id;
      INSERT INTO public.checkout_sale_revocation_outbox(subject_type,subject_id,event_id,
        provider_attempt_id,target_epoch,reason,state,last_error_code)
      VALUES('ticket_checkout_session',v_session.id,v_session.event_id,v_attempt.id,
        COALESCE(v_attempt.claimed_epoch,v_session.admission_epoch,1),
        'paid_provider_reference_missing','provider_unknown','paid_provider_reference_missing')
      ON CONFLICT(subject_type,subject_id,target_epoch) DO UPDATE SET state='provider_unknown',
        last_error_code=EXCLUDED.last_error_code,updated_at=now();
      RETURN jsonb_build_object('outcome','paid_reversal_pending',
        'reversalReason','paid_provider_reference_missing');
    END IF;
    v_reversal:=public.issue_1930_mint_ticket_late_reversal(v_session.id,
      v_observed_provider,p_stripe_payment_intent_id,
      CASE WHEN v_observed_provider='paystack' THEN p_stripe_charge_id ELSE NULL END,
      CASE WHEN v_observed_provider='stripe' THEN p_stripe_charge_id ELSE NULL END);
    RETURN jsonb_build_object('outcome','paid_reversal_pending',
      'reversalReason',COALESCE(v_reversal->>'reason',v_reversal->>'outcome'));
  END IF;
  v_result:=public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id,
    p_stripe_payment_intent_id,p_stripe_charge_id,p_stripe_payment_method_type,
    p_qr_token_pepper,p_stripe_customer_id_on_connected_account,
    p_saved_payment_method_id,p_installment_plan_root);
  -- Issue #3872 (F2/F3): the order carries the session's explicit totals and
  -- breakdown, written at create from the variable sent to the provider.
  PERFORM public.issue_3872_copy_session_totals_to_order(p_checkout_session_id);
  RETURN jsonb_build_object('outcome','finalized','replayed',false)||COALESCE(v_result,'{}'::jsonb);
END $function$

;

-- =============================================================================
-- §3. What the provider charged
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3872_record_ticket_provider_total(
  p_checkout_session_id uuid,
  p_provider text,
  p_provider_total_cents bigint,
  p_provider_tax_cents bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_added_tax bigint;
  v_breakdown jsonb;
  v_component_tax bigint;
  v_app_fee bigint;
  v_order_rows integer := 0;
BEGIN
  IF p_provider NOT IN ('stripe', 'paystack') THEN
    RAISE EXCEPTION 'invalid_provider' USING ERRCODE = '22023';
  END IF;
  IF p_provider_total_cents IS NULL OR p_provider_total_cents < 0
     OR (p_provider_tax_cents IS NOT NULL AND p_provider_tax_cents < 0) THEN
    RAISE EXCEPTION 'invalid_provider_amount' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_session.net_subtotal_cents IS NULL OR v_session.buyer_fees_cents IS NULL THEN
    -- Created before #3872 or the create-time write failed: there is no
    -- computed split to reconcile against. The operator backfill owns these.
    RETURN jsonb_build_object('outcome', 'no_computed_totals');
  END IF;

  v_added_tax := p_provider_total_cents
    - v_session.net_subtotal_cents - v_session.buyer_fees_cents;
  IF v_added_tax < 0 THEN
    RETURN jsonb_build_object(
      'outcome', 'mismatch',
      'provider_total_cents', p_provider_total_cents,
      'computed_total_cents', v_session.buyer_total_cents
    );
  END IF;

  v_breakdown := v_session.pricing_breakdown;
  IF v_breakdown IS NOT NULL THEN
    v_component_tax := GREATEST(
      COALESCE(p_provider_tax_cents, (v_breakdown #>> '{components,tax_cents}')::bigint, 0),
      v_added_tax
    );
    v_app_fee := COALESCE((v_breakdown ->> 'application_fee_amount_cents')::bigint, 0);
    v_breakdown := v_breakdown
      || jsonb_build_object(
        'buyer_total_cents', p_provider_total_cents,
        'connected_account_payout_cents', p_provider_total_cents - v_app_fee - v_component_tax,
        'provider_reconciled', jsonb_build_object(
          'provider', p_provider,
          'total_cents', p_provider_total_cents,
          'tax_cents', p_provider_tax_cents
        )
      );
    v_breakdown := jsonb_set(v_breakdown, '{components,tax_cents}', to_jsonb(v_component_tax), true);
    v_breakdown := jsonb_set(v_breakdown, '{passed,tax_cents}', to_jsonb(v_added_tax), true);
    v_breakdown := jsonb_set(v_breakdown, '{absorbed,tax_cents}',
      to_jsonb(v_component_tax - v_added_tax), true);
  END IF;

  UPDATE public.ticket_checkout_sessions
  SET tax_cents = v_added_tax,
      buyer_total_cents = p_provider_total_cents,
      pricing_source = 'provider_reconciled',
      pricing_breakdown = v_breakdown,
      updated_at = now()
  WHERE id = v_session.id;

  IF v_session.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET list_subtotal_cents = v_session.list_subtotal_cents,
        discount_cents = v_session.discount_cents,
        net_subtotal_cents = v_session.net_subtotal_cents,
        buyer_fees_cents = v_session.buyer_fees_cents,
        tax_cents = v_added_tax,
        buyer_total_cents = p_provider_total_cents,
        pricing_source = 'provider_reconciled',
        pricing_breakdown = COALESCE(v_breakdown, pricing_breakdown),
        updated_at = now()
    WHERE id = v_session.order_id
      AND (pricing_source IS DISTINCT FROM 'provider_reconciled'
           OR buyer_total_cents IS DISTINCT FROM p_provider_total_cents);
    GET DIAGNOSTICS v_order_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'reconciled',
    'buyer_total_cents', p_provider_total_cents,
    'tax_cents', v_added_tax,
    'changed', p_provider_total_cents IS DISTINCT FROM v_session.buyer_total_cents,
    'order_updated', v_order_rows > 0
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_record_ticket_provider_total(uuid, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_record_ticket_provider_total(uuid, text, bigint, bigint)
  TO service_role;
COMMENT ON FUNCTION public.issue_3872_record_ticket_provider_total(uuid, text, bigint, bigint) IS
  'Issue #3872: records the amount the provider charged for a ticket session (and its order, when finalized). Any difference from the create-time total is tax the provider added on top (hosted Checkout automatic tax). Refuses a provider amount below the computed subtotal and fees. service_role only.';

-- =============================================================================
-- §4. Operator backfill: reconcile existing orders from the provider's records
-- =============================================================================
-- The provider records are the signed webhook payloads Mingla already stores in
-- payment_webhook_events (Stripe payment_intent.succeeded / charge.succeeded /
-- checkout.session.completed; Paystack charge.success). Idempotent: only orders
-- without buyer_total_cents are touched, one audit row per changed order.
-- Run by an operator: SELECT * FROM issue_3872_backfill_order_totals(false)
-- prints what WOULD change; (true) applies it.
CREATE TABLE IF NOT EXISTS public.issue_3872_order_totals_backfill_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  pricing_source text NOT NULL,
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.issue_3872_order_totals_backfill_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_3872_order_totals_backfill_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.issue_3872_order_totals_backfill_audit TO service_role;
COMMENT ON TABLE public.issue_3872_order_totals_backfill_audit IS
  'Issue #3872: one row per order whose explicit totals the operator backfill wrote, with the values before and after and the provider evidence used.';

CREATE OR REPLACE FUNCTION public.issue_3872_backfill_order_totals(
  p_apply boolean DEFAULT false,
  p_limit integer DEFAULT 500
) RETURNS TABLE (
  order_id uuid,
  path text,
  legacy_total_cents bigint,
  provider_total_cents bigint,
  net_subtotal_cents bigint,
  buyer_fees_cents bigint,
  tax_cents bigint,
  pricing_source text,
  breakdown_filled boolean,
  verdict text,
  evidence jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  o record;
  v_cfg record;
  v_path text;
  v_net bigint;
  v_total bigint;
  v_fees bigint;
  v_tax bigint;
  v_exp_fees bigint;
  v_source text;
  v_pi_amount bigint;
  v_charge_amount bigint;
  v_cs_total bigint;
  v_cs_tax bigint;
  v_ps_amount bigint;
  v_ps_fees bigint;
  v_lines bigint;
  v_region text;
  v_service bigint;
  v_breakdown jsonb;
  v_evidence jsonb;
  v_verdict text;
  v_split text;
BEGIN
  FOR o IN
    SELECT x.* FROM public.orders x
     WHERE x.buyer_total_cents IS NULL
     ORDER BY x.created_at, x.id
     LIMIT greatest(1, least(p_limit, 5000))
     FOR UPDATE OF x
  LOOP
    v_pi_amount := NULL; v_charge_amount := NULL; v_cs_total := NULL; v_cs_tax := NULL;
    v_ps_amount := NULL; v_ps_fees := NULL; v_split := 'not_needed';
    SELECT coalesce(sum(li.total_cents), 0) INTO v_lines
      FROM public.order_line_items li WHERE li.order_id = o.id;
    SELECT * INTO v_cfg FROM public.resolve_event_pricing_inputs(o.event_id) LIMIT 1;

    v_path := CASE
      WHEN coalesce(o.total_cents, 0) = 0 AND coalesce(o.stripe_payment_intent_id, '') = '' THEN 'free'
      WHEN o.stripe_payment_intent_id LIKE 'pi\_%' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.ticket_checkout_sessions s
           WHERE s.order_id = o.id AND s.stripe_checkout_session_id IS NOT NULL
        ) THEN 'stripe_hosted' ELSE 'stripe_native' END
      WHEN o.stripe_payment_intent_id IS NOT NULL THEN 'paystack'
      ELSE 'unknown'
    END;

    IF v_path IN ('stripe_hosted', 'stripe_native') THEN
      SELECT (w.payload #>> '{data,object,amount_received}')::bigint INTO v_pi_amount
        FROM public.payment_webhook_events w
       WHERE w.type = 'payment_intent.succeeded'
         AND w.payload #>> '{data,object,id}' = o.stripe_payment_intent_id
       ORDER BY w.created_at DESC LIMIT 1;
      SELECT (w.payload #>> '{data,object,amount}')::bigint INTO v_charge_amount
        FROM public.payment_webhook_events w
       WHERE w.type = 'charge.succeeded'
         AND w.payload #>> '{data,object,payment_intent}' = o.stripe_payment_intent_id
       ORDER BY w.created_at DESC LIMIT 1;
      SELECT (w.payload #>> '{data,object,amount_total}')::bigint,
             (w.payload #>> '{data,object,total_details,amount_tax}')::bigint
        INTO v_cs_total, v_cs_tax
        FROM public.payment_webhook_events w
       WHERE w.type = 'checkout.session.completed'
         AND w.payload #>> '{data,object,payment_intent}' = o.stripe_payment_intent_id
       ORDER BY w.created_at DESC LIMIT 1;
      v_total := coalesce(v_cs_total, v_pi_amount, v_charge_amount);
      -- Stripe sessions keep the ticket base (the deposit on a plan) in total_cents.
      v_net := coalesce((o.pricing_breakdown ->> 'base_cents')::bigint, o.total_cents);
    ELSIF v_path = 'paystack' THEN
      SELECT (w.payload #>> '{data,amount}')::bigint, (w.payload #>> '{data,fees}')::bigint
        INTO v_ps_amount, v_ps_fees
        FROM public.payment_webhook_events w
       WHERE w.type = 'charge.success'
         AND w.payload #>> '{data,reference}' = o.stripe_payment_intent_id
       ORDER BY w.created_at DESC LIMIT 1;
      v_total := v_ps_amount;
      v_net := coalesce((o.pricing_breakdown ->> 'base_cents')::bigint, v_lines);
    ELSE
      v_total := 0;
      v_net := 0;
    END IF;

    v_evidence := jsonb_strip_nulls(jsonb_build_object(
      'path', v_path,
      'line_items_cents', v_lines,
      'stripe_payment_intent_amount_received', v_pi_amount,
      'stripe_charge_amount', v_charge_amount,
      'stripe_checkout_amount_total', v_cs_total,
      'stripe_checkout_amount_tax', v_cs_tax,
      'paystack_amount', v_ps_amount,
      'paystack_fees', v_ps_fees
    ));

    IF v_path = 'free' THEN
      v_source := 'legacy_reconstructed';
      v_fees := 0; v_tax := 0; v_total := 0; v_net := 0;
    ELSIF v_total IS NULL THEN
      -- No stored provider record: rebuild from the order and the event's
      -- current fee switches, and say so.
      v_source := 'legacy_reconstructed';
      v_total := CASE WHEN v_path = 'paystack' THEN o.total_cents
        ELSE coalesce((o.pricing_breakdown ->> 'buyer_total_cents')::bigint,
          o.total_cents
          + CASE WHEN coalesce(v_cfg.pass_mingla_fee, false)
              THEN round(o.total_cents * coalesce(v_cfg.effective_take_rate_bps, 0) / 10000.0)::bigint ELSE 0 END
          + CASE WHEN coalesce(v_cfg.pass_service_fee, false)
              THEN round(o.total_cents * 300 / 10000.0)::bigint ELSE 0 END)
      END;
    ELSE
      v_source := 'provider_reconciled';
    END IF;

    IF v_path <> 'free' THEN
      IF o.pricing_breakdown IS NOT NULL THEN
        v_fees := (o.pricing_breakdown ->> 'buyer_subtotal_cents')::bigint - v_net;
        v_tax := v_total - v_net - v_fees;
        v_split := 'from_breakdown';
      ELSE
        v_exp_fees :=
          CASE WHEN coalesce(v_cfg.pass_mingla_fee, false)
            THEN round(v_net * coalesce(v_cfg.effective_take_rate_bps, 0) / 10000.0)::bigint ELSE 0 END
          + CASE WHEN coalesce(v_cfg.pass_service_fee, false)
            THEN round(v_net * 300 / 10000.0)::bigint ELSE 0 END;
        IF v_total = v_net THEN
          v_fees := 0; v_tax := 0; v_split := 'nothing_added';
        ELSIF v_total - v_net = v_exp_fees THEN
          v_fees := v_exp_fees; v_tax := 0; v_split := 'matches_fee_switches';
        ELSIF coalesce(v_cs_tax, 0) > 0 AND v_total - v_net - v_cs_tax >= 0 THEN
          v_tax := v_cs_tax; v_fees := v_total - v_net - v_cs_tax; v_split := 'provider_tax';
        ELSE
          v_fees := v_total - v_net; v_tax := 0; v_split := 'fees_unverified';
        END IF;
      END IF;
    END IF;
    v_evidence := v_evidence || jsonb_build_object('fee_tax_split', v_split);

    v_verdict := CASE
      WHEN v_path = 'unknown' THEN 'conflict'
      WHEN v_net IS NULL OR v_net < 0 OR v_fees < 0 OR v_tax < 0 THEN 'conflict'
      WHEN v_path IN ('stripe_hosted', 'stripe_native')
        AND (
          (v_pi_amount IS NOT NULL AND v_pi_amount <> v_total)
          OR (v_charge_amount IS NOT NULL AND v_charge_amount <> v_total)
        ) THEN 'conflict'
      ELSE 'apply'
    END;

    v_breakdown := o.pricing_breakdown;
    IF v_verdict = 'apply' AND v_breakdown IS NULL THEN
      v_region := CASE
        WHEN v_path = 'paystack' OR v_cfg.payment_provider = 'paystack' THEN 'NG'
        WHEN upper(coalesce(v_cfg.pricing_region, '')) IN ('GB', 'US', 'EU', 'CH') THEN upper(v_cfg.pricing_region)
        ELSE 'GB' END;
      v_service := round(v_net * 300 / 10000.0)::bigint;
      v_breakdown := jsonb_build_object(
        'region', v_region,
        'currency', lower(trim(o.currency::text)),
        'tax_behavior', CASE WHEN v_region IN ('US', 'NG') THEN 'exclusive' ELSE 'inclusive' END,
        'tax_basis', CASE v_path WHEN 'paystack' THEN 'config_vat'
          WHEN 'stripe_hosted' THEN 'provider_hosted_checkout' ELSE 'unresolved_flat_absorb' END,
        'switches', jsonb_build_object(
          'pass_tax', coalesce(v_cfg.pass_tax, false),
          'pass_mingla_fee', coalesce(v_cfg.pass_mingla_fee, false),
          'pass_service_fee', coalesce(v_cfg.pass_service_fee, false)),
        'base_cents', v_net,
        'buyer_subtotal_cents', v_net + v_fees,
        'buyer_total_cents', v_total,
        'components', jsonb_build_object(
          'mingla_fee_cents', coalesce(o.stripe_application_fee_amount_cents, 0),
          'service_fee_cents', v_service,
          'tax_cents', v_tax),
        'passed', jsonb_build_object(
          'mingla_fee_cents', CASE WHEN coalesce(v_cfg.pass_mingla_fee, false)
            THEN coalesce(o.stripe_application_fee_amount_cents, 0) ELSE 0 END,
          'service_fee_cents', CASE WHEN coalesce(v_cfg.pass_service_fee, false) THEN v_service ELSE 0 END,
          'tax_cents', v_tax),
        'absorbed', jsonb_build_object(
          'mingla_fee_cents', CASE WHEN coalesce(v_cfg.pass_mingla_fee, false)
            THEN 0 ELSE coalesce(o.stripe_application_fee_amount_cents, 0) END,
          'service_fee_cents', CASE WHEN coalesce(v_cfg.pass_service_fee, false) THEN 0 ELSE v_service END,
          'tax_cents', 0),
        'application_fee_amount_cents', coalesce(o.stripe_application_fee_amount_cents, 0),
        'connected_account_payout_cents', v_total - coalesce(o.stripe_application_fee_amount_cents, 0) - v_tax,
        'stripe_tax_calculation_id', NULL,
        'effective_take_rate_bps', coalesce(v_cfg.effective_take_rate_bps, 0),
        'take_rate_source', coalesce(v_cfg.take_rate_source, 'platform_default'),
        'reconstructed_by', 'issue_3872_backfill',
        'fee_tax_split', v_split
      );
    END IF;

    IF p_apply AND v_verdict = 'apply' THEN
      UPDATE public.orders x
      SET list_subtotal_cents = v_net,
          discount_cents = 0,
          net_subtotal_cents = v_net,
          buyer_fees_cents = v_fees,
          tax_cents = v_tax,
          buyer_total_cents = v_total,
          pricing_source = v_source,
          pricing_breakdown = coalesce(x.pricing_breakdown, v_breakdown),
          updated_at = now()
      WHERE x.id = o.id AND x.buyer_total_cents IS NULL;
      INSERT INTO public.issue_3872_order_totals_backfill_audit(
        order_id, pricing_source, before_values, after_values, evidence
      ) VALUES (
        o.id, v_source,
        jsonb_build_object('total_cents', o.total_cents,
          'pricing_breakdown_present', o.pricing_breakdown IS NOT NULL),
        jsonb_build_object('list_subtotal_cents', v_net, 'net_subtotal_cents', v_net,
          'buyer_fees_cents', v_fees, 'tax_cents', v_tax, 'buyer_total_cents', v_total,
          'pricing_breakdown_filled', o.pricing_breakdown IS NULL),
        v_evidence
      );
    END IF;

    order_id := o.id;
    path := v_path;
    legacy_total_cents := o.total_cents;
    provider_total_cents := v_total;
    net_subtotal_cents := v_net;
    buyer_fees_cents := v_fees;
    tax_cents := v_tax;
    pricing_source := v_source;
    breakdown_filled := (o.pricing_breakdown IS NULL AND v_verdict = 'apply');
    verdict := v_verdict;
    evidence := v_evidence;
    RETURN NEXT;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_backfill_order_totals(boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_backfill_order_totals(boolean, integer)
  TO service_role;
COMMENT ON FUNCTION public.issue_3872_backfill_order_totals(boolean, integer) IS
  'Issue #3872 operator backfill. Reconciles orders without buyer_total_cents from the stored provider webhook payloads (legacy_reconstructed when none exists), fills a missing pricing_breakdown, and writes one audit row per changed order. p_apply=false is a dry run. Idempotent. service_role only.';

-- =============================================================================
-- §5. Payout release equation (F1, F10, refunded fees, reservation fee)
-- =============================================================================
-- For every source: net released to the host = what landed in the host's
-- provider balance = charged − fee Mingla kept − provider fee − net refunds −
-- open disputes. Bodies below start from the live definitions:
--   attach_payout_release, run_payout_release_dark_sweep:
--     20270725003645_issue_3645_installment_cancel_and_ledger.sql
--   plan_pending_payout_partner_legs:
--     20270110000003_issue_1174_partner_payout_deferral.sql
-- Readers of net_cents / net_release_cents checked and unchanged:
-- refresh_pending_payout_release_truth, apply_open_payout_debts,
-- sync_post_release_postponement_debts, payout-release-sweep engine.ts and
-- partnerRelease.ts, paystackOrganiserRelease.ts, organiserPayoutNotify.ts and
-- the Ari payout tool (none subtracts the partner share again).

-- Nothing already attached may change: every existing item must already equal
-- the new equation (production on 19 Oct 2026: 3 Paystack items, no partner
-- share, all released).
DO $assert_items$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.payout_release_items i
  WHERE i.net_cents <> greatest(0, i.gross_cents - i.refunded_cents - i.disputed_cents
                                   - i.mingla_fee_cents - i.provider_fee_cents);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'issue-3872: % existing payout_release_items would change under the corrected release equation; stop and review before applying', v_bad;
  END IF;
  SELECT count(*) INTO v_bad
  FROM public.brand_payout_releases r
  WHERE r.status <> 'pending'
    AND (r.partner_share_cents <> 0 OR EXISTS (
      SELECT 1 FROM public.payout_transfer_legs l WHERE l.release_id = r.id AND l.kind = 'partner'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'issue-3872: % settled releases carry partner money; stop and review before applying', v_bad;
  END IF;
END
$assert_items$;

CREATE OR REPLACE FUNCTION public.attach_payout_release(p_source_type text, p_source_id uuid, p_brand_id uuid, p_event_id uuid, p_event_date_id uuid, p_occurrence_key text, p_provider text, p_currency text, p_finalized_at timestamp with time zone, p_anchor_end_at timestamp with time zone, p_gross_cents integer, p_refunded_cents integer, p_disputed_cents integer, p_mingla_fee_cents integer, p_partner_share_cents integer, p_provider_fee_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cutover timestamptz;
  v_status text;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_net integer;
  v_maturity_anchor timestamptz;
BEGIN
  -- #1790 T-P3(5) pins the one-liner NOT IN list below character-for-character.
  -- Accept order_installment via a separate <> so that pin stays intact.
  IF (p_source_type NOT IN ('order','rsvp_contribution','venue_reservation','venue_menu_order')
      AND p_source_type <> 'order_installment')
     OR p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_source_type||':'||p_source_id::text,1171)
  );
  SELECT release_id INTO v_existing_release_id
  FROM public.payout_release_items
  WHERE source_type=p_source_type AND source_id=p_source_id;
  IF FOUND THEN RETURN v_existing_release_id; END IF;

  SELECT payout_hold_cutover_at INTO v_cutover FROM public.brands
   WHERE id = p_brand_id FOR SHARE;
  IF v_cutover IS NULL OR p_finalized_at <= v_cutover THEN
    RAISE EXCEPTION 'source_not_after_cutover' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR SHARE;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled_event_never_releases' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Issue #3872 (F1): the partner share is 10% OF Mingla's fee and is paid from
  -- Mingla's platform balance, never from the brand's. It stays stored on the
  -- item for reporting and is not subtracted from the host's net.
  v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents
    - p_mingla_fee_cents - p_provider_fee_cents);

  -- #3645: maturity anchors on payment time.
  v_maturity_anchor := p_finalized_at;

  INSERT INTO public.brand_payout_releases (
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_release_cents
  ) VALUES (
    p_brand_id,p_event_id,p_event_date_id,p_occurrence_key,p_source_type,p_provider,
    lower(p_currency),v_maturity_anchor,v_maturity_anchor + interval '1 day',
    p_gross_cents,p_refunded_cents,p_disputed_cents,p_mingla_fee_cents,
    p_partner_share_cents,p_provider_fee_cents,v_net
  )
  ON CONFLICT (brand_id,event_key,occurrence_key,surface,provider,currency)
  DO UPDATE SET
    anchor_end_at = EXCLUDED.anchor_end_at,
    releasable_at = EXCLUDED.releasable_at,
    updated_at = now()
  WHERE brand_payout_releases.status = 'pending'
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    SELECT id INTO v_release_id FROM public.brand_payout_releases
     WHERE brand_id=p_brand_id
       AND event_key=coalesce(p_event_id,'00000000-0000-0000-0000-000000000000'::uuid)
       AND occurrence_key=p_occurrence_key
       AND surface=p_source_type AND provider=p_provider AND currency=lower(p_currency);
  END IF;

  INSERT INTO public.payout_release_items (
    release_id,source_type,source_id,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_cents,source_finalized_at
  ) VALUES (
    v_release_id,p_source_type,p_source_id,p_gross_cents,p_refunded_cents,
    p_disputed_cents,p_mingla_fee_cents,p_partner_share_cents,p_provider_fee_cents,v_net,
    p_finalized_at
  ) ON CONFLICT (source_type,source_id) DO NOTHING;

  IF p_source_type = 'order_installment' THEN
    UPDATE public.order_installments
    SET payout_accounting_state = 'attached',
        updated_at = now()
    WHERE id = p_source_id
      AND payout_accounting_state = 'ready';
  END IF;

  UPDATE public.brand_payout_releases r SET
    gross_cents=x.gross, refunded_cents=x.refunded, disputed_cents=x.disputed,
    mingla_fee_cents=x.mingla_fee, partner_share_cents=x.partner_share,
    provider_fee_cents=x.provider_fee, net_release_cents=x.net, updated_at=now()
  FROM (
    SELECT release_id,sum(gross_cents)::int gross,sum(refunded_cents)::int refunded,
      sum(disputed_cents)::int disputed,sum(mingla_fee_cents)::int mingla_fee,
      sum(partner_share_cents)::int partner_share,sum(provider_fee_cents)::int provider_fee,
      sum(net_cents)::int net
    FROM public.payout_release_items WHERE release_id=v_release_id GROUP BY release_id
  ) x WHERE r.id=x.release_id;
  RETURN v_release_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_payout_release_dark_sweep(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row record; v_release_id uuid; v_created integer:=0; v_matured integer;
  v_opened integer; v_refreshed jsonb;
BEGIN
  v_refreshed:=public.refresh_pending_payout_release_truth(p_now);
  v_opened:=public.sync_post_release_postponement_debts(p_now);
  v_matured:=public.mature_postponement_debts(p_now);
  FOR v_row IN
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,
        occ.event_date_id,b.payment_provider provider,lower(o.currency::text) currency,
        -- Issue #3872 (F10): gross is what the provider charged (buyer_total_cents);
        -- orders.total_cents is the ticket base on Stripe paths.
        o.created_at finalized_at,occ.end_at anchor_end_at,
        coalesce(o.buyer_total_cents,o.total_cents)::int gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        -- Issue #3872: only the fee Mingla kept. A refund with
        -- refund_application_fee returns part of the fee to the host's balance.
        greatest(0,coalesce(o.stripe_application_fee_amount_cents,0)-coalesce((
          SELECT sum(rf.application_fee_refunded_cents)::int FROM public.refunds rf
          WHERE rf.order_id=o.id AND rf.status='succeeded'
            AND rf.application_fee_refund_status='succeeded_positive'
        ),0)) mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)) provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,occ.event_date_id,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),occ.end_at,
        c.buyer_total_cents,
        greatest(c.refunded_amount_cents,coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.buyer_state='processed'
        ),0)),0,
        greatest(0,coalesce(c.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),r.created_at,s.reserved_for,s.amount_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.buyer_state='processed'
        ),0),0,
        -- Issue #3872: the deposit pays Mingla an application fee; deduct what
        -- Mingla kept (this arm used to deduct 0 and over-release by the fee).
        greatest(0,coalesce(s.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_menu_order',vo.id,vo.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(vo.currency),vo.confirmed_at,vo.created_at,vo.total_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.buyer_state='processed'
        ),0),
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.venue_order_id=vo.id AND d.status NOT IN ('won','warning_closed')),0),
        greatest(0,coalesce(vo.mingla_fee_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.fee_state='processed'
        ),0)),
        0,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE vo.money_path='mingla'
        AND vo.payment_status IN ('paid','partial_refund')
        AND vo.total_cents>0
        AND vo.confirmed_at IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND vo.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      -- #3645 / #2036 — collected installment arm. Fees live on the row
      -- (application_fee_amount_cents / provider_fee_cents). Gated by
      -- issue_2036_installment_payout_ready() (default false). Skip cancelled
      -- events. Maturity = collected_at + 1 day via attach (payment+24h).
      SELECT 'order_installment',oi.id,e.brand_id,o.event_id,occ.event_date_id,
        -- Installment PIs are Stripe-only; never derive from mutable brands.payment_provider.
        'stripe'::text,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        oi.amount_cents::integer,0,0,
        coalesce(oi.application_fee_amount_cents,0),0,
        coalesce(oi.provider_fee_cents,0),
        -- Unique per installment payment so a later installment never mutates
        -- an already-released release keyed by shared occurrence (#3645).
        'order_installment:' || oi.id::text
      FROM public.order_installments oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
      WHERE public.issue_2036_installment_payout_ready()
        AND oi.status = 'collected'
        AND oi.payout_accounting_state = 'ready'
        AND oi.collected_at IS NOT NULL
        AND oi.amount_cents > 0
        AND oi.application_fee_amount_cents IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND oi.collected_at > b.payout_hold_cutover_at
        AND e.status <> 'cancelled'
    )
    -- Global maturity predicate stays #1790-compatible (anchor_end_at + 3 days)
    -- so #1792 T-1792-P1 CONTROL (confirmed_at=now()) still attaches. Installment
    -- arm alone is type-aware: finalized_at + 1 day (= payment+24h) without
    -- changing the global filter for other source types.
    SELECT * FROM candidates c
    WHERE c.anchor_end_at IS NOT NULL
      AND (
        CASE
          WHEN c.source_type = 'order_installment'
            THEN c.finalized_at + interval '1 day'
          ELSE c.anchor_end_at + interval '3 days'
        END
      ) <= p_now
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
    ORDER BY c.anchor_end_at,c.source_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.source_type||':'||v_row.source_id::text,0)
    );
    IF v_row.source_type IN ('venue_reservation','rsvp_contribution','venue_menu_order') AND EXISTS (
      SELECT 1 FROM public.source_refunds sr
      WHERE sr.source_type=v_row.source_type AND sr.source_id=v_row.source_id
        AND sr.financial_state<>'reconciled'
    ) THEN CONTINUE; END IF;
    v_release_id:=public.attach_payout_release(
      v_row.source_type,v_row.source_id,v_row.brand_id,v_row.event_id,v_row.event_date_id,
      v_row.occurrence_key,v_row.provider,v_row.currency,v_row.finalized_at,v_row.anchor_end_at,
      v_row.gross_cents,v_row.refunded_cents,v_row.disputed_cents,v_row.mingla_fee_cents,
      v_row.partner_share_cents,v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id,p_now);
    v_created:=v_created+1;
  END LOOP;
  RETURN jsonb_build_object(
    'dark',true,'attached',v_created,'opened_postponement_debts',v_opened,
    'matured_debts',v_matured,'refreshed',v_refreshed,'executed',0
  );
END $function$;

CREATE OR REPLACE FUNCTION public.plan_pending_payout_partner_legs(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_release record;
  v_split record;
  v_planned integer := 0;
  v_fee integer;
  v_stamp integer;
  v_partner_cost integer;
  v_principal_corrections integer := 0;
  v_new_corrections integer;
  v_gross integer;
  v_refunded integer;
  v_disputed integer;
  v_mingla_fee integer;
  v_item_partner_share integer;
  v_provider_fee integer;
  v_missing_attributions integer;
  v_blocked_attributions integer := 0;
BEGIN
  FOR v_release IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'pending'
    ORDER BY r.releasable_at, r.id
    LIMIT greatest(1, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*)::integer
      INTO v_missing_attributions
    FROM public.payout_release_items i
    LEFT JOIN public.payout_partner_attributions a
      ON a.order_id = i.source_id
    WHERE i.release_id = v_release.id
      AND i.source_type = 'order'
      AND i.mingla_fee_cents > 0
      AND a.order_id IS NULL;
    IF v_missing_attributions > 0 THEN
      v_blocked_attributions :=
        v_blocked_attributions + v_missing_attributions;
      CONTINUE;
    END IF;

    v_new_corrections :=
      public.reconcile_payout_partner_principal(v_release.id);
    v_principal_corrections :=
      v_principal_corrections + v_new_corrections;

    FOR v_split IN
      SELECT DISTINCT ps.id, ps.provider, ps.partner_share_cents
      FROM public.payout_release_items i
      JOIN public.partner_splits ps
        ON ps.order_id = i.source_id
       AND i.source_type = 'order'
      WHERE i.release_id = v_release.id
        AND ps.status = 'held'
        AND ps.release_id IS NULL
      ORDER BY ps.id
    LOOP
      -- Paystack cannot move a partner leg below its verified ₦50 floor.
      -- The split remains held and incurs no fee until a later contract
      -- explicitly aggregates sub-floor partner principal.
      IF v_split.provider = 'paystack'
         AND v_split.partner_share_cents < 5000 THEN
        CONTINUE;
      END IF;

      IF v_split.provider = 'paystack' THEN
        v_fee := CASE
          WHEN v_split.partner_share_cents <= 500000 THEN 1000
          WHEN v_split.partner_share_cents <= 5000000 THEN 2500
          ELSE 5000
        END;
        v_stamp := CASE
          WHEN v_split.partner_share_cents >= 1000000 THEN 5000
          ELSE 0
        END;
      ELSE
        v_fee := 0;
        v_stamp := 0;
      END IF;

      INSERT INTO public.payout_transfer_legs (
        release_id,
        partner_split_id,
        kind,
        chunk_index,
        principal_cents,
        estimated_fee_cents,
        stamp_duty_cents,
        fee_schedule_version
      )
      VALUES (
        v_release.id,
        v_split.id,
        'partner',
        0,
        v_split.partner_share_cents,
        v_fee,
        v_stamp,
        CASE
          WHEN v_split.provider = 'paystack' THEN 'verified-2026-07-24'
          ELSE 'stripe-platform-transfer-v1'
        END
      )
      ON CONFLICT (release_id, kind, partner_split_id, chunk_index)
      DO NOTHING;
      IF FOUND THEN v_planned := v_planned + 1; END IF;
    END LOOP;

    SELECT coalesce(sum(estimated_fee_cents + stamp_duty_cents), 0)::integer
      INTO v_partner_cost
    FROM public.payout_transfer_legs
    WHERE release_id = v_release.id
      AND kind = 'partner';

    SELECT
      coalesce(sum(gross_cents), 0)::integer,
      coalesce(sum(refunded_cents), 0)::integer,
      coalesce(sum(disputed_cents), 0)::integer,
      coalesce(sum(mingla_fee_cents), 0)::integer,
      coalesce(sum(partner_share_cents), 0)::integer,
      coalesce(sum(provider_fee_cents), 0)::integer
    INTO
      v_gross,
      v_refunded,
      v_disputed,
      v_mingla_fee,
      v_item_partner_share,
      v_provider_fee
    FROM public.payout_release_items
    WHERE release_id = v_release.id;

    SELECT coalesce(sum(amount_cents), 0)::integer
      INTO v_new_corrections
    FROM public.payout_ledger_adjustments
    WHERE release_id = v_release.id
      AND kind = 'partner_principal_correction';

    -- Rebuild from immutable items plus append-only corrections so retries
    -- cannot double-deduct either principal or transfer costs.
    UPDATE public.brand_payout_releases
    SET gross_cents = v_gross,
        refunded_cents = v_refunded,
        disputed_cents = v_disputed,
        mingla_fee_cents = v_mingla_fee,
        partner_share_cents = v_item_partner_share + v_new_corrections,
        provider_fee_cents = v_provider_fee,
        -- Issue #3872 (F1): partner principal, its corrections and the cost of
        -- the partner transfer are Mingla's money (platform balance), so none of
        -- them reduce the host's net. partner_share_cents stays for reporting.
        net_release_cents = greatest(
          0,
          v_gross - v_refunded - v_disputed - v_mingla_fee - v_provider_fee
          - permanent_debt_withheld_cents - temporary_debt_withheld_cents
          + maturity_recredit_cents
        ),
        updated_at = now()
    WHERE id = v_release.id;
  END LOOP;

  RETURN jsonb_build_object(
    'planned_partner_legs', v_planned,
    'partner_principal_corrections', v_principal_corrections,
    'blocked_partner_attributions', v_blocked_attributions
  );
END;
$function$;

-- =============================================================================
-- §6. Server-computed refunds (F4)
-- =============================================================================
-- Policy, read from mingla-business RefundSheet.tsx and eventOrdersService.ts:
-- each refunded line is quantity x the line's unit price at purchase
-- (order_line_items.unit_price_cents); no fee or tax share is added. The server
-- now computes exactly that and ignores the amount a client sends, so a Host on
-- a current app sees no change. Bodies of biz_refund_order and
-- admin_refund_order start from their live definitions
-- (20270110000006_issue_1175_paystack_refunds.sql, identical in production).

-- Canonical server lines: one entry per order line (duplicates summed), sorted
-- by line id, amount = quantity x unit price. A line that is not on the order is
-- kept with a NULL amount so the caller raises line_item_not_found.
CREATE OR REPLACE FUNCTION public.issue_3872_refund_server_lines(
  p_order_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH req AS (
    SELECT line->>'order_line_item_id' AS line_id,
           sum((line->>'quantity')::int)::int AS qty
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END
    ) AS line
    GROUP BY line->>'order_line_item_id'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'order_line_item_id', r.line_id,
      'quantity', r.qty,
      'amount_cents', (r.qty::bigint * oli.unit_price_cents)::int
    ) ORDER BY r.line_id), '[]'::jsonb)
  FROM req r
  LEFT JOIN public.order_line_items oli
    ON oli.id::text = r.line_id AND oli.order_id = p_order_id
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_refund_server_lines(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_refund_server_lines(uuid, jsonb)
  TO service_role;
COMMENT ON FUNCTION public.issue_3872_refund_server_lines(uuid, jsonb) IS
  'Issue #3872: the server''s refund lines for an order: quantity x order_line_items.unit_price_cents per line, duplicates summed. Internal helper for biz_refund_order, admin_refund_order and refund_preview.';

CREATE OR REPLACE FUNCTION public.biz_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
BEGIN
  -- Authorization precedes the idempotency lookup so replay cannot disclose
  -- refund or payment identifiers to a caller outside the order's brand.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );

  -- Serialize same-key requests before the lookup/insert pair. The existing
  -- unique expression index remains the final database backstop.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Issue #3872: never more than the buyer paid and has not had back.
  IF v_refund_amount_cents >
     COALESCE(v_order.buyer_total_cents, v_order.total_cents)
       - COALESCE(v_order.refunded_amount_cents, 0) THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents,
      COALESCE(v_order.buyer_total_cents, v_order.total_cents)
        - COALESCE(v_order.refunded_amount_cents, 0)
      USING ERRCODE = 'P0009';
  END IF;

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
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
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
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

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
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_existing_refund public.refunds%ROWTYPE;
  v_remaining_cents int;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
BEGIN
  -- I-PROPOSED-1278-ADMIN-GATE-FIRST: this remains the first executable
  -- statement, byte-for-byte equivalent to the approved service-role twin.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  v_remaining_cents :=
    v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);
  IF v_refund_amount_cents > v_remaining_cents THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents, v_remaining_cents USING ERRCODE = 'P0009';
  END IF;

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
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
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
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

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
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$;

-- refund_preview: what a refund of these lines would return, computed by the
-- same server rule, for the Host app's RefundSheet to show before confirm.
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
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_amount := v_amount + (v_line->>'amount_cents')::bigint;
  END LOOP;

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
  'Issue #3872: the amount refunding these lines would return (quantity x unit price at purchase), computed by the same rule biz_refund_order applies. Read-only. Callers need payment rights on the order''s brand.';

-- =============================================================================
-- §7. Proportional partner reversal on refunds (F5)
-- =============================================================================
-- The partner share is 10% OF Mingla's application fee. When a refund returns
-- part of that fee, the partner gives back the same proportion:
--   target reversed = floor(original share x fee refunded / fee).
-- A split not yet transferred is reduced in place (no provider call). A
-- transferred split is reversed by the difference between the target and what
-- is already reversed; the edge function makes that one Stripe call with an
-- idempotency key per cumulative target, so a replayed or reordered refund
-- event can never reverse twice. Disputes keep their existing full treatment
-- (mark_partner_split_reversed). On Paystack, a ticket refund returns none of
-- Mingla's fee (refunds.application_fee_refunded_cents = 0), so the rule
-- leaves the partner share unchanged.
ALTER TABLE public.partner_splits
  ADD COLUMN IF NOT EXISTS reversed_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_partner_share_cents integer;
ALTER TABLE public.partner_splits DROP CONSTRAINT IF EXISTS partner_splits_issue_3872_reversal_bounds;
ALTER TABLE public.partner_splits ADD CONSTRAINT partner_splits_issue_3872_reversal_bounds CHECK (
  reversed_cents >= 0
  AND (original_partner_share_cents IS NULL OR original_partner_share_cents >= 0)
  AND reversed_cents <= COALESCE(original_partner_share_cents, partner_share_cents + reversed_cents)
);
COMMENT ON COLUMN public.partner_splits.reversed_cents IS
  'Issue #3872: partner share given back because Mingla''s fee was refunded (reduced in place before transfer, or reversed from the transfer after).';
COMMENT ON COLUMN public.partner_splits.original_partner_share_cents IS
  'Issue #3872: the partner share at sale, recorded the first time a refund reduces partner_share_cents in place.';

CREATE OR REPLACE FUNCTION public.issue_3872_partner_split_refund_plan(
  p_application_fee_id text,
  p_fee_amount_cents integer,
  p_fee_refunded_cents integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_split public.partner_splits%ROWTYPE;
  v_original integer;
  v_target integer;
BEGIN
  IF p_fee_amount_cents IS NULL OR p_fee_amount_cents <= 0
     OR p_fee_refunded_cents IS NULL OR p_fee_refunded_cents < 0 THEN
    RAISE EXCEPTION 'invalid_fee_amounts' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_split FROM public.partner_splits
   WHERE stripe_application_fee_id = p_application_fee_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_split');
  END IF;

  v_original := CASE
    WHEN v_split.status = 'transferred' THEN COALESCE(v_split.original_partner_share_cents, v_split.partner_share_cents)
    ELSE COALESCE(v_split.original_partner_share_cents, v_split.partner_share_cents + v_split.reversed_cents)
  END;
  v_target := LEAST(v_original,
    floor(v_original::numeric * LEAST(p_fee_refunded_cents, p_fee_amount_cents) / p_fee_amount_cents)::integer);

  IF v_split.status IN ('reversed', 'reversed_pending', 'cancelled_refund') THEN
    RETURN jsonb_build_object('outcome', 'already_closed', 'status', v_split.status);
  END IF;
  IF v_target <= v_split.reversed_cents THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_reverse',
      'target_reversed_cents', v_target, 'reversed_cents', v_split.reversed_cents);
  END IF;

  IF v_split.status = 'transferred' THEN
    IF v_split.stripe_transfer_id IS NULL THEN
      RETURN jsonb_build_object('outcome', 'transfer_missing');
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'reverse',
      'transfer_id', v_split.stripe_transfer_id,
      'target_reversed_cents', v_target,
      'reverse_cents', v_target - v_split.reversed_cents,
      'original_partner_share_cents', v_original
    );
  END IF;

  -- Not transferred yet: reduce in place, no provider call.
  UPDATE public.partner_splits
  SET original_partner_share_cents = v_original,
      partner_share_cents = v_original - v_target,
      reversed_cents = v_target,
      status = CASE
        WHEN v_original - v_target > 0 THEN status
        WHEN status = 'held' THEN 'cancelled_refund'
        ELSE 'reversed_pending'
      END,
      reversed_at = CASE WHEN v_original - v_target > 0 THEN reversed_at ELSE COALESCE(reversed_at, now()) END
  WHERE id = v_split.id;
  RETURN jsonb_build_object(
    'outcome', 'reduced_in_place',
    'partner_share_cents', v_original - v_target,
    'target_reversed_cents', v_target
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_partner_split_record_reversal(
  p_application_fee_id text,
  p_target_reversed_cents integer,
  p_reversal_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_split public.partner_splits%ROWTYPE;
  v_original integer;
BEGIN
  SELECT * INTO v_split FROM public.partner_splits
   WHERE stripe_application_fee_id = p_application_fee_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_split');
  END IF;
  v_original := COALESCE(v_split.original_partner_share_cents, v_split.partner_share_cents);
  IF p_target_reversed_cents IS NULL OR p_target_reversed_cents < 0
     OR p_target_reversed_cents > v_original THEN
    RAISE EXCEPTION 'invalid_reversal_target' USING ERRCODE = '22023';
  END IF;
  UPDATE public.partner_splits
  SET original_partner_share_cents = v_original,
      reversed_cents = GREATEST(reversed_cents, p_target_reversed_cents),
      status = CASE WHEN GREATEST(reversed_cents, p_target_reversed_cents) >= v_original
        THEN 'reversed' ELSE status END,
      reversed_at = CASE WHEN GREATEST(reversed_cents, p_target_reversed_cents) >= v_original
        THEN COALESCE(reversed_at, now()) ELSE reversed_at END,
      error_message = CASE WHEN p_reversal_id IS NOT NULL
        THEN left('last_reversal:' || p_reversal_id, 500) ELSE error_message END
  WHERE id = v_split.id;
  RETURN jsonb_build_object('outcome', 'recorded',
    'reversed_cents', GREATEST(v_split.reversed_cents, p_target_reversed_cents));
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_partner_split_refund_plan(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_partner_split_refund_plan(text, integer, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_3872_partner_split_record_reversal(text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_partner_split_record_reversal(text, integer, text)
  TO service_role;
COMMENT ON FUNCTION public.issue_3872_partner_split_refund_plan(text, integer, integer) IS
  'Issue #3872 (F5): proportional partner give-back when Mingla''s application fee is refunded. Reduces an untransferred split in place; for a transferred split returns the amount still to reverse. service_role only.';
COMMENT ON FUNCTION public.issue_3872_partner_split_record_reversal(text, integer, text) IS
  'Issue #3872 (F5): records a Stripe transfer reversal up to a cumulative target; idempotent. service_role only.';





-- =============================================================================
-- §8. Event cancellation refunds return what the buyer was charged
-- =============================================================================
-- Decision (Seth, 19 Oct 2026, on #3872): when an event is cancelled, every
-- buyer gets back what they were actually charged, including the fees they
-- paid, on every rail. Before this, the cancellation refund was the sum of the
-- ticket lines: on Stripe the buyer lost the fees they had paid, and on
-- Paystack the provider refunded the whole transaction while the ledger
-- recorded only the ticket lines.
--
-- Fees on that refund: on Stripe the refund passes refund_application_fee, so
-- Stripe returns Mingla's fee to the host's balance in proportion (all of it on
-- a full refund) and the release equation (§5) stops deducting it. On Paystack
-- Mingla holds the money, refunds it from its own balance and keeps none of
-- the charge; any post-release recovery from the organiser stays capped by
-- organiser_refund_debt_room_cents (what was actually delivered to them).

-- A refund may now reach the charged total, which exceeds total_cents on
-- Stripe paths that pass fees (total_cents is the ticket base there).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_refunded_amount_not_exceed_total;
ALTER TABLE public.orders ADD CONSTRAINT orders_refunded_amount_not_exceed_total
  CHECK (refunded_amount_cents <= COALESCE(buyer_total_cents, total_cents));

-- Live body: 20270725003645_issue_3645_installment_cancel_and_ledger.sql
-- (identical in production). Only change: the per-order refund amount.
CREATE OR REPLACE FUNCTION public.cancel_event_refund_prepare(p_event_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_brand_id uuid;
  v_provider text;
  v_release record;
  v_temp public.organiser_payout_debts;
  v_total integer;
  v_rsvp_count integer;
  v_run_status text;
  v_pending_ids uuid[];
  v_installments_cancelled integer := 0;
BEGIN
  -- 1. Status-first guard (binding race guard + the SOLE authorization).
  SELECT status, brand_id INTO v_status, v_brand_id
  FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'event_not_cancelled' USING ERRCODE = 'P0002';
  END IF;

  SELECT CASE WHEN b.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id = v_brand_id;
  v_provider := COALESCE(v_provider, 'stripe');

  -- 1b. #3645 PR2 — freeze sales (idempotent).
  UPDATE public.ticket_types
  SET sale_end_at = p_now,
      is_disabled = true,
      updated_at = p_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND available_online IS TRUE
    AND (
      sale_end_at IS NULL
      OR sale_end_at > p_now
      OR is_disabled IS NOT TRUE
    );

  UPDATE public.events
  SET bookings_closed = true,
      bookings_closed_at = COALESCE(bookings_closed_at, p_now)
  WHERE id = p_event_id
    AND bookings_closed IS NOT TRUE;

  -- 1c. #3645 PR5 / #2030 — cancel scheduled/failed installments on this event's
  --     orders (mirror biz_cancel_trip_booking_begin). Collected rows stay.
  UPDATE public.order_installments oi
  SET status = 'cancelled',
      cancelled_at = p_now
  FROM public.orders o
  WHERE o.id = oi.order_id
    AND o.event_id = p_event_id
    AND oi.status IN ('scheduled', 'failed')
    AND oi.cancelled_at IS NULL;
  GET DIAGNOSTICS v_installments_cancelled = ROW_COUNT;

  -- 2. Stop releases (event-scoped; NEVER releases).
  WITH locked AS (
    SELECT id FROM public.brand_payout_releases
    WHERE event_id = p_event_id
      AND status IN (
        'pending','blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
        'fee_unreconciled','blocked_anchor','reanchored'
      )
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.brand_payout_releases r
  SET status = 'cancelled_event', updated_at = p_now
  FROM locked WHERE r.id = locked.id;

  -- 3. Atomic debt conversion BEFORE any refund (Stripe only).
  FOR v_release IN
    SELECT r.id AS release_id
    FROM public.brand_payout_releases r
    WHERE r.event_id = p_event_id
      AND r.status = 'released'
      AND r.provider = 'stripe'
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id = v_release.release_id
      AND kind = 'post_release_postponement'
      AND status = 'open'
    FOR UPDATE;
    IF FOUND AND v_temp.principal_cents > 0 THEN
      PERFORM public.convert_postponement_debt_to_permanent(
        v_release.release_id, 'post_release_cancellation', v_temp.principal_cents, p_now
      );
    END IF;
  END LOOP;

  -- 4. Open / refresh the backstop run.
  INSERT INTO public.event_cancel_refund_runs (event_id, status, last_attempt_at, opened_at)
  VALUES (p_event_id, 'awaiting_review', p_now, p_now)
  ON CONFLICT (event_id) DO UPDATE SET
    last_attempt_at = p_now;

  -- 5. Enumerate + persist per-object progress rows (orders only).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  -- Issue #3872: a cancelled event returns what each buyer was charged
  -- (buyer_total_cents, which includes passed fees and added tax), on every
  -- rail. orders.total_cents is the ticket base on Stripe paths.
  SELECT p_event_id, 'order', o.id, v_provider,
         (COALESCE(o.buyer_total_cents, o.total_cents)::integer
           - COALESCE(o.refunded_amount_cents, 0)), 'pending'
  FROM public.orders o
  WHERE o.event_id = p_event_id
    AND o.payment_status IN ('paid','partial_refund')
    AND (COALESCE(o.buyer_total_cents, o.total_cents)::integer
           - COALESCE(o.refunded_amount_cents, 0)) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;

  -- 5b. RSVP chip-in contributions.
  SELECT count(*)::integer INTO v_rsvp_count
  FROM public.event_rsvp_contributions c
  WHERE c.event_id = p_event_id
    AND c.status IN ('paid','partially_refunded')
    AND c.buyer_total_cents > c.refunded_amount_cents;

  -- 6. Resolve the run status from the refund work.
  UPDATE public.event_cancel_refund_runs
  SET total_objects = v_total,
      status = CASE
        WHEN status = 'completed' THEN status
        WHEN v_total = 0 AND v_rsvp_count = 0 THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN status <> 'completed' AND v_total = 0 AND v_rsvp_count = 0
             AND completed_at IS NULL THEN p_now
        ELSE completed_at
      END
  WHERE event_id = p_event_id
  RETURNING status INTO v_run_status;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_pending_ids
  FROM public.event_cancel_refund_progress
  WHERE event_id = p_event_id AND status IN ('pending','failed_retryable');

  RETURN jsonb_build_object(
    'run_status', v_run_status,
    'total_objects', v_total,
    'pending_object_ids', to_jsonb(v_pending_ids),
    'rsvp_pending_count', v_rsvp_count,
    'installments_cancelled', v_installments_cancelled
  );
END;
$function$;

-- The cancellation refund row: the remaining ticket lines (priced by the server
-- rule) and an amount equal to what the buyer was charged and has not had back.
-- The line amounts are the refund amount allocated across the lines in
-- proportion to their ticket value, so the lines still add up to the refund.
-- Same response shape and idempotency as admin_refund_order, so
-- event-cancel-refund-fanout continues with admin_refund_order_commit.
CREATE OR REPLACE FUNCTION public.issue_3872_cancel_refund_order(
  p_order_id uuid,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing_refunded integer;
  v_existing public.refunds%ROWTYPE;
  v_manifest jsonb;
  v_line_base bigint := 0;
  v_other bigint;
  v_charged bigint;
  v_amount bigint;
  v_allocated bigint := 0;
  v_alloc bigint;
  v_idx integer := 0;
  v_count integer;
  v_full boolean;
  v_status text;
  v_refund_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);

  SELECT * INTO v_existing FROM public.refunds
   WHERE metadata->>'idempotency_key' = p_idempotency_key AND order_id = p_order_id
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_manifest := v_existing.metadata->'refund_request_manifest';
    IF v_manifest IS NULL
       OR v_manifest->>'reason' IS DISTINCT FROM trim(p_reason)
       OR (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'order_line_item_id', l->>'order_line_item_id', 'quantity', (l->>'quantity')::int)
             ORDER BY l->>'order_line_item_id'), '[]'::jsonb)
           FROM jsonb_array_elements(v_manifest->'lines') l)
          IS DISTINCT FROM
          (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'order_line_item_id', l->>'order_line_item_id', 'quantity', (l->>'quantity')::int)
             ORDER BY l->>'order_line_item_id'), '[]'::jsonb)
           FROM jsonb_array_elements(v_lines) l) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'refund_id', v_existing.id, 'order_id', p_order_id,
      'amount_cents', v_existing.amount_cents, 'currency', v_existing.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status', v_manifest->>'proposed_new_payment_status',
      'is_full_refund', (v_manifest->>'is_full_refund')::boolean,
      'lines', v_manifest->'lines', 'reason', v_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing_refunded + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing_refunded, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_line_base := v_line_base + (v_line->>'amount_cents')::bigint;
  END LOOP;
  v_count := jsonb_array_length(v_lines);
  IF v_count = 0 OR v_line_base <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Would every line be fully refunded after this?
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0) FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded')
      ) + COALESCE((SELECT (l->>'quantity')::int FROM jsonb_array_elements(v_lines) l
                    WHERE l->>'order_line_item_id' = oli.id::text), 0)
  ) INTO v_full;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_other
  FROM public.refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');
  v_charged := COALESCE(v_order.buyer_total_cents, v_order.total_cents);
  -- Everything that remains when the last tickets go back; otherwise the lines
  -- (a cancellation always returns every remaining ticket, so this is the norm).
  v_amount := CASE WHEN v_full THEN v_charged - v_other ELSE LEAST(v_line_base, v_charged - v_other) END;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;
  v_status := CASE WHEN v_full THEN 'refunded' ELSE 'partial_refund' END;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id, v_amount::integer, v_order.currency, trim(p_reason), NULL, 'pending',
    v_order.stripe_payment_intent_id, v_order.stripe_charge_id,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_refund_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) ORDER BY value->>'order_line_item_id' LOOP
    v_idx := v_idx + 1;
    v_alloc := CASE WHEN v_idx = v_count THEN v_amount - v_allocated
      ELSE floor(v_amount::numeric * (v_line->>'amount_cents')::bigint / v_line_base)::bigint END;
    v_allocated := v_allocated + v_alloc;
    INSERT INTO public.refund_line_items (refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents)
    SELECT v_refund_id, oli.id, oli.ticket_type_id, (v_line->>'quantity')::int, v_alloc::integer
    FROM public.order_line_items oli WHERE oli.id::text = v_line->>'order_line_item_id';
  END LOOP;

  v_manifest := jsonb_build_object(
    'lines', (SELECT jsonb_agg(jsonb_build_object(
        'order_line_item_id', rli.order_line_item_id::text, 'quantity', rli.quantity,
        'amount_cents', rli.amount_cents) ORDER BY rli.order_line_item_id::text)
      FROM public.refund_line_items rli WHERE rli.refund_id = v_refund_id),
    'reason', trim(p_reason),
    'amount_cents', v_amount,
    'proposed_new_payment_status', v_status,
    'is_full_refund', v_full,
    'issue_3872_cancellation', jsonb_build_object(
      'ticket_lines_cents', v_line_base,
      'fees_and_tax_cents', GREATEST(0, v_amount - v_line_base),
      'charged_total_cents', v_charged)
  );
  UPDATE public.refunds
  SET metadata = metadata || jsonb_build_object('refund_request_manifest', v_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id, 'order_id', p_order_id,
    'amount_cents', v_amount, 'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_status,
    'is_full_refund', v_full,
    'lines', v_manifest->'lines', 'reason', trim(p_reason),
    'idempotent_replay', false
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_cancel_refund_order(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_cancel_refund_order(uuid, jsonb, text, text)
  TO service_role;
COMMENT ON FUNCTION public.issue_3872_cancel_refund_order(uuid, jsonb, text, text) IS
  'Issue #3872: the pending refund row for an order on a cancelled event. Returns every remaining ticket and the whole charged remainder (buyer_total_cents minus earlier refunds), fees included, on every rail. Same response and idempotency shape as admin_refund_order; committed with admin_refund_order_commit. service_role only.';

-- =============================================================================
-- §9. Stripe provider-fee snapshots exclude Mingla's application fee
-- =============================================================================
-- Found by the Stripe sandbox end-to-end run on #3872: on a direct charge the
-- connected account's balance transaction `fee` is Stripe's processing fee
-- PLUS Mingla's application fee (fee_details lists both). The fee capture
-- stored the whole `fee` as provider_fee_cents, so the release deducted
-- Mingla's fee twice (once as mingla_fee_cents, once inside provider_fee_cents)
-- and under-released every Stripe source by its application fee. The capture
-- code now stores only the provider's own fee and records the part it took out
-- in application_fee_excluded_cents. Snapshots captured before this change
-- (application_fee_excluded_cents IS NULL) get one append-only correction row.
ALTER TABLE public.payout_source_fee_snapshots
  ADD COLUMN IF NOT EXISTS application_fee_excluded_cents integer
    CHECK (application_fee_excluded_cents IS NULL OR application_fee_excluded_cents >= 0);
COMMENT ON COLUMN public.payout_source_fee_snapshots.application_fee_excluded_cents IS
  'Issue #3872: Stripe only. Mingla''s application fee taken out of the balance transaction fee so provider_fee_cents is the provider''s own fee. NULL on Paystack rows and on Stripe rows captured before #3872 (those are corrected through issue_3872_fee_snapshot_corrections).';

-- Snapshots are append-only (payout_source_fee_snapshots_append_only), so a
-- pre-#3872 Stripe snapshot is corrected by an append-only correction row that
-- the release sweep subtracts, never by changing the snapshot.
CREATE TABLE IF NOT EXISTS public.issue_3872_fee_snapshot_corrections (
  snapshot_id uuid PRIMARY KEY REFERENCES public.payout_source_fee_snapshots(id) ON DELETE RESTRICT,
  application_fee_cents integer NOT NULL CHECK (application_fee_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.issue_3872_fee_snapshot_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_3872_fee_snapshot_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.issue_3872_fee_snapshot_corrections TO service_role;
DROP TRIGGER IF EXISTS issue_3872_fee_snapshot_corrections_append_only ON public.issue_3872_fee_snapshot_corrections;
CREATE TRIGGER issue_3872_fee_snapshot_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.issue_3872_fee_snapshot_corrections
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();
COMMENT ON TABLE public.issue_3872_fee_snapshot_corrections IS
  'Issue #3872: Mingla''s application fee contained in a pre-#3872 Stripe provider-fee snapshot. The release sweep subtracts it from provider_fee_cents. Append-only, one row per snapshot.';

CREATE OR REPLACE FUNCTION public.issue_3872_correct_stripe_fee_snapshots()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  INSERT INTO public.issue_3872_fee_snapshot_corrections (snapshot_id, application_fee_cents)
  SELECT fs.id, LEAST(COALESCE(
      CASE fs.source_type
        WHEN 'order' THEN (SELECT o.stripe_application_fee_amount_cents FROM public.orders o WHERE o.id = fs.source_id)
        WHEN 'rsvp_contribution' THEN (SELECT c.application_fee_amount_cents FROM public.event_rsvp_contributions c WHERE c.id = fs.source_id)
        WHEN 'venue_reservation' THEN (SELECT s.application_fee_amount_cents FROM public.reservation_checkout_sessions s WHERE s.id = fs.source_id)
        WHEN 'venue_menu_order' THEN (SELECT vo.mingla_fee_cents FROM public.venue_orders vo WHERE vo.id = fs.source_id)
      END, 0), fs.provider_fee_cents)
  FROM public.payout_source_fee_snapshots fs
  WHERE fs.provider_balance_transaction_id LIKE 'txn\_%'
    AND fs.application_fee_excluded_cents IS NULL
  ON CONFLICT (snapshot_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('corrected', v_rows);
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_correct_stripe_fee_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_correct_stripe_fee_snapshots() TO service_role;
COMMENT ON FUNCTION public.issue_3872_correct_stripe_fee_snapshots() IS
  'Issue #3872: records, once per snapshot, the application fee inside Stripe provider-fee snapshots captured before #3872 (rows with application_fee_excluded_cents IS NULL). Idempotent. Run again right after the merge to cover snapshots the old capture code wrote in between. service_role only.';

-- Release items already attached keep their values (they never re-read the
-- snapshot); production had no Stripe item attached on 19 Oct 2026.
DO $assert_no_stripe_items$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payout_release_items i
    JOIN public.payout_source_fee_snapshots fs
      ON fs.source_type = i.source_type AND fs.source_id = i.source_id
    WHERE fs.provider_balance_transaction_id LIKE 'txn\_%'
      AND fs.application_fee_excluded_cents IS NULL
  ) THEN
    RAISE EXCEPTION 'issue-3872: a Stripe source with a pre-#3872 fee snapshot is already attached to a release; review before applying';
  END IF;
END
$assert_no_stripe_items$;

SELECT public.issue_3872_correct_stripe_fee_snapshots();

COMMIT;

NOTIFY pgrst, 'reload schema';
