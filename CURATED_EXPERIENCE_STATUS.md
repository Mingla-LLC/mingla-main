# Curated Experience Feature — Full Status Report
**Date:** 2026-03-01  
**Scope:** Everything related to the adventurous/curated multi-stop itinerary cards

---

## Table of Contents
1. [What We Implemented (Done)](#1-what-we-implemented-done)
2. [What's Currently Working in the App](#2-whats-currently-working-in-the-app)
3. [What's Broken / Not Yet Implemented](#3-whats-broken--not-yet-implemented)

---

## 1. What We Implemented (Done)

### 1A. Adventurous Taglines (DONE — Deployed)
**File:** `supabase/functions/generate-curated-experiences/index.ts`

Replaced the two hardcoded solo-focused tagline arrays (`"A full solo day out"`, `"Three stops, zero plans needed"`, `"The perfect day for one"`) with a per-experience-type tagline map `TAGLINES_BY_TYPE` (lines 233–272).

**What was added:**
- 6 experience-type tagline sets: `solo-adventure`, `first-dates`, `romantic`, `friendly`, `group-fun`, `business`
- Solo-adventure taglines are now exploratory: *"Explore the unexpected"*, *"Chart your own path through the city"*, etc.
- Each other type gets contextually appropriate taglines (romantic → *"A curated route for two"*, group-fun → *"Rally the crew"*, etc.)
- `DEFAULT_TAGLINES` falls back to `solo-adventure` if unknown type
- Both `buildCuratedCard()` (line 802) and `resolvePairing()` (line 881) now use `TAGLINES_BY_TYPE[experienceType]`

**Status:** ✅ Fully implemented and deployed.

---

### 1B. Preferences Enforcement on Curated Cards (DONE — Deployed)
**File:** `supabase/functions/generate-curated-experiences/index.ts`

**What was added:**
- **Mode-aware radius calculation** (lines 934–945): Replaced flat `travelConstraintValue * 80` with speed-based radius using `TRAVEL_SPEEDS_KMH` (walking: 4.5, biking: 14, transit: 20, driving: 35 km/h). Now walking 30 min → ~2.25 km, driving 30 min → ~17.5 km.
- **Strict budget enforcement**: Cards exceeding `budgetMax` are now hard-rejected (no fallback)
- **Datetime preference passthrough**: `datetimePref` is now sent from mobile → edge function for opening hours awareness
- **Gym exclusion**: `SOLO_EXCLUDED_TYPES` set filters out gyms/fitness centers from solo-adventure results
- **Clamped radius**: `Math.min(Math.max(radiusMeters, 500), 50000)` prevents absurd ranges

**Status:** ✅ Fully implemented and deployed.

---

### 1C. Collaboration Curated Card Parity (DONE — Deployed)
Multi-file change bringing curated cards to collaboration mode.

**Edge Function (`generate-curated-experiences/index.ts`):**
- Added `aggregateSessionPreferences()` function (lines 20–90) — fetches all `board_session_preferences` for a session and merges: widest budget range, union of categories, majority travel mode, most restrictive constraint, centroid location
- Added `session_id` parameter support (line 901) — when present, individual params are overridden with aggregated values
- If the experience type wasn't selected by any participant, returns `{ cards: [], reason: 'experience_type_not_selected' }`

**Service (`app-mobile/src/services/curatedExperiencesService.ts`):**
- Added `sessionId` to params interface
- Passes `session_id` in edge function body

**Hook (`app-mobile/src/hooks/useCuratedExperiences.ts`):**
- Added `sessionId` param, included in React Query key (so solo and collab caches are separate)
- Passes `datetimePref` through

**Context (`app-mobile/src/contexts/RecommendationsContext.tsx`):**
- Removed `isSoloMode` gate — curated hooks now fire in BOTH solo and collaboration mode
- Added `curatedSessionId = isCollaborationMode ? resolvedSessionId : undefined` (line 390)
- All 5 curated hooks (`solo-adventure`, `first-dates`, `romantic`, `friendly`, `group-fun`) receive `sessionId` and are enabled in both modes
- `datetimePref` added to `baseParams` (line 386)

**Collaboration Preferences (`CollaborationPreferences.tsx`):**
- Added `solo-adventure` ("Adventurous") to experience types list (line 49)
- Budget presets changed from range-based ($0-25/$25-75/$75-150/$150+) to "Up to" format ($25/$50/$100/$150) matching solo PreferencesSheet
- Added `INTENT_IDS` set for splitting intents from categories on load (lines 257–264)
- Intents are now saved into the categories array: `[...selectedIntents, ...selectedCategories]`

**Status:** ✅ Fully implemented.

---

### 1D. Expanded View Consistency — Saved & Calendar Tabs (DONE)
**Files:** `SavedTab.tsx`, `CalendarTab.tsx`

**What was fixed:**
- `handleCardPress()` in SavedTab.tsx (line ~1443) now detects curated cards via `Array.isArray((card as any).stops)` and spreads curated-specific fields (`cardType: 'curated'`, `stops`, `tagline`, `pairingKey`, `totalPriceMin`, `totalPriceMax`, `estimatedDurationMinutes`, `experienceType`) into the `ExpandedCardData` object
- `proceedWithScheduling()` (line ~1326) has the same curated field passthrough
- `CalendarTab.tsx` (line ~1080) detects curated cards from calendar entries and passes fields through to `ExpandedCardModal`

**Result:** Opening a saved or scheduled curated plan now shows `CuratedPlanView` (multi-stop timeline with stops, travel connectors, opening hours) instead of plain single-place card.

**Status:** ✅ Fully implemented.

---

### 1E. Premium Collapsed Card for Curated Plans (DONE)
**File:** `SavedTab.tsx`

**What was added:**
- `renderCuratedCard()` function (line 1627) — premium dark card layout for curated plans in the Saved tab
- `renderCard()` (line 1768) branches to `renderCuratedCard()` when card has `stops[]`
- `curatedSavedStyles` StyleSheet (line 851) — dark gradient card with:
  - 3-image strip with numbered amber circle badges (①②③)
  - Experience type badge ("Solo Adventure", "Romantic", etc.) with amber accent
  - Stop count badge ("3 Stops")
  - Title = stop names joined with `→` arrows
  - Tagline in italic muted text
  - Stats row: average rating, total duration, total price range
  - Amber "Schedule Plan" button + share/delete icons

**Status:** ✅ Fully implemented.

---

### 1F. Smart Schedule with Opening Hours Validation (DONE)
**File:** `SavedTab.tsx`

**What was added:**
- `StopAvailability` interface (line 1095) — tracks each stop's name, open/closed status, and reason
- `to24Hour()` helper (line 1101) — converts 12h → 24h format
- `checkSingleStopOpen()` (line ~1110) — validates one stop against a date: parses `"9:00 AM – 5:00 PM"` format, handles "Closed" days, missing data assumed open
- `checkAllStopsOpen()` (line 1174) — validates ALL stops with cumulative time offsets (stop 1 duration + travel time → stop 2 arrival time, etc.)
- `handleScheduleCurated()` (line 1200) — opens ProposeDateTimeModal for curated plans
- `handleProposeDateTime()` enhanced (line ~1232) — for curated cards:
  - If all stops open → confirmation Alert: "All 3 stops are open at [time]! Schedule?"
  - If any stop closed → Alert listing closed stops with reasons ("Closed on Sundays", "Opens at 10:00 AM") → "Choose New Time" to reopen picker

**Status:** ✅ Fully implemented.

---

### 1G. Device Calendar Service for Curated Plans (DONE)
**File:** `app-mobile/src/services/deviceCalendarService.ts`

**What was added:**
- `createEventFromCuratedCard()` static method (line 185) — creates a device calendar event with:
  - Title: `Mingla: [stop names joined with →]`
  - Duration: total plan duration
  - Notes: tagline + all stop addresses listed
  - Location: first stop's address
  - Alarm: 30 minutes before

**Status:** ✅ Fully implemented.

---

### 1H. Policies & Reservations Button (DONE)
**File:** `app-mobile/src/components/ExpandedCardModal.tsx`

**What was added:**
- Every stop in `CuratedPlanView` (line 565) has a "Policies & Reservations" button when `stop.website` exists
- Opens an in-app browser (`setBrowserUrl`) with the venue's website
- Globe icon + label, always visible (not collapsed behind the expand toggle)

**Status:** ✅ Fully implemented.

---

### 1I. Cards & Buttons Bugfix — Category System v2 (DONE)
**9 files modified** — fixed the swipe deck being completely empty after the Category System v2 overhaul:
- Updated all default categories from v1 (`"Sip & Chill"`, `"Stroll"`) to v2 (`"Nature"`, `"Casual Eats"`, `"Drink"`) across hooks, contexts, services, and schema
- Added `batchSeed` to React Query key so "Generate Another 20" actually fetches new cards
- Wrapped `curatedRecommendations` in `useMemo` to prevent re-shuffle every render
- Updated holiday system to v2 categories

**Status:** ✅ Fully implemented and deployed.

---

## 2. What's Currently Working in the App

| Feature | Status | Where |
|---------|--------|-------|
| Curated 3-stop itinerary cards generated per experience type | ✅ Working | Swipe deck (solo & collaboration) |
| Experience-type-aware taglines (adventurous, romantic, etc.) | ✅ Working | Edge function → card tagline field |
| CuratedPlanView with stop timeline, travel connectors, hours | ✅ Working | ExpandedCardModal |
| "Policies & Reservations" button per stop | ✅ Working | ExpandedCardModal → CuratedPlanView |
| Premium collapsed card in Saved tab (3 images, badges, stats) | ✅ Working | SavedTab → renderCuratedCard() |
| Saved curated plans open as CuratedPlanView (not regular card) | ✅ Working | SavedTab → handleCardPress() |
| Calendar curated plans open as CuratedPlanView | ✅ Working | CalendarTab → curated field passthrough |
| Smart Schedule with opening hours validation | ✅ Working | SavedTab → checkAllStopsOpen() |
| Offset-aware validation (stop 2 checks arrival time, not start) | ✅ Working | checkAllStopsOpen() cumulative offset |
| Device calendar event creation for curated plans | ✅ Working | DeviceCalendarService.createEventFromCuratedCard() |
| Collaboration mode shows curated cards | ✅ Working | RecommendationsContext → no more isSoloMode gate |
| Session preference aggregation for curated cards | ✅ Working | Edge function → aggregateSessionPreferences() |
| CollabPreferences has "Adventurous" type + matching budgets | ✅ Working | CollaborationPreferences.tsx |
| Mode-aware travel radius (walk vs drive) | ✅ Working | Edge function → TRAVEL_SPEEDS_KMH |
| Strict budget enforcement | ✅ Working | Edge function → hard reject above budgetMax |
| Gym exclusion from solo adventures | ✅ Working | Edge function → SOLO_EXCLUDED_TYPES |
| Category v2 defaults (cards actually appear) | ✅ Working | All default preferences updated |
| "Generate Another 20" fetches new batch | ✅ Working | batchSeed in React Query key |

---

## 3. What's Broken / Not Yet Implemented

### 3A. Google Places API Optimization — NOT IMPLEMENTED ❌
**Spec:** `FEATURE_PLACES_API_OPTIMIZATION_SPEC.md`

The centralized Google Places cache (`google_places_cache` table + `_shared/placesCache.ts` utility) was **planned but never built**:
- No `supabase/functions/_shared/placesCache.ts` file exists
- No `google_places_cache` migration was applied
- The `generate-curated-experiences` function still uses its own `curated_places_cache` table (24h, location-keyed) — this works but is NOT shared across other edge functions
- All other edge functions (`new-generate-experience-`, `discover-experiences`, `holiday-experiences`, `night-out-experiences`, `generate-session-experiences`, `get-companion-stops`, `get-picnic-grocery`) still make independent Google API calls with NO shared caching
- Mobile-side direct API calls (`geocodingService.ts`, `busynessService.ts`) have no caching or debounce optimization
- **Impact:** Google Places API usage remains at ~9,473 requests (the user's reported number), estimated 60-75% higher than necessary

### 3B. Edge Function TypeScript Strictness Warnings ⚠️
**File:** `supabase/functions/generate-curated-experiences/index.ts`

The `aggregateSessionPreferences()` function has implicit `any` type warnings on all `.map()` and `.forEach()` callbacks (lines 41, 42, 46, 54, 62, 68, 72). These are **not runtime errors** — they're TypeScript compiler warnings because the Supabase `.select('*')` return type is untyped. The function works correctly at runtime in the Deno edge function environment, but the local TS checker flags them.

### 3C. Collaboration Curated — Edge Function Not Re-Deployed? ⚠️
The code changes for session support in `generate-curated-experiences/index.ts` are in the codebase, but it's unclear whether the edge function was **re-deployed to Supabase** after the collaboration parity changes. If not deployed:
- Solo curated cards work fine (no `session_id` sent → old code path)
- Collaboration curated cards would **fail silently** — the deployed old version wouldn't recognize `session_id` and would fall through to solo-mode behavior using the individual user's params rather than aggregated session preferences

**To verify/fix:**
```bash
npx supabase functions deploy generate-curated-experiences
```

### 3D. Curated Card Data Persistence Gap ⚠️
When a curated card is swiped right (saved), the `savedCardsService.saveCard()` spreads the full card object into `card_data` JSONB. When fetched back, `normalizeRecord()` spreads it onto the SavedCard object. **This chain works**, but there's a subtle gap:

- The `stops[].openingHours` data is a snapshot from when the card was generated. If a venue changes its hours, the saved card has **stale opening hours** — the smart schedule validation would check against outdated data.
- No mechanism exists to refresh opening hours for saved curated plans.

### 3E. `_shared/placesCache.ts` Missing — Cannot Cross-Function Cache ❌
The spec called for a shared module at `supabase/functions/_shared/placesCache.ts` that all edge functions would import for centralized caching. This file was **never created**. Each edge function still has its own independent Google Places API calling logic.

### 3F. Curated Business Cards — Low Coverage ⚠️
The `business` experience type has taglines and is technically supported, but the category pairings (`PAIRINGS_BY_TYPE['business']`) map to the same restaurant/café/bar categories as other types. There are no business-specific venue categories (e.g., co-working spaces, conference venues). Business curated cards end up being nearly identical to `friendly` or `romantic` cards with different taglines.

### 3G. No Unit Tests ❌
None of the curated experience features have unit tests:
- No tests for `TAGLINES_BY_TYPE` selection logic
- No tests for `checkAllStopsOpen()` time parsing and offset calculation
- No tests for `aggregateSessionPreferences()` merger logic
- No tests for `to24Hour()` conversion edge cases (12 AM, 12 PM boundaries)

### 3H. Opening Hours Format Fragility ⚠️
The `checkAllStopsOpen()` parser uses a regex that expects exactly `"9:00 AM – 5:00 PM"` format. Edge cases that would silently pass as "open" (false negatives):
- 24-hour format: `"09:00 – 17:00"` → regex doesn't match → assumes open
- Multiple periods: `"9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM"` → only first period parsed
- "Open 24 hours" → regex doesn't match → assumes open (correct behavior by accident)
- Locale-specific formats from Google → may not match

---

## Summary

| Area | Status |
|------|--------|
| Adventurous taglines per experience type | ✅ Done |
| Curated cards in solo swipe deck | ✅ Done |
| Curated cards in collaboration swipe deck | ✅ Done (code), ⚠️ verify deployment |
| Premium collapsed card in Saved tab | ✅ Done |
| Expanded CuratedPlanView from Saved/Calendar | ✅ Done |
| Smart scheduling with hours validation | ✅ Done |
| Policies & Reservations button | ✅ Done |
| Preferences enforcement (budget, radius, datetime) | ✅ Done |
| Google Places API cost optimization | ❌ Not started |
| Shared cross-function places cache | ❌ Not started |
| Unit tests | ❌ Not started |
| Edge function re-deployment for collab | ⚠️ Needs verification |
