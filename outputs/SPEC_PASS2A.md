# Fix Spec: Pass 2a — Currency + Pricing (3 fixes)

**Date:** 2026-03-22
**Investigation:** `outputs/INVESTIGATION_PASS2A.md`
**Bugs:** P2-01, P2-02, P2-03
**Files touched:** 3

---

## Fix 1: P2-01 — Currency changes with GPS location

### Root Cause
`PreferencesSheet.tsx` calls `detectLocaleFromCoordinates` in two places — when the user selects a location suggestion (line 591) and when they toggle GPS on (line 639). Both paths overwrite `profile.currency` AND `profile.measurement_system` in Supabase and Zustand.

### Fix Strategy
**Remove both `detectLocaleFromCoordinates` call blocks entirely.** Currency and measurement system are set during onboarding and must never be auto-changed after that. Changing search location changes WHERE cards come from, not how prices display.

**Both currency and measurement system are locked.** Rationale: a US user searching for experiences in London still thinks in dollars and miles. If they permanently relocate, they can re-onboard or (future) use a manual settings picker.

### Changes

#### File 1: `app-mobile/src/components/PreferencesSheet.tsx`

**Change 1a — Remove locale detection from `handleSuggestionSelect` (lines 589–609)**

BEFORE:
```tsx
    setSelectedCoords(coords);

    // Auto-detect locale from resolved coordinates (fire-and-forget)
    if (coords) {
      detectLocaleFromCoordinates(coords.lat, coords.lng).then((detected) => {
        if (user?.id) {
          PreferencesService.updateUserProfile(user.id, {
            currency: detected.currency,
            measurement_system: detected.measurementSystemDb,
          }).catch((err) => {
            console.warn('Locale DB write failed in handleSuggestionSelect:', err?.message);
          });
        }
        const currentProfile = useAppStore.getState().profile;
        if (currentProfile) {
          setProfile({
            ...currentProfile,
            currency: detected.currency,
            measurement_system: detected.measurementSystemDb,
          });
        }
      }).catch(() => {});
    }

    setTimeout(() => {
```

AFTER:
```tsx
    setSelectedCoords(coords);

    setTimeout(() => {
```

(Delete the entire `// Auto-detect locale...` block including the `if (coords)` wrapper. Keep the `setTimeout` that follows.)

**Change 1b — Remove locale detection from `handleGpsToggle` (lines 636–657)**

BEFORE:
```tsx
      setSearchLocation('');
      setSelectedCoords(null);

      // Auto-detect locale from GPS coordinates (fire-and-forget)
      locationService.getCurrentLocation().then((loc) => {
        if (!loc) return;
        detectLocaleFromCoordinates(loc.latitude, loc.longitude).then((detected) => {
          if (user?.id) {
            PreferencesService.updateUserProfile(user.id, {
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            }).catch((err) => {
              console.warn('Locale DB write failed in handleGpsToggle:', err?.message);
            });
          }
          const currentProfile = useAppStore.getState().profile;
          if (currentProfile) {
            setProfile({
              ...currentProfile,
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            });
          }
        }).catch(() => {});
      }).catch(() => {});
    } else {
```

AFTER:
```tsx
      setSearchLocation('');
      setSelectedCoords(null);
    } else {
```

(Delete the entire `// Auto-detect locale from GPS...` block including the `locationService.getCurrentLocation()` chain.)

**Change 1c — Remove unused import (line 40)**

BEFORE:
```tsx
import { detectLocaleFromCoordinates } from "../utils/localeDetection";
```

AFTER:
(Delete this line. After removing both call sites, this import is unused.)

### Edge Cases
- **Old accounts without currency set:** They'd have whatever default Supabase gives for a nullable field (likely `null`). `useLocalePreferences.ts` already handles this: `profile?.currency || 'USD'` (defaults to USD). No change needed.
- **Onboarding still sets currency correctly:** `OnboardingFlow.tsx` calls `detectLocaleFromCoordinates` at lines 1258, 1282, 1408, and 1443. These are NOT touched — onboarding is the one correct place to auto-detect.
- **Users who never complete GPS onboarding step:** They get default USD/Imperial from `useLocalePreferences`. Acceptable.

