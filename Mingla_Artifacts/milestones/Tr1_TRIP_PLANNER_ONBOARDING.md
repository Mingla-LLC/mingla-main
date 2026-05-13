# Tr1 — Trip Planner Brand Onboarding

> **Milestone code:** Tr1
> **Track:** Track 1 — Trip planners
> **Duration:** 1 week
> **Depends on:** M0 (in TestFlight)
> **Status:** locked, not started

---

## 1. User Outcome

A trip planner downloads Mingla Business, signs in, picks "A trip" from the persona cards in the brand creation sheet, enters their brand name + bio + cover image, completes Stripe Connect onboarding, and lands on Home with a "Plan a trip" CTA waiting. They are a recognized seller in Mingla. They can't create a trip yet (that's Tr2) — but they exist as a brand of `kind='trip_planner'` with Stripe attached.

Stripe Connect is **required** for trip planners — no admin phone callback. Stripe's KYC + ID verification doubles as the planner's identity proof.

---

## 2. Smoke Test

1. Fresh install of mingla-business
2. Sign in with a new test account
3. **Open Brand Switcher Sheet** (Home tab "+" → Create brand, OR Account tab "+ New brand")
4. **Tap "A trip"** persona card
   - Expect: trip-specific wizard opens (different from event/place flows)
5. **Enter brand name:** "Wandering Soul Retreats"
6. **Enter bio:** "Small group retreats in Mexico and Costa Rica"
7. **Upload cover image** from photo library
8. **Tap Continue**
   - Expect: routed to Stripe Connect onboarding (existing flow, but flagged as required here)
9. Complete Stripe Connect onboarding in Stripe's hosted UI (test mode)
10. **Come back to Mingla**
    - Expect: lands on Home with "Plan a trip" CTA visible
    - Expect: brand chip at top shows the new brand
11. **Verify DB state:**
    ```sql
    SELECT id, name, slug, kind, stripe_connect_id, stripe_charges_enabled
    FROM public.brands
    WHERE name = 'Wandering Soul Retreats';
    ```
    Expect: `kind = 'trip_planner'`, `stripe_connect_id` populated, `stripe_charges_enabled = true`
12. **Verify Stripe Connect status on brand profile** at `/brand/{id}/payments` — should show "Onboarded"
13. **Regression:** create a popup brand same flow → verify "An event" path still works unchanged

---

## 3. Acceptance Criteria

| # | Criterion | Layer |
|---|-----------|-------|
| 1 | Brand creation sheet now shows three persona cards on no-match: "A place" / "An event" / "A trip" | UI |
| 2 | "A trip" card has a recognizable icon (plane / suitcase / compass) and one-line description ("I plan curated trips and multi-day experiences") | UI |
| 3 | Tapping "A trip" opens trip-specific brand creation flow | Routing |
| 4 | Trip-brand wizard captures: brand name + bio + cover image + Stripe Connect | UI |
| 5 | Cover image upload reuses existing `brand_covers` storage pipeline (ORCH-0805) | Service |
| 6 | Stripe Connect onboarding launched from the wizard, NOT deferred | Routing |
| 7 | Brand row written with `kind='trip_planner'` | DB |
| 8 | `brands.kind` CHECK constraint updated to allow `'trip_planner'` value | DB |
| 9 | Home tab CTA dynamically displays "Plan a trip" when current brand is `kind='trip_planner'` | UI |
| 10 | Brand creation fails gracefully if Stripe Connect onboarding abandoned (brand row exists in pending state; can resume) | Flow |
| 11 | "A place" persona card stub renders but does not yet open the venue claim flow (that's Ve1) | UI |
| 12 | "An event" persona card routes to today's minimal popup brand creation, unchanged | UI |
| 13 | Existing popup-brand creation flow (without persona fork) still accessible for users who don't see the new fork | Backward compat |

---

## 4. Files Touched

**`mingla-business/src/components/brand/`:**
- `BrandSwitcherSheet.tsx` — add persona fork rendering on no-match
- `PersonaPickerCards.tsx` (NEW) — three persona cards component
- `TripBrandWizard.tsx` (NEW) — trip-specific brand creation wizard

**`mingla-business/src/services/`:**
- `brandsService.ts` — `createBrand` accepts `kind='trip_planner'`; no other changes (the service already takes a `kind` param)

**`mingla-business/src/hooks/`:**
- `useBrands.ts` — `useCreateBrand` mutation passes through new kind value

**`mingla-business/app/`:**
- `(tabs)/home.tsx` — dynamic CTA based on current brand kind
- `connect-onboarding.tsx` — flag flow as required-for-trip-planner-onboarding (params)

**`supabase/migrations/`:**
- `<timestamp>_tr1_brands_kind_trip_planner.sql` (NEW)

---

## 5. Data Model Changes

```sql
-- supabase/migrations/<timestamp>_tr1_brands_kind_trip_planner.sql

-- Drop and recreate the kind CHECK to allow 'trip_planner'
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_kind_check;

ALTER TABLE public.brands
  ADD CONSTRAINT brands_kind_check
  CHECK (kind IN ('physical', 'popup', 'trip_planner'));

COMMENT ON COLUMN public.brands.kind IS
  'Mingla Business 1.2: physical=owns/leases venue; popup=organizer w/o fixed venue; trip_planner=multi-day trips. Per I-1.2-BRAND-AS-CONTAINER, kind is starting identity only — any brand can author any offering type via the universal "+" creator.';
```

No new tables. No new indexes (existing `idx_brands_account_id` + `idx_brands_slug_active` sufficient).

---

## 6. Dependencies

- **Upstream:** M0 (Hub tab + universal creator + `events.event_type` discriminator). Required because the persona fork and the top-bar "+" share UI surface with M0's work.
- **Downstream:** Tr2 (Minimum Viable Trip) — trip-planner brands must exist before they can create trips.
- **Sideways:** Ve1 (Physical Venue Brand Onboarding) — both build the persona fork in BrandSwitcherSheet; one of them adds the fork structure, the other adds the third card. Whichever lands first sets up the framework.

---

## 7. Regression Tests

1. **Today's popup brand creation flow** — must remain accessible and unchanged (a user who skips the persona picker, or who's already authenticated and creating a second brand, still gets the minimal flow)
2. **Stripe Connect onboarding return** — `stripe-onboarding-return.tsx` correctly routes back to Home regardless of brand kind
3. **Brand chip on Home** — switching between trip-planner brand and popup brand updates the brand chip + CTA correctly
4. **Brand list on Account tab** — both kinds appear correctly

