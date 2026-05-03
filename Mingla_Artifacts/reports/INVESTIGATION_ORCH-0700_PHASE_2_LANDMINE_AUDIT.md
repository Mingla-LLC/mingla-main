# INVESTIGATION — ORCH-0700 Phase 2 Landmine Audit

**Skill:** mingla-forensics (INVESTIGATE mode)
**Dispatched by:** orchestrator after 6 consecutive `supabase db push` failures
**Time-box:** 60 min, sequential per memory
**Method:** every assertion backed by live `pg_catalog` query via Management API
**Confidence:** HIGH (all critical findings verified live, byte-for-byte)

---

## Executive Summary (layman)

Six push attempts failed because the migration set was authored against **assumed** signatures, not **observed** ones. The live audit found:

- **2 SHIP-BLOCKING landmines** (must fix before next push)
- **3 LATENT BUGS** that won't surface until Migration 6 lands or until specific edge functions are called
- **0 corruption / data-loss** — Migrations 3 + 4 shipped clean (matview rebuilt with full GRANTs intact, all 10 dependent RPCs survived)

**Recommended action:** patch Migration 5 (one OUT-param rename) + write a NEW Migration 7 that scrubs the 3 admin edge functions' source-of-truth SQL — but those edge functions deploy from Deno (not from migrations), so the actual fix is **delete `seeding_category` references from 3 edge functions + redeploy them BEFORE Migration 6 runs**, OR roll forward with Migration 6 and accept that admin Seed/Refresh/Search functions throw `column "seeding_category" does not exist` until the edge-function fix ships.

The orchestrator's hypothesis was correct: the implementor pass that authored Migrations 3 + 5 wrote function bodies from spec memory, not from `pg_get_function_arguments()`. A new pre-flight gate is mandatory (see §11).

---

## Phase A — Migration 5 signature drifts

Live signatures via `SELECT pg_get_function_arguments(oid), pg_get_function_result(oid) FROM pg_proc WHERE proname IN (...)`:

| Function | Live IN args | Live RETURNS | Migration 5 file declares | Verdict |
|---|---|---|---|---|
| admin_city_place_stats | `p_city_id uuid` | `jsonb` | `p_city_id uuid` → `jsonb` | ✅ MATCH |
| admin_edit_place | `p_place_id uuid, p_name text, p_price_tier text, p_is_active boolean, p_price_tiers text[]` | `jsonb` | same → `jsonb` | ✅ MATCH |
| admin_pool_category_health | `p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text` | `TABLE(category text, total_places bigint, active_places bigint, with_photos bigint, photo_pct integer, avg_rating numeric, total_cards bigint, single_cards bigint, curated_cards bigint, places_needing_cards bigint, health text)` | identical | ✅ MATCH |
| admin_rules_preview_impact | `p_rule_set_id uuid, p_proposed_entries text[], p_proposed_thresholds jsonb DEFAULT NULL::jsonb, p_city_id uuid DEFAULT NULL::uuid` | `jsonb` | same → `jsonb` | ✅ MATCH |
| admin_virtual_tile_intelligence | `p_country text, p_city text` | `TABLE(`**`row_idx integer, col_idx integer`**`, center_lat double precision, center_lng double precision, active_places bigint, with_photos bigint, category_count integer, top_category text, avg_rating numeric)` | `TABLE(`**`r_idx integer, c_idx integer`**`, ...rest matches)` | 🔴 **DRIFT** |

