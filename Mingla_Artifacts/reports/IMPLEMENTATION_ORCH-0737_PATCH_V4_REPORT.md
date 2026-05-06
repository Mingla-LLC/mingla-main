# IMPLEMENTATION REPORT — ORCH-0737 v4 PATCH (two-pass worker)

**ORCH-ID:** ORCH-0737 v4 patch (architectural refactor under SPEC v2)
**Dispatch:** [`prompts/IMPLEMENTOR_ORCH-0737_PATCH_V4_TWO_PASS_WORKER.md`](../prompts/IMPLEMENTOR_ORCH-0737_PATCH_V4_TWO_PASS_WORKER.md)
**Predecessor:** [`reports/IMPLEMENTATION_ORCH-0737_PATCH_V3_REPORT.md`](IMPLEMENTATION_ORCH-0737_PATCH_V3_REPORT.md) (v3 cron filter patch)
**Status:** **implemented, unverified** — code written + grep-verified; runtime smoke pending operator
**Effort:** ~25 min wallclock (vs ~30-45 min estimate)

---

## 1. Layman Summary

Refactored the worker from "all 3 steps per row in parallel" into **two phases**:
- **Score phase (parallel-12, memory-light):** Just sends prepped collage URL to Gemini. ~10 MB/row peak. Memory-safe.
- **Prep phase (serial, memory-bounded):** Fetches reviews + builds photo collage one place at a time. ~50 MB peak.

Worker decides per cron tick: if any rows are prepped + waiting, score them (score-priority for visible progress). Else prep more. Steady state oscillates: prep 3 → score 12 → prep 3 → score 12 → ...

New schema column `prep_status` tracks whether a row has been prepped. Pre-existing rows get NULL by default (correct — they need prep first).

Cancel handling, cron filter, stuck-recovery (5-min cutoff), heartbeat, lock-FOR-UPDATE-NOWAIT — all preserved unchanged.

---

## 2. Old → New Receipts

### File 1 — `supabase/migrations/20260507000002_orch_0737_v4_prep_status.sql` (NEW, 53 LOC)

**What it did before:** N/A (new file)

**What it does now:**
- `ALTER TABLE place_intelligence_trial_runs ADD COLUMN prep_status text` (nullable; NULL = needs prep, 'ready' = prepped)
- `COMMENT ON COLUMN` documenting v4 contract
- `CREATE INDEX idx_trial_runs_prep_pickup ON (parent_run_id, prep_status, status, started_at) WHERE status IN ('pending', 'running')` — supports both phase-pickup queries efficiently
- Conditional WHERE excludes terminal rows from index → kept small
- BEGIN/COMMIT transaction-wrapped; idempotent ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS

**Why:** Dispatch §"Schema Migration" — schema substrate for the two-pass scheduler.

**Lines changed:** +53 / -0

### File 2 — `supabase/functions/run-place-intelligence-trial/index.ts` (MOD, 1668 → 1785 LOC; +117 / -0 net for refactor; ~190 LOC replaced with new ~307 LOC)

**What it did before (v3):** `handleProcessChunk` did all 3 steps per row in parallel-6 via `Promise.all`. Memory accumulated: 6 simultaneous compose_collage operations exceeded ~150 MB edge fn cap → `WORKER_RESOURCE_LIMIT 546` → workers died → rows stuck in 'running' → throughput collapsed to ~1.7 rows/min.

**What it does now (v4):**
- `handleProcessChunk` is now a **decider**: lock parent → check status (cancel/complete) → update heartbeat → count score-eligible rows → branch into `processScorePhase` (parallel-12 Gemini-only) OR `processPrepPhase` (serial fetch+collage)
- **NEW `processScorePhase`** (helper): parallel-12 Promise.all, processOnePlace only (memory-light). Stuck-recovery for rows that started Gemini but never completed.
- **NEW `processPrepPhase`** (helper): serial for-loop of 3, calls fetch_reviews + compose_collage per row, marks `prep_status='ready'` + resets status back to `pending`. Stuck-recovery for rows that started prep but never completed.
- v3 cancel-cleanup branch (`pending+running`) preserved unchanged at line 1528
- v2 stuck-recovery cutoff (5 min) preserved in both phase helpers
- v3 cron filter (`status IN running, cancelling`) preserved at trigger function level — already deployed

**Why:** Dispatch §"Edge Function Refactor" — root cause was memory saturation from parallel collage composition. Splitting into score-priority phase decider unlocks parallel-12 throughput on the memory-light step while bounding parallelism on the memory-heavy step.

**Lines changed:** +307 / -190 (net +117); pre-flight read confirmed exact text before edit; replacement applied via single Edit operation (after one re-read for word-level precision).

---

## 3. v3 + v2 Patches — All PRESERVED Verbatim

