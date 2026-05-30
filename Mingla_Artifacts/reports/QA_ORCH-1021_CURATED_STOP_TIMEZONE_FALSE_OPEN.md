# QA Report: ORCH-1021 Curated Stop Timezone False-Open

> Date: 2026-05-30
> Mode: TARGETED
> Verdict: FAIL
> Findings: P0:0 P1:1 P2:0 P3:0 P4:2

## 1. Layman Summary

The specific Nasher Museum of Art -> Parizade bug Seth reported is fixed: Nasher-style `10:00 - 5:00 PM` hours are now parsed as 10 AM to 5 PM, and the scheduler blocks after 5 PM.

Release is still blocked because the same meridiem-inference code creates a new false-open for common noon-closing ranges. A stop with Google-style `Saturday: 9:00 - 12:00 PM` is treated as open overnight before 9 AM and again at 11 PM, so Mingla can still say a stop is safe when it is closed.

## 2. Inputs Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1021_CURATED_STOP_TIMEZONE_FALSE_OPEN.md`
- Changed files:
  - `app-mobile/src/utils/openingHoursUtils.ts`
  - `app-mobile/src/utils/curatedStopsAvailability.ts`
  - `app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts`
  - `app-mobile/src/components/activity/SavedTab.tsx`
  - `app-mobile/src/components/activity/CalendarTab.tsx`
  - `supabase/functions/generate-curated-experiences/index.ts`
  - `supabase/functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts`
- Prior context: ORCH-1019 curated-hours canonical-reader path and Seth's live Nasher -> Parizade repro.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RLS | N/A | No migration or RLS change in this ORCH. |
| Edge/RPC/Webhooks | `generate-curated-experiences/index.ts`; `utc_offset_passthrough.test.ts` | Confirmed generated curated stops include `utcOffsetMinutes` source contract. |
| Services | `openingHoursUtils.ts`; `curatedStopsAvailability.ts` | Checked parse semantics, unknown/closed/open verdicts, cumulative stop arrival behavior. |
| Hooks/State/Cache | N/A | No cache or persisted-state ownership changed. |
| Components/Screens | `SavedTab.tsx`; `CalendarTab.tsx` | Checked alert copy moves to definitive safe/not-safe language and unsafe path blocks scheduling. |
| Tests/Build | Deno unit tests, Deno check, strict-grep, whitespace | Ran scoped automated gates and an independent parser repro. |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| Nasher-style `10:00 - 5:00 PM` parses as AM-to-PM and blocks after 5 PM. | `curatedStopsAvailability.test.ts` T-05; independent `deno eval`; `openingHoursUtils.ts:56-60`. | Verified | T-05 passed; `10-5pm-after false`. |
| Parizade-style `5:00 - 10:00 PM` parses as evening and does not open before 5 PM. | `curatedStopsAvailability.test.ts` T-01/T-05; independent `deno eval`. | Verified | `5-10pm-before false`, `5-10pm-during true`. |
| Unknown/unparseable curated hours block safe scheduling. | `curatedStopsAvailability.ts:82-104`; T-04. | Verified | `status: unknown`, `isOpen: false`, `allOpen: false`. |
| User-facing scheduling copy is definitive, not maybe/advisory. | `rg` across changed app-mobile files. | Verified | Active alert titles are `Safe to Schedule` and `Not Safe to Schedule`; no active `May be closed` copy remains in these paths. |
| Meridiem inference is safe for omitted-open ranges generally. | Independent parser repro against `Saturday: 9:00 - 12:00 PM`. | Refuted | Noon-closing ranges are treated as overnight and false-open before business opens. See P1-001. |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Curated availability unit tests | `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts` | PASS | 8 passed, 0 failed. |
| Curated generator UTC offset source contract | `cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts` | PASS | 2 passed, 0 failed. |
| Edge function type check | `deno check --no-lock supabase/functions/generate-curated-experiences/index.ts` | PASS | Exit 0. |
| Canonical reader strict-grep | `node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test && node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs` | PASS | Self-test passed; scanned 422 files; 0 direct day-key lookups. |
| Whitespace | `git diff --check` | PASS | Exit 0. |
| Independent noon-close parser repro | `deno eval --no-check --sloppy-imports "import { isPlaceOpenAt } from './app-mobile/src/utils/openingHoursUtils.ts'; for (const hour of [0,1,8,9,11,12,13,23]) console.log(hour, isPlaceOpenAt(['Saturday: 9:00 - 12:00 PM'], new Date(2026,4,30,hour,30,0)));" ` | FAIL | Returned `true` at 00:30, 01:30, 08:30, and 23:30; expected false outside 9 AM-noon. |

