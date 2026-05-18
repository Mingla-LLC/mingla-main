# SPEC — ORCH-0869 [Tr3 Installment Payments]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md`
**Milestone brief:** `Mingla_Artifacts/milestones/Tr3_INSTALLMENT_PAYMENTS.md`
**Author confidence:** H — operator-locked Option B (scheduled PaymentIntents); 8 Open SPEC Questions answered per investigation §10 recommendations (any can still be overridden by operator before implementor dispatch).

---

## 0. Layman summary

Build the first WeTravel-parity feature on Track 1: trip planners configure deposit + N installments on the pricing step; buyers see the schedule plainly at checkout; deposit charges via existing Stripe checkout AND saves the buyer's card for future use; a daily cron edge function auto-charges due installments per the schedule; failed installments fire dunning emails via the existing Resend pipeline and flag the booking "at risk" in the planner's dashboard after 3 retries; manual retry available from the Money tab on the trip dashboard. Schema, code paths, and CI gates are scoped to trips only (events stay single-payment as today). Refunds are Tr4 scope; Tr3 only schedules + collects.

---

## 1. Scope

### In scope

- New DB migration `20260610000000_tr3_installments.sql` creating `order_installments` ledger table + 1 JSONB column on `trip_pricing_tiers` (per investigation H-1 decision)
- New cron-scheduled edge function `process-scheduled-installments` (pg_cron-invoked every 6 hours; idempotent loop)
- Modified edge function `ticket-checkout-create` (add `setup_future_usage: "off_session"` conditional on schedule; add metadata for webhook discrimination)
- Modified `_shared/stripeWebhookRouter.ts` (add 2 new handler discriminators for installment PI metadata)
- New shared email helper `_shared/email/installmentDunningEmail.ts` (modeled on existing `tripConfirmationEmail.ts`)
- New RPC `biz_retry_installment(installment_id uuid)` for manual operator retry
- New mingla-business components: `PaymentPlanEditor.tsx` + `InstallmentScheduleDisplay.tsx`
- New mingla-business hook: `useOrderInstallments.ts`
- New mingla-business service: `orderInstallmentsService.ts`
- Modified `TripCreatorStep4Pricing.tsx` + `TripCheckoutFlow.tsx` + `tripCheckoutService.ts`
- New buyer-anon-web display in `app/checkout/[eventId]/index.tsx` + `buyer.tsx` + `payment.tsx`
- New "Money" tab on `app/trip/[id]/index.tsx` (Overview / Travelers / Money — joins existing tab pattern from Tr2)
- 4 new invariants flipping DRAFT → ACTIVE on close
- 3 CI gates (1 per invariant + 1 for routing discipline)
- Regression-test gate per ORCH-0840 [Regression-test enforcement] (implementor happy-path + tester adversarial)

### Non-goals (defer)

- **Refund engine** — Tr4 scope. Tr3 ledger schema is Tr4-ready (carries `stripe_payment_intent_id` per installment), but refund computation + cascading-tier refund engine + buyer-side refund UX are Tr4.
- **Installment plans on events (event_type='event')** — Hard Guard per brief. UI + RPC validation both reject.
- **Buyer-initiated voluntary "pay early"** — investigation O-4 defer; future ORCH.
- **Currency mixing within one schedule** — investigation O-5 lock; one currency per schedule, multiple schedules can be multi-currency.
- **More than 12 installments** (1 deposit + 11 future) — investigation O-6 lock; future ORCH if operators request.
- **Stripe Link off-session reuse** — investigation H-2 v1 exclusion; installments use card-only.
- **Stripe Tax on installment PIs** — investigation H-3; same gap as the existing native PI path per ORCH-0804-A deferral. Brand carries tax compliance on installment payments.
- **Per-installment custom application-fee rate** — investigation O-1; reuse ORCH-0843 hardcoded 1.5% rate on each installment PI.
- **Discount codes on installment-eligible trips** — out of scope; brief doesn't mention; future ORCH.
- **WeTravel-style "auto-adjust on late bookings" for bookings created AFTER one or more scheduled installment dates have passed** — defer to v1.1. Tr3 v1 rejects bookings where the schedule's first installment is already past-due at booking time (validation in `biz_ticket_checkout_create_session` RPC); SPEC §7 names the validation check.

### Assumptions

- pg_cron v1.6.4 + pg_net v0.19.5 are installed on the production Supabase project (verified live via `mcp__supabase__list_extensions` 2026-05-17).
- ORCH-0843 direct-charge + ORCH-0844 connected-account Customer + ephemeralKey + ORCH-0849 payment-method allowlist patterns are stable in production (all closed per WORLD_MAP).
- ORCH-0785 dunning email pipeline (Resend) is operational; new `installmentDunningEmail.ts` reuses `_shared/email/senders.ts` + `shell.ts` + `genericBody.ts` patterns.
- Tr2 [Minimum Viable Trip] migrations `20260608000000_orch_0859_trip_sidecar_tables.sql` + `20260608000100_orch_0859_publish_rpc_trip.sql` + `20260609000000_orch_0859_trip_publish_slug_flag.sql` are deployed on the production Supabase project.

---

## 2.5. Cross-Surface Impact (MANDATORY per `feedback_cross_surface_impact_inspection.md`)

| # | Surface | In scope | Files touched | Parity | User-visible behaviour |
|---|---|---|---|---|---|
| 1 | Consumer iOS | **NO** | `app-mobile/` untouched | n/a | No change — trips not on consumer app per Tr2 scope. |
| 2 | Consumer Android | **NO** | `app-mobile/` untouched | n/a | No change. |
| 3 | Buyer/anonymous Web | **YES** | `mingla-business/app/checkout/[eventId]/index.tsx`, `buyer.tsx`, `payment.tsx` | Manual per route — each route has its own SC | Buyer sees `InstallmentScheduleDisplay` ("$X today + $Y on Jan 15 + $Y on Feb 15") above line-item summary on all 3 checkout steps when the trip has an installment_schedule. Deposit charges at booking via existing Stripe Checkout / PaymentSheet path with `setup_future_usage:'off_session'` injected. Future installments auto-charge via cron; failed installments fire dunning email to buyer email + add `pm_update` link. |
| 4 | Business iOS | **YES** | New `PaymentPlanEditor.tsx`, `InstallmentScheduleDisplay.tsx`, new Money tab on `app/trip/[id]/index.tsx`, modified `TripCreatorStep4Pricing.tsx` + `TripCheckoutFlow.tsx` | Automatic (shared RN source) | Planner sees Payment plan toggle on trip wizard Step 4 Pricing → can configure deposit % + N installments. Trip dashboard gains "Money" tab showing per-traveler installment status with status pills + manual Retry button on failed rows. |
| 5 | Business Android | **YES** | Shared RN source with iOS | Automatic | Same as Business iOS. |
| 6 | Admin Web | **NO** | `mingla-admin/` untouched | n/a | Admin doesn't render trip-ops dashboards yet — future admin-side trip-ops surface is a separate ORCH. |
| 7 | Business Web preview | **YES** | Shared RN-Web bundle from Business iOS/Android | Automatic | Same as Business iOS/Android (preview parity already proven by Tr2). |

