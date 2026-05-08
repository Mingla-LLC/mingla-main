# Spec: Place Intelligence Failed Retry + City Coverage (ORCH-0757)

> Date: 2026-05-08
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
> Root cause: missing retry/coverage backend actions and capped active-only UI progress
> Status: ready for implementation

## 1. Layman Summary

Admins will see the real scored percentage for a selected city and can rerun only failed places. Raleigh should show 1,288 / 1,540 scored, 83.6%, with 252 retryable failures, instead of forcing another full-city run.

## 2. User Story

As a Mingla operator, I want to see city scored coverage and retry only failed places, so that failed Gemini/API rows can be recovered without paying to rescore successful places.

## 3. Scope

- **In scope:** One migration, two edge actions, helper tests, admin coverage panel, retry button/confirmation, active retry polling.
- **Non-goals:** Performance tuning, ranking changes, mobile/business changes, ORCH-0737 close protocol, Gemini credit management.
- **Assumptions:** Completed trial rows are the source of "scored" coverage. These rows remain research-only.
- **Dependencies:** Gemini credits restored before a real Raleigh retry; no active run in the same city.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Add failed-only retry action | Investigation Finding 1; worker excludes failed rows | High |
| Add durable city coverage action | Investigation Finding 2; UI only has active counters/latest 200 rows | High |
| Use new retry parent run, not reset old rows | Investigation Finding 3; audit/unique constraints/reconciliation | High |
| Add lineage columns and retry mode | Parent `mode` check currently excludes retry; no lineage columns exist | High |
| Show Raleigh-style retryable counts | Linked DB query: 252 failed, all retryable classes | High |

## 5. Success Criteria

1. For Raleigh source run `e37f5543-0f34-4175-b06a-7ffa4f852a51`, `city_coverage` returns `servable_count=1540`, `scored_count=1288`, `scored_percent≈83.6`, `latest_run_failed_count=252`, and `retryable_failed_count=252`.
2. `retry_failed_run` creates a new parent run with `mode='retry_failed'`, `source_run_id=<old run>`, and exactly one pending child row per selected failed source place.
3. Source failed rows are not overwritten, deleted, or marked completed by retry creation.
4. Retry is rejected if the source run is missing, nonterminal, has no failed rows, or another run is active for the city.
5. Admin UI shows city coverage after active polling stops and refreshes after retry creation/completion.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| Trial output never feeds ranking | Coverage reads only admin trial tables; no mobile/scorer changes | Code review |
| One active run per city | Reuse existing partial unique index on parent status | Edge test / manual conflict check |
| One child row per `(run_id, place)` | New retry creates a new `run_id`; existing unique constraint remains | DB constraint |
| Failed source attempts remain auditable | New lineage fields point back to source; no source row mutation | Deno helper test |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| Retry attempts are new parent runs | Edge function | `mode='retry_failed'`, `source_run_id` required | Tests |
| City coverage denominator is servable places | Edge function | `place_pool.city_id = city_id AND is_servable=true` | Tests/read-only query |
| Scored coverage numerator is distinct completed places | Edge function | de-dupe `status='completed'` by `place_pool_id` | Tests |

## 7. Database / RLS / Migration

Add a migration with a prefix greater than the current local max `20260514000000`; suggested filename:

```sql
-- Migration: 20260515000000_orch_0757_place_intel_retry_lineage.sql

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_mode_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_mode_check
  CHECK (mode IN ('sample','full_city','retry_failed'));

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS chk_sample_size_consistency;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT chk_sample_size_consistency
  CHECK (
    (mode = 'sample' AND sample_size IS NOT NULL)
    OR (mode IN ('full_city','retry_failed') AND sample_size IS NULL)
  );

ALTER TABLE public.place_intelligence_runs
  ADD COLUMN IF NOT EXISTS source_run_id uuid REFERENCES public.place_intelligence_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retry_filter text,
  ADD COLUMN IF NOT EXISTS retry_source_failed_count integer,
  ADD COLUMN IF NOT EXISTS retry_selected_count integer;

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS source_trial_run_id uuid REFERENCES public.place_intelligence_trial_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_place_intel_runs_source_run_id
  ON public.place_intelligence_runs(source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pit_runs_source_trial_run_id
  ON public.place_intelligence_trial_runs(source_trial_run_id)
  WHERE source_trial_run_id IS NOT NULL;

COMMENT ON COLUMN public.place_intelligence_runs.source_run_id IS
  'ORCH-0757: retry_failed parent lineage. Points to the source place_intelligence_runs row whose failed children were retried.';

COMMENT ON COLUMN public.place_intelligence_trial_runs.source_trial_run_id IS
  'ORCH-0757: retry child lineage. Points to the failed source child row that produced this retry attempt.';
```

