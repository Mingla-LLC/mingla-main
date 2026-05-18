# SPEC — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE.md`
**Milestone brief:** `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md` §6.2 Tr4 (lines 415-421)
**Operator-locked at INTAKE:** Buyer self-cancel + operator override; single ORCH end-to-end; trips only.
**Author confidence:** H — current-state grounded; ORCH-0869 [Tr3] + ORCH-0787 [refund-order] + ORCH-0843 [direct-charge] + ORCH-0844 [Connect Customer] already-shipped; 10 open Qs resolved with operator-readable trade-offs.

---

## 0. Layman summary

Build the first WeTravel-beat that "refunds don't suck" depends on: trip planners pick a refund policy from 3 templates (flexible / standard / strict) OR build custom cascading tiers, plus an absolute booking cutoff date. When a buyer cancels (from a token-protected URL in their confirmation email, OR the operator cancels from the trip dashboard), Mingla computes the correct refund based on cancel-time tier % × what's actually been paid (single-payment OR installment-paid via Tr3 ledger), executes the Stripe refund proportionally across the original PaymentIntents (one refund per PI, application fee refunded proportionally per ORCH-0843), marks any future scheduled installments cancelled (cron skips them), and dispatches a notification email via the existing ORCH-0788 dispatcher (reusing `buyer_refund_issued` + `buyer_order_cancelled` kinds with a `cancelledBy: 'buyer'|'operator'` payload discriminator). A new hourly cron auto-closes bookings at the cutoff; the checkout entry edge function hard-blocks bookings past the deadline as last-line-of-defense. Schema delta is small (4 new columns on `events`, 3 on `orders`, 2 on `order_installments`, 1 on `refund_line_items` — reuses existing `refunds` + `refund_line_items` from ORCH-0787 with installment provenance added). Edge functions: 2 NEW (`cancel-trip-booking`, `process-booking-deadlines`) + 3 modified (`ticket-checkout-create` bookings-closed check, `process-scheduled-installments` cancelled-at filter, `ticket-confirmation-dispatch` payload extension). Single ORCH end-to-end per INTAKE staging decision. 5 NEW DRAFT invariants, 21 SCs, boundary-condition test matrix per Tr4 risk register row 6, 9 cross-surface SCs split per route.

---

## 1. Scope

### 1.1 In scope

- **Migration `20260612000000_tr4_refund_tiers_booking_deadline.sql`** — see §3.1
- **NEW edge function `cancel-trip-booking`** — buyer-token-auth OR operator-JWT-auth; cascading-tier refund math; per-installment Stripe refund loop; installment-cancellation writes; notification dispatch
- **NEW edge function `process-booking-deadlines`** — hourly pg_cron; flips `events.bookings_closed=true` for trips past deadline
- **MODIFIED `ticket-checkout-create`** — bookings-closed check at entry (5-line surgical insert at lines 90-104)
- **MODIFIED `process-scheduled-installments`** — add `AND cancelled_at IS NULL` to both filters
- **MODIFIED `ticket-confirmation-dispatch`** — extend `buyer_refund_issued` + `buyer_order_cancelled` payload adapters with Tr4 fields
- **MODIFIED `_shared/email/buyerLifecycleAdapters.ts`** — extend `RefundIssuedPayloadShape` + `OrderCancelledPayloadShape` with `cancelledBy`, `tierApplied`, `refundAmountCents`, `installmentBreakdown`
- **NEW RPCs:** `biz_cancel_trip_booking(p_order_id, p_token_hash, p_actor, p_reason)`, `biz_compute_refund_for_cancel(p_order_id, p_cancel_at, p_actor)` (pure SQL function returning cascading math)
- **NEW services:** `cancelTripBookingService.ts`, `refundPolicyService.ts`, `bookingDeadlineService.ts`
- **NEW hooks:** `useCancelTripBooking`, `useUpdateRefundPolicy`, `useUpdateBookingDeadline`, `useRefundPreview`
- **NEW components:** `RefundPolicyEditor.tsx`, `BookingDeadlinePicker.tsx`, `RefundPreviewSheet.tsx`, `RefundPolicyDisplay.tsx`
- **MODIFIED `TripCreatorWizard.tsx`** — add refund-policy + booking-deadline UI (final IA decision at DESIGN phase per DISC-4)
- **MODIFIED `app/trip/[id]/index.tsx`** — replace ORCH-0873 Refund stub with real Refund action; add Cancel-booking action on traveler list rows
- **MODIFIED `app/t/[brandSlug]/[tripSlug].tsx`** — render `<RefundPolicyDisplay>` + booking-deadline countdown / closed banner
- **NEW route `mingla-business/app/booking/[orderId]/cancel.tsx`** — buyer-anon-web cancel flow (token in URL); refund preview; confirm + success
- **MODIFIED `mingla-business/app/checkout/[eventId]/index.tsx`** — handle 403 `bookings_closed` from `ticket-checkout-create` with "Bookings closed" banner
- **5 new DRAFT invariants** flipping ACTIVE on close
- **3 CI strict-grep gates** (2 invariants pinned via SQL CHECK / RLS instead)
- **Regression-test gate** per ORCH-0840: implementor happy-path + tester adversarial in same closing PR

### 1.2 Non-goals (defer)

- **Ve experiences refund tiers** — per ORCH-0825 §21 Q6; trips only. Future ORCH if demand surfaces.
- **Single-event (event_type='event') refund changes** — `refund-order/index.ts` UNCHANGED. Single-event refund flow keeps current ORCH-0787 behaviour.
- **Min-capacity gate** (auto-cancel-if-min-not-met) — per Q8 resolution; future ORCH after Tr4 ships.
- **Buyer self-update PM on dunning** — ORCH-0871 (Tr3 close follow-up); separate ORCH.
- **Late-booking auto-adjust** — ORCH-0870 (Tr3 close follow-up); separate ORCH.
- **Stripe Tax on installment refund line items** — ORCH-0804-A; same gap as existing PI path.
- **Admin web refund queue** — no admin equivalent; trip planners self-serve. Future admin-side trip-ops surface is a separate ORCH.
- **Realtime updates on Refund + Cancel actions** — polling via React Query + pull-to-refresh is sufficient for v1.
- **Multi-currency refund** — refund inherits `order_installments.currency` per I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH. No cross-currency mixing.
- **Partial refund on a single installment** — refund is all-or-nothing per installment in v1. Future ORCH if operators request.
- **Refund engine for cancelled-by-operator-fraud cases** — uses same tier engine; operator can override the computed refund amount but bears liability (audit row records override + actor). v1 ships with override capability + audit; UX for "this is fraud, do not refund" is a future polish.

### 1.3 Assumptions

- Tr3 [ORCH-0869 Installment Payments] migrations + edge functions are deployed (verified live 2026-05-18 per WORLD_MAP ORCH-0869 row).
- ORCH-0787 [refund-order] `refunds` + `refund_line_items` schema is deployed.
- ORCH-0843 [direct-charge] + ORCH-0844 [Connect Customer + ephemeralKey] are live (verified per Tr3 SPEC assumptions §1.3).
- ORCH-0788 [ticket-confirmation-dispatch] `buyer_refund_issued` + `buyer_order_cancelled` kinds are deployed.
- pg_cron v1.6.4 + pg_net v0.19.5 installed (verified live during Tr3 close 2026-05-18).
- `biz_is_brand_member_for_read_for_caller(uuid)` RLS helper is canonical (Tr3 SPEC §3.1 confirms).
- `biz_event_publish_v2` (or trip-specific publish RPC equivalent) is extensible — Tr4 amends to validate `refund_policy` JSONB schema at publish time.
- ORCH-0874 [Trip surfaces visual parity with Events] `TripCreatorWizard.tsx` Stepper + Close X + Keyboard.addListener chrome is stable.

---

## 2. Cross-Surface Impact (MANDATORY per `feedback_cross_surface_impact_inspection.md`)

