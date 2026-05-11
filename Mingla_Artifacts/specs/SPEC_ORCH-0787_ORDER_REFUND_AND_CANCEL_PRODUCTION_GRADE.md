# SPEC — ORCH-0787 Order Refund + Cancel Production-Grade

- **ORCH-ID:** ORCH-0787
- **Mode:** SPEC (Claude `mingla-forensics`, canonical owner per I-PROPOSED-AB)
- **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
- **Bound by:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md`
- **Date:** 2026-05-11
- **Status:** READY FOR IMPLEMENTATION

This spec is a binding contract between investigator, implementor, and tester. The implementor MUST NOT exceed scope. The tester MUST verify every numbered Success Criterion. Deviations require operator approval and a documented amendment to this file.

---

## §0 — Operator-Locked Decisions (from investigation §7, confirmed 2026-05-11)

| # | Decision | Spec impact |
|---|---|---|
| Q-1 | **Paid-order cancel collapses into full refund (Eventbrite pattern).** | One "Refund order" flow for paid; "Cancel order" path exists only for `payment_method='free'`. No "cancelled paid order" state. |
| Q-2 | **Application fee refunds proportionally via Stripe `refund_application_fee=true`.** | Edge function always passes `refund_application_fee: true` when `orders.stripe_application_fee_amount_cents > 0`. Stripe handles proportional math. |
| Q-3 | **Partial-refund line-to-ticket selection = oldest first (`tickets.created_at ASC`).** | Default; tactical. |
| Q-4 | **Defense-in-depth: advance `tickets.status` AND `orders.payment_status`.** | Both flips happen in the same RPC transaction. Scanner gate at `biz_ticket_scan` already filters `payment_status <> 'paid'`; we add the `tickets.status` flip as a second guard. |
| Q-5 | **Refund + cancel reason required, 10..200 trimmed chars.** | Matches `RefundSheet`, `DoorRefundSheet`, `CancelOrderDialog` existing pattern. |
| Q-6 | **No undo window.** | Stripe refunds are not reversible. UI shows confirmation modal; once confirmed, no rollback. |
| Q-7 | **S-09 orphan-refund column-mismatch fix folded into ORCH-0787 scope.** | `brandStripeOrphanedRefundsService.ts` corrected to query real columns (`stripe_event_id`, `payload`, `type`) — see §3.7. |
| Q-8 | **v1 Zustand orderStore exit: stop writing refunds locally, keep `OrderRecord` shape.** | `useOrderStore.recordRefund` and `useOrderStore.cancelOrder` are NOT called by the new flows. They remain in the store as TRANSITIONAL until follow-up ORCH-0788 contracts the shape. |
| Q-9 | **Free-order cancellation goes through the same `cancel-order` edge function with an internal `payment_method='free'` branch.** | One auditable code path. |
| Q-10 | **Webhook subscribes to `charge.refunded` + `refund.created` + `refund.updated`** (in addition to existing `charge.refund.updated`). | Broader event coverage; pinned `STRIPE_API_VERSION = "2026-04-22.dahlia"` supports these. |

---

## §1 — Scope, Non-Goals, Assumptions

### §1.1 Scope

ORCH-0787 ships a production-grade refund + cancel flow for ONLINE orders (`orders.payment_method IN ('card', 'apple_pay', 'google_pay', 'free')`). End-to-end:

1. **Schema:** add `'cancelled'` to `orders.payment_status` CHECK; add `cancelled_at, cancelled_by, cancellation_reason, refunded_amount_cents` columns to `orders`; add `currency, stripe_payment_intent_id, processed_at, application_fee_refunded_cents` columns to `public.refunds`; create new `public.refund_line_items` table; add direct-predicate RLS SELECT policy on `public.refunds` to prevent RLS-RETURNING-OWNER-GAP.
2. **RPCs:** create `biz_refund_order` and `biz_cancel_order` SECURITY DEFINER RPCs that own the multi-table atomic write (refunds + refund_line_items + orders.payment_status + tickets.status).
3. **Edge functions:** create `refund-order` and `cancel-order` edge functions. Each authenticates the caller, preflight-checks the brand-payments permission, calls the corresponding RPC, calls Stripe's Refund API on the **platform key** with `reverse_transfer: true` and (when fee>0) `refund_application_fee: true`, stamps `stripe_refund_id` back to `public.refunds`, enqueues a `ticket_order_notifications` row, returns the updated order shape. Idempotency via client-supplied `Idempotency-Key` header.
4. **Webhook:** extend `_shared/stripeWebhookRouter.ts` `handleRefundUpdated` to reconcile `public.refunds` and advance `orders.payment_status` (idempotent with in-app refund row). Add `charge.refunded`, `refund.created`, `refund.updated` to `STRIPE_ROUTED_EVENT_TYPES`. Handle `payment_intent.canceled` post-paid (extension of current pre-paid-only handler).
5. **Services + hooks:** `mingla-business/src/services/orderRefundService.ts` and `orderCancelService.ts` (new). `useEventOrders.ts` gains `useRefundOrder()` and `useCancelOrder()` React Query mutations with explicit invalidation of `eventOrdersKeys.detail / order / soldCounts / salesSummary`. `eventOrdersService.ts` fetches `refunds[]` from `public.refunds + public.refund_line_items` and computes `refundedQuantity` per line from `public.refund_line_items`.
6. **Components:** order detail page (`mingla-business/app/event/[id]/orders/[oid]/index.tsx`) flips the four hardcoded `false` flags to a derivation function, imports `RefundSheet` and `CancelOrderDialog`, replaces "coming soon" toasts with real sheet open handlers. `RefundSheet.tsx` and `CancelOrderDialog.tsx` swap their Zustand mutations for the new React Query mutations and remove the simulated 1.2s sleep. Order list page (`/orders/index.tsx`) `matchesFilter` separates `'failed'` from `'cancelled'` and adds a Failed pill (or hides failed entirely per §3.6.3).
7. **Orphan service fix (folded per Q-7):** `brandStripeOrphanedRefundsService.ts` corrected to query the real `payment_webhook_events` columns.
8. **CI + tests:** new strict-grep gate `orch-0787-refund-cancel-flow.mjs`, new Jest tests in `eventOrdersService.test.ts`, new Deno tests in `supabase/functions/refund-order/_test/` and `supabase/functions/cancel-order/_test/`.
9. **Decision log + invariant registry:** new DEC entries, three new I-PROPOSED invariants (REFUND-AUTHORITY-PLATFORM-DESTINATION, ORDER-CANCELLED-VS-FAILED-SEPARATION, REFUND-ROW-WRITTEN-BEFORE-STATUS-ADVANCED).

### §1.2 Non-Goals

ORCH-0787 does **NOT** ship:
- Premium email branding / refund email HTML templates — owned by **ORCH-0785**. ORCH-0787 enqueues `ticket_order_notifications` rows with a `payload.template_key`; ORCH-0785 owns the rendered content. ORCH-0787 may ship a minimal placeholder template (subject + 1-paragraph body) gated behind a feature flag so the refund flow is testable end-to-end before ORCH-0785 closes.
- Event-list / home-screen post-refund summary visibility — owned by **ORCH-0784**. ORCH-0787 invalidates the relevant React Query keys; ORCH-0784 owns the display contract.
- Resend-ticket CTA + notification rollup recompute — owned by **ORCH-0782**.
- Door-sale refund flow (Cycle 12) — explicitly separate per I-Cycle-12.
- Application-fee policy increase (Mingla charging >0%) — separate operator decision.
- Buyer-side ticket UI changes (app-mobile / web `/e/` / `/o/`) — anonymous buyer sees the refund only via email.
- Refund of refund / partial refund of partial refund as a special UX — handled by the same `biz_refund_order` RPC; UI shows the same RefundSheet with the remaining refundable amount.
- "Cancelled paid order" as a distinct state per Q-1.
- Per-ticket void UI (operator picks which 2 of 4 to void) — Q-3 default is oldest-first.
- `useOrderStore` full ID-only contraction per Q-8 — deferred to **ORCH-0788** (registered as a discovery for orchestrator).

### §1.3 Assumptions

- **A-01:** Stripe Connect destination-charge refund authority is platform-side. Confirmed by investigation C-09 and Stripe Connect docs. The new `refund-order` edge function uses the platform Stripe key (`Deno.env.get("STRIPE_SECRET_KEY")` via `_shared/stripe.ts`'s `getStripe()`); no `Stripe-Account` header.
- **A-02:** `STRIPE_API_VERSION = "2026-04-22.dahlia"` is the pinned version and supports `refund.*` events. Confirmed by reading `_shared/stripe.ts:29`.
- **A-03:** ORCH-0785's premium email template will accept a `payload.template_key = "buyer_refund_issued" | "buyer_order_cancelled"` and consume `payload.amount_cents`, `payload.currency`, `payload.refund_lines[]`, `payload.reason`. ORCH-0787 commits to this payload shape; ORCH-0785 commits to consuming it.
- **A-04:** The operator will deploy the new migration (`supabase db push --linked`) before the implementor's edge function deploy and before the QA tester live-fire. The implementor and orchestrator follow the deploy split codified in `feedback_orchestrator_deploys_edge_functions.md`.
- **A-05:** No buyer-facing app-mobile change is required. The buyer email is the entire buyer surface for this ORCH.

---

## §2 — Database Layer (Migration `20260520000000_orch_0787_order_refund_cancel.sql`)

### §2.1 Migration ordering and naming

Single migration file: `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql`. Timestamp chosen to land after `20260515000018` (ORCH-0783) and any in-flight ORCH-0784/0785/0786 migrations. **Implementor must verify** the highest existing migration timestamp at implementation time and bump if necessary; the file content is invariant.

### §2.2 `orders.payment_status` CHECK constraint extension

```sql
-- Drop and re-add the CHECK constraint to add 'cancelled'.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'pending'::text,
    'paid'::text,
    'failed'::text,
    'refunded'::text,
    'partial_refund'::text,
    'cancelled'::text
  ]));
