-- ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] migration.
-- Per SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md §3.1.
-- Extends events + orders + order_installments + refund_line_items (no new ledger).
-- New RPCs: validate_refund_policy, biz_compute_refund_for_cancel,
--           biz_cancel_trip_booking_begin, biz_cancel_trip_booking_commit,
--           biz_cancel_trip_booking_rollback.
-- New triggers: tg_refund_line_items_installment_parity
--               (I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY)
--               tg_refunds_amount_immutable
--               (I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL)
-- New CHECK constraints:
--   events_refund_policy_valid (invokes validate_refund_policy)
--   order_installments_cancelled_at_status_consistent
-- New pg_cron schedule: orch-0875-process-booking-deadlines (hourly)
--
-- Inherits ORCH-0787 [refund-order] refunds + refund_line_items schema (extends).
-- Inherits ORCH-0869 [Tr3 Installment Payments] order_installments status enum
-- (cancelled + refunded already in CHECK; this migration adds cancelled_at column).
--
-- DESIGN-AMENDMENT SC-22 freshness contract is enforced by edge fn
-- cancel-trip-booking re-computing biz_compute_refund_for_cancel at _begin step
-- and returning 409 on amount divergence; no DB-level enforcement needed.

BEGIN;

-- ============================================================
-- §3.1.A events: refund_policy + booking_deadline + bookings_closed
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN refund_policy jsonb NULL,
  ADD COLUMN booking_deadline timestamptz NULL,
  ADD COLUMN bookings_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN bookings_closed_at timestamptz NULL;

COMMENT ON COLUMN public.events.refund_policy IS
  'ORCH-0875 (Tr4): cascading refund tier policy for trips. Shape: {kind:"flexible"|"standard"|"strict"|"custom", tiers:[{days_before_start:int>=0, refund_pct:int 0-100}]}. Tiers sorted descending by days_before_start. Monotonicity: refund_pct non-increasing as days_before_start decreases. Trip-only (event_type=trip); single-event policy semantics unchanged.';

COMMENT ON COLUMN public.events.booking_deadline IS
  'ORCH-0875 (Tr4): absolute timestamp after which new bookings are rejected. NULL means no deadline (Tr2 default behaviour). Cron orch-0875-process-booking-deadlines flips bookings_closed=true when now() >= booking_deadline.';

COMMENT ON COLUMN public.events.bookings_closed IS
  'ORCH-0875 (Tr4): true when bookings_closed_at is set (auto by cron OR manual by operator). ticket-checkout-create hard-blocks with HTTP 403 when true. Trip-only effect.';

COMMENT ON COLUMN public.events.bookings_closed_at IS
  'ORCH-0875 (Tr4): timestamp when bookings_closed flipped true. Audit trail; not used for any business logic.';

CREATE INDEX idx_events_booking_deadline_open
  ON public.events(booking_deadline)
  WHERE event_type = 'trip' AND booking_deadline IS NOT NULL AND bookings_closed = false;

-- ============================================================
-- §3.1.B orders: buyer_cancel_token_hash ONLY
-- (SPEC-DEVIATION 2026-05-18 — applied at Phase A first-run after `supabase db
-- push` failed with "column cancelled_by already exists". Per live DB probe via
-- mcp__supabase__execute_sql, ORCH-0787 [refund-order] migration
-- 20260520000000_orch_0787_order_refund_cancel.sql lines 40-43 ALREADY added
-- `cancelled_at`, `cancelled_by`, `cancellation_reason`, `refunded_amount_cents`
-- to orders. Investigation §2.2 and SPEC §3.1.B verified only `cancelled_at`
-- and missed the other three. The semantic intent of SPEC's `cancel_reason` is
-- identical to existing `cancellation_reason` (free-text reason for cancellation).
-- DRY: reuse existing columns rather than duplicate. biz_cancel_trip_booking_begin
-- below writes to existing `cancellation_reason` + `cancelled_by`. Only the
-- net-new `buyer_cancel_token_hash` is added here. Surfaced as DISC-IMPL-A-4 in
-- the implementation report; orchestrator should update SPEC §3.1.B at REVIEW
-- to cite `cancellation_reason` instead of `cancel_reason`.)
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN buyer_cancel_token_hash text NULL;

