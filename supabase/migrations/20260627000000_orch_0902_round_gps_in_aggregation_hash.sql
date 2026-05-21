-- ============================================================================
-- ORCH-0902 follow-up — round GPS to 4 decimals in pg_aggregate_collab_prefs
-- ============================================================================
--
-- Fix A — server side. Operator-reported 2026-05-21 post-PR-#156 deploy: every
-- pref-sheet Apply (even with no logical change) bumps deck_version because
-- the device sends a fresh GPS reading on each Apply and the resulting
-- meter-level drift in custom_lat/custom_lng changes the canonical hash.
--
-- Concrete evidence from session daadd454-35a8-487d-ab25-bb595abc4635:
--   v1 minted 07:19:23 — initial backfill
--   v2 minted 07:20:06 — participant 2 lat ends 1914616, lng ends 3683584
--   v3 minted 07:25:43 — participant 2 lat ends 4140685, lng ends 2827482
--   v4 minted 08:14:11 — participant 2 lat ends 4344893, lng ends 7377796
--   v5 minted 08:43:58 — yet another drift
-- All differences are at the 5th-decimal (meter-level). Categories,
-- intents, travel_mode, travel_constraint_value, dateWindows all identical.
--
-- Rounding to 4 decimals ≈ 11 m precision. Walking around your kitchen does
-- not trigger a refetch anymore. Coordinates are rounded ONLY in the hash-
-- input jsonb; the raw values stay in participant_prefs and are read raw by
-- query_servable_places_by_signal_union (display-side accuracy unchanged).
--
-- CR-1 determinism preserved: both participants compute the same rounded
-- coordinates from the same raw GPS values (jsonb_typeof + ROUND() are
-- pure functions).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pg_aggregate_collab_prefs(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefs jsonb;
  v_accepted_user_ids uuid[];
  v_accepted_count integer;
  v_categories text[];
  v_intents text[];
  v_date_windows text[];
  v_selected_dates text[];
  v_datetime_pref text;
  v_circles jsonb;
  v_circle_count integer;
  v_result jsonb;
BEGIN
  SELECT participant_prefs INTO v_prefs
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_prefs IS NULL OR jsonb_typeof(v_prefs) <> 'object' THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', 0
    );
  END IF;

  SELECT array_agg(user_id ORDER BY user_id) INTO v_accepted_user_ids
    FROM public.session_participants
    WHERE session_id = p_session_id AND has_accepted = true;

  v_accepted_count := COALESCE(array_length(v_accepted_user_ids, 1), 0);

  IF v_accepted_count < 2 THEN
    RETURN jsonb_build_object(
      'categories', '[]'::jsonb,
      'intents', '[]'::jsonb,
      'dateWindows', '[]'::jsonb,
      'selectedDates', '[]'::jsonb,
      'datetimePref', null,
      'circles', '[]'::jsonb,
      'acceptedCount', v_accepted_count
    );
  END IF;

  SELECT array_agg(DISTINCT cat ORDER BY cat)
    INTO v_categories
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(prefs->'categories') = 'array'
                THEN prefs->'categories'
                ELSE '[]'::jsonb
           END
         ) AS cat
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND COALESCE((prefs->>'category_toggle')::boolean, true) = true;

  SELECT array_agg(DISTINCT intent ORDER BY intent)
    INTO v_intents
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(prefs->'intents') = 'array'
                THEN prefs->'intents'
                ELSE '[]'::jsonb
           END
         ) AS intent
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND COALESCE((prefs->>'intent_toggle')::boolean, true) = true;

  SELECT array_agg(DISTINCT (prefs->>'date_option') ORDER BY (prefs->>'date_option'))
    INTO v_date_windows
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'date_option' IS NOT NULL;

  SELECT array_agg(DISTINCT d ORDER BY d)
    INTO v_selected_dates
    FROM jsonb_each(v_prefs) AS rows(uid, prefs),
         jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(prefs->'selected_dates') = 'array'
                THEN prefs->'selected_dates'
                ELSE '[]'::jsonb
           END
         ) AS d
    WHERE uid::uuid = ANY(v_accepted_user_ids);

  SELECT MIN(prefs->>'datetime_pref') INTO v_datetime_pref
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'datetime_pref' IS NOT NULL;

  -- ORCH-0902 follow-up (this migration, 2026-05-21): ROUND lat/lng to 4
  -- decimals (~11 m precision) so meter-level GPS drift does not change the
  -- hash. Raw values stay in participant_prefs; rounding is hash-input only.
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', uid,
      'lat', ROUND((prefs->>'custom_lat')::numeric, 4),
      'lng', ROUND((prefs->>'custom_lng')::numeric, 4),
      'travel_mode', COALESCE(prefs->>'travel_mode', 'walking'),
      'time_min', COALESCE((prefs->>'travel_constraint_value')::integer, 30),
      'radius_m', public.estimate_circle_radius_m(
        COALESCE(prefs->>'travel_mode', 'walking'),
        COALESCE((prefs->>'travel_constraint_value')::integer, 30)
      )
    )
    ORDER BY uid
  ) INTO v_circles
    FROM jsonb_each(v_prefs) AS rows(uid, prefs)
    WHERE uid::uuid = ANY(v_accepted_user_ids)
      AND prefs->>'custom_lat' IS NOT NULL
      AND prefs->>'custom_lng' IS NOT NULL;

  v_circle_count := COALESCE(jsonb_array_length(v_circles), 0);
  IF v_circle_count > 50 THEN
    RAISE EXCEPTION
      'ORCH-0902 Q-6 fallback cap exceeded: session % has % participant circles (max 50 without PostGIS). Install PostGIS and swap query_servable_places_by_signal_union to Path A to lift this cap.',
      p_session_id, v_circle_count;
  END IF;

  v_result := jsonb_build_object(
    'categories', COALESCE(to_jsonb(v_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(v_intents), '[]'::jsonb),
    'dateWindows', COALESCE(to_jsonb(v_date_windows), '[]'::jsonb),
    'selectedDates', COALESCE(to_jsonb(v_selected_dates), '[]'::jsonb),
    'datetimePref', v_datetime_pref,
    'circles', COALESCE(v_circles, '[]'::jsonb),
    'acceptedCount', v_accepted_count
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.pg_aggregate_collab_prefs(uuid) IS
  'ORCH-0902 CR-1+CR-2 (post-2026-05-21 follow-up): server-side deterministic aggregation. Returns canonical jsonb (categories+intents+dates+circles unioned across accepted participants). Lat/lng ROUND-ed to 4 decimals (~11m precision) in circles array so meter-level GPS drift does not thrash deck_version. The recompute_deck_version trigger hashes this output. Replaces deleted client-side aggregateCollabPrefs (CR-9). ORDER BY uid in circles is critical for hash stability. 50-circle cap is the Q-6 Path B fallback.';
