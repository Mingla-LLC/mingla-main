# Test Prompt: Pass 1 — Kill the Lies

**Skill:** Brutal Tester
**Date:** 2026-03-24
**Spec:** outputs/SPEC_PASS1_KILL_THE_LIES.md
**Implementation:** outputs/IMPLEMENTATION_PASS1_KILL_THE_LIES.md
**Scope:** 6 fixes across 10 files. Verify all changes, run 27 test criteria, find anything the implementor missed.

---

## What Was Changed

10 files modified to remove fabricated data, wire currency, fix curated title, render opening hours, and fix travel icons. Zero schema/edge function changes.

**Files to audit:**
1. `app-mobile/src/components/activity/SavedTab.tsx` — Fixes 1a, 1d, 1f
2. `app-mobile/src/components/board/BoardSessionCard.tsx` — Fixes 1a, 1c, 1f
3. `app-mobile/src/components/SwipeableCards.tsx` — Fixes 1b, 1c
4. `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` — Fix 1c
5. `app-mobile/src/components/expandedCard/CardInfoSection.tsx` — Fix 1c
6. `app-mobile/src/components/ExpandedCardModal.tsx` — Fix 1c
7. `app-mobile/src/components/PersonGridCard.tsx` — Fix 1c
8. `app-mobile/src/components/PersonCuratedCard.tsx` — Fix 1c
9. `app-mobile/src/components/PersonHolidayView.tsx` — Fix 1c
10. `app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx` — Fix 1e

## What To Verify

### 1. Fabricated Fallbacks (Fix 1a + 1b)
- Confirm ALL 5 hardcoded fallbacks are gone (fake "4.5", "15m", "12 min drive", "$12-28")
- Confirm conditional rendering guards use `!= null && > 0` for rating, truthy + `!== '0 min'` for travel
- Confirm price fallback is "—" (em dash), not empty string
- Confirm SwipeableCards rating badge hidden when null/0
- Check: are there ANY other fabricated fallbacks in these files that were missed?

### 2. Currency Wiring (Fix 1c)
- For each of the 7 surfaces: confirm currency-aware formatting is used
- Confirm `useLocalePreferences()` is called correctly (not conditionally, not inside loops)
- Confirm `getCurrencySymbol` and `getCurrencyRate` imports resolve correctly
- Confirm `formatTierLabel` receives symbol + rate params
- Confirm `formatCurrency` receives currencyCode
- Check: does the existing `formatPriceRange` function in formatters.ts accept a currency param? If not, the BoardSessionCard call may fail.
- Check: are `getCurrencySymbol` and `getCurrencyRate` exported from the same file the imports point to?

### 3. Curated Title (Fix 1d)
- Confirm `card.title` is used with fallback to stop names
- Check: what if `card.title` is just whitespace? `"  "` is truthy but renders blank.

### 4. Opening Hours (Fix 1e)
- Confirm `hasAnyDetails` includes `openingHours`
- Confirm both string and structured format handled
- Confirm styles added (hoursRow, hoursContent, hoursText, openStatus)
- Check: what happens if `openingHours.weekday_text` is an empty array? Should render nothing, not crash.

### 5. Travel Icons (Fix 1f)
- Confirm `getTravelModeIcon` added to SavedTab and BoardSessionCard
- Confirm it matches the existing versions in SwipeableCards/CardInfoSection
- Check: `(card as any).travelMode` in SavedTab — is this safe? Could this cause issues with strict TypeScript? Is there a better way?

### 6. Cross-Cutting Concerns
- Check for TypeScript errors across all 10 files (run `npx tsc --noEmit` if possible)
- Check for any import path errors
- Check for any missing import that would cause runtime crash
- Check: did the implementor accidentally change any lines outside the spec scope?
- Check: are there any other surfaces that still show fabricated data that were missed entirely?

### 7. Spec's 27 Test Criteria
Run through all T1-T27 from the spec and verify each passes by reading the code.

## Output

Write test report to `outputs/TEST_PASS1_KILL_THE_LIES.md` with:
- Pass/fail verdict for each of the 27 test criteria
- Any NEW bugs found
- Any regressions detected
- Overall verdict: PASS / CONDITIONAL PASS / FAIL

**CRITICAL:** Do NOT include a summary paragraph about what you did. Just the test results.
