# Investigation Report: Place Intelligence Failed Retry + City Coverage (ORCH-0757)

> Date: 2026-05-08
> Source: User / Orchestrator
> Confidence: High — current admin UI, edge function, migrations, and read-only linked DB evidence all agree.
> Status: root cause proven

## 1. Layman Summary

The admin tool can run a whole city and show progress while that run is active, but it cannot tell you the durable city-wide scoring percentage after the run is over, and it cannot rerun only failed places. For Raleigh, the database now proves exactly why this hurts: 1,288 of 1,540 servable places were scored, 252 failed, and all 252 failures are retryable classes. The right fix is a new failed-only retry run linked to the original run, plus a city coverage panel that shows scored percent, failed count, retryable count, and estimated retry cost.

## 2. Scope

- **Feature / issue:** Place Intelligence Trial admin failed-place retry and city scored coverage.
- **Actor:** Mingla admin/operator.
- **Environment:** `mingla-admin`, `run-place-intelligence-trial` edge function, Supabase linked project.
- **Success definition:** Operator can see city scored coverage and start a retry-only job for failed places without rerunning completed places.
- **Assumptions:** "Scored" means at least one `place_intelligence_trial_runs` row for the city/place has `status='completed'`; completed rows are the only rows that persist Q2 output.
- **Out of scope:** Performance tuning, ORCH-0737 close protocol, Gemini billing restoration, and production ranking changes.

## 3. Intended Journey

`Admin opens Intelligence Trial -> selects city -> sees durable scored coverage -> sees latest run failures/retryability -> clicks Retry failed -> backend creates new retry parent run linked to the source -> worker processes only failed source places -> UI polls active retry run and refreshes city coverage`

Expected failure behavior: no retry while another run is active for the city, no retry for nonterminal source runs, cost confirmation above guard, clear "no retryable failures" state, and preserved failed source rows for audit.

## 4. Historical Context

