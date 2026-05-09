# RUNTIME_ORCH-0737_V8_RALEIGH_FULL_CITY_BASELINE_PRELIMINARY

**Date:** 2026-05-08  
**Run:** `e37f5543-0f34-4175-b06a-7ffa4f852a51`  
**City:** Raleigh  
**Status:** baseline partially successful; parent finalization bug found; Gemini credits depleted

## Summary

Raleigh full-city was started after ORCH-0737 v8 deploy and produced enough `timing_diagnostics` to identify the main bottleneck.

The run did not close cleanly:

- child rows are all terminal;
- parent row remains `running`;
- parent counters are stale relative to child truth;
- most failures are external Gemini billing/credit failures.

This is not evidence that the v8 instrumentation failed. The measurement recorder worked.

## Live Run State

Latest parent run snapshot:

```text
id: e37f5543-0f34-4175-b06a-7ffa4f852a51
city_name: Raleigh
parent_status: running
total_count: 1540
processed_count: 1522
succeeded_count: 1273
failed_count: 249
completed_at: NULL
```

Child truth:

```text
total_children: 1540
terminal_children: 1540
completed_children: 1288
failed_children: 252
nonterminal_children: 0
child_cost: 5.074114
```

Conclusion: the run is functionally done at the child-row layer but not finalized at the parent layer.

## Failure Breakdown

Top failure causes:

```text
250 rows: Gemini 429: "Your prepayment credits are depleted..."
1 row: Gemini returned no function_call ... finishReason=MALFORMED_FUNCTION_CALL
1 row: trial row update failed: TypeError sending request to Supabase REST update
```

Interpretation:

- 250/252 failures are external billing/credit exhaustion, not a Mingla pipeline defect.
- The existing malformed-function flake remains at expected low frequency.
- The one Supabase row-update transport failure is likely transient and needs no immediate standalone fix unless it recurs.

## Instrumentation Coverage

Timing coverage query returned:

```text
total_rows: 1540
rows_with_timing: 1262
rows_with_row_total: 1262
rows_with_gemini: 1237
rows_with_compose: 24
rows_with_batch_total: 1240
```

This is enough to analyze score-stage bottlenecks.

## Score Timing

Score rows with Gemini timing:

```text
score_rows: 1237
row_p50_s: 17.1
row_p95_s: 86.0
row_max_s: 86.5
gemini_p50_s: 16.4
gemini_p95_s: 85.4
base64_p50_ms: 490
total_backoff_s: 10440.0
retried_rows: 150
```

Interpretation:

- Score row wall time is almost entirely Gemini time.
- Base64 collage fetch is not the bottleneck at p50.
- Tail latency is dominated by Gemini retry/backoff, especially after credit depletion and 429s.

## Prep Timing

Prep rows with compose timing:

```text
prep_rows: 24
row_p50_s: 2.7
row_p95_s: 3.9
reviews_p50_s: 0.1
compose_p50_s: 2.6
```

Interpretation:

- Prep is not the dominant bottleneck in this Raleigh run.
- Collage compose is cheap relative to Gemini scoring.

## Root Cause Candidates

### RC-1: External Gemini credit depletion

Evidence: 250 failures with Gemini 429 message that prepaid credits are depleted.

Impact: run cannot complete successfully until credits/billing are restored. This also distorts tail timing via retry/backoff.

Fix direction: operator billing action, not code.

### RC-2: Parent finalization depends on parent counters, not child terminal truth

Evidence:

- parent `processed_count=1522`, `total_count=1540`, `status=running`;
- child terminal rows = 1540;
- child completed + failed = total count;
- no pending/running child rows remain.

Code evidence:

- `handleProcessChunk` finalizes parent only when `processed_count >= total_count`.
- cron also selects running parents only when `processed_count < total_count`.
- if counters miss a terminal child batch, parent can remain `running` forever even when child rows are all terminal.

Fix direction: implement a defensive child-truth finalization path and counter reconciliation.

## Current Recommendation

Do not close ORCH-0737 v8 yet.

Immediate next actions:

1. Restore Gemini/AI Studio prepaid credits or billing before another meaningful full-city score run.
2. Dispatch implementor rework for parent finalization/counter reconciliation.
3. After rework deploy, either manually reconcile this parent run under operator-approved SQL or run a small bounded smoke proving parent closes from child terminal truth.

## Non-Actions

- Do not start another full-city run until billing and parent finalization are addressed.
- Do not tune File API/cache/sharding from this run alone; 429 credit depletion polluted tail latency.
- Do not treat the 252 failures as model-quality failures.
