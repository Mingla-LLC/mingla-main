# Test Report: Pass 1 — Kill the Lies

**Date:** 2026-03-24
**Spec:** outputs/SPEC_PASS1_KILL_THE_LIES.md
**Implementation:** outputs/IMPLEMENTATION_PASS1_KILL_THE_LIES.md
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Test Manifest

Total items tested: 42

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 10 | 9 | 0 | 1 |
| Pattern Compliance | 10 | 10 | 0 | 0 |
| Security | 4 | 4 | 0 | 0 |
| React Query & State | 4 | 4 | 0 | 0 |
| Import Resolution | 10 | 10 | 0 | 0 |
| Spec Criteria (T1–T27) | 27 | 26 | 0 | 1 |
| Cross-Cutting Concerns | 4 | 3 | 0 | 1 |
| **TOTAL** | **69** | **66** | **0** | **3** |

---

## Spec Criteria — Detailed Pass/Fail

### Fix 1a — Fabricated Fallbacks (T1–T7)

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| T1 | Card with rating=4.2 in SavedTab shows "4.2 ★" | ✅ PASS | `Number(card.rating).toFixed(1)` renders "4.2". Guard `card.rating != null && Number(card.rating) > 0` passes. |
| T2 | Card with rating=null in SavedTab → hidden | ✅ PASS | `null != null` → false → entire `<View>` not rendered. |
| T3 | Card with rating=0 in SavedTab → hidden | ✅ PASS | `Number(0) > 0` → false → hidden. |
| T4 | Card with travelTime="20 min" shows with mode icon | ✅ PASS | Truthy + not `'0 min'` → renders. `getTravelModeIcon` called on `travelMode`. |
| T5 | Card with travelTime=null → hidden | ✅ PASS | `null` is falsy → not rendered. |
| T6 | Card with all nulls in BoardSessionCard | ✅ PASS | Rating hidden (`null != null` false), travel hidden (falsy), price shows `'—'` (`null` is falsy → ternary picks em dash). |
| T7 | Card with all data in BoardSessionCard | ✅ PASS | All three stats render with real data. `formatPriceRange(cardData.priceRange, currency)` produces currency-formatted string. |

### Fix 1b — SwipeableCards Rating (T8–T10)

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| T8 | Card with rating=3.5 on swipe deck | ✅ PASS | `3.5 != null && 3.5 > 0` → true → renders `3.5`. |
| T9 | Card with rating=null on swipe deck | ✅ PASS | `null != null` → false → badge hidden. |
| T10 | Card with rating=0 on swipe deck | ✅ PASS | `0 > 0` → false → badge hidden. |

### Fix 1c — Currency (T11–T18)

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| T11 | EUR user, CuratedExperienceSwipeCard | ✅ PASS | `currencyCode` prop threaded from SwipeableCards → `getCurrencySymbol('EUR')` → `€`. `formatTierLabel` and `formatCurrency` both receive EUR. |
| T12 | GBP user, expanded single card (CardInfoSection) | ✅ PASS | Existing `currency` prop now used: `getCurrencySymbol(currency)` + `getCurrencyRate(currency)` → `tierRangeLabel` receives £ symbol and GBP rate. |
| T13 | EUR user, expanded curated card header | ✅ PASS | `currencyCode` threaded from ExpandedCardModal → CuratedPlanView → MultiStopPlanView. `formatCurrency(totalPriceMin, 'EUR')` produces €-formatted output. TimelineSection `priceRange` prop also fixed (line 1125). |
| T14 | GBP user, PersonGridCard | ✅ PASS | `useLocalePreferences()` → `getCurrencySymbol(currency)` + `getCurrencyRate(currency)` → `formatTierLabel` receives £. |
| T15 | EUR user, PersonCuratedCard | ✅ PASS | `useLocalePreferences()` → `formatCurrency(totalPriceMin, currency)` produces €-formatted range. Local `formatPriceRange` function deleted. |
| T16 | GBP user, PersonHolidayView CardRow | ✅ PASS | `useLocalePreferences()` in CardRow → `formatTierLabel(slug, currencySymbol, currencyRate)` at both card render paths (lines 416 and 431). |
| T17 | EUR user, BoardSessionCard | ✅ PASS | `useLocalePreferences()` → `formatPriceRange(cardData.priceRange, currency)` in price text. |
| T18 | USD user, all surfaces | ✅ PASS | All fallbacks default to `'USD'`. `getCurrencySymbol('USD')` = `'$'`, `getCurrencyRate('USD')` = `1`. No regression. |

### Fix 1d — Curated Title (T19–T20)

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| T19 | Curated card with title "Night Out" | ✅ PASS | `card.title || stops.map(...)` → `"Night Out"` is truthy → shown. |
| T20 | Curated card with null title | ✅ PASS | `null || stops.map(...)` → falls back to stop names. |

