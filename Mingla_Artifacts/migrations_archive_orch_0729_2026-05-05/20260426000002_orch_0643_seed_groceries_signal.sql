-- ORCH-0643 v2.1 — seed groceries signal (v1.0.0, orchestrator-amended)
-- Closes the gap that made picnic-dates curated silently return 0 cards.
-- Weights paper-sim-validated against Raleigh anchors + tightened per user
-- product directive: "actual known supermarkets, not small local stores."
-- (see outputs/SPEC_ORCH-0643_v2_GROCERIES_SIGNAL_REGISTRATION.md §0 amendment + §6)
-- Pattern mirrors: 20260423100001_orch_0596_seed_casual_food_signal.sql
-- DO NOT edit weights here post-deploy — admin tunes via new signal_definition_versions row inserts.
--
-- IDEMPOTENT: ON CONFLICT DO NOTHING on signal_definitions; version-row insert runs only on first apply.
-- Running twice via `supabase db push` is safe (migration tracker prevents re-run).

INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES ('groceries', 'Groceries', 'type-grounded', true)
ON CONFLICT (id) DO NOTHING;

WITH version_insert AS (
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'groceries',
    'v1.0.0',
    '{
      "min_rating": 3.5,
      "min_reviews": 100,
      "bypass_rating": 4.5,
      "field_weights": {
        "types_includes_grocery_store": 70,
        "types_includes_supermarket": 70,
        "types_includes_hypermarket": 65,
        "types_includes_discount_supermarket": 60,
        "types_includes_food_store": 0,
        "types_includes_asian_grocery_store": 0,
        "types_includes_health_food_store": 0,
        "types_includes_butcher_shop": -40,
        "types_includes_farmers_market": -60,
        "types_includes_convenience_store": -40,
        "types_includes_gas_station": -80,
        "types_includes_liquor_store": -60,
        "types_includes_restaurant": -50,
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
    'ORCH-0643 v1.0.0 initial groceries seed (orchestrator-amended v2.1). User directive: reliable chain supermarkets only, no farmers markets or small local stores. Paper-sim Raleigh anchors (filter_min=120): Trader Joe 198, Whole Foods 197.5, Wegmans 200 (cap), Harris Teeter 181.6, Food Lion 181.2, Aldi 200 (cap), Publix 196.5 all pass. H Mart 110.4 and Earth Fare 124.9 depend on whether Google types[] includes grocery_store — marginal pass is acceptable. Farmers markets explicitly excluded via -60 weight (user intent). Convenience/gas/liquor stores excluded via strong negatives. min_reviews raised to 100 to enforce chain-store volume and filter out unknown small stores. See outputs/SPEC_ORCH-0643_v2_GROCERIES_SIGNAL_REGISTRATION.md §0 + §6.'
  )
  RETURNING id
)
UPDATE public.signal_definitions
SET current_version_id = (SELECT id FROM version_insert),
    updated_at = now()
WHERE id = 'groceries';

-- ROLLBACK:
-- DELETE FROM public.signal_definition_versions WHERE signal_id = 'groceries';
-- DELETE FROM public.signal_definitions WHERE id = 'groceries';
-- DELETE FROM public.place_scores WHERE signal_id = 'groceries';
