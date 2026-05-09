# Implementation Report: Place Intelligence Failed Retry And City Coverage (ORCH-0757)

> Date: 2026-05-08
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
> Status: implemented, partially verified

## 1. Layman Summary

Admins can now see how much of a city has actually been scored and can start a new run for only retryable failed places from the latest run. This means Raleigh-style failures no longer force a whole-city rerun just to recover the 252 failed places; successful places are left untouched.

## 2. Request And Context

- **Request:** Implement ORCH-0757 failed-only retry and city coverage.
- **Source:** User-dispatched `$implementor` prompt at `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`.
- **Affected surfaces:** Supabase migration, `run-place-intelligence-trial` edge function, admin Place Intelligence Trial UI.
- **Related artifacts:** Investigation and spec under `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0757...` and `SPEC_ORCH-0757...`.

## 3. Scope

- **In scope:** Retry lineage migration, retry/coverage helper, Deno tests, `city_coverage`, `retry_failed_run`, admin coverage panel, retry action.
- **Out of scope:** Live DB mutation, `supabase db push`, edge deploy, live retry execution, performance tuning, ranking/mobile/business/public scoring changes.
- **Assumptions:** Existing full-city worker path remains the owner of prep/scoring; retry children enter that path with `prep_status = null`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md` | Contract | Required migration, edge actions, UI, gates, and no live mutation. |
| `supabase/functions/run-place-intelligence-trial/index.ts` | Edge owner | Existing action dispatcher and full-city worker could host retry action and worker reuse. |
| `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx` | Admin UI owner | Existing active-run polling could be reused for retry runs. |
| `supabase/migrations/` | Migration order | Local max before ORCH-0757 was `20260514000000`; new migration uses `20260515000000`. |

## 5. Blast Radius

- **Direct changes:** Trial parent/child schema, one edge function, one admin component, one shared helper/test.
- **Cascade changes:** Retry parent mode now flows through active-run polling and worker chunks.
- **Parity surfaces:** Admin only.
- **Cache impact:** None; admin calls edge function directly.
- **State boundaries:** DB remains source of truth for coverage and retry lineage; UI does not infer coverage from latest 200 rows.
- **Auth/RLS/security:** User-auth action gate is preserved; `process_chunk` remains service-role-only.
- **Deploy path:** Operator runs migration push; Codex deploys edge function only after migration confirmation.

## 6. Old To New Receipts

### `supabase/migrations/20260515000000_orch_0757_place_intel_retry_lineage.sql`

- **Before:** No `retry_failed` parent mode or source-run/source-child lineage.
- **After:** Adds `retry_failed`, nullable sample size for retry/full-city, parent lineage fields, child lineage field, and lineage indexes.
- **Why:** Needed to audit retry runs without mutating original failed rows.
- **Approx lines changed:** New 54-line migration.

### `supabase/functions/_shared/placeIntelRetryCoverage.ts`

- **Before:** No reusable failure classification or coverage helper.
- **After:** Adds retryable/nonretryable classification, distinct scored coverage, retry row selection, and retry child row construction.
- **Why:** Keeps retry policy testable and out of UI code.
- **Approx lines changed:** New 194-line helper.

### `supabase/functions/run-place-intelligence-trial/index.ts`

- **Before:** No `city_coverage` or `retry_failed_run` actions.
- **After:** Adds DB-derived city coverage, latest-run child truth counts, retryable failure counts, retry parent creation, retry child lineage, cost guard, and first worker kick.
- **Why:** Admin needs server truth and a safe failed-only retry creation path.
- **Approx lines changed:** ORCH-0757 section plus dispatcher/import additions.

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`

- **Before:** Admin could see active progress/history but not true city scored percentage or failed-only retry.
- **After:** Selected city shows scored/servable, unscored, latest failed/retryable/nonretryable counts, estimated retry cost, and a `Retry failed` button.
- **Why:** Operator can understand recovery scope and launch only the retryable failed subset.
- **Approx lines changed:** Coverage state/fetching, retry handler, active retry display, coverage panel.

## 7. Implementation Details

- **Architecture decisions:** Retry is modeled as a new parent run with `mode = retry_failed`; original failed rows are immutable source evidence.
- **Data flow:** Admin calls `city_coverage`; admin calls `retry_failed_run`; edge inserts retry parent/children; normal worker processes children by `parent_run_id`.
- **Mutation/query behavior:** `city_coverage` is read-only. `retry_failed_run` inserts new rows only and rejects nonterminal source runs.
- **State handling:** UI refreshes coverage on city change, manual refresh, sample completion, full/retry terminal polling, and retry creation.
- **Error handling:** Edge returns explicit `source_run_not_terminal`, `no_failed_rows`, `no_retryable_failed_rows`, `cost_above_guard`, and `concurrent_run` cases.
- **Copy/accessibility:** Retry copy is concise and confirms cost plus "successful places will not be rerun."
- **Analytics/notifications/realtime:** No analytics or realtime changes.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Monotonic migration | `20260515000000...` | Local/linked remote heads showed `20260514000000`; new local row appears after remote head. | Pass |
| `city_coverage` server truth | Edge action added | `deno check` pass | Pass |
| `retry_failed_run` failed-only retry | Edge action added | `deno check` pass; helper tests pass | Pass |
| Retryable Raleigh classes | Helper classifier | Deno test covers quota, malformed function call, connection reset | Pass |
| `prerequisites_missing` nonretryable | Helper classifier | Deno test covers default nonretryable behavior | Pass |
| UI coverage panel | Admin component updated | Targeted ESLint and build pass | Pass |
| No live DB mutation/run/deploy | Preserved | No `supabase db push`, no live retry, no deploy run | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Trial output never feeds ranking | Yes | Yes | No production scoring/ranking surfaces changed. |
| Original failed rows remain audit evidence | Yes | Yes | Retry creates new child rows with `source_trial_run_id`. |
| DB owns persisted truth | Yes | Yes | Coverage uses server-side reads, not UI history. |
| Cost guard | Yes | Yes | `$5` guard reused for retry selected count. |
| Active-run collision | Yes | Yes | Existing unique partial-index behavior is honored; `23505` maps to `409 concurrent_run`. |