COMMENT ON COLUMN public.orders.buyer_cancel_token_hash IS
  'ORCH-0875 (Tr4): SHA256 hash of buyer cancel token. Plaintext token embedded in confirmation email URL as ?token=<plaintext>. Edge fn cancel-trip-booking validates by SHA256(plaintext) === buyer_cancel_token_hash. NULL for orders not eligible for buyer self-cancel (e.g., past trip end or already cancelled).';

CREATE INDEX idx_orders_buyer_cancel_token
  ON public.orders(buyer_cancel_token_hash)
  WHERE buyer_cancel_token_hash IS NOT NULL;

-- ============================================================
-- §3.1.C order_installments: cancelled_at + cancelled_by
-- ============================================================
ALTER TABLE public.order_installments
  ADD COLUMN cancelled_at timestamptz NULL,
  ADD COLUMN cancelled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.order_installments.cancelled_at IS
  'ORCH-0875 (Tr4): set when the installment is cancelled via Tr4 cancel flow. Cron process-scheduled-installments filters WHERE status=scheduled AND cancelled_at IS NULL to prevent post-cancel charging. Pairs with status=cancelled.';

COMMENT ON COLUMN public.order_installments.cancelled_by IS
  'ORCH-0875 (Tr4): auth.users.id of actor who cancelled. NULL when buyer-self-cancelled via anon token; set when operator-cancelled via JWT or when cron auto-cancels (would be NULL in cron context, but Tr4 v1 cron never cancels installments — buyer/operator cancel writes both columns).';

-- Tighten cron query: ensure status=cancelled rows are always also cancelled_at-stamped
ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_cancelled_at_status_consistent
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));

CREATE INDEX idx_order_installments_cancelled
  ON public.order_installments(cancelled_at)
  WHERE cancelled_at IS NOT NULL;

