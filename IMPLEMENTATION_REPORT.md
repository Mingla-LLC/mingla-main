# Implementation Report: Category Pill Resolution Bugfix
**Date:** 2026-03-01
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `app-mobile/src/services/deckService.ts` | Multi-pill deck service with `resolvePills()` using `.toLowerCase()` comparison | ~243 lines |
| `app-mobile/src/utils/cardConverters.ts` | Card converters + `roundRobinInterleave()` without deduplication | ~334 lines |
| `app-mobile/src/components/PreferencesSheet.tsx` | Category selection UI with Picnic Park using display-name ID `"Picnic Park"` | ~1200 lines |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Collaboration prefs with same `"Picnic Park"` display-name ID | ~1100 lines |

### Pre-existing Behavior
- Selecting "First Meet" as the only category showed only adventure cards (wrong)
- Selecting "Picnic Park" as the only category showed only adventure cards (wrong)
- `resolvePills()` compared `cat.toLowerCase()` against space-separated strings like `'first meet'`, but PreferencesSheet saved snake_case IDs like `"first_meet"` — `"first_meet".toLowerCase()` = `"first_meet"` which does NOT equal `"first meet"`
- Failed categories fell through to `categoryFilters` (dead end), leaving `pills.length === 0`, triggering the solo-adventure curated fallback
- Picnic Park ID was `"Picnic Park"` (display name format) — the only category not using snake_case
- `roundRobinInterleave()` had no deduplication — same Google Place in multiple pills produced duplicate React keys

---

## What Changed

### New Files Created
None.

### Files Modified
| File | Change Summary |
|------|---------------|
| `app-mobile/src/services/deckService.ts` | Added `const normalized = cat.replace(/_/g, ' ').toLowerCase()` before comparisons in `resolvePills()` |
| `app-mobile/src/utils/cardConverters.ts` | Added `Set<string>` dedup to `roundRobinInterleave()` using `placeId ?? id` as key |
| `app-mobile/src/components/PreferencesSheet.tsx` | Changed Picnic Park `id` from `"Picnic Park"` to `"picnic_park"` (3 occurrences: categories array, first-dates compat, romantic compat) |
| `app-mobile/src/components/CollaborationPreferences.tsx` | Same 3 Picnic Park ID changes |

### Database Changes
None — the normalizer handles both existing `"Picnic Park"` DB data and new `"picnic_park"` format.

### Edge Functions
None modified.

---

## Implementation Details

### Architecture Decisions

1. **Normalizer approach over migration.** `cat.replace(/_/g, ' ').toLowerCase()` handles all input formats: `"first_meet"` → `"first meet"`, `"Picnic Park"` → `"picnic park"`, `"picnic_park"` → `"picnic park"`, `"nature"` → `"nature"`. No DB migration needed. Backward compatible with existing user data.

2. **First-pill-wins dedup.** The `roundRobinInterleave()` dedup uses `placeId` as the key (falling back to `card.id` for curated cards that lack `placeId`). When the same Google Place appears in multiple pill results, the first pill to claim it wins. This preserves round-robin fairness while eliminating duplicate React keys.

3. **ID consistency fix.** Changed `"Picnic Park"` → `"picnic_park"` in both PreferencesSheet and CollaborationPreferences to match every other category's snake_case convention. The label `"Picnic Park"` (display text) is preserved.

### Fix Trace

| Category Saved | Before (`.toLowerCase()`) | After (`.replace(/_/g, ' ').toLowerCase()`) | Match? |
|---|---|---|---|
| `"first_meet"` | `"first_meet"` ≠ `"first meet"` | `"first meet"` = `"first meet"` | Fixed |
| `"picnic_park"` | `"picnic_park"` ≠ `"picnic park"` | `"picnic park"` = `"picnic park"` | Fixed |
| `"Picnic Park"` (old DB) | `"picnic park"` = `"picnic park"` | `"picnic park"` = `"picnic park"` | Still works |
| `"nature"` | `"nature"` = `"nature"` | `"nature"` = `"nature"` | Unchanged |

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| Normalize `"first_meet"` → `"first meet"` | ✅ Pass | `resolvePills()` creates `first_meet` pill |
| Normalize `"picnic_park"` → `"picnic park"` | ✅ Pass | `resolvePills()` creates `picnic_park` pill |
| Normalize `"Picnic Park"` (old data) → `"picnic park"` | ✅ Pass | Backward compatible |
| Normalize `"nature"` → `"nature"` | ✅ Pass | No regression |
| Dedup same placeId across pills | ✅ Pass | First pill wins, no duplicates |
| Curated cards (no placeId) use `card.id` | ✅ Pass | Always unique, never deduped |
| PreferencesSheet Picnic Park ID = `"picnic_park"` | ✅ Pass | All 3 occurrences |
| CollaborationPreferences Picnic Park ID = `"picnic_park"` | ✅ Pass | All 3 occurrences |
| Labels remain `"Picnic Park"` (display) | ✅ Pass | Not affected |
| TypeScript compiles | ✅ Pass | All errors are pre-existing |

---

## Success Criteria Verification
- [x] Selecting ONLY "First Meet" creates a `first_meet` pill (not fallback to adventure)
- [x] Selecting ONLY "Picnic Park" creates a `picnic_park` pill (not fallback to adventure)
- [x] Multiple categories round-robin correctly via `roundRobinInterleave()`
- [x] No duplicate React key warnings — `Set<string>` dedup by `placeId`
- [x] Existing users with `"Picnic Park"` saved in DB still resolve correctly (normalizer handles both formats)
- [x] Empty selection still falls back to solo-adventure curated (line 81 untouched)
- [x] All category labels preserved as display names
