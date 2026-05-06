# INVESTIGATION REPORT — ORCH-0737 v5 THROUGHPUT BOTTLENECK

**ORCH-ID:** ORCH-0737 v5 (post-v4 throughput optimization)
**Mode:** INVESTIGATE-THEN-SPEC (this is the investigation; spec is the companion file)
**Predecessor reports:** v1 / v2 / v3 / v4 — all loaded
**Spec authority:** [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](../specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md) — all 22 SCs and 7 invariants must hold
**Confidence:** **HIGH** — root cause six-field-proven via live runtime measurement against the in-flight Cary run

---

## 1. Symptom Summary

**Expected:** Operator's bar — full-city Cary (761 places) completes in ≤60 min; London (3495) in ≤4 hr. Operator labels these calibration sweeps "roughly hourly cadence."

**Actual:** Cary 761 grinding at **0.79 rows/min steady-state** → projected ~16 hours. London at same rate → projected ~74 hours. v4 patch eliminated WORKER_RESOURCE_LIMIT 546 errors (memory bug fixed) but exposed a deeper **scheduling-architecture bottleneck**.

**Reproduction:** runs deterministic. Every full-city run since v4 deploy will hit identical throughput cap.

---

## 2. Investigation Manifest

| File | Why read |
|------|----------|
| [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](../specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md) | Binding contract — verify v5 fix preserves SC-01..SC-22 + 7 invariants |
| [`IMPLEMENTATION_ORCH-0737_REPORT.md`](IMPLEMENTATION_ORCH-0737_REPORT.md) (v1) | Original architecture: 12-parallel chunk |
| [`IMPLEMENTATION_ORCH-0737_PATCH_V2_REPORT.md`](IMPLEMENTATION_ORCH-0737_PATCH_V2_REPORT.md) | v2 chunk=6, cancel-cleanup fix |
| [`IMPLEMENTATION_ORCH-0737_PATCH_V3_REPORT.md`](IMPLEMENTATION_ORCH-0737_PATCH_V3_REPORT.md) | v3 cron filter widening (cancelling pickup) |
| [`IMPLEMENTATION_ORCH-0737_PATCH_V4_REPORT.md`](IMPLEMENTATION_ORCH-0737_PATCH_V4_REPORT.md) | v4 two-pass refactor — D-1 already flagged budget-loop as followup |
| `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` | Latest definition of `tg_kick_pending_trial_runs` (heartbeat-staleness filter) |
| `supabase/migrations/20260507000002_orch_0737_v4_prep_status.sql` | `prep_status` column + `idx_trial_runs_prep_pickup` index |
| `supabase/functions/run-place-intelligence-trial/index.ts` (lines 1452-1785) | Worker decider + processScorePhase + processPrepPhase |
| `supabase/functions/_shared/imageCollage.ts` | compose_collage memory profile (sequential photo decode) |
| Live Supabase Management API SQL probes (8 probes against in-flight Cary run 6e26715f-fd50-49eb-80f8-5aa23027e428) | Real measurements, not theory |

---

## 3. Live Runtime Measurements (DEMAND PROOF — fulfilled)

Probes were run against the in-flight Cary full-city run at age 26.6 minutes, 21/761 (2.8%) processed.

### 3.1 Throughput envelope

| Wallclock minute | Rows scored |
|------------------|-------------|
| 09:29 | 3 |
| 09:33 | 3 |
| 09:37 | 3 |
| 09:41 | 3 |
| 09:45 | 3 |
| 09:49 | 3 |
| 09:53 | 3 |

**Pattern: exactly 3 rows scored every 4 minutes.** Throughput = 3/240s = **0.75 rows/min, perfectly deterministic.**

### 3.2 Queue distribution (probe A2)

| prep_status | status | count |
|-------------|--------|-------|
| NULL | pending | 740 |
| ready | completed | 21 |

**Zero rows in `(prep_status='ready', status='pending')`.** Score phase NEVER waits — its queue is drained immediately when filled. **Prep is the hard bottleneck.** Score's parallel-12 capacity is wasted (only 3 rows ever ready per cycle).

### 3.3 Per-row score wallclock (probe B1, 21 completed rows)