- RLS policies: existing `admin_full_access` on parent and service-role policies remain sufficient.
- Backfill/data migration: none.
- Rollback: drop new indexes/columns and restore mode/sample constraints without `retry_failed`.

## 8. Edge Functions / RPCs / Webhooks

### `run-place-intelligence-trial`: `city_coverage`

- **Path:** `supabase/functions/run-place-intelligence-trial/index.ts`
- **Auth:** same admin auth gate as `run_status`.
- **Request schema:** `{ action: "city_coverage", city_id: string, source_run_id?: string }`
- **Success response:**
  - `city`: `{ id, name, country }`
  - `servable_count`
  - `scored_count`: distinct `place_pool_id` with completed child row in this city
  - `scored_percent`
  - `unscored_count`
  - `latest_run`: latest parent run for city
  - `latest_run_status_counts`: child truth counts for latest run
  - `retryable_failed_count`, `nonretryable_failed_count`, `failed_count`
  - `estimated_retry_cost_usd`
  - `failure_classes`
- **Error responses:** 400 missing city, 404 city not found, 500 read failure.
- **Implementation notes:** Read in server pages, not from the UI latest-200 list. De-dupe completed rows by `place_pool_id`.

### `run-place-intelligence-trial`: `retry_failed_run`

- **Path:** `supabase/functions/run-place-intelligence-trial/index.ts`
- **Auth:** same admin auth gate as `start_run`.
- **Request schema:** `{ action: "retry_failed_run", source_run_id: string, retry_filter?: "retryable_only" | "all_failed", confirm_high_cost?: boolean }`
- **Success response:** same active-run shape as `start_run`, plus `sourceRunId`, `retrySelectedCount`, `retrySourceFailedCount`, `failureClasses`.
- **Validation:**
  - Source parent must exist and be terminal: `complete`, `failed`, or `cancelled`.
  - Reject if source has zero failed child rows.
  - Default `retry_filter` is `retryable_only`.
  - Reject if selected count is zero.
  - Apply existing `$5` cost guard using selected count.
  - Let existing unique partial index reject concurrent city runs; return `409 concurrent_run`.
- **Retryability classification:**
  - Retryable: Gemini 429/prepayment/quota/`RESOURCE_EXHAUSTED`, `MALFORMED_FUNCTION_CALL`, Supabase REST/connection reset/network/fetch failures.
  - Nonretryable by default: missing source row/place, structural validation/data errors, `prerequisites_missing`, persistent permission/config errors.
  - `all_failed` may include nonretryable rows only after confirmation/cost guard; label response clearly.
- **Creation semantics:**
  - Insert parent `place_intelligence_runs` with `mode='retry_failed'`, same `city_id/city_name`, `sample_size=null`, `total_count=selectedCount`, lineage fields, current model/prompt, and status `running`.
  - Insert new child rows with `run_id=newRunId`, `parent_run_id=newRunId`, same `city_id/place_pool_id`, `source_trial_run_id=oldChild.id`, `status='pending'`, `prep_status=null`, `signal_id=null`, `anchor_index=null`, `input_payload={}`.
  - Kick first `process_chunk` exactly like full-city mode.
- **Idempotency:** Do not reset or overwrite source rows. If retry action is double-clicked, active-run uniqueness should return 409 after first creation.
- **Deploy notes:** Edge function deploy required after migration is pushed.

## 9. Service Layer

None beyond existing `invokeWithRefresh`; keep calls local to `TrialResultsTab.jsx` unless a local pattern already exists.

## 10. Hook / State / Cache Layer

- Add local state in `TrialResultsTab.jsx`:
  - `cityCoverage`
  - `coverageLoading`
  - `retryingFailed`
- Fetch coverage when selected city changes, after `refresh()`, after active run reaches terminal, and after retry creation.
- Do not derive coverage from `allRows`.

## 11. Component / Screen Layer

### `TrialResultsTab`

- **Path:** `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`
- **States:**

| State | Condition | Renders |
|---|---|---|
| Loading coverage | city selected and request pending | compact skeleton/spinner |
| No city selected | no selected city | no coverage panel |
| Coverage available | `cityCoverage` loaded | scored percent, scored/servable, unscored, latest run failed/retryable |
| Retry available | retryable failed count > 0 and no active run | `Retry failed` button |
| Retry blocked | active run exists | disabled retry with active-run hint |
| No failures | failed count = 0 | "No failed places to retry" copy |

- **Interactions:**

