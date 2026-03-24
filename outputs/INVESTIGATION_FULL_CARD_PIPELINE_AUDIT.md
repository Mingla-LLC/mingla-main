# Full Card Pipeline Audit

**Date:** 2026-03-24
**Investigator:** Software and Code Architect (Forensic Mode)
**Scope:** Complete forensic trace of every card-related path — preferences through rendering, saving, scheduling, and display consistency.
**Prior work excluded:** Preferences race condition, collab prefs wiring (S1 spec), discover speed spec, paired holiday latency, curated save/schedule/review bugs, curated stop generation bugs, 10 deck hardening passes.

---

## Summary (Plain English)

The card pipeline has **deep inconsistency problems across surfaces**. The same card looks different depending on where you see it — different icons, different price formats, different rating fallbacks, and fabricated placeholder data like fake "4.5" ratings and "12 min drive" travel times. Currency conversion only works on 2 of 8+ surfaces. Opening hours are accepted as a prop in the expanded view but never actually rendered.

The save flow works but has **no rollback if save fails** — the card is already gone from the deck. The schedule flow has **4 entry points with wildly different validation** — one auto-schedules with zero validation, another checks all curated stops' hours. Loading states use spinners everywhere despite two unused skeleton components sitting in the codebase. Several screens have no error state at all.

The preferences-to-deck contract is solid for solo mode but **collab mode has dead code** — aggregated preferences are computed but never wired into the deck fetch (moot since collab uses a separate server-side deck, but the dead code is confusing). `budgetMin` is dead everywhere — carried through 4 layers of interfaces but hardcoded to 0.

---

## Section 1: Preferences → Deck Contract

### Facts (with file:line evidence)

**Fields the user can set in PreferencesSheet (PreferencesSheet.tsx:160-201):**
- `selectedCategories` (up to 3), `selectedIntents` (up to 1, radio behavior)
- `selectedPriceTiers` (array of PriceTierSlug)
- `travelMode`, `constraintValue` (minutes)
- `selectedDateOption`, `selectedTimeSlot`, `exactTime`, `selectedDate`
- `useGpsLocation`, `searchLocation`, `selectedCoords`

**Save handler `handleApplyPreferences` (PreferencesSheet.tsx:768):**
1. Closes sheet IMMEDIATELY (line 814) before saving — fire-and-forget async
2. Solo mode (line 847): calls `onSave(preferences)` → `AppHandlers.handleSavePreferences`
3. Collab mode (line 821): calls `updateBoardPreferences(dbPrefs)`
4. After save, invalidates 4 query keys (lines 863-866): `"curated-experiences"`, `"userLocation"`, `"deck-cards"`, `"userPreferences"`

**AppHandlers.handleSavePreferences (AppHandlers.tsx:565):**
- Writes all fields to DB (lines 593-632)
- Optimistic cache update to `["userPreferences", userId]` BEFORE DB write (lines 634-652)
- Computes prefs hash; if changed, resets deck history (lines 654-659)
- Bumps `preferencesRefreshKey` (lines 662-663) — triggers RecommendationsContext refresh

**RecommendationsContext solo deck params (RecommendationsContext.tsx:307-337):**
- `categories` from `userPrefs.categories` with fallback to defaults
- `intents` from `userPrefs.intents`, capped to 1

**useDeckCards call (RecommendationsContext.tsx:406-426):**
- `categories` and `intents`: from `activeDeckParams` (correct)
- `priceTiers`, `budgetMin`, `budgetMax`, `travelMode`, `travelConstraintValue`, `datetimePref`, `dateOption`, `timeSlot`, `exactTime`: ALL from `userPrefs?.xxx` directly (lines 410-419)

**useDeckCards.ts query key (lines 87-104):** Includes ALL preference fields — change any field → new key → new fetch.

**staleTime:** 30 minutes (line 111). **placeholderData:** keeps previous data visible during refetch (line 115).

**deckService.fetchDeck (deckService.ts:235):** Sends all params to `discover-cards` edge function. **`budgetMin` is NOT sent** (line 279) — only `budgetMax`.

**discover-cards edge function:** Receives params, computes radius from travel mode/constraint, filters by categories/price tiers via `query_pool_cards` RPC. `budgetMin` hardcoded to 0 (line 445). DateTime filtering happens AFTER pool fetch via `filterByDateTime()` (line 461).

**query_pool_cards SQL (migration 20260322500000, line 37):** Filters by `is_active`, `card_type`, category overlap, lat/lng bounding box, price tier match (with NULL passthrough), impression exclusion, type exclusions.

**aggregateAllPrefs (sessionPrefsUtils.ts:31-131):** Aggregates `categories`, `intents`, `priceTiers`, `budgetMin/Max`, `travelMode`, `travelConstraintValue`, `datetimePref`, `location`. Does NOT aggregate `dateOption`, `timeSlot`, `exactTime`.