- ORCH-0737 v8 found Raleigh run `e37f5543-0f34-4175-b06a-7ffa4f852a51` with child truth `1540/1540` terminal, `1288` completed, `252` failed.
- ORCH-0737 parent-finalization rework was implemented and tester conditionally passed; deployed function version 32.
- Older docs say prior Cary full-city passed and ORCH-0737 was closed, but current code/schema now use the ORCH-0737 parent table `place_intelligence_runs`.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md` | Orchestration | Mission, seed evidence, hard guards |
| 2 | `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` | Admin UI | User-visible progress, history, run actions |
| 3 | `supabase/functions/run-place-intelligence-trial/index.ts` | Edge/backend | Available actions, run creation, status, worker pickup |
| 4 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Schema/RLS | Trial row base table, RLS, indexes |
| 5 | `supabase/migrations/20260505000001_orch_0734_city_runs.sql` | Schema | City scope, unique `(run_id, place_pool_id)`, retry_count |
| 6 | `supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql` | Schema | Parent run table, mode constraint, active-run uniqueness |
| 7 | Linked Supabase read-only query | Data/runtime | Raleigh coverage and failure classes |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs/artifacts | ORCH-0757 asks for failed-only retry and city scored percentage; ORCH-0737 Raleigh failed 252 rows. | Forensics prompt and ORCH-0737 reports | Yes |
| Schema/RLS | Child rows are unique per `(run_id, place_pool_id)`; parent modes only `sample`/`full_city`; parent has no lineage columns. | `20260505000001...:72-74`, `20260506000001...:23-52` | Confirms migration needed |
| Code | Action switch has no retry or coverage action; worker only picks pending/stale running rows. | `index.ts:512-529`, `index.ts:2156-2162`, `index.ts:2324-2330` | Confirms missing backend |
| UI | Active panel shows only active parent counters; history is latest 200 child rows. | `TrialResultsTab.jsx:260-275`, `343-371`, `660-712`, `930-938` | Confirms misleading/incomplete coverage |
| Data | Raleigh has 1,540 servable, 1,288 completed, 252 failed, all retryable classes. | Read-only linked DB query on 2026-05-08 | Confirms real operator need |

**Contradictions:**

- The UI can imply run history by grouping latest 200 child rows, but a full-city run has 1,540 rows, so that view cannot be city or run truth.
- Schema already has `retry_count`, but it means Gemini malformed-function retry within one scoring call, not operator rerun of failed places.

## 7. Findings

### Finding 1: There is no failed-only retry backend path

- **Severity:** P1
- **Type:** confirmed bug / production-hardening gap
- **Confidence:** proven
- **Broken journey step:** Operator cannot recover 252 Raleigh failures without rerunning the whole city.
- **Evidence:** `run-place-intelligence-trial/index.ts:512-529` lists actions and has no retry action. Worker pickup in `index.ts:2156-2162` and `2324-2330` excludes `status='failed'`.
- **Current behavior:** Failed rows are terminal and stay failed.
- **Expected behavior:** Operator can create a new retry run from failed source rows.
- **Causal chain:** no action -> no retry parent -> failed rows excluded from worker -> failed places remain unscored.
- **User impact:** More cost/time than necessary, or incomplete city coverage.
- **Fix direction:** Add `retry_failed_run` that creates a new parent run linked to the source and inserts only selected failed places as pending children.
- **Missing test or guardrail:** Pure retry-selection tests and edge action validation tests.

### Finding 2: There is no durable city-wide scored coverage

- **Severity:** P1
- **Type:** UX gap / confirmed bug
- **Confidence:** proven
- **Broken journey step:** Operator cannot know what percentage of a city has been analyzed/scored after active polling stops.
- **Evidence:** Active progress is `processed_count / total_count` only while `activeRun` exists (`TrialResultsTab.jsx:660-712`). Polling stops on terminal parent (`343-371`). Initial refresh loads only latest 200 child rows (`260-275`).
- **Current behavior:** UI shows active-run progress, then falls back to capped row history.
- **Expected behavior:** UI shows city-wide `completed distinct places / servable places`.
- **Causal chain:** no city coverage backend -> UI has only active parent or capped child list -> operator lacks durable scored percentage.
- **User impact:** Cannot see Raleigh is 83.6% scored or that 252 places remain recoverable.
- **Fix direction:** Add `city_coverage` action and UI coverage panel.
- **Missing test or guardrail:** Coverage derivation test for duplicate completed rows across retry/full-city runs.

### Finding 3: Reusing/resetting old failed rows would destroy audit trail and fight current constraints

- **Severity:** P2
- **Type:** production-hardening gap
- **Confidence:** proven
- **Evidence:** Unique `(run_id, place_pool_id)` exists for idempotency (`20260505000001...:72-74`); parent reconciliation finalizes from child truth by parent run; parent modes currently only `sample`/`full_city` (`20260506000001...:27-51`).
- **Current behavior:** Each run has one row per place. Terminal failed rows preserve error messages and timing diagnostics.
- **Expected behavior:** Failed source rows remain intact; retry attempts are appended under a new run.
- **Fix direction:** Add explicit retry lineage columns and `mode='retry_failed'`.
- **Missing test or guardrail:** Test that retry does not mutate source run rows.

## 8. Root Cause Proof

- **File + line:** `supabase/functions/run-place-intelligence-trial/index.ts:512-529`
- **Exact code/schema:** switch handles `preview_run`, `fetch_reviews`, `compose_collage`, `start_run`, `run_trial_for_place`, `run_status`, `cancel_trial`, `list_active_runs`.
- **What it does:** No endpoint exists for failed-only retry or city coverage.
- **What it should do:** Expose admin-authenticated `city_coverage` and `retry_failed_run`.
- **Causal chain:** missing endpoint means UI cannot ask server for retry candidates or coverage; worker never sees failed rows because it only picks pending/stale-running rows.
- **Verification step:** `rg -n "retry_failed|rerun_failed|city_coverage"` returns no implementation in the edge/admin path.

- **File + line:** `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx:260-275`, `660-712`, `930-938`
- **Exact code/schema:** refresh loads latest 200 trial rows; active panel renders only active run counters; history displays `runRows.length`.
- **What it does:** Produces active-run progress and capped history, not durable city coverage.
- **What it should do:** Fetch server-derived city coverage and display scored percent independent of active polling.
- **Causal chain:** capped child rows cannot represent full-city runs; activeRun disappears at terminal status; no coverage panel remains.
- **Verification step:** Raleigh DB query proves 1,288/1,540 coverage, which current UI cannot compute from the latest-200 query.

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Latest-200 history cannot represent full-city truth | `TrialResultsTab.jsx` | `limit(200)` at lines `272-275` | P1 | UX gap |
| Parent mode constraint blocks retry mode | `20260506000001...sql` | `mode IN ('sample','full_city')` at lines `27-51` | P1 | production-hardening gap |
| No retry lineage | schema | no `source_run_id` or `source_trial_run_id` in current migrations | P2 | audit gap |

## 10. Blast Radius

- Other flows affected: Place Intelligence Trial admin only.
- Mobile/business/admin/public parity: Mobile/business/public unaffected; admin only.
- Query keys/cache/state involved: Local React state in `TrialResultsTab`; no shared query cache.
- RLS/auth/permission implications: Existing admin edge auth should gate new actions; service-role writes remain backend-only.
- Integrations involved: Gemini cost/billing, Serper/review prep, Supabase REST.
- Deploy/migration implications: Migration required for retry lineage and retry parent mode, then edge function deploy, then admin web deploy.
- Recurring pattern: Active progress was mistaken for durable operational coverage.

## 11. Production Readiness Verdict

- **Ready / not ready:** Not ready until ORCH-0757 is implemented.
- **Launch blockers:** No failed-only retry; no durable city coverage; no retry audit lineage.
- **Residual risks:** Coverage definition is trial-only and research-only; do not let these rows feed ranking.
- **Telemetry/monitoring gaps:** Need retry source/run lineage and failure classification in responses.
- **Missing tests:** Retry classification/selection, coverage derivation, action validation, admin lint/build.
- **Fastest next verification:** Implement spec, run Deno tests/check, run admin lint/build, then read-only DB query after a retry run.

## 12. Discoveries For Orchestrator

- Historical docs still contain older statements about `place_intelligence_city_runs` / ORCH-0737 closure. Current schema authority is `place_intelligence_runs`. Recommended separate documentation cleanup if those stale statements confuse future agents.

## 13. Recommended Next Step

Proceed to implementation using `SPEC_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`. The evidence supports a bounded implementation: database lineage migration, edge actions, focused admin UI, and tests.