### Per-surface success criteria (manual parity = separate SCs)

Because the 3 buyer-anon checkout routes are SEPARATE files (`index.tsx`, `buyer.tsx`, `payment.tsx`), parity is MANUAL — each route needs its own success criterion. SPEC §4 below uses sub-numbered criteria SC-5a / SC-5b / SC-5c for these three so the implementor can't ship one and skip another.

---

## 3. Per-Layer Specification

### 3.1 Database layer

**Migration file:** `supabase/migrations/20260610000000_tr3_installments.sql` (timestamp strictly greater than the existing max `20260609000000` per monotonic-migration-filename rule).

```sql
-- ORCH-0869 [Tr3 Installment Payments] migration.
-- Per SPEC §3.1.
-- Pre-state: Tr2 sidecar migration 20260608000000 created trip_pricing_tiers with
-- tier_metadata jsonb DEFAULT '{}' — Tr3 populates the .installments key per investigation H-1.

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
  CHECK (
    (status <> 'collected') OR
    (stripe_payment_intent_id IS NOT NULL AND collected_at IS NOT NULL)
  ),
  -- failed implies failed_at + failure_reason
  CHECK (
    (status <> 'failed') OR
    (failed_at IS NOT NULL AND failure_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.order_installments IS
  'ORCH-0869 (Tr3): per-installment ledger for trip orders with payment plans. One row per scheduled installment. Status flow: scheduled -> (collected | failed). Failed -> retried by cron up to 3 times; if all 3 retries fail, orders.at_risk=true. Refunded transition is Tr4 scope. Cancelled covers operator-initiated plan cancellation.';

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

-- Buyer reads own installments via the orders join (orders.account_id maps to auth.uid()
-- for signed-in buyers; anonymous buyers cannot read at all — they use buyer_status_token
-- via the existing checkout-session lookup path, NOT direct table SELECT).
CREATE POLICY order_installments_read_buyer ON public.order_installments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_installments.order_id
        AND o.account_id IS NOT NULL
        AND o.account_id = auth.uid()
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

-- INSERT/UPDATE/DELETE: ONLY service role (cron edge function + finalize RPCs).
-- No user-facing policy. The biz_retry_installment RPC is SECURITY DEFINER and
-- writes via the service-role context.

-- ---------------- orders columns added ----------------
ALTER TABLE public.orders
  ADD COLUMN at_risk boolean NOT NULL DEFAULT false,
  ADD COLUMN at_risk_since timestamptz,
  ADD COLUMN installment_plan_root boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.at_risk IS
  'ORCH-0869 (Tr3): true when 3 consecutive installment retries have failed per Acceptance Criterion #9. Operator dashboard surfaces flagged orders.';

COMMENT ON COLUMN public.orders.installment_plan_root IS
  'ORCH-0869 (Tr3): true when this order was booked under an installment plan. The order row itself represents the deposit charge; child order_installments rows represent future installments.';

CREATE INDEX idx_orders_at_risk
  ON public.orders(at_risk, brand_id)
  WHERE at_risk = true;

-- ---------------- pg_cron schedule ----------------
-- pg_cron extension verified live 2026-05-17 (v1.6.4). pg_net v0.19.5 enables
-- async HTTP from postgres to invoke edge functions.
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

-- ---------------- biz_retry_installment RPC ----------------
CREATE OR REPLACE FUNCTION biz_retry_installment(p_installment_id uuid)
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
  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  v_is_member := biz_is_brand_member_for_read_for_caller(v_event.brand_id);
  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- Flag for immediate retry on next cron run (next_retry_at = now())
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

REVOKE ALL ON FUNCTION biz_retry_installment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biz_retry_installment(uuid) TO authenticated;

-- ---------------- Self-verification probe ----------------
DO $$
DECLARE
  table_count int;
  policy_count int;
  column_count int;
BEGIN
  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'order_installments';
  IF table_count != 1 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: order_installments table missing';
  END IF;

  SELECT count(*) INTO policy_count FROM pg_policy
  WHERE polrelid = 'public.order_installments'::regclass;
  IF policy_count != 2 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: expected 2 RLS policies on order_installments, got %', policy_count;
  END IF;

  SELECT count(*) INTO column_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name IN ('at_risk', 'at_risk_since', 'installment_plan_root');
  IF column_count != 3 THEN
    RAISE EXCEPTION 'ORCH-0869 migration: expected 3 new columns on orders, got %', column_count;
  END IF;

  RAISE NOTICE 'ORCH-0869 migration complete: order_installments + 2 RLS + 3 orders columns + biz_retry_installment + pg_cron schedule.';
END $$;

COMMIT;
```

**Notes on the schema decision per investigation H-1:** SPEC chose `trip_pricing_tiers.tier_metadata.installments` over `ticket_types.installment_schedule` because Tr2 migration already reserved it AND because installments are trip-specific and the shared `ticket_types` table is used by event tickets which Hard Guard #3 explicitly forbids from installment plans. The TS shape of `tier_metadata.installments`:

```ts
type TripPricingTierMetadata = {
  installments?: {
    deposit_pct: number;            // 0 < x <= 100
    installments: Array<{
      ordinal: number;              // 1-based
      pct: number;                  // sum across installments + deposit_pct === 100
      // Exactly one of these two MUST be set:
      days_after_booking?: number;  // >= 1
      fixed_date?: string;          // ISO 8601 date (UTC date, time component ignored)
    }>;
  };
};
```

Validation at the publish RPC (existing `biz_event_publish_v2` or trip-specific equivalent — see SPEC §3.2) MUST reject malformed `tier_metadata.installments`: sum-check on percentages, ordinal monotonicity, no duplicate ordinals, exactly one of `days_after_booking | fixed_date` per installment, deposit_pct in (0, 100], at most 11 installments (deposit + 11 = 12 total per investigation O-6).

### 3.2 Edge function layer

