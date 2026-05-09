# QA Report: ORCH-0737 v8 Flash Measurement Patch

> Date: 2026-05-07  
> Mode: TARGETED + SPEC-COMPLIANCE  
> Verdict: CONDITIONAL PASS  
> Findings: P0:0 P1:0 P2:2 P3:1 P4:2

## 1. Verdict

**CONDITIONAL PASS.**

The v8 measurement patch is structurally implemented and does not appear to change Flash model, prompt, Q2 schema, generation config, score parallelism, prep parallelism, retry policy, malformed retry behavior, stuck-row recovery, cancel cleanup, or production ranking paths.

It is **not a full PASS** because:

- Deno is not installed locally, so `deno check` and `imageCollage.test.ts` could not run.
- The migration/function has not been deployed, so live schema, edge runtime, and `[ORCH-0737-V8-TIMING]` log evidence are still unverified.

Recommendation: install/provide Deno and run the two Deno gates before deploy. If those pass, deploy migration first, then function, then run the schema/log checks before the bounded Raleigh/Durham baseline.

## 2. Plain-English Impact

If deployed after the remaining gates pass, this gives us the evidence we need to stop guessing about Flash slowness. The next run should show whether time is being lost in prep/collage work, base64/image handling, Gemini latency, HTTP retries/backoff, DB overhead, or one slow row pinning each batch.

This patch does **not** make the worker faster yet. It makes the next speed decision evidence-based.

## 3. Files Reviewed

- `Mingla_Artifacts/prompts/TEST_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT.md`
- `supabase/functions/run-place-intelligence-trial/index.ts`
- `supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql`
- `README.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/QUERY_KEY_REGISTRY.md`

Dirty worktree note: unrelated mobile/artifact changes are present in the workspace. This QA only verified ORCH-0737 v8 affected files plus required isolation scans.

## 4. Commands Run

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Diagnostic symbols | `rg -n "timing_diagnostics\|ORCH-0737-V8-TIMING\|GeminiHttpDiagnostics\|batch_id\|collage_raw_bytes\|gemini_http_statuses" supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations` | PASS | Expected symbols in edge function and migration. Extra `batch_id` hits in baseline squash are unrelated broad-search matches. |
| Isolation scan | `rg -n "timing_diagnostics" app-mobile mingla-business mingla-admin supabase/functions supabase/migrations docs Mingla_Artifacts \| head -80` | PASS | No app-mobile, mingla-business, or mingla-admin code path reads `timing_diagnostics`; matches are new migration/function plus artifacts/spec/report. |
| Model/config/parallelism | `rg -n "\.limit\(6\)\|\.limit\(12\)\|GEMINI_MODEL_ID\|gemini-2.5-flash\|maxOutputTokens\|temperature" supabase/functions/run-place-intelligence-trial/index.ts` | PASS | `GEMINI_MODEL_ID` remains `gemini-2.5-flash`; `maxOutputTokens: 8000`; `temperature: 0.3`; score `.limit(6)`; prep `.limit(12)`. |
| Whitespace | `git diff --check -- supabase/functions/run-place-intelligence-trial/index.ts supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql` | PASS | Exit 0, no output. |
| Deno check | `deno check supabase/functions/run-place-intelligence-trial/index.ts` | BLOCKED | `zsh:1: command not found: deno`. |
| Deno unit test | `deno test supabase/functions/_shared/imageCollage.test.ts` | BLOCKED | `zsh:1: command not found: deno`. |
| Deno path check | `which deno || true` | BLOCKED | `deno not found`. |
| Known Deno bins | `ls /opt/homebrew/bin/deno /usr/local/bin/deno /Users/sethogieva/bin/deno 2>/dev/null || true` | BLOCKED | No paths found. |

## 5. Acceptance Criteria Matrix

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-1: model, prompt, Q2 schema, generation config, scoring semantics unchanged | PASS code-level | `GEMINI_MODEL_ID` lines 51-53; generation config lines 1397-1406; diff shows Q2 call still uses `Q2_TOOL`; no Q2 schema/prompt diff found. | None |
| SC-2: score `.limit(6)`, prep `.limit(12)` | PASS | Score pickup line 2049; prep pickup line 2217. | None |
| SC-3: no product/ranking path reads diagnostics | PASS | Isolation scan showed no app-mobile/mingla-business/mingla-admin reads. | None |
| SC-4: JSONB migration default/comment | PASS code-level, live unverified | Migration lines 3-7 add JSONB default `{}` and ranking isolation comment. | P2-002 |
| SC-5: completed score rows persist score/base64/Gemini/batch/DB diagnostics | PASS code-level, runtime unverified | `processOnePlace` lines 1216-1258; Gemini/base64 lines 1371-1477; batch end lines 2132-2143. | P2-002, P3-001 |
| SC-6: failed score rows persist partial diagnostics | PASS code-level | `processOnePlace` attach lines 1261-1271; score catch persists lines 2093-2127. | None |
| SC-7: prep success rows persist reviews/compose/cache/photo/DB/batch diagnostics | PASS code-level, runtime unverified | Prep success lines 2275-2328; batch end lines 2355-2365. | P2-002, P3-001 |
| SC-8: prep failed rows persist diagnostics/error | PASS code-level | Prep failure lines 2330-2350. | None |
| SC-9: HTTP retry/backoff preserves policy | PASS code-level | Retryable statuses line 307; backoff formula lines 316-322; `MAX_ATTEMPTS`/`BASE_BACKOFF_MS` unchanged lines 90-91. | None |
| SC-10: malformed retry and `retry_count` unchanged | PASS code-level | `MAX_MALFORMED_RETRIES = 1` line 1355; loop lines 1417-1505; `retry_count: retried ? 1 : 0` line 1242. | None |
| SC-11: stuck recovery/cancel cleanup unchanged | PASS code-level | Stuck filters lines 1921-1923, 2046-2049, 2214-2217; cancel cleanup lines 1830-1843 and 1886-1899. | None |
| SC-12: stable timing logs | PASS code-level, runtime unverified | `emitTiming` lines 215-221; row/batch calls lines 1080, 1258, 2127, 2157, 2328, 2350, 2379. | P2-002 |
| SC-13: report includes required commands/queries | PASS | Implementation report includes deploy, rollback, schema, baseline SQL/log checks. | None |
| SC-14: no live baseline without authorization | PASS | No deployment/baseline command was run by implementor or tester. | None |

