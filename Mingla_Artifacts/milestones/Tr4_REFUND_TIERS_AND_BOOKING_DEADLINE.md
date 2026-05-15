# Tr4 — Refund Tiers + Booking Deadline

> **Track:** Track 1 — Trip planners
> **Duration:** 1 week
> **Depends on:** Tr3 (in TestFlight)
> **Status:** locked, not started

---

## 1. User Outcome

Trip planner picks a refund policy from three templates (flexible / standard / strict) or builds a custom cascading policy ("100% refund before 60 days, 50% before 30, 0% after"). They also set a booking deadline (no new bookings after a date) and optional auto-cancel-if-min-capacity-not-met. When a buyer cancels, Mingla automatically calculates the correct refund based on (a) the cascading policy tier active on cancel date and (b) the installments they've actually paid, then fires the refund via Stripe.

---

## 2. Smoke Test

1. Planner edits a trip from Tr3. Add refund policy "100% before 60 days, 50% before 30, 0% after." Set booking deadline 14 days before trip start.
2. Buyer books trip with 3 installments. Pays deposit + 1 installment ($300 + $400 = $700 collected).
3. **Test point A:** Cancel 80 days before trip → Stripe refund of $700 (full refund — 100% tier active)
4. **Test point B:** Re-book another order. Cancel 45 days before trip → Stripe refund of $350 (50% of $700 collected — 50% tier active)
5. **Test point C:** Re-book another order, advance time. Cancel 20 days before trip → no refund (0% tier active). Order marked cancelled but no Stripe action.
6. **Test point D:** Attempt to book 10 days before trip (after booking deadline) → "Bookings closed" UI; button disabled
7. **Test point E:** Cron auto-closes bookings at booking deadline midnight — confirm via DB query

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Trip wizard adds "Booking deadline" date input + optional "Auto-cancel if min capacity not met by deadline" |
| 2 | Trip wizard adds "Refund policy" section with three preset templates + custom builder |
| 3 | `events.refund_policy` JSONB stores: `{tiers: [{before_days, refund_pct}], custom_terms_text}` |
| 4 | `events.booking_deadline` timestamptz column |
| 5 | Buyer-side cancel flow shows refund preview before confirmation ("You'll receive $X back per the planner's refund policy") |
| 6 | Buyer cancellation triggers refund engine that reads `events.refund_policy` + `order_installments` ledger |
| 7 | Refund engine extends existing `refund-order` edge function from ORCH-0787 with: (a) tier-lookup by days-from-trip-start, (b) installment-aware refund math (refund split across collected installments) |
| 8 | Refund engine writes back to `order_installments` rows: `status='refunded'`, audit trail |
| 9 | Booking deadline cron fires at midnight UTC daily, closes bookings on trips past deadline |
| 10 | Public trip page hides "Reserve" button after deadline; shows "Bookings closed" instead |
| 11 | Operator dashboard "Manage" tab adds cancel-trip action (refunds all bookings per policy) |
| 12 | Stripe refunds reach connected accounts correctly |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/trip/RefundPolicyEditor.tsx`
- `mingla-business/src/components/trip/BookingDeadlineInput.tsx`
- `mingla-business/src/components/trip/CancelTripDialog.tsx`
- `mingla-business/src/components/buyer/CancelOrderRefundPreview.tsx`
- `supabase/functions/refund-trip-order/` (or extend existing `refund-order`)
- `supabase/functions/close-bookings-at-deadline/index.ts` (cron-scheduled)
- `supabase/migrations/<timestamp>_tr4_refund_policy_and_deadline.sql`

**Modified:**
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (or new step)
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (gate Reserve button on deadline)
- `supabase/functions/refund-order/index.ts` (extend with cascading + installment-aware math)

---

## 5. Data Model Changes

```sql
ALTER TABLE public.events
  ADD COLUMN refund_policy jsonb,
  ADD COLUMN booking_deadline timestamptz;

COMMENT ON COLUMN public.events.refund_policy IS
  'Mingla Business 1.2 — cascading date-tier refund policy for trips. Structure: {tiers: [{before_days: 60, refund_pct: 100}, {before_days: 30, refund_pct: 50}, {before_days: 0, refund_pct: 0}], custom_terms_text: text}. NULL allowed for events (event_type=event,experience) — they use the existing flat refund flow.';

CREATE INDEX idx_events_booking_deadline ON public.events(booking_deadline)
  WHERE event_type = 'trip' AND status IN ('scheduled', 'live');
```

---

## 6. Dependencies

- Upstream: Tr3 (`order_installments` ledger is read by refund math)
- Downstream: none direct, but Tr5+ should be aware that order cancellation triggers refunds

---

## 7. Regression Tests

1. Existing event refund flow (ORCH-0787) — must remain unchanged for `event_type='event'`
2. Trip cancellation BEFORE any installments paid (only deposit) — refund only deposit
3. Trip cancellation with 0% tier active — order cancelled but no Stripe refund attempted
4. Booking after deadline — `Reserve` button confirmed disabled
5. Cron edge function idempotency (runs twice doesn't double-close)

---

## 8. Hard Guards

- Don't allow refund_policy with overlapping or non-monotonic tiers — validate at write
- Don't fire Stripe refund for $0 refunds — just mark order cancelled
- Don't auto-close a trip whose deadline is in the past at the moment of cron run if the planner has overridden — respect manual deadline overrides
- Don't modify the event refund flow for event_type='event' — that's a different path

---

## 9. Open Polish

- Visual treatment of the cascading tier editor (timeline slider vs table input)
- What happens when planner edits refund_policy after bookings exist (read-only after first booking? versioned?)
- Manual partial refund affordance for planner (override policy in edge cases)

---

## 9.5. Required Reading Before SPEC

The WeTravel competitive research at `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` is **required reading** before forensics writes the Tr4 SPEC. Specifically read §5 (Refund Tiers) — Tr4 is the **single biggest differentiation opportunity in Mingla 1.2**. WeTravel's cancellation policy is text-only; refunds are manual two-step with no policy enforcement and no installment-aware math; customer reviews describe the process as "a nightmare." Mingla 1.2 Tr4 ships a structured `events.refund_policy` JSONB with cascading tiers, auto-computed refunds reading the `order_installments` ledger, buyer-side refund preview at cancel time, and Stripe execution. The SPEC's opening "WeTravel comparison" paragraph must call this out explicitly — it's the headline win.

## 10. Pipeline Notes

**Seth-owned:** the refund math is the highest-risk piece. INVESTIGATE should map out every refund scenario (full, partial, tier-0, with-installments) and SPEC the math explicitly with worked examples.

**Taofeek-owned:** start with the migration + validation logic. Write unit tests for the refund math BEFORE wiring it to Stripe. Use the existing ORCH-0787 refund flow as the pattern; do not rewrite it, extend it.