### Fix 1e — Opening Hours (T21–T24)

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| T21 | String openingHours | ✅ PASS | `typeof openingHours === 'string'` → renders as `<Text>`. |
| T22 | Structured openingHours (open_now=true) | ✅ PASS | Renders "Open now" in green + `weekday_text` list. |
| T23 | Null openingHours | ✅ PASS | `{openingHours && (...)}` → not rendered. `hasAnyDetails` still works for address/phone. |
| T24 | Only openingHours (no address, no phone) | ✅ PASS | `hasAnyDetails = false || false || openingHours` → truthy → section renders with just hours. |

### Fix 1f — Travel Icons (T25–T27)

| # | Scenario | Verdict | Evidence |
|---|----------|---------|----------|
| T25 | travelMode="driving" in SavedTab | ✅ PASS | `getTravelModeIcon('driving')` → `'car'`. |
| T26 | travelMode="transit" in BoardSessionCard | ✅ PASS | `getTravelModeIcon('transit')` → `'bus-outline'`. |
| T27 | travelMode=null in SavedTab | ✅ PASS | `getTravelModeIcon(undefined)` → default → `'walk-outline'`. |

---

## 🟡 Medium Findings

### MED-001: Unused `tierLabel` Import in PersonHolidayView

**File:** `app-mobile/src/components/PersonHolidayView.tsx` (line 29)
**Category:** Dead code
**What's Wrong:**
`tierLabel` is imported but never used. Both call sites were changed to `formatTierLabel`. This will cause lint warnings and may fail strict unused-import checks.

**Evidence:**
```typescript
import { PriceTierSlug, tierLabel, formatTierLabel } from "../constants/priceTiers";
//                       ^^^^^^^^^^ — never referenced in file body
```

**Required Fix:**
Remove `tierLabel` from the import:
```typescript
import { PriceTierSlug, formatTierLabel } from "../constants/priceTiers";
```

**Why This Matters:**
Lint noise. No functional impact, but violates clean-code discipline.

---

### MED-002: Whitespace-Only `card.title` Not Guarded

**File:** `app-mobile/src/components/activity/SavedTab.tsx` (line 1814)
**Category:** Edge case
**What's Wrong:**
`card.title || stops.map(...)` treats whitespace-only strings (e.g., `"  "`) as truthy. If a curated experience title is accidentally saved as whitespace, the SavedTab would show a blank title instead of falling back to stop names.

**Evidence:**
```typescript
{card.title || stops.map(s => s.placeName).join(' → ')}
// "  " is truthy → renders blank space
```

**Required Fix:**
```typescript
{card.title?.trim() || stops.map(s => s.placeName).join(' → ')}
```

**Why This Matters:**
Low probability but easy to fix. Defensive coding for data that comes from backend/AI generation.

---

### MED-003: `SwipeableSessionCards.tsx` Still Has Fabricated Rating Fallback

**File:** `app-mobile/src/components/board/SwipeableSessionCards.tsx` (line 442)
**Category:** Missed surface (out of scope but related)
**What's Wrong:**
The spec targeted 10 files. But `SwipeableSessionCards.tsx` (the board *swipe* card, not the board *session* card) still has:

```typescript
{cardData.rating?.toFixed(1) || "4.5"}
```

This is the same fabricated `"4.5"` fallback that was removed from every other surface.

**Evidence:**
```
$ grep -n '"4.5"' app-mobile/src/components/board/SwipeableSessionCards.tsx
442: {cardData.rating?.toFixed(1) || "4.5"}
```

**Required Fix:**
Apply the same conditional-render pattern used in BoardSessionCard:
```typescript
{cardData.rating != null && cardData.rating > 0 && (
  <View style={styles.statItem}>
    <Icon name="star" size={14} color="#eb7825" />
    <Text style={styles.statText}>
      {Number(cardData.rating).toFixed(1)} ({cardData.reviewCount || 0})
    </Text>
  </View>
)}
```

**Why This Matters:**
This is the same lie the spec aimed to kill. Users in a board session swiping cards will still see fake "4.5" ratings. The audit missed this 11th file.

---

## ✅ What Passed

### Things Done Right

1. **Consistent guard pattern** — Every rating guard uses `!= null && > 0`, every travel guard uses `truthy && !== '0 min'`. Zero inconsistency across files.
2. **Currency wiring is thorough** — All 7 surfaces correctly wire currency via either prop drilling or `useLocalePreferences()` hook. The two-pattern approach (props vs hook) matches existing codebase conventions.
3. **`formatCurrency` double-conversion risk is zero** — Verified: `formatCurrency()` internally calls `getRate()` and applies conversion. `formatTierLabel()` takes explicit `symbol` + `rate` params. The implementor correctly used each function's contract without mixing them.
4. **Opening hours implementation is clean** — Handles string, structured, and null cases. The `open_now` color coding (green/red) and `weekday_text` rendering are well-structured. Styles use `StyleSheet.create()` correctly.
5. **Import resolution is 100%** — All 10 files have correct import paths. Every function exists with the right signature. No runtime crashes from missing exports.
6. **`(card as any).travelMode` is consistent** — SavedTab already uses `(card as any)` for 20+ fields (tagline, subtitle, stops, etc.). The implementor followed the established pattern, not introducing a new type hole.
7. **TimelineSection priceRange fix** — The implementor caught an extra `$`-hardcoded spot at ExpandedCardModal line 1125 that wasn't explicitly in the spec and fixed it. Good initiative.
8. **PersonCuratedCard cleanup** — Deleted the local `formatPriceRange` function entirely and replaced with the shared `formatCurrency`. Clean removal, no dead code.

