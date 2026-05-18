-- ORCH-0869 [Tr3 Installment Payments] — Stage 1 migration.
--
-- Creates the order_installments ledger table, adds 3 columns to orders
-- (at_risk, at_risk_since, installment_plan_root, plus 2 more for
-- saved-PM access from the cron), the biz_retry_installment RPC, and
-- schedules the pg_cron job that invokes the process-scheduled-installments
-- edge function every 6 hours.
--
-- Per SPEC §3.1.
--
-- Pre-state (verified 2026-05-17 via mcp__supabase__execute_sql):
--   pg_cron v1.6.4 installed
--   pg_net v0.19.5 installed (async HTTP from postgres)
--   public.orders table exists (per Cycle 9 ticket-orders core)
--   public.trip_pricing_tiers exists (Tr2 sidecar migration
--     20260608000000_orch_0859_trip_sidecar_tables.sql:84)
--   helper biz_is_brand_member_for_read_for_caller(brand_id) exists
--
-- Per I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID + invariant
-- CHECKs in the table definition below — DRAFT → ACTIVE on ORCH-0869 CLOSE.
--
-- Stage 1 scope: ledger + orders columns + retry RPC + cron schedule.
-- Stage 1b (separate migration) amends biz_ticket_checkout_create_session
-- to read trip_pricing_tiers.tier_metadata.installments + reject late-bookings,
-- and biz_ticket_checkout_finalize to populate order_installments rows + the
-- new orders columns when installment_plan_root=true.

BEGIN;

-- ---------------- order_installments ledger ----------------
CREATE TABLE public.order_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'collected', 'failed', 'refunded', 'cancelled')),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  collected_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  retry_count smallint NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ordinal),
  -- I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID
  CONSTRAINT order_installments_collected_requires_pi
    CHECK (
      (status <> 'collected') OR
      (stripe_payment_intent_id IS NOT NULL AND collected_at IS NOT NULL)
    ),
  CONSTRAINT order_installments_failed_requires_reason
    CHECK (
      (status <> 'failed') OR
      (failed_at IS NOT NULL AND failure_reason IS NOT NULL)
    )
);

COMMENT ON TABLE public.order_installments IS
  'ORCH-0869 (Tr3): per-installment ledger for trip orders with payment plans. One row per scheduled installment AFTER the deposit. Status flow: scheduled -> (collected | failed). Failed -> retried by cron up to 3 times; if all 3 retries fail, orders.at_risk=true. Refunded transition is Tr4 scope. Cancelled covers operator-initiated plan cancellation.';

COMMENT ON COLUMN public.order_installments.ordinal IS
  '1-based installment index. Ordinal 1 is the FIRST scheduled installment AFTER the deposit (the deposit itself is the original orders row, not an installment row). So a "25% deposit + 2 installments" plan creates 2 order_installments rows with ordinal 1 and 2.';

CREATE INDEX idx_order_installments_due_status
  ON public.order_installments(due_at, status)
  WHERE status = 'scheduled';

CREATE INDEX idx_order_installments_order
  ON public.order_installments(order_id, ordinal);

CREATE INDEX idx_order_installments_retry
  ON public.order_installments(next_retry_at, status)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- ---------------- updated_at trigger ----------------
CREATE OR REPLACE FUNCTION tg_order_installments_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_installments_set_updated_at
  BEFORE UPDATE ON public.order_installments
  FOR EACH ROW
  EXECUTE FUNCTION tg_order_installments_set_updated_at();

-- ---------------- RLS ----------------
ALTER TABLE public.order_installments ENABLE ROW LEVEL SECURITY;

-- Buyer reads own installments via the orders.buyer_user_id join. For
-- signed-in buyers buyer_user_id = auth.uid(); anonymous buyers cannot
-- read via this policy — they use buyer_status_token via the existing
-- checkout-session lookup path, NOT direct table SELECT.
CREATE POLICY order_installments_read_buyer ON public.order_installments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_installments.order_id
        AND o.buyer_user_id IS NOT NULL
        AND o.buyer_user_id = auth.uid()
    )
  );

-- Brand members read all installments for orders on their events.
CREATE POLICY order_installments_read_brand_member ON public.order_installments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.orders o
        JOIN public.events e ON e.id = o.event_id
       WHERE o.id = order_installments.order_id
         AND biz_is_brand_member_for_read_for_caller(e.brand_id)
    )
  );

-- INSERT/UPDATE/DELETE: ONLY service role (cron edge function + finalize
-- RPC via SECURITY DEFINER context). No user-facing INSERT/UPDATE/DELETE
-- policy by design.

-- ---------------- orders columns added ----------------
ALTER TABLE public.orders
  ADD COLUMN at_risk boolean NOT NULL DEFAULT false,
  ADD COLUMN at_risk_since timestamptz,
  ADD COLUMN installment_plan_root boolean NOT NULL DEFAULT false,
  -- Cron needs these to charge installments off-session on the connected account.
  -- Populated by biz_ticket_checkout_finalize when installment_plan_root=true
  -- (added in Stage 1b RPC amendment migration).
  ADD COLUMN stripe_customer_id_on_connected_account text,
  ADD COLUMN saved_payment_method_id text;

COMMENT ON COLUMN public.orders.at_risk IS
  'ORCH-0869 (Tr3): true when 3 consecutive installment retries have failed per Acceptance Criterion #9. Operator dashboard surfaces flagged orders.';