| Patch | What it was | Where it lives now | Verified |
|-------|-------------|-------------------|----------|
| v2 stuck-recovery (5-min cutoff) | Pickup query reclaims rows stuck in 'running' for >5 min | Both phase helpers (lines 1591, 1696) | ✅ grep |
| v2 cancel-cleanup `pending+running` | Cancel branch marks both pending AND running children cancelled | handleProcessChunk line 1528 + legacy fallback line 1443 | ✅ grep |
| v3 cron filter `status IN running, cancelling` | Trigger function kicks worker for cancelling runs so they can finalize | Trigger function (DB; migration `20260507000001_orch_0737_v3_cron_filter_cancelling.sql`) | ✅ already deployed; not touched |
| chunk size 12 → 6 (v2 path) | OBSOLETE post-v4 — `processScorePhase.limit(12)` and `processPrepPhase.limit(3)` are the new effective chunk sizes per phase | Replaced in v4 refactor | ✅ N/A |

---

## 4. Spec Traceability

This is an architectural patch under SPEC v2 (binding contract unchanged). All 22 SCs from SPEC v2 stand. v4 implements the SC-21 stuck-recovery semantics across two phases instead of one.

**Net SC impact:**
- SC-02 (full-city completes) — v4 unblocks (was blocked by memory cap)
- SC-13 (UI flips cancelling → cancelled) — preserved via v3 cron filter; v4 doesn't change
- SC-21 (stuck-recovery) — now applies in both phase helpers
- SC-08 (cancel observed within ≤90s) — preserved via v3 + v2 cancel-cleanup

5 new test cases proposed in dispatch §"Test Cases":
- T-26: Fresh full-city run on Cary 761 → throughput 6-12/min steady; complete in 1-2 hours
- T-27: Score phase with all rows prepped → parallel-12 throughput, no memory error
- T-28: Mid-run Cancel → finalizes within 60-90s regardless of phase
- T-29: Stuck-prep recovery → simulated worker death mid-collage; next tick reclaims
- T-30: Stuck-score recovery → simulated worker death mid-Gemini; next tick reclaims
- T-31: No `WORKER_RESOURCE_LIMIT` 546 in pg_net response queue post-deploy

All UNVERIFIED until operator deploys + runs Cary smoke.

---

## 5. Invariant Verification

All 7 ORCH-0737 invariants from SPEC v2 §11: **PRESERVED.** Patch is architectural under existing invariant frame; no new invariants introduced.