p50 ≈ 16s · p95 ≈ 23s · max outlier 57.9s (one Gemini retry).
Score work itself is fast and reliable. Confirmed not the bottleneck.

### 3.4 pg_cron health (probe B2, last 15 ticks)

Cron fires every **60.000s ± 100ms**, each tick completing in ~10-40ms (just dispatching pg_net.http_post). **No skipped ticks. No long-running ticks.** Cron infrastructure is healthy.

### 3.5 pg_net response inspection (probe B3, last 20 responses)

Pattern: every 2 minutes, alternating between:
- ODD-2min wallclock (e.g., 09:31, 09:35, ...): HTTP 200, body = `{"phase":"prep","chunk_size":3,"prepped":3}`
- EVEN-2min wallclock (e.g., 09:33, 09:37, ...): `status_code: null, content_type: null` — score-phase responses NOT captured by pg_net (still functioning per A3; output-capture gap, not throughput gap)

**Crucial:** zero WORKER_RESOURCE_LIMIT 546 errors since v4 deploy at 09:01. v4 memory architecture is sound.

**Crucial:** pg_net fires the worker only **every 2 minutes**, not every 1 minute (despite cron firing every 60s). The cron skips alternating ticks because of the heartbeat-staleness filter.

### 3.6 Index health (probe C2)

`idx_trial_runs_prep_pickup` matches the prep-phase pickup query perfectly. EXPLAIN ANALYZE shows 5ms execution. Index is **NOT a bottleneck.**

### 3.7 Cron concurrency (probe C4)

Zero overlapping cron invocations in the last 30 minutes. Heartbeat-staleness filter is fully serializing.

### 3.8 Prep-cycle gap (probe C1)

Gap between consecutive prep responses: **240.0 ± 0.05 seconds**, deterministic across 7 cycles.

---

## 4. Findings

### 🔴 Root Cause 1 — Throughput cap of 0.75 rows/min driven by **(heartbeat-staleness 90s filter + 60s cron tick = 120s effective interval) × (one-phase-per-invocation) = 240s per scored-row triplet**

**Field 1 — File + line:**
- `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql:201` — heartbeat-staleness filter
- `supabase/functions/run-place-intelligence-trial/index.ts:1565-1568` — single-phase return after either processScorePhase or processPrepPhase
- `supabase/functions/run-place-intelligence-trial/index.ts:1542-1544` — heartbeat updated ONCE at chunk start

**Field 2 — Exact code (verbatim):**
```sql
-- migration line 197-202 (latest definition; v3 widened to include cancelling — irrelevant here):
FOR r IN
  SELECT id FROM public.place_intelligence_runs
  WHERE status = 'running'
    AND processed_count < total_count
    AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
  ORDER BY created_at ASC
  LIMIT 5
LOOP ...
```

```typescript
// edge fn line 1542-1544: heartbeat update at chunk start ONLY
await db.from("place_intelligence_runs")
  .update({ last_heartbeat_at: new Date().toISOString() })
  .eq("id", runId);

// edge fn line 1565-1568: single-phase exit
if (phase === "score") {
  return await processScorePhase({ db, geminiKey, runId, stuckCutoff });
}
return await processPrepPhase({ db, serperKey, runId, stuckCutoff });
```

**Field 3 — What it does (precise current behavior):**

A worker invocation runs ONE phase (prep ~90s OR score ~25s) and exits. Heartbeat gets stamped at chunk start (T=0) and is never refreshed. cron fires every 60s; the staleness filter rejects any run whose heartbeat is < 90s old. So:
- T=0: cron tick. Worker A invoked. Heartbeat=T=0. Runs prep (90s). Exits T=90. Heartbeat still T=0.
- T=60: cron tick. Heartbeat 60s old. Filter rejects. Skip.
- T=120: cron tick. Heartbeat 120s old. Filter passes. Worker B invoked. Heartbeat=T=120. Runs score (25s). Exits T=145.
- T=180: cron tick. Heartbeat 60s old. Skip.
- T=240: cron tick. Heartbeat 120s old. Worker C invoked. Runs prep. Etc.

