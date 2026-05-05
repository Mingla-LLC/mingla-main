-- ═══════════════════════════════════════════════════════════════════════════════
-- Per-Category Exclusion Enforcement (Block 2)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- PROBLEM: Per-category exclusions are defined in TypeScript but never enforced
-- at serve time. Only 3 global types (gym, fitness_center, dog_park) are filtered.
-- Users see inappropriate places: kids' venues in Fine Dining, grocery stores
-- in Drink, fast food in Creative Arts.
--
-- SOLUTION: Schema-enforced lookup table + NOT EXISTS clause in query_pool_cards.
-- ~550 rows covering all 13 categories. Auditable, admin-editable, durable.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Part A: Create the exclusion table ──────────────────────────────────────

CREATE TABLE public.category_type_exclusions (
  category_slug TEXT NOT NULL,
  excluded_type TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category_slug, excluded_type)
);

CREATE INDEX idx_cte_category_slug ON public.category_type_exclusions (category_slug);

ALTER TABLE public.category_type_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read exclusions"
  ON public.category_type_exclusions
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated — only service_role can write

-- ── Part B: Insert all exclusion rows ───────────────────────────────────────

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

-- ── Part C: Replace query_pool_cards with per-category exclusion ────────────

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_budget_max INTEGER DEFAULT 1000,
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_pref_updated_at TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z',
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_price_tiers TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  card JSONB,
  total_unseen BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_unseen BIGINT;
  v_use_tiers BOOLEAN := (array_length(p_price_tiers, 1) IS NOT NULL AND array_length(p_price_tiers, 1) > 0);
  -- Globally excluded place types — must match GLOBAL_EXCLUDED_PLACE_TYPES in categoryPlaceTypes.ts
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park'];
  -- Hidden categories: cards tagged ONLY with these are excluded from regular queries
  v_hidden_categories TEXT[] := ARRAY['groceries'];
  -- Normalized slug version of p_categories (built in the normalization block below)
  v_slug_categories TEXT[];