#### 3.2.1 NEW: `supabase/functions/process-scheduled-installments/index.ts`

**Trigger:** pg_cron every 6 hours (per migration §3.1). Service-role auth required (no anon access).

**Request shape:**
```ts
// Body: {} OR { dryRun?: boolean, limit?: number }
type ProcessScheduledInstallmentsRequest = {
  dryRun?: boolean;  // if true, log what WOULD be charged but don't actually call Stripe
  limit?: number;    // safety cap on installments per run (default 500)
};
```

**Response shape:**
```ts
type ProcessScheduledInstallmentsResponse = {
  processed: number;     // installments attempted
  collected: number;     // PI succeeded
  failed: number;        // PI failed (will retry on next cron)
  at_risk_flagged: number;  // orders newly flagged at_risk this run
  errors: Array<{ installment_id: string; reason: string }>;
};
```

**Logic:**

1. Authenticate via service-role header (request from pg_cron → pg_net → edge function carries `SUPABASE_SERVICE_ROLE_KEY`).
2. Query `order_installments` WHERE `status='scheduled' AND due_at <= now()` ORDER BY `due_at ASC` LIMIT `limit`. Also query `status='failed' AND next_retry_at <= now()` separately.
3. For each row:
   - Join to `orders` + `events` + `brands` to get `stripe_account_id` (connected account).
   - Read `orders.stripe_customer_id_on_connected_account` (new column added in §3.2.2 modification) for the saved Customer.
   - Read `orders.saved_payment_method_id` (new column added in §3.2.2) for the saved PM.
   - Build idempotency-key: `installment:${order_id}:${ordinal}:${retry_count}` (different per retry attempt).
   - Call `stripe.paymentIntents.create({ amount, currency, customer, payment_method, confirm: true, off_session: true, payment_method_types: ['card'], application_fee_amount: Math.round(amount * 0.015), metadata: { mingla_installment_id, mingla_installment_ordinal, mingla_order_id, mingla_brand_id } }, { idempotencyKey, stripeAccount })`.
   - On success: update row `status='collected', stripe_payment_intent_id=pi.id, stripe_charge_id=pi.latest_charge, collected_at=now()`. Write audit row.
   - On failure: update row `status='failed', failed_at=now(), failure_reason=err.message, retry_count=retry_count+1, next_retry_at=now() + interval based on retry_count` (Day-3 for retry 1, Day-7 for retry 2). If `retry_count >= 3`, set `orders.at_risk=true, at_risk_since=now()` and skip further retries. Fire `installmentDunningEmail` via `dispatchNotification`. Write audit row.
4. Return summary.

**Error handling:** Wrap each installment in its own try/catch — a single failing row must NOT abort the whole cron run. Service-level errors (Supabase unreachable, Stripe-wide outage) log + return 500 (pg_cron will retry on next schedule).

**Idempotency:** Per-installment per-retry idempotency-key. Cron is safe to invoke twice — Stripe will return the existing PI on duplicate idempotency-key. DB writes use `UPDATE ... WHERE status='scheduled'` so a second concurrent invocation can't double-write.

**File path constraint:** all installment-charge logic lives in this file — per new invariant `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER`, no other code path may create installment PIs.

#### 3.2.2 MODIFIED: `supabase/functions/ticket-checkout-create/index.ts`

Changes are surgical:

1. **Add `setup_future_usage` to PI create body** (lines 463-485) when the trip has an installment_schedule:

```ts
// NEW: read the trip's installment_schedule from trip_pricing_tiers (joined in session RPC)
const hasInstallmentSchedule = session.installmentSchedule != null;
const piCreateBody: Record<string, unknown> = {
  amount: totalCents,
  currency,
  payment_method_types: hasInstallmentSchedule ? ['card'] : [...getPaymentMethodTypes()],  // installment plans card-only per investigation H-2
  metadata: {
    mingla_checkout_session_id: checkoutSessionId,
    mingla_event_id: eventId,
    mingla_buyer_email: buyerEmail,
    // NEW for Tr3:
    ...(hasInstallmentSchedule ? { mingla_installment_plan_root: 'true' } : {}),
  },
  ...(hasInstallmentSchedule ? { setup_future_usage: 'off_session' } : {}),
};
```

2. **Same change for the web/mobile-web hosted-checkout branch** (line 310-329 payment_intent_data): inject `setup_future_usage` into `payment_intent_data` and restrict `payment_method_types` (via `payment_method_options` for Checkout) to card-only when installment plan.

3. **Web/mobile-web cancel-url consideration:** existing cancel-url logic unchanged. The `setup_future_usage` config only takes effect when the PI completes successfully; cancelled checkouts produce no saved PM, no schedule.

4. **Session RPC `biz_ticket_checkout_create_session`** must be amended to return `installmentSchedule` from the trip's `trip_pricing_tiers.tier_metadata.installments` AND must validate that the buyer's order amount === sum of all installments (sanity check). Migration §3.1 already includes the validation in spirit; the RPC change is a separate sub-migration `20260610000001_tr3_ticket_checkout_session_installment_aware.sql`.

