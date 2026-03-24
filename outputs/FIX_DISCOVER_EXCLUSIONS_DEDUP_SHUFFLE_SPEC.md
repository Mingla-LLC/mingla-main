# Fix: Discover Exclusions Gap, Paired Card Duplication, and Shuffle Performance

**Date:** 2026-03-24
**Status:** Planned
**Mode:** Investigation + Fix
**Reported symptoms:**
1. Discover experiences may show excluded venue types (gyms, schools, etc.) that never appear in discover cards
2. Same cards repeat across birthday, custom holiday, and upcoming holiday sections in paired person view
3. Shuffle button takes 1-3 seconds to show new cards

---

## 1. Forensic Context

### What Was Reported

Three separate issues observed in the mobile app:
- Venues that should be excluded (kids' venues, gyms, farmers markets) may appear in the "For You" tab but not in category swipe cards
- Opening a paired person's view shows identical date idea cards in multiple holiday sections
- Pressing the shuffle button has a noticeable 1-3 second delay before new cards appear

### Investigation Summary

**Truth layers inspected:** Docs ✅ Schema ✅ Code ✅ Runtime ✅ Data ✅
**Files read:** 22
**Root cause(s):** 3 root causes, 1 critical (impression column mismatch), 1 high (missing exclusion check), 1 medium (sequential queries)
**Contributing factors:** 3
**Hidden flaws found:** 2

### Root Cause Analysis

#### 🔴 RC-001: RPC Impression Check Uses Wrong Column for Paired Users

**Fact:** `supabase/migrations/20260323000004_fix_person_hero_cards_slug_and_dedup.sql` line 79 checks `pci.person_id = p_person_id` in the NOT EXISTS clause.

**Fact:** `supabase/functions/get-person-hero-cards/index.ts` line 563 passes `effectivePersonId` (which equals `pairedUserId` for paired users, line 187) as `p_person_id`.

**Fact:** `supabase/functions/get-person-hero-cards/index.ts` lines 623-625: when `usingPairedUser` is true, impressions are stored in the `paired_user_id` column, NOT the `person_id` column. The `person_id` column is NULL for these rows.

**Inference:** The RPC's NOT EXISTS check compares `pci.person_id = p_person_id`, but the impression row has `person_id = NULL` and `paired_user_id = <the UUID>`. Since `NULL = <UUID>` evaluates to NULL (falsy in SQL), the NOT EXISTS check **always passes** — it never finds matching impressions. The RPC returns cards as if no impressions exist.

**Impact:** Impression-based dedup is **completely broken** for all paired users. Every query to `query_person_hero_cards` ignores all previously served cards. All holiday sections (birthday, custom, upcoming) can and do receive identical cards from the backend. The only defense is the fragile client-side `seenCardIds` ref filter.

**Defective code:**
```sql
-- In query_person_hero_cards (5 occurrences: lines 79, 94, 111, 129, 159)
AND NOT EXISTS (
  SELECT 1 FROM person_card_impressions pci
  WHERE pci.user_id = p_user_id
    AND pci.person_id = p_person_id  -- ← BUG: should also check paired_user_id
    AND pci.card_pool_id = cp.id
)
```

**What it should do:** Check BOTH `person_id` and `paired_user_id` columns, matching whichever one the impression was recorded under.

**Causal chain:**
1. User opens paired person view → edge function sets `usingPairedUser = true`
2. Edge function passes `pairedUserId` as `p_person_id` to RPC
3. RPC checks `pci.person_id = p_person_id` — never matches because impressions are in `pci.paired_user_id`
4. RPC returns cards ignoring all impressions → all sections get same cards
5. Edge function records impressions in `paired_user_id` column → next query STILL doesn't find them
6. User sees duplicate cards across every holiday section

**Invariant violated:** "A card served to a user for a specific paired person must not be served again for that same pairing."
**Enforced by:** Application code (NOT EXISTS in RPC) — currently broken.
**Verification:** Fix the NOT EXISTS clause to check both columns. Cards should not repeat across sections after the first load cycle.

#### 🔴 RC-002: Discover Experiences Bypasses Serve-Time Exclusion Check

**Fact:** `supabase/functions/discover-experiences/index.ts` lines 327-338 query `card_pool` directly using `.eq('category', toSlug(cat))` with no check against the `category_type_exclusions` table.

**Fact:** `supabase/functions/discover-cards/index.ts` line 452 uses `serveCardsFromPipeline()` which calls the `query_pool_cards` RPC. That RPC (defined in `migrations/20260321110000_per_category_exclusion_enforcement.sql`) includes:
```sql
AND NOT EXISTS (
  SELECT 1 FROM public.category_type_exclusions cte
  WHERE cte.category_slug = ANY(v_slug_categories)
    AND cte.excluded_type = ANY(t.types)
)
```

**Inference:** If a card was generated BEFORE an exclusion rule was added to `category_type_exclusions` (e.g., the school/gym exclusions added 2026-03-22), that card remains active in `card_pool`. `discover-cards` blocks it at serve time via the RPC. `discover-experiences` serves it because it never checks.

**Impact:** Users may see gyms, schools, kids' bounce houses, farmers markets, etc. in the "For You" tab (discover-experiences) that never appear in category swipe cards (discover-cards).

**Defective code:**
```typescript
// discover-experiences/index.ts lines 327-338
const { data } = await adminClient!
  .from('card_pool')
  .select('...')
  .eq('is_active', true)
  .eq('card_type', 'single')
  .eq('category', toSlug(cat))
  // ← NO exclusion check here
```

**What it should do:** Post-fetch filter cards whose `types` array intersects with excluded types for their category.

**Causal chain:**
1. Admin adds exclusion rule to `category_type_exclusions` (e.g., gym for Wellness)
2. Old card with `types: ['gym']` still active in `card_pool`
3. User opens "For You" tab → `discover-experiences` queries `card_pool` directly
4. No exclusion check → gym card served to user
5. Same card WOULD be blocked in category swipe (discover-cards uses RPC with exclusion check)

**Invariant violated:** "No excluded-type venue appears in any user-facing card surface."
**Enforced by:** Application code (RPC) — only in `discover-cards`, not `discover-experiences`.
**Verification:** Identify a card with an excluded type in card_pool. Confirm it appears in discover-experiences but not discover-cards. After fix, confirm it appears in neither.

#### 🟠 RC-003: Shuffle Performance — Sequential Queries + Radius Loop

**Fact:** `supabase/functions/get-person-hero-cards/index.ts` lines 363-404: shuffle mode runs swipe count query (line 366-370), then category preferences query (line 379-387) SEQUENTIALLY before the main RPC.

**Fact:** `supabase/functions/get-person-hero-cards/index.ts` lines 441-469: multi-dimension preferences (price tier, time-of-day, distance) are fetched with Promise.all, but AFTER the sequential queries above.

**Fact:** The RPC `query_person_hero_cards` runs a WHILE loop (lines 64-139 of migration `20260323000004`) that executes 4 SQL queries per iteration (2 COUNTs + 2 SELECTs), expanding radius from 15km to 100km in 50% increments. Worst case: 5 iterations × 4 queries = 20 SQL queries.

**Fact:** Every SELECT uses `ORDER BY RANDOM()` which is O(n log n) on the full qualifying set.

**Fact:** The index on `person_card_impressions` is `(user_id, person_id)` — does not include `card_pool_id`, making the NOT EXISTS a filter scan rather than an index-only lookup.

**Impact:** Shuffle latency ranges from 500ms (best case: dense pool, 1 iteration) to 2+ seconds (sparse pool, 5 iterations). User sees "Finding..." spinner.

**Invariant violated:** Constitution #1 — "No dead taps. No primary interaction may wait on non-critical network work before visible UI response."
**Enforced by:** Nothing — no performance budget exists.

### Contributing Factors

| ID | File | Line | Fact | Inference | Impact |
|----|------|------|------|-----------|--------|
| CF-001 | `PersonHolidayView.tsx` | 350 | `excludeIds` computed from `seenCardIds.current` at render time; all sections mount simultaneously with empty set | On initial mount, all 3+ sections fire backend queries with `excludeCardIds: []` | Backend receives no exclusion hints on first load |
| CF-002 | `usePairedCards.ts` | 64-66 | `excludeCardIds` not in query key — key is `personCardKeys.paired(pairedUserId, holidayKey, locKey)` | Even if `excludeIds` changes on re-render, React Query won't refetch | Backend dedup param is permanently stale after first fetch |
| CF-003 | `PersonHolidayView.tsx` | 367 | `seenCardIds.current` mutated inside `useMemo` (side effect in render) | React StrictMode, Concurrent Mode, or React Compiler could cause double-execution | Dedup set could accumulate incorrect entries |

### Hidden Flaws

| ID | File | Line | Fact | Inference | Future Risk |
|----|------|------|------|-----------|-------------|
| HF-001 | `usePairedCards.ts` | 105-112 | `useShufflePairedCards` does NOT pass `excludeCardIds` to the shuffle fetch | After shuffle, new cards aren't excluded from other sections' future refetches | If staleTime ever changes from Infinity, shuffle would cause cross-section duplicates |
| HF-002 | `discover-experiences/index.ts` | 327-338 | No `isChildVenueName()` check at serve time | Cards generated before child venue heuristic was added could still appear | Kids' venues in "For You" tab |

### Observations

| ID | File | Note |
|----|------|------|
| OB-001 | `get-person-hero-cards/index.ts:563` | `p_person_id` receives `pairedUserId` value — semantically confusing. Consider renaming the RPC param or adding a `p_paired_user_id` param. |
| OB-002 | README.md:238 | README claims "Paired view dedup (hardened 2026-03-22)" but dedup is broken due to RC-001 |

### Invariants That Must Hold After Fix

1. **"Impression-based dedup works for both person_id AND paired_user_id paths."** — Enforced by: RPC checks both columns via OR condition.
2. **"No excluded-type venue appears in any user-facing card surface."** — Enforced by: Post-fetch filter in discover-experiences using `category_type_exclusions` table.
3. **"Shuffle completes within 800ms for 95th percentile."** — Enforced by: Parallelized preference queries + covering index.

### What NOT to Change

- **`seenCardIds` ref pattern** — Leave the client-side dedup as a safety net. The real fix is RC-001 (backend impression check). Don't remove the client-side layer.
- **`staleTime: Infinity` on usePairedCards** — Correct design. Cards should persist until shuffle. Don't change this.
- **Progressive radius loop concept** — Keep the loop but optimize within it (covering index makes each iteration faster). Full elimination (PostGIS) is a separate feature.
- **Impression recording location** (lines 619-644) — The upsert logic is correct. The bug is in the READ side (RPC), not the WRITE side.

---

## 2. Summary

Three issues with one critical shared root cause: the `query_person_hero_cards` RPC checks `person_id` for impression-based dedup, but paired user impressions are stored in `paired_user_id`. This makes dedup completely non-functional for all paired users. Fix: update the RPC's NOT EXISTS clause to check both columns. Additionally, `discover-experiences` bypasses serve-time exclusion checks — fix with a post-fetch filter. Shuffle performance improved by parallelizing pre-RPC queries and adding a covering index.

## 3. Design Principle

**The database is the dedup authority, not the client.** Impression-based dedup must work at the SQL level regardless of which client-side patterns exist. Client-side dedup (seenCardIds) is a UX optimization, not a correctness mechanism.

## 4. Source of Truth Definition

| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| Card impressions (paired) | `person_card_impressions.paired_user_id` | Edge function upsert | No | Yes (re-serve) |
| Card impressions (legacy) | `person_card_impressions.person_id` | Edge function upsert | No | Yes (re-serve) |
| Excluded types per category | `category_type_exclusions` table | Admin config | Per-invocation | N/A (config) |
| Paired person cards | `card_pool` via RPC | Generated by admin pipeline | staleTime: Infinity | Yes (reshuffle) |

## 5. Success Criteria

1. After fix: opening a paired person view shows NO duplicate cards across birthday, custom holiday, and upcoming holiday sections — verified by comparing card IDs across sections
2. After fix: reshuffling one section does NOT introduce duplicates in other sections
3. After fix: `discover-experiences` returns zero cards with excluded types (gym, school, dog_park, etc.) for any category that excludes them
4. After fix: shuffle completes in < 1 second for a typical user (measured at edge function, excluding network)
5. All five NOT EXISTS clauses in the RPC check both `person_id` and `paired_user_id`
6. README updated to reflect the actual fix, removing "hardened" claim that was premature

## 6. Non-Goals

1. Replacing the progressive radius loop with PostGIS (separate optimization)
2. Consolidating all holiday section fetches into a single edge function call (architectural change, separate spec)
3. Removing the client-side `seenCardIds` pattern (keep as safety net)
4. Fixing `generate-single-cards` to check `category_type_exclusions` at generation time (generation already filters at seed time; serve-time is the safety net)

---

## 7. Database Changes

### 7.1 New Tables
None.

### 7.2 Modified Functions

```sql
-- Fix RC-001: Update query_person_hero_cards to check BOTH person_id and paired_user_id
-- Applied to ALL 5 NOT EXISTS clauses in the function

CREATE OR REPLACE FUNCTION public.query_person_hero_cards(
  p_user_id UUID,
  p_person_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_categories TEXT[],
  p_curated_experience_type TEXT DEFAULT NULL,
  p_initial_radius_meters INT DEFAULT 15000,
  p_max_radius_meters INT DEFAULT 100000,
  p_exclude_card_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE(card JSONB, card_type TEXT, total_available BIGINT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_radius INT := p_initial_radius_meters;
  v_lat_delta DOUBLE PRECISION;
  v_lng_delta DOUBLE PRECISION;
  v_curated_count INT := 0;
  v_single_count INT := 0;
  v_slug_categories TEXT[];
BEGIN
  -- ── SLUG NORMALIZATION ─────────────────────────────────────────────────
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(DISTINCT slug), '{}') INTO v_slug_categories
    FROM (
      SELECT CASE lower(trim(val))
        WHEN 'nature'           THEN 'nature_views'
        WHEN 'nature & views'   THEN 'nature_views'
        WHEN 'nature_views'     THEN 'nature_views'
        WHEN 'first meet'       THEN 'first_meet'
        WHEN 'first_meet'       THEN 'first_meet'
        WHEN 'picnic park'      THEN 'picnic_park'
        WHEN 'picnic_park'      THEN 'picnic_park'
        WHEN 'picnic'           THEN 'picnic_park'
        WHEN 'drink'            THEN 'drink'
        WHEN 'casual eats'      THEN 'casual_eats'
        WHEN 'casual_eats'      THEN 'casual_eats'
        WHEN 'fine dining'      THEN 'fine_dining'
        WHEN 'fine_dining'      THEN 'fine_dining'
        WHEN 'watch'            THEN 'watch'
        WHEN 'live performance' THEN 'live_performance'
        WHEN 'live_performance' THEN 'live_performance'
        WHEN 'creative & arts'  THEN 'creative_arts'
        WHEN 'creative arts'    THEN 'creative_arts'
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        WHEN 'wellness'         THEN 'wellness'
        WHEN 'flowers'          THEN 'flowers'
        WHEN 'groceries'        THEN 'groceries'
        ELSE NULL
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;

  -- Progressive radius expansion loop
  WHILE v_radius <= p_max_radius_meters LOOP
    v_lat_delta := v_radius::DOUBLE PRECISION / 111320.0;
    v_lng_delta := v_radius::DOUBLE PRECISION / (111320.0 * COS(p_lat * PI() / 180.0));

    SELECT COUNT(*) INTO v_curated_count
    FROM card_pool cp
    WHERE cp.card_type = 'curated'
      AND cp.is_active = true
      AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
      AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type)
      AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
      AND NOT EXISTS (
        SELECT 1 FROM person_card_impressions pci
        WHERE pci.user_id = p_user_id
          AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
          AND pci.card_pool_id = cp.id
      );

    SELECT COUNT(*) INTO v_single_count
    FROM card_pool cp
    WHERE cp.card_type = 'single'
      AND cp.is_active = true
      AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
      AND cp.category = ANY(v_slug_categories)
      AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
      AND NOT EXISTS (
        SELECT 1 FROM person_card_impressions pci
        WHERE pci.user_id = p_user_id
          AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
          AND pci.card_pool_id = cp.id
      );

    IF v_curated_count >= 3 AND v_single_count >= 3 THEN
      RETURN QUERY
      SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, (v_curated_count + v_single_count)::BIGINT AS total_available
      FROM card_pool cp
      WHERE cp.card_type = 'curated'
        AND cp.is_active = true
        AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
        AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
        AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type)
        AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
        AND NOT EXISTS (
          SELECT 1 FROM person_card_impressions pci
          WHERE pci.user_id = p_user_id
            AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
            AND pci.card_pool_id = cp.id
        )
      ORDER BY RANDOM()
      LIMIT 3;

      RETURN QUERY
      SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, (v_curated_count + v_single_count)::BIGINT AS total_available
      FROM card_pool cp
      WHERE cp.card_type = 'single'
        AND cp.is_active = true
        AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
        AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
        AND cp.category = ANY(v_slug_categories)
        AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
        AND NOT EXISTS (
          SELECT 1 FROM person_card_impressions pci
          WHERE pci.user_id = p_user_id
            AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
            AND pci.card_pool_id = cp.id
        )
      ORDER BY RANDOM()
      LIMIT 3;

      RETURN;
    END IF;

    v_radius := (v_radius * 1.5)::INT;
  END LOOP;

  v_lat_delta := p_max_radius_meters::DOUBLE PRECISION / 111320.0;
  v_lng_delta := p_max_radius_meters::DOUBLE PRECISION / (111320.0 * COS(p_lat * PI() / 180.0));

  RETURN QUERY
  SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, 0::BIGINT AS total_available
  FROM card_pool cp
  WHERE cp.is_active = true
    AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
    AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
    AND (
      (cp.card_type = 'curated' AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type))
      OR
      (cp.card_type = 'single' AND cp.category = ANY(v_slug_categories))
    )
    AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
    AND NOT EXISTS (
      SELECT 1 FROM person_card_impressions pci
      WHERE pci.user_id = p_user_id
        AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
        AND pci.card_pool_id = cp.id
    )
  ORDER BY cp.card_type ASC, RANDOM()
  LIMIT 6;
END;
$function$;
```

### 7.3 New Indexes

```sql
-- Covering index for the NOT EXISTS check — includes card_pool_id for index-only scan
-- Replaces the existing idx_person_card_impressions_lookup (user_id, person_id)
DROP INDEX IF EXISTS idx_person_card_impressions_lookup;

CREATE INDEX idx_person_card_impressions_person_card
  ON person_card_impressions (user_id, person_id, card_pool_id);

CREATE INDEX idx_person_card_impressions_paired_card
  ON person_card_impressions (user_id, paired_user_id, card_pool_id)
  WHERE paired_user_id IS NOT NULL;
```

### 7.4 Data Integrity Guarantees

| Invariant | Enforced By | Layer |
|-----------|------------|-------|
| No card shown twice to same user for same pairing | NOT EXISTS with OR on person_id/paired_user_id | Schema (RPC) |
| No excluded type served to users | category_type_exclusions check in RPC (discover-cards) + post-fetch filter (discover-experiences) | Code |
| Impression lookup is fast | Covering indexes on (user_id, person_id, card_pool_id) and (user_id, paired_user_id, card_pool_id) | Schema (index) |

---

## 8. Edge Functions

### 8.1 discover-experiences — Add Post-Fetch Exclusion Filter

**File path:** `supabase/functions/discover-experiences/index.ts`
**Change type:** Add post-fetch filter
**Idempotent:** Yes (filter only, no writes)

**Logic change (after line 343, before the `if (allPoolCards && allPoolCards.length > 0)` block):**

1. After fetching all pool cards per category, load excluded types for each category from `category_type_exclusions` table
2. Filter out any card whose `types` array (from card_pool JSONB) intersects with the excluded types for its category
3. Also apply `isChildVenueName()` heuristic to card titles

**Implementation:**

```typescript
// After line 343: allPoolCards populated
// Add exclusion filter before processing

// Load exclusions from DB (one query, all categories)
const { data: exclusionRows } = await adminClient!
  .from('category_type_exclusions')
  .select('category_slug, excluded_type')
  .in('category_slug', categoriesToFetch.map(c => toSlug(c)));

const exclusionMap = new Map<string, Set<string>>();
for (const row of (exclusionRows ?? [])) {
  if (!exclusionMap.has(row.category_slug)) {
    exclusionMap.set(row.category_slug, new Set());
  }
  exclusionMap.get(row.category_slug)!.add(row.excluded_type);
}

// Add global exclusions to every category
const globalExcluded = new Set(GLOBAL_EXCLUDED_PLACE_TYPES);

// Filter cards
allPoolCards = allPoolCards.filter((card: any) => {
  // Name-based child venue exclusion
  if (isChildVenueName(card.title || '')) return false;

  // Type-based exclusion
  const cardTypes: string[] = card.types || [];
  if (cardTypes.some((t: string) => globalExcluded.has(t))) return false;

  const catExclusions = exclusionMap.get(card.category);
  if (catExclusions && cardTypes.some((t: string) => catExclusions.has(t))) return false;

  return true;
});
```

**Required imports (add to top of file):**
```typescript
import { GLOBAL_EXCLUDED_PLACE_TYPES, isChildVenueName } from '../_shared/categoryPlaceTypes.ts';
```

### 8.2 get-person-hero-cards — Parallelize Shuffle Preference Queries

**File path:** `supabase/functions/get-person-hero-cards/index.ts`
**Change type:** Restructure sequential queries into Promise.all
**Idempotent:** Yes (read-only queries)

**Current (sequential, lines 363-469):**
1. Count swipes → wait
2. If ≥10: fetch category preferences → wait
3. Fetch price/time/distance preferences → wait (Promise.all)

**Fixed (parallel):**
```typescript
// Replace lines 363-469 with:
if (isShuffleMode && usingPairedUser) {
  try {
    // Parallelize ALL preference queries
    const [swipeResult, categoryPrefs, pricePrefs1, pricePrefs2, timePrefs1, timePrefs2, distPrefs] = await Promise.all([
      // Swipe count
      adminClient.from("user_interactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", pairedUserId)
        .in("interaction_type", ["swipe_left", "swipe_right"]),
      // Category preferences (always fetch, only use if swipes ≥ 10)
      adminClient.from("user_preference_learning")
        .select("preference_key, preference_value")
        .eq("user_id", pairedUserId)
        .eq("preference_type", "category")
        .gte("confidence", 0.15)
        .gt("preference_value", 0)
        .order("preference_value", { ascending: false })
        .limit(6),
      // Price tier preferences (paired user)
      adminClient.from("user_preference_learning")
        .select("preference_key")
        .eq("user_id", pairedUserId)
        .eq("preference_type", "price_tier")
        .gte("confidence", 0.15)
        .gt("preference_value", 0.5)
        .order("preference_value", { ascending: false })
        .limit(2),
      // Price tier preferences (viewer/creator)
      adminClient.from("user_preference_learning")
        .select("preference_key")
        .eq("user_id", userId)
        .eq("preference_type", "price_tier")
        .gte("confidence", 0.15)
        .gt("preference_value", 0.5)
        .order("preference_value", { ascending: false })
        .limit(2),
      // Time-of-day preferences (paired)
      adminClient.from("user_preference_learning")
        .select("preference_key")
        .eq("user_id", pairedUserId)
        .eq("preference_type", "time_of_day")
        .gte("confidence", 0.15)
        .gt("preference_value", 0.5)
        .order("preference_value", { ascending: false })
        .limit(2),
      // Time-of-day preferences (viewer)
      adminClient.from("user_preference_learning")
        .select("preference_key")
        .eq("user_id", userId)
        .eq("preference_type", "time_of_day")
        .gte("confidence", 0.15)
        .gt("preference_value", 0.5)
        .order("preference_value", { ascending: false })
        .limit(2),
      // Distance preferences
      adminClient.from("user_preference_learning")
        .select("preference_key")
        .eq("user_id", pairedUserId)
        .eq("preference_type", "distance")
        .gte("confidence", 0.15)
        .gt("preference_value", 0.5)
        .order("preference_value", { ascending: false })
        .limit(1),
    ]);

    const swipeCount = swipeResult.count ?? 0;

    if (swipeCount >= 10 && categoryPrefs.data?.length) {
      blendedCategories = categoryPrefs.data.map((p: any) => p.preference_key);
    } else {
      blendedCategories = [...categorySlugs].sort(() => Math.random() - 0.5);
    }

    // Build price tier filter from both users
    const priceSet = new Set<string>();
    for (const p of (pricePrefs1.data ?? [])) priceSet.add(p.preference_key);
    for (const p of (pricePrefs2.data ?? [])) priceSet.add(p.preference_key);
    if (priceSet.size > 0) priceTierFilter = [...priceSet];

  } catch (shuffleError) {
    console.warn("[get-person-hero-cards] Shuffle pref fetch failed:", shuffleError);
  }
}
```

---

## 9. Mobile Implementation

### 9.1 Files to Modify

None. The mobile-side `seenCardIds` pattern remains as a safety net. The real fix is backend (RC-001). No mobile code changes required for correctness.

### 9.2 State Classification

| State | Source of Truth | Derived? | Cached? | Where Stored |
|-------|----------------|----------|---------|-------------|
| Card impressions | `person_card_impressions` table | No | No | PostgreSQL |
| Paired cards per holiday | `card_pool` via RPC | Yes (from card_pool) | Yes (staleTime: Infinity) | React Query |
| seenCardIds (client dedup) | `useRef<Set<string>>` | Yes (from server data) | No | In-memory ref |

---

## 10. Migration Plan

### Forward Migration

1. **Deploy SQL migration** — Creates or replaces `query_person_hero_cards` with fixed NOT EXISTS (OR on both columns). Adds covering indexes. Non-destructive — replaces function, adds indexes.
2. **Deploy discover-experiences** — Add post-fetch exclusion filter. Backward compatible — only filters MORE cards.
3. **Deploy get-person-hero-cards** — Parallelize shuffle queries. Behavioral parity — same results, faster.
4. **Validate** — Run verification queries.

### Rollback Plan

- SQL migration is non-destructive (CREATE OR REPLACE, CREATE INDEX IF NOT EXISTS). Rollback: re-deploy previous function version.
- Edge function changes are backward compatible. Rollback: re-deploy previous edge function.
- No schema changes to tables. No data migration needed.

### Data Safety

- Non-destructive. No DROP, no ALTER TYPE, no DELETE.
- Old code can read/write safely during rollback window.
- Existing indexes are replaced with better ones (covering).

---

## 11. Implementation Order

**Step 1: SQL Migration** — Create migration file with:
- Fixed `query_person_hero_cards` (OR on person_id/paired_user_id in all 5 NOT EXISTS)
- New covering indexes
- Verify: run `SELECT * FROM query_person_hero_cards(...)` and confirm impressions are respected

**Step 2: discover-experiences exclusion filter** — Add post-fetch filter with `category_type_exclusions` + `isChildVenueName()`. Verify: confirm excluded-type cards no longer appear.

**Step 3: get-person-hero-cards shuffle optimization** — Parallelize preference queries. Verify: shuffle latency < 1s.

**Step 4: README update** — Update "Paired view dedup" and "Card Generation & Serving" sections to reflect actual fix.

**Step 5: Integration test** — Open paired person view → verify no duplicates across sections → shuffle → verify no duplicates → check For You tab for excluded types.

---

## 12. Test Cases

| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
| 1 | Paired view initial load — no duplicates | Open paired person with 3+ holiday sections | Zero card ID overlap across sections | E2E |
| 2 | Shuffle — no cross-section duplicates | Shuffle birthday section | Birthday shows new cards; custom/upcoming unchanged; no overlaps | E2E |
| 3 | Impression-based rotation | View same person 3x (exhaust pool) | Each visit shows different cards until pool exhausted | E2E |
| 4 | Excluded type not in discover-experiences | Card with `types: ['gym']` in card_pool | Not returned by discover-experiences | Edge function |
| 5 | Child venue name not in discover-experiences | Card titled "Kids Fun Zone" | Not returned by discover-experiences | Edge function |
| 6 | Shuffle < 1s | Shuffle with 10+ swipes | Edge function response < 800ms | Performance |
| 7 | Legacy person_id path still works | Use saved_people.id (non-paired) path | Impressions checked via person_id column | RPC |
| 8 | New paired_user_id path works | Use paired user path | Impressions checked via paired_user_id column | RPC |

---

## 13. Verification Queries

### Integrity Checks

```sql
-- Verify: paired user impressions are found by the RPC
-- (After fix, this should return 0 rows — all impressions are detectable)
SELECT pci.id, pci.user_id, pci.paired_user_id, pci.person_id, pci.card_pool_id
FROM person_card_impressions pci
WHERE pci.paired_user_id IS NOT NULL
  AND pci.person_id IS NULL
  -- This impression WOULD be missed by old RPC (checks person_id only)
LIMIT 10;
-- Expected: rows exist (these are the ones the old RPC was missing)

-- Verify: covering index exists
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'person_card_impressions'
  AND indexdef LIKE '%card_pool_id%';
-- Expected: 2 rows (person_card and paired_card indexes)

-- Verify: no excluded-type cards in card_pool that could leak
SELECT cp.id, cp.title, cp.category, cp.types
FROM card_pool cp
JOIN category_type_exclusions cte
  ON cte.category_slug = cp.category
  AND cte.excluded_type = ANY(cp.types)
WHERE cp.is_active = true;
-- Expected: 0 rows (or rows that will be filtered at serve time by the new check)
```

### Runtime Behavior Checks

- [ ] Open paired person view → no card IDs duplicated across sections
- [ ] Shuffle one section → other sections unchanged → no duplicates introduced
- [ ] "For You" tab → no gyms, schools, kids' venues visible
- [ ] Shuffle response time < 1s (check edge function logs)

---

## 14. Common Mistakes to Avoid

1. **Checking only `person_id` in the RPC:** → **Correct:** Use `(pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)` in ALL 5 NOT EXISTS clauses. Miss one and the bug persists for that code path.

2. **Forgetting the covering index:** → **Correct:** The OR condition makes the old `(user_id, person_id)` index insufficient. Must have separate indexes for each column that include `card_pool_id`.

3. **Adding exclusion check only to one path in discover-experiences:** → **Correct:** Apply the filter ONCE to `allPoolCards` before any per-category processing (hero selection, grid selection, rotation).

4. **Breaking the existing `person_id` path:** → **Correct:** The OR condition handles both. Legacy `person_id` impressions still work. Don't change the column used for writes.

5. **Moving exclusion check to the Supabase query builder:** → **Correct:** `card_pool` doesn't store `types` in a way that Supabase `.not()` can filter against `category_type_exclusions`. Post-fetch filter in JS is the right approach for discover-experiences.

---

## 15. Handoff to Implementor

Implementor: this is your single source of truth. §3 is the design principle — the database is the dedup authority. §4 defines what is authoritative vs derived. §1 contains the forensic diagnosis — RC-001 is the critical fix (wrong column in NOT EXISTS). Execute in order from §11. Do not skip, reorder, or expand scope. The SQL in §7.2 is the exact replacement function — use it verbatim. The edge function changes in §8 are additive (new filter, parallel queries). Produce IMPLEMENTATION_REPORT.md referencing each section, hand to tester. Not done until tester's report is green.

**README sections to update after implementation:**
- Line 238: "Paired view dedup" — update to reflect the actual column fix
- Line 257: "Paired view slug fix + dedup + quality" — add impression column fix
- Add new entry: "discover-experiences exclusion enforcement (hardened 2026-03-24)"
