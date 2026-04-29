-- ORCH-0601 — Seed two new quality-grounded vibe signals for Stroll + Picnic graduation.
--
-- 1. `scenic`          — ranks Nature places by walkability/views/greenway quality.
--                        Used by Take a Stroll to rank Nature stop (Umstead trails,
--                        JC Raulston, Dorothea Dix, Neuse River Trail > playgrounds).
--
-- 2. `picnic_friendly` — ranks parks by picnic-readiness (tables, shelters, lawns,
--                        family-friendliness). Used by Picnic Dates to rank Picnic
--                        Spot stop (Pullen, Dix, Laurel Hills > hiking-only preserves).

-- ── signal_definitions rows (upsert) ───────────────────────────────────────
INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES
  ('scenic',           'Scenic',           'quality-grounded', true),
  ('picnic_friendly',  'Picnic Friendly',  'quality-grounded', true)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, kind = EXCLUDED.kind, is_active = EXCLUDED.is_active,
  updated_at = now();

-- ── scenic v1.0.0 config ───────────────────────────────────────────────────
-- Top picks (expected, Raleigh): Williamson Preserve, Umstead SP, JC Raulston,
-- Neuse River Trail, Dorothea Dix Park, Lake Johnson, Annie Wilkerson, Durant.
INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
VALUES ('scenic', 'v1.0.0', $json${
  "cap": 200,
  "scale": {
    "rating_cap": 35,
    "reviews_cap": 25,
    "rating_multiplier": 10,
    "reviews_log_multiplier": 5
  },
  "clamp_min": 0,
  "min_rating": 4.0,
  "min_reviews": 30,
  "bypass_rating": 4.6,
  "field_weights": {
    "types_includes_botanical_garden": 45,
    "types_includes_national_park": 45,
    "types_includes_hiking_area": 40,
    "types_includes_nature_preserve": 40,
    "types_includes_state_park": 40,
    "types_includes_scenic_spot": 35,
    "types_includes_wildlife_refuge": 35,
    "types_includes_garden": 30,
    "types_includes_cycling_park": 30,
    "types_includes_park": 20,
    "types_includes_playground": -20,
    "types_includes_amusement_center": -30,
    "types_includes_amusement_park": -30,
    "types_includes_shopping_mall": -40,
    "types_includes_store": -30,
    "allows_dogs": 15,
    "outdoor_seating": 10
  },
  "text_patterns": {
    "summary_regex": "scenic|picturesque|walking trail|walking path|greenway|beautiful views?|stunning views?|nature trail|hiking|trail system|paved path|wooded|trails?",
    "summary_weight": 40,
    "reviews_regex": "beautiful walk|nice walk|peaceful walk|walked (around|along|through)|scenic|peaceful stroll|nice path|trail (was|is)|lovely walk|long walk|great views|stunning",
    "reviews_weight": 30
  }
}$json$::jsonb, 'ORCH-0601 initial — Stroll rank signal. Rewards trails/greenways/gardens with walking infrastructure. Small playgrounds and shopping malls penalized.');

-- ── picnic_friendly v1.0.0 config ─────────────────────────────────────────
-- Top picks (expected, Raleigh): Pullen Park (picnic shelters galore),
-- Dorothea Dix Park, Lake Johnson (picnic area), Laurel Hills, Shelley Lake.
INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
VALUES ('picnic_friendly', 'v1.0.0', $json${
  "cap": 200,
  "scale": {
    "rating_cap": 35,
    "reviews_cap": 25,
    "rating_multiplier": 10,
    "reviews_log_multiplier": 5
  },
  "clamp_min": 0,
  "min_rating": 4.0,
  "min_reviews": 30,
  "bypass_rating": 4.6,
  "field_weights": {
    "types_includes_picnic_ground": 55,
    "types_includes_park": 40,
    "types_includes_state_park": 35,
    "types_includes_recreation_ground": 35,
    "types_includes_national_park": 30,
    "types_includes_botanical_garden": 25,
    "types_includes_garden": 25,
    "types_includes_wildlife_refuge": -15,
    "types_includes_scenic_spot": -10,
    "types_includes_hiking_area": -10,
    "types_includes_nature_preserve": -5,
    "good_for_children": 20,
    "outdoor_seating": 25,
    "allows_dogs": 15
  },
  "text_patterns": {
    "summary_regex": "picnic (area|tables?|shelters?|spot|ground|pavilion)|picnic.?friendly|open (lawn|field|meadow|grass)|family.?friendly|shaded (picnic|tables?)|grassy area|benches|open space",
    "summary_weight": 40,
    "reviews_regex": "picnic|grabbed lunch|brought (food|lunch|a blanket)|had lunch here|spread out (on the|a) (blanket|lawn)|shaded tables?|perfect picnic|lunch spot|ate (lunch|outside)|picnicked|family friendly",
    "reviews_weight": 30
  }
}$json$::jsonb, 'ORCH-0601 initial — Picnic rank signal. Rewards parks with tables/shelters/lawns and family-friendliness. Hiking-heavy preserves penalized.');

-- ── Point signal_definitions.current_version_id at the new rows ───────────
UPDATE public.signal_definitions
SET current_version_id = (
  SELECT id FROM public.signal_definition_versions
  WHERE signal_id = 'scenic' ORDER BY created_at DESC LIMIT 1
)
WHERE id = 'scenic';

UPDATE public.signal_definitions
SET current_version_id = (
  SELECT id FROM public.signal_definition_versions
  WHERE signal_id = 'picnic_friendly' ORDER BY created_at DESC LIMIT 1
)
WHERE id = 'picnic_friendly';