### Bugs Found

**BUG S1-1: `budgetMin` is dead code (4 layers)**
- Severity: YELLOW
- Carried through PreferencesSheet → AppHandlers → RecommendationsContext → useDeckCards → deckService. Never sent to edge function. Edge function hardcodes it to 0. No filtering on minimum price ever occurs.
- Files: deckService.ts:279, discover-cards/index.ts:445

**BUG S1-2: `initialData` pill-only matching allows stale batch on cold start (useDeckCards.ts:66-70)**
- Severity: ORANGE
- The Zustand batch cache match uses only `batchSeed + activePills` (categories). Changing price tiers, travel mode, budget, or time prefs could serve stale `initialData` from previous session with different non-category preferences.
- File: useDeckCards.ts:66-70

**BUG S1-3: Collab `aggregateAllPrefs` drops `dateOption`, `timeSlot`, `exactTime`**
- Severity: YELLOW
- These fields exist in `BoardSessionPreferences` (useBoardSession.ts:35-37) and are saved by PreferencesSheet in collab mode (lines 832-835), but `aggregateAllPrefs` never reads them. The `AggregatedCollaborationPrefs` interface doesn't include them.
- File: sessionPrefsUtils.ts (entire function)

**BUG S1-4: Collab `collabDeckParams` aggregated values are dead code**
- Severity: YELLOW
- `collabDeckParams` correctly computes aggregated `priceTiers`, `budgetMin/Max`, `travelMode`, `travelConstraintValue`, `datetimePref` from `aggregateAllPrefs()` (RecommendationsContext.tsx:340-361). But these are never wired into the `useDeckCards` call — lines 410-419 always read from `userPrefs?.xxx`. Moot because collab uses `useSessionDeck` instead, but the dead code is confusing.
- File: RecommendationsContext.tsx:340-361, 410-419

### Inferences

- The preferences→deck pipeline is **functionally correct for solo mode**. Every preference field the user can set does affect what cards they see (except `budgetMin`). Confidence: HIGH.
- After preference change, old cards remain visible for the network round-trip (~200-500ms pool, up to 2s cold start) via `placeholderData`. This is intentional UX, not a bug. Confidence: HIGH.
- The `initialData` stale-batch risk (S1-2) only manifests on cold app start when Zustand has a persisted batch AND the user changed non-category preferences since last session. Low probability but real. Confidence: MEDIUM.

---

## Section 2: Swipe Deck Contract

### Facts

**Swipe RIGHT (Save):**
- PanResponder detects `dx > 120` (SwipeableCards.tsx:1005)
- Card animated off-screen, added to `removedCards` Set (line 1038-1041) — **immediate optimistic removal**
- `handleSwipeRef.current?.(direction, card)` called **fire-and-forget** — NOT awaited (line 1047)
- Inside `handleSwipe` (line 1155): records swipe count (awaited), logs AppsFlyer `af_add_to_wishlist`, tracks interaction in `saved_experiences` table, calls `onCardLike(card)` → `handleSaveCard`
- `handleSaveCard` (AppHandlers.tsx:776): solo → `savedCardsService.saveCard` writes to `saved_card` table with full card spread in `card_data` JSONB; collab → `BoardCardService.saveCardToBoard` writes to `board_saved_cards`
- Cache invalidated: `savedCardKeys.list(userId)` (line 1011)
- Toast: "Saved! {title} has been added to your saved experiences" (solo, line 1014-1018) or "Added to Board!" (collab, line 970-974)
- **No haptic feedback** — `Haptics` never imported or called in SwipeableCards.tsx
- Failure: `Alert.alert("Save failed", ...)` (line 1025-1028) but card already gone from deck

**Swipe LEFT (Dismiss):**
- PanResponder detects `dx < -120` (line 1006)
- Same optimistic removal mechanism
- `handleSwipe("left", card)`: logs AppsFlyer `card_dismissed`, tracks interaction as `"swipe_left"`, writes `"disliked"` status to experiences table (line 1271-1288)
- Calls `addDismissedCard(card)` — local array + AsyncStorage (RecommendationsContext.tsx:522-525)
- Server-side: persists as "disliked" in experiences table (durable)
- Client-side: AsyncStorage dismissed list (can be lost on cache clear)

**Swipe UP (Expand):**
- Detected when `dy < -50 && |dx| < 50` (SwipeableCards.tsx:990)
- Blocked for locked curated cards (line 991-994)
- Card snaps BACK to center (NOT removed) — opens ExpandedCardModal
- Same behavior as card tap

**Card Tap (Expand):**
- Only fires if card position near center (`< 10px`) (line 1072)
- Locked curated: opens paywall (line 1074-1077)
- All data from `Recommendation` mapped to `ExpandedCardData` (lines 1108-1147)
- No data lost in mapping — all fields transferred

