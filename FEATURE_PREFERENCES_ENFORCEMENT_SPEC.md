# Feature: Preferences-Driven Card Personalization & UI Polish

**Date:** 2026-02-28
**Status:** Planned
**Requested by:** User — "I want the preferences sheet to make sure the cards I see are perfectly personalized to me."

---

## Summary

The Preferences Sheet already collects travel mode, budget, time, distance, and datetime — but several of these values are either ignored or loosely enforced when generating curated experience cards. This feature enforces **strict preference filtering** so users never see cards that violate their settings. It also adds a universal "Policies & Reservations" in-app browser button to every stop, excludes gyms from solo adventures, and tightens the curated plan UI for a premium compact feel.

---

## User Stories

1. **As a user**, I want my travel mode (walking/biking/transit/driving) to change the travel times displayed on curated cards so I get accurate time estimates.
2. **As a user**, I want my budget cap enforced — if I set $100, I should never see a card whose minimum cost exceeds $100.
3. **As a user**, I want only places that are open at my selected time to appear in recommendations and curated stops.
4. **As a user**, I want my travel distance/duration limit to properly restrict how far cards are from me, based on my travel mode.
5. **As a user**, I want to never see gyms (e.g., Planet Fitness) in solo adventure cards.
6. **As a user**, I want every stop in a curated plan to have a "Policies & Reservations" button that opens the venue's website in an in-app browser.
7. **As a user**, I want the curated plan UI to feel premium and compact — no excessive white space, no text bleeding outside boxes.

---

## Architecture Impact

### Modified Files

| File | Change |
|------|--------|
| `supabase/functions/generate-curated-experiences/index.ts` | Mode-aware radius, strict budget, datetime/opening-hours filtering, gym exclusion |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Pass `datetimePref` in `baseParams` |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Accept & forward `datetimePref` param |
| `app-mobile/src/services/curatedExperiencesService.ts` | Pass `datetimePref` through to edge function |
| `app-mobile/src/components/ExpandedCardModal.tsx` | "Policies & Reservations" button on all stops; UI tightening |
| `app-mobile/src/types/curatedExperience.ts` | No changes needed — `website` field already exists on `CuratedStop` |

### New Files

None.

### New DB Tables/Columns

None.

### External APIs

- **Google Places API (New):** `currentOpeningHours` field added to field mask to enable time-based filtering.

---

## Change 1: Mode-Aware Radius Calculation

### Problem

The edge function calculates search radius with a flat `travelConstraintValue * 80` regardless of travel mode. This means a 30-minute walking constraint and a 30-minute driving constraint produce the same 2.4 km radius — completely wrong.

### Solution

Replace flat multiplier with mode-specific speed-based radius:

```typescript
// OLD (broken):
const radiusMeters = travelConstraintType === 'time'
  ? travelConstraintValue * 80
  : travelConstraintValue;

// NEW (mode-aware):
const TRAVEL_SPEEDS_KMH: Record<string, number> = {
  walking: 4.5,
  biking: 14,
  transit: 20,
  driving: 35,
};

const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;

const radiusMeters = travelConstraintType === 'time'
  ? Math.round((speedKmh * 1000 / 60) * travelConstraintValue)  // km/h → m/min × minutes
  : travelConstraintValue * 1000;  // km → meters

const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);
```

**Impact:** Walking 30 min → ~2.25 km radius. Driving 30 min → ~17.5 km radius. This means drivers see a much wider variety of places, walkers see nearby ones — exactly as expected.

---

## Change 2: Strict Budget Enforcement

### Problem

The current code allows cards that exceed `budgetMax` if retries are exhausted — it "prioritizes diversity over strict filtering." Users report seeing cards above their set budget.

### Solution

In `resolvePairingFromCategories()`, make the budget check a hard gate with NO fallback:

```typescript
// OLD (soft — allows cards on last retry):
if (budgetMax > 0 && totalPriceMin > budgetMax) {
  if (retryCount < MAX_RETRIES) { /* retry */ }
  else { /* allow anyway — diversity > accuracy */ }
}

// NEW (strict — never allow):
const totalPriceMin = stops.reduce((sum, s) => sum + s.priceMin, 0);
if (budgetMax > 0 && totalPriceMin > budgetMax) {
  return null;  // Always reject — never show cards above budget
}
```

Also filter individual places before selection:

