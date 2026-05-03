# SPEC — ORCH-0700 Phase 3B Helper Taxonomy Fix

**Author:** mingla-forensics (SPEC mode)
**Dispatch:** [SPEC_ORCH-0700_PHASE_3B_HELPER_TAXONOMY_FIX.md](../prompts/SPEC_ORCH-0700_PHASE_3B_HELPER_TAXONOMY_FIX.md)
**ORCH-ID:** ORCH-0700 Phase 3B
**Operator decision:** Path A (display label) confirmed 2026-05-03
**Status:** spec complete · ready for implementor dispatch

---

## 1 — Layman summary

Rewrite the SQL helper `pg_map_primary_type_to_mingla_category` to return Mingla's canonical 10-slug display taxonomy (combining `brunch`+`casual_food` → `brunch_lunch_casual`, `movies`+`theatre` → `movies_theatre`, separating `groceries` from `flowers`). Refresh the matview to re-derive all ~70k rows. Update the TS twin to match. Redeploy 3 admin edge functions. Result: admin Place Pool dashboard shows real non-zero counts for the 3 currently-broken categories. Mobile app, signal scoring, bouncer, rules engine, and curated pipeline are NOT touched. Atomic, reversible, ~1.5h work.

---

## 2 — Investigation Ingest (per Phase 1)

### Root causes addressed

From [INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md](../reports/INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md) §G + §11 and [INVESTIGATION_ORCH-0700_PHASE_3_TAXONOMY_REGRESSION.md](../reports/INVESTIGATION_ORCH-0700_PHASE_3_TAXONOMY_REGRESSION.md):

🔴 **ROOT CAUSE:** `admin_place_pool_mv.primary_category` (created by Migration 4 today) is filled by `pg_map_primary_type_to_mingla_category()` which returns 11 invented slugs (`brunch, casual_food, movies, theatre`, plus `flowers` absorbing grocery types). Admin dashboard reads this column expecting **canonical 10-slug display taxonomy** (`brunch_lunch_casual, movies_theatre, groceries, flowers`-florist-only). Mismatch → 3 cells render 0 in Baltimore (and globally).

### Hidden flaws this spec addresses
- 🟡 SQL helper's WARNING comment claims to mirror `mapPrimaryTypeToMinglaCategory` in `categoryPlaceTypes.ts` — false. Spec corrects the comment.
- 🟡 TS twin `derivePoolCategory.ts` inherits the same wrong taxonomy (created during Phase 3 implementor pass). Spec rewrites it.

### Hidden flaws explicitly NOT addressed (deferred per dispatch §Out of Scope)
- 🟡 `useMapCards.ts:8-12` stale 12-category list (pre-ORCH-0434)
- 🟡 ORCH-0597/0598 display split (10→12 slugs) — incomplete migration; operator deferred
- 🟡 `drinks_and_music` (display) vs `drinks` (signal) naming — confirmed intentional by orchestrator
- 🟡 GRANT-preservation invariant on matview rebuilds (separate dispatch)

### Invariants violated by current state
- **Constitution #2 (one owner per truth):** matview column is "scoring or display depending who reads" — fix restores single ownership (display)
- **Constitution #9 (no fabricated data):** matview emits slugs no consumer can resolve — fix ensures all emitted slugs are in DISPLAY_TO_SLUG

### Investigation completeness check
Investigation reports cover the full taxonomy landscape (4 systems mapped: seeding, bouncer, signal-scoring, display) + the leak site identification + the canonical authority document (`DISPLAY_TO_SLUG`). Sufficient to spec without uncertainty.

---

## 3 — Scope and Non-Goals

### In scope
1. New SQL migration replacing `pg_map_primary_type_to_mingla_category` with canonical-10-slug-returning version
2. `REFRESH MATERIALIZED VIEW admin_place_pool_mv` inside the same migration (atomic with helper change)
3. Updated `supabase/functions/_shared/derivePoolCategory.ts` with matching 10-slug ORDERED_BUCKETS
4. New unit test enforcing I-CATEGORY-SLUG-CANONICAL invariant at code level
5. Redeploy of `admin-seed-places`, `admin-refresh-places`, `admin-place-search` edge functions (no source changes — picks up new TS helper output)
6. Smoke verification recipe (3 commands)

