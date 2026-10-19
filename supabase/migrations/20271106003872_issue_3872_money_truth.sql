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
--
-- APPLY ORDER: this migration is applied to production BEFORE the pull request
-- merges. The edge functions that merge with it call §3 and write §1's columns;
-- both calls are non-fatal, so an unapplied migration degrades to "totals not
-- recorded", never to a failed checkout.

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

-- @@M3@@


COMMIT;

NOTIFY pgrst, 'reload schema';
