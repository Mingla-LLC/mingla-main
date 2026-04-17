-- ORCH-0443: Backfill board_session_preferences for accepted participants
-- who have no collab prefs row. Seeds from their solo preferences.
-- Idempotent — LEFT JOIN + WHERE bsp.id IS NULL ensures no duplicates.

INSERT INTO board_session_preferences (
  session_id, user_id, categories, intents,
  travel_mode, travel_constraint_type, travel_constraint_value,
  date_option, datetime_pref,
  use_gps_location, custom_location, custom_lat, custom_lng,
  intent_toggle, category_toggle, selected_dates
)
SELECT
  sp.session_id,
  sp.user_id,
  COALESCE(p.categories, ARRAY['nature','drinks_and_music','icebreakers']),
  COALESCE(p.intents, ARRAY[]::TEXT[]),
  COALESCE(p.travel_mode, 'walking'),
  'time',
  COALESCE(p.travel_constraint_value, 30),
  p.date_option,
  p.datetime_pref,
  COALESCE(p.use_gps_location, true),
  p.custom_location,
  p.custom_lat,
  p.custom_lng,
  COALESCE(p.intent_toggle, true),
  COALESCE(p.category_toggle, true),
  p.selected_dates
FROM session_participants sp
LEFT JOIN preferences p ON p.profile_id = sp.user_id
LEFT JOIN board_session_preferences bsp
  ON bsp.session_id = sp.session_id AND bsp.user_id = sp.user_id
WHERE sp.has_accepted = true
  AND bsp.id IS NULL;
