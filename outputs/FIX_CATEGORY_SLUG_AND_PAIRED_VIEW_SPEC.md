# Unified Fix Spec: Category Slug Mismatch + Paired View Improvements

**Date:** 2026-03-23
**Severity:** CRITICAL (For You 100% broken) + MEDIUM (Paired View degraded)

---

## Root Cause

Migration `20260320200004` converted `card_pool.category` from display names
("Nature & Views") to snake_case slugs ("nature_views"). Three query paths were
not updated:

1. `discover-experiences` edge function — raw `.eq('category', displayName)` queries
2. `query_person_hero_cards` SQL function — `cp.category = ANY(displayNames)`
3. `discover-experiences` client retry logic treats empty pool as auth failure

Additionally, the paired view has three quality issues:
4. No server-side card deduplication across sections
5. Cache expires after 30 min instead of persisting until shuffle
6. No travel time shown on expanded paired view cards

---

## All Changes (7 files + 1 new file)

### Change 1: Shared slug mapping — `_shared/categoryPlaceTypes.ts`

**File:** `supabase/functions/_shared/categoryPlaceTypes.ts`
**Location:** After `ALL_CATEGORY_NAMES` (~line 292)

Add these exports:

```ts
// ── Display name ↔ DB slug mapping ────────────────────────────────────────
export const DISPLAY_TO_SLUG: Record<string, string> = {
  'Nature & Views': 'nature_views',
  'First Meet': 'first_meet',
  'Picnic Park': 'picnic_park',
  'Drink': 'drink',
  'Casual Eats': 'casual_eats',
  'Fine Dining': 'fine_dining',
  'Watch': 'watch',
  'Live Performance': 'live_performance',
  'Creative & Arts': 'creative_arts',
  'Play': 'play',
  'Wellness': 'wellness',
  'Flowers': 'flowers',
  'Groceries': 'groceries',
};

export const SLUG_TO_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_TO_SLUG).map(([display, slug]) => [slug, display])
);

export function toSlug(displayName: string): string {
  return DISPLAY_TO_SLUG[displayName] || displayName;
}

export function toDisplay(slug: string): string {
  return SLUG_TO_DISPLAY[slug] || slug;
}
```

---

### Change 2: Fix `discover-experiences` edge function

**File:** `supabase/functions/discover-experiences/index.ts`

1. Import `toSlug` and `toDisplay` from `_shared/categoryPlaceTypes.ts`

2. Per-category pool query (line 330):
   `.eq('category', toSlug(cat))` instead of `.eq('category', cat)`

3. `findBestForCategory` (line 384): convert param to slug before filtering:
   ```ts
   const categorySlug = toSlug(category);
   // use categorySlug in BOTH the primary and fallback filters
   ```

4. `rotationFindBest` (line 512): same slug conversion

5. `poolRowToApiCard` (line 417): `category: toDisplay(card.category)`

6. Cache-hit hero reconstruction (lines 201-204): match both formats:
   `(c.category === heroCat || c.category === toSlug(heroCat))`

Do NOT change `CATEGORY_MIN_PRICE_TIER` lookup — already works.

---

### Change 3: SQL migration — slug normalization + dedup for `query_person_hero_cards`

**File:** `supabase/migrations/20260323000004_fix_person_hero_cards_slug_and_dedup.sql`

`CREATE OR REPLACE FUNCTION` with TWO additions to the existing function:

**Addition A — Slug normalization:**
- New variable: `v_slug_categories TEXT[]`
- CASE/WHEN block at top of function body (same pattern as `query_pool_cards`)
- Replace all 3 occurrences of `cp.category = ANY(p_categories)` with
  `cp.category = ANY(v_slug_categories)`

**Addition B — Card dedup parameter:**
- New parameter: `p_exclude_card_ids UUID[] DEFAULT '{}'`
- Add `AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))` to ALL 5 card_pool
  queries in the function (2 counts + 2 returns + 1 max-radius fallback)

Everything else in the function stays identical — curated card logic, radius expansion,
impression exclusion, return structure.

Full replacement SQL:

```sql
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
          AND pci.person_id = p_person_id
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
          AND pci.person_id = p_person_id
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
            AND pci.person_id = p_person_id
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
            AND pci.person_id = p_person_id
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
        AND pci.person_id = p_person_id
        AND pci.card_pool_id = cp.id
    )
  ORDER BY cp.card_type ASC, RANDOM()
  LIMIT 6;
END;
$function$;
```

---

### Change 4: Wire dedup in `get-person-hero-cards` edge function

**File:** `supabase/functions/get-person-hero-cards/index.ts`

Add `excludeCardIds?: string[]` to `RequestBody` interface.
Parse from request body and pass to RPC:

