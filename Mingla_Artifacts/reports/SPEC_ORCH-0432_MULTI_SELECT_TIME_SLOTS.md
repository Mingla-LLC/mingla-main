# SPEC: ORCH-0432 — Multi-Select Time Slots in Solo Mode

**Date:** 2026-04-14
**Depends on:** ORCH-0431 (weekend filter — shipped)
**Confidence:** HIGH — every file in the chain read and verified

---

## Scope

Allow users to select multiple time slots in PreferencesSheet (e.g., Brunch + Afternoon)
to widen the time window for card filtering. The backend already supports multi-slot
filtering via the `timeSlots` array path in discover-cards.

## Non-Goals

- Redesigning the time slot UI (pills stay, just become multi-select)
- Changing the edge function's core multi-slot UNION logic (lines 265-283, already works)
- Collab mode changes (already supports multi-slot via a different path)
- Adding new time slots or changing time ranges

## Assumptions

- The `timeSlots` array parameter in discover-cards works correctly for non-weekend
  dateOptions (verified — collab mode uses it)
- Existing users with a single `time_slot` in DB will continue working without re-saving

---

## Layer 1: Database

### Migration: `supabase/migrations/YYYYMMDDHHMMSS_add_time_slots_array.sql`

```sql
-- ORCH-0432: Add time_slots array column to support multi-select
-- Keep time_slot (TEXT) for backward compatibility — read from time_slots first,
-- fall back to time_slot for users who haven't re-saved.

ALTER TABLE public.preferences
ADD COLUMN IF NOT EXISTS time_slots TEXT[] DEFAULT NULL;

ALTER TABLE public.board_session_preferences
ADD COLUMN IF NOT EXISTS time_slots TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.preferences.time_slots
IS 'Selected time slots array: ["brunch","afternoon","dinner","lateNight"]. Supersedes time_slot (single TEXT). NULL = no preference.';

COMMENT ON COLUMN public.board_session_preferences.time_slots
IS 'Selected time slots array for collab sessions. Supersedes time_slot (single TEXT).';
```

**Rules:**
- `time_slots` is the new authoritative column
- `time_slot` (singular) is kept for backward compat — never deleted
- When saving: always write BOTH `time_slots` (array) AND `time_slot` (first item or null)
- When loading: read `time_slots` first; if null/empty, fall back to `time_slot` wrapped
  in `[time_slot]`

No RLS changes needed — both tables already have RLS policies that don't reference
specific columns. The new column inherits existing row-level policies.

---

## Layer 2: Edge Function — Weekend Handler Update

**File:** `supabase/functions/discover-cards/index.ts`
**Lines:** 253-263 (ORCH-0431 weekend handler)

### Current code (broken for multi-slot)

```typescript
if (dOpt === 'weekend' || dOpt === 'this weekend') {
  const hourStart = (timeSlot && TIME_SLOT_RANGES[timeSlot])
    ? TIME_SLOT_RANGES[timeSlot].start
    : 12;
  return places.filter(place =>
    isOpenDuringHour(place, 6, hourStart) || isOpenDuringHour(place, 0, hourStart),
  );
}
```

**Problem:** When `timeSlots` has >1 entry, `timeSlot` is `null` (line 492-494).
The weekend handler defaults to hour 12 and ignores all selected slots.

### Required change

Replace with multi-slot-aware version:

```typescript
if (dOpt === 'weekend' || dOpt === 'this weekend') {
  // Resolve which slots to check: use resolvedTimeSlots array if available,
  // else fall back to single timeSlot, else default noon
  const slotsToCheck = (timeSlots && timeSlots.length > 0)
    ? timeSlots
    : (timeSlot ? [timeSlot] : []);

  if (slotsToCheck.length === 0) {
    // No slots specified — check noon on either weekend day
    return places.filter(place =>
      isOpenDuringHour(place, 6, 12) || isOpenDuringHour(place, 0, 12),
    );
  }

  return places.filter(place =>
    slotsToCheck.some(slot => {
      const range = TIME_SLOT_RANGES[slot];
      if (!range) return false;
      return isOpenDuringHour(place, 6, range.start)
          || isOpenDuringHour(place, 0, range.start);
    }),
  );
}
```

**Logic:** Place passes if it's open on Saturday OR Sunday during ANY of the selected
time slot windows. This is the UNION of (weekend days) x (selected slots).

### No other edge function changes needed

The existing multi-slot path (lines 265-283) already handles `timeSlots` arrays for
non-weekend dateOptions. The request body parsing (lines 484-494) already accepts
`timeSlots` as an array. No changes there.