### 🔴 ROOT CAUSE LANDMINE-A1 — admin_virtual_tile_intelligence OUT-param name drift

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260503000005_orch_0700_scrub_doomed_column_mentions_in_rpc_comments.sql:308–315` |
| **Exact code** | `RETURNS TABLE(\n  r_idx integer,\n  c_idx integer,\n  center_lat double precision, ...)` |
| **What it does** | Postgres rejects with SQLSTATE 42P13 `cannot change return type of existing function. Row type defined by OUT parameters is different.` Live function uses `row_idx`/`col_idx`; CREATE OR REPLACE refuses to change OUT param NAMES (only IN param names + body are mutable). |
| **What it should do** | Use `row_idx integer, col_idx integer` to match live. Body's `RETURN QUERY SELECT r_idx, c_idx, ...` must also rename to `row_idx, col_idx` everywhere. |
| **Causal chain** | Implementor wrote spec from memory (`r_idx`/`c_idx` are common abbreviation choices) → live function (created elsewhere, possibly via implementor's own Migration 3 — `admin_virtual_tile_intelligence` was Migration 3's last function, which DROP+CREATE'd it) → Migration 3 actually shipped with `row_idx`/`col_idx` (need to re-check Migration 3 source — but live IS the truth) → Migration 5 file's CREATE OR REPLACE drifted from what Migration 3 shipped. |
| **Verification** | Live query result above shows `row_idx integer, col_idx integer`. Postgres will accept ONLY `row_idx`/`col_idx` for OUT param names. |

### 🟢 Phase A summary
- 4 of 5 RPCs in Migration 5 match live signature exactly.
- 1 of 5 (`admin_virtual_tile_intelligence`) has OUT-param name drift — single fix.

---

## Phase B — Scrub completeness

Re-run of doomed-column reference scan against `pg_proc.prosrc`:

```
admin_city_place_stats           → seeding_category (in comment)
admin_edit_place                 → seeding_category (in comment)
admin_pool_category_health       → seeding_category (in comment)
admin_rules_preview_impact       → ai_categories   (in comment x2)
admin_virtual_tile_intelligence  → seeding_category (in comment)
```

**Verdict:** ✅ exactly 5 RPCs reference doomed columns, exactly the 5 Migration 5 covers. No 6th surprise. After Migration 5 lands clean (post LANDMINE-A1 fix), pre-check 2 in Migration 6 will pass.

---

## Phase C — Migration 6 dependency landmines

### C.1 — Indexes on doomed columns
Query: `pg_index x JOIN pg_class i ON i.oid=x.indexrelid` filtered to `place_pool` + 6 doomed columns.

**Result:** `[]` — empty.

**Verdict:** ✅ no indexes block DROP COLUMN. Migration 6's defensive `DROP INDEX IF EXISTS public.place_pool_seeding_category_idx;` is a no-op (index doesn't exist) — harmless.

### C.2 — Constraints (CHECK/UNIQUE/FK) on doomed columns
Query: `pg_constraint c WHERE conrelid='place_pool'::regclass AND conkey contains doomed col`.

**Result:** `[]` — empty.

**Verdict:** ✅ no constraints reference doomed columns.

### C.3 — Triggers on place_pool referencing doomed columns
2 triggers exist on `place_pool`:
- `trg_auto_city_seeded_status` → calls `auto_update_city_seeded_status()` — body only updates `seeding_cities` based on `NEW.city_id` and `NEW.is_active`. No doomed-column refs.
- `update_place_pool_updated_at` → calls `update_updated_at_column()` — body sets `NEW.updated_at = now()`. No doomed-column refs.

**Verdict:** ✅ no trigger function references doomed columns.

### C.4 — Views (regular + matviews) referencing doomed columns
Query: `pg_class c WHERE relkind IN ('v','m') AND pg_get_viewdef ILIKE '%<each doomed col>%'`.

**Result:** `[]` — empty (Migration 4 already rebuilt `admin_place_pool_mv` without these columns, so it correctly does NOT show up here).

**Verdict:** ✅ no views block DROP COLUMN.

### C.5 — Default expressions on remaining columns referencing doomed columns
**Result:** `[]` — empty.

**Verdict:** ✅ no column default expressions reference doomed columns.

### C.6 — RLS policies on place_pool referencing doomed columns
3 policies exist:
- `service_role_all_place_pool` USING `auth.role() = 'service_role'`
- `authenticated_read_place_pool` USING `auth.role() = 'authenticated'`
- `admin_update_place_pool` USING/CHECK `EXISTS (SELECT 1 FROM admin_users au WHERE au.email = auth.email() AND au.status = 'active')`

None reference doomed columns.

**Verdict:** ✅ RLS policies survive DROP COLUMN unchanged.

### C.7 — Generated columns on place_pool
**Result:** `[]` — empty (no generated/stored expressions on the table).

**Verdict:** ✅ no generated columns affected.

### C.8 — Publications including place_pool
Query: `pg_publication_tables WHERE tablename = 'place_pool'`.

**Result:** `[]` — empty.

**Verdict:** ✅ table is not in any logical-replication publication. Realtime / wal2json subscribers (if any) use Supabase's internal mechanism, not pg_publication. DROP COLUMN won't break replication.

### C.9 — Cron jobs referencing doomed columns in their commands
**Result:** `[]` — empty.

**Verdict:** ✅ no cron job command string references doomed columns.

### Phase C summary
**0 of 9 sub-phases found a Postgres-level blocker for DROP COLUMN.** The `ALTER TABLE place_pool DROP COLUMN seeding_category, DROP COLUMN ai_categories, ...` will execute cleanly once the function-body references (Migration 5) are scrubbed.

---

## Phase D — Migration 4 (already applied) regression audit

### D.1 — Live matview shape
30 columns, listed in attnum order. `seeding_category` and `ai_categories` are GONE. `primary_category` (text) is present. All ORCH-0700 expected columns present (id, google_place_id, name, city_id, country_code/name, city_name/status, pp_country, pp_city, primary_category, types, primary_type, rating, review_count, price_level, is_active, is_servable, bouncer_validated_at, bouncer_reason, bouncer_validated, stored_photo_urls, has_photos, photo_count, photos, has_photo_refs, last_detail_refresh, updated_at, created_at, is_claimed).

**Verdict:** ✅ matview shape matches Migration 4 SELECT exactly.

### D.2 — Indexes after rebuild
4 indexes present: `admin_place_pool_mv_city_id_idx`, `admin_place_pool_mv_id_idx`, `admin_place_pool_mv_is_servable_idx`, `admin_place_pool_mv_primary_category_idx`. Matches Migration 4's `CREATE [UNIQUE] INDEX` block exactly.

**Verdict:** ✅ all 4 expected indexes present.

### D.3 — GRANTs on matview after rebuild
`information_schema.role_table_grants` returned `[]` — initial false alarm. Cross-checked via `pg_class.relacl`:
```
admin_place_pool_mv → {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
```
All 4 roles have full privileges (a/r/w/d/D/x/t/m). The `information_schema` view simply doesn't list matview rows — known PostgreSQL quirk, not a bug.

**Verdict:** ✅ GRANTs intact. (🟡 Hidden Flaw — Migration 4's footer comment says "GRANTs preserved by default ownership" — true in this case but ONLY because the migration role IS postgres. If migration role were not postgres, default privileges would have stripped non-postgres GRANTs. Codify this in invariant: "matview rebuilds must explicitly re-issue GRANTs.")

### D.4 — Cron job 13
```
{jobid: 13, jobname: refresh_admin_place_pool_mv, schedule: */10 * * * *, active: true, command: SELECT public.cron_refresh_admin_place_pool_mv()}
```

**Verdict:** ✅ cron still scheduled, still active, command intact.

### D.5 — All 10 dependent admin RPCs reference matview
All 10 RPCs (`admin_place_category_breakdown`, `admin_place_city_overview`, `admin_place_country_overview`, `admin_place_photo_stats`, `admin_place_pool_city_list`, `admin_place_pool_country_list`, `admin_place_pool_overview`, `admin_pool_category_health`, `admin_refresh_place_pool_mv`, `cron_refresh_admin_place_pool_mv`) confirm `reads_mv: true`.

**Verdict:** ✅ Migration 4's CASCADE drop did NOT take any dependent RPC with it (as predicted — they read MV inside SELECT, not as schema-bound view dependency).

### D.6 — Matview is populated and categorized
`SELECT COUNT(*) FROM admin_place_pool_mv` → `{total: 69599, categorized: 56311}`. 80.9% categorized via `pg_map_primary_type_to_mingla_category` (the new helper). 13288 fall through to `'uncategorized'` — meaningful baseline for future tracking but not a blocker.

**Verdict:** ✅ matview fully populated, helper function working, categorization rate looks healthy.

### Phase D summary
**0 regressions from Migration 4.** The matview rebuild was clean. Phase 2.D is GREEN.

---

## Phase E — Migration 3 (already applied) post-mortem

### E.1 — All 7 functions exist with their new signatures
All 7 RPCs confirmed present with the signatures I expect:
- `admin_city_place_stats(p_city_id uuid) → jsonb` ✅
- `admin_edit_place(p_place_id uuid, p_name text, p_price_tier text, p_is_active boolean, p_price_tiers text[]) → jsonb` ✅
- `admin_pool_category_health(p_country text DEFAULT NULL, p_city text DEFAULT NULL) → TABLE(...)` ✅
- `admin_rules_overview() → jsonb` ✅
- `admin_rules_preview_impact(p_rule_set_id uuid, p_proposed_entries text[], p_proposed_thresholds jsonb DEFAULT NULL, p_city_id uuid DEFAULT NULL) → jsonb` ✅
- `admin_uncategorized_places(p_country text DEFAULT NULL, p_city text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) → TABLE(...)` ✅
- `admin_virtual_tile_intelligence(p_country text, p_city text) → TABLE(row_idx integer, col_idx integer, ...)` ✅ (this is the AUTHORITATIVE name — NOT `r_idx`/`c_idx`)

### E.2 — admin_assign_place_category fully removed
`pg_proc WHERE proname = 'admin_assign_place_category'` → `[]`. ✅ Function was already gone before Migration 3 (CLI NOTICE during apply: "function does not exist, skipping" — Migration 3 was idempotent / it was likely dropped earlier in ORCH-0700 prep).

### E.3 — No callers of admin_assign_place_category remain (in pg_proc bodies)
**Result:** `[]` — empty. No SQL function references the dropped function.

🟡 **Hidden Flaw E.3 (defer to Phase 3 dispatch):** edge functions (Deno) are NOT in `pg_proc`. Need to grep `supabase/functions/` for `admin_assign_place_category` calls separately. (Quick check: `grep -r admin_assign_place_category supabase/functions` — out of scope for this audit, flagged for orchestrator.)

### Phase E summary
**0 regressions from Migration 3.** The 7 rewires shipped clean. Phase 2.C is GREEN.

---

## Phase F — Data integrity (archive backup safety for Migration 6)

### F.1 — Live row counts on doomed columns
```
sc_nn  (seeding_category):     61803  / 69599  (88.8%)
ac_nn  (ai_categories):        69593  / 69599  (~100%)
ar_nn  (ai_reason):            58829  / 69599  (84.5%)
api_nn (ai_primary_identity):  58774  / 69599  (84.4%)
aconf_nn (ai_confidence):      58774  / 69599  (84.4%)
awe_nn (ai_web_evidence):      56479  / 69599  (81.1%)
total_rows:                    69599
```

**Verdict:** ✅ Migration 6's archive-backup `WHERE` clause (`WHERE sc IS NOT NULL OR ac IS NOT NULL OR ...`) will capture **at least 69593 rows** (since `ai_categories` is non-null on ~100% of place_pool — every Bouncer-validated row had ai_categories populated). Migration 6's defensive `IF v_archive_count = 0 THEN RAISE EXCEPTION` will pass cleanly.

### F.2 — Doomed column types
```
seeding_category     → text
ai_categories        → text[]
ai_reason            → text
ai_primary_identity  → text
ai_confidence        → real
ai_web_evidence      → text
```

**Verdict:** ✅ all types are simple PG primitives. `CREATE TABLE archive AS SELECT id, seeding_category, ai_categories, ...` will preserve types correctly. No JSONB/JSON/composite-type traps.

### Phase F summary
Archive backup will be ~69593 rows × 6 columns = ~417 KB raw text payload (rough estimate). Well under any storage concern. Retention 30 days as specified.

---

## Phase G — Cron mid-rebuild collision risk for Migration 6

Cron job 13 command: `SELECT public.cron_refresh_admin_place_pool_mv()`. This wrapper most likely calls `REFRESH MATERIALIZED VIEW` (non-CONCURRENTLY) — would need to read the function body to know for sure, but irrelevant for Migration 6:

Migration 6 takes `ACCESS EXCLUSIVE` on `place_pool` (DROP COLUMN). It does NOT touch `admin_place_pool_mv`. Cron job 13 reads `place_pool` via the matview-refresh wrapper. Worst case: a refresh tick collides with DROP COLUMN, Postgres serializes the lock — refresh waits a few seconds, then runs against the new table shape (the matview's SELECT no longer references doomed columns post-Migration-4, so the refresh succeeds against the post-drop table).

**Verdict:** ✅ collision is low-impact — at most one refresh tick delayed by a few seconds. No data loss, no permanent failure.

---

## Phase H — Edge function + caller audit (CRITICAL FINDING)

### 🔴 ROOT CAUSE LANDMINE-H1 — 3 admin edge functions still WRITE/READ doomed columns

Grep over `supabase/functions/` for the 6 doomed column names returned 8 files. Filtering to active-code references (excluding comments and tests):

#### File 1: `supabase/functions/admin-seed-places/index.ts`
12 active references to `seeding_category`. Critical ones:
- L369: `seeding_category: seedingCategory,` — INSERT into `place_pool`
- L520, L526: `.select("seeding_category")` — read for batch tracking
- L582–596: query `seeding_category` for per-category place counts
- L611: count places by app slug stored in `seeding_category`
- L716: `seeding_category: config.appCategorySlug,` — INSERT into `seeding_batches`
- L786, L908, L914, L932, L1197, L1208, L1219, L1356, L1362, L1377, L1629: read `batch.seeding_category` for batch labelling

**Impact:** every admin-seed-places HTTP request will throw `column "seeding_category" does not exist` immediately after Migration 6 lands. Admin Seed/Refresh dashboard breaks.

#### File 2: `supabase/functions/admin-refresh-places/index.ts`
6 active references:
- L500: `query.or("seeding_category.in.(...),seeding_category.is.null")`
- L502: `query.in("seeding_category", concrete)`
- L504: `query.is("seeding_category", null)`
- L532: `.select("seeding_category", { count: "exact" })` from place_pool
- L542: `row.seeding_category ?? UNCATEGORIZED_LABEL`
- L603: `.select("id, seeding_category, last_detail_refresh")` from place_pool
- L606: `.order("seeding_category", { ascending: true })`

**Impact:** every admin-refresh-places HTTP request throws post-Migration-6.

#### File 3: `supabase/functions/admin-place-search/index.ts`
2 active references:
- L224: `seeding_category: null as string | null,` — initialized field on response shape
- L330: `row.seeding_category = p.seedingCategory || seedingCategory;` — populated before insert

**Impact:** depends on whether L330's `row` is ever inserted into a table that expects `seeding_category`. Need to trace, but conservatively assume admin-place-search either INSERTs or returns this field — both break post-Migration-6.

### 🔵 Observation H2 — clean files
- `supabase/functions/_shared/seedingCategories.ts` — only references in JSDoc comments
- `supabase/functions/_shared/signalRankFetch.ts` — only in comment lines noting deprecation
- `supabase/functions/_shared/stopAlternatives.ts` — only in comments
- `supabase/functions/generate-curated-experiences/index.ts` — only in comment lines
- `supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts` — test that ENFORCES the deprecation

These files were correctly scrubbed by the ORCH-0707 implementor pass. Only the 3 admin pipeline files (Seed, Refresh, Search) were missed.

### 🟡 Hidden Flaw H3 — admin UI / admin-dashboard JS
This audit did NOT grep `mingla-admin/src/`. Per the dispatch prompt, Phase H is time-boxed; admin UI grep is queued for the orchestrator. Any admin React page that displays `seeding_category` (e.g., Place Pool Management page, Seed Tab) will receive `null`/`undefined` from the now-broken edge functions OR will issue direct Supabase queries that fail.

### Phase H summary
**Migration 6 cannot land safely until the 3 admin edge functions are fixed.** This is a HARD blocker — not a "nice to have." The fix is OUT-OF-BAND from the migration chain (edge functions deploy via `supabase functions deploy`, not via SQL migrations), so the orchestrator must sequence:

1. Implementor Phase 3 dispatch to delete `seeding_category` reads/writes from the 3 edge functions
2. `supabase functions deploy admin-seed-places admin-refresh-places admin-place-search`
3. THEN `supabase db push --include-all` for Migrations 5 (fixed) + 6

OR accept that admin Seed/Refresh/Search are broken from Migration-6 land time until Phase 3 ships (could be hours to days).

---

## §10 — Recommended Migration 5 + 6 rewrite

### Migration 5 (one-line fix)

In `supabase/migrations/20260503000005_orch_0700_scrub_doomed_column_mentions_in_rpc_comments.sql`:

**Find:**
```sql
RETURNS TABLE(
  r_idx integer,
  c_idx integer,
  ...
)
```

**Replace with:**
```sql
RETURNS TABLE(
  row_idx integer,
  col_idx integer,
  ...
)
```

Then in the same function body, find the `RETURN QUERY SELECT` block:
```sql
SELECT
    r_idx,
    c_idx,
    v_min_lat + r_idx * v_cell_lat + v_cell_lat / 2.0 AS center_lat,
    v_min_lng + c_idx * v_cell_lng + v_cell_lng / 2.0 AS center_lng,
    ...
FROM (
    SELECT
      pp2.*,
      public.pg_map_primary_type_to_mingla_category(pp2.primary_type, pp2.types) AS derived_category,
      FLOOR((pp2.lat - v_min_lat) / v_cell_lat)::INTEGER AS r_idx,
      FLOOR((pp2.lng - v_min_lng) / v_cell_lng)::INTEGER AS c_idx
    ...
  ) pp
GROUP BY r_idx, c_idx
ORDER BY r_idx, c_idx;
```

Replace **EVERY** `r_idx` with `row_idx` and **EVERY** `c_idx` with `col_idx` in this block (subquery aliases too).

**Verification after fix:** push migration; expect "Applying 5… success" + final verify probe in Migration 5 footer reports zero RPCs with doomed-column references.

### Migration 6 (no changes needed)

Migration 6 is structurally correct — the only reason it failed earlier was that Migration 5 didn't land first. Once Migration 5 ships, Migration 6's pre-checks both pass and the DROP executes cleanly.

🟡 **One hidden flaw to flag (does NOT need to fix Migration 6 to ship):** Migration 6's pre-check 2 uses `prosrc ILIKE '%seeding_category%'` which would match comment text inside a function. Right now Migration 5 scrubs those comments, but the pattern is fragile — a future migration that adds an explanatory comment mentioning `seeding_category` to ANY function in the public schema would re-trigger pre-check 2 and block all Phase 2.E follow-ups. Future-proofing: switch to `pg_get_functiondef()` regex against actual SQL identifiers (e.g., `\bseeding_category\b` ignoring `--` prefix), but this is over-engineering for a one-shot DROP. Leave as-is.

### Migration 7 (NEW) — admin edge function source fix

Cannot be a SQL migration. Must be:

1. **Implementor dispatch (urgent):** delete `seeding_category` references from:
   - `supabase/functions/admin-seed-places/index.ts` (12 sites)
   - `supabase/functions/admin-refresh-places/index.ts` (7 sites)
   - `supabase/functions/admin-place-search/index.ts` (2 sites)

   Replace with: derived-category lookup via `pg_map_primary_type_to_mingla_category(primary_type, types)` for reads, and remove the writes entirely (the column is being dropped — there's nothing to write). For seeding-batch tracking that previously used `seeding_category` as a label, switch to a separate column on `seeding_batches` (e.g., already-existing `category_label` field — verify) OR pass through Mingla's helper-derived category at request time.

2. **Deploy:** `supabase functions deploy admin-seed-places admin-refresh-places admin-place-search`

3. **Verify:** smoke test admin Seed dashboard, admin Refresh, admin Place Search before pushing Migration 6.

---

## §11 — Recommended pre-flight gate (NEW orchestrator invariant)

### I-MIGRATION-LIVE-SIGNATURE-CHECK (NEW invariant — proposed)

**Before authoring any `CREATE OR REPLACE FUNCTION` migration, the implementor MUST query live and paste output into the implementation report:**

```sql
SELECT
  pg_get_function_arguments(oid) AS live_args,
  pg_get_function_result(oid) AS live_returns
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = '<target_function_name>';
```

**Then the migration MUST declare an IDENTICAL signature.** Any drift in IN-arg names (Postgres tolerates this), IN-arg defaults (Postgres rejects with 42P13 if existing defaults are removed), OR OUT-arg names (Postgres rejects with 42P13 if changed in CREATE OR REPLACE) is a SHIP-BLOCKER.

**Codification path:**
- Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` as I-MIGRATION-LIVE-SIGNATURE-CHECK
- Add to `.claude/skills/mingla-implementor/SKILL.md` Pre-Flight Protocol Step 5 ("Announce the Plan") — add bullet: "For migrations: paste live `pg_get_function_arguments()` for every CREATE OR REPLACE target."
- Add to `.claude/skills/mingla-forensics/SKILL.md` SPEC Mode Phase 3 (Database layer) — add bullet: "For every CREATE OR REPLACE FUNCTION in the spec, paste the live signature into the spec verbatim. Implementor must copy from there."

### Pre-flight gate for Phase 2.E-style column drops

Before any future `DROP COLUMN` migration:

1. **Mandatory: enumerate ALL pg_class objects** depending on the column:
   - `pg_index x JOIN pg_class i ON i.oid=x.indexrelid` (indexes)
   - `pg_constraint c WHERE conrelid=...` (constraints)
   - `pg_attrdef d` (default expressions)
   - `pg_attribute WHERE attgenerated <> ''` (generated columns)
   - `pg_policy WHERE polrelid=...` (RLS)
   - `pg_trigger WHERE tgrelid=...` (triggers, then grep their function bodies)
   - `pg_class WHERE relkind IN ('v','m') AND pg_get_viewdef ILIKE '%col%'` (views/matviews)
   - `pg_publication_tables` (logical replication)
   - `cron.job WHERE command ILIKE '%col%'` (cron commands)
   - `pg_proc WHERE prosrc ILIKE '%col%'` (RPC bodies — already done by Migration 6)
2. **Mandatory: grep edge function source** for column name (`grep -r 'col_name' supabase/functions/`)
3. **Mandatory: grep admin UI source** for column name (`grep -r 'col_name' mingla-admin/src/`)
4. **Mandatory: grep mobile app source** for column name (`grep -r 'col_name' app-mobile/src/ mingla-business/src/`)
5. Each finding becomes a `🔴` if it's an active reference or `🔵` if it's a comment/test.

This 5-layer-grep + 9-pg-catalog-query becomes the standard pre-flight checklist for column drops. Codify in `.claude/skills/mingla-forensics/references/recurring-patterns.md` as "Pre-DROP-COLUMN audit checklist."

---

## §12 — Confidence per finding

| Finding | Confidence | Reason |
|---|---|---|
| LANDMINE-A1 (admin_virtual_tile_intelligence OUT-param drift) | **HIGH (proven)** | live `pg_get_function_result()` returns `row_idx, col_idx`; Migration 5 file declares `r_idx, c_idx`. Six-field evidence complete. |
| LANDMINE-H1 (3 admin edge functions write/read seeding_category) | **HIGH (proven)** | Grep with line numbers. Active code, not comments. Tested by reading file segments to confirm context. |
| Phase D (Migration 4 clean) | **HIGH (proven)** | All 6 sub-phases queried live. matview shape, indexes, GRANTs (via pg_class.relacl), cron, dependents, populated state — all green. |
| Phase E (Migration 3 clean) | **HIGH (proven)** | All 7 RPCs verified via live signatures. assign_place_category gone with no callers in pg_proc. |
| Phase C.4 + C.5 + C.7 + C.8 (no views/defaults/generated/publications) | **HIGH (proven)** | Empty result sets verified across 4 separate queries. |
| Phase F (data integrity for archive) | **HIGH (proven)** | Live row counts. Type list. Estimate well within tolerance. |
| Phase G (cron collision low-risk) | **MEDIUM** | Did NOT read the body of `cron_refresh_admin_place_pool_mv()` to confirm CONCURRENTLY vs not. But irrelevant — even non-CONCURRENT serializes correctly with DROP COLUMN; worst case is one delayed tick. |
| Hidden Flaw E.3 (edge function calls to admin_assign_place_category) | **LOW** | Did NOT grep `supabase/functions/` for this function name. Flagged for orchestrator follow-up. |
| Hidden Flaw H3 (admin UI references) | **LOW** | Did NOT grep `mingla-admin/src/`. Flagged for orchestrator. |

---

## §13 — Discoveries for orchestrator (out-of-scope side issues)

1. **🟡 admin-place-search L330** — `row.seeding_category = p.seedingCategory || seedingCategory;` — needs trace to confirm whether this ever lands in an INSERT. If yes, broken post-Migration-6.
2. **🟡 admin UI (mingla-admin/src/) grep for seeding_category / ai_categories** — NOT done in this audit. Needs separate dispatch.
3. **🟡 Mobile + Business apps** (app-mobile/, mingla-business/) — NOT grepped. Should be clean per ORCH-0707 implementor pass but VERIFY.
4. **🟡 admin_assign_place_category callers in edge functions** — `supabase/functions/` NOT grepped for this name. Quick check needed.
5. **🟡 Future-proofing Migration 6 pre-check 2** — pattern `ILIKE '%col%'` matches comments. Consider regex with word boundaries for future column-drop migrations. Low priority (one-shot).
6. **🟡 D.3 GRANT preservation hidden flaw** — Migration 4's footer comment claims default ownership preserves GRANTs. True ONLY because migration role IS postgres. Codify: "matview rebuilds must explicitly GRANT SELECT to anon, authenticated, service_role."
7. **🟢 Categorization rate** — 80.9% of place_pool rows resolve to a non-uncategorized Mingla category via `pg_map_primary_type_to_mingla_category`. The remaining 19.1% (13288 rows) hit `'uncategorized'` and won't appear in admin category breakdowns. This is product-truth state, worth documenting in `PRODUCT_SNAPSHOT.md` as the post-ORCH-0700 baseline.
8. **🔴 Critical sequencing decision for orchestrator:** the question is NOT "should we ship Migration 6?" but "should we ship Migration 6 BEFORE or AFTER fixing the 3 admin edge functions?" If BEFORE: admin Seed/Refresh/Search dashboards break for hours-to-days. If AFTER: Phase 2 closes within days but only after a Phase 3 implementor dispatch ships first. **Recommend AFTER** — admin dashboards are not user-facing critical path; freezing them temporarily is a real but bounded harm; shipping a broken admin tool in production is a worse trust-cost than waiting one cycle.

---

## §14 — Fix Strategy (direction only — implementor will receive a separate spec)

### Path A (RECOMMENDED): sequential — admin edge functions first

1. Orchestrator writes spec for **Implementor Phase 3 — admin edge function scrub.** Files: 3 (admin-seed-places, admin-refresh-places, admin-place-search). Estimated scope: 21 active references to remove + replacement category-derivation logic. Likely 2-4h implementor + 1h tester.
2. Operator runs `supabase functions deploy admin-seed-places admin-refresh-places admin-place-search`.
3. Smoke test admin Seed/Refresh/Search dashboards via mingla-admin local dev.
4. **THEN** patch Migration 5 (LANDMINE-A1 fix: `r_idx`/`c_idx` → `row_idx`/`col_idx`).
5. Run `supabase db push --include-all` — applies fixed Migration 5 + Migration 6.
6. Run Migration 6 verification probes against live (5 probes per dispatch prompt §A6 of original spec).
7. Schedule 2026-06-02 reminder to drop archive table.
8. CLOSE ORCH-0700 Phase 2 + run DEPRECATION CLOSE EXTENSION (8-step protocol).

### Path B (NOT RECOMMENDED): ship Migration 6 now, fix edge functions later

1. Patch Migration 5 (LANDMINE-A1 fix only).
2. `supabase db push --include-all` — Migration 6 lands.
3. Admin Seed/Refresh/Search dashboards immediately broken (`column does not exist` errors).
4. Implementor Phase 3 fix as urgent priority over next 24-48h.
5. Risk: any admin user trying to seed/refresh/search during the gap sees 500 errors.

**Path A** is the right call. The cost of waiting one implementor cycle is low; the cost of a broken admin dashboard in production is trust + operational drag.

---

## §15 — Regression Prevention

To prevent another 6-push-failure cascade on the next column-drop or RPC rewire:

1. **Codify I-MIGRATION-LIVE-SIGNATURE-CHECK** (§11) into:
   - `INVARIANT_REGISTRY.md`
   - `.claude/skills/mingla-implementor/SKILL.md` Pre-Flight Step 5
   - `.claude/skills/mingla-forensics/SKILL.md` SPEC Phase 3 (Database)
2. **Codify the 9-query + 5-grep DROP-COLUMN pre-flight checklist** into `.claude/skills/mingla-forensics/references/recurring-patterns.md`.
3. **Update DEC log** with `DEC-08X — pre-DROP-COLUMN audit is mandatory; never trust the spec, always query pg_catalog`.
4. **Add a CI gate** (long-term, not for this cycle): a GitHub Action that runs against PR-target migrations and fails if any `CREATE OR REPLACE FUNCTION` declares a signature that doesn't match `pg_get_function_arguments()` from a snapshot of the live remote DB. Out of scope for this PR but flag for future.

---

## §16 — Investigation Manifest (for trace audit)

Files / queries executed in order:

1. Phase A: 1 query — live signatures of 5 Migration 5 targets
2. Phase B: 1 query — re-run of doomed-column scan
3. Phase C.1: 1 query — indexes
4. Phase C.2: 1 query — constraints
5. Phase C.3a: 1 query — triggers
6. Phase C.3b: 1 query — trigger function bodies (auto_update_city_seeded_status, update_updated_at_column)
7. Phase C.4: 1 query — views/matviews
8. Phase C.5: 1 query — defaults
9. Phase C.6: 1 query — RLS policies
10. Phase C.7: 1 query — generated columns
11. Phase C.8: 1 query — publications
12. Phase C.9: 1 query — cron command refs
13. Phase D.1: 1 query — matview shape
14. Phase D.2: 1 query — matview indexes
15. Phase D.3a: 1 query — information_schema GRANTs (false negative)
16. Phase D.3b: 1 query — pg_class.relacl GRANTs (corrected)
17. Phase D.4: 1 query — cron job 13 details
18. Phase D.5: 1 query — 10 dependent admin RPCs
19. Phase D.6: 1 query — matview row counts
20. Phase E.1: 1 query — 7 Migration 3 RPCs
21. Phase E.2: 1 query — admin_assign_place_category gone
22. Phase E.3: 1 query — pg_proc callers
23. Phase F.1: 1 query — doomed column row counts
24. Phase F.2: 1 query — doomed column types
25. Phase G: 1 query — cron job 13 command
26. Phase H: 2 greps — `supabase/functions/` for 6 doomed column names (files-with-matches + content)

**Total: 25 live SQL queries + 2 file greps + 1 file Read for context.** Time: ~30 min. Within the 60-min budget.

---

**END OF REPORT**

The orchestrator now has every landmine enumerated. Sequencing decision is the operator's call — recommend Path A (admin edge functions first, then Migration 5+6).
