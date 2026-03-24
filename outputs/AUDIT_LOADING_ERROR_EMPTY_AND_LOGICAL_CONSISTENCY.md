# Audit: Loading/Error/Empty States and Logical Consistency

## SECTION 6 -- Loading, Error, and Empty States

---

### 1. DiscoverScreen.tsx (ForYou tab)

**File:** `app-mobile/src/components/DiscoverScreen.tsx`

**Loading:**
- Line 3418-3422: Shows `ActivityIndicator` (spinner) + "Discovering experiences for you..." text, only on initial fetch (`recommendationsLoading && !hasCompletedInitialFetch`). Subsequent background refetches are invisible.
- No skeleton cards used. Pure spinner.

**Error:**
- Line 3426-3431: Shows error icon + "Something went wrong" + dynamic error message text. **No retry button on ForYou tab.** User must pull-to-refresh.
- Line 1879-1895: Error handling sets different messages: "Session expired. Pull down to retry." vs "Failed to load recommendations". Auth errors allow retry on next foreground; server errors set a date guard.
- **BUG: Inconsistent retry behavior.** NightOut tab (line 3566-3585) has an explicit Retry button. ForYou tab does NOT. User has no visible retry CTA except pull-to-refresh.

**Empty:**
- Line 3435-3442: Shows compass icon + "No experiences found" + "Try adjusting your preferences to discover new activities". No CTA button (just text).

**Violates "Show UI first, fetch after"?** Yes -- spinner blocks the entire content area during first load. No skeleton or shell UI.

---

### 2. DiscoverScreen.tsx (NightOut tab)

**File:** `app-mobile/src/components/DiscoverScreen.tsx`

**Loading:**
- Line 3553-3557: `ActivityIndicator` + "Discovering nightlife near you..."

**Error:**
- Line 3561-3586: Error icon + message + **Retry button** (orange, inline). Retry clears cache, re-fetches GPS, and reloads.

**Empty (no data):**
- Line 3590-3595: Moon icon + "No events found" + "No events found near your location. Try increasing your radius." (No radius adjustment CTA.)

**Empty (filters produce no results):**
- Line 3599-3609: Sliders icon + "No matching events" + "No events match your selected filters" + "Show All Events" CTA button.

**Violates "Show UI first, fetch after"?** Yes -- same spinner pattern as ForYou.

---

### 3. SavedTab.tsx

**File:** `app-mobile/src/components/activity/SavedTab.tsx`

**Loading:**
- Line 2047-2053: `ActivityIndicator` + "Loading saved experiences..." when `effectiveIsLoading` is true.

**Error:**
- **No error state rendered.** Errors from save/remove operations are caught and shown via `toastManager.error()` (line 1691) or `Alert.alert` (line 1328, 1487). But there is no fetch-error UI for the initial load of saved cards.

**Empty (filters active, no matches):**
- Line 2057-2081: Filter icon + "No matches" + "Try changing your filters or search." + "Clear filters" CTA button.

**Empty (truly empty):**
- Line 2084-2097: Heart icon + "Nothing saved yet" + "Swipe right on something great and it lands here." No CTA to navigate to Discover.

**Violates "Show UI first, fetch after"?** Yes -- spinner blocks content.

---

### 4. CalendarTab.tsx

**File:** `app-mobile/src/components/activity/CalendarTab.tsx`

**Loading:**
- **No loading state for initial data fetch.** The calendar entries come from a context/hook. No spinner or skeleton while loading.

**Error:**
- Line 335: `Alert.alert("Error", "Unable to reschedule. Please try again.")` for reschedule failures.
- Line 1143-1144: `console.error` for remove failures. No user-facing error for initial load.
- **No fetch-error UI rendered in the tab.**

**Empty (active tab):**
- Line 1710-1729: Calendar icon + "Your calendar's wide open" + "Save something you love and lock in a date."

**Empty (archive tab):**
- Line 1710-1729: Archive icon + "No past plans yet" + "Completed plans show up here."

**Violates "Show UI first, fetch after"?** N/A -- no loading state exists at all.

---

### 5. PersonHolidayView.tsx

**File:** `app-mobile/src/components/PersonHolidayView.tsx`

