# Tr3 — Installment Payments

> **Track:** Track 1 — Trip planners
> **Duration:** 2 weeks
> **Depends on:** Tr2 (in TestFlight)
> **Status:** locked, not started

---

## 1. User Outcome

Trip planner adds an installment plan when configuring pricing — "$300 deposit + 2 installments of $400 each at 30 days and 60 days." Buyer at checkout sees the schedule plainly ("$300 today, $400 on Jan 15, $400 on Feb 15"). Deposit charges now via Stripe. Future installments auto-charge on schedule. Failed installments fire dunning emails to the buyer and flag the booking "at risk" in the planner's dashboard. **First full WeTravel-parity feature.**

---

## 2. Smoke Test

1. As planner, edit existing trip from Tr2 (or create new). At Pricing step, add installment plan: 25% deposit + 2 installments
2. Republish trip
3. As buyer, open the trip link signed out, tap Reserve
4. **Verify schedule visible at checkout:** "$X today + $Y on <date> + $Y on <date>"
5. Complete payment with test card `4242 4242 4242 4242`
6. Verify confirmation: deposit charged, schedule shown
7. **Use Stripe test clock** to advance 30 days
8. Verify second installment auto-charged + email fired
9. Replace card on buyer side with `4000 0000 0000 0341` (auth required fail)
10. Advance 60 more days
11. Verify third installment fails + dunning email fires + planner dashboard shows "at risk"
12. Planner retries from dashboard with `4242 4242 4242 4242` → succeeds
13. **DB probe:**
    ```sql
    SELECT ordinal, status, amount_cents, collected_at, failed_at, retry_count
    FROM public.order_installments WHERE order_id = <order-id> ORDER BY ordinal;
    ```
    Expect 3 rows; #1 collected; #2 collected; #3 collected after retry with retry_count=1

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Trip wizard pricing step gains "Payment plan" sub-section with "Full price" / "Installments" toggle |
| 2 | Installment config UI: deposit % + N additional installments + due-date offsets from booking OR fixed dates |
| 3 | `ticket_types.installment_schedule` JSONB column stores: `{deposit_pct, installments: [{ordinal, days_after_booking OR fixed_date, pct}]}` |
| 4 | `order_installments` ledger table created with full per-installment row per order |
| 5 | At checkout, buyer sees full schedule with amounts + dates |
| 6 | Stripe SetupIntent attached to PaymentIntent on initial booking; saves card for future charges |
| 7 | Cron-scheduled edge function `process-scheduled-installments` runs daily, charges due installments |
| 8 | Failed installment writes `status='failed'`, fires dunning email via Resend |
| 9 | After 3 retries with grace period, booking flagged "at risk" |
| 10 | Operator dashboard Money tab shows per-traveler installment status |
| 11 | Manual retry from operator dashboard works |
| 12 | Refund engine in Tr4 will read this ledger — schema must support that need |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/trip/PaymentPlanEditor.tsx`
- `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`
- `mingla-business/app/trip/[id]/money.tsx` (or as a tab in `trip/[id]/index.tsx`)
- `supabase/functions/process-scheduled-installments/index.ts`
- `supabase/migrations/<timestamp>_tr3_installments.sql`

**Modified:**
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx`
- `mingla-business/src/services/tripCheckoutService.ts`
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (schedule display)
- `supabase/functions/_shared/ticketCheckout.ts` (SetupIntent attachment)
- `supabase/functions/_shared/email/` (new dunning template)
- Existing edge function `ticket-checkout-create` (creates `order_installments` rows on booking)

---

## 5. Data Model Changes

Per project spec §3.5. Key tables:

```sql
ALTER TABLE public.ticket_types ADD COLUMN installment_schedule jsonb;

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
  collected_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  retry_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ordinal)
);
CREATE INDEX idx_order_installments_due_status ON public.order_installments(due_at, status) WHERE status = 'scheduled';
CREATE INDEX idx_order_installments_order ON public.order_installments(order_id, ordinal);
```

RLS: brand members read all rows for orders on their events; buyer reads own rows.

---

## 6. Dependencies

- Upstream: Tr2 (trip orders exist)
- Downstream: Tr4 (refund engine reads ledger), Tr8 onward (alumni audiences include installment-state filters)

---

## 7. Regression Tests

1. Existing event checkout (no installments) — must remain unchanged
2. Tr2 trip with full-price (no installment_schedule) — must work as before
3. Failed deposit at booking — confirm no `order_installments` rows are written (transaction rolls back)
4. Idempotency of scheduled-installment edge function — running twice on same installment doesn't double-charge

**Critical test:** Stripe test clock + multiple installment cycles, verify exactly N charges fire for N installments.

---

## 8. Hard Guards

- Refund math is Tr4 scope, not Tr3. Tr3 only schedules + collects installments.
- Don't auto-cancel "at risk" bookings — flag only; operator decides
- Don't allow installment plans on events (event_type='event') for now — UI guard limits the feature to trips
- Don't store Stripe card details locally — only `stripe_payment_intent_id` and the saved payment-method-id on the customer

---

## 9. Open Polish

- Dunning email cadence (1 immediate / 1 at 3 days / 1 at 7 days?)
- Grace period before "at risk" flag (current proposal: 7 days)
- Whether to support "pay early" — buyer voluntarily pays remaining installments before scheduled
- Currency mixing (planner sets schedule in USD but buyer pays in EUR via Stripe currency conversion)

---

## 9.5. Required Reading Before SPEC

The WeTravel competitive research at `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` is **required reading** before forensics writes the Tr3 SPEC. Specifically read §4 (Installment Payment Engine) for WeTravel's 1-24 installment mechanics, auto-adjust on late bookings, deposit-on-booking constraint, and the auto-billing pattern. Mingla 1.2 Tr3 matches WeTravel parity on the core engine and beats them on (a) operator awareness when installments fail ("at-risk" status flag, dunning email pipeline from ORCH-0785), and (b) plan cancellation flexibility. Cite the research artifact in the SPEC's opening "WeTravel comparison" paragraph.

## 10. Pipeline Notes

**Seth-owned:** investigate Stripe Subscription Schedules vs scheduled PaymentIntents trade-offs in INVESTIGATE; pick one in SPEC. Decision criteria: refund-from-schedule complexity, multi-currency support, error recovery.

**Taofeek-owned:** start with the migration + ledger logic. Get a single scheduled installment firing correctly in test mode before building the UI. The cron-scheduled edge function is the highest-risk piece; build it first and prove it works with Stripe test clock.
