# INVESTIGATION: ORCH-0431 — Weekend + TimeSlot Returns Empty Deck

**Date:** 2026-04-14
**Severity:** S1-high
**Surface:** Deck / Discover (Solo mode)
**Confidence:** HIGH — every file read, every branch traced, six-field evidence complete

---

## Symptom

User selects Fine Dining + "This Weekend" + brunch in PreferencesSheet. Backend finds 26
matching Fine Dining places in the pool but serves 0 cards. User sees an empty deck.

**Expected:** 26 cards (or some subset filtered by brunch hours on Saturday/Sunday)
**Actual:** 0 cards, empty deck, no user-facing explanation

---

## Investigation Manifest

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `supabase/functions/discover-cards/index.ts` | 44-49 | TIME_SLOT_RANGES definition |
| 2 | `supabase/functions/discover-cards/index.ts` | 139-355 | `filterByDateTime()` — the core filtering function |
| 3 | `supabase/functions/discover-cards/index.ts` | 449-482 | Request body parsing + timeSlot resolution |
| 4 | `supabase/functions/discover-cards/index.ts` | 585-601 | Where filterByDateTime is called in the pipeline |
| 5 | `app-mobile/src/components/PreferencesSheet.tsx` | 131-149 | DATE_OPTION_TO_KEBAB / KEBAB_TO_DATE_OPTION maps |
| 6 | `app-mobile/src/components/PreferencesSheet.tsx` | 840-864 | Save path — what gets written to DB |
| 7 | `app-mobile/src/utils/preferencesConverter.ts` | 122-156 | `normalizePreferencesForSave()` — clears `datetime_pref` for weekend |
| 8 | `app-mobile/src/contexts/RecommendationsContext.tsx` | 459-490 | Reads DB prefs, passes to useDeckCards |
| 9 | `app-mobile/src/hooks/useDeckCards.ts` | 45-66, 117-130 | Query key builder + params pass-through |
| 10 | `app-mobile/src/services/deckService.ts` | 275-291 | Edge function invocation with dateOption/timeSlot |

Every file was read directly. No sub-agent findings relied upon without verification.

---

## Findings

### Finding 1 — ROOT CAUSE

**Classification:** RED — Root Cause

| Field | Detail |
|-------|--------|
| **File + line** | `supabase/functions/discover-cards/index.ts` lines 139-355 |
| **Exact code** | The entire `filterByDateTime()` function. No branch handles `dateOption === "weekend"` or `dateOption === "this-weekend"`. |
| **What it does** | When `dateOption` is not `"now"` and `datetimePref` is undefined, falls through to line 293-298 which computes `targetDay` from current server time (Monday = day 1). Then checks if places are open on Monday at 9 AM (brunch start). |
| **What it should do** | When `dateOption` is `"weekend"` or `"this-weekend"`, compute `targetDay` as the next Saturday (6) and/or Sunday (0), then check if places are open on those days at the time slot's start hour. |
| **Causal chain** | User picks "This Weekend" + brunch → DB stores `date_option: "weekend"` (or "this-weekend"), `time_slot: "brunch"`, `datetime_pref: null` → RecommendationsContext passes `dateOption: "weekend"`, `datetimePref: undefined`, `timeSlot: "brunch"` to edge function → `filterByDateTime()` hits no early return → falls to default filter (line 275) → `datetimePref` is falsy so line 293-298 runs → `targetDay = Monday (1)` from server clock → `targetHourStart = 9` from brunch slot → checks all 26 places for Monday 9 AM hours → fine dining closed Monday mornings → all 26 filtered out → 0 cards |
| **Verification step** | 1) Search `filterByDateTime` for the string "weekend" — zero results. 2) Run the same preferences on a Saturday — cards will appear because the fallback accidentally checks the correct day. 3) Add `console.log(targetDay)` at line 299 — will show `1` (Monday) instead of `6` (Saturday). |

### Exact control flow trace with user's inputs

