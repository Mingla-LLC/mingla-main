# Spec Prompt: Pass 1 — Kill the Lies

**Skill:** Software and Code Architect (Specer Mode)
**Date:** 2026-03-24
**Source:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md (verified)
**Scope:** 6 fixes. Remove fabricated data, fix currency, fix wrong titles, render hours, fix icons.

---

## Context

The pipeline audit found that SavedTab and BoardSessionCard show **fabricated data** — hardcoded "4.5" ratings, "15m" travel times, "$12-28" prices. Currency conversion only works on 3 of 10 price-displaying surfaces. The SavedTab shows curated card titles wrong. PracticalDetailsSection accepts opening hours but never renders them. Travel time icons are wrong.

All 6 fixes are **subtractive or wiring-only** — no new features, no schema changes, no edge functions.

---

## Fix 1a: Remove ALL Fabricated Fallbacks

**Problem:** SavedTab and BoardSessionCard hardcode fake values when real data is missing.

**Files and exact lines:**
- `SavedTab.tsx:1929` — `card.rating || "4.5"` → fake rating
- `SavedTab.tsx:1934` — `card.travelTime || "15m"` → fake travel time
- `BoardSessionCard.tsx:118` — `cardData.rating?.toFixed(1) || "4.5"` → fake rating
- `BoardSessionCard.tsx:125` — `cardData.travelTime || "12 min drive"` → fake travel time
- `BoardSessionCard.tsx:129` — `cardData.priceRange || "$12-28"` → fake price