**Loading:**
- Line 376-384: `ActivityIndicator` + conditional text: "Loading recommendations..." (if location available) or "Getting your location..." (if not). Small inline spinner in a row layout.

**Error:**
- Line 387-397: Cloud-offline icon + "Couldn't load recommendations" + **Retry button** (orange badge with refresh icon + "Retry" text).

**Empty:**
- Line 853-855: "Mark a day that matters" CTA for custom holidays section. No explicit empty state for the paired cards section (it falls through to fallback cards via `sectionFallback`).

**Violates "Show UI first, fetch after"?** Partially -- spinner replaces the card row, but the rest of the parent view remains visible.

---

### 6. ExpandedCardModal.tsx

**File:** `app-mobile/src/components/ExpandedCardModal.tsx`

**Weather loading:**
- Lines 790, 829-841, 866-881: `loadingWeather` state. Passed to `WeatherSection` component.
- `WeatherSection.tsx` line 54-66: Shows "Weather" label + inline `ActivityIndicator` spinner. Does NOT render section at all if no data and not loading (line 68: `if (!weatherData) return null`).

**Busyness loading:**
- Lines 791, 845-858, 889-903: `loadingBusyness` state. Passed to `BusynessSection`.
- `BusynessSection.tsx` line 41-59: Shows two rows: "Traffic" + spinner, "Busy Level" + spinner. Returns null if no data and not loading (line 62).

**Booking loading:**
- Line 792, 909-923: `loadingBooking` state. Not visible how this renders (likely inline in booking section).

**Stroll/Picnic plan loading:**
- Line 1297-1312, 1334-1349: Shows `ActivityIndicator` + "Loading Plan..." text inside the button while generating.

**Error handling:**
- Lines 837-838, 855-856, 877-878, 900-901, 920-921: All `catch` blocks log to console only. **No user-facing error message for weather/busyness/booking fetch failures.** Section simply never renders (returns null).

**Violates "Show UI first, fetch after"?** No -- the modal shell, images, and basic info render immediately. Weather/busyness load asynchronously with inline spinners. This is the correct pattern.

---

### 7. SessionViewModal.tsx

**File:** `app-mobile/src/components/SessionViewModal.tsx`

**Loading:**
- Line 714-718: `ActivityIndicator` + "Loading session..." when session is loading OR validity/permission checks haven't completed yet.

**Error:**
- Line 722-730: Shows error text with three possible messages:
  - `sessionError` (network/fetch error)
  - "Session is no longer available." (validity check failed)
  - "You don't have access to this session." (permission check failed)
- Includes "Close" button to dismiss.
- Line 205-206, 221-223: Uses `BoardErrorHandler` for network errors with automatic error display.

**Empty (no cards):**
- Not explicitly handled in the visible code. The `loadingCards` flag (line 753) is passed to the cards section. Empty state likely handled by the child component.

**Permission error:**
- Lines 399-419: Dedicated permission checking with `BoardErrorHandler.checkSessionPermission()`. Sets `hasPermission` state. If no permission, error message rendered at line 722-730.

**Violates "Show UI first, fetch after"?** Yes -- full-screen spinner until session + permissions validated.

---

### 8. ProfilePage.tsx / ProfileHeroSection.tsx

**File:** `app-mobile/src/components/ProfilePage.tsx` + `app-mobile/src/components/profile/ProfileHeroSection.tsx`

**Location loading:**
- ProfilePage.tsx line 98-125: Sets `isLoadingLocation` state during GPS fetch.
- ProfileHeroSection.tsx line 262-263: Shows inline `ActivityIndicator` (small, gray) replacing the location text while loading.

**Location error:**
- ProfilePage.tsx line 117-122: Sets `locationError` state, falls back to last cached location from AsyncStorage.
- ProfileHeroSection.tsx: `locationError` prop is accepted (line 26) but **NOT rendered anywhere in the visible code**. The error is silently ignored in the UI. The location text just shows the cached value or "Somewhere cool, probably" (line 265).
- **BUG: `locationError` is passed as a prop but never displayed to the user.**

**Violates "Show UI first, fetch after"?** No -- location loads inline while rest of profile renders.

---

### 9. DismissedCardsSheet.tsx

**File:** `app-mobile/src/components/DismissedCardsSheet.tsx`

