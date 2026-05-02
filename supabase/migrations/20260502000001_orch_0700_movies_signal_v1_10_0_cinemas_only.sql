-- ORCH-0700 Phase 1 — Movies signal v1.10.0 cinemas-only
--
-- REVERSES the v1.2.0+ deliberate theatre padding per operator decision 2026-05-02.
-- Movies pill becomes cinemas-only (movie_theater + drive_in only). Deck thin/empty
-- when local cinemas exhaust is intended behavior, not a bug.
--
-- Reference:
--   Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0700_RULES_CATEGORY_TRUTH.md
--   Spec:          Mingla_Artifacts/specs/SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md (§3.A.A1)
--
-- What changes:
--   1. INSERT new signal_definition_versions row 'v1.10.0' inheriting v1.9.0 config,
--      with these 5 theatre type weights stripped (removed from field_weights):
--        - types_includes_performing_arts_theater (was +35 in v1.9.0)
--        - types_includes_concert_hall            (was +25 in v1.9.0)
--        - types_includes_opera_house             (was +25 in v1.9.0)
--        - types_includes_amphitheatre            (was +20 in v1.9.0)
--        - types_includes_auditorium              (was +18 in v1.9.0)
--   2. Flip signal_definitions.current_version_id for 'movies' to point at v1.10.0
--
-- What is PRESERVED verbatim from v1.9.0:
--   - cap=200, clamp_min=0, min_rating=4.0, min_reviews=3, bypass_rating=5.1
--   - rating + reviews scaling (rating_cap 35, reviews_cap 25, multipliers)
--   - All non-theatre type weights (movie_theater +40, drive_in +40, all penalties)
--   - text_patterns (summary_regex, reviews_regex, atmosphere_regex + weights)
--
-- After this migration applies:
--   POST-STEP REQUIRED — operator runs run-signal-scorer for 'movies':
--     curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-signal-scorer" \
--       -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--       -H "Content-Type: application/json" \
--       -d '{"signal_id": "movies"}'
--   This re-scores ~14,412 places against the new v1.10.0 config.
--   Theatre venues drop to <80 (their type-weight contribution becomes 0; rating+reviews
--   scaling alone caps at ~60 — below filter_min 80). Cinema venues unchanged.
--
-- Rollback:
--   UPDATE public.signal_definitions
--   SET current_version_id = (
--     SELECT id FROM public.signal_definition_versions
--     WHERE signal_id = 'movies' AND version_label = 'v1.9.0'
--   )
--   WHERE id = 'movies';
--   Then re-run run-signal-scorer for 'movies'. v1.10.0 row stays in history per
--   append-only invariant on signal_definition_versions.

BEGIN;

-- Step 1: Insert new v1.10.0 inheriting v1.9.0 config with 5 theatre weights stripped
WITH v1_9_config AS (
  SELECT config
  FROM public.signal_definition_versions
  WHERE signal_id = 'movies' AND version_label = 'v1.9.0'
),
v1_10_config AS (
  SELECT
    -- jsonb_set replaces field_weights with the v1.9.0 field_weights minus 5 theatre keys.
    -- Postgres jsonb minus operator (-) accepts text or text[] to remove keys.
    jsonb_set(
      config,
      '{field_weights}',
      (config->'field_weights')
        - 'types_includes_performing_arts_theater'
        - 'types_includes_concert_hall'
        - 'types_includes_opera_house'
        - 'types_includes_amphitheatre'
        - 'types_includes_auditorium'
    ) AS config
  FROM v1_9_config
)
INSERT INTO public.signal_definition_versions (
  id,
  signal_id,
  version_label,
  config,
  notes,
  created_by,
  created_at
)
SELECT
  gen_random_uuid(),
  'movies',
  'v1.10.0',
  v1_10_config.config,
  'ORCH-0700 Path 1 cinemas-only — REVERSE v1.2.0+ deliberate theatre padding per operator decision 2026-05-02. Removed 5 theatre type weights from field_weights: performing_arts_theater (was 35), concert_hall (was 25), opera_house (was 25), amphitheatre (was 20), auditorium (was 18). Cinemas unchanged: types_includes_movie_theater 40 + drive_in 40 + summary_regex 45 + reviews_regex 25 + atmosphere 15 = 165 max for legitimate cinemas. Theatre venues now drop to 0 type-weight contribution; their rating+reviews scaling alone (max 60) cannot reach filter_min 80. Movies pill becomes cinemas-only; deck thin/empty when cinemas exhaust is intended.',
  NULL,
  now()