```typescript
// When picking a place from a category, skip places whose priceMin alone exceeds budgetMax
const affordablePlaces = categoryPlaces.filter(p => {
  if (budgetMax <= 0) return true;
  return (p.priceMin ?? 0) <= budgetMax;
});
```

---

## Change 3: DateTime / Opening Hours Filtering

### Problem

The `datetime_pref` from PreferencesSheet is never passed to the curated experiences edge function. The edge function does not check whether stops are open at the user's requested time. Users see stops that are closed.

### Solution

**Mobile side — pass datetime:**

In `RecommendationsContext.tsx`, add `datetimePref` to `baseParams`:

```typescript
const baseParams = {
  location: userLocation,
  budgetMin: userPrefs?.budget_min ?? 0,
  budgetMax: userPrefs?.budget_max ?? 1000,
  travelMode: userPrefs?.travel_mode ?? 'walking',
  travelConstraintType: ...,
  travelConstraintValue: ...,
  datetimePref: userPrefs?.datetime_pref ?? new Date().toISOString(),  // NEW
  batchSeed,
};
```

Thread `datetimePref` through `useCuratedExperiences` → `curatedExperiencesService` → edge function.

**Edge function side — filter by open hours:**

1. Request `currentOpeningHours` or `regularOpeningHours` in the Google Places field mask.
2. When selecting places for stops, check if the place is open at the requested datetime.
3. Filter logic:

```typescript
function isPlaceOpenAt(place: any, targetDatetime: string): boolean {
  // If no opening hours data available, assume open (be permissive)
  if (!place.regularOpeningHours?.periods) return true;

  const target = new Date(targetDatetime);
  const dayOfWeek = target.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const timeMinutes = target.getHours() * 60 + target.getMinutes();

  for (const period of place.regularOpeningHours.periods) {
    if (period.open?.day === dayOfWeek) {
      const openMin = (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0);
      const closeMin = period.close
        ? (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0)
        : 24 * 60; // If no close time, assume open until midnight

      if (timeMinutes >= openMin && timeMinutes < closeMin) {
        return true;
      }
    }
  }
  return false;
}
```

4. **ALL stops** in a curated card must be open at the target datetime for the card to be included. If any stop is closed, the entire card is rejected.
5. For "now" date option, use the current server time.

---

## Change 4: Travel Distance/Duration Filtering Per Mode

### Problem

The radius is mode-agnostic (Change 1 fixes this), but additionally, after fetching places, the function does NOT verify that individual stops are actually reachable within the user's constraint. A place at 2 km straight-line distance might take 40 minutes walking.

### Solution

After building stops, verify the total itinerary travel time fits within the user's time constraint:

```typescript
// After building all stops in resolvePairingFromCategories():
if (travelConstraintType === 'time') {
  const totalTravelMinutes = stops.reduce(
    (sum, s) => sum + (s.travelTimeFromPreviousStopMin ?? s.travelTimeFromUserMin), 0
  );
  if (totalTravelMinutes > travelConstraintValue * 1.5) {
    // Total travel time exceeds 1.5× the user's limit — reject
    return null;
  }
}
```

Also pass `travelConstraintType` and `travelConstraintValue` to the edge function (already done via body params).

---

## Change 5: Exclude Gyms from Solo Adventures

### Problem

The `sports-recreation` or `wellness-spa` category fetches gym-type places (Planet Fitness, etc.) which are not appropriate for solo adventure cards.

### Solution

Add gym-related types to the excluded types set in `fetchPlacesByCategoryWithCache()`:

```typescript
const SOLO_EXCLUDED_TYPES = new Set([
  'gym',
  'fitness_center',
  'athletic_field',
  'sports_club',
  'health_club',
]);

// When building category places for solo-adventure:
if (experienceType === 'solo-adventure') {
  categoryPlaces = categoryPlaces.filter(p =>
    !SOLO_EXCLUDED_TYPES.has(p.primaryType) &&
    !(p.types ?? []).some(t => SOLO_EXCLUDED_TYPES.has(t))
  );
}
```

---

## Change 6: "Policies & Reservations" Button on All Stops

### Problem

Currently only fine-dining stops (gated by `FINE_DINING_TYPES.has(stop.placeType)`) get a "Reserve a Table" button. Users want every stop to have a way to view the venue's website for policies and reservations.

### Solution

In `CuratedPlanView` inside `ExpandedCardModal.tsx`:

