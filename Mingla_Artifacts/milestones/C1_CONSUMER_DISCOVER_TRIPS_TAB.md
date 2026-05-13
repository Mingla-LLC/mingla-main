# C1 — Consumer Discover Trips Tab

> **Track:** Track 3 — Consumer surfacing
> **Duration:** 1.5 weeks
> **Depends on:** Tr2 (in TestFlight; real published trips exist to surface)
> **Status:** locked, not started

---

## 1. User Outcome

A consumer opens the Mingla **consumer app** (`app-mobile/`, NOT mingla-business), navigates to Discover, and sees a new "Trips" tab alongside the existing card stream. Real published trips from Mingla Business 1.2's trip planners appear as cards, filterable by city, dates, price range, and group size. Tapping a trip card opens the same public trip page used by share links (`/t/{brandSlug}/{tripSlug}` rendered from the consumer app side). The consumer can book the trip end-to-end without leaving the Mingla consumer app.

This is the first time the business app's content surfaces to consumers organically — until now, trip planners could share their link manually but trips weren't discoverable through Mingla.

---

## 2. Smoke Test

1. Fresh install of `app-mobile` (consumer app)
2. Sign in as a consumer test user
3. Navigate to Discover (existing surface)
4. **Verify a new "Trips" tab is visible** at the top or in a chip row (UX decision in SPEC)
5. Tap Trips tab
6. **See real trip cards** from Tr2-onward published trips, sorted by relevance (newest first or location-matched, TBD in SPEC)
7. Apply a city filter (e.g., "Tulum") — verify only Tulum trips remain
8. Apply a price range filter ($500-$2000) — verify only matching trips
9. Apply a group size filter (8-15 travelers) — verify only matching capacity trips
10. Tap a trip card → land on trip detail page (rendered in consumer app)
11. Tap "Reserve my spot" → complete buyer flow → land on confirmation
12. **Verify regression:** today's main Discover feed (cards, swipeable deck) is unaffected — works exactly as before
13. **Verify trip planner side:** trip planner sees the booking appear in their dashboard the same as if it came from a share link

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | New Trips tab UI in `app-mobile/` Discover surface |
| 2 | Trip card component renders: cover image, title, dates, destination, planner name + verified badge if planner is verified, price-from, capacity, "Reserve" CTA |
| 3 | Filter chips: city, dates (this month / next month / custom), price range, group size, intent (e.g., "yoga retreat", "food tour" — derived from trip metadata) |
| 4 | Sort: relevance (newest, location-proximity-aware), oldest, price ascending, price descending |
| 5 | Consumer-side service `tripsDiscoveryService.ts` queries published trips (`events` table filtered by event_type='trip', visibility='public', status='scheduled' or 'live', booking_deadline >= now) |
| 6 | Anon-tolerant — works without sign-in |
| 7 | Trip detail page rendered in `app-mobile/` (mirror of `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` but in the consumer app) |
| 8 | Buyer flow (pricing pick → buyer info → intake form → Stripe payment → confirmation) reuses same checkout pattern as event checkout (extended for trip-specific fields) |
| 9 | Empty state when no trips match filters: friendly message + suggestion to clear filters |
| 10 | Loading + error states for the trips query |
| 11 | Pagination or infinite scroll for trip list |
| 12 | Signal scoring extended to score trips alongside today's cards for intent matching |

---

## 4. Files Touched

**`app-mobile/` (consumer app):**

**New:**
- `app-mobile/src/screens/Discover/TripsTab.tsx`
- `app-mobile/src/components/discover/TripCard.tsx`
- `app-mobile/src/components/discover/TripFilterChips.tsx`
- `app-mobile/src/services/tripsDiscoveryService.ts`
- `app-mobile/src/hooks/useDiscoverTrips.ts`
- `app-mobile/app/t/[brandSlug]/[tripSlug].tsx` (consumer-side public trip page)
- `app-mobile/src/screens/Trip/TripDetail.tsx` (consumer-facing)
- `app-mobile/src/screens/Trip/TripCheckout.tsx`

**Modified:**
- `app-mobile/src/screens/Discover/DiscoverScreen.tsx` (adds Trips tab entry)
- `app-mobile/src/services/signalScoringService.ts` or equivalent (extend to score trips)

---

## 5. Data Model Changes

None — Tr2 already established the trip data model. This milestone is consumer-side read.

Verify view / RLS supports anon read of published trips:

```sql
-- Should already work via existing events RLS:
-- events with visibility='public' AND status IN ('scheduled','live') are anon-readable
-- trip_days + trip_pricing_tiers + trip_inclusions also anon-readable for published trips
```

If existing RLS denies anon read, add a `published_trips_public_view` similar to `claimed_venues_public_view`.

---

## 6. Dependencies

- Upstream: Tr2 (trips exist), Tr3/Tr4/Tr5/Tr6/Tr7 (richer trips improve consumer experience but C1 doesn't strictly require them all)
- Sideways: Tr8 (AI-generated itineraries make trips more attractive in the consumer feed)

---

## 7. Regression Tests

1. Today's main Discover feed (cards, swipeable deck) — unaffected
2. Anon access — works without sign-in
3. Empty state when no trips match — friendly message
4. Filter combinations — multi-filter applies correctly
5. Trip planner-side dashboard — bookings from consumer-app appear correctly
6. Consumer signed-in OR signed-out — both see the same trips (consumer auth not required for browsing)

---

## 8. Hard Guards

- Don't surface unpublished trips (draft / cancelled / past)
- Don't surface trips past their booking_deadline
- Don't surface trips without at least one published pricing tier
- Don't allow consumer to "preview" the trip planner's manage view
- Don't break the existing Discover surface — trips are additive

---

## 9. Open Polish

- Trip card visual treatment (full-bleed image vs structured grid)
- Sort default (newest vs location-proximity)
- Whether to mix trips into the main feed for matching intent (defer to C2 which composes multi-stops)
- Empty state imagery
- Saved/favorited trips (defer)
- Trip card on the public consumer profile (defer; consumer-app feature, not 1.2 scope)

---

## 10. Pipeline Notes

**Seth-owned:** consumer-side work crosses the `app-mobile/` boundary. INVESTIGATE: confirm signal scoring service accepts new content type; verify auth-less reads work without policy changes.

**Taofeek-owned:** consumer app is a different codebase from mingla-business but shares the same Supabase backend. The trip data is already there; this is largely a consumer-app feature build. Read existing Discover surface in `app-mobile/` before starting. The buyer flow can mirror the mingla-business buyer flow (Tr2) closely — same Stripe integration, same checkout pattern.