**Effective cycle: 240s per "round trip" (1 prep invocation + 1 score invocation).** 3 rows scored per round-trip. = 0.75 rows/min. Half the cycle is **dead air** (cron skipping). The other half does ONE phase — never both.

**Field 4 — What it should do (precise correct behavior):**

A worker invocation should run **multiple phases per invocation** within the safe edge-fn budget (~110s under the 150s timeout). It should also **chain to the next invocation immediately** when work remains, bypassing the heartbeat-staleness wait. The cron tick should serve only as **recovery** (kick a stalled chain) — not as the primary scheduler.

In particular: each worker invocation should perform a budget-loop containing both prep and score iterations, then if work remains and budget elapsed, fire pg_net.http_post to itself to chain. The cron's heartbeat-staleness filter then becomes a safety net — it kicks in only if the chain dies.

**Field 5 — Causal chain (this code → user symptom):**

1. cron tick at T=0 → trigger fn dispatches pg_net to worker URL → Worker A starts
2. Worker A locks parent (lock released at RPC return — see Contributing Factor 1)
3. Worker A updates heartbeat=T=0
4. Worker A's decider sees scoreEligibleCount=0 → runs prep phase
5. processPrepPhase serially preps 3 rows × ~30s/row = 90s wallclock
6. Worker A returns at T=90; pg_net captures response; isolate exits
7. cron tick at T=60 → trigger fn checks staleness: T=0 heartbeat, 60s old, < 90s threshold → SKIP
8. cron tick at T=120 → trigger fn checks staleness: 120s old, > 90s threshold → DISPATCH
9. Worker B starts at T=120, scoreEligibleCount=3, runs score phase parallel-3, exits T=145
10. cron tick at T=180 → 60s old → SKIP
11. cron tick at T=240 → 120s old → DISPATCH → Worker C runs prep again, this time on the next 3 rows
12. Pattern repeats forever. 240s per "3-prep + 3-score" cycle. **0.75 rows/min steady-state.**
13. Cary 761 / 0.75 = ~16.9 hours. Operator-painful.

**Field 6 — Verification step (how to confirm this is the cause, not coincidence):**

Live SQL probes prove every link of the causal chain:
- **Probe A3:** completed_at minute distribution shows EXACTLY 3 rows per 4-minute bucket (09:29, 09:33, 09:37, ..., 09:53). Pattern is deterministic — 7 consecutive cycles, all 4-minute spaced.
- **Probe C1:** prep-response gap is 240.0 ± 0.05s across 7 measured cycles. Variance < 0.1%. Deterministic.
- **Probe B2:** cron fires every 60s ± 100ms, completes in <50ms. Cron itself is healthy — it's the trigger function's heartbeat filter that drops alternating ticks.
- **Probe B3:** pg_net responses confirm worker is invoked every 2 minutes (alternating prep/score), not every minute.
- **Probe B1:** Score wallclock per row is 12-23s (well under 60s). Score is not slow — it's just rare (only 3 rows scored per 4-min cycle).
- **Probe A2:** Queue depth `(prep_status='ready', status='pending')` = 0. Score never has work waiting. Prep is the bottleneck pipe.

The numbers match the model exactly: 3 rows × 0.79 rows/min × 26.6 min = 21 rows. Observed: 21 rows. Six-field evidence is ironclad.

---

### 🟠 Contributing Factor 1 — `lock_run_for_chunk` releases lock immediately at RPC return; heartbeat-staleness filter is the **actual** chunk serializer

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts:1507`

```typescript
const { data: run, error: lockErr } = await db.rpc("lock_run_for_chunk", { p_run_id: runId });
```

**What it does:** Calls a SECURITY DEFINER function that does `SELECT ... FOR UPDATE NOWAIT` and returns the row. **The lock is held only inside that function's transaction**, which commits as soon as the RPC returns (~10ms). The lock does NOT span the worker's chunk processing.

**Implication:** if two cron-driven workers somehow fire concurrently (e.g., heartbeat threshold lowered), both would acquire-and-release lock_run_for_chunk in 10ms each, then race on pickup queries. Currently masked because the heartbeat-staleness filter ensures only one cron-fired worker ever runs per ~120s.

**Why it matters for v5:** any fix that lowers the heartbeat threshold or otherwise allows concurrent invocations MUST also strengthen pickup-query serialization (e.g., `SELECT FOR UPDATE SKIP LOCKED`), or else risk double-processing rows.

---

### 🟠 Contributing Factor 2 — Score phase parallel-12 capacity is wasted; only 3 rows ever in queue

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts:1588` — `.limit(12)` in score pickup

