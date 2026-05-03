---
id: ORCH-0700 (binding spec, v3 dispatch)
type: SPEC
mode: SPEC
classification: data-architecture + signal-config + admin-cleanup + transitional-alias-removal
severity: S1-high (Movies leak fix is user-facing); S2 for cleanup work
created: 2026-05-02
spec_writer: /mingla-forensics
dispatch: prompts/SPEC_ORCH-0700_DISPATCH_v3.md (supersedes v1+v2)
investigations:
  - reports/INVESTIGATION_ORCH-0700_RULES_CATEGORY_TRUTH.md (cycle-3, canonical)
  - reports/INVESTIGATION_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md (sub-audit)
  - reports/INVESTIGATION_ORCH-0700_CYCLE2_LIVE_FIRE.md
  - reports/INVESTIGATION_ORCH-0700_MOVIES_CHIP_LEAK.md
  - reports/INVESTIGATION_ORCH-0707_CURATED_CATEGORY_DERIVATION.md (related — explains ai_* deferral)
related_orch_ids:
  - ORCH-0707 (curated rewire — separate spec; blocks ai_* column drop until shipped + observed)
  - ORCH-0705 (NUKE rules engine — deferred)
  - ORCH-0706 (Casual+Brunch bar leak — deferred)
  - ORCH-0710 (Wire bouncer/scorer to rule_sets — deferred)
  - ORCH-0711 (Signal-name renames — deferred)
constitutional_compliance: #2 #8 #9 #13
---

# 1. Title + intent

**ORCH-0700 — Movies cinemas-only + seeding_category column drop + rule_sets SPLIT + replace-curated-stop modern-slug fix + sunset-coordinated transitional alias removal.**

Ships the user-facing Movies-pill leak fix (Path 1 cinemas-only via signal v1.10.0) plus the partial admin-cleanup work that doesn't depend on the curated rewrite. The 5 ai_* column drops + curated pipeline rewrite are explicitly deferred to ORCH-0707 (separate spec) + a follow-up migration after 24-48h observation.

# 2. Scope and non-goals

## Scope (IN)

This spec produces:
- **A.** 5 SQL migrations (signal v1.10.0, matview rebuild, column drop, rules SPLIT, RPC drift threshold + helper function)
- **B.** 4 backend edge function edits (replace-curated-stop, discover-cards, get-person-hero-cards, admin-seed-map-strangers)
- **C.** 9 admin RPC rewires + 2 admin edge function edits (admin-refresh-places, admin-place-search)
- **D.** 2 seed-pipeline file edits (seedingCategories.ts, admin-seed-places/index.ts)
- **E.** 4 admin UI file edits (SeedTab.jsx, categories.js, PlacePoolManagementPage.jsx, rules-filter dashboard verification)
- **F.** 7 mobile transitional-alias removal edits
- **G.** 56 i18n locale file edits (28 langs × 2 files)
- **H.** 3 sunset-coordinated final cleanup edits (categoryPlaceTypes.ts, scorer.test.ts, seedingCategories.test.ts)

Total: 5 SQL migrations + ~95 file edits.

## Non-goals (explicit OUT)

- **5 ai_* column drops** (`ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`) — DEFERRED to follow-up migration after ORCH-0707 ships and 24-48h observation passes
- **`generate-curated-experiences/index.ts` ai_categories rewrite** — ORCH-0707 spec
- **`_shared/stopAlternatives.ts` ai_categories rewrite** — ORCH-0707 spec
- **PlacePoolManagementPage.jsx ai_categories handling** — ORCH-0707 follow-up
- **`admin_place_pool_mv` ai_categories column reference removal** — ORCH-0707 follow-up (this spec only removes seeding_category from MV)
- **Rules engine wiring to bouncer/scorer** — ORCH-0710
- **Casual/Brunch bar leak fix** — ORCH-0706
- **Signal slug renames** (`fine_dining` ↔ `upscale_fine_dining`, `drinks` ↔ `drinks_and_music`) — ORCH-0711
- **Rules engine NUKE-ALL** — ORCH-0705

## Assumptions

- A1. Movies signal v1.9.0 is the current version (live-verified `signal_definitions.current_version_id` for `movies` points at v1.9.0 row created 2026-04-21 17:48 UTC).
- A2. The 41 entries in `MOVIES_THEATRE_BLOCKED_TYPES` and 36 entries in `BRUNCH_CASUAL_BLOCKED_TYPES` are stable (live-verified 2026-05-02 — see Appendix A for verbatim entry lists).
- A3. The 18 active rule_sets count is accurate (live-verified). After SPLIT: 18 + 4 - 2 = 20 active.
- A4. `signal_definition_versions` has append-only enforcement triggers (per ORCH-0588 design) — INSERT-only, no UPDATE allowed; flip via `signal_definitions.current_version_id`.
- A5. `rule_set_versions` and `rule_entries` have append-only enforcement triggers (verified by `tg_rule_set_versions_block_update` and `tg_rule_entries_block_update` triggers in pg_proc).
- A6. Cron job 13 `refresh_admin_place_pool_mv` runs every 10 min and will pick up the rebuilt matview definition automatically.
- A7. Mobile pre-OTA clients on builds older than 2026-04-22 (10+ days) are <2% of active users (operator confirmation; sunset 2026-05-12/13 was chosen 14 days post 100% adoption).
- A8. The `mapPrimaryTypeToMinglaCategory` function in `_shared/categoryPlaceTypes.ts` is stable and deterministic — admin RPCs can derive primary_category from primary_type+types via a SQL helper that mirrors its logic.

# 3. Per-layer specifications

## 3.A — Database layer

### Migration filenames (chronological order — apply in this sequence)

1. `20260502000001_orch_0700_movies_signal_v1_10_0_cinemas_only.sql` — Signal v1.10.0 + flip current_version_id
2. `20260502000002_orch_0700_create_pg_helper_map_primary_type.sql` — SQL helper function for category derivation (used by admin RPCs)
3. `20260502000003_orch_0700_rules_split_movies_theatre_brunch_casual.sql` — INSERT 4 new rule_sets + deactivate 2 legacy + update CASUAL_CHAIN_DEMOTION
4. `20260502000004_orch_0700_admin_rpcs_seeding_category_rewire.sql` — CREATE OR REPLACE 6 admin RPCs to use derivation; DROP admin_assign_place_category; ALTER admin_edit_place signature; UPDATE admin_rules_overview drift threshold
5. `20260502000005_orch_0700_rebuild_admin_place_pool_mv_no_seeding_category.sql` — Drop matview, recreate without `seeding_category` (KEEPS ai_categories), refresh
6. `20260502000006_orch_0700_drop_seeding_category_column.sql` — ALTER TABLE place_pool DROP COLUMN seeding_category

### A1 — Movies signal v1.10.0 (file `20260502000001_*`)

**Goal:** zero theatre type weights from v1.9.0; preserve everything else.

```sql
BEGIN;

-- Insert new version inheriting v1.9.0 with theatre weights stripped
WITH v1_9_config AS (
  SELECT config
  FROM public.signal_definition_versions
  WHERE signal_id = 'movies' AND version_label = 'v1.9.0'
),
v1_10_config AS (
  SELECT
    -- Strip the 5 theatre type weights by setting to NULL via jsonb_build_object overlay,
    -- then filtering nulls. We do this via field_weights surgery.
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
  id, signal_id, version_label, config, notes, created_by, created_at
)
SELECT
  gen_random_uuid(),
  'movies',
  'v1.10.0',
  v1_10_config.config,
  'ORCH-0700 Path 1 cinemas-only — REVERSE v1.2.0+ deliberate theatre padding per operator decision 2026-05-02. Removed types_includes_performing_arts_theater (was 35), types_includes_concert_hall (was 25), types_includes_opera_house (was 25), types_includes_amphitheatre (was 20), types_includes_auditorium (was 18). Cinemas only: types_includes_movie_theater 40 + drive_in 40 + summary_regex 45 + reviews_regex 25 + atmosphere 15 = 165 max for legitimate cinemas. Theatre venues now drop to 0 type-weight contribution; their rating+reviews scaling alone (max 60) cannot reach filter_min 80. Movies pill becomes cinemas-only; deck thin/empty when cinemas exhaust is intended.',
  NULL,
  now()
FROM v1_10_config;

-- Flip current_version_id to the new v1.10.0
UPDATE public.signal_definitions
SET current_version_id = (
  SELECT id FROM public.signal_definition_versions
  WHERE signal_id = 'movies' AND version_label = 'v1.10.0'
),
updated_at = now()
WHERE id = 'movies';

COMMIT;
```

**Post-migration step (NOT in SQL — implementor runs manually after migration applied):**

Invoke `run-signal-scorer` edge function for the `movies` signal to repopulate `place_scores`. Command:

```bash
curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-signal-scorer" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"signal_id": "movies"}'
```