**Additional fetches on expand (ExpandedCardModal.tsx:803-926):**
- Weather via `weatherService.getWeatherForecast` (line 871-882)
- Busyness via `busynessService.getVenueBusyness` (line 892-904)
- Booking options via `bookingService.getBookingOptions` (line 911-924)
- Each independently try/caught — failure = section doesn't render, modal still works

**Undo mechanism (DismissedCardsSheet.tsx):**
- Shows all dismissed cards
- "Reconsider" button: removes from dismissed, adds card back to front of deck (SwipeableCards.tsx:1369-1379)
- "Save" button: calls `onCardLike(card)` — same as swipe right
- Works for both single and curated cards

### Bugs Found

**BUG S2-1: No haptic feedback on swipe (SwipeableCards.tsx)**
- Severity: GREEN
- Zero tactile confirmation for swipe right (save) or swipe left (dismiss). Only DismissedCardsSheet uses haptics (line 37, 42). This is a noticeable quality gap — every swipe-based app uses haptics.

**BUG S2-2: No rollback on save failure (SwipeableCards.tsx:1038-1041, AppHandlers.tsx:1025-1028)**
- Severity: RED
- Card is optimistically removed from deck (line 1038) BEFORE `handleSwipe` runs. If `handleSaveCard` fails (DB error, network error), an Alert is shown but the card is permanently gone from the deck. User has lost the card with no way to recover it (it's not in saved, not in dismissed, not in deck).
- The fire-and-forget pattern at line 1047 means errors from handleSwipe are unhandled promise rejections.

**BUG S2-3: `handleSwipe` fire-and-forget = unhandled promise rejections (SwipeableCards.tsx:1047)**
- Severity: YELLOW
- `handleSwipeRef.current?.(direction, cardToRemove)` is called without `await` inside a non-async PanResponder callback. Any throw inside `handleSwipe` becomes an unhandled promise rejection. The outer catch (line 1316-1318) only `console.error`s.

### Inferences

- The save flow is reliable under normal conditions (network up, no DB errors). The risk is entirely in failure cases. Confidence: HIGH.
- The expand flow is well-designed — graceful degradation for supplemental data, no blocking fetches. Confidence: HIGH.
- Dismissed cards are durable server-side but fragile client-side (AsyncStorage only). If a user clears cache, the dismissed cards list resets but the server-side "disliked" record prevents the card from reappearing in the pool (via impression exclusion in `query_pool_cards`). Confidence: MEDIUM.

---

## Section 3: Card Data Consistency

### Cross-Surface Comparison

#### Title

| Surface | What's Shown | Consistent? |
|---------|-------------|-------------|
| SwipeableCards | `currentRec.title` or `'Experience'` | Yes |
| CuratedExperienceSwipeCard | `card.title` (experience title) | Yes |
| ExpandedCardModal | `card.title` | Yes |
| SavedTab (single) | `card.title`, numberOfLines=1 | Yes |
| **SavedTab (curated)** | **`stops.map(s => s.placeName).join(' -> ')`** | **NO — shows stop names not experience title** |
| CalendarTab | `entry.experience?.title \|\| entry.title` | Yes |
| PersonGridCard | `title`, numberOfLines=2 | Yes |
| PersonCuratedCard | `title`, numberOfLines=2 | Yes |
| BoardSessionCard | `cardData.title \|\| "Untitled"` | Yes |

#### Category Label

| Surface | Method | File:Line |
|---------|--------|-----------|
| SwipeableCards | `getReadableCategoryName(category)` — full lookup map | SwipeableCards.tsx:1885 |
| CuratedExperienceSwipeCard | `card.categoryLabel \|\| 'Adventurous'` — pre-computed | CuratedExperienceSwipeCard.tsx:53 |
| ExpandedCardModal CardInfoSection | `formatTag(category)` — own `replace(/_/g, ' ')` + title-case | expandedCard/CardInfoSection.tsx:96-114 |
| SavedTab (single) | `getReadableCategoryName(card.category) \|\| "Experience"` | SavedTab.tsx:1915 |
| SavedTab (curated) | `EXPERIENCE_LABELS[rawType]` — hardcoded map using `experienceType` | SavedTab.tsx:1755-1764 |
| CalendarTab | `getReadableCategoryName(entry.experience?.category)` | CalendarTab.tsx:1297 |
| PersonGridCard | `category` — raw string from parent | PersonGridCard.tsx:76 |
| BoardSessionCard | Category NOT displayed | N/A |

#### Category Icon — 5 DIFFERENT SYSTEMS

1. **SwipeableCards:** `getIconComponent()` — backward-compat map + Ionicons passthrough (SwipeableCards.tsx:185-233)
2. **CuratedExperienceSwipeCard:** `CURATED_ICON_MAP` — only 6 entries (CuratedExperienceSwipeCard.tsx:9-16)
3. **CardInfoSection:** `getCategoryIcon()` — substring matching on category name (expandedCard/CardInfoSection.tsx:59-93)
4. **PersonHolidayView:** `CATEGORY_ICONS` — 13-entry map with different icon names (PersonHolidayView.tsx:121-139)
5. **PersonGridCard:** `getCategoryIcon()` from `categoryUtils` (PersonGridCard.tsx:38)

SavedTab ignores category icon entirely — hardcodes `heart` (single) and `map-outline` (curated).

#### Price Display

| Surface | Format | Currency Conversion? | File:Line |
|---------|--------|---------------------|-----------|
| SwipeableCards | `formatTierLabel(tier)` or `formatPriceRange(range)` or `'Free'` | YES | SwipeableCards.tsx:1878-1880 |
| CuratedExperienceSwipeCard | `tierLabel(firstStopTier)` or `$min-$max` or `'Free'` | **NO — hardcoded $** | CuratedExperienceSwipeCard.tsx:43-50 |
| ExpandedCardModal CardInfoSection | `tierLabel(tier) + ' . ' + tierRangeLabel(tier)` | **NO — hardcoded $** | expandedCard/CardInfoSection.tsx:54-56 |
| ExpandedCardModal (curated header) | `$min-$max` raw | **NO — hardcoded $** | ExpandedCardModal.tsx:426-428 |
| SavedTab (single) | `formatTierLabel(tier, currencySymbol, currencyRate)` | YES | SavedTab.tsx:1938-1940 |
| SavedTab (curated) | `formatCurrency(totalPriceMin, currencyCode)` | YES | SavedTab.tsx:1746-1748 |
| PersonGridCard | `formatTierLabel(tier)` — no currency params | **NO** | PersonGridCard.tsx:37 |
| PersonCuratedCard | `$min-$max` raw | **NO — hardcoded $** | PersonCuratedCard.tsx:25-36 |
| PersonHolidayView | `tierLabel(tier)` — just the word | **NO** | PersonHolidayView.tsx:303-306 |
| BoardSessionCard | `cardData.priceRange \|\| "$12-28"` | **NO — hardcoded fallback** | BoardSessionCard.tsx:129 |

**Only 3 of 10 surfaces properly handle currency conversion.**

#### Rating

| Surface | Missing Rating Handling | File:Line |
|---------|------------------------|-----------|
| SwipeableCards | Shows `0.0` | SwipeableCards.tsx:1872 |
| CardInfoSection | Hidden if undefined | expandedCard/CardInfoSection.tsx:126-131 |
| **SavedTab (single)** | **Shows fake `"4.5"`** | SavedTab.tsx:1929 |
| **BoardSessionCard** | **Shows fake `"4.5"`** | BoardSessionCard.tsx:118 |
| PersonHolidayView | Hidden if null or 0 | PersonHolidayView.tsx:308-314 |

**Star icon color:** 5 different colors across surfaces — white, `#d97706`, `#fbbf24`, `#F59E0B`, `#eb7825`.

#### Travel Time

| Surface | Fallback | Icon | File:Line |
|---------|----------|------|-----------|
| SwipeableCards | Skips if `'0 min'` | `getTravelModeIcon(mode)` | SwipeableCards.tsx:1861-1868 |
| CuratedExperienceSwipeCard | N/A | `getTravelModeIcon(mode)` | CuratedExperienceSwipeCard.tsx:64-66 |
| CardInfoSection | Skips if `'0 min'` | `getTravelModeIcon(mode)` | expandedCard/CardInfoSection.tsx:141-148 |
| **SavedTab** | **Fake `"15m"`** | **`"paper-plane"` (wrong icon)** | SavedTab.tsx:1932-1935 |
| **BoardSessionCard** | **Fake `"12 min drive"`** | **`"paper-plane"` (wrong icon)** | BoardSessionCard.tsx:124-126 |

#### Hours / Open Status

| Surface | Shown? | Notes |
|---------|--------|-------|
| SwipeableCards | NOT shown | — |
| CuratedExperienceSwipeCard | NOT shown | — |
| **ExpandedCardModal PracticalDetailsSection** | **Accepts `openingHours` prop but NEVER RENDERS it** | PracticalDetailsSection.tsx:13-18, 45 |
| ExpandedCardModal (curated stops) | YES — StopOpenBadge per stop | ExpandedCardModal.tsx:626, 645-670 |
| SavedTab | `isPlaceOpenNow()` for schedule blocking | SavedTab.tsx:1888-1889 |

#### Images

| Surface | Missing Image Fallback |
|---------|----------------------|
| SwipeableCards | Unsplash stock photo of retail store |
| All other surfaces | Gray placeholder with icon |

**Inconsistency:** SwipeableCards shows a random stock photo for missing images; everywhere else shows a clean gray placeholder.

#### Distance

Only shown on 3 surfaces: SwipeableCards, CuratedExperienceSwipeCard, ExpandedCardModal CardInfoSection. All saved/calendar/person/board surfaces omit distance entirely.

#### Curated Stops

| Surface | What's Shown |
|---------|-------------|
| CuratedExperienceSwipeCard | Non-optional stops only (filters `!s.optional`) |
| ExpandedCardModal | All stops with accordion |
| SavedTab | First 3 stops regardless of optional status |
| PersonCuratedCard | Stop count badge only |

**Inconsistency:** Optional stops are filtered on swipe card but not on SavedTab.

#### "Saved" Indicator

No surface shows an "already saved" indicator on the deck swipe card. `isSaved` is hardcoded to `false` on the Discover expanded modal. Duplicate detection only happens at save-time (not visually).

### Bugs Found

**BUG S3-1: SavedTab curated title shows stop names, not experience title (SavedTab.tsx:1803)**
- Severity: ORANGE
- Every other surface shows the experience title. SavedTab shows `"Restaurant A -> Bar B -> Park C"` instead.

**BUG S3-2: Currency conversion missing on 7 of 10 price-displaying surfaces**
- Severity: ORANGE
- Only SwipeableCards, SavedTab (single), and SavedTab (curated) properly convert. All others hardcode USD `$`. For international users, prices will be wrong on expanded card, curated swipe card, person views, and board.
- Files: CuratedExperienceSwipeCard.tsx:43-50, CardInfoSection.tsx:54-56, ExpandedCardModal.tsx:426-428, PersonGridCard.tsx:37, PersonCuratedCard.tsx:25-36, PersonHolidayView.tsx:303-306, BoardSessionCard.tsx:129

**BUG S3-3: Fabricated fallback data on SavedTab and BoardSessionCard**
- Severity: ORANGE
- SavedTab rating: `"4.5"` (SavedTab.tsx:1929)
- BoardSessionCard rating: `"4.5"` (BoardSessionCard.tsx:118)
- SavedTab travel time: `"15m"` (SavedTab.tsx:1934)
- BoardSessionCard travel time: `"12 min drive"` (BoardSessionCard.tsx:125)
- BoardSessionCard price: `"$12-28"` (BoardSessionCard.tsx:129)
- Users see made-up data presented as real.

**BUG S3-4: PracticalDetailsSection silently drops opening hours (PracticalDetailsSection.tsx:13-18, 45)**
- Severity: ORANGE
- Accepts `openingHours` in props interface but `hasAnyDetails` check only looks at `address || phone`. Hours are never rendered in the expanded single-card view.

**BUG S3-5: 5 different category icon systems with different outputs for same category**
- Severity: GREEN
- Same category can show different icons on different surfaces. No single source of truth.
- Files: SwipeableCards.tsx:185-233, CuratedExperienceSwipeCard.tsx:9-16, CardInfoSection.tsx:59-93, PersonHolidayView.tsx:121-139, categoryUtils

**BUG S3-6: SavedTab uses `paper-plane` icon for travel time instead of travel-mode-aware icon**
- Severity: GREEN
- SwipeableCards and CardInfoSection use `getTravelModeIcon(mode)` which shows walking/driving/transit. SavedTab and BoardSessionCard hardcode `paper-plane`.
- Files: SavedTab.tsx:1932, BoardSessionCard.tsx:124

**BUG S3-7: Rating star color varies across 5 different hex values**
- Severity: GREEN
- white, `#d97706`, `#fbbf24`, `#F59E0B`, `#eb7825` across surfaces

**BUG S3-8: SwipeableCards shows 0.0 for missing rating; others hide or fake 4.5**
- Severity: GREEN
- No consistent handling of missing ratings. SwipeableCards.tsx:1872 shows "0.0 ★".

**BUG S3-9: Unsplash stock photo fallback only on swipe deck (SwipeableCards.tsx:83)**
- Severity: GREEN
- Only SwipeableCards uses an Unsplash URL as image fallback. All other surfaces use gray placeholder.

**BUG S3-10: Optional curated stops shown on SavedTab but filtered on deck (SavedTab.tsx:1770 vs CuratedExperienceSwipeCard.tsx:38)**
- Severity: GREEN
- CuratedExperienceSwipeCard filters `!s.optional`. SavedTab shows `stops.slice(0, 3)` regardless.

---

## Section 4: Save Flow Audit

### Entry Point Comparison

**Entry Point 1: Swipe right on deck (SwipeableCards.tsx:1155-1338)**
- Awaited? `handleSwipeRef` is fire-and-forget (line 1047); internally `saveExperience` IS awaited (line 1240)
- DB writes: `saved_experiences` (interaction tracking) + delegates to `handleSaveCard`
- Cache invalidated: by `handleSaveCard` downstream
- Toast: by `handleSaveCard` downstream
- Failure: card already gone from deck; Alert shown but no recovery
- Curated: `onCardLike(card)` passes full card with stops
- Collab: writes to `board_saved_cards` via `BoardCardService`

**Entry Point 2: handleSaveCard central hub (AppHandlers.tsx:776-1030)**
- Solo (line 978-1022):
  - Duplicate check via `supabase.from("saved_card").select("id").eq(...)` (line 840-845)
  - `savedCardsService.saveCard(userId, card, "solo")` → upserts to `saved_card` with conflict on `profile_id,experience_id`
  - `card_data` JSONB: blind spread of entire card object + `dateAdded` + `source` (savedCardsService.ts:67-88)
  - Cache invalidated: `savedCardKeys.list(userId)` (line 1011)
  - Toast: "Saved! {title}..." (line 1014-1018)
  - Failure: `Alert.alert("Save failed", error.message)` (line 1025-1028)
  - Fire-and-forget: pair-activity notification (line 984-1008)
  - Engagement RPCs: `increment_user_engagement`, `increment_place_engagement` (savedCardsService.ts:108-122)
- Collab (line 871-964):
  - Duplicate check in `board_saved_cards` (line 813-836)
  - `BoardCardService.saveCardToBoard(...)` → `board_saved_cards` with **explicitly mapped fields** including curated stops
  - Auto-votes "up" fire-and-forget (line 932-950)
  - Cache invalidated (line 967)
  - Toast: "Added to Board! {title}..." (line 970-974)

**Entry Point 3: DismissedCardsSheet save (DismissedCardsSheet.tsx:126-131)**
- Pure delegate to `handleSaveCard` via `onSave` prop
- Fire-and-forget — no await, no error feedback at this layer
- All behavior inherited from Entry Point 2

**Entry Point 4: ExpandedCardModal ActionButtons (expandedCard/ActionButtons.tsx)**
- Awaits `onSave` callback which routes through swipe logic back to `handleSaveCard`
- All behavior inherited from Entry Point 2

**PersonHolidayView and SessionViewModal are NOT save entry points** — both are read-only views.

### Bugs Found

**BUG S4-1: Solo `card_data` uses blind spread vs collab's explicit mapping**
- Severity: YELLOW
- Solo: `savedCardsService.saveCard` does `...card` spread into `card_data` JSONB (savedCardsService.ts:80-87). Whatever the card object contains goes in — no schema control.
- Collab: `BoardCardService.saveCardToBoard` explicitly maps each field. If the card shape changes, collab adapts but solo silently includes/excludes unexpected fields.
- This means solo `card_data` may contain stale or extra fields that make SavedTab rendering unpredictable.

**BUG S4-2: DismissedCardsSheet save has no error feedback (DismissedCardsSheet.tsx:126-131)**
- Severity: GREEN
- The `onSave` prop is called without await. If the underlying save fails, the dismissed card sheet gives zero feedback — the user thinks it saved. The card is removed from the dismissed list but may not be in saved cards.

---

## Section 5: Schedule Flow Audit

### Entry Point Comparison

**Entry Point 1: SavedTab handleSchedule (SavedTab.tsx)**
- Picker: `ProposeDateTimeModal` (custom component)
- Can pick today: Yes
- Hours validation: Checks `isPlaceOpenNow()` — **only checks CURRENT time, not the selected future time**
- Curated stops: N/A (separate handler)
- After confirm: removes from saved, adds to calendar, syncs to device calendar, shows toast
- Confirmation step: None for regular cards
- Calendar permission denied: handled
- DB failure: try/caught, toast shown

**Entry Point 2: SavedTab handleScheduleCurated (SavedTab.tsx)**
- Same picker as above
- Validates ALL stops' hours at estimated arrival times
- Confirmation alert required before scheduling
- Same post-confirm behavior as Entry Point 1

**Entry Point 3: ActionButtons proceedWithScheduling (expandedCard/ActionButtons.tsx)**
- Picker: Native `DateTimePicker`
- Checks availability at selected time
- Does NOT validate individual curated stop hours
- No separate confirmation step
- Same post-confirm behavior

**Entry Point 4: AppHandlers handleScheduleFromSaved (AppHandlers.tsx)**
- Picker: **NONE — auto-generates date from user preferences**
- No hours validation
- No confirmation step
- Does NOT remove card from saved
- Fire-and-forget behavior

### Bugs Found

**BUG S5-1: `handleScheduleFromSaved` has zero validation (AppHandlers.tsx)**
- Severity: RED
- No date picker — auto-generates date. No hours validation — can schedule for when place is closed. No confirmation — user never consents. Does NOT remove from saved — card stays in both SavedTab and CalendarTab.

**BUG S5-2: SavedTab `handleSchedule` only checks current-time openness, not selected time (SavedTab.tsx:1888-1889)**
- Severity: ORANGE
- `isPlaceOpenNow()` checks if place is open RIGHT NOW, not at the time the user selected. If user schedules for 9 PM but it's currently 2 PM, the check passes even if the place closes at 6 PM.

**BUG S5-3: ActionButtons schedule skips curated stop-level validation (expandedCard/ActionButtons.tsx)**
- Severity: ORANGE
- SavedTab's `handleScheduleCurated` validates each stop's hours at estimated arrival time. ActionButtons' `proceedWithScheduling` only validates the overall card, not individual stops. A user can schedule a curated experience where the second stop is closed at arrival time.

---

## Section 6: Loading/Error/Empty States

### Screen-by-Screen Assessment

**DiscoverScreen (ForYou tab):**
- Loading: `ActivityIndicator` spinner
- Error: NO retry button (NightOut tab HAS one)
- Empty: "No experiences" message
- Skeleton: NOT used

**SavedTab:**
- Loading: `ActivityIndicator` spinner
- Error: **No error state for initial load failure**
- Empty: Empty state with icon + message + CTA
- Skeleton: NOT used

**CalendarTab:**
- Loading: **No loading state at all for initial data**
- Error: Not observed
- Empty: Empty state with calendar icon + message
- Skeleton: NOT used

**PersonHolidayView:**
- Loading: `ActivityIndicator`
- Error: Minimal
- Empty: Fallback cards
- Skeleton: NOT used

**ExpandedCardModal:**
- Loading: Inline spinners for weather/busyness
- Error: Section silently doesn't render (swallowed)
- Empty: N/A
- Skeleton: NOT used

**SessionViewModal:**
- Loading: Proper loading state
- Error: Permission error handled with Close button
- Empty: "No cards in session" state
- Skeleton: NOT used

**ProfilePage:**
- Loading: Passes `locationError` as prop
- Error: `locationError` **never rendered** — `ProfileHeroSection` accepts but ignores it
- Skeleton: NOT used

**DismissedCardsSheet:**
- Loading: Minimal
- Error: None
- Empty: Plain text, no icon

**Skeleton components exist but are DEAD CODE:**
- `ui/LoadingSkeleton.tsx` — exists, never imported
- `SkeletonCard.tsx` — exists, never imported

### Bugs Found

**BUG S6-1: ForYou tab has no Retry button on error (DiscoverScreen)**
- Severity: ORANGE
- NightOut tab has a retry button. ForYou doesn't. If deck fetch fails, user is stuck.

**BUG S6-2: SavedTab has no error state for initial load failure**
- Severity: ORANGE
- If the initial fetch of saved cards fails, no error message or retry option is shown.

**BUG S6-3: CalendarTab has no loading state for initial data (CalendarTab.tsx)**
- Severity: ORANGE
- Data appears or doesn't — no indication of loading. Violates "show UI first" principle.

**BUG S6-4: ProfilePage `locationError` never rendered (ProfileHeroSection)**
- Severity: GREEN
- Error is passed as prop but silently ignored in rendering.

**BUG S6-5: Two skeleton components are dead code (LoadingSkeleton.tsx, SkeletonCard.tsx)**
- Severity: GREEN
- Built but never used. Every screen uses `ActivityIndicator` spinners instead. Violates the "show UI first, fetch after" constitution principle.

---

## Section 7: Logical Consistency

### Category + Icon Alignment

All 12 visible categories are covered across the various icon maps, but through THREE separate icon systems (Lucide, Ionicons, emoji). No single canonical icon map exists. The same category can produce different icons depending on which surface renders it.

Categories verified: nature, casual_eats, fine_dining, drink, entertainment, active_adventure, wellness, shopping, cultural, nightlife, hidden_gems, seasonal, local_favorites.

No missing category icons — but the triple-system is technical debt.

### Price Display Consistency

Three different fallback strings for missing prices:
- `"Free"` — SwipeableCards, CuratedExperienceSwipeCard
- `"Varies"` — some person views
- `"$"` — generic fallback

Two legacy components use their own `formatPrice()` instead of the shared `formatTierLabel()` system.

### Travel Time Consistency

Five different fallback values with inconsistent formatting:
- `"0 min"` (filtered out on deck)
- `"15m"` (SavedTab fake)
- `"15 min"` (some surfaces)
- `"N/A"` (edge cases)
- `"12 min drive"` (BoardSessionCard fake)

### Hours Consistency

Each component computes open/closed independently via `useIsPlaceOpen` hook or `isPlaceOpenNow()` utility. Since both use the same underlying data, they should agree. But deck cards don't show open/closed at all — so there can't be a direct contradiction between deck and expanded view. The risk is SavedTab showing "Open" for a card that was seeded hours ago and is now closed.

### Curated Stop Ordering

No defensive sorting exists. All surfaces rely entirely on API array order. If the API returns stops in a different order (unlikely but possible after data migration), all surfaces would show them in the new order simultaneously. Low risk.

### "Already Saved" Detection

- `isSaved` is **hardcoded to `false`** on the Discover expanded modal
- Deck does NOT pre-filter saved cards
- Duplicate detection only at save-time (upsert conflict on `profile_id,experience_id`)
- If a user saves a card, sees it again via paired view, and saves again → upsert handles it silently (no error, no "already saved" indicator)

### Currency

Properly preference-based (from user preferences), not GPS-based. Currency stored as user preference with USD fallback. Consistent approach, but only implemented on 3 of 10 price-displaying surfaces (see BUG S3-2).

---

## Master Bug List (NEW bugs only — not repeating prior investigations)

| # | Bug | Severity | File:Line | Category |
|---|-----|----------|-----------|----------|
| 1 | No rollback on save failure — card lost from deck | RED | SwipeableCards.tsx:1038, AppHandlers.tsx:1025 | Save flow |
| 2 | `handleScheduleFromSaved` has zero validation — no picker, no hours check, no confirm | RED | AppHandlers.tsx (handleScheduleFromSaved) | Schedule flow |
| 3 | SavedTab curated title shows stop names, not experience title | ORANGE | SavedTab.tsx:1803 | Data consistency |
| 4 | Currency conversion missing on 7 of 10 price-displaying surfaces | ORANGE | Multiple (see S3-2) | Data consistency |
| 5 | Fabricated fallback data (fake ratings "4.5", fake travel times, fake prices) | ORANGE | SavedTab.tsx:1929,1934; BoardSessionCard.tsx:118,125,129 | Data consistency |
| 6 | PracticalDetailsSection accepts `openingHours` but never renders them | ORANGE | PracticalDetailsSection.tsx:13-18, 45 | Data consistency |
| 7 | SavedTab `handleSchedule` only checks current-time openness, not selected time | ORANGE | SavedTab.tsx:1888-1889 | Schedule flow |
| 8 | ActionButtons schedule skips curated stop-level hours validation | ORANGE | expandedCard/ActionButtons.tsx | Schedule flow |
| 9 | ForYou tab has no Retry button on error | ORANGE | DiscoverScreen | Loading/error |
| 10 | SavedTab has no error state for initial load failure | ORANGE | SavedTab.tsx | Loading/error |
| 11 | CalendarTab has no loading state for initial data | ORANGE | CalendarTab.tsx | Loading/error |
| 12 | `initialData` pill-only matching allows stale batch on cold start | ORANGE | useDeckCards.ts:66-70 | Prefs→deck |
| 13 | `budgetMin` is dead code through 4 layers | YELLOW | deckService.ts:279, discover-cards:445 | Prefs→deck |
| 14 | Collab `aggregateAllPrefs` drops `dateOption`, `timeSlot`, `exactTime` | YELLOW | sessionPrefsUtils.ts | Prefs→deck |
| 15 | Collab `collabDeckParams` aggregated values are dead code | YELLOW | RecommendationsContext.tsx:340-361 | Prefs→deck |
| 16 | Solo `card_data` uses blind spread vs collab's explicit mapping | YELLOW | savedCardsService.ts:80-87 | Save flow |
| 17 | `handleSwipe` fire-and-forget = unhandled promise rejections | YELLOW | SwipeableCards.tsx:1047 | Swipe mechanics |
| 18 | No haptic feedback on swipe | GREEN | SwipeableCards.tsx | UX polish |
| 19 | 5 different category icon systems | GREEN | Multiple (see S3-5) | Data consistency |
| 20 | SavedTab uses `paper-plane` icon instead of travel-mode-aware icon | GREEN | SavedTab.tsx:1932, BoardSessionCard.tsx:124 | Data consistency |
| 21 | Rating star color varies across 5 hex values | GREEN | Multiple (see S3-7) | Data consistency |
| 22 | SwipeableCards shows 0.0 for missing rating; others hide or fake 4.5 | GREEN | SwipeableCards.tsx:1872 | Data consistency |
| 23 | Unsplash stock photo fallback only on swipe deck | GREEN | SwipeableCards.tsx:83 | Data consistency |
| 24 | Optional curated stops shown on SavedTab but filtered on deck | GREEN | SavedTab.tsx:1770, CuratedExperienceSwipeCard.tsx:38 | Data consistency |
| 25 | DismissedCardsSheet save has no error feedback | GREEN | DismissedCardsSheet.tsx:126-131 | Save flow |
| 26 | ProfilePage `locationError` never rendered | GREEN | ProfileHeroSection | Loading/error |
| 27 | Two skeleton components are dead code | GREEN | LoadingSkeleton.tsx, SkeletonCard.tsx | Loading/error |
| 28 | `isSaved` hardcoded false on Discover expanded modal — no "already saved" indicator | GREEN | ExpandedCardModal | UX polish |