```ts
p_exclude_card_ids: excludeCardIds || [],
```

---

### Change 5: Client — cache, dedup, retry fixes

**File:** `app-mobile/src/hooks/usePairedCards.ts`
- Change `staleTime: 30 * 60 * 1000` → `staleTime: Infinity`
- Add `excludeCardIds?: string[]` to `UsePairedCardsParams`
- Pass `excludeCardIds` through to `fetchPersonHeroCards`

**File:** `app-mobile/src/hooks/usePersonHeroCards.ts`
- Change `staleTime: 5 * 60 * 1000` → `staleTime: Infinity`

**File:** `app-mobile/src/services/personHeroCardsService.ts`
- Add `excludeCardIds?: string[]` to fetch params
- Include in POST body

**File:** `app-mobile/src/services/experienceGenerationService.ts`
- Fix retry-on-empty: only retry on `data?.meta?.authFailed`, not all empty responses

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
- Add `fetchingRef` mutex to prevent duplicate fetch calls

---

### Change 6: Travel time on paired view cards

**File:** `app-mobile/src/utils/travelTime.ts` (NEW)

```ts
const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 40,
  transit: 25,
  bicycling: 15,
  biking: 15,
};

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeTravelInfo(
  userLat: number, userLng: number,
  placeLat: number, placeLng: number,
  travelMode: string
): { travelTime: string; distance: string } {
  const distKm = haversineKm(userLat, userLng, placeLat, placeLng);
  const speed = SPEED_KMH[travelMode] || SPEED_KMH.walking;
  const minutes = Math.max(1, Math.round((distKm / speed) * 60));
  return {
    travelTime: `${minutes} min`,
    distance: `${Math.round(distKm * 10) / 10} km`,
  };
}
```

**File:** `app-mobile/src/components/PersonHolidayView.tsx`

- Add `travelMode?: string` to `PersonHolidayViewProps`
- Pass to `CardRow`
- In `CardRow`'s `onCardPress`, compute travel time with `computeTravelInfo` using
  the card's `lat`/`lng`, the user's `location`, and `travelMode`
- Add `travelTime`, `distance`, `travelMode` to the `onCardPress` payload
- Pass `Array.from(seenCardIds.current)` as `excludeCardIds` to `usePairedCards`

**File:** `app-mobile/src/components/DiscoverScreen.tsx`

- Pass `travelMode={userTravelMode}` to `PersonHolidayView`
- Thread `travelTime`, `distance`, `travelMode` from the paired view's `onCardPress`
  through to the `ExpandedCardData` object

---

## Files Summary

| # | File | What Changes |
|---|------|-------------|
| 1 | `supabase/functions/_shared/categoryPlaceTypes.ts` | Add slug mapping exports |
| 2 | `supabase/functions/discover-experiences/index.ts` | Fix 6 slug comparisons |
| 3 | `supabase/migrations/20260323000004_fix_person_hero_cards_slug_and_dedup.sql` | Slug normalization + dedup param in SQL |
| 4 | `supabase/functions/get-person-hero-cards/index.ts` | Pass `excludeCardIds` to RPC |
| 5 | `app-mobile/src/hooks/usePairedCards.ts` | `staleTime: Infinity` + excludeCardIds |
| 6 | `app-mobile/src/hooks/usePersonHeroCards.ts` | `staleTime: Infinity` |
| 7 | `app-mobile/src/services/personHeroCardsService.ts` | Add excludeCardIds to POST |
| 8 | `app-mobile/src/services/experienceGenerationService.ts` | Fix retry-on-empty |
| 9 | `app-mobile/src/components/DiscoverScreen.tsx` | Fetch mutex + pass travelMode |
| 10 | `app-mobile/src/components/PersonHolidayView.tsx` | Travel time + dedup wiring |
| 11 | `app-mobile/src/utils/travelTime.ts` | NEW — haversine + speed calc |

---

## Deploy Sequence

1. Deploy `_shared/categoryPlaceTypes.ts` + `discover-experiences` → restores For You
2. Apply SQL migration → restores paired view single cards + enables dedup
3. Deploy `get-person-hero-cards` → wires dedup parameter
4. Deploy mobile app build → cache fix, travel time, dedup wiring, retry fix

Steps 1-3 are server-side and can ship immediately. Step 4 requires app build.

---

## Verification

**For You:** 2 hero cards + ~10 grid cards, display names, correct icons
**Paired View:** 6 cards per section (3 curated + 3 single), no repeats across sections
**Cache:** Cards persist until shuffle pressed, not 30-min auto-refresh
**Travel Time:** Expanded paired view cards show travel time with mode-matching icon
**Retry:** No wasted 5-10s token refresh on legitimately empty pools
