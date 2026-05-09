# Test Report: ORCH-0737 v8 Parent Finalization Rework

> Date: 2026-05-08
> Mode: TARGETED / SPEC-COMPLIANCE
> Scope: `run-place-intelligence-trial` parent finalization and child-truth reconciliation
> Verdict: CONDITIONAL PASS

## 1. Verdict

**CONDITIONAL PASS.**

No P0/P1 blockers found. Code, tests, and static evidence satisfy the tester prompt. The condition is expected and operational: this has not been deployed or live-smoked yet. Tester mode did not deploy, mutate live Supabase, start a city run, or repair the stale Raleigh parent.

## 2. Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P2 | Deployment/runtime smoke remains pending. | Edge function changes are local only; tester prompt forbids deploy/live DB mutation. | Orchestrator must approve deploy, Codex deploys edge function, then runtime smoke/reconciliation check runs. |
| P2 | Clean performance baseline remains blocked by external Gemini credits. | Runtime report says `250/252` Raleigh failures were Gemini credit exhaustion. | Restore Gemini credits before any new full-city performance baseline. |

No P0/P1 implementation blockers.

## 3. Inputs Reviewed

| Artifact / file | Purpose | Result |
|---|---|---|
| `Mingla_Artifacts/prompts/TESTER_ORCH-0737_V8_PARENT_FINALIZATION_REWORK.md` | QA contract | Verified required checks. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_PARENT_FINALIZATION_REWORK.md` | Implementation claims | Claims matched code/tests. |
| `supabase/functions/run-place-intelligence-trial/index.ts` | Edge function implementation | Child-truth reconciliation wired into completion paths. |
| `supabase/functions/_shared/placeIntelParentReconciliation.ts` | Pure reconciliation helper | Counts child terminal/completed/failed/cancelled/nonterminal truth and derives update payload. |
| `supabase/functions/_shared/placeIntelParentReconciliation.test.ts` | Regression coverage | Covers Raleigh drift, nonterminal refusal, and cancellation final status. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Ordering-key proof | `place_intelligence_trial_runs_pkey` is primary key on `id`. |

## 4. Claim Verification

| Claim | Status | Evidence |
|---|---|---|
| Parent cannot remain `running` when all child rows are terminal once worker runs. | Verified in code/test; live deploy pending. | `index.ts:1956-1959`, `2013-2027`, `2063-2069`, `2091-2101`; regression test `placeIntelParentReconciliation.test.ts:4-32`. |
| Parent counters reconcile from child truth. | Verified. | Helper derives `processed_count`, `succeeded_count`, `failed_count`, `cost_so_far_usd` at `placeIntelParentReconciliation.ts:50-88`. |
| Reconciliation refuses to finalize while any child is nonterminal. | Verified. | Guard at `placeIntelParentReconciliation.ts:74-76`; test at `placeIntelParentReconciliation.test.ts:34-56`. |
| Cancellation final status is preserved. | Verified for helper contract; old explicit cancel cleanup remains unchanged. | Helper status branch at `placeIntelParentReconciliation.ts:78-80`; test at `placeIntelParentReconciliation.test.ts:58-79`; cancel cleanup remains `index.ts:1931-1944` and `1992-2011`. |
| Paged child reads are deterministic. | Verified. | `.order("id", { ascending: true }).range(from, to)` at `index.ts:1868-1873`. |
| Helper reads all pages until final short page. | Verified. | Loop page increment and short-page break at `index.ts:1865-1882`. |
| `id` is stable ordering key. | Verified. | Baseline migration line `10764`: `place_intelligence_trial_runs_pkey PRIMARY KEY ("id")`. |
| Score/prep limits unchanged. | Verified. | Static scan: score `.limit(6)` at `index.ts:2162`; prep `.limit(12)` at `index.ts:2330`. |
| Gemini model/config unchanged. | Verified. | Static scan: `gemini-2.5-flash` at `index.ts:57-59`, `maxOutputTokens: 8000` and `temperature: 0.3` at `index.ts:1430-1431`. |
| v8 timing diagnostics unchanged. | Verified. | Static scan confirms marker/types/fields at `index.ts:167-326` and write sites through score/prep batches. |

## 5. Command Evidence

### Deno Check

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/run-place-intelligence-trial/index.ts
```