---

## Layer 3: Service — DeckParams

**File:** `app-mobile/src/services/deckService.ts`

### DeckParams interface (line 23-39)

Change:
```typescript
timeSlot?: string | null;
```

To:
```typescript
timeSlots?: string[];
```

### fetchDeck request body (line 275-291)

Change:
```typescript
timeSlot: params.timeSlot,
```

To:
```typescript
timeSlots: params.timeSlots,
```

The edge function already accepts `timeSlots` as a request body field (line 470).
When receiving a single-item array like `["brunch"]`, the edge function resolves it
to `resolvedTimeSlots = ["brunch"]` and sets `timeSlot = "brunch"` (line 492-494).
Full backward compatibility — no special casing needed.

---

## Layer 4: Hook — useDeckCards

**File:** `app-mobile/src/hooks/useDeckCards.ts`

### DeckQueryKeyParams (line 30-43)

Change:
```typescript
timeSlot?: string | null;
```

To:
```typescript
timeSlots?: string[];
```

### buildDeckQueryKey (line 45-69)

Change line 66:
```typescript
params.timeSlot ?? '',
```

To:
```typescript
[...(params.timeSlots ?? [])].sort().join(','),
```

This ensures different slot selections produce different cache keys, and order doesn't
matter (`["brunch","dinner"]` and `["dinner","brunch"]` produce the same key).

### UseDeckCardsParams (line 72-88)

Change:
```typescript
timeSlot?: string | null;
```

To:
```typescript
timeSlots?: string[];
```

### Hook body — params pass-through

Everywhere `timeSlot: params.timeSlot` appears, change to `timeSlots: params.timeSlots`.

---

## Layer 5: Context — RecommendationsContext

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx`

### Reading from preferences (line 467)

Change:
```typescript
const effectiveTimeSlot = isCollaborationMode ? null : (userPrefs?.time_slot ?? null);
```

To:
```typescript
const effectiveTimeSlots: string[] = isCollaborationMode
  ? []
  : (userPrefs?.time_slots && userPrefs.time_slots.length > 0)
    ? userPrefs.time_slots
    : userPrefs?.time_slot
      ? [userPrefs.time_slot]
      : [];
