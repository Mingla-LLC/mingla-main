# SPEC: Per-Category Exclusion Enforcement at SQL Level

**Block:** 2 of Pool Intelligence launch hardening
**Priority:** #2 launch blocker — inappropriate places appear in category results
**Gate:** Spec → requires user approval before implementation
**Depends on:** Block 1 (category slug normalization) — merged

---

## 1. Problem Statement

Per-category exclusions are **defined** in TypeScript (`CATEGORY_EXCLUDED_PLACE_TYPES` — 27-50 types per category across 13 categories) but **never enforced** when serving cards. Users see inappropriate places: kids' venues in Fine Dining, Asian grocery stores in Drink, fast food in Creative & Arts, etc.

Three exclusion layers exist — all have gaps:

| Layer | Where | What it does | Gap |
|-------|-------|-------------|-----|
| Google API query-time | `admin-seed-places` request body | Passes `excludedPrimaryTypes` to Nearby Search | Google only filters on `primaryType`, not secondary `types[]`. Places with excluded types in their secondary array pass through. |
| Post-fetch seeding filter | `admin-seed-places/index.ts:201-227` | Checks `primaryType` against `GLOBAL_EXCLUDED_PLACE_TYPES` (3 types) | Does NOT check category-specific exclusions. Only checks `primaryType`, not the full `types[]` array. |
| Serve-time SQL | `query_pool_cards` | `NOT EXISTS (... pp.types && v_excluded_types)` | Only excludes 3 global types. Per-category exclusions (27-50 types each) are never applied. |

**Result:** The only enforcement is 3 global types (`gym`, `fitness_center`, `dog_park`). Hundreds of category-specific exclusions are defined but dead code at serve time.

---

## 2. Chosen Approach: Option B — Exclusion Lookup Table

### Why not the others

**Option A (hardcoded SQL map):** Would require a ~600-line PL/pgSQL CASE block mapping 13 categories × 27-50 types each. Unmaintainable. Every exclusion list change requires a new migration. Cannot be audited or admin-edited without touching SQL.

**Option C (parameter passing):** Enforcement depends on the caller sending correct parameters. A buggy caller, a new endpoint, or a direct RPC call could skip the exclusions entirely. Violates "make the bad state impossible" — enforcement would be "as good as the caller."

**Option B (lookup table) wins because:**
1. **Schema-enforced** — the database itself rejects bad data. No code path can bypass it.
2. **Auditable** — `SELECT * FROM category_type_exclusions WHERE category_slug = 'fine_dining'` instantly shows what's excluded and why.
3. **Admin-editable** — future admin UI can manage exclusions without code deploys.
4. **Single JOIN** — clean SQL, no massive CASE blocks, no parameter inflation.
5. **Durable** — survives edge function changes, new endpoints, direct SQL queries.

### Source of truth

- **Canonical definitions:** `CATEGORY_EXCLUDED_PLACE_TYPES` in `categoryPlaceTypes.ts` remains the design-time source (what engineers edit).
- **Runtime enforcement:** `category_type_exclusions` table is the runtime source (what SQL checks).
- **Sync:** A migration populates the table from the TypeScript definitions. Future changes require a migration that updates both.

---

## 3. Behavior Before / After

### Before (current)
- User selects "Fine Dining" category
- `query_pool_cards` checks: does the place have `gym`, `fitness_center`, or `dog_park`? If yes, exclude.
- A place with `types = ['restaurant', 'fast_food_restaurant', 'hamburger_restaurant']` is **served** to Fine Dining users
- A place with `types = ['grocery_store', 'asian_grocery_store']` is **served** to Drink users
- A place with `types = ['park', 'children_store', 'indoor_playground']` is **served** to Fine Dining users