1. Replace the fine-dining-only "Reserve a Table" button with a universal **"Policies & Reservations"** button.
2. Show it on **every stop** that has a `website` URL (not just fine dining).
3. Keep the existing `InAppBrowserModal` integration — just change the trigger:

```tsx
// OLD (fine dining only):
{isFineDining && (
  <TouchableOpacity onPress={() => { setBrowserUrl(stop.website!); }}>
    <Text>Reserve a Table</Text>
  </TouchableOpacity>
)}

// NEW (all stops with website):
{stop.website && (
  <TouchableOpacity
    style={curatedStyles.policiesButton}
    onPress={() => {
      setBrowserTitle(stop.placeName);
      setBrowserUrl(stop.website!);
    }}
    activeOpacity={0.8}
  >
    <Ionicons name="globe-outline" size={15} color="#ffffff" />
    <Text style={curatedStyles.policiesButtonText}>Policies & Reservations</Text>
  </TouchableOpacity>
)}
```

4. Style the button distinctly (neutral dark tint, not purple — purple was specific to fine dining):

```typescript
policiesButton: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#333338',
  paddingVertical: 8,
  paddingHorizontal: 14,
  borderRadius: 8,
  marginTop: 4,
  gap: 6,
},
policiesButtonText: {
  color: '#ffffff',
  fontSize: 13,
  fontWeight: '600',
},
```

---

## Change 7: UI Polish — Compact Premium Feel

### Problem

White space issues and text bleeding outside boxes in the CuratedPlanView.

### Specific Fixes

1. **Reduce vertical padding** on stop cards:
   - `stopCard.padding`: 16 → 12
   - `stopCard.gap`: reduce or remove implicit spacing

2. **Add `numberOfLines` to all text elements** to prevent text bleeding:
   - Stop name: `numberOfLines={1}` (already set — verify)
   - AI description: `numberOfLines={3}` with `ellipsizeMode="tail"`
   - Address: `numberOfLines={1}`
   - Place type: `numberOfLines={1}`

3. **Tighten travel connector** between stops:
   - Reduce connector height/padding
   - Make the dashed line + travel icon more compact

4. **Reduce infoSection padding** on swipe card:
   - `infoSection.padding`: 16 → 12
   - `infoSection.gap`: 8 → 6

5. **Ensure stop images are constrained**:
   - Use `overflow: 'hidden'` on image containers
   - Set max-height on expanded content

6. **Opening hours section** — make it more compact:
   - Smaller font size for hours text (13 → 12)
   - Reduce gap between day rows (6 → 4)

7. **Summary footer** — reduce padding:
   - `summaryCard.padding`: 16 → 12

---

## Test Cases

1. **Travel mode affects times:** Set travel mode to "walking" → card shows ~15 min between stops. Switch to "driving" → same route shows ~3 min. Verify the travel time on the card changes.

2. **Budget cap enforced:** Set budget to $25. Verify NO card's `totalPriceMin` exceeds $25. Repeat at $50, $100, $150.

3. **Opening hours respected:** Set time to 2:00 AM. Verify no cards are returned (or only 24h venues like gas stations). Set to 12:00 PM noon. Verify all stops in every card are open at noon.

4. **Distance/duration constraint:** Set walking + 15 min limit. Verify all stops are within ~1.1 km. Set driving + 30 min. Verify stops can be up to ~17 km away.

5. **No gyms:** Swipe through 20+ solo adventure cards. Verify zero gym/fitness results (no Planet Fitness, LA Fitness, etc.).

6. **Policies & Reservations button:** Expand any curated card. Every stop with a `website` field should show "Policies & Reservations" button. Tap it → in-app browser opens with the venue's website. Close button dismisses the browser.

7. **UI compactness:** Expand a curated card. Verify no excessive white space between stops. Verify all text fits within its container (no bleeding/overflow). Verify the feel matches a premium dark-theme app.

---

## Success Criteria

- [ ] Travel mode change in preferences immediately changes travel times on generated cards
- [ ] No card appears with `totalPriceMin` above user's `budgetMax`
- [ ] All stops in all cards are open at the user's selected datetime
- [ ] Search radius is mode-aware (walking ~2km, driving ~17km for 30 min constraint)
- [ ] Zero gyms/fitness centers appear in solo adventure cards
- [ ] Every stop with a website shows "Policies & Reservations" → opens in-app browser
- [ ] CuratedPlanView has compact spacing, no text overflow, premium feel
- [ ] No regressions in non-solo-adventure card types (first-dates, romantic, etc.)