```
Inputs:
  dateOption = "weekend"
  datetimePref = undefined
  timeSlot = "brunch"
  timeSlots = ["brunch"]

Line 147: timeSlots.includes('anytime') → false                    → SKIP
Line 149: timeSlot === 'anytime' → false                           → SKIP
Line 155: dateOption === 'now' → false                              → SKIP
          !datetimePref && !timeSlot → true && false → false        → SKIP
Line 253: timeSlots.length > 1 → false                             → SKIP
Line 275: DEFAULT FILTER (the fallback)
Line 285: if (datetimePref) → if (undefined) → false               → ELSE
Line 293-298: targetDay = server's current UTC day (Monday = 1)     ← BUG
Line 301-302: targetHourStart = TIME_SLOT_RANGES['brunch'].start = 9
Line 317-326: Check if place open on day 1 (Monday) at hour 9      ← WRONG DAY
Result: 0/26 pass (fine dining closed Monday 9 AM)
```

### Finding 2 — CONTRIBUTING FACTOR

**Classification:** ORANGE — Contributing Factor

| Field | Detail |
|-------|--------|
| **File + line** | `app-mobile/src/utils/preferencesConverter.ts` line 142-144 |
| **Exact code** | `} else if (dateOpt === 'weekend' ...) { normalized.datetime_pref = null; }` |
| **What it does** | Correctly clears `datetime_pref` for weekend option, since the user hasn't picked a specific date. |
| **Why it contributes** | If `datetime_pref` were set to the next Saturday's ISO string, the edge function's line 285-292 would extract the correct `targetDay`. The converter is correct per its own logic, but its design assumption (that the edge function handles weekend as a concept) is violated. |

This is NOT a bug in the converter — it's doing the right thing. But it means the edge
function receives no date hint at all for weekend, making the missing handler more impactful.

### Finding 3 — HIDDEN FLAW

**Classification:** YELLOW — Hidden Flaw

**`dateOption = "today"` with `timeSlot` may also be subtly wrong.**

When `dateOption = "today"` and `datetimePref` is null (which `normalizePreferencesForSave`
line 140-141 enforces for "today"), the same fallback at line 293-298 runs. It computes
`targetDay` from server UTC time. If the server is in a different timezone than the user,
and the UTC date differs from the user's local date (e.g., user is at 11 PM local = next
day UTC), the wrong day's hours get checked.

This is a minor issue since "today" usually aligns, but it's the same structural problem:
the code uses server time when it should use the user's local time/date.

### Finding 4 — OBSERVATION

**Classification:** BLUE — Observation

The user's DB stores `date_option` as `"weekend"` (legacy format), not `"this-weekend"`
(current kebab format). This is likely from a session saved before the kebab normalization
was added, or the save path at line 849-850 produced `"weekend"` for some input path.

The KEBAB_TO_DATE_OPTION map (line 147) handles this for loading back into the UI:
`'weekend': 'This Weekend'`. But the value sent to the edge function is the raw DB value
`"weekend"` — not normalized to `"this-weekend"`.

This doesn't affect the bug (neither value is handled), but it means any fix must handle
BOTH `"weekend"` AND `"this-weekend"` as dateOption values.

---

## Five-Layer Cross-Check

| Layer | Status | Evidence |
|-------|--------|----------|
| **Docs** | N/A | No product spec defines expected weekend filtering behavior |
| **Schema** | PASS | `query_pool_cards` returns 26 Fine Dining places correctly. Price tier filter works (NULL passes through). No date filtering at SQL level. |
| **Code** | BUG | `filterByDateTime()` has zero lines of code handling `dateOption === "weekend"` or `"this-weekend"`. The word "weekend" does not appear anywhere in the function. |
| **Runtime** | CONFIRMS | Logs show `fromPool: 26, totalServed: 0`. All 26 cards eliminated by JS filter layer. |
| **Data** | PASS | 26 Fine Dining places exist in pool near user's location with valid opening hours data |

**Contradiction:** The UI offers "This Weekend" as a first-class date option. The converter
correctly normalizes it. The context correctly passes it. The edge function silently
ignores it and filters against the wrong day.

---

## Blast Radius

### Directly affected
- **Every category** when user selects "This Weekend" + any time slot (brunch/afternoon/dinner/lateNight) on a weekday (Mon-Fri)
- Both `"weekend"` and `"this-weekend"` DB values
- Solo mode only (collab forces `dateOption = "now"` at line 466)

