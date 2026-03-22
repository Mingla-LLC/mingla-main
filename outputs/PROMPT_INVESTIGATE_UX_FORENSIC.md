# Investigation Prompt: UX Forensic Audit — Swipeable Deck, Saved Page, Scheduling, Paired View

**Target skill:** Software and Code Architect (Investigator mode)
**Priority:** High — multiple user-facing UX gaps
**Scope:** Beyond the known 12 bugs — find unreported issues

---

## Context

The user has reported 12 bugs across the swipeable deck, discover page, paired view, saved page, scheduling flow, and preferences. The spec prompt covers those 12. This investigation goes WIDER — examining every user-touchable surface for UX gaps, broken flows, and inconsistencies that the user hasn't caught yet.

**Do NOT re-investigate the 12 known bugs.** Focus on finding NEW issues.

---

## Areas to Audit

### A. Swipeable Deck Card Face (before expansion)

1. **Information density** — is the right information shown? Title, category, photo, rating, distance, travel time, price. Is anything missing or wrong?
2. **Swipe gestures** — left to dismiss, right to save, up to expand. Do they all work? Any dead zones?
3. **Card transitions** — smooth animations between cards? Any flicker, blank frame, or layout shift?
4. **Empty state** — what happens when deck is exhausted? Does it show a meaningful message or spinner forever?
5. **Loading state** — while cards are fetching, what does the user see? Skeleton? Spinner? Blank?
6. **Error state** — if the edge function fails, what does the user see?

### B. Expanded Card View (Single)

7. **All info fields populated** — title, photos, rating, review count, address, opening hours, description, highlights. Any NULL fields that show as blank or "undefined"?
8. **Photo gallery** — does horizontal scroll work? What if only 1 photo? What if 0 photos?
9. **Opening hours display** — correctly formatted? Current day highlighted? What if hours are null?
10. **Map / directions** — does tapping address or a map button work? Opens in-app or leaves app?
11. **Action buttons** — Save, Schedule, Share, Visit, Directions. Do they all work? Any missing for certain card types?

### C. Expanded Card View (Curated)

12. **Stop list** — are all stops shown with photos, names, categories?
13. **Travel time between stops** — shown correctly per user's travel mode? (Block 8 fix)
14. **Total duration** — accurate? Matches sum of stops + travel?
15. **Shopping list (picnic)** — rendered correctly for picnic-dates type?
16. **Flowers dismiss button** — works for romantic/first-date types?

### D. Saved Page

17. **Card display** — all saved cards shown? Photos? Titles? Categories?
18. **Remove from saved** — unsave works? Card disappears from list?
19. **Card type labels** — curated cards labeled differently from single?
20. **Stale saved cards** — if a card is deactivated after saving, what shows?
21. **Empty saved state** — no saved cards — meaningful message?

### E. Scheduling Flow (All Entry Points)

22. **From swipeable deck** — expand card → schedule → flow
23. **From saved page** — tap saved card → schedule → flow
24. **From paired view** — can you schedule from here at all?
25. **Date picker** — iOS vs Android behavior differences?
26. **Time picker** — 12h vs 24h format? Respects device settings?
27. **Calendar integration** — does scheduling create a device calendar entry?
28. **Confirmation** — after scheduling, what confirms success? Toast? Animation? Navigate away?
29. **Duplicate scheduling** — can you schedule the same card twice? What happens?

### F. Preferences Sheet

30. **All preferences persist** — change travel mode, close, reopen — is it saved?
31. **Category pill selection** — tap to select/deselect. Multi-select. Visual feedback.
32. **Budget slider** — works correctly? Updates deck immediately on close?
33. **Date option picker** — Now, Today, This Weekend, Pick a Date. All work?
34. **Time picker** — appears correctly for each date option that needs it?
35. **GPS toggle** — on/off animation. Custom location input field appears?
36. **Custom location geocoding** — validates the input? Shows suggestions? What if invalid input?

### G. Paired View

37. **No pair state** — user has no pair. What renders? CTA to pair?
38. **Pair pending state** — sent request, not yet accepted. What shows?
39. **Card interaction** — can you tap to expand? Swipe? Any gestures?
40. **Photo quality** — hero card photo loads? Correct resolution?
41. **Price display** — format consistent with swipeable deck?

### H. Cross-Cutting

42. **Accessibility** — are cards screen-reader friendly? Any missing `accessibilityLabel`?
43. **Dark mode** — if supported, do all cards render correctly?
44. **Landscape orientation** — does it break? Or is it locked to portrait?
45. **Deep links** — tapping a notification that links to a card — does it open correctly?
46. **Back navigation** — from expanded card, from schedule modal, from preferences — does back always work?

---

## Files to Search

- All components in `app-mobile/src/components/` related to: SwipeableCards, ExpandedCardModal, SavedTab, PreferencesSheet, PersonHolidayView, CuratedPlanView, ActionButtons, CardRow, HeroCard
- Scheduling: search for `schedule`, `calendar`, `DateTimePicker`, `calendarSync`
- In-app browser: search for `Linking.openURL`, `WebBrowser`, `openBrowserAsync`, `openURL`
- Category display: search for `getReadableCategoryName`, `categoryLabel`, slug-to-display conversions

---

## Output Format

Write to `outputs/INVESTIGATION_UX_FORENSIC.md` with:

1. **New bugs found** — issues NOT in the 12 known bugs, with exact file/line
2. **UX friction points** — things that technically work but feel broken or confusing
3. **Consistency violations** — where the same data looks different in different views
4. **Missing states** — loading, error, empty states that don't exist
5. **Prioritized list** — HIGH (breaks functionality), MEDIUM (confusing UX), LOW (polish)

Label everything as FACT / INFERENCE / RECOMMENDATION.
