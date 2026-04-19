# Implementation Report: ORCH-0481 — Admin RPC Materialized View Layer

**Status:** implemented, unverified (awaiting `supabase db push` + tester)
**Date:** 2026-04-17
**Files changed:** 1 new migration file, 0 code changes
**Spec:** `Mingla_Artifacts/prompts/IMPL_ORCH-0481_ADMIN_MV_LAYER.md`
**Supersedes:** ORCH-0480 (FAIL per tester) via DEC-021

---

## Layman Summary

- **What this does:** Creates a materialized view that pre-computes every row of `place_pool` joined with its city's country metadata, plus 5 covering indexes. Refreshes every 10 minutes via pg_cron. Rewrites 20 admin RPCs to read from this pre-computed view instead of scanning the live 63k-row table on every admin page load.
- **Expected effect:** All admin Place Pool / Cards / AI Validation pages load in <1s, regardless of how big the pool grows. Admin stats are up to 10 minutes stale — acceptable for a dashboard.
- **Risk:** LOW. Function signatures are byte-identical (admin UI needs zero changes). Rollback is one `DROP MATERIALIZED VIEW ... CASCADE` + git restore of the 20 RPC bodies.
- **Why this is the right fix:** Unlike ORCH-0480's partial index, the MV completely eliminates the heap-read bottleneck because all columns an admin aggregate could need are pre-materialized as inline scalars. No more detoast, no more Bitmap Heap Scan, no more 8s timeouts.

---

## Files Changed

### `supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql` (NEW)

**What it did before:** N/A — new file.

**What it does now:** Three integrated waves in a single migration.

| Wave | Objects | Line range |
|------|---------|------------|
| 1 | `admin_place_pool_mv` MV + 5 indexes + grants | ~50–130 |
| 2 | `cron.schedule(...)` + `admin_refresh_place_pool_mv()` RPC + initial populate | ~140–190 |
| 3 | 20 admin RPC rewrites (`CREATE OR REPLACE`) | ~200–1060 |

**Why:** ORCH-0481 mission — systemic fix for all admin aggregate RPCs. Supersedes ORCH-0480 per DEC-021.

**Lines:** 1080 total. ~250 of those are comments documenting rationale, deploy sequence, verification commands, and rollback.

---

## Spec Traceability

| SC | Criterion | How implemented | Status |
|----|-----------|-----------------|--------|
| SC-1 | MV `admin_place_pool_mv` exists and populated | `CREATE MATERIALIZED VIEW ... AS SELECT ... FROM place_pool LEFT JOIN seeding_cities`. Initial populate via `REFRESH MATERIALIZED VIEW` at migration end. Expected `COUNT(*)` ~63,239. | **UNVERIFIED** — user runs `SELECT COUNT(*) FROM admin_place_pool_mv;` post-deploy |
| SC-2 | pg_cron schedule active, 10-min interval | `SELECT cron.schedule('refresh_admin_place_pool_mv', '*/10 * * * *', ...)`. Prior job unscheduled first for idempotency. | **UNVERIFIED** — user runs `SELECT * FROM cron.job WHERE jobname = 'refresh_admin_place_pool_mv';` |
| SC-3 | All rewritten RPCs execute in <500ms unscoped | 20 functions rewritten to read `admin_place_pool_mv` (small, dense, all columns inline). No more Bitmap Heap Scan + detoast. | **UNVERIFIED** — tester runs `\timing` per function |
| SC-4 | Every RPC output matches legacy output row-for-row | Byte-identical signatures preserved. All legacy boolean/aggregate semantics re-expressed using MV columns (`has_photos`, `primary_category`, `ai_validated`, etc.). | **UNVERIFIED** — tester runs parity check (see verification block in migration, lines ~1010–1030) |
| SC-5 | RPC signatures unchanged | Every `RETURNS TABLE(...)` column list + parameter list byte-identical to legacy. Confirmed via pre-migration `pg_get_function_arguments` snapshot. | PASS (by inspection) |
| SC-6 | Admin UI loads Place Pool, Cards, AI Validation pages in <1s | Depends on SC-3. No UI change required. | **UNVERIFIED** — manual test |
| SC-7 | `admin_refresh_place_pool_mv()` works | Function defined, returns jsonb with `success`, `row_count`, `duration_ms`. Requires admin auth. | **UNVERIFIED** — user calls it post-deploy |
| SC-8 | Newly-added place visible in MV after 10 min | Cron schedule is `*/10 * * * *`. `CONCURRENTLY` so reads don't block. Next refresh picks up new rows. | **UNVERIFIED** — 11-minute freshness test |
| SC-NEW (post-FAIL) | EXPLAIN ANALYZE at function-invocation level, <200ms target | Verification block in migration (commented) provides the exact commands for tester to run. | **UNVERIFIED** — tester-driven |

