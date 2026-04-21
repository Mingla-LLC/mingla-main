-- ORCH-0595 Slice 3 — seed third signal: brunch
-- Weights paper-sim-validated against 8 Raleigh anchors
-- (see outputs/INVESTIGATION_ORCH-0595_SLICE3_BRUNCH_SIGNAL_VERTICAL.md §F-3).
-- DO NOT edit weights here post-deploy — admin tunes via signal_definition_versions row inserts.

INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES ('brunch', 'Brunch', 'type-grounded', true)
ON CONFLICT (id) DO NOTHING;

WITH version_insert AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'brunch',
    'v1.0.0',
    '{
      "min_rating": 4.0,
      "min_reviews": 30,
      "bypass_rating": 4.6,
      "field_weights": {
        "types_includes_brunch_restaurant": 80,
        "types_includes_breakfast_restaurant": 70,
        "types_includes_diner": 30,
        "types_includes_cafe": 15,
        "types_includes_bakery": 10,
        "types_includes_coffee_shop": 10,
        "serves_brunch": 50,
        "serves_breakfast": 30,
        "serves_lunch": 15,
        "dine_in": 5,
        "good_for_groups": 10,
        "outdoor_seating": 10,
        "reservable": 5,
        "delivery": 5,
        "takeout": 0,
        "serves_dinner": 0,
        "price_level_inexpensive": 5,
        "price_level_moderate": 10,
        "price_level_expensive": 5,
        "price_level_very_expensive": -15,
        "types_includes_fast_food_restaurant": -30,
        "types_includes_meal_takeaway": -20,
        "types_includes_meal_delivery": -20,
        "types_includes_night_club": -50,
        "types_includes_sports_bar": -30,
        "types_includes_brewery": -20,
        "types_includes_bar": -15,
        "types_includes_cocktail_bar": -15,
        "types_includes_pub": -15,
        "types_includes_wine_bar": -10
      },
      "scale": {
        "rating_multiplier": 10,
        "rating_cap": 35,
        "reviews_log_multiplier": 5,
        "reviews_cap": 25
      },
      "text_patterns": {
        "summary_regex": "brunch|mimosa|eggs benedict|avocado toast|pancake|french toast|bloody mary|bottomless|weekend brunch|breakfast|waffle|omelet|biscuit|crepe",
        "summary_weight": 25,
        "reviews_regex": "brunch|mimosa|eggs benedict|avocado toast|pancake|french toast|bloody mary|bottomless|great breakfast|best brunch|delicious pancakes",
        "reviews_weight": 15,
        "atmosphere_regex": "bright|airy|sunny|weekend|sunday|morning|patio|garden",
        "atmosphere_weight": 10
      },
      "cap": 200,
      "clamp_min": 0
    }'::jsonb,
    'Slice 3 first-pass weights. Paper-sim validated: First Watch, Big Eds City Market, Big Eds North, Irregardless, Morning Times, Jubala Coffee all cap at 200. Pure coffee shops without food score <60 (correctly excluded by filter_min 120). Dinner-only restaurants score <60 (naturally excluded via missing serves_brunch/breakfast booleans). Time-of-day sensitivity baked into field_weights — no RPC modification needed for v1.0.0.'
  )
  RETURNING id
)
UPDATE public.signal_definitions
SET current_version_id = (SELECT id FROM version_insert),
    updated_at = now()
WHERE id = 'brunch';

-- ROLLBACK:
-- DELETE FROM public.signal_definition_versions WHERE signal_id = 'brunch';
-- DELETE FROM public.signal_definitions WHERE id = 'brunch';