**Loading:**
- **No loading state.** The dismissed cards are passed as a prop array. No fetch happens in this component.

**Error:**
- **No error state.** Component is purely presentational.

**Empty:**
- Line 81-84: "No dismissed cards" plain text in center of sheet.
- **Minimal empty state** -- no icon, no description, just bare text.

**Violates "Show UI first, fetch after"?** N/A -- no fetching.

---

### Skeleton Component Usage Audit

**Two skeleton component files exist:**

1. `app-mobile/src/components/ui/LoadingSkeleton.tsx` -- exports `LoadingSkeleton`, `CardSkeleton`, `MessageSkeleton`
2. `app-mobile/src/components/SkeletonCard.tsx` -- exports `SkeletonCard`, `RecommendationSkeletonCard`, `SkeletonListItem`

**Where are they actually used?**

| Component | Used In | Notes |
|-----------|---------|-------|
| `SkeletonCard` (local) | `PairedSavesListScreen.tsx:59,192` | Locally defined skeleton, not imported |
| `SkeletonCard` (local) | `PairedProfileSection.tsx:31,132` | Locally defined skeleton, not imported |

**FINDING: Neither `LoadingSkeleton` nor `SkeletonCard` from the shared files are imported anywhere in any screen.**

The exported skeletons in `ui/LoadingSkeleton.tsx` and `SkeletonCard.tsx` are completely unused dead code. The two places that use skeletons define their own inline versions. Every other screen uses `ActivityIndicator` spinners.

---

## SECTION 7 -- Logical Consistency

---

### 1. ICON_MAP Coverage

**Three separate icon maps exist:**

**A. `constants/interestIcons.ts` -- CATEGORY_ICON_MAP (Lucide icons for profile page)**
- Line 44-57: 12 entries: `nature`, `first_meet`, `picnic_park`, `drink`, `casual_eats`, `fine_dining`, `watch`, `live_performance`, `creative_arts`, `play`, `wellness`, `flowers`
- Missing: `groceries` (hidden category, intentionally omitted)

**B. `utils/categoryUtils.ts` -- getCategoryIcon() (Ionicons for general use)**
- Line 184-199: 13 entries: same 12 + `picnic` alias
- Missing: `groceries` (hidden, intentionally omitted -- comment at line 198)
- Fallback: returns `'location'` for unknown slugs (line 201)

**C. `constants/categories.ts` -- Each category has an `icon` field (emoji)**
- Line 42-557: 12 categories with emoji icons (e.g., nature='🌿', first_meet='🤝')
- Missing: No `groceries` category in the main list

**FINDING:** There are 13 valid slugs (12 visible + 1 hidden `groceries`). All three icon maps cover the 12 visible categories. `groceries` is intentionally excluded from icon maps. No category is missing an icon.

**CONCERN:** Three separate icon systems (Lucide, Ionicons, emoji) for the same categories. The Lucide icons are only used on the profile page; Ionicons are used everywhere else; emojis are defined in `categories.ts` but not clear where they're rendered.

---

### 2. Price Display Format Across Surfaces

**Price display uses two parallel systems:**

| Surface | Code Location | Format |
|---------|--------------|--------|
| Discover grid cards | `DiscoverScreen.tsx:495,561,602,646` | `formatPriceRange(card.priceRange, currency)` |
| Discover grid (from API) | `DiscoverScreen.tsx:2989-2998` | `tierLabel(priceTier) + ' · ' + tierRangeLabel(priceTier)` |
| Saved tab cards | `SavedTab.tsx:1938-1940` | `formatTierLabel()` if priceTier exists, else `formatPriceRange()`, else `'Varies'` |
| Calendar tab | `CalendarTab.tsx:1430` | Uses `accountPreferences?.currency` with formatters |
| ExperienceCard | `ExperienceCard.tsx:443-445` | `formatTierLabel()` if priceTier, else `formatPriceRange()`, else `'Varies'` |
| Swipeable cards | `SwipeableCards.tsx:1723-1724` | `formatTierLabel()` if priceTier, else `formatPriceRange()` or `'Free'` |
| Board swipe cards | `SwipeableSessionCards.tsx:447-449` | `formatTierLabel()` if priceTier, else `formatPriceRange()` or `"$"` |
| Expanded modal | `ExpandedCardModal.tsx:19` | `formatPriceRange` imported |
| Share modal | `ShareModal.tsx:79-80` | `formatTierLabel()` if priceTier, else `formatPriceRange()` |
| Old ExperienceCard | `ExperienceCard.tsx:66` | Local `formatPrice(min, max)` -- `$min - $max` format |
| Old DetailedExperienceCard | `DetailedExperienceCard.tsx:166` | Local `formatPrice(min, max)` -- different format |

