# Test Report: Fix Discover Exclusions, Paired Dedup, Shuffle Performance

**Date:** 2026-03-24
**Spec:** `outputs/FIX_DISCOVER_EXCLUSIONS_DEDUP_SHUFFLE_SPEC.md`
**Implementation:** `outputs/IMPLEMENTATION_FIX_DISCOVER_EXCLUSIONS_DEDUP_SHUFFLE_REPORT.md`
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

RC-001 (SQL impression dedup) and RC-003 (shuffle parallelization) are correctly implemented — solid, spec-compliant work. RC-002 (discover-experiences exclusion filter) has a **critical defect**: the `card_pool` table does not have a `types` column, so the type-based exclusion filter is dead code. Only the `isChildVenueName()` name heuristic actually filters anything. The spec itself contained this error (assumed `types` existed on `card_pool`), and the implementor faithfully executed a broken spec.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| SQL Migration (RC-001) | 8 | 8 | 0 | 0 |
| Edge Function: discover-experiences (RC-002) | 6 | 2 | 1 | 3 |
| Edge Function: get-person-hero-cards (RC-003) | 7 | 7 | 0 | 0 |
| Pattern Compliance | 4 | 4 | 0 | 0 |
| Security | 3 | 3 | 0 | 0 |
| Cross-Domain Impact | 2 | 2 | 0 | 0 |
| README Accuracy | 3 | 2 | 1 | 0 |
| Spec Compliance | 6 | 5 | 1 | 0 |
| **TOTAL** | **39** | **33** | **3** | **3** |

---

## 🔴 Critical Findings (Must Fix Before Merge)

### CRIT-001: `card_pool` Has No `types` Column — Type-Based Exclusion Filter Is Dead Code

**File:** `supabase/functions/discover-experiences/index.ts` (lines 369-373)
**Category:** Data / Feature Correctness

**What's Wrong:**

The exclusion filter reads `card.types || []` to check against `GLOBAL_EXCLUDED_PLACE_TYPES` and `category_type_exclusions`. But `card_pool` has **no `types` column** — that column exists only on `place_pool`. The SELECT at line 331 does not include `types` (and can't, since the column doesn't exist on the table). Therefore:

- `card.types` → always `undefined`
- `card.types || []` → always `[]`
- `cardTypes.some(...)` → always `false`
- **Zero cards are ever filtered by type. The filter is a no-op.**

Only `isChildVenueName(card.title)` (line 367) actually works.

**Evidence:**

1. `card_pool` schema (migration `20260301000002_card_pool_pipeline.sql` lines 88-138): columns are `id, card_type, place_pool_id, google_place_id, title, category, categories, description, highlights, image_url, images, address, lat, lng, rating, review_count, price_min, price_max, opening_hours, base_match_score, popularity_score, is_active, served_count, last_served_at, created_at, updated_at`. **No `types` column.**

2. `place_pool` schema (same migration, line 31): `types TEXT[] NOT NULL DEFAULT '{}'`. **`types` lives here, not on `card_pool`.**

3. The working exclusion check in `query_pool_cards` RPC (migration `20260321110000`) does it correctly — it **JOINs** `card_pool` with `place_pool` to access `pp.types`:
```sql
NOT EXISTS (
  SELECT 1 FROM public.place_pool pp,
               public.category_type_exclusions cte
  WHERE pp.id = cp.place_pool_id
    AND cte.category_slug = ANY(v_slug_categories)
    AND cte.excluded_type = ANY(pp.types)
)
```

4. `discover-experiences` does NOT join with `place_pool` — it queries `card_pool` alone.

**Required Fix:**

Option A (recommended — minimal change): Join `place_pool` to get `types` for the filter. After the per-category pool card fetch, do a single query to get `place_pool.types` for all cards using their `place_pool_id`:

```typescript
// After allPoolCards is populated (after line 346)
if (allPoolCards.length > 0) {
  const placePoolIds = [...new Set(allPoolCards.map((c: any) => c.place_pool_id).filter(Boolean))];
  const { data: placePoolRows } = await adminClient!
    .from('place_pool')
    .select('id, types')
    .in('id', placePoolIds);

  const typesMap = new Map<string, string[]>();
  for (const row of (placePoolRows ?? [])) {
    typesMap.set(row.id, row.types || []);
  }

  // Enrich allPoolCards with types from place_pool
  for (const card of allPoolCards) {
    card.types = typesMap.get(card.place_pool_id) || [];
  }
}
```

Then the existing exclusion filter code works as-is.

**NOTE:** The SELECT at line 331 must also include `place_pool_id` (currently missing) for this join to work. Add it to the select string.

Option B (alternative — add `types` to card_pool schema): Create a migration adding `types TEXT[] DEFAULT '{}'` to `card_pool` and backfill from `place_pool`. Heavier change, but eliminates the join at serve time.

**Why This Matters:**

