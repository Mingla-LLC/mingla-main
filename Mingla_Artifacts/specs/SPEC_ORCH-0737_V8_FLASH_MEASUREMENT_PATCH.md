# SPEC — ORCH-0737 v8 — Flash Measurement Patch

**Status:** SPEC complete. **SPEC READY FOR IMPLEMENTOR: YES.**

**Mode:** `$forensic-mingla` SPEC only, per `Mingla_Artifacts/prompts/SPEC_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`.

**Primary evidence:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_V8_FLASH_THROUGHPUT_DEEP_DIVE.md`.

**Author:** forensic-mingla, 2026-05-07.

---

## 1. Executive Summary

Mingla's Gemini Flash trial worker is functional, but current telemetry cannot prove where runtime is spent. The next implementation must add a narrow measurement layer, not a throughput change.

This spec requires:

1. Add one JSONB diagnostics column to `place_intelligence_trial_runs`.
2. Capture per-row score timing for DB read, collage fetch/base64 bytes, Gemini HTTP attempts/statuses/backoff, malformed function-call retry, DB write, total row time, and batch identity.
3. Capture per-prep row timing for reviews fetch, compose/cached result, DB write, and total prep row time.
4. Emit stable `[ORCH-0737-V8-TIMING]` logs as backup, while JSONB remains the authoritative analysis source.
5. Preserve current model, prompts, score parallel-6, prep parallel-12, retry behavior, stuck recovery, cancel behavior, and production-ranking isolation.

The patch produces evidence only. It must not make Flash faster yet.

---

## 2. Scope And Non-Scope

**In scope**

- `place_intelligence_trial_runs.timing_diagnostics jsonb`
- edge-function timing helpers/types inside `supabase/functions/run-place-intelligence-trial/index.ts`
- Gemini HTTP retry diagnostics without behavior changes
- score batch and prep batch identifiers
- row-level diagnostics for completed and failed rows
- stable structured logs for row and batch timing
- implementation report queries for a bounded cold-city baseline

**Out of scope**

- changing `GEMINI_MODEL_ID`
- changing scoring prompt text, tool schema, `maxOutputTokens`, or output semantics
- changing `.limit(6)` in score pickup
- changing `.limit(12)` in prep pickup
- adding Gemini File API
- adding cache warming
- adding worker sharding
- changing admin UI, mobile, business app, or production ranking
- changing stuck-row recovery or cancel-cleanup semantics

---

## 3. Evidence Carried Forward

The v8 investigation proved:

- current model is `gemini-2.5-flash` at `supabase/functions/run-place-intelligence-trial/index.ts:50-53`;
- score path sends `inline_data` base64 image bytes at `index.ts:1135-1144`;
- Gemini HTTP retry exists at `index.ts:160-199`, but HTTP status/retry/backoff data is not persisted;
- malformed function-call retry exists at `index.ts:1179-1219`, but `retry_count` only stores malformed retry, not HTTP retry;
- score pickup is `.limit(6)` at `index.ts:1742-1748`;
- prep pickup is `.limit(12)` at `index.ts:1827-1833`;
- `Promise.all` waits for all score rows at `index.ts:1765-1791`;
- worker budget is checked before each iteration at `index.ts:1573`, not during a long `Promise.all`;
- `pg_net` captures self-invoke 5s timeouts, not Gemini status;
- no post-v6.1 live-fire run existed at investigation time;
- London cache was effectively cold: 6/3,495 cached collages;
- Cary was fully cached and therefore is not a useful cold baseline.

This spec is based on those proven facts. It does not assume the bottleneck is Gemini, base64, Supabase, quota, or cache.

---

## 4. File/Line Implementation Map

### Database

- Baseline table: `place_intelligence_trial_runs` defined in `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:8940-8968`.
- RLS enabled at `20260505000000_baseline_squash_orch_0729.sql:15822`.
- Service-role all policy at `20260505000000_baseline_squash_orch_0729.sql:15959`.
- City-run relaxations:
  - anchor index relaxed at `20260505000001_orch_0734_city_runs.sql:53-74`;
  - `city_id` and `retry_count` added at `20260505000001_orch_0734_city_runs.sql:81-97`;
  - `signal_id` nullable at `20260505000002_orch_0734_signal_id_nullable.sql:17-18`.
- Parent table/RPCs:
  - `place_intelligence_runs` table at `20260506000001_orch_0737_async_trial_runs.sql:23-55`;
  - `parent_run_id` FK at `20260506000001_orch_0737_async_trial_runs.sql:100-104`;
  - `lock_run_for_chunk` at `20260506000001_orch_0737_async_trial_runs.sql:108-123`;
  - `increment_run_counters` at `20260506000001_orch_0737_async_trial_runs.sql:127-148`.
- Cron/stuck re-kick:
  - original `tg_kick_pending_trial_runs` at `20260506000001_orch_0737_async_trial_runs.sql:171-221`;
  - latest v3 `status IN ('running','cancelling')` replacement at `20260506000002_orch_0737_v3_cron_filter_cancelling.sql:27-78`.
- Prep schema:
  - `prep_status` and pickup index at `20260507000002_orch_0737_v4_prep_status.sql:26-42`.

### Edge Function

- Gemini config: `run-place-intelligence-trial/index.ts:50-53`.
- HTTP retry target: `callGeminiWithRetry`, `index.ts:160-199`.
- Base64 target: `fetchAsBase64`, `index.ts:202-215`.
- Start-run child insertion: `index.ts:799-815`.
- Score row lifecycle: `processOnePlace`, `index.ts:928-1041`.
- Gemini request + malformed retry: `callGeminiQuestion`, `index.ts:1126-1220`.
- Worker budget loop: `handleProcessChunk`, `index.ts:1510-1728`.
- Score pickup/batch: `runScoreIteration`, `index.ts:1734-1805`.
- Prep pickup/batch: `runPrepIteration`, `index.ts:1819-1915`.
- Compose cache/cold behavior: `handleComposeCollage`, `index.ts:544-640`.
- URL-transform invariant:
  - `transformPhotoUrlForTile`, `_shared/imageCollage.ts:67-100`;
  - serial compose loop, `_shared/imageCollage.ts:157-185`.

---

## 5. Schema/Logging Decision

**Decision: Option C — JSONB authoritative + stable logs backup.**

Add one column:

```sql
-- supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
BEGIN;

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.place_intelligence_trial_runs.timing_diagnostics IS
  'ORCH-0737 v8: temporary/permanent-safe diagnostic JSON for Flash throughput measurement. Stores per-row score/prep timing, Gemini HTTP retry/status/backoff, collage byte counts, batch identity, and worker elapsed fields. Research/trial-only; production ranking MUST NOT read this column.';

