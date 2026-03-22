# Spec Prompt: Deck & Discover Hardening

**Target skill:** Software and Code Architect (Specer mode)
**Gate:** 2 (Spec)
**Investigation:** `outputs/INVESTIGATION_DECK_AND_DISCOVER.md`

---

## Context (Verified Root Causes)

5 bugs to fix, ordered by priority:

### Fix 1: Coordinates replacing display text (#10)
- `PreferencesSheet` loads `custom_location` (coords) instead of `location` (display name) after lock-in
- User enters "London, UK", sees it validated, locks in → field shows coordinates
- LOW effort — read the correct field

### Fix 2: Currency changes with GPS location (#3/#4)
- Locale detection re-runs when location changes, re-deriving currency from GPS
- User onboarded in US → currency should always be USD regardless of current GPS
- Currency must be immutable from onboarding — stored in profile, read from profile, never from device locale or GPS
- MEDIUM effort — need to trace where currency/locale is set and make it onboarding-locked

### Fix 3: priceRange = priceLevel bug (unreported)
- `PersonHolidayView:383` maps `priceRange={c.priceLevel}` — passes the Google enum string (e.g., "PRICE_LEVEL_MODERATE") instead of a formatted price
- Paired view cards show raw enum instead of human-readable price
- LOW effort — map the enum to a readable label or use the correct field

### Fix 4: Curated cards missing Schedule button (#8)
- `ActionButtons` is inside `{!isCuratedCard}` block in the expanded modal
- `CuratedPlanView` only has Save, not Schedule
- User can't schedule curated experiences
- LOW effort — add Schedule action to the curated expanded view

### Fix 5: Repeated experiences in paired view (#5)
- Each `CardRow` section (hero, upcoming holidays, custom holidays) fetches independently with no `excludeCardIds`
- Same experience appears in multiple sections
- MEDIUM effort — pass collected card IDs as exclusion to subsequent section queries

---

## Scope

Write a bounded spec for all 5 fixes.

### Fix 1 Spec Needs:
- Which field to read (`location` vs `custom_location`) and where
- The exact component and line where the wrong field is loaded
- What the display should show after lock-in

### Fix 2 Spec Needs:
- Where the user's currency is set during onboarding
- Where it's stored (profiles table? preferences?)
- Where the locale/currency is currently re-derived from GPS (the code that needs to change)
- How to make currency read-only from profile, not GPS
- If no currency column exists in profiles, need a migration
- What about users who travel? They should see their HOME currency, not destination currency
- Where on the card is the currency symbol rendered? What component?

### Fix 3 Spec Needs:
- Exact line in PersonHolidayView
- What field should be used instead of `priceLevel` (e.g., `priceTier`, `priceRange` from the card data)
- Or: map `PRICE_LEVEL_MODERATE` → readable label

### Fix 4 Spec Needs:
- Where to add the Schedule action for curated cards
- Should it go in CuratedPlanView alongside Save? Or should ActionButtons be rendered for curated cards too?
- For curated cards with multiple stops, what does "Schedule" mean? One calendar entry for the whole experience? When does it start (first stop time)?

### Fix 5 Spec Needs:
- How are the sections currently fetched? (parallel or sequential?)
- If parallel, dedup must happen client-side after all fetches complete
- If sequential, pass `excludeCardIds` from previous sections to next
- Which section has priority? (hero > upcoming holidays > custom holidays?)
- What if a card is removed from one section — does it reappear somewhere else?

---

## Files to Read