**FINDINGS:**
1. **Inconsistent fallback values:** SwipeableCards falls back to `'Free'`, SavedTab falls back to `'Varies'`, SwipeableSessionCards falls back to `"$"`. Three different strings for "no price data."
2. **Two legacy components** (`ExperienceCard.tsx:66`, `DetailedExperienceCard.tsx:166`) use their own inline `formatPrice()` function, not the shared `formatPriceRange()` or tier system.
3. The tier system and raw price range system coexist. A card might show "Comfy . $50 - $150" on one surface and "$75 - $120" on another depending on whether `priceTier` or `priceRange` is populated.

---

### 3. Travel Time Source Consistency

| Surface | Code Location | Source |
|---------|--------------|--------|
| Discover deck | `DiscoverScreen.tsx:286,1443,1464` | `card.travelTime` (string from API) |
| Saved tab | `SavedTab.tsx:1934` | `card.travelTime \|\| "15m"` |
| ExperienceCard | `ExperienceCard.tsx:440` | `experience.travelTime \|\| '15 min'` |
| Calendar tab | `CalendarTab.tsx:1183` | `experience.travelTime \|\| "N/A"` |
| Board card | `BoardSessionCard.tsx:125` | `cardData.travelTime \|\| "12 min drive"` |
| BoardDiscussion | `BoardDiscussion.tsx:98,125,152` | Hardcoded "12m", "18m", "25m" |
| Dismissed cards | `DismissedCardsSheet.tsx:113` | `card.distance \|\| card.travelTime` |
| Expanded modal (busyness) | `BusynessSection.tsx:66-67` | `busynessData.trafficInfo?.currentTravelTime \|\| travelTime \|\| "N/A"` |
| Curated swipe card | `CuratedExperienceSwipeCard.tsx:60` | `firstStop?.travelTimeFromUserMin` |
| Curated expanded | `ExpandedCardModal.tsx:536-546` | `stop.travelTimeFromPreviousStopMin` (inter-stop) |

**FINDINGS:**
1. **Five different fallback values:** `"15m"`, `"15 min"`, `"N/A"`, `"12 min drive"`, and hardcoded values in BoardDiscussion. Formats are inconsistent (some with units, some abbreviated).
2. **Travel time on expanded card comes from busyness API** (real-time traffic), while deck/saved show the original API-provided `travelTime` string. These can diverge significantly.
3. `BoardDiscussion.tsx` has **hardcoded mock travel times** (lines 98, 125, 152) that appear to be placeholder data.

---

### 4. Hours Source Consistency

**Opening hours flow:**
- Source: `card.openingHours` field (from Google Places API via edge function)
- Used in: `ProposeDateTimeModal.tsx` (lines 115-399) -- normalizes and parses weekday_text
- Live status: `useIsPlaceOpen` hook (4 files import it) -- computes real-time open/closed
- Expanded modal: Uses `useIsPlaceOpen` (imported at line 46) and `extractWeekdayText` (imported at line 21)

**Can one surface say "Open" while another says "Closed"?**
- YES. `useIsPlaceOpen` computes status based on current device time. If the user views a card at 8:59 PM and a place closes at 9:00 PM, different component renders could show different statuses depending on render timing.
- The `ProposeDateTimeModal` also has its own independent `isPlaceOpen` state (line 476) that checks against a *selected* date/time, not current time.
- There is no single cached "is open" state -- each component instance computes independently.

**FINDING:** Low risk in practice (millisecond timing edge case), but the architecture allows inconsistency. The Discover deck cards do NOT show open/closed status at all -- it only appears in expanded modal and scheduling modal.

---

### 5. Curated Stop Ordering

**File:** `app-mobile/src/utils/curatedToTimeline.ts`

