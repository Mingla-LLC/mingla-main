# Implementation Report: Fix Discover Exclusions, Paired Dedup, Shuffle Performance

**Date:** 2026-03-24
**Spec:** `outputs/FIX_DISCOVER_EXCLUSIONS_DEDUP_SHUFFLE_SPEC.md`
**Mode:** Spec Execute

---

## 1. What Was There Before

### RC-001 (Critical): Paired User Impression Dedup Broken
- `query_person_hero_cards` RPC checked `pci.person_id = p_person_id` in 5 NOT EXISTS clauses
- Paired user impressions are stored in `paired_user_id` column, NOT `person_id`
- `NULL = UUID` evaluates to NULL (falsy) → impressions never found → dedup completely broken for paired users
- All holiday sections received identical cards from backend

### RC-002 (High): discover-experiences Bypassed Exclusions
- `discover-experiences/index.ts` queried `card_pool` directly with no check against `category_type_exclusions`
- Cards with excluded types (gym, school, dog_park, etc.) served in "For You" tab
- `discover-cards` had the check (via `query_pool_cards` RPC), creating inconsistency

### RC-003 (Medium): Shuffle Performance — Sequential Queries
- Shuffle mode ran swipe count → category prefs → multi-dimension prefs sequentially
- 3+ round trips before the main RPC call
- Index on `person_card_impressions` was `(user_id, person_id)` — no `card_pool_id` for index-only scan

---

## 2. What Changed

### Files Created
| File | Purpose |
|------|---------|
| `supabase/migrations/20260324100000_fix_paired_impression_dedup_and_indexes.sql` | Fixed RPC + covering indexes |

### Files Modified
| File | Change |
|------|--------|
| `supabase/functions/discover-experiences/index.ts` | Added import of `GLOBAL_EXCLUDED_PLACE_TYPES` + `isChildVenueName`; added post-fetch exclusion filter after pool card fetch |
| `supabase/functions/get-person-hero-cards/index.ts` | Replaced sequential shuffle queries with single `Promise.all` (7 parallel queries); added `!isShuffleMode` guard to multi-dimension block |
| `README.md` | Updated paired view dedup entry (line 238), updated slug fix entry (line 257), added discover-experiences exclusion entry |

---

## 3. Spec Compliance

| Spec Section | Status | Notes |
|-------------|--------|-------|
| §7.2 — Fixed RPC (5 NOT EXISTS with OR) | DONE | All 5 clauses use `(pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)` |
| §7.3 — Covering indexes | DONE | `idx_person_card_impressions_person_card` + `idx_person_card_impressions_paired_card` (partial, WHERE paired_user_id IS NOT NULL) |
| §8.1 — discover-experiences exclusion filter | DONE | Post-fetch filter using `category_type_exclusions` + `GLOBAL_EXCLUDED_PLACE_TYPES` + `isChildVenueName()` |
| §8.2 — Shuffle parallelization | DONE | 7 queries in single Promise.all; multi-dimension block skipped for shuffle mode |
| §9 — No mobile changes | DONE | No mobile files touched |
| §11 Step 4 — README update | DONE | 3 entries updated/added |

---

## 4. Implementation Details

### SQL Migration
- `CREATE OR REPLACE FUNCTION` — non-destructive, replaces existing function
- `DROP INDEX IF EXISTS idx_person_card_impressions_lookup` — removes old insufficient index
- Two new indexes: one for `person_id` path, one partial for `paired_user_id` path
- Both include `card_pool_id` for index-only scan in NOT EXISTS

### discover-experiences Exclusion Filter
- Single query to `category_type_exclusions` for all categories in the batch
- Builds `Map<category_slug, Set<excluded_type>>` for O(1) lookup
- Applies `GLOBAL_EXCLUDED_PLACE_TYPES` globally (not per-category)
- Applies `isChildVenueName()` name heuristic
- Logs count diff when cards are filtered
- Filter runs BEFORE impression dedup and per-category selection

### Shuffle Parallelization
- Merged 3 sequential blocks into 1 `Promise.all` with 7 queries
- Swipe count + category prefs fetched unconditionally; category prefs only USED if swipes >= 10
- Price tier from both users (paired + viewer) merged via Set
- Distance pref applied to radius config
- Multi-dimension block gets `!isShuffleMode` guard to prevent double-fetch

---

## 5. Deviations from Spec

1. **Spec §8.2 omitted time-of-day prefs for viewer user** — The spec's Promise.all included `timePrefs1` (paired) and `timePrefs2` (viewer). I kept both, matching the spec. The original code only fetched paired user's time prefs. This is an improvement, not a deviation.

2. **No other deviations.** SQL is verbatim from spec §7.2.

---

## 6. Verification Checklist

| # | Success Criterion (§5) | Status |
|---|----------------------|--------|
| 1 | No duplicate cards across holiday sections | Ready for E2E test |
| 2 | Reshuffle doesn't introduce cross-section duplicates | Ready for E2E test |
| 3 | discover-experiences returns zero excluded-type cards | Ready for E2E test |
| 4 | Shuffle < 1s | Ready for perf test |
| 5 | All 5 NOT EXISTS clauses check both columns | VERIFIED in migration file |
| 6 | README updated | DONE |

---

## 7. Test Cases (§12)

| # | Test | Status |
|---|------|--------|
| 1 | Paired view initial load — no duplicates | Pending deploy |
| 2 | Shuffle — no cross-section duplicates | Pending deploy |
| 3 | Impression-based rotation | Pending deploy |
| 4 | Excluded type not in discover-experiences | Pending deploy |
| 5 | Child venue name not in discover-experiences | Pending deploy |
| 6 | Shuffle < 1s | Pending deploy |
| 7 | Legacy person_id path still works | Pending deploy |
| 8 | New paired_user_id path works | Pending deploy |

---

## 8. Files Inventory

```
Created:
  supabase/migrations/20260324100000_fix_paired_impression_dedup_and_indexes.sql

Modified:
  supabase/functions/discover-experiences/index.ts
  supabase/functions/get-person-hero-cards/index.ts
  README.md
```

---

## 9. Handoff to Tester

All three root causes addressed:
- **RC-001** (Critical): SQL impression dedup now checks both `person_id` and `paired_user_id` via OR
- **RC-002** (High): discover-experiences post-fetch filter enforces exclusions
- **RC-003** (Medium): Shuffle queries parallelized (7 queries in 1 round trip vs 3+ sequential)

Deploy order: migration first → discover-experiences → get-person-hero-cards.
Ready to break.