Expected: ~14,412 places re-scored on the new v1.10.0 config; theatre venues' scores drop to <80; cinema venues' scores unchanged (their type weights weren't touched).

### A2 — SQL helper for category derivation (file `20260502000002_*`)

**Goal:** create a SQL function that mirrors `mapPrimaryTypeToMinglaCategory(primary_type, types)` so admin RPCs can derive the Mingla category server-side without an edge-function round-trip.

```sql
BEGIN;

-- Helper: maps Google primary_type / types[] to Mingla category slug
-- Mirrors the logic in supabase/functions/_shared/categoryPlaceTypes.ts (mapPrimaryTypeToMinglaCategory)
-- "First-write-wins" rule: a type is claimed by the first category in declaration order
CREATE OR REPLACE FUNCTION public.pg_map_primary_type_to_mingla_category(
  p_primary_type text,
  p_types text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_type text;
BEGIN
  -- Combine primary_type + types into a single ordered scan
  IF p_primary_type IS NOT NULL THEN
    v_type := p_primary_type;
    -- First-write-wins category lookup
    RETURN CASE
      -- Nature & Views (slug 'nature')
      WHEN v_type IN ('beach','botanical_garden','garden','hiking_area','national_park',
                      'nature_preserve','park','scenic_spot','state_park','observation_deck',
                      'tourist_attraction','picnic_ground','vineyard','wildlife_park','wildlife_refuge',
                      'woods','mountain_peak','river','island','city_park','fountain','lake','marina')
        THEN 'nature'
      -- Icebreakers (slug 'icebreakers')
      WHEN v_type IN ('cafe','bowling_alley','coffee_shop','miniature_golf_course','art_gallery',
                      'tea_house','video_arcade','museum','book_store','amusement_center',
                      'bakery','go_karting_venue','cultural_center','dessert_shop','karaoke',
                      'plaza','ice_cream_shop','comedy_club','art_museum','juice_shop',
                      'paintball_center','donut_shop','dance_hall','breakfast_restaurant','brunch_restaurant')
        THEN 'icebreakers'
      -- Drinks & Music (slug 'drinks_and_music')
      WHEN v_type IN ('bar','cocktail_bar','wine_bar','brewery','pub','beer_garden','brewpub',
                      'lounge_bar','night_club','live_music_venue','coffee_roastery','coffee_stand')
        THEN 'drinks_and_music'
      -- Movies (slug 'movies')
      WHEN v_type IN ('movie_theater','drive_in')
        THEN 'movies'
      -- Theatre (slug 'theatre')
      WHEN v_type IN ('performing_arts_theater','opera_house','auditorium','amphitheatre','concert_hall')
        THEN 'theatre'
      -- Brunch (slug 'brunch')
      WHEN v_type IN ('american_restaurant','bistro','gastropub','diner')
        THEN 'brunch'
      -- Casual (slug 'casual_food')
      WHEN v_type IN ('mexican_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop',
                      'mediterranean_restaurant','indian_restaurant','chinese_restaurant',
                      'vietnamese_restaurant','korean_restaurant','japanese_restaurant',
                      'lebanese_restaurant','greek_restaurant','italian_restaurant',
                      'ramen_restaurant','noodle_shop','hamburger_restaurant','deli',
                      'barbecue_restaurant','seafood_restaurant','vegan_restaurant',
                      'vegetarian_restaurant','turkish_restaurant','spanish_restaurant',
                      'french_restaurant','sushi_restaurant','buffet_restaurant','food_court',
                      'afghani_restaurant','african_restaurant','asian_restaurant',
                      'brazilian_restaurant','indonesian_restaurant','middle_eastern_restaurant',
                      'hot_pot_restaurant','dim_sum_restaurant','argentinian_restaurant',
                      'basque_restaurant','persian_restaurant','scandinavian_restaurant',
                      'filipino_restaurant','soul_food_restaurant','cuban_restaurant',
                      'hawaiian_restaurant','ethiopian_restaurant','moroccan_restaurant',
                      'peruvian_restaurant','cajun_restaurant','fusion_restaurant',
                      'korean_barbecue_restaurant','tapas_restaurant')
        THEN 'casual_food'
      -- Upscale & Fine Dining (slug 'upscale_fine_dining')
      WHEN v_type IN ('fine_dining_restaurant','steak_house','oyster_bar_restaurant',
                      'fondue_restaurant','swiss_restaurant','european_restaurant',
                      'australian_restaurant','british_restaurant')
        THEN 'upscale_fine_dining'
      -- Creative & Arts (slug 'creative_arts')
      WHEN v_type IN ('art_studio','history_museum','sculpture','cultural_landmark')
        THEN 'creative_arts'
      -- Play (slug 'play')
      WHEN v_type IN ('amusement_park','roller_coaster','water_park','ferris_wheel',
                      'casino','planetarium','golf_course','indoor_golf_course',
                      'adventure_sports_center','ice_skating_rink')
        THEN 'play'
      -- Flowers (slug 'flowers')
      WHEN v_type IN ('florist','grocery_store','supermarket')
        THEN 'flowers'
      ELSE NULL
    END;
  END IF;

  -- Fallback: scan types[] in order, return first match
  IF p_types IS NOT NULL THEN
    FOREACH v_type IN ARRAY p_types LOOP
      DECLARE
        v_result text;
      BEGIN
        v_result := public.pg_map_primary_type_to_mingla_category(v_type, NULL);
        IF v_result IS NOT NULL THEN
          RETURN v_result;
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.pg_map_primary_type_to_mingla_category(text, text[]) IS
  'Mirrors mapPrimaryTypeToMinglaCategory in _shared/categoryPlaceTypes.ts. Returns Mingla category slug for a Google primary_type + types[]. NULL when no match. First-write-wins: a type is claimed by the first category whose place-type list contains it. Per ORCH-0700 spec — used by admin RPCs to derive primary_category server-side.';

COMMIT;
```

**WARNING for implementor:** the type-list arrays in this function MUST stay in sync with `MINGLA_CATEGORY_PLACE_TYPES` in `supabase/functions/_shared/categoryPlaceTypes.ts`. Drift between them will produce inconsistent admin display vs serving behavior. A future ORCH should auto-generate this function from the TS source. For this spec: hand-mirror with care; tests T-03 + T-07 verify alignment.

### A3 — rule_sets SPLIT (file `20260502000003_*`)

**Goal:** insert 4 new modern-slug rules cloned from the 2 legacy bundled rules; deactivate the legacy rules; update CASUAL_CHAIN_DEMOTION.thresholds.demote_to.

```sql
BEGIN;

-- Step 1: SPLIT MOVIES_THEATRE_BLOCKED_TYPES into MOVIES_BLOCKED_TYPES + THEATRE_BLOCKED_TYPES
DO $$
DECLARE
  v_movies_rule_set_id UUID := gen_random_uuid();
  v_movies_version_id UUID := gen_random_uuid();
  v_theatre_rule_set_id UUID := gen_random_uuid();
  v_theatre_version_id UUID := gen_random_uuid();
  v_brunch_rule_set_id UUID := gen_random_uuid();
  v_brunch_version_id UUID := gen_random_uuid();
  v_casual_food_rule_set_id UUID := gen_random_uuid();
  v_casual_food_version_id UUID := gen_random_uuid();
  v_legacy_movies_theatre_version_id UUID;
  v_legacy_brunch_casual_version_id UUID;
BEGIN
  -- Resolve legacy version IDs (source of entries to clone)
  SELECT current_version_id INTO v_legacy_movies_theatre_version_id
  FROM public.rule_sets WHERE name = 'MOVIES_THEATRE_BLOCKED_TYPES';

  SELECT current_version_id INTO v_legacy_brunch_casual_version_id
  FROM public.rule_sets WHERE name = 'BRUNCH_CASUAL_BLOCKED_TYPES';

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

  -- ── THEATRE_BLOCKED_TYPES ──────────────────────────────────────────
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

  -- ── CASUAL_FOOD_BLOCKED_TYPES ──────────────────────────────────────
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
END $$;

-- Step 2: Deactivate the 2 legacy bundled rules (preserve for audit)
UPDATE public.rule_sets
SET is_active = false,
    description = description || ' [DEACTIVATED 2026-05-02 per ORCH-0700 SPLIT — preserved for audit]',
    updated_at = now()
WHERE name IN ('MOVIES_THEATRE_BLOCKED_TYPES', 'BRUNCH_CASUAL_BLOCKED_TYPES');

-- Step 3: Update CASUAL_CHAIN_DEMOTION.thresholds.demote_to from "brunch_lunch_casual" to "casual_food"
DO $$
DECLARE
  v_chain_rule_set_id UUID;
  v_new_version_id UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_chain_rule_set_id FROM public.rule_sets WHERE name = 'CASUAL_CHAIN_DEMOTION';

  -- INSERT new version (append-only triggered table)
  INSERT INTO public.rule_set_versions (id, rule_set_id, version_number, change_summary, thresholds, created_at)
  VALUES (
    v_new_version_id, v_chain_rule_set_id, 2,
    'ORCH-0700 — change demote_to from legacy "brunch_lunch_casual" to modern "casual_food" per slug split.',
    '{"demote_to": "casual_food", "guarded_by": "UPSCALE_CHAIN_PROTECTION"}'::jsonb, now()
  );

  -- Clone entries from current version to new version (append-only — must duplicate)
  INSERT INTO public.rule_entries (id, rule_set_version_id, value, sub_category, position, reason, created_at)
  SELECT gen_random_uuid(), v_new_version_id, value, sub_category, position,
         'ORCH-0700 — cloned to new version on demote_to update', now()
  FROM public.rule_entries WHERE rule_set_version_id = (
    SELECT current_version_id FROM public.rule_sets WHERE id = v_chain_rule_set_id
  );

  -- Flip current_version_id
  UPDATE public.rule_sets SET current_version_id = v_new_version_id, updated_at = now()
  WHERE id = v_chain_rule_set_id;
END $$;

COMMIT;
```

**Verification probe (post-migration; tester runs):**

```sql
-- Should return 4 new active rules + 2 deactivated = 6 rows
SELECT name, scope_value, is_active,
  (SELECT COUNT(*) FROM rule_entries re JOIN rule_set_versions rsv ON re.rule_set_version_id = rsv.id WHERE rsv.id = rs.current_version_id) AS entry_count
FROM public.rule_sets rs
WHERE name IN ('MOVIES_BLOCKED_TYPES','THEATRE_BLOCKED_TYPES','BRUNCH_BLOCKED_TYPES','CASUAL_FOOD_BLOCKED_TYPES','MOVIES_THEATRE_BLOCKED_TYPES','BRUNCH_CASUAL_BLOCKED_TYPES')
ORDER BY name;

-- Expected: MOVIES_BLOCKED_TYPES + THEATRE_BLOCKED_TYPES each have 41 entries, is_active=true
--           BRUNCH_BLOCKED_TYPES + CASUAL_FOOD_BLOCKED_TYPES each have 36 entries, is_active=true
--           MOVIES_THEATRE_BLOCKED_TYPES + BRUNCH_CASUAL_BLOCKED_TYPES is_active=false (entry_count=41 and 36 still — versions preserved)

-- CASUAL_CHAIN_DEMOTION should have version_number=2 with new demote_to
SELECT rs.name, rsv.version_number, rsv.thresholds
FROM rule_sets rs JOIN rule_set_versions rsv ON rsv.id = rs.current_version_id
WHERE rs.name = 'CASUAL_CHAIN_DEMOTION';
-- Expected: version_number=2, thresholds.demote_to="casual_food"
```

### A4 — Admin RPC rewires + drift threshold (file `20260502000004_*`)

**Goal:** rewire 6 admin RPCs to derive category via `pg_map_primary_type_to_mingla_category(...)` instead of reading `seeding_category`. DROP `admin_assign_place_category`. ALTER `admin_edit_place` signature. Update `admin_rules_overview` drift threshold from `<18` to `<20`.

```sql
BEGIN;

-- ── A4.1: admin_rules_overview drift threshold ─────────────────────────────────
-- Read current source via pg_proc.prosrc, replace `< 18` with `< 20`, rewrite function

CREATE OR REPLACE FUNCTION public.admin_rules_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_drift_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- ORCH-0700: drift threshold raised 18 → 20 after SPLIT (2 legacy deactivated + 4 new active = +2 net)
  IF (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true) < 20 THEN
    v_drift_status := 'warning';
  ELSE
    v_drift_status := 'in_sync';
  END IF;

  SELECT jsonb_build_object(
    'rules_active', (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true),
    'rules_total',  (SELECT COUNT(*) FROM public.rule_sets),
    'places_governed', (SELECT COUNT(*) FROM public.place_pool WHERE is_active = true),
    'fires_7d', (
      SELECT COUNT(*) FROM public.rules_run_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '7 days'
    ),
    'drift_status', v_drift_status,
    'last_run', (SELECT MAX(completed_at) FROM public.rules_runs WHERE status = 'completed')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── A4.2: admin_uncategorized_places — derive category via helper ──────────────
-- IMPLEMENTOR NOTE: Read live `pg_proc.prosrc` for the current function body.
-- Replace WHERE clause that filters `seeding_category IS NULL` with:
--   WHERE public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) IS NULL
-- Preserve all other logic, parameters, return shape.

-- ── A4.3: admin_pool_category_health — group by derived category ───────────────
-- IMPLEMENTOR NOTE: Replace `GROUP BY seeding_category` with
--   `GROUP BY public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types)`
-- Output column `category` should reflect derived value, not stored column.

-- ── A4.4: admin_city_place_stats — derive ──────────────────────────────────────
-- IMPLEMENTOR NOTE: Same pattern as A4.3.

-- ── A4.5: admin_virtual_tile_intelligence — derive ────────────────────────────
-- IMPLEMENTOR NOTE: Same pattern.

-- ── A4.6: DROP admin_assign_place_category — no override target column ────────
DROP FUNCTION IF EXISTS public.admin_assign_place_category(uuid, text);
DROP FUNCTION IF EXISTS public.admin_assign_place_category(uuid, text, text);
-- (drop both possible signatures; implementor verifies which exists via pg_proc lookup)

-- ── A4.7: admin_edit_place — REMOVE p_seeding_category parameter ──────────────
-- IMPLEMENTOR NOTE: Read live signature via:
--   SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='admin_edit_place';
-- Drop the existing function with that exact signature, then CREATE OR REPLACE
-- without p_seeding_category. Function body MUST NOT write to seeding_category column.

COMMIT;
```