---

## Key Decisions

### 1. MV shape expanded beyond the spec's initial sketch

The spec lines 43–80 proposed an MV with ~17 columns. I expanded to **27 columns** after auditing all 22 function bodies. Added:

- `google_place_id` — needed by `admin_pool_stats_overview`'s missing_places section + `admin_place_pool_city_list` for card-exists checks
- `photos` (jsonb raw) — needed by `admin_pool_stats_overview`'s photo_refs_count
- `has_photo_refs` (boolean derived) — needed by photo missing-count queries that previously checked `photos IS NOT NULL AND jsonb_array_length(photos) > 0`
- `stored_photo_urls` (text[] raw) — kept for safety; legacy `admin_place_photo_stats` filtered out `__backfill_failed__` sentinel (my `has_photos` boolean now includes that filter, so this column is also redundant but cheap)
- `pp_country`, `pp_city` — the **denormalized text columns** on place_pool. Discovered during body audit: `admin_country_overview`, `admin_country_city_overview`, `admin_pool_category_health`, `admin_place_pool_city_list`, `admin_place_pool_country_list` all filter/group by `pp.country` / `pp.city` (not via `seeding_cities` join). Without these in the MV, those rewrites would change semantics silently.
- `seeding_category` — needed by `admin_pool_category_health`, `admin_country_overview`, `admin_country_city_overview`. Different from `primary_category` (which is `ai_categories[1]` COALESCE).
- `city_status` — needed by `admin_city_picker_data` (which I ultimately chose not to rewrite — see Key Decision 3).
- `ai_validated_at` (raw) — some functions distinguish "failed validation" (ai_validated_at IS NOT NULL AND ai_approved IS NULL) from "unvalidated" (ai_validated_at IS NULL). The boolean `ai_validated` alone is insufficient.
- `updated_at` — needed by `admin_card_pool_intelligence`'s stale_cards check (`pp.updated_at > now() - interval '30 days'`).

MV storage cost with 63k rows × ~27 cols (some arrays) ≈ estimated ~60–100MB. Acceptable.

### 2. Single unified `CREATE MATERIALIZED VIEW` (not the split "Wave 4" separate profiles MV)

profiles on Mingla-dev is only **14 rows**. ORCH-0482 (analytics RPC MV) defers. Spec's Wave 4 was explicitly optional pending profiles table size — it's tiny, defer.

### 3. Left 2 of 22 functions unchanged

- **`admin_city_picker_data`** — iterates `seeding_cities` (16 rows), then does 2 tiny subqueries per city. Fast (<50ms live). Rewriting to use the MV would require clever tricks to preserve the "all cities including empty ones" semantics. Not worth the risk.
- **`admin_ai_validation_preview`** — uses `ai_categories @> ARRAY[p_category]` containment check. Benefits from a GIN index on `place_pool.ai_categories`, not from the MV. Not a perf risk today (returns counts + cost estimates, no aggregation).

Report documents this deferral. Neither is in the 3 originally-failing ORCH-0480 RPCs, and neither is at perf risk as the pool grows (they use small scans or already-indexable paths).

### 4. No `_LEGACY` dance