```

**Semantics codified** (new invariant I-PROPOSED-(new) ORDER-CANCELLED-VS-FAILED-SEPARATION):
- `'pending'` — checkout session created, not yet finalized
- `'paid'` — finalized, no refund or cancellation
- `'failed'` — Stripe payment_intent failure (gateway failure; written by `biz_ticket_checkout_finalize` failure path or `payment_intent.payment_failed` webhook)
- `'refunded'` — full refund issued (in-app or via Stripe dashboard reconciled)
- `'partial_refund'` — at least one but not all line items refunded
- `'cancelled'` — **intentional cancellation by organiser** (free-only per Q-1 and Q-9; paid orders use refund instead)

### §2.3 New columns on `public.orders`

```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_reason_length
  CHECK (cancellation_reason IS NULL OR (length(trim(cancellation_reason)) BETWEEN 10 AND 200));

ALTER TABLE public.orders
  ADD CONSTRAINT orders_refunded_amount_nonnegative
  CHECK (refunded_amount_cents >= 0);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_refunded_amount_not_exceed_total
  CHECK (refunded_amount_cents <= total_cents);
```

`refunded_amount_cents` is a denormalized cache maintained by `biz_refund_order`. Source of truth is `SUM(public.refunds.amount_cents) WHERE order_id = orders.id AND status = 'succeeded'`. The cache exists so the orders list can be sorted/filtered/aggregated without an additional join.

### §2.4 New columns on `public.refunds`

```sql
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS currency character(3) NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS application_fee_refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_stripe_refund_id
  ON public.refunds(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refunds_order_id_status
  ON public.refunds(order_id, status);

ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_reason_length
  CHECK (reason IS NULL OR (length(trim(reason)) BETWEEN 10 AND 200));

ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_application_fee_nonnegative
  CHECK (application_fee_refunded_cents >= 0);
```

### §2.5 New table `public.refund_line_items`

```sql
CREATE TABLE IF NOT EXISTS public.refund_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  order_line_item_id uuid NOT NULL REFERENCES public.order_line_items(id) ON DELETE RESTRICT,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_line_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT refund_line_items_amount_positive CHECK (amount_cents > 0),
  UNIQUE (refund_id, order_line_item_id)
);

CREATE INDEX idx_refund_line_items_refund_id ON public.refund_line_items(refund_id);
CREATE INDEX idx_refund_line_items_order_line_item_id ON public.refund_line_items(order_line_item_id);

ALTER TABLE public.refund_line_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.refund_line_items IS
  'ORCH-0787: line-level refund accounting. Sum of quantity per (order_line_item_id) <= order_line_items.quantity.';
```

**Cumulative invariant** (enforced by `biz_refund_order` RPC at write time — see §2.7):
```
SUM(refund_line_items.quantity) WHERE order_line_item_id = X AND refund.status = 'succeeded'
  <= order_line_items.quantity
```

### §2.6 RLS policies

**On `public.refunds`** — add direct-predicate SELECT policy to prevent RLS-RETURNING-OWNER-GAP per I-PROPOSED-H. Keep existing helper-based ALL policy.

```sql
-- Existing policy retained:
--   "Brand admin plus can manage refunds" ALL
--   USING + WITH CHECK biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(order_id))

-- NEW direct-predicate SELECT policy for RETURNING context safety.
CREATE POLICY "Refunds owner direct select for RETURNING"
  ON public.refunds
  FOR SELECT
  TO authenticated
  USING (
    initiated_by = auth.uid()
    OR
    biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(order_id))
  );
```

**On `public.refund_line_items`** — single ALL policy inheriting refund-side access.

```sql
CREATE POLICY "Refund line items inherit refund access"
  ON public.refund_line_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.id = refund_line_items.refund_id
        AND biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(r.order_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.id = refund_line_items.refund_id
        AND biz_can_manage_payments_for_brand_for_caller(biz_order_brand_id(r.order_id))
    )
  );

CREATE POLICY "Refund line items direct select for RETURNING"
  ON public.refund_line_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.id = refund_line_items.refund_id
        AND r.initiated_by = auth.uid()
    )
  );