-- ============================================================
-- §3.1.D refund_line_items: installment_id provenance
-- ============================================================
ALTER TABLE public.refund_line_items
  ADD COLUMN installment_id uuid NULL REFERENCES public.order_installments(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.refund_line_items.installment_id IS
  'ORCH-0875 (Tr4): when this refund row attributes to a specific Tr3 installment payment (vs a one-shot single-PI refund), references the source installment. NULL for single-payment refunds (ORCH-0787 [refund-order] behaviour preserved).';

CREATE INDEX idx_refund_line_items_installment_id
  ON public.refund_line_items(installment_id)
  WHERE installment_id IS NOT NULL;

-- Drop the prior UNIQUE that does not account for per-installment splits.
-- ORCH-0787 named the constraint refund_line_items_refund_id_order_line_item_id_key
-- via UNIQUE (refund_id, order_line_item_id). Replace with composite that
-- permits per-installment splits within one refund.
ALTER TABLE public.refund_line_items
  DROP CONSTRAINT IF EXISTS refund_line_items_refund_id_order_line_item_id_key;

ALTER TABLE public.refund_line_items
  ADD CONSTRAINT refund_line_items_refund_line_installment_unique
  UNIQUE NULLS NOT DISTINCT (refund_id, order_line_item_id, installment_id);

-- I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY enforcement trigger.
-- Every refund_line_items row with installment_id set MUST reference an
-- order_installments row whose order_id matches the parent refunds.order_id.
CREATE OR REPLACE FUNCTION tg_refund_line_items_installment_parity()
RETURNS trigger AS $$
DECLARE
  v_installment_order_id uuid;
  v_refund_order_id uuid;
BEGIN
  IF NEW.installment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT order_id INTO v_installment_order_id
    FROM public.order_installments WHERE id = NEW.installment_id;
  SELECT order_id INTO v_refund_order_id
    FROM public.refunds WHERE id = NEW.refund_id;
  IF v_installment_order_id IS DISTINCT FROM v_refund_order_id THEN
    RAISE EXCEPTION 'I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY: installment_id % belongs to order % but refund references order %',
      NEW.installment_id, v_installment_order_id, v_refund_order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refund_line_items_installment_parity
  BEFORE INSERT OR UPDATE OF installment_id ON public.refund_line_items
  FOR EACH ROW EXECUTE FUNCTION tg_refund_line_items_installment_parity();

-- I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL enforcement trigger.
-- refunds.amount_cents is immutable post-insert. Prevents race conditions
-- between cancel-confirm and cron-charging the next installment.
CREATE OR REPLACE FUNCTION tg_refunds_amount_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.amount_cents IS DISTINCT FROM NEW.amount_cents THEN
    RAISE EXCEPTION 'I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL: refunds.amount_cents is immutable post-insert (attempted change from % to %)',
      OLD.amount_cents, NEW.amount_cents;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refunds_amount_immutable
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION tg_refunds_amount_immutable();

-- ============================================================
-- §3.1.E biz_compute_refund_for_cancel — pure SQL function (deterministic)
-- ============================================================
-- Returns the cascading-tier refund computation at cancel time without
-- side effects. Used by both refund preview (read-only) and biz_cancel_trip_booking
-- (write path). Pins refund amount at compute time so preview === confirm
-- (modulo SC-22 freshness re-check at _begin step).
CREATE OR REPLACE FUNCTION biz_compute_refund_for_cancel(
  p_order_id uuid,
  p_cancel_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_event_start timestamptz;
  v_policy jsonb;
  v_tiers jsonb;
  v_days_remaining int;
  v_tier_pct int;
  v_paid_total_cents bigint;
  v_refund_total_cents bigint;
  v_installments jsonb := '[]'::jsonb;
  v_installment record;
  v_per_installment_refund jsonb := '[]'::jsonb;
BEGIN
  -- Fetch order + event
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  IF v_event.event_type IS DISTINCT FROM 'trip' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_trip');
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  END IF;

  -- Determine trip start. Tr2 sidecar event_dates.start_at MIN aggregate per
  -- I-PROPOSED-TR2-* date sidecar pattern. If event_dates is empty (data
  -- integrity issue), reject with no_trip_start_date — operator must fix
  -- before Tr4 cancel can compute.
  SELECT min(start_at) INTO v_event_start
  FROM public.event_dates
  WHERE event_id = v_event.id;
  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_trip_start_date');
  END IF;

  -- Days remaining (floor to whole days; negative when after trip start).
  v_days_remaining := FLOOR(EXTRACT(EPOCH FROM (v_event_start - p_cancel_at)) / 86400)::int;

  -- Resolve refund policy. Trip-level overrides absent → tier_pct = 0 (no refund).
  v_policy := COALESCE(v_event.refund_policy, '{}'::jsonb);
  v_tiers := COALESCE(v_policy->'tiers', '[]'::jsonb);
  v_tier_pct := 0;
  -- Iterate tiers descending by days_before_start; first match wins (longest-notice tier first).
  SELECT (tier_entry->>'refund_pct')::int INTO v_tier_pct
  FROM jsonb_array_elements(v_tiers) AS tier_entry
  WHERE (tier_entry->>'days_before_start')::int <= v_days_remaining
  ORDER BY (tier_entry->>'days_before_start')::int DESC
  LIMIT 1;
  v_tier_pct := COALESCE(v_tier_pct, 0);

  -- Paid total + per-payment refund attribution.
  -- For installment-plan-root orders: deposit lives on orders.total_cents +
  -- each collected installment has its own row in order_installments.
  -- For single-payment orders: orders.total_cents is the only paid amount.
  IF v_order.installment_plan_root THEN
    -- Deposit (orders row) + sum of collected installments
    SELECT v_order.total_cents +
           COALESCE(sum(amount_cents), 0)
    INTO v_paid_total_cents
    FROM public.order_installments
    WHERE order_id = v_order.id AND status = 'collected';

    -- Build per-installment refund attribution (one row per collected installment).
    FOR v_installment IN
      SELECT id, amount_cents, currency, stripe_payment_intent_id, ordinal
      FROM public.order_installments
      WHERE order_id = v_order.id AND status = 'collected'
      ORDER BY ordinal ASC
    LOOP
      v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
        'installment_id', v_installment.id,
        'ordinal', v_installment.ordinal,
        'source_pi', v_installment.stripe_payment_intent_id,
        'paid_cents', v_installment.amount_cents,
        'refund_cents', FLOOR(v_installment.amount_cents * v_tier_pct / 100.0)::bigint,
        'currency', v_installment.currency
      );
    END LOOP;

    -- Append the deposit row (orders-level, installment_id=NULL).
    v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_order.total_cents * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency,
      'note', 'deposit'
    );
  ELSE
    -- Single-payment order: total_cents = paid.
    v_paid_total_cents := v_order.total_cents;
    v_per_installment_refund := jsonb_build_array(jsonb_build_object(
      'installment_id', NULL,
      'ordinal', 0,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_order.total_cents * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency
    ));
  END IF;

  -- Sum refund_cents across attributions for total (handles per-row rounding).
  SELECT COALESCE(sum((r->>'refund_cents')::bigint), 0) INTO v_refund_total_cents
  FROM jsonb_array_elements(v_per_installment_refund) AS r;

  -- Scheduled + failed installments to cancel (for write path); cron will
  -- skip these per AND cancelled_at IS NULL filter.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('installment_id', id, 'ordinal', ordinal, 'due_at', due_at)
           ORDER BY ordinal), '[]'::jsonb)
  INTO v_installments
  FROM public.order_installments
  WHERE order_id = v_order.id
    AND status IN ('scheduled', 'failed')
    AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'event_id', v_event.id,
    'cancel_at', p_cancel_at,
    'trip_start', v_event_start,
    'days_remaining', v_days_remaining,
    'tier_pct', v_tier_pct,
    'paid_total_cents', v_paid_total_cents,
    'refund_total_cents', v_refund_total_cents,
    'currency', v_order.currency,
    'per_payment_refund', v_per_installment_refund,
    'installments_to_cancel', v_installments,
    'policy_kind', COALESCE(v_policy->>'kind', 'none')
  );