COMMIT;

-- Rollback:
--   ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS timing_diagnostics;
```

No index is required for v8. The baseline analysis filters by `parent_run_id`/`run_id`, already indexed by existing run columns, then reads JSONB from the selected rows. Do not add a GIN index unless a later investigation proves repeated cross-run diagnostics queries need it.

**RLS impact:** no new policy. The worker uses service-role writes, and `service_role_all_pit_runs` already allows full access. Admin read behavior follows existing trial-run access. Production app paths must not read this table or this column.

**Stable log marker:** every row finalization and every batch finalization must also emit a single-line JSON log:

```text
[ORCH-0737-V8-TIMING] {"event":"row_complete", ...}
[ORCH-0737-V8-TIMING] {"event":"row_failed", ...}
[ORCH-0737-V8-TIMING] {"event":"batch_complete", ...}
```

Logs are backup only. SQL over `timing_diagnostics` is the source of truth.

---

## 6. Exact Diagnostic Field Contract

All durations are milliseconds. Use `performance.now()` for duration deltas and `Date.now() - workerStartedAtMs` for worker elapsed fields. Numbers should be rounded to integer milliseconds before storage.

### Row-Level Shape

Store this object in `place_intelligence_trial_runs.timing_diagnostics`:

```json
{
  "version": "orch-0737-v8",
  "run_id": "uuid",
  "parent_run_id": "uuid",
  "place_pool_id": "uuid",
  "phase": "score",
  "status": "completed",
  "batch_id": "runId-score-1-1710000000000",
  "batch_kind": "score",
  "batch_iteration": 1,
  "batch_parallel_n": 6,
  "batch_row_count": 6,
  "batch_started_at": "iso timestamp",
  "worker_elapsed_ms_at_batch_start": 1234,
  "worker_elapsed_ms_at_batch_end": 26500,
  "row_started_at": "iso timestamp",
  "row_completed_at": "iso timestamp",
  "row_total_ms": 24400,
  "db_read_ms": 55,
  "collage_fetch_base64_ms": 410,
  "collage_raw_bytes": 1431624,
  "collage_base64_bytes": 1908832,
  "gemini_total_ms": 23200,
  "gemini_attempt_count": 1,
  "gemini_http_statuses": [200],
  "gemini_retry_after_ms_total": 0,
  "gemini_backoff_ms_total": 0,
  "gemini_error_kinds": [],
  "gemini_final_outcome": "ok",
  "malformed_function_retry_count": 0,
  "db_write_ms": 40,
  "error_kind": null,
  "error_message": null
}
```

For prep rows, use the same envelope and replace score-only fields with prep fields:

```json
{
  "version": "orch-0737-v8",
  "phase": "prep",
  "status": "pending",
  "batch_id": "runId-prep-2-1710000000000",
  "batch_kind": "prep",
  "batch_iteration": 2,
  "batch_parallel_n": 12,
  "batch_row_count": 12,
  "row_total_ms": 3600,
  "reviews_fetch_ms": 650,
  "compose_collage_ms": 2800,
  "compose_cached": false,
  "compose_photo_count": 16,
  "compose_placed_count": 15,
  "compose_failed_count": 1,
  "db_write_ms": 30,
  "worker_elapsed_ms_at_batch_start": 27000,
  "worker_elapsed_ms_at_batch_end": 30600
}
```

### Practical Substitutions

- `collage_base64_bytes` may be computed as `base64.length`, not byte-encoded UTF-8 length.
- `db_read_ms` may aggregate place + reviews reads inside `processOnePlace`.
- `db_write_ms` may measure only the final row update, not every tiny intermediate update.
- If a row fails before a field is known, store `null` for the field and still store `row_total_ms`, `error_kind`, and `error_message`.
- If `callGeminiWithRetry` throws before a `Response` exists, record `gemini_http_statuses: []` and `gemini_error_kinds: ["network_or_fetch_error"]`.

---

## 7. Implementation Steps

### Step 1 — Add Migration

Create `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` exactly as described in §5.

No backfill required. Historical rows default to `{}`.

### Step 2 — Add Small Timing Helpers In Edge Function

In `supabase/functions/run-place-intelligence-trial/index.ts`, near helper types after `GeminiUsage`, add local types/helpers. Keep them file-local.

Required helper behavior:

- `elapsedMs(start: number): number` returns integer duration from `performance.now()`.
- `classifyError(err: unknown): string` returns a short stable kind, e.g. `gemini_http`, `collage_fetch`, `db_read`, `db_write`, `malformed_function_call`, `unknown`.
- `emitTiming(event: string, data: Record<string, unknown>): void` logs exactly one line prefixed `[ORCH-0737-V8-TIMING] ` plus JSON.
- `safeMergeDiagnostics(base, patch)` should avoid overwriting known base identity fields with undefined.

Do not introduce a new dependency.

### Step 3 — Instrument `fetchAsBase64`

Change `fetchAsBase64` return shape from:

```ts
Promise<{ base64: string; mimeType: string }>
```

to:

```ts
Promise<{ base64: string; mimeType: string; rawBytes: number; base64Bytes: number; elapsedMs: number }>
```

Implementation contract:

- start timer before `fetch(url)`;
- keep existing error behavior for non-OK response;
- set `rawBytes = buf.length`;
- set `base64Bytes = base64.length`;
- set `elapsedMs` after `btoa`;
- do not change chunk size or encoding logic.

### Step 4 — Instrument `callGeminiWithRetry`

Extend return shape to:

```ts
Promise<{ payload: any; usage: GeminiUsage; diagnostics: GeminiHttpDiagnostics }>
```

`GeminiHttpDiagnostics` must include:

- `gemini_total_ms`
- `gemini_attempt_count`
- `gemini_http_statuses`
- `gemini_retry_after_ms_total`
- `gemini_backoff_ms_total`
- `gemini_error_kinds`
- `gemini_final_outcome`

Behavior must remain identical:

- `MAX_ATTEMPTS` unchanged.
- retryable status logic unchanged.
- retry-after cap unchanged.
- backoff formula unchanged.
- thrown error text unchanged unless appending diagnostics is unavoidable; prefer no change.

Implementation detail:

- push `res.status` for every HTTP response, including `200`;
- add retry-after milliseconds to `gemini_retry_after_ms_total`;
- add actual sleep milliseconds to `gemini_backoff_ms_total`;
- on non-retryable or exhausted retry, attach the diagnostics object to the thrown `Error` via a property such as `(err as any).geminiDiagnostics = diagnostics` before throwing;
- on network/fetch exception, capture `network_or_fetch_error` and rethrow with attached diagnostics.

### Step 5 — Instrument `callGeminiQuestion`

Extend return shape to:

```ts
Promise<{
  aggregate: any;
  totalCostUsd: number;
  retried: boolean;
  diagnostics: {
    collage_fetch_base64_ms: number;
    collage_raw_bytes: number;
    collage_base64_bytes: number;
    gemini_total_ms: number;
    gemini_attempt_count: number;
    gemini_http_statuses: number[];
    gemini_retry_after_ms_total: number;
    gemini_backoff_ms_total: number;
    gemini_error_kinds: string[];
    gemini_final_outcome: string;
    malformed_function_retry_count: number;
  };
}>
```

Behavior contract:

- call `fetchAsBase64` once before building request body, as today;
- carry base64 diagnostics into the return value;
- accumulate Gemini HTTP diagnostics across malformed-function retries;
- `malformed_function_retry_count` must be `attempt - 1`;
- if malformed retry exhausts, attach partial diagnostics to the thrown error;
- do not alter prompt, tool schema, generation config, or retry count.

### Step 6 — Instrument `processOnePlace`

Extend args:

```ts
batchContext: {
  batch_id: string;
  batch_kind: "score";
  batch_iteration: number;
  batch_parallel_n: number;
  batch_row_count: number;
  batch_started_at: string;
  worker_elapsed_ms_at_batch_start: number;
}
```

Implementation contract:

- start `rowTimer` at function entry;
- measure the `place_pool` + reviews reads as `db_read_ms`;
- call `callGeminiQuestion` and capture diagnostics;
- measure final completed-row update as `db_write_ms`;
- update `timing_diagnostics` on successful completion in the same final row update that writes `q2_response`;
- return `{ cost, diagnostics }`, not just `number`, so `runScoreIteration` can log and compute batch tail;
- in failure paths owned by `runScoreIteration`, diagnostics must still be persisted by the catch block using partial data when available.

Important: `processOnePlace` currently marks running at `index.ts:937-942` even though `runScoreIteration` also marks pickup rows running at `index.ts:1761-1763`. The implementor may leave this duplicate mark as-is; do not refactor lifecycle semantics in this patch.

### Step 7 — Instrument `runScoreIteration`

Implementation contract:

- create `batchStartedAtPerf = performance.now()` and `batchStartedAtIso = new Date().toISOString()` immediately after pickup rows are known;
- generate `batch_id = `${runId}-score-${Date.now()}-${crypto.randomUUID().slice(0, 8)}``;
- build `batchContext` with `batch_parallel_n: 6` and `batch_row_count: pickupRows.length`;
- pass `batchContext` into `processOnePlace`;
- wrap each row with its own try/catch as today;
- on catch, update failed row with `timing_diagnostics` containing identity fields, row total if known, `status: "failed"`, `error_kind`, `error_message`, batch fields, and any attached Gemini diagnostics;
- after `Promise.all`, compute:
  - `batch_total_ms`;
  - slowest row by `row_total_ms`;
  - succeeded/failed counts;
  - max Gemini duration;
  - max base64 duration;
  - total retry/backoff milliseconds;
- emit one `[ORCH-0737-V8-TIMING]` `batch_complete` log with that summary;
- do not persist batch summary to parent table in v8.

Do not change `increment_run_counters`.

### Step 8 — Instrument `runPrepIteration`

Implementation contract:

- create `batch_id` and `batchContext` like score, with `batch_kind: "prep"` and `batch_parallel_n: 12`;
- for each prep row, measure:
  - `reviews_fetch_ms` around `handleFetchReviews`;
  - `compose_collage_ms` around `handleComposeCollage`;
  - `compose_cached`, `compose_photo_count`, `compose_placed_count`, `compose_failed_count` from `collageBody`;
  - `db_write_ms` around the update that sets `prep_status: "ready"`;
  - `row_total_ms`;
- on prep success, update `timing_diagnostics` with `phase: "prep"` while setting `prep_status: "ready"`;
- on prep failure, update failed row with prep diagnostics and error fields;
- emit row timing logs and a `batch_complete` summary.

Do not change prep concurrency or the serial photo loop.

### Step 9 — Add Baseline Analysis Queries To Implementation Report

The implementor report must include paste-ready SQL/log commands from §10, adjusted only for exact column names if implementation names differ. This is mandatory because the next orchestrator/tester review depends on those queries.

---

## 8. Acceptance Criteria

- **SC-1:** `GEMINI_MODEL_ID`, prompt version, Q2 tool schema, generation config, and scoring semantics are unchanged.
- **SC-2:** score pickup remains `.limit(6)` and prep pickup remains `.limit(12)`.
- **SC-3:** no mobile, business, production ranking, `place_scores`, bouncer, or card-generation path reads `timing_diagnostics`.
- **SC-4:** `place_intelligence_trial_runs.timing_diagnostics` exists as JSONB with default `{}` and a comment naming ORCH-0737 v8 and ranking isolation.
- **SC-5:** completed score rows contain `phase=score`, batch identity, row total, DB read/write timing, collage byte/timing data, Gemini timing/status/retry/backoff data, malformed retry count, and final status.
- **SC-6:** failed score rows contain batch identity, row total if measurable, error kind/message, and any partial Gemini/base64 diagnostics available before failure.
- **SC-7:** prep success rows contain `phase=prep`, batch identity, reviews timing, compose timing, cache boolean, photo counts when available, DB write timing, and row total.
- **SC-8:** prep failed rows contain prep diagnostics plus error kind/message.
- **SC-9:** HTTP retry/backoff capture preserves existing retry policy exactly.
- **SC-10:** malformed function-call retry behavior and `retry_count` semantics are unchanged.
- **SC-11:** stuck-row recovery and cancel cleanup branches remain present and behaviorally unchanged.
- **SC-12:** every row finalization and batch finalization emits one stable `[ORCH-0737-V8-TIMING]` JSON log line.
- **SC-13:** implementation report includes static checks, deploy command, rollback command, and paste-ready baseline SQL/log queries.
- **SC-14:** no live Raleigh/Durham/London run is started by the implementor without explicit operator authorization after implementation.

---

## 9. Verification Plan

### Static Verification

Run these before deploy:

```bash
rg -n "timing_diagnostics|ORCH-0737-V8-TIMING|GeminiHttpDiagnostics|batch_id|collage_raw_bytes|gemini_http_statuses" supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations
rg -n "\.limit\\(6\\)|\.limit\\(12\\)|GEMINI_MODEL_ID|gemini-2.5-flash|maxOutputTokens|temperature" supabase/functions/run-place-intelligence-trial/index.ts
rg -n "timing_diagnostics" app-mobile mingla-business mingla-admin supabase/functions supabase/migrations docs Mingla_Artifacts | head -80
```

Expected:

- timing symbols appear only in the new migration, the trial edge function, and artifacts;
- `.limit(6)` and `.limit(12)` still appear in score/prep pickup;
- model/prompt generation config unchanged;
- no mobile/business production code reads diagnostics.

### Deno / Edge Checks

Run existing deterministic collage tests:

```bash
deno test supabase/functions/_shared/imageCollage.test.ts
```

If Deno is unavailable locally, the implementation report must say so and list the command as operator-runnable.

Optional but recommended: add a pure unit test only if the timing helpers are factored into exported helpers. If they remain file-local in `index.ts`, do not contort the edge function to export internals just for this patch.

### Migration Verification

After migration on the target project:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'place_intelligence_trial_runs'
  and column_name = 'timing_diagnostics';
```