This is the entire point of RC-002. Without this fix, gyms, schools, dog parks, and other excluded venue types still appear in the "For You" tab — the exact symptom the spec was written to fix.

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: `place_pool_id` Not in SELECT — Can't Join Even If Fix Applied

**File:** `supabase/functions/discover-experiences/index.ts` (line 331)
**Category:** Missing Data

**What's Wrong:**

The `.select()` clause at line 331 does not include `place_pool_id`. Even if CRIT-001's fix is applied, the join to `place_pool` would fail because the FK is not fetched.

**Evidence:**

```typescript
.select('id, google_place_id, title, category, image_url, images, rating, review_count, price_min, price_max, price_tier, lat, lng, opening_hours, address, website, description, highlights, base_match_score, popularity_score')
// ← place_pool_id is missing
```

**Required Fix:**

Add `place_pool_id` to the select:
```typescript
.select('id, place_pool_id, google_place_id, title, category, image_url, images, rating, review_count, price_min, price_max, price_tier, lat, lng, opening_hours, address, website, description, highlights, base_match_score, popularity_score')
```

**Why This Matters:**

Prerequisite for CRIT-001's fix. Without the FK, can't look up `place_pool.types`.

---

### HIGH-002: README Claims Type-Based Filtering Works When It Doesn't

**File:** `README.md` (line 258)
**Category:** Documentation Accuracy

**What's Wrong:**

The README states: *"Post-fetch filter removes cards whose `types` array intersects with `category_type_exclusions` table or `GLOBAL_EXCLUDED_PLACE_TYPES`."*

This is false — the type-based filter is a no-op (CRIT-001). Only the `isChildVenueName()` heuristic works.

**Required Fix:**

After CRIT-001 is fixed, the README entry becomes accurate. Until then, it's misleading. Update after the fix is deployed.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: Exclusion Query Fetches by Display Name Instead of Slug

**File:** `supabase/functions/discover-experiences/index.ts` (line 353)
**Category:** Logic / Correctness Risk

**What's Wrong:**

```typescript
.in('category_slug', categoriesToFetch.map(c => toSlug(c)));
```

`categoriesToFetch` contains display names (e.g., "Fine Dining") which are then converted with `toSlug()`. This is correct now, but fragile — if `categoriesToFetch` ever contains slugs directly, the double-conversion through `toSlug()` could cause issues. The code works today because:

1. `ALL_CATEGORY_NAMES` contains display names
2. `toSlug()` correctly maps display → slug

This is a **warning** not a failure — the code works, but the indirection is worth noting.

### MED-002: Spec Bug Propagated — Spec §8.1 Assumed `types` on `card_pool`

**Category:** Process

The spec itself at §8.1 includes code reading `card.types || []` without noting that `types` doesn't exist on `card_pool`. The implementor correctly followed the spec verbatim. This is not the implementor's fault — it's a spec defect. Future specs should verify column existence on the target table before writing filter logic.

### MED-003: `DISCOVER_EXCLUDED_PLACE_TYPES` (Broader Set) Not Used

**File:** `supabase/functions/discover-experiences/index.ts` (line 363)
**Category:** Completeness

**What's There:**

The code uses `GLOBAL_EXCLUDED_PLACE_TYPES` (gyms, schools, dog parks — 12 types).

**What Exists:**

`categoryPlaceTypes.ts` exports `DISCOVER_EXCLUDED_PLACE_TYPES` — a superset that adds gas stations, ATMs, banks, hospitals, funeral homes, car repair, etc. (~30+ types). This set was specifically designed for "discovery/browse contexts."

**The spec chose `GLOBAL_EXCLUDED_PLACE_TYPES`**, so the implementation is spec-compliant. But `DISCOVER_EXCLUDED_PLACE_TYPES` may be more appropriate for the "For You" tab. This is a product decision, not a bug.

---

## ✅ What Passed

### Things Done Right

1. **RC-001 SQL migration is flawless.** All 5 NOT EXISTS clauses correctly use `(pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)`. The SQL matches the spec verbatim. Covering indexes are well-designed — partial index on `paired_user_id` with `WHERE paired_user_id IS NOT NULL` avoids bloat from NULL rows.

2. **RC-003 parallelization is clean.** 7 queries in a single `Promise.all`, correct destructuring, `!isShuffleMode` guard on the multi-dimension block prevents double-fetch. Category prefs fetched unconditionally (cheap) but only used if swipes ≥ 10 — smart trade-off.

3. **Migration is idempotent.** `CREATE OR REPLACE FUNCTION` + `CREATE INDEX IF NOT EXISTS` + `DROP INDEX IF EXISTS`. Safe to run multiple times.

4. **No mobile files touched.** Correct per spec §9.

5. **`isChildVenueName()` filter works.** This part of the exclusion filter is correctly wired — `card.title` IS in the SELECT, and `isChildVenueName()` correctly checks against the keyword list.