FROM v1_10_config;

-- Step 2: Pre-flip safety check — confirm v1.10.0 row was inserted
DO $$
DECLARE
  v_new_version_id UUID;
BEGIN
  SELECT id INTO v_new_version_id
  FROM public.signal_definition_versions
  WHERE signal_id = 'movies' AND version_label = 'v1.10.0';

  IF v_new_version_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 1: v1.10.0 INSERT failed silently — aborting flip. Check that v1.9.0 row exists for movies signal.';
  END IF;
END $$;

-- Step 3: Flip current_version_id for 'movies' to v1.10.0
UPDATE public.signal_definitions
SET
  current_version_id = (
    SELECT id FROM public.signal_definition_versions
    WHERE signal_id = 'movies' AND version_label = 'v1.10.0'
  ),
  updated_at = now()
WHERE id = 'movies';

-- Step 4: Post-flip verification — confirm flip succeeded
DO $$
DECLARE
  v_current_label TEXT;
BEGIN
  SELECT sdv.version_label INTO v_current_label
  FROM public.signal_definitions sd
  JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
  WHERE sd.id = 'movies';

  IF v_current_label IS DISTINCT FROM 'v1.10.0' THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 1: current_version_id flip failed. Expected v1.10.0, got %. Aborting transaction.', COALESCE(v_current_label, 'NULL');
  END IF;
END $$;

-- Step 5: Verify the 5 theatre keys are NOT in the new field_weights
DO $$
DECLARE
  v_field_weights JSONB;
  v_offending_keys TEXT[];
BEGIN
  SELECT (config->'field_weights') INTO v_field_weights
  FROM public.signal_definition_versions
  WHERE signal_id = 'movies' AND version_label = 'v1.10.0';

  v_offending_keys := ARRAY(
    SELECT key FROM jsonb_object_keys(v_field_weights) AS key
    WHERE key IN (
      'types_includes_performing_arts_theater',
      'types_includes_concert_hall',
      'types_includes_opera_house',
      'types_includes_amphitheatre',
      'types_includes_auditorium'
    )
  );

  IF array_length(v_offending_keys, 1) > 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 1: theatre weight strip failed. v1.10.0 still contains: %', v_offending_keys;
  END IF;
END $$;

-- Step 6: Verify movie_theater + drive_in weights are PRESERVED
DO $$
DECLARE
  v_movie_theater_weight NUMERIC;
  v_drive_in_weight NUMERIC;
BEGIN
  SELECT
    (config->'field_weights'->>'types_includes_movie_theater')::numeric,
    (config->'field_weights'->>'types_includes_drive_in')::numeric
  INTO v_movie_theater_weight, v_drive_in_weight
  FROM public.signal_definition_versions
  WHERE signal_id = 'movies' AND version_label = 'v1.10.0';

  IF v_movie_theater_weight IS NULL OR v_movie_theater_weight <= 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 1: types_includes_movie_theater weight missing or non-positive (%). v1.10.0 must preserve cinema weights.', v_movie_theater_weight;
  END IF;

  IF v_drive_in_weight IS NULL OR v_drive_in_weight <= 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 1: types_includes_drive_in weight missing or non-positive (%). v1.10.0 must preserve cinema weights.', v_drive_in_weight;
  END IF;
END $$;

COMMIT;