Expected: one row, `jsonb`, default `'{}'::jsonb`, not nullable.

### Deploy Command

```bash
/Users/sethogieva/bin/supabase db push --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

If PATH already resolves `supabase`, bare `supabase` is acceptable.

### No Live Baseline Without Operator Lock

Implementation verification may inspect schema/logs and run local tests. It must not start a city baseline run. The operator/orchestrator authorizes that after implementation review.

---

## 10. Post-Implementation Baseline-Run Plan

Preferred first measurement run after implementation review:

- **City:** Raleigh 100 or Durham 100.
- **Why:** both are cold enough to measure prep/cache behavior; smaller and cheaper than London; Cary is disqualified because it is 100% cached.
- **Mode:** sample 100 unless orchestrator explicitly locks full-city.
- **Pre-run check:** re-run cache-state query immediately before launch.

### Pre-Run Cache Query

```sql
select
  sc.name as city_name,
  count(*) filter (where pp.is_servable = true) as servable_rows,
  count(*) filter (
    where pp.is_servable = true
      and pp.photo_collage_url is not null
      and pp.photo_collage_fingerprint is not null
  ) as cached_collages,
  round(
    100.0 * count(*) filter (
      where pp.is_servable = true
        and pp.photo_collage_url is not null
        and pp.photo_collage_fingerprint is not null
    ) / nullif(count(*) filter (where pp.is_servable = true), 0),
    2
  ) as cached_pct
