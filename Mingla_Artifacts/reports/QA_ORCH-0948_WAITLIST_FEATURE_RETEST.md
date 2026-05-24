# QA RETEST Report: ORCH-0948 Waitlist Feature

> Date: 2026-05-24
> Mode: RETEST
> Working tree: `~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/` on branch `ORCH-0948-waitlist-feature`
> Verdict: PASS
> Severity counts: P0:0 P1:0 P2:0 P3:0 P4:2

## 1. Retest Scope

This retest independently verified the P1 rework from `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0948_WAITLIST_FEATURE.md` against the prior FAIL report `Mingla_Artifacts/reports/QA_ORCH-0948_WAITLIST_FEATURE.md`.

Focused goals:

- Verify P1-001 is fixed: `tests-append-only` no longer rejects `supabase/functions/notification-retry-sweeper/index.test.ts`.
- Verify P1-002 is fixed: ORCH-0863 backend strict-grep C7 no longer rejects the source-reconciled remote-only migration files.
- Verify T-WL-10, T-WL-11, and T-WL-12 are preserved and still pass.
- Preserve hard guards: no test weakening, no excluded product-path edits, no live Supabase mutation.

This was not a new live-data mutation pass. The prior QA report's runtime/manual notes for business iOS/Android/web planner parity, true live FIFO/idempotency mutation, and provider-safe send verification remain outside this P1 retest unless the operator dispatches a broader runtime QA pass.

## 2. Inputs Reviewed

| Artifact | Use |
|---|---|
| `Mingla_Artifacts/reports/QA_ORCH-0948_WAITLIST_FEATURE.md` | Prior FAIL source and P1/P2 baseline. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0948_WAITLIST_FEATURE.md` | Rework claims and expected verification gates. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0948_WAITLIST_FEATURE.md` | Original implementation scope, tests, exclusions, and residual risks. |
| `Mingla_Artifacts/reports/DEPLOY_ORCH-0948_WAITLIST_FEATURE.md` | Deploy/reconciliation context for renamed migration and remote-only migration files. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0948_WAITLIST_FEATURE.md` | Binding ORCH scope and excluded surfaces. |

## 3. Findings

No P0/P1/P2/P3 findings in the focused retest scope.

### P4-001: Prior runtime/manual gates remain outside this focused P1 retest

The prior QA report's P2 runtime parity and live-mutation checks were not re-executed because this dispatch explicitly targeted the P1 rework gates and T-WL-10/11/12 preservation. No live Supabase mutation was performed.

### P4-002: Worktree still has pre-existing untracked dependency folders

`git status --short --branch` still reports untracked `app-mobile/node_modules`, `mingla-admin/node_modules`, and `mingla-business/node_modules`. These are local dependency folders, not source edits, and were not modified by this retest.

## 4. Claim Verification

| Rework claim | Status | Evidence |
|---|---|---|
| P1-001 fixed without weakening tests | VERIFIED | `git diff origin/main...HEAD -- supabase/functions/notification-retry-sweeper/index.test.ts` shows only an added Deno test at lines 53-57; the legacy `new Set(eligible.map` assertion remains at lines 48-50. `node .github/scripts/test-append-only-check.js` passed: 10 passed, 0 failed. |
| P1-002 fixed with narrow ORCH-owned allowlist | VERIFIED | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` has ORCH-0948 backend allowlist lines 601-626 and reconciled migration allowlist lines 627-637. `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` passed with C7 clean across 42 changed files. |
| T-WL-10 preserved | VERIFIED | `supabase/functions/ticket-confirmation-dispatch/__tests__/waitlist-spot-open.adversarial.test.ts` remains present and pins malformed payload terminal failure, SMS Twilio path, provider retryability, and routing before unknown-template terminal fail. Deno focused suite passed 37/37. |
| T-WL-11 preserved | VERIFIED | `mingla-business/src/components/waitlist/__tests__/JoinWaitlistSheet.adversarial.test.tsx` remains present and pins consent re-disable, invalid email validation, and network-error sheet behavior. Focused Jest suite passed 3 suites / 8 tests. |
| T-WL-12 preserved | VERIFIED | `.github/scripts/strict-grep/__tests__/orch-0948-confirm-exclusion.test.mjs` remains present and validates pass/fail cases for confirm routes and `TicketQrCarousel.tsx`. Node self-test passed 3/3. |
| Excluded product paths untouched | VERIFIED | `git diff --name-only origin/main...HEAD | rg '^(app-mobile/|mingla-admin/|mingla-business/app/checkout/\\[eventId\\]/confirm/|mingla-business/app/checkout-trip/\\[tripEventId\\]/confirm/|.*TicketQrCarousel\\.tsx$)'` returned no source paths. |
| Live Supabase was not mutated during retest | VERIFIED | Retest used local source inspection and local Deno/Jest/Node gates only. No Supabase CLI or MCP mutation command was run. |

## 5. Gate Results

| Gate | Result | Evidence |
|---|---|---|
| Append-only regression gate | PASS | `node .github/scripts/test-append-only-check.js` -> append-only check: 10 passed, 0 failed. |
| ORCH-0863 backend strict-grep | PASS | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` -> all checks PASS; C7 reports zero unallowlisted backend touches. |
| ORCH-0948 confirm-exclusion strict-grep | PASS | `node .github/scripts/strict-grep/orch-0948-waitlist-feature.mjs` -> PASS, confirm exclusion preserved. |
| T-WL-12 self-test | PASS | `node --test .github/scripts/strict-grep/__tests__/orch-0948-confirm-exclusion.test.mjs` -> 3 passed, 0 failed. |
| Deno check | PASS | `/Users/sethogieva/.deno/bin/deno check supabase/functions/waitlist-signup/index.ts supabase/functions/ticket-confirmation-dispatch/index.ts supabase/functions/notification-retry-sweeper/index.ts supabase/functions/ticket-confirmation-dispatch/__tests__/waitlist-spot-open.adversarial.test.ts` exited 0. |
| Focused Deno suite | PASS | `/Users/sethogieva/.deno/bin/deno test --allow-read ...` -> 37 passed, 0 failed. Includes T-WL-10 and existing waitlist migration/source regressions. |
| Focused Jest suite | PASS | `npx jest src/components/checkout/__tests__/QuantityRow.waitlist.test.tsx src/components/waitlist/__tests__/JoinWaitlistSheet.test.tsx src/components/waitlist/__tests__/JoinWaitlistSheet.adversarial.test.tsx --runInBand` -> 3 suites passed, 8 tests passed. Includes T-WL-11. |
| Whitespace diff gate | PASS | `git diff --check` exited 0. |
| Excluded path diff guard | PASS | Forbidden-path grep returned no matches for `app-mobile/`, `mingla-admin/`, checkout confirm routes, checkout-trip confirm routes, or `TicketQrCarousel.tsx`. |

## 6. Retest Verdict

PASS for the focused P1 rework retest.

The prior append-only and ORCH-0863 backend strict-grep failures are fixed, and T-WL-10, T-WL-11, and T-WL-12 remain present and passing. No tests were weakened in the inspected rework surface, no excluded product source paths were touched, and no live Supabase mutation was performed.

## 7. Next Routing

Route to Codex `orchestrator-mingla` for CLOSE, using this retest report plus the original QA, implementation, rework, deploy, and spec artifacts as evidence. If the operator wants the older runtime/manual parity notes promoted back into close-blocking gates, dispatch a separate targeted runtime QA pass rather than reopening the P1 rework.
