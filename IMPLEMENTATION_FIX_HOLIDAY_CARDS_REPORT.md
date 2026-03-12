# Implementation Report: Fix Holiday Cards

**Date:** 2026-03-12
**Spec:** FIX_HOLIDAY_CARDS_SPEC.md
**Status:** Complete

---

## 1. What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `supabase/functions/get-holiday-cards/index.ts` | Edge function for holiday card fetching — had hardcoded CATEGORY_TYPE_MAP, queried card_pool with slugs, wrong geo column names, returned 1 card per category with no photos from Places fallback | ~293 lines |
| `app-mobile/src/services/holidayCardsService.ts` | Service calling the edge function — HolidayCard interface missing categorySlug, lat, lng | ~44 lines |
| `app-mobile/src/components/PersonHolidayView.tsx` | Parent view for person holidays — passed raw intent types as category slugs | ~410 lines |
| `app-mobile/src/components/HolidayRow.tsx` | Holiday row with expandable cards — cards were static View (not tappable), raw slug labels, tiny size, no gradient/color | ~405 lines |
| `app-mobile/src/components/PersonRecommendationCards.tsx` | Recommendation cards below birthday hero — not tappable, raw category labels, no gradient/color | ~247 lines |

### Pre-existing Behavior
- Expanding a holiday row showed tiny (140×180) flat cards with raw slug labels like "fine_dining"
- Cards were not tappable — no way to navigate to the venue
- Pool queries always returned empty (wrong column names: `latitude`/`longitude` instead of `lat`/`lng`)
- Pool queries also used slugs instead of display names for category matching — double failure
- Google Places fallback returned only 1 card per category with no photo URL
- Intent types like "romantic" were passed raw to the edge function instead of being resolved to mapped category slugs
- No haptic feedback, no gradient overlay, no category colors on badges

---

## 2. What Changed

### New Files Created
None.

### Files Modified
| File | What Changed |
|------|-------------|
| `supabase/functions/get-holiday-cards/index.ts` | Replaced hardcoded CATEGORY_TYPE_MAP with shared `categoryPlaceTypes.ts` import. Added slug→display name resolution via `resolveCategory()`. Fixed geo column names (`lat`/`lng`). Added `categorySlug`, `lat`, `lng` to Card interface. Extract Places photo URLs. Return up to 3 cards per category. |
| `app-mobile/src/services/holidayCardsService.ts` | Added `categorySlug`, `lat`, `lng` fields to `HolidayCard` interface |
| `app-mobile/src/components/PersonHolidayView.tsx` | Imported `INTENT_CATEGORY_MAP` from holidays constants. Replaced `.map(sec => sec.categorySlug \|\| sec.type)` with `.flatMap()` + INTENT_CATEGORY_MAP resolution |
| `app-mobile/src/components/HolidayRow.tsx` | Cards changed from `<View>` to `<TouchableOpacity>` with haptic + Google Maps navigation. Added `LinearGradient` overlay, category-colored badges via `getCategoryColor()`, readable labels via `getReadableCategoryName()`, category icons on placeholders via `getCategoryIcon()`. Card size 140×180 → 180×230 with `shadows.md`. Rating formatted with `.toFixed(1)`. Added map navigate icon hint. |
| `app-mobile/src/components/PersonRecommendationCards.tsx` | Same treatment: `<View>` → `<TouchableOpacity>` with haptic + Maps, LinearGradient, category colors/labels/icons, 160×200 → 180×230 with shadows.md, rating `.toFixed(1)`, map hint icon. Removed unused `getSourceIcon` helper and `SOURCE_ICONS`/`SourceType`. |

### Database Changes Applied
None — no schema changes required.

### Edge Functions
| Function | New / Modified | Method | Endpoint |
|----------|---------------|--------|----------|
| `get-holiday-cards` | Modified | POST | /functions/v1/get-holiday-cards |

### State Changes
- **React Query keys added:** None
- **React Query keys invalidated by mutations:** None (no new mutations)
- **Zustand slices modified:** None

---

## 3. Spec Compliance — Section by Section