COMMENT ON COLUMN public.orders.installment_plan_root IS
  'ORCH-0869 (Tr3): true when this order was booked under an installment plan. The order row itself represents the deposit charge; child order_installments rows represent future installments.';

COMMENT ON COLUMN public.orders.stripe_customer_id_on_connected_account IS
  'ORCH-0869 (Tr3): the Stripe Customer ID on the brand''s connected account (created during ticket-checkout-create per ORCH-0844). Used by process-scheduled-installments cron to attach the off-session PaymentIntent to the same Customer that holds the saved PaymentMethod.';

COMMENT ON COLUMN public.orders.saved_payment_method_id IS
  'ORCH-0869 (Tr3): the Stripe PaymentMethod ID saved at booking via setup_future_usage:''off_session''. Cron uses this to charge installments without buyer present.';

-- Partial index for "find at-risk orders" dashboard queries. Brand scoping
-- joins through public.events.brand_id (orders has no brand_id column;
-- brand reachable via orders.event_id FK -> events.brand_id).
CREATE INDEX idx_orders_at_risk
  ON public.orders(at_risk, event_id)
  WHERE at_risk = true;

-- ---------------- biz_retry_installment RPC ----------------
CREATE OR REPLACE FUNCTION public.biz_retry_installment(p_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_installment public.order_installments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_is_member boolean;
BEGIN
  -- Fetch the installment
  SELECT * INTO v_installment FROM public.order_installments WHERE id = p_installment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  -- Only failed installments can be manually retried
  IF v_installment.status <> 'failed' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'installment_not_failed',
      'current_status', v_installment.status
    );
  END IF;

  -- Authorization: caller must be brand member for the order's event
  SELECT * INTO v_order FROM public.orders WHERE id = v_installment.order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_not_found');
  END IF;

  v_is_member := biz_is_brand_member_for_read_for_caller(v_event.brand_id);
  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- Flag for immediate retry on next cron run: flip back to 'scheduled'
  -- with next_retry_at = now() so the cron picks it up at next tick.
  UPDATE public.order_installments
    SET status = 'scheduled',
        next_retry_at = now(),
        updated_at = now()
   WHERE id = p_installment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', p_installment_id,
    'scheduled_for_immediate_retry', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_retry_installment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_retry_installment(uuid) TO authenticated;

COMMENT ON FUNCTION public.biz_retry_installment(uuid) IS
  'ORCH-0869 (Tr3): operator-initiated manual retry of a failed installment. Authorization: caller must be brand member for the order''s event. Flips status back to scheduled with next_retry_at=now() so the next cron run picks it up.';

-- ---------------- pg_cron schedule ----------------
-- The pg_cron job invokes the process-scheduled-installments edge function
-- every 6 hours via pg_net async HTTP. The cron itself is idempotent: the
-- edge function uses Stripe idempotency-keys per installment+retry attempt,
-- and DB writes use predicate-bound UPDATEs (WHERE status='scheduled') so
-- concurrent runs cannot double-write.
--
-- Required GUCs (must be set in Supabase project settings or via
-- ALTER DATABASE ... SET app.settings.* before this migration runs):
--   app.settings.supabase_url        = 'https://gqnoajqerqhnvulmnyvv.supabase.co'
--   app.settings.supabase_service_role_key = '<service role key>'
-- The supabase_url GUC is standard for pg_net + edge function invocation.
SELECT cron.schedule(
  'orch-0869-process-scheduled-installments',
  '0 */6 * * *',  -- every 6 hours at minute 0
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-scheduled-installments',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- ---------------- Self-verification probe ----------------
DO $$
DECLARE
  v_table_count int;
  v_policy_count int;
  v_orders_column_count int;
  v_index_count int;
  v_rpc_count int;
  v_cron_count int;
BEGIN
  SELECT count(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'order_installments';
  IF v_table_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: order_installments table missing (got %)', v_table_count;
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policy WHERE polrelid = 'public.order_installments'::regclass;
  IF v_policy_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: expected 2 RLS policies on order_installments, got %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_orders_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name IN ('at_risk', 'at_risk_since', 'installment_plan_root', 'stripe_customer_id_on_connected_account', 'saved_payment_method_id');
  IF v_orders_column_count != 5 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: expected 5 new columns on orders, got %', v_orders_column_count;
  END IF;

  SELECT count(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_order_installments_due_status',
      'idx_order_installments_order',
      'idx_order_installments_retry',
      'idx_orders_at_risk'
    );
  IF v_index_count != 4 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: expected 4 indexes, got %', v_index_count;
  END IF;

  SELECT count(*) INTO v_rpc_count
  FROM pg_proc WHERE proname = 'biz_retry_installment';
  IF v_rpc_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: biz_retry_installment RPC missing';
  END IF;

  SELECT count(*) INTO v_cron_count
  FROM cron.job WHERE jobname = 'orch-0869-process-scheduled-installments';
  IF v_cron_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: pg_cron job not scheduled (got %)', v_cron_count;
  END IF;

  RAISE NOTICE 'ORCH-0869 Stage 1 migration complete: order_installments + 2 RLS + 5 orders columns + 4 indexes + biz_retry_installment RPC + pg_cron schedule.';
END $$;

COMMIT;