**IMPLEMENTOR DIRECTIVE for A4.2-A4.5:** Spec writer cannot include the verbatim CREATE OR REPLACE FUNCTION bodies for the 4 admin RPCs because their full source must be read live from `pg_proc.prosrc` first (per the D-SUB-1 sharpened rule from prior cycle). Implementor MUST:

1. For each of the 4 RPCs: query `SELECT prosrc FROM pg_proc WHERE proname = '<rpc_name>'` to get current source
2. Identify every reference to `seeding_category` in that source
3. Replace with `pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types)` derivation
4. Preserve all other logic, parameter signatures, return types
5. Issue CREATE OR REPLACE FUNCTION via the migration

This is a "structured patch" pattern: the migration template above is the framework; the implementor fills in the bodies based on live source.

### A5 — Rebuild admin_place_pool_mv (file `20260502000005_*`)

**Goal:** drop matview + recreate without `seeding_category`. **KEEP `ai_categories` columns** (deferred to ORCH-0707 follow-up).

```sql
BEGIN;

-- Step 1: pause cron job 13 to prevent refresh during rebuild
UPDATE cron.job SET active = false WHERE jobid = 13;

-- Step 2: DROP CASCADE the matview (reveals downstream RPCs that depend on it)
DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;

-- Step 3: Recreate matview WITHOUT seeding_category, KEEPING ai_categories
CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
SELECT
  pp.id,
  pp.google_place_id,
  pp.name,
  pp.city_id,
  sc.country_code,
  sc.country AS country_name,
  sc.name AS city_name,
  sc.status AS city_status,
  pp.country AS pp_country,
  pp.city AS pp_city,
  -- DROPPED per ORCH-0700: pp.seeding_category
  -- KEPT (deferred to ORCH-0707 follow-up): pp.ai_categories
  pp.ai_categories,
  -- primary_category derivation: per ORCH-0700, use pg_map_primary_type_to_mingla_category
  -- which derives from primary_type+types (single source of truth per Constitution #2)
  -- KEEP COALESCE on ai_categories[1] as fallback for now (deferred to ORCH-0707 follow-up)
  COALESCE(
    public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types),
    pp.ai_categories[1],
    'uncategorized'::text
  ) AS primary_category,
  pp.types,
  pp.primary_type,
  pp.rating,
  pp.review_count,
  pp.price_level,
  pp.is_active,
  pp.is_servable,
  pp.bouncer_validated_at,
  pp.bouncer_reason,
  (pp.bouncer_validated_at IS NOT NULL) AS bouncer_validated,
  pp.stored_photo_urls,
  ((pp.stored_photo_urls IS NOT NULL) AND (array_length(pp.stored_photo_urls, 1) > 0) AND (pp.stored_photo_urls <> ARRAY['__backfill_failed__'::text])) AS has_photos,
  COALESCE(array_length(pp.stored_photo_urls, 1), 0) AS photo_count,
  pp.photos,
  ((pp.photos IS NOT NULL) AND (pp.photos <> '[]'::jsonb)) AS has_photo_refs,
  pp.last_detail_refresh,
  pp.updated_at,
  pp.created_at,
  (pp.claimed_by IS NOT NULL) AS is_claimed
FROM (place_pool pp LEFT JOIN seeding_cities sc ON ((pp.city_id = sc.id)));

-- Step 4: Re-create indexes that existed on the old matview
CREATE UNIQUE INDEX admin_place_pool_mv_id_idx ON public.admin_place_pool_mv (id);
CREATE INDEX admin_place_pool_mv_city_id_idx ON public.admin_place_pool_mv (city_id);
CREATE INDEX admin_place_pool_mv_primary_category_idx ON public.admin_place_pool_mv (primary_category);
CREATE INDEX admin_place_pool_mv_is_servable_idx ON public.admin_place_pool_mv (is_servable);

-- Step 5: Initial refresh
REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;

-- Step 6: Re-enable cron job 13
UPDATE cron.job SET active = true WHERE jobid = 13;

-- Step 7: GRANTs (preserve original — implementor verifies via information_schema)
-- IMPLEMENTOR NOTE: Before running this migration, capture original GRANTs:
--   SELECT * FROM information_schema.table_privileges WHERE table_name = 'admin_place_pool_mv';
-- Re-issue them after CREATE MATERIALIZED VIEW.

COMMIT;
```

**WARNING:** the CASCADE drop will drop dependent RPCs if any are defined as `CREATE FUNCTION ... AS $$ SELECT ... FROM admin_place_pool_mv $$` (i.e., with embedded SELECTs). The 10 RPCs identified by cycle-3 audit query the matview from PL/pgSQL function bodies, not as definitional dependencies — CASCADE should NOT drop them. **Tester MUST verify** post-migration: all 10 RPCs (admin_place_category_breakdown, admin_place_city_overview, admin_place_country_overview, admin_place_photo_stats, admin_place_pool_city_list, admin_place_pool_country_list, admin_place_pool_overview, admin_pool_category_health, admin_refresh_place_pool_mv, cron_refresh_admin_place_pool_mv) still exist via `pg_proc` query. If any was dropped by CASCADE, restore from `pg_dump` backup taken pre-migration.

**MANDATORY pre-migration step:** implementor takes a `pg_dump` of all 10 RPCs into a file `Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-02.sql` BEFORE applying A5. If CASCADE drops any, restore from that file.

### A6 — DROP COLUMN seeding_category (file `20260502000006_*`)

**Goal:** drop the `place_pool.seeding_category` column. Single column. ai_* columns NOT touched.

```sql
BEGIN;

-- Pre-check: confirm matview no longer references seeding_category
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE matviewname = 'admin_place_pool_mv'
    AND definition ILIKE '%seeding_category%'
  ) THEN
    RAISE EXCEPTION 'admin_place_pool_mv still references seeding_category — A5 migration must run first';
  END IF;
END $$;

-- Pre-check: confirm no remaining RPCs reference seeding_category
DO $$
DECLARE
  v_rpc_count INT;
BEGIN
  SELECT COUNT(*) INTO v_rpc_count
  FROM pg_proc
  WHERE prosrc ILIKE '%seeding_category%'
    AND pronamespace = 'public'::regnamespace;
  IF v_rpc_count > 0 THEN
    RAISE EXCEPTION 'pg_proc still has % function(s) referencing seeding_category — A4 migration must complete first', v_rpc_count;
  END IF;
END $$;

-- Drop the column
ALTER TABLE public.place_pool DROP COLUMN IF EXISTS seeding_category;

-- Drop any orphan index on seeding_category (ALTER TABLE DROP COLUMN should auto-drop, but explicit safety)
DROP INDEX IF EXISTS place_pool_seeding_category_idx;

COMMIT;
```

**The two pre-check DO blocks are critical:** they enforce migration sequencing. If A4 or A5 didn't fully complete, A6 fails fast with a clear error instead of dropping a column that's still being read.

## 3.B — Backend serving edits (4 files)

### B1 — `supabase/functions/replace-curated-stop/index.ts`

**Lines 11-15:** Replace VALID_CATEGORIES set.

**Current:**
```typescript
const VALID_CATEGORIES = new Set([
  'nature', 'icebreakers', 'drinks_and_music', 'brunch_lunch_casual',
  'upscale_fine_dining', 'movies_theatre', 'creative_arts', 'play',
  'flowers', 'groceries',
]);
```

**Change to:**
```typescript
// ORCH-0700: replace legacy bundled slugs with modern split slugs.
// brunch_lunch_casual → brunch + casual_food (per ORCH-0597)
// movies_theatre → movies + theatre (per ORCH-0598)
const VALID_CATEGORIES = new Set([
  'nature', 'icebreakers', 'drinks_and_music',
  'brunch', 'casual_food',
  'upscale_fine_dining',
  'movies', 'theatre',
  'creative_arts', 'play',
  'flowers', 'groceries',
]);
```