### Test Criteria
1. Open Preferences → change search location from Raleigh to London → prices stay in USD (not GBP)
2. Toggle GPS on while in London → prices stay in USD
3. Close and reopen app → currency still USD (Supabase not overwritten)
4. Complete onboarding in London → currency correctly set to GBP (onboarding path unaffected)

---

## Fix 2: P2-02 — priceRange = priceLevel (Google enum on paired view cards)

### Root Cause
`PersonHolidayView.tsx:383` passes `c.priceLevel` (raw Google enum like `"PRICE_LEVEL_MODERATE"`) as the `priceRange` prop to `CompactCard`. The field `c.priceTier` (computed tier slug like `"comfy"`) exists on the same object and should be used with `tierLabel()`.

### Fix Strategy
**Replace `c.priceLevel` with a formatted display string using `tierLabel()`.** For single cards, use the tier label. For curated multi-stop cards that have `totalPriceMin`/`totalPriceMax`, format as a price range instead.

### Changes

#### File 2: `app-mobile/src/components/PersonHolidayView.tsx`

**Change 2a — Add `tierLabel` to imports (line 28)**

BEFORE:
```tsx
import { PriceTierSlug } from "../constants/priceTiers";
```

AFTER:
```tsx
import { PriceTierSlug, tierLabel } from "../constants/priceTiers";
```

**Change 2b — Fix `priceRange` prop on `CompactCard` (line 383)**

BEFORE:
```tsx
              priceRange={c.priceLevel}
```

AFTER:
```tsx
              priceRange={c.priceTier ? tierLabel(c.priceTier as PriceTierSlug) : null}
```

**Change 2c — Fix `priceRange` in `onPress` handler (line 395)**

BEFORE:
```tsx
                  priceRange: c.priceLevel,
```

AFTER:
```tsx
                  priceRange: c.priceTier ? tierLabel(c.priceTier as PriceTierSlug) : null,
```

### Why `tierLabel()` and not `formatTierLabel()`
- `tierLabel("comfy")` returns `"Comfy"` — clean, compact, appropriate for small cards.
- `formatTierLabel("comfy")` returns `"Comfy · $50–$150 per person"` — too long for a compact card footer.
- The price range detail is available in the expanded view; the compact card just needs the tier name.

### Why cast `as PriceTierSlug`
- `c.priceTier` is typed as `string | null` (from `HolidayCard` interface in `holidayCardsService.ts:15`).
- `tierLabel()` expects `PriceTierSlug` (one of `'chill' | 'comfy' | 'bougie' | 'lavish'`).
- The edge function `derivePriceTier()` guarantees the value is always a valid tier slug, but the type doesn't enforce this at the interface level. The cast is safe.
- The `? :` null check handles the case where `priceTier` is null.

### Edge Cases
- **`c.priceTier` is `null`:** Curated cards can have `priceTier: null`. In that case, `priceRange` becomes `null` and `CompactCard` renders `<View />` (empty space) instead. This is acceptable — curated cards show stop count and category, price isn't critical on the compact card.
- **Unknown tier slug:** `tierLabel()` calls `TIER_BY_SLUG[slug]?.label ?? 'Chill'` — falls back to "Chill" for any unrecognized slug. Safe.
- **`c.priceLevel` still available:** The raw Google enum is still on the `HolidayCard` object. It's just no longer used for display. If needed for filtering or analytics, it remains accessible.

### Test Criteria
1. Open PersonHolidayView → paired cards show "Chill", "Comfy", "Bougie", or "Lavish" (not "PRICE_LEVEL_MODERATE")
2. Curated cards show no price label (null tier) — or stop count fills the space
3. Tap a card → expanded view receives correct `priceRange` (not the raw enum)

---

## Fix 3: P2-03 — Slug on saved page (fine_dining instead of Fine Dining)

### Root Cause
`SavedTab.tsx:1900` renders `card.category` directly, which is a raw slug like `"fine_dining"`. The utility `getReadableCategoryName()` exists and is used everywhere else but was never imported in `SavedTab.tsx`.

### Fix Strategy
**Import `getReadableCategoryName` and wrap the display string.**

### Changes