Regression test files to add:
- `mingla-business/src/components/brand/__tests__/BrandSwitcherSheet.personaFork.test.tsx`
- `mingla-business/src/components/brand/__tests__/TripBrandWizard.test.tsx`
- `mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts`

---

## 8. Hard Guards (Do NOT)

- **Do NOT** implement the trip-creation wizard in this milestone — that's Tr2. Tr1 is just brand onboarding.
- **Do NOT** build the "A place" path beyond a stub — that's Ve1.
- **Do NOT** make Stripe Connect optional for trip planners — it's the identity proof per DEC-4 (project spec §8)
- **Do NOT** modify the brand profile (`/brand/[id]/index.tsx`) for trip-planner-specific rendering yet — that's a polish item for after Tr2
- **Do NOT** add a `place_pool_id` reference for trip planners — they don't claim a place

---

## 9. Open Polish Items

Resolve during Tr1's SPEC:
- Visual treatment of "A trip" persona card icon and copy
- Whether to show all three persona cards always, or only after the name field has no pool match (current plan: only on no-match)
- What happens if Stripe Connect onboarding fails or stalls — recovery UX
- Should trip-planner brands appear differently in the brand switcher (badge / icon) so operators can tell them apart at a glance?
- Whether to surface "Resume Stripe Connect" CTA on Home if onboarding is incomplete

---

## 10. Pipeline Notes (Seth-owned)

- **INVESTIGATE:** read BrandSwitcherSheet + connect-onboarding flow; confirm Stripe Connect already supports the params we'd pass
- **SPEC:** specify persona card UI in detail; specify trip-brand wizard flow; resolve §9 polish items
- **IMPLEMENT:** migration first → service layer → hook → wizard component → BrandSwitcherSheet integration → smoke test
- **TEST:** Stripe Connect test-mode end-to-end + persona fork + brand kind switching
- **CLOSE:** decision log entry for trip-planner Stripe Connect identity proof (DEC-4)

---

## 11. Pipeline Notes (Taofeek-owned)

Read this brief + the project spec §3.1 (brands migration). Open `BrandSwitcherSheet.tsx` and `connect-onboarding.tsx` to understand today's flow. The Stripe Connect onboarding is mature — you should not modify it, just route into it with the right params.

Start with the migration (low risk, easy rollback). Then build the persona picker cards. Then the trip-brand wizard. Then wire them into BrandSwitcherSheet. Run the smoke test on iOS Simulator with Stripe test mode at every step that involves Stripe.

If you discover Stripe Connect onboarding doesn't return cleanly from the trip-brand path (gets routed wrong on completion), pause and surface to Seth — this is the kind of integration detail that needs alignment.
