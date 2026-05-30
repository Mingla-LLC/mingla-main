# QA Retest Report: ORCH-1021 Decisive Curated + Single-Card Scheduling

Date: 2026-05-30  
Mode: RETEST / SPEC-COMPLIANCE  
Verdict: FAIL  
Findings: P0:0 P1:2 P2:1 P3:1 P4:3  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1021-[curated-stop-timezone-false-open]`  
Branch / commit: `ORCH-1021-curated-stop-timezone-false-open` / `75c543e4f`

## 1. Layman Summary

The core parser fix is real: noon-close hours like `9:00 - 12:00 PM` no longer look open overnight, and the new single-card helper correctly blocks closed and unknown hours.

Release is still blocked because the expanded-card schedule flow now runs the single-place availability check before the curated stop check. A curated card with all stops open but no top-level `openingHours` is blocked as `unknown` before Mingla checks its stops, so curated scheduling from expanded cards can be falsely blocked with the wrong single-place message.

There is also a TypeScript regression in a dependent component: widening `ExpandedCardData.openingHours` introduced an assignability error at `ExpandedCardModal.tsx:2046` when passing `card.openingHours` into `PracticalDetailsSection`.

## 2. Inputs Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`
- Rework prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`
- Prior QA fail: `Mingla_Artifacts/reports/QA_ORCH-1021_CURATED_STOP_TIMEZONE_FALSE_OPEN.md`
- Changed files from commit `75c543e4f`
- Active comms-ledger WARN entries for `ALL` / ORCH-1021 factored into this retest

## 3. Test Manifest

| Layer | Files / artifacts | Result |
|---|---|---|
| Parser utility | `app-mobile/src/utils/openingHoursUtils.ts`; `openingHoursUtils.test.ts` | PASS for noon-close and preserved shorthand cases. |
| Single-card helper | `app-mobile/src/utils/singleCardAvailability.ts`; `singleCardAvailability.test.ts` | PASS for `open`, `closed`, `unknown`, and UTC-offset behavior. |
| Curated helper | `app-mobile/src/utils/curatedStopsAvailability.ts`; existing curated tests | PASS. |
| SavedTab scheduling | `SavedTab.tsx` | PASS by source inspection for closed/unknown block. |
| ProposeDateTimeModal scheduling | `ProposeDateTimeModal.tsx` + footer state | PASS by source inspection for unknown no longer enabling schedule. |
| ActionButtons scheduling | `ActionButtons.tsx` | FAIL: curated cards hit the single-card helper before the curated validator. |
| Edge functions | `generate-curated-experiences`, `discover-cards` | PASS for Deno checks/tests. |
| Types/build | `ExpandedCardData`, `PracticalDetailsSection`, `ExpandedCardModal` | FAIL: related TypeScript assignability error. |

## 4. Claim Verification

| Claim / criterion | Evidence | Status |
|---|---|---|
| Noon-close ranges no longer false-open overnight. | `openingHoursUtils.ts:56-63`; Deno tests passed; fail-on-revert proof returned `8 true` and `23 true` on `HEAD^`. | Verified. |
| Single-card helper returns decisive `open/closed/unknown` and blocks unsafe cases. | `singleCardAvailability.ts:44-77`; Deno helper tests passed. | Verified. |
| SavedTab regular-card branch blocks closed and unknown. | `SavedTab.tsx:1195-1212` uses `checkSingleCardSchedulingAvailability` and returns before scheduling when unsafe. | Verified. |
| ProposeDateTimeModal unknown does not set `isPlaceOpen=true`. | `ProposeDateTimeModal.tsx:282-292` sets `isPlaceOpen(availability.isSafeToSchedule)`; unsafe message renders at `610-617`. | Verified. |
| ActionButtons single-card flow blocks closed and unknown. | `ActionButtons.tsx:339-369` blocks unsafe helper results. | Verified for single cards. |
| ActionButtons curated flow routes through `checkAllCuratedStopsOpen` with no weaker semantics. | Curated validator exists at `ActionButtons.tsx:450-468`, but `confirmAndSchedule` runs single-card helper first at `339-349`. | Refuted; see P1-001. |
| `discover-cards` maps `utc_offset_minutes`. | Select includes `utc_offset_minutes` at `discover-cards/index.ts:900-901`; output maps `utcOffsetMinutes` at `612-613`. | Verified. |
| No weak copy/escape remains in scheduling paths. | Source-contract Deno test passed. | Verified. |

## 5. Verification Commands

| Check | Command | Result |
|---|---|---|
| New ORCH-1021 tests | `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/openingHoursUtils.test.ts app-mobile/src/utils/__tests__/singleCardAvailability.test.ts app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts` | PASS: 13 passed, 0 failed. |
| Existing curated tests | `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts` | PASS: 8 passed, 0 failed. |
| Curated generator UTC-offset test | `cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts` | PASS: 2 passed, 0 failed. |
| Curated generator Deno check | `deno check --no-lock supabase/functions/generate-curated-experiences/index.ts` | PASS. |
| Discover cards Deno check | `deno check --no-lock supabase/functions/discover-cards/index.ts` | PASS. |
| Canonical reader strict grep | `node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test && node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs` | PASS: scanned 423 files. |
| Whitespace | `git diff --check` | PASS. |
| Curated ActionButtons logic repro | Deno eval: curated card with one open stop but no top-level `openingHours` | FAIL evidence: single precheck returned `unknown`; curated validator returned `allOpen:true`. |
| Fail-on-revert proof | `git show HEAD^:app-mobile/src/utils/openingHoursUtils.ts` imported into temp Deno eval | PASS evidence: old parser returned true at 8:30 AM and 11:30 PM for `9:00 - 12:00 PM`, so new test would catch the regression. |
| App-mobile TypeScript | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL. Many pre-existing errors remain, plus a related `ExpandedCardModal.tsx:2046` openingHours assignability error caused by the widened ORCH-1021 type. |
| PR presence | `gh pr view --json number,title,url,headRefName,mergeable` | No PR found for the branch. |

## 6. Findings

### P1-001: ActionButtons blocks curated cards with the single-card helper before it reaches the curated stop validator

Evidence:

- `ActionButtons.tsx:339-349` calls `checkSingleCardSchedulingAvailability(card, combinedDateTime)` for every card and only calls `proceedWithScheduling` when that single-card result is safe.
- `ActionButtons.tsx:450-468` does contain the correct `checkAllCuratedStopsOpen(card.stops, scheduledDateTime)` path, but curated cards with no top-level `openingHours` do not reach it.
- Independent Deno repro with a curated card whose only stop is open:
  - Single precheck result: `{"status":"unknown","isSafeToSchedule":false,...}`
  - Curated validator result: `{"allOpen":true,"results":[{"stopName":"Open Stop","status":"open","isOpen":true}]}`

Impact:

Curated cards can be falsely blocked from the expanded-card schedule button even when all stops are open. The user also receives single-place copy (`Mingla could not confirm this place is open...`) instead of the required curated stop verdict. This fails the ORCH-1021 goal for decisive and reliable curated scheduling.

Required rework:

In `confirmAndSchedule`, branch on curated cards before running the single-card helper. Curated cards should call `proceedWithScheduling(combinedDateTime)` so the existing `checkAllCuratedStopsOpen` block owns the stop-level decision. Add a Deno source-contract or component-level test that proves curated ActionButtons does not run single-card availability before the curated validator.

### P1-002: Widening `ExpandedCardData.openingHours` created a related TypeScript assignability regression

Evidence:

- `app-mobile/src/types/expandedCardTypes.ts:45-51` now allows `{ lines?: string[] }` and `string[]`.
- `ExpandedCardModal.tsx:2046` passes `card.openingHours` into `PracticalDetailsSection`.
- `PracticalDetailsSection.tsx:16-27` still accepts the older, narrower opening-hours union.
- `cd app-mobile && npx tsc --noEmit --pretty false` reports:
  - `src/components/ExpandedCardModal.tsx(2046,19): error TS2322 ...`
  - `Type 'string[]' is not assignable...`

Impact:

This can keep a stricter typecheck/build gate red even after the behavior tests pass. It is directly related to this ORCH because the type was widened in the implementation but the dependent prop type was not widened.

Required rework:

Update `PracticalDetailsSectionProps.openingHours` to mirror the same widened type used by `ExpandedCardData.openingHours`, or extract a shared opening-hours type so future widening cannot drift. Rerun the scoped grep against touched/dependent files and record the remaining repo-wide pre-existing TypeScript errors separately.

### P2-001: Regression tests do not cover the curated ActionButtons ordering bug

Evidence:

- `schedulingSourceContract.test.ts` only asserts that `ActionButtons.tsx` contains `checkAllCuratedStopsOpen`.
- The same file does not assert ordering or that curated cards bypass `checkSingleCardSchedulingAvailability`.
- P1-001 shows the current source passes the test while still blocking curated ActionButtons scheduling.

Required rework:

Add coverage that would fail on the current implementation. A source-contract test can assert the curated branch or `proceedWithScheduling` call occurs before single-card helper usage, but a small extracted pure function or component-level test would be stronger.

### P3-001: No PR exists for the pushed branch yet

Evidence:

- `gh pr view --json number,title,url,headRefName,mergeable` returned `no pull requests found for branch "ORCH-1021-curated-stop-timezone-false-open"`.

Impact:

Required GitHub checks cannot run until a PR is opened. This is not the reason for the FAIL, but it must be handled before merge/close.

## 7. Platform Matrix

| Surface | Evidence | Result |
|---|---|---|
| iOS app | Source + pure Deno tests only; runtime simulator smoke not run because P1 source blocker found first. | FAIL by source. |
| Android app | Source + pure Deno tests only; runtime emulator smoke not run because P1 source blocker found first. | FAIL by source. |
| Web/browser | N/A for app-mobile native scheduling surfaces. | N/A. |
| Supabase edge | Deno tests/checks for affected functions passed. | PASS. |
| Business/admin | N/A; no business/admin scheduling surface touched. | N/A. |

## 8. Regression Coverage

The noon-close parser regression has strong coverage and fail-on-revert proof. The old `HEAD^` parser returned open at 8:30 AM and 11:30 PM for `Saturday: 9:00 - 12:00 PM`, while the new tests require those times to be closed.

Single-card closed/unknown behavior is covered by pure helper tests and source-contract tests. Curated ActionButtons ordering is not covered and must be added in rework.

## 9. Security / Privacy

No auth, RLS, payment, ticketing, or private-data surface changed. No security finding.

## 10. Deploy Readiness

Not ready to deploy or merge due P1-001 and P1-002.

After rework passes QA and merges through PR, `discover-cards` must be redeployed from merged `main` for new single-card payloads to include `utcOffsetMinutes`. Preserve the prior ORCH-1021 deploy note for `generate-curated-experiences` if the curated offset passthrough is not already live.

## 11. Retest Instructions

1. Verify `ActionButtons.confirmAndSchedule` sends curated cards directly to the curated stop validator instead of the single-card helper.
2. Add and run a regression test that fails on current commit `75c543e4f` for curated ActionButtons ordering.
3. Fix the `PracticalDetailsSection` opening-hours prop type drift and rerun the TypeScript scoped check.
4. Rerun all commands listed in Section 5.
5. Open a PR before final close so required GitHub checks can run.