| Spec Section | Requirement | Implemented? | Notes |
|-------------|-------------|-------------|-------|
| §3.1 | 3-5 cards in horizontal scroll with venue image, category label, title, address, rating | ✅ | Up to 3 cards per category (up to 9 total for 3 categories) |
| §3.2 | Tap card opens Google Maps at venue coordinates or address fallback | ✅ | lat/lng preferred, address fallback via encodeURIComponent |
| §3.3 | Category badges show readable name with designated color | ✅ | Using getCategoryColor() and getReadableCategoryName() |
| §3.4 | Pool cards show stored image_url, Places cards show extracted photo | ✅ | Photo URL extracted from places.photos[0].name |
| §3.5 | Intent sections resolve via INTENT_CATEGORY_MAP | ✅ | flatMap + INTENT_CATEGORY_MAP in PersonHolidayView |
| §3.6 | Edge function queries with display names | ✅ | resolveCategory() before .eq("category", displayName) |
| §3.7 | Premium feel: elevation, gradient, sizing | ✅ | shadows.md, LinearGradient, 180×230 |
| §3.8 | PersonRecommendationCards same improvements | ✅ | Same interaction/styling pattern applied |
| §4 | No database changes | ✅ | No migrations created |
| §5.1 Step 1 | Replace CATEGORY_TYPE_MAP with canonical import | ✅ | Uses getPlaceTypesForCategory(resolveCategory(slug)) |
| §5.1 Step 2 | Resolve slugs to display names before pool query | ✅ | resolvedCategories array with slug + displayName |
| §5.1 Step 3 | Return up to 3 cards per category | ✅ | sorted.slice(0, 3) with linked-user boost |
| §5.1 Step 4 | Extract Places photo URLs | ✅ | photoRef → media URL with maxWidthPx=400 |
| §5.1 Step 5 | Fix lat/lng column names | ✅ | .gte("lat", latMin) instead of .gte("latitude", latMin) |
| §6.1.1 | HolidayCard interface updated | ✅ | categorySlug, lat, lng added |
| §6.1.2 | PersonHolidayView intent resolution | ✅ | flatMap + INTENT_CATEGORY_MAP |
| §6.1.3 | HolidayRow tappable + styled | ✅ | Full replacement per spec |
| §6.1.4 | PersonRecommendationCards tappable + styled | ✅ | Same pattern as HolidayRow |
| §7 | Implementation order followed | ✅ | Edge fn → Service → PersonHolidayView → HolidayRow → PersonRecommendationCards |

---

## 4. Implementation Details

### Architecture Decisions
- **Places API type limiting:** Google Places `includedTypes` array was sliced to first 5 types per category to stay within API limits, since the shared `categoryPlaceTypes.ts` can have 15+ types per category.
- **categorySlug fallback:** Both HolidayRow and PersonRecommendationCards use `card.categorySlug || card.category` for color/icon lookup, ensuring backward compatibility if any cached responses lack the new field.
- **PersonRecommendationCards uses `card.location.latitude`/`longitude`:** This is the existing shape from `personalizedCardsService.ts` — different from HolidayCards' flat `lat`/`lng`. Both patterns are handled correctly in their respective components.

### Google Places API Usage
- Endpoint: `https://places.googleapis.com/v1/places:searchNearby`
- Field mask: `places.id,places.displayName,places.rating,places.priceLevel,places.formattedAddress,places.photos,places.location`
- Photo URL construction: `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=400&key=${apiKey}`

---

## 5. Verification Results

### Success Criteria (from spec §3)
| # | Criterion | Result | How Verified |
|---|-----------|--------|-------------|
| 1 | Cards with images, labels, title, address, rating | ✅ PASS | Code review — all fields rendered in card template |
| 2 | Tap opens Google Maps | ✅ PASS | Linking.openURL with lat/lng or address fallback |
| 3 | Category badges with color | ✅ PASS | getCategoryColor() applied as backgroundColor |
| 4 | Pool images + Places photos | ✅ PASS | Pool: image_url field. Places: photo URL extraction |
| 5 | Intent resolution | ✅ PASS | flatMap + INTENT_CATEGORY_MAP wired in PersonHolidayView |
| 6 | Display name queries | ✅ PASS | resolveCategory() before .eq() |
| 7 | Premium styling | ✅ PASS | shadows.md, LinearGradient, 180×230 |
| 8 | PersonRecommendationCards updated | ✅ PASS | Same pattern applied |

