-- Issue #3645 — trip payment plans on Paystack: data model (M1 of 4).
--
-- One instalment ledger for both rails. Every order_installments row carries an
-- immutable provider stamped at finalize (never derived from the mutable
-- brands.payment_provider) and a per-row collection method. Paystack rows carry
-- the all-in price locked at checkout. Every Paystack money attempt has its own
-- deterministic reference recorded before any provider call; at most one
-- attempt per instalment is unresolved at a time (I-3645-PS-1).
--
-- Saved card details are stored server-side only, in the private schema, and
-- are reachable through service_role functions only (I-3645-PS-2).
--
-- Ships dark: issue_3645_paystack_installments_enabled() returns false.

BEGIN;

-- =============================================================================
-- §1. Attempts table (created first: order_installments.in_flight_attempt_id
--     references it).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.order_installment_charge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES public.order_installments(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  method text NOT NULL CHECK (method IN ('auto_card', 'pay_link', 'approve')),
  reference text NOT NULL UNIQUE
    CHECK (reference ~ '^mingla-inst-[0-9a-f-]{36}-[alp][0-9]+$'),
  state text NOT NULL DEFAULT 'created'
    CHECK (state IN (
      'created', 'succeeded', 'failed', 'paused', 'unknown',
      'superseded', 'refund_due', 'refunded'
    )),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  application_fee_cents bigint NOT NULL CHECK (application_fee_cents >= 0),
  provider_transaction_id text NULL,
  gateway_response text NULL CHECK (gateway_response IS NULL OR length(gateway_response) <= 500),
  approval_url text NULL,
  approval_url_expires_at timestamptz NULL,
  provider_fee_cents bigint NULL CHECK (provider_fee_cents IS NULL OR provider_fee_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  UNIQUE (installment_id, attempt_no)
);

-- I-3645-PS-1: the DB-level double-charge guard. A paused attempt is resolved
-- ("needs approval") and is superseded when a later approve/pay attempt starts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_installment_one_open_attempt
  ON public.order_installment_charge_attempts (installment_id)
  WHERE state IN ('created', 'unknown');
CREATE INDEX IF NOT EXISTS idx_oica_reconcile
  ON public.order_installment_charge_attempts (state, created_at)
  WHERE state IN ('created', 'unknown', 'paused');

ALTER TABLE public.order_installment_charge_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_installment_charge_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_installment_charge_attempts TO service_role;
-- Brand members read only the display-safe columns (never the reference, the
-- approval link or the gateway text), through the view below.
GRANT SELECT (id, installment_id, attempt_no, method, state, created_at, resolved_at)
  ON public.order_installment_charge_attempts TO authenticated;

DROP POLICY IF EXISTS oica_read_brand_member ON public.order_installment_charge_attempts;
CREATE POLICY oica_read_brand_member ON public.order_installment_charge_attempts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.order_installments oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.events e ON e.id = o.event_id
     WHERE oi.id = order_installment_charge_attempts.installment_id
       AND public.biz_is_brand_member_for_read_for_caller(e.brand_id)
  ));

CREATE OR REPLACE VIEW public.order_installment_attempts_safe
  WITH (security_invoker = true) AS
  SELECT id, installment_id, attempt_no, method, state, created_at, resolved_at
    FROM public.order_installment_charge_attempts;
REVOKE ALL ON public.order_installment_attempts_safe FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_installment_attempts_safe TO authenticated, service_role;

COMMENT ON TABLE public.order_installment_charge_attempts IS
  'Issue #3645: one row per provider money attempt for an instalment, recorded before the provider call. At most one unresolved attempt per instalment (I-3645-PS-1).';

-- =============================================================================
-- §2. order_installments — provider, method, locked price, attempt pointer.
-- =============================================================================
ALTER TABLE public.order_installments
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS collection_method text NOT NULL DEFAULT 'auto_card',
  ADD COLUMN IF NOT EXISTS buyer_total_cents bigint NULL,
  ADD COLUMN IF NOT EXISTS planned_application_fee_cents bigint NULL,
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb NULL,
  ADD COLUMN IF NOT EXISTS plan_bound_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS provider_transaction_id text NULL,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_action text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS buyer_action_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pre_charge_notice_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS in_flight_attempt_id uuid NULL;