```

**On `public.orders`** — no new policy needed if all writes go through SECURITY DEFINER RPCs. The existing helper-based UPDATE policy is bypassed by the RPC running as definer.

### §2.7 RPC: `biz_refund_order`

```sql
CREATE OR REPLACE FUNCTION public.biz_refund_order(
  p_order_id uuid,
  p_lines jsonb,           -- [{order_line_item_id, quantity, amount_cents}, ...]
  p_reason text,
  p_idempotency_key text   -- client-supplied; the edge function uses this to dedupe Stripe calls
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_total_refunded_after int;
  v_all_lines_fully_refunded boolean;
  v_new_payment_status text;
  v_tickets_to_void int;
  v_result jsonb;
BEGIN
  -- 1. Load order + verify caller permission
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate order is in a refundable state
  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate reason
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- 4. Validate lines: per-line cumulative refund must not exceed line quantity
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status = 'succeeded';

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% already=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded, v_line_item.quantity
        USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents := v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- 5. Insert public.refunds row (status='pending'; edge function flips to 'succeeded' after Stripe acks)
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
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_refund_id;

  -- 6. Insert refund_line_items
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
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

  -- 7. Compute new order payment_status
  --   - if SUM(refunded per line, succeeded refunds + this pending one) >= SUM(quantity per line) → 'refunded'
  --   - else → 'partial_refund'
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        WHERE rli.order_line_item_id = oli.id
      )
  ) INTO v_all_lines_fully_refunded;

  v_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;

  -- 8. Update orders.payment_status + denormalized cache (refunded_amount_cents stays in pending state
  --    until Stripe acks; we don't advance status to refunded until edge function flips refund.status='succeeded'.)
  --    HOWEVER: the RPC returns BOTH the proposed new status AND the cumulative pending amount, so the edge
  --    function can decide whether to commit the status flip after Stripe success. (See §3.4.)
  --    Implementor note: this RPC writes refund + line items in 'pending' state ONLY; it does NOT advance
  --    orders.payment_status here. That happens in `biz_refund_order_commit` after Stripe acks.

  -- 9. Select tickets to void: oldest-created-first per ticket_type within affected lines (Q-3 default).
  --    Returned to edge function as a manifest; actual tickets.status flip happens in `biz_refund_order_commit`.
  v_tickets_to_void := v_refund_amount_cents; -- placeholder; real selection is computed in commit RPC

  -- 10. Return pending refund manifest
  v_result := jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_refund_order(uuid, jsonb, text, text) TO authenticated;
```

**Companion RPC** `biz_refund_order_commit(p_refund_id, p_stripe_refund_id, p_application_fee_refunded_cents, p_status)` — called by the edge function after Stripe API returns. Flips `refunds.status`, sets `refunds.stripe_refund_id` + `refunds.processed_at` + `refunds.application_fee_refunded_cents`, advances `orders.payment_status` + `orders.refunded_amount_cents`, flips the oldest N tickets per affected line item to `'refunded'`.

```sql
CREATE OR REPLACE FUNCTION public.biz_refund_order_commit(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_application_fee_refunded_cents integer,
  p_status text   -- 'succeeded' | 'failed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_brand_id uuid;
  v_line_item record;
  v_new_payment_status text;
  v_total_refunded_cents int;
  v_result jsonb;
BEGIN
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_refund.status <> 'pending' THEN
    RAISE EXCEPTION 'refund_not_pending: status=%', v_refund.status USING ERRCODE = 'P0011';
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_commit_status' USING ERRCODE = 'P0012';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'failed' THEN
    UPDATE public.refunds
    SET status = 'failed', processed_at = now()
    WHERE id = p_refund_id;
    -- Failed refunds DO NOT void tickets or advance orders.payment_status.
    -- Line items stay; they can be re-attempted (a new refund row supersedes).
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed');
  END IF;

  -- p_status = 'succeeded'
  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      application_fee_refunded_cents = p_application_fee_refunded_cents,
      processed_at = now()
  WHERE id = p_refund_id;

  -- Compute cumulative refunded cents
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded';

  -- Determine new payment_status
  IF NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = v_order.id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status = 'succeeded'
      )
  ) THEN
    v_new_payment_status := 'refunded';
  ELSE
    v_new_payment_status := 'partial_refund';
  END IF;

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = v_order.id;

  -- Defense-in-depth (Q-4): void the oldest N tickets per affected line item.
  -- For each refund_line_item, void `quantity` tickets where:
  --   tickets.order_id = order_id
  --   tickets.ticket_type_id = rli.ticket_type_id
  --   tickets.status = 'valid'
  -- ordered by tickets.created_at ASC, limit rli.quantity (Q-3 default).
  FOR v_line_item IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = p_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = v_order.id
        AND t2.ticket_type_id = v_line_item.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line_item.quantity
    );
  END LOOP;

  v_result := jsonb_build_object(
    'refund_id', p_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents
  );
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_refund_order_commit(uuid, text, integer, text) TO authenticated;
```

### §2.8 RPC: `biz_cancel_order`

```sql
CREATE OR REPLACE FUNCTION public.biz_cancel_order(
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Q-1: paid orders cannot be cancelled — they must be refunded.
  IF v_order.payment_method <> 'free' THEN
    RAISE EXCEPTION 'paid_orders_must_be_refunded_not_cancelled' USING ERRCODE = 'P0006';
  END IF;

  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_cancellable: status=%', v_order.payment_status USING ERRCODE = 'P0007';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- Atomic: update orders, void tickets
  UPDATE public.orders
  SET payment_status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_caller,
      cancellation_reason = trim(p_reason),
      updated_at = now()
  WHERE id = p_order_id;

  UPDATE public.tickets
  SET status = 'void'
  WHERE order_id = p_order_id
    AND status = 'valid';

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', 'cancelled',
    'cancelled_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_cancel_order(uuid, text) TO authenticated;
```

### §2.9 Trigger to maintain `orders.refunded_amount_cents` cache

Optional but recommended: a trigger on `public.refunds` AFTER UPDATE of status to keep the cache in sync if a future codepath bypasses `biz_refund_order_commit`. Defer to implementor judgment — the commit RPC already writes the cache directly.

---

## §3 — Edge Function Layer

### §3.1 New edge function: `supabase/functions/refund-order/index.ts`

**Route:** `POST /functions/v1/refund-order`
**Auth:** JWT (authenticated user — same pattern as `ticket-checkout-create`).
**Idempotency:** client supplies `Idempotency-Key` header (UUID). The function uses this to (a) suppress duplicate Stripe calls and (b) link the resulting `public.refunds` row in `metadata.idempotency_key`.

**Request schema:**
```ts
interface RefundOrderRequest {
  order_id: string;           // UUID
  lines: Array<{
    order_line_item_id: string;  // UUID
    quantity: number;            // > 0
    amount_cents: number;        // > 0 (must equal quantity * unit_price_cents)
  }>;
  reason: string;             // 10..200 trimmed chars
  // Implicit from header: Idempotency-Key
}
```

**Response schema (success):**
```ts
interface RefundOrderResponse {
  refund_id: string;
  order_id: string;
  amount_cents: number;
  currency: string;
  status: 'succeeded';
  stripe_refund_id: string;
  application_fee_refunded_cents: number;
  new_payment_status: 'partial_refund' | 'refunded';
  processed_at: string;       // ISO timestamp
}
```

**Response schema (error):**
```ts
interface RefundOrderErrorResponse {
  error: string;          // machine-readable code
  message: string;        // human-readable
  details?: Record<string, unknown>;
}
```

Error codes (must map to existing `edgeFunctionError.ts` parser):
- `unauthenticated` (401)
- `permission_denied` (403)
- `order_not_found` (404)
- `order_not_refundable` (422)
- `line_overrefund` (422 — includes details with line_id and capacity)
- `reason_invalid_length` (422)
- `stripe_declined` (502 — Stripe API returned error; include details.stripe_error_code)
- `stripe_unreachable` (504)
- `idempotency_conflict` (409 — same key, different payload)
- `internal_error` (500)

**Function flow:**
1. Parse + validate request body. Reject if any field missing.
2. Verify JWT → resolve `auth.uid()`.
3. Call `biz_refund_order(p_order_id, p_lines, p_reason, p_idempotency_key)`. Errors map to error codes above.
4. From the RPC response, extract `stripe_payment_intent_id`, `application_fee_amount_cents`, `amount_cents`.
5. Look up the `stripe_account_id` from `public.ticket_checkout_sessions` joined by `order_id` (needed for logging only; **NOT** sent as `Stripe-Account` header per A-01).
6. Call `stripe.refunds.create({ payment_intent: ..., amount: amount_cents, reason: 'requested_by_customer', reverse_transfer: true, refund_application_fee: (app_fee>0) }, { idempotencyKey: <Idempotency-Key>:refund })`. Use the **platform** Stripe key from `getStripe()` in `_shared/stripe.ts`. No `Stripe-Account` header.
7. On Stripe success: call `biz_refund_order_commit(refund_id, stripe_refund.id, stripe_refund.application_fee_refunded ?? 0, 'succeeded')`.
8. On Stripe failure: call `biz_refund_order_commit(refund_id, null, 0, 'failed')`. Return `stripe_declined` error to client.
9. Enqueue buyer notification: insert into `public.ticket_order_notifications`:
   ```sql
   INSERT INTO public.ticket_order_notifications (
     order_id, event_id, channel, recipient, status,
     idempotency_key, attempt_count, payload
   ) VALUES (
     order_id, event_id, 'email', orders.buyer_email, 'pending',
     'refund:' || order_id || ':' || stripe_refund_id, 0,
     jsonb_build_object(
       'template_key', 'buyer_refund_issued',
       'amount_cents', amount_cents,
       'currency', currency,
       'refund_lines', refund_lines_json,
       'reason', reason,
       'is_full_refund', is_full_refund
     )
   );
   ```
   The `notify-dispatch` edge function picks this up and routes to Resend. (ORCH-0785 owns the rendered template content.)
10. Write audit row via `_shared/audit.ts:writeAudit` with `action='order_refund_issued'`.
11. Return success response.

**No retry on Stripe network failure inside the request handler** — the client retries with the same Idempotency-Key. The RPC + Stripe both honor idempotency keys, so a retry is safe.

**TypeScript constraints (per repo pattern):**
- Use `import type` from `https://esm.sh/@supabase/supabase-js@2` per existing convention (`@ts-ignore` allowed at that import only).
- Use `_shared/stripe.ts`'s `getStripe()` factory — do NOT instantiate Stripe inline (I-PROPOSED-Q).
- Use `_shared/idempotency.ts:generateIdempotencyKey` for any internal idempotency needs.
- Use `_shared/audit.ts:writeAudit` for the audit trail.
- Use `_shared/cors.ts` (or the same CORS preamble `ticket-checkout-create` uses) for browser/RN clients.

### §3.2 New edge function: `supabase/functions/cancel-order/index.ts`

**Route:** `POST /functions/v1/cancel-order`
**Auth:** JWT.
**Idempotency:** client `Idempotency-Key` header.

**Request:**
```ts
interface CancelOrderRequest {
  order_id: string;
  reason: string;     // 10..200 chars
}
```

**Response:**
```ts
interface CancelOrderResponse {
  order_id: string;
  status: 'cancelled';
  cancelled_at: string;
}
```

**Flow:**
1. Validate request.
2. Verify JWT.
3. Call `biz_cancel_order(p_order_id, p_reason)`. RPC enforces `payment_method='free'` (paid orders rejected with `paid_orders_must_be_refunded_not_cancelled`).
4. Enqueue `ticket_order_notifications` row with `payload.template_key='buyer_order_cancelled'`.
5. Write audit row with `action='order_cancelled'`.
6. Return success.

**No Stripe call** — free orders never charged Stripe; cancellation is DB + email only.

### §3.3 Webhook router extension: `supabase/functions/_shared/stripeWebhookRouter.ts`

**Modify `STRIPE_ROUTED_EVENT_TYPES`:** add `'charge.refunded'`, `'refund.created'`, `'refund.updated'`.

**Modify `handleRefundUpdated`** (or split into `handleRefundEvent` family):
- For events `charge.refunded`, `refund.created`, `refund.updated`, `charge.refund.updated`:
  1. Extract `stripe_refund_id` and `payment_intent` from the event payload.
  2. Look up `public.orders` by `stripe_payment_intent_id = payment_intent`. If not found, fall through to the existing detached-account audit-only branch (truly orphan).
  3. UPSERT into `public.refunds` with `stripe_refund_id` as the unique key. If a row already exists with this `stripe_refund_id` (in-app refund pre-recorded it), update status/processed_at/application_fee_refunded_cents only.
  4. If the upsert created a new row (dashboard-initiated): also create `refund_line_items` rows by proportional allocation (oldest line first by `order_line_items.created_at` — same selection policy as Q-3).
  5. Compute new `orders.payment_status` and call `biz_refund_order_commit_from_webhook(...)` (a NEW companion RPC, internal use only, that re-uses the commit logic without the caller-permission check since the webhook is service-role).
  6. Enqueue buyer notification (idempotent via the same `idempotency_key` as the in-app path).
- For `payment_intent.canceled` post-paid: separate handler that advances the order to `'failed'` if it was `'pending'` (current behavior), or no-op if already `'paid'` (paid intents cannot be canceled — they can only be refunded).

**New invariant** (enforced by webhook + edge function coordination): a refund row's `stripe_refund_id` is the **single global identity**. Both the in-app edge function and the webhook write to the same row.

### §3.4 Notification dispatch hooks

`supabase/functions/notify-dispatch/index.ts` already routes `ticket_order_notifications` rows. ORCH-0787 must:
- Add two new `template_key` values to the dispatch routing table: `buyer_refund_issued` and `buyer_order_cancelled`.
- Provide minimal placeholder HTML/text content for each (subject line + 1-paragraph body), gated behind a feature flag `ORCH_0785_PREMIUM_TEMPLATES`. When ORCH-0785 closes, the placeholder is replaced.

Placeholder copy (text):
- `buyer_refund_issued`:
  ```
  Subject: Your refund for {event_name}
  Body: Hi {buyer_name}, a refund of {amount_currency} has been issued for your {event_name} ticket(s). It will appear on your statement in 3–5 days. Reason: {reason}.
  ```
- `buyer_order_cancelled`:
  ```
  Subject: Your {event_name} order was cancelled
  Body: Hi {buyer_name}, your order for {event_name} has been cancelled by the organiser. No charge was made. Reason: {reason}.
  ```

---

## §4 — Service Layer (mingla-business)

### §4.1 New: `mingla-business/src/services/orderRefundService.ts`

```ts
export interface RefundOrderInput {
  orderId: string;
  lines: Array<{ orderLineItemId: string; quantity: number; amountCents: number }>;
  reason: string;
  idempotencyKey: string;
}

export interface RefundOrderResult {
  refundId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  newPaymentStatus: 'partial_refund' | 'refunded';
  stripeRefundId: string;
  applicationFeeRefundedCents: number;
  processedAt: string;
}

export async function issueOrderRefund(input: RefundOrderInput): Promise<RefundOrderResult>;
```

- Invokes via `supabase.functions.invoke('refund-order', { body, headers: { 'Idempotency-Key': idempotencyKey } })`.
- Error handling via existing `edgeFunctionError.ts`. Throws typed errors that the hook layer catches.
- Generates `idempotencyKey` via `crypto.randomUUID()` once per user gesture (NOT per retry).

### §4.2 New: `mingla-business/src/services/orderCancelService.ts`

```ts
export interface CancelOrderInput {
  orderId: string;
  reason: string;
  idempotencyKey: string;
}

export interface CancelOrderResult {
  orderId: string;
  status: 'cancelled';
  cancelledAt: string;
}

export async function cancelFreeOrder(input: CancelOrderInput): Promise<CancelOrderResult>;
```

Same pattern as §4.1.

### §4.3 Modified: `mingla-business/src/services/eventOrdersService.ts`

**Change 1** — `statusFromPayment`: remove the `'failed' → 'cancelled'` mapping. Map `'failed' → 'failed'` and `'cancelled' → 'cancelled'`. Update `OrderStatus` type (line 56 in `orderStore.ts`) to include `'failed'`.

**Change 2** — `fetchEventOrders`: replace the hardcoded `refunds: []` / `refundedQuantity: 0` / `refundedAmountGbp: 0` with a real SELECT. Add a joined query against `public.refunds` (with `refund_line_items` nested):

```ts
.select(`
  id, event_id, buyer_email, buyer_name, buyer_phone, buyer_phone_e164,
  total_cents, currency, payment_method, payment_status, confirmed_at, created_at,
  cancelled_at, cancelled_by, cancellation_reason, refunded_amount_cents,
  events!inner ( brand_id ),
  order_line_items (
    id, ticket_type_id, quantity, unit_price_cents, total_cents,
    ticket_types (name, is_free)
  ),
  refunds (
    id, amount_cents, currency, reason, status, processed_at, created_at, stripe_refund_id,
    refund_line_items ( order_line_item_id, ticket_type_id, quantity, amount_cents )
  )
`)
```

Then in the mapper:
- Compute `OrderLineRecord.refundedQuantity` per line by summing `refund_line_items.quantity` for matching `order_line_item_id` where parent refund `status='succeeded'`.
- Compute `OrderLineRecord.refundedAmountGbp` (and `refundedAmount`) similarly.
- Map each `refunds` row → `RefundRecord` shape (matching `orderStore.ts:92-104`).
- Filter `refunds` to status='succeeded' only (pending/failed refunds do not appear in the UI ledger).
- Map `cancelledAt` from `orders.cancelled_at` (NOT from `payment_status='failed'`).

**Change 3** — also export a new `getEventOrderRefunds(orderId: string): RefundRecord[]` helper for the order detail page, if needed.

### §4.4 Modified: `mingla-business/src/utils/edgeFunctionError.ts`

If the existing error parser does not map the new error codes (`order_not_refundable`, `line_overrefund`, `stripe_declined`, `paid_orders_must_be_refunded_not_cancelled`), add them. Each must map to a user-friendly toast copy via a centralized table.

---

## §5 — Hook Layer (mingla-business)

### §5.1 Modified: `mingla-business/src/hooks/useEventOrders.ts`

Add the following exports:

```ts
export const useRefundOrder = (): UseMutationResult<RefundOrderResult, Error, RefundOrderInput>;
export const useCancelOrder = (): UseMutationResult<CancelOrderResult, Error, CancelOrderInput>;
```

Each mutation's `onSuccess` MUST invalidate:
- `eventOrdersKeys.detail(eventId)`
- `eventOrdersKeys.order(eventId, orderId)`
- `eventOrdersKeys.soldCounts([eventId])`
- `eventOrdersKeys.salesSummary(eventId, currency, ticketSignature)` — note: ticketSignature can change between mounts, so use predicate-style invalidation: `queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'event-orders' && q.queryKey[1] === eventId })`.

Each mutation's `onError` MUST surface the error via `edgeFunctionError.toUserMessage(error)` to the caller — never silently swallow.

### §5.2 No new query keys

All keys exist in `eventOrdersKeys` factory.

---

## §6 — Component Layer (mingla-business)

### §6.1 Modified: `mingla-business/app/event/[id]/orders/[oid]/index.tsx`

**Remove lines 277-281** (the four hardcoded `false` flags).

**Add a derivation function** (matching Cycle 9c §3.4.2 logic per the order detail JSDoc lines 1-16):

```ts
function deriveActionFlags(order: OrderRecord, canRefund: boolean) {
  const fullyRefunded = order.status === 'refunded_full';
  const cancelled = order.status === 'cancelled';
  const partial = order.status === 'refunded_partial';
  const paid = order.status === 'paid';
  const isFree = order.paymentMethod === 'free';

  return {
    showRefundFull: canRefund && !isFree && paid,
    showRefundPartialAgain: canRefund && !isFree && partial,
    showCancelOrder: canRefund && isFree && paid,
    showSecondaryPartialFromFull: canRefund && !isFree && paid, // "Partial refund" link under "Refund order"
  };
}
```

**Import `RefundSheet` and `CancelOrderDialog`** (new imports — currently absent).

**Add sheet/dialog state:**
```ts
const [refundSheetMode, setRefundSheetMode] = useState<'full' | 'partial' | null>(null);
const [cancelDialogVisible, setCancelDialogVisible] = useState(false);
```

**Replace the four `onPress` handlers (lines 430-475):**
- `Refund order` → `onPress={() => setRefundSheetMode('full')}`
- `Partial refund` (secondary link) → `onPress={() => setRefundSheetMode('partial')}`
- `Refund again` → `onPress={() => setRefundSheetMode('partial')}`
- `Cancel order` → `onPress={() => setCancelDialogVisible(true)}`

**Render the sheets at the bottom of the component (inside the parent View, per `feedback_rn_sub_sheet_must_render_inside_parent`):**
```tsx
{order !== null && refundSheetMode !== null && (
  <RefundSheet
    visible={refundSheetMode !== null}
    mode={refundSheetMode}
    order={order}
    onClose={() => setRefundSheetMode(null)}
    onSuccess={(amount) => {
      showToast(`Refunded ${formatCurrency(amount, order.currency)}`);
      setRefundSheetMode(null);
    }}
  />
)}
{order !== null && order.status === 'paid' && order.paymentMethod === 'free' && (
  <CancelOrderDialog
    visible={cancelDialogVisible}
    orderId={order.id}
    buyerName={order.buyer.name}
    onClose={() => setCancelDialogVisible(false)}
    onSuccess={() => {
      showToast('Order cancelled');
      setCancelDialogVisible(false);
    }}
  />
)}
```

### §6.2 Modified: `mingla-business/src/components/orders/RefundSheet.tsx`

**Replace** `const recordRefund = useOrderStore((s) => s.recordRefund);` (line 93) **with**:
```ts
const refundOrder = useRefundOrder();
```

**Replace** `handleConfirm` body (lines 170-256) — keep the prelude (validation, line filtering, lines array construction) and replace the simulated sleep + Zustand call:

```ts
// Remove: await sleep(REFUND_PROCESSING_MS);
// Remove: const result = recordRefund(order.id, {...});

try {
  const result = await refundOrder.mutateAsync({
    orderId: order.id,
    lines: lines.map((l) => ({
      orderLineItemId: l.orderLineItemId, // must be present on OrderLineRecord — added in §4.3
      quantity: l.quantity,
      amountCents: Math.round(l.amountGbp * 100),
    })),
    reason: trimmedReason,
    idempotencyKey: idempotencyKeyRef.current,
  });
  onSuccess(result.amountCents / 100);
} catch (err) {
  showToast(edgeFunctionError.toUserMessage(err));
}
```

**Remove all side-effect code in lines 211-256** (Zustand→liveEventStore→eventEditLogStore→notifyEventChanged chain). Those side effects move to the edge function (audit row + buyer notification). The client-side `recordEdit` + `notifyEventChanged` calls are **deleted** in v1 to avoid double-firing. **Note:** the operator's event-edit-log surface and the parent notification rollup remain owned by ORCH-0782; if ORCH-0782 needs these client-side notifications, it can re-introduce them via the React Query `onSuccess` callback in `useRefundOrder`. This is a clean separation and a discovery for orchestrator.

**Add `idempotencyKeyRef` at the top of the component:**
```ts
const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
useEffect(() => {
  if (visible) idempotencyKeyRef.current = crypto.randomUUID();
}, [visible]);
```
(Regenerate on each sheet-open so retry attempts within the same sheet share the same key, but different sheet-opens get fresh keys.)

### §6.3 Modified: `mingla-business/src/components/orders/CancelOrderDialog.tsx`

Same pattern: replace `useOrderStore.cancelOrder` with `useCancelOrder` mutation. Remove the 1.2s simulated sleep. Remove the `notifyEventChanged` side-effect (moved to edge function). Idempotency key ref pattern.

### §6.4 Modified: `mingla-business/app/event/[id]/orders/index.tsx`

**`matchesFilter` (lines 43-56):** remove the `'failed' → 'cancelled'` mapping (it lived in `eventOrdersService.statusFromPayment`, not here; verify after §4.3 change). Add explicit:
```ts
if (filter === 'cancelled') return order.status === 'cancelled';
```
**Default decision (operator override available):** do NOT add a 'Failed' filter pill in v1. Orders with `payment_status='failed'` (pre-finalization gateway failures) are not visible in the organiser orders list today — checkout sessions in `'failed'` state stay in `ticket_checkout_sessions`, not `orders`. Per investigation §3.5 (production = 0 failed orders), this is the right call. Document for future ORCH-XXXX-FAILED-VISIBILITY if support requests arise.

### §6.5 No changes to `mingla-business/src/store/orderStore.ts`

Per Q-8 v1 decision: keep the store shape, stop writing refunds from the new flows. The `recordRefund` and `cancelOrder` methods remain on the store but become unused (the new RefundSheet and CancelOrderDialog use the React Query mutations instead). Add a `[DEPRECATED-IN-ORCH-0787]` comment above each method documenting the transition and the follow-up ORCH-0788 deadline.

```ts
/**
 * @deprecated since ORCH-0787 (2026-05-11). Use `useRefundOrder()` from
 * useEventOrders.ts instead. This method writes to client-side Zustand only and
 * does NOT call Stripe or persist server-side. Will be removed by ORCH-0788
 * (orderStore full ID-only contraction).
 */
recordRefund: ...
```

---

## §7 — Folded-in Side-Fix (Q-7): Orphan-Refund Service Column Mismatch

### §7.1 Modified: `mingla-business/src/services/brandStripeOrphanedRefundsService.ts`

**Fix the column-name mismatch (S-09 from investigation).** Live `payment_webhook_events` schema:
- `id, stripe_event_id, type, payload, processed, processed_at, error, created_at, retry_count, retries_exhausted`

The current service queries non-existent columns. The fix:

**Replace** the SELECT (lines 48-56) to query real columns. Since `payment_webhook_events` has no `account_id` column, the brand-scoping must be derived from the JSONB `payload.account` field at runtime (or via a new generated column `account_id` added in this migration as a follow-up — recommended).

**Recommended path** (cleanest): add a generated column in the migration (§2):
```sql
ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS account_id text
  GENERATED ALWAYS AS (payload->>'account') STORED;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_account_id_type
  ON public.payment_webhook_events(account_id, type)
  WHERE account_id IS NOT NULL;
```

Then rewrite the service to query:
```ts
.from('payment_webhook_events')
.select('stripe_event_id, payload, created_at')
.eq('type', 'charge.refund.updated')
.eq('account_id', stripeAccountId)
```

And rename the typed row + result interfaces to match (`stripe_event_id` → output's `eventId`; `payload` → output's `payload`).

### §7.2 Modified: `mingla-business/src/components/brand/BrandStripeOrphanedRefundsSection.tsx`

Update consumer to use the corrected service interface (no behavioural change, just type alignment).

### §7.3 New test

`mingla-business/src/services/__tests__/brandStripeOrphanedRefundsService.test.ts` (NEW):
- Verify the service queries `type` (not `event_type`), `payload` (not `raw_payload`), `stripe_event_id` (not `event_id`).
- Verify it handles empty results gracefully.

---

## §8 — CI / Strict-Grep Gates

### §8.1 New: `.github/scripts/strict-grep/orch-0787-refund-cancel-flow.mjs`

Enforce:
1. `mingla-business/src/services/eventOrdersService.ts` MUST NOT contain `refunds: []` as a hardcoded literal in `fetchEventOrders` (use ESLint AST grep or a regex on the function body).
2. `mingla-business/src/services/eventOrdersService.ts` MUST NOT contain `payment_status === "failed"` mapped to `"cancelled"` (the legacy stub mapping).
3. `mingla-business/app/event/[id]/orders/[oid]/index.tsx` MUST NOT contain `const showRefundFull = false;` (the hardcoded stub).
4. `mingla-business/src/components/orders/RefundSheet.tsx` MUST NOT call `useOrderStore.recordRefund` (use mutation).
5. `mingla-business/src/components/orders/CancelOrderDialog.tsx` MUST NOT call `useOrderStore.cancelOrder`.
6. `supabase/functions/refund-order/index.ts` MUST import `getStripe` from `_shared/stripe.ts` (no inline `new Stripe(...)`).
7. `supabase/functions/refund-order/index.ts` MUST NOT contain a literal `apiVersion:` (I-PROPOSED-Q enforcement).
8. `supabase/functions/cancel-order/index.ts` MUST NOT make any HTTP request to `api.stripe.com` (free orders only — no Stripe involvement).
9. `mingla-business/src/services/brandStripeOrphanedRefundsService.ts` MUST query `payload` (not `raw_payload`) and `type` (not `event_type`) and `stripe_event_id` (not `event_id`).

### §8.2 Registry: `.github/workflows/strict-grep-mingla-business.yml`

Add a job entry `orch-0787-refund-cancel-flow` mirroring the existing `orch-0777-ticket-checkout-production` job pattern. Per `feedback_strict_grep_registry_pattern.md` — one script + one job; no parallel workflow file.

### §8.3 New: `mingla-business/src/services/__tests__/orderRefundService.test.ts`

Unit tests for the service wrapper. Mock `supabase.functions.invoke`. Verify:
- Happy path returns `RefundOrderResult` shape.
- Error path with `order_not_refundable` throws a typed error mapped via `edgeFunctionError`.
- Idempotency key header is sent.

### §8.4 New: `mingla-business/src/services/__tests__/orderCancelService.test.ts`

Same pattern for cancel service.

### §8.5 New: `supabase/functions/refund-order/_test/index_test.ts`

Deno test suite. Mock Stripe SDK + Supabase client. Verify:
- Happy path: validates → calls `biz_refund_order` → calls Stripe → calls `biz_refund_order_commit` → enqueues notification → returns success.
- Stripe declined: validates → RPC writes pending → Stripe fails → commit RPC marks failed → returns `stripe_declined` error.
- Idempotency: same key + same payload → second invocation returns cached success without re-calling Stripe.
- Idempotency: same key + different payload → returns `idempotency_conflict`.
- Auth missing: returns `unauthenticated`.
- Permission denied: RPC throws 42501 → returns `permission_denied`.

### §8.6 New: `supabase/functions/cancel-order/_test/index_test.ts`

Same pattern. Plus: explicit test that calling `cancel-order` on a `payment_method='card'` order returns `paid_orders_must_be_refunded_not_cancelled`.

### §8.7 Extended Jest: `mingla-business/src/services/__tests__/eventOrdersService.test.ts`

Add coverage for:
- `fetchEventOrders` populates `OrderRecord.refunds[]` from the joined `public.refunds` table.
- `OrderLineRecord.refundedQuantity` is the sum of `refund_line_items.quantity` for that line where parent refund `status='succeeded'`.
- `statusFromPayment('failed')` → `'failed'` (NOT `'cancelled'`).
- `statusFromPayment('cancelled')` → `'cancelled'`.
- `cancelledAt` derives from `orders.cancelled_at` (NOT from `payment_status='failed'`).

---

## §9 — Decision Log + Invariant Registry Updates

### §9.1 New DECISION_LOG entries

- **DEC-XXX (Refund authority — destination charge):** ORCH-0787 commits to platform-side refund issuance for destination-charge orders. The new `refund-order` edge function uses the platform Stripe key (no `Stripe-Account` header) and passes `reverse_transfer: true` to pull funds back from the connected account. Application fee refund is automatic via `refund_application_fee: true` when `orders.stripe_application_fee_amount_cents > 0`. Rationale: Stripe Connect docs explicitly identify platform-account refunds as the canonical pattern for destination charges; alternative (connected-account refund + manual transfer reversal) is more error-prone.
- **DEC-XXX (Paid cancel = full refund):** ORCH-0787 collapses paid-order cancellation into the full refund flow. There is no `'cancelled paid order'` state. Free orders retain the distinct `'cancelled'` state. Rationale: Eventbrite/DICE pattern; reduces reconciliation burden; aligns with Q-1 operator decision.
- **DEC-XXX (Defense-in-depth ticket void):** Both `orders.payment_status` and `tickets.status` flip on refund. Scanner gates on both. Rationale: single-source updates have historically caused replay attacks (Q-4 operator decision).

### §9.2 New INVARIANT_REGISTRY entries (DRAFT — flips ACTIVE on CLOSE)

- **I-PROPOSED-(letter) REFUND-AUTHORITY-PLATFORM-DESTINATION** — Refund of a destination-charge order is issued on the platform Stripe key with `reverse_transfer: true`. No `Stripe-Account` header. CI gate at `orch-0787-refund-cancel-flow.mjs` grep #6 + #7. Test catches regression: refund-order Deno test asserts the Stripe SDK call shape.
- **I-PROPOSED-(letter) ORDER-CANCELLED-VS-FAILED-SEPARATION** — `orders.payment_status='failed'` is gateway failure (written only by `biz_ticket_checkout_finalize` or `payment_intent.payment_failed` webhook). `'cancelled'` is intentional cancellation (written only by `biz_cancel_order`). No code maps one to the other. CI gate grep #2. Test catches regression: `eventOrdersService.test.ts` `statusFromPayment` matrix.
- **I-PROPOSED-(letter) REFUND-ROW-WRITTEN-BEFORE-STATUS-ADVANCED** — `public.refunds` row insert MUST precede `orders.payment_status` advance within the same RPC transaction. The commit RPC enforces this; the two-step RPC pattern (`biz_refund_order` then `biz_refund_order_commit`) is the canonical write order. Test catches regression: refund-order Deno test asserts the row exists with `status='pending'` between Stripe call start and Stripe call complete (no race window).

### §9.3 Memory rail update

Append to `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_zustand_persist_no_server_snapshots.md`:
- Note: `useOrderStore` continues to persist `OrderRecord` server-snapshots in v1 of ORCH-0787 as a documented TRANSITIONAL extension. Full ID-only contraction deferred to ORCH-0788.

---

## §10 — Numbered Success Criteria

Each MUST be observable, testable, and unambiguous. The tester verifies each via the test matrix in §11.

| SC# | Criterion | How verified |
|---|---|---|
| SC-01 | An organiser with `finance_manager` rank or higher can tap "Refund order" on a `payment_status='paid'`, non-free order and see the existing `RefundSheet` UI open. | iOS Simulator + Android Emulator + Web Browser parity check. |
| SC-02 | Submitting a full refund issues a Stripe refund via the platform key with `reverse_transfer: true` and (when `application_fee_amount_cents > 0`) `refund_application_fee: true`. No `Stripe-Account` header is sent. | Deno test inspects Stripe SDK call args. |
| SC-03 | After a successful full refund: `orders.payment_status='refunded'`, `orders.refunded_amount_cents = orders.total_cents`, `public.refunds.status='succeeded'`, all `tickets.status` for the order = `'refunded'`. | SQL probe in Deno test + live-fire QA. |
| SC-04 | After a successful partial refund of 2 of 4 tickets in a single line: `orders.payment_status='partial_refund'`, exactly 2 `tickets` rows for that line are `'refunded'` (oldest by `created_at` first) and 2 remain `'valid'`. | SQL probe. |
| SC-05 | A buyer notification row is enqueued in `ticket_order_notifications` with `template_key='buyer_refund_issued'`, `channel='email'`, and the recipient = `orders.buyer_email`. | SQL probe. |
| SC-06 | A subsequent retry with the same `Idempotency-Key` (same payload) returns the same `refund_id` and does not create a duplicate `public.refunds` row or call Stripe a second time. | Deno test. |
| SC-07 | A retry with the same `Idempotency-Key` but a different payload returns `idempotency_conflict` (409). | Deno test. |
| SC-08 | An organiser with rank below `finance_manager` (e.g., `event_manager`) cannot see the Refund order CTA; if they bypass UI and call the edge function directly, the RPC returns `permission_denied` (42501). | iOS UI test + Deno test for the bypass path. |
| SC-09 | Tapping "Cancel order" on a `payment_method='free'` order fires the `cancel-order` edge function, sets `orders.payment_status='cancelled'`, `orders.cancelled_at`, `orders.cancelled_by`, `orders.cancellation_reason`, and voids all `tickets.status` to `'void'`. | iOS + Android + SQL probe. |
| SC-10 | Calling `cancel-order` on a `payment_method='card'` paid order returns `paid_orders_must_be_refunded_not_cancelled` error. | Deno test. |
| SC-11 | A Stripe-dashboard-initiated refund (no in-app refund row exists yet) triggers the webhook, which upserts into `public.refunds` (status='succeeded') with proportional `refund_line_items` rows (oldest line first), advances `orders.payment_status` correctly, voids the appropriate `tickets.status`, and enqueues the buyer notification. The flow is idempotent if the same webhook fires twice. | Webhook-replay live-fire test via `stripe trigger refund.created`. |
| SC-12 | The `brandStripeOrphanedRefundsService.ts` no longer references the non-existent columns `event_id`, `raw_payload`, `event_type`, `account_id`. Queries succeed against the live schema. | Jest test + live-fire probe. |
| SC-13 | The order list page filter pills "Refunded" and "Cancelled" each return matching orders correctly. `'failed'` orders are NOT mapped to "Cancelled". | iOS + Android UI test. |
| SC-14 | A refund issued for an order whose buyer email is empty does NOT crash; it skips the email enqueue and logs the missing-recipient case via `writeAudit`. | Deno test edge case. |
| SC-15 | All React Query keys invalidate on success: `eventOrdersKeys.detail`, `eventOrdersKeys.order`, and any `event-orders` query for that `eventId`. The orders list re-fetches and shows the updated state within 2 seconds of refund success. | iOS UI test + React Query DevTools assertion. |
| SC-16 | The new strict-grep gate `orch-0787-refund-cancel-flow.mjs` passes on the implemented branch. The gate fails when any of the 9 enforcement patterns are violated. | CI run + hand-injected regression test. |
| SC-17 | No `[DEPRECATED-IN-ORCH-0787]` marker comments are reaped (they're intended to survive to ORCH-0788). | Orchestrator CLOSE Step 1.5 — DIAG-marker reaping does NOT touch these. |
| SC-18 | Migration `20260520000000_orch_0787_order_refund_cancel.sql` applies idempotently (re-running on a partially-applied DB produces no error). | Operator dry-run via `supabase db push --linked --dry-run`. |
| SC-19 | The webhook `STRIPE_ROUTED_EVENT_TYPES` includes `charge.refunded`, `refund.created`, `refund.updated`. Stripe CLI `stripe trigger refund.created` produces no `webhook_unhandled` audit row. | Live-fire via Stripe test mode. |
| SC-20 | Order detail page imports `RefundSheet` and `CancelOrderDialog`; the four `show*` flag variables derive from `deriveActionFlags(order, canRefund)` and are NOT hardcoded to `false`. | Strict-grep gate #3 + code review. |

---

## §11 — Test Matrix

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Full refund happy path | `payment_status='paid'`, all-line refund, valid reason | `orders.payment_status='refunded'`, refund row succeeded, tickets refunded, buyer email enqueued | Full stack |
| T-02 | Partial refund happy path | `payment_status='paid'`, 1 of 4 tickets | `orders.payment_status='partial_refund'`, 1 ticket flipped (oldest by created_at), 3 still valid | Full stack |
| T-03 | Multi-step partial refund | Refund 2 then refund 2 more of same line | After step 1 `'partial_refund'`; after step 2 `'refunded'`; total 4 tickets refunded; 2 refund rows + 2 refund_line_items rows | Full stack |
| T-04 | Refund overflow | Try to refund 5 of 4 tickets | `line_overrefund` error; no DB write; no Stripe call | RPC + edge fn |
| T-05 | Reason too short | Reason length < 10 | `reason_invalid_length`; no write | Edge fn + RPC |
| T-06 | Reason too long | Reason length > 200 | Same as T-05 | Edge fn + RPC |
| T-07 | Stripe declined | Force `card_declined` in Stripe test | RPC writes pending, Stripe rejects, commit RPC marks `'failed'`, edge fn returns `stripe_declined`, NO ticket void, NO status advance | Full stack |
| T-08 | Stripe network failure | Mock Stripe SDK to throw timeout | Edge fn returns `stripe_unreachable`; client can retry with same Idempotency-Key safely | Edge fn |
| T-09 | Idempotency replay | Same key + same payload twice | 2nd call returns same `refund_id`, NO duplicate Stripe call | Edge fn |
| T-10 | Idempotency conflict | Same key + different payload | `idempotency_conflict` 409 | Edge fn |
| T-11 | Unauthenticated | No JWT | 401 `unauthenticated` | Edge fn |
| T-12 | Permission denied | JWT for user without finance_manager rank | RPC returns 42501; edge fn returns `permission_denied` | RPC + edge fn |
| T-13 | Order not found | Random UUID | `order_not_found` | RPC |
| T-14 | Wrong order state | `payment_status='cancelled'` | `order_not_refundable` | RPC |
| T-15 | Cancel free order happy path | `payment_method='free'`, `payment_status='paid'` | `orders.payment_status='cancelled'`, all tickets void, buyer email enqueued | Full stack |
| T-16 | Cancel paid order rejected | `payment_method='card'` | `paid_orders_must_be_refunded_not_cancelled` | RPC |
| T-17 | Webhook reconcile (dashboard refund) | Trigger `refund.created` for an order with no in-app refund | `public.refunds` row created with `status='succeeded'`, `refund_line_items` rows created (oldest line first), order status advanced, tickets voided, buyer email enqueued | Webhook |
| T-18 | Webhook idempotency | Same webhook fires twice | 2nd fire is a no-op; no duplicate refund row | Webhook |
| T-19 | Webhook + in-app race | In-app refund pending, webhook arrives before edge fn calls commit | UPSERT on `stripe_refund_id` updates the existing pending row to `'succeeded'`; commit RPC is a no-op or merges correctly | Webhook + edge fn |
| T-20 | Orphan refund (detached account, no order) | Detached connected account, refund event arrives | Old audit-only path still works (truly orphan); orphan section displays it | Webhook |
| T-21 | Orphan service columns | Call `fetchBrandStripeOrphanedRefunds(brandId)` | Query succeeds against real schema; returns expected shape | Service |
| T-22 | Order list filter "Refunded" | After T-01 lands a refund | Refunded pill shows count 1; order appears under filter | UI |
| T-23 | Order list filter "Cancelled" | After T-15 cancels a free order | Cancelled pill shows count 1; only the cancelled order shows | UI |
| T-24 | Failed order does not show as Cancelled | Inject `payment_status='failed'` via SQL | Order does NOT appear under Cancelled pill (current bug; this test catches regression) | UI |
| T-25 | RLS-RETURNING gap not triggered | Issue refund via edge fn (service-role bypass) | No 42501 error; refund row inserted; SELECT-after-INSERT succeeds via direct-predicate policy | RLS |
| T-26 | OrderStore stops writing refunds | Tap Refund order, complete it | `useOrderStore.entries[].refunds[]` is empty (or unchanged from pre-refund); React Query cache reflects new refund | Store + RQ |
| T-27 | Cross-platform parity | T-01 on iOS Simulator, Android Emulator, Web Browser | All three pass with identical UX | UX |
| T-28 | Live-fire RPC verification | Per `feedback_headless_qa_rpc_gap`: invoke `biz_refund_order` + `biz_refund_order_commit` through the real edge function caller path | RPC executes without `42883 row_to_jsonb` or similar PL/pgSQL type-resolution errors | RPC live-fire |

---

## §12 — Implementation Order

Strict sequential order. The implementor MUST complete each step before starting the next.

1. **Migration:** write `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql`. Includes §2.2 enum extension, §2.3 + §2.4 column adds, §2.5 new table, §2.6 RLS policies, §2.7 + §2.8 RPCs, §7.1 generated column on `payment_webhook_events`. Operator applies via `supabase db push --linked` and confirms via `mcp__supabase__list_migrations`.
2. **Generated TypeScript types:** regenerate via `mcp__supabase__generate_typescript_types` or whatever local script the repo uses. Commit only the types-file delta.
3. **Edge function: `refund-order/index.ts`** per §3.1. Local Deno test per §8.5 must pass before deploy.
4. **Edge function: `cancel-order/index.ts`** per §3.2. Local Deno test per §8.6 must pass.
5. **Webhook router extension:** modify `_shared/stripeWebhookRouter.ts` per §3.3. Add the three new event types. Modify `handleRefundUpdated` to handle the reconciliation. Add new companion RPC `biz_refund_order_commit_from_webhook` (service-role variant of `biz_refund_order_commit`).
6. **Service layer:** create `orderRefundService.ts` and `orderCancelService.ts` per §4.1 + §4.2. Modify `eventOrdersService.ts` per §4.3.
7. **Hook layer:** modify `useEventOrders.ts` per §5.1.
8. **Component layer:** modify order detail page per §6.1; modify `RefundSheet.tsx` per §6.2; modify `CancelOrderDialog.tsx` per §6.3; modify orders list page per §6.4; add deprecation markers per §6.5.
9. **Orphan service fix:** apply §7.1 + §7.2 + §7.3.
10. **Error mapping:** update `edgeFunctionError.ts` per §4.4.
11. **CI gates:** create `orch-0787-refund-cancel-flow.mjs` per §8.1, register in workflow per §8.2.
12. **Jest tests:** §8.3, §8.4, §8.7.
13. **Decision + invariant updates:** per §9 (operator applies the actual file edits to `DECISION_LOG.md` and `INVARIANT_REGISTRY.md` at CLOSE; the implementor only proposes the text in the implementation report).
14. **Operator deploys edge functions** via `supabase functions deploy refund-order` + `supabase functions deploy cancel-order` per `feedback_orchestrator_deploys_edge_functions.md`. Webhook router doesn't need its own deploy if it's bundled with `stripe-webhook`; verify in implementor report.
15. **Implementor report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0787_ORDER_REFUND_AND_CANCEL_PRODUCTION_GRADE.md` with old→new receipts per file, test results, and the deploy version verification.

---

## §13 — Regression Prevention

### §13.1 Class of bug being prevented

**Stub UX shipped to production with no exit condition or wiring deadline.** Cycle 9c shipped the Refund/Cancel surfaces as `[TRANSITIONAL]` "wires when B-cycle adds real Stripe" — but the B-cycle landed (ORCH-0777) without wiring it, and the stub silently shipped to production for months. The structural safeguard:

1. **Strict-grep gate #3** flags any hardcoded `const showRefundFull = false;` pattern. Future code cannot ship a hardcoded action-flag-off pattern without a CI failure.
2. **Strict-grep gate #4 + #5** prevents the RefundSheet / CancelOrderDialog from regressing back to Zustand-only writes.
3. **Strict-grep gate #2** prevents the `'failed' → 'cancelled'` mapping from coming back.
4. **Strict-grep gate #6 + #7** prevents Stripe SDK inline-instantiation in the refund-order function (I-PROPOSED-Q regression).
5. **Invariant I-PROPOSED-(REFUND-AUTHORITY-PLATFORM-DESTINATION)** locks the destination-charge refund model in code.

### §13.2 Protective comments (allowed in code per Mingla style)

The few protective comments allowed:
- On the `biz_refund_order` RPC: `-- ORCH-0787: do NOT advance orders.payment_status here. Use biz_refund_order_commit after Stripe acks. Refund row stays 'pending' between the two calls; webhook reconciles if Stripe responds before commit fires.`
- On `tickets.status` flip in `biz_refund_order_commit`: `-- Defense-in-depth (Q-4): scanner gates on payment_status<>'paid' AND on tickets.status='valid'. Both must flip together.`
- On the new direct-predicate SELECT policy on `public.refunds`: `-- Prevents RLS-RETURNING-OWNER-GAP (I-PROPOSED-H). The helper-based policy fails under .insert().select() chains.`

No other comments. The strict-grep CI gates carry the rest.

---

## §14 — Open Questions Resolved (no remaining SPEC-blocking questions)

All 10 questions from investigation §7 are resolved (operator-locked Q-1/2/7/8; defaults baked in for Q-3/4/5/6/9/10). Spec is implementation-ready.

---

## §15 — Discoveries for Orchestrator

- **ORCH-0788 should be registered** for the `useOrderStore` full ID-only contraction (Q-8 v1 defers the full exit; v1 stops new writes only). Suggested seed evidence: `mingla-business/src/store/orderStore.ts` `[DEPRECATED-IN-ORCH-0787]` markers, `feedback_zustand_persist_no_server_snapshots.md`. Score: P2 / Investigate Next.
- **ORCH-0785 dependency:** ORCH-0787 ships placeholder email templates for `buyer_refund_issued` and `buyer_order_cancelled`. ORCH-0785 must adopt these template keys and the `payload` shape codified in §3.1 step 9. Coordinate the close order: ORCH-0787 can close before ORCH-0785 with placeholder copy live; ORCH-0785 replaces the templates without touching the dispatch contract.
- **Event-edit-log + parent notification rollup** previously fired from `RefundSheet.handleConfirm` are removed in v1 (§6.2). If ORCH-0782 (resend-ticket + rollup) requires them, ORCH-0782's SPEC must re-introduce via the `useRefundOrder().onSuccess` callback or via a server-side trigger on `public.refunds.status='succeeded'`.
- **Webhook idempotency contract.** A latent concern: the in-app edge function inserts `public.refunds` with `status='pending'` BEFORE calling Stripe; if Stripe responds and a `refund.created` webhook fires before `biz_refund_order_commit` runs, the webhook handler might "win" by upserting on `stripe_refund_id` (which is NULL on the pending row). Mitigation: the webhook UPSERT must check for an existing pending row with matching `idempotency_key` in `metadata` first; if present, advance THAT row instead of creating a new one. Spec captures this in §3.3 step 3 ("If a row already exists with this `stripe_refund_id`..."); implementor must implement the metadata-key fallback as a second match path. **This is the single highest-risk implementation detail** — tester MUST validate via T-19.

---

**End of SPEC — ORCH-0787.**

Next dispatch: Codex `implementor-mingla`, following this spec verbatim.
