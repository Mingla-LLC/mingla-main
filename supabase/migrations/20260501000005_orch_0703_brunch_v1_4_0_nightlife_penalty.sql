-- ORCH-0703 Wave 1 follow-up — brunch signal v1.4.0: nightlife penalty alignment
--
-- Why: ORCH-0702 verification probe found Trapeze (FL place_id 89e190a8-0ab4-485e-b839-9d1d657d5b2d,
-- a swingers club) STILL scoring 137.49 on brunch — above filter_min 120 — even after fine_dining
-- was fixed today. Brunch v1.3.0 already had `types_includes_night_club: -50, types_includes_bar: -15`,
-- but Trapeze's positive contributions (reservable: 40, serves_cocktails: 35, summary_match: 35,
-- rating_scale: 35, reviews_scale: 12.5) overwhelmed the penalties. Same class of leak as
-- fine_dining had — different magnitude, same structural cause.
--
-- This migration aligns brunch's nightlife penalties to match fine_dining v1.2.0:
--   types_includes_night_club: -50 → -80
--   types_includes_bar:        -15 → -50
--   types_includes_strip_club:        → -200 (new)
--   types_includes_adult_entertainment_store:  → -200 (new)
--
-- Architectural rule established: every dining-context signal (fine_dining, brunch, casual_food,
-- icebreakers, romantic) MUST have ≥ -80 night_club and ≥ -50 bar penalties. Drinks + lively
-- explicitly opt out (positive nightlife rewards). Codified as invariant
-- I-DINING-SIGNAL-NIGHTLIFE-PENALTY at CLOSE.
--
-- Mechanical expectation: Trapeze brunch score 137.49 → 72.49 (below filter_min 120).
-- Calculation: 137.49 - 30 (night_club delta -50→-80) - 35 (bar delta -15→-50) = 72.49.
--
-- All other v1.3.0 weights preserved verbatim (reservable: 40, serves_cocktails: 35,
-- _summary_match, rating_multiplier, etc.) via jsonb || merge — only the four nightlife
-- penalty keys are touched.
--
-- Idempotent (skips if v1.4.0 already exists for brunch). Additive — v1.0..v1.3 preserved.

BEGIN;

DO $$
DECLARE
  v_current_version_id uuid;
  v_current_config     jsonb;
  v_new_config         jsonb;
  v_new_version_id     uuid;
  v_pre_reservable_w   jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.signal_definition_versions
    WHERE signal_id = 'brunch' AND version_label = 'v1.4.0'
  ) THEN
    RAISE NOTICE 'ORCH-0703: brunch v1.4.0 already exists; skipping insert.';
    RETURN;
  END IF;

  SELECT sd.current_version_id, sdv.config
    INTO v_current_version_id, v_current_config
  FROM public.signal_definitions sd
  JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
  WHERE sd.id = 'brunch';

  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0703: brunch signal not found OR has no current_version_id; aborting';
  END IF;

  IF v_current_config IS NULL OR v_current_config -> 'field_weights' IS NULL THEN
    RAISE EXCEPTION 'ORCH-0703: brunch current config missing or has no field_weights; aborting';
  END IF;

  v_pre_reservable_w := v_current_config -> 'field_weights' -> 'reservable';

  -- Merge: jsonb || on field_weights overwrites EXISTING night_club/bar (was -50/-15)
  -- and ADDS new strip_club/adult_entertainment_store (-200/-200).
  v_new_config := jsonb_set(
    v_current_config,
    '{field_weights}',
    (v_current_config -> 'field_weights')
      || jsonb_build_object(
           'types_includes_night_club',                -80,
           'types_includes_bar',                       -50,
           'types_includes_strip_club',               -200,
           'types_includes_adult_entertainment_store', -200
         )
  );

  -- Assertions A1: each new key has its specified value (overwriting old where applicable).
  IF (v_new_config -> 'field_weights' ->> 'types_includes_night_club')::int <> -80 THEN
    RAISE EXCEPTION 'ORCH-0703: A1 failed — night_club not -80 (was % now %)',
      v_current_config -> 'field_weights' -> 'types_includes_night_club',
      v_new_config -> 'field_weights' -> 'types_includes_night_club';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_bar')::int <> -50 THEN
    RAISE EXCEPTION 'ORCH-0703: A1 failed — bar not -50';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_strip_club')::int <> -200 THEN
    RAISE EXCEPTION 'ORCH-0703: A1 failed — strip_club not -200';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_adult_entertainment_store')::int <> -200 THEN
    RAISE EXCEPTION 'ORCH-0703: A1 failed — adult_entertainment_store not -200';
  END IF;

  -- Assertion A2: reservable weight (existing positive contributor) preserved verbatim.
  IF v_new_config -> 'field_weights' -> 'reservable' IS DISTINCT FROM v_pre_reservable_w THEN
    RAISE EXCEPTION 'ORCH-0703: A2 failed — reservable changed (pre=% post=%)',
      v_pre_reservable_w, v_new_config -> 'field_weights' -> 'reservable';
  END IF;

  -- Assertion A3: top-level non-field_weights keys preserved.
  IF v_new_config -> 'scale'         IS DISTINCT FROM v_current_config -> 'scale'         THEN RAISE EXCEPTION 'ORCH-0703: A3 failed — scale changed'; END IF;
  IF v_new_config -> 'text_patterns' IS DISTINCT FROM v_current_config -> 'text_patterns' THEN RAISE EXCEPTION 'ORCH-0703: A3 failed — text_patterns changed'; END IF;
  IF v_new_config -> 'cap'           IS DISTINCT FROM v_current_config -> 'cap'           THEN RAISE EXCEPTION 'ORCH-0703: A3 failed — cap changed'; END IF;
  IF v_new_config -> 'min_rating'    IS DISTINCT FROM v_current_config -> 'min_rating'    THEN RAISE EXCEPTION 'ORCH-0703: A3 failed — min_rating changed'; END IF;

  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'brunch',
    'v1.4.0',
    v_new_config,
    'ORCH-0703: brunch nightlife penalty aligned to fine_dining v1.2.0 pattern. Bumped: night_club -50 -> -80 (additional -30); bar -15 -> -50 (additional -35); added strip_club -200; added adult_entertainment_store -200. Closes Trapeze (place_id 89e190a8-0ab4-485e-b839-9d1d657d5b2d) brunch leak — was 137.49 (above filter_min 120) on v1.3.0; expected ~72.49 on v1.4.0. All other v1.3.0 weights preserved verbatim (reservable 40, serves_cocktails 35, summary_match 35, rating_multiplier, reviews_log_multiplier, atmosphere_match etc). Architectural invariant established: every dining-context signal must enforce >= -80 night_club and >= -50 bar penalties. Prior version_id=' || v_current_version_id::text || '.'
  )
  RETURNING id INTO v_new_version_id;

  UPDATE public.signal_definitions
  SET current_version_id = v_new_version_id,
      updated_at = now()
  WHERE id = 'brunch';

  RAISE NOTICE 'ORCH-0703: brunch v1.4.0 inserted (id=%); current_version_id flipped from % to %',
    v_new_version_id, v_current_version_id, v_new_version_id;
END $$;

COMMIT;
