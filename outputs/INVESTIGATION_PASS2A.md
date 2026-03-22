# Investigation Report: Pass 2a — Currency + Pricing (3 bugs)

**Date:** 2026-03-22
**Bugs:** P2-01, P2-02, P2-03
**Status:** All 3 CONFIRMED

---

## P2-01: Currency changes with GPS location

**Verdict:** CONFIRMED — 🔴 ROOT CAUSE

### Evidence Chain

1. **Currency is re-detected from GPS/location coordinates in PreferencesSheet.**
   - File: `PreferencesSheet.tsx:591` — When user selects a location suggestion:
     ```ts
     detectLocaleFromCoordinates(coords.lat, coords.lng).then((detected) => {
       PreferencesService.updateUserProfile(user.id, {
         currency: detected.currency,
         measurement_system: detected.measurementSystemDb,
       });
       setProfile({ ...currentProfile, currency: detected.currency, ... });
     });
     ```
   - File: `PreferencesSheet.tsx:639` — When user toggles GPS on:
     ```ts
     locationService.getCurrentLocation().then((loc) => {
       detectLocaleFromCoordinates(loc.latitude, loc.longitude).then((detected) => {
         PreferencesService.updateUserProfile(user.id, {
           currency: detected.currency,
           measurement_system: detected.measurementSystemDb,
         });
         setProfile({ ...currentProfile, currency: detected.currency, ... });
       });
     });
     ```
   - Both paths overwrite `profile.currency` in both Supabase (persistent) and Zustand (in-memory).

2. **Onboarding also sets currency from GPS — but that's the ONLY correct time to do it.**
   - File: `OnboardingFlow.tsx:1258` — During GPS step:
     ```ts
     const detected = detectLocaleFromCountryName(detectedCountry);
     PreferencesService.updateUserProfile(user.id, {
       currency: detected.currency,
       measurement_system: detected.measurementSystemDb,
     });
     ```
   - This is correct — onboarding determines the user's home currency.
   - File: `OnboardingFlow.tsx:1408` and `OnboardingFlow.tsx:1443` — Same pattern for manual location entry during onboarding.

3. **The locale detection function itself is GPS-based by design.**
   - File: `localeDetection.ts:55-88` — `detectLocaleFromCoordinates()` reverse-geocodes coordinates to a country, then maps country → currency.
   - This correctly maps "London GPS" → "GBP" and "Raleigh GPS" → "USD".
   - The function is fine. The problem is WHERE it's called post-onboarding.

4. **Currency is consumed throughout the app from `profile.currency`.**
   - Hook: `useLocalePreferences.ts` reads from `appStore.profile.currency` (defaults to 'USD').
   - Passed as `accountPreferences.currency` through component trees.
   - Used in `formatPriceRange()`, `formatTierLabel()`, `tierRangeLabel()` for all price displays.
   - When PreferencesSheet overwrites `profile.currency`, ALL price displays across the app immediately switch.

### Root Cause

**PreferencesSheet re-detects and overwrites currency whenever the user changes their search location or toggles GPS.** This is wrong — changing where you want to search for experiences should NOT change what currency your prices display in. A user in the US traveling to London still thinks in USD.

Currency should be set once during onboarding and never auto-changed again. If the user wants to change currency, it should be an explicit manual setting.

### Broken Invariant

**"Currency is locked from onboarding. Changing search location changes WHERE cards are found, not HOW prices are displayed."**

Currently enforced by: nothing. Two separate flows in PreferencesSheet silently overwrite it.

### Recommended Fix

**Remove the `detectLocaleFromCoordinates` calls from `PreferencesSheet.tsx`** — both the GPS toggle handler (line 639) and the location suggestion handler (line 591). Keep the onboarding calls intact.

Optionally: also remove the `measurement_system` overwrite. A user who set up their account in the US (Imperial) and temporarily searches in London should NOT have their measurement system flip to Metric.

### Files to Change
| File | Lines | Change |
|------|-------|--------|
| `PreferencesSheet.tsx` | 589–609 | Remove `detectLocaleFromCoordinates` block from `handleSuggestionSelect` |
| `PreferencesSheet.tsx` | 636–657 | Remove `detectLocaleFromCoordinates` block from `handleGpsToggle` |

### Edge Cases
- **New users who skip onboarding GPS:** They get default USD/Imperial. This is acceptable — they can set currency manually if needed (though a manual currency picker doesn't exist yet; that's a separate feature).
- **Users who legitimately relocate permanently:** They'd need to re-onboard or manually change currency. A future "change currency" setting would solve this, but auto-detecting from GPS is not the right approach.
- **Measurement system coupling:** Currently currency and measurement system are overwritten together. The fix removes both overwrites from PreferencesSheet. Onboarding still sets them correctly.