**What it does:** Score phase pickup queries `.limit(12)` and processes via Promise.all parallel. But prep produces only 3 ready rows per cycle, so score consumes 3 and exits. The parallel-12 capacity provisioned (with all the memory and complexity that implies) is never exercised.

**Implication:** v4's investment in score-parallel-12 with the score-priority decider is paying memory/code-complexity costs without throughput payoff. The real lever is **prep parallelism**, not score parallelism.

---

### 🟠 Contributing Factor 3 — End-of-chunk has no self-invoke; worker exits leaving cron-wait dead air

**File + line:** `supabase/functions/run-place-intelligence-trial/index.ts:1659-1668` (score exit) and `1777-1784` (prep exit)

**What it does:** Worker functions return a JSON response and exit. There's no `EdgeRuntime.waitUntil(fetch(SELF_URL, ...))` or equivalent self-invoke. The worker relies entirely on the next eligible cron tick to resume.

**Implication:** even if budget loop ran multiple phases per invocation, the gap between successive worker invocations is still ~30-60s (depending on where the chunk ended within the 60s cron interval). Self-invoke at end-of-chunk eliminates this gap.

---

### 🟡 Hidden Flaw 1 — `pg_net._http_response` capture failure on score-phase responses (cosmetic but noteworthy)

**Where:** `net._http_response` table — score-phase invocations consistently show `status_code: null, content_type: null`. Prep-phase invocations show `status_code: 200, content: {"phase":"prep",...}`.

**What it does:** pg_net fails to capture/parse the score-phase response body, but the actual scoring work completes successfully (verified via probe A3 — rows are marked `completed` and counters updated). Likely cause: response body shape difference, or response timing relative to pg_net's polling window.

**Implication:** purely a monitoring/observability gap. Operator inspecting pg_net would see 0% success rate on score invocations, which is misleading. Doesn't affect throughput.

**Defer:** out of scope for v5 throughput fix. Logged as ORCH-0737-followup-3.

---

### 🟡 Hidden Flaw 2 — compose_collage native-resolution decode peaks higher than expected

**Where:** `supabase/functions/_shared/imageCollage.ts:62-65` — `await decode(new Uint8Array(buf))` decodes at original photo resolution before resizing.

**What it does:** Google Places photos can be up to 4800×4800 native. RGBA decode = ~92 MB per photo at peak. composeCollage processes photos sequentially (one decoded at a time), so single-call peak is bounded — but with parallel calls, multiple decoded buffers coexist before V8 GC reclaims them.

**Implication:** This explains why v3 parallel-6 hit WORKER_RESOURCE_LIMIT 546 (~6 × 92 MB worst-case = 552 MB). Even parallel-3 carries non-trivial risk if photos are large. **Conservative parallel cap for v5 = 2.**

**Mitigation option (out of scope, log as followup):** decode photos at a downscaled target resolution before holding in memory. Would unlock parallel-4+ safely.

---

### 🔵 Observation — v4 memory architecture is correct; 0 WORKER_RESOURCE_LIMIT errors post-deploy

Probe B3 confirms: last 546 error was at 09:01 (pre-v4). All v4-era responses are 200 (or null for score, per Hidden Flaw 1). v4 patch did its job — memory bug is fixed. v5 must NOT regress this.

### 🔵 Observation — Score-phase wallclock: p50 ≈ 16s, p95 ≈ 23s, one outlier at 57.9s

