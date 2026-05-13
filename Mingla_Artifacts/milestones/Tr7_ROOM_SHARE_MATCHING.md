# Tr7 — Room-Share Matching

> **Track:** Track 1 — Trip planners
> **Duration:** 1 week
> **Depends on:** Tr2 (Tr5 if intake form integration desired)
> **Status:** locked, not started

---

## 1. User Outcome

Buyers opt into room-sharing at checkout (with optional preferences: gender, age range, sleep schedule). Planner sees the opted-in pool in dashboard and manually pairs travelers. When the planner confirms a pair, both travelers receive a push notification with their roommate's name, and pricing recalculates to remove the single supplement. Unpairing is supported.

---

## 2. Smoke Test

1. Planner creates trip with two pricing tiers: Double-occupancy $1500 + Single supplement $500 (so total private = $2000)
2. Buyer A books with "Room-share preferred (saves $500)" opt-in + preferences (female, 25-35)
3. Buyer B books same trip with same opt-in + matching preferences
4. Both initially charged for the full single-supplement amount (pending pair)
5. Planner opens Room-Share tab → sees both A and B in unpaired pool with green compatibility indicator
6. Tap "Pair these two"
7. Both travelers receive push notification: "You're rooming with <name>"
8. Their pricing recalculates: $500 refunded to each (or future installment reduced — TBD in SPEC)
9. Planner unpairs them → pricing reverts; both travelers notified
10. **DB probe:**
    ```sql
    SELECT order_id_a, order_id_b, assigned_at, assigned_by FROM public.trip_room_assignments
    WHERE event_id = <trip-id>;
    ```

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Buyer checkout adds optional "Room-share opt-in" toggle when single-supplement tier exists |
| 2 | Optional preferences captured: gender, age range, sleep schedule, smoking preference |
| 3 | `orders.room_share_preference` JSONB column stores opt-in flag + preferences |
| 4 | Planner dashboard Room-Share tab lists all opted-in travelers (paired + unpaired) |
| 5 | Compatibility indicator on each unpaired pair candidate (green/yellow/red based on preference alignment) |
| 6 | "Pair these two" action writes to `trip_room_assignments` table |
| 7 | Pairing triggers Stripe refund OR adjusts next installment to remove the single supplement (decision in SPEC) |
| 8 | Notification fires to both travelers on pair confirmation |
| 9 | Unpair action reverts pairing + recalculates pricing back to single supplement |
| 10 | Pairing requires both order statuses confirmed (post-deposit) |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/buyer/RoomShareOptIn.tsx`
- `mingla-business/src/components/trip/RoomShareDashboard.tsx`
- `mingla-business/src/components/trip/RoomShareCompatibilityIndicator.tsx`
- `mingla-business/src/services/roomShareService.ts`
- `supabase/functions/pair-room-share/index.ts`
- `supabase/migrations/<timestamp>_tr7_room_share.sql`

**Modified:**
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (room-share step after intake)
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (if pricing-tier setup needs a flag)

---

## 5. Data Model Changes

```sql
ALTER TABLE public.orders
  ADD COLUMN room_share_preference jsonb;

CREATE TABLE public.trip_room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  order_id_a uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_id_b uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES auth.users(id),
  UNIQUE (order_id_a),
  UNIQUE (order_id_b),
  CHECK (order_id_a < order_id_b) -- canonical ordering prevents A-B / B-A duplicates
);

ALTER TABLE public.trip_room_assignments ENABLE ROW LEVEL SECURITY;
-- Read: brand members; both buyers can see their own assignment
-- Write: brand members only
```

---

## 6. Dependencies

- Upstream: Tr2 (trip orders), Tr3 (installments — refunds need to coordinate with installment ledger)
- Sideways: Tr5 (intake form can include room-share preference questions; either path captures it)

---

## 7. Regression Tests

1. Trip without room-share enabled (no single supplement tier) — no room-share UI shown
2. Single buyer opts in without anyone to match — sits in pool indefinitely, no pricing change
3. Unpair after refund collected — confirm pricing reverts and re-charges happen correctly
4. Cancellation of a paired booking — other half automatically unpaired + notified

---

## 8. Hard Guards

- Don't auto-pair without operator confirmation in Tr7 — matching is operator-driven; auto-suggestion is polish
- Don't allow pairing across different trips — assignments scoped to single event_id
- Don't store demographic preferences (gender, age) in any analytics or marketing audience — internal matching only
- Don't expose another buyer's preferences to a buyer — operator-only data

---

## 9. Open Polish

- Auto-suggested matches based on preference alignment (defer to future polish)
- Three-way+ rooming (defer; pairs only in Tr7)
- Roommate request workflow (buyer A requests buyer B; B accepts) — defer

---

## 9.5. Required Reading Before SPEC

The WeTravel competitive research at `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` is **required reading** before forensics writes the Tr7 SPEC. Specifically read §9 (Room-Share Matching) — Tr7 is the **third-biggest differentiation opportunity in Mingla 1.2**. WeTravel supports shared-room PACKAGES (organizer creates a "Shared Female Dorm — Bed 1" package; traveler buys a specific bed) but does NOT support an opt-in matching algorithm. Companies that need real matching (Travel Divas, Sisterhood Travels, Flash Pack) build it themselves outside WeTravel via Google Form + email coordination. Mingla 1.2 Tr7 ships first-class manual matching with compatibility indicators, preference fields at checkout, and automated pricing recalc on pair. Auto-matching algorithm can wait for post-launch polish. Cite the research in the SPEC's opening comparison paragraph.

## 10. Pipeline Notes

**Seth-owned:** decision in SPEC — refund vs installment adjustment when pairing. Refund is simpler but slower (Stripe processing time); installment adjustment is cleaner but requires Tr3 ledger awareness.

**Taofeek-owned:** start with the data model + the pricing-adjustment logic (refund or installment-skip). Get the math right before building UI. Use the `refund-order` edge function pattern for refunds; use the `order_installments` ledger update pattern for installment adjustments.