## 6. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: Deno compile/unit gates are unverified because Deno is unavailable**

- **Evidence:** `deno check supabase/functions/run-place-intelligence-trial/index.ts` and `deno test supabase/functions/_shared/imageCollage.test.ts` both returned `zsh:1: command not found: deno`. `which deno` returned `deno not found`; `/opt/homebrew/bin/deno`, `/usr/local/bin/deno`, and `/Users/sethogieva/bin/deno` were absent.
- **What is wrong:** The edge function TypeScript and existing collage unit test did not run in this tester session.
- **Impact:** A compile/type/runtime issue could still exist despite static grep evidence. This is especially relevant because `callGeminiQuestion` now attaches diagnostics through thrown errors and returns a wider object shape.
- **Required fix/gate:** Install/provide Deno or run in an environment with Deno, then execute:
  - `deno check supabase/functions/run-place-intelligence-trial/index.ts`
  - `deno test supabase/functions/_shared/imageCollage.test.ts`
- **Retest:** Tester should record command output before deploy or as the first post-deploy gate.

**P2-002: Live schema, edge runtime, and timing logs remain unverified**

- **Evidence:** Implementation report says `NOT DEPLOYED, NOT BASELINE-RUN`; tester did not receive deploy/runtime authorization.
- **What is wrong:** The migration exists in code, but live `information_schema` was not checked; edge runtime did not execute; `[ORCH-0737-V8-TIMING]` logs were not observed.
- **Impact:** Code-level PASS is not equivalent to production readiness. The next baseline is only interpretable after live schema/log checks prove diagnostics actually persist.
- **Required fix/gate:** With operator authorization, deploy in this order:
  - `/Users/sethogieva/bin/supabase db push --project-ref gqnoajqerqhnvulmnyvv`
  - `/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv`
  Then run the schema verification query and log marker check from the implementation report.
- **Retest:** Confirm live column is `jsonb`, default `'{}'::jsonb`, not nullable, and logs include `[ORCH-0737-V8-TIMING]` after a bounded smoke.

### P3 Low

**P3-001: Diagnostic-only second updates ignore Supabase errors**

- **Evidence:** Score success writes final functional row with `timing_diagnostics: preWriteDiagnostics`, then performs a second diagnostics-only update at lines 1253-1257 without checking `{ error }`. Batch-end updates at lines 2139-2141 and 2362-2364 are also unchecked. Prep success second update at lines 2325-2327 is unchecked.
- **What is wrong:** If one of these diagnostics-only updates fails, the row can remain functionally correct but miss `db_write_ms`, `batch_total_ms`, or `worker_elapsed_ms_at_batch_end` without an explicit warning.
- **Impact:** Low production risk because trial output still completes and the first diagnostics write exists. Measurement quality could degrade silently if the second update fails during the first baseline.
- **Recommended fix:** Consider a small follow-up helper that logs `[ORCH-0737-V8-TIMING]` `diagnostic_update_failed` with row id/place id when a diagnostics-only update returns an error. Do not block deploy if Deno/live gates pass.
- **Retest:** Force or mock a diagnostics update error in a future harness, or inspect logs during the first baseline for missing batch-end fields.

### P4 Notes

**P4-001: Deployment order is correctly documented and load-bearing**

- **Evidence:** Implementation report states migration must apply before function deploy because the function writes `timing_diagnostics`.
- **Result:** Correct. Do not deploy function before migration.

**P4-002: The patch stayed measurement-only**

- **Evidence:** Static scan showed unchanged model/config/parallelism; no File API/cache warming/sharding paths were added.
- **Result:** Correct scope discipline.

## 7. Deployment / Baseline Status

- Migration deployed: **No**
- Function deployed: **No**
- Live schema verified: **No**
- Live timing logs observed: **No**
- Raleigh/Durham/London baseline started: **No**

This is the correct state for tester mode without explicit deployment/runtime authorization.

## 8. Remaining Manual Gates

Before treating this as deploy-ready:

1. Run Deno gates:
   ```bash
   deno check supabase/functions/run-place-intelligence-trial/index.ts
   deno test supabase/functions/_shared/imageCollage.test.ts
   ```
2. Deploy migration before function:
   ```bash
   /Users/sethogieva/bin/supabase db push --project-ref gqnoajqerqhnvulmnyvv
   /Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
   ```
3. Verify live schema:
   ```sql
   select column_name, data_type, column_default, is_nullable
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'place_intelligence_trial_runs'
     and column_name = 'timing_diagnostics';
   ```
4. Verify timing logs after a bounded smoke:
   ```bash
   /Users/sethogieva/bin/supabase functions logs run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv | rg "ORCH-0737-V8-TIMING"
   ```
5. Only after those pass, run the approved Raleigh 100 or Durham 100 measurement baseline.

## 9. Recommendation

**Conditional deploy recommendation:** hold deployment until the Deno gates are run. If Deno check and unit test pass, proceed with migration-first deploy, live schema verification, timing-log smoke, then bounded Raleigh/Durham 100 baseline.

No implementor rework is required before the Deno gate unless the operator wants the P3 diagnostic-update warning hardening before the first baseline.