## 10. Parity Check

- **Mobile:** No change.
- **Business app:** No change.
- **Admin:** Place Intelligence Trial tab updated.
- **Public/web:** No change.
- **Solo/collab:** Not applicable.
- **Gaps:** UI was not browser-click tested because this pass focused on gates/build and the edge function is not deployed yet.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** New edge response for `city_coverage`; new retry response mirrors existing active-run creation shape.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Admin fetches coverage when a city is selected and hydrates active run as before.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Deno helper tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/placeIntelRetryCoverage.test.ts` | Pass: 4 passed, 0 failed | Covers classification, coverage, lineage. |
| Edge type-check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/run-place-intelligence-trial/index.ts` | Pass: `Checked 1 file` | Fixed Supabase builder callback typing before final pass. |
| Parent reconciliation tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/placeIntelParentReconciliation.test.ts` | Pass: 3 passed, 0 failed | Required gate from prompt. |
| Image collage tests | `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/_shared/imageCollage.test.ts` | Pass: 8 passed, 0 failed | Required gate from prompt. |
| Full admin lint | `cd mingla-admin && npm run lint` | Fail: 121 errors, 10 warnings | Pre-existing broad admin lint debt. Touched file issues were fixed afterward. |
| Targeted admin lint | `cd mingla-admin && npx eslint src/components/placeIntelligenceTrial/TrialResultsTab.jsx` | Pass | Confirms ORCH-0757 touched admin file is lint-clean. |
| Admin build | `cd mingla-admin && npm run build` | Pass | Vite built successfully; existing chunk-size and Leaflet CSS warnings only. |
| Migration local order | `ls supabase/migrations | tail -20` | Pass | New migration is current local max. |
| Linked migration visibility | `/Users/sethogieva/bin/supabase migration list --linked | tail -30` | Pass/read-only | Shows `20260515000000` local-only and remote head still `20260514000000`. |

## 13. Regression Surface

1. Full-city worker selection: retry children must be picked up via `prep_status IS NULL`.
2. Active-run polling: retry parents share the same status UI and terminal refresh path.
3. Migration apply: edge deploy must wait until new columns/check constraints exist remotely.
4. Admin coverage response: UI tolerates current flattened coverage fields and future nested `coverage` wrapper.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Full admin lint debt | Whole-app lint gate remains red from unrelated files | Separate admin lint cleanup | `mingla-admin/src/**` |
| Edge not deployed | Admin button will require deployed edge code and applied migration | Operator pushes DB migration, then Codex deploys function | Supabase |
| No live retry test | No live DB mutation was allowed in implementor mode | Tester/operator validates against Raleigh after deploy | Admin + Supabase |

## 15. Discoveries For Orchestrator

- Full admin lint still has broad unrelated debt. ORCH-0757 touched admin file is lint-clean, but the repo-level gate remains noisy.
- Worktree contains unrelated dirty files from other ORCH lifecycles; this report only claims ORCH-0757-specific files.

## 16. Deploy Notes

- **Migrations:** Operator must run `supabase db push`. Do not use `--include-all`; this migration is monotonic and appears after the current remote head.
- **Edge functions:** After migration push succeeds, Codex should deploy `run-place-intelligence-trial`.
- **Mobile OTA/native:** None.
- **Business/admin web:** Admin web build passes and should be deployed through the normal admin web path.
- **Env vars/secrets:** No new secrets.
- **Explicit non-actions:** No live DB mutation, no `supabase db push`, no live retry run, and no edge deploy were performed in this implementation pass.

## Suggested Commit Message

```text
admin/place-intel: add failed retry and city coverage

Resolves: ORCH-0757
Evidence: Deno check/tests, targeted admin lint, admin build, implementation report
Deploy: operator db push first, then deploy run-place-intelligence-trial edge function
```

## Ready-To-Test Checklist

1. Apply migration with `supabase db push`.
2. Deploy `run-place-intelligence-trial`.
3. Open admin Place Intelligence Trial tab, select Raleigh, and verify scored coverage shows about `1288 / 1540` and `83.6%`.
4. Confirm `Retry failed` shows the retryable failed count from the latest Raleigh run.
5. Start retry only after approval; verify a new `retry_failed` parent and child rows with `source_trial_run_id` are created.