---

## P2-02: priceRange = priceLevel (Google enum on paired view cards)

**Verdict:** CONFIRMED — 🔴 ROOT CAUSE

### Evidence Chain

1. **PersonHolidayView passes `c.priceLevel` directly as `priceRange`.**
   - File: `PersonHolidayView.tsx:383`
     ```tsx
     priceRange={c.priceLevel}
     ```
   - And again at line 395 in the `onPress` handler:
     ```tsx
     priceRange: c.priceLevel,
     ```

2. **`c.priceLevel` contains raw Google Places API enum strings.**
   - Type: `HolidayCard.priceLevel: string | null` (from `holidayCardsService.ts:10`)
   - Source: edge function `get-person-hero-cards/index.ts:90`:
     ```ts
     priceLevel: (raw.price_level as string) ?? null,
     ```
   - `price_level` in the DB stores Google's raw enum: `"PRICE_LEVEL_FREE"`, `"PRICE_LEVEL_INEXPENSIVE"`, `"PRICE_LEVEL_MODERATE"`, `"PRICE_LEVEL_EXPENSIVE"`, `"PRICE_LEVEL_VERY_EXPENSIVE"`.

3. **`c.priceTier` already exists and contains the correct tier slug.**
   - The edge function already computes `priceTier` at line 95–98:
     ```ts
     priceTier: derivePriceTier(
       (raw.price_tier as string) ?? null,
       (raw.price_level as string) ?? null,
     ),
     ```
   - `derivePriceTier` maps Google enums to tier slugs: `"chill"`, `"comfy"`, `"bougie"`, `"lavish"`.
   - `c.priceTier` is available on the `HolidayCard` type (line 15) and is already used elsewhere (line 403).

4. **`CompactCard` renders `priceRange` as raw text.**
   - File: `PersonHolidayView.tsx:297–300`:
     ```tsx
     {priceRange ? (
       <Text style={styles.compactCardPrice}>{priceRange}</Text>
     ) : <View />}
     ```
   - No formatting, no conversion. Displays `"PRICE_LEVEL_MODERATE"` verbatim.

5. **Other views use `priceTier` correctly.**
   - `PersonHolidayView.tsx:422` — fallback single cards use `c.priceRange` (already formatted).
   - `PersonHolidayView.tsx:695` — saved view uses `asPriceTier(sv.priceTier)` and formats with `tierLabel()`.

### Root Cause

**`CompactCard` is passed `priceLevel` (raw Google enum) where it expects `priceRange` (display string).** The data is there (`c.priceTier`) — it's just wired wrong.

### Broken Invariant

**"Price displayed on any card must be a human-readable label (tier name or formatted range), never a raw API enum."**

### Recommended Fix

**Use `c.priceTier` with `tierLabel()` instead of `c.priceLevel`.** The `tierLabel()` function (from `priceTiers.ts:54–56`) converts slugs to display labels: `"chill"` → `"Chill"`, `"comfy"` → `"Comfy"`, etc.

Two changes needed:
1. At line 383, change `priceRange={c.priceLevel}` to format using the tier.
2. At line 395 in the `onPress` handler, same fix.

For curated cards (multi-stop), `priceTier` is `null` because they have `totalPriceMin`/`totalPriceMax` ranges instead. Handle this case: if curated, format as `$X–$Y`; if single, use `tierLabel(priceTier)`.

### Files to Change
| File | Lines | Change |
|------|-------|--------|
| `PersonHolidayView.tsx` | 383 | Replace `c.priceLevel` with formatted tier label or price range |
| `PersonHolidayView.tsx` | 395 | Same fix in `onPress` handler |

### Edge Cases
- **`c.priceTier` is `null`:** For curated cards, `priceTier` may be null. Fall back to `$${c.totalPriceMin}–$${c.totalPriceMax}` or `"Varies"`.
- **Currency conversion:** `tierLabel()` returns a plain label like "Comfy". `tierRangeLabel()` includes a price range with currency conversion. Decide which to use. For compact cards, `tierLabel()` (just the name) is probably sufficient.
- **`c.priceLevel` is `null`:** Some places don't have a Google price level. `derivePriceTier` defaults to `"chill"` in that case, so `priceTier` will be `"chill"`. This is acceptable.

---

## P2-03: Slug on saved page (fine_dining instead of Fine Dining)

**Verdict:** CONFIRMED — 🟠 CONTRIBUTING FACTOR (display-only bug)

### Evidence Chain

1. **SavedTab renders `card.category` as raw text without formatting.**
   - File: `SavedTab.tsx:1900`
     ```tsx
     <Text style={styles.cardSubtitle} numberOfLines={1} ellipsizeMode="tail">
       {(card as any).subtitle || card.category || "Experience"}
     </Text>
     ```
   - `card.category` contains the raw slug from the database: `"fine_dining"`, `"play"`, `"nature_and_views"`, etc.