### Non-goals (explicitly excluded — implementor must NOT touch)
- Migration 5 (RPC scrub for OUT-param drift) — separate dispatch
- Migration 6 (drop place_pool.seeding_category + 5 ai_* columns) — separate dispatch, gated on this fix
- Updating any admin RPC body (admin_pool_category_health, admin_place_category_breakdown, etc.) — they pass through matview values unchanged, and the matview refresh will give them correct values automatically
- mingla-admin/src/* changes — admin UI already expects canonical 10 slugs in `categories.js`
- app-mobile/* + mingla-business/* changes — mobile reads category from edge function responses, not from matview
- ORCH-0597/0598 display slug split (10→12) — operator deferred
- `useMapCards.ts` stale 12-category list cleanup — separate dispatch
- DECISION_LOG / INVARIANT_REGISTRY entries — orchestrator-owned, added at CLOSE
- Bouncer or signal scorer source code — orthogonal systems
- `place_scores` table or scoring formulas — untouched
- New helper variants, additional columns on matview, dual-column architecture

### Assumptions
- The canonical 10-slug taxonomy in `categoryPlaceTypes.ts:DISPLAY_TO_SLUG` is the authoritative target. Verified by reading the source (line 473-484) which is the AUTHORITY pointed to by `mingla-admin/src/constants/categories.js` header comment ("ORCH-0434: 10 categories ... These match the app-side slugs stored in the database").
- The current SQL helper signature is `(p_primary_type text, p_types text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE` — verified live via `pg_get_function_arguments` and `pg_get_function_result`. New helper preserves this exactly per I-MIGRATION-LIVE-SIGNATURE-CHECK.
- Matview refresh on ~70K rows takes seconds; cron collision risk is acceptable per prior ORCH-0700 LANDMINE_AUDIT analysis.

---

## 4 — Per-Layer Specification

### 4.1 — Database layer

**File:** `supabase/migrations/20260503000007_orch_0700_helper_canonical_taxonomy_fix.sql`

**Live signature to preserve (per I-MIGRATION-LIVE-SIGNATURE-CHECK):**
```sql
-- Verified live via pg_get_function_arguments(oid) + pg_get_function_result(oid):
-- args:    p_primary_type text, p_types text[]
-- returns: text
-- volatility: IMMUTABLE
-- parallel:   PARALLEL SAFE
-- security:   INVOKER (prosecdef = false)
-- language:   plpgsql
```

**Migration body (full SQL, ready to copy):**

```sql
-- ORCH-0700 Phase 3B — Helper canonical taxonomy fix
--
-- REPLACES the prior pg_map_primary_type_to_mingla_category helper (Migration 1
-- of ORCH-0700, applied 2026-05-03 ~earlier today) which returned an INVENTED
-- 11-slug taxonomy (brunch+casual_food split, movies+theatre split, no
-- groceries — grocery types absorbed into flowers). That taxonomy matched
-- nothing else in the codebase. Admin Place Pool dashboard rendered 0 for
-- Brunch+Lunch+Casual, Movies+Theatre, Groceries because no row in the
-- matview's primary_category column held those canonical slugs.
--
-- This migration:
--   1. CREATE OR REPLACE the helper to return the canonical 10-slug taxonomy
--      defined by DISPLAY_TO_SLUG in supabase/functions/_shared/categoryPlaceTypes.ts
--   2. REFRESH MATERIALIZED VIEW admin_place_pool_mv (re-derives all ~70K rows)
--   3. Self-verify probes (16 input/output pairs + canonical-set membership)
--   4. Post-refresh probe asserting matview contains ONLY canonical slugs ∪ {uncategorized}
--
-- Reference:
--   ORCH-0700 Phase 3B spec (this file's source)
--   INVESTIGATION_CATEGORY_PIPELINE_END_TO_END.md
--   INVESTIGATION_ORCH-0700_PHASE_3_TAXONOMY_REGRESSION.md

BEGIN;

-- ── Step 1: Replace helper with canonical-taxonomy version ──
CREATE OR REPLACE FUNCTION public.pg_map_primary_type_to_mingla_category(
  p_primary_type text,
  p_types text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $func$
DECLARE
  v_type text;
  v_result text;
BEGIN
  -- Try primary_type first (single match)
  IF p_primary_type IS NOT NULL THEN
    v_result := CASE
      -- Nature & Views (slug 'nature')
      WHEN p_primary_type IN ('beach','botanical_garden','garden','hiking_area','national_park',
                              'nature_preserve','park','scenic_spot','state_park','observation_deck',
                              'tourist_attraction','picnic_ground','vineyard','wildlife_park','wildlife_refuge',
                              'woods','mountain_peak','river','island','city_park','fountain','lake','marina')
        THEN 'nature'
      -- Icebreakers (slug 'icebreakers')
      WHEN p_primary_type IN ('cafe','bowling_alley','coffee_shop','miniature_golf_course','art_gallery',
                              'tea_house','video_arcade','museum','book_store','amusement_center',
                              'bakery','go_karting_venue','cultural_center','dessert_shop','karaoke',
                              'plaza','ice_cream_shop','comedy_club','art_museum','juice_shop',
                              'paintball_center','donut_shop','dance_hall','breakfast_restaurant','brunch_restaurant')
        THEN 'icebreakers'
      -- Drinks & Music (slug 'drinks_and_music')
      WHEN p_primary_type IN ('bar','cocktail_bar','wine_bar','brewery','pub','beer_garden','brewpub',
                              'lounge_bar','night_club','live_music_venue','coffee_roastery','coffee_stand')
        THEN 'drinks_and_music'
      -- Movies & Theatre (slug 'movies_theatre') — combines former 'movies' + 'theatre' helper buckets
      WHEN p_primary_type IN ('movie_theater','drive_in',
                              'performing_arts_theater','opera_house','auditorium','amphitheatre','concert_hall')
        THEN 'movies_theatre'
      -- Brunch, Lunch & Casual (slug 'brunch_lunch_casual') — combines former 'brunch' + 'casual_food' helper buckets
      WHEN p_primary_type IN ('american_restaurant','bistro','gastropub','diner',
                              'mexican_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop',
                              'mediterranean_restaurant','indian_restaurant','chinese_restaurant',
                              'vietnamese_restaurant','korean_restaurant','japanese_restaurant',
                              'lebanese_restaurant','greek_restaurant','italian_restaurant',
                              'ramen_restaurant','noodle_shop','hamburger_restaurant','deli',
                              'barbecue_restaurant','seafood_restaurant','vegan_restaurant',
                              'vegetarian_restaurant','turkish_restaurant','spanish_restaurant',
                              'french_restaurant','sushi_restaurant','buffet_restaurant','food_court',
                              'afghani_restaurant','african_restaurant','asian_restaurant',
                              'brazilian_restaurant','indonesian_restaurant','middle_eastern_restaurant',
                              'hot_pot_restaurant','dim_sum_restaurant','argentinian_restaurant',
                              'basque_restaurant','persian_restaurant','scandinavian_restaurant',
                              'filipino_restaurant','soul_food_restaurant','cuban_restaurant',
                              'hawaiian_restaurant','ethiopian_restaurant','moroccan_restaurant',
                              'peruvian_restaurant','cajun_restaurant','fusion_restaurant',
                              'korean_barbecue_restaurant','tapas_restaurant')
        THEN 'brunch_lunch_casual'
      -- Upscale & Fine Dining (slug 'upscale_fine_dining')
      WHEN p_primary_type IN ('fine_dining_restaurant','steak_house','oyster_bar_restaurant',
                              'fondue_restaurant','swiss_restaurant','european_restaurant',
                              'australian_restaurant','british_restaurant')
        THEN 'upscale_fine_dining'
      -- Creative & Arts (slug 'creative_arts')
      WHEN p_primary_type IN ('art_studio','history_museum','sculpture','cultural_landmark')
        THEN 'creative_arts'
      -- Play (slug 'play')
      WHEN p_primary_type IN ('amusement_park','roller_coaster','water_park','ferris_wheel',
                              'casino','planetarium','golf_course','indoor_golf_course',
                              'adventure_sports_center','ice_skating_rink')
        THEN 'play'
      -- Groceries (slug 'groceries') — MUST come BEFORE 'flowers' since grocery_store + supermarket
      -- belong here per canonical taxonomy. Flowers is florist-only.
      WHEN p_primary_type IN ('grocery_store','supermarket')
        THEN 'groceries'
      -- Flowers (slug 'flowers') — florist ONLY (no grocery absorption)
      WHEN p_primary_type = 'florist'
        THEN 'flowers'
      ELSE NULL
    END;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Fallback: scan types[] in order, return first match.
  -- Recursion safe because depth is bounded by types[] length and IMMUTABLE
  -- marker prevents planner re-entry.
  IF p_types IS NOT NULL THEN
    FOREACH v_type IN ARRAY p_types LOOP
      v_result := public.pg_map_primary_type_to_mingla_category(v_type, NULL);
      IF v_result IS NOT NULL THEN
        RETURN v_result;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$func$;

COMMENT ON FUNCTION public.pg_map_primary_type_to_mingla_category(text, text[]) IS
  'ORCH-0700 Phase 3B (2026-05-03): Returns Mingla canonical category slug per DISPLAY_TO_SLUG '
  'in supabase/functions/_shared/categoryPlaceTypes.ts. Returns NULL when no match (Constitution #9 — '
  'never fabricate). Output is always within the canonical 10-slug set: nature, icebreakers, '
  'drinks_and_music, brunch_lunch_casual, upscale_fine_dining, movies_theatre, creative_arts, '
  'play, flowers, groceries. WARNING: keep in sync with _shared/derivePoolCategory.ts (TS twin) '
  'and DISPLAY_TO_SLUG (canonical authority). Future ORCH should auto-generate all three from '
  'a single source of truth. Used by admin_place_pool_mv.primary_category derivation + admin RPCs.';

-- ── Step 2: Self-verify probes (RAISE EXCEPTION on regression) ──
DO $$
DECLARE
  v_test text;
  v_canonical_set text[] := ARRAY[
    'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
    'upscale_fine_dining','movies_theatre','creative_arts','play','flowers','groceries'
  ];
BEGIN
  -- Movies & Theatre (combined slug)
  v_test := public.pg_map_primary_type_to_mingla_category('movie_theater', NULL);
  IF v_test IS DISTINCT FROM 'movies_theatre' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-01: movie_theater expected ''movies_theatre'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('performing_arts_theater', NULL);
  IF v_test IS DISTINCT FROM 'movies_theatre' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-02: performing_arts_theater expected ''movies_theatre'', got ''%''', v_test;
  END IF;

  -- Brunch, Lunch & Casual (combined slug)
  v_test := public.pg_map_primary_type_to_mingla_category('italian_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'brunch_lunch_casual' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-03: italian_restaurant expected ''brunch_lunch_casual'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('american_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'brunch_lunch_casual' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-04: american_restaurant expected ''brunch_lunch_casual'', got ''%''', v_test;
  END IF;

  -- Upscale & Fine Dining
  v_test := public.pg_map_primary_type_to_mingla_category('fine_dining_restaurant', NULL);
  IF v_test IS DISTINCT FROM 'upscale_fine_dining' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-05: fine_dining_restaurant expected ''upscale_fine_dining'', got ''%''', v_test;
  END IF;

  -- Groceries (NEW — separate from flowers, must precede in CASE order)
  v_test := public.pg_map_primary_type_to_mingla_category('grocery_store', NULL);
  IF v_test IS DISTINCT FROM 'groceries' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-06: grocery_store expected ''groceries'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('supermarket', NULL);
  IF v_test IS DISTINCT FROM 'groceries' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-07: supermarket expected ''groceries'', got ''%''', v_test;
  END IF;

  -- Flowers (florist ONLY — grocery types now route to groceries)
  v_test := public.pg_map_primary_type_to_mingla_category('florist', NULL);
  IF v_test IS DISTINCT FROM 'flowers' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-08: florist expected ''flowers'', got ''%''', v_test;
  END IF;

  -- Other unchanged categories (regression backstop)
  v_test := public.pg_map_primary_type_to_mingla_category('park', NULL);
  IF v_test IS DISTINCT FROM 'nature' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-09: park expected ''nature'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('cafe', NULL);
  IF v_test IS DISTINCT FROM 'icebreakers' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-10: cafe expected ''icebreakers'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('bar', NULL);
  IF v_test IS DISTINCT FROM 'drinks_and_music' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-11: bar expected ''drinks_and_music'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('art_studio', NULL);
  IF v_test IS DISTINCT FROM 'creative_arts' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-12: art_studio expected ''creative_arts'', got ''%''', v_test;
  END IF;

  v_test := public.pg_map_primary_type_to_mingla_category('amusement_park', NULL);
  IF v_test IS DISTINCT FROM 'play' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-13: amusement_park expected ''play'', got ''%''', v_test;
  END IF;

  -- Unknown type → NULL (no fabrication, Constitution #9)
  v_test := public.pg_map_primary_type_to_mingla_category('xyz_unknown', NULL);
  IF v_test IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-14: xyz_unknown expected NULL, got ''%''', v_test;
  END IF;

  -- types[] fallback
  v_test := public.pg_map_primary_type_to_mingla_category(NULL, ARRAY['unknown_x','movie_theater']);
  IF v_test IS DISTINCT FROM 'movies_theatre' THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-15: types[] fallback expected ''movies_theatre'', got ''%''', v_test;
  END IF;

  -- All-NULL inputs → NULL
  v_test := public.pg_map_primary_type_to_mingla_category(NULL, NULL);
  IF v_test IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL T-16: NULL inputs expected NULL, got ''%''', v_test;
  END IF;

  RAISE NOTICE 'Phase 3B helper self-verify: 16/16 probes PASSED';
END $$;

-- ── Step 3: Refresh matview to re-derive primary_category for all rows ──
-- Non-CONCURRENTLY is acceptable: rebuild on ~70K rows takes seconds; cron job 13
-- collision risk is one delayed tick (per prior LANDMINE_AUDIT analysis).
REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;

-- ── Step 4: Post-refresh assertion — matview MUST contain only canonical slugs ──
DO $$
DECLARE
  v_offending_count INTEGER;
  v_offending_slugs TEXT[];
BEGIN
  -- Sample any rows whose primary_category is not in canonical set ∪ {uncategorized}
  SELECT COUNT(*), ARRAY(
    SELECT DISTINCT primary_category FROM admin_place_pool_mv
    WHERE primary_category IS NOT NULL
      AND primary_category NOT IN (
        'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
        'upscale_fine_dining','movies_theatre','creative_arts','play',
        'flowers','groceries','uncategorized'
      )
  ) INTO v_offending_count, v_offending_slugs
  FROM admin_place_pool_mv
  WHERE primary_category IS NOT NULL
    AND primary_category NOT IN (
      'nature','icebreakers','drinks_and_music','brunch_lunch_casual',
      'upscale_fine_dining','movies_theatre','creative_arts','play',
      'flowers','groceries','uncategorized'
    );
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: matview holds % rows with non-canonical slug(s): %',
      v_offending_count, v_offending_slugs;
  END IF;

  -- Sanity: confirm at least 3 of the previously-broken canonical slugs now exist
  IF NOT EXISTS (SELECT 1 FROM admin_place_pool_mv WHERE primary_category = 'brunch_lunch_casual' LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: zero rows with primary_category=''brunch_lunch_casual'' post-refresh — regression';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_place_pool_mv WHERE primary_category = 'movies_theatre' LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: zero rows with primary_category=''movies_theatre'' post-refresh — regression';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_place_pool_mv WHERE primary_category = 'groceries' LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 3B verify FAIL: zero rows with primary_category=''groceries'' post-refresh — regression';
  END IF;

  RAISE NOTICE 'Phase 3B matview post-refresh verify: PASSED (all primary_category values canonical, 3 previously-broken slugs now present)';
END $$;

COMMIT;
```

### 4.2 — Edge function layer (TS helper rewrite)

**File:** `supabase/functions/_shared/derivePoolCategory.ts`

**Full file replacement (ready to copy):**

```typescript
// ORCH-0700 Phase 3B (2026-05-03) — TS twin of pg_map_primary_type_to_mingla_category.
//
// Aligned with the canonical 10-slug taxonomy in DISPLAY_TO_SLUG
// (supabase/functions/_shared/categoryPlaceTypes.ts:473-484), NOT with any
// helper-only invented taxonomy. The SQL helper at
// supabase/migrations/20260503000007_orch_0700_helper_canonical_taxonomy_fix.sql
// mirrors this same canonical taxonomy.
//
// Returns the Mingla canonical category slug for a Google primary_type + types[]
// array, or null when no match (Constitution #9 — never fabricate).
//
// "First-write-wins": a type is claimed by the first category whose place-type
// list contains it (matching SQL CASE chain order).
//
// Used by admin edge functions to derive category client-side.
//
// WARNING: keep this file in sync with the SQL helper AND DISPLAY_TO_SLUG.
// Three layers must agree. Backed by:
//   - SQL self-verify probes in the helper migration
//   - TS unit test in __tests__/derivePoolCategory_canonical.test.ts (enforces
//     I-CATEGORY-SLUG-CANONICAL: every output ∈ Object.values(DISPLAY_TO_SLUG))
//   - Matview post-refresh probe

const NATURE = new Set<string>([
  "beach", "botanical_garden", "garden", "hiking_area", "national_park",
  "nature_preserve", "park", "scenic_spot", "state_park", "observation_deck",
  "tourist_attraction", "picnic_ground", "vineyard", "wildlife_park", "wildlife_refuge",
  "woods", "mountain_peak", "river", "island", "city_park", "fountain", "lake", "marina",
]);

const ICEBREAKERS = new Set<string>([
  "cafe", "bowling_alley", "coffee_shop", "miniature_golf_course", "art_gallery",
  "tea_house", "video_arcade", "museum", "book_store", "amusement_center",
  "bakery", "go_karting_venue", "cultural_center", "dessert_shop", "karaoke",
  "plaza", "ice_cream_shop", "comedy_club", "art_museum", "juice_shop",
  "paintball_center", "donut_shop", "dance_hall", "breakfast_restaurant", "brunch_restaurant",
]);

const DRINKS_AND_MUSIC = new Set<string>([
  "bar", "cocktail_bar", "wine_bar", "brewery", "pub", "beer_garden", "brewpub",
  "lounge_bar", "night_club", "live_music_venue", "coffee_roastery", "coffee_stand",
]);

// Movies & Theatre (combined canonical slug — was split as 'movies' + 'theatre' in helper-only taxonomy)
const MOVIES_THEATRE = new Set<string>([
  "movie_theater", "drive_in",
  "performing_arts_theater", "opera_house", "auditorium", "amphitheatre", "concert_hall",
]);

// Brunch, Lunch & Casual (combined canonical slug — was split as 'brunch' + 'casual_food' in helper-only taxonomy)
const BRUNCH_LUNCH_CASUAL = new Set<string>([
  "american_restaurant", "bistro", "gastropub", "diner",
  "mexican_restaurant", "thai_restaurant", "pizza_restaurant", "sandwich_shop",
  "mediterranean_restaurant", "indian_restaurant", "chinese_restaurant",
  "vietnamese_restaurant", "korean_restaurant", "japanese_restaurant",
  "lebanese_restaurant", "greek_restaurant", "italian_restaurant",
  "ramen_restaurant", "noodle_shop", "hamburger_restaurant", "deli",
  "barbecue_restaurant", "seafood_restaurant", "vegan_restaurant",
  "vegetarian_restaurant", "turkish_restaurant", "spanish_restaurant",
  "french_restaurant", "sushi_restaurant", "buffet_restaurant", "food_court",
  "afghani_restaurant", "african_restaurant", "asian_restaurant",
  "brazilian_restaurant", "indonesian_restaurant", "middle_eastern_restaurant",
  "hot_pot_restaurant", "dim_sum_restaurant", "argentinian_restaurant",
  "basque_restaurant", "persian_restaurant", "scandinavian_restaurant",
  "filipino_restaurant", "soul_food_restaurant", "cuban_restaurant",
  "hawaiian_restaurant", "ethiopian_restaurant", "moroccan_restaurant",
  "peruvian_restaurant", "cajun_restaurant", "fusion_restaurant",
  "korean_barbecue_restaurant", "tapas_restaurant",
]);

const UPSCALE_FINE_DINING = new Set<string>([
  "fine_dining_restaurant", "steak_house", "oyster_bar_restaurant",
  "fondue_restaurant", "swiss_restaurant", "european_restaurant",
  "australian_restaurant", "british_restaurant",
]);

const CREATIVE_ARTS = new Set<string>([
  "art_studio", "history_museum", "sculpture", "cultural_landmark",
]);

const PLAY = new Set<string>([
  "amusement_park", "roller_coaster", "water_park", "ferris_wheel",
  "casino", "planetarium", "golf_course", "indoor_golf_course",
  "adventure_sports_center", "ice_skating_rink",
]);

// Groceries (separate canonical slug — was absorbed into 'flowers' in helper-only taxonomy)
const GROCERIES = new Set<string>(["grocery_store", "supermarket"]);

// Flowers (florist ONLY — grocery types now route to GROCERIES)
const FLOWERS = new Set<string>(["florist"]);

// Iteration order MUST match the SQL CASE chain — first-match-wins.
// CRITICAL: GROCERIES must come BEFORE FLOWERS so grocery_store/supermarket
// route to 'groceries', not 'flowers'.
const ORDERED_BUCKETS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["nature", NATURE],
  ["icebreakers", ICEBREAKERS],
  ["drinks_and_music", DRINKS_AND_MUSIC],
  ["movies_theatre", MOVIES_THEATRE],
  ["brunch_lunch_casual", BRUNCH_LUNCH_CASUAL],
  ["upscale_fine_dining", UPSCALE_FINE_DINING],
  ["creative_arts", CREATIVE_ARTS],
  ["play", PLAY],
  ["groceries", GROCERIES],
  ["flowers", FLOWERS],
];

function lookupOne(t: string): string | null {
  for (const [slug, bucket] of ORDERED_BUCKETS) {
    if (bucket.has(t)) return slug;
  }
  return null;
}

/**
 * Returns the Mingla canonical category slug for a place's primary_type + types[].
 * Mirrors public.pg_map_primary_type_to_mingla_category(text, text[]).
 * Output is always within the canonical 10-slug set defined by DISPLAY_TO_SLUG
 * in categoryPlaceTypes.ts, or null.
 *
 * @param primaryType Google's primary_type (may be null)
 * @param types       Google's full types[] array (may be null/empty)
 * @returns slug like "nature" / "brunch_lunch_casual" / "movies_theatre", or null when no match
 */