| # | Surface | In scope | Files touched | Parity | User-visible behaviour |
|---|---|---|---|---|---|
| 1 | Consumer iOS | **NO** | `app-mobile/` untouched | n/a | No change — trips not on consumer app (C1 scope). |
| 2 | Consumer Android | **NO** | `app-mobile/` untouched | n/a | No change. |
| 3 | Buyer/anonymous Web | **YES** | NEW `mingla-business/app/booking/[orderId]/cancel.tsx`, MODIFIED `mingla-business/app/checkout/[eventId]/index.tsx`, MODIFIED `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | Manual per route — each route has its own SC | Buyer at `/booking/{orderId}/cancel?token=<...>` sees refund preview ("You'll receive $X back · cancelling now") with tier explanation, confirm CTA, success state. `/checkout/{eventId}` shows "Bookings closed · this trip stopped accepting new bookings on <date>" banner when 403 from edge fn. `/t/{brandSlug}/{tripSlug}` shows refund policy visual ladder + booking-deadline countdown ("Bookings close in 12 days") or "Bookings closed" banner. No `useAuth` on any anon route per `feedback_anon_buyer_routes.md`. |
| 4 | Business iOS | **YES** | NEW `RefundPolicyEditor.tsx`, `BookingDeadlinePicker.tsx`, `RefundPreviewSheet.tsx`, MODIFIED `TripCreatorStep4Pricing.tsx` (or new Step per DESIGN), MODIFIED `app/trip/[id]/index.tsx` (replace Refund stub + traveler list cancel actions) | Automatic (shared RN source) | Planner: wizard surfaces refund-policy + deadline UI (template chips + custom builder + datetime picker); trip dashboard Money tab has real Refund CTA + per-traveler Cancel action; refund preview sheet before confirmation; tier-applied receipt in audit/log surface. |
| 5 | Business Android | **YES** | Shared RN source with iOS | Automatic | Same as Business iOS. |
| 6 | Admin Web | **NO** | `mingla-admin/` untouched | n/a | No admin refund queue — trip planners self-serve. Future ORCH if needed. |
| 7 | Business Web preview | **YES** | Shared RN-Web bundle from Business iOS/Android | Automatic | Same as Business iOS/Android. |

### 2.1 Per-surface success criteria (manual parity = separate SCs)

Because the 3 buyer-anon-web surfaces are SEPARATE files (`booking/[orderId]/cancel.tsx`, `checkout/[eventId]/index.tsx`, `t/[brandSlug]/[tripSlug].tsx`), parity is MANUAL — each surface has its own success criterion. SC-06a/06b/06c handle the 3 buyer-anon routes; SC-20a/20b handle public page banner states.

---

## 3. Per-Layer Specification

### 3.1 Database layer

**Migration file:** `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql` (timestamp strictly greater than max prior `20260611000000` or whatever Tr3 leftover migrations are present; implementor verifies via `ls supabase/migrations/ | sort | tail -3` before naming).

```sql
-- ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] migration.
-- Per SPEC §3.1.
-- Extends events + orders + order_installments + refund_line_items.
-- New RPCs: biz_compute_refund_for_cancel, biz_cancel_trip_booking_begin,
--           biz_cancel_trip_booking_commit, biz_cancel_trip_booking_rollback.
-- New cron schedule: orch-0875-process-booking-deadlines (hourly).

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

CREATE INDEX idx_events_booking_deadline_open
  ON public.events(booking_deadline)
  WHERE event_type = 'trip' AND booking_deadline IS NOT NULL AND bookings_closed = false;

-- ============================================================
-- §3.1.B orders: cancel_reason, cancelled_by, buyer_cancel_token_hash
-- (Note: orders.cancelled_at ALREADY EXISTS via ORCH-0787)
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN cancel_reason text NULL,
  ADD COLUMN cancelled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN buyer_cancel_token_hash text NULL;

COMMENT ON COLUMN public.orders.cancel_reason IS
  'ORCH-0875 (Tr4): free-text reason captured at cancel time. NULL for buyer-self (no required reason); set for operator with prompt.';

COMMENT ON COLUMN public.orders.cancelled_by IS
  'ORCH-0875 (Tr4): auth.users.id of actor who cancelled. NULL when buyer-self-cancelled via anon token (no auth context). Set when operator-cancelled via JWT.';

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

-- Tighten the cron query: ensure status=cancelled rows are always also cancelled_at-stamped
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
  'ORCH-0875 (Tr4): when this refund row attributes to a specific Tr3 installment payment (vs a one-shot single-PI refund), references the source installment. NULL for single-payment refunds (ORCH-0787 behaviour preserved).';

CREATE INDEX idx_refund_line_items_installment_id
  ON public.refund_line_items(installment_id)
  WHERE installment_id IS NOT NULL;

-- Drop the prior UNIQUE that does not account for per-installment splits
ALTER TABLE public.refund_line_items
  DROP CONSTRAINT IF EXISTS refund_line_items_refund_id_order_line_item_id_key;
-- New composite UNIQUE permits per-installment splits within one refund
ALTER TABLE public.refund_line_items
  ADD CONSTRAINT refund_line_items_refund_line_installment_unique
  UNIQUE (refund_id, order_line_item_id, installment_id) NULLS NOT DISTINCT;

-- I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY enforcement trigger
CREATE OR REPLACE FUNCTION tg_refund_line_items_installment_parity()
RETURNS trigger AS $$
DECLARE
  v_installment_order_id uuid;
  v_refund_order_id uuid;
BEGIN
  IF NEW.installment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT order_id INTO v_installment_order_id FROM public.order_installments WHERE id = NEW.installment_id;
  SELECT order_id INTO v_refund_order_id FROM public.refunds WHERE id = NEW.refund_id;
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

-- I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL enforcement
-- (amount_cents immutable post-insert via RLS-equivalent check)
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
-- (write path). Pins refund amount at compute time so preview === confirm.
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

  -- Determine trip start (Tr2 sidecar event_dates.start_at MIN aggregate;
  -- implementor verifies the actual source-of-truth column at trip-publish time).
  SELECT min(start_at) INTO v_event_start
  FROM public.event_dates
  WHERE event_id = v_event.id;
  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_trip_start_date');
  END IF;

  -- Days remaining (floor to whole days; negative when after trip start)
  v_days_remaining := FLOOR(EXTRACT(EPOCH FROM (v_event_start - p_cancel_at)) / 86400)::int;

  -- Resolve refund policy. Trip-level overrides absent → tier_pct = 0 (no refund).
  v_policy := COALESCE(v_event.refund_policy, '{}'::jsonb);
  v_tiers := COALESCE(v_policy->'tiers', '[]'::jsonb);
  v_tier_pct := 0;
  -- Iterate tiers descending by days_before_start; first match wins
  SELECT (t->>'refund_pct')::int INTO v_tier_pct
  FROM jsonb_array_elements(v_tiers) WITH ORDINALITY AS t(tier, ord)
  WHERE (t.tier->>'days_before_start')::int <= v_days_remaining
  ORDER BY (t.tier->>'days_before_start')::int DESC
  LIMIT 1;
  v_tier_pct := COALESCE(v_tier_pct, 0);

  -- Paid total = sum of collected installment amounts + deposit (orders.total_cents
  -- minus installment scheduled but not yet collected, OR just sum of collected
  -- installments + the deposit row in orders for installment_plan_root orders).
  IF v_order.installment_plan_root THEN
    -- deposit (orders.total_cents represents the deposit charge in installment plan)
    -- + sum of collected installments
    SELECT v_order.total_cents +
           COALESCE(sum(amount_cents), 0)
    INTO v_paid_total_cents
    FROM public.order_installments
    WHERE order_id = v_order.id AND status = 'collected';

    -- Build per-installment refund attribution
    -- Pattern: pro-rata refund of each collected installment AND the deposit.
    -- Each gets refunded by v_tier_pct of its amount.
    -- The deposit refund attributes to refund_line_items with installment_id=NULL.
    FOR v_installment IN
      SELECT id, amount_cents, currency, stripe_payment_intent_id
      FROM public.order_installments
      WHERE order_id = v_order.id AND status = 'collected'
      ORDER BY ordinal ASC
    LOOP
      v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
        'installment_id', v_installment.id,
        'source_pi', v_installment.stripe_payment_intent_id,
        'paid_cents', v_installment.amount_cents,
        'refund_cents', FLOOR(v_installment.amount_cents * v_tier_pct / 100.0)::bigint,
        'currency', v_installment.currency
      );
    END LOOP;

    -- Also list the deposit row (orders-level) for refund attribution
    v_per_installment_refund := v_per_installment_refund || jsonb_build_object(
      'installment_id', NULL,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_order.total_cents * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency,
      'note', 'deposit'
    );
  ELSE
    -- Single-payment order: total_cents = paid
    v_paid_total_cents := v_order.total_cents;
    v_per_installment_refund := jsonb_build_array(jsonb_build_object(
      'installment_id', NULL,
      'source_pi', v_order.stripe_payment_intent_id,
      'paid_cents', v_order.total_cents,
      'refund_cents', FLOOR(v_order.total_cents * v_tier_pct / 100.0)::bigint,
      'currency', v_order.currency
    ));
  END IF;

  -- Sum refund_cents across attributions for total (handles rounding)
  SELECT COALESCE(sum((r->>'refund_cents')::bigint), 0) INTO v_refund_total_cents
  FROM jsonb_array_elements(v_per_installment_refund) AS r;

  -- Scheduled installments to cancel (for write path)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('installment_id', id, 'ordinal', ordinal, 'due_at', due_at)
           ORDER BY ordinal), '[]'::jsonb)
  INTO v_installments
  FROM public.order_installments
  WHERE order_id = v_order.id AND status IN ('scheduled', 'failed') AND cancelled_at IS NULL;

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
-- Two-step pattern mirrors biz_refund_order + biz_refund_order_commit:
-- begin → inserts pending refunds row + flips orders.cancelled_at +
-- writes installment cancellations + returns refund_id + per-payment attribution.
-- Edge function then calls stripe.refunds.create per PI, then calls _commit.

