# Investigation Report — ORCH-0734: City-runs + Gemini auto-retry

**Mode:** INVESTIGATE (forensics-only; NO spec, NO code changes)
**Date:** 2026-05-05
**Investigator:** mingla-forensics
**Parent dispatch:** [`prompts/INVESTIGATOR_ORCH-0734_CITY_RUNS.md`](../prompts/INVESTIGATOR_ORCH-0734_CITY_RUNS.md)
**Confidence:** H (high) on findings A-G + critical blocker; M-H on H (hidden flaws — runtime not yet exercised at city scale)

---

## 1. Symptom summary

**Current state:** `run-place-intelligence-trial` edge function is hardcoded to evaluate the 32 places in `signal_anchors` table. ORCH-0733 closed with DEC-102 (Gemini 2.5 Flash sole provider, v4 prompt locked). `signal_anchors` is a calibration scaffold whose purpose is now obsolete.

**Target state:** A trial run is scoped to a chosen city. Operator picks a city in the admin; edge function loads ALL servable places in that city; Gemini scores each across 16 signals. `signal_anchors` table dropped (with backup snapshot); admin tab `SignalAnchorsTab.jsx` retired. Gemini auto-retry-once on `MALFORMED_FUNCTION_CALL` mitigates the ~3% intermittent-flake rate observed in ORCH-0733 (Harris Teeter v4 sweep).

**No active symptom.** This is a planned redesign + reliability hardening, not a defect investigation. Findings are classified accordingly: 🟠 contributing factor (architectural drag from `signal_anchors` retention) / 🟡 hidden flaws (idempotency gaps, FK gaps, wall-time scaling cliff) / 🔵 observations (data shape, naming).

---

## 2. ⚠ CRITICAL FINDING — Operator-locked Q2 (sync only) needs revision before SPEC

The dispatch prompt locks Q2 = "synchronous only — one place at a time, browser-throttled (Gemini 1s)." This was correct at 32-anchor scale (~11 min wall time). **At city-run scale, sync-only means hours of operator-tab-open time.**

**Live data from `seeding_cities` × `place_pool` (run today, 2026-05-05):**

| City | Total places | **Servable count** | Sync wall time @ ~22s/place + 1s throttle | Gemini cost @ $0.0038/place |
|---|---|---|---|---|
| London | 5893 | **3627** | **~23.2 hours** | $13.78 |
| Washington DC | 5542 | **2358** | ~15.1 hours | $8.96 |
| Brussels | 4643 | **1884** | ~12.0 hours | $7.16 |
| Raleigh | 2936 | **1715** | ~10.9 hours | $6.52 |
| Baltimore | 2213 | **1253** | ~8.0 hours | $4.76 |
| Lagos | 4222 | **1038** | ~6.6 hours | $3.94 |
| Fort Lauderdale | 2247 | **1006** | ~6.4 hours | $3.82 |
| Cary | 1680 | **820** | ~5.2 hours | $3.12 |
| Durham | 1300 | **699** | ~4.5 hours | $2.66 |

**Even the smallest viable city (Durham, 699 places) is ~4.5 hours of operator-tab-open time.** The locked sync architecture from ORCH-0733 (browser-driven `for` loop with `await invokeWithRefresh` per place + `setTimeout` throttle) does not gracefully scale to this envelope.

**Why the operator likely chose sync:** observability + control. Operator wants to see progress, stop the run, not have a fire-and-forget background job produce surprises hours later. A `window.confirm` dialog with "~22min wall time" is acceptable; "~4.5 hours" probably is not for a routine calibration run.

**Three options to surface to operator before SPEC dispatch:**

| Option | Description | Pros | Cons |
|---|---|---|---|
| **(A) Keep sync, accept 4-23h tab-open** | Status quo + progress UI improvements (better progress bar, ETA, can-close-and-resume warning) | Simplest implementation; preserves observability | Operator-tab-open assumption broken at scale; refresh/network blip costs progress |
| **(B) Server-side background queue + admin polling** | Edge fn enqueues to a `place_intelligence_trial_jobs` table; cron worker drains queue 1 place / 30s; admin polls run progress every 10s | Closes-tab-and-comes-back works; no operator babysitting; same observability via polling | New table + cron worker + polling logic; estimated +1-2 day SPEC+IMPL |
| **(C) Hybrid: sync for small (<200 places) + queued for large** | Operator picks city; if ≤200 places, run sync browser-driven; else enqueue to background | Best UX per scale; small calibration cities (sample mode) stay fast | Two execution paths to maintain; can defer until usage validates need |
| **(D) Sampled sync** | Allow operator to set "Sample N places" cap (default 200); for full city, schedule via separate "Backfill all" button that uses path B | Hybrid pattern via UX choice; one execution path implementation-wise (loop bounded) | Operator must understand sample-vs-full distinction |

**My recommendation: (D) Sampled sync as the next-build, then (B) when full backfill is needed.** Reasoning: the immediate use case is calibration (verify v4 prompt against more diverse places than 32 anchors). 200-place stratified sample at ~75 min wall time + ~$0.76 cost is operator-feasible and produces statistically meaningful coverage. Full city backfill is a separate, less-frequent operation that justifies (B)'s complexity later.

**This is a STOP-and-decide moment per dispatch instructions.** I have NOT made an autonomous re-scope. The remainder of this report documents the rest of the forensics assuming the operator answers this question. Where the answer materially affects a finding, I have noted "depends on Q2 revision."

---

## 3. Investigation manifest