export function derivePoolCategory(
  primaryType: string | null | undefined,
  types: ReadonlyArray<string> | null | undefined,
): string | null {
  if (primaryType) {
    const fromPrimary = lookupOne(primaryType);
    if (fromPrimary !== null) return fromPrimary;
  }
  if (types && types.length > 0) {
    for (const t of types) {
      const fromType = lookupOne(t);
      if (fromType !== null) return fromType;
    }
  }
  return null;
}

/**
 * Inverse lookup: given a Mingla canonical category slug, return the Google
 * place_types that derive to that slug. Used by admin-refresh-places to filter
 * place_pool rows by category.
 *
 * Returns empty array for unknown slugs.
 */
export function googleTypesForCategory(categorySlug: string): string[] {
  for (const [slug, bucket] of ORDERED_BUCKETS) {
    if (slug === categorySlug) return Array.from(bucket);
  }
  return [];
}

/** All Mingla canonical category slugs the helper can return (excluding null). */
export const ALL_DERIVED_CATEGORY_SLUGS: ReadonlyArray<string> =
  ORDERED_BUCKETS.map(([slug]) => slug);
```

### 4.3 — Test layer (NEW unit test)

**File:** `supabase/functions/_shared/__tests__/derivePoolCategory_canonical.test.ts`

**Full file (ready to copy):**

```typescript
// ORCH-0700 Phase 3B — Unit test enforcing I-CATEGORY-SLUG-CANONICAL invariant.
//
// Asserts that every slug derivePoolCategory can return is a member of the
// canonical 10-slug taxonomy defined by DISPLAY_TO_SLUG in categoryPlaceTypes.ts.
//
// This is the third regression gate (alongside the SQL helper's self-verify
// probes and the matview's post-refresh assertion). If a future change to
// derivePoolCategory.ts introduces a slug that doesn't match DISPLAY_TO_SLUG,
// this test fails immediately at deno test time.
//
// Run: deno test supabase/functions/_shared/__tests__/derivePoolCategory_canonical.test.ts

