-- toward #3697 Wave 6 — Ads credit wallet + append-only ledger (D2 / D12).
-- Do NOT auto-apply — Management API post-merge.

BEGIN;

-- ── Per-brand wallet (available balance; ledger + lots are source of truth) ──
CREATE TABLE IF NOT EXISTS public.ad_credit_wallets (
  brand_id       uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE RESTRICT,
  currency       char(3) NOT NULL DEFAULT 'USD'
    REFERENCES public.supported_brand_currencies(code),
  balance_cents  bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_credit_wallets IS
  'toward #3697 Wave 6: host Ads credit available balance per brand. Updated only via ad_credit_apply.';

-- ── Append-only ledger ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_credit_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  entry_kind          text NOT NULL CHECK (entry_kind IN (
    'top_up',
    'withdraw',
    'unspend_return'
  )),
  -- Signed wallet delta: + on top_up/unspend_return; − on withdraw.
  amount_cents        bigint NOT NULL CHECK (amount_cents <> 0),
  fee_cents           bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  pay_cents           bigint NULL CHECK (pay_cents IS NULL OR pay_cents > 0),
  refund_cents        bigint NULL CHECK (refund_cents IS NULL OR refund_cents > 0),
  balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
  currency            char(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  -- Audit ids only — no FK. A cascading null on parent delete would UPDATE
  -- these rows and trip the append-only trigger; RESTRICT would block
  -- delete-user / campaign cleanup. Wave 7+ may add RESTRICT once those
  -- owners learn the hold.
  campaign_id         uuid NULL,
  external_ref        text NULL,
  actor_id            uuid NULL,
  idempotency_key     text NOT NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_credit_ledger_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT ad_credit_ledger_idempotency_key_len CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 8 AND 240
  )
);

COMMENT ON TABLE public.ad_credit_ledger IS
  'toward #3697 Wave 6: append-only Ads credit movements. Campaign hold/spend lands in a later wave with explicit held balances.';

CREATE INDEX IF NOT EXISTS ad_credit_ledger_brand_created_idx
  ON public.ad_credit_ledger (brand_id, created_at DESC, id);

-- ── Top-up lots (mutable remaining; FIFO withdraw attribution) ──────────────
CREATE TABLE IF NOT EXISTS public.ad_credit_lots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id              uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  top_up_ledger_id      uuid NOT NULL UNIQUE
    REFERENCES public.ad_credit_ledger(id) ON DELETE RESTRICT,
  currency              char(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  credit_remaining_cents bigint NOT NULL CHECK (credit_remaining_cents >= 0),
  pay_remaining_cents    bigint NOT NULL CHECK (pay_remaining_cents >= 0),
  fee_remaining_cents    bigint NOT NULL CHECK (fee_remaining_cents >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_credit_lots_remaining_coherent CHECK (
    credit_remaining_cents + fee_remaining_cents = pay_remaining_cents
    OR credit_remaining_cents = 0
  )
);

COMMENT ON TABLE public.ad_credit_lots IS
  'toward #3697 Wave 6: remaining refundable credit/pay/fee per top-up for FIFO withdraw attribution.';

CREATE INDEX IF NOT EXISTS ad_credit_lots_brand_fifo_idx
  ON public.ad_credit_lots (brand_id, created_at ASC, id)
  WHERE credit_remaining_cents > 0;

-- Append-only guard on the ledger (UPDATE of lot remainings is intentional).
CREATE OR REPLACE FUNCTION public.ad_credit_ledger_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'ad_credit_ledger_immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ad_credit_ledger_append_only ON public.ad_credit_ledger;
CREATE TRIGGER ad_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.ad_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ad_credit_ledger_reject_mutation();

ALTER TABLE public.ad_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_credit_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_credit_wallets_admin_select ON public.ad_credit_wallets;
CREATE POLICY ad_credit_wallets_admin_select ON public.ad_credit_wallets
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS ad_credit_wallets_brand_select ON public.ad_credit_wallets;
CREATE POLICY ad_credit_wallets_brand_select ON public.ad_credit_wallets
  FOR SELECT TO authenticated
  USING (public.biz_can_view_payments_for_brand_for_caller(brand_id));

DROP POLICY IF EXISTS ad_credit_ledger_admin_select ON public.ad_credit_ledger;
CREATE POLICY ad_credit_ledger_admin_select ON public.ad_credit_ledger
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS ad_credit_ledger_brand_select ON public.ad_credit_ledger;
CREATE POLICY ad_credit_ledger_brand_select ON public.ad_credit_ledger
  FOR SELECT TO authenticated
  USING (public.biz_can_view_payments_for_brand_for_caller(brand_id));

DROP POLICY IF EXISTS ad_credit_lots_admin_select ON public.ad_credit_lots;
CREATE POLICY ad_credit_lots_admin_select ON public.ad_credit_lots
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS ad_credit_lots_brand_select ON public.ad_credit_lots;
CREATE POLICY ad_credit_lots_brand_select ON public.ad_credit_lots
  FOR SELECT TO authenticated
  USING (public.biz_can_view_payments_for_brand_for_caller(brand_id));

REVOKE ALL ON public.ad_credit_wallets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_credit_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_credit_lots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_credit_wallets TO authenticated;
GRANT SELECT ON public.ad_credit_ledger TO authenticated;
GRANT SELECT ON public.ad_credit_lots TO authenticated;
-- Wallets/lots mutate via SECURITY DEFINER apply; ledger is INSERT-only.
GRANT SELECT, INSERT, UPDATE ON public.ad_credit_wallets TO service_role;
GRANT SELECT, INSERT ON public.ad_credit_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ad_credit_lots TO service_role;

-- ── Idempotent apply (service_role / edge only) ─────────────────────────────
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
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'ad_credit_brand_required' USING ERRCODE = '22023';
  END IF;
  IF p_entry_kind IS NULL OR p_entry_kind NOT IN (
    'top_up', 'withdraw', 'unspend_return'
  ) THEN
    RAISE EXCEPTION 'ad_credit_entry_kind_invalid' USING ERRCODE = '22023';
  END IF;
  -- One currency authority (#3645): public.supported_brand_currencies.
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
      'currency', v_existing.currency
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

  -- Withdraw: FIFO lot attribution for exact refund (credit + fee per lot).
  IF p_entry_kind = 'withdraw' THEN
    v_need := abs(p_amount_cents);
    IF v_wallet.balance_cents < v_need THEN
      RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
    END IF;

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

      UPDATE public.ad_credit_lots
      SET credit_remaining_cents = credit_remaining_cents - v_take,
          pay_remaining_cents = pay_remaining_cents - v_pay_take,
          fee_remaining_cents = fee_remaining_cents - v_fee_take,
          updated_at = now()
      WHERE id = v_lot.id;

      v_refund_total := v_refund_total + v_pay_take;
      v_fee_total := v_fee_total + v_fee_take;
      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION 'ad_credit_insufficient' USING ERRCODE = 'P0001';
    END IF;

    p_refund_cents := v_refund_total;
    p_fee_cents := v_fee_total;
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
    'lot_id', v_lot_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ad_credit_apply(
  uuid, text, bigint, text, text, bigint, bigint, bigint, uuid, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_credit_apply(
  uuid, text, bigint, text, text, bigint, bigint, bigint, uuid, text, uuid, jsonb
) TO service_role;

COMMENT ON FUNCTION public.ad_credit_apply IS
  'toward #3697 Wave 6: idempotent Ads credit ledger write. service_role only; edge enforces payment manage/view. Withdraw refunds FIFO against top-up lots.';

COMMIT;