- `app-mobile/src/components/PreferencesSheet.tsx` — custom location field (#1)
- `app-mobile/src/` — search for `locale`, `currency`, `formatPrice`, `getCurrency` (#2)
- `app-mobile/src/components/PersonHolidayView.tsx` — priceRange mapping (#3)
- `app-mobile/src/components/ExpandedCardModal.tsx` — isCuratedCard block (#4)
- `app-mobile/src/components/expandedCard/ActionButtons.tsx` — schedule action (#4)
- `app-mobile/src/components/CuratedPlanView.tsx` or similar — curated expanded actions (#4)
- Components rendering paired view sections — hero, upcoming, custom holidays (#5)
- `outputs/INVESTIGATION_DECK_AND_DISCOVER.md` — full investigation with line numbers

---

---

## ADDITIONAL BUGS (reported after initial investigation)

### Fix 6: Single card expanded — walking icon regardless of travel mode
- Same bug as Block 8 fixed for the swipeable deck card face, but the EXPANDED single card still shows walking icon
- We fixed `ExpandedCardModal.tsx:1235` to use `card.travelMode || effectiveTravelMode` — verify this is actually deployed and working for single cards too. If the bug persists, there may be a second render path or the card data doesn't have `travelMode` populated.

### Fix 7: Policies/reservation open in phone browser (leaves app)
- Buttons like "Policies" and "Reserve" open URLs in the device's default browser, taking the user out of the app
- Should ALWAYS open in an in-app browser (WebView / `expo-web-browser`)
- In-app browser should have a back button to navigate within pages
- Affects: swipeable deck expanded view, discover page, paired view hero, upcoming holidays, custom holidays
- Search for `Linking.openURL` or `window.open` in action button handlers — these should be `WebBrowser.openBrowserAsync` instead

### Fix 8: Schedule modal — date/time picker opens behind the modal
- On the Saved page, when scheduling and choosing "today", "this weekend", or "pick a date", the date/time picker opens BEHIND the schedule modal, making it invisible
- Likely a z-index or modal stacking issue — the DateTimePicker renders at a lower layer than the schedule modal

### Fix 9: Schedule from expanded card — no confirmation, abrupt
- When scheduling from the swipeable deck expanded card, there's no confirmation that the place is open or that scheduling succeeded
- It just schedules abruptly — needs a confirmation state or toast

### Fix 10: Schedule — can't use current date (shows "Cancel" not "Done")
- When scheduling from expanded card modal, the current date shows "Cancel" instead of "Done"
- User must pick a DIFFERENT date first, then it shows "Done"
- Likely the DateTimePicker's `onChange` doesn't fire when the already-selected date is confirmed

### Fix 11: Saved page — slug instead of display name
- Single experiences on the saved page show `fine_dining` instead of "Fine Dining"
- The `getReadableCategoryName()` function exists but isn't being called for this view
- Or the saved card data stores the slug and the component doesn't convert it

### Fix 12: Curated + category mix — round-robin broken
- When user selects both curated and category pills, either curated overwhelms or category cards don't appear
- The round-robin interleaver may not handle the curated/single mix correctly
- Or: curated cards are returned in the same query as singles and dominate due to higher counts

---

## Constraints

- No edge function changes unless currency conversion requires server-side work
- No schema changes unless currency column is missing
- Currency must be immutable from onboarding — never re-derived from GPS/device locale
- Dedup must not cause cards to disappear entirely — if excluded from one section, it should still appear in its primary section
- Policies/reservation links must NEVER open the phone's default browser — always in-app browser
- All category display names must use `getReadableCategoryName()` or equivalent — never raw slugs

---

## ADDITIONAL BUGS (batch 3 — reported after spec started)

### Fix 13: Schools appearing in cards
- A sport school appeared under Romantic in Creative & Arts
- Schools, academies, training centers should NEVER appear in a dating app
- Need TWO things:
  - Add school types to global exclusions in `category_type_exclusions` table: `school`, `primary_school`, `secondary_school`, `university`, `educational_institution`, `training_center`
  - Add school keywords to `isChildVenueName()` (or a new `isExcludedVenueName()`): "school", "academy", "institute", "training center", "learning center", "university", "college"
- This needs a migration (INSERT into category_type_exclusions) + code change (keyword list)

### Fix 14: Flowers category too broad
- Flowers category surfaces department stores, garden centers, and other retail that happens to sell flowers
- Should surface ONLY florist-type places
- Check `seedingCategories.ts` for the `flowers` category's `includedPrimaryTypes` — it may include types beyond `florist`
- Also check `category_type_exclusions` for the `flowers` category — it should exclude ALL retail types, department stores, garden centers, etc.
- The investigation should verify: what types does the `flowers` category currently include? What types should it include (just `florist`)?

### Fix 15: Curated stop descriptions + picnic dates empty
Two sub-issues:
- **AI stop descriptions**: Curated card stops should have AI-generated descriptions explaining each stop, the rationale for choosing it, and whether it's optional. Check if `generate-curated-experiences` generates these (it uses OpenAI). If they exist in the stops JSONB but aren't rendered, it's a mobile display gap. If they're not generated, it's a generation gap.
- **Picnic dates empty**: When user selects picnic dates curated type, zero cards appear. This could be: (a) no picnic-dates curated cards in card_pool for this area, (b) generation failed for picnic-dates type, (c) the picnic reverse-anchor can't find the right category combo (groceries + flowers + picnic_park). Check card_pool for `experience_type = 'picnic-dates'` in the user's area.

---

## Output Format

Write to `outputs/SPEC_DECK_HARDENING.md` with:

For each fix (all 12):
1. Exact code changes (file, line, before/after)
2. Edge cases
3. Test criteria

Plus:
- Implementation order
- Files changed summary
- Whether any migration is needed
