-- ORCH-0702 Wave 1 — fine_dining signal v1.1.0: nightlife penalty
--
-- Adds 4 negative field_weights to fine_dining to close the Trapeze class:
--   types_includes_night_club:               -80
--   types_includes_bar:                      -50
--   types_includes_strip_club:              -200
--   types_includes_adult_entertainment_store: -200
--
-- Why: Trapeze (FL place_id 89e190a8-0ab4-485e-b839-9d1d657d5b2d, swingers club at
-- 5213 FL-7, Tamarac, FL) scored 151.09 on fine_dining (above filter_min 120) and
-- surfaced as a dinner card. Every other dining/family signal correctly penalizes
-- types_includes_night_club (brunch -50, casual_food -50, romantic -60,
-- icebreakers -80, etc.) — fine_dining was the sole leak. Mechanically expected
-- to drop Trapeze's fine_dining score from 151 → ~21 (below filter_min).
--
-- Operator decision: scoring-layer fix only. NO bouncer changes. A sex club
-- remains a valid drinks recommendation under "right place, wrong context."
-- Trapeze's drinks score (192.49) and lively score (122.49) are intentionally
-- preserved.
--
-- LIVE-CONFIG-IS-SOT rule: this migration reads the live config from
-- signal_definitions.current_version_id and merges new fields into a copy.
-- It does NOT trust the 20260421200004 v1.0.0 migration file as the source of
-- truth for current weights — that file is the seed only; admin edits + later
-- ORCH-IDs may have inserted post-v1.0.0 versions directly. Trapeze contributions
-- trail confirmed brunch live config has serves_cocktails: 35 not in v1.0.0
-- migration; same drift may exist for fine_dining.
--
-- Idempotent: re-running this migration on a DB where v1.1.0 already exists
-- emits a NOTICE and returns without inserting a duplicate row.
--
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md
-- Dispatch:      Mingla_Artifacts/prompts/IMPL_ORCH-0702_FINE_DINING_NIGHTLIFE_PENALTY.md

BEGIN;

DO $$
DECLARE
  v_current_version_id uuid;
  v_current_config     jsonb;
  v_new_config         jsonb;
  v_new_version_id     uuid;
  v_pre_restaurant_w   jsonb;