BEGIN
  -- STRICT CATEGORY NORMALIZATION
  -- card_pool.categories stores slugs (e.g., 'nature_views', 'casual_eats').
  -- Callers send display names (e.g., 'Nature & Views') or slugs.
  -- Only known categories are accepted. Unknown values are dropped.
  -- This is intentional: broken callers fail visibly (too many cards), not silently (zero cards).
  -- To add a new category: add WHEN branches for both display name AND slug.
  IF p_categories = '{}' THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(slug), '{}')
    INTO v_slug_categories
    FROM (
      SELECT CASE val
        -- Display name → slug
        WHEN 'Nature & Views'   THEN 'nature_views'
        WHEN 'First Meet'       THEN 'first_meet'
        WHEN 'Picnic Park'      THEN 'picnic_park'
        WHEN 'Drink'            THEN 'drink'
        WHEN 'Casual Eats'      THEN 'casual_eats'
        WHEN 'Fine Dining'      THEN 'fine_dining'
        WHEN 'Watch'            THEN 'watch'
        WHEN 'Live Performance' THEN 'live_performance'
        WHEN 'Creative & Arts'  THEN 'creative_arts'
        WHEN 'Play'             THEN 'play'
        WHEN 'Wellness'         THEN 'wellness'
        WHEN 'Flowers'          THEN 'flowers'
        WHEN 'Groceries'        THEN 'groceries'
        -- Slug passthrough: if already a known slug, keep it
        WHEN 'nature_views'     THEN 'nature_views'
        WHEN 'first_meet'       THEN 'first_meet'
        WHEN 'picnic_park'      THEN 'picnic_park'
        WHEN 'drink'            THEN 'drink'
        WHEN 'casual_eats'      THEN 'casual_eats'
        WHEN 'fine_dining'      THEN 'fine_dining'
        WHEN 'watch'            THEN 'watch'
        WHEN 'live_performance' THEN 'live_performance'
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        WHEN 'wellness'         THEN 'wellness'
        WHEN 'flowers'          THEN 'flowers'
        WHEN 'groceries'        THEN 'groceries'
        ELSE NULL  -- Unknown value → dropped
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;

  -- ── Step 1: Count total unseen cards ──────────────────────────────────────

  WITH
  excluded AS (
    SELECT unnest(p_exclude_card_ids) AS card_id
  ),
  seen AS (
    SELECT uci.card_pool_id AS card_id
    FROM public.user_card_impressions uci
    WHERE uci.user_id = p_user_id
      AND uci.created_at >= p_pref_updated_at
  ),
  filtered AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
        OR
        (NOT v_use_tiers AND cp.price_min <= p_budget_max)
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT card_id FROM excluded)
      AND cp.id NOT IN (SELECT card_id FROM seen)
      -- Exclude globally banned place types (gym, fitness_center, dog_park)
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id
          AND pp.types && v_excluded_types
      )
      -- PER-CATEGORY EXCLUSION (Block 2 — hardened 2026-03-21)
      -- Excludes cards whose place has types excluded for the user's selected categories.
      -- Uses v_slug_categories (user's query), NOT cp.categories (card's tags).
      -- Source of truth: category_type_exclusions table (~550 rows, schema-enforced).
      -- When v_slug_categories is empty, this clause is inert (no category = no exclusion).
      -- Global exclusions above still apply regardless.
      -- To add exclusions: INSERT into category_type_exclusions. To audit: SELECT * FROM category_type_exclusions WHERE category_slug = ?.
      AND NOT EXISTS (
        SELECT 1
        FROM public.place_pool pp,
             public.category_type_exclusions cte
        WHERE pp.id = cp.place_pool_id
          AND cte.category_slug = ANY(v_slug_categories)
          AND cte.excluded_type = ANY(pp.types)
      )
      -- Exclude cards that are ONLY tagged with hidden categories
      AND NOT (cp.categories <@ v_hidden_categories)
  ),
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  )
  SELECT COUNT(*) INTO v_total_unseen FROM deduped;

  -- ── Step 2: Branch on whether unseen cards exist ──────────────────────────

  IF v_total_unseen > 0 THEN
    -- ── Primary path: return unseen cards (ordered by popularity) ──────────
    RETURN QUERY
    WITH
    excluded AS (
      SELECT unnest(p_exclude_card_ids) AS card_id
    ),
    seen AS (
      SELECT uci.card_pool_id AS card_id
      FROM public.user_card_impressions uci
      WHERE uci.user_id = p_user_id
        AND uci.created_at >= p_pref_updated_at
    ),
    filtered AS (
      SELECT cp.*
      FROM public.card_pool cp
      WHERE cp.is_active = true
        AND cp.card_type = p_card_type
        AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        AND cp.id NOT IN (SELECT card_id FROM seen)
        -- Exclude globally banned place types
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
        -- PER-CATEGORY EXCLUSION (Block 2 — hardened 2026-03-21)
        -- Excludes cards whose place has types excluded for the user's selected categories.
        -- Uses v_slug_categories (user's query), NOT cp.categories (card's tags).
        -- Source of truth: category_type_exclusions table (~550 rows, schema-enforced).
        -- When v_slug_categories is empty, this clause is inert (no category = no exclusion).
        -- Global exclusions above still apply regardless.
        -- To add exclusions: INSERT into category_type_exclusions. To audit: SELECT * FROM category_type_exclusions WHERE category_slug = ?.
        AND NOT EXISTS (
          SELECT 1
          FROM public.place_pool pp,
               public.category_type_exclusions cte
          WHERE pp.id = cp.place_pool_id
            AND cte.category_slug = ANY(v_slug_categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        -- Exclude cards that are ONLY tagged with hidden categories
        AND NOT (cp.categories <@ v_hidden_categories)
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    enriched AS (
      SELECT
        d.*,
        COALESCE(
          NULLIF(d.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM deduped d
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
    )
    SELECT
      CASE
        WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
        THEN to_jsonb(e.*) - 'resolved_website' || jsonb_build_object('website', e.resolved_website)
        ELSE to_jsonb(e.*) - 'resolved_website'
      END AS card,
      v_total_unseen AS total_unseen
    FROM enriched e
    ORDER BY e.popularity_score DESC
    LIMIT p_limit
    OFFSET p_offset;

  ELSE
    -- ── Fallback: impression rotation ────────────────────────────────────────
    RETURN QUERY
    WITH
    excluded AS (
      SELECT unnest(p_exclude_card_ids) AS card_id
    ),
    filtered_no_impressions AS (
      SELECT cp.*
      FROM public.card_pool cp
      WHERE cp.is_active = true
        AND cp.card_type = p_card_type
        AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        -- Exclude globally banned place types
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
        -- PER-CATEGORY EXCLUSION (Block 2 — hardened 2026-03-21)
        -- Excludes cards whose place has types excluded for the user's selected categories.
        -- Uses v_slug_categories (user's query), NOT cp.categories (card's tags).
        -- Source of truth: category_type_exclusions table (~550 rows, schema-enforced).
        -- When v_slug_categories is empty, this clause is inert (no category = no exclusion).
        -- Global exclusions above still apply regardless.
        -- To add exclusions: INSERT into category_type_exclusions. To audit: SELECT * FROM category_type_exclusions WHERE category_slug = ?.
        AND NOT EXISTS (
          SELECT 1
          FROM public.place_pool pp,
               public.category_type_exclusions cte
          WHERE pp.id = cp.place_pool_id
            AND cte.category_slug = ANY(v_slug_categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        -- Exclude cards that are ONLY tagged with hidden categories
        AND NOT (cp.categories <@ v_hidden_categories)
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered_no_impressions f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    with_impression_age AS (
      SELECT
        d.*,
        COALESCE(uci.created_at, '1970-01-01'::TIMESTAMPTZ) AS last_seen_at,
        COALESCE(
          NULLIF(d.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM deduped d
      LEFT JOIN public.user_card_impressions uci
        ON uci.card_pool_id = d.id AND uci.user_id = p_user_id
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
      ORDER BY last_seen_at ASC, d.popularity_score DESC
      LIMIT p_limit
      OFFSET p_offset
    )
    SELECT
      CASE
        WHEN w.resolved_website IS NOT NULL AND (w.website IS NULL OR w.website = '')
        THEN to_jsonb(w.*) - 'resolved_website' - 'last_seen_at' || jsonb_build_object('website', w.resolved_website)
        ELSE to_jsonb(w.*) - 'resolved_website' - 'last_seen_at'
      END AS card,
      (SELECT COUNT(*) FROM deduped)::BIGINT AS total_unseen
    FROM with_impression_age w;

  END IF;
END;
$$;
