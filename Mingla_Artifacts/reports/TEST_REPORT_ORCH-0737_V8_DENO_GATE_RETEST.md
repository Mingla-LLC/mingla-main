# TEST_REPORT_ORCH-0737_V8_DENO_GATE_RETEST

**Date:** 2026-05-07  
**Mode:** RETEST + SPEC-COMPLIANCE  
**Verdict:** CONDITIONAL PASS  
**Findings:** P0:0 P1:0 P2:1 P3:1 P4:2

## 1. Verdict

**CONDITIONAL PASS.**

The prior Deno blocker is resolved. The edge function now passes `deno check`, and the existing image-collage Deno test passes 8/8 with the required permissions.

This is not a full production PASS because the migration/function have not been deployed in this QA session, so live schema and `[ORCH-0737-V8-TIMING]` runtime log evidence remain pending. That is expected and correct under the standing deploy split.

Plain-English impact: the Flash measurement patch is now clean enough to move to the migration-first deploy gate. It still does not make Flash faster; it makes the next Raleigh/Durham baseline trustworthy.

## 2. Files Reviewed

- `Mingla_Artifacts/prompts/TESTER_ORCH-0737_V8_DENO_GATE_RETEST.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_DENO_GATE_REWORK_REPORT.md`
- `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`
- `supabase/functions/run-place-intelligence-trial/index.ts`
- `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`

Dirty worktree note: unrelated mobile/artifact changes are present. This retest only verified the ORCH-0737 v8 Deno rework and its required blast-radius scans.

## 3. Commands Run

| Check | Command | Result |
|---|---|---|
| Deno version | `/Users/sethogieva/.deno/bin/deno --version` | PASS: `deno 2.7.14`, `typescript 5.9.2` |
| Deno type check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/run-place-intelligence-trial/index.ts` | PASS: exit 0, no diagnostics output |
| Collage unit test | `/Users/sethogieva/.deno/bin/deno test --allow-net=deno.land --allow-env=DISABLE_PHOTO_URL_TRANSFORM supabase/functions/_shared/imageCollage.test.ts` | PASS: 8/8 passed |
| Model/config/parallelism | `rg -n "\.limit\(6\)|\.limit\(12\)|GEMINI_MODEL_ID|gemini-2.5-flash|maxOutputTokens|temperature" supabase/functions/run-place-intelligence-trial/index.ts` | PASS |
| Diagnostic symbol scan | `rg -n "TimingDiagnostics|GeminiHttpDiagnostics|PlacePoolTrialPromptRow|collage_raw_bytes|gemini_http_statuses|reviews_fetch_ms|compose_collage_ms|ORCH-0737-V8-TIMING" supabase/functions/run-place-intelligence-trial/index.ts` | PASS |
| Isolation scan | `rg -n "timing_diagnostics" app-mobile mingla-business mingla-admin supabase/functions supabase/migrations docs Mingla_Artifacts \| head -80` | PASS: no app-mobile, mingla-business, or mingla-admin code reader |
| Migration read | `sed -n '1,60p' supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` | PASS |
| Whitespace | `git diff --check -- supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` | PASS: exit 0, no output |
| Focused diff review | `git diff --unified=4 -- supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` plus targeted `rg` over the diff | PASS |

Collage unit output:

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

ok | 8 passed | 0 failed (4ms)
```

## 4. Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| Deno available and version recorded | PASS | `deno 2.7.14`; TypeScript `5.9.2` |
| `deno check` exits 0 | PASS | command exited 0 with no diagnostics |
| Collage Deno test passes 8/8 | PASS | 8 passed / 0 failed |
| Rework is type-only | PASS | Diff focus shows `GeminiHttpDiagnostics extends TimingDiagnostics`, local `PlacePoolTrialPromptRow`, and `ppRaw` post-guard cast |
| Diagnostics typing not weakened to broad `any` | PASS | `GeminiHttpDiagnostics` keeps explicit fields and extends `TimingDiagnostics`; no broad DB-client `any` added |
| `PlacePoolTrialPromptRow` cast is local/post-guard | PASS | `ppErr || !ppRaw` guard at edge function lines 1174-1175 before cast |
| Model/config/parallelism unchanged | PASS | `gemini-2.5-flash`, `maxOutputTokens: 8000`, `temperature: 0.3`, score `.limit(6)`, prep `.limit(12)` |
| Retry/cancel/stuck behavior not drifted | PASS code-level | Retry statuses remain `429` and `5xx`; backoff remains retry-after or exponential base; malformed retry remains max 1; cancel and stuck-cutoff branches remain present |
| Migration shape correct | PASS code-level | Adds `timing_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb`; comment says production ranking must not read |
| No app/business/admin code reads diagnostics | PASS | Isolation scan only found migration/function/artifacts/spec/report text |
| No deploy, DB push, or baseline run by tester | PASS | No deploy/DB/baseline commands were run in this tester session |

## 5. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: Live schema and timing-log evidence remain pending**

- **Evidence:** No `supabase db push`, function deploy, live schema query, function log query, or Raleigh/Durham baseline was run in this tester session.
- **Impact:** Code is deploy-gate clean, but production-readiness still depends on proving the live column exists and the deployed edge function emits/persists `[ORCH-0737-V8-TIMING]` diagnostics.
- **Required gate:** After orchestrator approval, operator runs `supabase db push`; then Codex deploys the edge function; then run live schema and log smoke before any measurement baseline.

### P3 Low

**P3-001: Prior diagnostic-only second-update caveat still exists**

- **Evidence:** The earlier QA report noted diagnostic-only second updates can ignore Supabase errors. This rework was type-only and did not address that non-blocking caveat.
- **Impact:** Functional scoring/prep output is not blocked. If a diagnostic-only update fails, some batch-end timing fields could be missing silently.
- **Recommendation:** Keep as non-blocking observation during the first baseline; harden later only if missing batch-end diagnostics appear.

### P4 Notes

**P4-001: Prior Deno blocker is resolved**

- The prior `P2-001` from `TEST_REPORT_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md` is resolved by this retest.

**P4-002: Rework stayed disciplined**

- No File API, cache warming, worker sharding, token bucket, timeout wrapper, prompt change, model change, deploy, DB push, or baseline was introduced.

## 6. Deploy Readiness

**Recommendation:** deploy sequence may proceed after orchestrator review.

Required order remains:

1. Operator runs `supabase db push`.
2. Operator confirms migration success.
3. Codex deploys:

```bash
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
```

4. Verify live schema:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'place_intelligence_trial_runs'
  and column_name = 'timing_diagnostics';
```

5. Verify `[ORCH-0737-V8-TIMING]` logs after bounded smoke.
6. Only then run Raleigh 100 or Durham 100 baseline.

## 7. Status Summary

- Prior Deno blocker: **resolved**.
- Local code/test gates: **green**.
- Migration deployed: **no**.
- Function deployed: **no**.
- Live schema verified: **no**.
- Live timing logs observed: **no**.
- Baseline run: **no**.