## 6. Constitution Compliance

| Rule | Verdict | Evidence |
|---|---|---|
| No dead taps | N/A | No tap target behavior changed beyond existing alerts. |
| One owner per truth | PASS | SavedTab and CalendarTab route through shared `checkAllCuratedStopsOpen`. |
| No silent failures | PASS | Unknown hours now block and explain `Hours unavailable at <time>`. |
| One key per entity | N/A | No query keys changed. |
| Server state server-side | N/A | No state ownership change. |
| Logout clears everything | N/A | No auth/logout path touched. |
| Label temporary | N/A | No temporary product labels added. |
| Subtract before adding | N/A | No replacement-flow mutation changed. |
| No fabricated data | FAIL | P1-001 still fabricates open status for noon-closing ranges before opening time. |
| Currency-aware | N/A | No money path touched. |
| One auth instance | N/A | No auth instance touched. |
| Validate at right time | PARTIAL | The selected arrival time is used; parser still misclassifies a common time range. |
| Exclusion consistency | N/A | No exclusion set touched. |
| Persisted-state startup | N/A | No persisted-state startup behavior changed. |

## 7. Findings

### P1 High

**P1-001: Noon-closing Google ranges can still produce a false "safe to schedule" verdict**

- **Evidence:** `app-mobile/src/utils/openingHoursUtils.ts:56-60` infers omitted open meridiem as `PM` whenever `closePeriod === 'PM'` and `openHour <= closeHour`. For `9:00 - 12:00 PM`, that becomes 9 PM -> noon and is treated as an overnight range.
- **Repro:** `isPlaceOpenAt(['Saturday: 9:00 - 12:00 PM'], new Date(2026,4,30,1,30,0))` returned `true`; expected `false`.
- **Observed output:** for hours `[0,1,8,9,11,12,13,23]`, the parser returned `true true true true true false false true`.
- **What is wrong:** Common noon-close hours are marked open from midnight until noon and again late at night. The correct open window is 9 AM through 11:59 AM only.
- **Impact:** Mingla can still tell a user a curated stop is safe when it is closed, just in a different omitted-meridiem shape than the Nasher case. This violates the core ORCH-1021 goal: definitive safe/not-safe scheduling.
- **Required fix:** In `inferOpenPeriod`, handle `closePeriod === 'PM' && closeHour === 12` as a noon-close special case: infer `AM` for omitted open hours 1-11, and infer `PM` only when the open hour is 12. Preserve the existing `10:00 - 5:00 PM` and `5:00 - 10:00 PM` behavior.
- **Required regression:** Add Deno-runnable tests proving `Saturday: 9:00 - 12:00 PM` is closed before 9 AM, open during 9 AM-noon, closed at noon, and closed late at night. The tests should fail on the current branch and pass after the fix.
- **Retest:** Rerun the existing curated availability tests, the new noon-close tests, Supabase UTC offset test, Deno check, strict-grep, and `git diff --check`.

### P4 Notes

**P4-001: Seth's live Nasher -> Parizade repro is covered**

- **Evidence:** `curatedStopsAvailability.test.ts` T-05 passed and the independent parser check returned `false` for `10:00 - 5:00 PM` at 5:13 PM.
- **Note:** This should stay as a regression after the rework.

**P4-002: Edge deploy remains a post-merge requirement**