**Verify:** any other reference to `'brunch_lunch_casual'` or `'movies_theatre'` in this file is removed.

### B2 — `supabase/functions/discover-cards/index.ts`

**Lines 90-96:** Remove TRANSITIONAL legacy chip mappings.

**Current (lines 87-96 visible):**
```typescript
  // [TRANSITIONAL] ORCH-0597 pre-OTA clients still send the old union chip label/slug.
  // Serve the union (brunch + casual_food) via parallel-RPC merge, same as Slice 4 did.
  // Exit condition: 2026-05-12 (14d post ORCH-0597 100% OTA adoption).
  'Brunch, Lunch & Casual': { signalIds: ['brunch', 'casual_food'], filterMin: 120, displayCategory: 'Brunch' },
  'brunch_lunch_casual':    { signalIds: ['brunch', 'casual_food'], filterMin: 120, displayCategory: 'Brunch' },
  // [TRANSITIONAL] ORCH-0598 pre-OTA clients still send the old Movies & Theatre union.
  // Serve the union (movies + theatre) via parallel-RPC merge.
  // Exit condition: 2026-05-13 (coordinated with ORCH-0597 2026-05-12 for single cleanup).
  'Movies & Theatre': { signalIds: ['movies', 'theatre'], filterMin: 100, displayCategory: 'Movies' },
  'movies_theatre':   { signalIds: ['movies', 'theatre'], filterMin: 100, displayCategory: 'Movies' },
};
```

**Change to:** delete lines 87-96 entirely (the comment block + 4 mapping entries). The `};` on line 97 stays (closing the CATEGORY_TO_SIGNAL object after `'Icebreakers'` on line 86).

**Coordinated with §H sunset cleanup.** This change MUST ship in the same commit as §B5/B6, §F, §G, and §H1.

### B3 — `supabase/functions/get-person-hero-cards/index.ts`

**Lines 175-197:** Update INTENT_CATEGORY_MAP + CATEGORY_SLUG_TO_SIGNAL_ID + SIGNAL_ID_TO_CATEGORY_SLUG.

**Current INTENT_CATEGORY_MAP (lines 175-183):**
```typescript
const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ["icebreakers", "drinks_and_music", "nature", "upscale_fine_dining"],
  adventurous: [
    "nature", "play", "creative_arts", "brunch_lunch_casual", "drinks_and_music",
    "icebreakers", "movies_theatre", "flowers",
  ],
  friendly: ["play", "brunch_lunch_casual", "drinks_and_music", "nature", "creative_arts",
    "movies_theatre"],
};
```

**Change to:**
```typescript
// ORCH-0700: replace legacy bundled slugs with modern split slugs per intent.
// adventurous: prefer 'casual_food' (energetic vibe) over 'brunch'; both 'movies'+'theatre' included
// friendly: prefer 'brunch' (conversation-friendly daytime) over 'casual_food'; both 'movies'+'theatre'
const INTENT_CATEGORY_MAP: Record<string, string[]> = {
  romantic: ["icebreakers", "drinks_and_music", "nature", "upscale_fine_dining"],
  adventurous: [
    "nature", "play", "creative_arts", "casual_food", "drinks_and_music",
    "icebreakers", "movies", "theatre", "flowers",
  ],
  friendly: ["play", "brunch", "drinks_and_music", "nature", "creative_arts",
    "movies", "theatre"],
};
```

**Current CATEGORY_SLUG_TO_SIGNAL_ID (lines 187-197):**
```typescript
const CATEGORY_SLUG_TO_SIGNAL_ID: Record<string, string> = {
  upscale_fine_dining: 'fine_dining',
  drinks_and_music: 'drinks',
  brunch_lunch_casual: 'casual_food',  // brunch/casual union — RPC supports multiple signalIds
  nature: 'nature',
  play: 'play',
  creative_arts: 'creative_arts',
  movies_theatre: 'movies',            // pair with 'theatre' on caller
  icebreakers: 'icebreakers',
  flowers: 'flowers',
};
```

**Change to:**
```typescript
// ORCH-0700: removed legacy bundled-slug bridge entries (brunch_lunch_casual, movies_theatre).
// Modern slugs map: 'movies' / 'theatre' / 'brunch' / 'casual_food' resolve directly to identity signal.
const CATEGORY_SLUG_TO_SIGNAL_ID: Record<string, string> = {
  upscale_fine_dining: 'fine_dining',
  drinks_and_music: 'drinks',
  brunch: 'brunch',
  casual_food: 'casual_food',
  nature: 'nature',
  play: 'play',
  creative_arts: 'creative_arts',
  movies: 'movies',
  theatre: 'theatre',
  icebreakers: 'icebreakers',
  flowers: 'flowers',
};
```

**Current SIGNAL_ID_TO_CATEGORY_SLUG IIFE (lines 202-213):**
```typescript
const SIGNAL_ID_TO_CATEGORY_SLUG: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [slug, sig] of Object.entries(CATEGORY_SLUG_TO_SIGNAL_ID)) {
    out[sig] = slug;
  }
  // Add the fan-out signals that don't have a matching category slug:
  // 'brunch' is the second signal under brunch_lunch_casual; 'theatre' under movies_theatre.
  out['brunch'] = 'brunch_lunch_casual';
  out['theatre'] = 'movies_theatre';
  out['casual_food'] = 'brunch_lunch_casual';
  return out;
})();
```

**Change to:**
```typescript
// ORCH-0700: removed fan-out additions for legacy bundled slugs.
// Now that brunch/theatre/casual_food are first-class entries in CATEGORY_SLUG_TO_SIGNAL_ID,
// the IIFE produces correct identity mappings without needing manual additions.
const SIGNAL_ID_TO_CATEGORY_SLUG: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [slug, sig] of Object.entries(CATEGORY_SLUG_TO_SIGNAL_ID)) {
    out[sig] = slug;
  }
  return out;
})();
```

**Lines 825-826:** Find and replace any remaining hardcoded `'brunch_lunch_casual'` or `'movies_theatre'` references in the request-handling code path. Implementor reads file in full to confirm all hits resolved.

### B4 — `supabase/functions/admin-seed-map-strangers/index.ts`

**Lines 116-119:** Update ALL_CATEGORIES list.

**Current:**
```typescript
const ALL_CATEGORIES = [
  "nature", "icebreakers", "drinks_and_music", "brunch_lunch_casual",
  "upscale_fine_dining", "movies_theatre", "creative_arts", "play", "flowers",
];
```

**Change to:**
```typescript
// ORCH-0700: replace legacy bundled slugs with modern split slugs.
const ALL_CATEGORIES = [
  "nature", "icebreakers", "drinks_and_music",
  "brunch", "casual_food",
  "upscale_fine_dining",
  "movies", "theatre",
  "creative_arts", "play", "flowers",
];
```

## 3.C — Admin RPC + admin edge function rewires

Already covered in §3.A.A4 (the 6 admin RPCs + DROP + ALTER) via migration `20260502000004_*`.

### C1 — `supabase/functions/admin-refresh-places/index.ts`

**Lines 500-606:** Replace seeding_category-based filter and progress display with derived category.

**Current line 500-504:**
```typescript
if (concrete.length > 0) {
  query = query.or(`seeding_category.in.(${concrete.join(",")}),seeding_category.is.null`);
} else {
  query = query.in("seeding_category", concrete);
}
```

**Change to:** filter by derived category. Since this is admin tooling that fetches places by category for refresh, replace with:

```typescript
// ORCH-0700: seeding_category column dropped. Filter by derived category.
// Fetch all rows in city/area, then filter in memory by derived category since
// PostgREST cannot directly filter on a function-call result via .in() syntax.
// Trade-off: small perf cost on admin tooling (acceptable — not user-facing).
// TODO ORCH-0707 follow-up: when ai_* columns drop, reconsider whether to add
// a generated column on place_pool for category to enable PostgREST filtering.
// For now: fetch broad, filter in JS post-hydrate.
```

**IMPLEMENTOR DIRECTIVE:** Read the current code from line 500 to ~606 (the progress display block). Refactor:
1. Remove `query.in("seeding_category", concrete)` and `query.is("seeding_category", null)` calls
2. Remove `seeding_category` from any `.select()` lists (line 532, 603 etc.)
3. Add an in-memory category derivation step using a TS helper that mirrors `pg_map_primary_type_to_mingla_category` (call into `mapPrimaryTypeToMinglaCategory(primary_type, types)` from `_shared/categoryPlaceTypes.ts` since both edge fns share that module)
4. Filter results by derived category to match the admin user's intent
5. Update any progress UI grouping that previously keyed on `r.seeding_category` to key on the derived category (line 542, 596 etc.)

**Order ordering:** keep `.order("seeding_category", { ascending: true, nullsFirst: false })` REMOVED — replace with `.order("name", { ascending: true })` since we can't sort on a function result post-fetch reliably.

### C2 — `supabase/functions/admin-place-search/index.ts`

**Lines 224 and 330:** Remove seeding_category writes.

**Line 224 current:**
```typescript
    seeding_category: null as string | null,
```

**Change to:** remove the field entirely from the row construction object. The column will be dropped by A6.

**Line 330 current:**
```typescript
      row.seeding_category = p.seedingCategory || seedingCategory;
```

**Change to:** remove the assignment line entirely.

**Implementor verify:** any other reference to `seeding_category` in this file is removed.

## 3.D — Seed pipeline write-paths (2 files)

### D1 — `supabase/functions/_shared/seedingCategories.ts`

**5 line edits:**

**Line 222 current:** `appCategorySlug: 'brunch_lunch_casual',` (inside config with label='Brunch, Lunch & Casual')
**Change to:** `appCategorySlug: 'brunch',` and update label to 'Brunch' if appropriate (verify config is the brunch_restaurant/breakfast_restaurant set per file inspection)

**Line 256 current:** `appCategorySlug: 'brunch_lunch_casual',` (inside World Cuisines config)
**Change to:** `appCategorySlug: 'casual_food',`

**Line 284 current:** `appCategorySlug: 'brunch_lunch_casual',` (inside Extended config)
**Change to:** `appCategorySlug: 'casual_food',`

**Line 340 current:** `appCategorySlug: 'movies_theatre',` (inside cinema-only config — `includedTypes: ['movie_theater']`)
**Change to:** `appCategorySlug: 'movies',`

**Line 361 current:** `appCategorySlug: 'movies_theatre',` (inside theatre/performing-arts config)
**Change to:** `appCategorySlug: 'theatre',`