| Action | Handler | Effect |
|---|---|---|
| Select city | existing city picker | fetch coverage for selected city |
| Retry failed | new handler | confirm count/cost, call `retry_failed_run`, set `activeRunId`, toast, refresh |
| Active run terminal | existing polling path | refresh rows and city coverage |

- **Copy:** Keep concise and operational. Example confirmation: `Retry 252 failed Raleigh places. Estimated Gemini cost: ~$0.63. Successful places will not be rerun. Continue?`
- **Accessibility:** Button text must include action; progress percentage must be text, not bar-only.
- **Layout/design constraints:** No nested cards. Put coverage panel near the city/mode controls or immediately above active run panel.

## 12. Business / Admin / Public Parity

- Business app changes: None.
- Admin changes: `TrialResultsTab.jsx` only.
- Public/web changes: None.
- Operational dependency: User still runs `supabase db push`; Codex runs Deno gates and deploys edge functions when approved.

## 13. Realtime / Notifications / Analytics

None. Existing 5s polling is sufficient.

## 14. Implementation Order

1. Add migration `20260515000000_orch_0757_place_intel_retry_lineage.sql`.
2. Add pure helper module in `supabase/functions/_shared/placeIntelRetryCoverage.ts` for failure classification, retry selection, and coverage derivation.
3. Add Deno tests in `supabase/functions/_shared/placeIntelRetryCoverage.test.ts`.
4. Wire `city_coverage` and `retry_failed_run` into `run-place-intelligence-trial/index.ts`.
5. Update `TrialResultsTab.jsx` with coverage state, fetch, panel, and retry handler.
6. Run Deno gates and admin lint/build.
7. After user pushes migration, deploy `run-place-intelligence-trial`.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T1 | Classify Raleigh failures | 429 prepayment, malformed function, connection reset | all retryable | Helper | Deno test |
| T2 | Nonretryable prep/data failure | `prerequisites_missing` | nonretryable by default | Helper | Deno test |
| T3 | Coverage de-dupes places | duplicate completed rows for same place across runs | counted once | Helper | Deno test |
| T4 | Retry selection preserves audit | failed source rows | new pending rows include `source_trial_run_id` | Helper/edge | Deno test or mocked helper |
| T5 | Missing source run | invalid UUID | 404/400 | Edge | Deno/manual |
| T6 | Active city run exists | partial unique violation | 409 `concurrent_run` | Edge/DB | Manual or mocked |
| T7 | UI city coverage | selected city with coverage response | percent and counts visible | Admin | `npm run lint`, build/manual |
| T8 | UI retry | retryable failures and no active run | confirmation and active run panel | Admin | manual/browser |

Required commands:

```bash
deno check supabase/functions/run-place-intelligence-trial/index.ts
deno test --allow-env supabase/functions/_shared/placeIntelRetryCoverage.test.ts
deno test --allow-env supabase/functions/_shared/placeIntelParentReconciliation.test.ts
deno test --allow-env --allow-net supabase/functions/_shared/imageCollage.test.ts
cd mingla-admin && npm run lint && npm run build
```

## 16. Regression Prevention

- **Structural safeguard:** Retry mode and lineage are explicit schema fields.
- **Test:** Helper tests for coverage/retry classification.
- **Protective comment:** In retry creation, state why source rows must not be reset.
- **Artifact update:** Implementation report must include read-only Raleigh expected coverage before any retry.

## 17. Rollback And Deploy Safety

- **Migration order:** User runs `supabase db push` first. Filename must be greater than local max `20260514000000`.
- **Edge function deploy:** Codex deploys `run-place-intelligence-trial` after Deno gates and migration push.
- **Mobile OTA vs native build:** None.
- **Business/admin web deploy:** Admin web deploy/build required for UI.
- **Env vars/secrets:** Existing Gemini/Serper/Supabase secrets only.
- **Partial rollback risk:** If edge deploy happens before migration, `retry_failed_run` will fail on missing columns/mode constraint. Gate deploy on migration push.

## 18. Common Mistakes

1. Do not reset old failed rows; that loses evidence.
2. Do not compute coverage from `allRows`; it is capped at 200.
3. Do not count attempts as places; de-dupe completed rows by `place_pool_id`.
4. Do not change production scoring/ranking to read trial output.
5. Do not use wall-clock migration naming if repo already has later-dated migrations.

## 19. Handoff To Implementor

Implement ORCH-0757 as a narrow admin/backend feature. Start with the monotonic migration, then pure retry/coverage helpers and tests, then edge actions, then the admin panel. The retry model must append a new `retry_failed` parent run with lineage and must never mutate source failed rows. After implementation, run Deno gates plus admin lint/build; wait for the user to push the migration before deploying the edge function.