from public.seeding_cities sc
join public.place_pool pp on pp.city_id = sc.id
where sc.name in ('Raleigh', 'Durham', 'Cary', 'London')
group by sc.name
order by sc.name;
```

If the servable boolean column name differs in the live schema, use the existing ORCH-0737 servable predicate from the admin trial query instead of inventing a new predicate.

### Run Analysis Queries

Replace `:run_id` with the measured parent run id.

Rows/min by 5-minute window:

```sql
select
  date_trunc('minute', completed_at)
    - make_interval(mins => (extract(minute from completed_at)::int % 5)) as window_5m,
  count(*) as completed_rows,
  round(count(*) / 5.0, 2) as rows_per_min
from public.place_intelligence_trial_runs
where parent_run_id = :run_id
  and status in ('completed', 'failed')
  and completed_at is not null
group by 1
order by 1;
```

Row duration distribution:

```sql
select
  percentile_cont(0.50) within group (order by (timing_diagnostics->>'row_total_ms')::numeric) as row_p50_ms,
  percentile_cont(0.75) within group (order by (timing_diagnostics->>'row_total_ms')::numeric) as row_p75_ms,
  percentile_cont(0.95) within group (order by (timing_diagnostics->>'row_total_ms')::numeric) as row_p95_ms,
  percentile_cont(0.99) within group (order by (timing_diagnostics->>'row_total_ms')::numeric) as row_p99_ms,
  max((timing_diagnostics->>'row_total_ms')::numeric) as row_max_ms