**Implementor must update** the corresponding `appCategory` field if it carries the legacy display name (`'Brunch, Lunch & Casual'` → `'Brunch'` or `'Casual'`; `'Movies & Theatre'` → `'Movies'` or `'Theatre'`).

**Test fixture impact:** the test at `_shared/seedingCategories.test.ts` (covered in §H3) asserts these `appCategorySlug` values; tests must be updated in lockstep with this file.

### D2 — `supabase/functions/admin-seed-places/index.ts`

**Line 716 current:** `seeding_category: config.appCategorySlug,` (inside the place_pool insert object)

**Change to:** REMOVE the line entirely. The column is dropped by A6; writing to it will fail post-migration. Add a comment:

```typescript
// ORCH-0700: seeding_category column dropped. Admin pages derive category
// from primary_type+types via pg_map_primary_type_to_mingla_category() helper.
// The seeding intent is preserved on seeding_batches.seeding_category and
// seeding_operations.seeding_category (separate operational queue tables).
```

**Verify:** any other reference to `seeding_category` in `admin-seed-places/index.ts` (lines 369, 520, 526, 582, 586, 596, 611, 786, 787, 908, 914, 932, 1197, 1208, 1209, 1219, 1356, 1362, 1377, 1629) — all of these read from `seeding_batches` or `seeding_operations` tables (NOT `place_pool`), so they remain valid. Implementor confirms each by checking the table the SELECT/UPDATE targets.

## 3.E — Admin UI (4 files)

### E1 — `mingla-admin/src/components/seeding/SeedTab.jsx`

**Lines 45-61:** Update primary_type → slug map.

**Current excerpt:**
```jsx
  // Brunch, Lunch & Casual
  restaurant: "brunch_lunch_casual", brunch_restaurant: "brunch_lunch_casual",
  breakfast_restaurant: "brunch_lunch_casual", diner: "brunch_lunch_casual",
  sandwich_shop: "brunch_lunch_casual", pizza_restaurant: "brunch_lunch_casual",
  hamburger_restaurant: "brunch_lunch_casual", mexican_restaurant: "brunch_lunch_casual",
  mediterranean_restaurant: "brunch_lunch_casual", thai_restaurant: "brunch_lunch_casual",
  vegetarian_restaurant: "brunch_lunch_casual",
  // Upscale & Fine Dining
  ...
  // Movies & Theatre
  movie_theater: "movies_theatre", performing_arts_theater: "movies_theatre",
  concert_hall: "movies_theatre", opera_house: "movies_theatre",
  philharmonic_hall: "movies_theatre", amphitheatre: "movies_theatre",
  comedy_club: "movies_theatre", event_venue: "movies_theatre",
  arena: "movies_theatre", live_music_venue: "movies_theatre",
```

**Change to:**
```jsx
  // ORCH-0700: split brunch_lunch_casual → brunch + casual_food per type intent.
  // breakfast_restaurant + brunch_restaurant + diner = brunch (daytime intent)
  // restaurant + cuisine-specific + sandwich/pizza/hamburger = casual_food (cuisine intent)
  brunch_restaurant: "brunch", breakfast_restaurant: "brunch", diner: "brunch",
  restaurant: "casual_food",
  sandwich_shop: "casual_food", pizza_restaurant: "casual_food",
  hamburger_restaurant: "casual_food", mexican_restaurant: "casual_food",
  mediterranean_restaurant: "casual_food", thai_restaurant: "casual_food",
  vegetarian_restaurant: "casual_food",
  // Upscale & Fine Dining (unchanged)
  ...
  // ORCH-0700: split movies_theatre → movies + theatre per type intent.
  // movie_theater = movies (cinema-only)
  // performing_arts_theater + concert_hall + opera_house + philharmonic_hall +
  //   amphitheatre + comedy_club + event_venue + arena + live_music_venue = theatre
  movie_theater: "movies",
  performing_arts_theater: "theatre", concert_hall: "theatre",
  opera_house: "theatre", philharmonic_hall: "theatre", amphitheatre: "theatre",
  comedy_club: "theatre", event_venue: "theatre",
  arena: "theatre", live_music_venue: "theatre",
```

### E2 — `mingla-admin/src/constants/categories.js`

**Lines 14, 16, 27, 29:** Remove legacy slug entries.

**Current excerpt (lines 13-30 inferred):**
```javascript
export const CATEGORY_DISPLAY_NAMES = {
  ...
  drinks_and_music: "Drinks & Music",
  brunch_lunch_casual: "Brunch, Lunch & Casual",
  upscale_fine_dining: "Upscale & Fine Dining",
  movies_theatre: "Movies & Theatre",
  creative_arts: "Creative & Arts",
  ...
};

export const CATEGORY_COLORS = {
  ...
  drinks_and_music: "#a855f7",
  brunch_lunch_casual: "#ef4444",
  upscale_fine_dining: "#dc2626",
  movies_theatre: "#3b82f6",
  creative_arts: "#ec4899",
  ...
};
```

**Change to:** remove the `brunch_lunch_casual` and `movies_theatre` keys from BOTH maps. Add `brunch`, `casual_food`, `movies`, `theatre` keys with appropriate display names + colors:

```javascript
export const CATEGORY_DISPLAY_NAMES = {
  ...
  drinks_and_music: "Drinks & Music",
  brunch: "Brunch",
  casual_food: "Casual",
  upscale_fine_dining: "Upscale & Fine Dining",
  movies: "Movies",
  theatre: "Theatre",
  creative_arts: "Creative & Arts",
  ...
};

export const CATEGORY_COLORS = {
  ...
  drinks_and_music: "#a855f7",
  brunch: "#f59e0b",         // amber — daytime brunch
  casual_food: "#ef4444",    // red — inherits old brunch_lunch_casual color
  upscale_fine_dining: "#dc2626",
  movies: "#3b82f6",         // blue — inherits old movies_theatre color (cinema)
  theatre: "#6366f1",        // indigo — distinct from movies
  creative_arts: "#ec4899",
  ...
};
```

### E3 — `mingla-admin/src/pages/PlacePoolManagementPage.jsx`

**Surgical edits — KEEP ai_categories handling for now (deferred to ORCH-0707 follow-up).**

**Line 361-362 current:**
```jsx
  const [editForm, setEditForm] = useState({
    name: "", price_tiers: [], seeding_category: "", is_active: true,
    ai_categories: [],
  });
```

**Change to:** remove `seeding_category` field; keep `ai_categories`:
```jsx
  // ORCH-0700: removed seeding_category from edit form (column dropped).
  // ai_categories handling preserved this cycle — deferred to ORCH-0707 follow-up.
  const [editForm, setEditForm] = useState({
    name: "", price_tiers: [], is_active: true,
    ai_categories: [],
  });
```

**Line 371 current:**
```jsx
      seeding_category: place.seeding_category || "",
```

**Change to:** remove this line from the object (in the pre-fill block). `ai_categories` line that follows stays.

**Line 382 current:**
```jsx
  const hasConflict = place.seeding_category && aiCats.length > 0 && place.seeding_category !== aiCats[0];
```

**Change to:** remove the conflict-detection logic entirely (no seeding_category to compare against). Replace with:
```jsx
  // ORCH-0700: seeding_category column dropped — conflict badge removed.
  // ORCH-0707 follow-up will reintroduce a derivation-vs-stored check if needed.
  const hasConflict = false;
```