### Not affected
- "This Weekend" + "anytime" (early return at line 149 skips all filtering)
- "Now" (has its own dedicated handler at line 155)
- "Pick a Date" with a `datetime_pref` (line 285-292 correctly extracts day from the ISO date)
- Collab mode (always uses `dateOption = "now"`)

### Accidentally works
- Using the app on Saturday or Sunday — the fallback computes `targetDay` from server time,
  which happens to be the correct weekend day

### Scale
- Any user in any city who picks "This Weekend" + a time slot on a weekday gets an empty
  or severely reduced deck. This is 5 out of 7 days per week.

---

## Invariant Violations

- **No silent failures (Constitutional Rule 3):** Empty deck with zero feedback to user
- **Validate at the right time (Constitutional Rule 12):** Edge function accepts "weekend"
  without handling it — should either process it or return an error

---

## Fix Direction (for spec/implementor)

Add a dedicated branch in `filterByDateTime()` for weekend date options:

1. Before the default filter (line 275), add: if `dateOption` is `"weekend"` or
   `"this-weekend"`, compute `targetDay` as both Saturday (6) and Sunday (0)
2. A place passes if it's open on EITHER Saturday OR Sunday at the time slot's start hour
3. Use the existing `isOpenDuringHour()` helper (line 214) — it already handles all three
   hours data formats
4. Handle both `"weekend"` and `"this-weekend"` values (and `"this weekend"` for safety)

The fix is ~15 lines of code in a single function in a single file. No client changes
needed. No database changes needed.

### Secondary fix (hidden flaw)
Consider whether `dateOption = "today"` needs the same treatment when `datetimePref` is null.
Currently it falls through to server-time day computation, which could be wrong across
timezone boundaries at midnight. Lower priority since the window of wrongness is narrow.

---

## Regression Prevention

- Add a comment block at the top of `filterByDateTime` listing ALL valid `dateOption` values
  and which code path handles each one
- Consider a switch/case structure instead of cascading if/else to make missing handlers
  obvious
- The `dateOption` parameter should ideally be a union type, not `string`, so TypeScript
  catches unhandled values at compile time

---

## Finding 5 — HIDDEN FLAW (UI)

**Classification:** YELLOW — Hidden Flaw

**Time slot buttons don't show hour ranges — user has no idea what "Brunch" means.**

The `TIME_SLOT_KEYS` array in `PreferencesSections.tsx` (line 247-252) defines a `timeKey`
for each slot (e.g., `"time_slots.brunch_time"` → "11–1"). The i18n keys exist in all
locales. But the render code (lines 338-361) **never uses `slot.timeKey`**. Only the label
and icon are displayed.

This means:
- User sees "Brunch" with a cafe icon, but no hours
- User sees "Late Night" with a moon icon, but doesn't know if that means 9 PM or midnight
- The data and translations are ALREADY DONE — the render just doesn't show them

**Fix:** Add one `<Text>` line below the label in the time slot pill to show
`t(\`preferences:${slot.timeKey}\`)`. Needs a new style `timeSlotPillTime` for the
subtitle (smaller, lighter color).

### Additional note: TIME_SLOT_RANGES mismatch

The edge function's `TIME_SLOT_RANGES` (line 44-49) defines:
- brunch: 9–13 (filter starts at 9 AM)
- The UI i18n says: "11–1" (suggests 11 AM – 1 PM)

The filter intentionally starts earlier (9 AM) to catch restaurants that open for brunch
prep/seating before 11. This is defensible but creates a perception mismatch: user thinks
"11–1" but the system filters from 9 AM. Not a bug per se, but worth being aware of.

---

## Discoveries for Orchestrator

1. **Legacy `date_option` values in DB:** Some users have `"weekend"` instead of
   `"this-weekend"`. Not a bug (the UI handles both), but the edge function fix must
   handle both.
2. **"today" timezone edge case:** Minor hidden flaw (Finding 3). Not urgent but worth
   tracking.
3. **No empty-deck UX:** When filters eliminate all cards, the user sees an empty deck
   with no explanation. This is a separate UX issue worth registering.
4. **Time slot hour subtitle:** i18n keys and data exist but are unused in rendering.
   Zero-cost UX improvement — just render them.