import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { derivePoolCategory, ALL_DERIVED_CATEGORY_SLUGS, googleTypesForCategory } from "../derivePoolCategory.ts";
import { DISPLAY_TO_SLUG } from "../categoryPlaceTypes.ts";

Deno.test("I-CATEGORY-SLUG-CANONICAL: every derivePoolCategory output is a canonical slug", () => {
  const canonical = new Set(Object.values(DISPLAY_TO_SLUG));
  for (const slug of ALL_DERIVED_CATEGORY_SLUGS) {
    assertEquals(
      canonical.has(slug),
      true,
      `derivePoolCategory exposes slug "${slug}" which is NOT in DISPLAY_TO_SLUG canonical set. ` +
      `Canonical set: [${Array.from(canonical).join(", ")}]. ` +
      `Add the slug to DISPLAY_TO_SLUG OR remove it from derivePoolCategory.ts ORDERED_BUCKETS.`,
    );
  }
});

Deno.test("derivePoolCategory: movie_theater → movies_theatre (combined canonical slug)", () => {
  assertStrictEquals(derivePoolCategory("movie_theater", null), "movies_theatre");
});

Deno.test("derivePoolCategory: performing_arts_theater → movies_theatre", () => {
  assertStrictEquals(derivePoolCategory("performing_arts_theater", null), "movies_theatre");
});

