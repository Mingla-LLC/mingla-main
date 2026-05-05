-- ORCH-0700 Phase 2.B — Rules SPLIT
--
-- Splits 2 legacy bundled-slug rule_sets into 4 modern-slug equivalents
-- (verbatim entry clones), deactivates the legacy originals (preserved for
-- audit trail; never deleted), and updates CASUAL_CHAIN_DEMOTION's demote_to
-- threshold from "brunch_lunch_casual" → "casual_food".
--
-- Pre-existing live rule_sets state (verified 2026-05-02):
--   MOVIES_THEATRE_BLOCKED_TYPES (scope=movies_theatre, kind=strip, 41 entries, is_active=true)
--   BRUNCH_CASUAL_BLOCKED_TYPES  (scope=brunch_lunch_casual, kind=strip, 36 entries, is_active=true)
--   CASUAL_CHAIN_DEMOTION        (scope=upscale_fine_dining, kind=demotion,
--                                 thresholds={"demote_to":"brunch_lunch_casual","guarded_by":"UPSCALE_CHAIN_PROTECTION"})
--
-- Post-migration state:
--   MOVIES_BLOCKED_TYPES         (scope=movies, kind=strip, 41 entries cloned, is_active=true)
--   THEATRE_BLOCKED_TYPES        (scope=theatre, kind=strip, 41 entries cloned, is_active=true)
--   BRUNCH_BLOCKED_TYPES         (scope=brunch, kind=strip, 36 entries cloned, is_active=true)
--   CASUAL_FOOD_BLOCKED_TYPES    (scope=casual_food, kind=strip, 36 entries cloned, is_active=true)
--   MOVIES_THEATRE_BLOCKED_TYPES (is_active=false; preserved for audit)
--   BRUNCH_CASUAL_BLOCKED_TYPES  (is_active=false; preserved for audit)
--   CASUAL_CHAIN_DEMOTION        (current_version_id → version_number=2, demote_to="casual_food")
--
-- Net active rule_sets count delta: +4 - 2 = +2 (so admin_rules_overview drift
-- threshold gets bumped 18 → 20 in Migration 3).
--
-- Reference: ORCH-0700 spec §3.A.A3
-- Cycle-3 audit: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0700_RULES_CATEGORY_TRUTH.md

BEGIN;

-- ── Step 1: SPLIT MOVIES_THEATRE_BLOCKED_TYPES → MOVIES_BLOCKED_TYPES + THEATRE_BLOCKED_TYPES ──
DO $$
DECLARE
  v_movies_rule_set_id      UUID := gen_random_uuid();
  v_movies_version_id       UUID := gen_random_uuid();
  v_theatre_rule_set_id     UUID := gen_random_uuid();
  v_theatre_version_id      UUID := gen_random_uuid();
  v_brunch_rule_set_id      UUID := gen_random_uuid();
  v_brunch_version_id       UUID := gen_random_uuid();
  v_casual_food_rule_set_id UUID := gen_random_uuid();
  v_casual_food_version_id  UUID := gen_random_uuid();
  v_legacy_movies_theatre_version_id UUID;
  v_legacy_brunch_casual_version_id  UUID;
  v_chain_rule_set_id       UUID;
  v_chain_new_version_id    UUID := gen_random_uuid();