Score parallel-12 wallclock is bounded by max-per-call. Even if all 12 ran in parallel, total would be ~25s (assuming Gemini doesn't degrade under concurrent load — untested, marginally risky).

### 🔵 Observation — Index `idx_trial_runs_prep_pickup` is correctly serving both phase queries (5ms execution)

Probe C2 confirms. No DB query optimization needed for v5.

---

## 5. Five-Layer Cross-Check

| Layer | Question | Finding |
|-------|----------|---------|
| **Docs** | What does SPEC v2 promise about throughput? | SC-09 mentions wallclock budget for full-city runs but does NOT mandate ≤60 min Cary. Operator's 60-min target is **a runtime expectation**, not a spec promise. **Doc/runtime contradiction:** spec is silent; operator expects ~hourly cadence. v5 fix should partially close the gap; full closure requires v6 architectural change. |
| **Schema** | Does the index correctly serve both phase queries? | Yes — `idx_trial_runs_prep_pickup` is partial on `status IN ('pending','running')` and includes (parent_run_id, prep_status, status, started_at). EXPLAIN ANALYZE shows 5ms. No schema work needed for v5. |
| **Code** | Does the worker chain itself? Does the decider correctly avoid prep starvation? Hidden serial awaits inside processScorePhase? | NO self-invoke. Decider correctly score-first (verified line 1560). No hidden serial awaits in score phase (Promise.all is genuine parallel). Prep phase IS serial-by-design (memory safety). All correct per v4 spec; the architecture itself is the bottleneck. |
| **Runtime** | What did live measurements show? | Documented in §3. 0.75 rows/min steady-state, 4-min round-trip cycle, 3 rows per cycle, deterministic. |
| **Data** | Queue distribution? Throughput pattern? | Documented in §3. 740 NULL/pending + 21 ready/completed, zero score-pending — score wait queue is empty. Prep is the bottleneck. |

**Layer agreement:** all five tell the same story. No contradictions.

---

## 6. Blast Radius Map

The throughput cap affects:
- **Cary 761:** ~16.9 hours instead of operator-acceptable ≤60 min
- **London 3495:** ~74 hours instead of operator-acceptable ≤4 hours
- **Future operator workflow** — calibration sweeps blocked at ~hourly cadence; current ~daily cadence

Solo/collab parity: N/A (admin-only tool; no mobile collab mode).
Admin dashboard: no UI changes needed; throughput is purely server-side.
Cache impact: N/A.
Invariants violated: **NONE.** The architecture is functionally correct; it's just slow. All 7 ORCH-0737 invariants from SPEC v2 §11 are preserved.

---

## 7. Lever Map (DISCARD ALL UNTIL ANALYSED)

The dispatch demanded an enumeration. Here it is.

| # | Lever | Mechanism | Estimated win | Verdict |
|---|-------|-----------|---------------|---------|
| L1 | **Budget loop in worker** | Wrap chunk body in `while (Date.now() - startTime < 110_000)` | Modest alone (~2× — fits prep+score in one invocation) | **ADOPT** |
| L2 | **Self-invoke at end of chunk** | At end of budget, fire `EdgeRuntime.waitUntil(fetch(SELF_URL, …))` if work remains | ~30s saved per cycle, ~30% throughput uplift | **ADOPT** |
| L3 | **Increase prep parallelism (serial → parallel-2)** | Within prep phase, process 2 rows concurrently via Promise.all chunked iteration | 2× prep throughput | **ADOPT** |
| L4 | **Increase prep parallelism to parallel-3** | Same as L3 but 3-at-a-time | 3× prep throughput | **REJECT for v5 (memory risk)** — Hidden Flaw 2 shows native-resolution decode can spike. v3 hit 546 with parallel-6 (552 MB worst-case). Parallel-3 worst-case = 276 MB. Borderline. Defer to v6 with photo-prefilter mitigation. |
| L5 | **Increase prep `.limit(3)` → `.limit(6)`** | Chunk size matches new parallel-2 capacity | Required to feed L3 | **ADOPT (paired with L3)** |
| L6 | **Reduce score `.limit(12)` → `.limit(6)`** | Match new prep output | Cosmetic | **ADOPT (cosmetic)** |
| L7 | **Lower heartbeat staleness threshold (90s → 30s)** | Cron fires more often per chunk | None on its own — would cause double-processing per Contributing Factor 1 | **REJECT** — race condition. Would require also adding `SELECT FOR UPDATE SKIP LOCKED` to pickup queries (architectural change, v6). |
| L8 | **Cron interval drop (60s → 30s) via `*/30` schedule** | More cron ticks | pg_cron supports sub-minute via custom format; throughput uplift ~25% | **REJECT** — same race issue as L7, plus existing 60s-tick infrastructure works fine. Diminishing returns. |
| L9 | **Two parallel cron jobs (one for prep, one for score)** | Independent prep+score chains | Modest (~50%) | **REJECT** — significant complexity for limited gain. Architectural blast radius too wide for a tuning patch. Defer to v6. |
| L10 | **Self-fetch compose_collage from worker** (each compose call hits fresh edge fn instance via fetch) | Memory bounded per-instance; could unlock parallel-12 prep | 6-12× IF Supabase routes to separate isolates; uncertain in practice | **REJECT for v5** — empirical testing required; Supabase isolate-routing semantics not documented; risk of all parallel calls landing in same isolate (memory regression). Spec a v6 PoC. |
| L11 | **Move compose_collage to background DB job (e.g., pg_cron processing storage)** | Eliminate worker memory entirely | Speculative | **REJECT for v5** — major rework; out of scope. |
| L12 | **External worker (Inngest / Trigger.dev / Render bg)** | True horizontal scale | 10×+ | **REJECT for v5** — explicitly out of scope per SPEC v2 §1 non-goals. |
| L13 | **Pre-warm: prep ALL rows first, then score-only phase** | Two distinct macro-passes | None for total time; defeats interleaved progress UX | **REJECT** — UX regression. Operator would see prep taking ~50 min before any score appears in admin. |

**Selected combo: L1 + L2 + L3 + L5 + L6.** All ADOPT levers compose cleanly. None of the REJECT levers are needed for the v5 target.

---

## 8. Throughput Math (v5 expected)

Per worker invocation (110s budget):
- Prep iteration: 6 rows parallel-2 (3 batches × ~30s = 90s) → 6 rows ready
- Score iteration: 6 rows parallel-6 (~25s) → 6 rows scored
- Self-invoke fire-and-forget at end (~10ms)
- Total: ~115s wallclock per invocation, well under 150s edge-fn timeout

With self-invoke chain (no cron-wait dead air, except for safety recovery):
- Effective cycle: ~115-120s per invocation (next worker starts ~5s after previous exits)
- Throughput: 6 rows / 117s avg = **3.1 rows/min** steady-state
- **4× over current v4 throughput (0.75 rows/min)**

Cary 761 / 3.1 = **~245 min ≈ 4.1 hours** (was 16.9 hours)
London 3495 / 3.1 = **~18.8 hours** (was 74 hours)

Operator's bar (≤60 min Cary, ≤4 hour London): **NOT MET.** v5 closes ~75% of the gap to Cary, ~80% of the gap to London. Full closure requires v6 architectural change (L4 + L10 path with photo-resolution mitigation).

---

## 9. Honest Verdict

The orchestrator's working hypothesis (budget loop) is **directionally correct.** v5 should ship the budget-loop + parallel-2 prep + self-invoke combo. It's a 4× improvement, low-risk, fits within SPEC v2 invariants.

**But the orchestrator's assumed throughput uplift (~12-30 rows/min) was wrong.** The real-world per-row prep wallclock (~30s) combined with safe parallel-2 prep caps single-worker throughput at ~3-5 rows/min. The 12-30 rows/min target requires either:
- Parallel-3+ prep (Hidden Flaw 2 risk)
- Self-fetch compose_collage with confirmed isolate routing (L10)
- External worker (out of v5 scope)

**Recommendation to operator (orchestrator-side decision, not investigator):**

Three choices:
1. **Accept v5 + live with 4-hour Cary.** Ship the budget-loop spec; calibration sweeps move from daily to half-day cadence. Close ORCH-0737. Plan ORCH-0739 for v6 architectural change later if 4 hours proves operator-painful.
2. **Skip v5, jump to v6.** Defer the easy fix; design an architectural rewrite (self-fetch PoC + photo-resolution prefilter + possibly external worker). Long lead time (~1-2 weeks).
3. **v5 now + v6 in parallel.** Ship v5 immediately for the 4× win; spin up ORCH-0739 v6 spec in the same cycle. Operator gets immediate partial relief; hourly-Cary unlocked in v6.

**Investigator's preference: option 3.** v5 is well-understood, low-risk, ships in <1 hour of implementor wallclock. v6 deserves its own forensic investigation to pick the right architectural path (self-fetch vs partition vs external).

---

## 10. Invariant Violations

**NONE.** All 7 SPEC v2 §11 invariants are preserved by the v5 fix path:
- I-TRIAL-CITY-RUNS-CANONICAL: city_id linkage unchanged
- I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING: worker still writes only to trial tables
- I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS: pickup queries unchanged from servable-only
- I-TRIAL-RUN-SCOPED-TO-CITY: schema unchanged
- I-PHOTO-AESTHETIC-DATA-SOLE-OWNER: unchanged
- I-COLLAGE-SOLE-OWNER: prep still delegates to handleComposeCollage (sole writer)
- I-BOUNCER-DETERMINISTIC: unchanged

---

## 11. Discoveries for Orchestrator

### D-1 — Operator's runtime expectation (≤60 min Cary) is not in SPEC v2

SPEC v2 SC-09 mentions "estimated_minutes" and "wallclock budget" but no hard target. Operator's "calibration sweeps need to be ~hourly" is a verbal expectation that hasn't been codified. **Recommend:** orchestrator update SPEC v2 §1 (or a new §1.1) with a numeric throughput SLA (e.g., "Cary ≤60 min, London ≤4 hr") so future regression catches throughput drops. The new SLA would inform whether v5 is sufficient or v6 is mandatory.

### D-2 — pg_net score-response capture gap (Hidden Flaw 1)

Score-phase responses show `status_code: null` in `net._http_response`. Worker is functioning (rows complete normally), but pg_net's monitoring view is misleading. Logged as ORCH-0737-followup-3. Investigate whether response body shape, response timing, or content size is causing pg_net's poll to miss it.

### D-3 — `composeCollage` decodes at native resolution, leaving memory headroom unused

The function decodes each photo at original resolution (potentially 4800×4800 = 92 MB RGBA), then resizes to tile size. If decode were targeted to tile resolution (e.g., 192×192 for 4×4 grid), per-call peak would drop to ~5 MB, and parallel-12 prep would fit easily in 60 MB. **Logged as ORCH-0737-followup-4** — meaningful prep-parallelism unlock that v6 should leverage.

### D-4 — `lock_run_for_chunk` doesn't actually serialize chunks (Contributing Factor 1)

Lock releases at RPC return. Chunk serialization is done by the heartbeat-staleness filter, not by the lock. This is a brittle design — if anyone ever lowers the threshold without strengthening pickup-query locking, race conditions appear. **Logged as ORCH-0737-followup-5** — hardening: add `FOR UPDATE SKIP LOCKED` to pickup queries OR redesign lock holding pattern.

---

## 12. Confidence Level

**HIGH** on root cause and v5 throughput projection.

- Root cause has six-field evidence with **deterministic** measurements (variance < 0.1% across 7 cycles).
- v5 throughput projection (~3-4 rows/min) is conservative; uplift could be slightly higher if score wallclock proves consistent under concurrent budget-loop pressure.
- v5 throughput projection has known cap that's well-understood (per-row prep wallclock × safe parallel cap).
- v6 architectural recommendations (D-3, L10) are speculative and require empirical testing.

---

## 13. Cross-references

- Spec (companion): [`SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md`](../specs/SPEC_ORCH-0737_PATCH_V5_THROUGHPUT.md)
- Forensics dispatch: [`prompts/FORENSICS_ORCH-0737_V5_THROUGHPUT.md`](../prompts/FORENSICS_ORCH-0737_V5_THROUGHPUT.md)
- Predecessor reports: v1, v2, v3, v4 implementation reports (above)
- Binding spec: [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](../specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md)
- Live SQL probes: 8 probes against in-flight Cary run 6e26715f-fd50-49eb-80f8-5aa23027e428 (probe outputs documented in §3 and §7)