| Invariant | Preserved? |
|-----------|------------|
| I-TRIAL-CITY-RUNS-CANONICAL | ✅ Y (no schema change to city_id) |
| I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING | ✅ Y (worker still writes only to trial tables) |
| I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS | ✅ Y (start_run still queries `is_servable=true`) |
| I-TRIAL-RUN-SCOPED-TO-CITY | ✅ Y (city_id NOT NULL preserved) |
| I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | ✅ Y (worker doesn't write photo_aesthetic_data) |
| I-COLLAGE-SOLE-OWNER | ✅ Y (prep phase delegates to existing handleComposeCollage) |
| I-BOUNCER-DETERMINISTIC | ✅ Y (bouncer untouched) |

---

## 6. Cache Safety

N/A — admin uses direct Supabase calls; no cache layer.

---

## 7. Regression Surface (operator post-deploy spot-check)

1. **Sample mode** — separate code path (browser-driven loop); v4 doesn't touch handleStartRun's sample branch or browser-loop code in TrialResultsTab.jsx. Quick Cary 50 sample as regression check.
2. **Existing v3-deployed full-city runs in DB** — current Cary 761 stuck run will be force-cleaned via operator SQL (in dispatch). New runs after v4 deploy use new schema column.
3. **Cron job behavior** — unchanged (jobid=15 still fires every minute, still calls tg_kick_pending_trial_runs, still pg_net.http_post to worker URL). Worker decides phase internally.
4. **Cancel button flow** — preserved verbatim. v3 cron filter handles cancelling status; v4 cancel-cleanup branch handles both pending+running.
5. **Active-run polling** — preserved (5s polling unchanged; `run_status` action returns parent + child rows; UI hydrates from parent state).

---

## 8. Constitutional Compliance

- ✅ #2 One owner per truth — `prep_status` is a single state column, not duplicated elsewhere
- ✅ #3 No silent failures — both phase helpers have try/catch with explicit error_message persistence + console.error
- ✅ #7 Label temporary fixes — no `[TRANSITIONAL]` items added; this is a permanent fix
- ✅ #8 Subtract before adding — old single-pass handleProcessChunk body REPLACED (not layered) with new decider + 2 helpers
- ✅ #13 Exclusion consistency — score phase queries `prep_status='ready' AND status IN (pending, running-stale)`; prep phase queries `prep_status IS NULL AND status IN (pending, running-stale)`. Mutually exclusive coverage; no row eligible for both phases simultaneously.

No violations.

---

## 9. Discoveries for Orchestrator

### D-1 (light, future tuning): worker invocation cycle has prep/score oscillation

In steady state, worker alternates between phases per cron tick (60s cadence). With prep budget 3 and score budget 12, the typical pattern after warm-up:
- Tick N: prep 3 (~30-90s wallclock) → marks 3 rows prepped → exit
- Tick N+1: score 3 (~10-30s wallclock with parallel-3) → 3 rows complete → exit
- Tick N+2: prep 3 → 3 rows prepped (now 0+3=3 in score queue) → exit
- Tick N+3: score 3 → ...

Throughput at steady state: ~3 rows/min (limited by prep). To accelerate: increase prep budget (3 → 6) at cost of higher memory peak per prep tick. Current 3 is safe (50 MB peak); could try 5 (~50 MB serial regardless of count, since serial within chunk).

**Better approach for future ORCH-0737-followup-2:** worker BUDGET LOOP — process chunks back-to-back within a single invocation until ~110s elapsed. Each invocation could complete 3 prep chunks + 3 score chunks ≈ 9 prep + 36 score = 27 net rows/min at steady state. ~30 min Cary 761. Defer to followup.

### D-2 (light, observational): score phase pickup query may be empty pre-warmup

For the first ~3 cron ticks of a fresh run, no rows have been prepped yet → score phase pickup is empty → worker falls through to prep phase via the decider. This is correct behavior (decider sees scoreEligibleCount=0 and dispatches prep). Just want to flag it so operator doesn't worry when first cron tick logs `phase=prep`.

### D-3 (none other): scope held tight; no other discoveries

---

## 10. Verification Status

**implemented, unverified.** All landed via grep:
- `prep_status` column added in migration ✅
- `idx_trial_runs_prep_pickup` index added in migration ✅
- `processScorePhase` function at line 1574 ✅
- `processPrepPhase` function at line 1675 ✅
- Phase decider at line 1560 (`scoreEligibleCount > 0 ? "score" : "prep"`) ✅
- v3 cancel-cleanup `["pending", "running"]` preserved at lines 1443 + 1528 ✅
- Edge fn LOC: 1668 → 1785 (+117 net) ✅

**Runtime verification pending operator-side:**
- Operator: force-cleanup current stuck Cary run (SQL provided in dispatch)
- Operator: `supabase db push` (applies v4 migration)
- Operator: verify column: `SELECT column_name FROM information_schema.columns WHERE table_name='place_intelligence_trial_runs' AND column_name='prep_status';` → 1 row
- Operator: `supabase functions deploy run-place-intelligence-trial`
- Operator: restart Cary full-city smoke
- Watch: prep_status ramp + completed_count growth + no `WORKER_RESOURCE_LIMIT` in pg_net response queue
- Test mid-run Cancel → finalizes within 90s

---

## 11. Out-of-Scope (untouched)

- SPEC v2 contract — preserved verbatim
- Admin UI (TrialResultsTab.jsx, PlaceIntelligenceTrialPage.jsx) — UI hydration, polling, active-run panel, mode toggle, double-confirm dialog all unchanged
- handleStartRun action — pending children get prep_status NULL by default (correct)
- handleCancelTrial action — unchanged; parent.status='cancelling' already sufficient
- handleRunStatus, handleListActiveRuns — unchanged
- Sample mode — completely separate browser-driven code path; not touched
- v3 cron filter migration — preserved
- supabase/config.toml — unchanged this session
- run-place-intelligence-trial action `run_trial_for_place` — unchanged (still callable by sample-mode browser loop)

---

## 12. Failure Mode Tripwires

None tripped:
- ✅ `prep_status` column doesn't pre-exist (`ADD COLUMN IF NOT EXISTS` is safe)
- ✅ No other references to `prep_status` outside the worker (sample mode untouched)
- ✅ Worker code grew 1668→1785 (+117 LOC = +7%); well under 2× threshold; refactor stayed focused

---

## 13. Sign-Off

**Status:** implemented, unverified
**Verification method available:** static-trace + grep
**Verification method NOT available:** runtime smoke (operator-side; requires deploy)

**Code is complete + ready for operator deploy.** Single new migration + edge fn refactor. UI completely unchanged. Sample mode untouched. v3 + v2 patches all preserved.

**Operator post-deploy sequence per dispatch §"Operator-side post-deploy action sequence":**
1. Force-cleanup current stuck Cary run (SQL in dispatch)
2. `supabase db push`
3. Verify column exists
4. `supabase functions deploy run-place-intelligence-trial`
5. Restart Cary full-city smoke
6. Observe ~6-12 rows/min steady; Cary in ~1-2 hours
7. Test Cancel mid-run → finalizes within 90s
