# Implementation Report: ORCH-0737 v8 Parent Finalization Rework

> Date: 2026-05-08
> Mode: Rework
> Spec: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0737_V8_PARENT_FINALIZATION_REWORK.md`
> Status: implemented and verified

## 1. Layman Summary

The Raleigh run proved every child row can finish while the parent run stays stuck as `running`. This rework makes the parent check the actual child rows before deciding whether a run is done. If every child is terminal, the parent counters are rebuilt from child truth and the parent is marked `complete` or `cancelled` as appropriate.

Follow-up rework after orchestrator review added deterministic paging: child rows are now ordered by `id` before `.range(from, to)`, so full-city reconciliation does not depend on implicit database row order.

## 2. Request And Context

- **Request:** Fix the parent finalization/counter drift bug found by ORCH-0737 v8 Raleigh baseline.
- **Source:** Runtime evidence in `RUNTIME_ORCH-0737_V8_RALEIGH_FULL_CITY_BASELINE_PRELIMINARY.md`.
- **Affected surfaces:** Supabase edge function `run-place-intelligence-trial`; shared Deno helper/test.
- **Related issues/artifacts:** ORCH-0737 v8 timing diagnostics, Raleigh run `e37f5543-0f34-4175-b06a-7ffa4f852a51`.
- **Follow-up rework:** `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0737_V8_PARENT_FINALIZATION_DETERMINISTIC_PAGING.md`.

## 3. Scope

- **In scope:** Parent finalization based on child-row truth; counter reconciliation; Deno regression test.
- **Out of scope:** Gemini model, prompt text, Q2 schema, generation config, File API, cache warming, sharding, billing/credit handling, live DB mutation.
- **Assumptions:** Existing child statuses `completed`, `failed`, and `cancelled` are terminal.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0737_V8_PARENT_FINALIZATION_REWORK.md` | Contract | Required child-truth reconciliation and Deno gates. |
| `Mingla_Artifacts/reports/RUNTIME_ORCH-0737_V8_RALEIGH_FULL_CITY_BASELINE_PRELIMINARY.md` | Evidence | Raleigh children terminal while parent counters drifted. |
| `supabase/functions/run-place-intelligence-trial/index.ts` | Target | Four completion decisions depended on parent counters. |
| `supabase/functions/_shared/imageCollage.test.ts` | Required existing gate | Collage regression gate still passes. |
| `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0737_V8_PARENT_FINALIZATION_DETERMINISTIC_PAGING.md` | Follow-up contract | Required explicit ordering before paged `.range(...)`. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Ordering-key proof | `place_intelligence_trial_runs_pkey` is primary key on `id`. |

## 5. Blast Radius

- **Direct changes:** `process_chunk` parent finalization path.
- **Cascade changes:** Self-invoke chaining now stops when child truth finalizes a run.
- **Parity surfaces:** Admin run status should stop showing completed city runs as forever-running.
- **Cache impact:** None.
- **State boundaries:** DB remains persisted source of truth; helper only reconciles parent row from child table.
- **Auth/RLS/security:** No policy/schema/auth changes.
- **Deploy path:** Edge function deploy required after tester/orchestrator approval.

## 6. Old To New Receipts

### `supabase/functions/run-place-intelligence-trial/index.ts`

- **Before:** Completion was based on `processed_count >= total_count`; drift left Raleigh parent `running`.
- **After:** `reconcileAndFinalizeParentFromChildren` pages all child rows in deterministic `id` order, derives terminal/completed/failed/cancelled/nonterminal counts, and updates parent counters/status when all children are terminal.
- **Why:** Child rows are the durable truth when parent counters drift.
- **Approx lines changed:** Added helper, replaced completion checks at initial/mid-budget/no-eligible/chain-decision points, and added `.order("id", { ascending: true })` before `.range(from, to)`.

### `supabase/functions/_shared/placeIntelParentReconciliation.ts`

- **Before:** No pure reusable/testable reconciliation logic.
- **After:** Pure derivation function computes reconciliation result and parent update payload from parent snapshot + child rows.
- **Why:** Gives the Raleigh drift class a focused regression test without importing the serving edge function.
- **Approx lines changed:** New helper module.

### `supabase/functions/_shared/placeIntelParentReconciliation.test.ts`

- **Before:** No automated coverage for parent counter drift.
- **After:** Tests Raleigh-style drift, nonterminal child guard, and cancellation status preservation.
- **Why:** Encodes the new finalization contract.
- **Approx lines changed:** New Deno test file.

## 7. Implementation Details

