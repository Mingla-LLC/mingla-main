# Investigation Prompt: Pass 2a — Currency + Pricing (3 fixes)

**Target skill:** Software and Code Architect (Investigator mode)
**Gate:** 1 (Audit)
**Pass:** 2a
**Bugs:** P2-01, P2-02, P2-03

---

## 3 Bugs to Investigate

### P2-01: Currency changes with GPS location
**What we think:** When the user changes their GPS location (e.g., from Raleigh to London), card prices switch currency (USD → GBP). Currency should be locked from onboarding — the user selected a country during onboarding, and prices should always display in that country's currency regardless of current GPS.
**Investigate:**
- Where is the user's currency/locale determined? Search for `currency`, `locale`, `Intl.NumberFormat`, `formatPrice`, `formatCurrency` in `app-mobile/src/`
- Is there a `currency` field in `profiles` or `user_preferences` tables?
- During onboarding, does the user select a country? Is a currency saved?
- Where does the price formatting happen on cards? What component renders "$15" or "£12"?
- Is the currency symbol derived from device locale, GPS location, or a stored preference?
- What needs to change: lock currency from profile, not from device/GPS

### P2-02: priceRange = priceLevel (Google enum on paired view cards)
**Reported location:** `PersonHolidayView.tsx:383`
**What we think:** Maps `priceRange={c.priceLevel}` — passes the raw Google enum string (e.g., "PRICE_LEVEL_MODERATE") instead of a formatted price or tier label.
**Investigate:**
- Read line 383 of PersonHolidayView.tsx. What's the exact code?
- What does `c.priceLevel` contain? The Google Places `priceLevel` enum? A number?
- What should `priceRange` be? A formatted string like "$15-$25"? A tier label like "Comfy"?
- Where do other views (swipeable deck, saved page) get their price display from? What field do they use?
- Is there a `priceTier` field that should be used instead?

### P2-03: Slug on saved page (fine_dining instead of Fine Dining)
**Reported location:** `SavedTab.tsx`
**What we think:** The saved page shows raw category slugs instead of display names. `getReadableCategoryName()` exists but isn't being called.
**Investigate:**
- Find where the category is rendered on saved cards in SavedTab.tsx
- What field is it reading? `card.category`? `card.categories[0]`?
- Is `getReadableCategoryName()` called? If not, where should it be added?
- Check other views — does the swipeable deck correctly convert slugs? What pattern does it use?

---

## For Each Bug

1. Read the exact file and lines
2. Confirm the bug exists as described
3. Trace the full data chain (where the value originates, how it flows, where it's rendered)
4. Identify the exact fix
5. Note edge cases

---

## Output Format

Write to `outputs/INVESTIGATION_PASS2A.md` with per-bug:
- CONFIRMED or NOT FOUND
- Exact current code
- Full data chain trace
- Exact fix
- Edge cases
- Files/lines to change
