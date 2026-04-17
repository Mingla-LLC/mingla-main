# QA Report — ORCH-0480 Admin Place Pool RPC Performance

**Tester:** mingla-tester
**Date:** 2026-04-17
**Spec:** `Mingla_Artifacts/prompts/IMPL_ORCH-0480_ADMIN_RPC_TIMEOUT.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0480_ADMIN_RPC_PERF_REPORT.md`
**Tester prompt:** `Mingla_Artifacts/prompts/TESTER_ORCH-0480_ADMIN_RPC_PERF.md`
**Environment under test:** Mingla-dev (`gqnoajqerqhnvulmnyvv`)
**Migration state:** Applied (migration `20260417300001_orch0480_admin_rpc_perf` present in migration ledger)

---

## Verdict: **FAIL**

**Counts:** P0: 3 | P1: 1 | P2: 1 | P3: 0 | P4: 3

The migration is structurally correct, the new index is real and used by the planner, function signatures are byte-identical, auth gates are intact, and semantic output looks plausible. **But none of the three RPCs meet their stated performance targets on Mingla-dev.** All three still exceed the PostgREST statement_timeout (~8s), which means the admin Place Pool page will continue to return 500 errors until a stronger fix is applied.

The partial expression index on `ai_categories[1]` accelerates pure filter queries (40,951 → 40ms Index-Only Scan proven below) but cannot accelerate the production RPCs because each one needs **additional columns** (`stored_photo_urls`, `rating`) from the heap, forcing Bitmap Heap Scan + detoast. The planner correctly picks the index but is blocked by the heap-read requirement of the actual aggregates.

**Recommendation:** Do NOT close ORCH-0480. Immediately dispatch **ORCH-0481** (materialized view layer) — the systemic fix that was already scoped. The partial-index approach yielded a ~45% improvement (16.8s → 9s on category_breakdown) but the admin dashboard requires <8s to render at all and ideally <500ms for good UX. Materialized views solve this unconditionally.

---

## Success Criteria Compliance Matrix

| SC | Criterion | Target | Observed | Verdict |
|----|-----------|--------|----------|---------|
| **SC-1** | `admin_place_category_breakdown` returns in <500ms | <500ms | ~9,000ms steady-state (all blocks cached) | **FAIL — P0** |
| **SC-2** | `admin_place_country_overview` returns in <500ms | <500ms | 11,673ms cold / 9,213ms warm | **FAIL — P0** |
| **SC-3** | `admin_place_pool_overview` returns in <2s | <2s | DISTINCT sub-clause alone is 3,934ms warm; full global path is 8 Counts + DISTINCT; estimated ≥5s total | **FAIL — P0** |
| SC-4 | New index is actually used | Index Scan in plan | `Bitmap Index Scan using idx_place_pool_ai_category_first` confirmed in all relevant plans; `Index Only Scan` used for pure COUNT variants | PASS |
| SC-5 | `admin_place_country_overview` semantic parity | Countries, city counts, photo_pct, ai_validated_pct, category_coverage all plausible | Returns 7 countries (US 19441 / FR 5307 / DE 4329 / GB 4190 / ES 3030 / BE 2683 / CA 2612 approved places); 10 categories covered in each; shape matches spec | PASS |
| SC-6 | `admin_place_category_breakdown` semantic parity | Sorted by COUNT DESC, expected columns | 10 rows, ordered correctly (brunch_lunch_casual 12,424 top, flowers 227 bottom); columns `category`, `place_count`, `photo_pct`, `avg_rating` all present | PASS |
| SC-7 | Admin Place Pool page loads without 500 | 200 OK on all 3 RPCs | **Cannot directly verify (no admin UI access), but projected FAIL** — all 3 RPCs exceed PostgREST's ~8s timeout, so page will still 500 | **PROJECTED FAIL — P0 (logical)** |
| SC-8 | Auth gate still fires | `RAISE EXCEPTION 'Not authorized'` | Confirmed in all 3 function bodies as the first statement inside BEGIN | PASS |
| SC-9 | Other admin pages unaffected | No new errors | Not directly exercised; no schema/RLS changes touched other admin surfaces; structural regression surface is zero | PASS (by construction) |
| SC-10 | Existing `idx_place_pool_city_active_approved` still used | Index used for city-scoped queries | City-scoped COUNT uses `Index Only Scan using idx_place_pool_city_active_approved`, Heap Fetches=0, 19ms | PASS |