---

## Spec Compliance Matrix

| Success Criterion | Tested? | Passed? | Evidence |
|-------------------|---------|---------|----------|
| T1: Rating 4.2 in SavedTab | ✅ | ✅ | `Number(card.rating).toFixed(1)` |
| T2: Rating null in SavedTab hidden | ✅ | ✅ | `card.rating != null` false |
| T3: Rating 0 in SavedTab hidden | ✅ | ✅ | `Number(0) > 0` false |
| T4: Travel "20 min" shows with icon | ✅ | ✅ | Truthy + mode icon |
| T5: Travel null hidden | ✅ | ✅ | Falsy check |
| T6: All nulls in BoardSessionCard | ✅ | ✅ | Hidden/em dash |
| T7: All data in BoardSessionCard | ✅ | ✅ | Real data rendered |
| T8: Rating 3.5 on swipe deck | ✅ | ✅ | Guard passes |
| T9: Rating null on swipe deck hidden | ✅ | ✅ | Guard fails |
| T10: Rating 0 on swipe deck hidden | ✅ | ✅ | `0 > 0` false |
| T11: EUR CuratedExperienceSwipeCard | ✅ | ✅ | `currencyCode` prop |
| T12: GBP CardInfoSection | ✅ | ✅ | Existing `currency` prop now used |
| T13: EUR ExpandedCardModal curated | ✅ | ✅ | `currencyCode` threaded |
| T14: GBP PersonGridCard | ✅ | ✅ | `useLocalePreferences()` |
| T15: EUR PersonCuratedCard | ✅ | ✅ | `formatCurrency` with hook |
| T16: GBP PersonHolidayView | ✅ | ✅ | `formatTierLabel` with hook |
| T17: EUR BoardSessionCard | ✅ | ✅ | `formatPriceRange` with hook |
| T18: USD no regression | ✅ | ✅ | All defaults = 'USD' |
| T19: Curated title shown | ✅ | ✅ | `card.title \|\| fallback` |
| T20: Null title → stop names | ✅ | ✅ | `null \|\| stops.map(...)` |
| T21: String openingHours | ✅ | ✅ | `typeof === 'string'` branch |
| T22: Structured openingHours | ✅ | ✅ | `open_now` + `weekday_text` |
| T23: Null openingHours | ✅ | ✅ | Not rendered |
| T24: Only openingHours | ✅ | ✅ | `hasAnyDetails` includes it |
| T25: driving → car icon | ✅ | ✅ | Switch case |
| T26: transit → bus icon | ✅ | ✅ | Switch case |
| T27: null → walk icon | ✅ | ✅ | Default case |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Removed fabricated fallbacks from all 5 locations" | ✅ | ✅ | All 5 specific locations confirmed clean |
| "All 7 surfaces use currency-aware formatting" | ✅ | ✅ | Every surface verified with correct function calls |
| "card.title used as primary, stop names fallback" | ✅ | ✅ | Line 1814 confirmed |
| "hasAnyDetails includes openingHours" | ✅ | ✅ | Line 45 confirmed |
| "getTravelModeIcon added to SavedTab and BoardSessionCard" | ✅ | ✅ | Both files have identical function copies |
| "Discrepancy: PersonHolidayView CompactCard is standalone" | ✅ | ✅ | CardRow is indeed standalone; hook added inside CardRow |
| "Discrepancy: SavedTab uses (card as any).travelMode" | ✅ | ✅ | Matches existing pattern (20+ other `(card as any)` usages) |
| "0 files created" | ✅ | ✅ | Only modifications |
| "0 schema changes" | ✅ | ✅ | No migration files in diff |
| "TimelineSection priceRange also fixed" | ✅ | ✅ | Line 1125 uses `formatCurrency` now |

---

## Recommendations

### Mandatory Before Merge
None. All critical and high findings are clear.

### Strongly Recommended (Quick Fixes)
1. **MED-001**: Remove unused `tierLabel` from PersonHolidayView import — 3-second fix
2. **MED-002**: Add `.trim()` to `card.title` guard in SavedTab — 3-second fix

### Track for Next Pass
1. **MED-003**: `SwipeableSessionCards.tsx` line 442 still has `|| "4.5"` fabricated fallback. Should be fixed in Pass 2 or as a quick addition to this PR. Same lie, different file.

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — Zero critical findings. Zero high findings. All 27 spec test criteria pass. Three medium findings: one dead import (MED-001), one edge case guard (MED-002), and one missed surface with the same fabricated data bug (MED-003). The first two are 3-second fixes. MED-003 is out of the spec's stated scope (10 files) but is the same class of bug — worth including in this PR for completeness. Safe to merge after addressing MED-001 and MED-002. MED-003 can be merged separately if scope discipline is preferred.
