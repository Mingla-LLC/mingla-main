# SPEC: Pass 1 — Kill the Lies

**Date:** 2026-03-24
**Source:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md + PROMPT_SPEC_PASS1_KILL_THE_LIES.md
**Scope:** 6 bounded fixes. Remove fabricated data, wire currency, fix curated title, render hours, fix travel icons, hide zero ratings.
**Schema changes:** None
**Edge function changes:** None
**New components:** None

---

## Fix 1a: Remove ALL Fabricated Fallbacks

### Behavior Before

| File | Line | Current Code | What User Sees |
|------|------|-------------|----------------|
| SavedTab.tsx | 1929 | `card.rating \|\| "4.5"` | Fake "4.5" rating for cards with no rating |
| SavedTab.tsx | 1934 | `card.travelTime \|\| "15m"` | Fake "15m" travel time |
| BoardSessionCard.tsx | 118 | `cardData.rating?.toFixed(1) \|\| "4.5"` | Fake "4.5" rating |
| BoardSessionCard.tsx | 125 | `cardData.travelTime \|\| "12 min drive"` | Fake "12 min drive" |
| BoardSessionCard.tsx | 129 | `cardData.priceRange \|\| "$12-28"` | Fake "$12-28" price |

### Behavior After

- **Rating null/undefined/0:** Hide the entire rating `statItem` View. Do not render star icon or text.
- **Travel time null/undefined/empty:** Hide the entire travel time `statItem` View.
- **Price null/undefined/empty:** Show `"—"` (em dash). NOT "Free" (implies knowledge we don't have).

### Exact Changes

**SavedTab.tsx — Rating (lines 1927-1930):**

```
// BEFORE:
                  <View style={styles.statItem}>
                    <Icon name="star" size={14} color="#fbbf24" />
                    <Text style={styles.statText}>{card.rating || "4.5"}</Text>
                  </View>

// AFTER:
                  {card.rating != null && card.rating > 0 && (
                    <View style={styles.statItem}>
                      <Icon name="star" size={14} color="#fbbf24" />
                      <Text style={styles.statText}>{Number(card.rating).toFixed(1)}</Text>
                    </View>
                  )}
```

**SavedTab.tsx — Travel time (lines 1931-1935):**

```
// BEFORE:
                  <View style={styles.statItem}>
                    <Icon name="paper-plane" size={14} color="#6b7280" />
                    <Text style={styles.statText}>
                      {card.travelTime || "15m"}
                    </Text>
                  </View>

// AFTER:
                  {card.travelTime && card.travelTime !== '0 min' && (
                    <View style={styles.statItem}>
                      <Icon name={getTravelModeIcon(card.travelMode)} size={14} color="#6b7280" />
                      <Text style={styles.statText}>
                        {card.travelTime}
                      </Text>
                    </View>
                  )}
```

Note: This also applies Fix 1f (travel icon) in the same edit. See Fix 1f for `getTravelModeIcon` sourcing.

**BoardSessionCard.tsx — Rating (lines 115-121):**

```
// BEFORE:
            <View style={styles.statItem}>
              <Icon name="star" size={14} color="#eb7825" />
              <Text style={styles.statText}>
                {cardData.rating?.toFixed(1) || "4.5"} (
                {cardData.reviewCount || 0})
              </Text>
            </View>

// AFTER:
            {cardData.rating != null && cardData.rating > 0 && (
              <View style={styles.statItem}>
                <Icon name="star" size={14} color="#eb7825" />
                <Text style={styles.statText}>
                  {Number(cardData.rating).toFixed(1)} (
                  {cardData.reviewCount || 0})
                </Text>
              </View>
            )}
```

**BoardSessionCard.tsx — Travel time (lines 122-127):**

```
// BEFORE:
            <View style={styles.statItem}>
              <Icon name="paper-plane" size={14} color="#eb7825" />
              <Text style={styles.statText}>
                {cardData.travelTime || "12 min drive"}
              </Text>
            </View>

// AFTER:
            {cardData.travelTime && cardData.travelTime !== '0 min' && (
              <View style={styles.statItem}>
                <Icon name={getTravelModeIcon(cardData.travelMode)} size={14} color="#eb7825" />
                <Text style={styles.statText}>
                  {cardData.travelTime}
                </Text>
              </View>
            )}
```

Note: Also applies Fix 1f. See Fix 1f for `getTravelModeIcon` sourcing.

**BoardSessionCard.tsx — Price (lines 128-130):**

```
// BEFORE:
            <Text style={styles.priceText}>
              {cardData.priceRange || "$12-28"}
            </Text>

// AFTER:
            <Text style={styles.priceText}>
              {cardData.priceRange ? formatPriceRange(cardData.priceRange, currency) : '—'}
            </Text>
```

Note: `currency` comes from `useLocalePreferences()` — see Fix 1c for wiring. `formatPriceRange` import from `components/utils/formatters`.

### Edge Cases

- `card.rating` is the string `"0"` → `Number("0") > 0` is false → hidden. Correct.
- `card.rating` is `4.5` (number) → `4.5 > 0` → shown. Correct.
- `card.travelTime` is `"0 min"` → explicitly filtered. Correct.
- `cardData.priceRange` is `""` (empty string) → falsy → shows "—". Correct.

### Invariant

**No component shall render a hardcoded data value as if it were real data. Missing data = hidden or "—".**

---

## Fix 1b: Hide Zero Rating on SwipeableCards

### Behavior Before

`SwipeableCards.tsx:1869-1874`:
```
                        <View style={styles.detailBadge}>
                          <Icon name="star" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {(currentRec.rating ?? 0).toFixed(1)}
                          </Text>
                        </View>
```

Cards with no rating show "0.0 ★" on the swipe deck.

### Behavior After

Hide the entire rating badge when rating is null, undefined, or 0.

### Exact Change

```
// BEFORE:
                        <View style={styles.detailBadge}>
                          <Icon name="star" size={12} color="white" />
                          <Text style={styles.detailBadgeText}>
                            {(currentRec.rating ?? 0).toFixed(1)}
                          </Text>
                        </View>

// AFTER:
                        {currentRec.rating != null && currentRec.rating > 0 && (
                          <View style={styles.detailBadge}>
                            <Icon name="star" size={12} color="white" />
                            <Text style={styles.detailBadgeText}>
                              {currentRec.rating.toFixed(1)}
                            </Text>
                          </View>
                        )}
```

### Edge Cases

- `currentRec.rating` is `undefined` → `undefined != null` is false → hidden. Correct.
- `currentRec.rating` is `0` → `0 > 0` is false → hidden. Correct.
- `currentRec.rating` is `3.7` → shown as "3.7". Correct.

---

## Fix 1c: Wire Currency to 7 Missing Surfaces

### Currency Architecture (Verified)

**Source of truth:** User's Supabase profile `currency` field (e.g., `"USD"`, `"EUR"`, `"GBP"`).

**Two access patterns exist in the codebase:**
1. **Prop drilling:** `accountPreferences` flows from `AppStateManager` → `AppHandlers` → `HomePage` → components. Already used by SwipeableCards, SavedTab.
2. **Hook:** `useLocalePreferences()` at `app-mobile/src/hooks/useLocalePreferences.ts` reads from Zustand store (`useAppStore().profile?.currency`). Returns `{ currency, measurementSystem }`. Already used in 3 components (`SingleCardDisplay`, `BoardPreferencesForm`, `ExperienceCard`).

**Key utility functions:**
- `formatTierLabel(slug, currencySymbol, rate)` — `constants/priceTiers.ts:70`. Needs explicit symbol + rate.
- `tierRangeLabel(slug, currencySymbol, rate)` — `constants/priceTiers.ts`. Same signature.
- `tierLabel(slug)` — `constants/priceTiers.ts`. Returns word only ("Comfy"), no currency needed.
- `formatCurrency(amount, currencyCode)` — `utils/currency.ts` or `components/utils/formatters.ts`. Internally calls `getRate()`.
- `formatPriceRange(range, currencyCode)` — `components/utils/formatters.ts`.
- `getCurrencySymbol(currency)` — `utils/currency.ts`.
- `getCurrencyRate(currency)` — `components/utils/formatters.ts` or `services/currencyService.ts`.

### Surface-by-Surface Fix

---

#### Surface 1: CuratedExperienceSwipeCard.tsx (lines 43-50)

**Prop chain:** `SwipeableCards` → `CuratedExperienceSwipeCard`
**SwipeableCards already has** `accountPreferences` in scope. Renders CuratedExperienceSwipeCard at line 1809-1814.

**Current code (lines 43-50):**
```typescript
const firstStopTier = stops[0]?.priceTier;
const priceSummary = firstStopTier
  ? tierLabel(firstStopTier)
  : card.totalPriceMin != null && card.totalPriceMax != null
    ? `$${card.totalPriceMin}–${card.totalPriceMax}`
    : 'Free';
```

**Fix:**
1. Add prop: `currencyCode?: string` to `CuratedExperienceSwipeCard` props.
2. In SwipeableCards, pass `currencyCode={accountPreferences?.currency || 'USD'}` where CuratedExperienceSwipeCard is rendered.
3. Replace price logic:

```typescript
// AFTER:
const symbol = getCurrencySymbol(currencyCode || 'USD');
const rate = getCurrencyRate(currencyCode || 'USD');
const firstStopTier = stops[0]?.priceTier;
const priceSummary = firstStopTier
  ? formatTierLabel(firstStopTier, symbol, rate)
  : card.totalPriceMin != null && card.totalPriceMax != null
    ? `${formatCurrency(card.totalPriceMin, currencyCode || 'USD')}–${formatCurrency(card.totalPriceMax, currencyCode || 'USD')}`
    : 'Free';
```

4. Add imports: `getCurrencySymbol`, `getCurrencyRate` from `utils/currency` or `components/utils/formatters`; `formatTierLabel` from `constants/priceTiers`; `formatCurrency` from `utils/currency`.

**Components modified:** 2 (CuratedExperienceSwipeCard + SwipeableCards pass-through)

---

#### Surface 2: expandedCard/CardInfoSection.tsx (line 56)

**Prop chain:** Already receives `currency` prop (line 22). ExpandedCardModal passes `currency={accountPreferences?.currency}` (line 1289).
**The prop exists but is NEVER USED for tier display.**

**Current code (line 54-56):**
```typescript
const resolvedTier = priceTier ?? googleLevelToTierSlug(priceLevel);
const tierData = TIER_BY_SLUG[resolvedTier];
const tierDisplayText = `${tierLabel(resolvedTier)} · ${tierRangeLabel(resolvedTier)}`;
```

`tierRangeLabel(resolvedTier)` is called with NO symbol/rate args — defaults to `$` and rate `1`.

**Fix:**
```typescript
// AFTER:
const resolvedTier = priceTier ?? googleLevelToTierSlug(priceLevel);
const tierData = TIER_BY_SLUG[resolvedTier];
const symbol = getCurrencySymbol(currency || 'USD');
const rate = getCurrencyRate(currency || 'USD');
const tierDisplayText = `${tierLabel(resolvedTier)} · ${tierRangeLabel(resolvedTier, symbol, rate)}`;
```

Add imports: `getCurrencySymbol`, `getCurrencyRate` from `../../utils/currency` or `../utils/formatters`.

**Components modified:** 1 (CardInfoSection only — prop already wired)

---

#### Surface 3: ExpandedCardModal.tsx curated header (lines 425-428)

**Available in scope:** `accountPreferences` is destructured from props at line 775.
**BUT** the curated header is rendered inside `CuratedPlanView` (private function, line ~363) and `MultiStopPlanView` (line ~397), which are inner components that do NOT receive `accountPreferences`.

**Current code (lines 425-428):**
```typescript
const priceText =
  card.totalPriceMin === 0 && card.totalPriceMax === 0
    ? 'Free'
    : `$${card.totalPriceMin}–$${card.totalPriceMax}`;
```

**Fix:**
1. Thread `currencyCode` from ExpandedCardModal → CuratedPlanView/MultiStopPlanView. These are private functions in the same file, so add the parameter to their props interfaces.
2. Replace price text:

```typescript
// AFTER:
const currencyCode = currencyCodeProp || 'USD';
const priceText =
  card.totalPriceMin === 0 && card.totalPriceMax === 0
    ? 'Free'
    : `${formatCurrency(card.totalPriceMin, currencyCode)}–${formatCurrency(card.totalPriceMax, currencyCode)}`;
```

3. Where CuratedPlanView/MultiStopPlanView are called (inside ExpandedCardModal render), pass `currencyCode={accountPreferences?.currency || 'USD'}`.

Add import: `formatCurrency` from `../../utils/currency`.

**Components modified:** 1 file (ExpandedCardModal.tsx — 3 internal functions touched)

---

#### Surface 4: PersonGridCard.tsx (line 37)

**Prop chain analysis:** PersonGridCard → HolidayRow → PersonHolidayView → DiscoverScreen. That's 3 layers of prop drilling. DiscoverScreen has `accountPreferences`.

**Recommended approach:** Use `useLocalePreferences()` hook directly inside PersonGridCard. This hook is already an established pattern (used in 3 other components). Zero prop changes needed.

**Current code (line 37):**
```typescript
const formattedPrice = formatTierLabel(resolvedTier);
```

**Fix:**
```typescript
// AFTER:
const { currency } = useLocalePreferences();
const symbol = getCurrencySymbol(currency);
const rate = getCurrencyRate(currency);
const formattedPrice = formatTierLabel(resolvedTier, symbol, rate);
```

Add imports: `useLocalePreferences` from `../../hooks/useLocalePreferences`; `getCurrencySymbol`, `getCurrencyRate` from `../../utils/currency`.

**Components modified:** 1 (PersonGridCard only)

---

#### Surface 5: PersonCuratedCard.tsx (lines 25-36)

**Same chain as PersonGridCard.** Use `useLocalePreferences()` hook directly.

**Current code (lines 25-36):**
```typescript
function formatPriceRange(
  min: number | null,
  max: number | null
): string | null {
  if (min != null && max != null) {
    return `$${min} – $${max}`;
  }
  if (min != null) {
    return `$${min}+`;
  }
  return null;
}
```

**Fix:** Replace the local `formatPriceRange` with currency-aware version:

```typescript
// AFTER (inside the component, not as standalone function):
const { currency } = useLocalePreferences();

// Then where formatPriceRange is called, replace with:
const priceDisplay = totalPriceMin != null && totalPriceMax != null
  ? `${formatCurrency(totalPriceMin, currency)}–${formatCurrency(totalPriceMax, currency)}`
  : totalPriceMin != null
    ? `${formatCurrency(totalPriceMin, currency)}+`
    : null;
```

Delete the standalone `formatPriceRange` function (lines 25-36) and inline the logic using `formatCurrency` from `../../utils/currency`.

Add imports: `useLocalePreferences` from `../../hooks/useLocalePreferences`; `formatCurrency` from `../../utils/currency`.

**Components modified:** 1 (PersonCuratedCard only)

---

#### Surface 6: PersonHolidayView.tsx (lines 303-306)

**PersonHolidayView itself delegates price display to HolidayRow → PersonGridCard / PersonCuratedCard.** The audit cited lines 303-306 and 414/429 as showing `tierLabel(priceTier)` — just the tier word with no price range.

**Since PersonGridCard and PersonCuratedCard are being fixed with hooks (Surfaces 4 & 5), PersonHolidayView may not need changes for currency.** But verify: does PersonHolidayView directly render any price text?

Lines 414 and 429 are in `CompactCard` (an inner function). If these render a tier label, they also need fixing:

**Fix (if CompactCard renders prices directly):** Add `useLocalePreferences()` inside `PersonHolidayView` and pass `currencySymbol`/`rate` to the `formatTierLabel` calls within CompactCard. Since CompactCard is an inner function in the same component, no prop interface change needed — it shares the closure.

```typescript
// At top of PersonHolidayView component:
const { currency } = useLocalePreferences();
const currencySymbol = getCurrencySymbol(currency);
const currencyRate = getCurrencyRate(currency);

// In CompactCard where tierLabel is called:
// BEFORE: tierLabel(priceTier)
// AFTER: formatTierLabel(priceTier, currencySymbol, currencyRate)
```

Add imports: `useLocalePreferences`, `getCurrencySymbol`, `getCurrencyRate`, `formatTierLabel`.

**Components modified:** 1 (PersonHolidayView)

---

#### Surface 7: BoardSessionCard.tsx (line 129)

**Use `useLocalePreferences()` hook directly.** SessionViewModal has its own `accountPreferences` but doesn't pass it to BoardSessionCard.

**Current code (line 128-130):**
```typescript
            <Text style={styles.priceText}>
              {cardData.priceRange || "$12-28"}
            </Text>
```

**Fix (combined with Fix 1a removal of fake fallback):**
```typescript
// AFTER:
const { currency } = useLocalePreferences();

// In JSX:
            <Text style={styles.priceText}>
              {cardData.priceRange ? formatPriceRange(cardData.priceRange, currency) : '—'}
            </Text>
```

Add imports: `useLocalePreferences` from `../../hooks/useLocalePreferences`; `formatPriceRange` from `../utils/formatters`.

**Components modified:** 1 (BoardSessionCard only)

---

### Currency Fix Summary Table

| # | Component | Fix Method | Props Added | New Imports |
|---|-----------|-----------|-------------|-------------|
| 1 | CuratedExperienceSwipeCard | New `currencyCode` prop from SwipeableCards | 1 prop | getCurrencySymbol, getCurrencyRate, formatTierLabel, formatCurrency |
| 2 | CardInfoSection | Use existing `currency` prop | 0 | getCurrencySymbol, getCurrencyRate |
| 3 | ExpandedCardModal (curated header) | Thread `currencyCode` to inner functions | 0 external props | formatCurrency |
| 4 | PersonGridCard | `useLocalePreferences()` hook | 0 | useLocalePreferences, getCurrencySymbol, getCurrencyRate |
| 5 | PersonCuratedCard | `useLocalePreferences()` hook | 0 | useLocalePreferences, formatCurrency |
| 6 | PersonHolidayView | `useLocalePreferences()` hook | 0 | useLocalePreferences, getCurrencySymbol, getCurrencyRate, formatTierLabel |
| 7 | BoardSessionCard | `useLocalePreferences()` hook | 0 | useLocalePreferences, formatPriceRange |

### Invariant

**Every surface that displays a price MUST use `formatTierLabel()` or `formatCurrency()` with the user's currency code. No hardcoded `$`.**

---

## Fix 1d: SavedTab Curated Title

### Behavior Before

`SavedTab.tsx:1802-1804`:
```typescript
          <Text style={curatedSavedStyles.title} numberOfLines={2}>
            {stops.map(s => s.placeName).join(' → ')}
          </Text>
```

A curated experience titled "Adventurous Night Out" shows as "Restaurant A → Bar B → Park C" in SavedTab. Every other surface shows the experience title.

### Behavior After

Primary title = experience title. Stop names become subtitle.

### Exact Change

```
// BEFORE:
          <Text style={curatedSavedStyles.title} numberOfLines={2}>
            {stops.map(s => s.placeName).join(' → ')}
          </Text>

// AFTER:
          <Text style={curatedSavedStyles.title} numberOfLines={2}>
            {card.title || stops.map(s => s.placeName).join(' → ')}
          </Text>
```

The `card.title` is the experience title (e.g., "Adventurous Night Out"). Falls back to stop names only if title is missing. The stop names arrow text already appears in the image strip badges and tagline area — removing it from the title does not lose information.

### Edge Cases

- `card.title` is undefined/null → falls back to stop names join. Correct.
- `card.title` is empty string → falls back to stop names join (`""` is falsy). Correct.
- `card.title` is present → shows experience title. Correct.

---

## Fix 1e: Render Opening Hours in PracticalDetailsSection

### Behavior Before

`PracticalDetailsSection.tsx` accepts `openingHours` in its Props interface (line 11-19) but:
- `hasAnyDetails` (line 45) only checks `address || phone` — ignores `openingHours`
- No JSX renders `openingHours` anywhere

Also: `website` is accepted as a prop but never rendered. Out of scope for this fix (no audit bug filed for it).

### Behavior After

If `openingHours` is provided:
- Include it in `hasAnyDetails` check
- Render it as a new row between address and phone, matching existing visual style
- Handle both string format and structured `{ open_now, weekday_text }` format

### Exact Change

**Line 45 — hasAnyDetails:**
```
// BEFORE:
  const hasAnyDetails = address || phone;

// AFTER:
  const hasAnyDetails = address || phone || openingHours;
```

**Add between address block (ends line 66) and phone block (starts line 69):**

```tsx
      {/* Opening Hours */}
      {openingHours && (
        <View style={styles.hoursRow}>
          <View style={styles.iconBadge}>
            <Icon name="time-outline" size={14} color="#ea580c" />
          </View>
          <View style={styles.hoursContent}>
            {typeof openingHours === 'string' ? (
              <Text style={styles.hoursText}>{openingHours}</Text>
            ) : (
              <>
                {openingHours.open_now != null && (
                  <Text style={[styles.openStatus, { color: openingHours.open_now ? '#16a34a' : '#dc2626' }]}>
                    {openingHours.open_now ? 'Open now' : 'Closed'}
                  </Text>
                )}
                {openingHours.weekday_text?.map((day, i) => (
                  <Text key={i} style={styles.hoursText}>{day}</Text>
                ))}
              </>
            )}
          </View>
        </View>
      )}
```

**Add styles:**
```typescript
  hoursRow: { flexDirection: "row", backgroundColor: "#fef7f0", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#eb782533", gap: 8 },
  hoursContent: { flex: 1, gap: 2 },
  hoursText: { fontSize: 12, color: "#374151", lineHeight: 16 },
  openStatus: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
```

### Edge Cases

- `openingHours` is `null` → not rendered. Correct.
- `openingHours` is `""` (empty string) → rendered as empty Text (falsy check: `""` is falsy in JS → not rendered). Correct.
- `openingHours` is `{ open_now: true, weekday_text: undefined }` → shows "Open now", no day list. Correct.
- `openingHours` is `{ open_now: undefined, weekday_text: ["Mon: 9-5", ...] }` → shows day list, no status badge. Correct.
- Address and phone are both null but openingHours exists → section renders (fixed by hasAnyDetails change). Correct.

---

## Fix 1f: Travel Mode Icon on SavedTab + BoardSessionCard

### Behavior Before

- `SavedTab.tsx:1932` — hardcoded `<Icon name="paper-plane">`
- `BoardSessionCard.tsx:123` — hardcoded `<Icon name="paper-plane">`

Both ignore the card's `travelMode` field. SwipeableCards and CardInfoSection use `getTravelModeIcon(mode)` which shows contextual walking/driving/transit icons.

### Where getTravelModeIcon Lives

**Three identical copies exist** (verified):
- `SwipeableCards.tsx:104`
- `CardInfoSection.tsx:26`
- `CuratedExperienceSwipeCard.tsx:18`

All have the same body:
```typescript
function getTravelModeIcon(mode?: string): string {
  switch (mode) {
    case 'driving': return 'car';
    case 'transit': return 'bus-outline';
    case 'bicycling':
    case 'biking': return 'bicycle-outline';
    case 'walking':
    default: return 'walk-outline';
  }
}
```

### Approach

Add a 4th copy of `getTravelModeIcon` inside SavedTab and a 5th inside BoardSessionCard. This is not ideal (5 copies), but matches the existing pattern and avoids scope creep into a utility refactor. The refactor to extract a shared utility is earmarked for Pass 5 (icon system consolidation).

### Exact Changes

**SavedTab.tsx — Add function near top of file (after imports):**
```typescript
function getTravelModeIcon(mode?: string): string {
  switch (mode) {
    case 'driving': return 'car';
    case 'transit': return 'bus-outline';
    case 'bicycling':
    case 'biking': return 'bicycle-outline';
    case 'walking':
    default: return 'walk-outline';
  }
}
```

**SavedTab.tsx — Already changed in Fix 1a.** The travel time line now uses `getTravelModeIcon(card.travelMode)` instead of `"paper-plane"`.

**BoardSessionCard.tsx — Add same function near top of file. Already changed in Fix 1a.**

### Edge Cases

- `card.travelMode` is undefined → defaults to `'walk-outline'`. Correct.
- `card.travelMode` is `"biking"` → `'bicycle-outline'`. Correct.
- `card.travelMode` is unknown string → defaults to `'walk-outline'`. Safe.

---

## Complete File Change Summary

| File | Fixes Applied | Changes |
|------|--------------|---------|
| **SavedTab.tsx** | 1a, 1d, 1f | Remove fake rating/travel fallbacks; conditional render for rating+travel; curated title uses `card.title`; add `getTravelModeIcon` function; use travel-mode-aware icon |
| **BoardSessionCard.tsx** | 1a, 1c, 1f | Remove fake rating/travel/price fallbacks; conditional render for rating+travel; price uses `formatPriceRange` with currency via `useLocalePreferences()`; add `getTravelModeIcon`; use travel-mode-aware icon |
| **SwipeableCards.tsx** | 1b, 1c (pass-through) | Conditional render for rating badge; pass `currencyCode` to CuratedExperienceSwipeCard |
| **CuratedExperienceSwipeCard.tsx** | 1c | New `currencyCode` prop; use `formatTierLabel`/`formatCurrency` with currency |
| **expandedCard/CardInfoSection.tsx** | 1c | Use existing `currency` prop in `tierRangeLabel()` call |
| **ExpandedCardModal.tsx** | 1c | Thread `currencyCode` to CuratedPlanView/MultiStopPlanView; use `formatCurrency` in curated price text |
| **PersonGridCard.tsx** | 1c | `useLocalePreferences()` hook; pass currency to `formatTierLabel()` |
| **PersonCuratedCard.tsx** | 1c | `useLocalePreferences()` hook; replace local `formatPriceRange` with `formatCurrency` |
| **PersonHolidayView.tsx** | 1c | `useLocalePreferences()` hook; pass currency to `formatTierLabel()` in CompactCard |
| **expandedCard/PracticalDetailsSection.tsx** | 1e | Add `openingHours` to `hasAnyDetails`; render hours section with structured/string support |

**Total: 10 files modified. 0 new files. 0 schema changes. 0 edge function changes.**

---

## Test Criteria (Comprehensive)

### Fix 1a — Fabricated Fallbacks

| # | Scenario | Expected |
|---|----------|----------|
| T1 | Card with rating=4.2 in SavedTab | Shows "4.2 ★" |
| T2 | Card with rating=null in SavedTab | Rating row hidden entirely |
| T3 | Card with rating=0 in SavedTab | Rating row hidden entirely |
| T4 | Card with travelTime="20 min" in SavedTab | Shows "20 min" with correct mode icon |
| T5 | Card with travelTime=null in SavedTab | Travel time row hidden |
| T6 | Card with all nulls in BoardSessionCard | Rating hidden, travel hidden, price shows "—" |
| T7 | Card with all data in BoardSessionCard | All rows show real data |

### Fix 1b — SwipeableCards Rating

| # | Scenario | Expected |
|---|----------|----------|
| T8 | Card with rating=3.5 on swipe deck | Shows "3.5 ★" |
| T9 | Card with rating=null on swipe deck | Rating badge not visible |
| T10 | Card with rating=0 on swipe deck | Rating badge not visible |

### Fix 1c — Currency

| # | Scenario | Expected |
|---|----------|----------|
| T11 | User currency=EUR, view CuratedExperienceSwipeCard | Price shows € symbol |
| T12 | User currency=GBP, view expanded single card | Tier range shows £ amounts |
| T13 | User currency=EUR, view expanded curated card header | Price shows €X–€Y |
| T14 | User currency=GBP, view PersonGridCard | Tier label shows £ amounts |
| T15 | User currency=EUR, view PersonCuratedCard | Price range shows €X–€Y |
| T16 | User currency=GBP, view PersonHolidayView CompactCard | Tier label shows £ |
| T17 | User currency=EUR, view BoardSessionCard | Price shows € format |
| T18 | User currency=USD, all surfaces | No regression — $ shown everywhere |

### Fix 1d — Curated Title

| # | Scenario | Expected |
|---|----------|----------|
| T19 | Curated card with title "Night Out" saved | SavedTab shows "Night Out" as title |
| T20 | Curated card with null title saved | SavedTab falls back to "Stop A → Stop B" |

### Fix 1e — Opening Hours

| # | Scenario | Expected |
|---|----------|----------|
| T21 | Card with string openingHours | Hours rendered in expanded card details |
| T22 | Card with structured openingHours (open_now=true) | Shows "Open now" + day list |
| T23 | Card with null openingHours | No hours section, address/phone still work |
| T24 | Card with only openingHours (no address, no phone) | Section renders with just hours |

### Fix 1f — Travel Icons

| # | Scenario | Expected |
|---|----------|----------|
| T25 | Card with travelMode="driving" in SavedTab | Shows car icon |
| T26 | Card with travelMode="transit" in BoardSessionCard | Shows bus icon |
| T27 | Card with travelMode=null in SavedTab | Shows walk icon (default) |

---

## Scope Boundaries (DO NOT)

- Do NOT change any edge function or migration
- Do NOT change the scoring algorithm or deck logic
- Do NOT change the save/schedule flow
- Do NOT refactor icon systems into shared utility (that's Pass 5)
- Do NOT add new components (only modify existing)
- Do NOT change the data shape flowing from the server
- Do NOT touch price formatting in SavedTab single/curated — those already work with currency