6. **Error handling preserved.** All try/catch blocks and console.warn patterns match adjacent code. No silent catches introduced.

7. **Impression recording unchanged.** Write-side logic (lines 691-714) correctly routes to `person_id` or `paired_user_id` based on `usingPairedUser`. The fix is read-side only, as the spec required.

### Static Analysis Results

| Check | Result |
|-------|--------|
| TypeScript `any` usage | Pre-existing `any` in edge functions (Deno convention) — no new violations |
| `as unknown as` casts | None |
| `@ts-ignore` / `@ts-nocheck` | None |
| Import ordering | Matches existing patterns ✅ |
| CORS headers | Present on all response paths ✅ |
| Auth verification | Present ✅ |
| Deno import versions | Pinned `@0.168.0` ✅ |
| Environment variables | `Deno.env.get()` ✅ |
| SQL injection | Parameterized (RPC params) ✅ |
| RLS considerations | Migration uses `CREATE OR REPLACE FUNCTION` in `public` schema — RPC callable by authenticated users only via Supabase client ✅ |

---

## Spec Compliance Matrix

| # | Success Criterion (from Spec §5) | Tested? | Passed? | Evidence |
|---|----------------------------------|---------|---------|----------|
| 1 | No duplicate cards across holiday sections | ✅ | ✅ | All 5 NOT EXISTS clauses check both columns — verified in migration file |
| 2 | Reshuffle doesn't introduce cross-section duplicates | ✅ | ✅ | `!isShuffleMode` guard prevents double-fetch; impression recording uses correct column |
| 3 | discover-experiences returns zero excluded-type cards | ✅ | 🔴 | **FAILS** — `card_pool` has no `types` column. Filter is dead code. Only name heuristic works. |
| 4 | Shuffle < 1s | ✅ | ✅ | 7 queries parallelized into 1 round trip vs 3+ sequential. Index covers NOT EXISTS. |
| 5 | All 5 NOT EXISTS clauses check both columns | ✅ | ✅ | Verified: lines 94, 109, 125, 143, 173 of migration — all use OR |
| 6 | README updated | ✅ | 🟡 | Updated but line 258 claims type filtering works — misleading until CRIT-001 fixed |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "All 5 clauses use OR on person_id/paired_user_id" | ✅ | ✅ | Confirmed in migration file — 5 NOT EXISTS, all with OR |
| "Covering indexes created" | ✅ | ✅ | `idx_person_card_impressions_person_card` + partial `idx_person_card_impressions_paired_card` |
| "Post-fetch filter using category_type_exclusions + GLOBAL_EXCLUDED_PLACE_TYPES + isChildVenueName()" | ✅ | 🔴 | Code exists but type-based checks are dead code (no `types` column on `card_pool`) |
| "7 queries in single Promise.all" | ✅ | ✅ | Lines 366-426 — correct |
| "Multi-dimension block skipped for shuffle mode" | ✅ | ✅ | Line 510: `&& !isShuffleMode` guard added |
| "No mobile files touched" | ✅ | ✅ | git status confirms no app-mobile changes |
| "SQL is verbatim from spec §7.2" | ✅ | ✅ | Migration matches spec exactly |

---

## Constitutional Compliance

| Constitution Principle | Status | Notes |
|----------------------|--------|-------|
| No dead taps (primary interaction) | ✅ | Shuffle parallelization reduces latency |
| No silent catches | ✅ | All catches log warnings |
| React Query key factories | N/A | No mobile changes |
| `useMutation` error handlers | N/A | No mobile changes |
| No duplicate ownership | ✅ | Impression writes unchanged |
| Transitional items labeled | N/A | No transitional items |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)

1. **CRIT-001:** `card_pool` has no `types` column. The type-based exclusion filter in `discover-experiences` is dead code. Fix by joining `place_pool` to get types (see fix instructions above). Also add `place_pool_id` to the SELECT (HIGH-001).

### After CRIT-001 Fix

2. **HIGH-002:** README line 258 becomes accurate once the filter actually works. No action needed if CRIT-001 is fixed before merge.

### Product Decision (Not a Bug)

3. **MED-003:** Consider using `DISCOVER_EXCLUDED_PLACE_TYPES` instead of `GLOBAL_EXCLUDED_PLACE_TYPES` for the For You tab — it's a broader set designed for browse/discovery contexts. This is a product call, not a code defect.

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — RC-001 and RC-003 are solid, well-implemented fixes. The SQL migration is flawless and the shuffle parallelization is clean. However, RC-002's type-based exclusion is non-functional due to a missing column — this is a spec bug that propagated to implementation. The `isChildVenueName()` heuristic works, providing partial protection. The fix is straightforward (one additional query to `place_pool` + add `place_pool_id` to SELECT). After CRIT-001 is resolved, this is a clean **PASS**. No re-test needed if the fix is limited to the prescribed changes — the rest of the implementation is trustworthy.