Deno.test("derivePoolCategory: italian_restaurant → brunch_lunch_casual (combined canonical slug)", () => {
  assertStrictEquals(derivePoolCategory("italian_restaurant", null), "brunch_lunch_casual");
});

Deno.test("derivePoolCategory: american_restaurant → brunch_lunch_casual", () => {
  assertStrictEquals(derivePoolCategory("american_restaurant", null), "brunch_lunch_casual");
});

Deno.test("derivePoolCategory: fine_dining_restaurant → upscale_fine_dining", () => {
  assertStrictEquals(derivePoolCategory("fine_dining_restaurant", null), "upscale_fine_dining");
});

Deno.test("derivePoolCategory: grocery_store → groceries (separate from flowers)", () => {
  assertStrictEquals(derivePoolCategory("grocery_store", null), "groceries");
});

Deno.test("derivePoolCategory: supermarket → groceries", () => {
  assertStrictEquals(derivePoolCategory("supermarket", null), "groceries");
});

Deno.test("derivePoolCategory: florist → flowers (florist-only, no grocery absorption)", () => {
  assertStrictEquals(derivePoolCategory("florist", null), "flowers");
});

Deno.test("derivePoolCategory: park → nature", () => {
  assertStrictEquals(derivePoolCategory("park", null), "nature");
});

Deno.test("derivePoolCategory: cafe → icebreakers", () => {
  assertStrictEquals(derivePoolCategory("cafe", null), "icebreakers");
});

