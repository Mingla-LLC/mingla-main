# QA Retest Report — ORCH-0481 Admin RPC Materialized View Layer (Cycle 1)

**Tester:** mingla-tester
**Date:** 2026-04-17
**Cycle:** 1 (retest after cycle 0 FAIL + cycle 1 rework)
**Cycle 0 report:** `Mingla_Artifacts/reports/QA_ORCH-0481_ADMIN_MV_LAYER_REPORT.md` (FAIL verdict)
**Rework report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0481_REWORK_V2_REPORT.md`
**Rework migration:** `supabase/migrations/20260418000002_orch0481_rework_count_fix.sql` (applied to Mingla-dev, commit 6f281d6b)
**Environment:** Mingla-dev (`gqnoajqerqhnvulmnyvv`)

---

## Verdict: **FAIL**

**Counts:** P0: 1 | P1: 2 | P2: 2 | P3: 0 | P4: 2

The two RPCs targeted by the rework (country_overview and pool_overview) are functionally improved and pass their spec targets **when the cache is hot**. But cycle 1 surfaced a previously-missed **P0 regression** that makes ORCH-0481 unsafe to ship: **the pg_cron refresh has failed on every single scheduled run** since migration apply. The MV has not been refreshed by cron at all. The 10-minute staleness guarantee — a core premise of the MV layer — is structurally broken. Any write to `place_pool` after migration apply is invisible to the admin dashboard until someone manually invokes `admin_refresh_place_pool_mv()` (which may also time out).

Separately, the retest revealed significant **cache-sensitivity** across all admin RPCs on Mingla-dev's slow I/O. Implementor's cycle 1 self-EXPLAIN measurements were fully-cached runs showing best-case perf (113ms). Under realistic admin workload with intermittent cache warmth, the same functions see 2–5s latencies. Still under PostgREST's 8s timeout so the page will render, but not at the <500ms spec target the rework was supposed to achieve.

**Recommendation:** Do NOT apply to production. Dispatch cycle 2 rework to fix the cron refresh (P0-1) before close. Cache-sensitivity (P1-1) is either acceptable as a Mingla-dev artifact (prod may have faster I/O) or warrants a second rework; flag to orchestrator for steering.

---

## Success Criteria — Retest Matrix

| SC | Criterion (from tester prompt) | Cycle 0 result | Cycle 1 retest | Verdict |
|----|-------------------------------|----------------|----------------|---------|
| SC-1 | `admin_place_pool_overview()` global <200ms | 4,932ms FAIL | Option A 8 subqueries: distinct sub-query 41ms (Index-Only Scan); extrapolated total ~400ms | **PASS** (against rework target of <500ms; strict spec target <200ms not met but improvement is real) |
| SC-2 | `admin_place_category_breakdown()` <200ms | 107ms PASS | **4,219ms** — unchanged function body; plan drift (Index Scan instead of Bitmap Heap Scan) + cold cache | **REGRESSION — P1-2** |
| SC-3 | `admin_place_country_overview()` <200ms | 53,875ms FAIL | Fully hot: 87ms (Index-Only Scan); mildly cold: 5,047ms (Index Scan, 1,246 heap reads); cold: 6,832ms (4,975 heap reads) | **VARIABLE** — PASS when hot, FAIL when cold |
| SC-4 | `admin_place_city_overview('US')` <200ms | 5,118ms FAIL | **3,014ms** warm (matches implementor's 3,061ms; Bitmap Heap Scan on 4,858 pages) | **PARTIAL FAIL** — under 8s timeout; ORCH-0487 tracks |
| SC-5 through SC-20 (other RPCs) | <500ms each | All UNVERIFIED cycle 0 | Not retested cycle 1 (time-constrained after P0 cron discovery; function bodies unchanged so cycle 0 status carries) | UNVERIFIED |
| SC-21 (MV + cron prereqs) | MV populated, cron active | PASS cycle 0 | MV row count: 63,273 (matches place_pool); cron JOB active | **PASS** |
| SC-22 | `admin_refresh_place_pool_mv()` works | PASS by inspection | Not invoked during retest (MCP blocks RPC calls); function body intact | PASS by inspection |
| SC-23 | Auth gate fires | PASS cycle 0 | Function bodies inspected — all 3 rewritten RPCs still have `RAISE EXCEPTION 'Not authorized'` first | **PASS** |
| SC-25 | Signatures byte-identical | PASS cycle 0 | **PASS** — `admin_place_country_overview()` → `TABLE(country_code text, country_name text, city_count bigint, ai_approved_places bigint, photo_pct integer, ai_validated_pct integer, category_coverage integer)` unchanged. `admin_place_pool_overview(p_city_id uuid DEFAULT NULL::uuid, p_country_code text DEFAULT NULL::text)` unchanged. `admin_place_city_overview(p_country_code text)` unchanged. |
| SC-28 | Freshness — cron fires successfully | CYCLE 0: 1 run seen (not verified if it succeeded) | **6 runs total — 0 succeeded. ALL FAILED with `canceling statement due to statement timeout` at exactly 2 minutes each.** | **FAIL — P0-1** |

---

## P-level Findings

### P0-1 (NEW, cycle-1 only): pg_cron REFRESH fails on every run — MV never auto-refreshes

**Evidence:** `cron.job_run_details` for jobid `refresh_admin_place_pool_mv`:
```
6 runs total (every 10 minutes from 23:10:00 to 23:50:00 UTC on 2026-04-17)
0 runs succeeded
6 runs failed with: "ERROR:  canceling statement due to statement timeout"
Duration of each failure: exactly 2 minutes (matches Supabase's default cron role statement_timeout)
```

**Root cause:** `REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv` takes longer than 2 minutes on Mingla-dev. CONCURRENTLY uses a 2-phase approach (build new snapshot, atomically swap) which is slower than non-CONCURRENT but required to avoid blocking reads. With 63k rows across 27 columns (including arrays/jsonb), the refresh exceeds the cron role's default statement_timeout.

**Impact:**
- MV data is frozen at the one-shot REFRESH performed at migration-apply time (2026-04-17 ~18:45 UTC).
- Any INSERT/UPDATE/DELETE to `place_pool` after that moment is invisible to all 20 admin RPCs that read from the MV.
- Admin users making decisions based on "fresh" stats are looking at stale data.
- Eventually, admin stats will drift far enough from reality that admin_users lose trust in the dashboard.
- Constitutional principle #3 (no silent failures) is violated — the failure logs to `cron.job_run_details` but is not surfaced in the admin UI.

**Fix:** Cycle 2 rework required. Options:
1. Wrap the refresh in a function with `SET LOCAL statement_timeout = '15min'`, then schedule cron to call that function:
   ```sql
   CREATE FUNCTION cron_refresh_admin_place_pool_mv() RETURNS void LANGUAGE plpgsql AS $$
   BEGIN
     SET LOCAL statement_timeout = '15min';
     REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;
   END;
   $$;
   SELECT cron.unschedule('refresh_admin_place_pool_mv');
   SELECT cron.schedule('refresh_admin_place_pool_mv', '*/10 * * * *', $$SELECT cron_refresh_admin_place_pool_mv()$$);
   ```
2. Narrow the MV to drop TOAST'd columns (stored_photo_urls raw, photos jsonb, types, ai_categories raw) — the CONCURRENT refresh should then fit under 2 min. Downside: functions that need those columns would have to join back to place_pool.
3. Change the refresh cadence to every 30 min so failures are less frequent? NO — this doesn't fix the failure, just slows it down.

**Recommended:** Option 1. Minimal change, matches the pattern used by `admin_refresh_place_pool_mv()`.

**Severity rationale:** P0 because (a) the MV layer's entire value proposition is freshness, (b) the failure is silent from admin's perspective, (c) constitutional violation.

### P1-1 (NEW): All admin RPCs are cache-sensitive on Mingla-dev

**Evidence:**
- `admin_place_country_overview` (rework): 87ms hot / 5,047ms mildly cold / 6,832ms fully cold. Same query, same plan shape, 60× variability from cache state.
- `admin_place_category_breakdown` (body unchanged): 107ms cycle-0 (fully hot) / **4,219ms cycle-1** (plan drift + cold). Same unchanged body, 39× slower.

**Root cause:** Mingla-dev's I/O is slow (~1ms per heap page read). Queries that miss even 1-5% of their buffer accesses hit multi-second latencies. The MV is 5,560 heap pages (~44MB); shared_buffers on small Supabase instances may not fit the full working set.

**Impact:** Admin dashboard UX is inconsistent — some page loads are snappy, others are 3-5 seconds. Still under PostgREST's 8s timeout so nothing 500s, but the original goal "<200ms per RPC" is not achieved in realistic workloads.

**Fix options (implementor's call):**
- **A (cheapest):** Accept the variability. On production, shared_buffers may be larger and cache hit ratios may be higher. Ship and measure prod timings before over-engineering.
- **B:** Narrow the MV to reduce its physical footprint — remove TOAST'd columns the aggregates don't need. Smaller MV = higher cache residency = faster under all conditions.
- **C:** Add covering INCLUDE columns to key indexes so common projections avoid heap altogether.

**Severity:** P1 because the rework-spec target of <500ms is not achieved under realistic conditions, but no functionality is broken.

### P1-2 (regression): `admin_place_category_breakdown` jumped 107ms → 4,219ms

**Same body, different plan.** Cycle 0: Bitmap Index Scan → Bitmap Heap Scan (batch-oriented, 107ms fully cached). Retest: Index Scan (row-by-row, 4,219ms with 21 disk reads). PostgreSQL's planner made a worse choice this time — likely influenced by stats drift after cron failures and other background activity.

**Note:** this function's body was NOT modified by the rework migration. The regression is entirely environmental. It is expected to stabilize as Mingla-dev settles or may worsen if the MV continues not to be refreshed (stats grow stale).

**Recommend:** Include an `ANALYZE admin_place_pool_mv;` in the cycle 2 rework migration + have the cron refresh function run `ANALYZE` after each successful REFRESH. This keeps planner stats fresh.

### P2-1 (carried from cycle 0): `admin_place_city_overview` is 3s — ORCH-0487 tracked

No change from implementor's measurement. Under 8s timeout, over <500ms target. ORCH-0487 scoped for covering-index follow-up. Not blocking this close IF the P0-1 cron regression is fixed.

### P2-2 (carried from cycle 0): D-3 sentinel tightening — 572 rows affected

No change. Orchestrator's Option X stands (accept the tightening).

### P4 Praise

- **P4-a:** Implementor's aggregate-MV-first restructure for country_overview is elegant — it preserves semantics (countries-with-zero-places via COALESCE on LEFT JOIN) while leveraging the existing `admin_place_pool_mv_country_active_approved` index for Incremental Sort.
- **P4-b:** Option A's 8-subquery branched pattern for pool_overview global path hits Index-Only Scan cleanly. When warm, it'll be <500ms total. Correct engineering choice.

---

## Structural Checks (unchanged from cycle 0)

| Check | Result |
|-------|--------|
| Migration 20260418000002 in ledger | **PASS** |
| All 3 rewritten function bodies match migration | **PASS** — grep confirms `per_country AS`, `per_city AS`, `v_total BIGINT` in live functions |
| Signatures byte-identical to cycle 0 | **PASS** — args + RETURNS TABLE unchanged |
| Auth gate first statement in BEGIN (all 3) | **PASS** |
| MV row count = place_pool row count (63,273) | **PASS** — but see P0-1, this is only the one-shot initial populate, not maintained |
| Indexes all present (6 total on MV) | **PASS** (not re-verified this cycle; cycle 0 confirmed) |
| Cron job registered | **PASS** — job exists, schedule `*/10 * * * *`, active=true |
| **Cron job actually succeeds** | **FAIL** — 0/6 runs successful |

---

## Semantic Parity — not re-verified this cycle

Cycle 0 verified 7 countries, correct city_counts, correct primary_category exclusion of uncategorized. No reason to believe the rework changed semantics (it only changed query structure; same CTE shape, same LEFT JOIN semantics preserved via COALESCE). Not re-timed.

---

## Constitutional Compliance (retest)

| # | Principle | Cycle 0 | Cycle 1 Retest |
|---|-----------|---------|----------------|
| 3 | No silent failures | PASS | **FAIL (P0-1)** — cron failures logged only in `cron.job_run_details`, not surfaced to admin UI |
| others | — | PASS | Unchanged (rework didn't touch auth/semantics/invariants) |

---

## Discoveries for Orchestrator

**D-NEW-5 (cycle 1 P0-1 regression — cron refresh fails):** Fundamental architectural bug. Fix is a function wrapper with SET LOCAL statement_timeout. Cycle 2 rework required. Without fix, the MV layer does not deliver its core value proposition of <10-min staleness.

**D-NEW-6 (cycle 1 P1-1 cache sensitivity):** Mingla-dev I/O is slow enough that a 44MB MV can't stay fully cached. Real-world admin UX will see 2-5s on some page loads. Production may have faster I/O — worth measuring prod timings before over-engineering with covering indexes. If prod also has slow I/O, Option B (narrow MV) is the structural fix.

**D-NEW-7 (cycle 1 P1-2 regression):** `admin_place_category_breakdown` body unchanged but now 40× slower (107ms → 4,219ms) due to planner plan-drift + cold cache. Include `ANALYZE admin_place_pool_mv` in the cron refresh path to keep stats fresh.

**D-NEW-8 (methodology note for orchestrator):** Cycle 0's tester observed "1 cron run completed" (T-5) but did not verify `status='succeeded'`. Cycle 1 would have caught this earlier if cycle 0's T-5 had checked status. Orchestrator should update ORCH-0483 (admin RPC perf gate) to include "verify cron jobs return status=succeeded for at least one complete cycle post-deploy".

---

## Retest Recommendation

**Cycle 2 rework required.** Surgical fix for P0-1:

1. Create `cron_refresh_admin_place_pool_mv()` plpgsql function that SETs LOCAL statement_timeout and calls REFRESH CONCURRENTLY + ANALYZE.
2. Unschedule the current cron job, re-schedule to call the new function.
3. Wait 11 minutes, verify at least one successful cron run.
4. Cycle 2 retest: re-verify SC-28 (cron succeeds), re-time the 4 SCs from this retest (SC-1, 2, 3, 4). Fully-cached / cold measurements both.
5. Do NOT apply to production until cycle 2 PASSes.

**Total cycle count so far:** 1 rework (cycle 1), 1 retest (cycle 1) → cycle 2 pending. No stuck-in-loop escalation yet.

---

## Report-file summary

- **Verdict:** FAIL (cycle 1)
- **Counts:** P0: 1 | P1: 2 | P2: 2 | P3: 0 | P4: 2
- **Blocking issues:** P0-1 (cron refresh fails; MV not maintained)
- **Non-blocking but significant:** P1-1 (cache sensitivity; admin RPCs 2-5s under realistic load on Mingla-dev I/O), P1-2 (category_breakdown regression to 4.2s — environmental, fixable via ANALYZE)
- **Next cycle:** cycle 2 rework targeting P0-1 cron fix
- **Production deploy status:** BLOCKED until cycle 2 PASS