**Fix:** Replace each fallback:
- **Rating:** If null/undefined/0 → hide the rating row entirely (don't render the star + number). Follow the pattern in `PersonHolidayView.tsx:308-314` which hides when null/0.
- **Travel time:** If null/undefined → hide the travel time row entirely. Follow `SwipeableCards.tsx:1861-1868` which skips when `'0 min'`.
- **Price:** If null/undefined → show "—" (em dash). NOT "Free" (that implies knowledge).

**Invariant:** No component shall render a hardcoded data value as if it were real data. Missing data = hidden or "—".

**Test criteria:**
1. Card with all fields populated → renders normally (no regression)
2. Card with null rating → rating row not visible
3. Card with null travelTime → travel time row not visible
4. Card with null priceRange → shows "—"

---

## Fix 1b: Fix Missing Rating Display on SwipeableCards

**Problem:** `SwipeableCards.tsx:1872` shows "0.0 ★" for cards with no rating.

**Fix:** If `rating` is null, undefined, or 0, hide the rating display entirely. Same pattern as Fix 1a.

**Test criteria:** Card with rating=null → no star/number visible on swipe card.

---

## Fix 1c: Wire Currency to 7 Missing Surfaces

**Problem:** Only SwipeableCards, SavedTab (single), and SavedTab (curated) properly convert prices. 7 other surfaces hardcode `$`.

**Current pattern (how currency works where it already works):**
- `accountPreferences` prop flows from AppStateManager → component tree
- `accountPreferences.currency` is a string like `"USD"`, `"EUR"`, `"GBP"`
- Two utility functions:
  - `formatTierLabel(slug, currencySymbol, rate)` from `constants/priceTiers.ts:70` — needs explicit symbol + rate
  - `formatCurrency(amount, currencyCode)` from `utils/formatters.ts:37` — internally calls `getRate(currencyCode)`
- `getCurrencySymbol(currency)` and `getCurrencyRate(currency)` from `services/currencyService.ts`

**Surfaces to fix (7):**

1. **CuratedExperienceSwipeCard.tsx:43-50** — hardcodes `$` in price display
   - This component is rendered inside SwipeableCards which already has `accountPreferences`
   - Thread `accountPreferences` (or just `currencyCode`) as a prop from SwipeableCards
   - Use `formatCurrency(min, currencyCode)` and `formatCurrency(max, currencyCode)`

2. **expandedCard/CardInfoSection.tsx:54-56** — `tierLabel(tier) + ' · ' + tierRangeLabel(tier)` with no currency
   - ExpandedCardModal receives card data; needs `currencyCode` threaded through
   - Use `formatTierLabel(tier, getCurrencySymbol(code), getCurrencyRate(code))`

3. **ExpandedCardModal.tsx:426-428** — curated header shows `$min-$max` raw
   - Same component, already has access to card data
   - Use `formatCurrency(min, currencyCode)` + `formatCurrency(max, currencyCode)`

4. **PersonGridCard.tsx:37** — `formatTierLabel(tier)` with no currency params
   - PersonHolidayView → HolidayRow → PersonGridCard chain
   - Thread `currencyCode` from PersonHolidayView (which gets it from DiscoverScreen)

5. **PersonCuratedCard.tsx:25-36** — raw `$min-$max`
   - Same chain as PersonGridCard
   - Use `formatCurrency()`

6. **PersonHolidayView.tsx:303-306** — `tierLabel(tier)` with no currency
   - Gets `accountPreferences` from DiscoverScreen props or needs it threaded
   - Use `formatTierLabel()` with currency params

7. **BoardSessionCard.tsx:129** — `cardData.priceRange || "$12-28"`
   - SessionViewModal → BoardSessionCard chain
   - Thread `currencyCode` from session context or `useAppStore`

**Approach:** Rather than threading `accountPreferences` through every prop chain (prop drilling), consider:
- Option A: Thread `currencyCode` as a single string prop through each chain (minimal change)
- Option B: Read directly from `useAppStore()` in each component that needs it (eliminates prop drilling but adds store dependency)
- **Recommend Option A** — matches existing pattern, minimal blast radius.

**Invariant:** Every surface that displays a price MUST use `formatTierLabel()` or `formatCurrency()` with the user's currency code. No hardcoded `$`.

**Test criteria:**
1. Set user currency to EUR → all 10 surfaces show € instead of $
2. Set user currency to GBP → all 10 surfaces show £
3. Set user currency to USD → no regression

---

## Fix 1d: SavedTab Curated Title

**Problem:** `SavedTab.tsx:1803` shows `stops.map(s => s.placeName).join(' -> ')` instead of the experience title.

**Fix:** Use `card.title` (the experience title, e.g., "Adventurous Night Out") consistently. The stop names can remain as subtitle/secondary text below the title.

**What every other surface does:** Shows `card.title` or `cardData.title` — the experience title. SavedTab is the only outlier.

**Test criteria:**
1. Save a curated card → SavedTab shows experience title (e.g., "Adventurous Night Out"), not "Restaurant A -> Bar B"
2. Stop names can optionally appear as subtitle text (but NOT as the primary title)

---

## Fix 1e: Render Opening Hours in PracticalDetailsSection

**Problem:** `PracticalDetailsSection.tsx:13-18` accepts `openingHours` in its Props interface, but `hasAnyDetails` (line 45) only checks `address || phone`. Hours are never rendered.

**Fix:**
1. Add `openingHours` to the `hasAnyDetails` check
2. Add a rendering section for opening hours (matching the address/phone pattern — icon + text)
3. Use the existing `openingHours` string. If it's a structured hours text (like "Mon-Fri 9am-9pm"), render as-is. If null → don't render.

**Test criteria:**
1. Card with openingHours data → hours displayed in expanded card practical details section
2. Card with null openingHours → section still works without hours (no crash)
3. Address and phone still render correctly (no regression)

---

## Fix 1f: Travel Mode Icon on SavedTab + BoardSessionCard

**Problem:** Both use `paper-plane` icon for travel time. SwipeableCards and CardInfoSection use `getTravelModeIcon(card.travelMode)` which shows walking/driving/transit contextually.

**Files:**
- `SavedTab.tsx:1932` — hardcoded `paper-plane`
- `BoardSessionCard.tsx:124` — hardcoded `paper-plane`

**Fix:** Import and use `getTravelModeIcon(card.travelMode || 'walking')` from the same utility SwipeableCards uses. Fall back to walking icon if travelMode is missing.

**Confirm:** Where is `getTravelModeIcon` defined? (Check SwipeableCards imports or a shared utility file.)

**Test criteria:**
1. Card saved with travelMode="driving" → SavedTab shows car icon
2. Card saved with travelMode="walking" → SavedTab shows walking icon
3. Card with no travelMode → shows walking icon (default)

---

## Files Modified (Complete List)

| File | Changes |
|------|---------|
| `SavedTab.tsx` | Remove fake fallbacks (1a), fix curated title (1d), fix travel icon (1f), already has currency (verify) |
| `BoardSessionCard.tsx` | Remove fake fallbacks (1a), fix travel icon (1f), wire currency (1c) |
| `SwipeableCards.tsx` | Hide 0.0 rating (1b), thread currencyCode to CuratedExperienceSwipeCard |
| `CuratedExperienceSwipeCard.tsx` | Wire currency (1c) |
| `expandedCard/CardInfoSection.tsx` | Wire currency (1c) |
| `ExpandedCardModal.tsx` | Wire currency to curated header (1c) |
| `PersonGridCard.tsx` | Wire currency (1c) |
| `PersonCuratedCard.tsx` | Wire currency (1c) |
| `PersonHolidayView.tsx` | Wire currency (1c), thread to children |
| `expandedCard/PracticalDetailsSection.tsx` | Render openingHours (1e) |

---

## Scope Boundaries (DO NOT)

- Do NOT change any edge function or migration
- Do NOT change the scoring algorithm or deck logic
- Do NOT change the save/schedule flow
- Do NOT refactor icon systems (that's Pass 5)
- Do NOT add new components (only modify existing)
- Do NOT change the data shape flowing from the server

---

## Output Format

Write the spec to `outputs/SPEC_PASS1_KILL_THE_LIES.md` with:
- Behavior before/after for each fix
- Exact code changes (which lines, what old code → new code)
- Edge cases
- Test criteria (the ones above, plus any you identify)

**CRITICAL:** Separate facts from inferences. Do NOT include a summary paragraph.
**CRITICAL:** For the currency threading (Fix 1c), trace the actual prop chain for each of the 7 surfaces to confirm whether `accountPreferences` is already available nearby or needs new prop drilling. Get the prop chain RIGHT — wrong threading = crashes.