5. **NEW columns on orders for cron access:** the finalize RPC `biz_ticket_checkout_finalize` (existing) must persist `stripe_customer_id_on_connected_account` (from the ORCH-0844 Customer create) AND `saved_payment_method_id` (from the PI's `payment_method` field on succeeded status) for the cron to use later. Add these columns in the migration in §3.1 (forgot to include above — add as ALTER TABLE in the same migration).

#### 3.2.3 MODIFIED: `supabase/functions/_shared/stripeWebhookRouter.ts`

Add metadata-discriminator branches:

```ts
// In existing payment_intent.succeeded handler:
if (event.data.object.metadata?.mingla_installment_id) {
  await handleInstallmentPaymentSucceeded(supabase, event);
  return;
}
// Existing ticket-checkout PaymentIntent succeeded handler proceeds for non-installment PIs.

// Same for payment_intent.payment_failed:
if (event.data.object.metadata?.mingla_installment_id) {
  await handleInstallmentPaymentFailed(supabase, event);
  return;
}
```

Two new handler functions in a NEW file `supabase/functions/_shared/installmentWebhookHandlers.ts`:

- `handleInstallmentPaymentSucceeded`: write `order_installments.status='collected'`, `collected_at`, `stripe_payment_intent_id`, `stripe_charge_id`. Write audit. If this was the LAST installment for the order (`ordinal === max(ordinal)`), fire a "fully paid" confirmation email.
- `handleInstallmentPaymentFailed`: write `status='failed'`, `failed_at`, `failure_reason`, increment `retry_count`. Compute `next_retry_at` based on retry_count (Day-3, Day-7, or stop). If `retry_count >= 3`, set `orders.at_risk=true`. Fire `installmentDunningEmail` (UNLESS the cron already fired it during its own attempt — use dedup by idempotency-key in the audit log).

**Webhook fall-through:** if metadata `mingla_installment_id` is set but NOT a recognised installment in the DB, log + audit + return ok (don't 500 — Stripe retries 500s, which would flood).

#### 3.2.4 NEW: `supabase/functions/_shared/email/installmentDunningEmail.ts`

Modeled on existing `tripConfirmationEmail.ts`. Sends Resend email to the buyer with:
- Subject: "Action needed: payment for [TripName]" (locked copy; the same string is hardcoded in the brief context — SPEC owns final copy).
- Body via existing `shell.ts` + `genericBody.ts` patterns.
- Failure reason rendered plainly: "Your card was declined. Update your payment method to keep your spot."
- CTA button: "Update payment method" → links to a new buyer-anon-web page `/buyer/installment/[order_id]?token=<buyer_status_token>` where the buyer can re-attach a card.
- Includes the next scheduled installment dates + amounts so the buyer sees the plan they're maintaining.

**New `/buyer/installment/[order_id]` page is OUT OF SCOPE for SPEC §1** — defer to v1.1; the v1 dunning email instead deep-links to the public event page where the buyer must contact the operator. SPEC explicit: v1 dunning email has CTA "Contact organizer" linking to `mailto:${brand.contact_email}` with a pre-filled subject. The buyer-can-self-update-PM flow is registered as a follow-up ORCH for SPEC §11.

### 3.3 Service layer

#### 3.3.1 NEW: `mingla-business/src/services/orderInstallmentsService.ts`

```ts
export type OrderInstallmentStatus = 'scheduled' | 'collected' | 'failed' | 'refunded' | 'cancelled';

export type OrderInstallment = {
  id: string;
  orderId: string;
  ordinal: number;
  amountCents: number;
  currency: string;
  dueAt: string;          // ISO 8601
  status: OrderInstallmentStatus;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  collectedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  nextRetryAt: string | null;
};

// Throws on error per services contract.
export async function fetchInstallmentsForOrder(orderId: string): Promise<OrderInstallment[]> { /* ... */ }

export async function fetchInstallmentsForBrandTrips(brandId: string, opts?: { atRiskOnly?: boolean }): Promise<OrderInstallment[]> { /* ... */ }

// Calls biz_retry_installment RPC.
export async function retryInstallment(installmentId: string): Promise<{ ok: true } | { ok: false; reason: string }> { /* ... */ }
```

**Error contract:** services throw on error (per Mingla services contract). Return `{ ok: false, reason }` for biz-logic rejections (not-found, unauthorized, not-failed) per the RPC return shape.

#### 3.3.2 MODIFIED: `mingla-business/src/services/tripCheckoutService.ts`

Add `installmentSchedule` parameter to the existing checkout-session create path. Pass through to the edge function in the request body. No new edge function call — same `ticket-checkout-create` enriched.

### 3.4 Hook layer

#### 3.4.1 NEW: `mingla-business/src/hooks/useOrderInstallments.ts`

```ts
// Query keys via existing query-key factory pattern.
export const orderInstallmentKeys = {
  all: ['orderInstallments'] as const,
  byOrder: (orderId: string) => [...orderInstallmentKeys.all, 'byOrder', orderId] as const,
  byBrand: (brandId: string, opts?: { atRiskOnly?: boolean }) => [...orderInstallmentKeys.all, 'byBrand', brandId, opts ?? {}] as const,
};

export function useInstallmentsForOrder(orderId: string | null) {
  return useQuery({
    queryKey: orderInstallmentKeys.byOrder(orderId ?? ''),
    queryFn: () => fetchInstallmentsForOrder(orderId!),
    enabled: orderId !== null,
    staleTime: 30_000,  // 30s — installment state changes via cron + webhook
  });
}

export function useInstallmentsForBrandTrips(brandId: string | null, opts?: { atRiskOnly?: boolean }) {
  return useQuery({
    queryKey: orderInstallmentKeys.byBrand(brandId ?? '', opts),
    queryFn: () => fetchInstallmentsForBrandTrips(brandId!, opts),
    enabled: brandId !== null,
    staleTime: 30_000,
  });
}

export function useRetryInstallment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installmentId: string) => retryInstallment(installmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderInstallmentKeys.all });
    },
    onError: (err) => {
      // Per Mingla mutation contract: surface to user via toast
      showToast({ kind: 'error', message: "Couldn't trigger retry. Try again." });
    },
  });
}
```

### 3.5 Component layer

#### 3.5.1 NEW: `mingla-business/src/components/trip/PaymentPlanEditor.tsx`

```ts
type PaymentPlanEditorProps = {
  value: TripInstallmentSchedule | null;
  onChange: (next: TripInstallmentSchedule | null) => void;
  totalAmountCents: number;
  currency: string;
};

type TripInstallmentSchedule = {
  deposit_pct: number;
  installments: Array<{
    ordinal: number;
    pct: number;
    days_after_booking?: number;
    fixed_date?: string;
  }>;
};
```

**States:**
- Empty (toggle off / "Full price"): no installment UI shown; CTA "Add a payment plan".
- Populated: deposit % stepper + N installment rows + "+ Add installment" button.
- Editing: live validation — sum of pct === 100, no duplicate ordinals, due dates monotonically increasing if fixed_date used.
- Error: inline error text under the violating field.

**Interactions:**
- Toggle on/off (clear schedule on off).
- Deposit % stepper (5% increments, range 10-100%).
- Per-installment: pct stepper + date-mode toggle (`days_after_booking` | `fixed_date`) + the chosen mode's input.
- Drag-reorder NOT supported in v1 — `ordinal` is auto-assigned by array position.
- "+ Add installment" up to 11 max.
- Trash icon per installment row.

**Validation copy:**
- "Percentages must add to 100% (currently 95%)."
- "Installment 2 due before installment 1 — fix dates."
- "Maximum 11 installments after deposit."

**Accessibility:**
- All steppers have `accessibilityLabel` + `accessibilityValue`.
- Date inputs are native pickers.
- Error text linked via `accessibilityLabelledBy`.

#### 3.5.2 NEW: `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`

Read-only display used inside `TripCheckoutFlow` + the 3 buyer-anon-web checkout routes. Renders:

```
Deposit today        $300.00
Jan 15, 2026         $400.00
Feb 15, 2026         $400.00
————————————
Total                $1,100.00
```

Currency-formatted per locale. Past-due installments (for late bookings — currently rejected at the RPC) would render in red — not used in v1 since rejection prevents past-due plans.

#### 3.5.3 NEW: `mingla-business/app/trip/[id]/index.tsx` — "Money" tab

Per investigation O-7 — add a third tab alongside the existing Overview + Travelers tabs (matches Tr2 dashboard pattern). New `tab === 'money'` branch renders:

- Per-traveler list grouped by booking.
- Each booking row: traveler name, total amount, installments-paid / installments-total, next-due-date, status pill, expand-row caret.
- Expanded: full installment list with status pill per row + "Retry" button on failed rows.
- "At risk" badge on bookings where `orders.at_risk = true`.
- "Refund" CTA is a STUB (Tr4) — renders disabled with tooltip "Refunds coming in Tr4".

#### 3.5.4 MODIFIED: `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`

Render `<PaymentPlanEditor>` below the existing single-price input, gated behind a toggle "Add a payment plan."

#### 3.5.5 MODIFIED: `mingla-business/src/components/trip/TripCheckoutFlow.tsx`

Render `<InstallmentScheduleDisplay>` above the existing line-item summary when the trip has an installment schedule.

#### 3.5.6 MODIFIED: `mingla-business/app/checkout/[eventId]/index.tsx` + `buyer.tsx` + `payment.tsx`

Render `<InstallmentScheduleDisplay>` above the line-item summary on each step. Three separate edits — each is its own SC for parity.

### 3.6 Realtime

Not in scope for Tr3 v1. The Money tab uses React Query polling (`staleTime: 30_000`) and pull-to-refresh. Realtime subscription on `order_installments` changes is deferred — webhook + manual refresh is sufficient for v1.

---

## 4. Success Criteria

| # | Criterion |
|---|---|
| SC-1 | Trip wizard Pricing step shows a "Payment plan" toggle. Toggle off = single full-price (current Tr2 behavior). Toggle on = `PaymentPlanEditor` renders below. |
| SC-2 | `PaymentPlanEditor` accepts: deposit % (10-100, 5% steps), 1-11 future installments, each with pct + due-date mode (`days_after_booking` OR `fixed_date`). Sum-validation: deposit_pct + sum(installments[].pct) === 100. Live error text on violation. |
| SC-3 | Publishing a trip with valid installment_schedule persists to `trip_pricing_tiers.tier_metadata.installments` JSONB. Schema-validation at `biz_event_publish_v2` (or trip publish RPC) rejects malformed schedules. |
| SC-4 | `order_installments` ledger table + 3 new orders columns (`at_risk`, `at_risk_since`, `installment_plan_root`) + biz_retry_installment RPC + pg_cron schedule all created by migration `20260610000000_tr3_installments.sql` with self-verification probe passing. |
| SC-5a | Buyer on `/checkout/{eventId}/index.tsx` sees `InstallmentScheduleDisplay` above the line-item summary when the trip has an installment_schedule. |
| SC-5b | Buyer on `/checkout/{eventId}/buyer.tsx` sees the same display. |
| SC-5c | Buyer on `/checkout/{eventId}/payment.tsx` sees the same display. |
| SC-6 | Deposit payment at booking saves the buyer's PaymentMethod to the connected-account Customer (via `setup_future_usage: 'off_session'` on the PI / Hosted Checkout). The finalize RPC writes `orders.stripe_customer_id_on_connected_account` + `orders.saved_payment_method_id`. |
| SC-7 | New cron edge function `process-scheduled-installments` runs on the pg_cron schedule. On each run, queries `order_installments WHERE status='scheduled' AND due_at <= now()`, creates a PI per row with `confirm:true, off_session:true, payment_method:<saved-pm>, customer:<connected-account-customer>, stripeAccount:<account-id>`, idempotency-key `installment:${order_id}:${ordinal}:${retry_count}`. |
| SC-8 | On successful installment PI (webhook `payment_intent.succeeded` with metadata `mingla_installment_id`), `order_installments.status` flips to `collected`, `collected_at`, `stripe_payment_intent_id`, `stripe_charge_id` populated. |
| SC-9 | On failed installment PI (webhook `payment_intent.payment_failed`), `order_installments.status` flips to `failed`, `failed_at`, `failure_reason` populated, `retry_count++`. `next_retry_at` set to now()+3d (retry 1) or now()+7d (retry 2). Dunning email fires via Resend. If retry_count >= 3, `orders.at_risk=true`. |
| SC-10 | "Money" tab on `app/trip/[id]/index.tsx` shows per-traveler installment list with status pills + "At risk" badge on flagged bookings. |
| SC-11 | "Retry" button on failed installment rows in Money tab calls `biz_retry_installment` RPC; on success, row flips to `scheduled` with `next_retry_at = now()` so the next cron run picks it up. |
| SC-12 | Refund engine in Tr4 can read `order_installments` ledger and target individual installments by `stripe_payment_intent_id` (schema-readiness check — no Tr4 code shipped). |
| SC-13 | Existing non-installment event checkout flow unchanged: no `order_installments` rows created, no `setup_future_usage`, no `at_risk` flag, no new columns populated. Verified by regression test. |
| SC-14 | Existing non-installment trip checkout flow unchanged: same as SC-13. |
| SC-15 | Failed deposit at booking does NOT write `order_installments` rows (transaction rolls back in finalize RPC). |
| SC-16 | Cron edge function is idempotent: running twice on the same `order_installments` row creates one PI (Stripe returns existing PI on duplicate idempotency-key), one DB UPDATE (concurrent UPDATE serialized by `WHERE status='scheduled'` predicate). |
| SC-17 | Late-booking rejection: trips with `installment_schedule` where the first installment's `due_at <= now()` at booking time are rejected by `biz_ticket_checkout_create_session` RPC with error `installment_schedule_past_due_at_booking`. Deferred WeTravel auto-adjust behavior is documented as v1.1 follow-up. |
| SC-18 | Buyer dunning email fires via Resend on every `payment_intent.payment_failed` for installment metadata. Email body includes: trip name + failed installment amount + failure reason + "Contact organizer" CTA linking to `mailto:${brand.contact_email}`. |
| SC-19 | Operator audit log captures every installment PI attempt (success + failure) + every at_risk flip + every manual retry. Audit table: existing `audit_logs` via `_shared/audit.ts`. |
| SC-20 | All 3 CI strict-grep gates report 0 violations on the closing PR (1 per new invariant in §5). |

---

## 5. Invariants

### Preserved (no violations expected — see investigation §11)

- I-PROPOSED-O / P / Q / R / S / T (Stripe family) — installment PI uses pinned API version, idempotency-keys, audit logs, country allowlist, embedded-components-SDK-only — all unchanged.
- I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY / I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST — installment PI uses `['card']` only per investigation H-2 (subset of the allowlist).
- I-PROPOSED-J — Zustand persist no server snapshots — no Zustand changes.
- I-PROPOSED-TR2-* (3 invariants from ORCH-0866 close) — new components MUST follow.

### New invariants (DRAFT → ACTIVE on close)

#### I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER

**Rule.** Installment PaymentIntent creation may ONLY originate from `supabase/functions/process-scheduled-installments/index.ts` OR the manual-retry RPC `biz_retry_installment` (which delegates to the cron function). Any other call site that creates a PI carrying the metadata `mingla_installment_id` is FORBIDDEN.

**Why.** Centralizing installment PI creation in one file makes the idempotency-key contract, retry-cadence logic, at_risk-flip logic, and dunning-email dispatch enforceable. A drift to a second installment-PI creator would split the at_risk count + dunning cadence between two implementations.

**Enforcement.** `.github/scripts/strict-grep/i-proposed-tr3-installment-pi-via-cron-owner.mjs` (CI gate) scans for `paymentIntents.create` calls in any TS file where the surrounding 10 lines contain `installment` (case-insensitive). The allowlist tag `// orch-strict-grep-allow tr3-installment-pi-via-cron-owner — <reason>` plus the file paths `process-scheduled-installments/index.ts` + the RPC file pass.

#### I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY

**Rule.** No code path may delete a connected-account Stripe Customer that has any `order_installments` rows with `status='scheduled'` for orders bound to that Customer. No code path may revoke a saved PaymentMethod that's the active PM for an order with pending installments.

**Why.** Installment auto-charges depend on the saved Customer + PaymentMethod persisting for the full schedule duration (could be 6+ months). Deleting the Customer mid-schedule breaks every future installment for that order.

**Enforcement.** `.github/scripts/strict-grep/i-proposed-tr3-installment-customer-durability.mjs` scans for `stripe.customers.del(` and `stripe.paymentMethods.detach(` calls. Each call site must either (a) have a comment within 5 lines above proving the pre-check `SELECT count(*) FROM order_installments WHERE order_id IN (orders for this customer) AND status='scheduled'` returned 0, OR (b) carry allowlist tag.

#### I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID

**Rule.** `order_installments.status='collected'` rows MUST have non-null `stripe_payment_intent_id` AND non-null `collected_at`. `order_installments.status='failed'` rows MUST have non-null `failed_at` AND non-null `failure_reason`.

**Why.** Pure DB integrity — prevents stale or partial state that breaks Tr4 refund logic.

**Enforcement.** SQL `CHECK` constraints already in the migration (§3.1).

#### I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH

**Rule.** All `order_installments` rows for a given `order_id` MUST share the same `currency`. The `currency` field on each installment is set at order finalize from the trip's currency at publish.

**Why.** Per investigation O-5 — no currency mixing within one schedule; matches WeTravel behavior; simplifies Tr4 refund math.

**Enforcement.** Validation in the finalize RPC. Tester-authored regression test asserts mismatched currency rejected.

---

## 6. Test Cases

| # | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Happy path: 3-installment plan | Trip with deposit 25% + 2 installments at 30d / 60d | 1 order row + 2 order_installments rows; deposit charged; test clock advances 30d → installment 1 charged; advance 30d → installment 2 charged; status='collected' on all | Full stack |
| T-02 | Failed installment retry sequence | Test card `4000 0000 0000 0341` (auth required fail) on installment 2 | retry_count increments on each cron run; next_retry_at = Day-3 then Day-7; after retry 3 fails, `orders.at_risk=true` + dunning email fired | Cron + webhook + email |
| T-03 | Manual retry from operator dashboard | Failed installment row + brand member taps Retry | `biz_retry_installment` RPC returns `ok:true`; status flips to `scheduled` + `next_retry_at=now()`; next cron run picks it up | Service + RPC + UI |
| T-04 | Idempotency: cron run twice | Cron edge function invoked twice in 1 second | Single PI created at Stripe (duplicate idempotency-key returns existing); single DB UPDATE (predicate `WHERE status='scheduled'` filters out the second update); no double-charge | Cron edge function |
| T-05 | Late-booking rejection | Trip with installment[0].fixed_date = yesterday | `biz_ticket_checkout_create_session` RPC returns error `installment_schedule_past_due_at_booking`; no order, no order_installments rows | RPC |
| T-06 | Non-installment trip unchanged | Trip without installment_schedule (Tr2 single-price) | No order_installments rows; no setup_future_usage on PI; no orders.at_risk; no new columns populated | Regression |
| T-07 | Non-installment event unchanged | Event (event_type='event') checkout | Same as T-06; Hard Guard #3 verified — UI doesn't show PaymentPlanEditor on event wizard | Regression |
| T-08 | Schedule sum mismatch rejected | deposit_pct=30, installments=[{pct:40}, {pct:40}] (sum=110) | Trip publish RPC rejects with `installment_pct_sum_mismatch` | RPC validation |
| T-09 | Duplicate ordinal rejected | installments=[{ordinal:1}, {ordinal:1}] | Trip publish RPC rejects with `installment_ordinal_duplicate` | RPC validation |
| T-10 | Currency mixing prevented | Attempt to insert order_installments row with different currency from sibling row | Finalize RPC rejects; if bypassed somehow, tester adversarial test catches | RPC + adversarial |
| T-11 | Buyer dunning email rendering | Trigger fail webhook → dunning email queued in Resend | Email subject + body match locked copy; CTA link is `mailto:${brand.contact_email}`; no PII leaked in subject | Email |
| T-12 | Money tab renders per-traveler installments | Brand member opens `/trip/{id}` → Money tab | List shows all bookings + status pills + at_risk badges (verified with mocked data and live) | UI |
| T-13 | Retry button only on failed rows | Money tab list | Retry button visible only on `status='failed'` rows; disabled tooltip on others | UI |
| T-14 | RLS: brand-A member cannot read brand-B installments | Sign in as brand-A; query order_installments for brand-B order | RLS returns 0 rows | Security |
| T-15 | RLS: anon cannot read order_installments directly | Anon Supabase client query | RLS returns 0 rows (anonymous buyers use buyer_status_token path, not direct table SELECT) | Security |
| T-16 | At-risk flag visible in operator dashboard | Trigger 3 failed retries on installment | `orders.at_risk=true`; Money tab shows "At risk" badge; operator filter "at risk only" works | Full stack |
| T-17 | Audit log capture on every state change | Trigger 1 success + 1 failure + 1 retry | 3 audit_logs rows with correct action_type + target_id | Audit |
| T-18 | Cross-surface parity: business iOS / Android / Web preview render Money tab identically | Compare screenshots across 3 sims | Pixel parity (or within tolerance) on identical state | Cross-platform |
| T-19 | Cross-surface parity: 3 buyer-anon-web checkout routes show InstallmentScheduleDisplay | Compare /checkout/index + /buyer + /payment on web preview | All three render the display above line-items | Cross-platform |
| T-20 | 3 strict-grep CI gates green | Run all 3 new gates locally | 0/0/0 violations | CI |

---

## 7. Implementation Order

Per brief §10 Pipeline Notes: cron edge function is highest-risk piece; build + prove it works with Stripe test clock BEFORE building UI.

1. **Migration `20260610000000_tr3_installments.sql`** — `order_installments` table + 3 orders columns + biz_retry_installment RPC + pg_cron schedule. Self-verification probe. Operator runs `supabase db push` after implementor writes the file.
2. **Migration `20260610000001_tr3_ticket_checkout_session_installment_aware.sql`** — amend `biz_ticket_checkout_create_session` to return `installmentSchedule` + add late-booking rejection. Amend `biz_ticket_checkout_finalize` to persist `stripe_customer_id_on_connected_account` + `saved_payment_method_id` on orders + create `order_installments` rows when `installment_plan_root=true`.
3. **New edge function `process-scheduled-installments/index.ts`** — cron loop. Includes Deno test fixture with Stripe test clock helper.
4. **Modified `_shared/stripeWebhookRouter.ts`** + NEW `_shared/installmentWebhookHandlers.ts` — webhook metadata-discrimination paths.
5. **NEW `_shared/email/installmentDunningEmail.ts`** — Resend dunning email template.
6. **Modified `ticket-checkout-create/index.ts`** — surgical addition of `setup_future_usage` + `payment_method_types` restriction for installment plans.
7. **Operator runs `supabase db push`** to apply migrations.
8. **Orchestrator deploys 4 edge functions:** `process-scheduled-installments` (NEW), `ticket-checkout-create` (modified), `stripe-webhook` (modified router), `ticket-confirmation-dispatch` (touched via shared dunning email path?). Verify via `mcp__supabase__list_edge_functions` version bumps.
9. **Live-fire test 1:** create a test trip with installment plan via direct SQL (no UI yet); use Stripe test clock to advance time; verify cron fires + ledger writes correctly. **This is the critical gate before building UI.**
10. **Service + hook layer:** `orderInstallmentsService.ts` + `useOrderInstallments.ts`.
11. **Components:** `PaymentPlanEditor.tsx`, `InstallmentScheduleDisplay.tsx`.
12. **Modified routes:** `TripCreatorStep4Pricing.tsx`, `TripCheckoutFlow.tsx`, 3 buyer-anon-web checkout routes, new Money tab on `app/trip/[id]/index.tsx`.
13. **3 CI strict-grep gates:** wire into `.github/workflows/strict-grep-mingla-business.yml`.
14. **Implementor regression test:** Stripe test clock + 3-installment happy-path Deno test in `process-scheduled-installments/__tests__/`. Fails-on-revert verified.
15. **Implementation report** with full Old → New receipts, all 20 SC mapped to verification.

---

## 8. Regression Prevention

**Bug class being fixed:** there is no existing bug — Tr3 is greenfield. The regression prevention concern is **scope creep** into Tr4 (refund) territory and **schema decisions that paint Tr4 into a corner**.

| Structural safeguard | What it prevents |
|---|---|
| `order_installments` ledger with per-row `stripe_payment_intent_id` + `stripe_charge_id` | Tr4 refund engine can target individual installments without reverse-engineering subscription state |
| `tier_metadata.installments` schema explicitly typed in TS + validated at RPC | Future drift in schedule shape caught at publish time |
| 3 new CI invariants (I-PROPOSED-TR3-*) | Prevents future code from (a) creating installment PIs outside the cron, (b) deleting Customers with live schedules, (c) bypassing currency-pinning |
| `at_risk` boolean on orders | Operator gets visibility WeTravel lacks — prevents the "discovered failed installment 30 days late" scenario |
| Card-only allowlist for installment PIs (investigation H-2) | Prevents Link off-session reuse semantics surprise in v1 |

**Protective inline comment template** (implementor MUST include in `process-scheduled-installments/index.ts`):

```ts
// ORCH-0869 [Tr3 Installment Payments] CONTRACT:
// - This file is the SINGLE OWNER of installment PI creation (per
//   I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER + CI gate).
// - PI metadata MUST include mingla_installment_id, mingla_installment_ordinal,
//   mingla_order_id, mingla_brand_id (webhook router discriminates on these).
// - Idempotency key MUST include retry_count so each retry attempt is independently
//   idempotent (Stripe will return existing PI on duplicate; new PI on next retry).
// - Customer + PaymentMethod live on the CONNECTED account — Stripe-Account header
//   on every API call (no exceptions).
// - Application fee = Math.round(amount * 0.015) per ORCH-0843 rate.
// - At-risk flag flips on retry_count >= 3 + cron halts further retries on that row.
// - Dunning email fires on first failure + each retry attempt until success or at_risk.
// Refund logic = Tr4 scope, NOT here.
```

---

## 9. Cross-Skill Notes

### For Codex `implementor-mingla`

- Brief §10 Pipeline Notes: "Taofeek-owned: start with the migration + ledger logic. Get a single scheduled installment firing correctly in test mode before building the UI." Per ORCH-0859 close, Codex implementor-mingla is the canonical implementor.
- Hard Guards from brief §8 and SPEC §1 non-goals are MANDATORY — refund math is Tr4; trip-only feature; no card storage; no auto-cancel.
- Deno gates: implementor runs `deno check` + `deno test` for `process-scheduled-installments/` BEFORE declaring complete (per Codex `implementor-mingla` SKILL.md cross-skill parity rule #8).
- Edge function deploy split: operator runs `supabase db push`; Codex (implementor) deploys edge functions post-CLOSE.

### For Claude `mingla-tester`

- 20 success criteria, 20 test cases — full parity needed.
- iOS sim + Android emu + Web preview parity for all UI surfaces (per Phase 0.A live-fire sim gate).
- Stripe test clock setup is required for T-01 + T-02 + T-04 — tester writes the test fixture if implementor's doesn't generalize.
- Verdict gate: PASS requires `proven`-level live-fire on every applicable platform AND adversarial regression test (tester-authored, fails-on-revert) AND implementor happy-path test in same closing PR.

### For Codex `orchestrator-mingla`

- 4 new invariants flip DRAFT → ACTIVE on close. INVARIANT_REGISTRY update at CLOSE Step 5e.
- New CI gates wire into `.github/workflows/strict-grep-mingla-business.yml` (per `feedback_strict_grep_registry_pattern.md`).
- 2 carry-over follow-up ORCHs from ORCH-0859 close still need registration (ORCH-0867 Trip dashboard View public page button + ORCH-0868 forwardRef RedBox cleanup) — orchestrator should fold these into Tr3 CLOSE artifact-sync pass.
- New follow-up ORCHs surfaced by this SPEC:
  - **ORCH-0870 [Tr3 v1.1 — Auto-adjust late bookings]** — implement WeTravel-parity redistribution when first installment due_at is past at booking time.
  - **ORCH-0871 [Tr3 buyer self-update PM]** — `/buyer/installment/[order_id]?token=...` page for buyers to re-attach a card without contacting the organizer.
  - **ORCH-0804-A [Stripe Tax on native PaymentIntent path]** — already known follow-up; Tr3 installments inherit the same gap.

---

## 10. Open Questions Resolution (carried from investigation §10)

All 8 Open SPEC Questions answered per investigation recommendations. Operator can override any of these before implementor dispatch by replying with override note; otherwise implementor builds per SPEC.

| O-# | Investigation recommendation | SPEC resolution |
|---|---|---|
| O-1 | Schema placement: `trip_pricing_tiers.tier_metadata.installments` | **Locked.** Migration §3.1 uses `tier_metadata.installments`; `ticket_types` table untouched. Brief's `ticket_types.installment_schedule` proposal is SUPERSEDED. |
| O-2 | Cron mechanism: pg_cron every 6 hours | **Locked.** Verified pg_cron v1.6.4 + pg_net v0.19.5 installed live. Cron schedule `0 */6 * * *` in migration. |
| O-3 | Dunning cadence: Day-immediate / Day-3 / Day-7 then at_risk | **Locked.** SPEC §3.2.1 + SC-9 + SC-18 codify. |
| O-4 | Pay-early: defer | **Locked as out-of-scope.** Future ORCH. |
| O-5 | Currency mixing: pinned at publish, no cross-installment mixing | **Locked.** I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH invariant codifies. |
| O-6 | Installment count cap: 12 (1 deposit + 11) | **Locked.** PaymentPlanEditor §3.5.1 enforces; RPC validation also enforces. |
| O-7 | UI placement: new Money tab on existing `[id]/index.tsx` | **Locked.** New tab joins Overview + Travelers. Matches Tr2 pattern. |
| O-8 | Retry mechanism: Mingla cron only (3 retries Day-3 / Day-7 / at_risk) | **Locked.** SPEC §3.2.1 cadence; SC-9. Stripe Smart Retries does NOT apply to one-off PIs by default. |

---

## 11. Discoveries for Orchestrator

- **2 carry-over follow-up ORCHs from ORCH-0859 close STILL not registered** in WORLD_MAP (ORCH-0867 Trip dashboard View public page button + ORCH-0868 forwardRef RedBox cleanup). Tr3 CLOSE should fold these in.
- **3 new follow-up ORCHs surfaced by Tr3 SPEC:** ORCH-0870 [Tr3 v1.1 auto-adjust late bookings], ORCH-0871 [Tr3 buyer self-update PM], ORCH-0804-A [Stripe Tax on native PaymentIntent path — also affects installment PIs].
- **Tr4 hard dependency on Tr3 ledger schema** locked in this SPEC. Tr4 reads `order_installments` + `stripe_payment_intent_id` per row. Worth a flag in WORLD_MAP for Tr4 milestone tracking.
- **Brand contact_email plumbing for dunning email CTA** — SC-18 has the buyer dunning email render `mailto:${brand.contact_email}` but the `brands.contact_email` column may not be populated for all brands. SPEC §3.2.4 dunning email rendering must handle null gracefully (fall back to "Contact organizer through Mingla" with a deep-link to the brand's public page).
- **No DESIGN phase in pipeline.** Tr3 is mechanical UI (toggle + steppers + list) on top of proven Tr2 design language. SPEC skips DESIGN dispatch and goes directly to implementor. If operator wants `ui-ux-pro-max` design exploration, redirect before implementor dispatch.

---

## 12. Confidence Level

**H — High** for the core architecture (Option B PI-with-cron model), the ledger schema, the 4 invariants, and the 20 success criteria.

**M — Medium** for:
- Dunning email cadence (Day-immediate / Day-3 / Day-7) — operator may adjust based on real send-engagement data once shipped.
- pg_cron 6-hour cadence — could tune to 1-hour or 12-hour based on volume; idempotency makes either safe.
- Late-booking rejection vs auto-adjust — chose rejection in v1 for simplicity; SPEC names ORCH-0870 as the v1.1 follow-up.

**L — Low** for:
- Buyer self-update PM page UX details (Out of scope; ORCH-0871).
- Tr4 refund-engine API surface this ledger exposes (not Tr3 scope; assumption is per-PI refund via stripe.refunds.create with amount sub-divisions).

---

## 13. Pipeline next

Per Canonical Pipeline Routing + this SPEC §9:

1. **Codex `implementor-mingla`** (default) implements per SPEC §7 order. Produces `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md`.
2. **Operator** runs `supabase db push` to apply migrations.
3. **Codex orchestrator** OR **implementor (post-DB push)** deploys 4 edge functions.
4. **Claude `mingla-tester`** RETEST with Stripe test clock + 20-test matrix. Produces `Mingla_Artifacts/reports/QA_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_REPORT.md`.
5. **Claude or Codex `mingla-orchestrator`** CLOSE per One-PR-per-CLOSE rule. Flip 4 invariants DRAFT → ACTIVE. Register 3 follow-up ORCHs. Sync WORLD_MAP + COVERAGE_MAP + PRIORITY_BOARD + MASTER_BUG_LIST + PRODUCT_SNAPSHOT + AGENT_HANDOFFS + OPEN_INVESTIGATIONS.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
