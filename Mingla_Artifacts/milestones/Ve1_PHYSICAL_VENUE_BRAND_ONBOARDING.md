# Ve1 — Physical Venue Brand Onboarding

> **Track:** Track 2 — Physical venues
> **Duration:** 1.5 weeks
> **Depends on:** M0 (in TestFlight; persona fork framework + universal creator)
> **Status:** locked, not started

---

## 1. User Outcome

A restaurant / bar / gallery / arcade owner downloads the business app, signs in, types their business name in the brand creation sheet. If we DON'T have them in `place_pool` (the pool-match flow is Ve2), they pick "A place" from the persona cards → category pills (Restaurant / Play / Creative & Arts) copied from the consumer preferences sheet → walk through a wizard capturing photos, structured address (via Google Places autocomplete), weekly hours, contact, description. Submit lands their claim in the `mingla-admin` queue with a 4-hour SLA countdown for admin phone verification.

---

## 2. Smoke Test

1. Sign in with a new test account
2. Open brand creation sheet → type a fake venue name (something NOT in `place_pool`)
3. Persona fork appears → tap "A place"
4. Category pills appear → tap "Restaurant"
5. Wizard steps:
   - **Address:** type address, pick from Google Places autocomplete dropdown
   - **Name + slug:** typed name carries through; slug auto-generated
   - **Photos:** upload 3 photos
   - **Hours:** set Mon-Sat 11am-10pm, Sun closed
   - **Contact:** phone, email, website
   - **Description:** "Family-owned Italian since 1995"
6. Tap Submit → see "Pending review — usually approved within 4 business hours" confirmation
7. **Verify DB state:**
   ```sql
   SELECT id, name, slug, kind, claim_status, lat, lng, city, country_code, address
   FROM public.brands WHERE name = 'Joe''s Pizza';
   -- Expect: kind='physical', claim_status='pending_review', lat/lng/city populated from Google Places
   SELECT weekday, open_time, close_time FROM public.brand_hours
   WHERE brand_id = <new-brand-id> ORDER BY weekday;
   -- Expect: 7 rows; Mon-Sat with 11:00/22:00; Sun NULL/NULL
   ```
