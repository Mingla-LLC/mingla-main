# QA Report: Place Intelligence Failed Retry And City Coverage (ORCH-0757)

> Date: 2026-05-08
> Mode: TARGETED + SPEC-COMPLIANCE
> Verdict: CONDITIONAL PASS
> Findings: P0:0 P1:0 P2:2 P3:0 P4:2

## 1. Layman Summary

The code-level implementation is sound enough to proceed: the migration is monotonic and now visible on the linked remote, helper tests pass, the edge function type-checks, the touched admin component is lint-clean, and the admin build passes. I found no P0/P1 blocker in retry lineage, source-row immutability, cost guard, active-run collision handling, or coverage math.

This is not a final production PASS because the ORCH-0757 edge function has not been deploy-proven/runtime-smoked. `run-place-intelligence-trial` still reports ACTIVE version `32`, updated `2026-05-08 06:36:21 UTC`, which is the earlier ORCH-0737 deploy window; the implementation report also states no ORCH-0757 edge deploy was performed. Runtime `city_coverage` and live admin Raleigh rendering remain blocked until Codex deploys the edge function.

## 2. Inputs Reviewed

- Spec: `Mingla_Artifacts/reports/SPEC_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Tester prompt: `Mingla_Artifacts/prompts/TESTER_ORCH-0757_PLACE_INTEL_FAILED_RETRY_AND_CITY_COVERAGE.md`
- Changed files: migration, helper/test, edge function, admin `TrialResultsTab.jsx`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | `supabase/migrations/20260515000000_orch_0757_place_intel_retry_lineage.sql` | Monotonic name, constraints, lineage columns, indexes, no source-row mutation. |
| Edge/RPC/Webhooks | `supabase/functions/run-place-intelligence-trial/index.ts` | Dispatch, auth split, `city_coverage`, `retry_failed_run`, worker pickup, failure paths. |
| Services | Admin `invokeWithRefresh` use | No new service layer; local calls use existing edge invocation wrapper. |
| Hooks/State/Cache | `TrialResultsTab.jsx` | Local coverage/retry state, refresh triggers, active-run polling integration. |
| Components/Screens | `TrialResultsTab.jsx` | Coverage panel, retry button, confirmation copy, disabled states. |
| Business/Admin/Public | Admin only | No mobile/business/public changes found in ORCH-0757 scope. |
| Tests/Build | Deno tests, admin lint/build | Required gates run and classified. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Migration is monotonic | Local tail + linked migration list | Verified | `20260515000000` is after `20260514000000`; linked list now shows Local=Remote for `20260515000000`. |
| `retry_failed` mode allowed | Migration lines 6-21 | Verified | Mode check and sample-size consistency updated. |
| Lineage columns exist | Migration lines 23-30; read-only linked schema query | Verified | Remote query returned all five expected columns. |
| Retry classes are tested | Helper test lines 9-35 | Verified | Deno test covers quota, malformed function call, transient REST/update failure. |
| `prerequisites_missing` nonretryable | Helper test lines 37-46 | Verified | Deno test passes. |
| Coverage de-dupes places | Helper lines 153-174; test lines 48-62 | Verified | Uses `Set` of completed `place_pool_id`. |
| Retry children preserve source lineage | Helper lines 177-199; test lines 64-106 | Verified | `source_trial_run_id` set to failed source row id. |
| `city_coverage` reads server truth | Edge lines 2032-2133 | Verified code-level | Paged DB reads, not `allRows`. Runtime edge smoke blocked until deploy. |
| `retry_failed_run` rejects unsafe cases | Edge lines 2151-2229 | Verified code-level | Missing source, nonterminal source, bad filter, no failed rows, no retryable rows, and cost guard handled. |
| Active-run collision safe | Edge lines 2235-2268 + existing DB partial unique index | Verified code-level | `23505` maps to `409 concurrent_run`. |
| Source rows not mutated | Edge lines 2187-2195, 2270-2288 | Verified code-level | Reads failed source children; inserts new parent/children only. |
| Worker picks retry children | Helper sets `prep_status:null`; worker prep pickup uses `.is("prep_status", null)` at edge lines 3053-3059 | Verified code-level | Retry children enter normal prep path. |
| Admin coverage panel exists | `TrialResultsTab.jsx` lines 1023-1097 | Verified code-level | Shows scored, unscored, failed, retryable, latest run, cost. |
| Admin does not derive coverage from `allRows` | `TrialResultsTab.jsx` lines 263-285 and 1023-1097 | Verified | Coverage comes from `city_coverage` edge action. |
| Edge deployed/runtime verified | `supabase functions list` | Not verified | Function shows version 32 updated `2026-05-08 06:36:21 UTC`; ORCH-0757 deploy not performed by tester. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Edge type-check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/run-place-intelligence-trial/index.ts` | PASS | Exit 0; cached Deno check produced no stdout. |
| Retry helper tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/placeIntelRetryCoverage.test.ts` | PASS | 4 passed, 0 failed. |
| Parent reconciliation tests | `/Users/sethogieva/.deno/bin/deno test --allow-env supabase/functions/_shared/placeIntelParentReconciliation.test.ts` | PASS | 3 passed, 0 failed. |
| Image collage tests | `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/_shared/imageCollage.test.ts` | PASS | 8 passed, 0 failed. |
| Touched admin lint | `cd mingla-admin && npx eslint src/components/placeIntelligenceTrial/TrialResultsTab.jsx` | PASS | Exit 0, no output. |
| Admin build | `cd mingla-admin && npm run build` | PASS | Vite built 2936 modules in 3.39s; only existing Leaflet/chunk warnings. |
| Full admin lint | `cd mingla-admin && npm run lint` | FAIL unrelated | 119 errors, 10 warnings. No `TrialResultsTab.jsx` entry. |
| Migration linked status | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | `20260515000000` appears in Local and Remote. |
| Function deploy status | `/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv` | CONDITIONAL | `run-place-intelligence-trial` ACTIVE version 32, updated `2026-05-08 06:36:21 UTC`; ORCH-0757 deploy still needed. |
| Read-only Raleigh child truth | Linked `supabase db query` count | PASS | `completed=1288`, `failed=252`, `total=1540`, `distinct_completed=1288`. |
| Read-only Raleigh servable denominator | Linked `supabase db query` count | PASS | `servable=1540`. |
| Linked schema check | Linked `supabase db query` information_schema | PASS | Returned `source_run_id`, `retry_filter`, `retry_source_failed_count`, `retry_selected_count`, `source_trial_run_id`. |

Note: Two parallel linked DB query attempts hit Supabase temporary-role/circuit-breaker auth errors after earlier successful read-only queries. I did not retry further to avoid noise. No write/mutation was attempted.

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | PASS code-level | Retry button has confirmation, invoke, toast error path; runtime click not performed. |
| One owner per truth | PASS | DB/edge owns coverage; UI does not derive from latest-200 rows. |
| No silent failures | PASS | Edge returns explicit error objects; UI toasts retry/coverage errors except quiet refresh paths. |
| One key per entity | N/A | No React Query key/cache change. |
| Server state server-side | PASS | Coverage and retry selection are server-side edge reads. |
| Logout clears everything | N/A | Admin trial surface only. |
| Label temporary | N/A | No new transitional marker. |
| Subtract before adding | PASS | Adds narrow helper/edge/UI without broad rewrite. |
| No fabricated data | PASS | Counts come from DB; no stubbed coverage. |
| Currency-aware | N/A | Uses USD cost estimate, existing trial cost convention. |
| One auth instance | PASS | Uses existing Supabase clients and admin gate. |
| Validate at right time | PASS | Edge validates source terminal state and cost before insert. |
| Exclusion consistency | N/A | No bouncer/exclusion changes. |
| Persisted-state startup | N/A | No persisted client store changes. |

## 7. Findings

### P0 Critical

None.

### P1 High

None.

### P2 Medium

**P2-001: ORCH-0757 edge actions are not deploy/runtime-proven yet**
- **Evidence:** `supabase functions list --project-ref gqnoajqerqhnvulmnyvv` reports `run-place-intelligence-trial` ACTIVE version `32`, updated `2026-05-08 06:36:21 UTC`; implementation report says no edge deploy occurred.
- **What is wrong:** Static code is verified, and migration is applied, but deployed edge runtime has not been proven to contain `city_coverage` / `retry_failed_run`.
- **Impact:** Admin UI will not work against production until the edge function is deployed with ORCH-0757 code.
- **Required fix:** After this conditional pass, Codex deploys `run-place-intelligence-trial` per standing deploy split.
- **Retest:** Call/read-only verify `city_coverage` for Raleigh after deploy.

**P2-002: Live retry creation was not tested because mutation/cost was not authorized**
- **Evidence:** Tester prompt forbids live `retry_failed_run` unless explicitly authorized; no such authorization was provided.
- **What is wrong:** Retry creation is verified by code/tests only; no new live `retry_failed` parent/children were created.
- **Impact:** Low implementation risk remains around runtime insert/worker kick behavior.
- **Required fix:** Only after operator approval, run a bounded live retry or a controlled dry/manual verification.
- **Retest:** Verify new parent `mode='retry_failed'`, child rows with `source_trial_run_id`, and no source-row mutation.

### P3 Low

None.

### P4 Notes

**P4-001: Full admin lint remains red from unrelated repo debt**
- **Evidence:** `npm run lint` reports failures in `App.jsx`, `InviteSetupScreen.jsx`, `LoginScreen.jsx`, `Sidebar.jsx`, `SignalAnchorsTab.jsx`, rules-filter files, settings/pages, etc.; no `TrialResultsTab.jsx` error appears.
- **Impact:** Not an ORCH-0757 blocker, but keeps admin-wide lint from being a clean release gate.

**P4-002: Remote migration is already applied**
- **Evidence:** `supabase migration list --linked` shows `20260515000000` in both Local and Remote.
- **Impact:** The previous deploy sequence step "operator runs db push" appears already satisfied. Next operational step is edge deploy, not another DB push.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Raleigh coverage expected 1288 / 1540 / 83.6% | Partial | Read-only DB proves `1288` distinct completed and `1540` servable; edge runtime not deployed/smoked | P2-001 |
| `retry_failed_run` creates linked parent/children | Partial | Code inserts parent lines 2235-2255 and children lines 2270-2278; live mutation not authorized | P2-002 |
| Source rows not overwritten/deleted | PASS code-level | Edge reads source failed rows then inserts new rows; no update/delete against source children | None |
| Reject missing/nonterminal/no failed/no selected/active city | PASS code-level | Edge validation lines 2157-2229; `23505` collision handling lines 2257-2268 | None |
| Admin coverage refreshes after change/refresh/terminal/retry | PASS code-level | `fetchCityCoverage` lines 263-285; refresh/poll/retry hooks lines 327-344, 397-400, 746-747 | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Admin auth required for new actions | None | Dispatcher reaches `city_coverage` / `retry_failed_run` only after bearer user + active `admin_users` check | PASS |
| Service-role-only worker preserved | None | `process_chunk` branch checks bearer equals service role before user auth branch | PASS |
| Source-row immutability | None | No update/delete on source failed rows in retry creation | PASS |
| Trial output remains research-only | None | No mobile/scoring/ranking code touched in ORCH-0757 scope | PASS |
| Secrets | None | No new secrets; no key logging found in ORCH-0757 code | PASS |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Coverage panel | Shows scored, unscored, failed, retryable, latest run, cost | None | PASS code-level |
| Retry confirmation | Includes retry count, city, estimated Gemini cost, and successful-place non-rerun copy | None | PASS code-level |
| Active retry state | Active run panel labels `retry_failed` as "Retry failed run" | None | PASS code-level |
| Runtime visual smoke | Browser/UI not opened against deployed edge | P2 | Blocked by edge deploy status |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | N/A | No change | Trial output remains admin-only. |
| Business | N/A | No change | No business files in scope. |
| Admin | Yes static/build | Conditional | Touched component lint/build pass; runtime pending deploy. |
| Public/web | N/A | No change | No public files in scope. |
| Solo | N/A | No change | Not a collab/social path. |
| Collab | N/A | No change | Not relevant. |
| iOS | N/A | No native change | Admin web only. |
| Android | N/A | No native change | Admin web only. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|
| Retry lineage migration | None | None | Enables UI | Required by retry action | Adds columns/constraints/indexes | Remote migration appears applied. |
| `city_coverage` action | None | None | Coverage panel depends on it | New read action | Read-only | Runtime pending deploy. |
| `retry_failed_run` action | None | None | Retry button depends on it | New insert action | New parent/child rows only | Live mutation not authorized. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Migration applied | `supabase migration list --linked` | PASS | None; avoid rerunning DB push unless needed. |
| Raleigh counts | Read-only linked DB query | PASS | After edge deploy, verify `city_coverage` returns same values. |
| Edge deployed | `supabase functions list` | BLOCKED/NOT DONE | Deploy `run-place-intelligence-trial`. |
| Admin runtime panel | Not opened/smoked | BLOCKED | Open admin after deploy and select Raleigh. |
| Live retry | Not authorized | NOT AUTHORIZED | Only run after operator explicitly approves cost/data mutation. |

## 14. Required Actions

None for implementor rework. No P0/P1 blocker found.

## 15. Conditional / Recommended Actions

1. **Deploy edge function:** Codex should deploy `run-place-intelligence-trial` now that migration `20260515000000` is applied remotely.
2. **Runtime smoke:** After deploy, run read-only `city_coverage` for Raleigh and verify about `1288 / 1540`, `83.6%`, `252` failed, `252` retryable.
3. **Admin smoke:** Open Place Intelligence Trial, select Raleigh, confirm the coverage panel renders those values and the retry button is present/blocked appropriately.
4. **Retry mutation gate:** Do not click/start failed retry until operator explicitly authorizes the Gemini cost/data mutation.

## 16. Discoveries For Orchestrator

- Full admin lint remains a separate admin-wide hygiene item; ORCH-0757 did not add touched-file lint debt.
- The operator or another process appears to have already pushed the ORCH-0757 migration; the next step is edge deploy, not migration push.
- Parallel linked `supabase db query` calls can trip temporary-role auth/circuit-breaker errors. Future live DB read-only verification should run sequential queries.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| N/A first tester pass | N/A | N/A | N/A |

Retest cycle: N/A.