BEGIN
  -- Resolve legacy version IDs (source of entries to clone via INSERT...SELECT)
  SELECT current_version_id INTO v_legacy_movies_theatre_version_id
  FROM public.rule_sets WHERE name = 'MOVIES_THEATRE_BLOCKED_TYPES';

  SELECT current_version_id INTO v_legacy_brunch_casual_version_id
  FROM public.rule_sets WHERE name = 'BRUNCH_CASUAL_BLOCKED_TYPES';

  IF v_legacy_movies_theatre_version_id IS NULL
     OR v_legacy_brunch_casual_version_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B: legacy rule_sets not found — cannot SPLIT.';
  END IF;

  -- ── MOVIES_BLOCKED_TYPES ──────────────────────────────────────────
  INSERT INTO public.rule_sets (id, name, description, kind, scope_kind, scope_value, is_active, created_at, updated_at)
  VALUES (
    v_movies_rule_set_id,
    'MOVIES_BLOCKED_TYPES',
    'Strip movies if primary_type is food/drink/retail. ORCH-0700 SPLIT — modern slug equivalent of MOVIES_THEATRE_BLOCKED_TYPES (cinema half).',
    'strip', 'category', 'movies',
    true, now(), now()
  );

  INSERT INTO public.rule_set_versions (id, rule_set_id, version_number, change_summary, thresholds, created_at)
  VALUES (
    v_movies_version_id, v_movies_rule_set_id, 1,
    'ORCH-0700 SPLIT — modern slug equivalent of MOVIES_THEATRE_BLOCKED_TYPES, cloned 41 entries verbatim.',
    '{"check_field": "primary_type"}'::jsonb, now()
  );

  INSERT INTO public.rule_entries (id, rule_set_version_id, value, sub_category, position, reason, created_at)
  SELECT gen_random_uuid(), v_movies_version_id, value, sub_category, position,
         'ORCH-0700 SPLIT — cloned from MOVIES_THEATRE_BLOCKED_TYPES', now()
  FROM public.rule_entries WHERE rule_set_version_id = v_legacy_movies_theatre_version_id;

  UPDATE public.rule_sets SET current_version_id = v_movies_version_id WHERE id = v_movies_rule_set_id;

  -- ── THEATRE_BLOCKED_TYPES ─────────────────────────────────────────
  INSERT INTO public.rule_sets (id, name, description, kind, scope_kind, scope_value, is_active, created_at, updated_at)
  VALUES (
    v_theatre_rule_set_id,
    'THEATRE_BLOCKED_TYPES',
    'Strip theatre if primary_type is food/drink/retail. ORCH-0700 SPLIT — modern slug equivalent of MOVIES_THEATRE_BLOCKED_TYPES (theatre half).',
    'strip', 'category', 'theatre',
    true, now(), now()
  );

  INSERT INTO public.rule_set_versions (id, rule_set_id, version_number, change_summary, thresholds, created_at)
  VALUES (
    v_theatre_version_id, v_theatre_rule_set_id, 1,
    'ORCH-0700 SPLIT — modern slug equivalent of MOVIES_THEATRE_BLOCKED_TYPES, cloned 41 entries verbatim.',
    '{"check_field": "primary_type"}'::jsonb, now()
  );

  INSERT INTO public.rule_entries (id, rule_set_version_id, value, sub_category, position, reason, created_at)
  SELECT gen_random_uuid(), v_theatre_version_id, value, sub_category, position,
         'ORCH-0700 SPLIT — cloned from MOVIES_THEATRE_BLOCKED_TYPES', now()
  FROM public.rule_entries WHERE rule_set_version_id = v_legacy_movies_theatre_version_id;

  UPDATE public.rule_sets SET current_version_id = v_theatre_version_id WHERE id = v_theatre_rule_set_id;

  -- ── BRUNCH_BLOCKED_TYPES ──────────────────────────────────────────
  INSERT INTO public.rule_sets (id, name, description, kind, scope_kind, scope_value, is_active, created_at, updated_at)
  VALUES (
    v_brunch_rule_set_id,
    'BRUNCH_BLOCKED_TYPES',
    'Strip brunch if types-array contains bar/play/tobacco/sports UNLESS primary_type is in RESTAURANT_TYPES. ORCH-0700 SPLIT — modern slug equivalent of BRUNCH_CASUAL_BLOCKED_TYPES (brunch half).',
    'strip', 'category', 'brunch',
    true, now(), now()
  );

  INSERT INTO public.rule_set_versions (id, rule_set_id, version_number, change_summary, thresholds, created_at)
  VALUES (
    v_brunch_version_id, v_brunch_rule_set_id, 1,
    'ORCH-0700 SPLIT — modern slug equivalent of BRUNCH_CASUAL_BLOCKED_TYPES, cloned 36 entries verbatim.',
    '{"check_field": "types_array", "exempt_if_primary_in": "RESTAURANT_TYPES"}'::jsonb, now()
  );

  INSERT INTO public.rule_entries (id, rule_set_version_id, value, sub_category, position, reason, created_at)
  SELECT gen_random_uuid(), v_brunch_version_id, value, sub_category, position,
         'ORCH-0700 SPLIT — cloned from BRUNCH_CASUAL_BLOCKED_TYPES', now()
  FROM public.rule_entries WHERE rule_set_version_id = v_legacy_brunch_casual_version_id;

  UPDATE public.rule_sets SET current_version_id = v_brunch_version_id WHERE id = v_brunch_rule_set_id;

  -- ── CASUAL_FOOD_BLOCKED_TYPES ─────────────────────────────────────
  INSERT INTO public.rule_sets (id, name, description, kind, scope_kind, scope_value, is_active, created_at, updated_at)
  VALUES (
    v_casual_food_rule_set_id,
    'CASUAL_FOOD_BLOCKED_TYPES',
    'Strip casual_food if types-array contains bar/play/tobacco/sports UNLESS primary_type is in RESTAURANT_TYPES. ORCH-0700 SPLIT — modern slug equivalent of BRUNCH_CASUAL_BLOCKED_TYPES (casual half).',
    'strip', 'category', 'casual_food',
    true, now(), now()
  );

  INSERT INTO public.rule_set_versions (id, rule_set_id, version_number, change_summary, thresholds, created_at)
  VALUES (
    v_casual_food_version_id, v_casual_food_rule_set_id, 1,
    'ORCH-0700 SPLIT — modern slug equivalent of BRUNCH_CASUAL_BLOCKED_TYPES, cloned 36 entries verbatim.',
    '{"check_field": "types_array", "exempt_if_primary_in": "RESTAURANT_TYPES"}'::jsonb, now()
  );

  INSERT INTO public.rule_entries (id, rule_set_version_id, value, sub_category, position, reason, created_at)
  SELECT gen_random_uuid(), v_casual_food_version_id, value, sub_category, position,
         'ORCH-0700 SPLIT — cloned from BRUNCH_CASUAL_BLOCKED_TYPES', now()
  FROM public.rule_entries WHERE rule_set_version_id = v_legacy_brunch_casual_version_id;

  UPDATE public.rule_sets SET current_version_id = v_casual_food_version_id WHERE id = v_casual_food_rule_set_id;

  -- ── Step 2: Deactivate the 2 legacy bundled rules (preserve for audit) ──
  UPDATE public.rule_sets
  SET is_active = false,
      description = description || ' [DEACTIVATED 2026-05-03 per ORCH-0700 SPLIT — preserved for audit]',
      updated_at = now()
  WHERE name IN ('MOVIES_THEATRE_BLOCKED_TYPES', 'BRUNCH_CASUAL_BLOCKED_TYPES');

  -- ── Step 3: Update CASUAL_CHAIN_DEMOTION.thresholds.demote_to ──
  -- Append-only enforced by tg_rule_set_versions_block_update trigger; INSERT new
  -- version + flip current_version_id (do NOT UPDATE existing version).
  SELECT id INTO v_chain_rule_set_id FROM public.rule_sets WHERE name = 'CASUAL_CHAIN_DEMOTION';
  IF v_chain_rule_set_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B: CASUAL_CHAIN_DEMOTION not found — cannot update demote_to.';
  END IF;

  INSERT INTO public.rule_set_versions (id, rule_set_id, version_number, change_summary, thresholds, created_at)
  VALUES (
    v_chain_new_version_id, v_chain_rule_set_id, 2,
    'ORCH-0700 — change demote_to from legacy "brunch_lunch_casual" to modern "casual_food" per slug split.',
    '{"demote_to": "casual_food", "guarded_by": "UPSCALE_CHAIN_PROTECTION"}'::jsonb, now()
  );

  -- Clone existing entries to new version (append-only — must duplicate)
  INSERT INTO public.rule_entries (id, rule_set_version_id, value, sub_category, position, reason, created_at)
  SELECT gen_random_uuid(), v_chain_new_version_id, value, sub_category, position,
         'ORCH-0700 — cloned to new version on demote_to update', now()
  FROM public.rule_entries WHERE rule_set_version_id = (
    SELECT current_version_id FROM public.rule_sets WHERE id = v_chain_rule_set_id
  );

  -- Flip current_version_id
  UPDATE public.rule_sets
  SET current_version_id = v_chain_new_version_id, updated_at = now()
  WHERE id = v_chain_rule_set_id;
