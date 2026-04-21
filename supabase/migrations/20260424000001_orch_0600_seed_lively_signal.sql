-- ORCH-0600 — Seed `lively` signal (quality-grounded vibe) for Group Fun curated intent.
--
-- Purpose: rank ANY stop by group-friendly energy. Used as EXPERIENCE_RANK_SIGNAL_OVERRIDE
-- for Group Fun. Surfaces bowling/arcade/sports-bar/brewery over quiet venues; for food
-- stops, surfaces group-friendly bistros over intimate candlelit spots.
--
-- Idempotent: upserts signal_definitions row, inserts new signal_definition_versions row
-- (scorer picks latest by created_at).
--
-- Paper-sim expectations (Raleigh):
--   Tier 1 (cap 200): Boxcar Bar+Arcade, Frankie's, Bowlero, Drive Shack, Tobacco Road
--   Tier 2 (130-180): Players Retreat, Whiskey Kitchen, Sky Zone, DEFY
--   Tier 3 (90-130):  Stanbury, Bonchon, Angus Barn, Second Empire
--   Tier 4 (<90):     Fiction Kitchen (vegan), fine-dining-heavy candlelit spots

-- ── signal_definitions row (upsert) ────────────────────────────────────────
INSERT INTO public.signal_definitions (id, label, kind, is_active)
VALUES ('lively', 'Lively', 'quality-grounded', true)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label, kind = EXCLUDED.kind, is_active = EXCLUDED.is_active,
  updated_at = now();

-- ── lively v1.0.0 config ───────────────────────────────────────────────────
INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
VALUES ('lively', 'v1.0.0', $json${
  "cap": 200,
  "scale": {
    "rating_cap": 35,
    "reviews_cap": 25,
    "rating_multiplier": 10,
    "reviews_log_multiplier": 5
  },
  "clamp_min": 0,
  "min_rating": 4.0,
  "min_reviews": 50,
  "bypass_rating": 4.7,
  "field_weights": {
    "types_includes_bowling_alley": 35,
    "types_includes_video_arcade": 35,
    "types_includes_karaoke_bar": 35,
    "types_includes_go_karting_venue": 35,
    "types_includes_comedy_club": 35,
    "types_includes_amusement_park": 30,
    "types_includes_amusement_center": 30,
    "types_includes_miniature_golf_course": 30,
    "types_includes_sports_bar": 30,
    "types_includes_indoor_golf_course": 30,
    "types_includes_brewery": 25,
    "types_includes_brewpub": 25,
    "types_includes_night_club": 20,
    "types_includes_indoor_playground": 20,
    "types_includes_cocktail_bar": 15,
    "types_includes_pub": 15,
    "types_includes_wine_bar": 10,
    "types_includes_bar_and_grill": 10,
    "types_includes_bar": 10,
    "types_includes_event_venue": 10,
    "types_includes_lounge_bar": 8,
    "types_includes_tourist_attraction": 5,
    "types_includes_fine_dining_restaurant": -5,
    "types_includes_art_gallery": -25,
    "types_includes_museum": -25,
    "types_includes_book_store": -30,
    "types_includes_spa": -40,
    "types_includes_library": -40,
    "good_for_groups": 40,
    "live_music": 25,
    "good_for_children": 10,
    "reservable": 5
  },
  "text_patterns": {
    "summary_regex": "lively|bustling|energetic|rowdy|festive|vibrant|fun atmosphere|group.?friendly|large groups?|perfect for (groups?|parties|gatherings)|birthday|party vibe|high.energy",
    "summary_weight": 40,
    "reviews_regex": "(with|brought) (my|the|a bunch of|a group of) (friends|crew|group|party)|group of \\d+|(birthday|bachelor|bachelorette) party|(great|perfect|fun) for (groups|parties|gatherings)|big group|large group|party of (\\d|us)|fun night (with|out)|celebration",
    "reviews_weight": 30,
    "atmosphere_regex": "intimate|quiet|peaceful|serene|candlelit|hushed|tranquil|romantic (setting|vibe|atmosphere)|date.night spot|cozy (booth|corner)",
    "atmosphere_weight": -35
  }
}$json$::jsonb, 'ORCH-0600 initial — Group Fun rank signal. Quality-grounded vibe: types stack (bowling+arcade+sports_bar), booleans give good_for_groups big bump, text_patterns reward lively/energetic language and penalize intimate/candlelit/quiet.');

-- ── Point signal_definitions.current_version_id at the new row ─────────────
UPDATE public.signal_definitions
SET current_version_id = (
  SELECT id FROM public.signal_definition_versions
  WHERE signal_id = 'lively'
  ORDER BY created_at DESC
  LIMIT 1
)
WHERE id = 'lively';