- **Architecture decisions:** Keep DB access in edge function; move pure counting/update derivation into `_shared` for testability.
- **Data flow:** Parent snapshot + paged child rows -> derived counts -> parent update if all children terminal.
- **Mutation/query behavior:** Child rows are fetched with `.order("id", { ascending: true }).range(from, to)` pages of 1000 so Raleigh-scale runs are not truncated by REST row caps and page boundaries are deterministic.
- **State handling:** Parent status becomes `complete` for normal terminal children, `cancelled` when parent was cancelling/cancelled.
- **Error handling:** Read/update failures return non-finalized reasons; worker does not silently claim completion.
- **Analytics/notifications/realtime:** Unchanged.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Parent cannot remain running when all child rows are terminal | Yes | Helper called before chaining and no-eligible exits | Pass |
| Parent counters reconciled from child truth | Yes | New pure helper + Raleigh-style test | Pass |
| Existing normal counter path still works | Yes | Counter path now finalizes through child truth when terminal | Pass |
| Cancellation semantics preserved | Yes | Cancelling/cancelled parent finalizes as `cancelled`; test added | Pass |
| Score/prep parallelism unchanged | Yes | Static scan shows `.limit(6)` and `.limit(12)` preserved | Pass |
| Measurement diagnostics unchanged | Yes | Static scan shows v8 timing symbols preserved | Pass |
| Paged reconciliation deterministic | Yes | Static scan shows `.order("id", { ascending: true })` before `.range(from, to)` | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| DB owns persisted truth | Yes | Yes | Parent is derived from child rows in DB. |
| No silent failure | Yes | Yes | Failed reconciliation returns/logs reason instead of false success. |
| One owner per truth | Yes | Yes | No client/cache state added. |
| Prompt/model stability | Yes | Yes | Gemini constants and prompt config untouched. |

## 10. Parity Check

- **Mobile:** Not affected.
- **Business app:** Not affected.
- **Admin:** Benefits from terminal parent status once edge function is deployed.
- **Public/web:** Not affected.
- **Solo/collab:** Not affected.
- **Gaps:** Live Raleigh parent was not mutated in implementor mode.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Edge function imports one small local helper.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Edge function typecheck | `/Users/sethogieva/.deno/bin/deno check supabase/functions/run-place-intelligence-trial/index.ts` | PASS | `Check supabase/functions/run-place-intelligence-trial/index.ts`. |
| New reconciliation regression | `/Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/placeIntelParentReconciliation.test.ts` | PASS | 3/3 passed. |
| Existing collage Deno unit test | `/Users/sethogieva/.deno/bin/deno test --allow-net=deno.land --allow-env=DISABLE_PHOTO_URL_TRANSFORM supabase/functions/_shared/imageCollage.test.ts` | PASS | 8/8 passed. |
| Score/prep/model/static ordering scan | `rg` for `.order("id"`, `.range(from, to)`, `.limit(6)`, `.limit(12)`, Gemini model/config | PASS | Ordering added; limits/model/config preserved. |
| v8 timing static scan | `rg` for timing diagnostics symbols | PASS | Timing fields and markers preserved. |
| Ordering-key proof | `rg` in baseline migration for `place_intelligence_trial_runs_pkey` | PASS | `id` is the primary key. |

## 13. Regression Surface

1. `process_chunk` completion decisions: now depend on child-row terminal truth before returning complete.
2. Self-invoke chaining: now stops if reconciliation finalizes before dispatching another worker.
3. Large city runs: child read is paged to avoid truncation at 1000 rows, with deterministic `id` ordering to keep page boundaries stable.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Live Raleigh parent still stale | Implementor did not mutate live DB | Tester/orchestrator/operator decide whether to run deploy and/or manual reconciliation | Supabase live run |
| Gemini credits depleted | Clean performance baseline remains blocked | Operator restores Gemini credits before another full-city run | External Gemini billing |

## 15. Discoveries For Orchestrator

- The helper must page child rows; Raleigh has 1,540 children, so an unpaged REST select could undercount. This is handled in the implementation.
- Orchestrator correctly caught that paging needs explicit ordering. The implementation now orders by `id`, proven as the table primary key.

## 16. Deploy Notes

- **Migrations:** None added. Operator does not need `supabase db push` for this rework.
- **Edge functions:** Deploy `run-place-intelligence-trial` after tester/orchestrator approval. Codex should deploy the edge function at that gate.
- **Mobile OTA/native:** None.
- **Business/admin web:** None.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
supabase: reconcile place intel parent completion

Resolves: ORCH-0737
Evidence: deno check, reconciliation regression test, imageCollage test
Deploy: edge function deploy required after tester/orchestrator approval
```

## Ready-To-Test Checklist

1. Tester runs Deno gates above.
2. Tester verifies `.limit(6)`, `.limit(12)`, Gemini model/config, and v8 timing diagnostics remain unchanged.
3. After deploy approval, invoke/allow `process_chunk` on a terminal-child/stale-parent run and confirm parent counters/status reconcile from child truth.
