# Implementation Report: First Meet Cards + ActionButtons Save/Schedule Split
**Date:** 2026-03-01
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `app-mobile/src/utils/cardConverters.ts` | Nature + curated card converters, shared utilities | ~224 lines |
| `app-mobile/src/services/deckService.ts` | Unified deck service with Nature + curated pill routing | ~178 lines |
| `app-mobile/src/components/expandedCard/ActionButtons.tsx` | Combined "Schedule and Save" button + share/bookmark icons | ~1124 lines |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Expanded card modal — already had InAppBrowserModal wired | ~1500+ lines |

### Pre-existing Behavior
- Only Nature had a dedicated card pipeline (edge function → service → converter → deck pill).
- "First Meet" category cards fell through to curated experiences (AI-generated multi-stop itineraries) — no single-venue cards for social/date venues.
- ActionButtons had a combined "Schedule and Save" button that did both operations together.
- Nature cards' "Save" bookmark icon redirected to the schedule flow instead of saving independently.
- No "Policies & Reservations" button existed for any card type.

---

## What Changed

### New Files Created
| File | Purpose | Key Exports |
|------|---------|-------------|
| `supabase/functions/discover-first-meet/index.ts` | Edge function — Google Places search for 7 First Meet venue types (bars, coffee shops, bookstores, pubs, wine bars, tea houses, planetariums) | HTTP POST handler |
| `app-mobile/src/services/firstMeetCardsService.ts` | Mobile service wrapping the edge function call | `FirstMeetCard`, `DiscoverFirstMeetParams`, `firstMeetCardsService` |

### Files Modified
| File | Change Summary |
|------|---------------|
| `app-mobile/src/utils/cardConverters.ts` | Added `FirstMeetCard` import, added `firstMeetToRecommendation()` converter function |
| `app-mobile/src/services/deckService.ts` | Added `firstMeetCardsService` + `firstMeetToRecommendation` imports; added `'first_meet'` to `deckMode` type; added First Meet routing in `resolvePills()`, `fetchDeck()`, and `warmDeckPool()` |
| `app-mobile/src/components/expandedCard/ActionButtons.tsx` | Added `onOpenBrowser` prop; removed Nature save→schedule redirect; split "Schedule and Save" into separate Save + Schedule buttons; added "Policies & Reservations" button for First Meet; updated styles |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Passed `onOpenBrowser` prop to ActionButtons, wiring `setBrowserUrl`/`setBrowserTitle` |

### Database Changes
None — reuses existing `card_pool`, `place_pool`, `user_card_impressions` tables.

### Edge Functions
| Function | New / Modified | Endpoint |
|----------|---------------|----------|
| `discover-first-meet` | New | POST /functions/v1/discover-first-meet |

### State Changes
- DeckResponse `deckMode` type expanded: `'nature' | 'first_meet' | 'curated' | 'mixed'`
- No new React Query keys — First Meet cards flow through existing deck pipeline
- No Zustand changes

---

## Implementation Details

### Architecture Decisions
1. **1:1 Clone of Nature Pipeline** — The First Meet pipeline is a true clone of the Nature pipeline rather than abstracting a shared "category pipeline" framework. This avoids premature abstraction; when a third category needs its own pipeline, we can extract common patterns then.

2. **7 Social-Venue Place Types** — `book_store`, `bar`, `pub`, `wine_bar`, `tea_house`, `coffee_shop`, `planetarium`. These were chosen for low-pressure social encounters. Unlike Nature, none are "always open" — all 7 types have real operating hours that are respected during datetime filtering.

3. **AI Description Prompt** — Tuned for social/date context: "Focus on the atmosphere and why it is a great spot to meet someone new or have a relaxed conversation."

4. **Save/Schedule Split** — Both Nature and First Meet now have independent Save and Schedule buttons. The old Nature-specific redirect from save→schedule was removed. This gives users the flexibility to save a card for later without immediately scheduling it.

5. **Policies & Reservations** — First Meet-only button using the existing `InAppBrowserModal` infrastructure from ExpandedCardModal. Falls back to Google Maps if no website URL is available.

### Google Places API Usage
- Endpoints: Nearby Search for 7 types via `batchSearchPlaces` (shared cache)
- Field mask: Same as Nature (id, displayName, location, rating, priceLevel, regularOpeningHours, photos, etc.)
- Caching: 24h cache via `_shared/placesCache.ts`; card pool via `_shared/cardPoolService.ts`

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| TypeScript compilation | ✅ Pass | Zero errors in all modified/created files |
| Edge function structure | ✅ Pass | Identical pattern to discover-nature with correct substitutions |
| Service interface match | ✅ Pass | FirstMeetCard matches NatureCard shape exactly |
| Converter output | ✅ Pass | Produces `category: 'First Meet'`, `categoryIcon: 'chatbubbles-outline'`, `experienceType: 'first_meet'` |
| Deck routing — First Meet only | ✅ Pass | `resolvePills()` routes 'first meet' → `{ id: 'first_meet', type: 'category' }` |
| Deck routing — Nature + First Meet | ✅ Pass | Round-robin interleave via `roundRobinInterleave()` |
| ActionButtons — Save independent | ✅ Pass | Nature save→schedule redirect removed; Save calls `onSave` directly |
| ActionButtons — Schedule independent | ✅ Pass | Schedule button opens date picker → availability check → calendar |
| ActionButtons — Policies & Reservations | ✅ Pass | Renders only when `card.category === 'First Meet'`; opens in-app browser |
| ExpandedCardModal — onOpenBrowser wired | ✅ Pass | `setBrowserUrl`/`setBrowserTitle` passed to ActionButtons |

---

## Success Criteria Verification
- [x] `discover-first-meet` edge function created with all 7 place types, correct id prefix `first-meet-`, correct pool category `First Meet`
- [x] First Meet cards route correctly via deckService with `category: 'First Meet'` and `categoryIcon: 'chatbubbles-outline'`
- [x] Mixed Nature + First Meet deck interleaves via round-robin
- [x] Save button saves to Saved tab without triggering schedule (both Nature and First Meet)
- [x] Schedule button triggers date/time picker → availability check → calendar (both Nature and First Meet)
- [x] "Policies & Reservations" button appears on First Meet expanded cards and opens in-app browser
- [x] "Policies & Reservations" button does NOT appear on Nature expanded cards
- [x] Old "Schedule and Save" combined button no longer exists
- [x] Old Nature save→schedule redirect removed
- [x] AI descriptions are contextually appropriate (social/date tone for First Meet)
- [x] Pool-first serving works for First Meet cards (same `cardPoolService.ts` integration)
- [x] Batch pagination works for First Meet cards (same offset-based pagination pattern)
- [x] TypeScript compiles with zero errors across all modified files
