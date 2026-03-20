# Feature: Admin Pool Management System
**Date:** 2026-03-20
**Status:** Design Review (Rev 2)
**Mode:** Feature — Full Design

**Revision 2 changelog:** Applied 8 corrections from SPECER_REVISION_ADMIN_POOL.md:
- [C1] Removed all no-rating rejection references
- [C2] Live Performance is its own app category (not mapped to Watch)
- [C3] 13 seeding categories → 13 app categories (not 12)
- [C4] Map view included from day one (removed from non-goals)
- [C5] $70 hard cap per city launch
- [C6] dog_park added to global exclusions
- [C7] Detailed structured error logging at every seeding step
- [C8] All 13 category configs use exact includedTypes/excludedPrimaryTypes from architect prompt
- [PB] Photo backfill granularity verified (tile, category, rating, impression priority, partial batch, cost estimate)

---

## 1. Summary

Replace the fragmented admin experience (PlacePoolBuilderPage + CityLauncherPage + PhotoPoolManagementPage) with two focused pages: **Place Pool Management** and **Card Pool Management**. The new system introduces a proprietary city+tile grid for systematic seeding using Google Nearby Search (not Text Search), per-category search configs with `includedTypes`/`excludedPrimaryTypes`, pre-operation cost estimation with a **$70 hard cap per city launch** <!-- [C5] -->, an integrated **map view** <!-- [C4] -->, and integrated photo management. Card Pool Management becomes the single pane for card generation controls, gap analysis, and city launch readiness.

## 2. Design Principle

**Places are the raw material; cards are the product. The admin pipeline is: validate city → tile → seed → photo → generate cards → assess readiness → launch.** Every operation shows its cost before executing. Every result is logged with structured error details <!-- [C7] -->. No implicit behavior.

## 3. Source of Truth Definition

| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| Place data | `place_pool` table | Google Places API | 7-day staleTime | Yes (re-fetch from Google) |
| Card data | `card_pool` table | `place_pool` + generation logic | No TTL (manual) | Yes (regenerate from place_pool) |
| City definition | `seeding_cities` table (NEW) | Admin input | N/A | No (manual) |
| Tile grid | `seeding_tiles` table (NEW) | Computed from city bounds | N/A | Yes (recompute from city) |
| Seeding config | `seedingCategoryConfigs.ts` constant <!-- [C8] --> | Architect prompt | N/A | N/A |
| Seeding operation log | `seeding_operations` table (NEW) | Runtime results | N/A | No (historical record) |
| Photo coverage | `stored_photo_urls` on `place_pool` | Photo pipeline | N/A | Yes (re-download) |

## 4. Success Criteria

1. Admin can define a city (name, country, center lat/lng, radius) and the system generates a tile grid
2. Admin can preview tile count and estimated cost before seeding
3. Cost estimate enforces **$70 hard cap** — warning shown if estimate exceeds $70 <!-- [C5] -->
4. Seeding uses Google Nearby Search with exact `includedTypes`/`excludedPrimaryTypes` per category
5. Places with zero Google photo references are rejected at seed time
6. Every seeding operation logs: tiles searched, places found, places rejected (no photos/closed), places new vs duplicate, cost incurred, and **structured error details per tile/category** <!-- [C7] -->
7. Place Pool page shows per-city and per-tile stats, filters, management, and **map view** <!-- [C4] -->
8. Card Pool page shows generation controls, gap analysis, and readiness checklist per city
9. Photo management is integrated into Place Pool (not a separate page)
10. Edit modal works (writes only existing columns, uses admin RPC)
11. All stats use server-side RPCs (no client-side fetch-all)

## 5. Non-Goals

1. Automated scheduling of seeding operations (manual trigger only for now)
2. Real-time Google quota monitoring (admin tracks monthly budget manually)
3. Changing the mobile app's card-serving logic
4. Modifying the `categoryPlaceTypes.ts` mappings (seeding configs are separate from serve-time configs)
<!-- [C4] Map view REMOVED from non-goals — now included in day-one scope -->

---

## 6. Tile System Design

### 6.1 What Is a Tile?

A tile is a circle defined by `(center_lat, center_lng, radius_meters)`. It maps directly to Google Nearby Search's `locationRestriction.circle` parameter. Each tile × category = one Google API call returning up to 20 places.

### 6.2 Grid Generation Algorithm

Given a city's `center_lat`, `center_lng`, and `coverage_radius_km`:

1. Convert `coverage_radius_km` to a bounding box (lat/lng bounds)
2. Choose `tile_radius_m` (default: 1500m = 1.5km). This is the Google search radius per tile
3. Compute tile spacing = `tile_radius_m * 1.4` (slight overlap for coverage, hexagonal-ish packing)
4. Generate a grid of tile centers within the bounding box
5. Filter out tiles whose center is outside the city's coverage circle
6. Store tiles in `seeding_tiles` table

### 6.3 Tile Size ↔ Coverage ↔ Cost Tradeoffs

| Tile Radius | Tile Area | Tiles for 10km city | API calls (13 cats) | Search cost | Coverage quality |
|-------------|-----------|--------------------|--------------------|-------------|-----------------|
| 500m | 0.79 km² | ~127 | 1,651 | $52.83 | Exhaustive — finds niche places |
| 1000m | 3.14 km² | ~32 | 416 | $13.31 | Good — misses only very dense pockets |
| 1500m | 7.07 km² | ~16 | 208 | $6.66 | Balanced — recommended default |
| 2000m | 12.57 km² | ~9 | 117 | $3.74 | Economy — top 20 per large area |
| 5000m | 78.54 km² | ~2 | 26 | $0.83 | Minimal — equivalent to current single-point search |

**Recommended default: 1500m.** Balances coverage with cost. Admin can override per city.

### 6.4 Why Not Text Search?

Current system uses Text Search (`"Restaurants in Lagos"`). Problems:
- No radius control — Google picks its own area
- No `includedTypes` / `excludedPrimaryTypes` — relies on NLP parsing the text
- lat/lng parameters are silently ignored (confirmed in investigation)
- 20 results with no pagination and no way to shift the geographic window
- Ambiguous city names ("Lagos" could be Portugal or Nigeria)

Nearby Search with tiles solves all of these. Each tile is a precise geographic circle with explicit type filtering.

---

## 7. Seeding Category Configurations

### 7.1 Seeding Categories = App Categories (1:1 Mapping)

<!-- [C2][C3] CORRECTED: 13 seeding categories map 1:1 to 13 app categories. Live Performance is its own app category. Groceries is hidden from users but exists as an app category. -->

There are **13 seeding categories and 13 app categories**. Each seeding category maps directly to its own app category. Groceries is hidden from user-facing UI but exists as an app category in the system.

| # | Seeding Category | App Category | Notes |
|---|-----------------|-------------|-------|
| 1 | Nature & Views | Nature & Views | Direct mapping |
| 2 | First Meet | First Meet | Direct mapping |
| 3 | Picnic Park | Picnic Park | Direct mapping |
| 4 | Drink | Drink | Direct mapping |
| 5 | Casual Eats | Casual Eats | Direct mapping |
| 6 | Fine Dining | Fine Dining | Direct mapping |
| 7 | Watch | Watch | Movie theaters |
| 8 | Live Performance | Live Performance | Performing arts — **own app category, NOT Watch** |
| 9 | Creative & Arts | Creative & Arts | Direct mapping |
| 10 | Play | Play | Direct mapping |
| 11 | Wellness | Wellness | Direct mapping |
| 12 | Flowers | Flowers | Florists + grocery stores with flowers |
| 13 | Groceries | Groceries | Hidden from users but tracked in system |

### 7.2 Config Structure and Exact Definitions

<!-- [C8] All 13 configs below use the exact includedTypes/excludedPrimaryTypes from the architect prompt. These are the single source of truth, defined in `seedingCategoryConfigs.ts`. -->

Each seeding category config contains:
- `includedTypes`: Google Nearby Search types to include
- `excludedPrimaryTypes`: Google Nearby Search types to exclude by primaryType
- `appCategory`: The Mingla app category (same name — 1:1 mapping)
- `appCategorySlug`: The slug form (for filtering)

These are defined as a constant in `seedingCategoryConfigs.ts` — **shared by the edge function and admin UI**. Single source of truth.