```

This is the **backward-compat bridge**: reads `time_slots` (array) first, falls back to
`time_slot` (string) wrapped in an array.

### Passing to useDeckCards (line 490)

Change:
```typescript
timeSlot: effectiveTimeSlot,
```

To:
```typescript
timeSlots: effectiveTimeSlots,
```

### Prefetch path (lines 727, 766)

Same change — replace `timeSlot` with `timeSlots` using the same fallback logic.

---

## Layer 6: Component — PreferencesSheet

**File:** `app-mobile/src/components/PreferencesSheet.tsx`

### State (line 199)

Change:
```typescript
const [selectedTimeSlot, setSelectedTimeSlot] = useState<TimeSlot | null>(null);
```

To:
```typescript
const [selectedTimeSlots, setSelectedTimeSlots] = useState<TimeSlot[]>([]);
```

### Toggle handler (new)

Add a toggle handler that enforces anytime exclusivity:

```typescript
const handleTimeSlotToggle = useCallback((slotId: TimeSlot) => {
  setSelectedTimeSlots(prev => {
    if (slotId === 'anytime') {
      // Anytime is exclusive — selecting it clears all others
      return prev.includes('anytime') ? [] : ['anytime'];
    }
    // Selecting a specific slot deselects anytime
    const withoutAnytime = prev.filter(s => s !== 'anytime');
    if (withoutAnytime.includes(slotId)) {
      // Deselect
      return withoutAnytime.filter(s => s !== slotId);
    }
    // Select
    return [...withoutAnytime, slotId];
  });
}, []);
```

### Form completeness (lines 668-672)

Change:
```typescript
hasDateTime = !!selectedTimeSlot;
```

To:
```typescript
hasDateTime = selectedTimeSlots.length > 0;
```

Same for line 671:
```typescript
hasDateTime = !!selectedDate && selectedTimeSlots.length > 0;
```

### CTA hint text (lines 682, 688)

Change `!selectedTimeSlot` to `selectedTimeSlots.length === 0`.

### Change detection (line 642)

Change:
```typescript
if (selectedTimeSlot !== initialPreferences.selectedTimeSlot) return true;
```

To:
```typescript
if (!arraysEqual([...selectedTimeSlots].sort(), [...(initialPreferences.selectedTimeSlots || [])].sort())) return true;
```

### Count changes (line 720)

Same pattern — use `arraysEqual` with sorted arrays.

### Save path — solo mode (line 776, line 793)

Change:
```typescript
time_slot: selectedTimeSlot || null,
```

To:
```typescript
time_slot: selectedTimeSlots.length > 0 ? selectedTimeSlots[0] : null,
time_slots: selectedTimeSlots.length > 0 ? selectedTimeSlots : null,
```

Write BOTH columns. `time_slot` gets the first item (backward compat for any code
reading the old column). `time_slots` gets the full array.

### Save path — collab mode (lines 846-847)

Same dual-write:
```typescript
time_of_day: selectedTimeSlots.length > 0 ? selectedTimeSlots[0] : null,
time_slot: selectedTimeSlots.length > 0 ? selectedTimeSlots[0] : null,
time_slots: selectedTimeSlots.length > 0 ? selectedTimeSlots : null,
```

### Preferences object for onSave (line 793)

Change:
```typescript
selectedTimeSlot: normalized.time_slot || selectedTimeSlot,
```

To:
```typescript
selectedTimeSlots: selectedTimeSlots,
```

### Load path — collab (lines 304-310)

Change:
```typescript
const loadedTimeSlot = prefs.time_slot || prefs.time_of_day;
if (loadedTimeSlot) {
  if (["brunch", "afternoon", "dinner", "lateNight", "anytime"].includes(loadedTimeSlot)) {
    setSelectedTimeSlot(loadedTimeSlot as TimeSlot);
  }
}
```

To:
```typescript
// Load time_slots (array) first, fall back to time_slot (string)
const VALID_SLOTS = ["brunch", "afternoon", "dinner", "lateNight", "anytime"];
if (prefs.time_slots && Array.isArray(prefs.time_slots) && prefs.time_slots.length > 0) {
  setSelectedTimeSlots(prefs.time_slots.filter((s: string) => VALID_SLOTS.includes(s)) as TimeSlot[]);
} else {
  const legacySlot = prefs.time_slot || prefs.time_of_day;
  if (legacySlot && VALID_SLOTS.includes(legacySlot)) {
    setSelectedTimeSlots([legacySlot as TimeSlot]);
  }
}
```

### initialPreferences (line 352)

Change:
```typescript
selectedTimeSlot: loadedTimeSlot || null,
```

To:
```typescript
selectedTimeSlots: /* the loaded array from above */,
```

### Mixpanel tracking (line 884)

Change:
```typescript
timeSlot: selectedTimeSlot ?? null,
```

To:
```typescript
timeSlots: selectedTimeSlots,
```

### useCallback dependencies (line 908)

Replace `selectedTimeSlot` with `selectedTimeSlots` in the dependency array.

### Prop to DateTimeSection (line 1009)

Change:
```typescript
selectedTimeSlot={selectedTimeSlot}
```

To:
```typescript
selectedTimeSlots={selectedTimeSlots}
onTimeSlotSelect={handleTimeSlotToggle}
```

---

## Layer 6b: Component — PreferencesSections (DateTimeSection)

**File:** `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx`

### Props

Change `selectedTimeSlot` prop to `selectedTimeSlots: string[]`.

### isSelected check (line 337)

Change:
```typescript
const isSelected = selectedTimeSlot === slot.id;
```

To:
```typescript
const isSelected = selectedTimeSlots.includes(slot.id);
```

### onPress handler (line 341)

No change needed — `onTimeSlotSelect(slot.id)` already calls the parent handler.
The parent's `handleTimeSlotToggle` handles the toggle logic.

---

## Layer 7: AppHandlers — Solo Save to DB

**File:** `app-mobile/src/components/AppHandlers.tsx`

### dbPreferences construction (line 494)

Change:
```typescript
time_slot: preferences.selectedTimeSlot || null,
```

To:
```typescript
time_slot: preferences.selectedTimeSlots?.length > 0
  ? preferences.selectedTimeSlots[0]
  : null,
time_slots: preferences.selectedTimeSlots?.length > 0
  ? preferences.selectedTimeSlots
  : null,
