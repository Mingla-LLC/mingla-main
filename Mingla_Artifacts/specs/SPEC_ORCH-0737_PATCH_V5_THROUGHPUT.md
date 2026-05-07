# SPEC — ORCH-0737 v5 PATCH: WORKER BUDGET LOOP + PARALLEL-2 PREP + SELF-INVOKE

**ORCH-ID:** ORCH-0737 v5 patch (post-v4 throughput optimization)
**Status:** **BINDING** — implementor must follow exactly; deviations require operator approval
**Authority:** SPEC v2 ([`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md)) is parent contract; v5 supersedes only the throughput-relevant sections of the worker code path.
**Investigation:** [`INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md`](../reports/INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md) — HIGH confidence root cause
**Predecessor patches preserved:** v2 (chunk-size + cancel-cleanup), v3 (cron filter), v4 (two-pass) all stand. v5 layers on top.
**DEC reservation:** none new — v5 is a tactical patch under DEC-111 (ORCH-0737 architecture umbrella).

---

## §1 Scope + Non-Goals + Assumptions

### Scope (exactly what v5 changes)

1. `supabase/functions/run-place-intelligence-trial/index.ts` — refactor `handleProcessChunk` body into a budget-loop wrapping the existing decider; refactor `processPrepPhase` from serial-3 to parallel-2 with `.limit(6)`; reduce `processScorePhase` `.limit(12)` → `.limit(6)`; add end-of-budget self-invoke fire-and-forget.

That's it. **No DB migrations. No admin UI changes. No schema changes. No new edge functions.**

### Non-goals (explicitly NOT in v5)

- Lowering heartbeat-staleness threshold (race-condition risk per Contributing Factor 1; deferred to v6)
- Increasing prep parallelism beyond 2-at-a-time (memory risk per Hidden Flaw 2; deferred to v6)
- Self-fetch compose_collage (uncertain isolate routing; v6 PoC required)
- Adding `FOR UPDATE SKIP LOCKED` to pickup queries (architectural; v6)
- Photo-resolution prefilter in composeCollage (v6 prerequisite for parallel-3+)
- Operator's ≤60-min Cary target (v5 closes ~75% of the gap; v6 required for full closure)

### Assumptions (explicit, must be checked at impl time)

- A1. Per-row prep wallclock ≈ 30s (compose_collage dominates). If real measurement shows >40s/row, throughput projection drops proportionally — implementor must report.
- A2. Parallel-2 compose_collage stays under ~150 MB peak per worker isolate. Conservative based on Hidden Flaw 2 analysis. If first smoke test shows ANY WORKER_RESOURCE_LIMIT 546 errors, **immediately revert to parallel-1 and re-evaluate.**
- A3. `EdgeRuntime.waitUntil(...)` is supported in Supabase edge functions. If the runtime API differs, use the documented Supabase pattern for fire-and-forget HTTP from inside a response handler.
- A4. Self-invoke HTTP latency (~50-200ms) is negligible vs 110s budget. If observed >1s, investigate Supabase routing.
- A5. Score wallclock under parallel-6 stays bounded by max-individual-call (~25s). No degradation expected at this concurrency. If observed degradation at parallel-6, drop to parallel-3.

If any assumption fails at implementation, **STOP and hand back to orchestrator** — do not silently adapt.

---

## §2 Database Layer

**No changes.** All migrations from v1-v4 stand verbatim. The heartbeat-staleness filter, the `idx_trial_runs_prep_pickup` index, the `lock_run_for_chunk` and `increment_run_counters` RPCs, the cron job, and the trigger function are ALL preserved unchanged.

The cron tick remains the **safety-net** for v5 (kicks the chain back to life if the worker dies mid-budget). Self-invoke is the **primary scheduler** — it carries the chain forward without cron-wait latency.

---

## §3 Edge Function Layer — `handleProcessChunk` (BINDING)

### §3.1 New body shape (REPLACE existing handleProcessChunk verbatim)

The new `handleProcessChunk` wraps the existing decider in a budget loop. Steps 1-3 (lock, status check, heartbeat) run ONCE at the start. Then the loop runs phase iterations until budget exhausted or work runs out. Then end-of-budget self-invoke fires if more work remains.

**Pseudocode (binding — implementor must match this control flow exactly):**

```typescript
async function handleProcessChunk(
  db: SupabaseClient,
  body: Record<string, unknown>,
  geminiKey: string,
  serperKey: string,
): Promise<Response> {
  const runId = body.run_id as string;
  if (!runId) return json({ error: "run_id required" }, 400);

  const startedAtMs = Date.now();
  const BUDGET_MS = 110_000;             // 110s — leaves 40s headroom under 150s edge-fn timeout
  const SAFETY_MAX_ITERATIONS = 6;       // belt+suspenders against runaway loop on bug

  // ─── Step 1: Lock + status check (ONCE per invocation) ────────────────
  const { data: run, error: lockErr } = await db.rpc("lock_run_for_chunk", { p_run_id: runId });
  if (lockErr) {
    if (lockErr.code === "55P03" || lockErr.code === "23P01") {
      return json({ skipped: true, reason: "concurrent_worker" });
    }
    return json({ error: `lock failed: ${lockErr.message}` }, 500);
  }
  if (!run) return json({ error: "run not found" }, 404);

  if (run.status === "cancelling") {
    // v3 + v2 cancel-cleanup branch — UNCHANGED VERBATIM from v4
    await db.from("place_intelligence_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", runId);
    await db.from("place_intelligence_trial_runs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "cancelled by operator",
      })
      .eq("parent_run_id", runId)
      .in("status", ["pending", "running"]);
    return json({ ok: true, action: "cancelled" });
  }
  if (run.status !== "running") {
    return json({ skipped: true, reason: `status=${run.status}` });
  }
  if (run.processed_count >= run.total_count) {
    await db.from("place_intelligence_runs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ ok: true, action: "complete" });
  }

  // ─── Step 2: Heartbeat update (ONCE per invocation, at start) ─────────
  // Per Investigation §3.5: heartbeat MUST be updated only at chunk start, not
  // during the budget loop. Refreshing mid-budget would extend the cron-staleness
  // wait for the NEXT recovery kick (worse, not better).
  await db.from("place_intelligence_runs")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", runId);

  // ─── Step 3: Budget loop ──────────────────────────────────────────────
  let iterations = 0;
  let totalScored = 0;
  let totalPrepped = 0;
  let totalReclaimed = 0;
  let runComplete = false;
  let exitReason: string = "budget_exhausted";

  while (Date.now() - startedAtMs < BUDGET_MS && iterations < SAFETY_MAX_ITERATIONS) {
    iterations++;

    // Re-check cancel signal each iteration. If operator clicked Cancel mid-budget,
    // the parent.status flips to 'cancelling' — bail out fast.
    const { data: liveRun, error: liveErr } = await db
      .from("place_intelligence_runs")
      .select("status, processed_count, total_count")
      .eq("id", runId)
      .maybeSingle();
    if (liveErr || !liveRun) {
      exitReason = "live_status_check_failed";
      break;
    }
    if (liveRun.status === "cancelling") {
      // Same v3 cancel-cleanup pattern as Step 1
      await db.from("place_intelligence_runs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", runId);
      await db.from("place_intelligence_trial_runs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "cancelled by operator",
        })
        .eq("parent_run_id", runId)
        .in("status", ["pending", "running"]);
      return json({
        ok: true,
        action: "cancelled_mid_budget",
        iterations,
        scored: totalScored,
        prepped: totalPrepped,
      });
    }
    if (liveRun.processed_count >= liveRun.total_count) {
      await db.from("place_intelligence_runs")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("id", runId);
      runComplete = true;
      exitReason = "complete";
      break;
    }

    // Decide phase. Score-priority preserved from v4.
    const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: scoreEligibleCount, error: countErr } = await db
      .from("place_intelligence_trial_runs")
      .select("id", { count: "exact", head: true })
      .eq("parent_run_id", runId)
      .eq("prep_status", "ready")
      .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`);
    if (countErr) {
      exitReason = `phase_decide_failed: ${countErr.message}`;
      break;
    }

    const phase = (scoreEligibleCount ?? 0) > 0 ? "score" : "prep";
    console.log(`[v5 budget-loop] iter=${iterations} runId=${runId} phase=${phase} elapsed=${Date.now() - startedAtMs}ms`);

    if (phase === "score") {
      const result = await runScoreIteration({ db, geminiKey, runId, stuckCutoff });
      totalScored += result.scored;
      totalReclaimed += result.reclaimed;
      if (result.scored === 0) {
        // Nothing to score — flip to prep next iteration (which will check prep eligibility).
        // Don't break here; let next iteration re-decide.
        continue;
      }
    } else {
      const result = await runPrepIteration({ db, serperKey, runId, stuckCutoff });
      totalPrepped += result.prepped;
      totalReclaimed += result.reclaimed;
      if (result.prepped === 0 && result.prep_failed === 0) {
        // No prep work AND score was already empty (we wouldn't be in prep phase otherwise) →
        // nothing more to do this invocation. Defensively re-check completion.
        const { data: doneCheck } = await db
          .from("place_intelligence_runs")
          .select("processed_count, total_count")
          .eq("id", runId)
          .maybeSingle();
        if (doneCheck && doneCheck.processed_count >= doneCheck.total_count) {
          await db.from("place_intelligence_runs")
            .update({ status: "complete", completed_at: new Date().toISOString() })
            .eq("id", runId);
          runComplete = true;
          exitReason = "complete";
        } else {
          exitReason = "prep_no_eligible_yet";
        }
        break;
      }
    }
  }

  if (iterations >= SAFETY_MAX_ITERATIONS) {
    exitReason = "safety_max_iterations";
    console.warn(`[v5 budget-loop] hit SAFETY_MAX_ITERATIONS=${SAFETY_MAX_ITERATIONS} for run=${runId}`);
  }

  // ─── Step 4: End-of-budget self-invoke (fire-and-forget) ──────────────
  // If run is not complete and we exited the loop for any reason other than completion,
  // fire pg_net to ourselves to chain to the next invocation. The cron tick still serves
  // as recovery if this self-invoke fails — but in the happy path, it skips the
  // 30-60s heartbeat-staleness wait.
  if (!runComplete) {
    const { data: chainCheckRun } = await db
      .from("place_intelligence_runs")
      .select("status, processed_count, total_count")
      .eq("id", runId)
      .maybeSingle();
    const shouldChain = chainCheckRun
      && chainCheckRun.status === "running"
      && chainCheckRun.processed_count < chainCheckRun.total_count;
    if (shouldChain) {
      const selfUrl = Deno.env.get("SUPABASE_URL")
        ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/run-place-intelligence-trial`
        : "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      // Fire-and-forget. If this fails, cron picks it up via heartbeat-staleness.
      // We deliberately do NOT await this — let the response return immediately.
      // Use EdgeRuntime.waitUntil so the runtime keeps the request in-flight after we return.
      try {
        // @ts-ignore — EdgeRuntime is Supabase-provided global, may not be in @types
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(
            fetch(selfUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ action: "process_chunk", run_id: runId }),
            }).catch((err) => {
              console.warn(`[v5 self-invoke] dispatch failed (cron will recover): ${err}`);
            }),
          );
        } else {
          // Fallback: schedule via DB pg_net.http_post
          await db.rpc("noop_or_other_pgnet_helper_if_exists", {
            // implementor: if EdgeRuntime.waitUntil unavailable, use db.rpc with
            // a pg_net.http_post wrapper. Only needed if Supabase runtime varies.
          }).catch(() => {});
        }
      } catch (err) {
        console.warn(`[v5 self-invoke] error scheduling self-invoke (cron will recover): ${err}`);
      }
    }
  }

  return json({
    ok: true,
    iterations,
    scored: totalScored,
    prepped: totalPrepped,
    reclaimed: totalReclaimed,
    exit_reason: exitReason,
    run_complete: runComplete,
    elapsed_ms: Date.now() - startedAtMs,
  });
}
```

**Implementor notes on §3.1:**
- The OLD `processScorePhase` and `processPrepPhase` functions are REPLACED by `runScoreIteration` and `runPrepIteration` (specified in §3.2 and §3.3). The names change to signal "this runs INSIDE the budget loop, not as a top-level handler."
- Heartbeat update happens ONCE at chunk start (Step 2). Investigation §3.5 + §4 root-cause Field 4 explain why mid-budget heartbeat refresh would WORSEN throughput (extends cron-recovery wait).
- The cancel-mid-budget check at the top of each iteration ensures SC-08 still holds (cancel observed within ≤90s, since each iteration is ≤30s and the worst-case wait is 1 iteration).
- `SAFETY_MAX_ITERATIONS = 6` is belt+suspenders. With 110s budget and ~30s per prep iteration + ~25s per score iteration, max realistic iterations is ~4. 6 is comfortable margin.
- Self-invoke uses `EdgeRuntime.waitUntil` to keep the fetch alive after the response returns. If the API is unavailable in the deployed runtime, fall back to skipping the self-invoke entirely — cron will recover within ≤90s. Document the fallback in implementation report.
- Service-role key for self-invoke: prefer `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` (Supabase auto-populates this in edge fn env). If unavailable, propagate from the original Authorization header.

### §3.2 New helper `runScoreIteration` (REPLACES processScorePhase)

Same body as v4's `processScorePhase` but with TWO changes:
1. `.limit(12)` → `.limit(6)` (matches new prep output cadence)
2. Returns `{ scored: number, failed: number, reclaimed: number }` instead of a Response (the budget loop wraps it; only the top-level handler returns JSON).

```typescript
async function runScoreIteration(args: {
  db: SupabaseClient;
  geminiKey: string;
  runId: string;
  stuckCutoff: string;
}): Promise<{ scored: number; failed: number; reclaimed: number }> {
  const { db, geminiKey, runId, stuckCutoff } = args;

  const { data: pickupRows, error: pickupErr } = await db
    .from("place_intelligence_trial_runs")
    .select("id, place_pool_id, signal_id, anchor_index, status, started_at")
    .eq("parent_run_id", runId)
    .eq("prep_status", "ready")
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
    .limit(6);                                                              // CHANGED v4 → v5: 12 → 6

  if (pickupErr) throw new Error(`score pickup failed: ${pickupErr.message}`);
  if (!pickupRows || pickupRows.length === 0) {
    return { scored: 0, failed: 0, reclaimed: 0 };
  }

  const reclaimed = pickupRows.filter((r) => r.status === "running").length;
  if (reclaimed > 0) {
    console.warn(`[v5 score] reclaimed ${reclaimed} stuck-running rows for run=${runId}`);
  }

  const rowIds = pickupRows.map((r) => r.id);
  await db.from("place_intelligence_trial_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .in("id", rowIds);

  // Promise.all parallel — score is memory-light (Gemini gets URL only)
  const results = await Promise.all(pickupRows.map(async (row) => {
    try {
      const cost = await processOnePlace({
        db,
        geminiKey,
        runId,
        anchor: {
          place_pool_id: row.place_pool_id,
          signal_id: row.signal_id,
          anchor_index: row.anchor_index,
        },
      });
      return { ok: true, place_pool_id: row.place_pool_id, cost };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[v5 score] row ${row.place_pool_id} failed: ${msg}`);
      await db.from("place_intelligence_trial_runs")
        .update({
          status: "failed",
          error_message: msg.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { ok: false, place_pool_id: row.place_pool_id, error: msg, cost: 0 };
    }
  }));

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const chunkCost = results.reduce((s, r) => s + (r.cost || 0), 0);

  await db.rpc("increment_run_counters", {
    p_run_id: runId,
    p_processed: results.length,
    p_succeeded: succeeded,
    p_failed: failed,
    p_cost: chunkCost,
  });

  return { scored: results.length, failed, reclaimed };
}
```

### §3.3 New helper `runPrepIteration` (REPLACES processPrepPhase) — PARALLEL-2 with `.limit(6)`

```typescript
async function runPrepIteration(args: {
  db: SupabaseClient;
  serperKey: string;
  runId: string;
  stuckCutoff: string;
}): Promise<{ prepped: number; prep_failed: number; reclaimed: number }> {
  const { db, serperKey, runId, stuckCutoff } = args;

  const { data: pickupRows, error: pickupErr } = await db
    .from("place_intelligence_trial_runs")
    .select("id, place_pool_id, status, started_at")
    .eq("parent_run_id", runId)
    .is("prep_status", null)
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
    .limit(6);                                                              // CHANGED v4 → v5: 3 → 6

  if (pickupErr) throw new Error(`prep pickup failed: ${pickupErr.message}`);
  if (!pickupRows || pickupRows.length === 0) {
    return { prepped: 0, prep_failed: 0, reclaimed: 0 };
  }

  const reclaimed = pickupRows.filter((r) => r.status === "running").length;
  if (reclaimed > 0) {
    console.warn(`[v5 prep] reclaimed ${reclaimed} stuck-prep rows for run=${runId}`);
  }

  const rowIds = pickupRows.map((r) => r.id);
  await db.from("place_intelligence_trial_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .in("id", rowIds);

  // PARALLEL-2 prep: process pairs concurrently to halve wallclock.
  // Memory: 2 simultaneous compose_collage instances ≈ 100 MB peak (well under 150 MB cap).
  // If ANY WORKER_RESOURCE_LIMIT 546 errors observed post-deploy, REVERT to serial-1
  // (set PARALLEL_PREP=1 below) and escalate to v6.
  const PARALLEL_PREP = 2;                                                  // NEW v5 — parallel prep
  let preppedCount = 0;
  let prepFailedCount = 0;

  for (let i = 0; i < pickupRows.length; i += PARALLEL_PREP) {
    const batch = pickupRows.slice(i, i + PARALLEL_PREP);
    const batchResults = await Promise.all(batch.map(async (row) => {
      try {
        // fetch_reviews (idempotent — skips if fresh-within-30-days)
        await handleFetchReviews(db, {
          place_pool_id: row.place_pool_id,
          force_refresh: false,
        }, serperKey);

        // compose_collage (idempotent — skips if fingerprint-matched cache)
        const collageRes = await handleComposeCollage(db, {
          place_pool_id: row.place_pool_id,
          force: false,
        });
        const collageBody = await collageRes.json();
        if (collageBody.error) {
          throw new Error(`compose_collage failed: ${collageBody.error}`);
        }

        // Mark prepared: prep_status='ready', status back to 'pending', started_at NULL
        await db.from("place_intelligence_trial_runs")
          .update({ prep_status: "ready", status: "pending", started_at: null })
          .eq("id", row.id);
        return { ok: true } as const;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[v5 prep] row ${row.place_pool_id} prep failed: ${msg}`);
        await db.from("place_intelligence_trial_runs")
          .update({
            status: "failed",
            error_message: `prep: ${msg.slice(0, 500)}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        return { ok: false } as const;
      }
    }));

    for (const r of batchResults) {
      if (r.ok) preppedCount++;
      else prepFailedCount++;
    }
  }

  if (prepFailedCount > 0) {
    await db.rpc("increment_run_counters", {
      p_run_id: runId,
      p_processed: prepFailedCount,
      p_succeeded: 0,
      p_failed: prepFailedCount,
      p_cost: 0,
    });
  }

  return { prepped: preppedCount, prep_failed: prepFailedCount, reclaimed };
}
```

**Implementor notes on §3.3:**
- The `for (let i = 0; i < ...; i += PARALLEL_PREP)` loop processes pairs of rows concurrently via Promise.all, then waits for each pair to complete before starting the next. This bounds memory to 2 simultaneous compose_collage instances.
- `PARALLEL_PREP = 2` is hardcoded as a const at the top of the function. If ANY 546 errors appear post-deploy, change to `PARALLEL_PREP = 1` (revert to serial), redeploy, and escalate to v6.
- `.limit(6)` matches the new score `.limit(6)` for output-balance, AND fits 3 batches × 30s = 90s wallclock — comfortably under any single iteration's edge-fn slice.

---

## §4 Service / Hook / Component / Realtime Layers

**No changes.**

- Service layer: not applicable (admin uses direct Supabase client)
- Hook layer: not applicable
- Component layer: admin UI shows polling-based progress; no UI changes needed
- Realtime: not used by ORCH-0737

---

## §5 Success Criteria (numbered, observable, testable, unambiguous)

| SC# | Criterion |
|-----|-----------|
| **SC-V5-01** | Cary 761 full-city run completes in ≤ 5 hours wallclock (target: ~4 hours). Measured from `started_at` to `completed_at` of `place_intelligence_runs` row. |
| **SC-V5-02** | Steady-state throughput ≥ 2.5 rows/min (target: 3-4 rows/min) measured over any 10-minute sliding window after the first 5 minutes of warm-up. Measured via `count(*) FILTER (WHERE status='completed') / 10` against `place_intelligence_trial_runs` for the active parent_run_id. |
| **SC-V5-03** | Zero `WORKER_RESOURCE_LIMIT 546` errors in `net._http_response` table for the duration of the Cary smoke test. Measured via `SELECT count(*) FROM net._http_response WHERE status_code = 546 AND created > <run_start>`. |
| **SC-V5-04** | Cancel observability ≤ 90 seconds. Operator clicks Cancel mid-run; parent.status flips `running` → `cancelling` → `cancelled` within 90s. Measured via timestamp diff between operator-visible cancel click and `place_intelligence_runs.completed_at` of the cancelled row. |
| **SC-V5-05** | Stuck-row recovery preserved in BOTH phases. Simulated worker death mid-prep (`UPDATE ... SET status='running', prep_status=NULL, started_at=now()-interval '6 minutes' WHERE id IN (...)` against 3 rows) → next budget-loop iteration in prep phase reclaims them with `[v5 prep] reclaimed N stuck-prep rows` log. Same for score phase with `prep_status='ready'`. |
| **SC-V5-06** | No double-processing of any row. After Cary smoke completes, `succeeded_count + failed_count = processed_count = total_count`, AND `count(*) FROM place_intelligence_trial_runs WHERE parent_run_id=:runId AND status='completed'` matches `succeeded_count`. |
| **SC-V5-07** | Cold-restart resilience preserved. `supabase functions deploy run-place-intelligence-trial` mid-Cary-run does NOT corrupt state; current invocation completes (or is killed by deploy), next cron tick re-kicks worker via heartbeat-staleness, run resumes within ≤ 120s of deploy. |
| **SC-V5-08** | All 7 SPEC v2 §11 invariants preserved (I-TRIAL-CITY-RUNS-CANONICAL, I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING, I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS, I-TRIAL-RUN-SCOPED-TO-CITY, I-PHOTO-AESTHETIC-DATA-SOLE-OWNER, I-COLLAGE-SOLE-OWNER, I-BOUNCER-DETERMINISTIC). Verifiable via grep: no schema migrations in v5; worker still writes only to trial tables; pickup queries unchanged in `is_servable` / `parent_run_id` semantics. |
| **SC-V5-09** | Sample mode untouched. Cary 50 sample run completes successfully with same wallclock as pre-v5. Regression spot-check. |
| **SC-V5-10** | Self-invoke chain advances ≤ 5 seconds between worker invocations in steady state. Measured via timestamp diff between consecutive `[v5 budget-loop] iter=1` log entries (or via pg_net response timestamps minus a fixed offset for HTTP latency). If gap > 30s consistently, self-invoke is failing — investigate. |

---

## §6 Invariants Preservation Strategy

| Invariant | Preservation Strategy | Test |
|-----------|----------------------|------|
| I-TRIAL-CITY-RUNS-CANONICAL (DEC-110) | Worker code unchanged at city_id boundary. Pickup queries scope by `parent_run_id`. | SC-V5-08 |
| I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING | Worker writes only to `place_intelligence_runs` + `place_intelligence_trial_runs`. v5 changes do not introduce any new write path. | SC-V5-08 |
| I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS (DEC-107) | start_run still queries `is_servable=true`. Worker pickup operates on already-filtered rows. | SC-V5-08 |
| I-TRIAL-RUN-SCOPED-TO-CITY | Schema unchanged. parent_run_id FK preserved. | SC-V5-08 |
| I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | Worker doesn't write `photo_aesthetic_data`. v5 doesn't touch this. | SC-V5-08 |
| I-COLLAGE-SOLE-OWNER | Prep iteration delegates to existing `handleComposeCollage` (sole writer). Parallel-2 calls still go through the single SQL UPDATE path inside that function. | SC-V5-08 |
| I-BOUNCER-DETERMINISTIC | Bouncer code path untouched. | SC-V5-08 |

**No new invariants** are established by v5. The fix is purely a scheduler optimization within the existing architectural frame.

---

## §7 Test Cases

| T# | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| **T-V5-01** | Fresh full-city run on Cary | start_run mode=full_city city=Cary | Run completes in 4-5 hours; SC-V5-01, SC-V5-02, SC-V5-03 all PASS | Worker + scheduler |
| **T-V5-02** | Steady-state throughput measurement | 10-min window mid-run | ≥ 2.5 rows/min; ideally 3-4 | Worker |
| **T-V5-03** | Memory safety under parallel-2 prep | Cary smoke run | Zero 546 errors | Worker memory |
| **T-V5-04** | Cancel mid-budget | Click Cancel during a budget-loop iteration | parent flips cancelling→cancelled within ≤90s; pending+running children flipped cancelled | Worker + cancel branch |
| **T-V5-05a** | Stuck-prep recovery | UPDATE 3 prep_status=NULL rows to status='running', started_at=now()-6min | Next worker iteration reclaims; `[v5 prep] reclaimed 3` log | Worker prep recovery |
| **T-V5-05b** | Stuck-score recovery | UPDATE 3 prep_status='ready' rows to status='running', started_at=now()-6min | Next worker iteration reclaims; `[v5 score] reclaimed 3` log | Worker score recovery |
| **T-V5-06** | No double-processing | Post-Cary completion, query distribution | succeeded+failed=processed=total; row-status matches counters | DB state validation |
| **T-V5-07** | Cold-restart mid-run | Run Cary; mid-run, `supabase functions deploy`. Wait. | Run resumes within 120s of deploy; no state corruption | Deploy + recovery |
| **T-V5-08** | Self-invoke chain functioning | Inspect logs between iter=1 entries from consecutive invocations | Gap ≤ 5s most of the time; cron-recovery only if self-invoke failed | Self-invoke + scheduler |
| **T-V5-09** | Sample mode regression | Cary 50 sample mode | Completes in ~25 min, $0.21, no errors | Sample mode (separate code path) |
| **T-V5-10** | Self-invoke fallback to cron-only | Manually disable EdgeRuntime.waitUntil (or test in environment without it) | Run still completes; cron-driven cycle resumes at ~120s intervals; throughput drops to ~1-1.5 rows/min but no failure | Fallback path |

---

## §8 Implementation Order

1. **Read** `supabase/functions/run-place-intelligence-trial/index.ts` lines 1452-1785 (current handleProcessChunk + helpers).
2. **Verify** SAFETY_MAX_ITERATIONS = 6 + BUDGET_MS = 110000 are correct constants.
3. **Replace** `handleProcessChunk` body with the §3.1 budget-loop pattern.
4. **Replace** `processScorePhase` with `runScoreIteration` per §3.2 (rename + return-shape change + .limit(12) → .limit(6)).
5. **Replace** `processPrepPhase` with `runPrepIteration` per §3.3 (rename + return-shape change + .limit(3) → .limit(6) + parallel-2 batching).
6. **Add** the EdgeRuntime.waitUntil self-invoke at end of handleProcessChunk per §3.1 Step 4.
7. **No DB migration needed.** No admin UI changes needed.
8. **Static-trace verify**: grep for old function names (`processScorePhase`, `processPrepPhase`) — should find zero matches in updated file.
9. **Static-trace verify**: confirm BUDGET_MS = 110000, SAFETY_MAX_ITERATIONS = 6, PARALLEL_PREP = 2, .limit(6) in both runs.
10. **Confirm v3 + v2 patches preserved**: cancel-cleanup `["pending","running"]` still at handleCancelTrial line 1443 AND new in handleProcessChunk Step 1 AND inside the budget-loop cancel-mid-budget branch. Stuck-cutoff 5min still computed correctly.

---

## §9 Operator Deploy Sequence (post-implementor handback)

**CRITICAL: the current Cary run is in flight.** v5 is a hot-deploy patch.

1. **Operator decision needed BEFORE deploy:** does operator want to (a) let current Cary run finish at v4 throughput (~16 hours from start), (b) cancel it and restart on v5, (c) deploy v5 hot and let the in-flight run pick up the new code automatically? **Recommended: (c)** — v5 is backward-compatible with v4-prepped rows. Worker mid-deploy will be killed; cron re-kicks; new code resumes seamlessly.
2. `supabase functions deploy run-place-intelligence-trial` — applies new edge fn body. Mid-flight worker invocations will be killed; cron re-kicks within ≤90s.
3. **Verify** new code is live: query `pg_net._http_response` after 2 minutes; expect bodies containing `"iterations": <N>` (new field) instead of the v4 `"phase": "prep|score"` shape.
4. **Watch throughput** for 10 min post-deploy. Expect 25-35 rows scored in 10 min (≥ 2.5 rows/min). If less, suspect self-invoke failing — check logs for `[v5 self-invoke]` entries.
5. **Watch for 546 errors** — `SELECT count(*) FROM net._http_response WHERE status_code = 546 AND created > now() - interval '15 minutes'`. If > 0, parallel-2 prep is too aggressive — revert PARALLEL_PREP=1 immediately (one-line edit + redeploy).
6. **Mid-run cancel test (optional but recommended):** start a fresh small-city run after Cary completes; click Cancel within first 2 min; verify parent flips cancelled within 90s and child rows are properly cleaned.
7. **After Cary completes:** report results to orchestrator. CLOSE protocol if all SCs PASS.

---

## §10 Rollback Plan

If v5 introduces ANY regression:

```bash
# Step 1: revert edge fn
git revert <v5-commit-sha>
supabase functions deploy run-place-intelligence-trial
# This restores v4 worker code. Estimated revert wallclock: ~5 min.
```

No DB rollback needed (no migrations in v5).

In-flight runs: cron will re-kick the v4 worker within ≤90s. Run resumes at v4 throughput.

---

## §11 Regression Surface (operator post-deploy spot-check)

1. **Sample mode** — separate browser-driven code path. Quick Cary 50 sample regression test (T-V5-09). Should complete in ~25 min unchanged.
2. **`handleStartRun`** — unchanged in v5, but inserts pending children with `prep_status=NULL` (correct default; v4 schema preserved).
3. **`handleCancelTrial`** — unchanged. v3 cancel-cleanup branch in worker preserved.
4. **`handleListActiveRuns`** — unchanged.
5. **Admin UI active-run polling** — unchanged. UI reads `place_intelligence_runs.status` and `processed_count` (counter atomic via `increment_run_counters`); no impact from worker refactor.
6. **pg_cron schedule** — unchanged. v3 cron filter unchanged.
7. **Vault service_role_key** — unchanged. New self-invoke uses the SAME service-role authentication as the cron-fired pg_net call.

---

## §12 Effort Estimate

- Implementor wallclock: **30-45 minutes** (1 file edit; no migrations; no UI changes; no tests beyond static-trace).
- Operator deploy + smoke wallclock: **~4 hours** (Cary 761 at v5 throughput).

---

## §13 Confidence

- **HIGH** on root cause (live runtime probes, deterministic measurements, six-field evidence — see Investigation §3-§4).
- **HIGH** on chosen lever combo correctness (budget-loop + parallel-2 prep + self-invoke is well-understood scheduling pattern; no architectural risk).
- **MEDIUM** on throughput projection (~3-4 rows/min). Real-world prep wallclock may be 25-35s instead of assumed 30s; range tolerance built into SC-V5-02 (≥ 2.5 rows/min PASS bar).
- **LOW** on hitting operator's ≤60-min Cary target. v5 closes ~75% of the gap; v6 architectural change required for full closure. **Operator must accept this honestly before signing off on v5.**

---

## §14 Cross-references

- Investigation: [`reports/INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md`](../reports/INVESTIGATION_ORCH-0737_V5_THROUGHPUT.md)
- Forensics dispatch: [`prompts/FORENSICS_ORCH-0737_V5_THROUGHPUT.md`](../prompts/FORENSICS_ORCH-0737_V5_THROUGHPUT.md)
- Parent spec: [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md`](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md) — all SC-01..SC-22 + 7 invariants stand
- Predecessor patches: v1 IMPLEMENTATION report, v2 PATCH report, v3 PATCH report, v4 PATCH report
- DEC-111 (parent architecture)
- Followup ORCHs queued: ORCH-0737-followup-3 (pg_net score-response capture), ORCH-0737-followup-4 (composeCollage native-resolution decode → tile-resolution), ORCH-0737-followup-5 (FOR UPDATE SKIP LOCKED hardening)
- Future: ORCH-0739 v6 architectural rework (self-fetch compose_collage OR partition-based two-chain) — depends on operator decision after v5 ships
