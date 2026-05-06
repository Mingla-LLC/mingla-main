# INVESTIGATION REPORT — ORCH-0737 FULL-CITY ASYNC TRIAL MODE

**ORCH-ID:** ORCH-0737
**Mode:** INVESTIGATE-THEN-SPEC (this report = INVESTIGATE phase)
**Confidence:** **HIGH** — all 5 truth layers verified; live runtime evidence + DB schema + edge fn code + admin UI code + memory artifacts all read.
**Predecessor binding context:** ORCH-0734 (DEC-110 — sampled-sync architecture); ORCH-0735 (DEC-107 — `I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS` upstream pool gate)

---

## 0. Layman Summary

The current trial pipeline relies on the **browser tab to drive the loop**. The admin's "Run trial" button kicks off a JavaScript `for` loop that calls the edge function once per place. If the operator closes the tab, refreshes the page, or logs out, **the loop terminates** and any unprocessed `pending` rows in the database are stranded forever.

**Empirical evidence**: 79 orphaned `pending` rows currently exist in `place_intelligence_trial_runs` from prior runs where the operator closed the tab mid-flight. This isn't theoretical — it's already happening in production.

ORCH-0737 fixes this by **moving the loop driver from browser to server**. After operator confirms the cost dialog, the run is registered in the DB; from that point forward, a server-side worker (driven by pg_cron) picks up pending rows and processes them autonomously. Browser becomes a status viewer, not the engine.

**Recommended architecture: pg_cron tick + worker edge function (Pattern B with parallel chunks).** Both required Postgres extensions (`pg_cron` v1.6.4 + `pg_net` v0.19.5) are already enabled. No new vendor dependencies. Simplest path to durable execution that meets the operator's behavioral contract.

---

## 1. Symptom Summary

| Aspect | Finding |
|--------|---------|
| **Expected behavior** | Operator clicks "Run whole city" + confirms cost dialog → run executes server-side autonomously, durable across tab close / refresh / logout, until operator explicitly clicks Cancel |
| **Actual behavior (today, sample mode)** | Browser tab IS the loop driver. `handleRunTrial` in `TrialResultsTab.jsx` runs two sequential `for` loops calling the edge function once per place. If tab closes, JS execution stops, pending rows stay pending forever. |
| **Reproduction** | Always. 79 orphaned `pending` rows currently in DB from prior runs |
| **When it started** | This pattern has been the architecture since ORCH-0712 (initial trial pipeline). ORCH-0734 made `start_run` city-scoped but kept the browser-loop pattern. |

---

## 2. Investigation Manifest

| File | Layer | Why I read it |
|------|-------|---------------|
| `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md` | Docs | Dispatch context (full read) |
| `supabase/functions/run-place-intelligence-trial/index.ts` | Code (edge fn) | 1,306 lines — full read of action-dispatch architecture |
| `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx` | Code (admin UI shell) | Tab structure |
| `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` | Code (admin UI logic) | 647 lines — full read of `handleRunTrial` browser-loop driver |
| `supabase/migrations/20260505000001_orch_0734_city_runs.sql` | Schema | Current schema state for `place_intelligence_trial_runs` (post-ORCH-0734) |
| `supabase/migrations/20260505000002_orch_0734_signal_id_nullable.sql` | Schema | Confirm `signal_id` nullable for city-runs |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Docs | I-TRIAL-CITY-RUNS-CANONICAL + I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING + I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS sections |
| `Mingla_Artifacts/DECISION_LOG.md` | Docs | DEC-110 + DEC-107 (binding context) |
| Live SQL: `pg_extension` | Runtime | Confirm `pg_cron` + `pg_net` available (✅ both pre-installed) |
| Live SQL: `place_intelligence_trial_runs` schema | Schema | Verify current columns + check what async needs |
| Live SQL: `place_intelligence_trial_runs` status distribution | Data | **EMPIRICAL: 79 orphaned `pending` rows confirm the operator-pain pattern** |
| Live SQL: `place_intelligence_trial_runs` run-history aggregate | Data | 9 runs / 306 rows total / 1 city-run (Cary 50) / 8 legacy 32-anchor |

---

## 3. Findings (Classified)

### 🔴 Root Cause #1 — Browser-driven loop architecture (the entire problem)

**File + line:** `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx:373-435`

