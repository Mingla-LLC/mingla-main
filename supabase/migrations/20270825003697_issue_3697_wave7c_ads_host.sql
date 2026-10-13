-- toward #3697 Wave 7c — withdraw lot→PI breakdown, campaign_spend, host campaign read.
-- MONOTONIC VERSION 20270825003697 (after tip census 20270824003697 / #3697).
-- Do NOT auto-apply — Management API post-merge.

BEGIN;

-- ── Expand ledger entry kinds (campaign spend debit on host launch) ─────────
ALTER TABLE public.ad_credit_ledger
  DROP CONSTRAINT IF EXISTS ad_credit_ledger_entry_kind_check;

ALTER TABLE public.ad_credit_ledger
  ADD CONSTRAINT ad_credit_ledger_entry_kind_check CHECK (entry_kind IN (
    'top_up',
    'withdraw',
    'unspend_return',
    'campaign_spend'
  ));

-- ── Provider refund rows (Stripe PI / Paystack ref per FIFO lot take) ────────
CREATE TABLE IF NOT EXISTS public.ad_credit_provider_refunds (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdraw_ledger_id   uuid NOT NULL
    REFERENCES public.ad_credit_ledger(id) ON DELETE RESTRICT,
  brand_id             uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  lot_id               uuid NOT NULL REFERENCES public.ad_credit_lots(id) ON DELETE RESTRICT,
  provider             text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  payment_ref          text NOT NULL,
  pay_take_cents       bigint NOT NULL CHECK (pay_take_cents > 0),
  credit_take_cents    bigint NOT NULL CHECK (credit_take_cents > 0),
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_refund_id   text NULL,
  idempotency_key      text NOT NULL,
  error_detail         text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_credit_provider_refunds_idem UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS ad_credit_provider_refunds_withdraw_idx
  ON public.ad_credit_provider_refunds (withdraw_ledger_id);

ALTER TABLE public.ad_credit_provider_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_credit_provider_refunds_admin_select
  ON public.ad_credit_provider_refunds;
CREATE POLICY ad_credit_provider_refunds_admin_select
  ON public.ad_credit_provider_refunds
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS ad_credit_provider_refunds_brand_select
  ON public.ad_credit_provider_refunds;
CREATE POLICY ad_credit_provider_refunds_brand_select
  ON public.ad_credit_provider_refunds
  FOR SELECT TO authenticated
  USING (public.biz_can_view_payments_for_brand_for_caller(brand_id));

REVOKE ALL ON public.ad_credit_provider_refunds
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ad_credit_provider_refunds TO authenticated, service_role;

-- ── Host brand members can read their host-owned campaigns ──────────────────
DROP POLICY IF EXISTS "ad_campaigns brand member can read host rows"
  ON public.ad_campaigns;
CREATE POLICY "ad_campaigns brand member can read host rows"
  ON public.ad_campaigns
  FOR SELECT TO authenticated
  USING (
    owner_kind = 'host'
    AND brand_id IS NOT NULL
    AND public.biz_is_brand_member_for_read_for_caller(brand_id)
  );

-- ── Replace ad_credit_apply: lot_takes + campaign_spend + provider_refund rows ─
CREATE OR REPLACE FUNCTION public.ad_credit_apply(
  p_brand_id uuid,
  p_entry_kind text,
  p_amount_cents bigint,
  p_currency text,
  p_idempotency_key text,
  p_fee_cents bigint DEFAULT 0,
  p_pay_cents bigint DEFAULT NULL,
  p_refund_cents bigint DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL,
  p_external_ref text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing      public.ad_credit_ledger%ROWTYPE;
  v_wallet        public.ad_credit_wallets%ROWTYPE;
  v_currency      text := upper(btrim(COALESCE(p_currency, '')));
  v_delta         bigint;
  v_new_bal       bigint;
  v_row           public.ad_credit_ledger%ROWTYPE;
  v_need          bigint;
  v_take          bigint;
  v_pay_take      bigint;
  v_fee_take      bigint;
  v_refund_total  bigint := 0;
  v_fee_total     bigint := 0;
  v_lot           public.ad_credit_lots%ROWTYPE;
  v_lot_id        uuid;
  v_lot_takes     jsonb := '[]'::jsonb;
  v_ext_ref       text;
  v_provider      text;
  v_refund_rows   jsonb := '[]'::jsonb;
  v_refund_rec    public.ad_credit_provider_refunds%ROWTYPE;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'ad_credit_brand_required' USING ERRCODE = '22023';
  END IF;
  IF p_entry_kind IS NULL OR p_entry_kind NOT IN (
    'top_up', 'withdraw', 'unspend_return', 'campaign_spend'
  ) THEN
    RAISE EXCEPTION 'ad_credit_entry_kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_supported_offering_currency(v_currency) THEN
    RAISE EXCEPTION 'ad_credit_currency_unsupported' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents = 0 THEN
    RAISE EXCEPTION 'ad_credit_amount_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL
     OR char_length(btrim(p_idempotency_key)) < 8
     OR char_length(btrim(p_idempotency_key)) > 240 THEN
    RAISE EXCEPTION 'ad_credit_idempotency_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_fee_cents IS NULL OR p_fee_cents < 0 THEN
    RAISE EXCEPTION 'ad_credit_fee_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'ad_credit_metadata_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.ad_credit_ledger
  WHERE idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'lot_id', r.lot_id,
      'provider', r.provider,
      'payment_ref', r.payment_ref,
      'pay_take_cents', r.pay_take_cents,
      'credit_take_cents', r.credit_take_cents,
      'status', r.status,
      'provider_refund_id', r.provider_refund_id,
      'idempotency_key', r.idempotency_key
    ) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_refund_rows
    FROM public.ad_credit_provider_refunds r
    WHERE r.withdraw_ledger_id = v_existing.id;

    RETURN jsonb_build_object(
      'replayed', true,
      'ledger_id', v_existing.id,
      'brand_id', v_existing.brand_id,
      'entry_kind', v_existing.entry_kind,
      'amount_cents', v_existing.amount_cents,
      'fee_cents', v_existing.fee_cents,
      'pay_cents', v_existing.pay_cents,
      'refund_cents', v_existing.refund_cents,
      'balance_after_cents', v_existing.balance_after_cents,
      'currency', v_existing.currency,
      'lot_takes', '[]'::jsonb,
      'provider_refunds', v_refund_rows
    );
  END IF;

  IF p_entry_kind IN ('top_up', 'unspend_return') THEN
    v_delta := abs(p_amount_cents);
  ELSE
    v_delta := -abs(p_amount_cents);
  END IF;

  INSERT INTO public.ad_credit_wallets (brand_id, currency, balance_cents)
  VALUES (p_brand_id, v_currency, 0)
  ON CONFLICT (brand_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.ad_credit_wallets
  WHERE brand_id = p_brand_id
  FOR UPDATE;

  IF v_wallet.currency <> v_currency THEN
    RAISE EXCEPTION 'ad_credit_currency_mismatch' USING ERRCODE = '22023';
  END IF;

  IF p_entry_kind IN ('withdraw', 'campaign_spend') THEN
    v_need := abs(p_amount_cents);
    IF v_wallet.balance_cents < v_need THEN
      RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
    END IF;

    IF p_entry_kind = 'withdraw' THEN
      FOR v_lot IN
        SELECT *
        FROM public.ad_credit_lots
        WHERE brand_id = p_brand_id
          AND credit_remaining_cents > 0
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_need <= 0;
        v_take := LEAST(v_lot.credit_remaining_cents, v_need);
        IF v_take = v_lot.credit_remaining_cents THEN
          v_pay_take := v_lot.pay_remaining_cents;
          v_fee_take := v_lot.fee_remaining_cents;
        ELSE
          v_pay_take := floor(
            v_lot.pay_remaining_cents::numeric * v_take
              / v_lot.credit_remaining_cents
          )::bigint;
          v_fee_take := v_pay_take - v_take;
          IF v_fee_take < 0 THEN
            v_fee_take := 0;
            v_pay_take := v_take;
          END IF;
          IF v_fee_take > v_lot.fee_remaining_cents THEN
            v_fee_take := v_lot.fee_remaining_cents;
            v_pay_take := v_take + v_fee_take;
          END IF;
        END IF;

        SELECT NULLIF(btrim(COALESCE(l.external_ref, '')), '')
        INTO v_ext_ref
        FROM public.ad_credit_ledger l
        WHERE l.id = v_lot.top_up_ledger_id;

        IF v_ext_ref IS NULL THEN
          RAISE EXCEPTION 'ad_credit_lot_missing_payment_ref' USING ERRCODE = 'P0001';
        END IF;

        IF v_ext_ref LIKE 'pi_%' THEN
          v_provider := 'stripe';
        ELSIF v_ext_ref LIKE 'mingla_adc_%' THEN
          v_provider := 'paystack';
        ELSE
          RAISE EXCEPTION 'ad_credit_lot_payment_ref_unsupported' USING ERRCODE = 'P0001';
        END IF;

        -- Paystack rejects partial refunds below 5_000 subunits; fail before
        -- wallet debit commits (this SECURITY DEFINER call is one transaction).
        IF v_provider = 'paystack' AND v_pay_take < 5000 THEN
          RAISE EXCEPTION 'ad_credit_paystack_refund_below_minimum' USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.ad_credit_lots
        SET credit_remaining_cents = credit_remaining_cents - v_take,
            pay_remaining_cents = pay_remaining_cents - v_pay_take,
            fee_remaining_cents = fee_remaining_cents - v_fee_take,
            updated_at = now()
        WHERE id = v_lot.id;

        v_refund_total := v_refund_total + v_pay_take;
        v_fee_total := v_fee_total + v_fee_take;
        v_need := v_need - v_take;

        v_lot_takes := v_lot_takes || jsonb_build_array(jsonb_build_object(
          'lot_id', v_lot.id,
          'top_up_ledger_id', v_lot.top_up_ledger_id,
          'payment_ref', v_ext_ref,
          'provider', v_provider,
          'pay_take_cents', v_pay_take,
          'credit_take_cents', v_take
        ));
      END LOOP;

      IF v_need > 0 THEN
        RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
      END IF;

      p_refund_cents := v_refund_total;
      p_fee_cents := v_fee_total;
    END IF;
  END IF;

  v_new_bal := v_wallet.balance_cents + v_delta;
  IF v_new_bal < 0 THEN
    RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ad_credit_wallets
  SET balance_cents = v_new_bal,
      updated_at = now()
  WHERE brand_id = p_brand_id;

  INSERT INTO public.ad_credit_ledger (
    brand_id, entry_kind, amount_cents, fee_cents, pay_cents, refund_cents,
    balance_after_cents, currency, campaign_id, external_ref, actor_id,
    idempotency_key, metadata
  ) VALUES (
    p_brand_id,
    p_entry_kind,
    v_delta,
    COALESCE(p_fee_cents, 0),
    p_pay_cents,
    p_refund_cents,
    v_new_bal,
    v_currency,
    p_campaign_id,
    NULLIF(btrim(COALESCE(p_external_ref, '')), ''),
    p_actor_id,
    btrim(p_idempotency_key),
    p_metadata
  )
  RETURNING * INTO v_row;

  IF p_entry_kind = 'top_up' THEN
    IF p_pay_cents IS NULL OR p_pay_cents <> (abs(v_delta) + COALESCE(p_fee_cents, 0)) THEN
      RAISE EXCEPTION 'ad_credit_top_up_pay_mismatch' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.ad_credit_lots (
      brand_id, top_up_ledger_id, currency,
      credit_remaining_cents, pay_remaining_cents, fee_remaining_cents
    ) VALUES (
      p_brand_id, v_row.id, v_currency,
      abs(v_delta), p_pay_cents, COALESCE(p_fee_cents, 0)
    )
    RETURNING id INTO v_lot_id;
  END IF;

  IF p_entry_kind = 'withdraw' AND jsonb_array_length(v_lot_takes) > 0 THEN
    INSERT INTO public.ad_credit_provider_refunds (
      withdraw_ledger_id, brand_id, lot_id, provider, payment_ref,
      pay_take_cents, credit_take_cents, status, idempotency_key
    )
    SELECT
      v_row.id,
      p_brand_id,
      (t->>'lot_id')::uuid,
      t->>'provider',
      t->>'payment_ref',
      (t->>'pay_take_cents')::bigint,
      (t->>'credit_take_cents')::bigint,
      'pending',
      left(
        'ad_credit_wd:' || btrim(p_idempotency_key) || ':' || (t->>'payment_ref'),
        240
      )
    FROM jsonb_array_elements(v_lot_takes) AS t;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'lot_id', r.lot_id,
      'provider', r.provider,
      'payment_ref', r.payment_ref,
      'pay_take_cents', r.pay_take_cents,
      'credit_take_cents', r.credit_take_cents,
      'status', r.status,
      'provider_refund_id', r.provider_refund_id,
      'idempotency_key', r.idempotency_key
    ) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_refund_rows
    FROM public.ad_credit_provider_refunds r
    WHERE r.withdraw_ledger_id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'replayed', false,
    'ledger_id', v_row.id,
    'brand_id', v_row.brand_id,
    'entry_kind', v_row.entry_kind,
    'amount_cents', v_row.amount_cents,
    'fee_cents', v_row.fee_cents,
    'pay_cents', v_row.pay_cents,
    'refund_cents', v_row.refund_cents,
    'balance_after_cents', v_row.balance_after_cents,
    'currency', v_row.currency,
    'lot_id', v_lot_id,
    'lot_takes', v_lot_takes,
    'provider_refunds', COALESCE(v_refund_rows, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ad_credit_mark_provider_refund(
  p_id uuid,
  p_status text,
  p_provider_refund_id text DEFAULT NULL,
  p_error_detail text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'ad_credit_refund_status_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ad_credit_provider_refunds
  SET status = p_status,
      provider_refund_id = COALESCE(NULLIF(btrim(COALESCE(p_provider_refund_id, '')), ''), provider_refund_id),
      error_detail = NULLIF(btrim(COALESCE(p_error_detail, '')), ''),
      updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_credit_refund_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ad_credit_mark_provider_refund(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_credit_mark_provider_refund(uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.ad_credit_apply IS
  'toward #3697 Wave 7c: idempotent Ads credit write. Withdraw returns lot_takes + pending provider_refunds for edge Stripe/Paystack refunds.';

COMMIT;