8. **Verify admin queue:** open `mingla-admin/admin/claims` → see the new claim with: venue name, address, the contact phone the operator entered (Google-listed lookup is Ve2/Ve3 work — for off-pool the operator-provided phone is the calling target)
9. **Verify public visibility:** `/b/{slug}` returns "not found" or unverified-state placeholder (claim_status != 'verified')
10. **Regression:** today's popup-brand creation still works (skip persona fork OR pick "An event")

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Persona fork on no-match shows three cards (extends M0's persona stubs) |
| 2 | "A place" routes to category pill sub-fork |
| 3 | Category pills component reuses (or visually replicates) the consumer prefs sheet UI |
| 4 | Three categories: Restaurant / Play / Creative & Arts, each with description text |
| 5 | Wizard captures structured address via existing `googlePlacesService.ts` (ORCH-0824) |
| 6 | `brands.lat`, `lng`, `city`, `country_code`, `google_place_id` populated from Google Places |
| 7 | Photo upload reuses `brand_covers` storage pipeline |
| 8 | Hours editor writes to new `brand_hours` sidecar (7 rows per brand max) |
| 9 | `brands.kind` = 'physical', `claim_status='pending_review'` on submit |
| 10 | Submission creates row visible in `mingla-admin` admin queue |
| 11 | Confirmation screen shows "Pending review — usually 4 business hours" + email sent |
| 12 | Email via Resend confirms submission to the operator |
| 13 | All migrations from §5 below applied successfully |

---

## 4. Files Touched

**New:**
- `mingla-business/src/components/brand/PlaceCategoryPicker.tsx`
- `mingla-business/src/components/brand/PhysicalVenueWizard.tsx`
- `mingla-business/src/components/brand/VenueHoursEditor.tsx`
- `mingla-business/src/services/venueClaimService.ts`
- `mingla-admin/src/pages/AdminClaimsQueue.jsx` (NEW route)
- `supabase/functions/_shared/email/venueClaimSubmittedEmail.ts`
- `supabase/migrations/<timestamp>_ve1_physical_venue_columns_and_hours.sql`

**Modified:**
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (wires up "A place" path)
- `mingla-business/src/components/brand/PersonaPickerCards.tsx` (from Tr1)

---

## 5. Data Model Changes

Per project spec §3.1 + §3.2:

```sql
ALTER TABLE public.brands
  ADD COLUMN place_pool_id uuid REFERENCES public.place_pool(id),
  ADD COLUMN google_place_id text,
  ADD COLUMN lat numeric(10, 7),
  ADD COLUMN lng numeric(10, 7),
  ADD COLUMN city text,
  ADD COLUMN country_code char(2),
  ADD COLUMN claim_status text NOT NULL DEFAULT 'unclaimed'
    CHECK (claim_status IN ('unclaimed', 'pending_review', 'verified', 'rejected')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by uuid REFERENCES auth.users(id);

CREATE INDEX idx_brands_place_pool_id ON public.brands(place_pool_id) WHERE place_pool_id IS NOT NULL;
CREATE INDEX idx_brands_claim_status ON public.brands(claim_status);

CREATE TABLE public.brand_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time time,
  close_time time,
  is_24h boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, weekday)
);
ALTER TABLE public.brand_hours ENABLE ROW LEVEL SECURITY;
-- Read: anon for kind='physical' AND claim_status='verified'; auth for brand owners + members
-- Write: brand owners + members
```

For Ve1, off-pool signups only — `place_pool_id` is NULL. Ve2 adds the pool-match path.

---

## 6. Dependencies

- Upstream: M0 (persona fork stubs in place, data model discriminator)
- Sideways: Tr1 (persona fork framework — whoever lands first puts the framework in)
- Downstream: Ve2 (extends Ve1 with pool-match), Ve3 (admin queue interactions), Ve4 (public surface), Ve5-Ve7 (AI experience generation depends on `brands.kind='physical'` existing)

---

## 7. Regression Tests

1. Today's popup brand creation (no persona fork) — must remain accessible & unchanged
2. Trip-planner persona path (from Tr1) — must remain unchanged
3. Brand list on Account tab — physical brands appear correctly
4. Google Places autocomplete in event wizard (ORCH-0824) — must continue working (same service shared)

---

## 8. Hard Guards

- Don't implement the pool-match comparison flow — that's Ve2
- Don't make brands publicly visible until claim_status='verified' (Ve3 does the approval)
- Don't allow physical brand to create events or experiences until approved
- Don't allow `kind='physical'` claim to skip the admin queue
- Don't let two operators successfully claim the same `google_place_id` simultaneously without admin arbitration (Ve3's job)

---

## 9. Open Polish

- Visual treatment of category pills (mirror consumer prefs sheet exactly vs simplified)
- Photo upload max + min counts (default: min 1, max 6)
- Address autocomplete vs map-pin-drop alternative
- Tone of "Pending review" confirmation copy
- Whether to show admin's name / contact during pending state (probably no, but TBD)

---

## 10. Pipeline Notes

**Seth-owned:** INVESTIGATE: confirm `googlePlacesService.ts` from ORCH-0824 can drive the autocomplete here; check the consumer prefs sheet to copy the pills UI; verify mingla-admin has the auth + role infrastructure for a new admin route.

**Taofeek-owned:** start with the migration. Then build the category pills + wizard wireframe before integrating Google Places (so you can build UI without API dependency). Add Google Places last.

For the admin queue, mingla-admin uses React 19 + Vite + JSX (no TypeScript). It's a different stack from the business app. Read the existing admin pages first to understand the pattern.
