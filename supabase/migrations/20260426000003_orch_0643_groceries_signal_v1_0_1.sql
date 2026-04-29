-- ORCH-0643 v1.0.1 — groceries signal weight tuning (post-scorer observation fix)
-- Parent: 20260426000002_orch_0643_seed_groceries_signal.sql (v1.0.0)
-- Parent spec: outputs/SPEC_ORCH-0643_v2_GROCERIES_SIGNAL_REGISTRATION.md (v2.1 amended)
-- Observation trigger: post-Raleigh-scorer run exposed 3 data-quality issues with v1.0.0:
--   (1) Harris Teeter (14 Raleigh locations) all scored 86-88 — below 120 — because Google
--       tags their in-store butcher counters as `butcher_shop`, and v1.0.0 penalized
--       butcher_shop at -40. That -40 dropped HT from ~127 to ~87, below threshold.
--   (2) Trader Joe's scored 139 instead of paper-sim-predicted 198 because Google tags
--       TJ's with `liquor_store` (they sell wine) and v1.0.0 penalized that at -60.
--   (3) Albaraka Mediterranean (primary_type=mediterranean_restaurant, but types[] also
--       includes supermarket + grocery_store) scored 132.7 and passed — a restaurant
--       slipping through because -50 wasn't strong enough to offset +140 from grocery+supermarket.
--
-- Four weight changes (all other config unchanged):
--   butcher_shop:    -40 → 0   (chain supermarkets have in-store butchers)
--   liquor_store:    -60 → 0   (chain supermarkets sell wine)
--   restaurant:      -50 → -120 (kill restaurants hard even with grocery types)
--   food_store:        0 → +10  (small positive; most chain supermarkets have this)
--
-- IDEMPOTENT: adds a NEW version row (v1.0.1) and updates current_version_id.
-- v1.0.0 row kept for history. Rolling back = re-set current_version_id to v1.0.0's id.

WITH version_insert AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'groceries',
    'v1.0.1',
    '{
      "min_rating": 3.5,
      "min_reviews": 100,
      "bypass_rating": 4.5,
      "field_weights": {
        "types_includes_grocery_store": 70,
        "types_includes_supermarket": 70,
        "types_includes_hypermarket": 65,
        "types_includes_discount_supermarket": 60,
        "types_includes_food_store": 10,
        "types_includes_asian_grocery_store": 0,
        "types_includes_health_food_store": 0,
        "types_includes_butcher_shop": 0,
        "types_includes_farmers_market": -60,
        "types_includes_convenience_store": -40,
        "types_includes_gas_station": -80,
        "types_includes_liquor_store": 0,
        "types_includes_restaurant": -120,
        "types_includes_fast_food_restaurant": -50,
        "types_includes_cafe": -30,
        "types_includes_bar": -50,
        "types_includes_gym": -80,
        "types_includes_hotel": -80,
        "types_includes_hospital": -80,
        "types_includes_shopping_mall": -40
      },
      "scale": {
        "rating_multiplier": 8,
        "rating_cap": 30,
        "reviews_log_multiplier": 4,
        "reviews_cap": 20
      },
      "text_patterns": {
        "summary_regex": "grocery|supermarket|fresh produce|organic food|specialty food|neighborhood market|local market|fresh food",
        "summary_weight": 15
      },
      "cap": 200,
      "clamp_min": 0
    }'::jsonb,
    'ORCH-0643 v1.0.1 weight tuning. Four changes from v1.0.0: butcher_shop -40→0 (fixes Harris Teeter from 87→~137), liquor_store -60→0 (fixes Trader Joe 139→cap), restaurant -50→-120 (kills false-positive Albaraka 133→~62), food_store 0→+10 (boost for chain supermarkets with this tag). Re-sim: Harris Teeter 14 locations all pass, TJ caps at 200, Albaraka correctly excluded, farmers markets still excluded. Supply gaps (Food Lion/Aldi not seeded, Publix is_servable=false) are separate from this tuning — register as follow-up ORCH.'
  )
  RETURNING id
)
UPDATE public.signal_definitions
SET current_version_id = (SELECT id FROM version_insert),
    updated_at = now()
WHERE id = 'groceries';

-- ROLLBACK (revert to v1.0.0):
-- UPDATE public.signal_definitions
-- SET current_version_id = (SELECT id FROM signal_definition_versions WHERE signal_id = 'groceries' AND version_label = 'v1.0.0'),
--     updated_at = now()
-- WHERE id = 'groceries';
-- DELETE FROM public.place_scores WHERE signal_id = 'groceries';
-- (Then re-run scorer against v1.0.0 — or just keep v1.0.1 if new scorer produces garbage.)