### Bugs Found and Fixed During Implementation
| Bug | Root Cause | Fix Applied |
|-----|-----------|------------|
| Pool queries always returned empty | Edge function used `latitude`/`longitude` column names but table uses `lat`/`lng` | Changed to `.gte("lat", latMin)` etc. |
| Pool queries never matched categories | Edge function queried with slugs (`fine_dining`) but pool stores display names (`Fine Dining`) | Added `resolveCategory()` before `.eq("category", displayName)` |
| Places fallback returned no photos | Field mask missing photo extraction logic | Added photo URL construction from `places.photos[0].name` |
| Places fallback returned no coordinates | Field mask missing `places.location` | Added to field mask, extracted `latitude`/`longitude` |

---

## 6. Deviations from Spec

| Spec Reference | What Spec Said | What I Did Instead | Why |
|---------------|---------------|-------------------|-----|
| §5.1 Step 1 | Delete lines 13-27 and getIncludedTypes | Removed entire block including function | Exact line numbers shifted but same code was removed |
| §5.1 Google Places types | Use `getPlaceTypesForCategory(resolveCategory(slug) ?? slug)` | Used `getPlaceTypesForCategory(resolved.displayName)` with early continue if empty | resolveCategory already done in resolvedCategories; added guard for empty types array |
| §5.1 Places API | Send all types to Places API | Sliced to first 5 types | Google Places API has practical limits on includedTypes array size |
| §6.1.4 | Mentions line 94 for card View | Full rewrite of component | Applied same comprehensive treatment as HolidayRow rather than surgical edits |

---

## 7. Known Limitations & Future Considerations

- **Card deduplication:** If multiple categories return the same Google Place (e.g., a restaurant appears under both "Fine Dining" and "Drink"), duplicate cards will appear. A Set-based dedup on `card.id` could be added in the edge function.
- **Places API cost:** Returning 3 cards per category (up to 3 categories) means the Places fallback path can generate up to 9 cards. Each request counts against the API quota. The `maxResultCount: 5` in the Places request is reasonable.
- **Photo URL expiry:** Google Places photo URLs may have time-limited access. Cards from Places fallback may show broken images if cached and viewed much later. This is mitigated by React Query's `staleTime: 30min`.
- **PersonRecommendationCards location shape:** The personalized cards service returns `location: { latitude, longitude }` while holiday cards return flat `lat`/`lng`. If these services are ever unified, the client-side location handling would need normalization.

---

## 8. Files Inventory

### Created
None.

### Modified
- `supabase/functions/get-holiday-cards/index.ts` — Replaced CATEGORY_TYPE_MAP with shared import, fixed slug→display name resolution, fixed lat/lng columns, added categorySlug/lat/lng to response, extract Places photos, return up to 3 cards per category
- `app-mobile/src/services/holidayCardsService.ts` — Added categorySlug, lat, lng to HolidayCard interface
- `app-mobile/src/components/PersonHolidayView.tsx` — Wired INTENT_CATEGORY_MAP for intent type resolution
- `app-mobile/src/components/HolidayRow.tsx` — Cards now tappable (TouchableOpacity + haptic + Google Maps), LinearGradient overlay, category-colored badges, readable labels, 180×230 sizing, shadows.md
- `app-mobile/src/components/PersonRecommendationCards.tsx` — Same tappable + styling treatment as HolidayRow

---

## 9. Handoff to Tester

Tester: everything listed above is in the codebase. The spec (FIX_HOLIDAY_CARDS_SPEC.md) is the contract — compliance mapped in §3 above. Files inventory in §8 is your audit checklist. Key areas to stress-test:
1. **Pool query fix:** Verify cards actually come from card_pool when pool has data nearby (the lat/lng + display name fix was critical — this path was completely broken before)
2. **Intent resolution:** Expand Valentine's Day → verify request body has resolved slugs, not "romantic"
3. **Google Maps navigation:** Tap cards with lat/lng and without (address fallback)
4. **Photo URLs:** Verify Places fallback cards show actual venue photos
5. **Category colors:** Each badge should have its designated color, not black overlay
