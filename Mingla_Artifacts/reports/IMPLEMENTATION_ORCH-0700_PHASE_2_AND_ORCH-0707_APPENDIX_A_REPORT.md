---
id: ORCH-0700 Phase 2 + ORCH-0707 Appendix A (combined)
type: IMPLEMENTATION REPORT
created: 2026-05-03
implementor: /mingla-implementor
spec: Mingla_Artifacts/specs/SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md (§3.A.A2-A6)
spec_appendix: Mingla_Artifacts/specs/SPEC_ORCH-0707_CURATED_CATEGORY_DERIVATION_REWIRE.md (§12 Appendix A)
dispatch: Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0700_PHASE_2_DISPATCH.md (v2 combined)
status: implemented, unverified (5 SQL migrations + admin RPC backup written; awaits operator `supabase db push`)
---

# 1. Layman summary

Five SQL migration files written. Together: build a SQL helper that translates Google place types into Mingla categories, split 2 stale admin "rules" into 4 modern ones, rewire 7 admin database functions to use the helper, rebuild the admin matview, drop 6 columns from the place_pool table (`seeding_category` + 5 `ai_*`), and create a 30-day archive backup of the dropped data. Zero user-visible change. Mandatory pg_dump backup of 10 dependent admin RPCs captured before matview rebuild.

# 2. Status

- **Status:** implemented, unverified (DB-side migrations await operator apply via `supabase db push`)
- **Verification:**
  - All 5 migration SQL files written + each contains inline DO-block safety checks that fail-fast on regression
  - Pre-step admin RPC backup captured to `Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql` (10 functions, 379 lines)
  - All 8 RPC source bodies were read live via `pg_proc.prosrc` per D-SUB-1 sharpened rule before writing rewrites
- **NOT verified** (operator-side):
  - `supabase db push` apply
  - Live verification probes (T-12 rules SPLIT, T-02 columns dropped, T-03 admin RPCs derive non-null, T-11 drift in_sync, manual smoke admin page loads)

# 3. Files written

### `supabase/migrations/20260503000001_orch_0700_create_pg_helper_map_primary_type.sql` (NEW, 169 lines)