**Exact code (verbatim, abbreviated):**
```jsx
for (let i = 0; i < places.length; i++) {
  if (stopRef.stop) break;
  const p = places[i];
  // ... fetch_reviews + compose_collage per place ...
  setProgress((s) => ({ ...s, succeeded: prepareSucceeded, failed: prepareFailed }));
}
// then phase 2 loop (run_trial_for_place per place)
for (let i = 0; i < places.length; i++) {
  if (stopRef.stop) break;
  // ...
  await invokeWithRefresh("run-place-intelligence-trial", { body: { action: "run_trial_for_place", ... } });
}
```

**What it does:** the browser's JavaScript runtime is the loop driver. Each iteration awaits an HTTP call to the edge function (which processes one place). The loop variable `stopRef.stop` is a client-side ref — only checked at iteration boundary.

**What it should do (post-ORCH-0737):** the operator-side click on "Run whole city" should register the run in the DB with `status='pending'` and exit. A server-side worker (driven by pg_cron tick) picks up pending rows and processes them. Browser becomes a status viewer.

**Causal chain:**
1. Operator clicks "Run trial" → browser begins phase-1 loop (prepare) → ~30s/place
2. After ~3-5 places, operator closes the tab (or hard-refreshes, or logs out, or browser crashes, or laptop sleeps)
3. JavaScript execution context terminates
4. Remaining `pending` rows in `place_intelligence_trial_runs` are stranded — no client and no server is iterating over them
5. Operator returns hours later: 5 of 200 rows show `status=completed`; 195 still `status=pending`. Run is "stuck" with no automatic recovery mechanism.

**Verification step:** I verified this empirically. Queried current `place_intelligence_trial_runs` status distribution:
```
completed: 219
pending:    79  ← orphaned rows from browser-closed loops
failed:      8
```
The 79 pending rows are spread across multiple `run_id` values, with `started_at IS NULL` for all of them — meaning these rows were inserted by `start_run` but never picked up by `run_trial_for_place`. This is the smoking gun.

---

### 🟠 Contributing Factor #1 — Cancel UX is client-side ref, not DB-persisted state

**File + line:** `TrialResultsTab.jsx:458-461` (`handleCancel` function)

**Exact code:**
```jsx
function handleCancel() {
  stopRef.stop = true;
  addToast({ variant: "info", title: "Cancelling…", description: "Will stop after the current place." });
}
```

**What it does:** sets a client-side React ref flag (`stopRef.stop = true`) that the active loop iteration checks at the next iteration boundary.

**What it should do (post-ORCH-0737):** write `status='cancelling'` to a server-side run record. The server-side worker (pg_cron-driven) picks up the cancel signal at the next tick and stops processing the run; updates `status='cancelled'` on the run-level row + leaves any in-flight place row state intact (preserving partial results).