#### Nature & Views
```json
{
  "includedTypes": ["beach", "botanical_garden", "garden", "hiking_area", "national_park", "nature_preserve", "park", "scenic_spot", "state_park", "observation_deck", "tourist_attraction"],
  "excludedPrimaryTypes": ["dog_park", "fitness_center", "gym", "community_center", "sports_complex", "sports_club", "playground", "athletic_field", "skateboard_park", "swimming_pool", "tennis_court", "cycling_park", "off_roading_area", "campground", "rv_park", "barbecue_area", "public_bath", "public_bathroom", "stable", "fishing_pond", "fishing_pier"]
}
```

#### First Meet
```json
{
  "includedTypes": ["book_store", "cafe", "coffee_shop", "tea_house", "bakery", "dessert_shop", "juice_shop", "bistro", "wine_bar", "lounge_bar"],
  "excludedPrimaryTypes": ["night_club", "sports_bar", "bar", "bar_and_grill", "pub", "restaurant", "fine_dining_restaurant", "fast_food_restaurant", "movie_theater", "bowling_alley", "karaoke", "concert_hall", "live_music_venue", "amusement_center", "video_arcade", "gym", "fitness_center", "coworking_space", "corporate_office", "shopping_mall"]
}
```

#### Picnic Park
```json
{
  "includedTypes": ["picnic_ground", "park"],
  "excludedPrimaryTypes": ["dog_park", "playground", "athletic_field", "sports_complex", "sports_club", "fitness_center", "gym", "skateboard_park", "swimming_pool", "tennis_court", "cycling_park", "off_roading_area", "campground", "rv_park", "barbecue_area", "community_center", "public_bath", "public_bathroom", "stable", "fishing_pond", "fishing_pier"]
}
```

#### Drink
```json
{
  "includedTypes": ["bar", "cocktail_bar", "lounge_bar", "wine_bar", "pub", "brewery", "beer_garden", "brewpub"],
  "excludedPrimaryTypes": ["night_club", "sports_bar", "restaurant", "fine_dining_restaurant", "fast_food_restaurant", "cafe", "coffee_shop", "tea_house", "bakery", "dessert_shop", "juice_shop", "movie_theater", "bowling_alley", "karaoke", "concert_hall", "live_music_venue", "amusement_center", "video_arcade", "gym", "fitness_center", "shopping_mall", "corporate_office", "coworking_space"]
}
```

#### Casual Eats
```json
{
  "includedTypes": ["restaurant", "bistro", "brunch_restaurant", "breakfast_restaurant", "diner", "cafe", "coffee_shop", "sandwich_shop", "pizza_restaurant", "hamburger_restaurant", "mexican_restaurant", "mediterranean_restaurant", "thai_restaurant", "vegetarian_restaurant"],
  "excludedPrimaryTypes": ["fine_dining_restaurant", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "night_club", "sports_bar", "fast_food_restaurant", "movie_theater", "bowling_alley", "karaoke", "concert_hall", "live_music_venue", "amusement_center", "video_arcade", "gym", "fitness_center", "shopping_mall", "corporate_office", "coworking_space"]
}
```

#### Fine Dining
```json
{
  "includedTypes": ["fine_dining_restaurant", "french_restaurant", "italian_restaurant", "steak_house", "seafood_restaurant", "wine_bar"],
  "excludedPrimaryTypes": ["fast_food_restaurant", "cafe", "coffee_shop", "tea_house", "bakery", "dessert_shop", "juice_shop", "bar", "sports_bar", "pub", "night_club", "movie_theater", "bowling_alley", "karaoke", "amusement_center", "video_arcade", "shopping_mall", "corporate_office", "coworking_space"]
}
```

#### Watch
```json
{
  "includedTypes": ["movie_theater"],
  "excludedPrimaryTypes": ["museum", "art_gallery", "art_museum", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "night_club", "restaurant", "fine_dining_restaurant", "fast_food_restaurant", "bowling_alley", "karaoke", "amusement_center", "video_arcade", "gym", "fitness_center", "shopping_mall", "corporate_office", "coworking_space"]
}
```

#### Live Performance
<!-- [C2] Own app category — NOT mapped to Watch -->
```json
{
  "includedTypes": ["performing_arts_theater", "concert_hall", "opera_house", "philharmonic_hall", "amphitheatre"],
  "excludedPrimaryTypes": ["museum", "art_gallery", "art_museum", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "video_arcade", "gym", "fitness_center", "shopping_mall", "corporate_office", "coworking_space"]
}
```

#### Creative & Arts
```json
{
  "includedTypes": ["art_gallery", "art_museum", "art_studio", "museum", "history_museum", "performing_arts_theater", "cultural_center", "cultural_landmark", "sculpture"],
  "excludedPrimaryTypes": ["movie_theater", "concert_hall", "opera_house", "philharmonic_hall", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "night_club", "restaurant", "fine_dining_restaurant", "fast_food_restaurant", "gym", "fitness_center", "shopping_mall", "corporate_office", "coworking_space", "park", "beach", "scenic_spot"]
}
```

#### Play
```json
{
  "includedTypes": ["amusement_center", "bowling_alley", "miniature_golf_course", "go_karting_venue", "paintball_center", "video_arcade", "karaoke", "amusement_park"],
  "excludedPrimaryTypes": ["movie_theater", "performing_arts_theater", "concert_hall", "opera_house", "philharmonic_hall", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "night_club", "restaurant", "fine_dining_restaurant", "fast_food_restaurant", "gym", "fitness_center", "shopping_mall", "corporate_office", "coworking_space", "park", "beach", "scenic_spot"]
}
```

#### Wellness
```json
{
  "includedTypes": ["spa", "massage_spa", "sauna", "wellness_center", "yoga_studio"],
  "excludedPrimaryTypes": ["gym", "fitness_center", "sports_club", "swimming_pool", "restaurant", "fine_dining_restaurant", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "night_club", "movie_theater", "museum", "art_gallery", "shopping_mall", "corporate_office", "coworking_space", "park", "beach"]
}
```

#### Flowers
```json
{
  "includedTypes": ["florist", "grocery_store", "supermarket"],
  "excludedPrimaryTypes": ["market", "shopping_mall", "store", "restaurant", "fine_dining_restaurant", "bar", "cocktail_bar", "lounge_bar", "wine_bar", "night_club", "movie_theater", "museum", "art_gallery", "gym", "fitness_center", "corporate_office", "coworking_space"]
}
```

#### Groceries
```json
{
  "includedTypes": ["grocery_store", "supermarket"],
  "excludedPrimaryTypes": ["florist", "garden_center", "restaurant", "fine_dining_restaurant", "fast_food_restaurant", "cafe", "coffee_shop", "tea_house", "bakery", "market", "food_store", "farmers_market", "health_food_store", "asian_grocery_store", "dessert_shop", "juice_shop", "liquor_store", "shopping_mall", "store", "department_store", "discount_store", "convenience_store", "corporate_office", "coworking_space"]
}
```

### 7.3 Global Excluded Place Types

<!-- [C6] dog_park added to global exclusions -->

In addition to per-category `excludedPrimaryTypes`, the following types are **globally excluded** from ALL seeding operations. Any place whose `primaryType` matches is rejected before upsert, regardless of category:

```typescript
const GLOBAL_EXCLUDED_PLACE_TYPES = [
  'gym',
  'fitness_center',
  'dog_park',  // [C6]
];
```

These are also enforced in `query_pool_cards` via the `v_excluded_types` SQL array:

```sql
v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park'];
```

### 7.4 How Seeding Uses the Config

For each tile × seeding category:

```
POST https://places.googleapis.com/v1/places:searchNearby

{
  "includedTypes": config.includedTypes,
  "excludedPrimaryTypes": config.excludedPrimaryTypes,
  "maxResultCount": 20,
  "locationRestriction": {
    "circle": {
      "center": { "latitude": tile.center_lat, "longitude": tile.center_lng },
      "radius": tile.radius_m
    }
  },
  "rankPreference": "POPULARITY"
}
```

Field mask: `places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours,places.photos,places.websiteUri,places.businessStatus`

Note: `places.businessStatus` added (Basic tier, free) to filter out permanently closed businesses.

### 7.5 Post-Fetch Filters (Before Upsert)