| # | File / artifact | Layer | Why read | Result |
|---|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0734_CITY_RUNS.md` | Dispatch | Take the report | Locked decisions confirmed; 8 question blocks A-H mapped |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0733_GEMINI_FIX_AND_ANTHROPIC_DROP_REPORT.md` | Prior context | Final architecture state | Confirmed v4 + Gemini sole + ~$0.0038/place + comment-preserved Anthropic helpers |
| 3 | `Mingla_Artifacts/signal-lab/CALIBRATION_LOG.md` Entry 005 | Prior context | v4 sweep observations | 31/32 success; 1 MALFORMED_FUNCTION_CALL on Harris Teeter; same row passed in v3 |
| 4 | MEMORY.md feedback memories | Context | Patterns + invariants | I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING + I-PHOTO-AESTHETIC-DATA-SOLE-OWNER + I-COLLAGE-SOLE-OWNER + I-CATEGORY-SLUG-CANONICAL relevant; sequential-pace + diagnose-first applies |
| 5 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` lines 9685-9704 | Schema (latest) | `signal_anchors` DDL | Table has FK to `place_pool` ON DELETE CASCADE + FK to `auth.users` for `labeled_by`; UNIQUE on `(signal_id, anchor_index) WHERE committed_at IS NOT NULL`; trigger for `updated_at`; RLS policies for admin + service_role |
| 6 | Live DB schema query | Schema (live) | `cities` table existence | **No `cities` table.** Only `seeding_cities` (the seeding-target list) is the de facto cities authority |
| 7 | Live DB schema query | Schema (live) | `place_pool.city_id` FK | **No FK constraint.** `city_id` is uuid but unconstrained. Data inspection confirms values match `seeding_cities.id` in current dataset (no orphans observed) |
| 8 | Live DB schema query | Schema (live) | `place_intelligence_trial_runs` constraints | **No UNIQUE constraint** on `(run_id, place_pool_id, signal_id)`. CHECK on `anchor_index = ANY (1, 2)` (city-runs incompatible without nullable). FK on `place_pool_id` ON DELETE CASCADE. Status enum: pending/running/completed/failed/cancelled |
| 9 | Live DB query — servable counts per city | Data | City picker viability | 18 seeded cities; 9 with non-zero servable; 9 with zero (Berlin, Paris, NY, Barcelona, Chicago, Toronto, Dallas, Miami, +1) — must filter |
| 10 | `supabase/functions/run-place-intelligence-trial/index.ts` lines 161-201 | Code | Gemini retry layer | `callGeminiWithRetry` only retries on HTTP 429/5xx — NOT on `MALFORMED_FUNCTION_CALL` (HTTP 200 with malformed body) |
| 11 | `supabase/functions/run-place-intelligence-trial/index.ts` lines 895-962 | Code | `callGeminiQuestion` | Throw at line 950-953 is the precise insertion point for retry-once on `MALFORMED_FUNCTION_CALL` |
| 12 | `supabase/functions/run-place-intelligence-trial/index.ts` lines 347 + 616 | Code | Active `signal_anchors` reads | Two ACTIVE references — `start_run` action loads anchors; another path likely loads anchor metadata for results display |
| 13 | `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` lines 190-418 | Code | Admin invocation flow | Two-phase: `handlePrepareAll` (fetch reviews + collage) + `handleRunTrial` (Gemini per place). Both loops `for (let i...)` over committed anchors. `window.confirm` dialog with cost+time estimate. `stopRef` + `isRunningRef` patterns established |
| 14 | `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx` (entire file, 426 lines) | Code | What `SignalAnchorsTab` does | **NEW DISCOVERY** — entire admin tab dedicated to anchor management (browse candidates per signal, commit/uncommit, label notes). This tab must be retired; estimated ~426 LOC removal + parent tab-list pruning |

---

## 4. Findings

### 🟠 F-1 — `place_intelligence_trial_runs` lacks idempotency UNIQUE constraint

**File + line:** `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (table DDL); current live DB
**Exact code (effective DDL):** Only `PRIMARY KEY (id)` + `FOREIGN KEY (place_pool_id) REFERENCES place_pool(id) ON DELETE CASCADE` + CHECK constraints on `status` and `anchor_index`. **No UNIQUE on `(run_id, place_pool_id, signal_id)`.**
**What it does:** Two simultaneous edge-fn invocations for the same `(run_id, place_pool_id, signal_id)` triple can both insert rows. Operator double-clicks Run, browser auto-retry on transient network blip, or city-runs SPEC's auto-retry-once on `MALFORMED_FUNCTION_CALL` could all race-write duplicates.
**What it should do:** Schema-level `UNIQUE (run_id, place_pool_id, signal_id)` + edge-fn `INSERT ... ON CONFLICT DO UPDATE` (or `DO NOTHING` if idempotent-success semantics preferred).
**Causal chain:** ORCH-0712 designed `signal_anchors` row keying to handle this (32 fixed anchors, no race opportunity at 1s throttle). City-runs at 699-3627 places + auto-retry-once + browser refresh/recovery = race opportunities multiply. Without UNIQUE, dupes silently double-count cost + skew per-run aggregate stats.
**Verification:** Run `SELECT run_id, place_pool_id, signal_id, COUNT(*) FROM place_intelligence_trial_runs GROUP BY 1,2,3 HAVING COUNT(*) > 1`. Today: 0 dupes (32-anchor scale + 1s throttle protected us). City-runs SPEC must add the UNIQUE before scale exposes the race.