ALTER TABLE public.order_installments
  DROP CONSTRAINT IF EXISTS order_installments_provider_check,
  DROP CONSTRAINT IF EXISTS order_installments_collection_method_check,
  DROP CONSTRAINT IF EXISTS order_installments_stripe_always_auto_card,
  DROP CONSTRAINT IF EXISTS order_installments_buyer_total_covers_net,
  DROP CONSTRAINT IF EXISTS order_installments_bound_paystack_has_price,
  DROP CONSTRAINT IF EXISTS order_installments_planned_fee_nonnegative,
  DROP CONSTRAINT IF EXISTS order_installments_refunded_within_charged,
  DROP CONSTRAINT IF EXISTS order_installments_buyer_action_check,
  DROP CONSTRAINT IF EXISTS order_installments_paystack_ngn,
  DROP CONSTRAINT IF EXISTS order_installments_in_flight_attempt_fkey;

ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_provider_check
    CHECK (provider IN ('stripe', 'paystack')),
  ADD CONSTRAINT order_installments_collection_method_check
    CHECK (collection_method IN ('auto_card', 'pay_link')),
  ADD CONSTRAINT order_installments_stripe_always_auto_card
    CHECK (provider = 'paystack' OR collection_method = 'auto_card'),
  ADD CONSTRAINT order_installments_buyer_total_covers_net
    CHECK (buyer_total_cents IS NULL OR buyer_total_cents >= amount_cents),
  ADD CONSTRAINT order_installments_bound_paystack_has_price
    CHECK (provider <> 'paystack' OR plan_bound_at IS NULL OR buyer_total_cents IS NOT NULL),
  ADD CONSTRAINT order_installments_planned_fee_nonnegative
    CHECK (planned_application_fee_cents IS NULL OR planned_application_fee_cents >= 0),
  ADD CONSTRAINT order_installments_refunded_within_charged
    CHECK (refunded_amount_cents >= 0
           AND refunded_amount_cents <= coalesce(buyer_total_cents, amount_cents)),
  ADD CONSTRAINT order_installments_buyer_action_check
    CHECK (buyer_action IN ('none', 'pay_link_sent', 'approval_required')),
  ADD CONSTRAINT order_installments_paystack_ngn
    CHECK (provider <> 'paystack' OR currency = 'NGN'),
  ADD CONSTRAINT order_installments_in_flight_attempt_fkey
    FOREIGN KEY (in_flight_attempt_id)
    REFERENCES public.order_installment_charge_attempts(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN public.order_installments.stripe_payment_intent_id IS
  'Provider payment reference: Stripe PaymentIntent id (provider=stripe) or the collecting Paystack reference mingla-inst-… (provider=paystack).';
COMMENT ON COLUMN public.order_installments.provider IS
  'Issue #3645: rail that collects this instalment, stamped at finalize and immutable (I-3645-PS-4). Never derived from brands.payment_provider at charge time.';
COMMENT ON COLUMN public.order_installments.collection_method IS
  'Issue #3645: auto_card (charge the saved card) or pay_link (email the buyer a secure link). Stripe rows are always auto_card.';
COMMENT ON COLUMN public.order_installments.buyer_total_cents IS
  'Issue #3645: all-in amount the buyer is charged for this instalment (minor units), locked at checkout. NULL on Stripe rows.';
COMMENT ON COLUMN public.order_installments.refunded_amount_cents IS
  'Issue #3645: amount of this instalment''s collecting payment already refunded. The single truth for instalment refunds (orders.refunded_amount_cents covers the deposit only).';

CREATE INDEX IF NOT EXISTS idx_order_installments_notice_due
  ON public.order_installments (due_at)
  WHERE status = 'scheduled' AND pre_charge_notice_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_installments_provider_status
  ON public.order_installments (provider, status);

-- I-3645-PS-4: provider is immutable after insert.
CREATE OR REPLACE FUNCTION public.tg_order_installments_provider_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'installment_provider_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.tg_order_installments_provider_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_installments_provider_immutable ON public.order_installments;
CREATE TRIGGER trg_order_installments_provider_immutable
  BEFORE UPDATE OF provider ON public.order_installments
  FOR EACH ROW EXECUTE FUNCTION public.tg_order_installments_provider_immutable();

-- =============================================================================
-- §3. Pay / approve links (raw token never stored; only its SHA-256).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.order_installment_pay_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id uuid NOT NULL REFERENCES public.order_installments(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('pay', 'approve')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  revoked_reason text NULL,
  last_opened_at timestamptz NULL,
  open_count integer NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_installment_one_live_link
  ON public.order_installment_pay_links (installment_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.order_installment_pay_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_installment_pay_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_installment_pay_links TO service_role;

-- =============================================================================
-- §4. Saved card details (private schema; reachable only through the M2
--     service_role functions).
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.order_payment_authorizations (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'paystack'),
  authorization_code text NOT NULL,
  authorization_email text NOT NULL CHECK (length(btrim(authorization_email)) > 0),
  reusable boolean NOT NULL,
  channel text NOT NULL,
  card_type text NULL,
  last4 text NULL CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  exp_month text NULL,
  exp_year text NULL,
  bank text NULL,
  signature text NULL,
  customer_code text NULL,
  source_reference text NOT NULL,
  deactivated_at timestamptz NULL,
  deactivated_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.order_payment_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.order_payment_authorizations FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- §5. Checkout session: the per-payment price locked at checkout.
-- =============================================================================
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS installment_charge_plan jsonb NULL;
ALTER TABLE public.ticket_checkout_sessions
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_charge_plan_needs_schedule;
ALTER TABLE public.ticket_checkout_sessions
  ADD CONSTRAINT ticket_checkout_sessions_charge_plan_needs_schedule
  CHECK (installment_charge_plan IS NULL OR installment_schedule IS NOT NULL);
COMMENT ON COLUMN public.ticket_checkout_sessions.installment_charge_plan IS
  'Issue #3645: Paystack plans only. {currency, engineVersion, payments:[{ordinal, netCents, buyerTotalCents, applicationFeeCents, taxCents, breakdown}]} — the all-in price of each later payment, locked at checkout.';

-- =============================================================================
-- §6. Refund rows that refund exactly one instalment's payment.
-- =============================================================================
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS order_installment_id uuid NULL
    REFERENCES public.order_installments(id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_installment
  ON public.refunds (order_installment_id)
  WHERE order_installment_id IS NOT NULL;
COMMENT ON COLUMN public.refunds.order_installment_id IS
  'Issue #3645: set when this refund returns one instalment''s payment. Such rows are excluded from the order-level (deposit) refund total.';

-- =============================================================================
-- §7. Readiness switch (ships false).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_3645_paystack_installments_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;

REVOKE ALL ON FUNCTION public.issue_3645_paystack_installments_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_paystack_installments_enabled() TO service_role;
COMMENT ON FUNCTION public.issue_3645_paystack_installments_enabled() IS
  'Issue #3645: Paystack trip payment plans. False until Seth approves the switch-on migration after the Paystack TEST-mode end-to-end passes.';

-- =============================================================================
-- §8. A paid, cancelled or refunded instalment's link stops working.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.tg_order_installments_revoke_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.order_installment_pay_links
     SET revoked_at = now(),
         revoked_reason = 'installment_' || NEW.status
   WHERE installment_id = NEW.id
     AND revoked_at IS NULL;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.tg_order_installments_revoke_links() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_installments_revoke_links ON public.order_installments;
CREATE TRIGGER trg_order_installments_revoke_links
  AFTER UPDATE OF status ON public.order_installments
  FOR EACH ROW
  WHEN (NEW.status IN ('collected', 'cancelled', 'refunded'))
  EXECUTE FUNCTION public.tg_order_installments_revoke_links();

-- =============================================================================
-- §9. Webhook inbox: keep only the masked card reference (forward-only,
--     idempotent). The Paystack webhook strips the same field before insert.
-- =============================================================================
UPDATE public.payment_webhook_events
   SET payload = payload #- '{data,authorization,authorization_code}'
 WHERE provider = 'paystack'
   AND payload #> '{data,authorization,authorization_code}' IS NOT NULL;

COMMIT;