Result: PASS, exit 0. Command produced no stdout in this cached run.

### Reconciliation Regression Test

```bash
/Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/placeIntelParentReconciliation.test.ts
```

Output:

```text
running 3 tests from ./supabase/functions/_shared/placeIntelParentReconciliation.test.ts
deriveParentReconciliation finalizes Raleigh-style drift from child truth ... ok (13ms)
deriveParentReconciliation refuses to finalize while any child is nonterminal ... ok (0ms)
deriveParentReconciliation preserves cancellation final status ... ok (0ms)

ok | 3 passed | 0 failed (22ms)
```

### Existing Collage Test

```bash
/Users/sethogieva/.deno/bin/deno test --allow-net=deno.land --allow-env=DISABLE_PHOTO_URL_TRANSFORM supabase/functions/_shared/imageCollage.test.ts
```

Output:

```text
running 8 tests from ./supabase/functions/_shared/imageCollage.test.ts
transform — Supabase Storage object URL → render URL with size params ... ok (0ms)
transform — Storage URL with existing query params has them stripped ... ok (0ms)
transform — Google lh3 CDN with =k-no suffix → =wN-hN ... ok (0ms)
transform — Google lh3 CDN with no suffix → appends =wN-hN ... ok (0ms)
transform — Google lh4 / lh5 / lh6 CDN host variants all match ... ok (0ms)
transform — unknown CDN URL passes through unchanged (graceful fallback) ... ok (0ms)
transform — empty / null / non-string input passes through unchanged ... ok (0ms)
transform — different tile sizes produce different URLs ... ok (0ms)

ok | 8 passed | 0 failed (8ms)
```

### Static Non-Regression Scan

```bash
rg -n "\.order\(\"id\"|\.range\(from, to\)|\.limit\(6\)|\.limit\(12\)|GEMINI_MODEL_ID|gemini-2.5-flash|maxOutputTokens|temperature" supabase/functions/run-place-intelligence-trial/index.ts
```

Key output:

```text
57:const GEMINI_MODEL_ID = "gemini-2.5-flash";
58:const GEMINI_MODEL_NAME_SHORT = "gemini-2.5-flash";
59:const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;
1430:      maxOutputTokens: 8000,
1431:      temperature: 0.3,
1872:      .order("id", { ascending: true })
1873:      .range(from, to);
2162:    .limit(6);
2330:    .limit(12);
```

### Timing Diagnostics Scan

```bash
rg -n "timing_diagnostics|ORCH-0737-V8-TIMING|GeminiHttpDiagnostics|batch_id|gemini_http_statuses" supabase/functions/run-place-intelligence-trial/index.ts
```

Result: PASS. Output included `ORCH-0737-V8-TIMING`, `GeminiHttpDiagnostics`, `gemini_http_statuses`, `batch_id`, and `timing_diagnostics` write sites.

### Ordering-Key Proof

```bash
rg -n "place_intelligence_trial_runs_pkey|PRIMARY KEY \\(\"id\"\\)" supabase/migrations/20260505000000_baseline_squash_orch_0729.sql
```

Key output:

```text
10764:    ADD CONSTRAINT "place_intelligence_trial_runs_pkey" PRIMARY KEY ("id");
```

## 6. Scope / Non-Change Verification

- No migration added.
- No deploy performed.
- No live Supabase mutation performed.
- No new full-city run started.
- No Gemini model/config change detected.
- No score/prep parallelism change detected.
- No v8 timing diagnostics removal detected.
- No File API/cache/sharding/token-bucket/performance-tuning scope added.

## 7. Residual Risk

- Runtime behavior still needs deploy + smoke because local tests cannot mutate the live Raleigh parent.
- The Raleigh performance timing evidence remains polluted by Gemini billing exhaustion and should not be used as a clean performance baseline.

## 8. Tester Recommendation

Proceed to `$orchestrator` review.

Recommended next orchestrator sequence:

1. Accept this Conditional Pass.
2. Authorize Codex edge function deploy for `run-place-intelligence-trial`.
3. After deploy, run a bounded runtime reconciliation smoke against a terminal-child/stale-parent run, or explicitly choose manual SQL/operator handling for the stale Raleigh parent.
4. Do not start another full-city baseline until Gemini credits are restored.
