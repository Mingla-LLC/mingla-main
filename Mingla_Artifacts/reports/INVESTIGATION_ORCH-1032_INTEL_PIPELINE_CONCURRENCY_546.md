# INVESTIGATION — ORCH-1032 [Intelligence pipeline concurrency cap + chunked enqueue]

**Date:** 2026-06-01
**Investigator:** mingla-orchestrator+claude (live forensic, full probe authority)
**Trigger:** Operator (Seth) cannot start the London intelligence-pipeline (remainder) run.
Admin UI shows: `Couldn't start remainder run — Function failed due to not having
enough compute resources (please check logs)`.

**Affected Surfaces:** admin-web (`mingla-admin/` pipeline UI renders run status) + backend
(`supabase/functions/run-place-intelligence-trial` + `supabase/migrations` cron/status).
**Surfaces explicitly NOT in scope:** iOS-consumer, Android-consumer, business-iOS,
business-Android, buyer-web — none touch the place-intelligence pipeline (admin-only flow).

---

## 1. Symptom → exact failure point

The error string is the admin client's fallback in
`mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx`
(via `mingla-admin/src/lib/edgeFunctionError.js`), shown when the `start_run` POST to
`run-place-intelligence-trial` returns a non-JSON error — here **HTTP 546**
(`WORKER_LIMIT` / "not enough compute resources"), the Supabase Edge runtime's
compute-exhaustion response.

The failure is at **`action: "start_run"`, `mode: "remainder"`**, inside
`handleStartRun` — NOT in the background worker.

## 2. Live evidence (probed 2026-06-01 ~04:34 UTC)

**(a) Five city runs already active (`place_intelligence_runs` where status active):**

| city | mode | status | processed / total | heartbeat age |
|---|---|---|---|---|
| Washington | remainder | running | 435 / 2298 | 54s |
| Brussels | remainder | running | 452 / 1858 | 54s |
| Fort Lauderdale | remainder | running | 445 / 958 | 54s |
| Lagos | remainder | running | 676 / 908 | 54s |
| Durham | remainder | running | 396 / 609 | 114s |

All five healthy and progressing.

**(b) London is the 6th and by far the heaviest to *start*:**
`place_pool` servable for London = **10,706**, distinct completed = **0**.
A London remainder run must therefore enqueue **all 10,706** places at once
(vs 609–2,298 for the active five).

**(c) Edge logs for `run-place-intelligence-trial` (function id `f8a15c96…`, v191):**
interleaved `200` and **`546`** responses. Short ~3–4s `546`s = London `start_run`
attempts denied compute; long 33–52s `546`s = the *existing* runs' own budget-loop
workers being killed mid-iteration under contention (they self-heal via the cron
re-kick, so the five keep progressing).

## 3. Root cause (proven, two compounding factors)

**RC-1 — Un-enforced concurrency ceiling.** The pipeline was *designed* around a
hard ceiling of **5 concurrent runs**:
- `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` →
  `tg_kick_pending_trial_runs()` selects active runs `ORDER BY created_at ASC LIMIT 5`,
  with the comment *"Pick up to 5 runs needing a kick (max 5 concurrent runs)"* and the
  function COMMENT *"picks up to 5 active runs"*.
- The Supabase Edge compute pool has just enough headroom for ~5 self-invoking
  110s worker chains (each run is a chain, not one request: `EdgeRuntime.waitUntil`
  self-invoke + pg_cron re-kick every 60s + `lock_run_for_chunk` NOWAIT retries).

But **`handleStartRun` has NO gate** — it inserts a new parent row as `status:'running'`
regardless of how many are already active (only the per-city unique partial index blocks
a *duplicate same-city* run). So the operator can start a 6th run; the platform can't run
it and the cron will never service it → `546` at start, or a stranded run.

There are exactly 5 active now → the operator hit the undocumented ceiling.

**RC-2 — Single-isolate giant enqueue.** `handleStartRun` (index.ts ~1300–1316) loads all
servable rows, builds one `pendingRows` array of up to 10,706 objects, and does a single
`.upsert(pendingRows)`. For London (10,706) this is the most memory-hungry single
invocation in the pipeline and the one most likely to trip `546` even at the margin —
independent of concurrency.

## 4. Fix contract (for SPEC)

1. **Concurrency gate** in `handleStartRun`: before inserting, count active runs; if
   `running >= CAP`, insert the parent as new status **`'queued'`** (do NOT kick, do NOT
   error). Return a friendly "queued — will auto-start when a slot frees, N ahead" payload.
2. **`'queued'` status**: add to the `place_intelligence_runs.status` CHECK constraint
   (`pending|queued|running|cancelling|cancelled|complete|failed`). Keep the per-city
   unique active index covering `queued` too (one pending/queued/running/cancelling per city).
3. **Cron promotion**: in `tg_kick_pending_trial_runs()`, at tick start count `running`;
   if `< CAP`, promote oldest `queued` run(s) to `running` (stamp `started_at`) up to the
   free-slot count, then kick. This is the "system paces itself" behaviour.
4. **One source of truth for CAP**: a named constant referenced by BOTH the edge gate and
   the cron `LIMIT`. **Recommended default = 4** (the live evidence shows intermittent
   worker-`546`s at 5 → leave one slot of headroom). Operator to confirm 4 vs 5 at REVIEW.
5. **Chunked enqueue**: replace the single giant `.upsert(pendingRows)` with a batched loop
   (~500–1000 rows per upsert) so a 10k-city enqueue cannot blow the start_run isolate.
6. **Admin UI**: render the `queued` state in the pipeline run list + start modal
   ("Queued — waiting for a slot"); do not treat it as an error/failure.

**Hard guards:** must not stop, cancel, or alter the 5 in-flight runs. Migration must be
additive (CHECK-constraint widen + function replace only) and safe to apply with active
rows present. Edge `verify_jwt` setting preserved on redeploy.
