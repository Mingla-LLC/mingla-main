-- ORCH-0588 Slice 1 — seed first signal: fine_dining
-- Weights mirror dispatch §2.2 + spec §F-9 paper sim validated weights.
-- DO NOT edit weights here post-deploy — admin tunes via signal_definition_versions row inserts.

INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES ('fine_dining', 'Fine Dining', 'type-grounded', true)
ON CONFLICT (id) DO NOTHING;

WITH version_insert AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'fine_dining',
    'v1.0.0',
    '{
      "min_rating": 4.0,
      "min_reviews": 50,
      "bypass_rating": 4.6,
      "field_weights": {
        "types_includes_restaurant": 30,
        "types_includes_fine_dining_restaurant": 60,
        "types_includes_steak_house": 30,
        "types_includes_seafood_restaurant": 30,
        "types_includes_sushi_restaurant": 30,
        "types_includes_french_restaurant": 30,
        "types_includes_italian_restaurant": 30,
        "types_includes_japanese_restaurant": 30,
        "serves_dinner": 30,
        "reservable": 30,
        "dine_in": 15,
        "serves_wine": 10,
        "serves_dessert": 8,
        "serves_cocktails": 5,
        "serves_lunch": 5,
        "serves_vegetarian_food": 5,
        "price_level_expensive": 25,
        "price_level_very_expensive": 50,
        "price_range_start_above_2500": 10,
        "price_range_start_above_4500": 15,
        "price_range_start_above_7000": 15,
        "price_range_end_above_8000": 10,
        "price_range_end_above_15000": 15,
        "delivery": -20,
        "takeout": -10,
        "allows_dogs": -20,
        "good_for_groups": -10,
        "good_for_children": -15,
        "serves_brunch": -5,
        "types_includes_fast_food_restaurant": -40,
        "types_includes_meal_takeaway": -25,
        "types_includes_meal_delivery": -25
      },
      "scale": {
        "rating_multiplier": 10,
        "rating_cap": 50,
        "reviews_log_multiplier": 5,
        "reviews_cap": 25
      },
      "text_patterns": {
        "summary_regex": "fine dining|upscale|elegant|refined|tasting menu|chef|cuisine|sommelier|prix fixe|white tablecloth",
        "summary_weight": 25,
        "reviews_regex": "fine dining|special occasion|anniversary|tasting|prix fixe|chef|impeccable",
        "reviews_weight": 15,
        "atmosphere_regex": "candle|fireplace|wine cellar|tasting room|piano",
        "atmosphere_weight": 10
      },
      "cap": 200,
      "clamp_min": 0
    }'::jsonb,
    'Slice 1 first-pass weights. Tuned from F-9 paper sim against 17 known Raleigh places.'
  )
  RETURNING id
)
UPDATE public.signal_definitions
SET current_version_id = (SELECT id FROM version_insert),
    updated_at = now()
WHERE id = 'fine_dining';

-- ROLLBACK:
-- DELETE FROM public.signal_definition_versions WHERE signal_id = 'fine_dining';
-- DELETE FROM public.signal_definitions WHERE id = 'fine_dining';