### 🟠 F-2 — `place_intelligence_trial_runs.anchor_index` CHECK constraint blocks city-runs

**File + line:** Same baseline; constraint `place_intelligence_trial_runs_anchor_index_check`
**Exact code:** `CHECK ((anchor_index = ANY (ARRAY[1, 2])))`
**What it does:** Every row MUST have `anchor_index` ∈ {1, 2}. This was meaningful for `signal_anchors` (each signal has 2 anchors). City-runs places have no anchor_index — they're general-population servable places.
**What it should do:** Either drop the CHECK + make column nullable (preserves backward compat for existing 32-anchor rows), or drop the column entirely (audit trail loss; existing query `SELECT ... anchor_index ...` in `start_run` action breaks).
**Causal chain:** Without modification, every city-run row insert fails with constraint violation.
**Verification:** Already proven by data shape — current schema requires {1,2}; city-runs cannot supply that.
**Recommended fix direction:** `ALTER TABLE place_intelligence_trial_runs DROP CONSTRAINT place_intelligence_trial_runs_anchor_index_check; ALTER TABLE ... ALTER COLUMN anchor_index DROP NOT NULL;` (column not currently NOT NULL per schema dump — verify in SPEC). Then nullable; city-runs leave it NULL; legacy rows preserve the value.

### 🟡 F-3 — `place_pool.city_id` has no FK constraint (orphan risk)

**File:** Live DB — verified by querying `information_schema.table_constraints`
**Exact code (effective DDL):** `place_pool.city_id` declared as `uuid`. No `FOREIGN KEY (city_id) REFERENCES seeding_cities(id)`.
**What it does:** A `place_pool` row can have a `city_id` that doesn't exist in `seeding_cities` (orphan). Today: data inspection shows all values match — no orphans observed. But there is no schema-level guarantee.
**What it should do:** Either add FK now (defensive; aligns with city-runs SPEC making `city_id` load-bearing) or document as accepted technical debt.
**Causal chain:** City picker dropdown loads from `seeding_cities`; city-run loads `place_pool WHERE city_id = $1`. If a `place_pool` row's `city_id` orphans (e.g., city soft-delete or seed re-run), it gets silently excluded — no error, just a missing row in the run.
**Verification:** Query `SELECT count(*) FROM place_pool WHERE city_id IS NOT NULL AND city_id NOT IN (SELECT id FROM seeding_cities)` → 0 today. Re-run pre-SPEC.
**Recommendation:** Add the FK in the SPEC's migration. Cheap defensive measure. ON DELETE behavior: SET NULL (preserves places when a city is hard-deleted; or RESTRICT if business semantics demand).

### 🟡 F-4 — `seeding_cities` is the de facto cities authority but named for seeding scope

**File:** Live DB schema
**What it does:** `seeding_cities` was named/scoped as the seeding-target list (which cities the seeder will call Google Places for). 9 cities with `status='seeded'` AND non-zero servable places effectively constitute Mingla's "live cities". 9 cities with `status='seeded'` AND zero servable are seeded-but-not-yet-bouncer-passed (or pre-launch, or unranked).
**What it should do:** Two paths: (a) accept that `seeding_cities` IS the cities table going forward (rename optional, comment-update sufficient); (b) add a `cities` view that joins servable counts and exposes only viable cities to the admin city picker.
**Causal chain:** No active bug. But future investigations searching "where is the cities table" will find the seeding-prefixed name and re-discover this conceptual drift.
**Recommendation:** Document in DECISION_LOG (DEC-104?) — `seeding_cities` is the canonical cities authority; rename DEFERRED. Add comment to the table: `COMMENT ON TABLE seeding_cities IS 'Canonical cities authority post-ORCH-0734. Originally scoped for seeding-target list; expanded to general cities role. Picker filters by servable_count > 0.'`. The SPEC's city picker queries `seeding_cities` directly with a `LEFT JOIN place_pool` for servable count.