(Or remove the variable + the conditional render that uses it; implementor's choice — preserve the JSX structure.)

**Line 398 current:**
```jsx
      p_seeding_category: editForm.seeding_category || null,
```

**Change to:** remove this line from the RPC call argument object.

**Lines 484-487 current:**
```jsx
                <span className="text-[var(--color-text-secondary)]">Google Category:</span>
                {place.seeding_category ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[place.seeding_category] }}>
                    {CATEGORY_LABELS[place.seeding_category] || place.seeding_category}
```

**Change to:** replace `place.seeding_category` lookup with derived category from primary_type+types. Since the admin UI doesn't have the helper function inline, use `place.primary_category` (computed by the rebuilt matview at A5):
```jsx
                <span className="text-[var(--color-text-secondary)]">Google Category:</span>
                {place.primary_category ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[place.primary_category] }}>
                    {CATEGORY_LABELS[place.primary_category] || place.primary_category}
```

**IMPLEMENTOR NOTE:** for the matview-derived `primary_category` to flow into `place` here, the admin RPC that hydrates this page (likely `admin_place_pool_overview` or similar) MUST select the matview's `primary_category` column. Check the exact RPC + ensure its return shape includes `primary_category`.

**Line 568-569 current:** dropdown editor for seeding_category. **Change to:** REMOVE the entire `<select>` block. The "edit seeding_category" UI capability is gone.

**Line 1063 current:**
```jsx
    let q = supabase.from("place_pool")
      .select("id, name, lat, lng, rating, ai_categories, seeding_category, is_active, stored_photo_urls, is_servable")
```

**Change to:** remove `seeding_category` from the select list (column dropped):
```jsx
    let q = supabase.from("place_pool")
      .select("id, name, lat, lng, rating, ai_categories, is_active, stored_photo_urls, is_servable")
```

**Line 1085 current:**
```jsx
  const filteredPlaces = places.filter((p) => visibleCats.has(p.ai_categories?.[0] || p.seeding_category));
```

**Change to:** remove fallback to seeding_category:
```jsx
  // ORCH-0700: removed seeding_category fallback (column dropped). ai_categories[0] is the only filter source until ORCH-0707 replaces it.
  const filteredPlaces = places.filter((p) => visibleCats.has(p.ai_categories?.[0]));
```

### E4 — `mingla-admin/src/components/rules-filter/`

**No code changes — verification only.** After A3 migration applies:
- The Rules Filter dashboard should load via `admin_rules_overview` and `admin_rules_list` RPCs
- The 4 new SPLIT rules (MOVIES_BLOCKED_TYPES, THEATRE_BLOCKED_TYPES, BRUNCH_BLOCKED_TYPES, CASUAL_FOOD_BLOCKED_TYPES) appear with `is_active=true`
- The 2 deactivated bundled rules (MOVIES_THEATRE_BLOCKED_TYPES, BRUNCH_CASUAL_BLOCKED_TYPES) appear greyed out / struck-through (per existing UI's is_active styling)
- `drift_status` returns `'in_sync'` (since active count = 20 ≥ 20 threshold)

If the UI does NOT render deactivated rules at all, the deactivation will appear as a disappearance — operator may want to verify that's acceptable or whether a "deactivated" filter pill should be added. Out of scope for ORCH-0700 spec; record as discovery if UI behaves unexpectedly.

## 3.F — Mobile transitional alias removal (7 files)

### F1 — `app-mobile/src/services/deckService.ts`

**Line 103:** deckMode union type. Remove `'brunch_lunch_casual'` and `'movies_theatre'` literals.

**Current:**
```typescript
  deckMode: 'nature' | 'icebreakers' | 'drinks_and_music' | 'brunch' | 'casual_food' | 'brunch_lunch_casual' | 'upscale_fine_dining' | 'movies' | 'theatre' | 'movies_theatre' | 'creative_arts' | 'play' | 'curated' | 'mixed';
```

**Change to:**
```typescript
  // ORCH-0700: removed legacy bundled slug literals from deckMode union.
  deckMode: 'nature' | 'icebreakers' | 'drinks_and_music' | 'brunch' | 'casual_food' | 'upscale_fine_dining' | 'movies' | 'theatre' | 'creative_arts' | 'play' | 'curated' | 'mixed';
```

**Line 145:** Remove `brunch_lunch_casual: 'Brunch, Lunch & Casual',` from the name map.

**Line 150:** Remove `movies_theatre: 'Movies & Theatre',` from the name map.

**Lines 250 and 260:** Remove `'brunch_lunch_casual': 'brunch',` and `'movies_theatre': 'movies',` from the alias resolver. Also remove the `'brunch, lunch & casual'` and `'movies & theatre'` lower-case aliases on lines 251 and 261.

### F2 — `app-mobile/src/utils/categoryUtils.ts`

**Lines 30-39:** Remove the LEGACY_CATEGORY_SLUGS Set.

**Current:**
```typescript
const ALL_CATEGORY_SLUGS = new Set([
  ...
  // [TRANSITIONAL] legacy bundled chips — kept for resolution / pre-OTA persistence.
  // brunch_lunch_casual → remove after 2026-05-12
  // movies_theatre     → remove after 2026-05-13
  'brunch_lunch_casual',
  'movies_theatre',
]);
```

**Change to:** remove the 2 legacy entries + the comment block. The 'brunch_lunch_casual' and 'movies_theatre' literals on lines 34, 35 + the 4-line comment above them (lines 30-33).

**Line 39:** Remove `const LEGACY_CATEGORY_SLUGS = new Set(['brunch_lunch_casual', 'movies_theatre']);`. Verify the constant isn't imported anywhere else; if it is, those imports must be removed too. Implementor greps for `LEGACY_CATEGORY_SLUGS` across `app-mobile/src/`.

**Lines 67, 69, 191, 223, 229, 261, 263, 295, 297, 303:** Remove all `'brunch_lunch_casual': '...'` and `'movies_theatre': '...'` entries from the alias maps. Each is a single-line edit per instance.

**Line 23 doc comment:** Update to remove "13 total: 10 visible + 2 hidden + 2 legacy-only" — change to "11 total: 10 visible + 2 hidden" (verify count post-removal).

### F3 — `app-mobile/src/constants/interestIcons.ts`

**Lines 53, 57:** Remove TRANSITIONAL legacy slug entries.

**Line 53 current:** `brunch_lunch_casual: UtensilsCrossed, // [TRANSITIONAL] legacy — remove after 2026-05-12`
**Change to:** remove this line entirely.

**Line 57 current:** `movies_theatre: Film, // [TRANSITIONAL] legacy — remove after 2026-05-13`
**Change to:** remove this line entirely.

### F4 — `app-mobile/src/constants/holidays.ts`

**Lines 18-19 (comments) and 138-141 (INTENT_CATEGORY_MAP):** Clean up.

**Lines 18-19 current:**
```typescript
// ORCH-0598 (Slice 6): updated label + slug from 'Movies & Theatre' / 'movies_theatre' to
// new single-chip 'Movies' / 'movies'. Users get Movies-ranked deck. Adding a separate
```

**Change to:** Update the comment to remove the historical reference to `'movies_theatre'` (cleanup pass — comment can be tightened to current state only). Keep ORCH-0598 reference if the structural comment is useful.

**Lines 138-141 current:**
```typescript
// ORCH-0434: Updated to new canonical slugs.
// ORCH-0597 (Slice 5): brunch_lunch_casual bundled chip split into brunch + casual_food.
// ORCH-0598 (Slice 6): movies_theatre bundled chip split into movies + theatre.
export const INTENT_CATEGORY_MAP: Record<string, string[]> = {
```

**Change to:** keep the ORCH-0434/0597/0598 historical context comments (useful audit trail). Inspect the INTENT_CATEGORY_MAP body that follows for any `'brunch_lunch_casual'` or `'movies_theatre'` literal references — remove each.

### F5 — `app-mobile/src/components/OnboardingFlow.tsx`

**Lines 2621 and 2626:** Remove TRANSITIONAL icon entries.

**Line 2621 current:** `brunch_lunch_casual: 'restaurant-outline', // [TRANSITIONAL] legacy — remove after 2026-05-12`
**Change to:** remove the line entirely.

**Line 2626 current:** `movies_theatre: 'film-new', // [TRANSITIONAL] legacy — remove after 2026-05-13`
**Change to:** remove the line entirely.

### F6 — `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx`

**Lines 137 and 141:** Remove TRANSITIONAL i18n key entries.

**Line 137 current:** `brunch_lunch_casual: "category_descriptions.brunch_lunch_casual", // [TRANSITIONAL]`
**Change to:** remove the line entirely.

**Line 141 current:** `movies_theatre: "category_descriptions.movies_theatre", // [TRANSITIONAL]`
**Change to:** remove the line entirely.

### F7 — `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`

**Lines 88 and 93:** Remove TRANSITIONAL icon entries.

**Line 88 current:** `brunch_lunch_casual: 'fast-food-outline', // [TRANSITIONAL] legacy — remove after 2026-05-12`
**Change to:** remove the line entirely.

**Line 93 current:** `movies_theatre: 'film-outline', // [TRANSITIONAL] legacy — remove after 2026-05-13`
**Change to:** remove the line entirely.

## 3.G — i18n cleanup (56 files)

For EACH file in the 56-file list:
- `app-mobile/src/i18n/locales/{en,es,fr,de,it,pt,ja,ko,zh,ar,bn,bin,el,ha,he,hi,id,ig,ms,nl,pl,ro,ru,sv,th,tr,uk,vi,yo}/common.json`
- `app-mobile/src/i18n/locales/{...}/preferences.json`

**Action:** Remove the JSON keys `category_descriptions.brunch_lunch_casual` and `category_descriptions.movies_theatre` if present.

**Verification SQL/grep for tester:**
```bash
# After implementor's pass, this command should return ZERO matches:
grep -rn "brunch_lunch_casual\|movies_theatre" app-mobile/src/i18n/locales/
```

If any locale file lacks these keys to begin with, no edit is needed for that file. Implementor uses jq or careful JSON editing to preserve formatting.

## 3.H — Sunset-coordinated final cleanup (3 files)

### H1 — `supabase/functions/_shared/categoryPlaceTypes.ts`

**Multi-region edits — must ship in same commit as B2 (discover-cards), F (mobile), G (i18n):**

**Lines 103-124:** Remove `MINGLA_CATEGORY_PLACE_TYPES['Brunch, Lunch & Casual']` entry block.
**Lines 140-145:** Remove `MINGLA_CATEGORY_PLACE_TYPES['Movies & Theatre']` entry block.
**Lines 228-230:** Remove `CATEGORY_ALIASES` entries for `'brunch_lunch_casual'`, `'brunch-lunch-casual'`, `'brunch, lunch & casual'`.
**Lines 246-248:** Remove `CATEGORY_ALIASES` entries for `'movies_theatre'`, `'movies-theatre'`.
**Line 477 + 479:** Remove `DISPLAY_TO_SLUG['Brunch, Lunch & Casual']` and `['Movies & Theatre']` entries.
**Line 577:** Remove `CATEGORY_EXCLUDED_PLACE_TYPES['Brunch, Lunch & Casual']` block.
**Line 603:** Remove `CATEGORY_EXCLUDED_PLACE_TYPES['Movies & Theatre']` block.

**Update doc comment at top of file (around lines 18-25):** remove the ORCH-0598 transitional / `[TRANSITIONAL]` references that no longer apply.

**Verify TypeScript still compiles:** `MINGLA_CATEGORY_PLACE_TYPES` keys are referenced via `Object.keys()` in `ALL_CATEGORY_NAMES` — removing 2 keys reduces it from 13 to 11. Verify `VISIBLE_CATEGORY_NAMES` still excludes the right hidden categories.

### H2 — `supabase/functions/_shared/__tests__/scorer.test.ts`

**Implementor reads file in full** to find every test fixture referencing legacy slugs. Likely test cases:
- Tests that pass `'brunch_lunch_casual'` or `'movies_theatre'` as a `categoryId` argument → update to `'brunch'`/`'casual_food'` or `'movies'`/`'theatre'` per test intent
- Tests that assert on `displayCategory: 'Movies & Theatre'` → update assertion to `'Movies'`
- Snapshot tests that include legacy slugs → update snapshots

If after edits no test references legacy slugs, the test suite is clean. Implementor runs `deno test supabase/functions/_shared/__tests__/scorer.test.ts` to confirm.

### H3 — `supabase/functions/_shared/seedingCategories.test.ts`

The invariant test enforces `appCategorySlug` values. After D1 changes, the test must expect:
- 'brunch' for the brunch-restaurant config
- 'casual_food' for the World Cuisines + Extended configs
- 'movies' for the cinema-only config
- 'theatre' for the performing-arts config

Implementor reads file, updates assertions, runs `deno test`. Net change: ~5 string literal updates in test fixtures.

# 4. Success criteria

1. **SC-01 — Movies pill cinemas-only:** After A1+A2+A3 (signal v1.10.0 + scorer re-run), querying `query_servable_places_by_signal('movies', 80, ...)` returns ZERO `primary_type` rows other than `movie_theater` and `drive_in` (and rows with NULL primary_type whose `types[]` contains those values). Verifiable via T-01.
2. **SC-02 — Theatre pill unchanged:** After A1, querying `query_servable_places_by_signal('theatre', 120, ...)` returns the same set of rows as it did pre-migration (only the movies signal changed). Verifiable via T-05.
3. **SC-03 — seeding_category column dropped:** After A6, `information_schema.columns WHERE table_name='place_pool' AND column_name='seeding_category'` returns ZERO rows. Verifiable via T-02.
4. **SC-04 — ai_* columns intact:** After A6, the 5 ai_* columns ARE present (deferred to ORCH-0707 follow-up). Verifiable via T-02.
5. **SC-05 — 4 SPLIT rules active:** After A3, `rule_sets WHERE name IN (...4 new...) AND is_active=true` returns 4 rows; `WHERE name IN (...2 legacy...) AND is_active=true` returns 0 rows. Verifiable via T-12.
6. **SC-06 — CASUAL_CHAIN_DEMOTION updated:** After A3, the current version of CASUAL_CHAIN_DEMOTION has `thresholds.demote_to = 'casual_food'`. Verifiable via T-12.
7. **SC-07 — admin_rules_overview drift in_sync:** After A4 (drift threshold raised to <20), `admin_rules_overview()` returns `drift_status: 'in_sync'`. Verifiable via T-11.
8. **SC-08 — admin pages render:** After A4+A5+E3, every admin page that previously read `seeding_category` loads without errors. The "Google Category" badge derives from matview's `primary_category` column (via pg_map_primary_type_to_mingla_category). Verifiable via T-07.
9. **SC-09 — Curated experience generation succeeds:** After A6, calling `generate-curated-experiences` for any experience type returns valid card responses (ai_categories columns still present this cycle, so curated continues working). Verifiable via T-06.
10. **SC-10 — replace-curated-stop accepts modern slugs:** After B1, POST request with `category: 'movies'` returns HTTP 200 (not 400). Verifiable via T-09.
11. **SC-11 — Mobile transitional aliases gone:** After F1-F7 + G + H1, grep for `'brunch_lunch_casual'` and `'movies_theatre'` across `app-mobile/src/` and `supabase/functions/_shared/categoryPlaceTypes.ts` returns ZERO active references (excluding migration files / historical reports). Verifiable via T-10.
12. **SC-12 — Cron job 13 still active:** After A5, cron job 13 `refresh_admin_place_pool_mv` shows `active=true`. Matview refreshes every 10 min on the new definition. Verifiable via T-03.

# 5. Invariants

## Preserved (must not break)

| Invariant | How preserved |
|-----------|---------------|
| **I-BOUNCER-DETERMINISTIC** (NO AI in bouncer) | This spec touches no bouncer code |
| **I-SIGNAL-CONTINUOUS** (score 0-200 numeric) | New signal v1.10.0 preserves cap=200, clamp_min=0 from v1.9.0 |
| **I-SCORE-NON-NEGATIVE** (clamps at 0) | Preserved by inheritance from v1.9.0 |
| **I-MV-COLUMN-COVERAGE** (proposed prior cycle) | A5 explicitly rebuilds matview when seeding_category column dropped; the pre-check DO blocks in A6 enforce this ordering |
| **I-RULES-VERSIONING-APPEND-ONLY** | A3 INSERTs new rule_set_versions rows; never UPDATEs existing ones (enforced by tg_rule_set_versions_block_update) |
| **I-13 (Exclusion Consistency)** | The 4 new rule_sets carry the SAME entries as their legacy parents; no semantic drift |
| **Constitution #2 (one-owner-per-truth)** | `pg_map_primary_type_to_mingla_category` makes Google's raw type data the single owner of category derivation |
| **Constitution #8 (subtract-before-adding)** | Legacy rules deactivated (not deleted — preserved for audit); seeding_category column dropped after all readers migrated |
| **Constitution #9 (no-fabricated-data)** | Helper function returns NULL when no match — never invents a category |
| **Constitution #13 (exclusion-consistency)** | rule_set entries cloned verbatim — same blocklist semantics in modern slugs as in legacy |

## NEW invariants established (DRAFT until tester PASS)

### I-CATEGORY-DERIVED-PARTIAL (DRAFT — partial flip post-ORCH-0700)

**Rule:** `place_pool.seeding_category` no longer exists. Admin per-place "primary category" is derived from `primary_type+types` via `pg_map_primary_type_to_mingla_category()` (DB) or `mapPrimaryTypeToMinglaCategory()` (TS). The `ai_categories` family remains until ORCH-0707 follow-up; full I-CATEGORY-DERIVED-FULL flips on that close.

**Enforcement:** Schema check (`information_schema.columns` should return zero rows for `seeding_category`); pg_proc check (no function references `seeding_category`).

**Test:** T-02.

**Status:** DRAFT until ORCH-0700 tester PASS; then ACTIVE-PARTIAL.

### I-RULES-MODERN-SLUG-COVERAGE (DRAFT)

**Rule:** Every Mingla category that has a chip on Discover MUST have a corresponding rule_set with `scope_value = chip_slug` (or `scope_value = signal_id` mapped via documented bridges) when admin has authored a strip/promotion/demotion rule for it. Legacy bundled-slug rules are deactivated and preserved for audit only — never re-activated.

**Enforcement:** CI check: parse `signal_definitions` and `rule_sets`, assert no scope_value equals a legacy bundled slug WHERE is_active=true.

**Test:** T-12 + a CI test added in the implementor pass.

**Status:** DRAFT until ORCH-0700 tester PASS; then ACTIVE.

# 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-01** | Live SQL — Movies signal cinemas-only | `SELECT primary_type, COUNT(*) FROM place_pool pp JOIN place_scores ps ON ps.place_id=pp.id WHERE ps.signal_id='movies' AND ps.score>=80 GROUP BY 1 ORDER BY 2 DESC;` | Only `movie_theater`, `drive_in`, and NULL primary_type (where types[] contains those) appear. ZERO `performing_arts_theater`, `concert_hall`, `amphitheatre`, `opera_house`, `auditorium`. | DB |
| **T-02** | Live SQL — column drop verification | `SELECT column_name FROM information_schema.columns WHERE table_name='place_pool' AND column_name IN ('seeding_category','ai_categories','ai_reason','ai_primary_identity','ai_confidence','ai_web_evidence');` | Returns 5 rows: ai_categories, ai_reason, ai_primary_identity, ai_confidence, ai_web_evidence. ZERO seeding_category. | DB |
| **T-03** | Live RPC test — admin matview consumers | Call each of the 10 admin RPCs reading `admin_place_pool_mv` (admin_place_category_breakdown, etc.) | All 10 return non-empty results without errors; primary_category field populated for typed places. | DB / RPC |
| **T-04** | Manual — Movies chip in Discover | Tap Movies chip in app, scroll deck | Only cinema venues appear. When local cinemas exhaust, deck goes thin/empty (intended). No theatre venues regardless of swipe count. | E2E mobile |
| **T-05** | Manual — Theatre chip unchanged | Tap Theatre chip in app | Theatre venues appear with the same content as pre-migration (signal v1.10.0 only changed movies, not theatre). | E2E mobile |
| **T-06** | Manual — Curated experience generation | Open curated tab, select Romantic experience | 3-stop curated card generates successfully. Each stop has a non-null placeType and non-zero estimatedDurationMinutes. | E2E mobile |
| **T-07** | Manual — Admin PlacePoolManagementPage | Open admin page; navigate to a place that previously had seeding_category set | Page loads without errors. "Google Category" badge displays the derived category (from matview's primary_category column). Edit form does NOT show seeding_category dropdown. | E2E admin |
| **T-08** | Manual — Admin Rules dashboard | Navigate to Rules Filter tab | 4 new SPLIT rules visible with is_active=true (MOVIES_BLOCKED_TYPES, THEATRE_BLOCKED_TYPES, BRUNCH_BLOCKED_TYPES, CASUAL_FOOD_BLOCKED_TYPES). 2 legacy rules visible with is_active=false (greyed/struck). | E2E admin |
| **T-09** | Live POST — replace-curated-stop modern slug | `POST https://....functions/v1/replace-curated-stop {"category":"movies", "currentStopId":"..."}` | HTTP 200 with valid alternatives. NOT HTTP 400 "Invalid category." | E2E backend |
| **T-10** | Pre-OTA mobile cutover | grep for legacy slug literals across `app-mobile/src/` (excluding tests/i18n historical) | Returns ZERO matches for `'brunch_lunch_casual'` and `'movies_theatre'` (excluding comments referencing ORCH IDs). Pre-OTA clients sending legacy chip slug get empty deck (acceptable per operator decision — adoption window is 14 days). | code grep |
| **T-11** | Live SQL — drift threshold | `SELECT (admin_rules_overview())->>'drift_status';` | Returns `'in_sync'` (active count = 20 ≥ 20 threshold). | DB / RPC |
| **T-12** | Live SQL — rule SPLIT verification | Query in §3.A.A3 verification block | 4 new rules with correct entry counts (41/41/36/36); 2 legacy with is_active=false; CASUAL_CHAIN_DEMOTION version_number=2 with `demote_to='casual_food'`. | DB |
| **T-13** | Edge case — A6 pre-check fail | If implementor accidentally runs A6 before A5 completes | A6 SQL fails fast with `RAISE EXCEPTION 'admin_place_pool_mv still references seeding_category — A5 migration must run first'`. | DB / safety |
| **T-14** | Edge case — empty deck on Movies | In a region with no cinemas (or after swiping all 7 Raleigh cinemas) | Discover Movies chip shows empty state correctly (no fabrication). Mobile UI handles `pool-empty` path. | E2E mobile |
| **T-15** | Regression — generate-curated-experiences uses ai_categories | Call generate-curated-experiences for First Date | Card generates with non-null `placeType` on each stop (ai_categories preserved this cycle, so the existing pp.ai_categories?.[0] derivation in line 435 still works). | E2E backend |
| **T-16** | Regression — get-person-hero-cards | Fetch a paired-person CardRow | Returns valid card composition. INTENT_CATEGORY_MAP changes (B3) preserve correct intent → category mapping. | E2E backend |
| **T-17** | Regression — admin-seed-places end-to-end | Trigger an admin seed batch for `movies` category in any city | seeding_batches row created with `seeding_category='movies'` (modern slug); place_pool inserts succeed (no longer write to seeding_category — column gone). | E2E admin |
| **T-18** | Regression — replace-curated-stop legacy slug | POST with `category: 'brunch_lunch_casual'` (legacy) | HTTP 400 with clear error "Invalid category" (legacy slug correctly rejected post-cleanup). | E2E backend |

# 7. Implementation order (sequencing)

**Strict ordering — phases cannot interleave.**

## Phase 1 — Movies signal v1.10.0 (user-visible fix; ships standalone if needed)

1. Apply migration `20260502000001_*` (signal v1.10.0 + flip current_version_id)
2. Run `run-signal-scorer` edge function for movies signal
3. Verify T-01 (cinemas-only) passes
4. Verify T-05 (theatre unchanged) passes

**This phase is shippable on its own** if operator wants to land the cinemas-only fix immediately and defer the cleanup phases. The remaining phases are admin-side hygiene with no user-facing impact.

## Phase 2 — DB structural cleanup

1. Apply migration `20260502000002_*` (helper function pg_map_primary_type_to_mingla_category)
2. Apply migration `20260502000003_*` (rule_sets SPLIT)
3. Apply migration `20260502000004_*` (admin RPC rewires + drift threshold)
4. Apply migration `20260502000005_*` (rebuild matview without seeding_category)
   - Pre-step: capture `pg_dump` backup of 10 admin RPCs
   - Verify CASCADE didn't drop any RPC
5. Apply migration `20260502000006_*` (DROP COLUMN seeding_category)
   - Pre-checks in the migration enforce A4+A5 must precede A6

## Phase 3 — Backend edge function edits

1. B1 — replace-curated-stop VALID_CATEGORIES
2. B3 — get-person-hero-cards INTENT_CATEGORY_MAP + CATEGORY_SLUG_TO_SIGNAL_ID + IIFE
3. B4 — admin-seed-map-strangers ALL_CATEGORIES
4. C1 — admin-refresh-places filter+display switch
5. C2 — admin-place-search remove seeding_category writes
6. D1 — seedingCategories.ts modern slugs
7. D2 — admin-seed-places remove seeding_category insert

(B2 is grouped with §H below — sunset-coordinated.)

## Phase 4 — Admin UI edits

1. E1 — SeedTab.jsx primary_type→slug map
2. E2 — categories.js display + colors
3. E3 — PlacePoolManagementPage.jsx (surgical edits)
4. E4 — Rules dashboard verification (no code change, just confirm)

## Phase 5 — Sunset-coordinated cleanup (single coordinated commit)

**MUST ship together — DO NOT split into multiple commits:**

1. B2 — discover-cards CATEGORY_TO_SIGNAL TRANSITIONAL removal
2. F1-F7 — mobile transitional alias removal (7 files)
3. G — i18n cleanup (56 files)
4. H1 — categoryPlaceTypes.ts TRANSITIONAL block removal
5. H2 — scorer.test.ts fixture updates
6. H3 — seedingCategories.test.ts fixture updates

**Why coordinated:** the discover-cards CATEGORY_TO_SIGNAL routes legacy slug requests via the TRANSITIONAL union mapping. Removing it without simultaneously removing the mobile-side legacy slug emissions (F1) leaves pre-OTA clients with empty decks. The whole pre-OTA bridge must come down at once.

## Phase 6 — Test + close

1. Run all 18 test cases (T-01 through T-18)
2. Tester documents results in test report
3. Orchestrator runs CLOSE protocol with DEPRECATION CLOSE EXTENSION (since A6 drops a production column):
   - Standard CLOSE steps 1-4 (artifact updates + commit message + EAS commands)
   - Extension steps 5a-5h (memory file flips, skill reviews, invariants, decision log, etc.)
   - Specifically: I-CATEGORY-DERIVED-PARTIAL flips DRAFT → ACTIVE-PARTIAL (full flip waits for ORCH-0707 follow-up)

# 8. Regression prevention

| Risk | Prevention |
|------|------------|
| Future migration drops a column without rebuilding dependent matview | Pre-check DO blocks in column-drop migrations (pattern shown in A6); CI test that parses `pg_matviews` against `information_schema.columns` |
| Admin RPC drifts from helper function (TS vs SQL definitions of mapPrimaryTypeToMinglaCategory) | Cycle-3 audit registered as discovery; ORCH should track auto-gen of pg_map_primary_type_to_mingla_category from TS source. For now: hand-mirror with code comments cross-referencing both files |
| Future agent re-introduces seeding_category column | New invariant I-CATEGORY-DERIVED-PARTIAL + DRAFT memory file (post-CLOSE protocol) flag any new column that holds Mingla category interpretation |
| Movies signal v1.10.0 over-tightens and breaks legitimate cinema-with-bar combos like Alamo Drafthouse | T-04 manual smoke checks Alamo Drafthouse; if it disappears, rollback v1.10.0 → v1.9.0 via single UPDATE on signal_definitions.current_version_id |
| Mobile pre-OTA clients on >14d-old builds get empty deck | Operator decision documented; sunset window enforced. If complaints surface, can re-add discover-cards routing aliases temporarily |
| Rule SPLIT migration partially fails halfway through | Wrapped in BEGIN/COMMIT; whole transaction rolls back on error. Append-only triggers prevent UPDATE-style corruption mid-transaction |
| admin_assign_place_category callers break (unaware admin RPC was dropped) | Grep for `admin_assign_place_category` across mingla-admin/src/ before A4 ships; remove any call sites or note as "removed feature" in admin UI |

# 9. Discoveries reference

From cycle-3 audit, this spec addresses:

| ID | Discovery | Status in this spec |
|----|-----------|---------------------|
| **D-NEW-1** | Signal slug ↔ chip slug mismatches (`fine_dining` vs `upscale_fine_dining`; `drinks` vs `drinks_and_music`) | DEFERRED to ORCH-0711 |
| **D-NEW-2** | Casual + Brunch ALSO leak bars (145 + 14 + 107) | DEFERRED to ORCH-0706 |
| **D-NEW-3** | Rules engine "designed but unwired" — NUKE-ALL viable | DEFERRED to ORCH-0705; this spec keeps engine via SPLIT |
| **D-NEW-4** | Admin UI has no rule-creation surface | OBSERVED only; no fix this cycle |
| **D-NEW-5** | admin_place_pool_mv `primary_category = COALESCE(ai_categories[1], 'uncategorized')` | ADDRESSED in A5 — derivation now layered: `COALESCE(pg_map_primary_type_to_mingla_category(...), ai_categories[1], 'uncategorized')`. Full removal of ai_categories[1] in ORCH-0707 follow-up |
| **D-NEW-6** | seedingCategories.ts continuously bleeds legacy slugs | ADDRESSED in D1 |
| **D-NEW-7** | mingla-admin SeedTab.jsx writes legacy slugs | ADDRESSED in E1 |
| **D-NEW-8** | replace-curated-stop rejects modern slugs | ADDRESSED in B1 |
| **D-NEW-9** | generate-curated-experiences fallback default `'brunch_lunch_casual'` | DEFERRED to ORCH-0707 (curated rewrite) |
| **D-NEW-10** | rules_runs zero runs since 2026-04-20 (12 days) | OBSERVED only; informs deferred ORCH-0705 NUKE-ALL decision |

# 10. Open questions

NONE — all 7 OQs from cycle-3 audit + the 4 OQ defaults from chat 2026-05-02 are operator-resolved before this spec was written.

# 11. Appendix A — Verbatim entries to clone in A3

## MOVIES_THEATRE_BLOCKED_TYPES → cloned to MOVIES_BLOCKED_TYPES + THEATRE_BLOCKED_TYPES (41 entries, position 1-41):

```
1: restaurant
2: fine_dining_restaurant
3: fast_food_restaurant
4: brunch_restaurant
5: breakfast_restaurant
6: bistro
7: diner
8: cafe
9: coffee_shop
10: tea_house
11: bakery
12: ice_cream_shop
13: bar
14: cocktail_bar
15: wine_bar
16: lounge_bar
17: pub
18: brewery
19: brewpub
20: beer_garden
21: sports_bar
22: hookah_bar
23: irish_pub
24: night_club
25: winery
26: bar_and_grill
27: gastropub
28: convenience_store
29: grocery_store
30: supermarket
31: store
32: department_store
33: shopping_mall
34: hotel
35: motel
36: gas_station
37: gym
38: fitness_center
39: amusement_center
40: bowling_alley
41: video_arcade
```

## BRUNCH_CASUAL_BLOCKED_TYPES → cloned to BRUNCH_BLOCKED_TYPES + CASUAL_FOOD_BLOCKED_TYPES (36 entries, position 1-36):

```
1: bar
2: cocktail_bar
3: wine_bar
4: lounge_bar
5: pub
6: brewery
7: brewpub
8: beer_garden
9: sports_bar
10: hookah_bar
11: irish_pub
12: night_club
13: winery
14: bar_and_grill
15: amusement_center
16: amusement_park
17: bowling_alley
18: video_arcade
19: go_karting_venue
20: paintball_center
21: miniature_golf_course
22: adventure_sports_center
23: casino
24: karaoke
25: community_center
26: sports_complex
27: sports_club
28: athletic_field
29: stadium
30: arena
31: swimming_pool
32: tobacco_shop
33: food_court
34: cafeteria
35: farm
36: ranch
```

The migration A3 cloning logic uses `INSERT ... SELECT` so these are reproduced verbatim — no manual entry typing required. Implementor verifies post-migration entry count = 41 + 41 + 36 + 36.

# 12. Appendix B — Constitutional compliance citations

| Constitution principle | How this spec satisfies |
|-----------------------|-------------------------|
| **#2 — One owner per truth** | After this spec: Mingla category is derived from Google's raw type data via single canonical function (`pg_map_primary_type_to_mingla_category` SQL + `mapPrimaryTypeToMinglaCategory` TS). `seeding_category` column eliminated as a competing storage layer. (`ai_categories` family follows in ORCH-0707.) |
| **#8 — Subtract before adding** | A6 drops `seeding_category` column AFTER all readers migrated (A4 + A5 + B/C/D/E phases). H1 removes TRANSITIONAL bundled-chip code AFTER mobile + admin migrate to modern slugs (F + G + B2). New code (helper function, SPLIT rules) accompanies the removal of legacy structures. |
| **#9 — No fabricated data** | `pg_map_primary_type_to_mingla_category` returns NULL when no match (never invents a category). Movies signal v1.10.0 returns honest empty deck when cinemas exhaust (Path 1 directive). |
| **#13 — Exclusion consistency** | The 4 new SPLIT rule_sets carry verbatim entries from their legacy parents. Same blocklist semantics; only the slug name differs. No new exclusion logic introduced. |

---

**END OF SPEC**