<!-- [C1] All "no rating" rejection references removed. Only two rejection criteria remain. -->

Every result goes through these filters before being offered for import:
1. **Reject if `businessStatus === "CLOSED_PERMANENTLY"`**
2. **Reject if no `photos` array or `photos.length === 0`** (no Google photo references)
3. **Reject if `primaryType` is in `GLOBAL_EXCLUDED_PLACE_TYPES`** <!-- [C6] -->

Places without ratings are **allowed** — new/niche places should not be excluded for lacking reviews.

These rejections are counted in the operation log but never inserted into place_pool.

---

## 8. Database Changes

### 8.1 New Table: `seeding_cities`

```sql
CREATE TABLE IF NOT EXISTS public.seeding_cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT NOT NULL UNIQUE,  -- Google Place ID from Autocomplete (validates city is real)
  name TEXT NOT NULL,                    -- verified display name from Google
  country TEXT NOT NULL,                 -- verified country name from Google
  country_code TEXT,                     -- ISO 3166-1 alpha-2 (e.g., "NG", "US")
  center_lat DOUBLE PRECISION NOT NULL,  -- from Google Geocoding (not manual entry)
  center_lng DOUBLE PRECISION NOT NULL,  -- from Google Geocoding (not manual entry)
  coverage_radius_km DOUBLE PRECISION NOT NULL DEFAULT 10,
  tile_radius_m INTEGER NOT NULL DEFAULT 1500,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'seeding', 'seeded', 'launched')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (name, country)
);

ALTER TABLE public.seeding_cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seeding_cities" ON public.seeding_cities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_seeding_cities" ON public.seeding_cities
  FOR SELECT USING (auth.role() = 'authenticated');
```

### 8.2 New Table: `seeding_tiles`

```sql
CREATE TABLE IF NOT EXISTS public.seeding_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES public.seeding_cities(id) ON DELETE CASCADE,
  tile_index INTEGER NOT NULL,           -- sequential index within city grid
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,              -- grid row
  col_idx INTEGER NOT NULL,              -- grid column
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (city_id, tile_index)
);

CREATE INDEX idx_seeding_tiles_city ON public.seeding_tiles (city_id);

ALTER TABLE public.seeding_tiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seeding_tiles" ON public.seeding_tiles
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_seeding_tiles" ON public.seeding_tiles
  FOR SELECT USING (auth.role() = 'authenticated');
```

### 8.3 New Table: `seeding_operations`

<!-- [C1] Removed places_rejected_no_rating column. [C7] Added error_details JSONB for structured error logging. -->

```sql
CREATE TABLE IF NOT EXISTS public.seeding_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES public.seeding_cities(id) ON DELETE CASCADE,
  tile_id UUID REFERENCES public.seeding_tiles(id) ON DELETE SET NULL,
  seeding_category TEXT NOT NULL,        -- the 13-category seeding config name
  app_category TEXT NOT NULL,            -- the Mingla app category it maps to
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Results
  google_api_calls INTEGER NOT NULL DEFAULT 0,
  places_returned INTEGER NOT NULL DEFAULT 0,
  places_rejected_no_photos INTEGER NOT NULL DEFAULT 0,
  places_rejected_closed INTEGER NOT NULL DEFAULT 0,
  places_rejected_excluded_type INTEGER NOT NULL DEFAULT 0,  -- [C6] global exclusions
  places_new_inserted INTEGER NOT NULL DEFAULT 0,
  places_duplicate_skipped INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Error tracking [C7]
  error_message TEXT,                    -- human-readable summary
  error_details JSONB,                   -- structured error log (see §8.3.1)

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_operations_city ON public.seeding_operations (city_id);
CREATE INDEX idx_seeding_operations_status ON public.seeding_operations (status);

ALTER TABLE public.seeding_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_seeding_operations" ON public.seeding_operations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_seeding_operations" ON public.seeding_operations
  FOR SELECT USING (auth.role() = 'authenticated');
```

#### 8.3.1 Structured Error Details Schema <!-- [C7] -->

The `error_details` JSONB column stores a structured log of all errors encountered during a seeding operation. Format:

```typescript
interface SeedingErrorDetails {
  tile_errors: Array<{
    tile_id: string;
    tile_index: number;
    category: string;
    error_type: 'google_api' | 'timeout' | 'parse' | 'upsert' | 'unknown';
    http_status?: number;         // Google API HTTP status code
    response_body?: string;       // Google API error response (truncated to 500 chars)
    message: string;              // human-readable error description
    timestamp: string;            // ISO 8601
  }>;
  summary: {
    total_tile_calls: number;
    successful_calls: number;
    failed_calls: number;
    error_types: Record<string, number>;  // count per error_type
  };
}
```

This ensures every failure is traceable to a specific tile + category + error type. The admin UI reads `error_details` to show inline error breakdowns (not just a generic "failed" badge).

### 8.4 Modified Table: `place_pool` — Add `city_id` and `country` Columns

```sql
-- Add city_id FK to link places to their seeding city
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.seeding_cities(id) ON DELETE SET NULL;

-- Add country column (parsed from Google formattedAddress at import time)
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS country TEXT;

-- Add seeding_category column (which of the 13 seeding categories found this place)
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS seeding_category TEXT;

-- Index for city-based queries
CREATE INDEX IF NOT EXISTS idx_place_pool_city_id ON public.place_pool (city_id);
CREATE INDEX IF NOT EXISTS idx_place_pool_country ON public.place_pool (country);
```