- **Evidence:** `generate-curated-experiences/index.ts` now emits `utcOffsetMinutes`; source-contract test passed.
- **Note:** The generator timezone passthrough only affects newly generated cards after the edge function is redeployed from merged `main`.

## 8. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Do not say all stops are open unless every stop is proven open. | FAIL | Noon-close false-open repro. | P1-001 |
| Unknown hours must block safe scheduling. | PASS | T-04; `curatedStopsAvailability.ts:96-104`. | None |
| User-facing warning must be definitive. | PASS | Alert copy check in `SavedTab.tsx` and `CalendarTab.tsx`. | None |
| Check selected arrival time, not current time. | PASS | Shared validator uses `startTime` plus cumulative stop duration/travel. | None |
| Preserve canonical reader path. | PASS | Strict-grep passed. | None |

## 9. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Auth/RLS/payment/privacy | N/A | No auth, RLS, payment, or private data surface changed. | Not in scope. |

## 10. UX / Accessibility

| Screen/state | Finding/check | Severity | Result |
|---|---|---|---|
| Saved curated schedule | Definitive title and body when not all stops are proven open. | P4 | Copy verified by source read. Runtime device smoke test still recommended after rework. |
| Calendar reschedule | Same unsafe copy path as saved scheduling. | P4 | Copy verified by source read. Runtime device smoke test still recommended after rework. |

## 11. Parity

| Surface/path | Tested? | Result | Notes |
|---|---|---|---|
| Mobile | Yes | FAIL | Shared mobile utility still has P1 parser false-open. |
| Business | N/A | N/A | No business surface touched. |
| Admin | N/A | N/A | No admin surface touched. |
| Public/web | N/A | N/A | No public web surface touched. |
| Solo | Yes | FAIL | Curated schedule path can false-open noon-close ranges. |
| Collab | Partial | FAIL | Shared validator is used by reschedule path; same parser risk applies. |
| iOS | Source/test only | FAIL | Device smoke remains after rework. |
| Android | Source/test only | FAIL | Device smoke remains after rework. |

## 12. Cross-Domain Impact

| Change | Mobile | Business | Admin | Edge/RPC | RLS/Data | Notes |
|---|---|---|---|---|---|---|
| Meridiem inference | Blocks release | N/A | N/A | N/A | N/A | Needs rework for noon-close ranges. |
| Unknown-hours blocking | Pass | N/A | N/A | N/A | N/A | Correctly fails closed. |
| UTC offset passthrough | Mobile consumes when present | N/A | N/A | Pass source-contract | N/A | Requires edge redeploy after merge. |

## 13. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Nasher -> Parizade after Nasher closes | Automated unit test and independent parser check | PASS | Smoke on iOS/Android after rework. |
| Noon-close stop before opening | Independent parser check | FAIL | Add automated regression, then smoke if a real curated stop fixture exists. |
| Edge function emits UTC offset | Source-contract Deno test | PASS | Redeploy from merged `main`; confirm new card payload includes `utcOffsetMinutes`. |

## 14. Required Actions

1. **P1-001:** Rework `inferOpenPeriod` so `closePeriod === 'PM' && closeHour === 12` infers AM for omitted open hours 1-11. Add regression tests for `9:00 - 12:00 PM` before-open, during-open, at-close, and late-night cases.

## 15. Conditional / Recommended Actions

1. Keep the Nasher -> Parizade regression test exactly in scope; it proves Seth's reported case stays fixed.
2. After merge, deploy `generate-curated-experiences` from `main` before relying on `utcOffsetMinutes` for newly generated curated cards.

## 16. Discoveries For Orchestrator

- None beyond the ORCH-1021 FAIL finding above; this is same-ORCH rework, not a new cross-ORCH discovery.

## 17. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| ORCH-1019/1021 Nasher omitted-AM range false-open | Yes | T-05 and independent parser check. | Covered. |
| Unknown hours treated as safe/open-enough | Yes | T-04 and shared validator source. | Covered. |
| Noon-close omitted-AM range false-open | No | Independent repro. | Missing and required. |

Retest cycle: 1