Deno.test("derivePoolCategory: bar → drinks_and_music", () => {
  assertStrictEquals(derivePoolCategory("bar", null), "drinks_and_music");
});

Deno.test("derivePoolCategory: art_studio → creative_arts", () => {
  assertStrictEquals(derivePoolCategory("art_studio", null), "creative_arts");
});

Deno.test("derivePoolCategory: amusement_park → play", () => {
  assertStrictEquals(derivePoolCategory("amusement_park", null), "play");
});

Deno.test("derivePoolCategory: unknown type → null (Constitution #9: no fabrication)", () => {
  assertStrictEquals(derivePoolCategory("xyz_unknown", null), null);
});

Deno.test("derivePoolCategory: types[] fallback when primary is null", () => {
  assertStrictEquals(
    derivePoolCategory(null, ["unknown_x", "movie_theater"]),
    "movies_theatre",
  );
});

Deno.test("derivePoolCategory: all-null inputs → null", () => {
  assertStrictEquals(derivePoolCategory(null, null), null);
});

Deno.test("googleTypesForCategory: groceries returns [grocery_store, supermarket]", () => {
  const types = googleTypesForCategory("groceries");
  assertEquals(types.sort(), ["grocery_store", "supermarket"]);
});

Deno.test("googleTypesForCategory: flowers returns [florist] only (no grocery types)", () => {
  const types = googleTypesForCategory("flowers");
  assertEquals(types, ["florist"]);
});

Deno.test("googleTypesForCategory: unknown slug returns []", () => {
  assertEquals(googleTypesForCategory("nonexistent_slug"), []);
});

Deno.test("ALL_DERIVED_CATEGORY_SLUGS: contains exactly 10 canonical slugs", () => {
  assertStrictEquals(ALL_DERIVED_CATEGORY_SLUGS.length, 10);
  const expected = [
    "nature", "icebreakers", "drinks_and_music", "movies_theatre",
    "brunch_lunch_casual", "upscale_fine_dining", "creative_arts", "play",
    "groceries", "flowers",
  ];
  // Order matters per first-write-wins semantics
  assertEquals([...ALL_DERIVED_CATEGORY_SLUGS], expected);
});
```

### 4.4 — Edge function redeploy

**No source changes** to:
- `supabase/functions/admin-seed-places/index.ts`
- `supabase/functions/admin-refresh-places/index.ts`
- `supabase/functions/admin-place-search/index.ts`

Each imports `derivePoolCategory` (and `admin-refresh-places` also imports `googleTypesForCategory`). When deployed, Supabase bundles the imports — so a redeploy is required to pick up the new TS helper output. Operator runs:

```bash
cd c:/Users/user/Desktop/mingla-main
supabase functions deploy admin-seed-places admin-refresh-places admin-place-search
```

Expected output: `Deployed Functions on project gqnoajqerqhnvulmnyvv: admin-seed-places, admin-refresh-places, admin-place-search`.

---

## 5 — Success Criteria

| # | Criterion | Verification |
|---|---|---|
| SC-01 | New SQL helper returns ONLY values in canonical 10-slug set ∪ {NULL} for any input | 16 self-verify probes pass at migration time + step-4 post-refresh probe passes |
| SC-02 | Matview `admin_place_pool_mv.primary_category` post-refresh contains ONLY canonical 10 slugs ∪ {`'uncategorized'`} | step-4 DO block in migration assertion |
| SC-03 | Matview contains ≥1 row each for `'brunch_lunch_casual'`, `'movies_theatre'`, `'groceries'` (categories that were 0 pre-fix) | step-4 DO block in migration assertion |
| SC-04 | TS twin `derivePoolCategory.ts` returns canonical slugs for all 17 test inputs | unit test passes via `deno test` |
| SC-05 | TS unit test enforces I-CATEGORY-SLUG-CANONICAL: `for slug in ALL_DERIVED_CATEGORY_SLUGS: assert(Object.values(DISPLAY_TO_SLUG).includes(slug))` | unit test passes |
| SC-06 | All 3 admin edge functions redeploy successfully | `supabase functions deploy` returns 3 function names with no error |
| SC-07 | Admin Place Pool dashboard renders non-zero counts for Brunch+Lunch+Casual, Movies+Theatre, Groceries on Baltimore (city UUID `e079b4fc-121e-4a7a-ba46-082c90b5711a`) | manual visual check OR curl smoke per §7 |
| SC-08 | `admin-seed-places coverage_check` for Baltimore returns response with `coverage[]` items where every `categoryId` is in the canonical 10-slug set | curl smoke per §7 |
| SC-09 | Migration is atomic via BEGIN/COMMIT — fully rollbackable via single revert migration if needed | inspection of migration file |
| SC-10 | Live signature unchanged: `pg_get_function_arguments` returns `'p_primary_type text, p_types text[]'`, `pg_get_function_result` returns `'text'`, `provolatile='i'`, `proparallel='s'` | live SQL post-deploy |

If ANY criterion is partial/unverified, label as `implemented, partially verified` and enumerate the gap.

---

## 6 — Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | movie_theater derives to movies_theatre | SQL: `pg_map(...)` | `'movies_theatre'` | DB |
| T-02 | performing_arts_theater derives to movies_theatre | SQL: `pg_map(...)` | `'movies_theatre'` | DB |
| T-03 | italian_restaurant derives to brunch_lunch_casual | SQL: `pg_map(...)` | `'brunch_lunch_casual'` | DB |
| T-04 | american_restaurant derives to brunch_lunch_casual | SQL: `pg_map(...)` | `'brunch_lunch_casual'` | DB |
| T-05 | fine_dining_restaurant derives to upscale_fine_dining | SQL: `pg_map(...)` | `'upscale_fine_dining'` | DB |
| T-06 | grocery_store derives to groceries (NEW BEHAVIOR vs pre-fix) | SQL: `pg_map(...)` | `'groceries'` | DB |
| T-07 | supermarket derives to groceries (NEW BEHAVIOR) | SQL: `pg_map(...)` | `'groceries'` | DB |
| T-08 | florist derives to flowers (florist-only, no grocery absorption) | SQL: `pg_map(...)` | `'flowers'` | DB |
| T-09 | park derives to nature | SQL: `pg_map(...)` | `'nature'` | DB |
| T-10 | cafe derives to icebreakers | SQL: `pg_map(...)` | `'icebreakers'` | DB |
| T-11 | bar derives to drinks_and_music | SQL: `pg_map(...)` | `'drinks_and_music'` | DB |
| T-12 | art_studio derives to creative_arts | SQL: `pg_map(...)` | `'creative_arts'` | DB |
| T-13 | amusement_park derives to play | SQL: `pg_map(...)` | `'play'` | DB |
| T-14 | unknown type returns NULL (Constitution #9) | SQL: `pg_map('xyz', NULL)` | `NULL` | DB |
| T-15 | types[] fallback when primary is NULL | SQL: `pg_map(NULL, ARRAY['unknown_x','movie_theater'])` | `'movies_theatre'` | DB |
| T-16 | all-NULL inputs return NULL | SQL: `pg_map(NULL, NULL)` | `NULL` | DB |
| T-17 | TS twin returns same as SQL for italian_restaurant | TS: `derivePoolCategory('italian_restaurant', null)` | `'brunch_lunch_casual'` | TS |
| T-18 | TS twin returns same for grocery_store | TS: `derivePoolCategory('grocery_store', null)` | `'groceries'` | TS |
| T-19 | TS twin returns same for movie_theater | TS: `derivePoolCategory('movie_theater', null)` | `'movies_theatre'` | TS |
| T-20 | TS invariant: every helper output ∈ DISPLAY_TO_SLUG | unit test loop | all true | TS |
| T-21 | googleTypesForCategory('groceries') returns [grocery_store, supermarket] | TS function call | `['grocery_store', 'supermarket']` | TS |
| T-22 | googleTypesForCategory('flowers') returns [florist] only | TS function call | `['florist']` | TS |
| T-23 | ALL_DERIVED_CATEGORY_SLUGS has exactly 10 canonical slugs in correct order | TS export read | length=10, matches expected order | TS |
| T-24 | Live matview Baltimore shows non-zero brunch_lunch_casual | `SELECT COUNT(*) FROM admin_place_pool_mv WHERE city_id='e079b4fc-...' AND primary_category='brunch_lunch_casual'` | > 0 (estimated ~567) | Live DB |
| T-25 | Live matview Baltimore shows non-zero movies_theatre | same with `='movies_theatre'` | > 0 (estimated ~53) | Live DB |
| T-26 | Live matview Baltimore shows non-zero groceries | same with `='groceries'` | > 0 (estimated 3-10) | Live DB |
| T-27 | Live matview holds zero rows with non-canonical slugs | `SELECT COUNT(*) FROM admin_place_pool_mv WHERE primary_category NOT IN (10 canonical ∪ 'uncategorized')` | 0 | Live DB |
| T-28 | admin-seed-places coverage_check returns canonical slugs only | curl `coverage_check` for Baltimore; assert all `coverage[].categoryId` ∈ canonical 10 | all canonical | Edge function |
| T-29 | admin-refresh-places preview_refresh_cost breakdown uses canonical slugs | curl `preview_refresh_cost` for Baltimore with `filterCategories=['nature','brunch_lunch_casual']`; assert response.breakdown[].category ∈ canonical 10 ∪ {'(uncategorized)'} | all canonical | Edge function |
| T-30 | Admin Place Pool dashboard renders non-zero for 3 previously-broken cells | Open dashboard for Baltimore; visually inspect Brunch+Casual, Movies+Theatre, Groceries | non-zero numbers visible | Manual UI |

**Test coverage:** every SC has at least one test. T-01..T-16 = SC-01 + SC-02 + SC-03. T-17..T-23 = SC-04 + SC-05. SC-06 is verified by deploy command output. SC-07 = T-30. SC-08 = T-28. SC-09 = file inspection. SC-10 = post-deploy SQL.

---

## 7 — Smoke Verification (post-deploy)

Operator runs these AFTER migration applies + edge functions redeploy:

### Smoke A — Live matview group-by

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/database/query" \
  -H "Authorization: Bearer sbp_5411a6829489687c518fd98434d7be387c865577" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT primary_category, COUNT(*) FROM admin_place_pool_mv WHERE city_id='\''e079b4fc-121e-4a7a-ba46-082c90b5711a'\'' AND is_active GROUP BY primary_category ORDER BY 2 DESC;"}'
```