```

### Optimistic cache update (line 523)

Add `time_slots` to the cache object:
```typescript
time_slot: dbPreferences.time_slot,
time_slots: dbPreferences.time_slots,
```

---

## Layer 8: preferencesConverter — normalizePreferencesForSave

**File:** `app-mobile/src/utils/preferencesConverter.ts`

### Type signature (line 122-131)

Add:
```typescript
time_slots?: string[] | null;
```

### "Now" normalization (line 136-139)

Add:
```typescript
normalized.time_slots = null;
```

alongside the existing `normalized.time_slot = null`.

No other changes — the function's purpose is to clear conflicting fields, not to
validate slot values.

---

## Success Criteria

| ID | Criterion | How to Verify |
|----|-----------|---------------|
| SC-1 | User can select multiple time slots (e.g., Brunch + Dinner) | Tap Brunch, tap Dinner — both highlight. Tap Brunch again — only Dinner remains. |
| SC-2 | "Anytime" is mutually exclusive | Select Brunch + Afternoon, then tap Anytime — only Anytime highlighted. Tap Brunch — Anytime deselects, Brunch highlights. |
| SC-3 | Brunch + Afternoon returns places open during either window | Select Today + Brunch + Afternoon. Deck contains places open 9-13 AND places open 12-17. |
| SC-4 | Preferences persist across app restart | Select Brunch + Dinner, close app, reopen. Preferences sheet shows Brunch + Dinner selected. |
| SC-5 | Legacy single time_slot users preserved | User with `time_slot: "dinner"` and no `time_slots` column loads correctly as `["dinner"]`. |
| SC-6 | Weekend + multi-slot works | Select This Weekend + Brunch + Dinner. Cards include places open Sat/Sun at brunch OR dinner hours. |
| SC-7 | Cache invalidates on slot change | Select Brunch → cards load. Add Afternoon → new fetch (different query key). |
| SC-8 | Collab mode unaffected | Create collab session, set time slots — existing behavior unchanged. |
| SC-9 | Empty selection blocked | With "Today" selected and zero time slots, Apply button is disabled. |

---

## Invariants

| Invariant | How Preserved |
|-----------|---------------|
| One owner per truth | `time_slots` array is the new authoritative source. `time_slot` is kept for backward compat only, always derived from first array element. |
| No silent failures | If `time_slots` is empty/null AND `time_slot` is null, the deck returns all cards (no time filtering). This is equivalent to "anytime". |
| Query key uniqueness | Sorted slots joined with comma in query key. Different selections = different keys. |
| Persisted-state startup | Cold start reads `time_slots` from DB (or falls back to `time_slot`). No undefined behavior. |

---

## Test Cases

| Test | Scenario | Input | Expected |
|------|----------|-------|----------|
| T-01 | Single select (backward compat) | Select only Brunch | DB: `time_slots: ["brunch"]`, `time_slot: "brunch"`. Edge function filters for brunch only. |
| T-02 | Multi select | Select Brunch + Dinner | DB: `time_slots: ["brunch","dinner"]`, `time_slot: "brunch"`. Edge function shows places open during either. |
| T-03 | Anytime exclusive | Select Brunch, then Anytime | `selectedTimeSlots = ["anytime"]`. Previous slots cleared. |
| T-04 | Deselect anytime | Have Anytime, tap Brunch | `selectedTimeSlots = ["brunch"]`. Anytime removed. |
| T-05 | Deselect all | Have Brunch selected, tap Brunch | `selectedTimeSlots = []`. Apply button disabled (for Today/Weekend). |
| T-06 | Legacy load | DB has `time_slot: "dinner"`, no `time_slots` | Loads as `selectedTimeSlots = ["dinner"]`. |
| T-07 | Weekend + multi | Weekend + Brunch + Afternoon | Edge function checks: open Sat/Sun at 9 OR open Sat/Sun at 12. |
| T-08 | Cache key differs | Brunch vs Brunch+Dinner | Two different query keys → two separate cache entries. |
| T-09 | Collab no regression | Collab with existing time_slots logic | No change in behavior. |

---

## Implementation Order

1. **Database migration** — add `time_slots TEXT[]` to both tables
2. **Edge function** — update weekend handler for multi-slot awareness
3. **deckService.ts** — change DeckParams from `timeSlot` to `timeSlots`
4. **useDeckCards.ts** — update types, query key, param pass-through
5. **RecommendationsContext.tsx** — read `time_slots`/`time_slot` with fallback, pass array
6. **preferencesConverter.ts** — add `time_slots` to normalization
7. **PreferencesSheet.tsx** — state, toggle handler, save/load, validation, change detection
8. **PreferencesSections.tsx** — multi-select rendering
9. **AppHandlers.tsx** — dual-write `time_slot` + `time_slots` to DB

---

## Regression Surface

- Deck card loading (different cards for different slot combos)
- Preference persistence (round-trip save/load)
- Collab mode preference aggregation
- Weekend filtering (ORCH-0431)
- "Now" mode (should ignore time slots — verify anytime early return still works)
- Cold start from persisted cache key

---

## Discoveries for Orchestrator

None — this is a clean feature addition on top of existing multi-slot infrastructure.