from public.place_intelligence_trial_runs
where parent_run_id = :run_id
  and timing_diagnostics ? 'row_total_ms';
```

Gemini/base64 distribution:

```sql
select
  percentile_cont(0.50) within group (order by (timing_diagnostics->>'gemini_total_ms')::numeric) as gemini_p50_ms,
  percentile_cont(0.95) within group (order by (timing_diagnostics->>'gemini_total_ms')::numeric) as gemini_p95_ms,
  percentile_cont(0.99) within group (order by (timing_diagnostics->>'gemini_total_ms')::numeric) as gemini_p99_ms,
  percentile_cont(0.50) within group (order by (timing_diagnostics->>'collage_fetch_base64_ms')::numeric) as base64_p50_ms,
  percentile_cont(0.95) within group (order by (timing_diagnostics->>'collage_fetch_base64_ms')::numeric) as base64_p95_ms,
  percentile_cont(0.99) within group (order by (timing_diagnostics->>'collage_fetch_base64_ms')::numeric) as base64_p99_ms
from public.place_intelligence_trial_runs
where parent_run_id = :run_id
  and timing_diagnostics->>'phase' = 'score';
```

HTTP retry/status summary:

```sql
select
  count(*) as score_rows,
  count(*) filter (where (timing_diagnostics->>'gemini_attempt_count')::int > 1) as http_retried_rows,
  sum((timing_diagnostics->>'gemini_backoff_ms_total')::numeric) as total_backoff_ms,
  sum((timing_diagnostics->>'gemini_retry_after_ms_total')::numeric) as total_retry_after_ms,
  count(*) filter (where timing_diagnostics->'gemini_http_statuses' @> '429'::jsonb) as rows_with_429,
  count(*) filter (where timing_diagnostics->'gemini_http_statuses' @> '500'::jsonb) as rows_with_500