**Pass criteria:** result includes rows for `brunch_lunch_casual`, `movies_theatre`, `groceries` with positive counts. NO rows for `brunch`, `casual_food`, `movies`, `theatre` (those slugs should not exist post-fix).

### Smoke B — admin-seed-places coverage_check

```bash
curl -s -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/admin-seed-places" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"coverage_check","cityId":"e079b4fc-121e-4a7a-ba46-082c90b5711a"}'
```

**Pass criteria:** HTTP 200; `coverage[].categoryId` values all in canonical 10-slug set. Counts for `brunch_lunch_casual`, `movies_theatre`, `groceries` are > 0.

### Smoke C — Admin Place Pool dashboard visual

Open https://[admin-dashboard-url]/place-pool, select Baltimore. Categories block shows non-zero counts for Brunch+Lunch+Casual, Movies+Theatre, Groceries.

**Pass criteria:** all 3 previously-broken cells render numbers > 0.

---

## 8 — Implementation Order

1. Implementor authors the SQL migration file at the exact path: `supabase/migrations/20260503000007_orch_0700_helper_canonical_taxonomy_fix.sql`. Body per §4.1.
2. Implementor replaces `supabase/functions/_shared/derivePoolCategory.ts` with the body in §4.2.
3. Implementor creates the new test file `supabase/functions/_shared/__tests__/derivePoolCategory_canonical.test.ts` with the body in §4.3.
4. Implementor runs `deno test supabase/functions/_shared/__tests__/derivePoolCategory_canonical.test.ts` locally (or notes if deno not on PATH and labels SC-04/SC-05 as `partially verified`). All tests must pass before deploy.
5. Operator runs `supabase db push --include-all` — applies the migration. The 16 self-verify probes + matview-refresh-assertion run inside the migration; if any fails, the entire transaction rolls back and the helper is unchanged.
6. Operator runs `supabase functions deploy admin-seed-places admin-refresh-places admin-place-search` — picks up the new TS helper output.
7. Operator runs Smoke A + Smoke B + Smoke C per §7.
8. Implementor reports back to orchestrator with success/failure per each SC, plus pasted output of: deno test, migration apply NOTICE messages, deploy command, all 3 smokes.

---

## 9 — Invariants

### Existing invariants this spec preserves

