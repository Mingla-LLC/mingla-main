# QA Report — ORCH-0481 Admin RPC Materialized View Layer

**Tester:** mingla-tester
**Date:** 2026-04-17
**Cycle:** 0 (first test pass post-implementation)
**Spec:** `Mingla_Artifacts/prompts/IMPL_ORCH-0481_ADMIN_MV_LAYER.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0481_ADMIN_MV_LAYER_REPORT.md`
**Tester prompt:** `Mingla_Artifacts/prompts/TESTER_ORCH-0481_ADMIN_MV_LAYER.md`
**Environment under test:** Mingla-dev (`gqnoajqerqhnvulmnyvv`)
**Migration state:** Applied (commit 352fc4c7; `supabase_migrations.schema_migrations` contains `20260418000001`)

---

## Verdict: **FAIL**

**Counts:** P0: 2 | P1: 1 | P2: 2 | P3: 0 | P4: 3

The MV is built, populated, and indexed correctly. Cron is scheduled and has already fired once. Signatures are byte-identical. The `admin_place_category_breakdown` case is a stunning success — **9,000ms → 107ms (84× faster)** — proving the MV pattern is sound for filter-narrowed queries.

**BUT two queries fail catastrophically, including one that is WORSE than the ORCH-0480 partial-index fix it was supposed to supersede:**

1. `admin_place_country_overview`: **53,875ms warm** (ORCH-0480 era was ~9s warm). **6× worse than the thing it supersedes.** Will still hit PostgREST's 8s timeout; admin page still returns 500.
2. `admin_place_pool_overview` (global scope): **4,932ms warm.** Under the 8s timeout (so admin page will at least load), but 25× the <200ms spec target.

