-- ORCH-0590 Slice 2 — seed second signal: drinks
-- Weights paper-sim-validated against 8 Raleigh anchors
-- (see outputs/INVESTIGATION_ORCH-0590_SLICE2_DRINKS_SIGNAL_VERTICAL.md §F-3).
-- DO NOT edit weights here post-deploy — admin tunes via signal_definition_versions row inserts.

INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES ('drinks', 'Drinks', 'type-grounded', true)
ON CONFLICT (id) DO NOTHING;

WITH version_insert AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'drinks',
    'v1.0.0',
    '{
      "min_rating": 4.0,
      "min_reviews": 30,
      "bypass_rating": 4.6,
      "field_weights": {
        "types_includes_bar": 40,
        "types_includes_cocktail_bar": 60,
        "types_includes_wine_bar": 50,
        "types_includes_brewery": 50,
        "types_includes_winery": 50,
        "types_includes_distillery": 50,
        "types_includes_pub": 40,
        "types_includes_irish_pub": 40,
        "types_includes_beer_garden": 40,
        "types_includes_lounge_bar": 35,
        "types_includes_sports_bar": 30,
        "types_includes_night_club": 30,
        "serves_cocktails": 20,
        "serves_wine": 10,
        "serves_beer": 10,
        "dine_in": 5,
        "live_music": 15,
        "outdoor_seating": 10,
        "good_for_groups": 15,
        "price_level_moderate": 5,
        "price_level_expensive": 10,
        "delivery": -10,
        "takeout": -5,
        "serves_breakfast": -10,
        "types_includes_fast_food_restaurant": -40,
        "types_includes_meal_takeaway": -30,
        "types_includes_meal_delivery": -30,
        "types_includes_chicken_wings_restaurant": -15
      },
      "scale": {
        "rating_multiplier": 10,
        "rating_cap": 35,
        "reviews_log_multiplier": 5,
        "reviews_cap": 25
      },
      "text_patterns": {
        "summary_regex": "cocktail|brewery|beer garden|wine bar|taproom|bourbon|spirits|bartender|mixology|craft beer|wine list|pub|tavern|dive bar|speakeasy",
        "summary_weight": 25,
        "reviews_regex": "great cocktails|craft beer|wine selection|bartender|mixology|bourbon|whiskey|speakeasy|happy hour|best drinks",
        "reviews_weight": 15,
        "atmosphere_regex": "dimly lit|vintage|prohibition|live music|rooftop|patio|fireplace",
        "atmosphere_weight": 10
      },
      "cap": 200,
      "clamp_min": 0
    }'::jsonb,
    'Slice 2 first-pass weights. Paper-sim validated on 8 Raleigh anchors: Foundation ~151, Bittersweet 200(cap), Watts & Ward 200(cap), Trophy Taproom ~148, Raleigh Beer Garden 200(cap), Flying Saucer 200(cap), Crawford and Son <120 (restaurant not bar), Trophy Brewing & Pizza ~170. Bare word "bar" deliberately excluded from summary_regex to avoid false-matching restaurants with "full bar" mentions.'
  )
  RETURNING id
)
UPDATE public.signal_definitions
SET current_version_id = (SELECT id FROM version_insert),
    updated_at = now()
WHERE id = 'drinks';

-- ROLLBACK:
-- DELETE FROM public.signal_definition_versions WHERE signal_id = 'drinks';
-- DELETE FROM public.signal_definitions WHERE id = 'drinks';
