-- ORCH-0702 Wave 1 RETRY — fine_dining signal v1.2.0: nightlife penalty
--
-- Why this migration exists separately from 20260501000003:
-- The original migration's idempotency guard (`version_label='v1.1.0'`) collided
-- with a pre-existing v1.1.0 row created 2026-04-21 03:18 UTC (likely an admin
-- tuning pass shortly after v1.0.0 seed). The pre-existing row lacked the four
-- nightlife-penalty fields. The DO block hit IF EXISTS → RETURN, no row written,
-- current_version_id unchanged. Discovery D-IMPL-1 in the IMPL report predicted
-- exactly this scenario; it actually fired during apply via the Management API.
--
-- This RETRY bumps to v1.2.0 (no collision) and merges the four nightlife
-- penalty fields (-80 night_club, -50 bar, -200 strip_club, -200
-- adult_entertainment_store) into the LIVE current config (whatever that
-- currently is — read at deploy time).
--
-- Migration 20260501000003 stays in the tree as a no-op-on-apply for any
-- environment that didn't have the pre-existing v1.1.0 row. Both files together
-- ensure every environment lands on a v1.x.0 with the penalties present.
--
-- Idempotent (skips if v1.2.0 already exists for fine_dining). Additive-only —
-- the pre-existing v1.0.0 + v1.1.0 rows are preserved as version history.

BEGIN;

DO $$
DECLARE
  v_current_version_id uuid;
  v_current_config     jsonb;
  v_new_config         jsonb;
  v_new_version_id     uuid;
  v_pre_restaurant_w   jsonb;
BEGIN
  -- Idempotency guard — skip if v1.2.0 already exists.
  IF EXISTS (
    SELECT 1 FROM public.signal_definition_versions
    WHERE signal_id = 'fine_dining' AND version_label = 'v1.2.0'
  ) THEN
    RAISE NOTICE 'ORCH-0702 RETRY: fine_dining v1.2.0 already exists; skipping insert.';
    RETURN;
  END IF;

  -- Read LIVE current config (regardless of which version label is current).
  SELECT sd.current_version_id, sdv.config
    INTO v_current_version_id, v_current_config
  FROM public.signal_definitions sd
  JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
  WHERE sd.id = 'fine_dining';

  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: fine_dining signal not found OR has no current_version_id; cannot derive v1.2.0';
  END IF;

  IF v_current_config IS NULL OR v_current_config -> 'field_weights' IS NULL THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: fine_dining current config is missing or has no field_weights; aborting';
  END IF;

  v_pre_restaurant_w := v_current_config -> 'field_weights' -> 'types_includes_restaurant';

  -- Merge in 4 new field_weights via jsonb || (concat).
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

  -- Assertions A1: each new key has its specified value.
  IF (v_new_config -> 'field_weights' ->> 'types_includes_night_club')::int <> -80 THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: A1 failed — types_includes_night_club not -80';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_bar')::int <> -50 THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: A1 failed — types_includes_bar not -50';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_strip_club')::int <> -200 THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: A1 failed — types_includes_strip_club not -200';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_adult_entertainment_store')::int <> -200 THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: A1 failed — types_includes_adult_entertainment_store not -200';
  END IF;

  -- Assertion A2: existing types_includes_restaurant weight unchanged.
  IF v_new_config -> 'field_weights' -> 'types_includes_restaurant' IS DISTINCT FROM v_pre_restaurant_w THEN
    RAISE EXCEPTION 'ORCH-0702 RETRY: A2 failed — types_includes_restaurant changed (pre=% post=%)',
      v_pre_restaurant_w, v_new_config -> 'field_weights' -> 'types_includes_restaurant';
  END IF;

  -- Assertion A3: top-level non-field_weights keys preserved verbatim.
  IF v_new_config -> 'scale'         IS DISTINCT FROM v_current_config -> 'scale'         THEN RAISE EXCEPTION 'ORCH-0702 RETRY: A3 failed — scale changed'; END IF;
  IF v_new_config -> 'text_patterns' IS DISTINCT FROM v_current_config -> 'text_patterns' THEN RAISE EXCEPTION 'ORCH-0702 RETRY: A3 failed — text_patterns changed'; END IF;
  IF v_new_config -> 'cap'           IS DISTINCT FROM v_current_config -> 'cap'           THEN RAISE EXCEPTION 'ORCH-0702 RETRY: A3 failed — cap changed'; END IF;
  IF v_new_config -> 'clamp_min'     IS DISTINCT FROM v_current_config -> 'clamp_min'     THEN RAISE EXCEPTION 'ORCH-0702 RETRY: A3 failed — clamp_min changed'; END IF;

  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'fine_dining',
    'v1.2.0',
    v_new_config,
    'ORCH-0702 RETRY: bumped to v1.2.0 because pre-existing v1.1.0 from 2026-04-21 collided with original migration idempotency guard. Merged in nightlife penalty fields against live config from prior current_version_id=' || v_current_version_id::text || '. Added: types_includes_night_club: -80, types_includes_bar: -50, types_includes_strip_club: -200, types_includes_adult_entertainment_store: -200. All other fields preserved verbatim. Mechanical expectation: Trapeze (place_id 89e190a8-0ab4-485e-b839-9d1d657d5b2d) fine_dining score 151.09 → ~21 (below filter_min 120).'
  )
  RETURNING id INTO v_new_version_id;

  UPDATE public.signal_definitions
  SET current_version_id = v_new_version_id,
      updated_at = now()
  WHERE id = 'fine_dining';

  RAISE NOTICE 'ORCH-0702 RETRY: fine_dining v1.2.0 inserted (id=%); current_version_id flipped from % to %',
    v_new_version_id, v_current_version_id, v_new_version_id;
END $$;

COMMIT;
