# QA REPORT — ORCH-0431 + ORCH-0432: Weekend Filter + Multi-Select Time Slots

**Date:** 2026-04-14
**Tester:** Forensic Code Audit (static analysis)
**Commits:** `64947dbc` (ORCH-0431), `a8c2b400` (ORCH-0432)

---

## Verdict: CONDITIONAL PASS

**P0: 0 | P1: 2 | P2: 0 | P3: 1 | P4: 1**

Two P1 issues found in files NOT in the implementation manifest — callers that weren't
updated when `timeSlot` was renamed to `timeSlots`. These cause query key mismatches
and TypeScript errors. Must fix before production.

---

## P1 Findings (Must Fix)

### P1-01: useAuthSimple.ts still uses `timeSlot` (singular)

**File:** `app-mobile/src/hooks/useAuthSimple.ts`
**Lines:** 137, 154

**Code:**
```typescript
// Line 137 (buildDeckQueryKey call):
timeSlot: prefs.time_slot ?? null,

// Line 154 (deckService.fetchDeck call):
timeSlot: prefs.time_slot ?? null,
```

**Problem:** Both `DeckQueryKeyParams` and `DeckParams` interfaces now have `timeSlots: string[]`
instead of `timeSlot: string | null`. This code passes a field that no longer exists in the
interface. Result:
1. TypeScript error (if strict compilation catches it at build time)
2. Query key mismatch — the prefetched key includes `timeSlot` but the actual deck hook
   builds a key with `timeSlots`. The prefetch data is never read from cache.
3. The `timeSlot` field in the request body is silently ignored by the edge function
   (it reads `timeSlots` array now)

**Fix:**
```typescript
// Line 137:
timeSlots: prefs.time_slots ?? (prefs.time_slot ? [prefs.time_slot] : []),

// Line 154:
timeSlots: prefs.time_slots ?? (prefs.time_slot ? [prefs.time_slot] : []),
```

### P1-02: OnboardingFlow.tsx still uses `timeSlot` (singular)

**File:** `app-mobile/src/components/OnboardingFlow.tsx`
**Lines:** 1688, 1705

**Code:**
```typescript
// Line 1688 (buildDeckQueryKey):
timeSlot: null,

// Line 1705 (deckService.fetchDeck):
timeSlot: null,
```

**Problem:** Same as P1-01. Onboarding prefetch builds a query key with `timeSlot: null`
but the actual deck hook builds with `timeSlots: []`. Keys don't match → prefetch wasted.
Also TypeScript interface mismatch.

**Fix:**
```typescript
// Both lines:
timeSlots: [],
```

---

## P3 Finding (Minor)

### P3-01: All date option switches clear time slots

**File:** `app-mobile/src/components/PreferencesSheet.tsx`
**Lines:** 530-543

**Behavior:** Switching from "Today" to "This Weekend" (or vice versa) clears all selected
time slots. This is not a bug — it's a reasonable design decision to prevent stale state.
But it could surprise users who select Brunch + Dinner, switch from "Today" to "This Weekend",
and find their time selections gone.

**Impact:** Minor UX friction. Not a blocker.

