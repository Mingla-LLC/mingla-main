# Feature: Nature Card Schedule-First Flow with Opening Hours Validation

**Date:** 2026-03-01
**Status:** Planned
**Requested by:** "Schedule and save button for nature cards should always ask for date/time, check if open, move to calendar if open, ask for different time if closed. Must always get opening hours data for all nature cards."

## Summary

Nature cards currently have a broken opening hours pipeline — the data IS fetched from Google Places API and returned by the `discover-nature` edge function, but the `natureToRecommendation` mapper discards the `weekday_text` array and only passes `open_now`. This means the availability check in `ActionButtons` always falls through to "assume open." Additionally, the bookmark/save button saves Nature cards without prompting for a date/time, bypassing the scheduling flow entirely.

This feature fixes the opening hours data pipeline so availability checks work for Nature cards, and makes the save button redirect to the scheduling flow (date/time picker → availability check → calendar) for Nature-category cards specifically.

## User Story

As a user browsing Nature cards, I want the save/schedule button to always ask me for a date and time, validate that the place is open at that time, and schedule it to my calendar — so I never show up to a closed nature spot.

## Problem Breakdown

### Problem 1: Opening Hours Data Not Flowing Through

| Layer | What Happens | Status |
|-------|-------------|--------|
| Google Places API | `regularOpeningHours` requested via field mask | Working |
| `discover-nature` edge function | `parseOpeningHours()` extracts `Record<string, string>` + `isOpenNow` | Working |
| Edge function response | Returns `openingHours: { monday: "9:00 AM – 5:00 PM", ... }` | Working |
| `NatureCard` interface | `openingHours: Record<string, string>` | Working |
| **`natureToRecommendation()`** | **Only passes `{ open_now: isOpenNow }`, discards weekday data** | **BROKEN** |
| `Recommendation.openingHours` | Gets `{ open_now: true }` with NO `weekday_text` | Incomplete |
| `ActionButtons.checkPlaceAvailability()` | Falls through to "assume open" because no `weekday_text` | Broken |

### Problem 2: Save Button Doesn't Prompt for Date/Time

The bookmark button calls `handleSave()` which just saves to `saved_card` table without asking for a date/time. For Nature cards, the user wants save to always go through the scheduling flow.

## Architecture Impact

- **Modified files:**
  - `app-mobile/src/contexts/RecommendationsContext.tsx` — fix `natureToRecommendation()` mapping
  - `app-mobile/src/components/expandedCard/ActionButtons.tsx` — redirect save to schedule for Nature cards

- **No new files needed**
- **No new DB tables/columns needed**
- **No new edge functions needed**
- **No external API changes needed** — data is already being fetched

## Detailed Changes

### Change 1: Fix `natureToRecommendation()` Opening Hours Mapping

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx`
**Function:** `natureToRecommendation()` (line ~204)

**Current (broken):**
```typescript
openingHours: card.isOpenNow != null
  ? { open_now: card.isOpenNow }
  : null,