### After (with this spec)
- User selects "Fine Dining" category
- `query_pool_cards` checks: does the place have ANY type that is excluded for ANY of the card's categories? If yes, exclude.
- The `fast_food_restaurant` place is **excluded** (in Fine Dining's exclusion list)
- The `asian_grocery_store` place is **excluded** from Drink (in Drink's exclusion list via RETAIL_EXCLUSIONS)
- The `children_store`/`indoor_playground` place is **excluded** from Fine Dining

### Multi-category curated card behavior
A card tagged `['picnic_park', 'groceries', 'flowers']`:
- Exclusion is the **UNION** of all its categories' exclusion lists
- If the place has a type excluded from **any** of those categories, the card is excluded
- Rationale: the card appears in multiple category feeds. It must be appropriate for ALL of them.

### Cards without a place (`place_pool_id IS NULL`)
- Curated cards with no linked place are **not affected** — the `NOT EXISTS` subquery returns no rows when `place_pool_id` is NULL, so the card passes through
- This is correct: curated cards without places are manually vetted

---

## 4. Database Changes

### 4.1 New Table: `category_type_exclusions`

```sql
CREATE TABLE public.category_type_exclusions (
  category_slug TEXT NOT NULL,
  excluded_type TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category_slug, excluded_type)
);

-- Index for the JOIN pattern: given a set of category slugs, find all excluded types
CREATE INDEX idx_cte_category_slug ON public.category_type_exclusions (category_slug);

-- RLS: read-only for authenticated, write via service role only
ALTER TABLE public.category_type_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read exclusions"
  ON public.category_type_exclusions
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated — only service_role can write
```

### 4.2 Populate from TypeScript definitions

The migration inserts all rows matching `CATEGORY_EXCLUDED_PLACE_TYPES` from `categoryPlaceTypes.ts`. Full INSERT below (derived from the TypeScript source — every value verified against the source file).

```sql
-- Shared RETAIL_EXCLUSIONS (applied to multiple categories inline below)
-- Each category gets its own rows including the shared retail exclusions

INSERT INTO public.category_type_exclusions (category_slug, excluded_type) VALUES
-- ── Nature & Views (nature_views) ─────────────────────────────────────────
('nature_views', 'movie_theater'),
('nature_views', 'video_arcade'),
('nature_views', 'bowling_alley'),
('nature_views', 'casino'),
('nature_views', 'night_club'),
('nature_views', 'karaoke'),
('nature_views', 'amusement_center'),
('nature_views', 'amusement_park'),
('nature_views', 'parking'),
('nature_views', 'parking_lot'),
('nature_views', 'parking_garage'),
('nature_views', 'bus_station'),
('nature_views', 'train_station'),
('nature_views', 'transit_station'),
('nature_views', 'airport'),
('nature_views', 'store'),
-- nature_views RETAIL_EXCLUSIONS
('nature_views', 'asian_grocery_store'),
('nature_views', 'auto_parts_store'),
('nature_views', 'bicycle_store'),
('nature_views', 'building_materials_store'),
('nature_views', 'butcher_shop'),
('nature_views', 'cell_phone_store'),
('nature_views', 'clothing_store'),
('nature_views', 'convenience_store'),
('nature_views', 'cosmetics_store'),
('nature_views', 'department_store'),
('nature_views', 'discount_store'),
('nature_views', 'discount_supermarket'),
('nature_views', 'electronics_store'),
('nature_views', 'farmers_market'),
('nature_views', 'flea_market'),
('nature_views', 'food_store'),
('nature_views', 'furniture_store'),
('nature_views', 'garden_center'),
('nature_views', 'general_store'),
('nature_views', 'gift_shop'),
('nature_views', 'hardware_store'),
('nature_views', 'health_food_store'),
('nature_views', 'home_goods_store'),
('nature_views', 'home_improvement_store'),
('nature_views', 'hypermarket'),
('nature_views', 'jewelry_store'),
('nature_views', 'liquor_store'),
('nature_views', 'market'),
('nature_views', 'pet_store'),
('nature_views', 'shoe_store'),
('nature_views', 'shopping_mall'),
('nature_views', 'sporting_goods_store'),
('nature_views', 'sportswear_store'),
('nature_views', 'tea_store'),
('nature_views', 'thrift_store'),
('nature_views', 'toy_store'),
('nature_views', 'warehouse_store'),
('nature_views', 'wholesaler'),
('nature_views', 'womens_clothing_store'),

-- ── First Meet (first_meet) ───────────────────────────────────────────────
('first_meet', 'night_club'),
('first_meet', 'bar'),
('first_meet', 'cocktail_bar'),
('first_meet', 'lounge_bar'),
('first_meet', 'brewery'),
('first_meet', 'brewpub'),
('first_meet', 'fine_dining_restaurant'),
('first_meet', 'french_restaurant'),
('first_meet', 'steak_house'),
('first_meet', 'indoor_playground'),
('first_meet', 'water_park'),
-- first_meet RETAIL_EXCLUSIONS
('first_meet', 'asian_grocery_store'),
('first_meet', 'auto_parts_store'),
('first_meet', 'bicycle_store'),
('first_meet', 'building_materials_store'),
('first_meet', 'butcher_shop'),
('first_meet', 'cell_phone_store'),
('first_meet', 'clothing_store'),
('first_meet', 'convenience_store'),
('first_meet', 'cosmetics_store'),
('first_meet', 'department_store'),
('first_meet', 'discount_store'),
('first_meet', 'discount_supermarket'),
('first_meet', 'electronics_store'),
('first_meet', 'farmers_market'),
('first_meet', 'flea_market'),
('first_meet', 'food_store'),
('first_meet', 'furniture_store'),
('first_meet', 'garden_center'),
('first_meet', 'general_store'),
('first_meet', 'gift_shop'),
('first_meet', 'hardware_store'),
('first_meet', 'health_food_store'),
('first_meet', 'home_goods_store'),
('first_meet', 'home_improvement_store'),
('first_meet', 'hypermarket'),
('first_meet', 'jewelry_store'),
('first_meet', 'liquor_store'),
('first_meet', 'market'),
('first_meet', 'pet_store'),
('first_meet', 'shoe_store'),
('first_meet', 'shopping_mall'),
('first_meet', 'sporting_goods_store'),
('first_meet', 'sportswear_store'),
('first_meet', 'tea_store'),
('first_meet', 'thrift_store'),
('first_meet', 'toy_store'),
('first_meet', 'warehouse_store'),
('first_meet', 'wholesaler'),
('first_meet', 'womens_clothing_store'),

-- ── Picnic Park (picnic_park) ─────────────────────────────────────────────
('picnic_park', 'dog_park'),
('picnic_park', 'amusement_park'),
('picnic_park', 'water_park'),
('picnic_park', 'bar'),
('picnic_park', 'night_club'),
('picnic_park', 'casino'),
('picnic_park', 'movie_theater'),
('picnic_park', 'video_arcade'),
-- picnic_park RETAIL_EXCLUSIONS
('picnic_park', 'asian_grocery_store'),
('picnic_park', 'auto_parts_store'),
('picnic_park', 'bicycle_store'),
('picnic_park', 'building_materials_store'),
('picnic_park', 'butcher_shop'),
('picnic_park', 'cell_phone_store'),
('picnic_park', 'clothing_store'),
('picnic_park', 'convenience_store'),
('picnic_park', 'cosmetics_store'),
('picnic_park', 'department_store'),
('picnic_park', 'discount_store'),
('picnic_park', 'discount_supermarket'),
('picnic_park', 'electronics_store'),
('picnic_park', 'farmers_market'),
('picnic_park', 'flea_market'),
('picnic_park', 'food_store'),
('picnic_park', 'furniture_store'),
('picnic_park', 'garden_center'),
('picnic_park', 'general_store'),
('picnic_park', 'gift_shop'),
('picnic_park', 'hardware_store'),
('picnic_park', 'health_food_store'),
('picnic_park', 'home_goods_store'),
('picnic_park', 'home_improvement_store'),
('picnic_park', 'hypermarket'),
('picnic_park', 'jewelry_store'),
('picnic_park', 'liquor_store'),
('picnic_park', 'market'),
('picnic_park', 'pet_store'),
('picnic_park', 'shoe_store'),
('picnic_park', 'shopping_mall'),
('picnic_park', 'sporting_goods_store'),
('picnic_park', 'sportswear_store'),
('picnic_park', 'tea_store'),
('picnic_park', 'thrift_store'),
('picnic_park', 'toy_store'),
('picnic_park', 'warehouse_store'),
('picnic_park', 'wholesaler'),
('picnic_park', 'womens_clothing_store'),

-- ── Drink (drink) ─────────────────────────────────────────────────────────
('drink', 'fine_dining_restaurant'),
('drink', 'spa'),
('drink', 'sauna'),
('drink', 'amusement_park'),
('drink', 'water_park'),
-- drink RETAIL_EXCLUSIONS
('drink', 'asian_grocery_store'),
('drink', 'auto_parts_store'),
('drink', 'bicycle_store'),
('drink', 'building_materials_store'),
('drink', 'butcher_shop'),
('drink', 'cell_phone_store'),
('drink', 'clothing_store'),
('drink', 'convenience_store'),
('drink', 'cosmetics_store'),
('drink', 'department_store'),
('drink', 'discount_store'),
('drink', 'discount_supermarket'),
('drink', 'electronics_store'),
('drink', 'farmers_market'),
('drink', 'flea_market'),
('drink', 'food_store'),
('drink', 'furniture_store'),
('drink', 'garden_center'),
('drink', 'general_store'),
('drink', 'gift_shop'),
('drink', 'hardware_store'),
('drink', 'health_food_store'),
('drink', 'home_goods_store'),
('drink', 'home_improvement_store'),
('drink', 'hypermarket'),
('drink', 'jewelry_store'),
('drink', 'liquor_store'),
('drink', 'market'),
('drink', 'pet_store'),
('drink', 'shoe_store'),
('drink', 'shopping_mall'),
('drink', 'sporting_goods_store'),
('drink', 'sportswear_store'),
('drink', 'tea_store'),
('drink', 'thrift_store'),
('drink', 'toy_store'),
('drink', 'warehouse_store'),
('drink', 'wholesaler'),
('drink', 'womens_clothing_store'),

-- ── Casual Eats (casual_eats) ─────────────────────────────────────────────
('casual_eats', 'fine_dining_restaurant'),
('casual_eats', 'bar'),
('casual_eats', 'night_club'),
('casual_eats', 'spa'),
('casual_eats', 'grocery_store'),
('casual_eats', 'supermarket'),
-- casual_eats RETAIL_EXCLUSIONS
('casual_eats', 'asian_grocery_store'),
('casual_eats', 'auto_parts_store'),
('casual_eats', 'bicycle_store'),
('casual_eats', 'building_materials_store'),
('casual_eats', 'butcher_shop'),
('casual_eats', 'cell_phone_store'),
('casual_eats', 'clothing_store'),
('casual_eats', 'convenience_store'),
('casual_eats', 'cosmetics_store'),
('casual_eats', 'department_store'),
('casual_eats', 'discount_store'),
('casual_eats', 'discount_supermarket'),
('casual_eats', 'electronics_store'),
('casual_eats', 'farmers_market'),
('casual_eats', 'flea_market'),
('casual_eats', 'food_store'),
('casual_eats', 'furniture_store'),
('casual_eats', 'garden_center'),
('casual_eats', 'general_store'),
('casual_eats', 'gift_shop'),
('casual_eats', 'hardware_store'),
('casual_eats', 'health_food_store'),
('casual_eats', 'home_goods_store'),
('casual_eats', 'home_improvement_store'),
('casual_eats', 'hypermarket'),
('casual_eats', 'jewelry_store'),
('casual_eats', 'liquor_store'),
('casual_eats', 'market'),
('casual_eats', 'pet_store'),
('casual_eats', 'shoe_store'),
('casual_eats', 'shopping_mall'),
('casual_eats', 'sporting_goods_store'),
('casual_eats', 'sportswear_store'),
('casual_eats', 'tea_store'),
('casual_eats', 'thrift_store'),
('casual_eats', 'toy_store'),
('casual_eats', 'warehouse_store'),
('casual_eats', 'wholesaler'),
('casual_eats', 'womens_clothing_store'),

-- ── Fine Dining (fine_dining) ─────────────────────────────────────────────
('fine_dining', 'fast_food_restaurant'),
('fine_dining', 'food_court'),
('fine_dining', 'bar'),
('fine_dining', 'bowling_alley'),
('fine_dining', 'amusement_park'),
('fine_dining', 'water_park'),
('fine_dining', 'video_arcade'),
('fine_dining', 'night_club'),
('fine_dining', 'hamburger_restaurant'),
('fine_dining', 'pizza_restaurant'),
('fine_dining', 'ramen_restaurant'),
('fine_dining', 'sandwich_shop'),
('fine_dining', 'diner'),
('fine_dining', 'buffet_restaurant'),
('fine_dining', 'breakfast_restaurant'),
('fine_dining', 'brunch_restaurant'),
('fine_dining', 'donut_shop'),
('fine_dining', 'ice_cream_shop'),
('fine_dining', 'bistro'),
('fine_dining', 'gastropub'),
('fine_dining', 'pub'),
('fine_dining', 'brewpub'),
('fine_dining', 'beer_garden'),
('fine_dining', 'indoor_playground'),
('fine_dining', 'amusement_center'),
('fine_dining', 'playground'),
('fine_dining', 'children_store'),
('fine_dining', 'child_care_agency'),
('fine_dining', 'preschool'),
-- fine_dining RETAIL_EXCLUSIONS
('fine_dining', 'asian_grocery_store'),
('fine_dining', 'auto_parts_store'),
('fine_dining', 'bicycle_store'),
('fine_dining', 'building_materials_store'),
('fine_dining', 'butcher_shop'),
('fine_dining', 'cell_phone_store'),
('fine_dining', 'clothing_store'),
('fine_dining', 'convenience_store'),
('fine_dining', 'cosmetics_store'),
('fine_dining', 'department_store'),
('fine_dining', 'discount_store'),
('fine_dining', 'discount_supermarket'),
('fine_dining', 'electronics_store'),
('fine_dining', 'farmers_market'),
('fine_dining', 'flea_market'),
('fine_dining', 'food_store'),
('fine_dining', 'furniture_store'),
('fine_dining', 'garden_center'),
('fine_dining', 'general_store'),
('fine_dining', 'gift_shop'),
('fine_dining', 'hardware_store'),
('fine_dining', 'health_food_store'),
('fine_dining', 'home_goods_store'),
('fine_dining', 'home_improvement_store'),
('fine_dining', 'hypermarket'),
('fine_dining', 'jewelry_store'),
('fine_dining', 'liquor_store'),
('fine_dining', 'market'),
('fine_dining', 'pet_store'),
('fine_dining', 'shoe_store'),
('fine_dining', 'shopping_mall'),
('fine_dining', 'sporting_goods_store'),
('fine_dining', 'sportswear_store'),
('fine_dining', 'tea_store'),
('fine_dining', 'thrift_store'),
('fine_dining', 'toy_store'),
('fine_dining', 'warehouse_store'),
('fine_dining', 'wholesaler'),
('fine_dining', 'womens_clothing_store'),

-- ── Watch (watch) ─────────────────────────────────────────────────────────
('watch', 'store'),
('watch', 'sports_complex'),
('watch', 'sports_club'),
('watch', 'stadium'),
('watch', 'race_course'),
('watch', 'tennis_court'),
('watch', 'swimming_pool'),
('watch', 'skateboard_park'),
('watch', 'grocery_store'),
('watch', 'supermarket'),
('watch', 'gas_station'),
('watch', 'car_repair'),
('watch', 'car_wash'),
('watch', 'parking'),
('watch', 'parking_lot'),
('watch', 'parking_garage'),
('watch', 'bus_station'),
('watch', 'train_station'),
('watch', 'transit_station'),
('watch', 'airport'),
-- watch RETAIL_EXCLUSIONS
('watch', 'asian_grocery_store'),
('watch', 'auto_parts_store'),
('watch', 'bicycle_store'),
('watch', 'building_materials_store'),
('watch', 'butcher_shop'),
('watch', 'cell_phone_store'),
('watch', 'clothing_store'),
('watch', 'convenience_store'),
('watch', 'cosmetics_store'),
('watch', 'department_store'),
('watch', 'discount_store'),
('watch', 'discount_supermarket'),
('watch', 'electronics_store'),
('watch', 'farmers_market'),
('watch', 'flea_market'),
('watch', 'food_store'),
('watch', 'furniture_store'),
('watch', 'garden_center'),
('watch', 'general_store'),
('watch', 'gift_shop'),
('watch', 'hardware_store'),
('watch', 'health_food_store'),
('watch', 'home_goods_store'),
('watch', 'home_improvement_store'),
('watch', 'hypermarket'),
('watch', 'jewelry_store'),
('watch', 'liquor_store'),
('watch', 'market'),
('watch', 'pet_store'),
('watch', 'shoe_store'),
('watch', 'shopping_mall'),
('watch', 'sporting_goods_store'),
('watch', 'sportswear_store'),
('watch', 'tea_store'),
('watch', 'thrift_store'),
('watch', 'toy_store'),
('watch', 'warehouse_store'),
('watch', 'wholesaler'),
('watch', 'womens_clothing_store'),

-- ── Live Performance (live_performance) ───────────────────────────────────
('live_performance', 'store'),
('live_performance', 'sports_complex'),
('live_performance', 'sports_club'),
('live_performance', 'stadium'),
('live_performance', 'race_course'),
('live_performance', 'tennis_court'),
('live_performance', 'swimming_pool'),
('live_performance', 'skateboard_park'),
('live_performance', 'grocery_store'),
('live_performance', 'supermarket'),
('live_performance', 'gas_station'),
('live_performance', 'car_repair'),
('live_performance', 'car_wash'),
('live_performance', 'parking'),
('live_performance', 'parking_lot'),
('live_performance', 'parking_garage'),
('live_performance', 'bus_station'),
('live_performance', 'train_station'),
('live_performance', 'transit_station'),
('live_performance', 'airport'),
-- live_performance RETAIL_EXCLUSIONS
('live_performance', 'asian_grocery_store'),
('live_performance', 'auto_parts_store'),
('live_performance', 'bicycle_store'),
('live_performance', 'building_materials_store'),
('live_performance', 'butcher_shop'),
('live_performance', 'cell_phone_store'),
('live_performance', 'clothing_store'),
('live_performance', 'convenience_store'),
('live_performance', 'cosmetics_store'),
('live_performance', 'department_store'),
('live_performance', 'discount_store'),
('live_performance', 'discount_supermarket'),
('live_performance', 'electronics_store'),
('live_performance', 'farmers_market'),
('live_performance', 'flea_market'),
('live_performance', 'food_store'),
('live_performance', 'furniture_store'),
('live_performance', 'garden_center'),
('live_performance', 'general_store'),
('live_performance', 'gift_shop'),
('live_performance', 'hardware_store'),
('live_performance', 'health_food_store'),
('live_performance', 'home_goods_store'),
('live_performance', 'home_improvement_store'),
('live_performance', 'hypermarket'),
('live_performance', 'jewelry_store'),
('live_performance', 'liquor_store'),
('live_performance', 'market'),
('live_performance', 'pet_store'),
('live_performance', 'shoe_store'),
('live_performance', 'shopping_mall'),
('live_performance', 'sporting_goods_store'),
('live_performance', 'sportswear_store'),
('live_performance', 'tea_store'),
('live_performance', 'thrift_store'),
('live_performance', 'toy_store'),
('live_performance', 'warehouse_store'),
('live_performance', 'wholesaler'),
('live_performance', 'womens_clothing_store'),

-- ── Creative & Arts (creative_arts) ───────────────────────────────────────
('creative_arts', 'fast_food_restaurant'),
('creative_arts', 'food_court'),
('creative_arts', 'bar'),
('creative_arts', 'bowling_alley'),
('creative_arts', 'amusement_park'),
('creative_arts', 'water_park'),
('creative_arts', 'spa'),
('creative_arts', 'sauna'),
('creative_arts', 'night_club'),
('creative_arts', 'store'),
('creative_arts', 'sports_complex'),
('creative_arts', 'sports_club'),
('creative_arts', 'stadium'),
('creative_arts', 'race_course'),
('creative_arts', 'tennis_court'),
('creative_arts', 'swimming_pool'),
('creative_arts', 'parking'),
('creative_arts', 'parking_lot'),
('creative_arts', 'parking_garage'),
('creative_arts', 'bus_station'),
('creative_arts', 'train_station'),
('creative_arts', 'transit_station'),
('creative_arts', 'airport'),
-- creative_arts RETAIL_EXCLUSIONS
('creative_arts', 'asian_grocery_store'),
('creative_arts', 'auto_parts_store'),
('creative_arts', 'bicycle_store'),
('creative_arts', 'building_materials_store'),
('creative_arts', 'butcher_shop'),
('creative_arts', 'cell_phone_store'),
('creative_arts', 'clothing_store'),
('creative_arts', 'convenience_store'),
('creative_arts', 'cosmetics_store'),
('creative_arts', 'department_store'),
('creative_arts', 'discount_store'),
('creative_arts', 'discount_supermarket'),
('creative_arts', 'electronics_store'),
('creative_arts', 'farmers_market'),
('creative_arts', 'flea_market'),
('creative_arts', 'food_store'),
('creative_arts', 'furniture_store'),
('creative_arts', 'garden_center'),
('creative_arts', 'general_store'),
('creative_arts', 'gift_shop'),
('creative_arts', 'hardware_store'),
('creative_arts', 'health_food_store'),
('creative_arts', 'home_goods_store'),
('creative_arts', 'home_improvement_store'),
('creative_arts', 'hypermarket'),
('creative_arts', 'jewelry_store'),
('creative_arts', 'liquor_store'),
('creative_arts', 'market'),
('creative_arts', 'pet_store'),
('creative_arts', 'shoe_store'),
('creative_arts', 'shopping_mall'),
('creative_arts', 'sporting_goods_store'),
('creative_arts', 'sportswear_store'),
('creative_arts', 'tea_store'),
('creative_arts', 'thrift_store'),
('creative_arts', 'toy_store'),
('creative_arts', 'warehouse_store'),
('creative_arts', 'wholesaler'),
('creative_arts', 'womens_clothing_store'),

-- ── Play (play) ───────────────────────────────────────────────────────────
('play', 'store'),
('play', 'art_gallery'),
('play', 'museum'),
('play', 'cultural_center'),
('play', 'art_museum'),
('play', 'history_museum'),
('play', 'fast_food_restaurant'),
('play', 'hamburger_restaurant'),
('play', 'pizza_restaurant'),
('play', 'sandwich_shop'),
('play', 'food_court'),
('play', 'buffet_restaurant'),
('play', 'parking'),
('play', 'parking_lot'),
('play', 'parking_garage'),
('play', 'bus_station'),
('play', 'train_station'),
('play', 'transit_station'),
('play', 'airport'),
-- play RETAIL_EXCLUSIONS
('play', 'asian_grocery_store'),
('play', 'auto_parts_store'),
('play', 'bicycle_store'),
('play', 'building_materials_store'),
('play', 'butcher_shop'),
('play', 'cell_phone_store'),
('play', 'clothing_store'),
('play', 'convenience_store'),
('play', 'cosmetics_store'),
('play', 'department_store'),
('play', 'discount_store'),
('play', 'discount_supermarket'),
('play', 'electronics_store'),
('play', 'farmers_market'),
('play', 'flea_market'),
('play', 'food_store'),
('play', 'furniture_store'),
('play', 'garden_center'),
('play', 'general_store'),
('play', 'gift_shop'),
('play', 'hardware_store'),
('play', 'health_food_store'),
('play', 'home_goods_store'),
('play', 'home_improvement_store'),
('play', 'hypermarket'),
('play', 'jewelry_store'),
('play', 'liquor_store'),
('play', 'market'),
('play', 'pet_store'),
('play', 'shoe_store'),
('play', 'shopping_mall'),
('play', 'sporting_goods_store'),
('play', 'sportswear_store'),
('play', 'tea_store'),
('play', 'thrift_store'),
('play', 'toy_store'),
('play', 'warehouse_store'),
('play', 'wholesaler'),
('play', 'womens_clothing_store'),

-- ── Wellness (wellness) ───────────────────────────────────────────────────
('wellness', 'gym'),
('wellness', 'fitness_center'),
('wellness', 'sports_complex'),
('wellness', 'sports_club'),
('wellness', 'stadium'),
('wellness', 'tennis_court'),
('wellness', 'swimming_pool'),
('wellness', 'race_course'),
('wellness', 'amusement_park'),
('wellness', 'amusement_center'),
('wellness', 'video_arcade'),
('wellness', 'bowling_alley'),
('wellness', 'paintball_center'),
('wellness', 'go_karting_venue'),
('wellness', 'miniature_golf_course'),
('wellness', 'skateboard_park'),
('wellness', 'night_club'),
('wellness', 'karaoke'),
('wellness', 'store'),
('wellness', 'grocery_store'),
('wellness', 'supermarket'),
('wellness', 'parking'),
('wellness', 'parking_lot'),
('wellness', 'parking_garage'),
('wellness', 'bus_station'),
('wellness', 'train_station'),
('wellness', 'transit_station'),
('wellness', 'airport'),
('wellness', 'doctor'),
('wellness', 'dentist'),
('wellness', 'medical_clinic'),
('wellness', 'medical_center'),
('wellness', 'medical_lab'),
('wellness', 'hospital'),
('wellness', 'general_hospital'),
-- wellness RETAIL_EXCLUSIONS
('wellness', 'asian_grocery_store'),
('wellness', 'auto_parts_store'),
('wellness', 'bicycle_store'),
('wellness', 'building_materials_store'),
('wellness', 'butcher_shop'),
('wellness', 'cell_phone_store'),
('wellness', 'clothing_store'),
('wellness', 'convenience_store'),
('wellness', 'cosmetics_store'),
('wellness', 'department_store'),
('wellness', 'discount_store'),
('wellness', 'discount_supermarket'),
('wellness', 'electronics_store'),
('wellness', 'farmers_market'),
('wellness', 'flea_market'),
('wellness', 'food_store'),
('wellness', 'furniture_store'),
('wellness', 'garden_center'),
('wellness', 'general_store'),
('wellness', 'gift_shop'),
('wellness', 'hardware_store'),
('wellness', 'health_food_store'),
('wellness', 'home_goods_store'),
('wellness', 'home_improvement_store'),
('wellness', 'hypermarket'),
('wellness', 'jewelry_store'),
('wellness', 'liquor_store'),
('wellness', 'market'),
('wellness', 'pet_store'),
('wellness', 'shoe_store'),
('wellness', 'shopping_mall'),
('wellness', 'sporting_goods_store'),
('wellness', 'sportswear_store'),
('wellness', 'tea_store'),
('wellness', 'thrift_store'),
('wellness', 'toy_store'),
('wellness', 'warehouse_store'),
('wellness', 'wholesaler'),
('wellness', 'womens_clothing_store'),

-- ── Flowers (flowers) ─────────────────────────────────────────────────────
('flowers', 'fast_food_restaurant'),
('flowers', 'hamburger_restaurant'),
('flowers', 'pizza_restaurant'),
('flowers', 'sandwich_shop'),
('flowers', 'buffet_restaurant'),
('flowers', 'food_court'),
('flowers', 'diner'),
('flowers', 'restaurant'),
('flowers', 'amusement_park'),
('flowers', 'amusement_center'),
('flowers', 'video_arcade'),
('flowers', 'bowling_alley'),
('flowers', 'paintball_center'),
('flowers', 'go_karting_venue'),
('flowers', 'miniature_golf_course'),
('flowers', 'skateboard_park'),
('flowers', 'movie_theater'),
('flowers', 'spa'),
('flowers', 'massage_spa'),
('flowers', 'massage'),
('flowers', 'sauna'),
('flowers', 'wellness_center'),
('flowers', 'hair_salon'),
('flowers', 'beauty_salon'),
('flowers', 'gym'),
('flowers', 'fitness_center'),
('flowers', 'sports_complex'),
('flowers', 'sports_club'),
('flowers', 'stadium'),
('flowers', 'parking'),
('flowers', 'parking_lot'),
('flowers', 'parking_garage'),
('flowers', 'bus_station'),
('flowers', 'train_station'),
('flowers', 'transit_station'),
('flowers', 'airport'),
('flowers', 'convenience_store'),
('flowers', 'general_store'),

-- ── Groceries (groceries) ─────────────────────────────────────────────────
('groceries', 'fast_food_restaurant'),
('groceries', 'hamburger_restaurant'),
('groceries', 'pizza_restaurant'),
('groceries', 'sandwich_shop'),
('groceries', 'buffet_restaurant'),
('groceries', 'food_court'),
('groceries', 'diner'),
('groceries', 'restaurant'),
('groceries', 'amusement_park'),
('groceries', 'amusement_center'),
('groceries', 'video_arcade'),
('groceries', 'bowling_alley'),
('groceries', 'paintball_center'),
('groceries', 'go_karting_venue'),
('groceries', 'miniature_golf_course'),
('groceries', 'skateboard_park'),
('groceries', 'movie_theater'),
('groceries', 'spa'),
('groceries', 'massage_spa'),
('groceries', 'massage'),
('groceries', 'sauna'),
('groceries', 'wellness_center'),
('groceries', 'hair_salon'),
('groceries', 'beauty_salon'),
('groceries', 'gym'),
('groceries', 'fitness_center'),
('groceries', 'sports_complex'),
('groceries', 'sports_club'),
('groceries', 'stadium'),
('groceries', 'parking'),
('groceries', 'parking_lot'),
('groceries', 'parking_garage'),
('groceries', 'bus_station'),
('groceries', 'train_station'),
('groceries', 'transit_station'),
('groceries', 'airport'),
('groceries', 'convenience_store'),
('groceries', 'general_store')

ON CONFLICT (category_slug, excluded_type) DO NOTHING;
```

---

## 5. SQL Changes to `query_pool_cards`

### 5.1 New filter clause

Add the following `AND NOT EXISTS` clause **after** the existing global exclusion check in all three `filtered` CTEs (count, primary, fallback):

```sql
-- Existing global exclusion (KEEP — unchanged)
AND NOT EXISTS (
  SELECT 1 FROM public.place_pool pp
  WHERE pp.id = cp.place_pool_id
    AND pp.types && v_excluded_types
)
-- NEW: Per-category exclusion — exclude cards whose place has
-- types that are excluded for ANY of the card's categories
AND NOT EXISTS (
  SELECT 1
  FROM public.place_pool pp,
       public.category_type_exclusions cte
  WHERE pp.id = cp.place_pool_id
    AND cte.category_slug = ANY(cp.categories)
    AND cte.excluded_type = ANY(pp.types)
)
```

### 5.2 How this works

1. For each candidate card `cp`, the subquery joins `place_pool` (via `place_pool_id`) and `category_type_exclusions` (via the card's categories array).
2. If **any** of the card's categories has an excluded type that matches **any** of the place's types, the `EXISTS` returns true and the card is excluded.
3. This implements UNION semantics: a card must be clean for ALL its categories.

### 5.3 NULL `place_pool_id` safety

When `cp.place_pool_id IS NULL`:
- `pp.id = cp.place_pool_id` → `pp.id = NULL` → always false
- The `NOT EXISTS` subquery returns no rows → the card is NOT excluded
- Curated cards without a place pass through safely. No crash, no accidental exclusion.

### 5.4 Empty `types` array safety

When `pp.types = '{}'` or `pp.types IS NULL`:
- `cte.excluded_type = ANY(pp.types)` → no matches when array is empty
- `ANY(NULL)` → NULL → no match
- The card passes through. Correct behavior: we can't exclude what we can't identify.

### 5.5 Empty categories safety

When `cp.categories = '{}'`:
- `cte.category_slug = ANY(cp.categories)` → no matches
- The card passes through. Correct: a card with no categories has no category-specific exclusions.

### 5.6 Performance analysis

**Table size:** ~550 rows (13 categories × ~40 types average). Fits entirely in memory.

**Index usage:**
- `idx_cte_category_slug` on `category_type_exclusions(category_slug)` — index scan for the `ANY(cp.categories)` predicate
- Existing GIN index on `place_pool.types` — supports `ANY(pp.types)` matching
- Existing `place_pool.id` PK index — supports `pp.id = cp.place_pool_id`

**Query plan:** For each candidate card, Postgres does a nested loop: look up the card's categories in the exclusion table (index scan, ~40 rows), then check overlap with place types (array contains). The exclusion table is tiny and cached. Expected overhead: < 1ms per query.

**Recommendation:** Benchmark before/after with `EXPLAIN ANALYZE` on production data. The table is so small that performance regression is extremely unlikely.

---

## 6. Post-Fetch Seeding Filter Enhancement

### 6.1 Current behavior (`admin-seed-places/index.ts:201-227`)

```typescript
// Current: only checks primaryType against 3 global types
if (p.primaryType && GLOBAL_EXCLUDED_PLACE_TYPES.includes(p.primaryType)) {
  rejectedExcludedType++;
  return false;
}
```

### 6.2 Required changes

The `applyPostFetchFilters` function must be enhanced to:
1. Accept the `seedingCategory` (category ID) as a parameter
2. Check **all** types (not just `primaryType`) against category-specific exclusions
3. Use `getExcludedTypesForCategory()` from `categoryPlaceTypes.ts` (already exists, returns global + category-specific)

### 6.3 New implementation

**File:** `supabase/functions/admin-seed-places/index.ts`

```typescript
import {
  GLOBAL_EXCLUDED_PLACE_TYPES,
  getExcludedTypesForCategory,
} from "../_shared/categoryPlaceTypes.ts";

// Updated signature — accepts category for per-category filtering
function applyPostFetchFilters(places: any[], categoryId: string): FilterResult {
  let rejectedNoPhotos = 0;
  let rejectedClosed = 0;
  let rejectedExcludedType = 0;

  // Get full exclusion set: global + category-specific
  const excludedTypes = getExcludedTypesForCategory(categoryId);
  const excludedSet = new Set(excludedTypes);

  const passed = places.filter((p: any) => {
    // Reject permanently closed
    if (p.businessStatus === "CLOSED_PERMANENTLY") {
      rejectedClosed++;
      return false;
    }
    // Reject no photos
    if (!p.photos || p.photos.length === 0) {
      rejectedNoPhotos++;
      return false;
    }
    // Reject if ANY type (not just primaryType) is in the exclusion set
    const placeTypes: string[] = p.types ?? [];
    if (placeTypes.some((t: string) => excludedSet.has(t))) {
      rejectedExcludedType++;
      return false;
    }
    return true;
  });

  return { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType };
}
```

### 6.4 Call site change

In `seedCategory()`, update the call at line ~467:

```typescript
// Before:
const { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType } =
  applyPostFetchFilters(places);

// After:
const { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType } =
  applyPostFetchFilters(places, config.id);
```

### 6.5 Note on `getExcludedTypesForCategory`

This function at `categoryPlaceTypes.ts:512` takes a category string (any format) and returns global + category-specific exclusions. It uses `resolveCategory()` internally. The seeding code passes `config.id` (e.g., `'nature_views'`), which `resolveCategory` handles via the alias map. Verified: `'nature_views'` → `'Nature & Views'` → lookup in `CATEGORY_EXCLUDED_PLACE_TYPES`.

---

## 7. One-Time Data Cleanup

### 7.1 Audit query — find all violating cards

Run this AFTER the `category_type_exclusions` table is populated:

```sql
-- Find active cards whose places have types excluded for the card's categories
SELECT
  cp.id AS card_id,
  cp.title,
  cp.categories,
  pp.name AS place_name,
  pp.types AS place_types,
  array_agg(DISTINCT cte.excluded_type) AS violated_exclusions,
  array_agg(DISTINCT cte.category_slug) AS violated_categories
FROM public.card_pool cp
JOIN public.place_pool pp ON pp.id = cp.place_pool_id
JOIN public.category_type_exclusions cte
  ON cte.category_slug = ANY(cp.categories)
  AND cte.excluded_type = ANY(pp.types)
WHERE cp.is_active = true
GROUP BY cp.id, cp.title, cp.categories, pp.name, pp.types
ORDER BY array_length(cp.categories, 1) DESC, cp.title;
```

This query shows exactly which cards are violating, which types violated, and which category exclusions they hit. **Run this first, review the output, then decide whether to deactivate or just report.**

### 7.2 Deactivation query

```sql
-- Deactivate cards that violate per-category exclusions
UPDATE public.card_pool cp
SET is_active = false,
    updated_at = now()
WHERE cp.is_active = true
  AND cp.place_pool_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.place_pool pp
    JOIN public.category_type_exclusions cte
      ON cte.category_slug = ANY(cp.categories)
      AND cte.excluded_type = ANY(pp.types)
    WHERE pp.id = cp.place_pool_id
  );
```

### 7.3 Cleanup strategy

1. Run the audit query first — understand the blast radius (how many cards will be deactivated)
2. If the count is manageable (< 5% of active cards), run the deactivation
3. If the count is large (> 5%), investigate whether the exclusion lists are too aggressive before deactivating
4. The deactivation is reversible: `UPDATE card_pool SET is_active = true WHERE ...`

---

## 8. Edge Cases

| Case | Behavior | Why |
|------|----------|-----|
| `place_pool_id IS NULL` (curated card, no place) | Card passes through — not excluded | `NOT EXISTS` subquery finds no matching `pp` rows |
| `pp.types = '{}'` (place with empty types) | Card passes through | `ANY('{}')` matches nothing |
| `pp.types IS NULL` | Card passes through | `ANY(NULL)` evaluates to NULL, no match |
| `cp.categories = '{}'` (card with no categories) | Card passes through | `ANY('{}')` matches nothing in exclusion table |
| Card with single category (normal case) | Filtered by that category's exclusions only | Standard path |
| Card with multiple categories | Filtered by UNION of all categories' exclusions | If excluded from ANY category, card is removed |
| Category not in exclusion table (future new category) | No exclusions applied for that category | `ANY(cp.categories)` finds no rows for unknown slug |
| `v_slug_categories = '{}'` (no category filter) | Per-category exclusions still apply based on card's OWN categories | The exclusion check is on `cp.categories`, not `v_slug_categories` |
| Global exclusions + per-category exclusions overlap (e.g., `gym` in both) | Both filters run; global catches it first, per-category is redundant but harmless | Two independent `NOT EXISTS` clauses |

---

## 9. Test Criteria

### 9.1 Verification queries (run after migration)

```sql
-- TEST 1: Fine Dining cards should NOT include fast_food_restaurant places
-- Expected: 0 rows
SELECT cp.id, cp.title, pp.types
FROM card_pool cp
JOIN place_pool pp ON pp.id = cp.place_pool_id
WHERE cp.is_active = true
  AND 'fine_dining' = ANY(cp.categories)
  AND 'fast_food_restaurant' = ANY(pp.types);

-- TEST 2: Drink cards should NOT include asian_grocery_store places
-- Expected: 0 rows
SELECT cp.id, cp.title, pp.types
FROM card_pool cp
JOIN place_pool pp ON pp.id = cp.place_pool_id
WHERE cp.is_active = true
  AND 'drink' = ANY(cp.categories)
  AND 'asian_grocery_store' = ANY(pp.types);

-- TEST 3: Global exclusions still work (gym should be excluded from ALL categories)
-- Expected: 0 rows
SELECT cp.id, cp.title, pp.types
FROM card_pool cp
JOIN place_pool pp ON pp.id = cp.place_pool_id
WHERE cp.is_active = true
  AND 'gym' = ANY(pp.types);

-- TEST 4: Cards WITHOUT excluded types are still served
-- Expected: > 0 rows (normal cards exist)
SELECT COUNT(*)
FROM card_pool cp
JOIN place_pool pp ON pp.id = cp.place_pool_id
WHERE cp.is_active = true
  AND 'fine_dining' = ANY(cp.categories)
  AND NOT ('fast_food_restaurant' = ANY(pp.types));

-- TEST 5: Curated cards with NULL place_pool_id still served
-- Expected: any curated cards without places pass through
SELECT COUNT(*)
FROM card_pool
WHERE is_active = true
  AND place_pool_id IS NULL;

-- TEST 6: Exclusion table has expected row count (~550)
SELECT COUNT(*) FROM category_type_exclusions;
-- Also verify per-category counts
SELECT category_slug, COUNT(*) AS exclusion_count
FROM category_type_exclusions
GROUP BY category_slug
ORDER BY category_slug;

-- TEST 7: query_pool_cards returns Fine Dining cards without excluded types
-- (Functional test — run via RPC with a test user)
-- Verify no returned card has fast_food_restaurant, hamburger_restaurant,
-- pizza_restaurant, children_store, etc. in its place's types
```

### 9.2 Performance benchmark

```sql
-- Run BEFORE migration (on current query_pool_cards):
EXPLAIN ANALYZE
SELECT * FROM query_pool_cards(
  'TEST_USER_UUID',
  ARRAY['Fine Dining'],
  37.7, 37.8, -122.5, -122.4,
  1000, 'single', NULL,
  '1970-01-01T00:00:00Z', '{}', 20, 0, '{}'
);
-- Record execution time

-- Run AFTER migration (same parameters):
-- Compare execution time. Acceptable: < 20% increase.
```

---

## 10. Migration File

**Filename:** `supabase/migrations/20260321110000_per_category_exclusion_enforcement.sql`

**Contents:** Combines sections 4.1, 4.2, and the updated `query_pool_cards` function (section 5) into a single migration.

The migration should:
1. Create the `category_type_exclusions` table with PK and index
2. Enable RLS with read-only policy for authenticated
3. Insert all exclusion rows (from section 4.2)
4. `CREATE OR REPLACE FUNCTION query_pool_cards(...)` with the new `NOT EXISTS` clause added to all three `filtered` CTEs

---

## 11. Files Changed

| File | Change | Type |
|------|--------|------|
| `supabase/migrations/20260321110000_per_category_exclusion_enforcement.sql` | New migration: table + data + updated function | **New file** |
| `supabase/functions/admin-seed-places/index.ts` | Enhanced `applyPostFetchFilters` to accept category, check all types | **Edit** |
| `supabase/functions/admin-seed-places/index.ts` | Updated `seedCategory` call site to pass `config.id` | **Edit** |

### Files NOT changed (confirmed out of scope)
- No mobile code changes
- No `card_pool` schema changes
- No changes to Block 1's category normalization
- No Pool Intelligence or admin page changes
- `categoryPlaceTypes.ts` — not changed (source of truth remains, already has the exclusion lists)

---

## 12. Invariants

| Invariant | Enforced by |
|-----------|-------------|
| No card is served if its place has a type excluded for any of the card's categories | SQL `NOT EXISTS` join on `category_type_exclusions` — schema-level |
| Global exclusions (gym, fitness_center, dog_park) always apply regardless of category | Separate `NOT EXISTS` clause with `v_excluded_types` — unchanged |
| Curated cards without places are never accidentally excluded | NULL `place_pool_id` → `NOT EXISTS` returns no rows → card passes |
| Exclusion lists are auditable | `SELECT * FROM category_type_exclusions WHERE category_slug = ?` |
| Adding a new category with no exclusions is safe | No rows in exclusion table → no filtering applied |

---

## 13. README Impact

Update `full_scope_architecture.md`:
- **§23 (Schema):** Add `category_type_exclusions` table documentation
- **§22 (Edge Functions):** Update `admin-seed-places` description to note category-aware post-fetch filtering
- **§ query_pool_cards docs:** Document per-category exclusion as a filtering layer

---

## 14. Rollback Plan

If something goes wrong:
1. Drop the new `NOT EXISTS` clause from `query_pool_cards` (revert to Block 1 version)
2. The `category_type_exclusions` table can remain — it's inert if not referenced by the function
3. The post-fetch filter change is backward-compatible (only filters MORE, never less)

To fully rollback:
```sql
-- Revert query_pool_cards to Block 1 version
-- (Re-run the Block 1 migration SQL)

-- Optionally drop the table
DROP TABLE IF EXISTS public.category_type_exclusions;
```