#### File 3: `app-mobile/src/components/activity/SavedTab.tsx`

**Change 3a — Add import (after existing imports, around line 37)**

After the line:
```tsx
import { isPlaceOpenNow, extractWeekdayText } from "../../utils/openingHoursUtils";
```

Add:
```tsx
import { getReadableCategoryName } from "../../utils/categoryUtils";
```

**Change 3b — Format category at display (line 1900)**

BEFORE:
```tsx
                    <Text style={styles.cardSubtitle} numberOfLines={1} ellipsizeMode="tail">
                      {(card as any).subtitle || card.category || "Experience"}
                    </Text>
```

AFTER:
```tsx
                    <Text style={styles.cardSubtitle} numberOfLines={1} ellipsizeMode="tail">
                      {(card as any).subtitle || getReadableCategoryName(card.category) || "Experience"}
                    </Text>
```

### Category Filter Pills — NOT a slug bug (but a different bug)
The investigation's adjacent find about filter pills was checked. The filter pills at lines 2167–2178 use hardcoded display names ("Take a Stroll", "Casual Eats", etc.). They render correctly — no slug issue.

**However**, the filter comparison at line 264 compares `card.category` (slug like `"fine_dining"`) against `selectedCategory` (display name like `"Dining Experiences"`). These will never match, making the category filter completely non-functional. This is a separate pre-existing bug — out of scope for this pass but worth noting for a future fix.

### Edge Cases
- **`card.category` is empty/null:** `getReadableCategoryName("")` returns `"Experience"` (line 35 of `categoryUtils.ts`). The existing `|| "Experience"` fallback becomes redundant but harmless — keep it for defense-in-depth.
- **Unknown slug:** `getReadableCategoryName` has a final fallback (line 132) that title-cases the slug: `"some_new_slug"` → `"Some New Slug"`. Safe for future categories.
- **Curated cards in saved:** Curated cards often have `category: "adventurous"` or `"romantic"` — both handled by `getReadableCategoryName`: `"adventurous"` → `"Adventurous"`, `"romantic"` → `"Romantic"`.

### Test Criteria
1. Save a "fine_dining" card → check Saved tab → shows "Fine Dining" (not "fine_dining")
2. Save a "nature_and_views" card → shows "Nature & Views"
3. Save a curated "adventurous" card → shows "Adventurous"
4. Card with no category → shows "Experience"

---

## Summary: All Changes by File

### `app-mobile/src/components/PreferencesSheet.tsx`
| Change | Lines | Description |
|--------|-------|-------------|
| 1a | 589–609 | Remove `detectLocaleFromCoordinates` block from `handleSuggestionSelect` |
| 1b | 636–657 | Remove `detectLocaleFromCoordinates` block from `handleGpsToggle` |
| 1c | 40 | Remove unused `detectLocaleFromCoordinates` import |

### `app-mobile/src/components/PersonHolidayView.tsx`
| Change | Lines | Description |
|--------|-------|-------------|
| 2a | 28 | Add `tierLabel` to `priceTiers` import |
| 2b | 383 | Replace `c.priceLevel` with `tierLabel(c.priceTier)` |
| 2c | 395 | Same fix in `onPress` handler |

### `app-mobile/src/components/activity/SavedTab.tsx`
| Change | Lines | Description |
|--------|-------|-------------|
| 3a | ~37 | Add `getReadableCategoryName` import |
| 3b | 1900 | Wrap `card.category` with `getReadableCategoryName()` |

### Invariants Restored
1. **P2-01:** "Currency is set once during onboarding and never auto-changed" — enforced by removing the only post-onboarding overwrite paths.
2. **P2-02:** "Price displayed on cards is always human-readable" — enforced by using `tierLabel()` instead of raw enum.
3. **P2-03:** "Category names displayed to users are always human-readable" — enforced by `getReadableCategoryName()`.

### Out of Scope (tracked, not fixed)
- No manual currency picker exists — users can't change currency after onboarding. Future feature.
- Category filter in SavedTab is broken (compares slugs against display names). Pre-existing bug, separate pass.
- `curatedStyles.saveButton*` dead styles from Pass 1c — cleanup pass.