BEGIN
  -- ── Idempotency guard ───────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1
    FROM public.signal_definition_versions
    WHERE signal_id = 'fine_dining'
      AND version_label = 'v1.1.0'
  ) THEN
    RAISE NOTICE 'ORCH-0702: fine_dining v1.1.0 already exists in signal_definition_versions; skipping insert.';
    RETURN;
  END IF;

  -- ── Read LIVE current config ────────────────────────────────────────────────
  -- Single source of truth: whatever signal_definitions.current_version_id
  -- points at right now. NOT the v1.0.0 migration file.
  SELECT sd.current_version_id, sdv.config
    INTO v_current_version_id, v_current_config
  FROM public.signal_definitions sd
  JOIN public.signal_definition_versions sdv ON sdv.id = sd.current_version_id
  WHERE sd.id = 'fine_dining';

  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0702: fine_dining signal not found OR has no current_version_id; cannot derive v1.1.0';
  END IF;

  IF v_current_config IS NULL OR v_current_config -> 'field_weights' IS NULL THEN
    RAISE EXCEPTION 'ORCH-0702: fine_dining current config is missing or has no field_weights; aborting';
  END IF;

  -- Capture pre-merge restaurant weight for post-merge regression assertion.
  v_pre_restaurant_w := v_current_config -> 'field_weights' -> 'types_includes_restaurant';

  -- ── Merge in 4 new field_weights ────────────────────────────────────────────
  -- jsonb_set replaces the field_weights subtree with the union of the
  -- existing weights || the four new keys. Existing weights NEVER overwritten —
  -- the new keys do not collide with any existing key (verified via Trapeze
  -- score trail showing fine_dining live contributions has no night_club, bar,
  -- strip_club, or adult_entertainment_store entries).
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

  -- ── Post-merge assertions ───────────────────────────────────────────────────
  -- A1: new keys present with correct values.
  IF (v_new_config -> 'field_weights' ->> 'types_includes_night_club')::int <> -80 THEN
    RAISE EXCEPTION 'ORCH-0702: merge assertion A1 failed — types_includes_night_club not -80';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_bar')::int <> -50 THEN
    RAISE EXCEPTION 'ORCH-0702: merge assertion A1 failed — types_includes_bar not -50';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_strip_club')::int <> -200 THEN
    RAISE EXCEPTION 'ORCH-0702: merge assertion A1 failed — types_includes_strip_club not -200';
  END IF;
  IF (v_new_config -> 'field_weights' ->> 'types_includes_adult_entertainment_store')::int <> -200 THEN
    RAISE EXCEPTION 'ORCH-0702: merge assertion A1 failed — types_includes_adult_entertainment_store not -200';
  END IF;

  -- A2: existing types_includes_restaurant weight unchanged (regression guard
  -- against accidental clobber via jsonb_set semantics).
  IF v_new_config -> 'field_weights' -> 'types_includes_restaurant' IS DISTINCT FROM v_pre_restaurant_w THEN
    RAISE EXCEPTION 'ORCH-0702: merge assertion A2 failed — types_includes_restaurant changed (pre=% post=%)',
      v_pre_restaurant_w, v_new_config -> 'field_weights' -> 'types_includes_restaurant';
  END IF;

  -- A3: top-level non-field_weights keys preserved verbatim.
  IF v_new_config -> 'scale'          IS DISTINCT FROM v_current_config -> 'scale'         THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — scale changed'; END IF;
  IF v_new_config -> 'text_patterns'  IS DISTINCT FROM v_current_config -> 'text_patterns' THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — text_patterns changed'; END IF;
  IF v_new_config -> 'cap'            IS DISTINCT FROM v_current_config -> 'cap'           THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — cap changed'; END IF;
  IF v_new_config -> 'clamp_min'      IS DISTINCT FROM v_current_config -> 'clamp_min'     THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — clamp_min changed'; END IF;
  IF v_new_config -> 'min_rating'     IS DISTINCT FROM v_current_config -> 'min_rating'    THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — min_rating changed'; END IF;
  IF v_new_config -> 'min_reviews'    IS DISTINCT FROM v_current_config -> 'min_reviews'   THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — min_reviews changed'; END IF;
  IF v_new_config -> 'bypass_rating'  IS DISTINCT FROM v_current_config -> 'bypass_rating' THEN RAISE EXCEPTION 'ORCH-0702: merge assertion A3 failed — bypass_rating changed'; END IF;

  -- ── Insert v1.1.0 row ───────────────────────────────────────────────────────
  INSERT INTO public.signal_definition_versions (signal_id, version_label, config, notes)
  VALUES (
    'fine_dining',
    'v1.1.0',
    v_new_config,
    'ORCH-0702 Wave 1: nightlife penalty fields added to close Trapeze (FL place_id 89e190a8-0ab4-485e-b839-9d1d657d5b2d) class. ' ||
    'Added: types_includes_night_club: -80, types_includes_bar: -50, types_includes_strip_club: -200, types_includes_adult_entertainment_store: -200. ' ||
    'All other field_weights, scale, text_patterns, cap, clamp_min, min_rating, min_reviews, bypass_rating preserved verbatim from prior version_id=' || v_current_version_id::text || '. ' ||
    'Operator decision: scoring-layer fix only; bouncer unchanged so sex clubs remain valid drinks recommendations. ' ||
    'Mechanical expectation: Trapeze fine_dining score 151.09 → ~21 (below filter_min 120). Investigation: INVESTIGATION_ORCH-0702_PLACE_INTELLIGENCE_AUDIT.md.'
  )
  RETURNING id INTO v_new_version_id;

  -- ── Flip current_version_id ─────────────────────────────────────────────────
  UPDATE public.signal_definitions
  SET current_version_id = v_new_version_id,
      updated_at = now()
  WHERE id = 'fine_dining';

  RAISE NOTICE 'ORCH-0702: fine_dining v1.1.0 inserted (id=%); current_version_id flipped from % to %',
    v_new_version_id, v_current_version_id, v_new_version_id;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK PROCEDURE (manual — execute only if v1.1.0 needs reverting)
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Capture the prior version_id (run ONCE before reverting):
--    SELECT current_version_id FROM public.signal_definitions WHERE id='fine_dining';
--    -- Will return the v1.1.0 id; the prior version is the second-newest row.
--
-- 2. Find the prior version_id:
--    SELECT id FROM public.signal_definition_versions
--    WHERE signal_id = 'fine_dining' AND version_label != 'v1.1.0'
--    ORDER BY created_at DESC LIMIT 1;
--
-- 3. Revert (replace <PRIOR_ID> with the uuid from step 2):
--    BEGIN;
--    UPDATE public.signal_definitions
--    SET current_version_id = '<PRIOR_ID>'::uuid, updated_at = now()
--    WHERE id = 'fine_dining';
--    -- Optionally hard-delete the v1.1.0 row to allow re-running this migration:
--    DELETE FROM public.signal_definition_versions
--    WHERE signal_id = 'fine_dining' AND version_label = 'v1.1.0';
--    COMMIT;
--
-- 4. Re-run run-signal-scorer for fine_dining to restore prior scores:
--    POST /functions/v1/run-signal-scorer { "signal_id": "fine_dining", "all_cities": true }