CREATE OR REPLACE FUNCTION biz_cancel_trip_booking_begin(
  p_order_id uuid,
  p_actor_kind text,  -- 'buyer' | 'operator'
  p_actor_user_id uuid,  -- nullable for buyer-self
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
  v_per_payment jsonb;
BEGIN
  -- Compute refund (deterministic SQL function pins amount at cancel_at)
  v_compute := biz_compute_refund_for_cancel(p_order_id, p_cancel_at);
  IF NOT (v_compute->>'ok')::boolean THEN
    RETURN v_compute;
  END IF;

  -- Insert pending refund (ORCH-0787 schema; amount immutable post-insert per trigger)
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

  -- Flip orders.cancelled_at + cancel_reason + cancelled_by + clear at_risk
  UPDATE public.orders
    SET cancelled_at = p_cancel_at,
        cancel_reason = p_reason,
        cancelled_by = p_actor_user_id,
        at_risk = false,
        at_risk_since = NULL
   WHERE id = p_order_id;

  -- Cancel scheduled/failed installments (cron will skip per AND cancelled_at IS NULL)
  UPDATE public.order_installments
    SET status = 'cancelled',
        cancelled_at = p_cancel_at,
        cancelled_by = p_actor_user_id
   WHERE order_id = p_order_id
     AND status IN ('scheduled', 'failed')
     AND cancelled_at IS NULL;

  -- Insert refund_line_items per (line_item × installment) intersection
  -- Implementor: loop over v_compute->'per_payment_refund' AND match to order_line_items.
  -- For v1, single-tier-per-order means one (line_item × installment) row per payment.
  -- Full implementation per SPEC §3.2.1 in the edge function (does the loop).

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_refund_id,
    'per_payment_refund', v_compute->'per_payment_refund',
    'refund_total_cents', v_compute->'refund_total_cents',
    'currency', v_compute->'currency',
    'tier_pct', v_compute->'tier_pct'
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
BEGIN
  UPDATE public.refunds
    SET status = 'succeeded',
        stripe_refund_id = p_stripe_refund_ids[1],  -- primary refund id; full list in metadata
        application_fee_refunded_cents = p_application_fee_refunded_cents,
        processed_at = p_processed_at
   WHERE id = p_refund_id AND status = 'pending';
  IF NOT FOUND THEN
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
CREATE OR REPLACE FUNCTION biz_cancel_trip_booking_rollback(
  p_refund_id uuid,
  p_failure_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.refunds
    SET status = 'failed',
        reason = LEFT(COALESCE(reason, '') || ' | rollback: ' || LEFT(COALESCE(p_failure_reason, 'unknown'), 100), 200),
        processed_at = now()
   WHERE id = p_refund_id AND status = 'pending';
  -- Revert orders + order_installments since the refund didn't actually happen
  -- (implementor: this is a recoverable rollback — caller retries the whole flow).
  -- For v1: leave orders.cancelled_at SET but log the refund failure; operator must
  -- manually retry via the dashboard. Future ORCH: automated retry.
  RETURN jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'status', 'failed');
END;
$$;

REVOKE ALL ON FUNCTION biz_cancel_trip_booking_rollback(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biz_cancel_trip_booking_rollback(uuid, text) TO service_role;

-- ============================================================
-- §3.1.I refund_policy publish-time validation
-- ============================================================
-- Helper used by trip publish RPC + RLS UPDATE on events.refund_policy:
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
    RETURN true;  -- NULL is "no policy" (no refund at any time)
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
    RAISE EXCEPTION 'refund_policy.tiers max 8 tiers';
  END IF;
  -- Iterate tiers in input order; expect DESC by days_before_start; assert monotonicity
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

-- Enforce at write-time (defense-in-depth alongside publish-RPC validation)
ALTER TABLE public.events
  ADD CONSTRAINT events_refund_policy_valid
  CHECK (refund_policy IS NULL OR validate_refund_policy(refund_policy));

-- ============================================================
-- §3.1.J pg_cron schedule for process-booking-deadlines
-- ============================================================
SELECT cron.schedule(
  'orch-0875-process-booking-deadlines',
  '0 * * * *',  -- every hour at minute 0
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-booking-deadlines',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- ============================================================
-- §3.1.K Self-verification probe
-- ============================================================
DO $$
DECLARE
  v_count int;
BEGIN
  -- events new columns
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'events'
    AND column_name IN ('refund_policy', 'booking_deadline', 'bookings_closed', 'bookings_closed_at');
  IF v_count != 4 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 4 new events columns, got %', v_count;
  END IF;

  -- orders new columns
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name IN ('cancel_reason', 'cancelled_by', 'buyer_cancel_token_hash');
  IF v_count != 3 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 3 new orders columns, got %', v_count;
  END IF;

  -- order_installments new columns
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'order_installments'
    AND column_name IN ('cancelled_at', 'cancelled_by');
  IF v_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 2 new order_installments columns, got %', v_count;
  END IF;

  -- refund_line_items installment_id
  SELECT count(*) INTO v_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'refund_line_items' AND column_name = 'installment_id';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: refund_line_items.installment_id missing';
  END IF;

  -- 4 new RPCs
  SELECT count(*) INTO v_count FROM pg_proc
  WHERE proname IN ('biz_compute_refund_for_cancel', 'biz_cancel_trip_booking_begin',
                    'biz_cancel_trip_booking_commit', 'biz_cancel_trip_booking_rollback',
                    'validate_refund_policy');
  IF v_count != 5 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: expected 5 new RPCs, got %', v_count;
  END IF;

  -- pg_cron entry
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'orch-0875-process-booking-deadlines';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0875 migration: pg_cron schedule missing';
  END IF;

  RAISE NOTICE 'ORCH-0875 migration complete: 10 columns + 5 RPCs + 2 triggers + 1 pg_cron + 1 CHECK + 4 indexes.';
END $$;

COMMIT;
```

**Refund policy JSONB shape (TS type for client + server validation):**

```ts
type RefundPolicy = {
  kind: 'flexible' | 'standard' | 'strict' | 'custom';
  tiers: Array<{
    days_before_start: number;  // int >= 0
    refund_pct: number;          // int 0-100
  }>;
  // Tiers sorted DESC by days_before_start; refund_pct MUST be non-increasing.
};

// Locked defaults per Q1 resolution (operator can override at any time):
const FLEXIBLE_POLICY: RefundPolicy = {
  kind: 'flexible',
  tiers: [
    { days_before_start: 30, refund_pct: 100 },
    { days_before_start: 14, refund_pct: 50 },
    { days_before_start: 0,  refund_pct: 0  },
  ],
};

const STANDARD_POLICY: RefundPolicy = {
  kind: 'standard',
  tiers: [
    { days_before_start: 60, refund_pct: 100 },
    { days_before_start: 30, refund_pct: 50 },
    { days_before_start: 0,  refund_pct: 0  },
  ],
};

const STRICT_POLICY: RefundPolicy = {
  kind: 'strict',
  tiers: [
    { days_before_start: 90, refund_pct: 100 },
    { days_before_start: 0,  refund_pct: 0  },
  ],
};
```

### 3.2 Edge function layer

#### 3.2.1 NEW: `supabase/functions/cancel-trip-booking/index.ts`

**Trigger:** HTTP POST. Two auth modes.

**Request shape:**
```ts
type CancelTripBookingRequest =
  | { mode: 'buyer'; orderId: string; token: string; reason?: string }
  | { mode: 'operator'; orderId: string; reason: string; refundAmountOverride?: number };
```

**Response shape:**
```ts
type CancelTripBookingResponse =
  | { ok: true; refundId: string; refundAmountCents: number; currency: string; tierApplied: string;
      perPaymentRefund: Array<{ source_pi: string; refund_cents: number; installment_id: string | null; stripe_refund_id: string }>;
      installmentsCancelled: number }
  | { ok: false; error: string; detail: string; status: number };
```

**Logic:**

1. **Auth:**
   - `mode='buyer'`: Look up `orders WHERE id=orderId`; SHA256 the supplied `token` and compare to `orders.buyer_cancel_token_hash`. If mismatch → 401. If `orders.cancelled_at` already set → 409 `already_cancelled`. Set `actor.kind='buyer', actor.user_id=NULL`.
   - `mode='operator'`: Validate JWT via `userIdFromAuthHeader()`. Look up `orders→events→brands` chain. Call `biz_is_brand_member_for_read_for_caller(brand_id)`. If false → 403. Require `reason` ≥ 10 chars. Set `actor.kind='operator', actor.user_id=jwt.sub`.

2. **Compute refund preview** (read-only via `biz_compute_refund_for_cancel`). Pin `p_cancel_at = now()`. Return early as 200 with `{ok:true, mode:'preview'}` if request carries `?preview=true` query param (used by buyer UI to show "you'll get $X back" before confirming).

3. **Begin** — call `biz_cancel_trip_booking_begin(orderId, actor.kind, actor.user_id, reason, cancelAt)`. Returns `refund_id`, `per_payment_refund` array, `refund_total_cents`, `tier_pct`.

4. **Per-PI refund loop** — for each entry in `per_payment_refund` where `refund_cents > 0`:
   - Look up connected `stripeAccount` via orders→events→brands (same pattern as `refund-order` lines 212-265).
   - Call `stripe.refunds.create({payment_intent: entry.source_pi, amount: entry.refund_cents, reason:'requested_by_customer', refund_application_fee: true, metadata: {mingla_refund_id, mingla_installment_id, mingla_order_id}}, {idempotencyKey: \`tr4_cancel:${refund_id}:${entry.installment_id ?? 'deposit'}\`, stripeAccount: connectedAccountId})`.
   - Insert `refund_line_items` row attributing to (line_item, installment) — installment_id from entry, line_item from order's primary line item.
   - Collect refunded application fee from response.

5. **On any per-PI failure:** call `biz_cancel_trip_booking_rollback(refund_id, failure_reason)`. Return 500 with `{ok:false, error:'stripe_refund_failed', detail:'<message>', refund_id, partial: <count of refunds that succeeded before failure>}`. Operator can retry from dashboard.

6. **On all PI success:** call `biz_cancel_trip_booking_commit(refund_id, [stripeRefundIds], totalApplicationFeeRefunded)`.

7. **Notification dispatch:** insert `ticket_order_notifications` row with kind=`buyer_order_cancelled` AND a second row with kind=`buyer_refund_issued` (so buyer gets both: "your trip is cancelled" + "refund of $X is on its way"). Payload includes `{cancelledBy: actor.kind, tierApplied, refundAmountCents, installmentBreakdown, trip:{name, dates}}`.

8. Return success with full `perPaymentRefund` array including stripe refund IDs.

**Error handling:** wrap each PI refund in try/catch — partial failures roll back via `biz_cancel_trip_booking_rollback`. Service-level errors (Supabase unreachable) return 500.

**Idempotency:** per-refund per-PI idempotency-key. Cron + manual retries safe.

#### 3.2.2 NEW: `supabase/functions/process-booking-deadlines/index.ts`

**Trigger:** pg_cron hourly (per migration §3.1.J). Service-role auth required.

**Request shape:** `{}` or `{dryRun?: boolean}`.

**Response shape:** `{closed: number, errors: Array<{event_id: string, reason: string}>}`.

**Logic:**

1. Authenticate via service-role header.
2. `UPDATE public.events SET bookings_closed=true, bookings_closed_at=now() WHERE event_type='trip' AND booking_deadline IS NOT NULL AND booking_deadline <= now() AND bookings_closed=false RETURNING id, brand_id`.
3. For each affected event: insert `ticket_order_notifications` row kind=`operator_bookings_auto_closed` (or REUSE existing operator-notification kind if one exists — implementor verifies). Notification informs the brand that bookings auto-closed.
4. Return summary.

**Idempotency:** WHERE filter on `bookings_closed=false` ensures double-runs no-op.

#### 3.2.3 MODIFIED: `supabase/functions/ticket-checkout-create/index.ts`

**Surgical 5-line insert at lines 90-104** (right after event_dates.end_at check):

```ts
// ORCH-0875 (Tr4): hard-block bookings past deadline OR explicitly closed.
// I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT — last line of defense.
if (event.event_type === 'trip' && (event.bookings_closed === true ||
    (event.booking_deadline && new Date(event.booking_deadline) <= new Date()))) {
  return new Response(
    JSON.stringify({
      error: 'bookings_closed',
      detail: 'Bookings closed',
      deadline: event.booking_deadline ?? null,
    }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  );
}
```

**Note for implementor:** the existing event-fetch query (around line 67-89) must include `bookings_closed`, `booking_deadline`, `event_type` columns in the `.select(...)`. Verify by reading current select string.

#### 3.2.4 MODIFIED: `supabase/functions/process-scheduled-installments/index.ts`

**Two SQL filter changes:**

1. Scheduled-installments query (current: `WHERE status='scheduled' AND due_at <= now()`):
   ```sql
   WHERE status='scheduled' AND due_at <= now() AND cancelled_at IS NULL
   ```

2. Failed-retry query (current: `WHERE status='failed' AND next_retry_at <= now()`):
   ```sql
   WHERE status='failed' AND next_retry_at <= now() AND cancelled_at IS NULL
   ```

**Defense-in-depth:** the new CHECK constraint `order_installments_cancelled_at_status_consistent` ensures `cancelled_at IS NOT NULL ⟺ status='cancelled'`, so a row that has `cancelled_at` set will also have `status='cancelled'` and the existing `status='scheduled'` filter excludes it. The explicit `AND cancelled_at IS NULL` is a belt-and-braces second check.

#### 3.2.5 MODIFIED: `supabase/functions/ticket-confirmation-dispatch/index.ts` + `_shared/email/buyerLifecycleAdapters.ts`

**Extend existing `RefundIssuedPayloadShape` and `OrderCancelledPayloadShape`:**

```ts
export type RefundIssuedPayloadShape = {
  // existing fields...
  // NEW for Tr4:
  cancelledBy?: 'buyer' | 'operator';
  tierApplied?: 'flexible' | 'standard' | 'strict' | 'custom';
  tierPct?: number;  // 0-100
  installmentBreakdown?: Array<{
    ordinal: number | null;  // null for deposit
    paid_cents: number;
    refund_cents: number;
    currency: string;
  }>;
};

export type OrderCancelledPayloadShape = {
  // existing fields...
  // NEW for Tr4:
  cancelledBy?: 'buyer' | 'operator';
  tripName?: string;
  tripStartDate?: string;  // ISO
  refundIssued?: boolean;  // false when 0% tier applied
};
```

Email body templates differentiate via `cancelledBy`:
- `cancelledBy='buyer'`: "You cancelled your reservation for {tripName}. Refund of {amount} sent to your card ending in •••• {last4}."
- `cancelledBy='operator'`: "The organiser cancelled your reservation for {tripName}. Refund of {amount} is on its way."

### 3.3 Service layer

#### 3.3.1 NEW: `mingla-business/src/services/cancelTripBookingService.ts`

```ts
export type RefundPreview = {
  refundTotalCents: number;
  currency: string;
  tierPct: number;
  tierKind: 'flexible' | 'standard' | 'strict' | 'custom' | 'none';
  paidTotalCents: number;
  daysRemaining: number;
  perPaymentRefund: Array<{
    installmentId: string | null;
    sourcePi: string | null;
    paidCents: number;
    refundCents: number;
    currency: string;
    note?: string;
  }>;
  installmentsToCancel: number;
};

// Buyer-mode preview (anon, requires token)
export async function previewBuyerCancel(orderId: string, token: string): Promise<RefundPreview> { ... }

// Operator-mode preview (JWT)
export async function previewOperatorCancel(orderId: string): Promise<RefundPreview> { ... }

// Buyer-mode commit (anon)
export async function commitBuyerCancel(orderId: string, token: string, reason?: string): Promise<CancelResult> { ... }

// Operator-mode commit (JWT)
export async function commitOperatorCancel(orderId: string, reason: string): Promise<CancelResult> { ... }
```

Service throws on transport errors; returns typed result on biz-logic outcomes per Mingla services contract.

#### 3.3.2 NEW: `mingla-business/src/services/refundPolicyService.ts`

```ts
export async function updateRefundPolicy(eventId: string, policy: RefundPolicy | null): Promise<void> { ... }
export async function updateBookingDeadline(eventId: string, deadline: Date | null): Promise<void> { ... }
```

Both are operator-only (JWT-gated). RLS: brand-member can update their own events.

### 3.4 Hook layer

```ts
// mingla-business/src/hooks/useRefundPreview.ts
export function useBuyerRefundPreview(orderId: string | null, token: string | null) { ... }
export function useOperatorRefundPreview(orderId: string | null) { ... }

// mingla-business/src/hooks/useCancelTripBooking.ts
export function useCancelTripBookingBuyer() { ... }  // mutation
export function useCancelTripBookingOperator() { ... }  // mutation

// mingla-business/src/hooks/useRefundPolicy.ts
export function useUpdateRefundPolicy() { ... }  // mutation
export function useUpdateBookingDeadline() { ... }  // mutation
```

Query keys via existing factory pattern. Mutations invalidate `orderKeys`, `eventKeys`, `installmentKeys`. `onError` on every mutation surfaces a toast.

### 3.5 Component layer

#### 3.5.1 NEW: `mingla-business/src/components/trip/RefundPolicyEditor.tsx`

**Props:** `{ value: RefundPolicy | null; onChange: (next: RefundPolicy | null) => void }`

**States:**
- Empty (no policy): "No refund policy yet — pick a template or build custom"
- Template chips: 3 chips for flexible / standard / strict; tap to apply preset
- Custom builder: tier rows with `days_before_start` input + `refund_pct` input + "+ Add tier" button; live validation (monotonicity error inline)
- Error: inline error text per tier row when monotonicity violated

**Interactions:** template tap = apply preset (overwrites). Custom edits = `kind='custom'`. Trash icon per tier. "+ Add tier" up to 8 max.

**Validation copy:**
- "Each refund % must be the same or lower than the tier above (you have 50% then 80%)."
- "Tiers must count down: 30 days, then 14 days, then 0 days."
- "Maximum 8 tiers."

**Accessibility:** all inputs have `accessibilityLabel`; tier rows announce "Tier N: X% refund if cancelled Y days before start".

#### 3.5.2 NEW: `mingla-business/src/components/trip/BookingDeadlinePicker.tsx`

**Props:** `{ value: Date | null; tripStart: Date | null; onChange: (next: Date | null) => void }`

**States:**
- Empty: toggle "Set a booking deadline" off (no auto-close)
- Populated: datetime picker (native iOS/Android sheet); enforced `value < tripStart` and `value > now()` with inline error
- Display: human format ("Closes Saturday, Jan 15 at 11:59 PM in your brand's time zone")

**Validation copy:**
- "Deadline must be before trip starts."
- "Deadline must be in the future."

#### 3.5.3 NEW: `mingla-business/src/components/trip/RefundPreviewSheet.tsx`

**Props:** `{ visible: boolean; orderId: string; mode: 'buyer'|'operator'; token?: string; onConfirm: (reason?: string) => Promise<void>; onClose: () => void }`

**Rendered inside Sheet primitive.** Reuses Tr2 design language (GlassCard, ActionTile pattern).

**Content:**
- Header: "Cancel your reservation?" (buyer) or "Cancel this booking?" (operator)
- Body:
  - Trip name + start date (small)
  - Hero: large refund amount + "You'll receive {refundTotal} back" (buyer) or "Refund {refundTotal} to the buyer" (operator)
  - Breakdown: per-payment list (deposit + each collected installment) with paid + refund amounts
  - Future installments cancelled: "{installmentsToCancel} future installments will be cancelled"
  - Tier explanation: "{tierPct}% refund applies because cancelling {daysRemaining} days before the trip ({tierKind} policy)"
  - When `tierPct=0`: red banner "No refund applies — your cancellation policy is past the refund window"
- Operator-only: reason text input (10-200 chars)
- CTAs: Cancel CTA (destructive variant) + Keep Reservation (secondary)
- Loading state on confirm; toast on error; success state with "Refund processed" message + close

#### 3.5.4 NEW: `mingla-business/src/components/trip/RefundPolicyDisplay.tsx`

Read-only visual ladder for public trip page + buyer cancel preview:

```
Cancellation policy
├ Cancel 60+ days before start: 100% refund
├ Cancel 30-59 days before start: 50% refund
└ Cancel within 30 days: No refund
```

Time-sorted (longest-notice first); refund-% prominent; "No refund" rendered in muted style.

#### 3.5.5 MODIFIED: `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (provisional — DESIGN-phase resolves IA)

Render `<RefundPolicyEditor>` + `<BookingDeadlinePicker>` below the existing PaymentPlanEditor section. ALTERNATIVE if `/ui-ux-pro-max` recommends a new Step 5: extract to new step component `TripCreatorStep5Policy.tsx` and bump Stepper to 6 total steps. SPEC defers final IA to DESIGN phase per DISC-4.

#### 3.5.6 MODIFIED: `mingla-business/app/trip/[id]/index.tsx`

Replace ORCH-0873 Refund stub with real Refund CTA:
- Money tab "Refund · coming in Tr4" stub → "Cancel booking" CTA (per traveler row) + "Refund options" CTA (per traveler-row-on-cancelled-booking)
- Tap "Cancel booking" → opens `<RefundPreviewSheet mode='operator'>`
- Tap "Refund options" on already-cancelled booking → opens read-only `<RefundDetailsSheet>` showing the refund execution (placeholder for v1; if no edits needed, skip the second sheet)

Per-traveler list row gains:
- "Cancel & refund" action (replaces the prior coming-in-Tr4 chip)
- "At risk" badge unchanged from Tr3

#### 3.5.7 NEW: `mingla-business/app/booking/[orderId]/cancel.tsx`

**Buyer-anon-web cancel route.** MUST NOT call `useAuth`. Token from URL query param.

**Flow:**
1. Mount → fetch preview via `useBuyerRefundPreview(orderId, token)`.
2. Loading: skeleton card.
3. Token invalid (401) → "This cancel link isn't valid or has been used. Contact the organiser."
4. Already cancelled (409) → "Your reservation is already cancelled. Refund {amount} sent {date}."
5. Preview loaded → render `<RefundPreviewSheet visible mode='buyer' onConfirm={confirmAndClose}>`.
6. Confirm tapped → commit mutation; success state with "Cancelled · refund of {amount} sent" + link back to public trip page.
7. Error on confirm → toast + retry button.

**SafeArea:** mandatory per I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES. Include allowlist comment.

#### 3.5.8 MODIFIED: `mingla-business/app/checkout/[eventId]/index.tsx`

Handle 403 `bookings_closed` from `ticket-checkout-create`: render "Bookings closed · this trip stopped accepting bookings on {date}. Reach out to the organiser if you have questions." Replace primary CTA with disabled state.

#### 3.5.9 MODIFIED: `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`

Render `<RefundPolicyDisplay policy={trip.refundPolicy}>` near the pricing/dates block. Render booking-deadline state:
- `bookings_closed=true`: red banner "Bookings closed".
- `booking_deadline` set + future: "Bookings close in {humanCountdown}" pill (refreshes on focus).
- No deadline + open: no banner.

### 3.6 Realtime

Not in scope for Tr4 v1. React Query polling + pull-to-refresh on Money tab. Realtime subscription on `orders.cancelled_at` + `events.bookings_closed` is deferred.

---

## 4. Success Criteria

| # | Criterion | Test |
|---|---|---|
| SC-01 | Trip wizard Pricing step (or new Step 5 per DESIGN) shows refund-policy template chips + custom builder. Tapping a template applies preset. | T-01 |
| SC-02 | Custom refund builder enforces monotonicity (refund_pct non-increasing) + descending days_before_start; live inline error on violation. | T-02 |
| SC-03 | Publishing a trip with valid refund_policy persists JSONB to `events.refund_policy`. Publish RPC rejects malformed policy via `validate_refund_policy()`. | T-03 |
| SC-04 | Booking-deadline picker enforces `value < tripStart` AND `value > now()`. | T-04 |
| SC-05 | Publishing a trip with `booking_deadline` persists to `events.booking_deadline`. | T-05 |
| SC-06a | Buyer at `/booking/{orderId}/cancel?token=<valid>` loads refund preview ("You'll receive $X back") + Cancel CTA + reason copy. | T-06 |
| SC-06b | Buyer at `/booking/{orderId}/cancel?token=<invalid>` sees "This cancel link isn't valid" + no preview, no CTA. | T-07 |
| SC-06c | Buyer at `/booking/{orderId}/cancel?token=<valid>` on already-cancelled order sees "Your reservation is already cancelled" + no CTA. | T-08 |
| SC-07 | Buyer confirms cancel → `cancel-trip-booking` returns success → success state shows "Cancelled · refund of $X sent" → email arrives via Resend (kind=`buyer_order_cancelled` + `buyer_refund_issued`). | T-09 |
| SC-08 | Single-payment refund math: $1000 trip + standard policy + cancel 80 days before → 100% tier → $1000 refund. | T-10 |
| SC-09 | Single-payment refund math: $1000 trip + standard policy + cancel 45 days before → 50% tier → $500 refund. | T-11 |
| SC-10 | Single-payment refund math: $1000 trip + standard policy + cancel 10 days before → 0% tier → $0 refund (no Stripe call). | T-12 |
| SC-11 | Installment refund: 3-installment $300+$300+$300 plan with 2 paid + standard policy + cancel 80 days before → 100% tier → $300 + $300 = $600 refund (refund both paid installments) + cancel scheduled installment 3 (no charge). | T-13 |
| SC-12 | Installment refund: same plan with 2 paid + cancel 45 days before → 50% tier → $150 + $150 = $300 refund + cancel installment 3. | T-14 |
| SC-13 | Installment refund: same plan with 2 paid + cancel 10 days before → 0% tier → $0 refund + cancel installment 3 (still cancelled even with $0 refund). | T-15 |
| SC-14 | Cron `process-booking-deadlines` runs hourly. Trip with `booking_deadline=now()-1h` → `bookings_closed=true` AND `bookings_closed_at` populated within 1h of deadline. | T-16 |
| SC-15 | `ticket-checkout-create` returns 403 with `{error:'bookings_closed', detail:'Bookings closed', deadline:<ISO>}` when `events.bookings_closed=true` OR `events.booking_deadline < now()`. | T-17 |
| SC-16 | Operator dashboard "Cancel booking" CTA on traveler row → opens RefundPreviewSheet → confirm → same `cancel-trip-booking` flow with `mode='operator'` + JWT. | T-18 |
| SC-17 | Cancelling an at-risk booking clears `orders.at_risk=false` + `orders.at_risk_since=NULL`. | T-19 |
| SC-18 | After Tr4 cancel, cron `process-scheduled-installments` does NOT charge cancelled installments (filter `AND cancelled_at IS NULL` works). | T-20 |
| SC-19 | Public trip page `/t/{brandSlug}/{tripSlug}` renders `<RefundPolicyDisplay>` as visual ladder. | T-21 |
| SC-20a | Public trip page with `bookings_closed=true` shows "Bookings closed" banner. | T-22 |
| SC-20b | Public trip page with `booking_deadline` open shows "Bookings close in {countdown}" pill. | T-23 |
| SC-21 | RLS: buyer-cancel via correct token authorized; wrong token 401; operator-cancel via JWT on own brand authorized; cross-brand operator-cancel forbidden. | T-24 |
| SC-22 | **Refund-preview freshness contract (DESIGN-AMENDMENT 2026-05-18 per DESIGN-ORCH-0875 DISC-D-2 + OQ-D-1).** (a) Buyer cancel route renders a "Quoted at {timestamp} · confirm within 15 minutes for this amount" caption directly under the hero refund number on preview load. (b) `cancel-trip-booking` edge function (operator + buyer modes) MUST re-compute `biz_compute_refund_for_cancel` at `_begin` step and if computed `refund_total_cents` diverges from the preview's `refund_total_cents` by > 0 cents (the preview client passes the previewed amount in the begin request body as `expectedRefundTotalCents`), return HTTP 409 with `{error: "policy_updated", detail: "Cancellation policy was updated — refresh to see your new refund amount", currentRefundTotalCents: <new>}`. Buyer UI on 409 → re-fetch preview, re-render hero, allow re-confirm. Operator UI on 409 → re-render RefundPreviewSheet contents, surface "Policy changed" banner. | T-25 |

---

## 5. Invariants

### 5.1 Preserved

All Tr1-Tr3 invariants + I-38 + I-39 + anon-buyer-routes + RLS-RETURNING-OWNER-GAP — see investigation §6.1.

### 5.2 New (DRAFT → ACTIVE on close)

#### I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY

**Rule.** `events.refund_policy.tiers` must be sorted DESC by `days_before_start` AND `refund_pct` must be non-increasing across tiers.

**Why.** A non-monotonic policy ("50% if cancel 30 days before, 80% if cancel 14 days before") is semantically incoherent — buyer is incentivised to cancel later. Catching at write-time prevents operator misconfiguration.

**Enforcement.** SQL `CHECK (validate_refund_policy(refund_policy))` constraint on `events` table (migration §3.1.I) AND `validate_refund_policy()` IMMUTABLE function rejects at publish-RPC time AND client-side `RefundPolicyEditor` shows inline error on monotonicity violation.

#### I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT

**Rule.** `ticket-checkout-create` MUST return HTTP 403 with `{error:'bookings_closed'}` when `events.bookings_closed=true` OR (`events.booking_deadline IS NOT NULL AND events.booking_deadline < now()`).

**Why.** UI close banner + cron auto-close are defense-in-depth, not enforcement. A buyer with the URL but no UI client (or a stale UI cache) could book past the deadline. Edge function check is the LAST line of defense.

**Enforcement.** Surgical check in `ticket-checkout-create/index.ts` per §3.2.3 + tester adversarial test (`POST` to edge fn with `bookings_closed=true` → expect 403) + strict-grep gate `.github/scripts/strict-grep/i-proposed-tr4-booking-deadline-respected-at-checkout.mjs` scans the edge fn file for the conditional block.

#### I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY

**Rule.** Every `refund_line_items` row with `installment_id IS NOT NULL` MUST reference an `order_installments` row whose `order_id` matches the parent `refunds.order_id`.

**Why.** Cross-order installment attribution would break audit. Prevents bugs where a refund for Order A accidentally attributes to an installment of Order B.

**Enforcement.** SQL trigger `tg_refund_line_items_installment_parity` (migration §3.1.D) raises EXCEPTION on mismatch + tester adversarial test attempts forged insert and expects rejection.

#### I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL

**Rule.** `refunds.amount_cents` is computed at cancel-time (via `biz_compute_refund_for_cancel`) and immutable post-insert. No code path may UPDATE `refunds.amount_cents`.

**Why.** Race condition prevention. Between `biz_cancel_trip_booking_begin` and `_commit`, the cron could theoretically charge a scheduled installment if cancellation didn't propagate fast enough. Pinning the amount at begin-time means even if cron sneaks in a charge, the refund executes for the originally-computed amount (any over-charge from cron becomes a separate operator-handled refund — not a Tr4 silent compute drift).

**Enforcement.** SQL trigger `tg_refunds_amount_immutable` raises EXCEPTION on UPDATE of `amount_cents` + tester adversarial test attempts forged UPDATE and expects rejection.

#### I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED

**Rule.** `process-scheduled-installments` cron query MUST filter `WHERE status='scheduled' AND cancelled_at IS NULL` (and same for the failed-retry branch).

**Why.** A cancelled installment must NEVER be charged. Defense-in-depth via two filters (status + cancelled_at) prevents transaction-visibility-lag races.

**Enforcement.** Strict-grep gate `.github/scripts/strict-grep/i-proposed-tr4-cancelled-installment-never-charged.mjs` scans `process-scheduled-installments/index.ts` for both filter clauses present; tester adversarial test inserts a row with `status='scheduled' AND cancelled_at=now()` then triggers cron and asserts no Stripe call.

---

## 6. Test Cases

| # | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Template chip applies preset | Tap "standard" chip | refund_policy = STANDARD_POLICY constant; editor shows 3 tier rows | UI |
| T-02 | Custom builder monotonicity error | Enter tiers: 30d/50%, 14d/80% | Inline error on second tier; publish blocked | UI + RPC |
| T-03 | Publish RPC rejects malformed JSONB | Direct SQL insert refund_policy with non-int days_before_start | publish RPC raises EXCEPTION via validate_refund_policy() | RPC |
| T-04 | Deadline picker validation | Pick deadline after trip start | Inline error "Deadline must be before trip starts" | UI |
| T-05 | Publish persists deadline | Valid datetime + publish | events.booking_deadline populated | DB |
| T-06 | Buyer cancel preview happy path | GET /booking/{orderId}/cancel?token=<valid> | RefundPreviewSheet renders with computed refund + tier explanation | UI + RPC + edge fn |
| T-07 | Invalid token | GET with wrong token | 401 error UI ("This cancel link isn't valid") | UI + edge fn |
| T-08 | Already-cancelled order | GET with valid token, already cancelled | 409 error UI ("Your reservation is already cancelled") | UI + edge fn |
| T-09 | Buyer confirm cancel happy path | Confirm → edge fn → Stripe refund → DB writes → notification | 200; refunds row succeeded; orders.cancelled_at set; ticket_order_notifications row enqueued | Full stack |
| T-10 | Single-payment 100% tier | $1000 trip + cancel 80d before + standard policy | refund_total_cents=100000, 1 stripe.refunds.create call with amount=100000 | Refund engine |
| T-11 | Single-payment 50% tier | $1000 trip + cancel 45d before + standard policy | refund_total_cents=50000 | Refund engine |
| T-12 | Single-payment 0% tier | $1000 trip + cancel 10d before + standard policy | refund_total_cents=0; NO stripe.refunds.create call; orders.cancelled_at set; ticket_order_notifications with refundIssued=false | Refund engine |
| T-13 | Installment 100% tier | 3×$300 plan with 2 paid + cancel 80d before + standard | 2 stripe.refunds.create calls (one per collected installment PI); refund_total=60000; 1 cancelled installment row | Refund engine + installment |
| T-14 | Installment 50% tier | Same + cancel 45d before | 2 refund calls (amount=15000 each); refund_total=30000 | Refund engine + installment |
| T-15 | Installment 0% tier | Same + cancel 10d before | 0 stripe refund calls; refund_total=0; installment 3 cancelled (no charge attempt next cron run) | Refund engine + installment |
| T-16 | Cron auto-close happy path | Trip with deadline=now()-1h | Cron run → bookings_closed=true, bookings_closed_at populated | Cron |
| T-17 | Checkout 403 when closed | POST ticket-checkout-create with event.bookings_closed=true | HTTP 403 + body `{error:'bookings_closed', detail:'Bookings closed', deadline:<ISO>}` | Edge fn |
| T-18 | Operator cancel via JWT | Operator JWT + orderId + reason → POST cancel-trip-booking mode='operator' | Same refund flow; cancelled_by=jwt.sub; ticket_order_notifications.payload.cancelledBy='operator' | Full stack |
| T-19 | At-risk auto-clear | Cancel an at_risk=true booking | orders.at_risk=false, at_risk_since=NULL | DB |
| T-20 | Cancelled installments not charged | Schedule installment due_at=now()+1min; cancel order; trigger cron after 5 min | Cron query returns 0 rows for that order_id; no Stripe call | Cron + DB |
| T-21 | Public page renders refund ladder | Trip with standard policy → load public page | RefundPolicyDisplay shows 3 tier rows in time-sorted order | UI |
| T-22 | Public page closed banner | events.bookings_closed=true → load public page | Red banner "Bookings closed" rendered | UI |
| T-23 | Public page countdown pill | events.booking_deadline=now()+12d → load public page | Pill "Bookings close in 12 days" | UI |
| T-24 | RLS forbids cross-brand operator cancel | Operator JWT for brand A; orderId for brand B | 403 forbidden from cancel-trip-booking | Edge fn + RLS |
| T-25 | Refund-preview freshness divergence (SC-22) | Load preview; operator changes refund_policy mid-flight to lower tier; buyer confirms with old expectedRefundTotalCents | edge fn returns HTTP 409 `{error:'policy_updated', currentRefundTotalCents:<new>}`; UI re-fetches + re-renders + allows re-confirm. NO Stripe refund created at old amount. | Edge fn + UI |

### 6.1 Boundary-condition test matrix (Tr4 risk-register row 6)

**Single-payment refund (6 boundary points):**

| Test | Tier matrix | Cancel days remaining | Expected refund_pct |
|------|---|---:|---:|
| BD-01 | Standard | 61 (just-before 60d boundary) | 100% |
| BD-02 | Standard | 60 (on 60d boundary) | 100% (tier matches `<=`) |
| BD-03 | Standard | 59 (just-after 60d boundary) | 50% |
| BD-04 | Standard | 31 (just-before 30d boundary) | 50% |
| BD-05 | Standard | 30 (on 30d boundary) | 50% |
| BD-06 | Standard | 29 (just-after 30d boundary) | 0% |

**Installment refund (9 boundary points × paid-count):**

| Test | Tier days | Installments paid (of 3) | Expected math |
|------|---|---:|---|
| BI-01 | 61 days remaining | 0 paid | refund 100% of deposit only |
| BI-02 | 60 days remaining | 1 paid | refund 100% × (deposit + installment 1) |
| BI-03 | 59 days remaining | 2 paid | refund 50% × (deposit + installment 1 + installment 2) |
| BI-04 | 31 days remaining | 0 paid | refund 50% × deposit |
| BI-05 | 30 days remaining | 1 paid | refund 50% × (deposit + installment 1) |
| BI-06 | 29 days remaining | 2 paid | refund 0%; both installments and deposit forfeited |
| BI-07 | 0 days remaining | 0 paid | refund 0% |
| BI-08 | -1 day remaining (after start) | 1 paid | refund 0% |
| BI-09 | 200 days remaining | 0 paid | refund 100% × deposit |

**Implementor writes happy-path:** BD-02 + BD-05 + BI-02 + BI-05 (representative on-boundary cases) as `cancel-trip-booking/__tests__/refund_math_boundaries.test.ts`. Fails-on-revert: revert the `<=` operator in `biz_compute_refund_for_cancel` to `<` → BD-02 fails (gives 50% instead of 100%).

**Tester writes adversarial:** all 15 boundary cases (BD-01 through BD-06 + BI-01 through BI-09) as `cancel-trip-booking/__tests__/refund_math_boundaries.adversarial.test.ts`. Different angle than implementor: implementor proves on-boundary correctness; tester proves just-before/just-after asymmetry + paid-count variation + edge cases (200 days, after-start, all-paid, none-paid). Plus security adversarial:

- AD-01: Forge orderId in token → expect 401.
- AD-02: Replay valid token after order already cancelled → expect 409 (idempotent rejection).
- AD-03: Operator JWT for brand A, orderId for brand B → expect 403.
- AD-04: Concurrent buyer-cancel + operator-cancel race → one succeeds, other gets 409 (DB UNIQUE on cancelled_at prevents double-write).
- AD-05: Direct UPDATE on refunds.amount_cents → expect EXCEPTION from trigger.
- AD-06: Direct INSERT on refund_line_items with mismatched installment_id/order_id → expect EXCEPTION from trigger.

---

## 7. Implementation Order

Per `feedback_orchestrator_deploys_edge_functions.md` + operator-owns-db-push split:

1. **Write migration** `20260612000000_tr4_refund_tiers_booking_deadline.sql` per §3.1.
2. **Operator runs `supabase db push --linked`** (manual gate).
3. **Implementor writes edge functions:**
   - NEW `cancel-trip-booking/index.ts` (high risk; Deno tests required)
   - NEW `process-booking-deadlines/index.ts`
   - MODIFIED `ticket-checkout-create/index.ts` (surgical 5-line insert)
   - MODIFIED `process-scheduled-installments/index.ts` (2 SQL filter edits)
   - MODIFIED `ticket-confirmation-dispatch/index.ts` (payload-shape extensions)
   - MODIFIED `_shared/email/buyerLifecycleAdapters.ts`
4. **Implementor runs Deno gates** (`deno check`, `deno test`) on all 6 edge fn files.
5. **Orchestrator deploys edge functions** (5 deploys after operator confirms DB push).
6. **Live-fire test 1:** create a test trip with refund_policy + booking_deadline via direct SQL; trigger `process-booking-deadlines` cron manually via curl with service-role; confirm bookings_closed flip. **This is the critical gate before building UI.**
7. **Live-fire test 2:** create a test installment-paid order via Stripe test mode; cancel via `cancel-trip-booking` edge fn with operator JWT; confirm refund posts + installments cancelled + cron skips cancelled rows on next run.
8. **Service + hook layer:** §3.3 + §3.4.
9. **Components:** RefundPolicyEditor, BookingDeadlinePicker, RefundPreviewSheet, RefundPolicyDisplay.
10. **`/ui-ux-pro-max` DESIGN dispatch** (parallel to step 9 OR before, operator's call) for wizard step IA + buyer cancel-flow IA + refund-preview visual polish.
11. **Modified routes/screens:** TripCreatorStep4Pricing (or new Step 5 per DESIGN), `app/trip/[id]/index.tsx` (replace Refund stub), public trip page, NEW `app/booking/[orderId]/cancel.tsx`, MODIFIED `app/checkout/[eventId]/index.tsx` 403 handling.
12. **CI strict-grep gates** (3 new): wire into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`.
13. **Implementor regression tests** per ORCH-0840 Step 0.5 (happy-path):
    - `cancel-trip-booking/__tests__/refund_math_boundaries.test.ts` — BD-02, BD-05, BI-02, BI-05
    - `process-booking-deadlines/__tests__/cron_happy_path.test.ts` — T-16 SQL+http
    - `RefundPolicyEditor.test.tsx` — monotonicity validation
    - All with `fails-on-revert verified at <commit-hash>` cited in implementation report.
14. **Implementation report** with full Old → New receipts, all 24 test cases mapped to verification.

---

## 8. Regression Prevention

| Structural safeguard | What it prevents |
|---|---|
| FORK `cancel-trip-booking` rather than mutate `refund-order` | ORCH-0787 single-event refund stays untouched (smaller blast radius) |
| Cron filter `AND cancelled_at IS NULL` on BOTH scheduled + failed queries | Cancelled installment double-charge race |
| Bookings-closed check at `ticket-checkout-create` entry | Last-line-of-defense vs UI-cache staleness or direct-curl bypass |
| Order-scoped buyer cancel token (SHA256 hash in DB; plaintext in email) | Buyer self-cancel works weeks after checkout without re-authentication; rotatable per-order |
| Refund amount pinned at cancel-time, immutable trigger-enforced | Race between cancel-confirm and cron-charging next installment can't drift refund |
| 9+6 cell boundary-condition test matrix | Tr4 risk-register row 6 mandate; off-by-one bugs caught at PR time |
| `validate_refund_policy()` CHECK constraint + IMMUTABLE function | Operator can't misconfigure non-monotonic policy at any write surface |
| Trigger `tg_refund_line_items_installment_parity` | Cross-order installment attribution impossible |
| `routeForEventRowDefensive` reused on any Tr4 trip-event routing | I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE preserved |
| `feedback_anon_buyer_routes.md` enforced on new `/booking/{orderId}/cancel` route | Buyer-anon-web posture preserved |

**Protective inline comment template** (implementor MUST include in `cancel-trip-booking/index.ts`):

```ts
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CONTRACT:
// - This file is the SINGLE OWNER of trip-booking cancellation + Tr4 refund
//   execution. Single-event refund flow stays in refund-order/index.ts UNCHANGED.
// - Auth mode 'buyer': SHA256(token) === orders.buyer_cancel_token_hash.
//   Auth mode 'operator': JWT validate + biz_is_brand_member_for_read_for_caller.
// - Refund amount computed via biz_compute_refund_for_cancel (deterministic SQL
//   function pins amount at cancel_at). Immutable post-insert via trigger.
// - Per-PI refund loop: one stripe.refunds.create per source PaymentIntent.
//   {stripeAccount: connectedAccountId} on EVERY call per ORCH-0843 direct-charge.
//   refund_application_fee:true gives proportional 1.5% Mingla fee refund.
// - On any per-PI failure: biz_cancel_trip_booking_rollback; operator retries.
// - Installment cancellation: scheduled+failed installments flipped to status=cancelled
//   + cancelled_at populated. CHECK constraint enforces both-or-neither.
// - Cron process-scheduled-installments has belt-and-braces filter:
//   WHERE status='scheduled' AND cancelled_at IS NULL.
// - Notification: REUSE existing buyer_order_cancelled + buyer_refund_issued kinds
//   from ORCH-0788; payload extended with cancelledBy + tierApplied + breakdown.
```

---

## 9. Cross-Skill Notes

### For Codex `implementor-mingla` (or Claude `mingla-implementor`)

- **High-risk implementation order** per §7 — backend + cron live-fire BEFORE UI.
- **No mocking installment refund flow** in tests — use Stripe test mode against real test-mode connected account per Tr3 close pattern.
- **Migration filename** must be strictly greater than max prior; verify `ls supabase/migrations/ | sort | tail -3` before naming.
- **Deno gates** for the 2 NEW + 3 modified edge functions — `deno check` + `deno test` BEFORE declaring complete.
- **Deploy split:** operator runs `supabase db push --linked`; implementor (or orchestrator) deploys edge fns with `/Users/sethogieva/bin/supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv`.
- **DESIGN dependency:** wizard step IA + buyer cancel route polish should come from `/ui-ux-pro-max` BEFORE component file authoring.
- **`/ui-ux-pro-max` preflight** required for any UI surface per `feedback_implementor_uses_ui_ux_pro_max.md`.

### For Claude `mingla-tester` (or forensics TEST mode)

- **24 success criteria + 15 boundary tests + 6 adversarial tests** — full coverage.
- **iOS sim + Android emu + Web preview parity** for all UI surfaces (per Phase 0.A live-fire sim gate). Buyer cancel route is web-only (no native client), so sim-leg = web preview only for that route.
- **Stripe test-mode setup** required for T-09 through T-15, T-18, T-24. Tester writes fixtures if implementor's don't generalize.
- **Verdict gate:** PASS requires `proven`-level live-fire sim repro on every applicable surface, both regression tests (implementor + tester) committed in closing PR, all 5 NEW invariants pinned by CI or SQL.

### For Claude or Codex `mingla-orchestrator`

- **5 NEW invariants flip DRAFT → ACTIVE** on close. INVARIANT_REGISTRY update at CLOSE Step 5e.
- **3 NEW CI strict-grep gates** wire into `.github/workflows/strict-grep-mingla-business.yml`. Two invariants (REFUND-CASCADE-MONOTONICITY + INSTALLMENT-REFUND-LEDGER-PARITY) pinned via SQL CHECK + trigger, not strict-grep.
- **3 follow-up ORCHs** to register at CLOSE per DISC-6/DISC-7 (min-capacity gate; buyer self-update PM if not yet registered; late-booking auto-adjust if not yet registered).
- **EAS OTA eligibility:** YES — pure JS UI changes + edge fns + migrations + no new native modules.
- **Stage 1c follow-up** noted in Tr3 close (ORCH-0872) covers secondary `finalize` callers — orthogonal to Tr4 but worth flagging if it's still open (Tr4 finalize callers must respect same plumbing).

---

## 10. Open Questions Resolution

All 10 Q answered per dispatch §4 with operator-readable recommendations. Operator can override any of these before implementor dispatch.

| Q | Resolution | Reasoning |
|---|---|---|
| Q1 — Tier matrix per 3 templates | **Locked.** Flexible: 30d/100%, 14d/50%, 0d/0%. Standard: 60d/100%, 30d/50%, 0d/0% (= brief's example). Strict: 90d/100%, 0d/0% (binary). | Industry-norm (Airbnb-style); standard matches brief verbatim; flexible/strict bracket the typical operator preference range. Operator can override per trip via custom builder. |
| Q2 — Installment refund math | **Locked.** Refund per-installment: each collected installment refunded `× tier_pct`. Deposit refunded `× tier_pct` separately. Future scheduled+failed installments cancelled (status=cancelled + cancelled_at set). Per-PI Stripe refund (preserves PI-level audit + application-fee proportionality). Cap: refund per installment can't exceed installment.amount_cents (math floor naturally prevents overflow). | Maintains installment_id provenance in refund_line_items; one stripe.refunds.create per source PI matches Stripe-native semantics; cron skips cancelled rows. |
| Q3 — Booking-deadline semantics | **Locked.** Absolute `timestamptz` only. Rejected "N days before trip start" computed form. | Cognitive load lower (operator picks the exact moment); ambiguity at edits avoided (changing trip start would silently shift deadline); UI shows human countdown derived at render time. |
| Q4 — Cron schedule | **Locked.** Hourly (`0 * * * *`). Cadence picked over 15-min for cost + log noise; over daily for sub-day-precision deadlines. | Operator can set deadline at any wall-clock minute; cron closes within 60min worst-case; UI countdown updates more frequently via React Query. |
| Q5 — Cancel-after-deadline policy | **Locked.** Tier engine still applies (typically 0% refund at that point per policy). No special path. | Simpler — operator's policy is the single source of truth. If they want operator-only override post-deadline they can disable buyer-token in a future ORCH polish. |
| Q6 — Stripe refund execution | **Locked.** Connect-account refund via `stripe.refunds.create({payment_intent, amount, refund_application_fee:true}, {stripeAccount: connectedAccountId})`. Application fee proportional via Stripe-native. | Mirrors ORCH-0787 single-event refund pattern; ORCH-0843 direct-charge architecture handled correctly; no new application-fee accounting needed. |
| Q7 — At-risk flag auto-clear | **Locked.** Yes — `biz_cancel_trip_booking_begin` sets `orders.at_risk=false, at_risk_since=NULL`. | Cancelled bookings are not at-risk (they're closed). Operator dashboard at-risk filter correctly excludes cancelled bookings. |
| Q8 — Min-capacity gate | **Locked OUT-OF-SCOPE.** Defer to future ORCH after Tr4 ships. | Separate concern; needs its own UX surface (capacity threshold setter, auto-cancel notification, refund implications); WeTravel doesn't have it either so Tr4 ships parity-plus without it. |
| Q9 — Refund email template | **Locked.** REUSE existing `buyer_order_cancelled` + `buyer_refund_issued` kinds from ORCH-0788. Extend payload with `{cancelledBy, tierApplied, refundAmountCents, installmentBreakdown}`. Email body differentiates buyer-vs-operator via discriminator. | NO new dispatcher kind branches; smaller blast radius on dispatcher; payload extension is additive (backward-compatible with single-event refund). |
| Q10 — Buyer cancel route | **Locked.** NEW `mingla-business/app/booking/[orderId]/cancel.tsx?token=<...>` route. Token = SHA256 hash on `orders.buyer_cancel_token_hash` (plaintext in confirmation email URL). | Cancel needs revisit-able URL (operator may resend link weeks later); confirmation route is fire-and-forget. Pattern mirrors existing Tr2 buyer_status_token at session level; Tr4 adds order-scoped variant. |

---

## 11. Discoveries for Orchestrator

- **DISC-1** — `refund_line_items` from ORCH-0787 is Tr4-ready with one ALTER (add `installment_id`). Dispatch §3.1 NEW `order_refunds` table is REDUNDANT — SPEC revises.
- **DISC-2** — `orders.cancelled_at` already exists (ORCH-0787). Dispatch §3.1 add-cancelled_at is RESOLVED — no add. Tr4 adds `cancel_reason`, `cancelled_by`, `buyer_cancel_token_hash` only.
- **DISC-3** — Existing dispatcher kinds (ORCH-0788) `buyer_refund_issued` + `buyer_order_cancelled` cover Tr4. Dispatch §3.2 Q9 (new kinds) REVISED — REUSE existing.
- **DISC-4** — Wizard step IA is a `/ui-ux-pro-max` DESIGN decision (3 options per dispatch §3.3). SPEC left OPEN; orchestrator dispatches DESIGN phase before implementor.
- **DISC-5** — Booking-deadline timezone UX needs design clarity (operator-brand TZ picker semantics vs UTC). `/ui-ux-pro-max` decides.
- **DISC-6** — Min-capacity gate (ORCH-0825 §5) deferred per Q8 — register follow-up ORCH at CLOSE.
- **DISC-7** — Existing Tr3 close follow-ups still relevant: ORCH-0870 (late-booking auto-adjust), ORCH-0871 (buyer self-update PM on dunning), ORCH-0804-A (Stripe Tax). Tr4 doesn't depend on them but they're worth re-surfacing at Tr4 CLOSE.
- **DISC-8** — `ticket-checkout-create` event-fetch select query needs `bookings_closed`, `booking_deadline`, `event_type` added. Implementor verifies the current `.select(...)` string and patches if those columns aren't already there.
- **DISC-9** — Tr4 needs `event_dates` table reference for trip-start timestamp in `biz_compute_refund_for_cancel`. Implementor verifies the canonical trip-start source column (vs `events.start_at` direct vs Tr2 sidecar `event_dates.start_at`) — possibly trip-only via `trip_days[0].start_at`. SPEC assumes `event_dates.start_at MIN()` per Tr2 pattern; implementor confirms.

---

## 12. Confidence Level

**H — High** for:
- Schema deltas (4+3+2+1 columns + 4 RPCs + 1 cron + 1 CHECK + 4 indexes + 2 triggers) — all grounded in current-state map.
- 5 NEW invariants — each maps to a concrete enforcement mechanism (SQL CHECK / trigger / strict-grep / RLS).
- Refund math (boundary-condition matrix covers the off-by-one risk per Tr4 risk-register row 6).
- Q1-Q10 resolutions — operator-locked at INTAKE for the 2 strategic forks; remaining 8 resolved per industry norm + ORCH precedent.
- Edge function fork decision (don't mutate `refund-order`) — smaller blast radius.

**M — Medium** for:
- Wizard step IA — deferred to `/ui-ux-pro-max` DESIGN phase.
- Buyer cancel route polish (loading states, success animation, error-recovery copy) — deferred to DESIGN.
- Cron cadence (hourly chosen; could tune to 15min if operator demand surfaces).
- Email-copy variants (cancelledBy discriminator approach is sound; final copy locked at DESIGN).

**L — Low** for:
- Min-capacity gate UX (out of scope; future ORCH).
- Tr4 v1.1 polish (operator override + fraud workflow).

---

## 13. Pipeline next

1. **Claude `mingla-orchestrator`** reviews investigation + spec; verifies Phase 0 ingest complete; verifies Q1-Q10 RESOLVED block present.
2. **Claude `mingla-orchestrator`** presents operator-readable summary; operator confirms or overrides Q1-Q10 defaults.
3. **`/ui-ux-pro-max`** DESIGN dispatch for:
   - Wizard step IA (add 2 steps vs fold into Step 4 vs add 1 combined)
   - Buyer cancel-flow IA (`/booking/{orderId}/cancel` layout, refund-preview presentation, success state)
   - Email body copy + visual polish (buyer-vs-operator variant copy)
4. **Implementor** dispatch with locked SPEC + DESIGN artifact.
5. **Operator** runs `supabase db push --linked`.
6. **Orchestrator** deploys 5 edge functions.
7. **Implementor** live-fires backend (cron + cancel-trip-booking) via Stripe test mode against real connected account.
8. **Tester** TARGETED mode — 24 SC + 15 boundary + 6 adversarial.
9. **Orchestrator** CLOSE per One-PR-per-CLOSE; flip 5 invariants DRAFT → ACTIVE; register follow-up ORCHs per DISC-6/7/9.

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