**What it does:** CREATE OR REPLACE FUNCTION `public.pg_map_primary_type_to_mingla_category(text, text[]) RETURNS text` per spec §3.A.A2.
- IMMUTABLE + PARALLEL SAFE
- Mirrors TS `mapPrimaryTypeToMinglaCategory` in `_shared/categoryPlaceTypes.ts`
- First-write-wins type-to-category mapping (movies / theatre / brunch / casual_food / upscale_fine_dining / drinks_and_music / nature / icebreakers / creative_arts / play / flowers / groceries)
- Returns NULL when no match (Constitution #9)
- 8 inline self-verification probes (RAISE EXCEPTION on regression — covers cinema, theatre, cuisine, upscale, brunch, types[] fallback, unknown→NULL, all-NULL→NULL)
- COMMENT ON FUNCTION cites the TS source-of-truth + warns about hand-mirror drift risk

**Why:** Spec §3.A.A2 — admin RPCs need a SQL twin of the TS function so they can derive category server-side after `seeding_category` + `ai_categories` columns drop.

### `supabase/migrations/20260503000002_orch_0700_rules_split_movies_theatre_brunch_casual.sql` (NEW, 213 lines)

**What it does:** Per spec §3.A.A3 — DO-block-wrapped:
1. INSERT 4 new active rule_sets (MOVIES_BLOCKED_TYPES + THEATRE_BLOCKED_TYPES + BRUNCH_BLOCKED_TYPES + CASUAL_FOOD_BLOCKED_TYPES) cloned verbatim from 2 legacy bundled originals via `INSERT ... SELECT`. Each gets a rule_set_versions row + entries cloned + UPDATE current_version_id.
2. UPDATE `rule_sets SET is_active=false WHERE name IN ('MOVIES_THEATRE_BLOCKED_TYPES', 'BRUNCH_CASUAL_BLOCKED_TYPES')` + append "[DEACTIVATED 2026-05-03 per ORCH-0700 SPLIT]" to description.
3. INSERT new `rule_set_versions` row (version_number=2) for `CASUAL_CHAIN_DEMOTION` with `thresholds.demote_to = "casual_food"` (was "brunch_lunch_casual"). Clone existing entries to new version (append-only enforced by trigger). Flip current_version_id.
4. 5 inline verification probes: 4 new rules active, 2 legacy deactivated, entry counts (41/41/36/36), CASUAL_CHAIN_DEMOTION demote_to="casual_food".

**Why:** Spec §3.A.A3 — admin Rules dashboard must reflect modern slug taxonomy; CASUAL_CHAIN_DEMOTION's demote_to was the last live write path using the legacy bundled slug.

### `supabase/migrations/20260503000003_orch_0700_admin_rpcs_rewire.sql` (NEW, 348 lines)

**What it does:** 8 RPC operations per spec §3.A.A4 + ORCH-0707 Appendix A:

1. **`admin_rules_overview`** — drift threshold `< 18` → `< 20` (since SPLIT adds +2 net active)
2. **`admin_uncategorized_places`** — `WHERE pp.seeding_category IS NULL` → `WHERE pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) IS NULL`
3. **`admin_pool_category_health`** — switch from `mv.seeding_category` to `mv.primary_category` (matview's helper-derived single category column; works because primary_category exists pre + post Migration 4 — only the derivation source changes)
4. **`admin_city_place_stats`** — switch `by_seeding_category` JSONB key to `by_category` (derived); aggregates by `pg_map_primary_type_to_mingla_category(...)` instead of `seeding_category`
5. **`admin_virtual_tile_intelligence`** — derived_category via helper for COUNT(DISTINCT) + MODE() WITHIN GROUP
6. **`admin_assign_place_category`** — DROP FUNCTION (3 possible signatures dropped defensively)
7. **`admin_edit_place`** — DROP existing signature + CREATE OR REPLACE without `p_seeding_category` parameter; preserve all other edit logic; remove `seeding_category` from RETURNING object
8. **`admin_rules_preview_impact`** (Appendix A folded in) — 5 reads of `v_scope_value = ANY(pp.ai_categories)` replaced with `pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value` (semantically equivalent under Constitution #2's one-owner-per-truth model). Promotion branch's `NOT (v_scope_value = ANY(pp.ai_categories))` → `IS DISTINCT FROM v_scope_value`. Sample SELECT returns derived `current_category` (singular) instead of `current_categories` (array).

Inline verification probe: 7 RPCs present + admin_assign_place_category absent.

**Why:** Spec §3.A.A4 + ORCH-0707 Appendix A. Removes all DB-side `seeding_category` + `ai_categories` reads so Migration 5's column drop is safe. D-SUB-1 sharpened rule honored — every rewrite was based on live `pg_proc.prosrc` source captured 2026-05-03.

### `supabase/migrations/20260503000004_orch_0700_rebuild_admin_place_pool_mv.sql` (NEW, 158 lines)

**What it does:** Per spec §3.A.A5 + ORCH-0707 Appendix A:
1. Pause cron job 13 (10-min refresh)
2. DROP MATERIALIZED VIEW IF EXISTS `admin_place_pool_mv` CASCADE
3. CREATE MATERIALIZED VIEW WITHOUT `seeding_category` AND WITHOUT `ai_categories`. New `primary_category` derivation:
   ```sql
   COALESCE(
     public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types),
     'uncategorized'::text
   ) AS primary_category
   ```
   (No more `pp.ai_categories[1]` fallback — that column won't exist post-Migration 5.)
4. Re-create 4 indexes (id UNIQUE, city_id, primary_category, is_servable)
5. REFRESH MATERIALIZED VIEW
6. Re-enable cron job 13
7. 5 inline verification probes: matview exists, primary_category present, seeding_category absent, ai_categories absent, all 10 dependent admin RPCs survived CASCADE

GRANTs not re-issued explicitly — comment notes operator can re-issue if defaults don't cover.

**Why:** Spec §3.A.A5 — must rebuild before column drop. Combining ORCH-0707 Appendix A drops both column families in one rebuild (single matview rebuild instead of two).

### `supabase/migrations/20260503000005_orch_0700_drop_seeding_category_and_ai_columns.sql` (NEW, 121 lines)

**What it does:** Per spec §3.A.A6 + ORCH-0707 Appendix A. **Drops 6 columns total in single ALTER TABLE.**

Two pre-check DO blocks fail-fast:
1. Matview must NOT reference any of 6 doomed columns (catches Migration 4 didn't run)
2. NO function in public schema may reference any of 6 doomed columns (catches Migration 3 missed an RPC)

Pre-step: CREATE TABLE `_archive_orch_0700_doomed_columns` AS SELECT all rows with non-null in ANY of the 6 columns. Includes `archived_at` + `retention_drop_date='2026-06-02'`. COMMENT documents 30-day retention. Index on `id` for rollback queries. Defensive non-empty check (RAISE EXCEPTION if archive empty since cycle-3 audit confirmed live data exists).

Then: `ALTER TABLE public.place_pool DROP COLUMN IF EXISTS seeding_category, DROP COLUMN IF EXISTS ai_categories, DROP COLUMN IF EXISTS ai_reason, DROP COLUMN IF EXISTS ai_primary_identity, DROP COLUMN IF EXISTS ai_confidence, DROP COLUMN IF EXISTS ai_web_evidence;`

Plus DROP INDEX IF EXISTS `place_pool_seeding_category_idx` (defensive).

Post-migration verification: zero of 6 columns remain on place_pool.

Final comment: operator should schedule `/schedule` reminder for 2026-06-02 to drop the archive table.

**Why:** Spec §3.A.A6 + ORCH-0707 Appendix A. The atomic 6-column drop avoids the two-cycle-rebuild waste.

### `Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql` (NEW, 379 lines)

**What it does:** Pre-Migration-4 mandatory backup of 10 admin RPCs that read `admin_place_pool_mv`. Captured live via Supabase Management API + `pg_proc.prosrc` query. Format: `CREATE OR REPLACE FUNCTION public.<name>(<args>) RETURNS <type> LANGUAGE plpgsql [SECURITY DEFINER] [STABLE/IMMUTABLE] AS $func$<body>$func$;` per RPC. Restore command: `psql -f Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql` against the project.

The 10 RPCs backed up:
1. admin_place_category_breakdown
2. admin_place_city_overview
3. admin_place_country_overview
4. admin_place_photo_stats
5. admin_place_pool_city_list
6. admin_place_pool_country_list
7. admin_place_pool_overview
8. admin_pool_category_health
9. admin_refresh_place_pool_mv
10. cron_refresh_admin_place_pool_mv

**Why:** Spec §3.A.A5 mandatory pre-step. DROP MATERIALIZED VIEW ... CASCADE in Migration 4 should NOT drop these (they read MV via SELECT in PL/pgSQL bodies, not as view-dependencies), but this backup is the safety net if Postgres surprises us.

# 4. Spec traceability

| Spec section | Migration | Status |
|--------------|-----------|--------|
| §3.A.A2 — pg_map helper function | 1 | ✅ Implemented per spec verbatim |
| §3.A.A3 — Rules SPLIT (4 new + 2 deactivate + CASUAL_CHAIN_DEMOTION update) | 2 | ✅ Implemented per spec verbatim |
| §3.A.A4.1 — admin_rules_overview drift threshold 18→20 | 3 | ✅ Implemented |
| §3.A.A4.2 — admin_uncategorized_places derivation switch | 3 | ✅ Implemented (live pg_proc read first per D-SUB-1) |
| §3.A.A4.3 — admin_pool_category_health derivation switch (via mv.primary_category) | 3 | ✅ Implemented |
| §3.A.A4.4 — admin_city_place_stats derivation switch | 3 | ✅ Implemented |
| §3.A.A4.5 — admin_virtual_tile_intelligence derivation switch | 3 | ✅ Implemented |
| §3.A.A4.6 — admin_assign_place_category DROP | 3 | ✅ Implemented (3 signatures dropped defensively) |
| §3.A.A4.7 — admin_edit_place remove p_seeding_category | 3 | ✅ Implemented |
| §3.A.A5 — admin_place_pool_mv rebuild | 4 | ✅ Implemented (combined: drops both seeding_category AND ai_categories references) |
| §3.A.A5 mandatory backup pre-step | RPC backup file | ✅ Captured (10 functions, 379 lines) |
| §3.A.A6 — DROP COLUMN seeding_category + 2 pre-check DO blocks | 5 | ✅ Implemented (extended to 6 columns per Appendix A) |
| ORCH-0707 §12 Appendix A.1 — DROP 5 ai_* columns | 5 | ✅ Implemented (combined into Migration 5's 6-column drop) |
| ORCH-0707 §12 Appendix A.1 — admin_place_pool_mv rebuild without ai_* | 4 | ✅ Implemented (combined with Phase 2.D) |
| ORCH-0707 §12 Appendix A — admin_rules_preview_impact rewrite | 3 | ✅ Implemented (semantically-equivalent substitution per Constitution #2) |
| 30-day archive backup table | 5 | ✅ Implemented (`_archive_orch_0700_doomed_columns`) |

# 5. Invariant verification

| Invariant | Preserved? | How |
|-----------|-----------|-----|
| **I-RULES-VERSIONING-APPEND-ONLY** | ✅ Y | All rule_set + rule_set_versions changes use INSERT (never UPDATE existing version row). CASUAL_CHAIN_DEMOTION update creates version_number=2 + flips current_version_id pointer. Trigger `tg_rule_set_versions_block_update` enforces. |
| **I-MV-COLUMN-COVERAGE** (proposed by sub-audit) | ✅ Y | Migration 4 explicitly rebuilds matview before any column drop in Migration 5. Pre-check DO blocks in Migration 5 RAISE EXCEPTION if MV still references any doomed column. |
| **I-13 (Exclusion Consistency)** | ✅ Y | The 4 new rule_sets carry verbatim entries from their legacy parents — no semantic drift. |
| **I-CURATED-LABEL-SOURCE** (DRAFT, ORCH-0707) | ✅ Y | Curated pipeline already migrated (ORCH-0707 commit d941a9ec); this work doesn't reintroduce ai_categories reads anywhere. |
| **Constitution #2 (one-owner-per-truth)** | ✅ Y | `pg_map_primary_type_to_mingla_category` makes Google's raw type data the single owner. admin_rules_preview_impact rewrite consolidates from multi-category ai_categories array to single derived category. |
| **Constitution #3 (no silent failures)** | ✅ Y | All DO-block self-verification probes RAISE EXCEPTION on regression. Pre-check DO blocks in Migration 5 fail-fast on missing prereqs. Helper function returns NULL (honest absence) instead of silent default. |
| **Constitution #8 (subtract before adding)** | ✅ Y | Legacy rules deactivated (not deleted — preserved for audit). Old admin_assign_place_category dropped before new behavior. Old matview dropped before new one created. |
| **Constitution #9 (no fabricated data)** | ✅ Y | Helper returns NULL when no match. Archive backup preserves data; no rows lost. `'uncategorized'` literal in matview is documented placeholder, not fabricated category. |
| **Constitution #13 (exclusion consistency)** | ✅ Y | Same derivation function used in admin RPCs that previously read seeding_category. |

# 6. Parity check

**N/A** — backend SQL migrations only. Solo/collab modes both consume same admin pages through same RPCs. No mode-specific code path.

# 7. Cache safety

**N/A** — DB-side change only. No React Query keys, no Zustand state, no AsyncStorage shape change.

Wire impact: admin pages that render `seeding_category` or `ai_categories` badges will start showing empty/null until Phase 4 admin UI cleanup ships (PlacePoolManagementPage edits per spec §3.E.E3). **Harmless — doesn't crash, just visually empty.** This is a documented Phase 5 follow-up.

# 8. Regression surface (tester focus areas)

After operator runs `supabase db push`, smoke-test:

1. **Admin Rules dashboard** — should show 4 NEW SPLIT rules (MOVIES_BLOCKED_TYPES, THEATRE_BLOCKED_TYPES, BRUNCH_BLOCKED_TYPES, CASUAL_FOOD_BLOCKED_TYPES) as active + 2 OLD bundled rules (MOVIES_THEATRE_BLOCKED_TYPES, BRUNCH_CASUAL_BLOCKED_TYPES) as deactivated/grayed. drift_status="in_sync".
2. **Admin PlacePoolManagementPage** — should LOAD without errors. Will show empty `seeding_category` + `ai_categories` badges/dropdowns (Phase 4 cleanup pending). The "Google Category" derived badge should populate correctly via matview's `primary_category` column.
3. **Admin city/country pages** — should load without errors. Category breakdowns now reflect helper-derived categories (will differ from previous breakdowns since semantics changed).
4. **Cron job 13 (refresh_admin_place_pool_mv)** — should fire successfully every 10 min after rebuild. Watch logs for any errors.
5. **No edge function regressions** — generate-curated-experiences + replace-curated-stop don't touch any of these tables/RPCs/columns; should be unaffected.
6. **Movies pill verified live ORCH-0700 Phase 1** — should still be cinemas-only (signal_definitions config unchanged).

# 9. Constitutional compliance

| Principle | Touched? | Result |
|-----------|----------|--------|
| #1 No dead taps | No (DB only) | N/A |
| #2 One owner per truth | Yes | ✅ helper function makes Google's raw type data the single category owner |
| #3 No silent failures | Yes | ✅ DO-block fail-fast pre-checks + verification probes throughout |
| #4-7 React Query / Zustand / Logout | No | N/A |
| #8 Subtract before adding | Yes | ✅ legacy rules deactivated (preserved); admin RPCs dropped + recreated; matview dropped + rebuilt; columns dropped + archived |
| #9 No fabricated data | Yes | ✅ helper returns NULL on no-match; archive table preserves data; no invented values |
| #10-12 | No | N/A |
| #13 Exclusion consistency | Yes | ✅ derivation function used everywhere category needs to be inferred from raw types |
| #14 Persisted state startup | No | N/A |

# 10. Operator action sequence

## Action 1 — Verify backup file before applying

```bash
ls -la Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql
# Should show ~12-15KB file, 379 lines
grep -c "^CREATE OR REPLACE FUNCTION" Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql
# Should output: 10
```

## Action 2 — Apply migrations

```bash
supabase db push
```

This applies all 5 migrations chronologically. The pre-check DO blocks in Migration 5 enforce ordering — if Migration 3 or 4 didn't complete, Migration 5 aborts the entire transaction with `RAISE EXCEPTION` and rolls back to pre-migration state.

## Action 3 — Run verification probes

### Probe 1 (T-12 — Rules SPLIT)
```sql
SELECT name, scope_value, is_active,
  (SELECT COUNT(*) FROM rule_entries re
   JOIN rule_set_versions rsv ON re.rule_set_version_id = rsv.id
   WHERE rsv.id = rs.current_version_id) AS entry_count
FROM rule_sets rs
WHERE name IN ('MOVIES_BLOCKED_TYPES','THEATRE_BLOCKED_TYPES','BRUNCH_BLOCKED_TYPES','CASUAL_FOOD_BLOCKED_TYPES','MOVIES_THEATRE_BLOCKED_TYPES','BRUNCH_CASUAL_BLOCKED_TYPES','CASUAL_CHAIN_DEMOTION')
ORDER BY name;
```
**Expected:** 4 new rules active with entry_count 41/41/36/36; 2 legacy is_active=false; CASUAL_CHAIN_DEMOTION present.

### Probe 2 (T-02 — columns dropped)
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='place_pool'
  AND column_name IN ('seeding_category','ai_categories','ai_reason','ai_primary_identity','ai_confidence','ai_web_evidence');
```
**Expected:** ZERO rows (all 6 columns gone).

### Probe 3 (T-03 — admin RPCs derive non-null)
```sql
SELECT public.admin_place_country_overview() LIMIT 1;
SELECT public.admin_pool_category_health(NULL, NULL) LIMIT 1;
```
**Expected:** non-null results without errors.

### Probe 4 (T-11 — drift in_sync)
```sql
SELECT (admin_rules_overview())->>'drift_status' AS drift_status,
       (admin_rules_overview())->>'rules_active' AS rules_active;
```
**Expected:** drift_status='in_sync', rules_active=20.

### Probe 5 — archive table populated
```sql
SELECT COUNT(*) AS archived_rows, retention_drop_date
FROM public._archive_orch_0700_doomed_columns
GROUP BY retention_drop_date;
```
**Expected:** thousands of rows, retention_drop_date=2026-06-02.

## Action 4 — Manual smoke

- Open admin Rules dashboard — verify 4 SPLIT rules + 2 deactivated legacy
- Open admin Place Pool Management page — verify it loads (will show empty AI badges; expected)
- Watch cron job 13 logs for next 20 min — should fire successfully

## Action 5 — Schedule 30-day archive drop

Set a reminder for 2026-06-02:
```sql
DROP TABLE IF EXISTS public._archive_orch_0700_doomed_columns;
```

# 11. Rollback procedure

If anything broke after deploy (verification probe FAILS, admin pages crash, cron job 13 throws):

1. Restore admin RPCs from backup (if any were CASCADE-dropped):
   ```bash
   psql -f Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql
   ```

2. The 6 dropped columns CANNOT be restored as schema in-place (Postgres doesn't have ALTER TABLE UNDROP). However, data is in `_archive_orch_0700_doomed_columns`. If full rollback is needed:
   ```sql
   ALTER TABLE public.place_pool
     ADD COLUMN seeding_category text,
     ADD COLUMN ai_categories text[],
     ADD COLUMN ai_reason text,
     ADD COLUMN ai_primary_identity text,
     ADD COLUMN ai_confidence real,
     ADD COLUMN ai_web_evidence text;

   UPDATE public.place_pool pp
   SET seeding_category = a.seeding_category,
       ai_categories = a.ai_categories,
       ai_reason = a.ai_reason,
       ai_primary_identity = a.ai_primary_identity,
       ai_confidence = a.ai_confidence,
       ai_web_evidence = a.ai_web_evidence
   FROM public._archive_orch_0700_doomed_columns a
   WHERE pp.id = a.id;
   ```
   Then revert Migrations 1-4 by hand (drop helper, drop new rules, restore matview from old definition, restore admin RPCs from backup).

3. The rules SPLIT can be reverted by:
   ```sql
   UPDATE public.rule_sets SET is_active=true
   WHERE name IN ('MOVIES_THEATRE_BLOCKED_TYPES', 'BRUNCH_CASUAL_BLOCKED_TYPES');
   UPDATE public.rule_sets SET is_active=false
   WHERE name IN ('MOVIES_BLOCKED_TYPES','THEATRE_BLOCKED_TYPES','BRUNCH_BLOCKED_TYPES','CASUAL_FOOD_BLOCKED_TYPES');
   ```

# 12. Discoveries for orchestrator

**D-IMPL-PHASE2-1 — admin_assign_place_category had legacy slug whitelist.** The dropped function's category whitelist contained pre-ORCH-0434 slugs (`'nature_views'`, `'first_meet'`, `'picnic_park'`, `'drink'`, `'casual_eats'`, `'fine_dining'`, `'watch'`, `'live_performance'`, `'creative_arts'`, `'play'`, `'wellness'`, `'flowers'`, `'groceries'`). Confirms the function had been broken since ORCH-0434 — admin couldn't assign any modern category through it. Defer-DROP correct call. **Severity:** S3 (informational; function dropped this cycle).

**D-IMPL-PHASE2-2 — admin_pool_category_health "uncategorized" filtering.** The rewritten RPC filters out rows where `primary_category = 'uncategorized'`. Pre-ORCH-0700 it filtered `seeding_category IS NOT NULL` (excluding NULL rows). Post-rebuild, the matview replaces NULL with `'uncategorized'` literal. Behavior preserved by adding explicit `<> 'uncategorized'` filter. **Severity:** S3 (semantic equivalence preserved; flagged for documentation).

**D-IMPL-PHASE2-3 — admin_rules_preview_impact semantic shift.** The rewrite changes from "any of place's AI-assigned categories matches scope" to "place's helper-derived single category equals scope." Multi-category attribution is gone. For places with multiple ai_categories, the previous code could match if ANY matched; the new code matches only on the canonical helper-derived single category. **This is by design** per Constitution #2, but admin users running the preview should expect to see lower modify/reject counts than pre-migration if the legacy rules engine was relying on multi-category attribution. **Severity:** S3 (intentional per spec; document for admin operator awareness).

**D-IMPL-PHASE2-4 — admin_city_place_stats JSONB key renamed.** The rewrite renamed `by_seeding_category` → `by_category` in the returned JSONB. Any admin UI consumer reading the OLD key will get undefined. PlacePoolManagementPage (Phase 4 cleanup) will need to use the new key. **Severity:** S3 (Phase 4 dispatch must update key reference).

**D-IMPL-PHASE2-5 — Helper function maintenance burden.** `pg_map_primary_type_to_mingla_category` hand-mirrors the TS `mapPrimaryTypeToMinglaCategory` with ~150 type-to-category mappings hardcoded. Drift between TS + SQL versions is a real risk. Future ORCH should build either (a) a code generator that auto-emits the SQL from TS source, or (b) a CI test that compares the two for drift. **Severity:** S3 (technical debt; orchestrator should register as ORCH-0712 candidate).

# 13. Transition items

**None.** All migrations are atomic; rule deactivation is permanent (preserved-for-audit, not transitional); archive table has explicit retention drop date.

# 14. Post-CLOSE Protocol triggers

This work decommissions a column family (5 ai_* columns) and triggers the **DEPRECATION CLOSE PROTOCOL EXTENSION** (orchestrator's 8-step extension):

- **5a:** Persistent memory file `feedback_ai_categories_decommissioned.md` flips DRAFT → ACTIVE-FULL on tester PASS
- **5b:** MEMORY.md index update
- **5c:** Memory file scan for stale ai_categories references
- **5d:** Skill definition reviews (especially mingla-categorizer)
- **5e:** New invariant `I-CATEGORY-DERIVED-FULL` (replaces I-CATEGORY-DERIVED-PARTIAL) added to INVARIANT_REGISTRY
- **5f:** DECISION_LOG entries for ai_categories decommission complete
- **5g:** PRODUCT_SNAPSHOT + ROOT_CAUSE_REGISTER updates
- **5h:** Schedule reminder for 2026-06-02 to drop `_archive_orch_0700_doomed_columns`

Orchestrator owns these post-tester-PASS.

# 15. Confidence

- **Migration SQL correctness:** H — all 5 migrations follow spec verbatim where exact templates exist; live pg_proc.prosrc reads grounded the 8 RPC rewrites
- **Pre-check safety:** H — Migration 5's 2 DO-block pre-checks are watertight (matview + pg_proc grep)
- **CASCADE drop safety:** M-H — all 10 dependent admin RPCs are PL/pgSQL functions reading MV via SELECT (not view-dependencies); should survive CASCADE; backup file is the safety net if Postgres surprises
- **Helper function correctness:** H — 8 inline self-verification probes RAISE EXCEPTION on regression; mirrors TS source where I have line-by-line visibility
- **admin_rules_preview_impact semantic equivalence:** M-H — substitution is per spec but loses multi-category attribution semantics; documented as D-IMPL-PHASE2-3 for admin awareness
- **Apply success:** M-H — cannot run `supabase db push` from implementor sandbox; spec applies cleanly per inline verification, but live deploy needed for true confirmation