```

**Fixed:**
```typescript
openingHours: Object.keys(card.openingHours).length > 0
  ? {
      open_now: card.isOpenNow,
      weekday_text: Object.entries(card.openingHours).map(
        ([day, hours]) =>
          `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
      ),
    }
  : card.isOpenNow != null
    ? { open_now: card.isOpenNow }
    : null,
```

**Why this works:**
- The `discover-nature` edge function's `parseOpeningHours()` returns keys like `"monday"`, `"tuesday"`, etc.
- ActionButtons' `checkPlaceAvailability()` expects `weekday_text` entries like `"Monday: 9:00 AM – 5:00 PM"`
- This conversion capitalizes the day name and formats it to match what ActionButtons expects
- Falls back to `open_now`-only when no structured hours exist (many outdoor parks won't have them)

### Change 2: Redirect Save Button to Schedule Flow for Nature Cards

**File:** `app-mobile/src/components/expandedCard/ActionButtons.tsx`
**Function:** `handleSave()` (line ~339)

**Current:**
```typescript
const handleSave = async () => {
  if (isSaving) return;
  setIsSaving(true);
  try {
    await onSave(card);
  } catch (error: any) {
    Alert.alert("Error", "Failed to save the card. Please try again.");
  } finally {
    setIsSaving(false);
  }
};
```

**Updated:**
```typescript
const handleSave = async () => {
  // For Nature cards, redirect to the scheduling flow instead of just saving
  if (card.category === "Nature") {
    handleSchedule();
    return;
  }

  if (isSaving) return;
  setIsSaving(true);
  try {
    await onSave(card);
  } catch (error: any) {
    Alert.alert("Error", "Failed to save the card. Please try again.");
  } finally {
    setIsSaving(false);
  }
};
```

**Why:** The user explicitly wants both the "Schedule and Save" button and the bookmark/save button to trigger the date/time picker for Nature cards. The scheduling flow already handles saving to `calendar_entries` and adding to the device calendar.

### Change 3: Update Save Button Label for Nature Cards (Optional UX Enhancement)

**File:** `app-mobile/src/components/expandedCard/ActionButtons.tsx`
**Section:** Save/bookmark button render (line ~778)

Update the bookmark button tooltip or visual to indicate it will schedule for Nature cards. Since the current UI uses just an icon (bookmark), this is a minor visual change — the icon could change to a calendar icon for Nature cards:

```typescript
<Ionicons
  name={
    isSaved
      ? "bookmark"
      : card.category === "Nature"
        ? "calendar-outline"
        : "bookmark-outline"
  }
  size={18}
  color={isSaved ? "#eb7825" : "#6b7280"}
/>
```

## Edge Cases & Graceful Handling

### Places Without Opening Hours Data

Many nature places (parks, trails, beaches, hiking areas) don't have structured opening hours in Google Places API. The system already handles this:

1. `checkPlaceAvailability()` returns `{ isOpen: true, isAssumption: true, reason: "Opening hours data not available" }` when no `weekday_text` exists
2. The scheduling proceeds normally — user picks a date/time and the card is scheduled
3. A subtle warning could be shown: "Opening hours not available — schedule at your own discretion" (currently shows nothing for assumptions)

### Places Marked as "Open 24 hours"

The existing `checkPlaceAvailability()` already handles `"Open 24 hours"` strings in `weekday_text` and returns `{ isOpen: true, isAssumption: false }`.

### Places Marked as "Closed" on a Specific Day

Already handled — returns `{ isOpen: false, isAssumption: false }` and the user gets the "Choose Another Time" alert.

## React Query Impact

- **No new query keys**
- **No invalidation changes**
- The `natureCards` query already fetches opening hours data — it just wasn't being passed through

## Test Cases

1. **Nature card with opening hours data** — Tap save button → date/time picker appears → select a time when place is open → card moves to "Locked In" calendar tab + added to phone calendar
2. **Nature card with opening hours, select closed time** — Tap schedule → select date/time when place is closed → "Place Closed" alert → "Choose Another Time" → select open time → schedules successfully
3. **Nature card without opening hours (park/trail)** — Tap save → date/time picker appears → select any time → schedules successfully (assumption: open)
4. **Non-Nature card save button unchanged** — Tap bookmark on a Casual Eats card → saves normally without date/time picker (existing behavior preserved)
5. **Opening hours display** — Expand a Nature card with hours data → opening hours section shows correctly in ActionButtons with today highlighted
6. **Already scheduled Nature card** — Both schedule and save buttons show disabled "Scheduled" state

## Success Criteria

- [ ] Nature cards show opening hours in the expanded card's ActionButtons section
- [ ] Tapping save (bookmark) on a Nature card triggers the date/time picker, not a plain save
- [ ] Selecting a time when the place is closed shows the "Place Closed" alert with re-selection option
- [ ] Selecting a time when the place is open schedules the card to the calendar tab AND device calendar
- [ ] Nature cards without opening hours data still schedule successfully (graceful fallback)
- [ ] Non-Nature cards are unaffected — save button works as before
