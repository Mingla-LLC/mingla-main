-- ORCH-0596 Slice 4 — seed fourth signal: casual_food
-- Weights paper-sim-validated against 10 Raleigh anchors
-- (see outputs/INVESTIGATION_ORCH-0596_SLICE4_CASUAL_FOOD_SIGNAL_VERTICAL.md §F-4).
-- DO NOT edit weights here post-deploy — admin tunes via signal_definition_versions row inserts.

INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES ('casual_food', 'Casual Food', 'type-grounded', true)
ON CONFLICT (id) DO NOTHING;

WITH version_insert AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'casual_food',
    'v1.0.0',
    '{
      "min_rating": 4.0,
      "min_reviews": 30,
      "bypass_rating": 4.6,
      "field_weights": {
        "types_includes_cafe": 50,
        "types_includes_sandwich_shop": 50,
        "types_includes_pizza_restaurant": 50,
        "types_includes_mexican_restaurant": 50,
        "types_includes_thai_restaurant": 50,
        "types_includes_chinese_restaurant": 50,
        "types_includes_vietnamese_restaurant": 50,
        "types_includes_korean_restaurant": 50,
        "types_includes_japanese_restaurant": 45,
        "types_includes_indian_restaurant": 50,
        "types_includes_mediterranean_restaurant": 50,
        "types_includes_greek_restaurant": 50,
        "types_includes_lebanese_restaurant": 50,
        "types_includes_italian_restaurant": 45,
        "types_includes_taco_restaurant": 50,
        "types_includes_burrito_restaurant": 40,
        "types_includes_ramen_restaurant": 40,
        "types_includes_noodle_shop": 40,
        "types_includes_sushi_restaurant": 35,
        "types_includes_hamburger_restaurant": 40,
        "types_includes_chicken_restaurant": 35,
        "types_includes_barbecue_restaurant": 40,
        "types_includes_deli": 40,
        "types_includes_bakery": 30,
        "types_includes_diner": 30,
        "types_includes_american_restaurant": 20,
        "types_includes_family_restaurant": 25,
        "types_includes_food_court": 25,
        "serves_lunch": 30,
        "serves_dinner": 15,
        "dine_in": 10,
        "takeout": 10,
        "good_for_groups": 10,
        "price_level_inexpensive": 25,
        "price_level_moderate": 15,
        "price_level_expensive": -15,
        "price_level_very_expensive": -40,
        "types_includes_fine_dining_restaurant": -40,
        "types_includes_steak_house": -30,
        "types_includes_cocktail_bar": -40,
        "types_includes_wine_bar": -40,
        "types_includes_night_club": -50,
        "types_includes_brewery": -15,
        "types_includes_bar": -5,
        "types_includes_sports_bar": -15,
        "types_includes_fast_food_restaurant": -25,
        "types_includes_golf_course": -80,
        "types_includes_indoor_golf_course": -80,
        "types_includes_athletic_field": -80,
        "types_includes_sports_activity_location": -80,
        "types_includes_food_store": -60,
        "types_includes_grocery_store": -60
      },
      "scale": {
        "rating_multiplier": 10,
        "rating_cap": 35,
        "reviews_log_multiplier": 5,
        "reviews_cap": 25
      },
      "text_patterns": {
        "summary_regex": "casual|quick|easy|family-friendly|neighborhood|local favorite|hole-in-the-wall|cozy|laid-back|unpretentious|no-frills|relaxed|informal",
        "summary_weight": 20,
        "reviews_regex": "casual|quick|easy|family-friendly|great for lunch|local spot|cozy|laid-back|low-key",
        "reviews_weight": 10,
        "atmosphere_regex": "casual|cozy|welcoming|friendly",
        "atmosphere_weight": 8
      },
      "cap": 200,
      "clamp_min": 0
    }'::jsonb,
    'Slice 4 first-pass weights. Paper-sim 10/10 correct: Neomonde/Miltons/Chido/Lilys/Taqueria Zacatecana/Bida Manda all cap 200; Chipotle excluded (rating 3.4 < min 4.0); Crawford/Jolie/Angus/Capital correctly below filter 120.'
  )
  RETURNING id
)
UPDATE public.signal_definitions
SET current_version_id = (SELECT id FROM version_insert),
    updated_at = now()
WHERE id = 'casual_food';

-- ROLLBACK:
-- DELETE FROM public.signal_definition_versions WHERE signal_id = 'casual_food';
-- DELETE FROM public.signal_definitions WHERE id = 'casual_food';