- **Constitution #2 (one owner per truth):** `admin_place_pool_mv.primary_category` post-fix has a single, well-defined meaning (the canonical display slug). No ambiguity. ✅
- **Constitution #9 (no fabricated data):** helper returns NULL for unknown types, not a default like `'unknown'`. ✅
- **Constitution #13 (exclusion consistency):** SQL helper, TS twin, and matview all emit the same canonical 10-slug set. ✅
- **I-MIGRATION-LIVE-SIGNATURE-CHECK:** new helper preserves the live signature byte-for-byte (`(p_primary_type text, p_types text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE`). Verified live before drafting. ✅
- **I-CURATED-LABEL-SOURCE:** untouched (curated experience pipeline doesn't read this helper). ✅

### NEW invariant established by this spec (orchestrator codifies in INVARIANT_REGISTRY at CLOSE)

- **I-CATEGORY-SLUG-CANONICAL:** any helper function (SQL, TS, or other) that produces a category slug for a place_pool row MUST return a value within the canonical 10-slug set defined by `Object.values(DISPLAY_TO_SLUG)` in `categoryPlaceTypes.ts`. NULL is acceptable. Backed by:
  - SQL self-verify probes (16 probes) in helper migration
  - TS unit test (`derivePoolCategory_canonical.test.ts`)
  - Matview post-refresh assertion (Step 4 in helper migration)

  Established 2026-05-03 after ORCH-0700 Phase 3B regression where the SQL helper invented an 11-slug taxonomy that didn't match any consumer.

---

## 10 — Regression Prevention

The class of bug being fixed: **a derivation helper produces values that no consumer can resolve.**

Three structural safeguards prevent recurrence:

1. **SQL probe** (in helper migration body, Step 2) — runtime check at migration apply time. If any of the 16 expected (input, output) pairs disagrees, migration aborts.
2. **Matview post-refresh probe** (in helper migration body, Step 4) — data check at migration apply time. If any matview row holds a non-canonical slug, migration aborts.
3. **TS unit test** (`derivePoolCategory_canonical.test.ts`) — code check at test time. If anyone adds a new bucket to `ORDERED_BUCKETS` whose slug isn't in `DISPLAY_TO_SLUG`, test fails immediately.

Protective comments in derivePoolCategory.ts header explicitly state the three-layer invariant.

---

## 11 — Failure Modes & Rollback

### If the migration's self-verify probes fail
- Entire transaction rolls back via BEGIN/COMMIT. Helper remains in current (broken) state. No data change.
- Implementor reports the specific failed probe + which slug + which expected value.
- Orchestrator decides: fix the spec (probe was wrong) or fix the implementation (helper body has a typo).

### If the matview post-refresh probe fails (non-canonical slug present)
- Migration rolls back. Helper unchanged. Matview unchanged.
- Means the helper body is emitting a slug we didn't expect — implementor reviews the CASE chain for typos.

### If `deno test` fails
- Implementor does not deploy. Reports failing assertion.
- Likely cause: TS twin doesn't match SQL helper, OR new bucket slug isn't in DISPLAY_TO_SLUG.

### If `supabase functions deploy` fails
- Edge functions remain on prior version (broken helper output continues). DB migration ALREADY applied (helper + matview now correct).
- Operator can re-attempt deploy without DB rollback. Cron-driven matview refresh continues working correctly even with prior edge function code (because admin RPCs read the matview directly, not via TS helper).

### If smoke shows wrong numbers post-deploy
- Implementor inspects:
  - Did matview refresh succeed? Check live `SELECT primary_category, COUNT(*) FROM admin_place_pool_mv` distribution.
  - Did edge functions actually pick up new TS helper? Check deploy timestamp; redeploy if needed.
  - Is admin UI cache stale? Hard-refresh browser.

### Full rollback procedure
If the operator decides to undo Phase 3B entirely:

```sql
-- Revert to pre-Phase-3B helper (the original Migration 1 body — 11-slug taxonomy)
-- (Implementor must commit this rollback migration as 20260503000008_orch_0700_revert_phase_3b.sql
--  if rollback is invoked; orchestrator approves rollback explicitly.)
```

Plus revert `derivePoolCategory.ts` and delete the new unit test. Edge functions auto-recover on next deploy.

---

## 12 — Discoveries for Orchestrator

(Already flagged by prior investigations — re-confirming for traceability.)

1. **🟡 ORCH-0597/0598 display split is incomplete** — `categoryPlaceTypes.ts` `DISPLAY_TO_SLUG` still maps combined display names to combined slugs. New display names `'Brunch'`, `'Casual'`, `'Movies'`, `'Theatre'` exist in `MINGLA_CATEGORY_PLACE_TYPES` keys but have NO entries in `DISPLAY_TO_SLUG`. If/when this split lands, the helper will need rewriting again. Not this spec's job per dispatch §Out of Scope.
2. **🟡 `useMapCards.ts:8-12` stale 12-category list** — separate dispatch.
3. **🟡 GRANT-preservation invariant on matview rebuilds** — Migration 4 only worked because the migration role IS postgres. Codify "matview rebuilds must explicitly re-issue GRANTs" in INVARIANT_REGISTRY.
4. **🟢 Migration 1's misleading WARNING comment is fixed by this spec.** New COMMENT ON FUNCTION text explicitly states the canonical authority is `DISPLAY_TO_SLUG`, not the TS function `mapPrimaryTypeToMinglaCategory`.
5. **🆕 NEW invariant `I-CATEGORY-SLUG-CANONICAL`** — orchestrator codifies in INVARIANT_REGISTRY at CLOSE.

---

## 13 — Estimated Effort + Risk

- **Wall clock:** 1.5–2 hours end-to-end (implementor authoring + operator apply + smoke).
- **Risk:** LOW.
  - Atomic migration with BEGIN/COMMIT
  - 16 SQL self-verify probes prevent shipping a broken helper
  - Matview post-refresh probe prevents shipping bad data
  - Unit test prevents code-level drift
  - Fully rollbackable
- **Cron collision risk:** LOW. Matview refresh on ~70K rows takes seconds. If cron job 13 collides, one tick fails and the next succeeds 10 min later.
- **Reversibility:** Easy. One migration to undo (re-apply prior helper body) + revert TS twin + delete unit test.

---

**END OF SPEC**

Implementor reads this spec, executes Steps 1–4 of Implementation Order (§8), reports back. Operator runs Steps 5–7. Orchestrator gates the close.