- Line 32: `stops.forEach((stop, index)` -- iterates in array order, no sorting.
- The timeline is built from whatever order the `stops` array arrives in.
- No `stop_order` field or explicit sorting is applied in `curatedToTimeline.ts`.

**Where stops come from:**
- The `CuratedStop` type doesn't have a `stop_order` field in the type definition.
- Stop order depends entirely on the order returned by the edge function / API.
- The expanded modal at line 434 and 536 iterates stops in array order.

**FINDING:** Stop ordering is implicit (array position). If the API or database query doesn't guarantee order, stops could render in wrong sequence. No defensive sorting on the client side.

---

### 6. "Already Saved" Detection

**File:** `app-mobile/src/components/AppHandlers.tsx`

**When swiping right / saving from deck:**
- Lines 809-864: Checks database before saving:
  - **Session mode** (line 810-836): Queries `board_saved_cards` by `session_id`, matches by `card_data.id` or `card_data.experience_id`. Shows toast if duplicate.
  - **Solo mode** (line 838-864): Queries `saved_card` by `profile_id` + `experience_id`. Shows Toast (Android) or Alert (iOS) if duplicate.

**On Discover screen:**
- Line 3641: `isSaved={false}` is **hardcoded** on the ExpandedCardModal. The Discover screen never checks whether a card is already saved before showing it in the deck or expanded view.
- The deck itself (`SwipeableCards`) does not pre-filter saved cards. A user can see a card they already saved.
- Duplicate detection only happens at save-time, not at display-time.

**FINDING:** The deck does NOT pre-filter already-saved cards. Users will see cards they've already saved, and only get a duplicate warning after attempting to save again. This is a UX gap -- the save button in expanded modal always shows "Save" (never "Saved") because `isSaved` is hardcoded to `false`.

---

### 7. Currency Handling

**Source of truth:** `accountPreferences?.currency` (user setting, not GPS-based)

- All price formatting goes through `accountPreferences?.currency` with fallback to `"USD"`.
- `formatters.ts` line 3-4: Uses `getRate()` from `currencyService` and `currencySymbolMap` from `countryCurrencyService`.
- `priceTiers.ts` line 58-68: `tierRangeLabel()` accepts `currencySymbol` and `rate` parameters.
- Currency conversion uses stored exchange rates, not live rates.

**FINDING:** Currency is preference-based (user selects in settings), NOT GPS-based. Consistent across all surfaces -- every component passes `accountPreferences?.currency`. The only inconsistency is the fallback: most places use `"USD"` but one (`SwipeableSessionCards.tsx:260`) passes `accountPreferences?.currency` without a fallback, which would result in `undefined` being passed to `getCurrencySymbol()`, which defaults to `'$'` anyway (line 131 of formatters.ts). So effectively consistent.

---

## Summary of Critical Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | ForYou tab has no Retry button (NightOut tab does) | Medium | `DiscoverScreen.tsx:3426-3431` |
| 2 | `locationError` prop passed but never rendered in ProfileHeroSection | Low | `ProfileHeroSection.tsx:26,50` |
| 3 | Skeleton components exist but are completely unused (dead code) | Low | `ui/LoadingSkeleton.tsx`, `SkeletonCard.tsx` |
| 4 | Three different "no price" fallbacks: "Free", "Varies", "$" | Medium | Multiple files |
| 5 | Five different travel time fallbacks with inconsistent formatting | Medium | Multiple files |
| 6 | `isSaved` hardcoded to `false` on Discover expanded modal | Medium | `DiscoverScreen.tsx:3641` |
| 7 | Deck does not filter out already-saved cards | Low-Med | `DiscoverScreen.tsx`, `AppHandlers.tsx` |
| 8 | No error state for SavedTab initial load failure | Medium | `SavedTab.tsx` |
| 9 | No loading state for CalendarTab initial load | Low | `CalendarTab.tsx` |
| 10 | Curated stop order has no defensive sorting | Low | `curatedToTimeline.ts` |
| 11 | BoardDiscussion has hardcoded mock travel times | Low | `BoardDiscussion.tsx:98,125,152` |
| 12 | All main screens use spinners, not skeletons (violates "show UI first") | Medium | All screens |
