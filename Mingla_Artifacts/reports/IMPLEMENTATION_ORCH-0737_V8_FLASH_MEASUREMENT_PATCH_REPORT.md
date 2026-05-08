# IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT

**Date:** 2026-05-07  
**Status:** IMPLEMENTED, NOT DEPLOYED, NOT BASELINE-RUN  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`  
**Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`

## 1. Outcome

Implemented the ORCH-0737 v8 measurement patch for the Gemini Flash place-intelligence trial worker.

This patch adds evidence capture only. It does not intentionally make the worker faster yet.

## 2. Changed Files

- `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`
- `supabase/functions/run-place-intelligence-trial/index.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT.md`

Pre-existing unrelated artifact changes were left untouched.

## 3. What Was Implemented

- Added `place_intelligence_trial_runs.timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb`.
- Added stable `[ORCH-0737-V8-TIMING]` JSON log emission for row completion, row failure, and batch completion.
- Added score-row diagnostics:
  - row identity and batch identity
  - `row_total_ms`
  - `db_read_ms`
  - `db_write_ms`
  - collage fetch/base64 timing and byte counts
  - Gemini total time, HTTP statuses, attempt count, retry-after total, backoff total, error kinds, final outcome
  - malformed-function retry count
  - failed-row partial diagnostics where available
- Added prep-row diagnostics:
  - reviews fetch timing
  - compose collage timing
  - compose cache boolean
  - compose photo/placed/failed counts when returned
  - row total and DB write timing
  - failed-row error kind/message
- Added score/prep batch diagnostics:
  - `batch_id`
  - `batch_kind`
  - `batch_iteration`
  - `batch_parallel_n`
  - `batch_row_count`
  - `batch_total_ms`
  - worker elapsed at batch start/end
  - batch summary logs

## 4. Explicit Non-Changes

- Did not change Gemini model.
- Did not change prompt text or Q2 schema.
- Did not change generation config.
- Did not change score parallelism.
- Did not change prep parallelism.
- Did not add Gemini File API.
- Did not add cache warming.
- Did not add worker sharding.
- Did not change mobile, business, admin, production ranking, `place_scores`, bouncer, or card-generation behavior.
- Did not deploy.
- Did not start a live city baseline.

## 5. Model / Prompt / Parallelism Evidence

Command:

```bash
rg -n "\.limit\(6\)|\.limit\(12\)|GEMINI_MODEL_ID|gemini-2.5-flash|maxOutputTokens|temperature" supabase/functions/run-place-intelligence-trial/index.ts
```

Observed:

```text
51:const GEMINI_MODEL_ID = "gemini-2.5-flash";
52:const GEMINI_MODEL_NAME_SHORT = "gemini-2.5-flash";
53:const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;
1241:        model_version: GEMINI_MODEL_ID,
1404:      maxOutputTokens: 8000,
1405:      temperature: 0.3,
2049:    .limit(6);
2217:    .limit(12);
```

Interpretation: model, generation config, score pickup limit, and prep pickup limit stayed unchanged.

## 6. Static Verification

Command:

```bash
rg -n "timing_diagnostics|ORCH-0737-V8-TIMING|GeminiHttpDiagnostics|batch_id|collage_raw_bytes|gemini_http_statuses" supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations
```

Result: exit 0. Expected matches were present in the trial edge function and new migration. Extra `batch_id` matches also appeared in the baseline squash migration because that search term is intentionally broad.

Command:

```bash
rg -n "timing_diagnostics" app-mobile mingla-business mingla-admin supabase/functions supabase/migrations docs Mingla_Artifacts | head -80
```

Result: exit 0. Matches were limited to the new migration, the trial edge function, and ORCH-0737 artifacts/spec text. No app-mobile, mingla-business, or mingla-admin code path reads `timing_diagnostics`.

Command:

```bash
git diff --check -- supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

Result: exit 0, no whitespace errors.

## 7. Automated Test Status

Command:

```bash
deno check supabase/functions/run-place-intelligence-trial/index.ts
```

Result:

```text
zsh:1: command not found: deno
```

Command:

```bash
deno test supabase/functions/_shared/imageCollage.test.ts
```

Result:

```text
zsh:1: command not found: deno
```

Local Deno is unavailable on this machine. These remain required operator/tester-runnable gates before deploy or after installing Deno.

## 8. Acceptance Criteria Status

- **SC-1:** PASS by static scan; model/generation config unchanged. Prompt/Q2 schema were not edited.
- **SC-2:** PASS; score remains `.limit(6)`, prep remains `.limit(12)`.
- **SC-3:** PASS by static scan; no app/admin/business/mobile path reads `timing_diagnostics`.
- **SC-4:** PASS in code; migration adds JSONB default `{}` and ranking-isolation comment. Live schema not verified because deployment was not authorized.
- **SC-5:** PASS in code; completed score rows persist timing/base64/Gemini/retry/batch/DB diagnostics.
- **SC-6:** PASS in code; failed score rows persist partial diagnostics where available.
- **SC-7:** PASS in code; prep success rows persist reviews/compose/cache/photo/DB/batch diagnostics.
- **SC-8:** PASS in code; prep failed rows persist diagnostics plus error kind/message.
- **SC-9:** PASS by code review; retryable statuses and backoff formula were preserved while measured.
- **SC-10:** PASS by code review; malformed-function retry loop and `retry_count` semantics remain one retry max and `retry_count = retried ? 1 : 0`.
- **SC-11:** PASS by code review; stuck-row query/cancel cleanup behavior was not changed.
- **SC-12:** PASS in code; row and batch finalization emit `[ORCH-0737-V8-TIMING]`.
- **SC-13:** PASS in this report, except Deno gates are documented as blocked by missing local Deno.
- **SC-14:** PASS; no live city baseline was started.

## 9. Deployment Status

Not deployed. No live migration push or function deploy was run.

Required deploy order when authorized:

```bash
/Users/sethogieva/bin/supabase db push --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

The migration must be applied before the function deploy because the function now writes `timing_diagnostics`.

## 10. Migration Verification Query

Run after deployment:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'place_intelligence_trial_runs'
  and column_name = 'timing_diagnostics';
```

Expected: one row, `jsonb`, default `'{}'::jsonb`, not nullable.

## 11. Baseline Plan

No baseline was started by this implementation.

Preferred first measurement run after implementation review:

- City: Raleigh 100 or Durham 100.
- Mode: sample 100 unless orchestrator explicitly locks full-city.
- Cary remains disqualified for this measurement because prior evidence showed it was fully cached.

Pre-run cache query:

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

If the servable boolean column name differs in the live schema, use the existing ORCH-0737 servable predicate from the admin trial query.

## 12. Post-Run Analysis Queries

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

Log backup check:

```bash
/Users/sethogieva/bin/supabase functions logs run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv | rg "ORCH-0737-V8-TIMING"
```

## 13. Interpretable Baseline Gates

The first measurement run is interpretable if:

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

## 14. Rollback

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

Dropping the column loses diagnostics only. It should not affect trial outputs or production ranking because no production path reads this column.

## 15. Remaining Gates

- Install or provide Deno, then run:
  - `deno check supabase/functions/run-place-intelligence-trial/index.ts`
  - `deno test supabase/functions/_shared/imageCollage.test.ts`
- After deployment authorization, push migration before function deploy.
- After deployment, verify live schema with the migration verification query.
- Only after implementation review, authorize a bounded Raleigh 100 or Durham 100 baseline.
