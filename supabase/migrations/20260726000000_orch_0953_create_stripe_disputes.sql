-- ORCH-0953 §3.3: Stripe dispute observability for live-mode cutover.

CREATE TABLE public.stripe_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id text NOT NULL UNIQUE,
  stripe_charge_id text NOT NULL,
  stripe_payment_intent_id text,
  stripe_account_id text NOT NULL,
  brand_id uuid REFERENCES public.brands(id),
  order_id uuid REFERENCES public.orders(id),
  amount integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  evidence_due_by timestamptz,
  is_charge_refundable boolean NOT NULL DEFAULT false,
  raw_event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stripe_disputes_brand_id
  ON public.stripe_disputes(brand_id);

CREATE INDEX idx_stripe_disputes_order_id
  ON public.stripe_disputes(order_id);

CREATE INDEX idx_stripe_disputes_status
  ON public.stripe_disputes(status);

ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_stripe_disputes"
  ON public.stripe_disputes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "brand_payment_managers_select_stripe_disputes"
  ON public.stripe_disputes FOR SELECT TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id
      FROM public.brand_team_members
      WHERE user_id = auth.uid()
        AND removed_at IS NULL
        AND accepted_at IS NOT NULL
        AND role IN ('account_owner', 'brand_admin', 'finance_manager')
    )
  );