---

## Evidence — Raw Performance Plans

### Inner query of `admin_place_category_breakdown` (without photo_pct / avg_rating — best case)

Steady-state (warm cache), second pass:

```
HashAggregate  (cost=12285.69..12286.20 rows=51 width=40) (actual time=8964.276..8964.280 rows=10)
  Group Key: ai_categories[1]
  Buffers: shared hit=13866
  ->  Bitmap Heap Scan on place_pool  (cost=87.62..12216.14 rows=13910 width=32) (actual time=5.352..8940.410 rows=40951)
        Recheck Cond: (is_active AND ai_approved AND (ai_categories IS NOT NULL) AND (array_length(ai_categories, 1) > 0))
        Heap Blocks: exact=13829
        Buffers: shared hit=13866
        ->  Bitmap Index Scan on idx_place_pool_ai_category_first  (cost=0.00..84.14 rows=13910 width=0) (actual time=2.727..2.728 rows=40951)
              Buffers: shared hit=37
Execution Time: 8967.537 ms
```

- Index scan: **2.7ms** (extremely fast — the index works as intended).
- Bitmap Heap Scan on 13,829 already-cached heap pages: **8,940ms**. This is the bottleneck. Every row must be re-examined on the heap to project `ai_categories[1]` (even though the index stores that expression) because the planner cannot prove all needed columns are in the index.
- Plus, the real RPC also projects `stored_photo_urls` and `rating` — which make Index-Only Scan impossible regardless of planner cleverness.

### Proof the index CAN be Index-Only-scanned for pure COUNT

```
Aggregate  (cost=258.01..258.02 rows=1 width=8) (actual time=52.979..52.980 rows=1)
  Buffers: shared hit=38
  ->  Index Only Scan using idx_place_pool_ai_category_first on place_pool
      (cost=0.29..223.24 rows=13910 width=0) (actual time=3.784..50.046 rows=40951)
        Heap Fetches: 0
        Buffers: shared hit=38
Execution Time: 53.675 ms
```

53ms for the same 40,951 rows. This is what the implementor's ≤500ms target would look like. But it's ONLY achievable for pure `COUNT(*)` / `COUNT(DISTINCT)` without heap-resident columns. The actual RPCs need heap columns → cannot leverage this path.

### Inner query of rewritten `admin_place_country_overview`

Warm run (place_pool still partly out-of-cache due to 32k+ page size):

```
Sort  ...  (actual time=9200.672..9201.300 rows=7)
  Buffers: shared hit=14481 read=17975, temp read=1248 written=1254
  ->  Hash Join  ...
        ->  GroupAggregate  (actual time=9137.769..9195.831 rows=7)
              ->  Sort  (actual time=9126.585..9144.971 rows=62971)
                    Sort Method: external merge  Disk: 9984kB
                    ->  Hash Right Join
                          ->  Seq Scan on place_pool pp
                                Filter: is_active
                                Rows Removed by Filter: 34
                                (actual time=0.741..8966.764 rows=63239)
Execution Time: 9213.640 ms
```

- **Seq Scan on place_pool** for 8,967ms — reads ~63k rows to project 6 columns (country_code via join, ai_approved, ai_categories, stored_photo_urls, city_id).
- **External disk sort for 9.5MB** — temp files spill because the sort set is too big for work_mem.
- New index is NOT used because the query needs `ai_approved`, `ai_categories`, `stored_photo_urls` for every row in place_pool (not just the 40k matching the partial index).

### `admin_place_pool_overview` global-path DISTINCT sub-query

```
Aggregate  (actual time=3933.436..3933.436 rows=1)
  Buffers: shared hit=24096
  ->  Index Scan using idx_place_pool_ai_category_first on place_pool
      (actual time=2.748..3903.767 rows=40951 width=31)
        Buffers: shared hit=24096
Execution Time: 3934.895 ms
```

- Even using the new index (3.9s) this **single** sub-query is already ~2× the <2s target for the **whole** RPC.
- The global path has 7 more `SELECT COUNT(*)` subqueries that each use their own indexes. Realistic total: 5–10s.