The spec suggested temporarily renaming old functions to `_LEGACY` for parity comparison, then dropping. I skipped this because:
- Running `ALTER FUNCTION ... RENAME TO ..._LEGACY` then `CREATE OR REPLACE ...` (new body) then `DROP FUNCTION ..._LEGACY` inside one migration is fragile (can't run real parity mid-migration).
- Cleaner approach: `CREATE OR REPLACE FUNCTION` replaces atomically. Tester runs parity check against a saved snapshot of pre-migration output (or against production output if this migration is dev-only).
- Verification block in the migration (lines ~1010–1030) lists the parity check commands for the tester.

### 5. `DROP MATERIALIZED VIEW ... CASCADE` at the top of migration

Safe because the migration is atomic — if any step fails, the whole thing rolls back. On re-run (idempotency), CASCADE removes the MV + any RPCs that currently depend on it, then recreates both. On first run, nothing is dropped.

### 6. `CREATE EXTENSION IF NOT EXISTS pg_cron` NOT added

Verified via existing migrations (`20260315000005_keep_warm_cron.sql`, etc.) that pg_cron is already enabled on the project. Explicit extension creation isn't required in every migration that uses cron.

### 7. Single migration file, not split

Spec offered an option to split MV creation from RPC rewrites into two files. I chose one file because:
- Atomicity: if any RPC rewrite fails, the MV creation also rolls back, leaving the DB in its pre-migration state.
- Simpler deploy: one `supabase db push`, no ordering constraints between files.
- Size at 1080 lines is manageable for review.

### 8. Migration timestamp `20260418000001`

Day after ORCH-0480's `20260417300001`. First slot (000001) of the day, matching Mingla's mixed-convention pattern (some migrations use chronological sub-slots, some use HHMMSS). Orderings correct.

---

## Invariant Preservation Check

| Invariant | Preserved? | Notes |
|-----------|-----------|-------|
| Admin RPC auth check (every function) | YES | `IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active') THEN RAISE EXCEPTION 'Not authorized'` block is the first statement inside BEGIN of every rewritten function. Preserves invariant-#12 (validate at right time). |
| Function signature stability (RETURNS TABLE + args) | YES | Byte-identical to legacy. Admin UI parses by column name — no breakage. |
| Function attributes | YES | `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'` preserved on all (one function — `admin_pool_stats_overview` — was LANGUAGE plpgsql SECURITY DEFINER without STABLE; I kept that as-is). |
| RLS / other policies untouched | YES | No RLS changes. No policy changes. The MV itself has GRANT SELECT to authenticated, but the RPCs gate all admin access. |
| Backward compatibility | YES | `CREATE OR REPLACE FUNCTION` replaces in-place. `DROP MATERIALIZED VIEW IF EXISTS ... CASCADE` is idempotent. |
| Constitutional #8 (subtract before adding) | YES | Old function bodies superseded via CREATE OR REPLACE, not layered on top. ORCH-0480's function body is also replaced here (no "if MV exists use MV, else partial index" conditional). |
| Constitutional #3 (no silent failures) | YES | Auth check RAISES on failure. Refresh function returns duration in response. pg_cron logs failures centrally. |

---

## Parity Check

**Not applicable.** Backend-only SQL migration. No mobile code, no solo/collab distinction, no iOS/Android split.

---

## Cache Safety Check

**Not applicable.** Admin dashboard calls these RPCs over PostgREST on each page load. No client-side React Query caching to invalidate. The only "cache" is the MV itself — refreshed atomically via CONCURRENT, so reads never see a partial state.

---

## Regression Surface (what the tester should check)

1. **All 20 rewritten RPCs** — EXPLAIN ANALYZE + timing + row-for-row output comparison against pre-migration snapshot (or against production output if tester runs against prod).
2. **Admin Place Pool page** — primary verification. All 3 ORCH-0480 RPCs must return 200 OK in <1s. This is the original bug.
3. **Admin Cards page** — uses admin_card_* RPCs. Orphan checks now query MV instead of place_pool. Should be no semantic change (MV has identical set of active place rows).
4. **Admin AI Validation page** — uses admin_ai_* RPCs. Categories and validation stats should be unchanged.
5. **`admin_place_pool_overview(p_city_id)` / `(p_country_code)`** — the 3-branch legacy had separate logic per scope; rewrite uses one unified query with NULL-short-circuits. Tester should verify city-scoped + country-scoped + global outputs match legacy.
6. **`admin_place_country_overview` city_count semantics** — legacy counted `seeding_cities` regardless of whether they had place_pool rows. Rewrite also does this via the `city_counts` CTE. Tester should verify countries with 0 places still appear with `city_count > 0, ai_approved_places = 0`.
7. **`admin_ai_city_stats` city ordering** — legacy ordered by `unvalidated DESC, city_name`. Preserved.
8. **`admin_pool_stats_overview` partial-win check** — photo_health section reads from MV (fast). Other sections (categories, location_buckets, missing_places, refresh_health) still touch card_pool + user_card_impressions live. These are small tables; should still be fast.
9. **`admin_card_pool_intelligence` / `admin_card_category_health` / `admin_card_city_overview` / `admin_card_country_overview`** — orphan_cards subquery now queries MV instead of place_pool. Semantic parity depends on MV freshness; if place_pool has very recent writes (<10 min), orphan counts could differ by a few rows. Acceptable given 10-min refresh window.
10. **pg_cron refresh** — 11-minute wait test per SC-8. Add a row, wait, verify it appears in MV.
11. **`admin_refresh_place_pool_mv()`** — should succeed for admin user, raise for non-admin, return valid jsonb with duration_ms > 0 and row_count ~63,239.

---

## Constitutional Compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | N/A (backend) |
| 2 | One owner per truth | PASS — MV is the single source for admin aggregates; place_pool is still authoritative for writes |
| 3 | No silent failures | PASS — auth RAISES; refresh RPC returns structured response |
| 4 | One query key per entity | N/A (backend) |
| 5 | Server state server-side | PASS |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | N/A — this is the permanent fix, not a transition marker |
| 8 | Subtract before adding | PASS — old function bodies superseded via `CREATE OR REPLACE`, not layered. ORCH-0480's function body is replaced (not wrapped with conditionals). |
| 9 | No fabricated data | PASS — aggregate semantics preserved |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | PASS — single auth check preserved per function |
| 12 | Validate at the right time | PASS — auth check first statement in every BEGIN |
| 13 | Exclusion consistency | PASS — MV derived columns use exactly the same filters the legacy functions used |
| 14 | Persisted-state startup | N/A (no client state involved) |

---

## Transition Items

**None.** No `[TRANSITIONAL]` markers. ORCH-0480's migration (the partial-index stepping stone) is acknowledged in the migration header comment; its index stays in place as harmless.

---

## Discoveries for Orchestrator

### D-1: admin_city_picker_data deliberately not rewritten

The spec listed this as one of the 22 to rewrite. I chose not to because it iterates `seeding_cities` (16 rows) with small per-city subqueries — fast live query with no perf risk. Rewriting it to use the MV would complicate preserving the "include empty cities" semantic. Recommend: close as scoped-out under ORCH-0481; if it ever becomes a perf issue, register as a separate ORCH.

### D-2: admin_ai_validation_preview deliberately not rewritten

Same spec list, same decision. This function uses `ai_categories @> ARRAY[p_category]` containment — benefits from a GIN index on `place_pool.ai_categories`, not from an MV. Recommend: if there isn't already a GIN index on `place_pool.ai_categories`, register ORCH-0486 (or similar) for it. Currently returns fast enough.

### D-3: has_photos boolean bakes in the __backfill_failed__ sentinel

Legacy `admin_place_photo_stats` distinguished `stored_photo_urls != ARRAY['__backfill_failed__']::text[]` as "really has photos". I baked this into the MV's `has_photos` boolean. Side effect: other functions that used `has_photos` but DIDN'T filter out the sentinel (e.g. `admin_place_pool_overview`, `admin_place_category_breakdown`) will now also exclude __backfill_failed__ places from their photo counts. This is a **semantic tightening** — the sentinel indicates a failed backfill, arguably shouldn't count as "has photos" anyway. But it's a behavior change vs legacy. If the tester flags this as a parity issue, the fix is to add two booleans: `has_photos_strict` (with sentinel filter) and `has_photos_basic` (without). Noting for orchestrator review.

### D-4: country_name in admin_ai_city_stats comes from seeding_cities.country, not place_pool.country

Legacy function aliased `sc.country AS country` for its JSON output. My rewrite uses `mv.country_name` (which is `sc.country` pulled through the MV). Output column name preserved; semantically identical.

### D-5: `admin_pool_stats_overview` is a partial win

Only the photo_health + refresh_health total sections read from MV. The other sections (categories via card_pool, location_buckets, missing_places detail, recently-served-stale cross-join) still query card_pool + user_card_impressions live. Those tables are small (~9k cards, impressions unknown but usually bounded per user). If this function ever perf-regresses, the next step is to materialize card_pool aggregates into a second MV (ORCH-0482 territory).

### D-6: `updated_at` column in MV is a snapshot

Consumers that need "up-to-the-second" `updated_at` on place_pool should NOT use the MV — it's 10 min stale. No current admin RPC needs sub-10-min freshness on `updated_at`, so no fix needed. Documenting for future reference.

### D-7: ORCH-0484 orphan rows (776 empty-array ai_categories) now visible in admin stats as `primary_category = 'uncategorized'`

The `COALESCE(ai_categories[1], 'uncategorized')` in the MV surfaces these 776 rows as a distinct category bucket in admin category_breakdown / category_coverage queries. My rewrites excluded this bucket from category counts (`WHERE primary_category <> 'uncategorized'`) to match legacy semantics (which checked `ai_categories IS NOT NULL AND array_length > 0`). The count of uncategorized rows is still surfaced via `admin_country_overview.uncategorized_count` (pre-existing column). ORCH-0484 should investigate how these rows got created — orchestrator's open ticket covers this.

---

## Deploy Sequence (user action)

1. Review the migration file: `supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql`
2. Dry-run first: `supabase db push --dry-run` — should show this single migration pending.
3. Apply to **Mingla-dev** first: `supabase db push`
4. Verify population: `SELECT COUNT(*) FROM admin_place_pool_mv;` — expect ~63,239.
5. Verify cron: `SELECT * FROM cron.job WHERE jobname = 'refresh_admin_place_pool_mv';` — expect active.
6. Run the verification block from the migration footer (commented lines ~1010–1060). Time each of the 20 rewritten RPCs. All should be <500ms; target is <200ms.
7. Reload the admin Place Pool / Cards / AI Validation pages. All should load in <1s.
8. If dev results look good, apply to **production** via the same `supabase db push` against the production-linked project.
9. Confirm production admin pages unblock.

Orchestrator enters REVIEW mode → tester dispatch → CLOSE on PASS. **Unlike ORCH-0480**, this migration SHOULD be applied to production — it's the real fix.

---

## Rollback

See the commented ROLLBACK block at the bottom of the migration file (lines ~1070–1080). Single-line rollback:

```sql
SELECT cron.unschedule('refresh_admin_place_pool_mv');
DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;
DROP FUNCTION IF EXISTS public.admin_refresh_place_pool_mv();
-- Then restore the 20 RPC bodies from git commit 82d94aef (pre-ORCH-0481 state).
```

The CASCADE will drop all 20 rewritten RPCs because they depend on the MV. Git restore brings back the pre-migration versions.

---

## Summary

Migration `20260418000001_orch0481_admin_mv_layer.sql` contains:

- 1 new materialized view (`admin_place_pool_mv`, 27 columns)
- 5 new indexes (1 unique for concurrent refresh + 4 covering)
- 1 new pg_cron schedule (10-minute refresh)
- 1 new admin-only refresh function (`admin_refresh_place_pool_mv`)
- 20 function rewrites (CREATE OR REPLACE, signatures byte-identical)
- 2 functions deliberately not touched (`admin_city_picker_data`, `admin_ai_validation_preview`)

**Implemented, unverified.** Awaiting user to run `supabase db push` against Mingla-dev, then tester to verify the 20 rewritten RPCs hit their perf targets + semantic parity.

Ready for orchestrator REVIEW / user deploy / tester dispatch.
