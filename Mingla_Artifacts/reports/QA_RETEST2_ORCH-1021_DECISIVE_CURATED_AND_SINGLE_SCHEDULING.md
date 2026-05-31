# QA Retest 2: ORCH-1021 Decisive Curated + Single-Card Scheduling

Date: 2026-05-30
Mode: RETEST / SPEC-COMPLIANCE
Verdict: CONDITIONAL PASS
Findings: P0:0 P1:0 P2:1 P3:1 P4:3
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1021-[curated-stop-timezone-false-open]`
Branch / commit: `ORCH-1021-curated-stop-timezone-false-open` / `2558d631c`

## 1. Layman Summary

The P1 rework fixed the two release blockers from the prior QA report. Curated cards in the expanded-card schedule flow now skip the single-card availability precheck and reach the all-stops validator, so a missing top-level `openingHours` value no longer prevents stop-level validation.

The Nasher -> Parizade false-open class is covered by the curated regression tests: a Nasher-style omitted-meridiem range is reported closed after 5 PM, and closed/unknown stops block scheduling instead of allowing a weak "maybe" warning.

This is a conditional pass because I verified source and repo-running gates, but did not complete an iOS/Android tap-through runtime smoke on the actual app screen. Seth should run that smoke once before the orchestrator treats the ORCH as fully ready to close.

## 2. Inputs Reviewed

- Prior FAIL report: `Mingla_Artifacts/reports/QA_RETEST_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`
- Current branch diff against `origin/main`
- Active COMMS ledger WARN entries for `ALL` / ORCH-1021

## 3. Claim Verification

| Claim / criterion | Evidence | Status |
|---|---|---|
| Prior P1-001 fixed: expanded-card curated scheduling reaches the curated all-stops validator before any single-card helper. | `ActionButtons.tsx:339-344` branches on `Array.isArray(card.stops) && card.stops.length > 0` and calls `proceedWithScheduling`; `ActionButtons.tsx:457-470` then calls `checkAllCuratedStopsOpen` and blocks unsafe stops. | Verified. |
| Prior P1-002 fixed: widened opening-hours data no longer breaks the dependent prop type. | `PracticalDetailsSection.tsx:16-29` now accepts `{ lines?: string[] }` and `string[]`; scoped TypeScript grep returned no ORCH-touched/dependent errors. | Verified. |
| The Nasher-style false-open parser bug is covered. | `curatedStopsAvailability.test.ts:108-140` asserts `Saturday: 10:00 - 5:00 PM` is closed for Nasher at 5:13 PM while Parizade remains open. | Verified. |
| Closed and unknown single-card scheduling are decisive, not advisory. | `singleCardAvailability.ts:62-76`; helper Deno tests passed for closed, missing hours, unparseable hours, and timezone offset. | Verified. |
| Weak scheduling copy and escape buttons are gone from scoped scheduling paths. | `schedulingSourceContract.test.ts` passed and scans for `Schedule Anyway`, `schedule_anyway`, `may be closed`, and `appears to be closed`. | Verified. |
| UTC offsets flow into new single-card and curated payloads. | `discover-cards/index.ts:612-613` maps `utc_offset_minutes` to `utcOffsetMinutes`; `generate-curated-experiences/index.ts:567-568` emits per-stop `utcOffsetMinutes`. | Verified. |

## 4. Verification Commands

| Check | Command | Result |
|---|---|---|
| ORCH-1021 focused tests | `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/openingHoursUtils.test.ts app-mobile/src/utils/__tests__/singleCardAvailability.test.ts app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts` | PASS: 14 passed, 0 failed. |
| Curated stop tests | `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts` | PASS: 8 passed, 0 failed. |
| Curated generator UTC-offset test | `cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts` | PASS: 2 passed, 0 failed. |
| Curated generator Deno check | `deno check --no-lock supabase/functions/generate-curated-experiences/index.ts` | PASS: exit 0. |
| Discover cards Deno check | `deno check --no-lock supabase/functions/discover-cards/index.ts` | PASS: exit 0. |
| Canonical reader strict grep | `node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test && node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs` | PASS: self-test passed; scanned 423 files. |
| Whitespace | `git diff --check` | PASS. |
| Scoped app-mobile TypeScript grep | `cd app-mobile && npx tsc --noEmit --pretty false 2>&1 \| rg "<ORCH touched/dependent files>" \|\| true` | PASS: no output for ORCH-touched/dependent files. |
| Full app-mobile TypeScript sample | `cd app-mobile && npx tsc --noEmit --pretty false 2>&1 \| head -20` | Still fails on pre-existing unrelated errors, starting with Deno test globals and `BoardDiscussion` types; no `ExpandedCardModal.tsx:2046` opening-hours error remains. |
| Fail-on-old proof for P1-001 regression | Read `HEAD^:app-mobile/src/components/expandedCard/ActionButtons.tsx` and checked ordering | PASS evidence: `{"confirmStart":11884,"singleHelperIndex":12787,"curatedBypassIndex":-1,"wouldFail":true}`. |
| PR presence | `gh pr view --json number,title,url,headRefName,mergeable` | No PR found for branch `ORCH-1021-curated-stop-timezone-false-open`. |

## 5. Findings

### P2-001: Runtime app tap-through smoke is still missing

Evidence:

- Source and Deno proof confirm the scheduling decision logic.
- Maestro is installed (`2.5.1`) and iOS simulators are booted, but no app-tap receipt was captured for the actual Nasher -> Parizade schedule flow on iOS or Android during this retest.

Impact:

The core bug class is covered by deterministic tests, but a user-visible scheduling flow should still get one end-to-end app smoke before close because native state, card payload freshness, and modal wiring can still drift outside the pure helpers.

Manual smoke gate:

1. Open the consumer app on iOS and Android from this branch build.
2. Open a curated card containing Nasher Museum of Art and Parizade.
3. Schedule for a time after Nasher closes while Parizade is open.
4. Expected: Mingla shows `Not Safe to Schedule`, names Nasher as closed or unavailable, and does not offer `Schedule Anyway`.
5. Schedule for a time where every stop is open.
6. Expected: scheduling proceeds; no weak "maybe" copy appears.
7. Repeat with a single-place card that is closed or has unknown hours.
8. Expected: closed/unknown single cards are blocked with definitive copy.

### P3-001: No PR exists yet

Evidence:

- `gh pr view --json number,title,url,headRefName,mergeable` returned `no pull requests found for branch "ORCH-1021-curated-stop-timezone-false-open"`.

Impact:

Required GitHub checks cannot run until the branch has a PR. This does not block the local code retest, but it blocks merge/close readiness.

## 6. Platform Matrix

| Surface | Evidence | Result |
|---|---|---|
| Consumer iOS | Source inspection + Deno helper tests; iOS runtime tap-through not captured. | CONDITIONAL PASS; manual smoke required. |
| Consumer Android | Source inspection + Deno helper tests; Android runtime tap-through not captured. | CONDITIONAL PASS; manual smoke required. |
| Consumer web | N/A; affected schedule surfaces are app-mobile native. | N/A. |
| Supabase edge | Deno checks/tests for `discover-cards` and `generate-curated-experiences`. | PASS. |
| Business/admin | N/A; no business/admin scheduling surface touched. | N/A. |

## 7. Regression Coverage

Coverage is now adequate for local merge gating:

- Noon-close false-open coverage exists in `openingHoursUtils.test.ts`.
- Nasher-style curated false-open coverage exists in `curatedStopsAvailability.test.ts`.
- Closed/unknown single-card scheduling coverage exists in `singleCardAvailability.test.ts`.
- Weak-copy removal and ActionButtons curated ordering coverage exists in `schedulingSourceContract.test.ts`.
- The new ordering test has fail-on-old proof against the QA-failed parent commit.

The remaining gap is runtime tap-through, not automated unit coverage.

## 8. Security / Privacy

No auth, RLS, payment, ticketing, or private-data surface changed. No security finding.

## 9. Deploy Readiness

No migration was added.

After merge through PR, redeploy `discover-cards` from merged `main` so new single-card payloads include `utcOffsetMinutes`. Also redeploy `generate-curated-experiences` from merged `main` if the curated offset passthrough is not already live.

Do not close the ORCH as a full PASS until the manual iOS/Android scheduling smoke above is recorded or Seth explicitly accepts the conditional gate.