---

## P-level Findings

### P0-1: All three RPCs exceed spec perf targets by 5×–24× on Mingla-dev

**Files:** `supabase/migrations/20260417300001_orch0480_admin_rpc_perf.sql`
**Evidence:** All three EXPLAIN ANALYZE blocks above.
**Impact:** Admin Place Pool page still returns 500s because queries exceed PostgREST ~8s statement_timeout.
**Root cause:** A partial expression index can only accelerate filter-narrowing. All three RPCs project additional columns (`stored_photo_urls`, `rating`, or multi-column aggregates) that require heap reads — which are slow on Mingla-dev (Bitmap Heap Scan on cached pages is still ~8s for 40k rows due to row-width + detoast overhead on `ai_categories` / `stored_photo_urls` arrays).
**Fix direction (not implementor's to solve — escalate to ORCH-0481):** Materialized views keyed by (country, city, category) that pre-compute the aggregates. Daily/10-min refresh via pg_cron. This is already scoped as ORCH-0481.
**Partial credit:** ~45% improvement over the 16.8s pre-migration baseline (16.8s → 9s on category_breakdown). Directionally correct but insufficient.

### P0-2: `admin_place_country_overview` rewrite forces a full Seq Scan + external disk sort

**File:** `supabase/migrations/20260417300001_orch0480_admin_rpc_perf.sql` lines ~110–150 (CTE rewrite)
**Evidence:** "Seq Scan on place_pool pp ... (actual time=0.741..8966.764 rows=63239)" + "Sort Method: external merge Disk: 9984kB"
**Impact:** This rewrite may actually be **slower** than the legacy correlated-subquery version on low-resourced instances because it forces one big sort over 63k rows instead of 49 targeted lookups. The implementor's "1-2s → <500ms" estimate is not supported by post-deploy evidence.
**Root cause:** The `LEFT JOIN place_pool ON city_id = sc.id AND is_active = true` from the `seeding_cities` side can't use any place_pool index because no index covers `(city_id, is_active, ai_approved, ai_categories, stored_photo_urls)` as covering columns for a sort on `(country_code, country)`.
**Fix direction:** Same as P0-1 — escalate to materialized view approach. A narrower alternative would be a composite index on `(city_id, is_active)` with INCLUDE of the aggregate columns, but this only helps if columns are narrow and not TOAST'd — which `stored_photo_urls` and `ai_categories` are not.

### P0-3: SC-7 (admin page loads) is projected FAIL

**Evidence:** All 3 RPCs take 4s–11s on Mingla-dev. PostgREST statement_timeout is typically 8s. `admin_place_category_breakdown` and `admin_place_country_overview` WILL hit the timeout and return 500. `admin_place_pool_overview` is borderline.
**Impact:** The stated intent of ORCH-0480 ("admin Place Pool page loads again") is not achieved on Mingla-dev.
**Caveat:** I cannot directly click the admin UI from here. If the user observes 200 OK on all three RPCs after reload, my timing measurements are wrong (unlikely — EXPLAIN ANALYZE is authoritative server-side timing).

### P1-1: Implementation report's ORCH-0484 orphan-count query has a SQL correctness bug

**File:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0480_ADMIN_RPC_PERF_REPORT.md` line 153-157
**Evidence:** The query `... AND (ai_categories IS NULL OR array_length(ai_categories, 1) = 0)` returns 0 rows because `array_length(empty_array::text[], 1)` returns NULL, not 0, so `NULL = 0` evaluates to NULL (treated as false in WHERE).
**Correct query (verified returns 776 on Mingla-dev):**
```sql
SELECT COUNT(*) FROM place_pool
WHERE is_active = true AND ai_approved = true
  AND COALESCE(array_length(ai_categories, 1), 0) = 0;
```
**Impact:** Not a code bug — a documentation/measurement bug. The partial-index predicate in the migration is semantically CORRECT (`... array_length > 0` is the right sieve). Only the report's diagnostic example query is wrong. Should be corrected inline so future readers don't copy a broken query.
**Note:** Finding validates ORCH-0484. All 776 orphan rows on dev are empty arrays (`ai_categories = '{}'`), **none are NULL**. This is more specific than the original ORCH-0484 registration.

### P2-1: `admin_place_country_overview` external-merge sort is an operational warning sign

**Evidence:** `Sort Method: external merge  Disk: 9984kB, temp read=1248 written=1254`
**Impact:** Every call writes ~10MB to temp files. Under concurrent admin sessions this amplifies I/O pressure. Not a correctness bug but poor behavior for a function expected to be called on every admin page load.
**Fix direction:** Bumping work_mem for this session or rewriting the aggregate to avoid the sort. Moot once ORCH-0481's materialized view replaces this function body.

### P4 Praise

- **P4-a:** Function signature byte-identity maintained — `pg_get_function_arguments()` and `pg_get_function_result()` return values match spec exactly. Admin UI needs zero changes. (Verified via `pg_proc` introspection.)
- **P4-b:** Auth gate remains the **first** statement in the rewritten function body, before any data computation. Matches invariant-#12 ("validate at the right time"). (Verified by reading `pg_get_functiondef` output.)
- **P4-c:** The partial index predicate is correctly tuned — it matches the WHERE clause of the slow query exactly, and it successfully excludes the 776 orphan empty-array rows without needing a separate data cleanup. Under pure filter pressure (no column projection) the index achieves 53ms on 40k rows via Index-Only Scan.

---

## Semantic Parity Evidence

### `admin_place_country_overview` output (all 7 rows)

| country_code | country_name | city_count | ai_approved_places | photo_pct | ai_validated_pct | category_coverage |
|--------------|--------------|------------|--------------------|-----------|------------------|-------------------|
| US | United States | 10 | 19,441 | 46 | 89 | 10 |
| FR | France | 1 | 5,307 | 0 | 100 | 10 |
| DE | Germany | 1 | 4,329 | 0 | 100 | 10 |
| GB | UK | 1 | 4,190 | 100 | 100 | 10 |
| ES | Spain | 1 | 3,030 | 0 | 100 | 10 |
| BE | Belgium | 1 | 2,683 | 21 | 76 | 10 |
| CA | Canada | 1 | 2,612 | 0 | 100 | 10 |

**Total ai_approved across 7 countries: 41,592.** Global `is_active AND ai_approved` count is 41,727 (context query). Discrepancy of 135 rows = places with a `city_id` that doesn't exist in `seeding_cities`. This matches the **legacy function's behavior** (it also keyed off seeding_cities) — not a regression from the rewrite.

Note: FR/DE/ES/CA show 0% photo_pct on dev. Probably a dev-data state (photo backfill hasn't run for these countries). Not related to the migration.

### `admin_place_category_breakdown` output (all 10 rows)

| category | place_count | photo_pct | avg_rating |
|----------|-------------|-----------|------------|
| brunch_lunch_casual | 12,424 | 39 | 4.4 |
| nature | 8,308 | 34 | 4.4 |
| icebreakers | 6,443 | 33 | 4.5 |
| drinks_and_music | 5,168 | 30 | 4.4 |
| creative_arts | 3,510 | 27 | 4.6 |
| movies_theatre | 2,132 | 24 | 4.5 |
| groceries | 1,003 | 32 | 4.1 |
| upscale_fine_dining | 907 | 29 | 4.5 |
| play | 829 | 26 | 4.6 |
| flowers | 227 | 23 | 4.2 |

Total: 40,951 (matches partial-index EXPLAIN). 10 categories = current Mingla 10-category reality. Correctly sorted by `COUNT DESC`.

---

## Constitutional Compliance

| # | Principle | Verdict | Notes |
|---|-----------|---------|-------|
| 1 | No dead taps | N/A | Backend |
| 2 | One owner per truth | PASS | Single migration authoritative |
| 3 | No silent failures | PASS | Auth check raises exception, doesn't return empty |
| 4 | One query key per entity | N/A | Backend |
| 5 | Server state server-side | PASS | N/A change from legacy |
| 6 | Logout clears everything | N/A | |
| 7 | Label temporary fixes | PARTIAL | The migration comment correctly names this an "emergency narrow fix" and references ORCH-0481 as the permanent fix. But there is no `[TRANSITIONAL]` marker in code. Acceptable since the next-steps doc trail is clear, but strictly by the letter of the rule this could be flagged. |
| 8 | Subtract before adding | PASS | `CREATE OR REPLACE FUNCTION` replaces in-place |
| 9 | No fabricated data | PASS | No fake values |
| 10 | Currency-aware UI | N/A | |
| 11 | One auth instance | PASS | Single auth check preserved |
| 12 | Validate at right time | PASS | Auth check is first statement |
| 13 | Exclusion consistency | PASS | Index predicate and query predicate match exactly |
| 14 | Persisted-state startup | N/A | |

No automatic P0 from constitutional violations.

---

## Regression Surface Actually Tested

| Surface | Method | Result |
|---------|--------|--------|
| `idx_place_pool_city_active_approved` still used for city-scoped queries | EXPLAIN ANALYZE with specific city | **PASS** — Index Only Scan, Heap Fetches=0, 19ms |
| Function signatures byte-identical | `pg_get_function_arguments` + `pg_get_function_result` | **PASS** — args "" (no params), RETURNS TABLE columns exactly match spec |
| Function attributes preserved | `pg_proc.provolatile` / `prosecdef` / `proconfig` | **PASS** — STABLE, SECURITY DEFINER, search_path=public on all three |
| No other admin_place_* functions modified | `pg_get_functiondef` of others | **PASS — by construction** (migration only touches country_overview) |
| Auth gate present in all three | Function body inspection | **PASS** — first statement in every BEGIN |
| Mobile deck pipeline unaffected | N/A (no overlapping code paths) | **PASS — by construction** |

---

## Environment Caveat (Important)

Measurements above are from **Mingla-dev**. I cannot directly measure production. Key uncertainties:

1. **If production has faster I/O** (larger instance, more shared_buffers, better disk), the Bitmap Heap Scan may complete in much less time than 8s. In that case SC-1 through SC-3 might pass on prod. However, the post-migration times would still be **bounded below by the Index Only Scan baseline** (which was 53ms for the pure filter but irrelevant because real RPCs need heap columns). The realistic best case on prod would be ~1–3s for category_breakdown — still above the <500ms target, but potentially under the 8s PostgREST timeout. That would mean the admin UI loads (no 500) but slowly.
2. **If production has the same I/O characteristics as dev**, the admin page will continue to 500 and ORCH-0480 has not achieved its primary goal.
3. **Row counts on dev match the implementor's cited baseline exactly** (63,239 active / 41,727 approved / 40,951 in partial index). So there's no data-volume difference between environments that would explain a large perf delta.

**Recommendation to orchestrator:** Before deciding ORCH-0480's fate, run an identical EXPLAIN ANALYZE against production to establish the actual post-deploy perf on the instance the admin UI points at. If prod results are also >8s, the admin page is still broken and ORCH-0481 must ship. If prod results are <8s, ORCH-0480 is a partial win and ORCH-0481 can ship at non-emergency priority.

---

## Discoveries for Orchestrator

**D-1 (confirms implementor's D-1):** `admin_place_pool_overview` was not rewritten and my measurements confirm its DISTINCT sub-clause alone runs 3.9s on warm cache. The other 7 COUNT subqueries are fast (Index-Only Scans), but the DISTINCT alone makes the full global path likely ≥5s. **Follow-up migration IS needed** if ORCH-0480 is to close on its own merits. But — again — better to skip this follow-up and ship ORCH-0481 (MV layer) instead.

**D-2 (validates ORCH-0484):** 776 rows on Mingla-dev have `is_active=true AND ai_approved=true` but `ai_categories = '{}'` (empty array). **ZERO are NULL** — all 776 are empty arrays. This is a more precise formulation than the original ORCH-0484 registration. ORCH-0484 registration should be updated to say "empty array" rather than "NULL/empty". The implementor's D-2 diagnostic query in the implementation report is buggy (hits the same Postgres-NULL-semantics gotcha that tricked me initially).

**D-3 (new, tester discovery):** The rewrite of `admin_place_country_overview` produces an **external disk sort** (9984kB spilling to temp files) on every call. Even after ORCH-0481 replaces this function with an MV-backed version, the current implementation is a noticeable I/O amplifier. Not a correctness bug but worth noting in the ORCH-0481 scoping — that spec should explicitly subsume this function (not just the three ORCH-0480 RPCs).

**D-4 (new, tester discovery):** `admin_place_country_overview` rewrite may be **slower than the legacy version** on low-I/O instances. The legacy did 49 small targeted scans; the rewrite does 1 large Seq Scan. Postgres + storage layer can handle small-N scans better than a single 63k-row Seq Scan when dead tuples are few (0 on dev) and indexes are well-placed. Impossible to verify without a legacy-function comparison. Adds urgency to the ORCH-0481 MV approach.

**D-5 (new, tester discovery):** The migration comment claims "Heap Blocks: exact=13829" implies the index is successful — and it is, for narrowing. But the bottleneck is NOT the index, it's the heap visit for column projection. The spec/report should be amended to acknowledge that a single partial expression index is fundamentally insufficient for aggregate RPCs that project heap-resident columns. This may influence how ORCH-0483 (the perf-gate process rule) is written — the rule should require EXPLAIN ANALYZE of the **actual function**, not just of the inner narrow query.

---

## Fix Instructions (for next agent dispatch)

### Option A (Recommended) — Skip rework of ORCH-0480; dispatch ORCH-0481 as priority

Stop trying to make the partial-index approach work. Go straight to the materialized view layer at `Mingla_Artifacts/prompts/IMPL_ORCH-0481_ADMIN_MV_LAYER.md`. Acceptance criteria: each of the 3 RPCs returns <500ms regardless of pool size. Expected implementation time: similar to ORCH-0480 (single migration). Expected outcome: admin Place Pool page loads under 1s.

**Caveat:** ORCH-0481 trades some freshness for speed (admin sees data that's up to 10–30 minutes stale). Confirm that's acceptable for the admin use case. If real-time is required, use triggers to invalidate the MV on place_pool writes.

### Option B — Minor-rework ORCH-0480

Only pursue this if ORCH-0481 is not feasible for some reason. Changes that might help (untested):

1. Replace the CTE rewrite of country_overview with a pre-aggregated temp table created at function start. Reduces per-row heap work if the planner picks a hash aggregate.
2. Add a covering index: `CREATE INDEX ... ON place_pool (city_id, is_active, ai_approved) INCLUDE (ai_categories, stored_photo_urls, rating) WHERE is_active AND ai_approved = true`. This could let admin_place_country_overview and admin_place_category_breakdown do Index-Only Scans — but INCLUDE doesn't work well with array/text[] TOAST'd columns, so may not pan out. **Test on dev before committing.**
3. Bump work_mem for the function via `SET LOCAL work_mem = '32MB'` to avoid the external disk sort in country_overview. This is a band-aid, not a fix.

### What MUST change in ORCH-0480 report / artifacts

1. Correct the D-2 diagnostic query in `IMPLEMENTATION_ORCH-0480_ADMIN_RPC_PERF_REPORT.md` to use `COALESCE(array_length(ai_categories, 1), 0) = 0` instead of `array_length(...) = 0`.
2. Update the ORCH-0484 World Map entry to specify "empty array `{}`, NOT NULL — 776 rows on Mingla-dev confirmed".
3. Acknowledge in the report that post-deploy targets were NOT met on Mingla-dev.

---

## Retest Recommendation

**Do not retest ORCH-0480 in its current form.** The approach is architecturally under-powered for the data volume. Retesting will produce the same FAIL verdict.

**Instead:** Retest after ORCH-0481 ships. That is the cycle worth spending a retest on.

---

## Report-file summary

- **Verdict:** FAIL
- **Counts:** P0: 3 | P1: 1 | P2: 1 | P3: 0 | P4: 3
- **Blocking issues:** P0-1 (all 3 RPCs miss perf target), P0-2 (country_overview rewrite may be slower than legacy on low-I/O instances), P0-3 (admin page projected to still 500)
- **Discoveries for orchestrator:** D-1, D-2 (validates ORCH-0484), D-3, D-4, D-5
- **Cycle:** 0 (first test pass post-implementation)
- **Retest disposition:** Escalate to ORCH-0481 instead of retesting ORCH-0480.