**Backfill strategy for existing places:**
- `city_id`: NULL for existing places (they weren't seeded through the tile system)
- `country`: Parse from existing `address` field using last comma-separated part. Run a one-time backfill query.
- `seeding_category`: NULL for existing places

### 8.5 New RPC: `admin_edit_place`

Replaces the broken direct-update pattern. Uses SECURITY DEFINER to bypass RLS.

```sql
CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id UUID,
  p_name TEXT DEFAULT NULL,
  p_price_tier TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Build dynamic update (only non-null params)
  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = COALESCE(p_price_tier, price_tier),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object('id', id, 'name', name, 'price_tier', price_tier, 'is_active', is_active)
  INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Place not found: %', p_place_id;
  END IF;

  -- Cascade is_active changes to cards
  IF p_is_active IS NOT NULL THEN
    UPDATE public.card_pool
    SET is_active = p_is_active, updated_at = now()
    WHERE place_pool_id = p_place_id;
  END IF;

  RETURN v_result;
END;
$$;
```

### 8.6 New RPCs: City Stats and Tile Stats

```sql
-- City-level stats for Place Pool Management
CREATE OR REPLACE FUNCTION public.admin_city_place_stats(p_city_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_places', COUNT(*) FILTER (WHERE is_active),
    'inactive_places', COUNT(*) FILTER (WHERE NOT is_active),
    'avg_rating', ROUND(AVG(rating) FILTER (WHERE is_active AND rating IS NOT NULL)::numeric, 2),
    'with_photos', COUNT(*) FILTER (WHERE is_active AND stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0),
    'without_photos', COUNT(*) FILTER (WHERE is_active AND (stored_photo_urls IS NULL OR array_length(stored_photo_urls, 1) IS NULL)),
    'stale_count', COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '7 days'),
    'by_seeding_category', (
      SELECT jsonb_object_agg(
        COALESCE(seeding_category, 'unknown'),
        jsonb_build_object('count', cnt, 'with_photos', photo_cnt)
      )
      FROM (
        SELECT seeding_category,
               COUNT(*) as cnt,
               COUNT(*) FILTER (WHERE stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0) as photo_cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY seeding_category
      ) sub
    ),
    'price_tier_distribution', (
      SELECT jsonb_object_agg(COALESCE(price_tier, 'unknown'), cnt)
      FROM (
        SELECT price_tier, COUNT(*) as cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY price_tier
      ) sub
    )
  ) INTO v_result
  FROM public.place_pool
  WHERE city_id = p_city_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Card pool stats per city (for Card Pool Management)
-- [C3] Updated to use 13 app categories
CREATE OR REPLACE FUNCTION public.admin_city_card_stats(p_city_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_single_cards', COUNT(*) FILTER (WHERE c.card_type = 'single' AND c.is_active),
    'total_curated_cards', COUNT(*) FILTER (WHERE c.card_type = 'curated' AND c.is_active),
    'inactive_cards', COUNT(*) FILTER (WHERE NOT c.is_active),
    'cards_with_photos', COUNT(*) FILTER (WHERE c.is_active AND c.image_url IS NOT NULL),
    'cards_without_photos', COUNT(*) FILTER (WHERE c.is_active AND c.image_url IS NULL),
    'by_category', (
      SELECT jsonb_object_agg(category, cnt)
      FROM (
        SELECT c2.category, COUNT(*) as cnt
        FROM public.card_pool c2
        JOIN public.place_pool p2 ON c2.place_pool_id = p2.id
        WHERE p2.city_id = p_city_id AND c2.is_active
        GROUP BY c2.category
      ) sub
    ),
    'places_without_cards', (
      SELECT COUNT(*)
      FROM public.place_pool p3
      LEFT JOIN public.card_pool c3 ON c3.place_pool_id = p3.id AND c3.is_active
      WHERE p3.city_id = p_city_id AND p3.is_active AND c3.id IS NULL
    )
  ) INTO v_result
  FROM public.card_pool c
  JOIN public.place_pool p ON c.place_pool_id = p.id
  WHERE p.city_id = p_city_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;
```

### 8.7 Data Integrity Guarantees

| Invariant | Enforced By | Layer |
|-----------|------------|-------|
| No duplicate places | `google_place_id UNIQUE` on place_pool | Schema |
| Every tile belongs to a city | `city_id NOT NULL FK` on seeding_tiles | Schema |
| Seeding operation status is bounded | CHECK constraint on seeding_operations.status | Schema |
| City status is bounded | CHECK constraint on seeding_cities.status | Schema |
| Card cascades on place deactivation | `admin_edit_place` RPC + existing deactivate RPCs | Code (SECURITY DEFINER) |
| No place without photo refs at seed time | Post-fetch filter in edge function | Code |
| No globally excluded types seeded | Post-fetch filter + `GLOBAL_EXCLUDED_PLACE_TYPES` | Code |
| Places link to city | `city_id FK` on place_pool, SET NULL on delete | Schema |
| Tiles cleaned up with city | `city_id FK CASCADE` on seeding_tiles | Schema |
| Operations tracked per city | `city_id FK CASCADE` on seeding_operations | Schema |
| City launch cost ≤ $70 | UI warning + confirmation gate | Code (admin UI) |

---

## 9. Edge Function Changes

### 9.1 New Edge Function: `admin-seed-places`

**Purpose:** Replaces the search functionality of `admin-place-search` for structured seeding. Uses Nearby Search with tile geometry and per-category configs.

**File path:** `supabase/functions/admin-seed-places/index.ts`
**Method:** POST | **Auth:** Required (admin check) | **Idempotent:** Yes (upsert on google_place_id)

**Shared config file:** `supabase/functions/_shared/seedingCategoryConfigs.ts` <!-- [C8] — single source of truth for all 13 category configs -->

**Actions:**

#### `action: "generate_tiles"`
Generate tile grid for a city.

Request:
```typescript
{
  action: "generate_tiles",
  cityId: string  // UUID of seeding_cities row
}
```

Response:
```typescript
{
  cityId: string,
  tileCount: number,
  tiles: Array<{ id: string, tileIndex: number, centerLat: number, centerLng: number, radiusM: number, row: number, col: number }>
}
```

Logic:
1. Read city from `seeding_cities` (center_lat, center_lng, coverage_radius_km, tile_radius_m)
2. Compute bounding box from coverage_radius_km
3. Generate grid of tile centers with spacing = tile_radius_m * 1.4
4. Filter tiles outside coverage circle
5. Delete any existing tiles for this city (regeneration)
6. Insert new tiles into `seeding_tiles`
7. Return tile list

#### `action: "preview_cost"`
Show estimated cost before seeding. **Enforces $70 hard cap.** <!-- [C5] -->

Request:
```typescript
{
  action: "preview_cost",
  cityId: string,
  categories: string[],    // subset of 13 seeding categories (or "all")
  tileIds?: string[]        // optional: seed specific tiles only
}
```

Response:
```typescript
{
  tileCount: number,
  categoryCount: number,
  totalApiCalls: number,
  estimatedSearchCost: number,   // tileCount × categoryCount × $0.032
  estimatedPhotoCost: number,    // rough estimate based on expected results
  estimatedTotalCost: number,
  exceedsHardCap: boolean,       // [C5] true if estimatedTotalCost > $70
  hardCapUsd: 70,                // [C5] constant
  breakdown: Array<{ category: string, tiles: number, calls: number, cost: number }>
}
```

#### `action: "seed"`
Execute seeding for specified city/tiles/categories.

Request:
```typescript
{
  action: "seed",
  cityId: string,
  categories: string[],    // subset of 13 seeding categories
  tileIds?: string[],       // optional: seed specific tiles only
  dryRun?: boolean,         // if true, search but don't insert
  acknowledgeHardCap?: boolean  // [C5] must be true if cost > $70
}
```

Response:
```typescript
{
  operationIds: string[],     // one per category
  summary: {
    totalApiCalls: number,
    totalPlacesReturned: number,
    totalRejected: { noPhotos: number, closed: number, excludedType: number },  // [C1] no "noRating", [C6] added excludedType
    totalNewInserted: number,
    totalDuplicateSkipped: number,
    estimatedCostUsd: number
  },
  perCategory: Record<string, {
    apiCalls: number,
    placesReturned: number,
    rejected: { noPhotos: number, closed: number, excludedType: number },  // [C1][C6]
    newInserted: number,
    duplicateSkipped: number,
    errors: Array<{ tileIndex: number, errorType: string, message: string }>  // [C7]
  }>
}
```

Logic (per category, parallelized across categories):
1. Load tiles (all city tiles or specified subset)
2. For each tile: call Google Nearby Search with category config
3. **Log any Google API error** with HTTP status, response body, tile ID, and category <!-- [C7] -->
4. Apply post-fetch filters (closed, no photos, globally excluded types) <!-- [C1] removed "no rating" -->
5. Collect all passing places, deduplicate by google_place_id
6. For each unique new place: upsert into place_pool with `city_id`, `seeding_category`, `country` (parsed from formattedAddress), `fetched_via: 'nearby_search'`
7. Log operation to `seeding_operations` table **including `error_details` JSONB** <!-- [C7] -->
8. Use `ignoreDuplicates: true` on upsert to preserve admin-edited fields on existing places

**Critical implementation note:** The upsert must use `ON CONFLICT (google_place_id) DO UPDATE SET` with only Google-sourced fields. Admin-edited fields (`price_tier` if manually set, `is_active`) must NOT be overwritten. Implementation approach: use a selective update that only overwrites: `name`, `address`, `lat`, `lng`, `types`, `primary_type`, `rating`, `review_count`, `price_level`, `opening_hours`, `photos`, `website`, `raw_google_data`, `last_detail_refresh`, `refresh_failures` (reset to 0). Leave `price_tier`, `is_active`, `stored_photo_urls`, impression/save counters untouched.

**Timeout handling:** Use `timeoutFetch()` from `_shared/timeoutFetch.ts` with 10s timeout per Google API call. If a tile call fails, **log the structured error** (tile_id, category, HTTP status, response body truncated to 500 chars) <!-- [C7] --> and continue to next tile. Do not abort the entire operation.

**Rate limiting:** Process tiles sequentially within each category (to avoid burst-hitting Google), but parallelize across categories (up to 4 concurrent). Add 100ms delay between tile calls within a category.

### 9.2 Existing Edge Function Changes

#### `admin-place-search`
- **Keep** for ad-hoc text searches (admin still needs free-text "rooftop bars in Lagos")
- **Fix:** Wire `lat`/`lng`/`radius` through as `locationBias` when provided
- **Fix:** Add `places.businessStatus` to FIELD_MASK
- **Fix:** Use `timeoutFetch()` instead of raw `fetch()`
- **Remove:** `action: "refresh"` — consolidate all refresh into `admin-refresh-places`

#### `admin-refresh-places`
- No changes needed. Already works correctly.

#### `generate-single-cards`
- No changes needed. Already reads from place_pool by location + category types.
- Card Pool Management page will call this with city-derived location + radius.

#### `generate-curated-experiences`
- No changes needed. Card Pool Management page will call this.

#### `query_pool_cards` (SQL function)
<!-- [C6] Add dog_park to v_excluded_types -->
- Update `v_excluded_types` array: `ARRAY['gym', 'fitness_center', 'dog_park']`

---

## 10. Place Pool Management Page

### 10.1 Page Layout

**Replace:** PlacePoolBuilderPage + PhotoPoolManagementPage + CityLauncherPage
**New file:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

Top-level layout:
1. **City Selector** — dropdown of seeding_cities at page top (+ "Add City" button)
2. **City Summary Bar** — stat cards showing key numbers for selected city
3. **Tab Bar** — 6 tabs below the summary <!-- [C4] Added Map tab -->

### 10.2 City Selector + Add City

At the top of the page, always visible:
- Dropdown listing all `seeding_cities` ordered by name
- Each option shows: `{name}, {country}` + status badge (draft/seeding/seeded/launched)
- "Add City" button opens a modal with: Name, Country, Country Code, Center Lat, Center Lng, Coverage Radius (km, default 10), Tile Radius (m, default 1500)
- On save: inserts into `seeding_cities`, auto-generates tiles via `admin-seed-places` action `generate_tiles`
- **"All Cities"** option shows aggregate view

### 10.3 City Summary Bar (4 stat cards)

When a city is selected:
- **Total Places** — active count (+ inactive below)
- **Photo Coverage** — X% with downloaded photos (green/yellow/red based on %)
- **Freshness** — X% refreshed within 7 days (green/yellow/red)
- **Seeding Spend** — total estimated cost for this city's seeding operations (red badge if approaching $70 cap) <!-- [C5] -->

Data source: `admin_city_place_stats` RPC.

### 10.4 Tab 1: Seed & Import

The core seeding workflow. Replaces CityLauncherPage entirely.

**Sections:**

**A. Tile Grid Summary**
- Shows: total tiles, tile radius, coverage area
- "Regenerate Tiles" button (if city params changed)
- Compact table: Tile #, Center (lat/lng), Status (unseeded/seeded/partial)

**B. Category Selector**
- 13 seeding categories as toggleable pills (all selected by default) <!-- [C3] -->
- Each pill shows: category name + icon + count of places already seeded for this city/category

**C. Cost Preview Panel**
- Auto-updates when categories or tiles change
- Shows: X tiles × Y categories = Z API calls → $A.BC estimated cost
- **$70 hard cap warning:** If estimated total (search + photos) exceeds $70, panel turns red with warning: "Estimated cost ($X.XX) exceeds the $70 per-city cap. Reduce tile count, tile radius, or categories." <!-- [C5] -->
- "Include photo estimate" toggle → adds photo cost estimate
- Big green "Start Seeding" button (disabled until cost preview is shown; **disabled if over $70 cap unless admin explicitly acknowledges**) <!-- [C5] -->

**D. Seeding Progress** (shown during/after seeding)
- Progress bar: "Category 3/13: Casual Eats — Tile 8/16..."
- Live counters: places found, rejected (no photos / closed / excluded type), new, duplicate <!-- [C1] removed "no rating", [C6] added excluded type -->
- **Error detail inline:** if a tile fails, show error type + HTTP status + message directly in the progress panel (not hidden behind a log) <!-- [C7] -->
- Per-category expandable results showing tile-by-tile breakdown
- Final summary with total cost incurred

**E. Ad-Hoc Search** (collapsible section at bottom)
- Free-text search like current PlacePoolBuilderPage Search tab
- Fields: Text Query, (city auto-filled from selection)
- Uses existing `admin-place-search` edge function (with locationBias fix)
- Results table with select + push to pool

### 10.5 Tab 2: Map View <!-- [C4] NEW — day-one inclusion -->

An aesthetic, user-friendly map for visual coverage analysis. Uses **Leaflet** (already in admin stack).

**Features:**
- **Tile grid overlay:** circles drawn on the map showing each tile's coverage area
- **Tile status coloring:**
  - Gray: unseeded
  - Light blue: partially seeded (some categories)
  - Green: fully seeded (all 13 categories)
  - Red outline: tiles with errors during last seeding operation
- **Place pins:** all seeded places plotted as markers, color-coded by seeding category (13 colors from a distinguishable palette)
- **Pin click:** popup with place name, category, rating, photo count, active/inactive status
- **Category filter:** toggle which categories are shown on the map (same pill UI as Seed tab)
- **Coverage gap detection:** tiles with < 5 places per category highlighted with warning indicator
- **City boundary:** dashed circle showing the city's coverage_radius_km
- **Controls:** zoom, layer toggle (tiles/pins/boundary), fullscreen

**Data source:** `seeding_tiles` + `place_pool WHERE city_id` — loaded once on tab activation, not real-time.

### 10.6 Tab 3: Browse Pool

Replaces current Browse Pool tab. Enhanced with:

**Filters (sidebar or top bar):**
- City (auto-filled from city selector, but overridable)
- Seeding Category (dropdown of 13) <!-- [C3] -->
- Status: Active / Inactive / All
- Photo Status: Has Photos / Missing Photos / All
- Price Tier: chill / comfy / bougie / lavish
- Rating: Min rating slider (0-5)
- Name search (text input)

**Table columns:**
- Name (clickable → edit modal)
- Address (truncated)
- Seeding Category (badge)
- Rating (★ number)
- Price Tier (badge)
- Photos (count badge, red if 0)
- Impressions
- Status (Active/Inactive)
- Actions: Edit, Refresh, Toggle Active

**Bulk actions:**
- Select all on page / Deselect all
- Deactivate Selected
- Refresh Selected (uses `admin-refresh-places`)
- Trigger Photo Download (for places with Google refs but no stored photos)

**Edit Modal (FIXED):**
- Fields: Name (text), Price Tier (dropdown: chill/comfy/bougie/lavish), Is Active (toggle)
- Saves via `admin_edit_place` RPC (SECURITY DEFINER, bypasses RLS)
- No `category` or `visibility` fields (these don't exist on place_pool)

**Pagination:** 20 per page, server-side via .range() + { count: "exact" }

### 10.7 Tab 4: Photo Management

Replaces PhotoPoolManagementPage. Integrated into Place Pool.

**Sections:**

**A. Photo Health Summary** (stat cards)
- Total places with photos / without photos / % coverage
- Uses existing `admin_pool_stats_overview` RPC (filtered by city_id)

**B. Missing Photos Table** <!-- [PB] Photo backfill granularity verified -->
- Shows places that have Google photo refs (`photos` JSONB not empty) but no `stored_photo_urls`
- **Filters:**
  - By tile (specific tile from dropdown) <!-- [PB] -->
  - By seeding category (e.g., "only Nature") <!-- [PB] -->
  - By minimum rating (e.g., "4.0+ first") <!-- [PB] -->
- **Sort options:**
  - By rating descending (highest-rated first — best ROI) <!-- [PB] -->
  - By most-seen first (highest impression count — most user-facing impact) <!-- [PB] -->
- "Download Photos" button per individual row
- **"Batch Download"** with controls: <!-- [PB] -->
  - Scope: all missing in city, or filtered subset (category, tile, rating)
  - Limit: download **top N places only** (partial batch for budget control) <!-- [PB] -->
  - **Cost estimate shown before running:** N places × 5 photos × $0.007 <!-- [PB] -->
  - Cost included in $70 hard cap tracking <!-- [C5] -->

**C. Photo Download Progress** (shown during backfill)
- Uses existing `admin_trigger_place_refresh` mechanism or a new photo-specific backfill trigger
- Progress bar + cost counter + success/failure count
- **Per-place error details inline** if download fails <!-- [C7] -->

### 10.8 Tab 5: Stale Review

Carries over existing Stale Review functionality with enhancement:

**Enhancement: City filter auto-applied** from city selector.

Everything else from existing Stale tab remains: staleness tiers, per-place refresh, bulk refresh, deactivate with reason, audit trail.

Uses existing `admin_list_stale_places` RPC — needs a `p_city_id` parameter added (or filter client-side by joined city_id).

### 10.9 Tab 6: Stats & Analytics

Replaces client-side stats with server-side RPCs.

**Sections:**

**A. Aggregate Stats** — uses `admin_city_place_stats` RPC
- Places by seeding category (horizontal bar chart) — **all 13 categories** <!-- [C3] -->
- Price tier distribution
- Photo coverage by category

**B. Seeding History** — reads `seeding_operations` table
- Table: Date, Category, Tiles, Found, Rejected, New, Dupes, Cost, **Errors** <!-- [C7] -->
- "Errors" column shows count; click to expand `error_details` JSONB inline <!-- [C7] -->
- Filterable by date range and category
- Total cost tracker (sum of all operations for this city) — **with $70 cap indicator** <!-- [C5] -->

**C. Quality Metrics**
- Average rating by category
- Places with 0 impressions ("dead inventory")
- Top performing places (highest impressions/saves)

---

## 11. Card Pool Management Page

### 11.1 Page Layout

**New file:** `mingla-admin/src/pages/CardPoolManagementPage.jsx`

Top-level layout:
1. **City Selector** — same component as Place Pool page
2. **City Readiness Score** — visual indicator (traffic light)
3. **Tab Bar** — 4 tabs

### 11.2 Tab 1: City Launch Readiness

The main value of this page — answers "Is this city ready to launch?"

**Readiness Checklist (per city):**

| Step | Check | Source | Status |
|------|-------|--------|--------|
| 1 | City defined + tiles generated | `seeding_cities` + `seeding_tiles` | pass/fail |
| 2 | Places seeded (≥50 active) | `place_pool WHERE city_id` | pass/warn/fail + count |
| 3 | Photos downloaded (≥80% coverage) | `stored_photo_urls` check | pass/warn/fail + % |
| 4 | Single cards generated | `card_pool WHERE card_type='single'` + city join | pass/warn/fail + count |
| 5 | Curated cards generated (≥10) | `card_pool WHERE card_type='curated'` + city join | pass/warn/fail + count |
| 6 | Category coverage (≥8 of 13 categories have cards) | Per-category card count | pass/warn/fail | <!-- [C3] 13 categories -->
| 7 | Total spend ≤ $70 | Sum of seeding_operations.estimated_cost_usd | pass/warn/fail | <!-- [C5] -->

**Per-Category Traffic Lights:**
<!-- [C3] All 13 app categories shown -->
- For each of the **13 app categories**: show a row with:
  - Category name + icon
  - Places seeded (count)
  - Photos done (count / %)
  - Cards generated (count)
  - Traffic light: green (≥5 cards with photos), yellow (1-4 cards), red (0 cards)
  - Note: Groceries row marked as "hidden from users" but still tracked

**Overall Readiness Score:** Percentage of checklist items at green. Display as large circular gauge.

**"Launch City" Button:** Only enabled when all critical items are green. Sets `seeding_cities.status = 'launched'`.

### 11.3 Tab 2: Generate Cards

Controls for card generation.

**A. Single Card Generation**
- Button: "Generate Single Cards for {city}"
- Calls `generate-single-cards` edge function with: `location: {city center}`, `radiusMeters: coverage_radius_km * 1000`, `categories: ["all"]`
- Shows: dry run first (preview what would be generated), then confirm to execute
- Progress display with per-category results

**B. Curated Card Generation**
- Button: "Generate Curated Experiences for {city}"
- Calls `generate-curated-experiences` with city location + radius
- Preview mode first, then execute

**C. Category-Specific Generation**
- Dropdown to pick one of the **13 categories** <!-- [C3] --> → generate cards for that category only
- Useful for filling gaps identified in readiness tab

### 11.4 Tab 3: Browse Cards

Card browsing and management.

**Filters:**
- City (auto-filled)
- Card Type: Single / Curated / All
- Category (dropdown of **13 app categories**) <!-- [C3] -->
- Status: Active / Inactive / All
- Photo Status: Has Photo / No Photo
- Name search

**Table columns:**
- Title
- Type (Single/Curated badge)
- Category (badge)
- Image (thumbnail)
- Rating
- Price Tier
- Status
- Actions: View Details, Deactivate/Reactivate

**Card Detail Modal:**
- Full card info: title, description, category, images, rating, price range
- Source place (link to place in Place Pool)
- For curated: list of stops with place links
- Impression count, save count

### 11.5 Tab 4: Gap Analysis

Identifies what's missing.

**A. Places Without Cards**
- Table of active places that have photos but no corresponding active card
- "Generate Card" button per row (calls generate-single-cards for that one place)
- Bulk "Generate All Missing" button

**B. Category Gaps**
- Per-category comparison across **all 13 categories** <!-- [C3] -->: places seeded vs cards generated
- Highlights categories where places >> cards (generation needed)
- Highlights categories where places are low (more seeding needed)

**C. Cross-City Comparison** (when "All Cities" selected)
- Table: City, Places, Cards, Coverage %, Readiness Score, **Total Spend vs $70 Cap** <!-- [C5] -->
- Quick comparison across all defined cities

---

## 12. Cost Model

### 12.1 Cost Per Operation

| Operation | Google API | Cost Per Call | Notes |
|-----------|-----------|-------------|-------|
| Nearby Search (seeding) | places:searchNearby | $0.032 | With Advanced fields |
| Text Search (ad-hoc) | places:searchText | $0.032 | With Advanced fields |
| Place Details (refresh) | places/{id} | $0.005 | Basic + Advanced |
| Photo Download | places/{id}/photos/{ref}/media | $0.007 | Per photo |

### 12.2 City Launch Cost Estimate (Default 1500m tiles, 10km radius)

| Phase | Calculation | Cost |
|-------|------------|------|
| Tile generation | Free (compute only) | $0.00 |
| Seeding search | ~16 tiles × 13 categories × $0.032 | $6.66 |
| Photo download | ~1,500 unique places × 5 photos × $0.007 | $52.50 |
| Single card generation | Free (reads from pool) | $0.00 |
| Curated card generation | Depends on OpenAI calls | ~$2-5 |
| **Total per city** | | **~$61-64** |

### 12.3 $70 Hard Cap <!-- [C5] -->

**Every city launch has a $70 maximum cost cap.** This is enforced at two levels:

1. **Preview gate:** The `preview_cost` action returns `exceedsHardCap: true` if the estimate exceeds $70. The UI disables the "Start Seeding" button and shows a red warning.
2. **Confirmation override:** If the admin still wants to proceed (e.g., for a large city where partial seeding already happened), they must explicitly acknowledge the cap override. The `seed` action requires `acknowledgeHardCap: true` in this case.
3. **Running total:** The City Summary Bar and Readiness Checklist track cumulative spend across all seeding operations for the city. The UI shows a progress bar toward $70.

**What counts toward the cap:**
- Nearby Search calls (seeding)
- Photo downloads
- Place Detail refreshes triggered from this city

**What does NOT count:**
- Ad-hoc text searches
- Card generation (no Google cost)

### 12.4 Monthly Budget Planning

| Budget | Cities/Month (full pipeline) | Cities/Month (search only) |
|--------|----------------------------|---------------------------|
| $200 free credit | ~3 cities | ~30 cities |
| $200 + $100 extra | ~4-5 cities | ~45 cities |

### 12.5 Cost Display in UI

Every seeding operation shows cost BEFORE execution:
- Tile count × category count × $0.032 = search cost
- Expected unique places × 5 × $0.007 = photo cost estimate
- Total shown with a "This will cost approximately $X.XX" warning
- **Red warning if total exceeds $70** <!-- [C5] -->
- Admin must click "Confirm" after seeing cost (or "Acknowledge & Proceed" if over cap)

---

## 13. Seeding Workflow: End to End

### From "I want to seed Lagos" to "Lagos is launch-ready":

**Step 1: Define City**
- Place Pool Management → "Add City" → enter: Lagos, Nigeria, NG, 6.5244, 3.3792, 15km radius, 1500m tiles
- System generates ~28 tiles, saves to `seeding_tiles`
- City status: `draft`

**Step 2: Preview & Seed**
- Select Lagos in city dropdown
- Seed & Import tab → all 13 categories selected <!-- [C3] -->
- Cost preview: 28 tiles × 13 cats = 364 calls → $11.65
- **Check:** $11.65 < $70 cap → green light <!-- [C5] -->
- Click "Start Seeding" → progress shows per-category
- **Any tile failures show inline** with error type + HTTP status <!-- [C7] -->
- Expect ~2,000-3,500 total results, ~800-1,500 unique after dedup + filters
- City status: `seeding` → `seeded`

**Step 3: Check Map** <!-- [C4] -->
- Switch to Map tab → see tile grid overlay on Lagos
- Place pins color-coded by category → visual confirmation of coverage
- Spot gaps: e.g., Victoria Island has sparse Nature pins → might need smaller tiles there

**Step 4: Download Photos**
- Photo Management tab → see "467 places missing photos"
- Filter by category "Fine Dining" → 12 places → batch download just those first <!-- [PB] -->
- Then "Batch Download" remaining → cost estimate: 455 × 5 × $0.007 = $15.93
- Running total: $11.65 + $15.93 = $27.58 (well under $70) <!-- [C5] -->
- Confirm → download runs (may need multiple invocations due to 60s edge function timeout)

**Step 5: Generate Cards**
- Switch to Card Pool Management → Generate Cards tab
- "Generate Single Cards for Lagos" → dry run shows: "Would generate 412 cards (55 skipped: no photos)"
- Confirm → cards generated
- "Generate Curated Experiences for Lagos" → generates multi-stop experiences

**Step 6: Assess Readiness**
- City Launch Readiness tab → checklist:
  - Pass: City defined + tiles (28 tiles)
  - Pass: Places seeded (892 active)
  - Warn: Photos (78% coverage — need to re-run backfill for remaining)
  - Pass: Single cards (412)
  - Warn: Curated cards (7 — need 3 more)
  - Pass: Category coverage (10/13) <!-- [C3] -->
  - Pass: Total spend $27.58 / $70 <!-- [C5] -->
- Per-category traffic lights show Fine Dining red (0 cards — no fine dining places found in Lagos with that config)
- Admin decides: acceptable, or seed more targeted tiles in the Fine Dining area

**Step 7: Launch**
- Once all checklist items are green (or admin overrides)
- Click "Launch Lagos" → sets `seeding_cities.status = 'launched'`
- All places already have `is_active: true` from seeding

---

## 14. Migration Path

### 14.1 What Happens to Existing Data

| Existing Item | Action |
|--------------|--------|
| Existing places in `place_pool` | Keep. `city_id` = NULL, `seeding_category` = NULL. Backfill `country` from address. |
| Existing cards in `card_pool` | Keep. Unaffected. |
| Existing photos | Keep. Unaffected. |

### 14.2 What Pages to Kill

| Page | Action | Reason |
|------|--------|--------|
| `PlacePoolBuilderPage.jsx` | **REPLACE** with PlacePoolManagementPage | All 4 tabs absorbed into new page with enhancements |
| `CityLauncherPage.jsx` | **KILL** | Fully replaced by Seed & Import tab |
| `PhotoPoolManagementPage.jsx` | **KILL** | Absorbed into Photo Management tab on Place Pool page |

### 14.3 Admin Navigation Changes

Update `App.jsx` page registry:
- Remove: `placepool`, `citylauncher`, `photopool`
- Add: `placepool` → PlacePoolManagementPage, `cardpool` → CardPoolManagementPage
- Sidebar: "Place Pool" and "Card Pool" as two entries (replacing three old ones)

### 14.4 Forward Migration

1. Run schema migration (new tables + alter place_pool)
2. Backfill `country` on existing places from address
3. Deploy `seedingCategoryConfigs.ts` to `_shared/` <!-- [C8] -->
4. Deploy new `admin-seed-places` edge function
5. Update `admin-place-search` (add locationBias, businessStatus, timeoutFetch)
6. Update `query_pool_cards` — add `dog_park` to `v_excluded_types` <!-- [C6] -->
7. Deploy new admin pages
8. Remove old pages from App.jsx

### 14.5 Rollback Plan

- Schema changes are additive (new tables, new columns) — old code still works
- If rollback needed: revert App.jsx to old page registry, old pages still function
- New tables can be dropped if needed (no existing code depends on them)
- `city_id` column on place_pool is nullable — old code ignores it

---

## 15. What To Kill (Detailed)

### Edge Functions
- `admin-place-search`: **KEEP but modify** — still needed for ad-hoc text search. Remove `action: "refresh"` (use `admin-refresh-places` instead). Add locationBias.
- `query_pool_cards`: **MODIFY** — add `dog_park` to `v_excluded_types` <!-- [C6] -->
- All other edge functions: no changes needed.

### Admin Pages
- `PlacePoolBuilderPage.jsx` (1,433 lines): **REPLACE**
- `CityLauncherPage.jsx` (472 lines): **DELETE**
- `PhotoPoolManagementPage.jsx`: **DELETE**

### RPCs
- All existing RPCs: **KEEP**. They still serve their purpose.
- `admin_pool_stats_overview`: **KEEP** — reuse in Photo Management tab.

---

## 16. Common Mistakes to Avoid

1. **Don't use Text Search for structured seeding.** Text Search has no `includedTypes`/`excludedPrimaryTypes` and its location filtering is text-based guessing. Always use Nearby Search for tile-based seeding.

2. **Don't overwrite admin-edited fields on re-seed.** The upsert must selectively update only Google-sourced fields. Use a specific column list in `ON CONFLICT DO UPDATE SET`, not a blanket overwrite.

3. **Don't forget the 60s edge function timeout.** A city with 28 tiles × 13 categories = 364 API calls will NOT fit in one invocation. The seeding must be chunked: process one category at a time (each category = ~28 tiles = ~28 API calls = ~30s with delays). Return partial results and let the frontend orchestrate multiple calls.

4. **Don't compute stats client-side.** All aggregate stats must use server-side RPCs. The pattern of fetching all rows in batches of 1,000 doesn't scale.

5. **Don't forget to parse `country` from formattedAddress.** Google's `formattedAddress` always ends with the country name. Use the last comma-separated part. But also accept the `seeding_cities.country` as the authoritative value for city-seeded places.

6. **Don't confuse seeding categories with app categories.** <!-- [C2][C3] CORRECTED --> They are now 1:1 (13 and 13), but `place_pool.seeding_category` stores the seeding category name while `card_pool.category` stores the app category slug. Keep the distinction even though the mapping is direct.

7. **Don't skip the `places.businessStatus` field.** It's Basic tier (free) and prevents seeding permanently closed businesses.

8. **Don't swallow errors.** <!-- [C7] --> Every Google API failure, timeout, or upsert error must be captured in `error_details` JSONB with tile_id, category, HTTP status, and response body. The admin UI must show these inline — not behind a generic "failed" badge.

9. **Don't forget `dog_park` in global exclusions.** <!-- [C6] --> Both the edge function post-fetch filter AND the `query_pool_cards` SQL function must exclude `dog_park`.

10. **Don't exceed the $70 cap without explicit admin acknowledgment.** <!-- [C5] --> The preview_cost action and UI must gate on this.

---

## 17. Implementation Order

**Step 1: Shared config** — Create `supabase/functions/_shared/seedingCategoryConfigs.ts` with all 13 category definitions <!-- [C8] -->. This is the single source of truth.

**Step 2: Database migration** — Create `seeding_cities`, `seeding_tiles`, `seeding_operations` tables (including `error_details JSONB` <!-- [C7] -->). Add `city_id`, `country`, `seeding_category` columns to `place_pool`. Create `admin_edit_place`, `admin_city_place_stats`, `admin_city_card_stats` RPCs. Backfill `country` on existing places. Update `query_pool_cards` to exclude `dog_park` <!-- [C6] -->.

**Step 3: `admin-seed-places` edge function** — New function with `generate_tiles`, `preview_cost` (with $70 cap check <!-- [C5] -->), `seed` actions. Import configs from `seedingCategoryConfigs.ts`. Implement structured error logging <!-- [C7] -->. Test with a single tile + single category first.

**Step 4: Fix `admin-place-search`** — Add locationBias, businessStatus, timeoutFetch. Remove `action: "refresh"`.

**Step 5: PlacePoolManagementPage** — New page with 6 tabs <!-- [C4] -->. Start with Seed & Import + Map View + Browse Pool (most critical). Then Photo Management, Stale Review, Stats.

**Step 6: CardPoolManagementPage** — New page with 4 tabs. Start with Launch Readiness (highest value, with $70 cap tracking <!-- [C5] -->), then Generate, Browse, Gap Analysis.

**Step 7: Kill old pages** — Remove CityLauncherPage, PhotoPoolManagementPage from App.jsx. Replace PlacePoolBuilderPage with new page.

**Step 8: Integration test** — Full end-to-end: define city → seed → check map → photos → generate cards → check readiness → verify spend ≤ $70.

---

## 18. Test Cases

| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
| 1 | Add city generates tiles | City: Lagos, 10km, 1500m tiles | ~16 tiles in seeding_tiles | DB + Edge |
| 2 | Cost preview is accurate | 16 tiles × 3 categories | $1.54 (48 × $0.032) | Edge |
| 3 | Cost preview flags $70 cap | 127 tiles × 13 categories (500m radius) | `exceedsHardCap: true` | Edge | <!-- [C5] -->
| 4 | Seeding uses Nearby Search | Seed 1 tile, 1 category | Google called with locationRestriction + includedTypes | Edge |
| 5 | Places without photos rejected | Google returns place with photos: [] | Place not in place_pool | Edge |
| 6 | Closed businesses rejected | businessStatus = CLOSED_PERMANENTLY | Place not in place_pool | Edge |
| 7 | Dog parks rejected | primaryType = dog_park | Place not in place_pool | Edge | <!-- [C6] -->
| 8 | Places without ratings ACCEPTED | rating = null, has photos, not closed | Place IS in place_pool | Edge | <!-- [C1] -->
| 9 | Duplicate upsert preserves admin edits | Re-seed tile with existing place where price_tier was manually set | price_tier unchanged | DB + Edge |
| 10 | Edit modal saves via RPC | Edit name + price_tier | Update succeeds, card_pool not affected | DB + Admin |
| 11 | Edit modal deactivate cascades | Toggle is_active to false | card_pool rows also deactivated | DB |
| 12 | City stats RPC returns correct counts | City with 50 active, 10 inactive places | { total_places: 50, inactive_places: 10 } | DB |
| 13 | Card generation respects city boundary | Generate single cards for city | Only place_pool rows within city radius included | Edge |
| 14 | Readiness checklist reflects reality | City with 80% photo coverage | Photo step shows warn not pass | Admin |
| 15 | Readiness shows 13 category rows | Select city with mixed categories | All 13 rows shown including Groceries (marked hidden) | Admin | <!-- [C3] -->
| 16 | Stale review filtered by city | Select city → Stale tab | Only stale places for that city shown | Admin |
| 17 | 60s timeout handled gracefully | Seed 30+ tiles in one category | Partial results returned, operation logged as completed with count | Edge |
| 18 | Failed tile logged with structured error | Google returns 429 on tile #5 | error_details JSONB contains tile_id, http_status=429, response_body | Edge | <!-- [C7] -->
| 19 | Concurrent seeding operations | Seed category A and B simultaneously | Both succeed, no race on place_pool upsert | Edge + DB |
| 20 | Photo backfill cost estimate | 200 places missing photos | Shows "$7.00 (200 × 5 × $0.007)" | Admin |
| 21 | Photo backfill filtered by tile | Select tile #3, batch download | Only places from tile #3 processed | Admin | <!-- [PB] -->
| 22 | Photo backfill partial batch | Set limit to 50, 200 missing | Only top 50 (by rating) downloaded | Admin | <!-- [PB] -->
| 23 | Map shows tile grid | Select seeded city, Map tab | Leaflet map with tile circles + place pins | Admin | <!-- [C4] -->
| 24 | Map shows coverage gaps | City with empty tiles | Empty tiles highlighted differently | Admin | <!-- [C4] -->
| 25 | $70 cap blocks seeding | Cumulative $65 spent, new estimate $10 | Warning shown, button disabled without acknowledgment | Admin | <!-- [C5] -->
| 26 | query_pool_cards excludes dog_park | Card query with dog_park place in pool | Card not returned | DB | <!-- [C6] -->

---

## 19. Verification Queries

### After migration:

```sql
-- New tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('seeding_cities', 'seeding_tiles', 'seeding_operations');
-- Expected: 3 rows

-- place_pool has new columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'place_pool' AND column_name IN ('city_id', 'country', 'seeding_category');
-- Expected: 3 rows

-- seeding_operations has error_details column [C7]
SELECT column_name FROM information_schema.columns WHERE table_name = 'seeding_operations' AND column_name = 'error_details';
-- Expected: 1 row

-- RLS enabled on new tables
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('seeding_cities', 'seeding_tiles', 'seeding_operations');
-- Expected: all have rowsecurity = true

-- Country backfill worked
SELECT COUNT(*) FROM place_pool WHERE country IS NULL AND address IS NOT NULL;
-- Expected: 0 (all addresses parsed)

-- dog_park is in query_pool_cards exclusion [C6]
-- Manual: read the function definition and confirm v_excluded_types includes 'dog_park'
```

### After seeding a city:

```sql
-- Tiles generated correctly
SELECT COUNT(*) FROM seeding_tiles WHERE city_id = '<city_uuid>';
-- Expected: matches calculated tile count

-- Places linked to city
SELECT COUNT(*) FROM place_pool WHERE city_id = '<city_uuid>' AND is_active;
-- Expected: > 0

-- No places without photo refs were seeded (new places only)
SELECT COUNT(*) FROM place_pool
WHERE city_id = '<city_uuid>'
  AND (photos IS NULL OR photos::text = '[]')
  AND created_at > '<seeding_start_time>';
-- Expected: 0

-- No dog_park places seeded [C6]
SELECT COUNT(*) FROM place_pool
WHERE city_id = '<city_uuid>'
  AND primary_type = 'dog_park'
  AND created_at > '<seeding_start_time>';
-- Expected: 0

-- No "no rating" rejections recorded [C1]
SELECT column_name FROM information_schema.columns
WHERE table_name = 'seeding_operations' AND column_name = 'places_rejected_no_rating';
-- Expected: 0 rows (column should NOT exist)

-- Operations logged with error_details [C7]
SELECT id, seeding_category, error_details
FROM seeding_operations WHERE city_id = '<city_uuid>' AND error_details IS NOT NULL;
-- Expected: rows with structured JSONB error logs for any operations that had tile failures

-- Operations logged
SELECT seeding_category, places_new_inserted, places_rejected_no_photos, estimated_cost_usd
FROM seeding_operations WHERE city_id = '<city_uuid>';
-- Expected: one row per category seeded

-- Total spend under cap [C5]
SELECT SUM(estimated_cost_usd) as total_spend FROM seeding_operations WHERE city_id = '<city_uuid>';
-- Expected: ≤ 70.00
```

---

## 20. Handoff to Implementor

Implementor: this is your single source of truth. §2 is the design principle — refer to it for ambiguous decisions. §3 defines what is authoritative vs derived — never confuse them. Execute in order from §17. Do not skip, reorder, or expand scope.

Key decisions already made for you:
- **Tile radius default: 1500m.** Don't second-guess this.
- **13 seeding categories, 13 app categories, 1:1 mapping.** <!-- [C2][C3] --> The mapping is in §7.1. Every category maps to itself.
- **Nearby Search, not Text Search** for structured seeding. Text Search is kept only for ad-hoc.
- **Selective upsert** — never overwrite admin-edited fields. Use explicit column list.
- **SECURITY DEFINER RPCs** for all admin writes to place_pool. No direct client updates.
- **Server-side stats RPCs.** Zero client-side aggregate computation.
- **Ad-hoc search stays** as a collapsible section. Don't remove it.
- **$70 hard cap** per city launch. UI gates on this. <!-- [C5] -->
- **`dog_park` globally excluded** — both in edge function AND `query_pool_cards`. <!-- [C6] -->
- **Structured error logging** — `error_details` JSONB on every seeding operation. Admin UI shows errors inline. <!-- [C7] -->
- **Map view is day one** — Leaflet, tile grid overlay, category-coded pins, coverage gaps. <!-- [C4] -->
- **Category configs in `seedingCategoryConfigs.ts`** — single file, shared by edge function and admin UI. <!-- [C8] -->

Produce IMPLEMENTATION_REPORT.md referencing each section, hand to tester. Not done until tester's report is green.