**Causal chain (post-async):** if operator closes tab → reopens → clicks Cancel: today, no-op (client-side ref doesn't exist; loop already terminated by tab close). Post-fix: must persist cancel intent to DB.

**Note:** there IS a `cancel_trial` edge function action that updates `status='cancelled'` for `pending`/`running` rows, but the admin UI's `handleCancel` doesn't call it — it just flips the client-side ref. Bug-adjacent: even today, if the loop is running and tab closes, the existing `cancel_trial` action could be invoked to mark rows cancelled... but admin UI doesn't wire it. (Will be fixed by ORCH-0737 design.)

---

### 🟡 Hidden Flaw #1 — No run-level row exists today

**File + line:** entire schema

**Exact state:** the current `place_intelligence_trial_runs` table is **per-place** (one row per `(run_id, place_pool_id)`). There is NO **per-run** row holding run-level metadata (status, total_count, processed_count, started_by, cost_so_far, cancelled_at, etc.).

**What it does today:** `run_id` is a UUID generated client-side and used as a grouping key. All run-level state must be **derived** by `GROUP BY run_id` aggregation queries.

**What it should do (post-ORCH-0737):** a separate parent table `place_intelligence_runs` (or similarly named) holding one row per run with run-level metadata. The per-place `place_intelligence_trial_runs` rows become children referencing the parent via FK. Run-level state machine (`pending → running → cancelling → cancelled / complete / failed`) lives on parent row.

**Why this matters now:** for async durable execution, the worker needs to know:
- Has this run been cancelled? (check parent.status)
- What's the cursor / processed count? (parent.processed_count)
- When was the last heartbeat? (parent.last_heartbeat_at)
- What's the cost so far? (parent.cost_so_far)

All of these are awkward to derive from per-place rows.

---

### 🟡 Hidden Flaw #2 — `prepare phase` and `trial phase` are sequential per-place but could be merged

**File + line:** `TrialResultsTab.jsx:369-435`

**Exact behavior:** browser does phase-1 loop (fetch_reviews + compose_collage for every place) then phase-2 loop (run_trial_for_place for every place). Each phase walks all places before next phase begins.

**What it does:** double-walk. For 200 places, the browser makes 600 HTTP calls (200 fetch_reviews + 200 compose_collage + 200 run_trial_for_place).

**What it should do (post-ORCH-0737):** for async, prepare + trial should be merged into a single per-place "process" step in the worker. fetch_reviews + compose_collage are idempotent (skip if fresh / fingerprint-matched), so merging them with run_trial_for_place is safe and reduces call count.

**Why flag now:** 600 HTTP calls × the throttle padding × edge function cold-start latency adds material wallclock. Merging halves edge-fn invocation count.

---

### 🔵 Observation #1 — `pg_cron` + `pg_net` extensions pre-installed

**Live SQL evidence:**
```
pg_cron     1.6.4
pg_net      0.19.5
```

Both are pre-installed in the project. **No extension installation required.** The recommended architecture (Pattern B: pg_cron tick + worker edge function via pg_net) is immediately viable.

---

### 🔵 Observation #2 — UNIQUE constraint on (run_id, place_pool_id) already in place

**Migration `20260505000001_orch_0734_city_runs.sql:72-74`:**
```sql
ALTER TABLE public.place_intelligence_trial_runs
  ADD CONSTRAINT place_intelligence_trial_runs_run_place_unique
  UNIQUE (run_id, place_pool_id);
```

**Implication:** retry-safe UPSERT semantics already work. ORCH-0737 worker can re-attempt failed rows via `INSERT ... ON CONFLICT (run_id, place_pool_id) DO UPDATE` without race conditions.

---

### 🔵 Observation #3 — Edge function action `cancel_trial` already exists

**File + line:** `run-place-intelligence-trial/index.ts:1295-1305`

The action sets `status='cancelled'` for `(run_id) AND status IN ('pending','running')`. Admin UI doesn't wire it (only sets client-side ref). Post-ORCH-0737 admin UI must call this OR we can build cancel into the new run-level state machine.

---

### 🔵 Observation #4 — UI already renders `pending`/`running`/`completed`/`failed`/`cancelled` status colors

**File + line:** `TrialResultsTab.jsx:60-67`

```jsx
row.status === "completed" && "bg-[var(--color-success-50)]"
row.status === "running" && "bg-[var(--color-info-50)]"
row.status === "failed" && "bg-[var(--color-error-50)]"
row.status === "pending" && "bg-[var(--gray-100)]"
row.status === "cancelled" && "bg-[var(--color-warning-50)]"
```

**Implication:** UI status rendering is already done at the per-place row level. Adding run-level status (e.g., `cancelling` parent state) requires NEW UI affordance, not retrofit of existing.

---

### 🔵 Observation #5 — Per-place processing time profile

Combining edge function code + UI estimates:
- `fetch_reviews`: ~2-5s (Serper API, idempotent skip if fresh-within-30-days)
- `compose_collage`: ~5-10s (downloads N photos + composes PNG + uploads to Storage; idempotent skip if fingerprint-matched)
- `run_trial_for_place`: ~10-22s (Gemini 2.5 Flash + Q2 evaluation)
- **Steady-state per-place: ~17-37s; UI estimate uses 30s as honest middle**

**Implication for async:** even the optimistic 17s/place case at full London (3495 rows) sequential = ~16.5 hours. Parallelizing within a chunk (e.g., 12 concurrent Gemini calls) compresses to ~5 hours wallclock. Operator's behavioral contract supports this — multi-hour runs are acceptable as long as durable.

---

## 4. Five-Layer Cross-Check

| Layer | What it says today | Post-ORCH-0737 expected |
|-------|--------------------|-----|
| **Docs** | Sampled-sync; ~75 min for sample-200; full-city is "future tool" (per `PlaceIntelligenceTrialPage.jsx` AlertCard copy line 63) | Sampled-sync preserved + new full-city-async mode toggle |
| **Schema** | `place_intelligence_trial_runs` per-place rows; status enum (text); city_id nullable; UNIQUE (run_id, place_pool_id) | + NEW `place_intelligence_runs` parent table with run-level state; + new statuses (`cancelling`); + cursor / heartbeat columns |
| **Code** | `TrialResultsTab.jsx` browser-loop drives phases 1+2; edge fn has 7 actions; `cancel_trial` exists but admin UI ignores it | Browser becomes status viewer; new worker edge fn (or new action) processes pending rows; admin UI calls `cancel_trial` action correctly |
| **Runtime** | `pg_cron` v1.6.4 + `pg_net` v0.19.5 pre-installed; current edge fn timeout configurable per-function in supabase.toml | Add pg_cron job + worker edge fn with appropriate timeout (default 150s should suffice if per-chunk processing is bounded) |
| **Data** | 79 orphaned `pending` rows from prior browser-closed loops; 219 completed; 8 failed across 9 historical runs | Worker drains the 79 pending rows on first deploy (free side-benefit); future runs are durable |

**No layer contradictions.** All 5 layers point to the same architectural shift.

---

## 5. Architecture Decision Matrix

Forensics evaluated 4 architectures. Pattern B (pg_cron + worker edge fn via pg_net) is the recommended primary path.

| Pattern | How it works | Pros | Cons | Verdict |
|---------|-------------|------|------|---------|
| **A1: pg_cron + DB-driven cursor (in-DB worker)** | pg_cron tick every 1 min; SQL function picks up `pending` rows; calls Gemini API directly via pg_net.http_post | Zero edge-fn dependency. Pure DB layer. | Gemini calls from pg_net are async fire-and-forget — can't await response/store evaluation. PostgreSQL is a poor place for image collage composition + base64 encoding. **Architectural mismatch** | ❌ REJECTED |
| **A2 / "Pattern B": pg_cron + worker edge function via pg_net.http_post** | pg_cron tick (every 1 min) → SQL function `tg_kick_pending_trial_runs()` → `pg_net.http_post(worker_edge_fn_url, body={ run_id })` for any run with status `running` and pending rows. Worker edge fn pulls next chunk of pending rows + processes in parallel + exits before edge timeout. | Native Supabase. Durable. Simple control flow. Both extensions pre-installed. Edge fn handles image composition correctly. Failures auto-resume on next tick. | 1-min granularity per chunk. Self-throttle to one chunk per minute per run. Need to enforce single-instance via `SELECT FOR UPDATE` or status flag. | ✅ **RECOMMENDED PRIMARY** |
| **A3 / "Pattern C": Edge function self-invocation chain** | `start_run` triggers worker; worker processes chunk + HTTP-invokes itself for next chunk via service-role | No scheduler dep. Chain latency ~0s vs pg_cron's 1-min granularity. | Chain breakage = orphan run (single network glitch breaks chain). Needs heartbeat + watchdog (which IS pg_cron). De facto becomes Pattern D (hybrid). | ❌ REJECTED as standalone |
| **A4 / "Pattern D": pg_cron watchdog + self-invoke primary** | Same as A2 but worker also self-invokes after each chunk; pg_cron is fallback if `last_heartbeat > 5 min` | Lowest latency (back-to-back chunks). Resilient (cron auto-recovery). | Most complex control flow. Implementor risk higher. Two execution paths to debug. | 🟡 FUTURE EVOLUTION (consider only if Pattern B latency is operator-painful) |
| **A5: External worker (Inngest / Trigger.dev / Render bg)** | Out-of-stack vendor | Most reliable; mature retry semantics; battle-tested | Net-new vendor dependency. Cost. Operator manages a 4th platform. **Out of scope** per orchestrator dispatch | ❌ REJECTED |
| **A6: Deno EdgeRuntime.waitUntil()** | Function returns response immediately; continues background work until ~10 min cap | Simplest single-shot | Doesn't survive 10-min cap; full London (~5h) impossible | ❌ REJECTED |

### Recommended primary: Pattern B

**Concrete architecture:**

```
┌─────────────────┐
│ Admin UI        │
│ (status viewer) │ ← polls run_status OR Realtime subscription
└────────┬────────┘
         │ kicks off
         │ POST run-place-intelligence-trial?action=start_run
         ▼
┌────────────────────────────────────────────┐
│ start_run action                            │
│ - validates inputs                          │
│ - INSERT INTO place_intelligence_runs       │
│   (parent row, status='running')            │
│ - INSERT pending rows into                  │
│   place_intelligence_trial_runs (per-place) │
│ - pg_net.http_post(worker_url, {run_id})    │
│   to kick first chunk immediately           │
│ - returns runId + summary                   │
└────────────────────────────────────────────┘

[Then: pg_cron + worker autonomously drives the run to completion]

Every 1 min:
┌────────────────────────────────────────────┐
│ pg_cron job: kick_pending_trials            │
│ SELECT id FROM place_intelligence_runs      │
│ WHERE status='running'                      │
│ AND pending_count > 0                       │
│ AND (last_heartbeat_at IS NULL              │
│      OR last_heartbeat_at < now()-90sec)    │
│ FOR EACH: pg_net.http_post(worker_url,      │
│                            {run_id})        │
└──────────┬─────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────┐
│ Worker edge fn (action='process_chunk')    │
│ 1. UPDATE last_heartbeat_at = now()         │
│ 2. Check status: if 'cancelling' → mark     │
│    'cancelled' + return                     │
│ 3. SELECT next N pending rows               │
│ 4. Promise.all (parallel-12) processes       │
│    each row: fetch_reviews + compose_collage│
│    + run_trial_for_place                    │
│ 5. UPDATE processed_count + cost_so_far     │
│ 6. If all done → UPDATE status='complete'   │
│ 7. Return; pg_cron picks up next tick       │
└────────────────────────────────────────────┘
```

**Latency math:**
- Chunk size: 12 places (parallel via Promise.all)
- Per-chunk wallclock: ~30s (one place latency, parallelized)
- Cron ticks every 1 min → effectively 1 chunk per minute
- London 3495 rows / 12 per chunk = 291 chunks = 291 minutes = **~4.85 hours**
- Cary 761 rows / 12 = ~64 minutes = **~1 hour**
- Cost guard: $5 default still holds; full London ~$14, full London > guard so requires explicit override

**Single-instance enforcement:**
- Each chunk-run UPDATEs `place_intelligence_runs` SET `last_heartbeat_at = now()`
- pg_cron only re-fires for runs where `last_heartbeat_at < now() - 90sec` (stale heartbeat = previous worker died)
- Belt+suspenders: worker uses `SELECT ... FROM place_intelligence_runs WHERE id = :runId FOR UPDATE NOWAIT` to fail fast on lock contention; if NOWAIT fails, exit (another worker is processing this run already)

**Cancel semantics:**
- Operator clicks Cancel → admin UI calls `cancel_trial` action → UPDATE `place_intelligence_runs` SET `status='cancelling'` WHERE `id = :runId`
- Worker checks `status` at start of each chunk → if `cancelling` → UPDATE `status='cancelled'` + return immediately
- pg_cron stops kicking the run (because `WHERE status='running'` filter)
- Place rows in `pending` stay `pending` permanently; UI displays "X processed of Y" with `Cancelled` badge; nothing wasted

---

## 6. Schema Additions Required

**New parent table:** `place_intelligence_runs`

```sql
CREATE TABLE public.place_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),                -- the run_id
  city_id uuid NOT NULL REFERENCES public.seeding_cities(id),
  city_name text NOT NULL,                                       -- denormalized for display
  mode text NOT NULL CHECK (mode IN ('sample','full_city')),     -- new!
  sample_size integer,                                           -- null for mode='full_city'
  total_count integer NOT NULL,                                  -- pending rows pre-inserted
  processed_count integer NOT NULL DEFAULT 0,                    -- bumped per place
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','cancelling','cancelled','complete','failed')),
  cost_so_far_usd numeric NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL,
  estimated_minutes integer NOT NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  started_by uuid REFERENCES public.admin_users(id),             -- audit trail
  cancelled_by uuid REFERENCES public.admin_users(id),
  error_reason text,
  last_heartbeat_at timestamptz,                                 -- pg_cron watchdog
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- One-job-per-(city, mode) when running, per operator clarification
CREATE UNIQUE INDEX uniq_one_running_run_per_city
  ON public.place_intelligence_runs (city_id)
  WHERE status IN ('pending','running','cancelling');

-- Index for pg_cron pickup
CREATE INDEX idx_runs_active_for_cron
  ON public.place_intelligence_runs (status, last_heartbeat_at)
  WHERE status = 'running';

-- RLS: only admin_users
ALTER TABLE public.place_intelligence_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_full_access ON public.place_intelligence_runs
  USING (auth.uid() IN (SELECT id FROM admin_users WHERE status='active'))
  WITH CHECK (auth.uid() IN (SELECT id FROM admin_users WHERE status='active'));
```

**Add FK on existing per-place table:**

```sql
ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.place_intelligence_runs(id);

-- Backfill existing rows: parent_run_id = run_id (because run_id was already a UUID
-- but never had a parent row). For pre-ORCH-0737 rows, leave NULL — historical audit.
-- Do NOT auto-create parent rows for orphaned rows; let those die naturally.
```

**pg_cron job:**

```sql
-- Kicks worker for any run that's running with stale heartbeat or no heartbeat yet
SELECT cron.schedule(
  'kick_pending_trial_runs',
  '* * * * *',                                                   -- every 1 min
  $$
  SELECT public.tg_kick_pending_trial_runs();
  $$
);
```

**Trigger function (pg_net wrapper):**

```sql
CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  worker_url text;
  service_key text;
BEGIN
  worker_url := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial';
  -- service_key fetched from vault.decrypted_secrets to avoid hard-coding
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key' LIMIT 1;

  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status = 'running'
      AND processed_count < total_count
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
    LIMIT 5                                                       -- max 5 concurrent runs
  LOOP
    PERFORM net.http_post(
      url := worker_url,
      body := jsonb_build_object('action', 'process_chunk', 'run_id', r.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      )
    );
  END LOOP;
END;
$$;
```

---

## 7. UI Architecture Sketch

**Toggle UX:** segmented control with two options at top of the trial form. Default is `Sample`; clicking `Whole city` flips the form (hides `sample_size` input + shows full-city cost+time math).

```
┌──────────────────────────────────────────────────┐
│ ◉ Sample (default, ~75 min, ~$0.84 for 200 places)│
│ ◯ Whole city (durable; can take hours)            │
└──────────────────────────────────────────────────┘
```

**Cost-confirmation dialog (Whole city mode):** native `window.confirm` is acceptable for velocity (per existing pattern for sample-mode). Copy:

> About to run a FULL-CITY trial for {city.name} ({total_servable} servable places) using Gemini 2.5 Flash.
>
> Estimated cost: ~${estimated_cost_usd} USD
> Estimated wall time: ~{estimated_minutes} min ({estimated_minutes/60} hrs)
>
> The run will execute on Mingla's servers. You can close this tab and come back hours later — the run keeps going until you click Cancel. To stop it, return to this page and click Cancel.
>
> Continue?

If `estimated_cost_usd > $5` (existing COST_GUARD_USD), require **double-confirm**: a second `window.confirm` after the first repeats the cost in red and asks "I understand this will charge ~$X. Confirm again?"

**In-progress UI states (run-level):**

| Status | Render |
|--------|--------|
| `pending` (just kicked, no heartbeat yet) | "Run starting…" + spinner + Cancel button |
| `running` | Progress bar (processed_count / total_count) + cost-so-far + estimated-time-remaining + Cancel button |
| `cancelling` | "Cancelling… will stop after current chunk" (~30-90s) + spinner |
| `cancelled` | "Cancelled at X/Y" + Final cost-so-far + "Resume" disabled (cancelled is terminal) |
| `complete` | "Complete — Y/Y processed" + total cost + summary stats + per-place cards expand below |
| `failed` | "Failed — error: {error_reason}" + processed-count snapshot + Retry / Resume buttons |

**Cross-session resume on page load:**
- On `useEffect`, query `place_intelligence_runs WHERE status IN ('pending','running','cancelling')` for any active runs
- If found, immediately render the in-progress UI for that run (highest-priority surface)
- Status updates via 5-second polling (Supabase Realtime is preferable but adds dependency; polling is simpler)

**Cancel button:**
- Single click → `window.confirm("Cancel this run? Partial results will be preserved.")` → calls `cancel_trial` action → UI flips to `cancelling`
- No second-confirm needed (cancel is reversible-by-restart, just preserves cost-so-far)

**Concurrent runs:**
- Within UI, if a run is already active for the selected city → city dropdown shows "Cary (running 47/761) — already running, cannot start another" + disabled Run button
- Cross-city is allowed: operator can run Cary AND start Lagos in parallel (different city_id)
- Enforcement: DB unique partial index on `(city_id) WHERE status IN ('pending','running','cancelling')`

---

## 8. Concurrency + Race Conditions

### Race A — Cancel between cron pickup and worker checking status

| Time | Event |
|------|-------|
| t=0 | pg_cron tick fires → `tg_kick_pending_trial_runs()` → `pg_net.http_post` to worker (async) |
| t=0.5s | Operator clicks Cancel → admin UI calls `cancel_trial` → UPDATE `status='cancelling'` |
| t=1s | Worker function starts → first thing: `SELECT status FROM place_intelligence_runs WHERE id=:runId FOR UPDATE` |
| t=1.1s | Worker sees `status='cancelling'` → UPDATE `status='cancelled'` + return immediately. NO chunk processed. |

**Resolution:** worker's first action is `FOR UPDATE` lock + status check. Cancel signal seen, no work done. Belt+suspenders: every worker call respects status at chunk-start.

### Race B — Two cron ticks fire 1 min apart while previous chunk still running

| Time | Event |
|------|-------|
| t=0 | Cron tick 1 → kick worker for run X |
| t=30s | Worker starts; chunk takes 35s wallclock |
| t=60s | Cron tick 2 → check `last_heartbeat_at`. Worker updated heartbeat at t=30s. Now is t=60s. Heartbeat is 30s old < 90s threshold → SKIP. No double-kick. |
| t=65s | Worker finishes; updates heartbeat to t=65s; exits |
| t=120s | Cron tick 3 → heartbeat is 55s old < 90s → SKIP |
| t=180s | Cron tick 4 → heartbeat is 115s old > 90s → kick |

**Resolution:** 90-second stale-heartbeat threshold prevents double-kicks while allowing recovery if worker dies.

### Race C — Service role write contention on the same row

Each worker chunk processes 12 rows in parallel via Promise.all. Each row's write is a single UPDATE on `place_intelligence_trial_runs WHERE run_id=X AND place_pool_id=Y`. UNIQUE constraint already exists. PostgreSQL row-level locking is automatic. **No additional protection needed.**

### Race D — Operator double-clicks Run

Currently sample-mode handles this via `isRunningRef.current` client-side guard. For full-city mode, the **DB unique partial index on `(city_id) WHERE status IN ('pending','running','cancelling')`** provides server-side enforcement. If client somehow bypasses the disabled button, second `start_run` returns 23505 unique violation; admin UI catches and shows "Run already in progress" toast.

---

## 9. Cost Guards + Observability

### Cost guard
- `COST_GUARD_USD = 5.0` already exists in edge fn; Pattern B preserves
- Full-city cost for cities > $5 threshold: London ($14), Washington ($9.65), Brussels ($7.80), Raleigh ($6.47), Baltimore ($5.06)
- For these: admin UI requires **second window.confirm** with red copy after first dialog ("I understand this will cost ~$14. Confirm again?")
- Edge fn `start_run` STILL enforces `COST_GUARD_USD` check; only allows full-city if `mode='full_city'` body field is set + UI has confirmed

### Per-run audit trail
Every run gets a `place_intelligence_runs` parent row with:
- `started_by` (admin user UUID) — who kicked off
- `created_at` / `started_at` / `completed_at`
- `total_count` / `processed_count` / `succeeded_count` / `failed_count`
- `cost_so_far_usd` (incremented per chunk; final = total)
- `estimated_cost_usd` / `estimated_minutes` — recorded at start for variance analysis

### Run-history table in admin
Currently `TrialResultsTab.jsx` GROUP BY's `place_intelligence_trial_runs.run_id` to derive run-level. Post-fix: query `place_intelligence_runs` directly. Run history sortable by `created_at DESC`; displays mode (Sample / Whole city), status, processed/total, cost.

### Failure observability
- Each per-place row preserves `error_message` (exists today)
- Run-level `error_reason` populated when run-level fails (e.g., Gemini API quota breach, vault decryption failure, network outage)
- Retry button (UI only): re-runs failed rows in same run by setting their status back to `pending` + re-kicking pg_cron

---

## 10. Invariants This Change Must Preserve

| Invariant | Preservation strategy |
|-----------|----------------------|
| **I-TRIAL-CITY-RUNS-CANONICAL** (DEC-110) | Parent table `place_intelligence_runs.city_id NOT NULL`. Every run still scopes to single city. |
| **I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING** | No async-bypass that lets trial data leak into production rerank. Worker edge fn only writes to `place_intelligence_trial_runs` + `place_intelligence_runs`. |
| **I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS** (DEC-107) | Worker still queries `is_servable=true` filter when pulling pending rows (inherited from `start_run`'s sample selection — already verified). |
| **I-TRIAL-RUN-SCOPED-TO-CITY** | Schema NOT NULL on city_id remains. Both parent and child tables enforce. |
| **I-PHOTO-AESTHETIC-DATA-SOLE-OWNER** | Worker does not touch photo_aesthetic_data. Only fetch_reviews + compose_collage + run_trial_for_place per-place actions are reused. |
| **I-COLLAGE-SOLE-OWNER** | Worker delegates to existing `compose_collage` action which is the sole writer. |
| **I-BOUNCER-DETERMINISTIC** | Worker doesn't touch bouncer; trial output validity gated on bouncer holding. |

**No invariant violations.** No new invariants introduced (pattern is feature-additive).

---

## 11. Discoveries for Orchestrator (side issues)

### D-1 (NEW, light): 79 orphaned `pending` rows in DB

**Severity:** S3-low (data hygiene; doesn't block ORCH-0737 but worth noting)

**Description:** Live SQL probe confirmed 79 rows in `place_intelligence_trial_runs` with `status='pending'` and `started_at IS NULL`. These are stranded from prior browser-driven runs where the operator closed the tab mid-flight.

**Recommendation:** ORCH-0737 IMPL can include a **one-time data-cleanup migration** that runs once-on-deploy:
```sql
-- Wipe orphaned pending rows from pre-ORCH-0737 era
DELETE FROM public.place_intelligence_trial_runs
WHERE status = 'pending'
  AND started_at IS NULL
  AND created_at < '2026-05-06'::timestamptz;     -- before ORCH-0737 deploy
```
OR alternatively: backfill parent rows with `status='cancelled'` + reason='ORCH-0737 migration cleanup' to preserve historical audit. Implementor's choice.

### D-2 (NEW, S2-medium): `cancel_trial` action exists but admin UI ignores it

Even before ORCH-0737, the existing client-side cancel doesn't write `status='cancelled'` to DB. After tab close, prior `pending`/`running` rows stay in their state forever. ORCH-0737's design fixes this by making admin UI call `cancel_trial` action correctly.

### D-3 (NEW, S3-low): UI copy "Don't refresh the page during the run"

`TrialResultsTab.jsx:339` includes copy: "Don't refresh the page during the run." Post-ORCH-0737 full-city mode, this is no longer true. Sample-mode keeps the warning; full-city mode replaces with "You can close this tab. The run will continue."

### D-4 (NEW, S3-low): `model` column default is still `claude-haiku-4-5`

`place_intelligence_trial_runs.model DEFAULT 'claude-haiku-4-5'::text` per current schema. Per DEC-102 Anthropic was dropped 2026-05-05; current default is misleading. Not blocking (every row written by `start_run` overrides with `gemini-2.5-flash`), but cleanup-eligible. Bundle into ORCH-0737 migration or defer.

---

## 12. Confidence

**HIGH.** Reasoning:

| Layer | Verification |
|-------|--------------|
| Docs | Read full prompt + INVARIANT_REGISTRY + DECISION_LOG + memory files |
| Schema | Live SQL probed `place_intelligence_trial_runs` columns + verified pg_cron + pg_net extensions |
| Code | Full read of edge fn (1,306 lines) + admin UI driver (647 lines) |
| Runtime | Live SQL probed status distribution + run history + extension versions |
| Data | Empirical 79 orphaned pending rows confirms operator-pain pattern |

No layer left unverified. No sub-agent findings cited as fact. Migration chain checked (only 2 ORCH-0734 migrations + 1 baseline; no superseded function definitions). Dispatch prompt's question matrix all answered.

---

## 13. Fix Strategy (direction only — formalized in SPEC)

1. **DB layer:** new parent table `place_intelligence_runs` + FK from existing per-place table + pg_cron job + trigger function via pg_net + unique partial index for one-job-per-city
2. **Edge fn layer:** new action `process_chunk` (worker) + new action `start_run_v2` (with mode='sample'|'full_city'); existing `cancel_trial` action upgraded to update parent table; existing `start_run` deprecated but preserved for 1-cycle deprecation window
3. **Admin UI layer:** mode toggle + cost-confirm dialog (with double-confirm for $5+ cost) + run-level status panel + cancel button wired to `cancel_trial` action + cross-session resume hydration on mount
4. **One-time data cleanup:** wipe or backfill 79 orphaned pending rows
5. **Tests:** T-cases covering happy path full-city / cancel mid-run / tab close + reload / failure recovery / concurrent same-city block / concurrent cross-city allow / cost-confirm-then-back-out / heartbeat-timeout-recovery / cron-double-tick-no-double-process

The SPEC in `Mingla_Artifacts/specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md` formalizes this direction with exact SQL, exact JSX, T-cases, SCs, and implementation order.
