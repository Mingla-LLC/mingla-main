# Tr2 — Minimum Viable Trip

> **Milestone code:** Tr2
> **Track:** Track 1 — Trip planners
> **Duration:** 2 weeks
> **Depends on:** Tr1 (in TestFlight)
> **Status:** locked, not started
> **Importance:** **first revenue event for Mingla Business 1.2**

---

## 1. User Outcome

A trip planner uses the universal "+" → "Create trip" to launch a wizard, builds a real trip (title, dates, destination via Google Places, manual day-by-day itinerary, what's included, capacity, single full-price ticket), and publishes it. They get a shareable link at `/t/{brandSlug}/{tripSlug}`. They share the link with a friend. The friend opens it (signed out, anonymous), sees the trip detail page, taps "Reserve my spot," fills in name/email/phone, pays via Stripe (Apple Pay or card), receives a confirmation email, and appears in the planner's traveler list.

**This is the first end-to-end purchasable trip on Mingla. First dollar of trip revenue.**

No installments yet (Tr3). No intake forms (Tr5). No discussion board (Tr6). No room-share (Tr7). No AI itinerary scaffolding (Tr8). Just the minimum that delivers a complete bookable experience.

---

## 2. Smoke Test

1. As trip-planner brand from Tr1, tap top-bar "+" → "Create trip or otherwise"
2. **Step 1 — Basics:** title "Tulum Yoga Retreat — March 2026", dates 2026-03-12 to 2026-03-18, destination via Google Places autocomplete ("Tulum, Quintana Roo, Mexico"), capacity 12
3. **Step 2 — Itinerary:** add 7 days manually with titles + narratives
4. **Step 3 — Inclusions/exclusions:** Included: "lodging, all meals, daily yoga, airport transfer". Excluded: "flights, alcohol, optional excursions"
5. **Step 4 — Pricing:** single tier "Double occupancy" $50 (test mode, low amount)
6. **Step 5 — Review & publish:** verify preview shows correctly; tap Publish
7. Trip is now live. Tap "Share" → copy link `/t/wandering-soul-retreats/tulum-yoga-retreat-march-2026`
8. **Open the link on a second phone signed out of any Mingla account**
9. Trip detail page renders: photos (cover), title, dates, day-by-day itinerary, inclusions/exclusions, "Reserve my spot" CTA
10. Tap "Reserve my spot"
11. Pricing tier picker shows "Double occupancy — $50"
12. Buyer info: enter name, email, phone
13. Payment screen: Stripe PaymentSheet opens with test card prefilled or accept input
14. Pay with `4242 4242 4242 4242` test card
15. Land on confirmation screen with order details
16. Check email — confirmation email received with trip + traveler details
17. **Back on planner's phone:** refresh trip dashboard at `/trip/{id}`
18. Verify Overview tab shows: 1 traveler confirmed, $50 revenue, days-until-departure correct
19. Verify Travelers tab shows: the traveler name + email + payment status
20. **Verify DB state:**
    ```sql
    SELECT id, event_type, status, brand_id FROM public.events WHERE slug = 'tulum-yoga-retreat-march-2026';
    -- expect: event_type='trip', status='scheduled' or 'live'
    SELECT COUNT(*) FROM public.trip_days WHERE event_id = <trip-id>;
    -- expect: 7
    SELECT * FROM public.orders WHERE event_id = <trip-id>;
    -- expect: 1 row with correct buyer + Stripe payment
    ```

---

## 3. Acceptance Criteria

| # | Criterion | Layer |
|---|-----------|-------|
| 1 | Top-bar "+" → "Create trip" routes to `/trip/create` (no longer stubbed) | Routing |
| 2 | `/trip/create` creates a draft trip and routes to `/trip/{id}/edit?step=0` | Routing |
| 3 | Trip wizard has 5 steps with autosave between steps | UI |
| 4 | Step 1 Basics: title, dates, destination (Google Places), capacity all captured | UI |
| 5 | Step 2 Itinerary: operator can add/edit/delete/reorder days manually | UI |
| 6 | Step 3 Inclusions/Exclusions: add/remove items in each list | UI |
| 7 | Step 4 Pricing: single tier with price + currency | UI |
| 8 | Step 5 Review: preview as buyer will see + Publish CTA | UI |
| 9 | Publish creates a public anon-tolerant route at `/t/{brandSlug}/{tripSlug}` | Routing |
| 10 | Buyer detail page renders: hero, dates, itinerary, inclusions, pricing, CTA | UI |
| 11 | Buyer checkout: tier picker → buyer info → Stripe PaymentSheet → confirmation | UI |
| 12 | Order created with `event_id` referencing the trip | DB |
| 13 | Confirmation email fires via Resend pipeline using a new trip-specific template | Edge |
| 14 | Operator trip dashboard at `/trip/{id}`: Overview tab + Travelers tab | UI |
| 15 | Migration creates `trip_days`, `trip_pricing_tiers`, `trip_inclusions` sidecar tables | DB |
| 16 | RLS on sidecar tables: trip-day rows readable by anon for published trips, writable only by brand members | DB |
| 17 | Trip wizard autosave uses same pattern as event wizard (server draft) | Service |
| 18 | Stripe Connect funds route to the trip planner's connected account, not Mingla's main account | Payments |

---

## 4. Files Touched

**`mingla-business/app/`:**
- `trip/create.tsx` (NEW) — wizard entry, creates draft + routes
- `trip/[id]/edit.tsx` (NEW) — wizard host
- `trip/[id]/index.tsx` (NEW) — operator trip dashboard
- `t/[brandSlug]/[tripSlug].tsx` (NEW) — public trip detail page (anon-tolerant)

**`mingla-business/src/components/trip/`:**
- `TripCreatorWizard.tsx` (NEW)
- `TripCreatorStep1Basics.tsx` (NEW)
- `TripCreatorStep2Itinerary.tsx` (NEW)
- `TripCreatorStep3Inclusions.tsx` (NEW)
- `TripCreatorStep4Pricing.tsx` (NEW)
- `TripCreatorStep5Review.tsx` (NEW)
- `TripDayEditor.tsx` (NEW)
- `TripPreview.tsx` (NEW) — used in Step 5 + public page
- `TripCheckoutFlow.tsx` (NEW) — buyer flow

**`mingla-business/src/services/`:**
- `tripsService.ts` (NEW) — CRUD operations for trips + trip_days + pricing + inclusions
- `tripCheckoutService.ts` (NEW) — buyer-side checkout

**`mingla-business/src/hooks/`:**
- `useTrips.ts` (NEW) — React Query hooks
- `usePublicTripBySlug.ts` (NEW) — anon-tolerant public trip fetch
- `useTripOrders.ts` (NEW) — operator dashboard data

**`supabase/migrations/`:**
- `<timestamp>_tr2_trip_sidecar_tables.sql` (NEW)

**`supabase/functions/`:**
- `trip-publish` or extension of `business-publish-event-draft` (TBD during SPEC) — handles `event_type='trip'` publish path
- Existing `ticket-checkout-create` extended to handle trip orders (single tier, no installments yet)

---

## 5. Data Model Changes

```sql
-- supabase/migrations/<timestamp>_tr2_trip_sidecar_tables.sql

CREATE TABLE public.trip_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal > 0),
  title text NOT NULL,
  narrative text,
  date date,
  stops jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, ordinal)
);

CREATE TABLE public.trip_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  tier_name text NOT NULL,
  tier_metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.trip_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('included', 'excluded')),
  item text NOT NULL,
  ordinal smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.trip_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY trip_days_read_published ON public.trip_days FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id
        AND e.deleted_at IS NULL
        AND (e.status IN ('scheduled', 'live') OR public.is_brand_member(e.brand_id))
    )
  );
CREATE POLICY trip_days_write_brand_members ON public.trip_days FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_days.event_id AND public.is_brand_member(e.brand_id)
    )
  );

-- Same RLS pattern for trip_pricing_tiers + trip_inclusions
-- (snipped for brevity; SPEC will spell out)

CREATE INDEX idx_trip_days_event_ordinal ON public.trip_days(event_id, ordinal);
CREATE INDEX idx_trip_pricing_tiers_event ON public.trip_pricing_tiers(event_id);
CREATE INDEX idx_trip_inclusions_event_kind ON public.trip_inclusions(event_id, kind);
```

`events.event_type = 'trip'` for trips. Status lifecycle: `draft` → `scheduled` → `live` → `ended` / `cancelled` (same as events).

---

## 6. Dependencies

- **Upstream:** M0 (events.event_type discriminator), Tr1 (trip-planner brands exist)
- **Downstream:** Tr3 (installments) extends Tr2's checkout. Tr4-Tr7 layer features onto Tr2's foundation. C1 (Consumer Discover Trips tab) reads Tr2's published trips.

---

## 7. Regression Tests

1. **Today's event creation flow** — popup brands creating events should be completely unaffected
2. **Today's event checkout** — buyer flow for events should be unchanged (the buyer-side checkout work for trips is a new path, not a modification of the event path)
3. **Brand list on Account tab** — trip-planner brands appear alongside popup brands; tap routes to brand profile (which doesn't change in Tr2)
4. **Marketing Hub** — no impact

Regression test files:
- `mingla-business/src/services/__tests__/tripsService.test.ts`
- `mingla-business/src/services/__tests__/tripCheckoutService.test.ts`
- `mingla-business/src/hooks/__tests__/useTrips.test.ts`
- `mingla-business/app/trip/__tests__/trip-create-publish.test.tsx`
- `mingla-business/app/t/__tests__/public-trip-page.test.tsx`

---

## 8. Hard Guards (Do NOT)

- **Do NOT** implement installments — single full-price ticket only. Installments are Tr3.
- **Do NOT** implement intake forms — buyer captures name/email/phone only. Forms are Tr5.
- **Do NOT** implement the discussion board / group chat — Tr6.
- **Do NOT** implement room-share — Tr7.
- **Do NOT** implement AI itinerary scaffolding — manual day-by-day entry only. AI is Tr8.
- **Do NOT** modify the existing event-checkout edge functions in a way that changes behavior for event_type='event' orders. Extend with discriminator-aware branches if needed, but don't break the existing path.
- **Do NOT** create a separate `trips` table — use `events.event_type='trip'` per the unified data model invariant.
- **Do NOT** allow trips with `kind='popup'` or `kind='physical'` brands in this milestone — only `kind='trip_planner'` brands create trips for now. (Cross-persona offering creation is enabled by the brand-as-container principle but the UI guards it in this milestone to keep scope tight.)

---

## 9. Open Polish Items

Resolve during Tr2's SPEC:
- Day-by-day editor UX (cards stacked vs accordion vs single page with collapsible days)
- Whether to allow image upload per day (defer to polish later — narrative text only in Tr2)
- Wizard navigation pattern: linear next/back vs step jumper
- Anon-tolerant trip page hero design — single cover image + dates + capacity vs richer
- Should published trips appear in the planner's Hub > Trips sub-tab? (Yes, but UX needs design)
- Confirmation email template design — reuses Resend brand shell from ORCH-0785

---

## 10. Pipeline Notes (Seth-owned)

- **INVESTIGATE:** trace existing event-create-publish-checkout pipeline end-to-end; identify exact branches where trip-vs-event divergence needs to happen; verify Stripe Connect handles event_type='trip' orders transparently
- **SPEC:** wizard step-by-step UI spec; data model spec; edge function spec; buyer flow spec; email template spec
- **IMPLEMENT:** migration → service → hook → wizard components → public route → buyer flow → operator dashboard
- **TEST:** end-to-end smoke test (planner publishes, buyer purchases, both see correct state) + regression sweep on event flow
- **CLOSE:** decision log entry for `events.event_type='trip'` semantics

---

## 11. Pipeline Notes (Taofeek-owned)

This is the biggest milestone so far (2 weeks). Pace it:

- **Week 1:** migration + service + hook + wizard skeleton + autosave. Smoke test publish-only (no buyer flow yet).
- **Week 2:** public trip page + buyer checkout + operator dashboard. Smoke test full end-to-end.

Read the existing event wizard at `mingla-business/src/components/event/CreatorStep*.tsx` extensively. The trip wizard mirrors that pattern. The biggest divergence is Step 2 (Itinerary — multi-day) vs the event wizard's single-date Step.

For the buyer flow, mirror `mingla-business/app/checkout/[eventId]/*` exactly. Keep the buyer experience parallel to events; the only difference is the trip-shaped detail page above the checkout.

Surface to Seth before commit: Stripe Connect routing — confirm test-mode trip orders settle to the trip planner's connected account, not Mingla's main account. This is the kind of money plumbing that has to be verified, not assumed.