from public.place_intelligence_trial_runs
where parent_run_id = :run_id
  and timing_diagnostics->>'phase' = 'score';
```

Batch-tail rows:

```sql
with rows as (
  select
    place_pool_id,
    timing_diagnostics->>'batch_id' as batch_id,
    (timing_diagnostics->>'row_total_ms')::numeric as row_total_ms,
    (timing_diagnostics->>'gemini_total_ms')::numeric as gemini_total_ms,
    (timing_diagnostics->>'collage_fetch_base64_ms')::numeric as base64_ms,
    (timing_diagnostics->>'gemini_backoff_ms_total')::numeric as backoff_ms,
    row_number() over (
      partition by timing_diagnostics->>'batch_id'
      order by (timing_diagnostics->>'row_total_ms')::numeric desc
    ) as rn
  from public.place_intelligence_trial_runs
  where parent_run_id = :run_id
    and timing_diagnostics ? 'batch_id'
)
select *
from rows
where rn = 1
order by row_total_ms desc
limit 20;
```

Prep cache/cold split:

```sql
select
  timing_diagnostics->>'compose_cached' as compose_cached,
  count(*) as rows,
  percentile_cont(0.50) within group (order by (timing_diagnostics->>'compose_collage_ms')::numeric) as compose_p50_ms,
  percentile_cont(0.95) within group (order by (timing_diagnostics->>'compose_collage_ms')::numeric) as compose_p95_ms