END;
$$;

REVOKE ALL ON FUNCTION biz_compute_refund_for_cancel(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biz_compute_refund_for_cancel(uuid, timestamptz) TO authenticated, service_role;

-- ============================================================
-- §3.1.F biz_cancel_trip_booking_begin — write path begin (pre-Stripe)
-- ============================================================
-- Two-step pattern mirrors ORCH-0787 [refund-order] biz_refund_order +
-- biz_refund_order_commit. Begin inserts pending refunds row + flips
-- orders.cancelled_at + writes installment cancellations + returns
-- refund_id + per-payment attribution. Edge function then calls
-- stripe.refunds.create per PI, then calls _commit on success or
-- _rollback on failure.
CREATE OR REPLACE FUNCTION biz_cancel_trip_booking_begin(
  p_order_id uuid,
  p_actor_kind text,    -- 'buyer' | 'operator'
  p_actor_user_id uuid, -- nullable for buyer-self
  p_reason text,
  p_cancel_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_compute jsonb;
  v_refund_id uuid;
BEGIN
  -- Validate actor_kind
  IF p_actor_kind IS NULL OR p_actor_kind NOT IN ('buyer', 'operator') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_actor_kind');
  END IF;

  -- Compute refund (deterministic SQL function pins amount at cancel_at).
  v_compute := biz_compute_refund_for_cancel(p_order_id, p_cancel_at);
  IF NOT (v_compute->>'ok')::boolean THEN
    RETURN v_compute;
  END IF;

  -- Insert pending refund (ORCH-0787 schema; amount immutable post-insert per trigger).
  INSERT INTO public.refunds (
    order_id, amount_cents, currency, status, reason,
    application_fee_refunded_cents
  ) VALUES (
    p_order_id,
    (v_compute->>'refund_total_cents')::bigint,
    v_compute->>'currency',
    'pending',
    LEFT(COALESCE(p_reason, 'tr4_cancel'), 200),
    0  -- computed by Stripe + written by _commit
  )
  RETURNING id INTO v_refund_id;

  -- Flip orders.cancelled_at + cancellation_reason + cancelled_by + clear at_risk (Q7 resolution).
  -- Note: reusing existing ORCH-0787 [refund-order] cancellation_reason + cancelled_by
  -- columns rather than adding duplicate Tr4-prefixed ones (DISC-IMPL-A-4).
  UPDATE public.orders
    SET cancelled_at = p_cancel_at,
        cancellation_reason = p_reason,
        cancelled_by = p_actor_user_id,
        at_risk = false,
        at_risk_since = NULL
   WHERE id = p_order_id;

  -- Cancel scheduled/failed installments (cron will skip per AND cancelled_at IS NULL filter).
  UPDATE public.order_installments
    SET status = 'cancelled',
        cancelled_at = p_cancel_at,
        cancelled_by = p_actor_user_id
   WHERE order_id = p_order_id
     AND status IN ('scheduled', 'failed')
     AND cancelled_at IS NULL;

  -- NOTE: refund_line_items inserts happen in the edge function per-PI loop
  -- (after Stripe refund succeeds for that PI). The edge function passes
  -- (refund_id, order_line_item_id, installment_id, amount_cents) per row.

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_refund_id,
    'per_payment_refund', v_compute->'per_payment_refund',
    'refund_total_cents', v_compute->'refund_total_cents',
    'currency', v_compute->'currency',
    'tier_pct', v_compute->'tier_pct',
    'installments_to_cancel', v_compute->'installments_to_cancel'
  );
END;
$$;

REVOKE ALL ON FUNCTION biz_cancel_trip_booking_begin(uuid, text, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_begin(uuid, text, uuid, text, timestamptz) TO service_role;

-- ============================================================
-- §3.1.G biz_cancel_trip_booking_commit — write path commit (post-Stripe)
-- ============================================================
CREATE OR REPLACE FUNCTION biz_cancel_trip_booking_commit(
  p_refund_id uuid,
  p_stripe_refund_ids text[],  -- one per source PI; ORCH-0787 single-event uses 1 element
  p_application_fee_refunded_cents int,
  p_processed_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count int;
BEGIN
  UPDATE public.refunds
    SET status = 'succeeded',
        stripe_refund_id = p_stripe_refund_ids[1],  -- primary refund id; full list in metadata
        application_fee_refunded_cents = p_application_fee_refunded_cents,
        processed_at = p_processed_at
   WHERE id = p_refund_id AND status = 'pending';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_not_pending_or_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'refund_id', p_refund_id);
END;
$$;

REVOKE ALL ON FUNCTION biz_cancel_trip_booking_commit(uuid, text[], int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_commit(uuid, text[], int, timestamptz) TO service_role;

-- ============================================================
-- §3.1.H biz_cancel_trip_booking_rollback — write path rollback (Stripe failure)
-- ============================================================
-- Marks refund as failed. Operator must manually retry via dashboard.
-- v1: orders.cancelled_at stays SET (booking is cancelled even if refund failed —
-- operator handles the refund retry separately). Future ORCH: automated retry.
CREATE OR REPLACE FUNCTION biz_cancel_trip_booking_rollback(
  p_refund_id uuid,
  p_failure_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count int;
BEGIN
  UPDATE public.refunds
    SET status = 'failed',
        reason = LEFT(COALESCE(reason, '') || ' | rollback: ' || LEFT(COALESCE(p_failure_reason, 'unknown'), 100), 200),
        processed_at = now()
   WHERE id = p_refund_id AND status = 'pending';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'refund_not_pending_or_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'status', 'failed');
END;
$$;

REVOKE ALL ON FUNCTION biz_cancel_trip_booking_rollback(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_rollback(uuid, text) TO service_role;

-- ============================================================
-- §3.1.I refund_policy publish-time validation
-- ============================================================
-- IMMUTABLE function used by:
--   (a) CHECK constraint on events.refund_policy (write-time defense-in-depth)
--   (b) trip publish RPC explicit call (validates before write)
--   (c) client-side RefundPolicyEditor inline error display (informational; SQL is authoritative)
--
-- I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY: refund_pct must be non-increasing
-- across tiers. Tiers must be sorted DESC by days_before_start.
CREATE OR REPLACE FUNCTION validate_refund_policy(p_policy jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_kind text;
  v_tiers jsonb;
  v_prev_days int := -1;
  v_prev_pct int := 101;
  v_tier jsonb;
  v_days int;
  v_pct int;
BEGIN
  IF p_policy IS NULL THEN
    RETURN true;  -- NULL is "no policy" (no refund at any time, semantically equivalent to 0% tier)
  END IF;
  v_kind := p_policy->>'kind';
  IF v_kind NOT IN ('flexible', 'standard', 'strict', 'custom') THEN
    RAISE EXCEPTION 'refund_policy.kind must be flexible|standard|strict|custom (got %)', v_kind;
  END IF;
  v_tiers := p_policy->'tiers';
  IF jsonb_typeof(v_tiers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'refund_policy.tiers must be a JSONB array';
  END IF;
  IF jsonb_array_length(v_tiers) = 0 THEN
    RAISE EXCEPTION 'refund_policy.tiers must contain at least 1 tier';
  END IF;
  IF jsonb_array_length(v_tiers) > 8 THEN
    RAISE EXCEPTION 'refund_policy.tiers max 8 tiers (got %)', jsonb_array_length(v_tiers);
  END IF;
  -- Iterate tiers in input order; expect DESC by days_before_start; assert monotonicity.
  FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
    v_days := (v_tier->>'days_before_start')::int;
    v_pct := (v_tier->>'refund_pct')::int;
    IF v_days IS NULL OR v_days < 0 THEN
      RAISE EXCEPTION 'tier days_before_start must be int >= 0 (got %)', v_days;
    END IF;
    IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'tier refund_pct must be int 0-100 (got %)', v_pct;
    END IF;
    IF v_prev_days >= 0 AND v_days >= v_prev_days THEN
      RAISE EXCEPTION 'tier days_before_start must be strictly descending (% then %)', v_prev_days, v_days;
    END IF;
    IF v_pct > v_prev_pct THEN
      RAISE EXCEPTION 'I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY: tier refund_pct must be non-increasing (% then %)', v_prev_pct, v_pct;
    END IF;
    v_prev_days := v_days;
    v_prev_pct := v_pct;
  END LOOP;
  RETURN true;
END;
$$;

-- Enforce at write-time (defense-in-depth alongside trip-publish RPC validation).
ALTER TABLE public.events
  ADD CONSTRAINT events_refund_policy_valid
  CHECK (refund_policy IS NULL OR validate_refund_policy(refund_policy));

-- ============================================================
-- §3.1.J pg_cron schedule for process-booking-deadlines
-- ============================================================
-- Vault-backed secret reads per ORCH-0869 [Tr3 Installment Payments] migration
-- 20260610000001_tr3_cron_use_vault_secrets.sql pattern. supabase_url +
-- service_role_key live in vault.decrypted_secrets.
SELECT cron.schedule(
  'orch-0875-process-booking-deadlines',
  '0 * * * *',  -- every hour at minute 0
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/process-booking-deadlines',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $cron$
);

-- ============================================================
-- §3.1.K Self-verification probe
-- ============================================================
DO $verify$
DECLARE
  v_count int;
BEGIN
  -- events new columns (4)
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'events'
    AND column_name IN ('refund_policy', 'booking_deadline', 'bookings_closed', 'bookings_closed_at');
  IF v_count != 4 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 4 new events columns, got %', v_count;
  END IF;

  -- orders new column (1); cancelled_at + cancelled_by + cancellation_reason
  -- already exist from ORCH-0787 [refund-order] (reused per DISC-IMPL-A-4).
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name = 'buyer_cancel_token_hash';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 1 new orders column (buyer_cancel_token_hash), got %', v_count;
  END IF;

  -- order_installments new columns (2)
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'order_installments'
    AND column_name IN ('cancelled_at', 'cancelled_by');
  IF v_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 2 new order_installments columns, got %', v_count;
  END IF;

  -- refund_line_items.installment_id
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'refund_line_items' AND column_name = 'installment_id';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: refund_line_items.installment_id missing';
  END IF;

  -- 5 new RPCs
  SELECT count(*) INTO v_count FROM pg_proc
  WHERE proname IN ('biz_compute_refund_for_cancel', 'biz_cancel_trip_booking_begin',
                    'biz_cancel_trip_booking_commit', 'biz_cancel_trip_booking_rollback',
                    'validate_refund_policy');
  IF v_count != 5 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 5 new RPCs, got %', v_count;
  END IF;

  -- 2 new triggers
  SELECT count(*) INTO v_count FROM pg_trigger
  WHERE tgname IN ('trg_refund_line_items_installment_parity', 'trg_refunds_amount_immutable');
  IF v_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 2 new triggers, got %', v_count;
  END IF;

  -- pg_cron entry
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'orch-0875-process-booking-deadlines';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: pg_cron schedule missing';
  END IF;

  -- CHECK constraints (2 new: events_refund_policy_valid + order_installments_cancelled_at_status_consistent)
  SELECT count(*) INTO v_count FROM pg_constraint
  WHERE conname IN ('events_refund_policy_valid', 'order_installments_cancelled_at_status_consistent');
  IF v_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 2 new CHECK constraints, got %', v_count;
  END IF;

  RAISE NOTICE 'ORCH-0875 migration complete: 8 net-new columns (4 events + 1 orders + 2 order_installments + 1 refund_line_items; reused 2 ORCH-0787 orders columns) + 5 RPCs + 2 triggers + 2 CHECK + 1 pg_cron + 4 indexes.';
END $verify$;

COMMIT;