2. **`getReadableCategoryName()` exists and handles all slugs.**
   - File: `categoryUtils.ts:34–132`
   - Maps slugs to display names:
     - `"fine_dining"` → `"Fine Dining"`
     - `"nature_and_views"` → `"Nature & Views"`
     - `"play"` → `"Play"`
     - `"creative_and_arts"` → `"Creative & Arts"`
   - Already imported and used in many components (e.g., `SwipeableCards.tsx`, `ExperienceCard.tsx`, `HolidayRow.tsx`, `DismissedCardsSheet.tsx`, `SingleCardDisplay.tsx`).
   - **Not imported in `SavedTab.tsx`.**

3. **The saved card's category comes from `card_data.category` in Supabase.**
   - File: `savedCardsService.ts:51`:
     ```ts
     category: cardData.category || record.category,
     ```
   - The category slug is stored as-is when the card is saved (line 76):
     ```ts
     category: card.category,
     ```
   - The slug is the correct internal identifier — the display formatting should happen at render time.

4. **Other views correctly format the category.**
   - `SwipeableCards.tsx` calls `getReadableCategoryName()` before displaying.
   - `ExperienceCard.tsx` calls `getReadableCategoryName()`.
   - `HolidayRow.tsx` calls `getReadableCategoryName()`.
   - Only `SavedTab.tsx` skips it.

### Root Cause

**`SavedTab.tsx` renders `card.category` directly without calling `getReadableCategoryName()`.** The utility exists and is used everywhere else — it was simply missed here.

### Broken Invariant

**"Category names displayed to users must always be human-readable (Title Case), never raw slugs."**

### Recommended Fix

**Import `getReadableCategoryName` in `SavedTab.tsx` and wrap `card.category` at line 1900.**

Additionally, check for other places in `SavedTab.tsx` where `card.category` is displayed to users (not used as filter keys or analytics tags — those should stay as slugs).

Scan results:
- Line 1900: **Display** — needs fix
- Line 264: **Filter comparison** — must stay as slug (comparing against `selectedCategory` which is also a slug)
- Lines 1361, 1453, 1458, 1495, 1558: **Analytics/service calls** — must stay as slug

### Files to Change
| File | Lines | Change |
|------|-------|--------|
| `SavedTab.tsx` | top imports | Add `import { getReadableCategoryName } from "../../utils/categoryUtils"` |
| `SavedTab.tsx` | 1900 | Change `card.category` to `getReadableCategoryName(card.category)` |

### Edge Cases
- **`card.category` is empty or null:** `getReadableCategoryName("")` returns `"Experience"` (line 35). The existing `|| "Experience"` fallback at line 1900 becomes redundant but harmless.
- **Unknown slug:** `getReadableCategoryName` has a final fallback (line 132) that strips underscores and title-cases: `"some_new_slug"` → `"Some New Slug"`. Safe for future categories.
- **Category filter comparison:** The filter at line 264 compares `card.category` (slug) against `selectedCategory` (also a slug). Do NOT format this — it must stay as slug-to-slug comparison.

---

## Summary of All Changes

| Bug | Severity | Root Cause | Fix Complexity |
|-----|----------|-----------|----------------|
| P2-01 | 🔴 High — wrong currency across entire app | PreferencesSheet overwrites currency on location change | Low (remove 2 code blocks) |
| P2-02 | 🔴 High — raw enum shown to users | Wrong field mapped (`priceLevel` instead of `priceTier`) | Low (change 2 lines) |
| P2-03 | 🟠 Medium — ugly slug text | Missing `getReadableCategoryName()` call | Low (add import + wrap 1 line) |

### Adjacent Issues Found

1. **Measurement system also changes with GPS** — Same PreferencesSheet code overwrites `measurement_system` alongside `currency`. Same fix applies (remove both overwrites).

2. **CompactCard has no price tier formatting** — Even after fixing P2-02, `CompactCard` renders `priceRange` as raw text. If we pass `tierLabel(c.priceTier)`, it will show "Comfy" instead of "$50–$150". This may be fine for compact cards, but it's inconsistent with the full ExperienceCard which shows "Comfy · $50–$150 per person". Low priority.

3. **No manual currency picker exists** — After fixing P2-01, there's no way for a post-onboarding user to change their currency. A future settings screen should allow this. Out of scope for this pass.

4. **Category filter pills in SavedTab likely show slugs too** — The category filter dropdown/pills (around line 262–265) probably display raw slugs in the filter UI. This wasn't explicitly reported but is the same class of bug as P2-03. Should be checked during implementation.
