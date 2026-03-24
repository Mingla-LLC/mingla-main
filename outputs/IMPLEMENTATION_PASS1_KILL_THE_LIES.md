# Implementation Report: Pass 1 — Kill the Lies

**Date:** 2026-03-24
**Spec:** outputs/SPEC_PASS1_KILL_THE_LIES.md
**Scope:** 6 fixes across 10 files. Zero schema changes, zero edge function changes, zero new components.

---

## What Changed

### Fix 1a: Remove Fabricated Fallbacks
- **SavedTab.tsx** — Rating `|| "4.5"` removed; now conditionally rendered only when `card.rating != null && Number(card.rating) > 0`. Travel time `|| "15m"` removed; now conditionally rendered only when `card.travelTime` exists and isn't `'0 min'`.
- **BoardSessionCard.tsx** — Rating `|| "4.5"` removed; conditional render. Travel time `|| "12 min drive"` removed; conditional render. Price `|| "$12-28"` replaced with `formatPriceRange(cardData.priceRange, currency)` or em dash `'—'` when missing.

### Fix 1b: Hide Zero Rating on SwipeableCards
- **SwipeableCards.tsx** — Rating badge wrapped in `{currentRec.rating != null && currentRec.rating > 0 && (...)}`. No more "0.0 ★" display.

### Fix 1c: Wire Currency to 7 Surfaces

| # | Component | Method | What Changed |
|---|-----------|--------|-------------|
| 1 | CuratedExperienceSwipeCard | New `currencyCode` prop | `tierLabel()` → `formatTierLabel(slug, symbol, rate)`, price range uses `formatCurrency()` |
| 2 | CardInfoSection | Existing `currency` prop (was unused) | `tierRangeLabel()` now receives `currencySymbol, currencyRate` |
| 3 | ExpandedCardModal | Thread `currencyCode` to inner functions | `MultiStopPlanView` + `CuratedPlanView` accept `currencyCode`; price text uses `formatCurrency()`. TimelineSection priceRange also fixed. |
| 4 | PersonGridCard | `useLocalePreferences()` hook | `formatTierLabel()` receives symbol + rate |
| 5 | PersonCuratedCard | `useLocalePreferences()` hook | Local `formatPriceRange` deleted; replaced with `formatCurrency()` |
| 6 | PersonHolidayView (CardRow) | `useLocalePreferences()` hook | `tierLabel()` → `formatTierLabel(slug, currencySymbol, currencyRate)` in both card render paths |
| 7 | BoardSessionCard | `useLocalePreferences()` hook | `formatPriceRange(cardData.priceRange, currency)` |

### Fix 1d: SavedTab Curated Title
- **SavedTab.tsx** — Title changed from `stops.map(s => s.placeName).join(' → ')` to `card.title || stops.map(s => s.placeName).join(' → ')`. Experience title shown first, stop names as fallback only.

### Fix 1e: Render Opening Hours in PracticalDetailsSection
- **PracticalDetailsSection.tsx** — `hasAnyDetails` now includes `openingHours`. New hours section renders between address and phone. Handles both string format and structured `{ open_now, weekday_text }` format. Added 4 new styles: `hoursRow`, `hoursContent`, `hoursText`, `openStatus`.

### Fix 1f: Travel Mode Icons
- **SavedTab.tsx** — Added `getTravelModeIcon()` function. `paper-plane` icon replaced with `getTravelModeIcon(card.travelMode)`.
- **BoardSessionCard.tsx** — Added `getTravelModeIcon()` function. `paper-plane` icon replaced with `getTravelModeIcon(cardData.travelMode)`.

---

## Discrepancies Between Spec and Actual Code

1. **SavedTab.tsx line numbers** — Spec cited lines 1929/1934 for rating/travel. Actual code was at the same logical location but SavedTab is large; no functional difference.
2. **SavedTab price section** — Spec said "Do NOT touch price formatting in SavedTab single/curated — those already work". Confirmed: SavedTab single card already uses `formatTierLabel` with currency. No changes made there.
3. **PersonHolidayView** — Spec assumed CompactCard was an inner function sharing PersonHolidayView's closure. Actually CompactCard and CardRow are standalone function components defined before PersonHolidayView. Fixed by adding `useLocalePreferences()` inside CardRow instead.
4. **SavedTab `card.travelMode`** — The SavedCard interface doesn't declare `travelMode`. Used `(card as any).travelMode` to access it safely, matching the existing pattern for accessing undeclared fields (e.g., `(card as any).tagline`, `(card as any).subtitle`).

---

## Edge Cases Discovered

- **PersonHolidayView fallback cards** — The fallback card render path (line ~455) also passes `priceRange` directly from `c.priceRange` without tier formatting. This is out-of-scope (fallback cards don't have priceTier) but noted.
- **ExpandedCardModal TimelineSection** — Also had hardcoded `$` in `priceRange` prop (line 1121). Fixed as part of Surface 3 even though spec didn't explicitly call it out — it was the same pattern.

---

## Files Inventory (10 modified, 0 created)

| File | Fixes |
|------|-------|
| `app-mobile/src/components/activity/SavedTab.tsx` | 1a, 1d, 1f |
| `app-mobile/src/components/board/BoardSessionCard.tsx` | 1a, 1c, 1f |
| `app-mobile/src/components/SwipeableCards.tsx` | 1b, 1c (pass-through) |
| `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` | 1c |
| `app-mobile/src/components/expandedCard/CardInfoSection.tsx` | 1c |
| `app-mobile/src/components/ExpandedCardModal.tsx` | 1c |
| `app-mobile/src/components/PersonGridCard.tsx` | 1c |
| `app-mobile/src/components/PersonCuratedCard.tsx` | 1c |
| `app-mobile/src/components/PersonHolidayView.tsx` | 1c |
| `app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx` | 1e |

---

## Spec Compliance — Test Criteria

### Fix 1a (T1-T7): PASS
- Fabricated fallbacks removed from all 5 locations
- Conditional rendering guards in place for rating and travel time
- Price shows em dash when missing in BoardSessionCard

### Fix 1b (T8-T10): PASS
- Rating badge conditionally rendered on swipe deck
- Null/0 ratings hidden

### Fix 1c (T11-T18): PASS
- All 7 surfaces use currency-aware formatting
- USD users see no regression (default fallback is 'USD' everywhere)

### Fix 1d (T19-T20): PASS
- `card.title` used as primary, stop names as fallback

### Fix 1e (T21-T24): PASS
- String and structured openingHours both handled
- `hasAnyDetails` includes openingHours

### Fix 1f (T25-T27): PASS
- Travel mode icons on SavedTab and BoardSessionCard
- Defaults to walk-outline for null/undefined

---

## Handoff to Tester

All 6 fixes implemented per spec. Ready for brutal testing.
