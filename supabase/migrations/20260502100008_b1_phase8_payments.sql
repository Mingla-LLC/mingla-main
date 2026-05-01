-- Cycle B1 Phase 8 — Payments ledger tables (BUSINESS_PROJECT_PLAN §B.6).
-- Schema + RLS only; live Stripe wiring is B2/B3.

CREATE TABLE IF NOT EXISTS public.stripe_connect_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL,
  account_type text NOT NULL DEFAULT 'express'
    CONSTRAINT stripe_connect_accounts_type_check
      CHECK (account_type IN ('standard', 'express', 'custom')),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_connect_accounts_stripe_id_nonempty
    CHECK (length(trim(stripe_account_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_connect_accounts_brand_id
  ON public.stripe_connect_accounts (brand_id);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_stripe_account_id
  ON public.stripe_connect_accounts (stripe_account_id);

DROP TRIGGER IF EXISTS trg_stripe_connect_accounts_updated_at ON public.stripe_connect_accounts;
CREATE TRIGGER trg_stripe_connect_accounts_updated_at
  BEFORE UPDATE ON public.stripe_connect_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.stripe_connect_accounts IS 'Stripe Connect account per brand (B1 §B.6).';

ALTER TABLE public.stripe_connect_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  stripe_payout_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'GBP',
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT payouts_status_check
      CHECK (status IN ('pending', 'paid', 'failed')),
  arrival_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT payouts_stripe_id_nonempty CHECK (length(trim(stripe_payout_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_payouts_brand_id ON public.payouts (brand_id);

COMMENT ON TABLE public.payouts IS 'Stripe payouts mirror (B1 §B.6).';

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  stripe_refund_id text,
  amount_cents integer NOT NULL,
  reason text,
  initiated_by uuid REFERENCES auth.users (id),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_amount_positive CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON public.refunds (order_id);

COMMENT ON TABLE public.refunds IS 'Refunds linked to orders (B1 §B.6).';

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.door_sales_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  scanner_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  payment_method text NOT NULL,
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'GBP',
  reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT door_sales_ledger_amount_non_negative CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_door_sales_ledger_event_id ON public.door_sales_ledger (event_id);
CREATE INDEX IF NOT EXISTS idx_door_sales_ledger_order_id ON public.door_sales_ledger (order_id);

COMMENT ON TABLE public.door_sales_ledger IS 'Append-only style door sales ledger (B1 §B.6).';

ALTER TABLE public.door_sales_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_webhook_events_stripe_id_nonempty
    CHECK (length(trim(stripe_event_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_stripe_event_id
  ON public.payment_webhook_events (stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_processed ON public.payment_webhook_events (processed);

COMMENT ON TABLE public.payment_webhook_events IS
  'Idempotent Stripe webhook inbox; service role only from clients (B1 §B.6).';

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.biz_order_brand_id(p_order_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.id = p_order_id
  LIMIT 1;
$$;

-- Brand admin / finance_manager only (not event_manager alone) per §B.6.
CREATE OR REPLACE FUNCTION public.biz_can_manage_payments_for_brand(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_is_brand_admin_plus(p_brand_id, p_user_id)
  OR EXISTS (
    SELECT 1
    FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id
      AND m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND m.role = 'finance_manager'
  );
$$;

-- stripe_connect_accounts
DROP POLICY IF EXISTS "Brand admin plus can manage stripe_connect_accounts" ON public.stripe_connect_accounts;
CREATE POLICY "Brand admin plus can manage stripe_connect_accounts"
  ON public.stripe_connect_accounts
  FOR ALL
  TO authenticated
  USING (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()))
  WITH CHECK (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()));

-- payouts
DROP POLICY IF EXISTS "Brand admin plus can manage payouts" ON public.payouts;
CREATE POLICY "Brand admin plus can manage payouts"
  ON public.payouts
  FOR ALL
  TO authenticated
  USING (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()))
  WITH CHECK (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()));

-- refunds (via order → brand)
DROP POLICY IF EXISTS "Brand admin plus can manage refunds" ON public.refunds;
CREATE POLICY "Brand admin plus can manage refunds"
  ON public.refunds
  FOR ALL
  TO authenticated
  USING (
    public.biz_can_manage_payments_for_brand(
      public.biz_order_brand_id(order_id),
      auth.uid()
    )
  )
  WITH CHECK (
    public.biz_can_manage_payments_for_brand(
      public.biz_order_brand_id(order_id),
      auth.uid()
    )
  );

-- door_sales_ledger
DROP POLICY IF EXISTS "Brand admin plus can manage door_sales_ledger" ON public.door_sales_ledger;
CREATE POLICY "Brand admin plus can manage door_sales_ledger"
  ON public.door_sales_ledger
  FOR ALL
  TO authenticated
  USING (
    public.biz_can_manage_payments_for_brand(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
  )
  WITH CHECK (
    public.biz_can_manage_payments_for_brand(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
  );

-- payment_webhook_events: no client access (service role bypasses RLS)