END $$;

-- ── Step 4: Verification probes (RAISE EXCEPTION on regression) ──
DO $$
DECLARE
  v_active_count INT;
  v_movies_entries INT;
  v_theatre_entries INT;
  v_brunch_entries INT;
  v_casual_entries INT;
  v_demote_to TEXT;
BEGIN
  -- 4 new rules active
  SELECT COUNT(*) INTO v_active_count FROM public.rule_sets
  WHERE name IN ('MOVIES_BLOCKED_TYPES','THEATRE_BLOCKED_TYPES','BRUNCH_BLOCKED_TYPES','CASUAL_FOOD_BLOCKED_TYPES')
    AND is_active = true;
  IF v_active_count <> 4 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: expected 4 new active rules, got %', v_active_count;
  END IF;

  -- 2 legacy rules deactivated
  SELECT COUNT(*) INTO v_active_count FROM public.rule_sets
  WHERE name IN ('MOVIES_THEATRE_BLOCKED_TYPES','BRUNCH_CASUAL_BLOCKED_TYPES')
    AND is_active = true;
  IF v_active_count <> 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: expected 0 legacy active, got %', v_active_count;
  END IF;

  -- Entry counts: 41 / 41 / 36 / 36
  SELECT COUNT(*) INTO v_movies_entries
  FROM public.rule_entries re
  JOIN public.rule_set_versions rsv ON rsv.id = re.rule_set_version_id
  JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id AND rs.current_version_id = rsv.id
  WHERE rs.name = 'MOVIES_BLOCKED_TYPES';
  IF v_movies_entries <> 41 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: MOVIES_BLOCKED_TYPES expected 41 entries, got %', v_movies_entries;
  END IF;

  SELECT COUNT(*) INTO v_theatre_entries
  FROM public.rule_entries re
  JOIN public.rule_set_versions rsv ON rsv.id = re.rule_set_version_id
  JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id AND rs.current_version_id = rsv.id
  WHERE rs.name = 'THEATRE_BLOCKED_TYPES';
  IF v_theatre_entries <> 41 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: THEATRE_BLOCKED_TYPES expected 41 entries, got %', v_theatre_entries;
  END IF;

  SELECT COUNT(*) INTO v_brunch_entries
  FROM public.rule_entries re
  JOIN public.rule_set_versions rsv ON rsv.id = re.rule_set_version_id
  JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id AND rs.current_version_id = rsv.id
  WHERE rs.name = 'BRUNCH_BLOCKED_TYPES';
  IF v_brunch_entries <> 36 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: BRUNCH_BLOCKED_TYPES expected 36 entries, got %', v_brunch_entries;
  END IF;

  SELECT COUNT(*) INTO v_casual_entries
  FROM public.rule_entries re
  JOIN public.rule_set_versions rsv ON rsv.id = re.rule_set_version_id
  JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id AND rs.current_version_id = rsv.id
  WHERE rs.name = 'CASUAL_FOOD_BLOCKED_TYPES';
  IF v_casual_entries <> 36 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: CASUAL_FOOD_BLOCKED_TYPES expected 36 entries, got %', v_casual_entries;
  END IF;

  -- CASUAL_CHAIN_DEMOTION updated
  SELECT rsv.thresholds->>'demote_to' INTO v_demote_to
  FROM public.rule_sets rs
  JOIN public.rule_set_versions rsv ON rsv.id = rs.current_version_id
  WHERE rs.name = 'CASUAL_CHAIN_DEMOTION';
  IF v_demote_to IS DISTINCT FROM 'casual_food' THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.B verify FAIL: CASUAL_CHAIN_DEMOTION.demote_to expected ''casual_food'', got ''%''', COALESCE(v_demote_to, 'NULL');
  END IF;
END $$;

COMMIT;