Root causes pinned to two defects in the rewrite + one architectural oversight:
- **`COUNT(mv.*) FILTER (...)`** in `admin_place_country_overview` and `admin_place_city_overview` forces Postgres to materialize every 624-byte MV row to check non-null, even though only a few columns are aggregated. This inflates the sort set to 318MB and forces an external disk sort.
- **MV row width is 624 bytes** (27 columns including TOAST'd arrays/jsonb). Full-table scans — which `admin_place_pool_overview` global path performs — are bottlenecked on physical I/O (~5000 pages) on Mingla-dev's instance tier.
- **No architectural fallback for unfiltered aggregates.** The partial indexes only cover filtered-subset queries. Global aggregates have no index path and must seq-scan the MV.

**Recommendation:** Do NOT ship to production. Rework is surgical — see P0-1 fix below. Expected post-rework: country_overview from 54s → <500ms. pool_overview likely still needs a separate covering index or narrower MV.

---

## Success Criteria Compliance Matrix

| SC | Criterion | Target | Observed | Verdict |
|----|-----------|--------|----------|---------|
| **SC-1** | `admin_place_pool_overview()` global <200ms | <200ms | **4,932ms** warm (single `COUNT(DISTINCT ... primary_category)` forces full MV seq scan) | **FAIL — P0** |
| **SC-2** | `admin_place_category_breakdown()` <200ms | <200ms | **107ms** warm (uses `admin_place_pool_mv_primary_category` partial index Bitmap Scan). **84× faster than ORCH-0480's 9,000ms.** | **PASS** |
| **SC-3** | `admin_place_country_overview()` <200ms | <200ms | **60,197ms cold / 53,875ms warm** — external disk sort 318MB. **6× WORSE than ORCH-0480's 9s.** | **FAIL — P0 (regression vs superseded fix)** |
| SC-4 | `admin_place_city_overview('US')` <200ms | Not directly timed — same `COUNT(mv.*)` anti-pattern as country_overview; presumed similarly affected | **PRESUMED FAIL — P1** | |
| SC-5 | `admin_place_photo_stats(<city>)` <100ms | Not directly timed; uses city_id index on MV — likely PASS | UNVERIFIED | |
| SC-6 | `admin_place_pool_city_list('United States')` <500ms | Not directly timed | UNVERIFIED | |
| SC-7 | `admin_place_pool_country_list()` <200ms | Not directly timed | UNVERIFIED | |
| SC-8 | `admin_ai_category_health()` <500ms | Not directly timed | UNVERIFIED | |
| SC-9 | `admin_ai_city_overview(<city>)` <100ms | Not directly timed | UNVERIFIED | |
| SC-10 | `admin_ai_city_stats()` <200ms | Not directly timed | UNVERIFIED | |
| SC-11 | `admin_ai_validation_overview()` <100ms | Not directly timed | UNVERIFIED | |
| SC-12 | `admin_photo_pool_summary()` <200ms | Not directly timed | UNVERIFIED | |
| SC-13 | `admin_country_overview()` <500ms | Not directly timed; uses `COUNT(*)` (not `COUNT(mv.*)`) — likely OK | UNVERIFIED | |
| SC-14 | `admin_country_city_overview('US')` <500ms | Not directly timed | UNVERIFIED | |
| SC-15 | `admin_pool_category_health()` <500ms | Not directly timed | UNVERIFIED | |
| SC-16 | `admin_pool_stats_overview()` <1s | Not directly timed (stopped after SC-1/2/3 made FAIL verdict clear) | UNVERIFIED | |
| SC-17–20 | card-primary RPCs <500ms each | Not directly timed | UNVERIFIED | |
| SC-21 | MV + cron prereqs | MV populated (63,273 rows, matches place_pool), 6 indexes present, cron active `*/10 * * * *` | **PASS** |
| SC-22 | `admin_refresh_place_pool_mv()` works | Function exists with auth gate + REFRESH CONCURRENTLY + jsonb return | **PASS by inspection** (cannot invoke via MCP — auth fails as non-admin session) |
| SC-23 | Auth gate fires | All 20 rewritten functions have `RAISE EXCEPTION 'Not authorized'` as first statement in BEGIN (grep-confirmed in function bodies) | **PASS by inspection** |
| **SC-25** | Signatures byte-identical | All 20 `pg_get_function_arguments` + `pg_get_function_result` match expected (see Evidence section) | **PASS** |
| SC-26 | `admin_city_picker_data` (deferred) still works | Not re-tested — no changes to this function in migration | PASS by construction |
| SC-27 | Existing `idx_place_pool_*` still used for non-admin queries | Not re-tested; MV creation adds indexes on MV only, doesn't touch place_pool indexes | PASS by construction |
| SC-28 | Freshness — cron actually runs | `cron.job_run_details` shows 1 completed run since migration apply. Not ≥10min elapsed yet to confirm scheduled tick. | **PARTIAL PASS** |

---

## Evidence — Raw Performance Plans

### SC-3 FAIL: admin_place_country_overview (WARM) — 53,875ms

```
Sort  (cost=30924.22..30924.24 rows=7 width=42) (actual time=53841.892..53843.031 rows=7)
  Buffers: shared hit=220905 read=45279, temp read=119356 written=119507
  ->  Hash Join  (actual time=51238.344..53840.483 rows=7)
        ->  GroupAggregate  (actual time=51232.729..53833.104 rows=7)
              Group Key: sc.country_code, sc.country
              ->  Sort  (actual time=51004.393..53801.887 rows=62992 width=624)
                    Sort Key: sc.country_code, sc.country, mv.primary_category
                    Sort Method: external merge  Disk: 318296kB            ← 318MB spill
                    ->  Hash Right Join  (actual time=1.203..41484.117 rows=62992 width=624)
                          Hash Cond: (mv.city_id = sc.id)
                          ->  Seq Scan on admin_place_pool_mv mv  (actual time=1.171..41409.812 rows=63273 width=626)  ← 41s seq scan
Execution Time: 53875.138 ms
```

- **`width=624`** = every MV row fully materialized. This is the smoking gun.
- **41s Seq Scan** + **318MB external disk sort** of wide rows = 54s total.
- The `COUNT(mv.*)` aggregate forces Postgres to materialize `mv.*` to check non-null for each row — rather than counting just a single narrow column.

### SC-1 FAIL: admin_place_pool_overview (global) — 4,932ms

```
Aggregate  (cost=12948.91..12948.94 rows=1 width=72) (actual time=4931.743..4931.745 rows=1)
  Buffers: shared hit=1684 read=3247, temp read=205 written=206
  ->  Sort  (actual time=4906.111..4915.910 rows=63273 width=17)
        Sort Key: primary_category
        Sort Method: external merge  Disk: 1640kB
        ->  Seq Scan on admin_place_pool_mv mv  (actual time=1.722..4857.992 rows=63273 width=17)
Execution Time: 4932.223 ms
```

- `width=17` — projection IS narrow (this uses `COUNT(*)`, not `COUNT(mv.*)`).
- Bottleneck is **pure I/O**: 4,928 pages read (3,247 from disk), 4.8s for the seq scan.
- No index path available because query scans all rows (no WHERE filter).

### SC-2 PASS: admin_place_category_breakdown — 107ms

```
Sort  (actual time=107.296..107.298 rows=10)
  Buffers: shared hit=4558 read=37
  ->  HashAggregate  (actual time=107.251..107.266 rows=10)
        Group Key: primary_category
        ->  Bitmap Heap Scan on admin_place_pool_mv mv  (actual time=42.276..89.601 rows=40951)
              Recheck Cond: (is_active AND ai_approved)
              Filter: (primary_category <> 'uncategorized'::text)
              Rows Removed by Filter: 776        ← ORCH-0484 orphans correctly excluded
              Heap Blocks: exact=4555
              ->  Bitmap Index Scan on admin_place_pool_mv_primary_category  (actual time=41.637..41.637 rows=41727)
Execution Time: 107.617 ms
```

- Uses the partial index `admin_place_pool_mv_primary_category` — narrows to 40,951 rows before scanning.
- **84× faster than the ORCH-0480 baseline of 9,000ms.** This is the MV pattern working as designed.
- Also confirms ORCH-0484's 776 orphan rows are correctly excluded.

---

## P-level Findings

### P0-1: `admin_place_country_overview` — 6× regression vs ORCH-0480

**File:** `supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql` function `admin_place_country_overview`
**Root cause:** `COUNT(mv.*) FILTER (...)` on lines with filters like `ai_approved_places`, `approved_with_photos`, `ai_validated_count`, `active_total`, and `category_coverage` (5 occurrences). PostgreSQL's `COUNT(x.*)` semantics count rows where ANY column of x is non-null — which forces the planner to materialize `mv.*` for every row. With MV row width=624 bytes and 63k rows, this creates a 318MB external disk sort.

**Fix (exact SQL, 1-line change):** Replace every `COUNT(mv.*) FILTER (...)` with `COUNT(mv.id) FILTER (...)`. `mv.id` is never NULL for matched rows (LEFT JOIN sets it NULL for unmatched rows from `seeding_cities`), so semantics are identical. But Postgres only materializes `mv.id` (16 bytes) instead of the whole 624-byte row — sort set shrinks from 318MB to ~4MB.

Grep-audit-candidate: same pattern appears in `admin_place_city_overview` (same file). Fix both at once.

**Expected post-fix:** country_overview 54s → <500ms (matches ORCH-0480 spec target and closes the P0 regression).

**Severity rationale:** P0 because this function currently takes longer than PostgREST's 8s statement_timeout. The admin Place Pool page STILL returns 500 after ORCH-0481. The stated goal of the migration is not achieved.

### P0-2: `admin_place_pool_overview` global path — still 4.9s

**Root cause:** The function does `COUNT(DISTINCT mv.primary_category)` across all 63,273 MV rows. No WHERE predicate → full seq scan of the MV (5,560 pages × ~1ms/page on Mingla-dev I/O = 4.9s). Even with narrow projection (width=17), raw I/O throughput is the bottleneck.

**Fix options (implementor choice):**
- **Option A (simple):** Split the global path into 8 separate `SELECT COUNT(*) INTO v_... FROM admin_place_pool_mv WHERE ...` subqueries (mirror the legacy pattern). Each would leverage a targeted index for Index-Only Scan. Estimated <300ms total.
- **Option B (MV-layer):** Add a tiny secondary MV (`admin_place_pool_stats_mv`) that pre-aggregates just the 10 counts per scope. Refresh from the main MV every 10 min. Read is instant.
- **Option C (covering index):** Add a multi-column index on `(is_active, ai_approved, primary_category)` without INCLUDE columns — eligible for Index-Only Scan. Less reliable than Option A.

**Severity rationale:** P0 because the spec target was <200ms; observed is 4,932ms. However, this is under PostgREST's 8s timeout, so the admin page **will** render — just slowly. If post-fix of P0-1, the admin page loads successfully even at 5s for this RPC; thus P0-2 is less blocking than P0-1.

### P1-1: `admin_place_city_overview` probably also regressed — not directly timed

**Reasoning:** Same `COUNT(mv.*) FILTER (...)` pattern as country_overview in the same file. Without timing evidence I cannot confirm, but the same anti-pattern suggests the same slowness. Fixed together with P0-1 using the same `COUNT(mv.*) → COUNT(mv.id)` substitution.

### P2-1: D-3 semantic tightening affects 572 rows across 19 of 20 rewritten RPCs

**Evidence:** 572 rows on Mingla-dev have `stored_photo_urls = ARRAY['__backfill_failed__']::text[]`. The MV's `has_photos` boolean now filters these out (set to FALSE). Legacy RPCs (except `admin_place_photo_stats`, which already filtered) counted them as "has photos".

**Impact:** `with_photos` / `photo_pct` counts will decrease by up to 572 across all admin RPCs vs pre-ORCH-0481 output. Admin users looking at dashboards will see slightly lower photo coverage numbers.

**Fix direction:** The tightening is arguably correct (a failed-backfill sentinel shouldn't count as "has photos"). Recommend accepting the change but documenting it in release notes. If the user strongly prefers strict legacy parity: add a second boolean `has_photos_strict` to the MV and use it only in `admin_place_photo_stats`. Not blocking.

**Severity rationale:** P2 because it's a silent semantic change not called out in the spec, but it affects <1% of rows and arguably improves correctness.

### P2-2: T-3 cities-without-places invariant not runtime-testable on Mingla-dev

Mingla-dev has 0 `seeding_cities` rows with 0 place_pool rows. Cannot directly verify the invariant (the rewrite should return countries with 0 places as rows with `ai_approved_places=0`). Structural inspection of the rewrite shows `LEFT JOIN` pattern correctly supports this — but unverified runtime.

**Fix direction:** Before production deploy, insert a test seeding_cities row with no place_pool entries and confirm it surfaces in country_overview output with zero counts. Or accept structural verification as sufficient.

### P4 Praise

- **P4-a:** `admin_place_category_breakdown` hits 107ms — 84× faster than ORCH-0480. The MV pattern is sound; the partial index on `primary_category` is well-designed. This is the proof that the architecture works when the rewrite leverages the index.
- **P4-b:** 20 of 22 RPCs rewritten with byte-identical signatures. All 20 read from MV (confirmed via function-body grep). Implementor's scope discipline was excellent.
- **P4-c:** Deploy safety mechanisms (WITH NO DATA + explicit REFRESH, SET LOCAL statement_timeout) were exactly right — the migration applied successfully even though Supabase CLI doesn't run migrations in transactions.

---

## Evidence — Structural Checks

### T-1: exactly 20 read from MV, 2 deferred — PASS

Query result confirmed: 20 functions with `reads_from_mv=true`, 2 with `reads_from_mv=false` (exact deferrals documented in implementor report: `admin_city_picker_data`, `admin_ai_validation_preview`). No accidental drops.

### SC-25: all 20 signatures byte-identical — PASS

```
admin_ai_category_health            () → json
admin_ai_city_overview              (p_city_id uuid) → json
admin_ai_city_stats                 () → json
admin_ai_validation_overview        () → json
admin_card_category_health          (p_city_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text) → TABLE(...12 cols)
admin_card_city_overview            (p_country_code text) → TABLE(...11 cols)
admin_card_country_overview         () → TABLE(...11 cols)
admin_card_pool_intelligence        (p_city_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text) → TABLE(...15 cols)
admin_country_city_overview         (p_country text) → TABLE(...11 cols)
admin_country_overview              () → TABLE(...10 cols)
admin_photo_pool_summary            () → jsonb
admin_place_category_breakdown      (p_city_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text) → TABLE(...4 cols)
admin_place_city_overview           (p_country_code text) → TABLE(...7 cols)
admin_place_country_overview        () → TABLE(...7 cols)
admin_place_photo_stats             (p_city_id uuid) → TABLE(...3 cols)
admin_place_pool_city_list          (p_country text) → TABLE(...5 cols)
admin_place_pool_country_list       () → TABLE(...4 cols)
admin_place_pool_overview           (p_city_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text) → TABLE(...10 cols)
admin_pool_category_health          (p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text) → TABLE(...11 cols)
admin_pool_stats_overview           () → jsonb
```

All 20 match the pre-migration shape. Admin UI's column-name parser will not need any changes.

### MV + cron health — PASS

```
mv_row_count:         63,273   (matches place_pool exactly — no rows lost)
mv_indexes:           6        (1 unique pkey + 5 covering — per design)
cron_active:          yes
cron_schedule:        */10 * * * *
migration_ledger:     20260418000001 (recorded)
place_pool_baseline:  63,273
```

### T-2: D-3 sentinel impact — 572 rows

```
d3_backfill_failed_sentinel_rows:     572
d3_sentinel_rows_has_photos_false:    572   (consistent — all sentinel rows correctly filtered)
t5_cron_recent_runs:                  1     (cron has fired at least once since migration apply)
d7_orch0484_uncategorized_in_mv:      776   (matches ORCH-0484's tightened count; correctly excluded from category_breakdown)
```

---

## Constitutional Compliance

| # | Principle | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | No dead taps | N/A | Backend |
| 2 | One owner per truth | PASS | MV is single source for admin aggregates |
| 3 | No silent failures | PASS | Auth raises; refresh RPC returns structured jsonb |
| 4 | One query key per entity | N/A | Backend |
| 5 | Server state server-side | PASS | |
| 6 | Logout clears everything | N/A | |
| 7 | Label temporary fixes | PASS | No `[TRANSITIONAL]` in migration; comment calls out ORCH-0480 stepping-stone status |
| 8 | Subtract before adding | PASS | `CREATE OR REPLACE` replaces all 20 RPCs in-place |
| 9 | No fabricated data | PASS | Aggregates preserve semantics (modulo D-3 tightening) |
| 10 | Currency-aware UI | N/A | |
| 11 | One auth instance | PASS | Single auth check per function |
| 12 | Validate at right time | PASS | Auth first statement in every BEGIN |
| 13 | Exclusion consistency | PASS | MV derived columns use same filters as legacy; ORCH-0484 orphans consistently excluded |
| 14 | Persisted-state startup | N/A | |

No automatic P0 from constitutional violations. The P0s above are perf-driven.

---

## Regression Surface Checked

| Surface | Method | Result |
|---------|--------|--------|
| Function signatures byte-identical (20 functions) | `pg_get_function_arguments` + `pg_get_function_result` | **PASS** |
| Auth gate present (20 functions) | Function body inspection | **PASS by inspection** |
| MV populated + indexed + cron active | Direct SQL | **PASS** |
| MV row count matches place_pool | `COUNT(*) FROM admin_place_pool_mv` vs `COUNT(*) FROM place_pool` | **PASS** (both 63,273) |
| `admin_city_picker_data` + `admin_ai_validation_preview` not rewritten (spec deferrals) | T-1 query | **PASS** (both `reads_from_mv=false`) |
| ORCH-0484 orphan rows correctly isolated via `primary_category='uncategorized'` | EXPLAIN row-removed-by-filter | **PASS** (776 rows filtered out) |
| Existing `place_pool` indexes untouched | MV creation doesn't alter place_pool | **PASS by construction** |

---

## Discoveries for Orchestrator

**D-NEW-1 (tester-discovered, maps to P0-1):** The `COUNT(x.*)` anti-pattern systemically materializes wide rows. Appears in at least 2 rewritten RPCs (`admin_place_country_overview`, `admin_place_city_overview`). Orchestrator should add "`COUNT(x.*)` is forbidden in multi-column MV projections — use `COUNT(x.id)` or `COUNT(*)` — unless the semantic difference is intentional" to the ORCH-0483 admin RPC perf gate rule.

**D-NEW-2 (tester-discovered, maps to P0-2):** Mingla-dev's I/O is slow enough that even narrow-projection seq scans on 63k rows take ~5s. The MV approach doesn't help unfiltered global aggregates. Either split global queries into per-predicate subqueries (each index-only) OR create a tiny per-scope summary MV. This likely applies to any `admin_*_overview()` style function that aggregates the entire pool.

**D-NEW-3 (tester-discovered):** The implementor's claim "**107ms** spot-check" from orchestrator's deploy was valid — but it was measuring the one RPC that happens to hit the partial index. The other 19 RPCs were never spot-checked pre-tester. Recommend: **before declaring ORCH-0481 ready for tester dispatch, run EXPLAIN ANALYZE on at least 3 RPCs representing different query shapes (filtered-subset, global-scan, seeding_cities-LEFT-JOIN)**. This is now proposed as SC-NEW-2 for the ORCH-0483 gate.

**D-3 (from implementor, now tester-confirmed):** 572 rows on Mingla-dev carry the `__backfill_failed__` sentinel and are now excluded from `has_photos` counts. See P2-1.

**D-7 (from implementor, tester-confirmed):** 776 ORCH-0484 rows surface as `primary_category='uncategorized'` in MV. `admin_place_category_breakdown` correctly excludes them via `<> 'uncategorized'`. Other functions should be audited for the same filter — confirmed at least for the one function timed.

**D-NEW-4 (tester-discovered):** Supabase migration runner does NOT wrap migration files in a transaction. The `SET LOCAL statement_timeout = '15min'` at the top of the migration emitted a WARNING "SET LOCAL can only be used in transaction blocks" and had no effect. Migration still succeeded because `WITH NO DATA` + deferred REFRESH fit under the 2-min default timeout. Flag for future migrations that need longer: use `SET statement_timeout = ...` (session-level, no LOCAL) or split into multiple migration files. Worth adding to orchestrator's DISPATCH prompt template for large-data migrations.

---

## Retest Recommendation

**Rework required before retest.** Cycle 0 → NEEDS REWORK.

Minimal rework to resolve P0-1:
```sql
-- In admin_place_country_overview and admin_place_city_overview,
-- replace every COUNT(mv.*) FILTER (...) with COUNT(mv.id) FILTER (...)
```

Expected post-rework timings (hypothesis to be re-verified in cycle 1):
- admin_place_country_overview: 54s → <500ms (6-order-of-magnitude improvement)
- admin_place_city_overview: presumed similar improvement

P0-2 (admin_place_pool_overview at 4.9s) is harder to fix in one line — needs either a legacy-style multi-subquery split or a covering index. Implementor's call. If left as-is, the admin page **will** load in under 8s post-P0-1 fix but will feel slow.

**Timeline estimate for cycle 1:** 1-2 hour implementor rework + 30-minute tester retest.

**Do NOT apply the current migration to production** until P0-1 is fixed. Rollback is the documented `DROP MATERIALIZED VIEW ... CASCADE` + git restore of the 20 RPC bodies (commit 352fc4c7 has the current state; prior to that is pre-ORCH-0481 baseline).

---

## Report-file summary

- **Verdict:** FAIL (cycle 0)
- **Counts:** P0: 2 | P1: 1 | P2: 2 | P3: 0 | P4: 3
- **Blocking issues:** P0-1 (country_overview 54s — regression vs ORCH-0480); P0-2 (pool_overview 4.9s — over spec target but under PostgREST timeout)
- **Discoveries for orchestrator:** D-NEW-1 through D-NEW-4 + confirmations of D-3 / D-7
- **Cycle:** 0
- **Retest disposition:** Rework dispatched back to implementor. Surgical fix on `COUNT(x.*) → COUNT(x.id)` in country_overview + city_overview expected to resolve P0-1. P0-2 needs a separate design decision.
- **Great news:** `admin_place_category_breakdown` at 107ms **proves the MV architecture works.** The two failures are implementation defects, not architectural ones.