**Recommendation:** Keep current behavior for now. Could be improved later by only clearing
slots when switching TO "Now" (which doesn't use time slots) and preserving them for
Today ↔ Weekend ↔ Pick a Date transitions.

---

## P4 Finding (Praise)

### P4-01: Dual-write backward compatibility is solid

The implementation correctly writes both `time_slot` (first item) and `time_slots` (full array)
on every save, and reads `time_slots` first with `time_slot` fallback on load. This means:
- Legacy users who haven't re-saved see their single selection preserved
- New saves work for any future code that reads either column
- No data migration needed — it's self-healing on next save

This is clean backward-compat engineering.

---

## Static Analysis Results (All Changed Files)

### discover-cards/index.ts — PASS
- Weekend handler correctly uses `timeSlots` array with `timeSlot` fallback
- `slotsToCheck` construction handles all cases: multi-slot, single-slot, no-slot
- `TIME_SLOT_RANGES[slot]` null check prevents crash on invalid slot names
- Existing multi-slot path (lines 277-284) unmodified — no regression

### deckService.ts — PASS
- Interface correctly changed to `timeSlots?: string[]`
- Request body sends `timeSlots` (matches edge function parameter name)

### useDeckCards.ts — PASS
- Both interfaces updated: `DeckQueryKeyParams` and `UseDeckCardsParams`
- Query key uses sorted join — order-independent, correct cache behavior
- Param pass-through uses `timeSlots`

### RecommendationsContext.tsx — PASS
- Backward-compat bridge reads `time_slots` → `time_slot` fallback, correct
- Prefetch path mirrors main path exactly — query keys will match
- Collab mode passes empty array (correct — collab has its own path)

### PreferencesSheet.tsx — PASS
- State correctly changed to `TimeSlot[]`
- Toggle handler has correct anytime exclusivity logic
- All validation checks use `selectedTimeSlots.length > 0`
- Save paths dual-write both columns
- Load paths handle array-first with legacy fallback
- Change detection uses `arraysEqual` with sorting
- Dependency arrays updated consistently

### PreferencesSections.tsx — PASS
- `isSelected` uses `.includes()` — correct for multi-select
- Defensive `(selectedTimeSlots || [])` prevents crash if prop is undefined

### AppHandlers.tsx — PASS
- Dual-write in DB preferences construction
- Optimistic cache includes both `time_slot` and `time_slots`

### preferencesConverter.ts — PASS
- `time_slots` added to type signature
- "Now" normalization clears both `time_slot` and `time_slots`

### Migration — PASS
- `IF NOT EXISTS` prevents double-apply issues
- Both tables covered (preferences + board_session_preferences)
- `DEFAULT NULL` correct — doesn't force a default array on existing rows

---

## Constitutional Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| 1. No dead taps | PASS | All time slot pills respond to tap (toggle) |
| 2. One owner per truth | PASS | `time_slots` is authoritative, `time_slot` is derived |
| 3. No silent failures | PASS | No new catch blocks, no swallowed errors |
| 4. One key per entity | PASS | Query key uses sorted join of slots array |
| 5. Server state server-side | PASS | No Zustand changes |
| 6. Logout clears everything | N/A | No auth changes |
| 7. Label temporary | PASS | No transitional items |
| 8. Subtract before adding | PASS | Old `timeSlot` paths replaced, not layered |
| 9. No fabricated data | N/A | No display data changes |
| 10. Currency-aware | N/A | No currency changes |
| 11. One auth instance | N/A | No auth changes |
| 12. Validate at right time | PASS | Slots validated against `VALID_SLOTS` on load |
| 13. Exclusion consistency | PASS | "anytime" exclusivity enforced in UI AND honored by edge function |
| 14. Persisted-state startup | PASS | Cold start reads `time_slots` from DB with fallback |

---

## Blocking Issues Summary

Fix these two files before production:

1. **`app-mobile/src/hooks/useAuthSimple.ts`** lines 137, 154 — change `timeSlot` to `timeSlots`
2. **`app-mobile/src/components/OnboardingFlow.tsx`** lines 1688, 1705 — change `timeSlot` to `timeSlots`

After fixing, re-verify that onboarding prefetch query key matches the actual deck query key.

---

## Tests Requiring On-Device Verification

All tests in the orchestrator's test matrix (A-01 through D-05) require on-device testing.
The static analysis above covers code correctness; runtime behavior needs manual verification
after the P1 fixes are applied.

Priority manual tests:
1. Multi-select toggle behavior (B-01 through B-06)
2. Anytime exclusivity (B-07 through B-09)
3. Persistence round-trip (B-20 through B-23)
4. Weekend + multi-slot returns cards (B-17)