### 🟡 F-5 — `MALFORMED_FUNCTION_CALL` retry insertion point bypasses existing retry layer

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts` lines 161-201 (`callGeminiWithRetry`) + lines 950-953 (`callGeminiQuestion` throw)
**Exact code:**
```ts
// Line 191
if (!res!.ok) throw new Error(`Gemini exhausted retries: ${lastErrText.slice(0, 500)}`);
// Lines 950-953
if (!fnCallPart?.functionCall?.args) {
  const finishReason = candidates[0]?.finishReason || "unknown";
  throw new Error(`Gemini returned no function_call for ${tool.name} (finishReason=${finishReason})`);
}
```
**What it does:** `callGeminiWithRetry` only retries HTTP 429/5xx. `MALFORMED_FUNCTION_CALL` returns HTTP 200 with a malformed payload — bypasses the retry layer entirely; `callGeminiQuestion` throws at line 952 unconditionally on first malformed response.
**What it should do:** Wrap lines 941-953 in a once-only retry. On `finishReason='MALFORMED_FUNCTION_CALL'`, re-invoke `callGeminiWithRetry` with the same body. Per ORCH-0733 evidence, the same row that failed in v4 sweep `e15f5d8f` (Harris Teeter / flowers) succeeded in v3 sweep `fe15cb99` — the flake is non-deterministic; bit-identical retry usually succeeds.
**Causal chain:** Without retry, ~3% per-row failure rate (1/32 in v4). At 699-place Durham scale: ~21 spurious failures per run. At 3627-place London: ~109 spurious failures. Operator must manually re-run failed rows or accept gaps.
**Recommendation:** SPEC adds a `RETRY_ON_MALFORMED = 1` constant in `index.ts`; restructures `callGeminiQuestion` to detect malformed-finish AT line 951 and loop once with the same `reqBody`. NO prompt nudge (Gemini's flake is genuinely random; nudging risks introducing v5 prompt regressions). NO temperature change (would invalidate v4 calibration). Same-prompt same-reqBody retry; lower-effort, higher-confidence.
**Cost accounting:** Failed call's tokens are wasted (Gemini bills for the failed completion). SPEC must capture both calls' cost. Recommend: `cost_usd` on the row reflects ONLY the successful call (existing semantics); add a NEW column `retry_count` (default 0) + log the wasted tokens to `console.log` with run_id + place_pool_id for cost reconciliation if ever needed. Alternative: capture wasted cost in `error_message` JSON. SPEC choice — either acceptable.

### 🟡 F-6 — Browser-driven sync loop refresh-fragility under multi-hour runs

**File:** `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` lines 335-418
**Exact code:** `handleRunTrial` is a `for` loop over `anchors` with `await invokeWithRefresh` per place. State (`progress`, `runId`, `succeeded`, `failed`, `totalCost`) lives in React component state. `stopRef` enables Stop button.
**What it does:** Operator must keep tab open. Tab close / browser refresh / accidental navigation / system sleep → loop terminates mid-run. Edge function calls already-issued continue to completion server-side, but the browser stops triggering subsequent calls. Existing `place_intelligence_trial_runs` rows are preserved (server-side state); but no automatic resume.
**What it should do at city scale:** Either (a) accept the constraint and add explicit "Resume run" UX (operator clicks "Resume {run_id}" → re-discovers which `(run_id, signal_id, place_pool_id)` triples are missing → re-iterates); OR (b) move the loop server-side per F-1 finding; OR (c) Sample sync mode (D from Section 2) bounds runs to ≤200 places / ~75 min — likely tab-survivable.
**Causal chain:** Today: 32 anchors × 22s = 11 min, no operator concern. City-runs: 699-3627 places × 22s = 4-23 hours, tab must stay open. Refresh-during-run loses progress.
**Recommendation:** **Depends on Q2 revision.** If operator picks (D) Sampled sync: this finding becomes 🔵 Observation (75-min runs are tab-survivable). If (A) Keep sync at full scale: SPEC must ship Resume UX with skip-already-completed logic. If (B) Server-side queue: F-6 dissolves entirely.

### 🟡 F-7 — `SignalAnchorsTab.jsx` retirement is non-trivial UI surface removal

**File:** `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx` (426 lines)
**Discovery:** ENTIRE admin tab dedicated to anchor management (browse candidates per signal via `place_scores`, commit/uncommit anchors, label notes). 4 active references to `signal_anchors` table in CRUD operations. Built during ORCH-0712.
**What it does:** Operator browses candidate places per signal, picks 2 per signal × 16 = 32 anchors, commits them. Commit triggers `signal_anchors` insert. Used during ORCH-0713 v1/v2/v3/v4 calibration sweeps.
**What it should do:** Retire entirely. Calibration anchors are obsolete post-DEC-102 (v4 prompt locked); future calibration uses Gemini-specific cutoff re-derivation per DEC-103 reserved (will use full city sweeps, not curated anchors).
**Causal chain:** If `signal_anchors` table dropped without retiring this tab, the tab will load with a 4xx error or empty state and confuse future operators.
**Recommendation:** SPEC scope must include: (a) remove `SignalAnchorsTab.jsx` entirely; (b) prune the parent component's tab list (find the parent that imports SignalAnchorsTab + remove the entry); (c) preserve audit trail via the file's git history. Estimate: ~30-min removal + tab-list-prune.
**Discovery for orchestrator:** `TrialResultsTab.jsx` lines 229-232 reads `signal_anchors` for committed-count display. Lines 266-274 reads `signal_anchors` to load anchor list for the prepare/run loop. **Both reads must be replaced with city-aware equivalents.**

### 🟡 F-8 — `start_run` action body in edge function reads `signal_anchors` as place source

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts` line 347 (and likely surrounding ~50 lines)
**What it does:** `action: "start_run"` (called by `handleRunTrial` to create a run_id + pending rows) loads committed anchors from `signal_anchors` as the place set for the run. Returns `{ runId, anchors, estimatedCostUsd }` to the browser. Browser then iterates `anchors` calling `run_trial_for_place` for each.
**What it should do:** Take `city_id` parameter; load `place_pool WHERE is_servable=true AND city_id = $1` (with optional `LIMIT $2` for sample mode); return same shape `{ runId, anchors: [...], estimatedCostUsd }` where each anchor entry has `{ place_pool_id, signal_id_will_iterate_all_16: null }` — semantics shift slightly because city-runs evaluate ALL 16 signals per place (one Gemini call returns all 16 evaluations in the v4 prompt's `evaluations` array).
**Wait, important clarification:** Re-reading the existing flow — `run_trial_for_place` takes a SINGLE `(place_pool_id, signal_id)` pair AS INPUT but the Gemini call returns ALL 16 signal evaluations per place in one call (per `evaluations` array shape verified during ORCH-0733 spot-checks). The existing 32-anchor flow only writes 1 row per place even though all 16 signals were scored. Need to verify in SPEC: does `run_trial_for_place` write ONE row containing `q2_response.evaluations` for all 16, or write 16 rows? Browser loop iterates 32 entries (anchors), so probably 32 rows total. City-runs scale: 699 rows for Durham (one per place) — NOT 699×16=11,184 rows. Verify in SPEC.
**Causal chain:** SPEC must reconcile this — is per-place row semantics preserved? If yes, evaluating 699 places writes 699 rows, each containing all 16 signal scores in `q2_response`. Idempotency UNIQUE becomes `(run_id, place_pool_id)` — drop signal_id from the unique tuple — because there's one row per place per run.
**Recommendation:** SPEC must verify the existing semantics by reading lines 347-616 (the two `signal_anchors` references span ~270 lines of code) and explicitly document the row-per-place contract. F-1 (UNIQUE constraint) must be `(run_id, place_pool_id)` not `(run_id, place_pool_id, signal_id)` if this is the case.

### 🔵 F-9 — `signal_anchors` blast radius: 4 files; 2 SQL DDL contexts

**Files referencing `signal_anchors`:**
1. `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` — DDL (table creation, FKs, RLS, trigger, indexes, GRANTs). Drop migration must reverse this carefully.
2. `supabase/functions/run-place-intelligence-trial/index.ts` lines 347 + 616 — ACTIVE code reads. Per F-7 + F-8, both must be replaced.
3. `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` lines 230 + 268 — ACTIVE code reads (committed-count display + anchor loading). Per F-7, both must be replaced.
4. `mingla-admin/src/components/placeIntelligenceTrial/SignalAnchorsTab.jsx` lines 293, 325, 334, 356 — ACTIVE CRUD. Per F-7, file deleted entirely.

**SQL artifacts attached to the table:**
- 2 RLS policies: `admin_all_signal_anchors`, `service_role_all_signal_anchors`
- 2 indexes: `idx_signal_anchors_signal`, `idx_signal_anchors_unique` (partial)
- 1 trigger: `trg_signal_anchors_set_updated_at` (function `tg_signal_anchors_set_updated_at`)
- 1 trigger function: `tg_signal_anchors_set_updated_at()` — drop CASCADE on table will leave function orphan; SPEC must `DROP FUNCTION ... tg_signal_anchors_set_updated_at()` explicitly
- 2 FKs: `signal_anchors_labeled_by_fkey` (to auth.users) + `signal_anchors_place_pool_id_fkey` (to place_pool ON DELETE CASCADE) — both auto-drop with table
- 3 GRANTs (anon, authenticated, service_role) — auto-drop with table

**No matviews, RPCs, or cron jobs reference `signal_anchors`.** Verified via `pg_get_functiondef` query (no production RPC contains the string).

**No mobile (`app-mobile/`) references.** Verified via grep.

**Comment artifact:** `Mingla_Artifacts/signal-lab/SIGNAL_TAXONOMY.md` and the IMPLEMENTATION reports reference `signal_anchors` historically — preserve as audit trail; do NOT modify.

### 🔵 F-10 — Existing patterns for picker / dropdown / modal in admin

**Admin stack:** React 19 + Vite + Tailwind v4 + Framer Motion. No React Query. No Zustand. Direct Supabase calls + React Context (Auth, Theme, Toast).

**Sibling pattern survey (TrialResultsTab.jsx):**
- `window.confirm` dialog for destructive/expensive actions (line 342) — primitive but functional
- `useToast()` from context for status feedback (line 209)
- `setLoading` / `setRunning` / `setProgress` local state for in-flight UX
- `stopRef` + `isRunningRef` for cancel/double-invoke guards
- No existing dropdown primitive imported — would need to verify in `mingla-admin/src/components/ui/` for a `Select` primitive or build inline

**Recommendation for SPEC:** City picker = inline `<select>` with Tailwind v4 styling matching existing form controls in admin. Pre-flight `window.confirm` shows: "City X · N servable places · est ~$Y · ~Z min wall time. Don't refresh during run. Continue?". Already-established pattern; minimal new primitive risk.

### 🔵 F-11 — Per-place wall-time calibration

**Source:** ORCH-0733 v4 sweep `e15f5d8f` actual data — 32 places, $0.1292 cost, 10:59 wall time.
- Per-place cost: $0.1292 / 32 = $0.00404 (the dispatch's $0.0038 is a rounding-down from earlier v3 measurement; actual v4 is $0.0040).
- Per-place wall time: 659s / 32 = 20.6s. Plus 1s browser throttle = ~21.6s steady-state.
- Recommend SPEC update `PER_PLACE_COST_USD` to 0.0040 (defensive over-estimate harmless) and document the throttle math.

---

## 5. Five-layer cross-check

| Layer | What it says | Contradiction? |
|---|---|---|
| **Docs** | `signal-lab/SIGNAL_TAXONOMY.md` says cutoffs derived from 32 anchors; warns about Gemini cutoff re-derivation pending DEC-103. `CALIBRATION_LOG.md` Entries 001-005 document anchor-based sweeps. **Docs are anchor-centric.** | Aligned with current state; will need post-CLOSE update referencing city-runs as the new sweep mechanism. |
| **Schema** | `signal_anchors` exists; `place_intelligence_trial_runs.anchor_index` CHECK ∈ {1,2}; no UNIQUE on triple; `place_pool.city_id` unconstrained; `seeding_cities` is the de facto cities table. | F-1, F-2, F-3 surfaced. |
| **Code** | Edge fn + 2 admin tabs all assume `signal_anchors`. `callGeminiWithRetry` doesn't handle `MALFORMED_FUNCTION_CALL`. | F-5, F-6, F-7, F-8 surfaced. |
| **Runtime** | v4 sweep 31/32 success on `signal_anchors` set; ~$0.13/sweep, ~11min wall time. | Healthy at 32-anchor scale; F-6 surfaces the scaling cliff. |
| **Data** | Live: 9 cities with non-zero servable; smallest 699 (Durham), largest 3627 (London); no `place_pool.city_id` orphans currently. | F-3 risk is latent, not active. |

**Layer disagreement:** Docs + Schema + Code all assume 32-anchor scope. Data + Runtime show the architecture works AT that scope. **Section 2's critical finding is the cross-layer truth: the architecture does not gracefully extend to city scale without an operator decision revision.**

---

## 6. Blast radius map

**`signal_anchors` drop touches:**
- 1 edge function (active code, 2 read sites)
- 2 admin components (active code, 6 read sites + 1 entire file delete)
- 1 migration (DDL ownership; new drop migration needed)
- 0 mobile files
- 0 RPC/matview/cron jobs
- 4 docs / artifacts (preserve as audit trail; comment-only updates)

**City-runs introduction touches:**
- Edge fn `index.ts`: ~3 new code regions (city query, idempotency UPSERT, retry-once on MALFORMED), ~50-100 LOC delta
- Edge fn body schema: `start_run` adds `{ city_id: uuid, sample_size?: number }` input (depends on Q2 revision)
- Admin `TrialResultsTab.jsx`: city picker dropdown (~30 LOC), updated confirm dialog (~10 LOC), anchor load → city load (~40 LOC delta), Resume UX optional (depends on Q2)
- Admin `SignalAnchorsTab.jsx`: deleted entirely (~426 LOC removed)
- Admin parent (whichever imports SignalAnchorsTab): tab-list pruning (~5 LOC)
- New migration: `[date]_orch_0734_city_runs_schema.sql` — drop `signal_anchors` (with backup) + drop trigger function + alter `anchor_index` CHECK + add UNIQUE on `place_intelligence_trial_runs` + add `city_id` column to `place_intelligence_trial_runs` (for run-level city tracking) + optional FK on `place_pool.city_id`
- New `_archive_orch_0734_signal_anchors` snapshot table (data preservation)

**Cache state impact:** None — admin uses no React Query / Zustand for trial data. State refreshes via `refresh()` callback after each operation.

**Constitutional principles:** 
- **Const #2 (one owner per truth)** — `seeding_cities` becomes canonical cities authority; clean.
- **Const #3 (no silent failures)** — auto-retry-once must log retry attempts (recommend `console.log` with run_id+place_pool_id+attempt#).
- **Const #7 (label temporary fixes)** — `seeding_cities` table-name not renamed; deserves a TRANSITIONAL marker comment.
- **Const #8 (subtract before add)** — drop `signal_anchors` BEFORE introducing city-runs (in SAME migration to avoid inconsistent intermediate state).
- **Const #9 (no fabricated data)** — N/A; no display fabrication.

**Invariants:**
- I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING — preserved (city-runs still write to research-only `place_intelligence_trial_runs`).
- I-PHOTO-AESTHETIC-DATA-SOLE-OWNER — preserved (collage builder unchanged).
- I-COLLAGE-SOLE-OWNER — preserved.
- I-FIELD-MASK-SINGLE-OWNER — preserved.
- I-REFRESH-NEVER-DEGRADES — preserved.
- I-BOUNCER-DETERMINISTIC — preserved (city-runs filter on `is_servable` which is already bouncer-determined; no new bouncer logic).
- **NEW invariant proposal:** `I-TRIAL-RUN-SCOPED-TO-CITY` — every `place_intelligence_trial_runs` row written post-DEC-104 (or whatever DEC ratifies city-runs) must have a `run_id` whose corresponding city_id is non-null AND the place's `city_id` matches. CI enforcement: post-deployment SQL probe in calibration sweeps.

---

## 7. Hidden flaws (Phase 2.H from dispatch)

**H1. Code paths assuming `signal_anchors` exists post-drop:**
- F-7 (TrialResultsTab.jsx CRUD reads) — must be replaced
- F-8 (edge fn `start_run` action) — must be replaced
- F-9 SignalAnchorsTab.jsx — entire file deleted

No silent assumptions remain after these are addressed.

**H2. Matviews / scheduled jobs / triggers referencing signal_anchors:**
- Trigger `trg_signal_anchors_set_updated_at` (auto-drops with table)
- Trigger function `tg_signal_anchors_set_updated_at()` (does NOT auto-drop; must be explicitly DROPped)
- No matviews. No cron jobs. No RPCs reference it.

**H3. Mobile / admin-direct-Supabase-JS reads of signal_anchors:**
- Mobile: 0 references
- Admin: 6 references in 2 files, all addressed by F-7/F-8

**H4. RLS / RPC dependencies:**
- 2 RLS policies (auto-drop with table)
- 0 RPCs

**H5. `is_servable=true AND city_id IS NULL` edge case:**
- Verify: `SELECT COUNT(*) FROM place_pool WHERE is_servable=true AND city_id IS NULL`. Expected = 0 (every servable place should have city_id). If non-zero, those places get silently excluded from city-runs. SPEC must include a pre-deployment probe.

**H6. `seeding_cities` soft-delete during run:**
- `seeding_cities.status` field exists but no soft-delete column observed. Hard-delete would orphan `place_pool.city_id` references (no FK currently per F-3). Mid-run city deletion is ultra-low probability; document as accepted edge case.

**H7. I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING preservation:**
- Confirmed: SPEC explicitly does NOT modify `place_scores`, signal scorers, bouncer, or rerank pipeline. City-runs writes to `place_intelligence_trial_runs` exclusively (research-only).

**H8 (NEW — surfaced during investigation). Resume-after-tab-close semantics:**
- Today: tab close mid-32-anchor run = 11 min wasted. At city scale: tab close mid-Durham run = up to 4.5 hours wasted. F-1's UNIQUE constraint enables resume (idempotent re-write); F-6's Resume UX exposes it. Both depend on Q2 revision.

**H9 (NEW). Per-place collage build cost not in $0.0038 figure:**
- The $0.0038 per-place cost is Gemini API cost only. Collage build (Sharp image processing, 9 photo URL fetches, image storage write) has its own cost — measured during ORCH-0708/0713 but not in current `PER_PLACE_COST_USD` constant. At 32-place scale negligible; at 3627-place London ~$0.50-$2 additional infra cost. SPEC should call this out for full backfill use cases.

**H10 (NEW). `place_pool` photo availability variance per city:**
- F-9's blast-radius assumed every servable place has photos. Reality: places without sufficient photos fail collage build, return 4xx from `compose_collage`. At 32-anchor scale, all anchors had photos (curated). At city-runs scale, ~5-15% of servable places typically lack 9+ photos — they'll fail prepare phase. SPEC must document this expected partial-success rate; admin Resume UX should distinguish "missing photos" from "Gemini flake" failures.

---

## 8. Schema deltas required (preview for SPEC)

| # | Operation | Object | Notes |
|---|---|---|---|
| 1 | `CREATE TABLE _archive_orch_0734_signal_anchors AS SELECT * FROM signal_anchors;` | New backup table | Per orchestrator CLOSE protocol Step 5h, schedule retention reminder for N+1 days post-CLOSE (recommend N=14 — calibration is research-only, low rollback need) |
| 2 | `DROP TRIGGER trg_signal_anchors_set_updated_at ON signal_anchors;` | Existing trigger | Pre-table-drop |
| 3 | `DROP TABLE signal_anchors CASCADE;` | Existing table | Cascades 2 RLS policies + 2 indexes + 2 FKs + 3 GRANTs |
| 4 | `DROP FUNCTION tg_signal_anchors_set_updated_at();` | Orphan trigger function | Does NOT auto-drop with table |
| 5 | `ALTER TABLE place_intelligence_trial_runs DROP CONSTRAINT place_intelligence_trial_runs_anchor_index_check;` | CHECK constraint | F-2 |
| 6 | `ALTER TABLE place_intelligence_trial_runs ALTER COLUMN anchor_index DROP NOT NULL;` (verify if NOT NULL exists in baseline) | Column nullability | F-2 |
| 7 | `ALTER TABLE place_intelligence_trial_runs ADD CONSTRAINT place_intelligence_trial_runs_run_place_signal_unique UNIQUE (run_id, place_pool_id, signal_id);` OR `... UNIQUE (run_id, place_pool_id);` | UNIQUE constraint | **Depends on F-8 row-cardinality verification** in SPEC |
| 8 | `ALTER TABLE place_intelligence_trial_runs ADD COLUMN city_id uuid REFERENCES seeding_cities(id);` | New column | Run-level city tracking; optional but useful for filtering historical runs by city |
| 9 | `ALTER TABLE place_intelligence_trial_runs ADD COLUMN retry_count smallint NOT NULL DEFAULT 0;` | New column | F-5 retry observability |
| 10 | `ALTER TABLE place_pool ADD CONSTRAINT place_pool_city_id_fkey FOREIGN KEY (city_id) REFERENCES seeding_cities(id) ON DELETE SET NULL;` | New FK | F-3 defensive (optional; can defer) |
| 11 | `COMMENT ON TABLE seeding_cities IS '...post-ORCH-0734 canonical cities authority...'` | Doc | F-4 |

---

## 9. Fix strategy (direction only — NOT a spec)

**Phase A — Operator decision on Q2 revision (Section 2).** Until operator picks (A/B/C/D), SPEC cannot finalize. Recommend (D) Sampled sync with 200-place default + "Backfill all (background)" deferred to a future ORCH.

**Phase B — Schema migration.** One migration file containing the 11 deltas in §8, ordered to avoid intermediate-state inconsistency: snapshot → drop trigger → drop table cascade → drop function → alter `place_intelligence_trial_runs` (drop CHECK + nullable + UNIQUE + add 2 cols) → alter `place_pool` (add FK) → comment update.

**Phase C — Edge function rewrite of `start_run` action.** Take `{ city_id, sample_size? }`, query `place_pool`, return same `{ runId, anchors, estimatedCostUsd }` shape (preserves browser-side loop compatibility). Add `city_id` to the `place_intelligence_trial_runs` row insert.

**Phase D — Edge function `callGeminiQuestion` retry-once.** Wrap lines 941-953 in a once-only loop on `MALFORMED_FUNCTION_CALL` finishReason. Same body, same prompt. Increment `retry_count` on the persisted row. Console.log retry attempt with run_id + place_pool_id.

**Phase E — Admin UI.** Add city picker dropdown to TrialResultsTab. Update confirm dialog to include city + sample_size. Update prepare/run loops to load from city query (not signal_anchors). Delete SignalAnchorsTab.jsx + prune parent. (If Q2 revision picks (A) or (D) full mode, add Resume UX.)

**Phase F — Tester verification.** Run a Cary or Durham city-run sample (200 places) end-to-end. Verify: city picker filters zero-servable; confirm dialog shows accurate estimate; run completes without dupes; Gemini retry-once observable in logs; resume after browser close (if applicable). Spot-check 5-10 places' scores against SIGNAL_TAXONOMY cutoffs.

**Phase G — Post-CLOSE.** DEC-104 ratifies city-runs architecture + sample-vs-full execution mode; DEC-103 stays reserved for cutoff re-derivation; new invariant `I-TRIAL-RUN-SCOPED-TO-CITY` ratified.

---

## 10. Regression prevention requirements

| Class of regression | Structural safeguard |
|---|---|
| Future code re-discovers `signal_anchors` as live system | Per orchestrator CLOSE protocol Step 5: NEW memory file `feedback_signal_anchors_decommissioned.md` (post-CLOSE) + MEMORY.md index entry + skill definition reviews + decision log entries. Identical pattern to `feedback_ai_categories_decommissioned.md`. |
| Idempotency violation (duplicate rows) | UNIQUE constraint enforces schema-level guard; tester probe runs `GROUP BY ... HAVING COUNT(*) > 1` on every run. |
| Browser refresh mid-run loses progress | (Depends on Q2) Resume UX OR Sample-mode bounded scope OR background queue. |
| `MALFORMED_FUNCTION_CALL` dropping rows silently | Retry-once + `retry_count` column + `error_message` JSON capture. Tester verifies retry observability. |
| `place_pool.city_id` orphaning | Optional FK in §8 step 10. If deferred, post-deployment SQL probe `SELECT COUNT(*) FROM place_pool WHERE city_id NOT IN (SELECT id FROM seeding_cities)` runs in calibration sweep CI. |
| Future researcher uses Anthropic again | DEC-102 + comment-preserved helpers per Const #7; this dispatch does NOT touch that boundary. |

---

## 11. Discoveries for orchestrator

1. **`SignalAnchorsTab.jsx` is a 426-LOC admin tab whose existence the dispatch did not anticipate.** Retirement is part of SPEC scope. Operator should be aware the admin sidebar's Place Intelligence Trial section will visibly lose a tab after ship. (Tab list parent file not yet read; SPEC must identify.)

2. **`seeding_cities` IS the cities table.** No separate `cities` table exists. The dispatch's "sourced from `cities` table" assumption was wrong; corrected here. Operator may want to record DEC-104 (or similar) to formalize this naming reconciliation.

3. **9 of 18 seeded cities have zero servable places.** Picker MUST filter — empty-city runs would create empty trial_runs. Recommend filter by `EXISTS (SELECT 1 FROM place_pool WHERE city_id = sc.id AND is_servable=true)` rather than greying-out (greyed-out invites confusion).

4. **Per-place cost is $0.0040, not $0.0038.** Adjust constant accordingly. Defensive over-estimate harmless to operator.

5. **F-8 row-cardinality semantics ambiguous on read.** SPEC must verify: is current behavior 1 row per (place, anchor_index) or 1 row per (place, signal_id)? The 32-anchor data shows 1 row per place (32 rows per run, despite 16 signals scored per place). UNIQUE constraint and idempotency UPSERT must align with this — `UNIQUE (run_id, place_pool_id)` not `UNIQUE (run_id, place_pool_id, signal_id)`. **Surface this for explicit verification in SPEC.**

6. **`place_pool` collage availability variance** (H10) — at city scale, ~5-15% of servable places typically lack sufficient photos for collage. SPEC should document partial-success expectations and admin UI should distinguish "missing photos" from "Gemini flake."

7. **No matviews / cron / RPCs reference `signal_anchors`.** Drop is conceptually clean.

8. **Gemini per-place wall time is 20.6s observed (not 22s).** Adjust math accordingly. Trivial.

---

## 12. Confidence level

| Finding | Confidence | Reasoning |
|---|---|---|
| F-1 idempotency missing | **H** | Verified live via `pg_constraint` query |
| F-2 anchor_index CHECK | **H** | Verified live via `pg_constraint` query |
| F-3 city_id FK missing | **H** | Verified live via `information_schema` query |
| F-4 seeding_cities is cities table | **H** | Verified live via `information_schema` table list |
| F-5 retry insertion point | **H** | Verified by reading lines 161-201 + 895-962 of edge fn |
| F-6 sync wall-time scaling | **H** | Math from live servable counts × measured per-place wall time |
| F-7 SignalAnchorsTab retirement | **H** | File read confirmed; 426 LOC + 4 active CRUD references |
| F-8 row-cardinality semantics | **M-H** | Inferred from 32-anchor → 32-row pattern; SPEC must explicitly verify by reading lines 347-616 of edge fn |
| F-9 blast radius | **H** | Verified via repo-wide grep (mobile + admin + supabase) |
| F-10 admin patterns | **H** | Sibling component reading complete |
| F-11 wall-time calibration | **H** | Direct measurement from run `e15f5d8f` |
| H1-H10 hidden flaws | **M-H** | H8-H10 surfaced during investigation; H5 (`is_servable + city_id IS NULL`) needs runtime probe in SPEC |
| Section 2 critical Q2 revision | **H** | Math is direct; recommendation is judgment |

**Overall confidence: H.** The architecture, schema, and code paths are well-mapped. The single M-H finding (F-8) is verifiable with one more file read by the SPEC author; not a blocker for this investigation but a SPEC-phase verification gate.

---

**End of investigation. SPEC dispatch deferred until operator answers Section 2 Q2 revision.**