from public.place_intelligence_trial_runs
where parent_run_id = :run_id
  and timing_diagnostics->>'phase' = 'prep'
group by 1
order by 1;
```

### Baseline Interpretation Gates

The run is interpretable if:

- at least 95/100 rows reach terminal status;
- at least 90 score rows have non-empty `timing_diagnostics`;
- no `WORKER_RESOURCE_LIMIT 546` appears for this function during the run;
- stuck-row reclaim count is zero or explicitly explained by diagnostics;
- row p95, Gemini p95, base64 p95, HTTP 429 rate, retry/backoff total, and batch-tail rows can all be computed from SQL.

Suggested pass thresholds for the current parallel-6 baseline:

- failed rows <= 1%;
- HTTP 429 rows <= 2%;
- stuck rows = 0;
- row p95 <= 35s;
- row p99 <= 75s;
- base64 p95 <= 1.5s;
- no 546/resource-limit errors.

If thresholds fail, the result is still useful: it determines the next speed spec.

---

## 11. Risks And Rollback

### Risks

- JSONB diagnostics add row payload size. Expected impact is low because each object is small compared with Q2 JSON output and trial rows are research-only.
- Instrumentation can accidentally alter retry behavior if implementor mixes measurement with control flow. Acceptance criteria forbid this.
- If a row fails before final update, only logs may carry complete context. The catch path must persist partial diagnostics wherever possible.
- Admin UI may fetch broader row objects. If diagnostics payload becomes visible/large, future UI may need explicit column selection, but v8 should not alter UI.

### Rollback

Code rollback:

```bash
git revert <implementation-commit>
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

Schema rollback if needed:

```sql
ALTER TABLE public.place_intelligence_trial_runs
  DROP COLUMN IF EXISTS timing_diagnostics;
```

The column is intentionally non-critical. Dropping it loses diagnostics only; it must not affect trial outputs or production ranking.

---

## 12. Implementor Handoff Notes

Write an implementation report at:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT.md`

The report must include:

- exact files changed;
- migration name and SQL;
- confirmation that model/prompt/parallelism did not change;
- confirmation that no live baseline was started;
- static check outputs;
- Deno test result or explicit inability to run;
- deploy status if deployment is authorized;
- paste-ready SQL/log commands for baseline analysis;
- any deviation from this spec, clearly labeled.

Do not implement cache warming, File API, model swaps, token buckets, timeout wrappers, or parallel-ramp logic in this patch. Those belong to the next ORCH-0737 throughput spec after measurement.

**SPEC READY FOR IMPLEMENTOR: YES.**

